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
