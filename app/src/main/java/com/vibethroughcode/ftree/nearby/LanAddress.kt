package com.vibethroughcode.ftree.nearby

/**
 * Address arithmetic for the local network, kept free of Android and `java.net` so a JVM test reaches it.
 */
object LanAddress {

    /**
     * The subnet-directed broadcast for an IPv4 address and prefix length: `192.168.29.40/24` gives
     * `192.168.29.255`.
     *
     * Used instead of the limited broadcast `255.255.255.255`, which goes out of whichever interface
     * the system prefers — on a phone with a VPN, the VPN — and so reaches nobody in the room. A
     * directed broadcast is routed by its address, and its address is the Wi-Fi's own subnet.
     */
    fun directedBroadcast(address: ByteArray, prefixLength: Int): ByteArray {
        require(address.size == 4) { "IPv4 only" }
        require(prefixLength in 0..32) { "prefix $prefixLength" }
        val value = address.fold(0L) { acc, byte -> (acc shl 8) or (byte.toLong() and 0xFF) }
        val hostMask = if (prefixLength == 32) 0L else (1L shl (32 - prefixLength)) - 1
        val broadcast = value or hostMask
        return ByteArray(4) { ((broadcast shr (24 - it * 8)) and 0xFF).toByte() }
    }
}
