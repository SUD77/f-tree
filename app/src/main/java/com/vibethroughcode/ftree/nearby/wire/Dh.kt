package com.vibethroughcode.ftree.nearby.wire

import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.DH_GENERATOR
import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.DH_PRIME_HEX
import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.DH_PRIVATE_BITS
import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.DH_PUBLIC_BYTES
import java.math.BigInteger
import java.security.SecureRandom

/**
 * Diffie-Hellman over RFC 3526 group 14.
 *
 * Classic finite-field DH rather than X25519, which would be the obvious modern choice, because the
 * app supports API 26 and the platform only offers X25519 from 33. The alternatives were a
 * dependency — this project's rule is that one has to earn its place — or hand-rolled curve
 * arithmetic, which is the worst way to answer a cryptographic question. `BigInteger` is in the
 * standard library, `node:crypto` has the same group on the desktop side, and modular exponentiation
 * is the one primitive both languages are guaranteed to implement identically.
 *
 * Everything here except [generatePrivate] is a pure function of its arguments, so the whole module
 * is checked against the shared vectors on the JVM.
 */
object Dh {

    val P: BigInteger = BigInteger(DH_PRIME_HEX, 16)
    val G: BigInteger = BigInteger.valueOf(DH_GENERATOR)

    private val TWO: BigInteger = BigInteger.valueOf(2L)
    private val P_MINUS_ONE: BigInteger = P.subtract(BigInteger.ONE)
    private val P_MINUS_TWO: BigInteger = P.subtract(TWO)

    /**
     * A private exponent, 256 bits rather than the group's 2048.
     *
     * The group is worth about 110 bits against the best known attack, so an exponent longer than
     * 256 protects nothing and costs about eight times the work. On a mid-range phone that is the
     * difference between a handshake nobody notices and a pause in the middle of pairing.
     */
    fun generatePrivate(random: SecureRandom = SecureRandom()): BigInteger {
        while (true) {
            val candidate = BigInteger(DH_PRIVATE_BITS, random)
            if (candidate >= TWO) return candidate
        }
    }

    fun publicOf(private: BigInteger): BigInteger = G.modPow(private, P)

    /**
     * Refuses a peer's public value before it is used for anything.
     *
     * `p` is a safe prime, so its only small subgroups are `{1}` and `{1, p-1}`. Requiring
     * `2 <= Y <= p-2` excludes both, which is the whole of small-subgroup confinement for this
     * group. Without it, a peer sending `1` forces a shared secret of `1` and every later frame is
     * encrypted under a key an attacker already knows.
     */
    fun isValidPublic(y: BigInteger): Boolean = y >= TWO && y <= P_MINUS_TWO

    /**
     * @throws NearbyFailure on a peer value that is out of range, or a shared secret that is
     * degenerate. The second check is belt and braces given the first, and costs one comparison.
     */
    fun sharedSecret(private: BigInteger, peerPublic: BigInteger): BigInteger {
        if (!isValidPublic(peerPublic)) throw NearbyFailure(NearbyProblem.BAD_PUBLIC_KEY)
        val z = peerPublic.modPow(private, P)
        if (z <= BigInteger.ONE || z == P_MINUS_ONE) {
            throw NearbyFailure(NearbyProblem.BAD_PUBLIC_KEY)
        }
        return z
    }

    /**
     * Exactly 256 bytes, big-endian, left-padded with zeros.
     *
     * The likeliest interoperability bug in the whole protocol, and it is invisible until it is not:
     *
     * - Here, `BigInteger.toByteArray()` prepends a zero sign byte whenever bit 2047 is set, giving
     *   257 bytes, and returns fewer than 256 for any smaller value.
     * - On the desktop side, Node's `computeSecret()` and `getPublicKey()` *strip* leading zeros,
     *   so a shared secret that happens to begin `0x00` — one time in 256 — comes back 255 bytes.
     *
     * Feed either of those into the key derivation unpadded and the two devices agree on a shared
     * secret and then derive different keys from it. It works two hundred and fifty-five times and
     * then quietly does not, which is why both languages call one helper and both test it against
     * the same vectors.
     */
    fun to256(value: BigInteger): ByteArray {
        val raw = value.toByteArray()
        val start = if (raw.size > 1 && raw[0] == 0.toByte()) 1 else 0
        val length = raw.size - start
        require(length <= DH_PUBLIC_BYTES) { "value wider than the group: $length bytes" }
        val out = ByteArray(DH_PUBLIC_BYTES)
        System.arraycopy(raw, start, out, DH_PUBLIC_BYTES - length, length)
        return out
    }

    /** The inverse of [to256]. Always positive: these are group elements, never signed numbers. */
    fun fromBytes(bytes: ByteArray): BigInteger = BigInteger(1, bytes)
}
