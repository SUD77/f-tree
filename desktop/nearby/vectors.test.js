/*
 * This implementation against the one in the phone app.
 *
 * `docs/nearby/vectors.txt` is generated from the Kotlin. This file reads it and checks that the
 * JavaScript produces the same bytes. It is the only thing standing between two implementations of
 * one handshake and a silent divergence, and it is worth being precise about what that divergence
 * would look like:
 *
 *   two devices show two different six-digit codes, the people holding them compare the screens,
 *   see a mismatch, and correctly conclude something is wrong -- then incorrectly conclude what.
 *   A mismatch is defined, in the interface and in the documentation, as evidence of somebody in
 *   the middle. Nobody would suspect the software, because the software is behaving exactly as it
 *   would if it were right and the network were hostile.
 *
 * That is why the agreement is a file rather than an intention, and why this test exists before
 * either side has a socket.
 *
 * When this fails, one of the two implementations has moved. Regenerating the golden makes the
 * failure go away and is almost always the wrong answer -- the diff on that file is the deliverable
 * of a PR that changes the protocol, and it should be read.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const protocol = require('./protocol');
const dh = require('./dh');
const handshake = require('./handshake');
const framecrypto = require('./framecrypto');
const { encodeFrame } = require('./frame');
const beacon = require('./beacon');
const messages = require('./messages');
const names = require('./names');
const qrlink = require('./qrlink');
const { PROBLEM, importCodeOf } = require('./problems');

const VECTORS = path.join(__dirname, '..', '..', 'docs', 'nearby', 'vectors.txt');

/** `group | input | output`, with `#` comments and blank lines. */
function load() {
  const text = fs.readFileSync(VECTORS, 'utf8');
  const rows = new Map();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(' | ');
    assert.equal(parts.length, 3, `malformed vector line: ${trimmed}`);
    rows.set(`${parts[0]} | ${parts[1]}`, parts[2]);
  }
  return rows;
}

const vectors = load();

/** Looks a case up, failing loudly rather than silently passing on a typo in a key. */
function expected(group, input) {
  const key = `${group} | ${input}`;
  const value = vectors.get(key);
  assert.ok(value !== undefined, `no vector named "${key}" -- has the golden been regenerated?`);
  return value;
}

const hex = (buffer) => Buffer.from(buffer).toString('hex');

test('the golden file was found and is not empty', () => {
  assert.ok(vectors.size > 50, `only ${vectors.size} vectors loaded from ${VECTORS}`);
});

test('to256 pads the way the Kotlin pads', () => {
  // The four shapes where the two languages' big-number libraries disagree about width.
  assert.equal(hex(dh.to256(2n)), expected('to256', 'two'));
  assert.equal(hex(dh.to256(1n << 2039n)), expected('to256', 'leading-zero-byte'));
  assert.equal(hex(dh.to256(1n << 2047n)), expected('to256', 'top-bit-set'));
  assert.equal(hex(dh.to256(dh.P - 2n)), expected('to256', 'full-width'));
});

test('modular exponentiation agrees', () => {
  for (const x of [2n, 3n, 0xc0ffeen]) {
    assert.equal(hex(dh.to256(dh.publicOf(x))), expected('dh.public', `x=${x}`));
  }
});

test('a shared secret agrees', () => {
  const shared = dh.sharedSecret(0xa11cen, dh.publicOf(0xb0bn));
  assert.equal(hex(dh.to256(shared)), expected('dh.shared', 'a=0xa11ce b=0xb0b'));
});

test('HKDF agrees on every label this protocol uses', () => {
  const prk = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1));
  for (const [label, length] of [
    [protocol.LABEL_SENDER_TO_RECEIVER, 32],
    [protocol.LABEL_RECEIVER_TO_SENDER, 32],
    [protocol.LABEL_SAS, 8],
  ]) {
    assert.equal(
      hex(handshake.expand(prk, label, length)),
      expected('hkdf', `prk=01..20 label=${label} len=${length}`),
      label,
    );
  }
});

test('a whole handshake agrees, down to the six digits', () => {
  // The vector. If both languages produce these values they interoperate; if they produce
  // anything else they do not, whatever the rest of either suite says.
  for (const paired of [false, true]) {
    const which = paired ? 'with-token' : 'no-token';

    const transcript = new handshake.TranscriptHash()
      .add(encodeFrame(protocol.TYPE_HELLO, Buffer.alloc(29, 1)))
      .add(encodeFrame(protocol.TYPE_HELLO_ACK, Buffer.alloc(29, 2)))
      .add(encodeFrame(protocol.TYPE_KEY, Buffer.alloc(288, 3)))
      .add(encodeFrame(protocol.TYPE_KEY_ACK, Buffer.alloc(288, 4)))
      .value();
    assert.equal(hex(transcript), expected('handshake.transcript', which), `transcript ${which}`);

    const token = paired
      ? Buffer.from(Array.from({ length: 16 }, (_, i) => i + 0x40))
      : handshake.NO_TOKEN;
    const shared = dh.sharedSecret(0xa11cen, dh.publicOf(0xb0bn));
    const prk = handshake.extract(transcript, token, shared);
    assert.equal(hex(prk), expected('handshake.prk', which), `prk ${which}`);

    const keys = handshake.deriveKeys(prk);
    assert.equal(hex(keys.senderToReceiver), expected('handshake.s2r', which), `s2r ${which}`);
    assert.equal(hex(keys.receiverToSender), expected('handshake.r2s', which), `r2s ${which}`);
    assert.equal(keys.sas, expected('handshake.sas', which), `sas ${which}`);
  }
});

test('the transcript is the same with and without a token, but the keys are not', () => {
  // The token goes into the salt, never into the transcript and never onto the wire. If this ever
  // inverts, a device that did not see the screen would derive the right keys.
  assert.equal(
    expected('handshake.transcript', 'no-token'),
    expected('handshake.transcript', 'with-token'),
  );
  assert.notEqual(expected('handshake.sas', 'no-token'), expected('handshake.sas', 'with-token'));
});

test('the six digits agree, including the cases that are negative in Kotlin', () => {
  // `all-ones` and `high-bit` are the two that would come back negative if either side reduced a
  // signed 64-bit value. Kotlin has no unsigned Long and Java's % keeps the sign; JavaScript has
  // no 64-bit integer at all without BigInt. Two different traps, one pair of vectors.
  const cases = {
    zero: Buffer.alloc(8),
    seven: Buffer.concat([Buffer.alloc(7), Buffer.from([7])]),
    'all-ones': Buffer.alloc(8, 0xff),
    'high-bit': Buffer.concat([Buffer.from([0x80]), Buffer.alloc(7)]),
  };
  for (const [label, raw] of Object.entries(cases)) {
    assert.equal(handshake.sasDigits(raw), expected('sas', label), label);
  }
});

test('nonces agree, including past the point a Number stops being exact', () => {
  const sequences = [
    [0n, '0'],
    [1n, '1'],
    [0xffffffffn, '4294967295'],
    [1n << 32n, '4294967296'],
    [1n << 53n, '9007199254740992'],
    [(1n << 64n) - 1n, '18446744073709551615'],
  ];
  for (const direction of [
    protocol.DIRECTION_SENDER_TO_RECEIVER,
    protocol.DIRECTION_RECEIVER_TO_SENDER,
  ]) {
    for (const [sequence, shown] of sequences) {
      assert.equal(
        hex(framecrypto.nonceFor(direction, sequence)),
        expected('nonce', `dir=${direction} seq=${shown}`),
        `dir=${direction} seq=${shown}`,
      );
    }
  }
});

test('AES-GCM produces the same ciphertext and tag', () => {
  const key = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1));
  const cases = {
    empty: Buffer.alloc(0),
    short: Buffer.from('a family'),
    block: Buffer.from(Array.from({ length: 64 }, (_, i) => (i * 3) & 0xff)),
  };
  for (const [label, plaintext] of Object.entries(cases)) {
    const sealed = framecrypto.seal(key, 1, 0n, protocol.TYPE_DATA, plaintext);
    assert.equal(
      hex(sealed),
      expected('gcm', `key=01..20 dir=1 seq=0 type=0x20 pt=${label}`),
      label,
    );
    // And it opens again, which the golden cannot check on its own.
    assert.deepEqual(
      framecrypto.open(key, 1, 0n, protocol.TYPE_DATA, sealed),
      plaintext,
    );
  }
});

test('the beacon fingerprint agrees', () => {
  const deviceId = Buffer.from(Array.from({ length: 16 }, (_, i) => i + 1));
  for (const x of [2n, 0xb0bn]) {
    assert.equal(
      hex(handshake.beaconFingerprint(deviceId, dh.publicOf(x))),
      expected('fingerprint', `id=01..10 x=${x}`),
      `x=${x}`,
    );
  }
});

test('the key commitment agrees', () => {
  // If the two sides hashed the receiver's promise differently, every honest conversation between
  // them would end in KEY_NOT_AS_PROMISED -- which reads, correctly, as an attack.
  const nonce = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 0x20));
  for (const x of [2n, 0xb0bn]) {
    assert.equal(
      hex(handshake.keyCommitment(dh.publicOf(x), nonce)),
      expected('commitment', `x=${x} nonce=20..3f`),
      `x=${x}`,
    );
  }
});

test('the beacon is the same bytes on both sides', () => {
  const deviceId = Buffer.from(Array.from({ length: 16 }, (_, i) => i + 1));
  const keyFingerprint = Buffer.from(Array.from({ length: 8 }, (_, i) => (i * 3) & 0xff));
  const cases = {
    ascii: 'Quiet Heron',
    // Devanagari, because a name is UTF-8 and the length prefix counts bytes rather than
    // characters -- a side that wrote characters would produce a shorter prefix and the reader
    // would find the name running into the next field.
    devanagari: 'अंकित',
    // Eighty 'n', against a 64-byte ceiling, so the truncation rule is pinned too.
    longest: 'n'.repeat(80),
  };
  for (const [label, displayName] of Object.entries(cases)) {
    const announced = beacon.announce({
      platform: beacon.PLATFORM.ANDROID,
      flags: protocol.FLAG_ACCEPTS_TREE,
      tcpPort: 49813,
      deviceId,
      keyFingerprint,
      displayName,
    });
    assert.equal(hex(beacon.encodeBeacon(announced)), expected('beacon', `name=${label}`), label);
  }
  assert.equal(hex(beacon.encodeBeacon(beacon.query())), expected('beacon', 'query'));
});

test('the handshake messages are the same bytes on both sides', () => {
  // These four are hashed verbatim into the transcript, so their layout is as load-bearing as the
  // crypto: one field written in a different order gives two devices two different six-digit codes
  // and no way to tell that from an attack.
  const deviceId = Buffer.from(Array.from({ length: 16 }, (_, i) => i + 1));

  assert.equal(
    hex(messages.Hello.encode({
      platform: beacon.PLATFORM.ANDROID,
      flags: protocol.FLAG_ACCEPTS_TREE,
      deviceId,
      displayName: 'Quiet Heron',
    })),
    expected('messages.hello', 'android flags=1 name=ascii'),
  );

  // An empty name is replaced by the generated one rather than sent empty. Both sides have to pick
  // the same creature from the same tables, or the two screens disagree about who is who.
  assert.equal(
    hex(messages.Hello.encode({
      platform: beacon.PLATFORM.WINDOWS,
      flags: protocol.FLAG_ACCEPTS_TREE,
      deviceId,
      displayName: '',
    })),
    expected('messages.hello', 'empty-name'),
  );

  assert.equal(
    hex(messages.HelloAck.encode({
      chosenVersion: 1,
      platform: beacon.PLATFORM.LINUX,
      flags: protocol.FLAG_ACCEPTS_TREE,
      deviceId,
      displayName: 'Amber Otter',
      keyCommitment: Buffer.alloc(protocol.KEY_COMMITMENT_BYTES, 5),
    })),
    expected('messages.hello-ack', 'v=1 flags=1'),
  );

  assert.equal(
    hex(messages.KeyMessage.encode({
      publicKey: Buffer.alloc(protocol.DH_PUBLIC_BYTES, 3),
      nonce: Buffer.alloc(protocol.HANDSHAKE_NONCE_BYTES, 4),
    })),
    expected('messages.key', 'pub=03.. nonce=04..'),
  );
});

test('the transfer messages are the same bytes on both sides', () => {
  assert.equal(
    hex(messages.Offer.encode({
      peopleCount: 12,
      relationshipCount: 7,
      photoCount: 3,
      // 2^53, where a Number stops being exact. Written as a BigInt on both sides.
      totalBytes: 1n << 53n,
      sha256: Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1)),
      treeFormatVersion: 1,
      suggestedFileName: 'family.ftree',
    })),
    expected('messages.offer', 'people=12 rel=7 photos=3 bytes=2^53'),
  );

  assert.equal(
    hex(messages.End.encode({
      bytesSent: 1n << 32n,
      sha256: Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 5) & 0xff)),
    })),
    expected('messages.end', 'bytes=4294967296'),
  );

  assert.equal(hex(messages.Result.encode({ accepted: true })), expected('messages.result', 'accepted'));
  assert.equal(
    hex(messages.Result.encode({ accepted: false, importProblem: 'notAnArchive' })),
    expected('messages.result', 'refused-not-an-archive'),
  );
  assert.equal(
    hex(messages.Abort.encode({ problem: PROBLEM.DECLINED })),
    expected('messages.abort', 'declined'),
  );
});

test('a message survives a round trip through this side', () => {
  // The golden pins the encoder. Nothing pins the decoder, so it is checked against the encoder
  // here -- a decode that read a field at the wrong offset would still match a golden written by
  // the same broken encoder, but it cannot also survive this.
  const deviceId = Buffer.from(Array.from({ length: 16 }, (_, i) => i + 1));
  const hello = messages.Hello.decode(
    messages.Hello.encode({
      platform: beacon.PLATFORM.ANDROID,
      flags: protocol.FLAG_ACCEPTS_TREE,
      deviceId,
      displayName: 'Quiet Heron',
    }),
  );
  assert.equal(hello.displayName, 'Quiet Heron');
  assert.equal(hello.platform, beacon.PLATFORM.ANDROID);
  assert.deepEqual(hello.deviceId, deviceId);

  const offer = messages.Offer.decode(
    messages.Offer.encode({
      peopleCount: 12,
      relationshipCount: 7,
      photoCount: 3,
      totalBytes: 1n << 53n,
      sha256: Buffer.alloc(32, 9),
      treeFormatVersion: 1,
      suggestedFileName: 'family.ftree',
    }),
  );
  assert.equal(offer.totalBytes, 1n << 53n);
  assert.equal(offer.suggestedFileName, 'family.ftree');
});

test('the generated device names agree', () => {
  // Each side renders the *other* device's default name from the other device's id, so the word
  // tables and the indexing are a wire format even though no name crosses the network.
  for (const [a, b] of [[0x00, 0x00], [0x01, 0x02], [0xff, 0x80], [0x7f, 0x10]]) {
    const id = Buffer.alloc(16);
    id[0] = a;
    id[1] = b;
    const label = `id=${a.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    assert.equal(names.friendlyName(id), expected('names', label), label);
  }
});

test('the problem codes agree', () => {
  // Written down rather than taken from a position in a list, so reordering either enum for
  // readability cannot silently change what the other device is told.
  for (const [name, code] of Object.entries(PROBLEM)) {
    assert.equal(`0x${code.toString(16).padStart(2, '0')}`, expected('problems', name), name);
  }
  // And the other way: a reason the Kotlin can send that this side has never heard of would be
  // shown as "the other device stopped" when it has a sentence of its own.
  for (const key of vectors.keys()) {
    if (!key.startsWith('problems | ')) continue;
    const name = key.slice('problems | '.length);
    assert.ok(name in PROBLEM, `the Kotlin knows ${name} and this side does not`);
  }
  const importProblems = {
    NOT_AN_ARCHIVE: 'notAnArchive',
    NOT_A_TREE_FILE: 'notATreeFile',
    FROM_A_NEWER_VERSION: 'fromANewerVersion',
    EMPTY: 'empty',
    UNREADABLE: 'unreadable',
  };
  for (const [kotlinName, jsName] of Object.entries(importProblems)) {
    assert.equal(
      `0x${importCodeOf(jsName).toString(16).padStart(2, '0')}`,
      expected('import-problems', kotlinName),
      kotlinName,
    );
  }
});

test('the QR link is the same string on both sides', () => {
  assert.equal(
    qrlink.encodeQrLink({
      address: '192.168.1.42',
      port: 49813,
      deviceId: Buffer.from(Array.from({ length: 16 }, (_, i) => (i * 7) & 0xff)),
      keyFingerprint: Buffer.from(Array.from({ length: 8 }, (_, i) => i + 1)),
      token: Buffer.from(Array.from({ length: 16 }, (_, i) => (i * 11) & 0xff)),
      displayName: 'Quiet Heron',
    }),
    expected('qrlink', 'encode'),
  );
});

test('the two sides refuse the same addresses', () => {
  // A scanned address outside these ranges is either a mistake or an attempt to make a device post
  // somebody's family to a machine on the internet. "10.0.0.010" is the interesting one: some
  // parsers read a leading zero as octal, so a dotted quad with one is refused rather than guessed.
  for (const address of [
    '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.1.1',
    '8.8.8.8', '172.32.0.1', '10.0.0.010',
  ]) {
    assert.equal(
      String(qrlink.isPrivateAddress(address)),
      expected('qrlink.private', address),
      address,
    );
  }
});

test('framing agrees', () => {
  const cases = {
    empty: Buffer.alloc(0),
    one: Buffer.from([0x41]),
    sixteen: Buffer.from(Array.from({ length: 16 }, (_, i) => i)),
  };
  for (const [label, payload] of Object.entries(cases)) {
    assert.equal(
      hex(encodeFrame(protocol.TYPE_OFFER, payload)),
      expected('frame', `type=0x10 payload=${label}`),
      label,
    );
  }
});
