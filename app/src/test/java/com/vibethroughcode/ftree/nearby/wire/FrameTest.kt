package com.vibethroughcode.ftree.nearby.wire

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Framing, and the ceiling that stops a stranger on the network exhausting this device's memory.
 *
 * The reader is fed in awkward shapes on purpose. A socket delivers whatever it feels like — a
 * header split across two reads, four frames in one read, one byte at a time under load — and a
 * parser that only ever sees whole frames in tests is a parser that has not been tested.
 */
class FrameTest {

    @Test
    fun `a frame round-trips`() {
        val payload = ByteArray(37) { it.toByte() }
        val frames = FrameReader().feed(encodeFrame(NearbyProtocol.TYPE_OFFER, payload))
        assertEquals(1, frames.size)
        assertEquals(NearbyProtocol.TYPE_OFFER, frames[0].type)
        assertArrayEquals(payload, frames[0].payload)
    }

    @Test
    fun `an empty payload is legal`() {
        // ACCEPT carries nothing, so a body of exactly one byte has to work.
        val frames = FrameReader().feed(encodeFrame(NearbyProtocol.TYPE_ACCEPT, ByteArray(0)))
        assertEquals(1, frames.size)
        assertEquals(0, frames[0].payload.size)
    }

    @Test
    fun `several frames in one read all come out, in order`() {
        val stream = encodeFrame(NearbyProtocol.TYPE_HELLO, byteArrayOf(1)) +
            encodeFrame(NearbyProtocol.TYPE_KEY, byteArrayOf(2, 2)) +
            encodeFrame(NearbyProtocol.TYPE_DATA, byteArrayOf(3, 3, 3))

        val frames = FrameReader().feed(stream)
        assertEquals(listOf(NearbyProtocol.TYPE_HELLO, NearbyProtocol.TYPE_KEY, NearbyProtocol.TYPE_DATA), frames.map { it.type })
        assertEquals(3, frames[2].payload.size)
    }

    @Test
    fun `a frame fed one byte at a time arrives whole and only once`() {
        val payload = ByteArray(300) { (it * 7).toByte() }
        val encoded = encodeFrame(NearbyProtocol.TYPE_DATA, payload)

        val reader = FrameReader()
        val collected = mutableListOf<Frame>()
        for (byte in encoded) {
            collected += reader.feed(byteArrayOf(byte))
        }

        assertEquals(1, collected.size)
        assertArrayEquals(payload, collected[0].payload)
        assertEquals(0, reader.pending)
    }

    @Test
    fun `a header split across two reads is not a frame until it is`() {
        val encoded = encodeFrame(NearbyProtocol.TYPE_END, ByteArray(40) { 5 })
        val reader = FrameReader()

        // Three bytes: not even a length yet.
        assertTrue(reader.feed(encoded.copyOfRange(0, 3)).isEmpty())
        // Seven: a length and a type, but no body.
        assertTrue(reader.feed(encoded.copyOfRange(3, 7)).isEmpty())

        val frames = reader.feed(encoded.copyOfRange(7, encoded.size))
        assertEquals(1, frames.size)
        assertEquals(NearbyProtocol.TYPE_END, frames[0].type)
    }

    @Test
    fun `the largest legal frame is accepted`() {
        val payload = ByteArray(NearbyProtocol.MAX_FRAME_BODY - 1)
        val frames = FrameReader().feed(encodeFrame(NearbyProtocol.TYPE_DATA, payload))
        assertEquals(1, frames.size)
        assertEquals(payload.size, frames[0].payload.size)
    }

    @Test
    fun `a length past the ceiling is refused before anything is allocated`() {
        val hostile = byteArrayOf(0x00, 0x01, 0x00, 0x13, NearbyProtocol.TYPE_DATA.toByte())
        assertThrows(NearbyFailure::class.java) { FrameReader().feed(hostile) }
    }

    @Test
    fun `a length of 0xFFFFFFFF is refused rather than read as minus one`() {
        // The trap this exists for: read into an Int, 0xFFFFFFFF is -1, which is smaller than the
        // ceiling and sails through the check straight into a negative allocation. Read into a
        // Long through an explicit mask, it is four billion and is refused.
        val hostile = byteArrayOf(
            0xFF.toByte(), 0xFF.toByte(), 0xFF.toByte(), 0xFF.toByte(),
            NearbyProtocol.TYPE_DATA.toByte(),
        )
        val failure = assertThrows(NearbyFailure::class.java) { FrameReader().feed(hostile) }
        assertEquals(NearbyProblem.FRAME_TOO_LARGE, failure.problem)
    }

    @Test
    fun `a length of zero is refused`() {
        // Every frame has at least a type byte, so a body of zero is malformed rather than empty.
        val hostile = byteArrayOf(0, 0, 0, 0, 0)
        assertThrows(NearbyFailure::class.java) { FrameReader().feed(hostile) }
    }

    @Test
    fun `bytes after a complete frame are held for the next one`() {
        val first = encodeFrame(NearbyProtocol.TYPE_HELLO, byteArrayOf(1, 2, 3))
        val second = encodeFrame(NearbyProtocol.TYPE_KEY, byteArrayOf(9))

        val reader = FrameReader()
        val frames = reader.feed(first + second.copyOfRange(0, 3))
        assertEquals(1, frames.size)
        assertEquals(3, reader.pending)

        val rest = reader.feed(second.copyOfRange(3, second.size))
        assertEquals(1, rest.size)
        assertEquals(NearbyProtocol.TYPE_KEY, rest[0].type)
        assertEquals(0, reader.pending)
    }

    @Test
    fun `two frames with the same bytes are equal`() {
        // ByteArray gives identity equality, which would make every test that compares frames pass
        // or fail for a reason unrelated to what it is testing.
        assertEquals(Frame(1, byteArrayOf(1, 2)), Frame(1, byteArrayOf(1, 2)))
        assertEquals(Frame(1, byteArrayOf(1, 2)).hashCode(), Frame(1, byteArrayOf(1, 2)).hashCode())
    }
}
