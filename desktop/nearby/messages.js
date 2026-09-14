/*
 * The messages, as fixed binary.
 *
 * A port of `nearby/wire/Messages.kt`.
 *
 * Not JSON, and the reason is narrow rather than aesthetic: the first four of these feed a
 * transcript hash. JSON key order is not a contract, so two implementations that agreed on every
 * field and disagreed on their order would derive different keys and show two different six-digit
 * codes -- and the two people holding the devices would correctly conclude that something was
 * wrong, and incorrectly conclude what. Offsets cannot drift the way key order can.
 */

const protocol = require('./protocol');
const names = require('./names');
const { ByteWriter, ByteReader } = require('./bytes');
const { NearbyFailure, PROBLEM, problemFromCode, importCodeOf, importProblemOf } = require('./problems');
const { platformFromCode } = require('./beacon');

/** The `.ftree` document version this build writes and reads. Mirrors `TreeDocument.VERSION`. */
const TREE_FORMAT_VERSION = 1;

// HELLO and HELLO_ACK differ only in what bytes 4 and 5 mean, so they share one shape. -----------

function writeGreeting({
  first,
  second,
  role,
  platform,
  flags,
  deviceId,
  treeFormatMin,
  treeFormatMax,
  displayName,
}) {
  const chosen =
    names.truncateToBytes(displayName ?? '', protocol.BEACON_MAX_NAME_BYTES) ||
    names.friendlyName(deviceId);
  return new ByteWriter()
    .bytes(protocol.MAGIC)
    .u8(first)
    .u8(second)
    .u8(role)
    .u8(platform)
    .u16(flags)
    .bytes(deviceId)
    .u8(treeFormatMin)
    .u8(treeFormatMax)
    .lengthPrefixed(Buffer.from(chosen, 'utf8'), protocol.BEACON_MAX_NAME_BYTES)
    .toBuffer();
}

// Reads the shared greeting and stops, so each message decides what may follow it.
function readGreeting(reader) {
  const magic = reader.bytes(protocol.MAGIC.length);
  if (!magic.equals(protocol.MAGIC)) throw new NearbyFailure(PROBLEM.NOT_A_NEARBY_PEER);

  const first = reader.u8();
  const second = reader.u8();
  const role = reader.u8();
  const platform = platformFromCode(reader.u8());
  const flags = reader.u16();
  const deviceId = reader.bytes(16);
  const treeFormatMin = reader.u8();
  const treeFormatMax = reader.u8();
  const rawName = reader.lengthPrefixed().toString('utf8');

  return {
    first,
    second,
    role,
    platform,
    flags,
    deviceId,
    treeFormatMin,
    treeFormatMax,
    displayName: names.sanitise(rawName) ?? names.friendlyName(deviceId),
  };
}

/**
 * The opening frame. Names a version range, a role, what `.ftree` versions this device can write
 * and read, and who it says it is.
 *
 * `treeFormatMin` and `treeFormatMax` are the **document** version and not this protocol's. They
 * are carried here so that a sender whose file is too new for the receiver finds out in the first
 * exchange, rather than after pushing four megabytes of somebody's family across a room. Two
 * version numbers on two independent axes, which is the whole reason there are two.
 */
const Hello = {
  encode({
    maxVersion = protocol.VERSION,
    minVersion = protocol.MIN_VERSION,
    platform,
    flags,
    deviceId,
    treeFormatMin = TREE_FORMAT_VERSION,
    treeFormatMax = TREE_FORMAT_VERSION,
    displayName,
  }) {
    return writeGreeting({
      first: maxVersion,
      second: minVersion,
      role: protocol.ROLE_SENDER,
      platform,
      flags,
      deviceId,
      treeFormatMin,
      treeFormatMax,
      displayName,
    });
  },

  decode(payload) {
    const reader = new ByteReader(payload);
    const g = readGreeting(reader);
    reader.ignoreRest();
    if (g.role !== protocol.ROLE_SENDER) throw new NearbyFailure(PROBLEM.UNEXPECTED_MESSAGE);
    return {
      maxVersion: g.first,
      minVersion: g.second,
      role: g.role,
      platform: g.platform,
      flags: g.flags,
      deviceId: g.deviceId,
      treeFormatMin: g.treeFormatMin,
      treeFormatMax: g.treeFormatMax,
      displayName: g.displayName,
    };
  },
};

/**
 * The receiver's answer. It **states** the chosen version and the negotiated flags rather than
 * proposing them, and the sender then checks that what it was told is something it actually
 * offered -- see `negotiation.verifyChosen`. A receiver must not be able to name a version the
 * sender never put on the table.
 *
 * It also carries `keyCommitment`, the receiver's promise of the key and nonce it will send in
 * `KEY_ACK` -- see `handshake.keyCommitment`. It sits after the name, so the greeting both messages
 * share keeps one layout.
 */
const HelloAck = {
  encode({
    chosenVersion,
    platform,
    flags,
    deviceId,
    treeFormatMin = TREE_FORMAT_VERSION,
    treeFormatMax = TREE_FORMAT_VERSION,
    displayName,
    keyCommitment,
  }) {
    if (!keyCommitment || keyCommitment.length !== protocol.KEY_COMMITMENT_BYTES) {
      throw new Error(`key commitment must be ${protocol.KEY_COMMITMENT_BYTES} bytes`);
    }
    const greeting = writeGreeting({
      first: chosenVersion,
      second: 0,
      role: protocol.ROLE_RECEIVER,
      platform,
      flags,
      deviceId,
      treeFormatMin,
      treeFormatMax,
      displayName,
    });
    return Buffer.concat([greeting, keyCommitment]);
  },

  decode(payload) {
    const reader = new ByteReader(payload);
    const g = readGreeting(reader);
    // The role first: a HELLO sent back at a sender is the wrong message, not a short one.
    if (g.role !== protocol.ROLE_RECEIVER) throw new NearbyFailure(PROBLEM.UNEXPECTED_MESSAGE);
    const keyCommitment = reader.bytes(protocol.KEY_COMMITMENT_BYTES);
    reader.ignoreRest();
    return {
      chosenVersion: g.first,
      role: g.role,
      platform: g.platform,
      flags: g.flags,
      deviceId: g.deviceId,
      treeFormatMin: g.treeFormatMin,
      treeFormatMax: g.treeFormatMax,
      displayName: g.displayName,
      keyCommitment,
    };
  },
};

/** `KEY` and `KEY_ACK` are the same 288 bytes in both directions. */
const KeyMessage = {
  encode({ publicKey, nonce }) {
    if (publicKey.length !== protocol.DH_PUBLIC_BYTES) throw new Error('public key must be 256 bytes');
    if (nonce.length !== protocol.HANDSHAKE_NONCE_BYTES) throw new Error('nonce must be 32 bytes');
    return new ByteWriter().bytes(publicKey).bytes(nonce).toBuffer();
  },

  decode(payload) {
    const reader = new ByteReader(payload);
    return {
      publicKey: reader.bytes(protocol.DH_PUBLIC_BYTES),
      nonce: reader.bytes(protocol.HANDSHAKE_NONCE_BYTES),
    };
  },
};

/**
 * What is about to be sent, described before it is.
 *
 * The counts are shown in the prompt that asks whether to accept. They are what the *sender*
 * claims -- the real ones are whatever the importer finds after the file has arrived and been read
 * -- and the screen says so, because a number presented as fact and then contradicted is worse than
 * no number at all.
 */
const Offer = {
  encode({
    peopleCount,
    relationshipCount,
    photoCount,
    totalBytes,
    sha256,
    treeFormatVersion,
    suggestedFileName,
  }) {
    if (sha256.length !== 32) throw new Error('sha-256 is 32 bytes');
    const name = Buffer.from(
      names.truncateToBytes(suggestedFileName, protocol.OFFER_MAX_NAME_BYTES),
      'utf8',
    );
    return new ByteWriter()
      .u32(peopleCount)
      .u32(relationshipCount)
      .u32(photoCount)
      .u64(totalBytes)
      .bytes(sha256)
      .u8(treeFormatVersion)
      .lengthPrefixed(name, protocol.OFFER_MAX_NAME_BYTES)
      .toBuffer();
  },

  decode(payload) {
    const reader = new ByteReader(payload);
    const offer = {
      peopleCount: reader.u32(),
      relationshipCount: reader.u32(),
      photoCount: reader.u32(),
      totalBytes: reader.u64(),
      sha256: reader.bytes(32),
      treeFormatVersion: reader.u8(),
      suggestedFileName: reader.lengthPrefixed().toString('utf8'),
    };
    reader.ignoreRest();
    return offer;
  },
};

/** The last frame of a transfer, carrying what the sender believes it sent. */
const End = {
  encode({ bytesSent, sha256 }) {
    if (sha256.length !== 32) throw new Error('sha-256 is 32 bytes');
    return new ByteWriter().u64(bytesSent).bytes(sha256).toBuffer();
  },

  decode(payload) {
    const reader = new ByteReader(payload);
    return { bytesSent: reader.u64(), sha256: reader.bytes(32) };
  },
};

/**
 * Whether the file could be read, sent once the import has been *prepared* and before anybody has
 * reviewed it.
 *
 * Preparing needs no human, so the socket is held for a second at most, and the sender learns
 * something true and useful: that what it sent was readable. Its screen then says the tree is being
 * looked at, rather than implying the story ended when the last byte left.
 */
const Result = {
  encode({ accepted, importProblem = null }) {
    return new ByteWriter()
      .u8(accepted ? 0 : 1)
      .u8(importProblem ? importCodeOf(importProblem) : 0)
      .toBuffer();
  },

  decode(payload) {
    const reader = new ByteReader(payload);
    const accepted = reader.u8() === 0;
    const importProblem = importProblemOf(reader.u8());
    reader.ignoreRest();
    return { accepted, importProblem };
  },
};

/** A reason and nothing else. Free text would be a stranger's words in somebody's log. */
const Abort = {
  encode({ problem }) {
    return Buffer.from([problem & 0xff]);
  },

  decode(payload) {
    const buffer = Buffer.from(payload);
    if (buffer.length === 0) return { problem: PROBLEM.UNKNOWN };
    return { problem: problemFromCode(buffer[0]) };
  },
};

/** Which frame types carry one of the messages above, for a reader that has only the type byte. */
const HANDSHAKE_TYPES = new Set([
  protocol.TYPE_HELLO,
  protocol.TYPE_HELLO_ACK,
  protocol.TYPE_KEY,
  protocol.TYPE_KEY_ACK,
]);

module.exports = {
  TREE_FORMAT_VERSION,
  Hello,
  HelloAck,
  KeyMessage,
  Offer,
  End,
  Result,
  Abort,
  HANDSHAKE_TYPES,
};
