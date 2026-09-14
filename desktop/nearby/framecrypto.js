/*
 * AES-256-GCM for one frame.
 *
 * A port of `nearby/wire/FrameCrypto.kt`. Deterministic given its arguments -- the nonce is
 * derived, never drawn -- so the whole module is a pure function and `docs/nearby/vectors.txt`
 * pins it byte for byte against the Kotlin.
 */

const crypto = require('node:crypto');

const protocol = require('./protocol');

/**
 * `direction(4) || sequence(8)`, and it is never transmitted.
 *
 * Counters rather than random nonces, which is the opposite of the usual advice and is right here.
 * A 96-bit random nonce carries a birthday risk, and worse, a poorly seeded generator can repeat
 * one outright -- and reusing a GCM nonce does not merely expose one message, it exposes the
 * authentication key and forges every frame after it. A counter cannot repeat before it wraps,
 * which at 2^64 frames of 64 KiB it will not, and the key cannot carry over from a previous
 * session because both ends contribute a fresh nonce to the salt.
 *
 * The sequence is a BigInt. A Number is exact only to 2^53, and `vectors.txt` carries that exact
 * sequence so this fails loudly rather than in one case out of several million.
 */
function nonceFor(direction, sequence) {
  const nonce = Buffer.alloc(protocol.NONCE_BYTES);
  nonce.writeUInt32BE(direction, 0);
  nonce.writeBigUInt64BE(BigInt.asUintN(64, BigInt(sequence)), 4);
  return nonce;
}

/**
 * `length(4) || type(1) || nonce(12)`.
 *
 * The type is bound so a frame cannot be replayed as a different one -- a DATA presented as an END
 * would truncate a transfer and still authenticate. The nonce is bound so the sequence is covered
 * even though it never goes on the wire.
 */
function associatedData(type, ciphertextLength, nonce) {
  const aad = Buffer.alloc(5 + protocol.NONCE_BYTES);
  aad.writeUInt32BE(1 + ciphertextLength, 0);
  aad.writeUInt8(type, 4);
  nonce.copy(aad, 5);
  return aad;
}

function seal(key, direction, sequence, type, plaintext) {
  if (plaintext.length > protocol.MAX_PLAINTEXT) {
    throw new Error(`plaintext too large: ${plaintext.length}`);
  }
  const nonce = nonceFor(direction, sequence);
  const aad = associatedData(type, plaintext.length + protocol.GCM_TAG_BYTES, nonce);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce, {
    authTagLength: protocol.GCM_TAG_BYTES,
  });
  cipher.setAAD(aad);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([body, cipher.getAuthTag()]);
}

/**
 * Throws on a tag that does not verify. Fatal, with no retry, because there is nothing a retry
 * could fix: either the key is wrong -- a stale code, or somebody in between -- or the bytes were
 * altered. `firstFrame` separates those for the person reading the screen, since a failure on the
 * very first encrypted frame means the pairing was wrong rather than that the connection went bad
 * halfway through.
 */
function open(key, direction, sequence, type, sealed, firstFrame = false) {
  if (sealed.length < protocol.GCM_TAG_BYTES) throw new Error('MALFORMED_FRAME');
  const nonce = nonceFor(direction, sequence);
  const body = sealed.subarray(0, sealed.length - protocol.GCM_TAG_BYTES);
  const tag = sealed.subarray(sealed.length - protocol.GCM_TAG_BYTES);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce, {
    authTagLength: protocol.GCM_TAG_BYTES,
  });
  decipher.setAAD(associatedData(type, sealed.length, nonce));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new Error(firstFrame ? 'BAD_PAIRING' : 'DECRYPT_FAILED');
  }
}

module.exports = { nonceFor, associatedData, seal, open };
