package com.vibethroughcode.ftree.nearby.wire

import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.FRAME_HEADER_SIZE
import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.MAX_FRAME_BODY

/** One message as it appears on the wire, after the length has been read off. */
data class Frame(val type: Int, val payload: ByteArray) {

    // ByteArray gives identity equals, which makes every test that compares two frames pass or fail
    // for the wrong reason. Spelled out rather than made a data-class-shaped trap for the next
    // person.
    override fun equals(other: Any?): Boolean =
        this === other ||
            (other is Frame && type == other.type && payload.contentEquals(other.payload))

    override fun hashCode(): Int = 31 * type + payload.contentHashCode()

    override fun toString(): String = "Frame(type=0x%02X, ${payload.size} bytes)".format(type)
}

/**
 * `length(4) || type(1) || payload`.
 *
 * `length` counts the type byte and the payload, not itself, so a reader that has the header knows
 * exactly how much more to wait for.
 */
fun encodeFrame(type: Int, payload: ByteArray): ByteArray {
    require(payload.size <= MAX_FRAME_BODY - 1) { "frame payload too large: ${payload.size}" }
    val body = 1 + payload.size
    val out = ByteArray(FRAME_HEADER_SIZE + payload.size)
    out[0] = (body ushr 24).toByte()
    out[1] = (body ushr 16).toByte()
    out[2] = (body ushr 8).toByte()
    out[3] = body.toByte()
    out[4] = type.toByte()
    payload.copyInto(out, FRAME_HEADER_SIZE)
    return out
}

/**
 * Frames out of a stream that arrives in whatever sizes the network felt like.
 *
 * Incremental and pure: it is fed byte arrays and yields whole frames, and it owns no socket. That
 * is what makes the awkward cases — a header split across two reads, a body arriving one byte at a
 * time, a length that is a lie — testable on the JVM, where CI can run them, rather than only
 * against a real connection on a device CI does not have.
 */
class FrameReader {

    private var buffer = ByteArray(0)

    /**
     * Adds [count] bytes of [chunk] and returns every frame that is now complete.
     *
     * @throws NearbyFailure if the stream claims a frame larger than the ceiling. Fatal by design:
     * a length prefix is the one field read before anything is allocated, so it is the one field a
     * stranger can use to exhaust memory. There is nothing to recover to, because the next bytes
     * are at an offset the reader can no longer find.
     */
    fun feed(chunk: ByteArray, count: Int = chunk.size): List<Frame> {
        buffer = if (buffer.isEmpty()) {
            chunk.copyOf(count)
        } else {
            val grown = ByteArray(buffer.size + count)
            buffer.copyInto(grown)
            chunk.copyInto(grown, buffer.size, 0, count)
            grown
        }

        val frames = mutableListOf<Frame>()
        var offset = 0
        while (true) {
            if (buffer.size - offset < FRAME_HEADER_SIZE) break

            // Into a Long through an explicit mask. As an Int, a claimed length of 0xFFFFFFFF is
            // -1, which is smaller than the ceiling and sails through the check below into a
            // negative allocation. This line is why vector 3 exists.
            val body = (
                ((buffer[offset].toLong() and 0xFF) shl 24) or
                    ((buffer[offset + 1].toLong() and 0xFF) shl 16) or
                    ((buffer[offset + 2].toLong() and 0xFF) shl 8) or
                    (buffer[offset + 3].toLong() and 0xFF)
                )

            if (body < 1L || body > MAX_FRAME_BODY.toLong()) {
                throw NearbyFailure(NearbyProblem.FRAME_TOO_LARGE)
            }

            val total = FRAME_HEADER_SIZE + (body - 1).toInt()
            if (buffer.size - offset < total) break

            val type = buffer[offset + 4].toInt() and 0xFF
            val payload = buffer.copyOfRange(offset + FRAME_HEADER_SIZE, offset + total)
            frames += Frame(type, payload)
            offset += total
        }

        buffer = if (offset == 0) buffer else buffer.copyOfRange(offset, buffer.size)
        return frames
    }

    /** Bytes held back because they are the start of a frame that has not finished arriving. */
    val pending: Int get() = buffer.size
}
