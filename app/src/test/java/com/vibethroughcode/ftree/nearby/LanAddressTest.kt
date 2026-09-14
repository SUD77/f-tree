package com.vibethroughcode.ftree.nearby

import org.junit.Assert.assertEquals
import org.junit.Test

class LanAddressTest {

    private fun ip(text: String) = text.split(".").map { it.toInt().toByte() }.toByteArray()
    private fun text(bytes: ByteArray) = bytes.joinToString(".") { (it.toInt() and 0xFF).toString() }

    @Test
    fun `a home network broadcasts to its own subnet`() {
        assertEquals("192.168.29.255", text(LanAddress.directedBroadcast(ip("192.168.29.40"), 24)))
        assertEquals("10.0.2.255", text(LanAddress.directedBroadcast(ip("10.0.2.16"), 24)))
    }

    @Test
    fun `wider and narrower networks keep their own boundaries`() {
        assertEquals("172.31.255.255", text(LanAddress.directedBroadcast(ip("172.16.4.9"), 12)))
        assertEquals("192.168.1.127", text(LanAddress.directedBroadcast(ip("192.168.1.100"), 25)))
        // High octets are where a signed byte would go wrong.
        assertEquals("10.255.255.255", text(LanAddress.directedBroadcast(ip("10.200.128.1"), 8)))
    }

    @Test
    fun `the edges of the prefix range`() {
        assertEquals("192.168.1.7", text(LanAddress.directedBroadcast(ip("192.168.1.7"), 32)))
        assertEquals("255.255.255.255", text(LanAddress.directedBroadcast(ip("192.168.1.7"), 0)))
    }
}
