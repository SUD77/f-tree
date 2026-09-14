/*
 * Why a transfer stopped. Each is something the person at the screen can act on.
 *
 * A port of `nearby/wire/NearbyProblem.kt`.
 *
 * The numbers are written down rather than derived from position. A position is a wire format
 * nobody declared: reordering this list for readability would silently change what the other
 * device is told, and the two implementations would disagree about what "8" meant without either
 * of them changing a line that looks like protocol code.
 */

const PROBLEM = {
  /** Their f-tree speaks a version this one does not. */
  PROTOCOL_TOO_NEW: 0x01,
  PROTOCOL_TOO_OLD: 0x02,

  /** Something answered on that port, but it was not f-tree. */
  NOT_A_NEARBY_PEER: 0x03,

  MALFORMED_FRAME: 0x04,
  FRAME_TOO_LARGE: 0x05,

  /** The right shape at the wrong moment. Also what an unknown message type becomes. */
  UNEXPECTED_MESSAGE: 0x06,

  BAD_PUBLIC_KEY: 0x07,

  /** The device that answered is not the device that was discovered. */
  WRONG_DEVICE: 0x08,

  /** The first encrypted frame would not open: a stale code, or somebody in between. */
  BAD_PAIRING: 0x09,

  DECRYPT_FAILED: 0x0a,
  CODES_DID_NOT_MATCH: 0x0b,
  DECLINED: 0x0c,
  TIMED_OUT: 0x0d,
  CANCELLED: 0x0e,
  CONNECTION_LOST: 0x0f,
  TOO_LARGE: 0x10,
  NO_SPACE: 0x11,
  TRANSFER_INCOMPLETE: 0x12,

  /** What arrived is not what was sent. */
  CONTENT_MISMATCH: 0x13,

  /** This device writes a `.ftree` the other one is too old to read. */
  TREE_FORMAT_TOO_NEW: 0x14,

  /** The file arrived whole and the importer still refused it; carries an import problem. */
  IMPORT_REFUSED: 0x15,

  /** A socket would not bind, multicast was unavailable, or the network went away. */
  NETWORK: 0x16,

  PERMISSION: 0x17,
  BUSY: 0x18,

  /**
   * The key the receiver sent is not the one it promised in `HELLO_ACK`. An honest receiver cannot
   * produce this; it is what a machine in the middle looks like when it tries to choose its nonce
   * after seeing the sender's. Shown with the same alarm as `CODES_DID_NOT_MATCH`.
   */
  KEY_NOT_AS_PROMISED: 0x19,

  /**
   * A code this build does not recognise.
   *
   * Never shown as a number. A device running a later release may abort for a reason that did not
   * exist when this one was written, and "the other device stopped" is both true and useful, where
   * "error 27" is neither.
   */
  UNKNOWN: 0xff,
};

const NAME_BY_CODE = new Map(Object.entries(PROBLEM).map(([name, code]) => [code, name]));

/** Anything unrecognised becomes UNKNOWN rather than throwing. A stranger picks this byte. */
function problemFromCode(code) {
  return NAME_BY_CODE.has(code) ? code : PROBLEM.UNKNOWN;
}

function problemName(code) {
  return NAME_BY_CODE.get(code) ?? 'UNKNOWN';
}

/**
 * The wire numbers for the importer's own refusals, so a receiver can tell a sender why its file
 * was refused and the sender can show the sentence the app already has for it.
 *
 * These mirror `ImportProblemCodes` in the Kotlin. They are written here rather than in `read.js`
 * for the same reason they are not on `ImportProblem`: the `.ftree` format does not depend on
 * there being a network, and putting a wire code on it would be the first place that stopped
 * being true.
 */
const IMPORT_PROBLEM_BY_CODE = {
  0x01: 'notAnArchive',
  0x02: 'notATreeFile',
  0x03: 'fromANewerVersion',
  0x04: 'empty',
  0x05: 'unreadable',
};

const IMPORT_CODE_BY_PROBLEM = Object.fromEntries(
  Object.entries(IMPORT_PROBLEM_BY_CODE).map(([code, name]) => [name, Number(code)]),
);

function importCodeOf(problem) {
  return IMPORT_CODE_BY_PROBLEM[problem] ?? 0x05;
}

/** `0` means the import was not refused. Anything unrecognised reads as unreadable. */
function importProblemOf(code) {
  if (code === 0) return null;
  return IMPORT_PROBLEM_BY_CODE[code] ?? 'unreadable';
}

/** A transfer that ended for a reason worth showing. */
class NearbyFailure extends Error {
  constructor(problem, importProblem = null) {
    super(`Nearby failed: ${problemName(problem)}${importProblem ? ` (${importProblem})` : ''}`);
    this.name = 'NearbyFailure';
    this.problem = problem;
    this.importProblem = importProblem;
  }
}

module.exports = {
  PROBLEM,
  problemFromCode,
  problemName,
  importCodeOf,
  importProblemOf,
  NearbyFailure,
};
