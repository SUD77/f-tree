/*
 * The receiving end: a TCP server, one transfer at a time.
 *
 * The receiver is the side that advertises and the side that consents, and those are the same fact
 * -- "who can see me" is naturally a property of the machine that has to say yes. It is therefore
 * also the server, which keeps the roles fixed and the state machine small.
 *
 * Nothing here decides anything. It moves bytes, runs the key agreement, and hands every decision
 * to `ReceiverSession`, which owns no socket and is tested without one.
 */

const net = require('node:net');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

const protocol = require('./protocol');
const dh = require('./dh');
const handshake = require('./handshake');
const negotiation = require('./negotiation');
const messages = require('./messages');
const beacon = require('./beacon');
const { Connection, checkType } = require('./connection');
const { encodeFrame } = require('./frame');
const { ReceiverSession, EVENT } = require('./session');
const { NearbyFailure, PROBLEM, problemName } = require('./problems');

/**
 * Accepts one transfer at a time.
 *
 * A second connection is accepted only far enough to be told `ABORT(BUSY)` and then closed. That
 * costs a socket for a few milliseconds and buys a sentence the person on the other machine can
 * read, instead of a connection that hangs until it times out and a screen that says nothing.
 */
class NearbyServer extends EventEmitter {
  constructor({ identity, beaconKey, sink, maxOfferBytes = protocol.MAX_OFFER_BYTES }) {
    super();
    this.identity = identity;
    this.beaconKey = beaconKey;
    this.sink = sink;
    this.maxOfferBytes = maxOfferBytes;
    this.server = null;
    this.active = null;
    this.port = 0;
  }

  /**
   * Binds on an ephemeral port and advertises it in the beacon.
   *
   * Binding lazily -- only when visibility is switched on -- rather than at launch is what puts the
   * macOS Local Network prompt and the Windows Firewall prompt at the moment the person understands
   * what they are being asked, instead of the first time they open the app.
   */
  listen(host = '0.0.0.0') {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => this.#accept(socket));
      this.server.once('error', reject);
      this.server.listen(0, host, () => {
        this.port = this.server.address().port;
        resolve(this.port);
      });
    });
  }

  close() {
    if (this.active) {
      this.active.connection.destroy();
      this.active = null;
    }
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  #accept(socket) {
    const busy = this.active !== null;
    const transfer = new IncomingTransfer({
      socket,
      identity: this.identity,
      beaconKey: this.beaconKey,
      sink: this.sink,
      maxOfferBytes: this.maxOfferBytes,
      busy,
    });

    if (!busy) {
      this.active = transfer;
      transfer.once('finished', () => {
        if (this.active === transfer) this.active = null;
      });
      this.emit('transfer', transfer);
    }
    transfer.start();
  }
}

/** One incoming connection, from the socket opening to the file being handed over. */
class IncomingTransfer extends EventEmitter {
  constructor({ socket, identity, beaconKey, sink, maxOfferBytes, busy }) {
    super();
    this.socket = socket;
    this.identity = identity;
    this.beaconKey = beaconKey;
    this.sink = sink;
    this.maxOfferBytes = maxOfferBytes;

    this.connection = new Connection(socket, {
      sendDirection: protocol.DIRECTION_RECEIVER_TO_SENDER,
      receiveDirection: protocol.DIRECTION_SENDER_TO_RECEIVER,
    });
    this.transcript = new handshake.TranscriptHash();
    this.nonce = crypto.randomBytes(protocol.HANDSHAKE_NONCE_BYTES);
    this.peerNonce = null;
    this.peerHello = null;
    this.sas = null;
    this.offer = null;
    this.received = 0n;
    this.digest = crypto.createHash('sha256');
    this.finished = false;
    /**
     * The token on the receiver's screen, set by the caller while a QR is showing. It is used only
     * for a connection whose HELLO says it scanned one; `onTokenUsed` is called when one does, and
     * the token is then spent.
     */
    this.pairingToken = handshake.NO_TOKEN;
    this.onTokenUsed = () => {};
    this.activeToken = handshake.NO_TOKEN;

    this.session = new ReceiverSession({
      busy,
      helloAck: (hello) => this.#onHello(hello),
      keyAck: (key) => this.#onKey(key),
      acceptable: (offer) => this.#acceptable(offer),
    });
  }

  start() {
    this.socket.on('data', (chunk) => this.#onData(chunk));
    this.socket.on('error', () => this.#finish(PROBLEM.CONNECTION_LOST));
    this.socket.on('close', () => this.#run(EVENT.peerClosed()));
    // One idle timeout for the whole connection, set to the longest legitimate pause in it: the
    // time somebody may take to read the prompt and decide. A handshake-length timeout would be
    // tighter but would fire while a person was still reading, which is a bug that only shows up
    // for the users who read carefully.
    this.socket.setTimeout(protocol.USER_DECISION_TIMEOUT_MS, () => {
      this.#failWith(PROBLEM.TIMED_OUT);
    });
    this.#run(EVENT.connected());
  }

  /** The person at this screen said yes. */
  accept() {
    this.#run(EVENT.userAccepted());
  }

  decline() {
    this.#run(EVENT.userDeclined());
  }

  /**
   * The person at this screen stopped it at a moment that was not a question -- the codes on
   * screen, or the bytes arriving. The session already answers `user-cancelled` in every state with
   * `ABORT(CANCELLED)`, which the sender can put into words; a decline sent here instead would reach
   * it as a message out of place.
   */
  cancel() {
    this.#run(EVENT.userCancelled());
  }

  /**
   * This side cannot carry on for a reason of its own -- the disk it is writing to filled, say --
   * and the sender is told which, rather than left to time out on a receiver that went quiet.
   */
  stopBecause(problem) {
    if (!this.finished) this.#failWith(problem);
  }

  #onData(chunk) {
    try {
      for (const frame of this.connection.feed(chunk, this.transcript)) {
        checkType(frame.type);
        if (frame.type === protocol.TYPE_ABORT) {
          this.#finish(messages.Abort.decode(frame.payload).problem);
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

  #onHello(hello) {
    // Version and format are both settled here, in the first exchange, so a file that is too new
    // for this build is refused before four megabytes of somebody's family crosses a room.
    const chosen = negotiation.chooseVersion(hello.maxVersion, hello.minVersion);
    negotiation.verifyTreeFormat(messages.TREE_FORMAT_VERSION, hello.treeFormatMax);
    this.peerHello = hello;
    this.chosenVersion = chosen;

    // The token is for the connections that say they scanned it, and only those. Applied to every
    // connection, a sender that picked this device from a list -- and so knows no token -- would
    // derive a different key and fail as if it were an impostor.
    if (hello.flags & protocol.FLAG_PAIRED_BY_QR) {
      if (this.pairingToken.equals(handshake.NO_TOKEN)) throw new NearbyFailure(PROBLEM.BAD_PAIRING);
      this.activeToken = this.pairingToken;
      this.onTokenUsed();
    }
    this.negotiatedFlags = negotiation.negotiateFlags(hello.flags, protocol.SUPPORTED_FLAGS);

    return messages.HelloAck.encode({
      chosenVersion: chosen,
      platform: beacon.thisPlatform(),
      flags: this.negotiatedFlags,
      deviceId: this.identity.deviceId,
      displayName: this.identity.displayName,
      // The promise of what KEY_ACK will carry, made before the sender's key has been seen.
      keyCommitment: handshake.keyCommitment(this.beaconKey.publicKey, this.nonce),
    });
  }

  #onKey(key) {
    const peerPublic = dh.fromBytes(key.publicKey);
    // Refused before it is used for anything. A peer sending 1 would otherwise force a shared
    // secret of 1, and every later frame would be encrypted under a key it chose.
    const shared = dh.sharedSecret(this.beaconKey.privateKey, peerPublic);
    this.peerNonce = key.nonce;

    const reply = messages.KeyMessage.encode({
      publicKey: dh.to256(this.beaconKey.publicKey),
      nonce: this.nonce,
    });

    // KEY_ACK goes into the transcript here rather than when it is written, because the derivation
    // below needs the completed transcript and the sender -- which hashes this frame as it arrives
    // -- has it in exactly this position. `#perform` therefore sends this one frame without
    // hashing it again.
    this.transcript.add(encodeFrame(protocol.TYPE_KEY_ACK, reply));
    const transcriptValue = this.transcript.value();

    const prk = handshake.extract(transcriptValue, this.activeToken, shared);
    const keys = handshake.deriveKeys(prk);
    this.sas = keys.sas;
    this.pendingKeys = {
      senderKey: keys.receiverToSender,
      receiverKey: keys.senderToReceiver,
    };
    this.transcriptValue = transcriptValue;

    return { reply, sas: keys.sas };
  }

  #acceptable(offer) {
    if (offer.totalBytes > BigInt(this.maxOfferBytes)) return PROBLEM.TOO_LARGE;
    if (offer.treeFormatVersion > messages.TREE_FORMAT_VERSION) return PROBLEM.TREE_FORMAT_TOO_NEW;
    this.offer = offer;
    return null;
  }

  #run(event) {
    if (this.finished) return;
    const { actions } = this.session.step(event);
    for (const action of actions) this.#perform(action);
  }

  #perform(action) {
    switch (action.kind) {
      case 'send-frame': {
        // KEY_ACK was already hashed in `#onKey`, where the derivation needed it.
        const hashed = action.type === protocol.TYPE_KEY_ACK;
        this.connection.send(action.type, action.payload, hashed ? null : this.transcript);
        // And it is the last plaintext frame. Everything after it is sealed.
        if (hashed) this.connection.secure(this.pendingKeys, this.transcriptValue);
        break;
      }
      case 'show-code':
        this.emit('code', action.sas);
        break;
      case 'show-offer':
        this.emit('offer', action.offer);
        break;
      case 'write-chunk':
        this.received += BigInt(action.bytes.length);
        this.digest.update(action.bytes);
        // Never into a stream that is closing. Once a transfer has ended the caller destroys the
        // `.part` to remove it, and a write handed to a destroyed stream fails asynchronously -- as
        // an 'error' event, after this frame is long gone.
        if (this.sink && !this.sink.destroyed && !this.sink.writableEnded) this.sink.write(action.bytes);
        this.emit('progress', { received: this.received, total: this.offer?.totalBytes ?? 0n });
        break;
      case 'verify-and-hand-over':
        this.#verify();
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
   * What arrived against what was promised, before anything reaches the importer.
   *
   * Both halves matter and for different reasons. The length catches a truncated transfer; the
   * digest catches a corrupted one. Neither is a security check -- an attacker who could alter the
   * stream would also alter the OFFER -- they are there so that a half-written file is never handed
   * to the code that reads somebody's family.
   */
  #verify() {
    const actual = this.digest.digest();
    const lengthMatches = this.received === this.offer.totalBytes;
    const digestMatches = actual.equals(this.offer.sha256);
    if (!lengthMatches || !digestMatches) {
      const { actions } = this.session.contentMismatch();
      for (const action of actions) this.#perform(action);
      return;
    }
    this.emit('complete', {
      bytes: this.received,
      suggestedFileName: this.offer.suggestedFileName,
      sha256: actual,
    });
  }

  /** Called by the caller once the importer has looked at the file. */
  verified(importProblem = null) {
    const { actions } = this.session.verified(importProblem);
    for (const action of actions) this.#perform(action);
    this.#finish(null, importProblem);
  }

  #failWith(problem) {
    this.connection.send(protocol.TYPE_ABORT, messages.Abort.encode({ problem }));
    this.#finish(problem);
  }

  #finish(problem, importProblem = null) {
    if (this.finished) return;
    this.finished = true;
    this.connection.close();
    this.emit('finished', problem ? { problem, problemName: problemName(problem), importProblem } : null);
  }
}

module.exports = { NearbyServer, IncomingTransfer };
