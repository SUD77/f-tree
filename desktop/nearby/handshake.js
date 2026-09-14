/*
 * The transcript, the key derivation, and the six digits both screens show.
 *
 * A port of `nearby/wire/Handshake.kt`. Every value here is pinned by `docs/nearby/vectors.txt`,
 * because this is the file where a one-byte disagreement between the two implementations stops
 * looking like a bug and starts looking like an attack: two devices showing two different codes is
 * exactly what a machine in the middle would produce, so nobody would suspect the software.
 */

const crypto = require('node:crypto');

const protocol = require('./protocol');
const dh = require('./dh');

/** Sixteen zero bytes when nothing was scanned, so the derivation has one shape and not two. */
const NO_TOKEN = Buffer.alloc(protocol.PAIRING_TOKEN_BYTES);

/**
 * A running hash of every handshake byte, in the order it crossed the wire.
 *
 * The transcript is the first four frames *verbatim*, length prefixes included, rather than a
 * structured summary of what they meant. That is the cheapest correctness decision in the
 * protocol: there is no field ordering for the two languages to agree on, no canonical form to get
 * subtly wrong, and no way for a value to be covered by one side's hash and not the other's.
 */
class TranscriptHash {
  constructor() {
    this.digest = crypto.createHash('sha256');
    this.digest.update(Buffer.from(protocol.LABEL_TRANSCRIPT, 'ascii'));
  }

  /** Feed the whole encoded frame -- header and all -- exactly as `encodeFrame` produced it. */
  add(encodedFrame) {
    this.digest.update(encodedFrame);
    return this;
  }

  value() {
    return this.digest.copy().digest();
  }
}

function hmac(key, message) {
  return crypto.createHmac('sha256', key).update(message).digest();
}

/**
 * RFC 5869 extract.
 *
 * The salt carries the transcript *and* the pairing token, which is what makes a scanned code a
 * real shared secret: the token itself never goes on the wire, so a device that did not see the
 * screen derives a different key and its first encrypted frame simply fails to open. A fingerprint
 * alone proves the receiver to the sender; only the token proves the sender saw the screen.
 */
function extract(transcript, token, sharedSecret) {
  if (token.length !== protocol.PAIRING_TOKEN_BYTES) {
    throw new Error(`token must be ${protocol.PAIRING_TOKEN_BYTES} bytes`);
  }
  const salt = crypto.createHash('sha256').update(transcript).update(token).digest();
  return hmac(salt, dh.to256(sharedSecret));
}

/**
 * RFC 5869 expand, for outputs of at most one block.
 *
 * Every output this protocol asks for is 32 bytes or fewer, so the counter never passes 1 and the
 * loop the RFC describes would run once. Written as the single block it is, with the ceiling
 * enforced rather than assumed.
 */
function expand(prk, label, length) {
  if (length < 1 || length > 32) throw new Error(`one block only: asked for ${length}`);
  const info = Buffer.concat([Buffer.from(label, 'ascii'), Buffer.from([1])]);
  return hmac(prk, info).subarray(0, length);
}

function deriveKeys(prk) {
  return {
    senderToReceiver: expand(prk, protocol.LABEL_SENDER_TO_RECEIVER, protocol.SESSION_KEY_BYTES),
    receiverToSender: expand(prk, protocol.LABEL_RECEIVER_TO_SENDER, protocol.SESSION_KEY_BYTES),
    sas: sasDigits(expand(prk, protocol.LABEL_SAS, protocol.SAS_RAW_BYTES)),
  };
}

/**
 * The six digits.
 *
 * `readBigUInt64BE`, not `readUInt32BE` twice and not a Number: eight bytes is more than a Number
 * can hold exactly, and reducing only four of them modulo a million carries a bias of about one in
 * half a million for no reason at all.
 *
 * The number depends on the transcript *and* the shared secret, so a machine in the middle -- which
 * is running two separate conversations with two different secrets -- cannot make the two screens
 * agree. That is the entire security argument for the feature, which is why the copy for a mismatch
 * has to alarm rather than reassure.
 */
function sasDigits(raw) {
  if (raw.length !== protocol.SAS_RAW_BYTES) {
    throw new Error(`sas needs ${protocol.SAS_RAW_BYTES} bytes`);
  }
  const reduced = Buffer.from(raw).readBigUInt64BE(0) % protocol.SAS_MODULUS;
  return reduced.toString().padStart(protocol.SAS_DIGITS, '0');
}

/**
 * What a receiver publishes in its beacon, so a sender can tie the device it tapped in a list to
 * the device it ends up talking to.
 */
function beaconFingerprint(deviceId, publicKey) {
  return crypto
    .createHash('sha256')
    .update(Buffer.from(protocol.LABEL_BEACON_KEY, 'ascii'))
    .update(deviceId)
    .update(dh.to256(publicKey))
    .digest()
    .subarray(0, protocol.KEY_FINGERPRINT_BYTES);
}

module.exports = {
  NO_TOKEN,
  TranscriptHash,
  extract,
  expand,
  deriveKeys,
  sasDigits,
  beaconFingerprint,
};
