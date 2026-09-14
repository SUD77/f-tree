/*
 * Who this device says it is on a network, and the keypair it advertises a fingerprint of.
 *
 * A port of the Android side's `NearbyIdentity`.
 *
 * The `deviceId` here is **not** `identity.js`'s `sourceTreeId`, and that separation is the whole
 * reason this file exists rather than reusing the one next door. `sourceTreeId` is stamped into
 * every `.ftree` this device has ever exported. Broadcasting it twice a second would turn a
 * file-provenance identifier into a device tracker: anybody who had ever received a file from this
 * machine could then recognise it on every network it joined afterwards, forever, with no way to
 * reset it short of losing the tree's identity.
 *
 * Two ids, two purposes, and the nearby one can be regenerated without touching anything a person
 * has spent years filling in.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const dh = require('./dh');
const handshake = require('./handshake');
const names = require('./names');

const FILE = 'nearby-identity.json';

/** Sixteen random bytes. A v4 UUID's worth of entropy, stored as hex. */
function mint() {
  return crypto.randomBytes(16);
}

/**
 * Reads the device id from disk, creating one on first use.
 *
 * Kept in its own small file rather than in settings, so that "forget this device" can be a delete
 * rather than a careful edit of something else's JSON.
 */
function loadDeviceId(directory) {
  const file = path.join(directory, FILE);
  try {
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof stored.deviceId === 'string' && /^[0-9a-f]{32}$/.test(stored.deviceId)) {
      return Buffer.from(stored.deviceId, 'hex');
    }
  } catch {
    // Missing, unreadable, or not what it should be. All three mean the same thing: mint a new one.
  }
  const deviceId = mint();
  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ deviceId: deviceId.toString('hex') }, null, 2)}\n`);
  } catch {
    // A device id that cannot be persisted still works for this session. Being unable to remember
    // it is a much smaller problem than refusing to run.
  }
  return deviceId;
}

/**
 * The keypair a receiver advertises while it is visible.
 *
 * Held in memory, never written to disk, and regenerated whenever visibility goes off and on
 * again. It is reused across several transfers within one advertising session, which is a bounded
 * trade worth naming out loud: if this private key were extracted at the end of a session,
 * recordings made during that session could be read. The per-connection keys still differ, because
 * the sender's key is fresh for every connection and both ends contribute a fresh nonce.
 */
class BeaconKey {
  constructor(deviceId) {
    this.deviceId = deviceId;
    this.privateKey = dh.generatePrivate();
    this.publicKey = dh.publicOf(this.privateKey);
    this.fingerprint = handshake.beaconFingerprint(deviceId, this.publicKey);
  }
}

/**
 * Everything a nearby session needs to introduce itself.
 *
 * `displayName` is whatever the person chose, or a generated one. Never the hostname: consumer
 * machine names are overwhelmingly "priya-macbook", and a default that used one would broadcast a
 * real person's name to every stranger on a shared network, twice a second, without ever
 * mentioning that is what it did.
 */
class NearbyIdentity {
  constructor(directory, chosenName = null) {
    this.deviceId = loadDeviceId(directory);
    this.chosenName = chosenName;
    this.beaconKey = null;
  }

  get displayName() {
    return names.sanitise(this.chosenName ?? '') ?? names.friendlyName(this.deviceId);
  }

  /** Called when visibility is switched on. A fresh key each time is the point. */
  startAdvertising() {
    this.beaconKey = new BeaconKey(this.deviceId);
    return this.beaconKey;
  }

  stopAdvertising() {
    this.beaconKey = null;
  }
}

module.exports = { NearbyIdentity, BeaconKey, loadDeviceId, mint };
