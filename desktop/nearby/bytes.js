/*
 * Reading and writing the fixed binary layouts in `docs/nearby-protocol.md`.
 *
 * A port of `nearby/wire/Bytes.kt`.
 *
 * Fixed binary rather than JSON, for one reason that matters: these bytes feed a transcript hash,
 * and JSON key order is not a contract. Two implementations that serialise the same fields in a
 * different order would hash to different values, derive different keys, and show two different
 * six-digit codes -- and the people holding the devices would conclude they were being attacked.
 * Offsets cannot drift the way key order can.
 *
 * Everything is big-endian. A read past the end raises `MALFORMED_FRAME` rather than returning
 * whatever a Buffer read returns for an out-of-range offset, because every one of these buffers
 * arrived from somebody else's device and a truncated message is a thing that happens rather than
 * a bug.
 */

const protocol = require('./protocol');
const { NearbyFailure, PROBLEM } = require('./problems');

class ByteWriter {
  constructor() {
    this.chunks = [];
  }

  u8(value) {
    const b = Buffer.alloc(1);
    b.writeUInt8(value & 0xff, 0);
    this.chunks.push(b);
    return this;
  }

  u16(value) {
    const b = Buffer.alloc(2);
    b.writeUInt16BE(value & 0xffff, 0);
    this.chunks.push(b);
    return this;
  }

  u32(value) {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(value >>> 0, 0);
    this.chunks.push(b);
    return this;
  }

  /**
   * A BigInt, always.
   *
   * The Kotlin writes this field from a `Long`. A `Number` here would agree with it for every
   * value anybody tests by hand and disagree above 2^53, which is why `vectors.txt` carries a
   * sequence at exactly that boundary.
   */
  u64(value) {
    const b = Buffer.alloc(8);
    b.writeBigUInt64BE(BigInt.asUintN(64, BigInt(value)), 0);
    this.chunks.push(b);
    return this;
  }

  bytes(value) {
    this.chunks.push(Buffer.from(value));
    return this;
  }

  /** A UTF-8 string behind a single-byte length. Callers truncate first; this refuses to guess. */
  lengthPrefixed(value, max) {
    const b = Buffer.from(value);
    if (b.length > max) throw new Error(`string too long: ${b.length} > ${max}`);
    return this.u8(b.length).bytes(b);
  }

  toBuffer() {
    return Buffer.concat(this.chunks);
  }
}

class ByteReader {
  constructor(buffer) {
    this.buffer = Buffer.from(buffer);
    this.offset = 0;
  }

  get remaining() {
    return this.buffer.length - this.offset;
  }

  #need(count) {
    if (this.remaining < count) throw new NearbyFailure(PROBLEM.MALFORMED_FRAME);
  }

  u8() {
    this.#need(1);
    return this.buffer.readUInt8(this.offset++);
  }

  u16() {
    this.#need(2);
    const value = this.buffer.readUInt16BE(this.offset);
    this.offset += 2;
    return value;
  }

  u32() {
    this.#need(4);
    const value = this.buffer.readUInt32BE(this.offset);
    this.offset += 4;
    return value;
  }

  /** Returns a BigInt. See the note on `ByteWriter.u64`. */
  u64() {
    this.#need(8);
    const value = this.buffer.readBigUInt64BE(this.offset);
    this.offset += 8;
    return value;
  }

  bytes(count) {
    this.#need(count);
    const out = Buffer.from(this.buffer.subarray(this.offset, this.offset + count));
    this.offset += count;
    return out;
  }

  lengthPrefixed() {
    return this.bytes(this.u8());
  }

  /**
   * Trailing bytes are not an error.
   *
   * A later version may append fields to a message this one already understands, and refusing a
   * message because it is longer than expected would make every such addition a breaking change.
   * The rule is: read what you know, ignore the rest.
   */
  ignoreRest() {
    this.offset = this.buffer.length;
  }
}

/** Constant-time comparison, for anything an attacker gets to guess one byte at a time. */
function equalBytes(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x[i] ^ y[i];
  return diff === 0;
}

module.exports = { ByteWriter, ByteReader, equalBytes, MAX_NAME: protocol.BEACON_MAX_NAME_BYTES };
