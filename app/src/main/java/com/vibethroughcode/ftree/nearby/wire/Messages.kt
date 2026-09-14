package com.vibethroughcode.ftree.nearby.wire

import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.HANDSHAKE_NONCE_BYTES
import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.MAGIC
import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.MIN_VERSION
import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.OFFER_MAX_NAME_BYTES
import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.ROLE_RECEIVER
import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.ROLE_SENDER
import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.TYPE_HELLO
import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.TYPE_HELLO_ACK
import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.TYPE_KEY
import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.TYPE_KEY_ACK
import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.VERSION
import com.vibethroughcode.ftree.transfer.ImportProblem
import com.vibethroughcode.ftree.transfer.TreeDocument

/**
 * The messages, as fixed binary.
 *
 * Not JSON, and the reason is narrow rather than aesthetic: the first four of these feed a
 * transcript hash. JSON key order is not a contract, so two implementations that agreed on every
 * field and disagreed on their order would derive different keys and show two different six-digit
 * codes — and the two people holding the phones would correctly conclude that something was wrong,
 * and incorrectly conclude what. Offsets cannot drift the way key order can.
 */

/**
 * The opening frame. Names a version range, a role, what `.ftree` versions this device can write
 * and read, and who it says it is.
 *
 * [treeFormatMin] and [treeFormatMax] are the **document** version — `TreeDocument.VERSION` — and
 * not this protocol's. They are carried here so that a sender whose file is too new for the
 * receiver finds out in the first exchange, rather than after pushing four megabytes of somebody's
 * family across a room. Two version numbers on two independent axes, which is the whole reason
 * there are two.
 */
data class Hello(
    val maxVersion: Int = VERSION,
    val minVersion: Int = MIN_VERSION,
    val role: Int = ROLE_SENDER,
    val platform: NearbyPlatform,
    val flags: Int,
    val deviceId: DeviceId,
    val treeFormatMin: Int = TreeDocument.VERSION,
    val treeFormatMax: Int = TreeDocument.VERSION,
    val displayName: String,
) {
    fun encode(): ByteArray = writeGreeting(
        first = maxVersion,
        second = minVersion,
        role = role,
        platform = platform,
        flags = flags,
        deviceId = deviceId,
        treeFormatMin = treeFormatMin,
        treeFormatMax = treeFormatMax,
        displayName = displayName,
    )

    companion object {
        fun decode(payload: ByteArray): Hello {
            val reader = ByteReader(payload)
            val g = readGreeting(reader)
            reader.ignoreRest()
            if (g.role != ROLE_SENDER) throw NearbyFailure(NearbyProblem.UNEXPECTED_MESSAGE)
            return Hello(
                maxVersion = g.first,
                minVersion = g.second,
                role = g.role,
                platform = g.platform,
                flags = g.flags,
                deviceId = g.deviceId,
                treeFormatMin = g.treeFormatMin,
                treeFormatMax = g.treeFormatMax,
                displayName = g.displayName,
            )
        }
    }
}

/**
 * The receiver's answer. It **states** the chosen version and the negotiated flags rather than
 * proposing them, and the sender then checks that what it was told is something it actually
 * offered — see [Negotiation.verifyChosen]. A receiver must not be able to name a version the
 * sender never put on the table.
 *
 * It also carries [keyCommitment], the receiver's promise of the key and nonce it will send in
 * `KEY_ACK` — see [Handshake.keyCommitment] for why the six digits mean nothing without it. It sits
 * after the name, at the end, so the greeting both messages share keeps one layout.
 */
data class HelloAck(
    val chosenVersion: Int,
    val role: Int = ROLE_RECEIVER,
    val platform: NearbyPlatform,
    val flags: Int,
    val deviceId: DeviceId,
    val treeFormatMin: Int = TreeDocument.VERSION,
    val treeFormatMax: Int = TreeDocument.VERSION,
    val displayName: String,
    val keyCommitment: ByteArray,
) {
    init {
        require(keyCommitment.size == NearbyProtocol.KEY_COMMITMENT_BYTES) {
            "key commitment must be ${NearbyProtocol.KEY_COMMITMENT_BYTES} bytes"
        }
    }

    fun encode(): ByteArray = writeGreeting(
        first = chosenVersion,
        second = 0,
        role = role,
        platform = platform,
        flags = flags,
        deviceId = deviceId,
        treeFormatMin = treeFormatMin,
        treeFormatMax = treeFormatMax,
        displayName = displayName,
    ) + keyCommitment

    override fun equals(other: Any?): Boolean =
        this === other || (
            other is HelloAck &&
                chosenVersion == other.chosenVersion &&
                role == other.role &&
                platform == other.platform &&
                flags == other.flags &&
                deviceId == other.deviceId &&
                treeFormatMin == other.treeFormatMin &&
                treeFormatMax == other.treeFormatMax &&
                displayName == other.displayName &&
                keyCommitment.contentEquals(other.keyCommitment)
            )

    override fun hashCode(): Int {
        var result = chosenVersion
        result = 31 * result + deviceId.hashCode()
        result = 31 * result + displayName.hashCode()
        return 31 * result + keyCommitment.contentHashCode()
    }

    companion object {
        fun decode(payload: ByteArray): HelloAck {
            val reader = ByteReader(payload)
            val g = readGreeting(reader)
            // The role first: a HELLO sent back at a sender is the wrong message, not a short one.
            if (g.role != ROLE_RECEIVER) throw NearbyFailure(NearbyProblem.UNEXPECTED_MESSAGE)
            val commitment = reader.bytes(NearbyProtocol.KEY_COMMITMENT_BYTES)
            reader.ignoreRest()
            return HelloAck(
                chosenVersion = g.first,
                role = g.role,
                platform = g.platform,
                flags = g.flags,
                deviceId = g.deviceId,
                treeFormatMin = g.treeFormatMin,
                treeFormatMax = g.treeFormatMax,
                displayName = g.displayName,
                keyCommitment = commitment,
            )
        }
    }
}

/** `KEY` and `KEY_ACK` are the same 288 bytes in both directions. */
data class KeyMessage(val publicKey: ByteArray, val nonce: ByteArray) {
    init {
        require(publicKey.size == NearbyProtocol.DH_PUBLIC_BYTES) { "public key must be 256 bytes" }
        require(nonce.size == HANDSHAKE_NONCE_BYTES) { "nonce must be 32 bytes" }
    }

    fun encode(): ByteArray = ByteWriter(NearbyProtocol.DH_PUBLIC_BYTES + HANDSHAKE_NONCE_BYTES)
        .bytes(publicKey)
        .bytes(nonce)
        .toByteArray()

    override fun equals(other: Any?): Boolean =
        this === other || (
            other is KeyMessage &&
                publicKey.contentEquals(other.publicKey) &&
                nonce.contentEquals(other.nonce)
            )

    override fun hashCode(): Int = 31 * publicKey.contentHashCode() + nonce.contentHashCode()

    override fun toString(): String = "KeyMessage(256-byte public key)"

    companion object {
        fun decode(payload: ByteArray): KeyMessage {
            val reader = ByteReader(payload)
            return KeyMessage(
                publicKey = reader.bytes(NearbyProtocol.DH_PUBLIC_BYTES),
                nonce = reader.bytes(HANDSHAKE_NONCE_BYTES),
            )
        }
    }
}

/**
 * What is about to be sent, described before it is.
 *
 * The counts are shown in the prompt that asks whether to accept. They are what the *sender* claims
 * — the real ones are whatever the importer finds after the file has arrived and been read — and
 * the screen says so, because a number presented as fact and then contradicted is worse than no
 * number at all.
 */
data class Offer(
    val peopleCount: Int,
    val relationshipCount: Int,
    val photoCount: Int,
    val totalBytes: Long,
    val sha256: ByteArray,
    val treeFormatVersion: Int,
    val suggestedFileName: String,
) {
    init {
        require(sha256.size == 32) { "sha-256 is 32 bytes" }
    }

    fun encode(): ByteArray {
        val name = NearbyNames.truncateToBytes(suggestedFileName, OFFER_MAX_NAME_BYTES)
            .toByteArray(Charsets.UTF_8)
        return ByteWriter(54 + name.size)
            .u32(peopleCount)
            .u32(relationshipCount)
            .u32(photoCount)
            .u64(totalBytes)
            .bytes(sha256)
            .u8(treeFormatVersion)
            .lengthPrefixed(name, OFFER_MAX_NAME_BYTES)
            .toByteArray()
    }

    override fun equals(other: Any?): Boolean =
        this === other || (
            other is Offer &&
                peopleCount == other.peopleCount &&
                relationshipCount == other.relationshipCount &&
                photoCount == other.photoCount &&
                totalBytes == other.totalBytes &&
                sha256.contentEquals(other.sha256) &&
                treeFormatVersion == other.treeFormatVersion &&
                suggestedFileName == other.suggestedFileName
            )

    override fun hashCode(): Int {
        var result = peopleCount
        result = 31 * result + relationshipCount
        result = 31 * result + photoCount
        result = 31 * result + totalBytes.hashCode()
        result = 31 * result + sha256.contentHashCode()
        result = 31 * result + treeFormatVersion
        return 31 * result + suggestedFileName.hashCode()
    }

    companion object {
        fun decode(payload: ByteArray): Offer {
            val reader = ByteReader(payload)
            val offer = Offer(
                peopleCount = reader.u32(),
                relationshipCount = reader.u32(),
                photoCount = reader.u32(),
                totalBytes = reader.u64(),
                sha256 = reader.bytes(32),
                treeFormatVersion = reader.u8(),
                suggestedFileName = String(reader.lengthPrefixed(), Charsets.UTF_8),
            )
            reader.ignoreRest()
            return offer
        }
    }
}

/** The last frame of a transfer, carrying what the sender believes it sent. */
data class End(val bytesSent: Long, val sha256: ByteArray) {
    init {
        require(sha256.size == 32) { "sha-256 is 32 bytes" }
    }

    fun encode(): ByteArray = ByteWriter(40).u64(bytesSent).bytes(sha256).toByteArray()

    override fun equals(other: Any?): Boolean =
        this === other ||
            (other is End && bytesSent == other.bytesSent && sha256.contentEquals(other.sha256))

    override fun hashCode(): Int = 31 * bytesSent.hashCode() + sha256.contentHashCode()

    companion object {
        fun decode(payload: ByteArray): End {
            val reader = ByteReader(payload)
            return End(bytesSent = reader.u64(), sha256 = reader.bytes(32))
        }
    }
}

/**
 * Whether the file could be read, sent once the import has been *prepared* and before anybody has
 * reviewed it.
 *
 * Preparing needs no human, so the socket is held for a second at most, and the sender learns
 * something true and useful: that what it sent was readable. Its screen then says the tree is being
 * looked at, rather than implying the story ended when the last byte left.
 */
data class Result(val accepted: Boolean, val importProblem: ImportProblem?) {

    fun encode(): ByteArray = ByteWriter(2)
        .u8(if (accepted) 0 else 1)
        .u8(importProblem?.let { ImportProblemCodes.codeOf(it) } ?: 0)
        .toByteArray()

    companion object {
        fun decode(payload: ByteArray): Result {
            val reader = ByteReader(payload)
            val accepted = reader.u8() == 0
            val problem = ImportProblemCodes.problemOf(reader.u8())
            reader.ignoreRest()
            return Result(accepted, problem)
        }
    }
}

/** A reason and nothing else. Free text would be a stranger's words in somebody's log. */
data class Abort(val problem: NearbyProblem) {
    fun encode(): ByteArray = byteArrayOf(problem.code.toByte())

    companion object {
        fun decode(payload: ByteArray): Abort {
            if (payload.isEmpty()) return Abort(NearbyProblem.UNKNOWN)
            return Abort(NearbyProblem.fromCode(payload[0].toInt() and 0xFF))
        }
    }
}

// HELLO and HELLO_ACK differ only in what bytes 4 and 5 mean, so they share one shape. ------------

private class Greeting(
    val first: Int,
    val second: Int,
    val role: Int,
    val platform: NearbyPlatform,
    val flags: Int,
    val deviceId: DeviceId,
    val treeFormatMin: Int,
    val treeFormatMax: Int,
    val displayName: String,
)

private fun writeGreeting(
    first: Int,
    second: Int,
    role: Int,
    platform: NearbyPlatform,
    flags: Int,
    deviceId: DeviceId,
    treeFormatMin: Int,
    treeFormatMax: Int,
    displayName: String,
): ByteArray {
    val name = NearbyNames.truncateToBytes(displayName, NearbyProtocol.BEACON_MAX_NAME_BYTES)
        .ifEmpty { NearbyNames.friendlyName(deviceId.bytes) }
        .toByteArray(Charsets.UTF_8)
    return ByteWriter(29 + name.size)
        .bytes(MAGIC)
        .u8(first)
        .u8(second)
        .u8(role)
        .u8(platform.code)
        .u16(flags)
        .bytes(deviceId.bytes)
        .u8(treeFormatMin)
        .u8(treeFormatMax)
        .lengthPrefixed(name, NearbyProtocol.BEACON_MAX_NAME_BYTES)
        .toByteArray()
}

/**
 * Reads the shared greeting and stops, so each message decides what may follow it. Bytes past the
 * end of what a message knows are ignored by the caller, which is what lets a later version append.
 */
private fun readGreeting(reader: ByteReader): Greeting {
    val magic = reader.bytes(MAGIC.size)
    if (!magic.contentEquals(MAGIC)) throw NearbyFailure(NearbyProblem.NOT_A_NEARBY_PEER)

    val first = reader.u8()
    val second = reader.u8()
    val role = reader.u8()
    val platform = NearbyPlatform.fromCode(reader.u8())
    val flags = reader.u16()
    val deviceId = DeviceId(reader.bytes(16))
    val treeFormatMin = reader.u8()
    val treeFormatMax = reader.u8()
    val nameBytes = reader.lengthPrefixed()

    val raw = String(nameBytes, Charsets.UTF_8)
    return Greeting(
        first = first,
        second = second,
        role = role,
        platform = platform,
        flags = flags,
        deviceId = deviceId,
        treeFormatMin = treeFormatMin,
        treeFormatMax = treeFormatMax,
        displayName = NearbyNames.sanitise(raw) ?: NearbyNames.friendlyName(deviceId.bytes),
    )
}

/** Which frame types carry one of the messages above, for a reader that has only the type byte. */
internal val HANDSHAKE_TYPES = setOf(TYPE_HELLO, TYPE_HELLO_ACK, TYPE_KEY, TYPE_KEY_ACK)
