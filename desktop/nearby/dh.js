/*
 * Diffie-Hellman over RFC 3526 group 14.
 *
 * A port of `nearby/wire/Dh.kt`. Classic finite-field DH rather than X25519, which would be the
 * obvious modern choice, because the phone supports API 26 and the platform only offers X25519
 * from 33 -- and the two sides have to agree. Modular exponentiation is the one primitive both
 * languages are guaranteed to implement identically.
 *
 * `node:crypto` has a Diffie-Hellman of its own, and this file deliberately does not use it for
 * the arithmetic. `crypto.createDiffieHellman` will not let a caller choose the exponent length
 * without also generating the key, which makes it useless for the fixed-exponent test vectors that
 * are the whole point of `docs/nearby/vectors.txt` -- and a fixed vector that cannot be reproduced
 * is a vector nobody can debug against. BigInt modPow is thirty lines and is exact.
 */

const crypto = require('node:crypto');

const protocol = require('./protocol');

const P = BigInt('0x' + protocol.DH_PRIME_HEX);
const G = BigInt(protocol.DH_GENERATOR);
const P_MINUS_ONE = P - 1n;
const P_MINUS_TWO = P - 2n;

/**
 * Square and multiply.
 *
 * Not constant time, and it does not need to be: the exponent here is a per-connection ephemeral
 * private key that is discarded when the socket closes, and there is no remote timing signal to
 * read it from -- the peer sees one public value and nothing about how long it took to compute.
 */
function modPow(base, exponent, modulus) {
  let result = 1n;
  let b = base % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus;
    b = (b * b) % modulus;
    e >>= 1n;
  }
  return result;
}

/**
 * A private exponent, 256 bits rather than the group's 2048.
 *
 * The group is worth about 110 bits against the best known attack, so a longer exponent protects
 * nothing and costs about eight times the work.
 */
function generatePrivate() {
  for (;;) {
    const candidate = fromBytes(crypto.randomBytes(protocol.DH_PRIVATE_BITS / 8));
    if (candidate >= 2n) return candidate;
  }
}

function publicOf(privateKey) {
  return modPow(G, privateKey, P);
}

/**
 * Refuses a peer's public value before it is used for anything.
 *
 * `p` is a safe prime, so its only small subgroups are {1} and {1, p-1}. Requiring 2 <= Y <= p-2
 * excludes both. Without it, a peer sending 1 forces a shared secret of 1, and every later frame
 * is encrypted under a key the attacker chose.
 */
function isValidPublic(y) {
  return y >= 2n && y <= P_MINUS_TWO;
}

function sharedSecret(privateKey, peerPublic) {
  if (!isValidPublic(peerPublic)) throw new Error('BAD_PUBLIC_KEY');
  const z = modPow(peerPublic, privateKey, P);
  if (z <= 1n || z === P_MINUS_ONE) throw new Error('BAD_PUBLIC_KEY');
  return z;
}

/**
 * Exactly 256 bytes, big-endian, left-padded with zeros.
 *
 * The likeliest interoperability bug in the whole protocol, and it is invisible until it is not.
 * A BigInt rendered as hex drops its leading zeros, so a value whose top byte happens to be 0x00 --
 * which is one shared secret in every 256 -- is 255 bytes rather than 256. The Kotlin has the
 * mirror-image problem: `BigInteger.toByteArray()` *prepends* a sign byte when bit 2047 is set.
 *
 * Feed either into the key derivation unpadded and the two devices agree on a shared secret and
 * then derive different keys from it. It works two hundred and fifty-five times and then quietly
 * does not, which is why both languages call one helper and both test it against the same vectors.
 */
function to256(value) {
  let hex = value.toString(16);
  if (hex.length > protocol.DH_PUBLIC_BYTES * 2) {
    throw new Error(`value wider than the group: ${hex.length / 2} bytes`);
  }
  return Buffer.from(hex.padStart(protocol.DH_PUBLIC_BYTES * 2, '0'), 'hex');
}

/** The inverse of `to256`. Always positive: these are group elements, never signed numbers. */
function fromBytes(bytes) {
  const hex = Buffer.from(bytes).toString('hex');
  return hex.length === 0 ? 0n : BigInt('0x' + hex);
}

module.exports = {
  P,
  G,
  modPow,
  generatePrivate,
  publicOf,
  isValidPublic,
  sharedSecret,
  to256,
  fromBytes,
};
