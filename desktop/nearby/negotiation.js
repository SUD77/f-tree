/*
 * Deciding what two builds have in common.
 *
 * A port of `nearby/wire/Negotiation.kt`. Pure, and small enough to read in one go, which is the
 * point: this is where a downgrade would be arranged if one could be, so it should be possible to
 * convince yourself by reading rather than by testing.
 *
 * It cannot be, and the reason is not in this file. Both greetings are covered by the transcript
 * hash, so changing a flag or a version in flight changes one side's transcript, which changes the
 * salt, the keys and the six digits -- and the first encrypted frame fails to open. The checks here
 * make a *mistake* legible; the transcript is what makes an *attack* impossible.
 */

const protocol = require('./protocol');
const { NearbyFailure, PROBLEM } = require('./problems');

/**
 * Throws `NearbyFailure` when there is no version both can speak. The two codes are from the point
 * of view of the device that raises them, so each end can say something true about which of the two
 * needs updating.
 */
function chooseVersion(
  senderMax,
  senderMin,
  receiverMax = protocol.VERSION,
  receiverMin = protocol.MIN_VERSION,
) {
  const chosen = Math.min(senderMax, receiverMax);
  const floor = Math.max(senderMin, receiverMin);
  if (chosen < floor) {
    throw new NearbyFailure(
      senderMin > receiverMax ? PROBLEM.PROTOCOL_TOO_NEW : PROBLEM.PROTOCOL_TOO_OLD,
    );
  }
  return chosen;
}

/** Only what both sides claimed, and only bits this build actually knows about. */
function negotiateFlags(senderFlags, receiverFlags) {
  return senderFlags & receiverFlags & protocol.SUPPORTED_FLAGS;
}

/**
 * The sender's check on what it was told.
 *
 * The receiver states the outcome, and a receiver that could state anything it liked could name a
 * version the sender never offered, or claim a capability the sender never advertised. Both would
 * be a mistake rather than an attack -- the transcript already prevents the attack -- but a mistake
 * that silently produces a working-looking connection is the kind that ships.
 */
function verifyChosen(chosen, statedFlags, senderMax, senderMin, senderFlags, receiverBeaconFlags) {
  if (chosen > senderMax || chosen < senderMin) {
    throw new NearbyFailure(PROBLEM.UNEXPECTED_MESSAGE);
  }
  if (statedFlags !== negotiateFlags(senderFlags, receiverBeaconFlags)) {
    throw new NearbyFailure(PROBLEM.UNEXPECTED_MESSAGE);
  }
}

/**
 * Whether this device can write a `.ftree` the other one can read.
 *
 * Checked in the first exchange rather than after the upload. The importer already refuses a file
 * from a newer version out loud; this is the same refusal made by the sender, before anybody has
 * waited for four megabytes of photographs to cross a room for nothing.
 */
function verifyTreeFormat(ourVersion, theirMax) {
  if (ourVersion > theirMax) throw new NearbyFailure(PROBLEM.TREE_FORMAT_TOO_NEW);
}

module.exports = { chooseVersion, negotiateFlags, verifyChosen, verifyTreeFormat };
