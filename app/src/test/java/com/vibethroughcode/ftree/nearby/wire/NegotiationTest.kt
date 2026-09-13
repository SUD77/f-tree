package com.vibethroughcode.ftree.nearby.wire

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

/** Version and capability negotiation, including the refusals a user has to be able to act on. */
class NegotiationTest {

    @Test
    fun `two builds of the same version agree on it`() {
        assertEquals(1, Negotiation.chooseVersion(senderMax = 1, senderMin = 1))
    }

    @Test
    fun `the lower of the two maximums wins`() {
        assertEquals(1, Negotiation.chooseVersion(senderMax = 3, senderMin = 1, receiverMax = 1, receiverMin = 1))
        assertEquals(2, Negotiation.chooseVersion(senderMax = 2, senderMin = 1, receiverMax = 5, receiverMin = 1))
    }

    @Test
    fun `a sender that is too new is told so, and so is the other side`() {
        // Each device raises the code that is true from where it stands, so both can show a
        // sentence naming the device that actually needs updating.
        val tooNew = assertThrows(NearbyFailure::class.java) {
            Negotiation.chooseVersion(senderMax = 5, senderMin = 4, receiverMax = 2, receiverMin = 1)
        }
        assertEquals(NearbyProblem.PROTOCOL_TOO_NEW, tooNew.problem)

        val tooOld = assertThrows(NearbyFailure::class.java) {
            Negotiation.chooseVersion(senderMax = 1, senderMin = 1, receiverMax = 9, receiverMin = 5)
        }
        assertEquals(NearbyProblem.PROTOCOL_TOO_OLD, tooOld.problem)
    }

    @Test
    fun `only capabilities both sides claim survive`() {
        val both = NearbyProtocol.FLAG_ACCEPTS_TREE or NearbyProtocol.FLAG_PAIRED_BY_QR
        assertEquals(
            NearbyProtocol.FLAG_ACCEPTS_TREE,
            Negotiation.negotiateFlags(both, NearbyProtocol.FLAG_ACCEPTS_TREE),
        )
    }

    @Test
    fun `a reserved bit is never negotiated on, even if both sides set it`() {
        // MERGE_SYNC is specified but not implemented. Two version-1 builds that both set it by
        // mistake must not end up believing they agreed to a conversation neither can hold.
        val withReserved = NearbyProtocol.FLAG_ACCEPTS_TREE or NearbyProtocol.FLAG_MERGE_SYNC
        assertEquals(
            NearbyProtocol.FLAG_ACCEPTS_TREE,
            Negotiation.negotiateFlags(withReserved, withReserved),
        )
    }

    @Test
    fun `a receiver cannot name a version the sender never offered`() {
        assertThrows(NearbyFailure::class.java) {
            Negotiation.verifyChosen(
                chosen = 7,
                statedFlags = 0,
                senderMax = 1,
                senderMin = 1,
                senderFlags = 0,
                receiverBeaconFlags = 0,
            )
        }
    }

    @Test
    fun `a receiver cannot claim a capability the sender did not advertise`() {
        assertThrows(NearbyFailure::class.java) {
            Negotiation.verifyChosen(
                chosen = 1,
                statedFlags = NearbyProtocol.FLAG_ACCEPTS_TREE,
                senderMax = 1,
                senderMin = 1,
                senderFlags = 0,
                receiverBeaconFlags = NearbyProtocol.FLAG_ACCEPTS_TREE,
            )
        }
    }

    @Test
    fun `an honest answer verifies`() {
        Negotiation.verifyChosen(
            chosen = 1,
            statedFlags = NearbyProtocol.FLAG_ACCEPTS_TREE,
            senderMax = 1,
            senderMin = 1,
            senderFlags = NearbyProtocol.FLAG_ACCEPTS_TREE,
            receiverBeaconFlags = NearbyProtocol.FLAG_ACCEPTS_TREE,
        )
    }

    @Test
    fun `a file too new for the other device is caught before it is sent`() {
        val failure = assertThrows(NearbyFailure::class.java) {
            Negotiation.verifyTreeFormat(ourVersion = 2, theirMax = 1)
        }
        assertEquals(NearbyProblem.TREE_FORMAT_TOO_NEW, failure.problem)
    }

    @Test
    fun `a device that can read a newer format than we write is fine`() {
        Negotiation.verifyTreeFormat(ourVersion = 1, theirMax = 3)
    }
}
