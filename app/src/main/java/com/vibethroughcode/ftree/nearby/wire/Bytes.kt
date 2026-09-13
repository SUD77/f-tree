package com.vibethroughcode.ftree.nearby.wire

/**
 * Reading and writing the fixed binary layouts in `docs/nearby-protocol.md`.
 *
 * Fixed binary rather than JSON, for one reason that matters: these bytes feed a transcript hash,
 * and JSON key order is not a contract. Two implementations that serialise the same fields in a
 * different order would hash to different values, derive different keys, and show two different
 * six-digit codes — and the people holding the phones would conclude they were being attacked.
 * Offsets cannot drift the way key order can.
 *
 * Everything is big-endian. A read past the end is [NearbyProblem.MALFORMED_FRAME] rather than an
 * `IndexOutOfBoundsException`, because every one of these buffers arrived from somebody else's
 * device and a truncated message is a thing that happens rather than a bug.
 */
internal class ByteWriter(initialCapacity: Int = 64) {
    private var buffer = ByteArray(initialCapacity)
    private var size = 0

    private fun room(extra: Int) {
        if (size + extra <= buffer.size) return
        var capacity = maxOf(buffer.size * 2, 16)
        while (capacity < size + extra) capacity *= 2
        buffer = buffer.copyOf(capacity)
    }

    fun u8(value: Int): ByteWriter {
        room(1)
        buffer[size++] = value.toByte()
        return this
    }

    fun u16(value: Int): ByteWriter {
        room(2)
        buffer[size++] = (value ushr 8).toByte()
        buffer[size++] = value.toByte()
        return this
    }

    fun u32(value: Int): ByteWriter {
        room(4)
        for (shift in intArrayOf(24, 16, 8, 0)) buffer[size++] = (value ushr shift).toByte()
        return this
    }

    fun u64(value: Long): ByteWriter {
        room(8)
        for (shift in intArrayOf(56, 48, 40, 32, 24, 16, 8, 0)) {
            buffer[size++] = (value ushr shift).toByte()
        }
        return this
    }

    fun bytes(value: ByteArray): ByteWriter {
        room(value.size)
        value.copyInto(buffer, size)
        size += value.size
        return this
    }

    /** A UTF-8 string behind a single-byte length. Callers truncate first; this refuses to guess. */
    fun lengthPrefixed(value: ByteArray, max: Int): ByteWriter {
        require(value.size <= max) { "string too long: ${value.size} > $max" }
        return u8(value.size).bytes(value)
    }

    fun toByteArray(): ByteArray = buffer.copyOf(size)
}

internal class ByteReader(private val buffer: ByteArray) {
    var offset = 0
        private set

    val remaining: Int get() = buffer.size - offset

    private fun need(count: Int) {
        if (remaining < count) throw NearbyFailure(NearbyProblem.MALFORMED_FRAME)
    }

    fun u8(): Int {
        need(1)
        return buffer[offset++].toInt() and 0xFF
    }

    fun u16(): Int {
        need(2)
        return (u8() shl 8) or u8()
    }

    fun u32(): Int {
        need(4)
        return (u8() shl 24) or (u8() shl 16) or (u8() shl 8) or u8()
    }

    /**
     * A Long, because these are lengths and counters that a peer chooses.
     *
     * The desktop side reads the same field with `readBigUInt64BE` into a `BigInt`. Neither may use
     * a type that loses the top bits, which is why the vectors include sequence 2^53: a JavaScript
     * `Number` passes every smaller case and fails that one.
     */
    fun u64(): Long {
        need(8)
        var value = 0L
        repeat(8) { value = (value shl 8) or (buffer[offset++].toLong() and 0xFF) }
        return value
    }

    fun bytes(count: Int): ByteArray {
        need(count)
        val out = buffer.copyOfRange(offset, offset + count)
        offset += count
        return out
    }

    fun lengthPrefixed(): ByteArray = bytes(u8())

    /**
     * Trailing bytes are not an error.
     *
     * A later version may append fields to a message this one already understands, and refusing a
     * message because it is longer than expected would make every such addition a breaking change.
     * The rule is: read what you know, ignore the rest.
     */
    fun ignoreRest() {
        offset = buffer.size
    }
}
