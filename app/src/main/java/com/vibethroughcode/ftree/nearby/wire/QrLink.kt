package com.vibethroughcode.ftree.nearby.wire

import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.KEY_FINGERPRINT_BYTES
import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.PAIRING_TOKEN_BYTES
import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.QR_HOST
import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.QR_PATH
import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.QR_SCHEME
import com.vibethroughcode.ftree.nearby.wire.NearbyProtocol.VERSION
import java.net.URLDecoder
import java.net.URLEncoder

/**
 * Everything a device needs to reach another one, small enough to be a square on a screen.
 *
 * The [token] is the interesting field. It is sixteen random bytes that are **never transmitted**:
 * both ends mix it into the key derivation, so a device that did not see the screen derives a
 * different key and its first encrypted frame simply fails to open. That is what turns the code
 * from a convenience into a shared secret, and it is why scanning one is allowed to skip the
 * six-digit comparison while typing an address is not — a fingerprint proves the receiver to the
 * sender, but only the token proves the sender was standing in front of the receiver's screen.
 */
data class QrLink(
    val address: String,
    val port: Int,
    val deviceId: DeviceId,
    val keyFingerprint: ByteArray,
    val token: ByteArray?,
    val displayName: String?,
    val maxVersion: Int = VERSION,
) {
    override fun equals(other: Any?): Boolean =
        this === other || (
            other is QrLink &&
                address == other.address &&
                port == other.port &&
                deviceId.bytes.contentEquals(other.deviceId.bytes) &&
                keyFingerprint.contentEquals(other.keyFingerprint) &&
                (token?.contentEquals(other.token ?: ByteArray(0)) ?: (other.token == null)) &&
                displayName == other.displayName &&
                maxVersion == other.maxVersion
            )

    override fun hashCode(): Int {
        var result = address.hashCode()
        result = 31 * result + port
        result = 31 * result + deviceId.bytes.contentHashCode()
        result = 31 * result + keyFingerprint.contentHashCode()
        result = 31 * result + (token?.contentHashCode() ?: 0)
        result = 31 * result + (displayName?.hashCode() ?: 0)
        return 31 * result + maxVersion
    }

    /** The token is a secret; it does not belong in a log line. */
    override fun toString(): String = "QrLink($address:$port, ${deviceId.hex()}, token=${token != null})"

    fun encode(): String = buildString {
        append(QR_SCHEME).append("://").append(QR_HOST).append(QR_PATH)
        append("?a=").append(address)
        append("&p=").append(port)
        append("&d=").append(deviceId.hex())
        append("&f=").append(base64Url(keyFingerprint))
        token?.let { append("&t=").append(base64Url(it)) }
        displayName?.let { append("&n=").append(URLEncoder.encode(it, "UTF-8").replace("+", "%20")) }
        append("&v=").append(maxVersion)
    }

    companion object {

        /**
         * A custom scheme rather than an `https:` link, on purpose.
         *
         * An https URL carrying a LAN address is a URL a browser will cheerfully fetch, and a QR
         * code is a thing people point cameras at without reading. `ftree://` goes nowhere if it is
         * scanned by anything but this app.
         */
        fun parse(text: String): QrLink? {
            val trimmed = text.trim()
            val prefix = "$QR_SCHEME://$QR_HOST$QR_PATH?"
            if (!trimmed.startsWith(prefix)) return null

            val query = trimmed.substring(prefix.length)
            val fields = mutableMapOf<String, String>()
            for (pair in query.split("&")) {
                if (pair.isEmpty()) continue
                val equals = pair.indexOf('=')
                if (equals <= 0) continue
                // Unknown keys are ignored rather than refused, so a later version can add one.
                fields[pair.substring(0, equals)] = pair.substring(equals + 1)
            }

            val address = fields["a"] ?: return null
            if (!isPrivateAddress(address)) return null

            val port = fields["p"]?.toIntOrNull()?.takeIf { it in 1..65535 } ?: return null
            val deviceId = fields["d"]?.let { DeviceId.parse(it) } ?: return null
            val fingerprint = fields["f"]
                ?.let { decodeBase64Url(it) }
                ?.takeIf { it.size == KEY_FINGERPRINT_BYTES }
                ?: return null

            val token = fields["t"]?.let { decodeBase64Url(it) }
            if (fields.containsKey("t") && token?.size != PAIRING_TOKEN_BYTES) return null

            val name = fields["n"]?.let {
                runCatching { URLDecoder.decode(it, "UTF-8") }.getOrNull()
            }?.let { NearbyNames.sanitise(it) }

            val version = fields["v"]?.toIntOrNull() ?: 1
            if (version < 1) return null

            return QrLink(
                address = address,
                port = port,
                deviceId = deviceId,
                keyFingerprint = fingerprint,
                token = token,
                displayName = name,
                maxVersion = version,
            )
        }

        /**
         * `10/8`, `172.16/12`, `192.168/16` and `169.254/16`, and nothing else.
         *
         * A scanned or typed address outside those ranges is refused outright rather than attempted.
         * It is either a mistake or an attempt to make a phone post somebody's family to a machine
         * on the internet, and there is no third reading — so there is nothing to weigh and no
         * reason to ask. Loopback is deliberately *not* included here: see [isTestableAddress].
         */
        fun isPrivateAddress(address: String): Boolean {
            val parts = address.split(".")
            if (parts.size != 4) return false
            val octets = parts.map { part ->
                if (part.isEmpty() || part.length > 3 || !part.all { it.isDigit() }) return false
                // "010" is not a dotted quad; some parsers read a leading zero as octal.
                if (part.length > 1 && part[0] == '0') return false
                part.toInt().also { if (it > 255) return false }
            }
            val (a, b) = octets
            return when {
                a == 10 -> true
                a == 172 && b in 16..31 -> true
                a == 192 && b == 168 -> true
                a == 169 && b == 254 -> true
                else -> false
            }
        }

        /**
         * Loopback, which an Android emulator reaches its host on as `10.0.2.2` — already private —
         * but which a desktop talking to a second copy of itself needs directly.
         *
         * Kept apart from [isPrivateAddress] so that the rule a scanned code is held to stays the
         * narrow one. Only the test harness and the desktop's own smoke run pass this.
         */
        fun isTestableAddress(address: String): Boolean =
            isPrivateAddress(address) || address == "127.0.0.1"

        /*
         * java.util.Base64, not android.util.Base64.
         *
         * The Android one is a framework class with no implementation on a plain JVM, so a unit
         * test touching it fails with "not mocked" rather than with anything to do with this code.
         * This whole package exists to be testable where CI can run it — there is no emulator on
         * CI — so an android.* import here would quietly cost the file its tests. java.util.Base64
         * arrived in API 26, which is the app's floor.
         */
        private val encoder = java.util.Base64.getUrlEncoder().withoutPadding()
        private val decoder = java.util.Base64.getUrlDecoder()

        private fun base64Url(bytes: ByteArray): String = encoder.encodeToString(bytes)

        private fun decodeBase64Url(value: String): ByteArray? =
            runCatching { decoder.decode(value) }.getOrNull()
    }
}
