/*
 * Where a transfer has got to, and what should happen next.
 *
 * A port of `nearby/wire/NearbySession.kt`.
 *
 * A pure fold: `(state, event) -> (state, actions)`. It owns no socket, no file and no clock -- the
 * caller supplies the time in a `tick` event. Everything that decides whether somebody's family
 * moves is therefore a function of its arguments, and testable with `node --test` rather than only
 * against a live connection.
 *
 * The rule worth stating separately, because it is a safety property and not a flow: **the sender
 * cannot reach SENDING without passing through CONFIRMING_CODE, unless the peer was reached by
 * scanning a QR.** A code that can be skipped by accident is a code that is not doing anything.
 */

const protocol = require('./protocol');
const { Hello, HelloAck, KeyMessage, Offer, End, Result, Abort } = require('./messages');
const { NearbyFailure, PROBLEM } = require('./problems');

const SENDER = {
  CONNECTING: 'connecting',
  AWAITING_HELLO_ACK: 'awaiting-hello-ack',
  AWAITING_KEY_ACK: 'awaiting-key-ack',
  CONFIRMING_CODE: 'confirming-code',
  AWAITING_ACCEPT: 'awaiting-accept',
  SENDING: 'sending',
  AWAITING_RESULT: 'awaiting-result',
  DONE: 'done',
  FAILED: 'failed',
};

const RECEIVER = {
  LISTENING: 'listening',
  AWAITING_HELLO: 'awaiting-hello',
  AWAITING_KEY: 'awaiting-key',
  AWAITING_OFFER: 'awaiting-offer',
  AWAITING_USER: 'awaiting-user',
  RECEIVING: 'receiving',
  VERIFYING: 'verifying',
  DONE: 'done',
  FAILED: 'failed',
};

/** The events a caller feeds in. Named the way the Kotlin's sealed interface is. */
const EVENT = {
  connected: () => ({ kind: 'connected' }),
  frame: (type, payload) => ({ kind: 'frame', type, payload }),
  userConfirmedCode: (matched) => ({ kind: 'user-confirmed-code', matched }),
  userAccepted: () => ({ kind: 'user-accepted' }),
  userDeclined: () => ({ kind: 'user-declined' }),
  userCancelled: () => ({ kind: 'user-cancelled' }),
  /** Bytes read from the file being sent. Empty means the file is finished. */
  fileChunkRead: (bytes) => ({ kind: 'file-chunk-read', bytes }),
  peerClosed: () => ({ kind: 'peer-closed' }),
  tick: (atMillis) => ({ kind: 'tick', atMillis }),
};

/** The actions a caller carries out. This module performs none of them. */
const ACTION = {
  sendFrame: (type, payload) => ({ kind: 'send-frame', type, payload }),
  /** Both screens should now show these six digits. */
  showCode: (sas) => ({ kind: 'show-code', sas }),
  showOffer: (offer) => ({ kind: 'show-offer', offer }),
  readMoreOfTheFile: () => ({ kind: 'read-more-of-the-file' }),
  writeChunk: (bytes) => ({ kind: 'write-chunk', bytes }),
  verifyAndHandOver: () => ({ kind: 'verify-and-hand-over' }),
  fail: (problem, importProblem = null) => ({ kind: 'fail', problem, importProblem }),
  close: () => ({ kind: 'close' }),
};

const EMPTY = Buffer.alloc(0);

/**
 * The sending half.
 *
 * `pairedByQr` is passed in rather than discovered, because it is the one thing that legitimately
 * removes a safety step and it should be visible at the point the session is constructed rather
 * than inferred halfway through a handshake.
 */
class SenderSession {
  constructor({ pairedByQr = false, hello, key, onHelloAck, onKeyAck, offer }) {
    this.state = SENDER.CONNECTING;
    this.pairedByQr = pairedByQr;
    this.hello = hello;
    this.key = key;
    this.onHelloAck = onHelloAck;
    this.onKeyAck = onKeyAck;
    this.offer = offer;
  }

  step(event) {
    if (this.state === SENDER.DONE || this.state === SENDER.FAILED) {
      return { state: this.state, actions: [] };
    }
    if (event.kind === 'user-cancelled') return this.#fail(PROBLEM.CANCELLED);
    if (event.kind === 'peer-closed') return this.#fail(PROBLEM.CONNECTION_LOST);

    try {
      switch (this.state) {
        case SENDER.CONNECTING:
          return this.#onConnecting(event);
        case SENDER.AWAITING_HELLO_ACK:
          return this.#onAwaitingHelloAck(event);
        case SENDER.AWAITING_KEY_ACK:
          return this.#onAwaitingKeyAck(event);
        case SENDER.CONFIRMING_CODE:
          return this.#onConfirmingCode(event);
        case SENDER.AWAITING_ACCEPT:
          return this.#onAwaitingAccept(event);
        case SENDER.SENDING:
          return this.#onSending(event);
        case SENDER.AWAITING_RESULT:
          return this.#onAwaitingResult(event);
        default:
          return { state: this.state, actions: [] };
      }
    } catch (error) {
      if (error instanceof NearbyFailure) return this.#fail(error.problem, error.importProblem);
      throw error;
    }
  }

  #onConnecting(event) {
    if (event.kind !== 'connected') return this.#ignore(event);
    this.state = SENDER.AWAITING_HELLO_ACK;
    return { state: this.state, actions: [ACTION.sendFrame(protocol.TYPE_HELLO, this.hello())] };
  }

  #onAwaitingHelloAck(event) {
    if (event.kind !== 'frame' || event.type !== protocol.TYPE_HELLO_ACK) return this.#ignore(event);
    this.onHelloAck(HelloAck.decode(event.payload));
    this.state = SENDER.AWAITING_KEY_ACK;
    return { state: this.state, actions: [ACTION.sendFrame(protocol.TYPE_KEY, this.key())] };
  }

  #onAwaitingKeyAck(event) {
    if (event.kind !== 'frame' || event.type !== protocol.TYPE_KEY_ACK) return this.#ignore(event);
    const sas = this.onKeyAck(KeyMessage.decode(event.payload));
    if (this.pairedByQr) {
      // The token in the code already proved both directions. There is nothing left for a person
      // to check, and asking them to check nothing teaches them to click through.
      this.state = SENDER.AWAITING_ACCEPT;
      return { state: this.state, actions: [this.#sendOffer()] };
    }
    this.state = SENDER.CONFIRMING_CODE;
    return { state: this.state, actions: [ACTION.showCode(sas)] };
  }

  #onConfirmingCode(event) {
    if (event.kind !== 'user-confirmed-code') return this.#ignore(event);
    if (!event.matched) return this.#fail(PROBLEM.CODES_DID_NOT_MATCH);
    this.state = SENDER.AWAITING_ACCEPT;
    return { state: this.state, actions: [this.#sendOffer()] };
  }

  #onAwaitingAccept(event) {
    if (event.kind !== 'frame') return this.#ignore(event);
    if (event.type === protocol.TYPE_ACCEPT) {
      this.state = SENDER.SENDING;
      return { state: this.state, actions: [ACTION.readMoreOfTheFile()] };
    }
    if (event.type === protocol.TYPE_DECLINE) return this.#fail(PROBLEM.DECLINED);
    return this.#ignore(event);
  }

  #onSending(event) {
    if (event.kind !== 'file-chunk-read') return this.#ignore(event);
    if (event.bytes.length > 0) {
      return {
        state: this.state,
        actions: [
          ACTION.sendFrame(protocol.TYPE_DATA, event.bytes),
          ACTION.readMoreOfTheFile(),
        ],
      };
    }
    this.state = SENDER.AWAITING_RESULT;
    const summary = this.offer();
    return {
      state: this.state,
      actions: [
        ACTION.sendFrame(
          protocol.TYPE_END,
          End.encode({ bytesSent: summary.totalBytes, sha256: summary.sha256 }),
        ),
      ],
    };
  }

  #onAwaitingResult(event) {
    if (event.kind !== 'frame' || event.type !== protocol.TYPE_RESULT) return this.#ignore(event);
    const result = Result.decode(event.payload);
    if (!result.accepted) return this.#fail(PROBLEM.IMPORT_REFUSED, result.importProblem);
    this.state = SENDER.DONE;
    return { state: this.state, actions: [ACTION.close()] };
  }

  #sendOffer() {
    return ACTION.sendFrame(protocol.TYPE_OFFER, Offer.encode(this.offer()));
  }

  /**
   * Anything that is not expected here ends the connection.
   *
   * Never skipped, and that is the whole of it: ignoring an unrecognised frame in an encrypted
   * stream means consuming a sequence number whose meaning is unknown, which is exactly how a
   * downgrade is smuggled past a version check. A tick is the one thing that may pass through
   * untouched, because the caller sends it constantly and it says nothing.
   */
  #ignore(event) {
    if (event.kind === 'tick') return { state: this.state, actions: [] };
    return this.#fail(PROBLEM.UNEXPECTED_MESSAGE);
  }

  #fail(problem, importProblem = null) {
    const wasLive = this.state !== SENDER.CONNECTING;
    this.state = SENDER.FAILED;
    const actions = [];
    if (wasLive) actions.push(ACTION.sendFrame(protocol.TYPE_ABORT, Abort.encode({ problem })));
    actions.push(ACTION.fail(problem, importProblem), ACTION.close());
    return { state: this.state, actions };
  }
}

/** The receiving half. Consent lives here, which is why this side is the one that advertises. */
class ReceiverSession {
  constructor({ busy = false, helloAck, keyAck, acceptable }) {
    this.state = RECEIVER.LISTENING;
    this.busy = busy;
    this.helloAck = helloAck;
    this.keyAck = keyAck;
    this.acceptable = acceptable;
    this.offer = null;
  }

  step(event) {
    if (this.state === RECEIVER.DONE || this.state === RECEIVER.FAILED) {
      return { state: this.state, actions: [] };
    }
    if (event.kind === 'user-cancelled') return this.#fail(PROBLEM.CANCELLED);
    if (event.kind === 'peer-closed' && this.state !== RECEIVER.LISTENING) {
      return this.#fail(PROBLEM.CONNECTION_LOST);
    }

    try {
      switch (this.state) {
        case RECEIVER.LISTENING:
          return this.#onListening(event);
        case RECEIVER.AWAITING_HELLO:
          return this.#onAwaitingHello(event);
        case RECEIVER.AWAITING_KEY:
          return this.#onAwaitingKey(event);
        case RECEIVER.AWAITING_OFFER:
          return this.#onAwaitingOffer(event);
        case RECEIVER.AWAITING_USER:
          return this.#onAwaitingUser(event);
        case RECEIVER.RECEIVING:
          return this.#onReceiving(event);
        default:
          return { state: this.state, actions: [] };
      }
    } catch (error) {
      if (error instanceof NearbyFailure) return this.#fail(error.problem, error.importProblem);
      throw error;
    }
  }

  #onListening(event) {
    if (event.kind !== 'connected') return this.#ignore(event);
    // Accepted only far enough to say so. A refusal somebody can read beats a hang.
    if (this.busy) return this.#fail(PROBLEM.BUSY);
    this.state = RECEIVER.AWAITING_HELLO;
    return { state: this.state, actions: [] };
  }

  #onAwaitingHello(event) {
    if (event.kind !== 'frame' || event.type !== protocol.TYPE_HELLO) return this.#ignore(event);
    const reply = this.helloAck(Hello.decode(event.payload));
    this.state = RECEIVER.AWAITING_KEY;
    return { state: this.state, actions: [ACTION.sendFrame(protocol.TYPE_HELLO_ACK, reply)] };
  }

  #onAwaitingKey(event) {
    if (event.kind !== 'frame' || event.type !== protocol.TYPE_KEY) return this.#ignore(event);
    const { reply, sas } = this.keyAck(KeyMessage.decode(event.payload));
    this.state = RECEIVER.AWAITING_OFFER;
    return {
      state: this.state,
      actions: [ACTION.sendFrame(protocol.TYPE_KEY_ACK, reply), ACTION.showCode(sas)],
    };
  }

  #onAwaitingOffer(event) {
    if (event.kind !== 'frame' || event.type !== protocol.TYPE_OFFER) return this.#ignore(event);
    const incoming = Offer.decode(event.payload);
    const refusal = this.acceptable(incoming);
    if (refusal !== null && refusal !== undefined) {
      // Refused on size or space before a byte moves, which is the reason the offer carries a
      // length at all.
      return this.#declineWith(refusal);
    }
    this.offer = incoming;
    this.state = RECEIVER.AWAITING_USER;
    return { state: this.state, actions: [ACTION.showOffer(incoming)] };
  }

  #onAwaitingUser(event) {
    if (event.kind === 'user-accepted') {
      this.state = RECEIVER.RECEIVING;
      return { state: this.state, actions: [ACTION.sendFrame(protocol.TYPE_ACCEPT, EMPTY)] };
    }
    if (event.kind === 'user-declined') return this.#declineWith(PROBLEM.DECLINED);
    if (event.kind === 'user-confirmed-code') {
      return event.matched
        ? { state: this.state, actions: [] }
        : this.#fail(PROBLEM.CODES_DID_NOT_MATCH);
    }
    return this.#ignore(event);
  }

  #onReceiving(event) {
    if (event.kind !== 'frame') return this.#ignore(event);
    if (event.type === protocol.TYPE_DATA) {
      return { state: this.state, actions: [ACTION.writeChunk(event.payload)] };
    }
    if (event.type === protocol.TYPE_END) {
      this.state = RECEIVER.VERIFYING;
      return { state: this.state, actions: [ACTION.verifyAndHandOver()] };
    }
    return this.#ignore(event);
  }

  /**
   * The bytes are whole and the importer has looked at them. Called by the caller, not by an
   * event, because verifying touches a file and this class touches nothing.
   */
  verified(importProblem = null) {
    if (this.state !== RECEIVER.VERIFYING) return { state: this.state, actions: [] };
    this.state = RECEIVER.DONE;
    return {
      state: this.state,
      actions: [
        ACTION.sendFrame(
          protocol.TYPE_RESULT,
          Result.encode({ accepted: importProblem === null, importProblem }),
        ),
        ACTION.close(),
      ],
    };
  }

  /** What arrived is not what was sent. Nothing is handed to the importer. */
  contentMismatch() {
    return this.#fail(PROBLEM.CONTENT_MISMATCH);
  }

  #declineWith(problem) {
    this.state = RECEIVER.FAILED;
    return {
      state: this.state,
      actions: [
        ACTION.sendFrame(protocol.TYPE_DECLINE, Buffer.from([problem & 0xff])),
        ACTION.fail(problem),
        ACTION.close(),
      ],
    };
  }

  #ignore(event) {
    if (event.kind === 'tick') return { state: this.state, actions: [] };
    return this.#fail(PROBLEM.UNEXPECTED_MESSAGE);
  }

  #fail(problem, importProblem = null) {
    this.state = RECEIVER.FAILED;
    return {
      state: this.state,
      actions: [
        ACTION.sendFrame(protocol.TYPE_ABORT, Abort.encode({ problem })),
        ACTION.fail(problem, importProblem),
        ACTION.close(),
      ],
    };
  }
}

module.exports = { SENDER, RECEIVER, EVENT, ACTION, SenderSession, ReceiverSession };
