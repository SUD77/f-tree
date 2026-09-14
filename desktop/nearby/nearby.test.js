/*
 * The facade `main.js` sees, and the properties that are promises to the user rather than to a
 * caller.
 *
 * `loopback.test.js` proves the protocol works. This file is about the object wrapped around it:
 * that nothing is bound until visibility is switched on, that switching it off gives the socket
 * back, that a received file lands where an import can pick it up, and that a failed transfer
 * leaves nothing behind.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { Nearby, localAddress } = require('./index');
const { parseQrLink } = require('./qrlink');
const protocol = require('./protocol');
const { PROBLEM } = require('./problems');

function scratch(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `ftree-${name}-`));
}

function sampleFile(directory, bytes = 32 * 1024) {
  const file = path.join(directory, 'family.ftree');
  const content = crypto.randomBytes(bytes);
  fs.writeFileSync(file, content);
  return { file, content };
}

test('nothing is bound until visibility is switched on', async () => {
  // The property the whole privacy argument rests on, and the reason the prompts macOS and Windows
  // raise arrive when somebody has just asked to be visible rather than at launch.
  const nearby = new Nearby({ directory: scratch('quiet') });
  assert.equal(nearby.visible, false);
  assert.equal(nearby.discovery, null);
  assert.equal(nearby.server, null);
  assert.deepEqual(nearby.peers(), []);
  assert.equal(nearby.qrLink(), null);
});

test('switching visibility off gives the socket back', async () => {
  const nearby = new Nearby({ directory: scratch('toggle') });
  await nearby.setVisible(true);
  assert.equal(nearby.visible, true);
  const port = nearby.server.port;
  assert.ok(port > 0);

  await nearby.setVisible(false);
  assert.equal(nearby.visible, false);
  assert.equal(nearby.server, null);
  assert.equal(nearby.discovery, null);

  // And the key is gone with it. A fresh one each time is what keeps a session's recordings from
  // being readable by anybody who later extracted the old one.
  assert.equal(nearby.beaconKey, null);
});

test('a device has a name it did not take from the machine', () => {
  // Never the hostname. A default of "priya-macbook" would broadcast a real person's name to every
  // stranger on a shared network, twice a second, without ever saying that is what it did.
  const nearby = new Nearby({ directory: scratch('name') });
  assert.match(nearby.deviceName, /^[A-Z][a-z]+ [A-Z][a-z]+$/);
  assert.ok(!nearby.deviceName.includes(os.hostname()));
});

test('a chosen name is sanitised before it is ever broadcast', () => {
  const nearby = new Nearby({ directory: scratch('chosen') });
  assert.equal(nearby.setDeviceName('Ankit‮s phone'), 'Ankits phone');
  assert.equal(nearby.setDeviceName('  spaced   out  '), 'spaced out');
  // Nothing survives, so it falls back to the generated name rather than announcing an empty one.
  assert.match(nearby.setDeviceName('   '), /^[A-Z][a-z]+ [A-Z][a-z]+$/);
});

test('the QR carries a token, and the token is not in the beacon', async () => {
  const nearby = new Nearby({ directory: scratch('qr') });
  await nearby.setVisible(true);

  const link = nearby.qrLink();
  if (link === null) {
    // A machine with no private-range address has nothing to put in a code. Saying so is right.
    await nearby.setVisible(false);
    return;
  }

  const parsed = parseQrLink(link.text);
  assert.ok(parsed, `unparseable: ${link.text}`);
  assert.equal(parsed.port, nearby.server.port);
  assert.equal(parsed.token.length, protocol.PAIRING_TOKEN_BYTES);
  assert.ok(parsed.keyFingerprint.equals(nearby.beaconKey.fingerprint));

  // The beacon advertises a fingerprint of the key and nothing about the token. The token is a
  // shared secret precisely because it only ever exists on a screen and in two memories.
  assert.ok(!nearby.beaconKey.fingerprint.equals(parsed.token));
  await nearby.setVisible(false);
});

test('the QR never carries an address off this network', async () => {
  const address = localAddress();
  if (address === null) return;
  // The same rule a scanned code is held to, applied to the one this device shows, so a machine
  // with a public address on some interface cannot put it in a square somebody points a phone at.
  const [a, b] = address.split('.').map(Number);
  const isPrivate = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  assert.ok(isPrivate, `localAddress returned ${address}`);
});

test('a file received through the facade lands where an import can pick it up', async () => {
  const senderDirectory = scratch('facade-send');
  const receiverDirectory = scratch('facade-receive');
  const { file, content } = sampleFile(senderDirectory);

  const receiver = new Nearby({ directory: receiverDirectory });
  const sender = new Nearby({ directory: senderDirectory });
  await receiver.setVisible(true);

  const complete = new Promise((resolve) => {
    receiver.on('receive-offer', () => receiver.acceptIncoming());
    receiver.on('receive-complete', resolve);
  });

  sender.on('send-code', () => sender.confirmSendCode(true));
  await sender.send({
    filePath: file,
    counts: { people: 12, relationships: 7, photos: 3 },
    suggestedFileName: 'family.ftree',
    link: {
      address: '127.0.0.1',
      port: receiver.server.port,
      deviceId: receiver.identity.deviceId,
      keyFingerprint: null,
      token: null,
    },
  });

  const arrived = await complete;

  // Deliberately the exact shape `tree:chooseImport` already returns, so `planImport` and the
  // review screen need no changes at all. A transfer ends where an import begins.
  assert.ok('name' in arrived && 'path' in arrived);
  assert.equal(arrived.name, 'family.ftree');
  assert.equal(arrived.bytes, content.length);
  assert.ok(fs.readFileSync(arrived.path).equals(content));
  // And it is no longer a `.part`, because a half-written file that looks finished is worse than
  // no file.
  assert.ok(!arrived.path.endsWith('.part'));

  receiver.importFinished(null);
  await receiver.setVisible(false);
});

test('a refused transfer leaves nothing partial behind', async () => {
  const senderDirectory = scratch('partial-send');
  const receiverDirectory = scratch('partial-receive');
  const { file } = sampleFile(senderDirectory);

  const receiver = new Nearby({ directory: receiverDirectory });
  const sender = new Nearby({ directory: senderDirectory });
  await receiver.setVisible(true);

  // Both sides, because the receiver is the one that has a file to clean up and `receive-finished`
  // is defined to fire only once there is nothing left on disk.
  const refused = Promise.all([
    new Promise((resolve) => sender.on('send-finished', resolve)),
    new Promise((resolve) => receiver.on('receive-finished', resolve)),
  ]);
  receiver.on('receive-offer', () => receiver.declineIncoming());

  sender.on('send-code', () => sender.confirmSendCode(true));
  await sender.send({
    filePath: file,
    counts: { people: 1, relationships: 0, photos: 0 },
    suggestedFileName: 'family.ftree',
    link: {
      address: '127.0.0.1',
      port: receiver.server.port,
      deviceId: receiver.identity.deviceId,
      keyFingerprint: null,
      token: null,
    },
  });

  const [senderProblem] = await refused;
  assert.ok(senderProblem, 'the sender was not told it had been declined');

  // Nothing partial is left for somebody to find later and try to open.
  const downloads = path.join(receiverDirectory, 'nearby');
  const left = fs.existsSync(downloads) ? fs.readdirSync(downloads) : [];
  assert.deepEqual(left, [], `left behind: ${left.join(', ')}`);

  await receiver.setVisible(false);
});

/*
 * The code on screen, as the screen sees it.
 *
 * `loopback.test.js` holds the protocol to "a token is used only by a connection that scanned it,
 * and only once". These are the facade's half: that the square on screen is told when it has
 * stopped being true -- spent, or old -- so it is never left showing a code nothing will honour.
 */
function sendTo(receiver, { token = null, onCode = (sender) => sender.confirmSendCode(true) } = {}) {
  const directory = scratch('qr-sender');
  const { file } = sampleFile(directory, 8192);
  const sender = new Nearby({ directory });
  const finished = new Promise((resolve) => sender.once('send-finished', resolve));
  sender.on('send-code', () => onCode(sender));
  return sender.send({
    filePath: file,
    counts: { people: 1, relationships: 0, photos: 0 },
    suggestedFileName: 'family.ftree',
    link: {
      address: '127.0.0.1',
      port: receiver.server.port,
      deviceId: receiver.identity.deviceId,
      keyFingerprint: receiver.beaconKey.fingerprint,
      token,
    },
  }).then(() => finished);
}

test('a code that has been used is redrawn, and the new one is different', async () => {
  const receiver = new Nearby({ directory: scratch('qr-spent') });
  await receiver.setVisible(true);
  receiver.qrLink();
  const token = Buffer.from(receiver.pairingToken);
  let redraws = 0;
  receiver.on('qr-changed', () => { redraws += 1; });
  receiver.on('receive-offer', () => receiver.acceptIncoming());
  receiver.on('receive-complete', () => receiver.importFinished(null));
  const how = new Promise((resolve) => receiver.once('receive-code', (_sas, info) => resolve(info)));

  const problem = await sendTo(receiver, { token });
  assert.equal(problem, null, JSON.stringify(problem));
  // The receiver is told the sender scanned, so it does not ask anybody to compare digits that the
  // other screen never showed.
  assert.deepEqual(await how, { pairedByQr: true });
  assert.equal(redraws, 1, 'the screen was not told its code had been spent');
  assert.equal(receiver.pairingToken, null);
  receiver.qrLink();
  assert.ok(receiver.pairingToken && !receiver.pairingToken.equals(token));
  await receiver.setVisible(false);
});

test('a code that has run out of time is redrawn, and a scan of it is refused', async () => {
  // Five minutes, scaled down. What matters is that the picture and the check agree: the square is
  // retired at the moment the token is, not at the next time somebody happens to ask for it.
  const receiver = new Nearby({ directory: scratch('qr-old'), pairingTokenLifetimeMs: 120 });
  await receiver.setVisible(true);
  receiver.qrLink();
  const token = Buffer.from(receiver.pairingToken);
  const retired = new Promise((resolve) => receiver.once('qr-changed', resolve));
  await retired;
  assert.equal(receiver.pairingToken, null);

  let offered = false;
  receiver.on('receive-offer', () => { offered = true; });
  const problem = await sendTo(receiver, { token });
  assert.equal(problem?.problem, PROBLEM.BAD_PAIRING, JSON.stringify(problem));
  assert.equal(offered, false);
  await receiver.setVisible(false);
});

test('a list-picked sender is told the receiver said it compares, not that it scanned', async () => {
  const receiver = new Nearby({ directory: scratch('qr-list') });
  await receiver.setVisible(true);
  receiver.qrLink();
  receiver.on('receive-offer', () => receiver.acceptIncoming());
  receiver.on('receive-complete', () => receiver.importFinished(null));
  const how = new Promise((resolve) => receiver.once('receive-code', (_sas, info) => resolve(info)));

  const problem = await sendTo(receiver);
  assert.equal(problem, null, JSON.stringify(problem));
  assert.deepEqual(await how, { pairedByQr: false });
  await receiver.setVisible(false);
});

test('the receiver can stop a transfer while the codes are up, and the sender hears why', async () => {
  // Cancel has to really cancel: the sender is told CANCELLED rather than a generic failure, and
  // nothing partial is left in the receiver's folder.
  const receiverDirectory = scratch('cancel-receive');
  const receiver = new Nearby({ directory: receiverDirectory });
  await receiver.setVisible(true);
  receiver.on('receive-code', () => receiver.cancelIncoming());
  const receiverEnd = new Promise((resolve) => receiver.once('receive-finished', resolve));

  const problem = await sendTo(receiver, { onCode: () => {} });
  assert.equal(problem?.problem, PROBLEM.CANCELLED, JSON.stringify(problem));
  assert.equal((await receiverEnd).problem, PROBLEM.CANCELLED);

  const downloads = path.join(receiverDirectory, 'nearby');
  assert.deepEqual(fs.existsSync(downloads) ? fs.readdirSync(downloads) : [], []);
  await receiver.setVisible(false);
});

test('sending to an address off this network is refused before a socket opens', async () => {
  const directory = scratch('refuse');
  const { file } = sampleFile(directory, 1024);
  const sender = new Nearby({ directory });

  await assert.rejects(
    () => sender.send({
      filePath: file,
      counts: { people: 1, relationships: 0, photos: 0 },
      link: { address: '8.8.8.8', port: 4000, deviceId: Buffer.alloc(16), keyFingerprint: null, token: null },
    }),
    /refusing to connect/,
  );
});

test('the device id is not the tree id', () => {
  // The separation that cannot be fixed after a release ships. `sourceTreeId` is stamped into
  // every `.ftree` this machine has exported; broadcasting it twice a second would turn a
  // file-provenance identifier into a device tracker.
  const directory = scratch('ids');
  const nearby = new Nearby({ directory });
  assert.equal(nearby.identity.deviceId.length, 16);

  // Stored in its own file, so "forget this device" is a delete rather than an edit of something
  // else's JSON.
  assert.ok(fs.existsSync(path.join(directory, 'nearby-identity.json')));
  const stored = JSON.parse(fs.readFileSync(path.join(directory, 'nearby-identity.json'), 'utf8'));
  assert.ok(!('sourceTreeId' in stored));
  assert.deepEqual(Object.keys(stored), ['deviceId']);

  // And it is remembered, so a device does not appear as a stranger every time the app restarts.
  assert.equal(new Nearby({ directory }).identity.deviceId.toString('hex'), nearby.identity.deviceId.toString('hex'));
});
