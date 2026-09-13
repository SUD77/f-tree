/*
 * Everything a device needs to reach another one, small enough to be a square on a screen.
 *
 * A port of `nearby/wire/QrLink.kt`.
 *
 * The `token` is the interesting field. It is sixteen random bytes that are **never transmitted**:
 * both ends mix it into the key derivation, so a device that did not see the screen derives a
 * different key and its first encrypted frame simply fails to open. That is what turns the code
 * from a convenience into a shared secret, and it is why scanning one is allowed to skip the
 * six-digit comparison while typing an address is not -- a fingerprint proves the receiver to the
 * sender, but only the token proves the sender was standing in front of the receiver's screen.
 */

const protocol = require('./protocol');
const names = require('./names');
const { deviceIdHex, parseDeviceId } = require('./beacon');

const PREFIX = `${protocol.QR_SCHEME}://${protocol.QR_HOST}${protocol.QR_PATH}?`;

function base64Url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

function decodeBase64Url(value) {
  try {
    const out = Buffer.from(value, 'base64url');
    // Buffer.from is famously forgiving: it ignores anything it cannot decode rather than
    // objecting. Re-encoding and comparing is the only way to tell a valid string from a
    // near-miss, and a near-miss here is a fingerprint that would match nothing.
    return out.toString('base64url') === value ? out : null;
  } catch {
    return null;
  }
}

function encodeQrLink({
  address,
  port,
  deviceId,
  keyFingerprint,
  token = null,
  displayName = null,
  maxVersion = protocol.VERSION,
}) {
  let out = `${PREFIX}a=${address}&p=${port}&d=${deviceIdHex(deviceId)}&f=${base64Url(keyFingerprint)}`;
  if (token) out += `&t=${base64Url(token)}`;
  if (displayName) out += `&n=${encodeURIComponent(displayName)}`;
  return `${out}&v=${maxVersion}`;
}

/**
 * A custom scheme rather than an `https:` link, on purpose.
 *
 * An https URL carrying a LAN address is a URL a browser will cheerfully fetch, and a QR code is a
 * thing people point cameras at without reading. `ftree://` goes nowhere if it is scanned by
 * anything but this app.
 */
function parseQrLink(text) {
  const trimmed = String(text).trim();
  if (!trimmed.startsWith(PREFIX)) return null;

  const fields = new Map();
  for (const pair of trimmed.slice(PREFIX.length).split('&')) {
    if (pair === '') continue;
    const equals = pair.indexOf('=');
    if (equals <= 0) continue;
    // Unknown keys are ignored rather than refused, so a later version can add one.
    fields.set(pair.slice(0, equals), pair.slice(equals + 1));
  }

  const address = fields.get('a');
  if (address === undefined || !isPrivateAddress(address)) return null;

  const port = Number(fields.get('p'));
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;

  const deviceId = parseDeviceId(fields.get('d'));
  if (deviceId === null) return null;

  const keyFingerprint = fields.has('f') ? decodeBase64Url(fields.get('f')) : null;
  if (keyFingerprint === null || keyFingerprint.length !== protocol.KEY_FINGERPRINT_BYTES) {
    return null;
  }

  let token = null;
  if (fields.has('t')) {
    token = decodeBase64Url(fields.get('t'));
    if (token === null || token.length !== protocol.PAIRING_TOKEN_BYTES) return null;
  }

  let displayName = null;
  if (fields.has('n')) {
    try {
      displayName = names.sanitise(decodeURIComponent(fields.get('n')));
    } catch {
      displayName = null;
    }
  }

  const maxVersion = fields.has('v') ? Number(fields.get('v')) : 1;
  if (!Number.isInteger(maxVersion) || maxVersion < 1) return null;

  return { address, port, deviceId, keyFingerprint, token, displayName, maxVersion };
}

/**
 * `10/8`, `172.16/12`, `192.168/16` and `169.254/16`, and nothing else.
 *
 * A scanned or typed address outside those ranges is refused outright rather than attempted. It is
 * either a mistake or an attempt to make a device post somebody's family to a machine on the
 * internet, and there is no third reading -- so there is nothing to weigh and no reason to ask.
 * Loopback is deliberately *not* included here: see `isTestableAddress`.
 */
function isPrivateAddress(address) {
  const parts = String(address).split('.');
  if (parts.length !== 4) return false;
  const octets = [];
  for (const part of parts) {
    if (part.length === 0 || part.length > 3 || !/^[0-9]+$/.test(part)) return false;
    // "010" is not a dotted quad; some parsers read a leading zero as octal.
    if (part.length > 1 && part[0] === '0') return false;
    const value = Number(part);
    if (value > 255) return false;
    octets.push(value);
  }
  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

/**
 * Loopback, which an Android emulator reaches its host on as `10.0.2.2` -- already private -- but
 * which a desktop talking to a second copy of itself needs directly.
 *
 * Kept apart from `isPrivateAddress` so that the rule a scanned code is held to stays the narrow
 * one. Only the test harness and the desktop's own smoke run pass this.
 */
function isTestableAddress(address) {
  return isPrivateAddress(address) || address === '127.0.0.1';
}

module.exports = { encodeQrLink, parseQrLink, isPrivateAddress, isTestableAddress };
