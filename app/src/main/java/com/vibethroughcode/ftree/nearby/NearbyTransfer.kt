package com.vibethroughcode.ftree.nearby

import com.vibethroughcode.ftree.nearby.wire.Abort
import com.vibethroughcode.ftree.nearby.wire.Dh
import com.vibethroughcode.ftree.nearby.wire.Handshake
import com.vibethroughcode.ftree.nearby.wire.Hello
import com.vibethroughcode.ftree.nearby.wire.HelloAck
import com.vibethroughcode.ftree.nearby.wire.KeyMessage
import com.vibethroughcode.ftree.nearby.wire.NearbyAction
import com.vibethroughcode.ftree.nearby.wire.NearbyEvent
import com.vibethroughcode.ftree.nearby.wire.NearbyFailure
import com.vibethroughcode.ftree.nearby.wire.NearbyPlatform
import com.vibethroughcode.ftree.nearby.wire.NearbyProblem
import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol
import com.vibethroughcode.ftree.nearby.wire.Negotiation
import com.vibethroughcode.ftree.nearby.wire.Offer
import com.vibethroughcode.ftree.nearby.wire.ReceiverSession
import com.vibethroughcode.ftree.nearby.wire.ReceiverState
import com.vibethroughcode.ftree.nearby.wire.SenderSession
import com.vibethroughcode.ftree.nearby.wire.SenderState
import com.vibethroughcode.ftree.nearby.wire.TranscriptHash
import com.vibethroughcode.ftree.nearby.wire.encodeFrame
import com.vibethroughcode.ftree.transfer.ImportProblem
import com.vibethroughcode.ftree.transfer.TreeDocument
import java.io.File
import java.io.OutputStream
import java.math.BigInteger
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit

/**
 * What a transfer tells the screen while it is happening.
 *
 * Callbacks rather than a flow, because this runs on its own thread and the caller is the one that
 * knows which dispatcher the screen lives on. `NearbyRepository` is where these become state.
 */
interface NearbyTransferListener {
    /** Both screens should now show these six digits. */
    fun onCode(sas: String) {}
    fun onOffer(offer: Offer) {}
    fun onProgress(done: Long, total: Long) {}
    fun onFailed(problem: NearbyProblem, importProblem: ImportProblem? = null) {}
}

/** What the sender is about to offer, gathered before a socket is opened. */
data class OutgoingFile(
    val file: File,
    val peopleCount: Int,
    val relationshipCount: Int,
    val photoCount: Int,
    val suggestedFileName: String,
) {
    /**
     * Read once, before connecting, for the length and the digest.
     *
     * Both go in the OFFER so the receiver can refuse on size before a byte moves and check what
     * arrived against what was promised. Doing it here rather than while streaming is what makes
     * the number in the prompt a fact rather than an estimate.
     */
    fun describe(): Offer {
        val digest = MessageDigest.getInstance("SHA-256")
        var total = 0L
        file.inputStream().use { stream ->
            val buffer = ByteArray(NearbyProtocol.MAX_PLAINTEXT)
            while (true) {
                val read = stream.read(buffer)
                if (read <= 0) break
                digest.update(buffer, 0, read)
                total += read
            }
        }
        if (total > NearbyProtocol.MAX_OFFER_BYTES) throw NearbyFailure(NearbyProblem.TOO_LARGE)
        return Offer(
            peopleCount = peopleCount,
            relationshipCount = relationshipCount,
            photoCount = photoCount,
            totalBytes = total,
            sha256 = digest.digest(),
            treeFormatVersion = TreeDocument.VERSION,
            suggestedFileName = suggestedFileName,
        )
    }
}

/**
 * The sending half, driven on one thread.
 *
 * Blocking and synchronous on purpose. A transfer is a conversation with fixed turns — say
 * something, wait for the answer — and expressing that as a loop that reads and writes is both
 * shorter and easier to be sure of than the same thing spread across callbacks. The caller runs it
 * on a background dispatcher; nothing here touches a main thread or a database.
 */
class NearbySendTransfer(
    private val identity: NearbySelf,
    private val outgoing: OutgoingFile,
    private val pairedByQr: Boolean = false,
    private val pairingToken: ByteArray = Handshake.NO_TOKEN,
    private val expectedFingerprint: ByteArray? = null,
    private val listener: NearbyTransferListener,
) {

    private val privateKey = Dh.generatePrivate()
    private val publicKey = Dh.publicOf(privateKey)
    private val nonce = ByteArray(NearbyProtocol.HANDSHAKE_NONCE_BYTES)
        .also { SecureRandom().nextBytes(it) }

    private val transcript = TranscriptHash()
    private var connection: NearbyConnection? = null
    private var peer: HelloAck? = null
    private var offer: Offer? = null
    private var sent = 0L

    /** A one-slot mailbox for the answer to "do the two codes match?", which comes from a screen. */
    private val codeAnswer = ArrayBlockingQueue<Boolean>(1)
    private val cancelled = java.util.concurrent.atomic.AtomicBoolean(false)

    /**
     * The reason this transfer ended, once anything knows it.
     *
     * Kept here rather than only as a local, because the reason is usually learned *before* the
     * connection finishes dying: a receiver that declines closes its socket immediately afterwards,
     * so the sender's next write fails and would otherwise report "the connection was lost" over
     * the top of "they said no". The first answer is the true one and the second is its echo.
     */
    @Volatile
    private var known: NearbyProblem? = null

    fun confirmCode(matched: Boolean) {
        codeAnswer.offer(matched)
    }

    fun cancel() {
        cancelled.set(true)
        codeAnswer.offer(false)
        runCatching { connection?.close() }
    }

    /**
     * Runs the whole transfer. Returns the problem that ended it, or `null` if it finished.
     *
     * Every exit closes the channel, including the ones that throw, because a socket left open on a
     * phone is a socket that stays open until the process dies.
     */
    fun run(channel: NearbyChannel): NearbyProblem? = channel.use {
        val described = try {
            outgoing.describe()
        } catch (failure: NearbyFailure) {
            listener.onFailed(failure.problem)
            return failure.problem
        }
        offer = described

        val link = NearbyConnection(
            input = channel.input,
            output = channel.output,
            sendDirection = NearbyProtocol.DIRECTION_SENDER_TO_RECEIVER,
            receiveDirection = NearbyProtocol.DIRECTION_RECEIVER_TO_SENDER,
        )
        connection = link

        val session = SenderSession(
            pairedByQr = pairedByQr,
            hello = { hello() },
            key = { key() },
            onHelloAck = { ack -> onHelloAck(ack) },
            onKeyAck = { ack -> onKeyAck(ack, link) },
            offer = { described },
        )

        return try {
            drive(session, link)
        } catch (failure: NearbyFailure) {
            known = known ?: failure.problem
            runCatching { link.send(NearbyProtocol.TYPE_ABORT, Abort(failure.problem).encode()) }
            listener.onFailed(known!!, failure.importProblem)
            known
        } catch (_: Exception) {
            // A dead socket after the reason is known is the reason's echo, not a second failure.
            val problem = known ?: NearbyProblem.CONNECTION_LOST
            listener.onFailed(problem)
            problem
        } finally {
            runCatching { link.close() }
        }
    }

    private fun drive(session: SenderSession, link: NearbyConnection): NearbyProblem? {
        var problem: NearbyProblem? = null
        var importProblem: ImportProblem? = null

        fun perform(actions: List<NearbyAction>) {
            for (action in actions) {
                when (action) {
                    // Best-effort. Telling a peer why we stopped is a courtesy, and by the time
                    // this runs the peer is often the reason we stopped and has already gone.
                    is NearbyAction.SendFrame ->
                        runCatching { link.send(action.type, action.payload, transcript) }
                    is NearbyAction.ShowCode -> listener.onCode(action.sas)
                    is NearbyAction.ReadMoreOfTheFile -> Unit // driven by the loop below
                    is NearbyAction.Fail -> {
                        problem = action.problem
                        importProblem = action.importProblem
                        known = known ?: action.problem
                    }
                    else -> Unit
                }
            }
        }

        perform(session.step(NearbyEvent.Connected).actions)

        outgoing.file.inputStream().use { file ->
            val buffer = ByteArray(NearbyProtocol.MAX_PLAINTEXT)
            while (session.state != SenderState.DONE && session.state != SenderState.FAILED) {
                if (cancelled.get()) {
                    perform(session.step(NearbyEvent.UserCancelled).actions)
                    break
                }
                when (session.state) {
                    SenderState.CONFIRMING_CODE -> {
                        // Blocks on a person, so the timeout is the one for a person rather than the
                        // one for a socket.
                        val matched = codeAnswer.poll(
                            NearbyProtocol.USER_DECISION_TIMEOUT_MS.toLong(),
                            TimeUnit.MILLISECONDS,
                        )
                        if (matched == null) {
                            perform(session.step(NearbyEvent.UserCancelled).actions)
                            problem = NearbyProblem.TIMED_OUT
                            break
                        }
                        perform(session.step(NearbyEvent.UserConfirmedCode(matched)).actions)
                    }

                    SenderState.SENDING -> {
                        val read = file.read(buffer)
                        val chunk = if (read <= 0) ByteArray(0) else buffer.copyOf(read)
                        if (read > 0) {
                            sent += read
                            listener.onProgress(sent, offer?.totalBytes ?: 0L)
                        }
                        perform(session.step(NearbyEvent.FileChunkRead(chunk)).actions)
                    }

                    else -> {
                        val frame = link.read(transcript)
                        if (frame == null) {
                            perform(session.step(NearbyEvent.PeerClosed).actions)
                            break
                        }
                        if (frame.type == NearbyProtocol.TYPE_ABORT) {
                            problem = Abort.decode(frame.payload).problem
                            known = known ?: problem
                            break
                        }
                        if (frame.type == NearbyProtocol.TYPE_DECLINE) {
                            // A DECLINE carries the reason in its first byte, and it is worth
                            // reading rather than flattening to "they said no": TOO_LARGE and
                            // TREE_FORMAT_TOO_NEW are refusals the *device* made about the file,
                            // and the person who pressed send never declined anything. They need
                            // different sentences, and one of them is actionable.
                            known = if (frame.payload.isNotEmpty()) {
                                NearbyProblem.fromCode(frame.payload[0].toInt() and 0xFF)
                            } else {
                                NearbyProblem.DECLINED
                            }
                        }
                        perform(session.step(NearbyEvent.FrameReceived(frame.type, frame.payload)).actions)
                        if (known != null && frame.type == NearbyProtocol.TYPE_DECLINE) {
                            problem = known
                            break
                        }
                    }
                }
            }
        }

        if (problem != null) listener.onFailed(problem!!, importProblem)
        return problem
    }

    private fun hello(): ByteArray = Hello(
        platform = NearbyPlatform.ANDROID,
        flags = NearbyProtocol.SUPPORTED_FLAGS,
        deviceId = identity.deviceId,
        displayName = identity.displayName,
    ).encode()

    private fun key(): ByteArray = KeyMessage(
        publicKey = Dh.to256(publicKey),
        nonce = nonce,
    ).encode()

    private fun onHelloAck(ack: HelloAck) {
        // What the receiver *stated*, checked against what this side actually offered. The
        // transcript already makes lying about it impossible; this makes getting it wrong by
        // accident impossible, which is the failure that ships.
        Negotiation.verifyChosen(
            chosen = ack.chosenVersion,
            statedFlags = ack.flags,
            senderMax = NearbyProtocol.VERSION,
            senderMin = NearbyProtocol.MIN_VERSION,
            senderFlags = NearbyProtocol.SUPPORTED_FLAGS,
            receiverBeaconFlags = NearbyProtocol.SUPPORTED_FLAGS,
        )
        Negotiation.verifyTreeFormat(TreeDocument.VERSION, ack.treeFormatMax)
        peer = ack
    }

    private fun onKeyAck(ack: KeyMessage, link: NearbyConnection): String {
        val peerPublic = BigInteger(1, ack.publicKey)

        // Before anything else, and before any code exists to show: the key and nonce must be the
        // ones promised in HELLO_ACK, fixed before this side's nonce was sent. A receiver that
        // could choose them afterwards could choose the six digits. See Handshake.keyCommitment.
        val promised = Handshake.keyCommitment(peerPublic, ack.nonce)
        if (!MessageDigest.isEqual(promised, peer!!.keyCommitment)) {
            throw NearbyFailure(NearbyProblem.KEY_NOT_AS_PROMISED)
        }

        // The device that was tapped in the list against the device that actually answered. Not an
        // authenticator — a beacon is unsigned and anybody can copy one — but it turns "I reached
        // the wrong host" into a refusal here rather than a transfer that completes to a stranger.
        expectedFingerprint?.let { expected ->
            val actual = Handshake.beaconFingerprint(peer!!.deviceId.bytes, peerPublic)
            if (!actual.contentEquals(expected)) throw NearbyFailure(NearbyProblem.WRONG_DEVICE)
        }

        val shared = Dh.sharedSecret(privateKey, peerPublic)
        val transcriptValue = transcript.value()
        val keys = Handshake.deriveKeys(Handshake.extract(transcriptValue, pairingToken, shared))
        link.secure(sendKey = keys.senderToReceiver, receiveKey = keys.receiverToSender)
        return keys.sas
    }
}

/**
 * The receiving half. Consent lives here, which is why this side is the one that advertises.
 *
 * Writes to a [OutputStream] the caller owns, so this class never decides where a file lands, and
 * hands the caller a digest at the end so it can check what arrived against what was promised.
 */
class NearbyReceiveTransfer(
    private val identity: NearbySelf,
    private val beaconPrivateKey: BigInteger,
    private val beaconPublicKey: BigInteger,
    private val sink: OutputStream,
    private val busy: Boolean = false,
    private val pairingToken: ByteArray = Handshake.NO_TOKEN,
    private val maxOfferBytes: Long = NearbyProtocol.MAX_OFFER_BYTES.toLong(),
    private val listener: NearbyTransferListener,
) {

    private val nonce = ByteArray(NearbyProtocol.HANDSHAKE_NONCE_BYTES)
        .also { SecureRandom().nextBytes(it) }
    private val transcript = TranscriptHash()
    private val digest = MessageDigest.getInstance("SHA-256")

    private var connection: NearbyConnection? = null
    private var pendingSendKey: ByteArray? = null
    private var pendingReceiveKey: ByteArray? = null
    private var offer: Offer? = null
    private var received = 0L

    private val userAnswer = ArrayBlockingQueue<Boolean>(1)
    private val cancelled = java.util.concurrent.atomic.AtomicBoolean(false)

    /** What the sender claimed, once it has arrived. Shown in the prompt as a claim. */
    val incomingOffer: Offer? get() = offer

    fun accept() {
        userAnswer.offer(true)
    }

    fun decline() {
        userAnswer.offer(false)
    }

    fun cancel() {
        cancelled.set(true)
        userAnswer.offer(false)
        runCatching { connection?.close() }
    }

    /**
     * Runs until the file is whole or the transfer fails.
     *
     * @return `null` and a complete file, or the problem that stopped it. The caller then prepares
     * the import and calls [finish], which is what tells the sender whether its file was readable.
     */
    fun run(channel: NearbyChannel): NearbyProblem? {
        val link = NearbyConnection(
            input = channel.input,
            output = channel.output,
            sendDirection = NearbyProtocol.DIRECTION_RECEIVER_TO_SENDER,
            receiveDirection = NearbyProtocol.DIRECTION_SENDER_TO_RECEIVER,
        )
        connection = link

        val session = ReceiverSession(
            busy = busy,
            helloAck = { hello -> onHello(hello) },
            keyAck = { key -> onKey(key) },
            acceptable = { incoming -> acceptable(incoming) },
        )
        this.session = session

        return try {
            drive(session, link)
        } catch (failure: NearbyFailure) {
            runCatching { link.send(NearbyProtocol.TYPE_ABORT, Abort(failure.problem).encode()) }
            listener.onFailed(failure.problem, failure.importProblem)
            failure.problem
        } catch (_: Exception) {
            listener.onFailed(NearbyProblem.CONNECTION_LOST)
            NearbyProblem.CONNECTION_LOST
        }
    }

    private var session: ReceiverSession? = null

    /**
     * The importer has looked at the file; tell the sender.
     *
     * Sent after `prepare()` and before anybody reviews, because preparing needs no human — it is a
     * copy, a parse and a duplicate match — so the socket is held a second at most and the sender
     * learns something true: that what it sent was readable. Its screen can then say the tree is
     * being looked at rather than implying the story ended when the last byte left.
     */
    fun finish(importProblem: ImportProblem?) {
        val step = session?.verified(importProblem) ?: return
        for (action in step.actions) {
            if (action is NearbyAction.SendFrame) {
                runCatching { connection?.send(action.type, action.payload) }
            }
        }
        runCatching { connection?.close() }
    }

    /** What arrived is not what was sent. Nothing is handed to the importer. */
    fun contentMismatch() {
        session?.contentMismatch()
        runCatching {
            connection?.send(
                NearbyProtocol.TYPE_ABORT,
                Abort(NearbyProblem.CONTENT_MISMATCH).encode(),
            )
        }
        runCatching { connection?.close() }
    }

    private fun drive(session: ReceiverSession, link: NearbyConnection): NearbyProblem? {
        var problem: NearbyProblem? = null

        fun perform(actions: List<NearbyAction>) {
            for (action in actions) {
                when (action) {
                    is NearbyAction.SendFrame -> {
                        // KEY_ACK was already hashed in onKey, where the derivation needed it.
                        val hashed = action.type == NearbyProtocol.TYPE_KEY_ACK
                        link.send(action.type, action.payload, if (hashed) null else transcript)
                        if (hashed) {
                            link.secure(
                                sendKey = pendingSendKey!!,
                                receiveKey = pendingReceiveKey!!,
                            )
                        }
                    }
                    is NearbyAction.ShowCode -> listener.onCode(action.sas)
                    is NearbyAction.ShowOffer -> listener.onOffer(action.offer)
                    is NearbyAction.WriteChunk -> {
                        sink.write(action.bytes)
                        digest.update(action.bytes)
                        received += action.bytes.size
                        listener.onProgress(received, offer?.totalBytes ?: 0L)
                    }
                    is NearbyAction.Fail -> problem = action.problem
                    else -> Unit
                }
            }
        }

        perform(session.step(NearbyEvent.Connected).actions)

        while (session.state != ReceiverState.VERIFYING &&
            session.state != ReceiverState.DONE &&
            session.state != ReceiverState.FAILED
        ) {
            if (cancelled.get()) {
                perform(session.step(NearbyEvent.UserCancelled).actions)
                break
            }
            if (session.state == ReceiverState.AWAITING_USER) {
                val accepted = userAnswer.poll(
                    NearbyProtocol.USER_DECISION_TIMEOUT_MS.toLong(),
                    TimeUnit.MILLISECONDS,
                )
                if (accepted == null) {
                    perform(session.step(NearbyEvent.UserCancelled).actions)
                    problem = NearbyProblem.TIMED_OUT
                    break
                }
                perform(
                    session.step(
                        if (accepted) NearbyEvent.UserAccepted else NearbyEvent.UserDeclined,
                    ).actions,
                )
                continue
            }

            val frame = link.read(transcript)
            if (frame == null) {
                perform(session.step(NearbyEvent.PeerClosed).actions)
                break
            }
            if (frame.type == NearbyProtocol.TYPE_ABORT) {
                problem = Abort.decode(frame.payload).problem
                break
            }
            perform(session.step(NearbyEvent.FrameReceived(frame.type, frame.payload)).actions)
        }

        sink.flush()

        if (problem == null && session.state == ReceiverState.VERIFYING) {
            // Length catches a truncated transfer, digest catches a corrupted one. Neither is a
            // security check — somebody who could alter the stream would alter the OFFER too — they
            // are here so a half-written file never reaches the code that reads a family.
            val expected = offer
            val lengthMatches = expected != null && received == expected.totalBytes
            val digestMatches = expected != null && digest.digest().contentEquals(expected.sha256)
            if (!lengthMatches || !digestMatches) {
                contentMismatch()
                listener.onFailed(NearbyProblem.CONTENT_MISMATCH)
                return NearbyProblem.CONTENT_MISMATCH
            }
            return null
        }

        if (problem != null) listener.onFailed(problem!!)
        return problem ?: NearbyProblem.CONNECTION_LOST
    }

    private fun onHello(hello: Hello): ByteArray {
        // Version and format settled in the first exchange, so a file too new for this build is
        // refused before four megabytes of somebody's family crosses a room.
        val chosen = Negotiation.chooseVersion(hello.maxVersion, hello.minVersion)
        Negotiation.verifyTreeFormat(TreeDocument.VERSION, hello.treeFormatMax)
        return HelloAck(
            chosenVersion = chosen,
            platform = NearbyPlatform.ANDROID,
            flags = Negotiation.negotiateFlags(hello.flags, NearbyProtocol.SUPPORTED_FLAGS),
            deviceId = identity.deviceId,
            displayName = identity.displayName,
            // The promise of what KEY_ACK will carry, made before the sender's key has been seen.
            keyCommitment = Handshake.keyCommitment(beaconPublicKey, nonce),
        ).encode()
    }

    private fun onKey(key: KeyMessage): Pair<ByteArray, String> {
        val peerPublic = BigInteger(1, key.publicKey)
        // Refused before it is used for anything: a peer sending 1 would force a shared secret of 1
        // and every later frame would be encrypted under a key it chose.
        val shared = Dh.sharedSecret(beaconPrivateKey, peerPublic)

        val reply = KeyMessage(
            publicKey = Dh.to256(beaconPublicKey),
            nonce = nonce,
        ).encode()

        // Hashed here rather than when it is written, because the derivation below needs the
        // completed transcript and the sender — which hashes this frame as it arrives — has it in
        // exactly this position.
        transcript.add(encodeFrame(NearbyProtocol.TYPE_KEY_ACK, reply))
        val keys = Handshake.deriveKeys(
            Handshake.extract(transcript.value(), pairingToken, shared),
        )
        pendingSendKey = keys.receiverToSender
        pendingReceiveKey = keys.senderToReceiver
        return reply to keys.sas
    }

    private fun acceptable(incoming: Offer): NearbyProblem? {
        offer = incoming
        return when {
            incoming.totalBytes > maxOfferBytes -> NearbyProblem.TOO_LARGE
            incoming.treeFormatVersion > TreeDocument.VERSION -> NearbyProblem.TREE_FORMAT_TOO_NEW
            else -> null
        }
    }
}
