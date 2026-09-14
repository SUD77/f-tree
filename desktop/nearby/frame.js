/*
 * `length(4) || type(1) || payload`, and the ceiling that stops a stranger on the network
 * exhausting this process's memory.
 *
 * A port of `nearby/wire/Frame.kt`.
 */

const protocol = require('./protocol');

/**
 * `length` counts the type byte and the payload, not itself, so a reader holding the header knows
 * exactly how much more to wait for.
 */
function encodeFrame(type, payload) {
  const body = Buffer.from(payload);
  if (body.length > protocol.MAX_FRAME_BODY - 1) {
    throw new Error(`frame payload too large: ${body.length}`);
  }
  const out = Buffer.alloc(protocol.FRAME_HEADER_SIZE + body.length);
  out.writeUInt32BE(1 + body.length, 0);
  out.writeUInt8(type, 4);
  body.copy(out, protocol.FRAME_HEADER_SIZE);
  return out;
}

/**
 * Frames out of a stream that arrives in whatever sizes the network felt like.
 *
 * Incremental and pure: fed buffers, yields whole frames, owns no socket. That is what makes the
 * awkward cases -- a header split across two reads, a body arriving a byte at a time, a length that
 * is a lie -- testable with `node --test` rather than only against a real connection.
 */
class FrameReader {
  constructor() {
    this.buffer = Buffer.alloc(0);
  }

  /**
   * Adds a chunk and returns every frame that is now complete.
   *
   * Throws on a claimed length past the ceiling. Fatal by design: the length prefix is the one
   * field read before anything is allocated, so it is the one field a stranger can use to exhaust
   * memory. There is nothing to recover to, because the next bytes are at an offset the reader can
   * no longer find.
   *
   * `readUInt32BE` is unsigned, so `0xFFFFFFFF` arrives here as four billion and is refused. The
   * Kotlin has to reach for a Long and an explicit mask to get the same answer; as an Int it would
   * be -1, which is smaller than the ceiling and would sail straight past this check.
   */
  feed(chunk) {
    this.buffer = this.buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.buffer, chunk]);

    const frames = [];
    let offset = 0;
    for (;;) {
      if (this.buffer.length - offset < protocol.FRAME_HEADER_SIZE) break;

      const body = this.buffer.readUInt32BE(offset);
      if (body < 1 || body > protocol.MAX_FRAME_BODY) throw new Error('FRAME_TOO_LARGE');

      const total = protocol.FRAME_HEADER_SIZE + (body - 1);
      if (this.buffer.length - offset < total) break;

      frames.push({
        type: this.buffer.readUInt8(offset + 4),
        payload: Buffer.from(this.buffer.subarray(offset + protocol.FRAME_HEADER_SIZE, offset + total)),
      });
      offset += total;
    }

    if (offset > 0) this.buffer = Buffer.from(this.buffer.subarray(offset));
    return frames;
  }

  /** Bytes held back because they are the start of a frame that has not finished arriving. */
  get pending() {
    return this.buffer.length;
  }
}

module.exports = { encodeFrame, FrameReader };
