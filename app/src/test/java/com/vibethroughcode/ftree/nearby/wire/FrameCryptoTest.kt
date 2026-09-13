package com.vibethroughcode.ftree.nearby.wire

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The cipher, and the nonce discipline that makes it safe to use a counter.
 *
 * The nonce cases carry the weight. Reusing a GCM nonce under one key does not merely expose a
 * message — it exposes the authentication key, and every later frame can then be forged. A counter
 * cannot repeat, which is the whole argument for using one, but only if it is built the way both
 * implementations agree it is.
 */
class FrameCryptoTest {

    private val key = ByteArray(32) { (it + 1).toByte() }
    private val other = ByteArray(32) { (it + 2).toByte() }

    @Test
    fun `a frame opens with the key, direction and sequence it was sealed under`() {
        val plaintext = "a family".toByteArray()
        val sealed = FrameCrypto.seal(key, NearbyProtocol.DIRECTION_SENDER_TO_RECEIVER, 0, NearbyProtocol.TYPE_DATA, plaintext)
        val opened = FrameCrypto.open(key, NearbyProtocol.DIRECTION_SENDER_TO_RECEIVER, 0, NearbyProtocol.TYPE_DATA, sealed)
        assertArrayEquals(plaintext, opened)
    }

    @Test
    fun `an empty payload and a full one both work`() {
        for (size in listOf(0, 1, NearbyProtocol.MAX_PLAINTEXT)) {
            val plaintext = ByteArray(size) { it.toByte() }
            val sealed = FrameCrypto.seal(key, 1, 3, NearbyProtocol.TYPE_DATA, plaintext)
            assertEquals(size + NearbyProtocol.GCM_TAG_BYTES, sealed.size)
            assertArrayEquals(plaintext, FrameCrypto.open(key, 1, 3, NearbyProtocol.TYPE_DATA, sealed))
        }
    }

    @Test
    fun `the wrong key does not open it`() {
        val sealed = FrameCrypto.seal(key, 1, 0, NearbyProtocol.TYPE_OFFER, byteArrayOf(1, 2, 3))
        assertThrows(NearbyFailure::class.java) {
            FrameCrypto.open(other, 1, 0, NearbyProtocol.TYPE_OFFER, sealed)
        }
    }

    @Test
    fun `a failure on the first frame is reported as a pairing problem`() {
        // The difference matters to the person reading the screen: a bad first frame means the code
        // they scanned was wrong or somebody is in between, not that the connection went bad.
        val sealed = FrameCrypto.seal(key, 1, 0, NearbyProtocol.TYPE_OFFER, byteArrayOf(1))
        val first = assertThrows(NearbyFailure::class.java) {
            FrameCrypto.open(other, 1, 0, NearbyProtocol.TYPE_OFFER, sealed, firstFrame = true)
        }
        assertEquals(NearbyProblem.BAD_PAIRING, first.problem)

        val later = assertThrows(NearbyFailure::class.java) {
            FrameCrypto.open(other, 1, 0, NearbyProtocol.TYPE_OFFER, sealed, firstFrame = false)
        }
        assertEquals(NearbyProblem.DECRYPT_FAILED, later.problem)
    }

    @Test
    fun `a frame cannot be replayed at a different sequence`() {
        val sealed = FrameCrypto.seal(key, 1, 5, NearbyProtocol.TYPE_DATA, byteArrayOf(9))
        assertThrows(NearbyFailure::class.java) {
            FrameCrypto.open(key, 1, 6, NearbyProtocol.TYPE_DATA, sealed)
        }
    }

    @Test
    fun `a frame cannot be replayed back in the other direction`() {
        val sealed = FrameCrypto.seal(key, NearbyProtocol.DIRECTION_SENDER_TO_RECEIVER, 0, NearbyProtocol.TYPE_DATA, byteArrayOf(9))
        assertThrows(NearbyFailure::class.java) {
            FrameCrypto.open(key, NearbyProtocol.DIRECTION_RECEIVER_TO_SENDER, 0, NearbyProtocol.TYPE_DATA, sealed)
        }
    }

    @Test
    fun `a frame cannot be replayed as a different type`() {
        // The type is bound into the associated data precisely so that a DATA frame cannot be
        // presented as an END, which would truncate a transfer and still authenticate.
        val sealed = FrameCrypto.seal(key, 1, 0, NearbyProtocol.TYPE_DATA, byteArrayOf(9))
        assertThrows(NearbyFailure::class.java) {
            FrameCrypto.open(key, 1, 0, NearbyProtocol.TYPE_END, sealed)
        }
    }

    @Test
    fun `a single altered bit is caught`() {
        val sealed = FrameCrypto.seal(key, 1, 0, NearbyProtocol.TYPE_DATA, ByteArray(64) { 7 })
        for (index in listOf(0, 30, sealed.size - 1)) {
            val tampered = sealed.copyOf()
            tampered[index] = (tampered[index].toInt() xor 1).toByte()
            assertThrows(NearbyFailure::class.java) {
                FrameCrypto.open(key, 1, 0, NearbyProtocol.TYPE_DATA, tampered)
            }
        }
    }

    @Test
    fun `a nonce is twelve bytes of direction and counter`() {
        val nonce = FrameCrypto.nonceFor(1, 1)
        assertEquals(NearbyProtocol.NONCE_BYTES, nonce.size)
        assertArrayEquals(byteArrayOf(0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1), nonce)
    }

    @Test
    fun `the counter does not lose its top bits`() {
        // 2^53 is where a JavaScript Number stops being exact. The desktop side reads this field
        // with readBigUInt64BE for that reason, and this case is the one that fails if it ever
        // stops doing so. Kotlin has no such limit, so this pins the expected bytes for both.
        val nonce = FrameCrypto.nonceFor(1, 1L shl 53)
        assertArrayEquals(byteArrayOf(0, 0, 0, 1, 0, 0x20, 0, 0, 0, 0, 0, 0), nonce)

        val max = FrameCrypto.nonceFor(2, -1L) // 2^64 - 1 unsigned
        assertArrayEquals(
            byteArrayOf(0, 0, 0, 2, -1, -1, -1, -1, -1, -1, -1, -1),
            max,
        )
    }

    @Test
    fun `every sequence gives a different nonce`() {
        val seen = mutableSetOf<List<Byte>>()
        for (sequence in 0L until 1000L) {
            assertTrue(seen.add(FrameCrypto.nonceFor(1, sequence).toList()))
        }
        // And the two directions never collide, which is what lets both start at zero.
        for (sequence in 0L until 1000L) {
            assertTrue(seen.add(FrameCrypto.nonceFor(2, sequence).toList()))
        }
    }

    @Test
    fun `the same plaintext at two sequences gives different ciphertext`() {
        val plaintext = ByteArray(32) { 4 }
        val first = FrameCrypto.seal(key, 1, 0, NearbyProtocol.TYPE_DATA, plaintext)
        val second = FrameCrypto.seal(key, 1, 1, NearbyProtocol.TYPE_DATA, plaintext)
        assertNotEquals(first.toList(), second.toList())
    }

    @Test
    fun `a payload shorter than a tag is malformed rather than an exception`() {
        val failure = assertThrows(NearbyFailure::class.java) {
            FrameCrypto.open(key, 1, 0, NearbyProtocol.TYPE_DATA, ByteArray(8))
        }
        assertEquals(NearbyProblem.MALFORMED_FRAME, failure.problem)
    }

    @Test
    fun `the ciphertext does not contain the plaintext`() {
        val plaintext = "Ankit Kumar".toByteArray()
        val sealed = FrameCrypto.seal(key, 1, 0, NearbyProtocol.TYPE_DATA, plaintext)
        assertFalse(String(sealed, Charsets.ISO_8859_1).contains("Ankit"))
    }
}
