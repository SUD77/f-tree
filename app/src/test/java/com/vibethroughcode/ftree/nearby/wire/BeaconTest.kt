package com.vibethroughcode.ftree.nearby.wire

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The announcement, and everything it must refuse.
 *
 * A beacon arrives on a shared network from anybody who cares to send one, so most of this file is
 * about rejection. Every bad case returns `null` rather than throwing: a malformed datagram is far
 * more likely to be some other protocol using the same port than a fault, and discovery has no
 * user-visible place to report one anyway.
 */
class BeaconTest {

    private val deviceId = DeviceId(ByteArray(16) { (it + 1).toByte() })
    private val fingerprint = ByteArray(8) { (it * 3).toByte() }

    private fun announce(name: String = "Quiet Heron", port: Int = 49813) = Beacon.announce(
        platform = NearbyPlatform.ANDROID,
        flags = NearbyProtocol.FLAG_ACCEPTS_TREE,
        tcpPort = port,
        deviceId = deviceId,
        keyFingerprint = fingerprint,
        displayName = name,
    )

    @Test
    fun `an announcement round-trips`() {
        val decoded = Beacon.decode(announce().encode())
        assertEquals(announce(), decoded)
    }

    @Test
    fun `the lowest and highest ports both survive`() {
        // A port is a u16 and 49813 fits comfortably, but an ephemeral port can be anything up to
        // 65535 — which is negative if the field is ever read as a signed short.
        assertEquals(1, Beacon.decode(announce(port = 1).encode())!!.tcpPort)
        assertEquals(65535, Beacon.decode(announce(port = 65535).encode())!!.tcpPort)
    }

    @Test
    fun `a query says nothing about who sent it`() {
        val decoded = Beacon.decode(Beacon.query().encode())!!
        assertEquals(NearbyProtocol.BEACON_QUERY, decoded.messageType)
        assertEquals(0, decoded.tcpPort)
        assertEquals("", decoded.displayName)
        assertTrue(decoded.deviceId.bytes.all { it == 0.toByte() })
    }

    @Test
    fun `a multibyte name survives the wire`() {
        val decoded = Beacon.decode(announce(name = "अंकित का फ़ोन").encode())
        assertEquals("अंकित का फ़ोन", decoded!!.displayName)
    }

    @Test
    fun `a truncated datagram is ignored rather than throwing`() {
        val encoded = announce().encode()
        for (length in 0 until NearbyProtocol.BEACON_HEADER_SIZE) {
            assertNull("length $length should be ignored", Beacon.decode(encoded, length))
        }
        // Cut part-way through the name, after a complete header.
        assertNull(Beacon.decode(encoded, NearbyProtocol.BEACON_HEADER_SIZE + 2))
    }

    @Test
    fun `the wrong magic is ignored`() {
        val encoded = announce().encode()
        encoded[0] = 'X'.code.toByte()
        assertNull(Beacon.decode(encoded))
    }

    @Test
    fun `trailing bytes are accepted and ignored`() {
        // This is what lets a later version append a field without this one refusing to see the
        // device at all. It is a compatibility promise, so it gets a test rather than a comment.
        val padded = announce().encode() + ByteArray(64) { 0x7F }
        assertEquals(announce(), Beacon.decode(padded))
    }

    @Test
    fun `an announcement with no name is ignored`() {
        val nameless = announce().encode().copyOf(NearbyProtocol.BEACON_HEADER_SIZE)
        nameless[36] = 0
        assertNull(Beacon.decode(nameless))
    }

    @Test
    fun `a name made only of overrides falls back rather than drawing nothing`() {
        val decoded = Beacon.decode(announce(name = "‮‮").encode())
        assertNotNull(decoded)
        assertEquals(NearbyNames.friendlyName(deviceId.bytes), decoded!!.displayName)
    }

    @Test
    fun `a version range that is backwards is ignored`() {
        val encoded = announce().encode()
        encoded[4] = 1 // max
        encoded[5] = 9 // min, above max
        assertNull(Beacon.decode(encoded))
    }

    @Test
    fun `a peer needing a newer build is readable but not speakable`() {
        // Shown greyed rather than hidden: a peer that vanishes is a bug report, and a peer that
        // explains itself is an upgrade prompt. So it must decode.
        val encoded = announce().encode()
        encoded[4] = 9
        encoded[5] = 9
        val decoded = Beacon.decode(encoded)
        assertNotNull(decoded)
        assertFalse(decoded!!.speakable)
    }

    @Test
    fun `an oversized datagram cannot claim a name longer than the limit`() {
        val encoded = announce().encode()
        encoded[36] = 100 // longer than the 64-byte ceiling
        assertNull(Beacon.decode(encoded))
    }

    @Test
    fun `a beacon never exceeds one small datagram`() {
        val longest = announce(name = "n".repeat(200))
        assertTrue(longest.encode().size <= NearbyProtocol.BEACON_MAX_SIZE)
    }

    @Test
    fun `a device id round-trips through hex`() {
        assertEquals(deviceId.bytes.toList(), DeviceId.parse(deviceId.hex())!!.bytes.toList())
        assertNull(DeviceId.parse("not hex"))
        assertNull(DeviceId.parse(deviceId.hex().dropLast(1)))
    }
}
