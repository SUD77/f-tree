package com.vibethroughcode.ftree.nearby.wire

import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.BEACON_ANNOUNCE
import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.BEACON_HEADER_SIZE
import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.BEACON_MAX_NAME_BYTES
import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.BEACON_QUERY
import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.KEY_FINGERPRINT_BYTES
import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.MAGIC
import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.MIN_VERSION
import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.VERSION

/** Which kind of machine is speaking. Shown as an icon; never trusted for anything. */
enum class NearbyPlatform(val code: Int) {
    UNKNOWN(0), ANDROID(1), LINUX(2), WINDOWS(3), MACOS(4),
    ;

    companion object {
        private val byCode = entries.associateBy { it.code }
        fun fromCode(code: Int): NearbyPlatform = byCode[code] ?: UNKNOWN
    }
}

/**
 * The 16 bytes of a UUID, as they go on the wire.
 *
 * Equality is spelled out because it has to be. A `ByteArray` compares by identity, so a wrapper
 * that inherited that would make two ids with the same bytes unequal — and every `data class` with
 * one in it, which is most of the messages, would then fail to round-trip for a reason that has
 * nothing to do with the field being examined.
 */
class DeviceId(val bytes: ByteArray) {
    init {
        require(bytes.size == 16) { "a device id is 16 bytes, not ${bytes.size}" }
    }

    fun hex(): String = bytes.joinToString("") { "%02x".format(it) }

    override fun equals(other: Any?): Boolean =
        this === other || (other is DeviceId && bytes.contentEquals(other.bytes))

    override fun hashCode(): Int = bytes.contentHashCode()

    override fun toString(): String = "DeviceId(${hex()})"

    companion object {
        val ZERO = DeviceId(ByteArray(16))
        fun parse(hex: String): DeviceId? {
            if (hex.length != 32 || !hex.all { it.isDigit() || it in 'a'..'f' || it in 'A'..'F' }) {
                return null
            }
            return DeviceId(ByteArray(16) { hex.substring(it * 2, it * 2 + 2).toInt(16).toByte() })
        }
    }
}

/**
 * What a device says about itself, twice a second, while somebody is looking at the nearby screen.
 *
 * **There is no address in here.** The address a peer is reached on is taken from the datagram's
 * source instead. That is not an omission: an address in the payload is an address a forged beacon
 * can use to point a sender at a third machine, and it is also the field that goes stale when a
 * device changes network and keeps announcing the interface it used to have. Reading it off the
 * packet makes both problems impossible rather than merely unlikely.
 */
data class Beacon(
    val messageType: Int,
    val maxVersion: Int,
    val minVersion: Int,
    val platform: NearbyPlatform,
    val flags: Int,
    val tcpPort: Int,
    val deviceId: DeviceId,
    val keyFingerprint: ByteArray,
    val displayName: String,
) {
    /** True when this build can hold a conversation with whoever sent it. */
    val speakable: Boolean get() = minVersion <= VERSION && maxVersion >= MIN_VERSION

    override fun equals(other: Any?): Boolean =
        this === other || (
            other is Beacon &&
                messageType == other.messageType &&
                maxVersion == other.maxVersion &&
                minVersion == other.minVersion &&
                platform == other.platform &&
                flags == other.flags &&
                tcpPort == other.tcpPort &&
                deviceId.bytes.contentEquals(other.deviceId.bytes) &&
                keyFingerprint.contentEquals(other.keyFingerprint) &&
                displayName == other.displayName
            )

    override fun hashCode(): Int {
        var result = messageType
        result = 31 * result + maxVersion
        result = 31 * result + minVersion
        result = 31 * result + platform.hashCode()
        result = 31 * result + flags
        result = 31 * result + tcpPort
        result = 31 * result + deviceId.bytes.contentHashCode()
        result = 31 * result + keyFingerprint.contentHashCode()
        return 31 * result + displayName.hashCode()
    }

    fun encode(): ByteArray {
        val name = NearbyNames.truncateToBytes(displayName, BEACON_MAX_NAME_BYTES)
            .toByteArray(Charsets.UTF_8)
        return ByteWriter(BEACON_HEADER_SIZE + name.size)
            .bytes(MAGIC)
            .u8(maxVersion)
            .u8(minVersion)
            .u8(messageType)
            .u8(platform.code)
            .u16(flags)
            .u16(tcpPort)
            .bytes(deviceId.bytes)
            .bytes(keyFingerprint.copyOf(KEY_FINGERPRINT_BYTES))
            .lengthPrefixed(name, BEACON_MAX_NAME_BYTES)
            .toByteArray()
    }

    companion object {

        /**
         * Reads a datagram, or returns `null`.
         *
         * Every rejection is silent and returns `null` rather than throwing. A datagram on a shared
         * network is as likely to be some other protocol that happens to use this port as it is to
         * be a fault, and discovery has no user-visible place to report one anyway. The only thing
         * a malformed beacon should cost is the microsecond spent looking at it.
         *
         * A datagram **longer** than the fields described is accepted and the excess ignored, which
         * is what lets a later version append a field without this one refusing to see the device
         * at all.
         */
        fun decode(datagram: ByteArray, length: Int = datagram.size): Beacon? {
            if (length < BEACON_HEADER_SIZE) return null
            for (index in MAGIC.indices) {
                if (datagram[index] != MAGIC[index]) return null
            }

            val reader = ByteReader(datagram.copyOf(length))
            return try {
                reader.bytes(MAGIC.size)
                val maxVersion = reader.u8()
                val minVersion = reader.u8()
                val messageType = reader.u8()
                val platform = NearbyPlatform.fromCode(reader.u8())
                val flags = reader.u16()
                val tcpPort = reader.u16()
                val deviceId = DeviceId(reader.bytes(16))
                val fingerprint = reader.bytes(KEY_FINGERPRINT_BYTES)
                val nameLength = reader.u8()
                if (nameLength > BEACON_MAX_NAME_BYTES) return null
                val name = String(reader.bytes(nameLength), Charsets.UTF_8)

                // An announcement with no name is not a device anybody can pick out of a list.
                // Only a QUERY, which carries nothing about its sender, is allowed to be nameless.
                if (messageType != BEACON_QUERY && nameLength == 0) return null
                if (minVersion > maxVersion) return null

                Beacon(
                    messageType = messageType,
                    maxVersion = maxVersion,
                    minVersion = minVersion,
                    platform = platform,
                    flags = flags,
                    tcpPort = tcpPort,
                    deviceId = deviceId,
                    keyFingerprint = fingerprint,
                    displayName = if (messageType == BEACON_QUERY) {
                        ""
                    } else {
                        NearbyNames.sanitise(name) ?: NearbyNames.friendlyName(deviceId.bytes)
                    },
                )
            } catch (_: NearbyFailure) {
                // Truncated part-way through a field. Same answer as a wrong magic: it is noise.
                null
            }
        }

        /** Says only that somebody is looking, and nothing whatever about who. */
        fun query(): Beacon = Beacon(
            messageType = BEACON_QUERY,
            maxVersion = VERSION,
            minVersion = MIN_VERSION,
            platform = NearbyPlatform.UNKNOWN,
            flags = 0,
            tcpPort = 0,
            deviceId = DeviceId.ZERO,
            keyFingerprint = ByteArray(KEY_FINGERPRINT_BYTES),
            displayName = "",
        )

        fun announce(
            platform: NearbyPlatform,
            flags: Int,
            tcpPort: Int,
            deviceId: DeviceId,
            keyFingerprint: ByteArray,
            displayName: String,
        ): Beacon = Beacon(
            messageType = BEACON_ANNOUNCE,
            maxVersion = VERSION,
            minVersion = MIN_VERSION,
            platform = platform,
            flags = flags,
            tcpPort = tcpPort,
            deviceId = deviceId,
            keyFingerprint = keyFingerprint,
            displayName = displayName,
        )
    }
}
