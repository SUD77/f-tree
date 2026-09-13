package com.vibethroughcode.ftree.nearby

import com.vibethroughcode.ftree.nearby.wire.DeviceId
import com.vibethroughcode.ftree.nearby.wire.Dh
import com.vibethroughcode.ftree.nearby.wire.Handshake
import com.vibethroughcode.ftree.nearby.wire.NearbyProblem
import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol
import com.vibethroughcode.ftree.nearby.wire.Offer
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.io.PipedInputStream
import java.io.PipedOutputStream
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * A whole transfer between the two halves of this implementation, on the JVM.
 *
 * Piped streams rather than sockets, deliberately: what is being tested is the conversation, and a
 * socket would add a port, a bind, a firewall and a flake to a test that is about neither. The real
 * sockets are [LanTransport], which is thin by design — a pipe and a socket present the same two
 * streams, and everything above them is this.
 *
 * CI has no emulator, so this is the only place the two halves of the Android implementation ever
 * meet before somebody runs the app on two phones.
 */
class NearbyTransferTest {

    @get:Rule
    val folder = TemporaryFolder()

    private class Pipe(
        override val input: InputStream,
        override val output: OutputStream,
        override val remoteAddress: String,
    ) : NearbyChannel {
        override fun close() {
            runCatching { output.close() }
            runCatching { input.close() }
        }
    }

    /** Two channels wired to each other, the way a connected socket pair would be. */
    private fun pair(): Pair<NearbyChannel, NearbyChannel> {
        val senderOut = PipedOutputStream()
        val receiverIn = PipedInputStream(senderOut, BUFFER)
        val receiverOut = PipedOutputStream()
        val senderIn = PipedInputStream(receiverOut, BUFFER)
        return Pipe(senderIn, senderOut, "10.0.0.1") to Pipe(receiverIn, receiverOut, "10.0.0.2")
    }

    /**
     * A device, without a `Context`.
     *
     * The reason [NearbySelf] is an interface: this test runs the whole conversation on the JVM,
     * where CI can reach it, and an identity that needed SharedPreferences would have pushed all of
     * it onto an emulator that CI does not have.
     */
    private fun identity(seed: Byte) = object : NearbySelf {
        override val deviceId = DeviceId(ByteArray(16) { seed })
        override val displayName = "Device $seed"
    }

    /** Captures what a side was told, so a test can assert on it after the threads have joined. */
    private class Recorder : NearbyTransferListener {
        var sas: String? = null
        var offer: Offer? = null
        var problem: NearbyProblem? = null
        var progress = 0L

        override fun onCode(sas: String) {
            this.sas = sas
        }

        override fun onOffer(offer: Offer) {
            this.offer = offer
        }

        override fun onProgress(done: Long, total: Long) {
            progress = done
        }

        override fun onFailed(problem: NearbyProblem, importProblem: com.vibethroughcode.ftree.transfer.ImportProblem?) {
            this.problem = problem
        }
    }

    private fun sampleFile(bytes: Int): Pair<File, ByteArray> {
        val content = ByteArray(bytes) { (it * 31).toByte() }
        val file = folder.newFile("family-$bytes.ftree")
        file.writeBytes(content)
        return file to content
    }

    /**
     * Runs both halves on their own threads and returns when both have finished.
     *
     * @param decide what the receiving side does when the offer arrives.
     * @param confirm what the sending side says when the code appears.
     */
    private fun transfer(
        fileBytes: Int = 160 * 1024,
        maxOfferBytes: Long = NearbyProtocol.MAX_OFFER_BYTES.toLong(),
        senderToken: ByteArray = Handshake.NO_TOKEN,
        receiverToken: ByteArray = Handshake.NO_TOKEN,
        pairedByQr: Boolean = false,
        busy: Boolean = false,
        confirm: Boolean = true,
        decide: Boolean = true,
    ): Result {
        val (file, content) = sampleFile(fileBytes)
        val (senderChannel, receiverChannel) = pair()
        val sink = ByteArrayOutputStream()

        val beaconPrivate = Dh.generatePrivate()
        val beaconPublic = Dh.publicOf(beaconPrivate)

        val sendRecorder = Recorder()
        val receiveRecorder = Recorder()

        val sendTransfer = NearbySendTransfer(
            identity = identity(1),
            outgoing = OutgoingFile(
                file = file,
                peopleCount = 12,
                relationshipCount = 7,
                photoCount = 3,
                suggestedFileName = "family.ftree",
            ),
            pairedByQr = pairedByQr,
            pairingToken = senderToken,
            expectedFingerprint = Handshake.beaconFingerprint(
                DeviceId(ByteArray(16) { 2 }).bytes,
                beaconPublic,
            ),
            listener = sendRecorder,
        )

        val receiveTransfer = NearbyReceiveTransfer(
            identity = identity(2),
            beaconPrivateKey = beaconPrivate,
            beaconPublicKey = beaconPublic,
            sink = sink,
            busy = busy,
            pairingToken = receiverToken,
            maxOfferBytes = maxOfferBytes,
            listener = receiveRecorder,
        )

        val done = CountDownLatch(2)
        var sendProblem: NearbyProblem? = null
        var receiveProblem: NearbyProblem? = null

        thread(name = "test-receiver") {
            receiveProblem = receiveTransfer.run(receiverChannel)
            if (receiveProblem == null) receiveTransfer.finish(null)
            done.countDown()
        }
        thread(name = "test-sender") {
            sendProblem = sendTransfer.run(senderChannel)
            done.countDown()
        }

        // Answers fed in as the two sides reach the points that need a person. Polled rather than
        // signalled because the states are reached on other threads and a test should not reach
        // into either session to find out.
        thread(name = "test-user") {
            val deadline = System.currentTimeMillis() + TIMEOUT_MS
            var confirmed = false
            var decided = false
            while (System.currentTimeMillis() < deadline && (!confirmed || !decided)) {
                if (!confirmed && sendRecorder.sas != null) {
                    sendTransfer.confirmCode(confirm)
                    confirmed = true
                }
                if (!decided && receiveRecorder.offer != null) {
                    if (decide) receiveTransfer.accept() else receiveTransfer.decline()
                    decided = true
                }
                Thread.sleep(5)
            }
            // On the QR path no code is ever shown, so nothing is waiting to be confirmed.
            if (!confirmed && pairedByQr) sendTransfer.confirmCode(true)
        }

        assertTrue("the transfer did not finish", done.await(TIMEOUT_MS, TimeUnit.MILLISECONDS))
        return Result(
            sendProblem = sendProblem,
            receiveProblem = receiveProblem,
            sent = content,
            received = sink.toByteArray(),
            senderSaw = sendRecorder,
            receiverSaw = receiveRecorder,
        )
    }

    private class Result(
        val sendProblem: NearbyProblem?,
        val receiveProblem: NearbyProblem?,
        val sent: ByteArray,
        val received: ByteArray,
        val senderSaw: Recorder,
        val receiverSaw: Recorder,
    )

    @Test
    fun `a family crosses the wire and arrives byte for byte`() {
        val result = transfer()
        assertNull("sender: ${result.sendProblem}", result.sendProblem)
        assertNull("receiver: ${result.receiveProblem}", result.receiveProblem)
        assertArrayEquals(result.sent, result.received)
    }

    @Test
    fun `both ends show the same six digits`() {
        // The entire security argument for the feature. A machine in the middle runs two
        // conversations with two different secrets and cannot make these agree.
        val result = transfer(fileBytes = 4096)
        assertNotNull(result.senderSaw.sas)
        assertNotNull(result.receiverSaw.sas)
        assertEquals(result.senderSaw.sas, result.receiverSaw.sas)
        assertEquals(6, result.senderSaw.sas!!.length)
        assertTrue(result.senderSaw.sas!!.all { it.isDigit() })
    }

    @Test
    fun `a file spanning several frames is reassembled in order`() {
        // 160 KiB over 64 KiB frames is two full frames and one short one. An implementation that
        // assumed every DATA frame was full would pass a one-frame test and truncate every real
        // tree.
        val result = transfer(fileBytes = 160 * 1024)
        assertNull(result.sendProblem)
        assertEquals(160 * 1024, result.received.size)
        assertArrayEquals(result.sent, result.received)
    }

    @Test
    fun `an empty file is a transfer rather than a hang`() {
        val result = transfer(fileBytes = 0)
        assertNull(result.sendProblem)
        assertNull(result.receiveProblem)
        assertEquals(0, result.received.size)
    }

    @Test
    fun `the offer arrives before the file, carrying what the sender claims`() {
        val result = transfer(fileBytes = 4096)
        val offer = result.receiverSaw.offer
        assertNotNull(offer)
        assertEquals(12, offer!!.peopleCount)
        assertEquals(7, offer.relationshipCount)
        assertEquals(3, offer.photoCount)
        assertEquals(4096L, offer.totalBytes)
        assertEquals("family.ftree", offer.suggestedFileName)
        // The digest is in the offer, so what arrived can be checked against what was promised
        // rather than a truncation being discovered afterwards.
        assertArrayEquals(MessageDigest.getInstance("SHA-256").digest(result.sent), offer.sha256)
    }

    @Test
    fun `a mismatched code stops everything before the offer`() {
        // The user said the screens did not match, which means somebody is there. Nothing else
        // happens: no offer, no file.
        val result = transfer(fileBytes = 4096, confirm = false)
        assertEquals(NearbyProblem.CODES_DID_NOT_MATCH, result.sendProblem)
        assertNull("an offer was sent after the codes did not match", result.receiverSaw.offer)
        assertEquals(0, result.received.size)
    }

    @Test
    fun `a declined transfer tells the sender why and writes nothing`() {
        val result = transfer(fileBytes = 4096, decide = false)
        assertEquals(NearbyProblem.DECLINED, result.sendProblem)
        assertEquals(0, result.received.size)
    }

    @Test
    fun `a second transfer is refused rather than left hanging`() {
        // A refusal somebody can read beats a connection that sits open until it times out.
        val result = transfer(fileBytes = 4096, busy = true)
        assertEquals(NearbyProblem.BUSY, result.sendProblem)
        assertEquals(0, result.received.size)
    }

    @Test
    fun `an offer past the ceiling is refused before the prompt appears`() {
        val result = transfer(fileBytes = 64 * 1024, maxOfferBytes = 1024)
        assertEquals(NearbyProblem.TOO_LARGE, result.sendProblem)
        // Nobody was asked about a file that was never going to fit.
        assertNull(result.receiverSaw.offer)
        assertEquals(0, result.received.size)
    }

    @Test
    fun `a QR pairing skips the code entirely`() {
        val token = ByteArray(NearbyProtocol.PAIRING_TOKEN_BYTES) { 0x5A }
        val result = transfer(
            fileBytes = 8192,
            senderToken = token,
            receiverToken = token,
            pairedByQr = true,
        )
        assertNull("sender: ${result.sendProblem}", result.sendProblem)
        assertNull("a code was shown on the QR path", result.senderSaw.sas)
        assertArrayEquals(result.sent, result.received)
    }

    @Test
    fun `a wrong pairing token fails on the first sealed frame`() {
        // The token never goes on the wire; both ends mix it into the salt. A sender that did not
        // see the screen derives a different key, and the failure's shape is the point: it is not
        // "the code was wrong" — no code was ever shown — it is the first sealed frame not opening,
        // which is exactly what a stale or copied pairing looks like.
        val result = transfer(
            fileBytes = 4096,
            senderToken = ByteArray(NearbyProtocol.PAIRING_TOKEN_BYTES) { 0x11 },
            receiverToken = ByteArray(NearbyProtocol.PAIRING_TOKEN_BYTES) { 0x22 },
            pairedByQr = true,
        )
        assertNotNull("a mismatched token was accepted", result.sendProblem)
        assertTrue(
            "unexpected ${result.sendProblem}",
            result.sendProblem == NearbyProblem.BAD_PAIRING ||
                result.sendProblem == NearbyProblem.CONNECTION_LOST ||
                result.sendProblem == NearbyProblem.DECRYPT_FAILED,
        )
        assertEquals(0, result.received.size)
    }

    private companion object {
        const val BUFFER = 1 shl 16
        const val TIMEOUT_MS = 30_000L
    }
}
