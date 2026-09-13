package com.vibethroughcode.ftree.nearby.wire

import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.KEY_FINGERPRINT_BYTES
import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.LABEL_BEACON_KEY
import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.LABEL_RECEIVER_TO_SENDER
import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.LABEL_SAS
import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.LABEL_SENDER_TO_RECEIVER
import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.LABEL_TRANSCRIPT
import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.PAIRING_TOKEN_BYTES
import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.SAS_DIGITS
import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.SAS_MODULUS
import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.SAS_RAW_BYTES
import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.SESSION_KEY_BYTES
import java.math.BigInteger
import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * A running hash of every handshake byte, in the order it crossed the wire.
 *
 * The transcript is defined as the first four frames *verbatim*, length prefixes included, rather
 * than as some structured summary of what they meant. That is deliberate and it is the cheapest
 * correctness decision in the protocol: there is no field ordering for the two languages to agree
 * on, no canonical form to get subtly wrong, and no way for a value to be covered by one side's
 * hash and not the other's. Whatever went out is what is hashed.
 */
class TranscriptHash {
    private val digest = MessageDigest.getInstance("SHA-256").apply {
        update(LABEL_TRANSCRIPT.toByteArray(Charsets.US_ASCII))
    }

    /** Feed the whole encoded frame — header and all — exactly as [encodeFrame] produced it. */
    fun add(encodedFrame: ByteArray): TranscriptHash {
        digest.update(encodedFrame)
        return this
    }

    fun value(): ByteArray = digest.clone().let { (it as MessageDigest).digest() }
}

/** What both ends derive once the handshake is done. */
data class SessionKeys(
    val senderToReceiver: ByteArray,
    val receiverToSender: ByteArray,
    val sas: String,
) {
    override fun equals(other: Any?): Boolean =
        this === other || (
            other is SessionKeys &&
                senderToReceiver.contentEquals(other.senderToReceiver) &&
                receiverToSender.contentEquals(other.receiverToSender) &&
                sas == other.sas
            )

    override fun hashCode(): Int {
        var result = senderToReceiver.contentHashCode()
        result = 31 * result + receiverToSender.contentHashCode()
        return 31 * result + sas.hashCode()
    }

    /** Keys have no business in a log line or a crash report. */
    override fun toString(): String = "SessionKeys(sas=$sas)"
}

object Handshake {

    /** Sixteen zero bytes when nothing was scanned, so the derivation has one shape, not two. */
    val NO_TOKEN = ByteArray(PAIRING_TOKEN_BYTES)

    /**
     * RFC 5869 extract.
     *
     * The salt carries the transcript *and* the pairing token, which is what makes a scanned code
     * a real shared secret: the token itself never goes on the wire, so a device that did not see
     * the screen derives a different key and its first encrypted frame simply fails to open. A
     * fingerprint alone proves the receiver to the sender; only the token proves the sender saw
     * the receiver's screen.
     */
    fun extract(transcript: ByteArray, token: ByteArray, sharedSecret: BigInteger): ByteArray {
        require(token.size == PAIRING_TOKEN_BYTES) { "token must be $PAIRING_TOKEN_BYTES bytes" }
        val salt = MessageDigest.getInstance("SHA-256").apply {
            update(transcript)
            update(token)
        }.digest()
        return hmac(salt, Dh.to256(sharedSecret))
    }

    /**
     * RFC 5869 expand, for outputs of at most one block.
     *
     * Every output this protocol asks for is 32 bytes or fewer, so the counter never passes 1 and
     * the loop the RFC describes would be a loop that runs once. Written as the single block it is,
     * with the ceiling enforced rather than assumed.
     */
    fun expand(prk: ByteArray, label: String, length: Int): ByteArray {
        require(length in 1..32) { "one block only: asked for $length" }
        val info = label.toByteArray(Charsets.US_ASCII)
        val block = hmac(prk, info + byteArrayOf(1))
        return block.copyOf(length)
    }

    fun deriveKeys(prk: ByteArray): SessionKeys = SessionKeys(
        senderToReceiver = expand(prk, LABEL_SENDER_TO_RECEIVER, SESSION_KEY_BYTES),
        receiverToSender = expand(prk, LABEL_RECEIVER_TO_SENDER, SESSION_KEY_BYTES),
        sas = sasDigits(expand(prk, LABEL_SAS, SAS_RAW_BYTES)),
    )

    /**
     * The six digits both screens show.
     *
     * Eight bytes reduced rather than four: modulo a million, a 32-bit value is biased by about one
     * in half a million, and the extra four bytes take that to one in twenty million million for no
     * cost at all.
     *
     * The number depends on the transcript *and* the shared secret, so a machine in the middle —
     * which is running two separate conversations with two different secrets — cannot make the two
     * screens agree. That is the entire security argument for the feature, which is why the copy
     * for a mismatch has to alarm rather than reassure: it means somebody is there, not that the
     * user should try again.
     */
    fun sasDigits(raw: ByteArray): String {
        require(raw.size == SAS_RAW_BYTES) { "sas needs $SAS_RAW_BYTES bytes" }
        var value = 0L
        for (byte in raw) {
            // Unsigned, assembled a byte at a time. Kotlin has no u64, and the sign bit of the
            // first byte would otherwise make this negative for half of all handshakes.
            value = (value shl 8) or (byte.toLong() and 0xFF)
        }
        // The top bit makes `value` negative as a signed Long; Java's % keeps that sign, so a
        // plain `value % SAS_MODULUS` yields a negative code for half of all handshakes.
        val reduced = java.lang.Long.remainderUnsigned(value, SAS_MODULUS)
        return reduced.toString().padStart(SAS_DIGITS, '0')
    }

    /**
     * What a receiver publishes in its beacon, so a sender can tie the device it tapped in a list
     * to the device it ends up talking to.
     *
     * Eight bytes of a hash over the device id and the receiver's long-term public value. It is not
     * a secret and it is not an authenticator — a beacon is unsigned and anybody can copy one. What
     * it does is make a *mistake* impossible: two devices on one network with the same name are
     * told apart by this, and a sender that connects to the wrong host discovers it before the
     * handshake rather than after the transfer. Proving the receiver is who it claims is the SAS's
     * job, or the QR token's.
     */
    fun beaconFingerprint(deviceId: ByteArray, publicKey: BigInteger): ByteArray =
        MessageDigest.getInstance("SHA-256").run {
            update(LABEL_BEACON_KEY.toByteArray(Charsets.US_ASCII))
            update(deviceId)
            update(Dh.to256(publicKey))
            digest().copyOf(KEY_FINGERPRINT_BYTES)
        }

    private fun hmac(key: ByteArray, message: ByteArray): ByteArray =
        Mac.getInstance("HmacSHA256").run {
            init(SecretKeySpec(key, "HmacSHA256"))
            doFinal(message)
        }
}
