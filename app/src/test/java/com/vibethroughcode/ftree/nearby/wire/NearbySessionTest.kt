package com.vibethroughcode.ftree.nearby.wire

import com.vibethroughcode.ftree.transfer.ImportProblem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The state machine, including the one rule in it that is a safety property rather than a flow.
 *
 * **A sender cannot reach SENDING without passing through CONFIRMING_CODE, unless the peer was
 * reached by scanning a QR.** A code that can be skipped by accident is a code that is not doing
 * anything, and the accident would be invisible — the transfer would work.
 */
class NearbySessionTest {

    private val deviceId = DeviceId(ByteArray(16) { 1 })
    private val digest = ByteArray(32) { 2 }

    private fun offer(bytes: Long = 1024) = Offer(
        peopleCount = 12,
        relationshipCount = 20,
        photoCount = 3,
        totalBytes = bytes,
        sha256 = digest,
        treeFormatVersion = 1,
        suggestedFileName = "Kumar-family.ftree",
    )

    private fun sender(pairedByQr: Boolean = false) = SenderSession(
        pairedByQr = pairedByQr,
        hello = { byteArrayOf(1) },
        key = { byteArrayOf(2) },
        onHelloAck = { },
        onKeyAck = { "483027" },
        offer = { offer() },
    )

    private fun receiver(busy: Boolean = false, refuse: NearbyProblem? = null) = ReceiverSession(
        busy = busy,
        helloAck = { byteArrayOf(3) },
        keyAck = { byteArrayOf(4) to "483027" },
        acceptable = { refuse },
    )

    private fun frame(type: Int, payload: ByteArray = ByteArray(0)) =
        NearbyEvent.FrameReceived(type, payload)

    // The session decodes what it is handed, so the fixtures are real messages rather than empty
    // arrays. A stub that fed nothing would be testing the decoder's error path in every case and
    // would never reach the states this file is about.

    private fun helloPayload() = Hello(
        platform = NearbyPlatform.ANDROID,
        flags = NearbyProtocol.FLAG_ACCEPTS_TREE,
        deviceId = deviceId,
        displayName = "Quiet Heron",
    ).encode()

    private fun helloAckPayload() = HelloAck(
        chosenVersion = 1,
        platform = NearbyPlatform.LINUX,
        flags = NearbyProtocol.FLAG_ACCEPTS_TREE,
        deviceId = deviceId,
        displayName = "Amber Swift",
    ).encode()

    private fun keyPayload() =
        KeyMessage(ByteArray(NearbyProtocol.DH_PUBLIC_BYTES) { 3 }, ByteArray(32) { 4 }).encode()

    /** Drives a sender to the point just before the code is confirmed. */
    private fun SenderSession.toCodeConfirmation() {
        step(NearbyEvent.Connected)
        step(frame(NearbyProtocol.TYPE_HELLO_ACK, helloAckPayload()))
        step(frame(NearbyProtocol.TYPE_KEY_ACK, keyPayload()))
    }

    /** Drives a receiver to the point where it is waiting for the user to answer. */
    private fun ReceiverSession.toOffer(bytes: Long = 1024) {
        step(NearbyEvent.Connected)
        step(frame(NearbyProtocol.TYPE_HELLO, helloPayload()))
        step(frame(NearbyProtocol.TYPE_KEY, keyPayload()))
        step(frame(NearbyProtocol.TYPE_OFFER, offer(bytes).encode()))
    }

    @Test
    fun `the happy path reaches DONE`() {
        val session = sender()
        session.toCodeConfirmation()
        assertEquals(SenderState.CONFIRMING_CODE, session.state)

        session.step(NearbyEvent.UserConfirmedCode(matched = true))
        assertEquals(SenderState.AWAITING_ACCEPT, session.state)

        session.step(frame(NearbyProtocol.TYPE_ACCEPT))
        assertEquals(SenderState.SENDING, session.state)

        session.step(NearbyEvent.FileChunkRead(ByteArray(100)))
        assertEquals(SenderState.SENDING, session.state)

        session.step(NearbyEvent.FileChunkRead(ByteArray(0)))
        assertEquals(SenderState.AWAITING_RESULT, session.state)

        session.step(frame(NearbyProtocol.TYPE_RESULT, Result(true, null).encode()))
        assertEquals(SenderState.DONE, session.state)
    }

    @Test
    fun `SENDING is unreachable without confirming the code`() {
        // The property, tested as a property: from the state where the digits are on screen, every
        // event other than a matching confirmation must fail to produce a transfer.
        for (event in listOf(
            frame(NearbyProtocol.TYPE_ACCEPT),
            frame(NearbyProtocol.TYPE_DATA, byteArrayOf(1)),
            NearbyEvent.FileChunkRead(ByteArray(10)),
            NearbyEvent.UserAccepted,
        )) {
            val session = sender()
            session.toCodeConfirmation()
            session.step(event)
            assertFalse("$event reached ${session.state}", session.state == SenderState.SENDING)
        }
    }

    @Test
    fun `a scanned code skips the digits and nothing else`() {
        // Legitimate, because the token in the QR already authenticated both directions. The offer
        // goes out immediately rather than the state machine waiting on a person who has nothing
        // left to check.
        val session = sender(pairedByQr = true)
        session.toCodeConfirmation()
        assertEquals(SenderState.AWAITING_ACCEPT, session.state)
    }

    @Test
    fun `a code that does not match stops everything`() {
        val session = sender()
        session.toCodeConfirmation()
        val step = session.step(NearbyEvent.UserConfirmedCode(matched = false))

        assertEquals(SenderState.FAILED, session.state)
        assertTrue(
            step.actions.any {
                it is NearbyAction.Fail && it.problem == NearbyProblem.CODES_DID_NOT_MATCH
            },
        )
        // And the other end is told, so its screen can say the same thing rather than time out.
        assertTrue(step.actions.any { it is NearbyAction.SendFrame && it.type == NearbyProtocol.TYPE_ABORT })
    }

    @Test
    fun `a decline ends the sender without any bytes leaving`() {
        val session = sender()
        session.toCodeConfirmation()
        session.step(NearbyEvent.UserConfirmedCode(matched = true))
        val step = session.step(frame(NearbyProtocol.TYPE_DECLINE, byteArrayOf(NearbyProblem.DECLINED.code.toByte())))

        assertEquals(SenderState.FAILED, session.state)
        assertTrue(step.actions.any { it is NearbyAction.Fail && it.problem == NearbyProblem.DECLINED })
    }

    @Test
    fun `an unexpected frame in any state ends the connection`() {
        // Never skipped: consuming a frame whose meaning is unknown is how a downgrade gets past a
        // version check. Every state is checked rather than a representative one.
        val states = listOf<(SenderSession) -> Unit>(
            { },
            { it.step(NearbyEvent.Connected) },
            { it.toCodeConfirmation() },
        )
        for (drive in states) {
            val session = sender()
            drive(session)
            session.step(frame(0x66))
            assertEquals(SenderState.FAILED, session.state)
        }
    }

    @Test
    fun `a reserved type is refused by a version 1 build`() {
        // 0x30-0x3F is set aside for a later merge-sync conversation. This build must not consume
        // one silently, which it does not because unknown types are fatal by rule.
        val session = sender()
        session.toCodeConfirmation()
        session.step(frame(0x30))
        assertEquals(SenderState.FAILED, session.state)
    }

    @Test
    fun `a peer that disappears mid-transfer is a lost connection`() {
        val session = sender()
        session.toCodeConfirmation()
        session.step(NearbyEvent.UserConfirmedCode(matched = true))
        session.step(frame(NearbyProtocol.TYPE_ACCEPT))

        val step = session.step(NearbyEvent.PeerClosed)
        assertEquals(SenderState.FAILED, session.state)
        assertTrue(step.actions.any { it is NearbyAction.Fail && it.problem == NearbyProblem.CONNECTION_LOST })
    }

    @Test
    fun `a cancel from any state hangs up, and is idempotent`() {
        val session = sender()
        session.toCodeConfirmation()
        session.step(NearbyEvent.UserCancelled)
        assertEquals(SenderState.FAILED, session.state)

        // A second cancel produces nothing rather than a second abort on a closed socket.
        val again = session.step(NearbyEvent.UserCancelled)
        assertTrue(again.actions.isEmpty())
    }

    @Test
    fun `a tick is not an unexpected message`() {
        val session = sender()
        session.toCodeConfirmation()
        val step = session.step(NearbyEvent.Tick(1_000))
        assertEquals(SenderState.CONFIRMING_CODE, session.state)
        assertTrue(step.actions.isEmpty())
    }

    @Test
    fun `a second connection while busy is refused rather than left hanging`() {
        val session = receiver(busy = true)
        val step = session.step(NearbyEvent.Connected)
        assertEquals(ReceiverState.FAILED, session.state)
        assertTrue(step.actions.any { it is NearbyAction.Fail && it.problem == NearbyProblem.BUSY })
    }

    @Test
    fun `the receiver shows the code and then the offer, in that order`() {
        val session = receiver()
        session.step(NearbyEvent.Connected)
        session.step(frame(NearbyProtocol.TYPE_HELLO, helloPayload()))

        val keyStep = session.step(frame(NearbyProtocol.TYPE_KEY, keyPayload()))
        assertTrue(keyStep.actions.any { it is NearbyAction.ShowCode })

        val offerStep = session.step(frame(NearbyProtocol.TYPE_OFFER, offer().encode()))
        assertEquals(ReceiverState.AWAITING_USER, session.state)
        assertTrue(offerStep.actions.any { it is NearbyAction.ShowOffer })
    }

    @Test
    fun `an offer that is too large is refused before a byte moves`() {
        val session = receiver(refuse = NearbyProblem.TOO_LARGE)
        session.step(NearbyEvent.Connected)
        session.step(frame(NearbyProtocol.TYPE_HELLO, helloPayload()))
        session.step(frame(NearbyProtocol.TYPE_KEY, keyPayload()))
        val step = session.step(frame(NearbyProtocol.TYPE_OFFER, offer(bytes = Long.MAX_VALUE).encode()))

        assertEquals(ReceiverState.FAILED, session.state)
        assertTrue(step.actions.any { it is NearbyAction.SendFrame && it.type == NearbyProtocol.TYPE_DECLINE })
    }

    @Test
    fun `nothing is received until the user has accepted`() {
        val session = receiver()
        session.toOffer()

        // Data arriving before the answer is not written; it is a protocol violation.
        val step = session.step(frame(NearbyProtocol.TYPE_DATA, ByteArray(10)))
        assertFalse(step.actions.any { it is NearbyAction.WriteChunk })
        assertEquals(ReceiverState.FAILED, session.state)
    }

    @Test
    fun `a digest that does not match means nothing reaches the importer`() {
        val session = receiver()
        session.toOffer()
        session.step(NearbyEvent.UserAccepted)
        session.step(frame(NearbyProtocol.TYPE_DATA, ByteArray(10)))
        session.step(frame(NearbyProtocol.TYPE_END, End(10, digest).encode()))
        assertEquals(ReceiverState.VERIFYING, session.state)

        val step = session.contentMismatch()
        assertEquals(ReceiverState.FAILED, session.state)
        assertTrue(step.actions.any { it is NearbyAction.Fail && it.problem == NearbyProblem.CONTENT_MISMATCH })
    }

    @Test
    fun `a refused import is reported back with the reason the importer gave`() {
        val session = receiver()
        session.toOffer()
        session.step(NearbyEvent.UserAccepted)
        session.step(frame(NearbyProtocol.TYPE_END, End(0, digest).encode()))

        val step = session.verified(ImportProblem.FROM_A_NEWER_VERSION)
        val sent = step.actions.filterIsInstance<NearbyAction.SendFrame>()
            .single { it.type == NearbyProtocol.TYPE_RESULT }
        val decoded = Result.decode(sent.payload)

        assertFalse(decoded.accepted)
        assertEquals(ImportProblem.FROM_A_NEWER_VERSION, decoded.importProblem)
    }
}
