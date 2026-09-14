package com.vibethroughcode.ftree.nearby.wire

import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.GCM_TAG_BITS
import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.GCM_TAG_BYTES
import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.MAX_PLAINTEXT
import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.NONCE_BYTES
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * AES-256-GCM for one frame.
 *
 * Deterministic given its arguments — the nonce is derived, never drawn — so the whole module is a
 * pure function and the shared vectors pin it byte for byte in both languages.
 */
object FrameCrypto {

    /**
     * `direction(4) || sequence(8)`, and it is never transmitted.
     *
     * Counters rather than random nonces, which is the opposite of the usual advice and is right
     * here. A 96-bit random nonce carries a birthday risk, and worse, a poorly seeded generator on
     * a phone can repeat one outright — and reusing a GCM nonce does not merely expose one message,
     * it exposes the authentication key and forges every frame after it. A counter cannot repeat
     * before it wraps, which at 2^64 frames of 64 KiB it will not, and the key cannot carry over
     * from a previous session because both ends contribute a fresh nonce to the salt.
     *
     * It also gives replay and reorder detection for nothing, and being deterministic it is
     * testable, which a random nonce is not.
     */
    fun nonceFor(direction: Int, sequence: Long): ByteArray {
        val nonce = ByteArray(NONCE_BYTES)
        nonce[0] = (direction ushr 24).toByte()
        nonce[1] = (direction ushr 16).toByte()
        nonce[2] = (direction ushr 8).toByte()
        nonce[3] = direction.toByte()
        for (i in 0 until 8) {
            nonce[4 + i] = (sequence ushr (56 - 8 * i)).toByte()
        }
        return nonce
    }

    /**
     * `length(4) || type(1) || nonce(12)`.
     *
     * The type is bound so a frame cannot be replayed as a different one, and the nonce is bound so
     * the sequence is covered even though it never goes on the wire. The length is the value that
     * will be in the header the receiver has already read.
     */
    fun associatedData(type: Int, ciphertextLength: Int, nonce: ByteArray): ByteArray {
        val body = 1 + ciphertextLength
        val aad = ByteArray(5 + NONCE_BYTES)
        aad[0] = (body ushr 24).toByte()
        aad[1] = (body ushr 16).toByte()
        aad[2] = (body ushr 8).toByte()
        aad[3] = body.toByte()
        aad[4] = type.toByte()
        nonce.copyInto(aad, 5)
        return aad
    }

    fun seal(key: ByteArray, direction: Int, sequence: Long, type: Int, plaintext: ByteArray): ByteArray {
        require(plaintext.size <= MAX_PLAINTEXT) { "plaintext too large: ${plaintext.size}" }
        val nonce = nonceFor(direction, sequence)
        val aad = associatedData(type, plaintext.size + GCM_TAG_BYTES, nonce)
        return cipher(Cipher.ENCRYPT_MODE, key, nonce, aad).doFinal(plaintext)
    }

    /**
     * @throws NearbyFailure if the tag does not verify. Fatal, with no retry, because there is
     * nothing a retry could fix: either the key is wrong — a stale code, or somebody in between —
     * or the bytes were altered. [firstFrame] separates those two for the person reading the
     * screen, since a failure on the very first encrypted frame means the pairing was wrong rather
     * than that the connection went bad halfway through.
     */
    fun open(
        key: ByteArray,
        direction: Int,
        sequence: Long,
        type: Int,
        sealed: ByteArray,
        firstFrame: Boolean = false,
    ): ByteArray {
        if (sealed.size < GCM_TAG_BYTES) throw NearbyFailure(NearbyProblem.MALFORMED_FRAME)
        val nonce = nonceFor(direction, sequence)
        val aad = associatedData(type, sealed.size, nonce)
        return try {
            cipher(Cipher.DECRYPT_MODE, key, nonce, aad).doFinal(sealed)
        } catch (_: AEADBadTagException) {
            throw NearbyFailure(
                if (firstFrame) NearbyProblem.BAD_PAIRING else NearbyProblem.DECRYPT_FAILED,
            )
        }
    }

    private fun cipher(mode: Int, key: ByteArray, nonce: ByteArray, aad: ByteArray): Cipher =
        Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(mode, SecretKeySpec(key, "AES"), GCMParameterSpec(GCM_TAG_BITS, nonce))
            updateAAD(aad)
        }
}
