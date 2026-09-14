/*
 * The sending end: a TCP client that streams one `.ftree` and stops.
 *
 * The sender browses, the receiver advertises. Fixed roles in version 1, because the side that has
 * to consent is naturally the side that decides who can see it, and a protocol where either end can
 * start has two state machines where one will do.
 *
 * As on the other side, nothing here decides anything: it moves bytes and hands every decision to
 * `SenderSession`, which owns no socket.
 */

const net = require('node:net');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

const protocol = require('./protocol');
const dh = require('./dh');
const handshake = require('./handshake');
const negotiation = require('./negotiation');
const messages = require('./messages');
const beacon = require('./beacon');
const names = require('./names');
const { Connection, checkType } = require('./connection');
const { encodeFrame } = require('./frame');
const { SenderSession, SENDER, EVENT } = require('./session');
const { NearbyFailure, PROBLEM, problemName } = require('./problems');

/** 64 KiB, the largest plaintext a frame carries. */
const CHUNK = protocol.MAX_PLAINTEXT;

/**
 * One outgoing transfer.
 *
 * `filePath` is a `.ftree` that has already been written, not a tree in memory, and that is
 * deliberate. Exporting to a temporary file first buys four things at the cost of one file: an
 * honest progress bar, a receiver that can refuse on size before a byte moves, a digest bound into
 * the accept decision rather than discovered at the end, and -- the one that matters -- no database
 * transaction held open across a network for minutes.
 */
class NearbySender extends EventEmitter {
  constructor({
    identity,
    filePath,
    counts,
    suggestedFileName = null,
    pairedByQr = false,
    pairingToken = null,
    expectedFingerprint = null,
  }) {
    super();
    this.identity = identity;
    this.filePath = filePath;
    this.counts = counts;
    this.suggestedFileName = suggestedFileName ?? 'family.ftree';
    this.pairedByQr = pairedByQr;
    this.pairingToken = pairingToken ?? handshake.NO_TOKEN;
    this.expectedFingerprint = expectedFingerprint;

    this.privateKey = dh.generatePrivate();
    this.publicKey = dh.publicOf(this.privateKey);
    this.nonce = crypto.randomBytes(protocol.HANDSHAKE_NONCE_BYTES);

    this.transcript = new handshake.TranscriptHash();
    this.socket = null;
    this.connection = null;
    this.handle = null;
    this.sent = 0n;
    this.sas = null;
    this.finished = false;
    this.offerMessage = null;
  }

  /**
   * Reads the file once, before connecting, for its length and its digest.
   *
   * Both go in the OFFER so the receiver can refuse on size before a byte moves and verify what
   * arrived against what was promised. Doing it here rather than while streaming means the number
   * in the prompt is a fact rather than an estimate.
   */
  async prepare() {
    const digest = crypto.createHash('sha256');
    let total = 0n;
    await new Promise((resolve, reject) => {
      const stream = fs.createReadStream(this.filePath, { highWaterMark: CHUNK });
      stream.on('data', (chunk) => {
        digest.update(chunk);
        total += BigInt(chunk.length);
      });
      stream.on('error', reject);
      stream.on('end', resolve);
    });

    if (total > BigInt(protocol.MAX_OFFER_BYTES)) throw new NearbyFailure(PROBLEM.TOO_LARGE);

    this.offerMessage = {
      peopleCount: this.counts.people,
      relationshipCount: this.counts.relationships,
      photoCount: this.counts.photos,
      totalBytes: total,
      sha256: digest.digest(),
      treeFormatVersion: messages.TREE_FORMAT_VERSION,
      suggestedFileName: names.truncateToBytes(this.suggestedFileName, protocol.OFFER_MAX_NAME_BYTES),
    };
    return this.offerMessage;
  }

  connect(address, port) {
    if (!this.offerMessage) throw new Error('call prepare() before connect()');

    this.session = new SenderSession({
      pairedByQr: this.pairedByQr,
      hello: () => this.#hello(),
      key: () => this.#key(),
      onHelloAck: (ack) => this.#onHelloAck(ack),
      onKeyAck: (ack) => this.#onKeyAck(ack),
      offer: () => this.offerMessage,
    });

    this.socket = net.createConnection({ host: address, port }, () => {
      this.#run(EVENT.connected());
    });
    this.connection = new Connection(this.socket, {
      sendDirection: protocol.DIRECTION_SENDER_TO_RECEIVER,
      receiveDirection: protocol.DIRECTION_RECEIVER_TO_SENDER,
    });

    this.socket.on('data', (chunk) => this.#onData(chunk));
    this.socket.on('error', (error) => this.#failLocally(error));
    this.socket.on('close', () => this.#run(EVENT.peerClosed()));
    this.socket.setTimeout(protocol.USER_DECISION_TIMEOUT_MS, () => {
      this.#failWith(PROBLEM.TIMED_OUT);
    });
    return this;
  }

  /** The person at this screen said the two codes matched. */
  confirmCode(matched) {
    this.#run(EVENT.userConfirmedCode(matched));
  }

  cancel() {
    this.#run(EVENT.userCancelled());
  }

  #hello() {
    return messages.Hello.encode({
      platform: beacon.thisPlatform(),
      flags: protocol.SUPPORTED_FLAGS,
      deviceId: this.identity.deviceId,
      displayName: this.identity.displayName,
    });
  }

  #key() {
    return messages.KeyMessage.encode({
      publicKey: dh.to256(this.publicKey),
      nonce: this.nonce,
    });
  }

  #onHelloAck(ack) {
    // What the receiver *stated* is checked against what this side actually offered. A receiver
    // that could name any version it liked could name one never put on the table. The transcript
    // already makes that impossible to do maliciously; this makes it impossible to do by mistake,
    // which is the failure that ships.
    negotiation.verifyChosen(
      ack.chosenVersion,
      ack.flags,
      protocol.VERSION,
      protocol.MIN_VERSION,
      protocol.SUPPORTED_FLAGS,
      protocol.SUPPORTED_FLAGS,
    );
    negotiation.verifyTreeFormat(messages.TREE_FORMAT_VERSION, ack.treeFormatMax);
    this.peer = ack;
  }

  #onKeyAck(ack) {
    const peerPublic = dh.fromBytes(ack.publicKey);

    // The device that was tapped in the list against the device that actually answered. Not an
    // authenticator -- a beacon is unsigned and anybody can copy one -- but it turns "I connected
    // to the wrong host" into a refusal here rather than a transfer that completes to a stranger.
    if (this.expectedFingerprint) {
      const actual = handshake.beaconFingerprint(this.peer.deviceId, peerPublic);
      if (!actual.equals(this.expectedFingerprint)) throw new NearbyFailure(PROBLEM.WRONG_DEVICE);
    }

    const shared = dh.sharedSecret(this.privateKey, peerPublic);
    const transcriptValue = this.transcript.value();
    const prk = handshake.extract(transcriptValue, this.pairingToken, shared);
    const keys = handshake.deriveKeys(prk);

    this.sas = keys.sas;
    this.connection.secure(
      { senderKey: keys.senderToReceiver, receiverKey: keys.receiverToSender },
      transcriptValue,
    );
    return keys.sas;
  }

  #onData(chunk) {
    try {
      for (const frame of this.connection.feed(chunk, this.transcript)) {
        checkType(frame.type);
        if (frame.type === protocol.TYPE_ABORT) {
          this.#finish(messages.Abort.decode(frame.payload).problem);
          return;
        }
        if (frame.type === protocol.TYPE_DECLINE) {
          const problem = frame.payload.length > 0 ? frame.payload[0] : PROBLEM.DECLINED;
          this.#finish(problem);
          return;
        }
        this.#run(EVENT.frame(frame.type, frame.payload));
        if (this.finished) return;
      }
    } catch (error) {
      if (error instanceof NearbyFailure) this.#failWith(error.problem);
      else this.#failWith(PROBLEM.MALFORMED_FRAME);
    }
  }

  #run(event) {
    if (this.finished) return;
    const { state, actions } = this.session.step(event);
    for (const action of actions) this.#perform(action);
    // Success has no `fail` action, so it needs saying separately: reaching DONE is the one way
    // out of this state machine that is not a problem, and it still has to be reported.
    if (state === SENDER.DONE) this.#finish(null);
  }

  #perform(action) {
    switch (action.kind) {
      case 'send-frame':
        this.connection.send(action.type, action.payload, this.transcript);
        break;
      case 'show-code':
        this.emit('code', action.sas);
        break;
      case 'read-more-of-the-file':
        this.#readMore();
        break;
      case 'fail':
        this.#finish(action.problem, action.importProblem);
        break;
      case 'close':
        this.connection.close();
        break;
      default:
        break;
    }
  }

  /**
   * One chunk at a time, driven by the state machine asking for it.
   *
   * Pull rather than push, so the session decides when more is wanted and a cancellation between
   * two chunks is honoured at the next one rather than after the whole file has gone.
   */
  #readMore() {
    if (this.finished) return;
    if (this.handle === null) this.handle = fs.openSync(this.filePath, 'r');

    const buffer = Buffer.alloc(CHUNK);
    const read = fs.readSync(this.handle, buffer, 0, CHUNK, null);
    if (read === 0) {
      fs.closeSync(this.handle);
      this.handle = null;
      this.#run(EVENT.fileChunkRead(Buffer.alloc(0)));
      return;
    }
    const bytes = buffer.subarray(0, read);
    this.sent += BigInt(read);
    this.emit('progress', { sent: this.sent, total: this.offerMessage.totalBytes });
    this.#run(EVENT.fileChunkRead(bytes));
  }

  #failLocally(error) {
    // A socket error is this machine's news, not the peer's. There is nobody to tell.
    this.#finish(error.code === 'ECONNREFUSED' ? PROBLEM.NETWORK : PROBLEM.CONNECTION_LOST);
  }

  #failWith(problem) {
    if (this.connection) this.connection.send(protocol.TYPE_ABORT, messages.Abort.encode({ problem }));
    this.#finish(problem);
  }

  #finish(problem, importProblem = null) {
    if (this.finished) return;
    this.finished = true;
    if (this.handle !== null) {
      try {
        fs.closeSync(this.handle);
      } catch {
        // Already closed, or never opened. Nothing to report and nothing to do.
      }
      this.handle = null;
    }
    if (this.connection) this.connection.close();
    this.emit(
      'finished',
      problem ? { problem, problemName: problemName(problem), importProblem } : null,
    );
  }
}

module.exports = { NearbySender, CHUNK };
