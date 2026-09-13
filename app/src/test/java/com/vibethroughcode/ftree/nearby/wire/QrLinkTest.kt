package com.vibethroughcode.ftree.nearby.wire

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The scanned code.
 *
 * The address check is the part that matters. A code is a thing people point a camera at without
 * reading, so "where will this send my family" cannot be a question the user is expected to answer.
 */
class QrLinkTest {

    private val deviceId = DeviceId(ByteArray(16) { (it * 7).toByte() })
    private val fingerprint = ByteArray(8) { (it + 1).toByte() }
    private val token = ByteArray(16) { (it * 11).toByte() }

    private fun link(
        address: String = "192.168.1.42",
        withToken: Boolean = true,
        name: String? = "Quiet Heron",
    ) = QrLink(
        address = address,
        port = 49813,
        deviceId = deviceId,
        keyFingerprint = fingerprint,
        token = if (withToken) token else null,
        displayName = name,
    )

    @Test
    fun `a link round-trips`() {
        assertEquals(link(), QrLink.parse(link().encode()))
    }

    @Test
    fun `a link without a token round-trips, and says so`() {
        val parsed = QrLink.parse(link(withToken = false).encode())
        assertNotNull(parsed)
        assertNull(parsed!!.token)
    }

    @Test
    fun `a name with spaces and punctuation survives`() {
        val parsed = QrLink.parse(link(name = "Ankit's Pixel 7").encode())
        assertEquals("Ankit's Pixel 7", parsed!!.displayName)
    }

    @Test
    fun `a multibyte name survives percent-encoding`() {
        val parsed = QrLink.parse(link(name = "अंकित").encode())
        assertEquals("अंकित", parsed!!.displayName)
    }

    @Test
    fun `every private range is accepted`() {
        for (address in listOf("10.0.0.1", "10.255.255.254", "172.16.0.1", "172.31.255.1", "192.168.1.1")) {
            assertTrue(address, QrLink.isPrivateAddress(address))
        }
    }

    @Test
    fun `link-local is accepted, because two devices with no router still have one`() {
        assertTrue(QrLink.isPrivateAddress("169.254.3.4"))
    }

    @Test
    fun `a public address is refused outright`() {
        // Either a mistake or an attempt to make a phone post somebody's family to a machine on
        // the internet. There is no third reading, so there is nothing to ask the user about.
        for (address in listOf("8.8.8.8", "1.1.1.1", "172.32.0.1", "172.15.0.1", "192.169.1.1", "11.0.0.1")) {
            assertFalse(address, QrLink.isPrivateAddress(address))
            assertNull(address, QrLink.parse(link(address = address).encode()))
        }
    }

    @Test
    fun `loopback is not a private address, but is reachable in a test`() {
        // Kept apart on purpose: the rule a scanned code is held to stays the narrow one, and only
        // the harness and the desktop's own smoke run use the wider one.
        assertFalse(QrLink.isPrivateAddress("127.0.0.1"))
        assertTrue(QrLink.isTestableAddress("127.0.0.1"))
        assertTrue(QrLink.isTestableAddress("10.0.2.2"))
    }

    @Test
    fun `a malformed address is refused`() {
        for (address in listOf("", "10.0.0", "10.0.0.0.1", "10.0.0.256", "10.0.0.-1", "ten.0.0.1", "10.0.0.1 ")) {
            assertFalse("[$address]", QrLink.isPrivateAddress(address))
        }
    }

    @Test
    fun `an octet with a leading zero is refused`() {
        // Some parsers read "010" as octal, so two pieces of software can disagree about where
        // "10.0.0.010" points. Refusing the ambiguity is cheaper than picking a reading.
        assertFalse(QrLink.isPrivateAddress("10.0.0.010"))
        assertFalse(QrLink.isPrivateAddress("010.0.0.1"))
    }

    @Test
    fun `the wrong scheme is refused`() {
        val genuine = link().encode()
        assertNull(QrLink.parse(genuine.replace("ftree://", "https://")))
        assertNull(QrLink.parse("https://example.com/?a=192.168.1.1&p=1"))
        assertNull(QrLink.parse("ftree://elsewhere/v1?a=192.168.1.1&p=1"))
    }

    @Test
    fun `an unknown query key is ignored rather than refused`() {
        val extended = link().encode() + "&zz=something"
        assertEquals(link(), QrLink.parse(extended))
    }

    @Test
    fun `a missing required field is refused`() {
        val genuine = link().encode()
        val mark = genuine.indexOf('?')
        val prefix = genuine.substring(0, mark + 1)
        val fields = genuine.substring(mark + 1).split("&")

        for (key in listOf("a=", "p=", "d=", "f=")) {
            // Split the query only, not the whole URI: the first field is glued to the "?" and a
            // naive split leaves it in place, so the test would pass while removing nothing.
            val broken = prefix + fields.filterNot { it.startsWith(key) }.joinToString("&")
            assertNull(key, QrLink.parse(broken))
        }
    }

    @Test
    fun `a token of the wrong length is refused rather than silently ignored`() {
        // Quietly dropping a malformed token would downgrade the connection to one that needs the
        // six digits, without telling anybody the code they scanned did not work.
        val broken = link().encode().replace(Regex("&t=[^&]*"), "&t=AAAA")
        assertNull(QrLink.parse(broken))
    }

    @Test
    fun `a mangled or truncated link never parses into something usable`() {
        val genuine = link().encode()
        for (cut in genuine.indices step 7) {
            val parsed = QrLink.parse(genuine.substring(0, cut))
            if (parsed != null) {
                assertTrue(QrLink.isPrivateAddress(parsed.address))
                assertEquals(NearbyProtocol.KEY_FINGERPRINT_BYTES, parsed.keyFingerprint.size)
            }
        }
    }

    @Test
    fun `the link stays short enough to be a readable square`() {
        // Byte mode at error-correction level M. Past about 150 characters the code needs a higher
        // version, which means smaller modules and a camera that has to be held steady.
        assertTrue(link().encode().length < 160)
    }

    @Test
    fun `the token is not in the string representation`() {
        assertFalse(link().toString().contains("k7"))
        assertTrue(link().toString().contains("token=true"))
    }
}
