/*
 * What a device says about itself, twice a second, while somebody is looking at the nearby screen.
 *
 * A port of `nearby/wire/Beacon.kt`.
 *
 * **There is no address in here.** The address a peer is reached on is taken from the datagram's
 * source instead. That is not an omission: an address in the payload is an address a forged beacon
 * can use to point a sender at a third machine, and it is also the field that goes stale when a
 * device changes network and keeps announcing the interface it used to have. Reading it off the
 * packet makes both problems impossible rather than merely unlikely.
 */

const protocol = require('./protocol');
const names = require('./names');
const { ByteWriter, ByteReader } = require('./bytes');
const { NearbyFailure } = require('./problems');

/** Which kind of machine is speaking. Shown as an icon; never trusted for anything. */
const PLATFORM = {
  UNKNOWN: 0,
  ANDROID: 1,
  LINUX: 2,
  WINDOWS: 3,
  MACOS: 4,
};

const PLATFORM_CODES = new Set(Object.values(PLATFORM));

function platformFromCode(code) {
  return PLATFORM_CODES.has(code) ? code : PLATFORM.UNKNOWN;
}

/** What this build reports for itself. Cosmetic; the other side draws an icon from it. */
function thisPlatform() {
  switch (process.platform) {
    case 'win32':
      return PLATFORM.WINDOWS;
    case 'darwin':
      return PLATFORM.MACOS;
    case 'linux':
      return PLATFORM.LINUX;
    default:
      return PLATFORM.UNKNOWN;
  }
}

const ZERO_DEVICE_ID = Buffer.alloc(16);

function deviceIdHex(bytes) {
  return Buffer.from(bytes).toString('hex');
}

function parseDeviceId(hex) {
  if (typeof hex !== 'string' || !/^[0-9a-fA-F]{32}$/.test(hex)) return null;
  return Buffer.from(hex, 'hex');
}

/** True when this build can hold a conversation with whoever sent it. */
function speakable(beacon) {
  return beacon.minVersion <= protocol.VERSION && beacon.maxVersion >= protocol.MIN_VERSION;
}

function encodeBeacon(beacon) {
  const name = Buffer.from(
    names.truncateToBytes(beacon.displayName, protocol.BEACON_MAX_NAME_BYTES),
    'utf8',
  );
  const fingerprint = Buffer.alloc(protocol.KEY_FINGERPRINT_BYTES);
  Buffer.from(beacon.keyFingerprint).copy(fingerprint, 0, 0, protocol.KEY_FINGERPRINT_BYTES);

  return new ByteWriter()
    .bytes(protocol.MAGIC)
    .u8(beacon.maxVersion)
    .u8(beacon.minVersion)
    .u8(beacon.messageType)
    .u8(beacon.platform)
    .u16(beacon.flags)
    .u16(beacon.tcpPort)
    .bytes(beacon.deviceId)
    .bytes(fingerprint)
    .lengthPrefixed(name, protocol.BEACON_MAX_NAME_BYTES)
    .toBuffer();
}

/**
 * Reads a datagram, or returns `null`.
 *
 * Every rejection is silent and returns `null` rather than throwing. A datagram on a shared network
 * is as likely to be some other protocol that happens to use this port as it is to be a fault, and
 * discovery has no user-visible place to report one anyway. The only thing a malformed beacon
 * should cost is the microsecond spent looking at it.
 *
 * A datagram **longer** than the fields described is accepted and the excess ignored, which is what
 * lets a later version append a field without this one refusing to see the device at all.
 */
function decodeBeacon(datagram) {
  const buffer = Buffer.from(datagram);
  if (buffer.length < protocol.BEACON_HEADER_SIZE) return null;
  if (!buffer.subarray(0, protocol.MAGIC.length).equals(protocol.MAGIC)) return null;

  try {
    const reader = new ByteReader(buffer);
    reader.bytes(protocol.MAGIC.length);
    const maxVersion = reader.u8();
    const minVersion = reader.u8();
    const messageType = reader.u8();
    const platform = platformFromCode(reader.u8());
    const flags = reader.u16();
    const tcpPort = reader.u16();
    const deviceId = reader.bytes(16);
    const keyFingerprint = reader.bytes(protocol.KEY_FINGERPRINT_BYTES);
    const nameLength = reader.u8();
    if (nameLength > protocol.BEACON_MAX_NAME_BYTES) return null;
    const rawName = reader.bytes(nameLength).toString('utf8');

    // An announcement with no name is not a device anybody can pick out of a list. Only a QUERY,
    // which carries nothing about its sender, is allowed to be nameless.
    if (messageType !== protocol.BEACON_QUERY && nameLength === 0) return null;
    if (minVersion > maxVersion) return null;

    return {
      messageType,
      maxVersion,
      minVersion,
      platform,
      flags,
      tcpPort,
      deviceId,
      keyFingerprint,
      displayName:
        messageType === protocol.BEACON_QUERY
          ? ''
          : names.sanitise(rawName) ?? names.friendlyName(deviceId),
    };
  } catch (error) {
    // Truncated part-way through a field. Same answer as a wrong magic: it is noise.
    if (error instanceof NearbyFailure) return null;
    throw error;
  }
}

/** Says only that somebody is looking, and nothing whatever about who. */
function query() {
  return {
    messageType: protocol.BEACON_QUERY,
    maxVersion: protocol.VERSION,
    minVersion: protocol.MIN_VERSION,
    platform: PLATFORM.UNKNOWN,
    flags: 0,
    tcpPort: 0,
    deviceId: ZERO_DEVICE_ID,
    keyFingerprint: Buffer.alloc(protocol.KEY_FINGERPRINT_BYTES),
    displayName: '',
  };
}

function announce({ platform, flags, tcpPort, deviceId, keyFingerprint, displayName }) {
  return {
    messageType: protocol.BEACON_ANNOUNCE,
    maxVersion: protocol.VERSION,
    minVersion: protocol.MIN_VERSION,
    platform,
    flags,
    tcpPort,
    deviceId,
    keyFingerprint,
    displayName,
  };
}

function goodbye(beacon) {
  return { ...beacon, messageType: protocol.BEACON_GOODBYE };
}

module.exports = {
  PLATFORM,
  platformFromCode,
  thisPlatform,
  ZERO_DEVICE_ID,
  deviceIdHex,
  parseDeviceId,
  speakable,
  encodeBeacon,
  decodeBeacon,
  query,
  announce,
  goodbye,
};
