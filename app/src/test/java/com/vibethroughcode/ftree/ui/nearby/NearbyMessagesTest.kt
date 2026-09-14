package com.vibethroughcode.ftree.ui.nearby

import com.vibethroughcode.ftree.nearby.wire.NearbyProblem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NearbyMessagesTest {

    @Test
    fun `the two ways of meeting somebody in the middle both read as a warning`() {
        // A broken promise is the same event as mismatched digits, caught a step earlier. If only
        // one of them looked alarming, the earlier and stronger signal would read as the weaker.
        assertTrue(NearbyMessages.isAlarming(NearbyProblem.CODES_DID_NOT_MATCH))
        assertTrue(NearbyMessages.isAlarming(NearbyProblem.KEY_NOT_AS_PROMISED))
        assertEquals(
            "both need their own sentence",
            false,
            NearbyMessages.message(NearbyProblem.CODES_DID_NOT_MATCH) ==
                NearbyMessages.message(NearbyProblem.KEY_NOT_AS_PROMISED),
        )
    }

    @Test
    fun `ordinary endings do not`() {
        for (problem in listOf(
            NearbyProblem.DECLINED,
            NearbyProblem.TIMED_OUT,
            NearbyProblem.CANCELLED,
            NearbyProblem.CONNECTION_LOST,
            NearbyProblem.NETWORK,
            NearbyProblem.BUSY,
        )) {
            assertFalse(problem.name, NearbyMessages.isAlarming(problem))
        }
    }

    @Test
    fun `every reason has a sentence`() {
        // The `when` is exhaustive, so this compiles only if each has one; the loop proves none of
        // them throws at run time either.
        for (problem in NearbyProblem.entries) NearbyMessages.message(problem)
    }

    @Test
    fun `the digits are spoken one at a time and shown in threes`() {
        assertEquals("4 8 3 0 2 7", NearbyMessages.spokenDigits("483027"))
        assertEquals("483 027", NearbyMessages.groupedDigits("483027"))
        assertEquals("007 000", NearbyMessages.groupedDigits("007000"))
    }

    @Test
    fun `a typed address is a private address and a port`() {
        assertEquals("192.168.1.20" to 43121, NearbyMessages.parseAddress(" 192.168.1.20:43121 "))
        assertEquals("10.0.2.2" to 5000, NearbyMessages.parseAddress("10.0.2.2:5000"))
        assertNull(NearbyMessages.parseAddress("192.168.1.20"))
        assertNull(NearbyMessages.parseAddress("192.168.1.20:0"))
        assertNull(NearbyMessages.parseAddress("192.168.1.20:70000"))
        // A public address is either a mistake or an attempt to post somebody's family to the
        // internet, and there is no third reading.
        assertNull(NearbyMessages.parseAddress("8.8.8.8:443"))
        assertNull(NearbyMessages.parseAddress("example.com:443"))
    }
}
