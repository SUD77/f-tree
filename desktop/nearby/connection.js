/*
 * One TCP connection, and the moment it stops being readable by anyone watching.
 *
 * The first four frames are plaintext -- they are the key agreement, so they have to be -- and
 * every frame after them is sealed. This class owns that switch, the two counters the sealing
 * depends on, and nothing else: it does not decide what to send, when to send it, or whether the
 * person at the other end should be trusted. Those live in `session.js`, which owns no socket.
 *
 * The split is the same one the Kotlin makes, and it exists so that the part that can be *wrong*
 * is not tangled with the part that can be *slow*.
 */

const { FrameReader, encodeFrame } = require('./frame');
const framecrypto = require('./framecrypto');
const protocol = require('./protocol');
const { NearbyFailure, PROBLEM } = require('./problems');

/**
 * Wraps a `net.Socket`.
 *
 * `sendDirection` is this end's direction constant and `receiveDirection` the peer's. They differ
 * on the two sides of one connection, which is what keeps the two counters in separate nonce
 * spaces -- without it both ends would encrypt their first frame under the same key and the same
 * nonce, and GCM would leak the authentication key rather than merely one message.
 */
class Connection {
  constructor(socket, { sendDirection, receiveDirection }) {
    this.socket = socket;
    this.sendDirection = sendDirection;
    this.receiveDirection = receiveDirection;

    this.reader = new FrameReader();
    this.keys = null;
    this.sendSequence = 0n;
    this.receiveSequence = 0n;
    this.openedOne = false;

    /** Every handshake frame, verbatim, in the order it crossed the wire. */
    this.transcript = null;
    this.closed = false;
  }

  /** Called once the key agreement is done. Everything after this is sealed. */
  secure(keys, transcript) {
    this.keys = keys;
    this.transcript = transcript;
  }

  get secured() {
    return this.keys !== null;
  }

  /**
   * A frame out.
   *
   * Before `secure`, plaintext and recorded in the transcript. After it, sealed under the next
   * sequence number, which is never transmitted -- both sides count, and a side that lost count
   * produces a tag the other cannot verify, which is the detection rather than the bug.
   */
  send(type, payload = Buffer.alloc(0), transcriptHash = null) {
    if (this.closed) return;
    if (!this.secured) {
      const frame = encodeFrame(type, payload);
      if (transcriptHash) transcriptHash.add(frame);
      this.socket.write(frame);
      return;
    }
    const sealed = framecrypto.seal(
      this.keys.senderKey,
      this.sendDirection,
      this.sendSequence,
      type,
      payload,
    );
    this.sendSequence += 1n;
    this.socket.write(encodeFrame(type, sealed));
  }

  /**
   * Frames in, from one chunk of whatever size the network felt like.
   *
   * Yields `{ type, payload }` objects with the payload already opened. A frame that will not open
   * is fatal and throws: either the key is wrong -- a stale code, or somebody in between -- or the
   * bytes were altered, and there is nothing a retry could fix in either case.
   *
   * A generator, one frame at a time, and that is load-bearing. The keys arrive *inside* this
   * stream: the caller handles KEY_ACK and only then calls `secure()`. Opened all at once, a chunk
   * holding KEY_ACK and the sealed frame after it -- a receiver that cancels the moment the digits
   * appear sends exactly that, and TCP may deliver both in one read -- read the second as plaintext,
   * and the sender reported a random byte of ciphertext as its reason: "the other device stopped",
   * instead of "they cancelled". Pulled lazily, each frame is judged under the keys the caller has
   * installed by the time it is reached.
   */
  *feed(chunk, transcriptHash = null) {
    for (const frame of this.reader.feed(chunk)) {
      if (!this.secured) {
        if (transcriptHash) transcriptHash.add(encodeFrame(frame.type, frame.payload));
        yield frame;
        continue;
      }
      // The first sealed frame is the one that tells a stale pairing from a broken connection, and
      // the two need different sentences on screen.
      const firstFrame = !this.openedOne;
      let payload;
      try {
        payload = framecrypto.open(
          this.keys.receiverKey,
          this.receiveDirection,
          this.receiveSequence,
          frame.type,
          frame.payload,
          firstFrame,
        );
      } catch (error) {
        throw new NearbyFailure(
          error.message === 'BAD_PAIRING' ? PROBLEM.BAD_PAIRING : PROBLEM.DECRYPT_FAILED,
        );
      }
      this.openedOne = true;
      this.receiveSequence += 1n;
      yield { type: frame.type, payload };
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.socket.end();
  }

  destroy() {
    this.closed = true;
    this.socket.destroy();
  }
}

/**
 * Refuses a frame type this build does not know, before the session ever sees it.
 *
 * Fatal, never skipped, and the reserved range is refused by name rather than by falling through.
 * Skipping an unrecognised frame in an encrypted stream consumes a sequence number whose meaning is
 * unknown -- which is exactly how a downgrade gets smuggled past a version check. The reserved
 * range belongs to a merge-sync conversation that does not exist yet; a version 1 build must refuse
 * it rather than treat it as noise.
 */
const KNOWN_TYPES = new Set([
  protocol.TYPE_HELLO,
  protocol.TYPE_HELLO_ACK,
  protocol.TYPE_KEY,
  protocol.TYPE_KEY_ACK,
  protocol.TYPE_OFFER,
  protocol.TYPE_ACCEPT,
  protocol.TYPE_DECLINE,
  protocol.TYPE_DATA,
  protocol.TYPE_END,
  protocol.TYPE_RESULT,
  protocol.TYPE_ABORT,
]);

function checkType(type) {
  if (!KNOWN_TYPES.has(type)) throw new NearbyFailure(PROBLEM.UNEXPECTED_MESSAGE);
}

module.exports = { Connection, checkType, KNOWN_TYPES };
