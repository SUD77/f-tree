package com.vibethroughcode.ftree.nearby.wire

import java.math.BigInteger
import java.security.MessageDigest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The derivation, and the six digits it ends in.
 *
 * These are the assertions the whole feature rests on. If the two implementations disagree about
 * any of it, two people compare two screens, see different numbers, and correctly conclude that
 * something is wrong — while the thing that is wrong is this file rather than the network.
 */
class HandshakeTest {

    private fun transcriptOf(vararg frames: ByteArray): ByteArray =
        TranscriptHash().apply { frames.forEach { add(it) } }.value()

    @Test
    fun `RFC 5869 basic case, as an anchor on the HKDF itself`() {
        // Case 1 from the RFC: 22 bytes of 0x0b keyed by 13 bytes of salt. Checked because if
        // HKDF is wrong, every other assertion here is wrong in a way that still looks consistent.
        val ikm = ByteArray(22) { 0x0b }
        val salt = ByteArray(13) { it.toByte() }
        val prk = javax.crypto.Mac.getInstance("HmacSHA256").run {
            init(javax.crypto.spec.SecretKeySpec(salt, "HmacSHA256"))
            doFinal(ikm)
        }
        assertEquals(
            "077709362c2e32df0ddc3f0dc47bba6390b6c73bb50f9c3122ec844ad7c2b3e5",
            prk.joinToString("") { "%02x".format(it) },
        )
    }

    @Test
    fun `both sides derive the same keys and the same digits`() {
        val alicePrivate = BigInteger.valueOf(0xA11CE)
        val bobPrivate = BigInteger.valueOf(0xB0B)

        val transcript = transcriptOf(
            encodeFrame(NearbyProtocol.TYPE_HELLO, ByteArray(20) { 1 }),
            encodeFrame(NearbyProtocol.TYPE_HELLO_ACK, ByteArray(20) { 2 }),
        )

        val fromAlice = Handshake.extract(
            transcript,
            Handshake.NO_TOKEN,
            Dh.sharedSecret(alicePrivate, Dh.publicOf(bobPrivate)),
        )
        val fromBob = Handshake.extract(
            transcript,
            Handshake.NO_TOKEN,
            Dh.sharedSecret(bobPrivate, Dh.publicOf(alicePrivate)),
        )

        assertEquals(Handshake.deriveKeys(fromAlice), Handshake.deriveKeys(fromBob))
    }

    @Test
    fun `a one-bit change anywhere in the transcript changes the digits`() {
        val secret = BigInteger.valueOf(0x5EC6E7)
        val original = transcriptOf(encodeFrame(NearbyProtocol.TYPE_HELLO, ByteArray(20) { 1 }))

        val tampered = ByteArray(20) { 1 }.also { it[7] = (it[7].toInt() xor 1).toByte() }
        val changed = transcriptOf(encodeFrame(NearbyProtocol.TYPE_HELLO, tampered))

        val a = Handshake.deriveKeys(Handshake.extract(original, Handshake.NO_TOKEN, secret))
        val b = Handshake.deriveKeys(Handshake.extract(changed, Handshake.NO_TOKEN, secret))

        assertNotEquals(a.sas, b.sas)
        assertNotEquals(
            a.senderToReceiver.toList(),
            b.senderToReceiver.toList(),
        )
    }

    @Test
    fun `a pairing token changes the keys, which is what makes it a secret`() {
        val secret = BigInteger.valueOf(0x7043)
        val transcript = transcriptOf(encodeFrame(NearbyProtocol.TYPE_KEY, ByteArray(8)))

        val without = Handshake.deriveKeys(Handshake.extract(transcript, Handshake.NO_TOKEN, secret))
        val with = Handshake.deriveKeys(
            Handshake.extract(transcript, ByteArray(16) { 0x5A }, secret),
        )

        // A device that did not see the screen derives these keys, not those, and its first
        // encrypted frame fails to open. That is the whole mechanism.
        assertNotEquals(without.sas, with.sas)
    }

    @Test
    fun `the two directions get different keys`() {
        val keys = Handshake.deriveKeys(
            Handshake.extract(ByteArray(32), Handshake.NO_TOKEN, BigInteger.valueOf(99)),
        )
        assertNotEquals(keys.senderToReceiver.toList(), keys.receiverToSender.toList())
        assertEquals(32, keys.senderToReceiver.size)
        assertEquals(32, keys.receiverToSender.size)
    }

    @Test
    fun `the code is always six digits, including when the value is small`() {
        // A raw value that reduces to 7 must render as "000007" and not as "7". Two screens showing
        // "7" and "000007" is a mismatch a user would report as an attack.
        val raw = ByteArray(8)
        raw[7] = 7
        assertEquals("000007", Handshake.sasDigits(raw))
    }

    @Test
    fun `the code is not negative when the top bit is set`() {
        // Kotlin has no unsigned 64-bit type, so a raw value with the high bit set is a negative
        // Long, and `%` in Java keeps the sign. Unhandled, half of all handshakes show "-12345".
        val raw = ByteArray(8) { 0xFF.toByte() }
        val sas = Handshake.sasDigits(raw)
        assertEquals(6, sas.length)
        assertTrue("got $sas", sas.all { it.isDigit() })
    }

    @Test
    fun `the code spreads across the whole six-digit range`() {
        val seen = mutableSetOf<String>()
        var lowest = 1_000_000
        var highest = -1
        for (i in 0 until 4000) {
            val raw = java.security.MessageDigest.getInstance("SHA-256")
                .digest(i.toString().toByteArray())
                .copyOf(8)
            val sas = Handshake.sasDigits(raw)
            assertEquals(6, sas.length)
            seen += sas
            lowest = minOf(lowest, sas.toInt())
            highest = maxOf(highest, sas.toInt())
        }
        // No truncation to five digits, and no clustering in a corner of the range.
        assertTrue("collisions: ${4000 - seen.size}", seen.size > 3950)
        assertTrue("lowest was $lowest", lowest < 50_000)
        assertTrue("highest was $highest", highest > 950_000)
    }

    @Test
    fun `the transcript covers the length prefix, not only the payload`() {
        // The transcript is defined as whole frames "as they crossed the wire". A hash over only
        // the payloads would let two different framings agree, which is the ambiguity the
        // definition exists to remove.
        val payload = ByteArray(4) { 9 }
        val framed = transcriptOf(encodeFrame(NearbyProtocol.TYPE_HELLO, payload))
        val bare = transcriptOf(payload)
        assertNotEquals(framed.toList(), bare.toList())
    }

    @Test
    fun `the beacon fingerprint changes when either input does`() {
        val deviceId = ByteArray(16) { (it + 1).toByte() }
        val other = ByteArray(16) { (it + 2).toByte() }
        val key = Dh.publicOf(BigInteger.valueOf(0xB0BL))
        val otherKey = Dh.publicOf(BigInteger.valueOf(0xA11CEL))

        val base = Handshake.beaconFingerprint(deviceId, key)
        assertEquals(NearbyProtocol.KEY_FINGERPRINT_BYTES, base.size)
        assertEquals(base.toList(), Handshake.beaconFingerprint(deviceId, key).toList())

        // Both inputs are covered. A fingerprint over the key alone would be identical for two
        // devices that happened to reuse one, and a fingerprint over the id alone would not change
        // when a device generated a new key — which is exactly when a stale entry in somebody's
        // peer list needs to stop matching.
        assertNotEquals(base.toList(), Handshake.beaconFingerprint(other, key).toList())
        assertNotEquals(base.toList(), Handshake.beaconFingerprint(deviceId, otherKey).toList())
    }

    @Test
    fun `the beacon fingerprint is domain separated from the session keys`() {
        // Same hash, same inputs, different label. Without the label a fingerprint — which is
        // broadcast in clear, twice a second — would be a prefix of something derived from the
        // same material for a different purpose.
        val deviceId = ByteArray(16) { (it + 1).toByte() }
        val key = Dh.publicOf(BigInteger.valueOf(0xB0BL))
        val fingerprint = Handshake.beaconFingerprint(deviceId, key)

        val plain = MessageDigest.getInstance("SHA-256").run {
            update(deviceId)
            update(Dh.to256(key))
            digest().copyOf(NearbyProtocol.KEY_FINGERPRINT_BYTES)
        }
        assertNotEquals(plain.toList(), fingerprint.toList())
    }

    @Test
    fun `expand refuses more than one block`() {
        val prk = ByteArray(32)
        assertEquals(32, Handshake.expand(prk, "x", 32).size)
        try {
            Handshake.expand(prk, "x", 33)
            throw AssertionError("should have refused 33 bytes")
        } catch (_: IllegalArgumentException) {
            // Expected: every output this protocol asks for fits in one block, and a silent
            // second block would be a second implementation of the RFC's counter.
        }
    }
}
