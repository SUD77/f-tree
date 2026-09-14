/*
 * What the golden file cannot check.
 *
 * `vectors.test.js` pins the bytes this side produces against the bytes the Kotlin produces, which
 * is the right tool for agreement and the wrong one for refusal: a table of correct answers says
 * nothing about what happens when the input is wrong, and every input in this package arrives from
 * somebody else's device.
 *
 * So these are the cases where the answer is "no". A beacon that is noise, a name that would draw
 * as another device's name, an address that is not on this network, a frame claiming to be four
 * gigabytes. The Kotlin has the same assertions in its own suite; where a test here has a twin
 * there, the comment says so, because a rule enforced on one side only is a rule a peer can walk
 * around by running the other implementation.
 */

const test = require('node:test');
const assert = require('node:assert');

const protocol = require('./protocol');
const names = require('./names');
const beacon = require('./beacon');
const messages = require('./messages');
const negotiation = require('./negotiation');
const qrlink = require('./qrlink');
const dh = require('./dh');
const { FrameReader, encodeFrame } = require('./frame');
const { ByteWriter, ByteReader } = require('./bytes');
const { PROBLEM, NearbyFailure } = require('./problems');

// Names ---------------------------------------------------------------------------------------

test('a name cannot smuggle a bidi override', () => {
  // The one in this file that is not cosmetic. Left in, a device names itself so that it *renders*
  // as another device's name, and choosing the right row in a list stops meaning anything.
  const attack = 'Quiet ‮Heron';
  const safe = names.sanitise(attack);
  assert.ok(!safe.includes('‮'), `override survived: ${JSON.stringify(safe)}`);
  assert.equal(safe, 'Quiet Heron');

  for (const control of ['‪', '‫', '‬', '‭', '⁦', '⁧', '⁨', '⁩']) {
    assert.ok(!names.sanitise(`a${control}b`).includes(control), control.codePointAt(0).toString(16));
  }
});

test('a name cannot contain a newline, because a row is one line high', () => {
  assert.equal(names.sanitise('Quiet\nHeron'), 'Quiet Heron');
  assert.equal(names.sanitise('Quiet\t\tHeron'), 'Quiet Heron');
  assert.equal(names.sanitise('  Quiet  Heron  '), 'Quiet Heron');
});

test('a name that is nothing but control characters is nothing', () => {
  // Returns null rather than an empty string, so the caller substitutes a generated name instead
  // of drawing a blank row that cannot be clicked or described.
  assert.equal(names.sanitise('\x00\x01\u202e'), null);
  assert.equal(names.sanitise('   '), null);
  assert.equal(names.sanitise(''), null);
});

test('two spellings of one name compare equal after NFC', () => {
  const composed = 'Amélie';
  const decomposed = 'Amélie';
  assert.notEqual(composed, decomposed);
  assert.equal(names.sanitise(composed), names.sanitise(decomposed));
});

test('truncation cuts between characters, never through one', () => {
  // A name cut mid-character decodes to a replacement glyph on the other device. The limit counts
  // UTF-8 bytes, so the test has to use something wider than ASCII to mean anything.
  const devanagari = 'अ'.repeat(40); // three bytes each, so 120 against a 64-byte ceiling
  const cut = names.truncateToBytes(devanagari, protocol.BEACON_MAX_NAME_BYTES);
  assert.ok(Buffer.byteLength(cut, 'utf8') <= protocol.BEACON_MAX_NAME_BYTES);
  assert.equal(cut, 'अ'.repeat(21)); // 63 bytes; a 22nd would be 66
  assert.ok(!cut.includes('�'));
});

test('an emoji is kept or dropped whole', () => {
  // Surrogate pairs are one codepoint. Iterating UTF-16 units would cut one in half and produce a
  // lone surrogate, which is not valid UTF-8 at all.
  const withEmoji = `${'n'.repeat(62)}👪`;
  const cut = names.truncateToBytes(withEmoji, protocol.BEACON_MAX_NAME_BYTES);
  assert.ok(!cut.includes('👪'), 'the emoji needs 4 bytes and only 2 were left');
  assert.ok(Buffer.byteLength(cut, 'utf8') <= protocol.BEACON_MAX_NAME_BYTES);
});

test('the generated name is stable and depends only on the first two bytes', () => {
  const a = Buffer.alloc(16, 0);
  const b = Buffer.alloc(16, 0);
  b[15] = 0xff;
  assert.equal(names.friendlyName(a), names.friendlyName(b));
  assert.equal(names.friendlyName(a), names.friendlyName(a));
});

// Beacons -------------------------------------------------------------------------------------

test('a beacon that is noise is null, never an exception', () => {
  // Discovery has nowhere to report a fault and no reason to: a datagram on a shared port is as
  // likely to be some other protocol as a bug. The only thing a bad beacon should cost is the
  // microsecond spent looking at it.
  assert.equal(beacon.decodeBeacon(Buffer.alloc(0)), null);
  assert.equal(beacon.decodeBeacon(Buffer.alloc(10)), null);
  assert.equal(beacon.decodeBeacon(Buffer.from('not an f-tree beacon at all, but long enough')), null);
  assert.equal(beacon.decodeBeacon(Buffer.alloc(protocol.BEACON_MAX_SIZE, 0xff)), null);
});

test('a beacon truncated part-way through a field is null', () => {
  const whole = beacon.encodeBeacon(
    beacon.announce({
      platform: beacon.PLATFORM.LINUX,
      flags: 1,
      tcpPort: 4000,
      deviceId: Buffer.alloc(16, 3),
      keyFingerprint: Buffer.alloc(8, 4),
      displayName: 'Quiet Heron',
    }),
  );
  assert.ok(beacon.decodeBeacon(whole) !== null);
  for (let cut = 1; cut < whole.length; cut += 1) {
    assert.equal(beacon.decodeBeacon(whole.subarray(0, cut)), null, `truncated to ${cut}`);
  }
});

test('a longer beacon than this version knows about is still read', () => {
  // What lets a later version append a field without this one refusing to see the device at all.
  const whole = beacon.encodeBeacon(
    beacon.announce({
      platform: beacon.PLATFORM.ANDROID,
      flags: 1,
      tcpPort: 4000,
      deviceId: Buffer.alloc(16, 3),
      keyFingerprint: Buffer.alloc(8, 4),
      displayName: 'Quiet Heron',
    }),
  );
  const extended = Buffer.concat([whole, Buffer.from('a field from version 2')]);
  const decoded = beacon.decodeBeacon(extended);
  assert.ok(decoded !== null);
  assert.equal(decoded.displayName, 'Quiet Heron');
  assert.equal(decoded.tcpPort, 4000);
});

test('an announcement with no name is refused, but a query may be nameless', () => {
  // A nameless announcement is not a device anybody can pick out of a list. A QUERY says only that
  // somebody is looking and carries nothing about who, which is the point of it.
  const nameless = new ByteWriter()
    .bytes(protocol.MAGIC)
    .u8(1).u8(1).u8(protocol.BEACON_ANNOUNCE).u8(1)
    .u16(0).u16(4000)
    .bytes(Buffer.alloc(16, 3))
    .bytes(Buffer.alloc(protocol.KEY_FINGERPRINT_BYTES))
    .u8(0)
    .toBuffer();
  assert.equal(beacon.decodeBeacon(nameless), null);

  const query = beacon.decodeBeacon(beacon.encodeBeacon(beacon.query()));
  assert.ok(query !== null);
  assert.equal(query.displayName, '');
  assert.equal(query.tcpPort, 0);
});

test('a beacon whose versions are the wrong way round is refused', () => {
  const backwards = new ByteWriter()
    .bytes(protocol.MAGIC)
    .u8(1).u8(9).u8(protocol.BEACON_ANNOUNCE).u8(1)
    .u16(0).u16(4000)
    .bytes(Buffer.alloc(16, 3))
    .bytes(Buffer.alloc(protocol.KEY_FINGERPRINT_BYTES))
    .lengthPrefixed(Buffer.from('Quiet Heron'), 64)
    .toBuffer();
  assert.equal(beacon.decodeBeacon(backwards), null);
});

test('a hostile name in a beacon is sanitised on the way in', () => {
  const hostile = beacon.encodeBeacon({
    messageType: protocol.BEACON_ANNOUNCE,
    maxVersion: 1,
    minVersion: 1,
    platform: beacon.PLATFORM.ANDROID,
    flags: 0,
    tcpPort: 4000,
    deviceId: Buffer.alloc(16, 3),
    keyFingerprint: Buffer.alloc(8),
    displayName: 'Quiet ‮Heron',
  });
  assert.ok(!beacon.decodeBeacon(hostile).displayName.includes('‮'));
});

test('speakable is false for a peer whose range does not overlap', () => {
  const at = (minVersion, maxVersion) => ({ minVersion, maxVersion });
  assert.ok(beacon.speakable(at(1, 1)));
  assert.ok(!beacon.speakable(at(2, 5)));
  assert.ok(!beacon.speakable(at(0, 0)));
});

// Messages ------------------------------------------------------------------------------------

test('a greeting with the wrong magic is not an f-tree peer', () => {
  // A distinct code from a malformed frame, because they need different sentences: something
  // answered on that port and it was not this app.
  const wrong = Buffer.concat([Buffer.from('NOPE'), Buffer.alloc(40)]);
  assert.throws(
    () => messages.Hello.decode(wrong),
    (error) => error instanceof NearbyFailure && error.problem === PROBLEM.NOT_A_NEARBY_PEER,
  );
});

test('a greeting claiming the wrong role is refused', () => {
  // A receiver must not be able to answer a HELLO with another HELLO. The state machine would
  // otherwise have two senders and no receiver, both waiting.
  const asReceiver = messages.HelloAck.encode({
    chosenVersion: 1,
    platform: beacon.PLATFORM.LINUX,
    flags: 1,
    deviceId: Buffer.alloc(16, 1),
    displayName: 'Amber Otter',
    keyCommitment: Buffer.alloc(protocol.KEY_COMMITMENT_BYTES),
  });
  assert.throws(
    () => messages.Hello.decode(asReceiver),
    (error) => error.problem === PROBLEM.UNEXPECTED_MESSAGE,
  );
});

test('a hello ack without its commitment is malformed rather than accepted', () => {
  // A receiver that left the promise out would be free to choose its nonce after the sender's,
  // which is the one thing the promise exists to stop.
  const whole = messages.HelloAck.encode({
    chosenVersion: 1,
    platform: beacon.PLATFORM.LINUX,
    flags: 1,
    deviceId: Buffer.alloc(16, 1),
    displayName: 'Amber Otter',
    keyCommitment: Buffer.alloc(protocol.KEY_COMMITMENT_BYTES, 9),
  });
  assert.deepEqual(messages.HelloAck.decode(whole).keyCommitment, Buffer.alloc(32, 9));
  assert.throws(
    () => messages.HelloAck.decode(whole.subarray(0, whole.length - 1)),
    (error) => error instanceof NearbyFailure && error.problem === PROBLEM.MALFORMED_FRAME,
  );
});

test('a truncated message is malformed rather than a crash', () => {
  const whole = messages.Offer.encode({
    peopleCount: 1,
    relationshipCount: 0,
    photoCount: 0,
    totalBytes: 10n,
    sha256: Buffer.alloc(32, 1),
    treeFormatVersion: 1,
    suggestedFileName: 'x.ftree',
  });
  for (const cut of [0, 1, 10, 20, whole.length - 1]) {
    assert.throws(
      () => messages.Offer.decode(whole.subarray(0, cut)),
      (error) => error instanceof NearbyFailure && error.problem === PROBLEM.MALFORMED_FRAME,
      `cut to ${cut}`,
    );
  }
});

test('a key message of the wrong size is refused rather than padded', () => {
  assert.throws(() => messages.KeyMessage.encode({
    publicKey: Buffer.alloc(255),
    nonce: Buffer.alloc(protocol.HANDSHAKE_NONCE_BYTES),
  }));
  // 255 rather than 256 is the padding bug's shape. Refusing it here means a peer that has it
  // fails at the message rather than silently deriving a different key.
});

test('an abort with no payload is UNKNOWN rather than a crash', () => {
  assert.equal(messages.Abort.decode(Buffer.alloc(0)).problem, PROBLEM.UNKNOWN);
  assert.equal(messages.Abort.decode(Buffer.from([0x99])).problem, PROBLEM.UNKNOWN);
  assert.equal(messages.Abort.decode(Buffer.from([0x0c])).problem, PROBLEM.DECLINED);
});

// Negotiation ---------------------------------------------------------------------------------

test('two builds with no version in common say which one is behind', () => {
  assert.equal(negotiation.chooseVersion(1, 1, 1, 1), 1);
  assert.equal(negotiation.chooseVersion(3, 1, 1, 1), 1);

  assert.throws(
    () => negotiation.chooseVersion(5, 5, 1, 1),
    (error) => error.problem === PROBLEM.PROTOCOL_TOO_NEW,
  );
  assert.throws(
    () => negotiation.chooseVersion(1, 1, 5, 5),
    (error) => error.problem === PROBLEM.PROTOCOL_TOO_OLD,
  );
});

test('flags are the intersection, and never a bit this build does not know', () => {
  const both = protocol.FLAG_ACCEPTS_TREE;
  assert.equal(negotiation.negotiateFlags(both, both), both);
  assert.equal(negotiation.negotiateFlags(both, 0), 0);
  // A peer claiming a capability from a later version cannot turn it on here by asserting it.
  assert.equal(negotiation.negotiateFlags(0xffff, 0xffff), protocol.SUPPORTED_FLAGS);
  assert.equal(negotiation.negotiateFlags(protocol.FLAG_MERGE_SYNC, protocol.FLAG_MERGE_SYNC), 0);
});

test('the sender refuses a version it never offered', () => {
  const flags = protocol.FLAG_ACCEPTS_TREE;
  negotiation.verifyChosen(1, flags, 1, 1, flags, flags);

  assert.throws(
    () => negotiation.verifyChosen(2, flags, 1, 1, flags, flags),
    (error) => error.problem === PROBLEM.UNEXPECTED_MESSAGE,
  );
  // And a capability it never advertised.
  assert.throws(
    () => negotiation.verifyChosen(1, flags, 1, 1, 0, flags),
    (error) => error.problem === PROBLEM.UNEXPECTED_MESSAGE,
  );
});

test('a file too new for the other side is refused before it is sent', () => {
  negotiation.verifyTreeFormat(1, 1);
  negotiation.verifyTreeFormat(1, 2);
  assert.throws(
    () => negotiation.verifyTreeFormat(2, 1),
    (error) => error.problem === PROBLEM.TREE_FORMAT_TOO_NEW,
  );
});

// QR links ------------------------------------------------------------------------------------

test('a link survives a round trip, token and all', () => {
  const original = {
    address: '192.168.1.42',
    port: 49813,
    deviceId: Buffer.from(Array.from({ length: 16 }, (_, i) => (i * 7) & 0xff)),
    keyFingerprint: Buffer.alloc(8, 2),
    token: Buffer.alloc(16, 3),
    displayName: 'Quiet Heron',
  };
  const parsed = qrlink.parseQrLink(qrlink.encodeQrLink(original));
  assert.equal(parsed.address, original.address);
  assert.equal(parsed.port, original.port);
  assert.deepEqual(parsed.deviceId, original.deviceId);
  assert.deepEqual(parsed.token, original.token);
  assert.equal(parsed.displayName, 'Quiet Heron');
});

test('a link to somewhere on the internet is refused outright', () => {
  // Not a warning and not a prompt. It is either a mistake or an attempt to make this machine post
  // somebody's family to a host on the internet, and there is no third reading.
  for (const address of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '11.0.0.1', '192.169.1.1']) {
    const link = qrlink.encodeQrLink({
      address,
      port: 4000,
      deviceId: Buffer.alloc(16, 1),
      keyFingerprint: Buffer.alloc(8),
    });
    assert.equal(qrlink.parseQrLink(link), null, address);
  }
});

test('a dotted quad with a leading zero is refused rather than guessed', () => {
  // Some parsers read "010" as octal 8. Refusing the shape is the only answer that is the same in
  // every parser anybody might later route this string through.
  assert.equal(qrlink.isPrivateAddress('10.0.0.010'), false);
  assert.equal(qrlink.isPrivateAddress('010.0.0.1'), false);
  assert.equal(qrlink.isPrivateAddress('10.0.0.1'), true);
});

test('a malformed address is refused in every shape', () => {
  for (const address of ['', '10.0.0', '10.0.0.1.1', '10.0.0.256', '10.0.0.x', '10.0.0.', 'ten.0.0.1']) {
    assert.equal(qrlink.isPrivateAddress(address), false, JSON.stringify(address));
  }
});

test('loopback is testable but not private', () => {
  // Kept apart so the rule a scanned code is held to stays the narrow one. Only the test harness
  // and the desktop's own smoke run pass the wider check.
  assert.equal(qrlink.isPrivateAddress('127.0.0.1'), false);
  assert.equal(qrlink.isTestableAddress('127.0.0.1'), true);
  // The emulator reaches its host here, and it is inside 10/8, so it passes both.
  assert.equal(qrlink.isPrivateAddress('10.0.2.2'), true);
});

test('a token of the wrong length makes the whole link invalid', () => {
  // Silently dropping a malformed token would turn a QR pairing into an unpaired one, and the
  // difference is whether the six-digit comparison may be skipped.
  const base = `${protocol.QR_SCHEME}://${protocol.QR_HOST}${protocol.QR_PATH}` +
    '?a=192.168.1.1&p=4000&d=' + '01'.repeat(16) + '&f=' + Buffer.alloc(8).toString('base64url');
  assert.ok(qrlink.parseQrLink(`${base}&v=1`) !== null);
  assert.equal(qrlink.parseQrLink(`${base}&t=${Buffer.alloc(8).toString('base64url')}&v=1`), null);
  assert.equal(qrlink.parseQrLink(`${base}&t=not-base64!!&v=1`), null);
});

test('anything that is not an ftree link is not a link', () => {
  for (const text of [
    '',
    'https://example.com',
    'ftree://nearby/v2?a=10.0.0.1',
    'ftree://elsewhere/v1?a=10.0.0.1',
  ]) {
    assert.equal(qrlink.parseQrLink(text), null, JSON.stringify(text));
  }
});

test('an unknown field in a link is ignored rather than fatal', () => {
  const base = `${protocol.QR_SCHEME}://${protocol.QR_HOST}${protocol.QR_PATH}` +
    '?a=192.168.1.1&p=4000&d=' + '01'.repeat(16) + '&f=' + Buffer.alloc(8).toString('base64url') +
    '&z=something-from-version-2&v=1';
  assert.ok(qrlink.parseQrLink(base) !== null);
});

// Framing and readers -------------------------------------------------------------------------

test('a frame claiming four gigabytes is refused, not allocated', () => {
  // The single most important guard in the protocol: the length prefix is the one field read
  // before anything is allocated, so it is the one field a stranger uses to exhaust memory.
  const reader = new FrameReader();
  assert.throws(() => reader.feed(Buffer.from([0xff, 0xff, 0xff, 0xff, 0x01])), /FRAME_TOO_LARGE/);
});

test('a frame claiming zero length is refused', () => {
  // The length counts the type byte, so the smallest legal value is 1. Zero would leave the reader
  // at an offset it cannot advance from.
  const reader = new FrameReader();
  assert.throws(() => reader.feed(Buffer.from([0, 0, 0, 0, 0x01])), /FRAME_TOO_LARGE/);
});

test('a frame split one byte at a time still arrives whole', () => {
  const payload = Buffer.from(Array.from({ length: 300 }, (_, i) => i & 0xff));
  const encoded = encodeFrame(protocol.TYPE_DATA, payload);
  const reader = new FrameReader();
  const frames = [];
  for (const byte of encoded) frames.push(...reader.feed(Buffer.from([byte])));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].type, protocol.TYPE_DATA);
  assert.deepEqual(frames[0].payload, payload);
  assert.equal(reader.pending, 0);
});

test('several frames in one read all come back, in order', () => {
  const reader = new FrameReader();
  const frames = reader.feed(Buffer.concat([
    encodeFrame(protocol.TYPE_HELLO, Buffer.from([1])),
    encodeFrame(protocol.TYPE_OFFER, Buffer.from([2])),
    encodeFrame(protocol.TYPE_END, Buffer.from([3])),
  ]));
  assert.deepEqual(frames.map((f) => f.type), [protocol.TYPE_HELLO, protocol.TYPE_OFFER, protocol.TYPE_END]);
  assert.deepEqual(frames.map((f) => f.payload[0]), [1, 2, 3]);
});

test('a reader holds an incomplete frame rather than guessing at it', () => {
  const encoded = encodeFrame(protocol.TYPE_DATA, Buffer.alloc(100, 7));
  const reader = new FrameReader();
  assert.deepEqual(reader.feed(encoded.subarray(0, 50)), []);
  assert.ok(reader.pending > 0);
  const frames = reader.feed(encoded.subarray(50));
  assert.equal(frames.length, 1);
  assert.equal(reader.pending, 0);
});

test('a payload past the ceiling cannot be encoded either', () => {
  assert.throws(
    () => encodeFrame(protocol.TYPE_DATA, Buffer.alloc(protocol.MAX_FRAME_BODY)),
    /too large/,
  );
});

test('a reader past the end of a buffer is malformed, not undefined', () => {
  // Buffer reads are famously forgiving in some shapes and throw in others. Every read in this
  // package goes through one check so a truncated message has one answer.
  const reader = new ByteReader(Buffer.alloc(2));
  assert.throws(() => reader.u32(), (error) => error.problem === PROBLEM.MALFORMED_FRAME);
  assert.throws(() => reader.u64(), (error) => error.problem === PROBLEM.MALFORMED_FRAME);
  assert.throws(() => reader.bytes(3), (error) => error.problem === PROBLEM.MALFORMED_FRAME);
});

test('a 64-bit field survives values a Number would round', () => {
  const written = new ByteWriter().u64(2n ** 64n - 1n).u64(2n ** 53n + 1n).toBuffer();
  const reader = new ByteReader(written);
  assert.equal(reader.u64(), 2n ** 64n - 1n);
  assert.equal(reader.u64(), 2n ** 53n + 1n);
});

// Key agreement -------------------------------------------------------------------------------

test('a peer public key in a small subgroup is refused before it is used', () => {
  // p is a safe prime, so its only small subgroups are {1} and {1, p-1}. A peer sending 1 would
  // force a shared secret of 1, and every later frame would be encrypted under a key it chose.
  for (const bad of [0n, 1n, dh.P - 1n, dh.P, dh.P + 1n]) {
    assert.throws(() => dh.sharedSecret(12345n, bad), /BAD_PUBLIC_KEY/, `y=${bad}`);
  }
});

test('two sides of a real exchange reach the same secret', () => {
  const a = dh.generatePrivate();
  const b = dh.generatePrivate();
  assert.equal(
    dh.sharedSecret(a, dh.publicOf(b)).toString(16),
    dh.sharedSecret(b, dh.publicOf(a)).toString(16),
  );
});

test('to256 is always 256 bytes, including when the value is short', () => {
  // The padding trap, from this side. A value whose top byte is zero renders as 255 bytes of hex
  // and would feed the derivation one byte short, once in every 256 handshakes.
  assert.equal(dh.to256(1n).length, 256);
  assert.equal(dh.to256(1n << 2039n).length, 256);
  assert.equal(dh.to256(dh.P - 2n).length, 256);
  assert.equal(dh.to256(1n << 2039n)[0], 0);
  assert.throws(() => dh.to256(1n << 2048n), /wider than the group/);
});
