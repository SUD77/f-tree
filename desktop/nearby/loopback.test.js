/*
 * A whole transfer, over a real socket, in this process.
 *
 * Everything before this file checks that two implementations *would* agree. This one checks that
 * one of them actually works: a server binds, a client connects, they agree a key over a TCP
 * connection neither of them can see the other side of, and a file comes out the far end byte for
 * byte identical.
 *
 * `127.0.0.1` rather than a network, because what is being tested is the protocol and not the
 * router. The failures that need two devices and one access point -- multicast that a consumer AP
 * drops, client isolation on guest Wi-Fi, a phone that walks out of range mid-transfer -- cannot be
 * reached from here and are a manual checklist on the tracking issue. What *can* be reached from
 * here is every byte of the handshake and every frame of the transfer, and that is the part where
 * being wrong is silent.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const protocol = require('./protocol');
const handshake = require('./handshake');
const { NearbyIdentity } = require('./identity');
const { NearbyServer } = require('./server');
const { NearbySender } = require('./client');
const { PROBLEM } = require('./problems');

function scratch() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ftree-nearby-'));
}

/**
 * A file large enough to cross several frames.
 *
 * 160 KiB against a 64 KiB frame is three frames: a full one, a full one, and a short one. The
 * short last frame is the case worth having -- an implementation that assumed every DATA frame was
 * full would pass a one-frame test and truncate every real tree.
 */
function sampleFile(directory, bytes = 160 * 1024) {
  const file = path.join(directory, 'family.ftree');
  const content = crypto.randomBytes(bytes);
  fs.writeFileSync(file, content);
  return { file, content };
}

/** Runs one transfer end to end and resolves with what both sides saw. */
async function transfer({ directory, file, content, onCode = null, decline = false } = {}) {
  const receivedPath = path.join(directory, 'received.ftree');
  const sink = fs.createWriteStream(receivedPath);

  const receiverIdentity = new NearbyIdentity(path.join(directory, 'receiver'));
  const senderIdentity = new NearbyIdentity(path.join(directory, 'sender'));
  const beaconKey = receiverIdentity.startAdvertising();

  const server = new NearbyServer({ identity: receiverIdentity, beaconKey, sink });
  const port = await server.listen('127.0.0.1');

  const seen = { receiverCode: null, senderCode: null, offer: null, complete: null };

  const done = new Promise((resolve) => {
    server.on('transfer', (incoming) => {
      incoming.on('code', (sas) => {
        seen.receiverCode = sas;
      });
      incoming.on('offer', (offer) => {
        seen.offer = offer;
        if (decline) incoming.decline();
        else incoming.accept();
      });
      incoming.on('complete', (summary) => {
        seen.complete = summary;
        sink.end(() => incoming.verified(null));
      });
      incoming.on('finished', (problem) => resolve({ side: 'receiver', problem }));
    });
  });

  const sender = new NearbySender({
    identity: senderIdentity,
    filePath: file,
    counts: { people: 12, relationships: 7, photos: 3 },
    suggestedFileName: 'family.ftree',
  });
  await sender.prepare();

  const senderDone = new Promise((resolve) => {
    sender.on('code', (sas) => {
      seen.senderCode = sas;
      if (onCode) onCode(sender, sas);
      else sender.confirmCode(true);
    });
    sender.on('finished', (problem) => resolve(problem));
  });

  sender.connect('127.0.0.1', port);

  const receiverResult = await done;
  const senderProblem = await senderDone;
  server.close();

  return {
    seen,
    senderProblem,
    receiverProblem: receiverResult.problem,
    receivedPath,
    content,
  };
}

test('a family crosses a socket and arrives byte for byte', async () => {
  const directory = scratch();
  const { file, content } = sampleFile(directory);
  const result = await transfer({ directory, file, content });

  assert.equal(result.senderProblem, null, `sender: ${JSON.stringify(result.senderProblem)}`);
  assert.equal(result.receiverProblem, null, `receiver: ${JSON.stringify(result.receiverProblem)}`);

  const received = fs.readFileSync(result.receivedPath);
  assert.equal(received.length, content.length);
  assert.ok(received.equals(content), 'the bytes that arrived are not the bytes that were sent');
});

test('both ends show the same six digits', async () => {
  // The entire security argument for the feature. A machine in the middle runs two conversations
  // with two different secrets and cannot make these agree.
  const directory = scratch();
  const { file, content } = sampleFile(directory, 4096);
  const result = await transfer({ directory, file, content });

  assert.ok(result.seen.senderCode, 'the sender never showed a code');
  assert.ok(result.seen.receiverCode, 'the receiver never showed a code');
  assert.equal(result.seen.senderCode, result.seen.receiverCode);
  assert.match(result.seen.senderCode, /^[0-9]{6}$/);
});

test('the offer arrives before the file does, with the counts in it', async () => {
  const directory = scratch();
  const { file, content } = sampleFile(directory, 4096);
  const result = await transfer({ directory, file, content });

  assert.ok(result.seen.offer, 'no offer reached the receiver');
  assert.equal(result.seen.offer.peopleCount, 12);
  assert.equal(result.seen.offer.relationshipCount, 7);
  assert.equal(result.seen.offer.photoCount, 3);
  assert.equal(result.seen.offer.totalBytes, BigInt(content.length));
  assert.equal(result.seen.offer.suggestedFileName, 'family.ftree');
  // The digest is in the offer, so the receiver can check what arrived against what was promised
  // rather than discovering a truncation after the fact.
  assert.ok(result.seen.offer.sha256.equals(crypto.createHash('sha256').update(content).digest()));
});

test('a file that spans several frames is reassembled in order', async () => {
  // 160 KiB over 64 KiB frames: two full and one short. An implementation that assumed every DATA
  // frame was full would pass a single-frame test and truncate every real tree.
  const directory = scratch();
  const bytes = 160 * 1024;
  const { file, content } = sampleFile(directory, bytes);
  const result = await transfer({ directory, file, content });

  assert.equal(result.senderProblem, null);
  const received = fs.readFileSync(result.receivedPath);
  assert.equal(received.length, bytes);
  assert.ok(received.equals(content));
});

test('an empty file is still a transfer, not a hang', async () => {
  const directory = scratch();
  const { file, content } = sampleFile(directory, 0);
  const result = await transfer({ directory, file, content });

  assert.equal(result.senderProblem, null);
  assert.equal(result.receiverProblem, null);
  assert.equal(fs.readFileSync(result.receivedPath).length, 0);
});

test('a mismatched code stops the transfer before the offer', async () => {
  // The user said the two screens did not match. That means somebody is there, so nothing else
  // happens: no offer, no file, and a code the other end can name.
  const directory = scratch();
  const { file, content } = sampleFile(directory, 4096);
  const result = await transfer({
    directory,
    file,
    content,
    onCode: (sender) => sender.confirmCode(false),
  });

  assert.equal(result.senderProblem?.problem, PROBLEM.CODES_DID_NOT_MATCH);
  assert.equal(result.seen.offer, null, 'an offer was sent after the codes did not match');
  assert.ok(!fs.existsSync(result.receivedPath) || fs.readFileSync(result.receivedPath).length === 0);
});

test('a declined transfer tells the sender why, and writes nothing', async () => {
  const directory = scratch();
  const { file, content } = sampleFile(directory, 4096);
  const result = await transfer({ directory, file, content, decline: true });

  assert.equal(result.senderProblem?.problem, PROBLEM.DECLINED);
  assert.equal(fs.readFileSync(result.receivedPath).length, 0);
});

test('the second connection is refused rather than left hanging', async () => {
  // A refusal somebody can read beats a socket that sits open until it times out.
  const directory = scratch();
  const { file } = sampleFile(directory, 4096);

  const receiverIdentity = new NearbyIdentity(path.join(directory, 'r'));
  const beaconKey = receiverIdentity.startAdvertising();
  const sink = fs.createWriteStream(path.join(directory, 'out.ftree'));
  const server = new NearbyServer({ identity: receiverIdentity, beaconKey, sink });
  const port = await server.listen('127.0.0.1');

  // The first sender connects and then simply waits at the code prompt, holding the server.
  const first = new NearbySender({
    identity: new NearbyIdentity(path.join(directory, 's1')),
    filePath: file,
    counts: { people: 1, relationships: 0, photos: 0 },
  });
  await first.prepare();
  const firstHolding = new Promise((resolve) => first.once('code', resolve));
  server.on('transfer', (incoming) => incoming.on('offer', () => incoming.accept()));
  first.connect('127.0.0.1', port);
  await firstHolding;

  const second = new NearbySender({
    identity: new NearbyIdentity(path.join(directory, 's2')),
    filePath: file,
    counts: { people: 1, relationships: 0, photos: 0 },
  });
  await second.prepare();
  const refusal = new Promise((resolve) => second.once('finished', resolve));
  second.connect('127.0.0.1', port);

  const problem = await refusal;
  assert.ok(problem, 'the second connection was not refused');
  assert.equal(problem.problem, PROBLEM.BUSY);

  first.cancel();
  server.close();
});

test('a sender that connects to nothing says so instead of waiting', async () => {
  const directory = scratch();
  const { file } = sampleFile(directory, 1024);
  const sender = new NearbySender({
    identity: new NearbyIdentity(directory),
    filePath: file,
    counts: { people: 1, relationships: 0, photos: 0 },
  });
  await sender.prepare();

  const problem = await new Promise((resolve) => {
    sender.once('finished', resolve);
    // Port 1 on loopback: nothing is listening and the refusal is immediate.
    sender.connect('127.0.0.1', 1);
  });
  assert.equal(problem.problem, PROBLEM.NETWORK);
});

test('a QR pairing skips the code, and only a matching token works', async () => {
  // The token never goes on the wire. Both ends mix it into the salt, so a sender that did not see
  // the screen derives a different key and its first sealed frame fails to open -- which is what
  // makes it safe to skip the comparison a scan replaces.
  const directory = scratch();
  const { file, content } = sampleFile(directory, 8192);
  const token = crypto.randomBytes(protocol.PAIRING_TOKEN_BYTES);

  for (const [label, senderToken, shouldSucceed] of [
    ['matching', token, true],
    ['wrong', crypto.randomBytes(protocol.PAIRING_TOKEN_BYTES), false],
  ]) {
    const sub = fs.mkdtempSync(path.join(directory, label));
    const receiverIdentity = new NearbyIdentity(path.join(sub, 'r'));
    const beaconKey = receiverIdentity.startAdvertising();
    const sink = fs.createWriteStream(path.join(sub, 'out.ftree'));
    const server = new NearbyServer({ identity: receiverIdentity, beaconKey, sink });
    const port = await server.listen('127.0.0.1');

    let codeShown = false;
    server.on('transfer', (incoming) => {
      incoming.pairingToken = token;
      incoming.on('offer', () => incoming.accept());
      incoming.on('complete', (summary) => sink.end(() => incoming.verified(null)));
    });

    const sender = new NearbySender({
      identity: new NearbyIdentity(path.join(sub, 's')),
      filePath: file,
      counts: { people: 1, relationships: 0, photos: 0 },
      pairedByQr: true,
      pairingToken: senderToken,
    });
    await sender.prepare();
    sender.on('code', () => {
      codeShown = true;
    });

    const problem = await new Promise((resolve) => {
      sender.once('finished', resolve);
      sender.connect('127.0.0.1', port);
    });
    server.close();

    assert.equal(codeShown, false, `${label}: a code was shown on the QR path`);
    if (shouldSucceed) {
      assert.equal(problem, null, `${label}: ${JSON.stringify(problem)}`);
      assert.ok(fs.readFileSync(path.join(sub, 'out.ftree')).equals(content));
    } else {
      // Not "the code was wrong" -- the sender never saw a code. The first sealed frame simply
      // would not open, which is the shape a stale or copied pairing actually has.
      assert.ok(problem, `${label}: a mismatched token was accepted`);
      assert.ok(
        problem.problem === PROBLEM.BAD_PAIRING || problem.problem === PROBLEM.CONNECTION_LOST,
        `${label}: unexpected ${JSON.stringify(problem)}`,
      );
    }
  }
});

test('the receiver refuses an offer larger than it will take, before any bytes move', async () => {
  const directory = scratch();
  const { file } = sampleFile(directory, 64 * 1024);

  const receiverIdentity = new NearbyIdentity(path.join(directory, 'r'));
  const beaconKey = receiverIdentity.startAdvertising();
  const receivedPath = path.join(directory, 'out.ftree');
  const sink = fs.createWriteStream(receivedPath);
  // A ceiling below the file's size, so the refusal is on the number in the offer.
  const server = new NearbyServer({ identity: receiverIdentity, beaconKey, sink, maxOfferBytes: 1024 });
  const port = await server.listen('127.0.0.1');

  let sawOffer = false;
  server.on('transfer', (incoming) => {
    incoming.on('offer', () => {
      sawOffer = true;
      incoming.accept();
    });
  });

  const sender = new NearbySender({
    identity: new NearbyIdentity(path.join(directory, 's')),
    filePath: file,
    counts: { people: 1, relationships: 0, photos: 0 },
  });
  await sender.prepare();
  sender.on('code', () => sender.confirmCode(true));

  const problem = await new Promise((resolve) => {
    sender.once('finished', resolve);
    sender.connect('127.0.0.1', port);
  });
  server.close();

  assert.equal(problem?.problem, PROBLEM.TOO_LARGE);
  // The prompt never appeared, because the refusal happened on the declared size rather than after
  // somebody had been asked about a file that was never going to fit.
  assert.equal(sawOffer, false);
  assert.equal(fs.readFileSync(receivedPath).length, 0);
});

/**
 * A receiver written by hand that answers KEY_ACK with `ackNonce` after promising `promisedNonce` in
 * HELLO_ACK -- what a machine in the middle has to do to choose the six digits. Resolves with what
 * the sender concluded and the code it showed, if any.
 */
async function againstScriptedReceiver(promisedNonce, ackNonce) {
  const net = require('node:net');
  const dh = require('./dh');
  const messages = require('./messages');
  const beacon = require('./beacon');
  const { encodeFrame } = require('./frame');

  const directory = scratch();
  const { file } = sampleFile(directory, 1024);
  const publicKey = dh.publicOf(dh.generatePrivate());

  const server = net.createServer((socket) => {
    socket.on('error', () => {});
    let buffered = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      while (buffered.length >= 4 && buffered.length >= 4 + buffered.readUInt32BE(0)) {
        const length = buffered.readUInt32BE(0);
        const type = buffered[4];
        buffered = buffered.subarray(4 + length);
        if (type === protocol.TYPE_HELLO) {
          socket.write(encodeFrame(protocol.TYPE_HELLO_ACK, messages.HelloAck.encode({
            chosenVersion: protocol.VERSION,
            platform: beacon.PLATFORM.LINUX,
            flags: protocol.SUPPORTED_FLAGS,
            deviceId: Buffer.alloc(16, 2),
            displayName: 'Amber Otter',
            keyCommitment: handshake.keyCommitment(publicKey, promisedNonce),
          })));
        } else if (type === protocol.TYPE_KEY) {
          socket.write(encodeFrame(protocol.TYPE_KEY_ACK, messages.KeyMessage.encode({
            publicKey: dh.to256(publicKey),
            nonce: ackNonce,
          })));
        }
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const sender = new NearbySender({
    identity: new NearbyIdentity(path.join(directory, 'sender')),
    filePath: file,
    counts: { people: 1, relationships: 0, photos: 0 },
    suggestedFileName: 'family.ftree',
  });
  await sender.prepare();

  let code = null;
  const finished = new Promise((resolve) => {
    sender.on('code', (sas) => {
      code = sas;
      sender.confirmCode(false);
    });
    sender.on('finished', (problem) => resolve(problem));
  });
  sender.connect('127.0.0.1', server.address().port);
  const problem = await finished;
  server.close();
  return { problem: problem?.problem ?? null, code };
}

test('a receiver that changes its nonce after the sender has spoken is refused before any code', async () => {
  // Without the promise, a machine in the middle playing the receiver tries nonces until the code
  // on this screen equals the one it already agreed with the real receiver. The refusal has to come
  // before a code is shown, or it is too late.
  const result = await againstScriptedReceiver(Buffer.alloc(32, 1), Buffer.alloc(32, 2));
  assert.equal(result.problem, PROBLEM.KEY_NOT_AS_PROMISED);
  assert.equal(result.code, null, 'a code was shown for a key that broke its promise');
});

test('the same scripted receiver keeping its promise does reach the code', async () => {
  // The control: the script is a valid receiver in every other respect, so the refusal above is
  // about the nonce and nothing else.
  const nonce = Buffer.alloc(32, 1);
  const result = await againstScriptedReceiver(nonce, nonce);
  assert.notEqual(result.code, null, 'no code was shown');
  assert.equal(result.problem, PROBLEM.CODES_DID_NOT_MATCH);
});
