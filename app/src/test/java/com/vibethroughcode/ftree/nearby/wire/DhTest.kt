package com.vibethroughcode.ftree.nearby.wire

import java.math.BigInteger
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Key agreement, and in particular the padding rule.
 *
 * The `to256` cases are not padding-for-its-own-sake. Kotlin's `BigInteger.toByteArray()` prepends
 * a sign byte when the top bit is set, and Node's `computeSecret()` strips leading zeros — so a
 * shared secret that begins `0x00`, which happens once in every 256 handshakes, is 255 bytes on one
 * side and 256 on the other. Unpadded, the two devices agree on a secret and then derive different
 * keys from it: the feature works, and works, and works, and then one time in 256 shows two
 * different six-digit codes to two people who conclude they are being attacked.
 */
class DhTest {

    @Test
    fun `to256 strips the sign byte a 2048-bit value carries`() {
        // Bit 2047 set, so toByteArray() returns 257 bytes with a leading zero.
        val topBitSet = BigInteger.ONE.shiftLeft(2047)
        assertEquals(257, topBitSet.toByteArray().size)

        val padded = Dh.to256(topBitSet)
        assertEquals(256, padded.size)
        assertEquals(0x80.toByte(), padded[0])
    }

    @Test
    fun `to256 left-pads a value whose leading byte is zero`() {
        // 255 bytes wide: exactly the case Node hands back short.
        val short = BigInteger.ONE.shiftLeft(2039)
        val padded = Dh.to256(short)
        assertEquals(256, padded.size)
        assertEquals(0.toByte(), padded[0])
        assertEquals(0x80.toByte(), padded[1])
    }

    @Test
    fun `to256 left-pads a one-byte value`() {
        val padded = Dh.to256(BigInteger.valueOf(2))
        assertEquals(256, padded.size)
        assertEquals(2.toByte(), padded[255])
        assertTrue(padded.take(255).all { it == 0.toByte() })
    }

    @Test
    fun `to256 round-trips through fromBytes`() {
        val value = BigInteger("deadbeef".repeat(16), 16)
        assertEquals(value, Dh.fromBytes(Dh.to256(value)))
    }

    @Test
    fun `a shared secret is the same computed from either side`() {
        val alicePrivate = BigInteger.valueOf(0xC0FFEE)
        val bobPrivate = BigInteger.valueOf(0xBADF00D)

        val alicePublic = Dh.publicOf(alicePrivate)
        val bobPublic = Dh.publicOf(bobPrivate)

        assertEquals(
            Dh.sharedSecret(alicePrivate, bobPublic),
            Dh.sharedSecret(bobPrivate, alicePublic),
        )
    }

    @Test
    fun `a degenerate public value is refused`() {
        // p is a safe prime, so 1 and p-1 are its only small-subgroup elements. A peer sending
        // either forces a shared secret an attacker already knows.
        for (bad in listOf(
            BigInteger.ZERO,
            BigInteger.ONE,
            Dh.P.subtract(BigInteger.ONE),
            Dh.P,
            Dh.P.add(BigInteger.ONE),
        )) {
            assertFalse("$bad should be refused", Dh.isValidPublic(bad))
            assertThrows(NearbyFailure::class.java) {
                Dh.sharedSecret(BigInteger.valueOf(7), bad)
            }
        }
    }

    @Test
    fun `the edges of the valid range are accepted`() {
        assertTrue(Dh.isValidPublic(BigInteger.TWO))
        assertTrue(Dh.isValidPublic(Dh.P.subtract(BigInteger.TWO)))
    }

    @Test
    fun `a generated private exponent is in range and 256 bits`() {
        repeat(20) {
            val private = Dh.generatePrivate()
            assertTrue(private >= BigInteger.TWO)
            assertTrue(private.bitLength() <= NearbyProtocol.DH_PRIVATE_BITS)
        }
    }

    @Test
    fun `the prime is the RFC 3526 group 14 prime`() {
        assertEquals(2048, Dh.P.bitLength())
        assertTrue(Dh.P.isProbablePrime(40))
        // A safe prime: (p-1)/2 is also prime, which is what makes the range check sufficient.
        assertTrue(Dh.P.subtract(BigInteger.ONE).shiftRight(1).isProbablePrime(40))
    }

    @Test
    fun `to256 output is exactly the wire width for every public key`() {
        repeat(10) {
            val public = Dh.publicOf(Dh.generatePrivate())
            assertEquals(NearbyProtocol.DH_PUBLIC_BYTES, Dh.to256(public).size)
        }
    }

    @Test
    fun `a public key survives the wire unchanged`() {
        val public = Dh.publicOf(BigInteger.valueOf(0x1234567))
        assertArrayEquals(Dh.to256(public), Dh.to256(Dh.fromBytes(Dh.to256(public))))
    }
}
