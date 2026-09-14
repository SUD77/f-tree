package com.vibethroughcode.ftree.nearby

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Who this device is willing to be seen by.
 *
 * Two axes rather than three states, and no *"always visible"* option at all. The argument that
 * settles it: **a device that announces itself while nobody is looking at it is a device somebody
 * has forgotten they configured.** Tying visibility to an open screen is also what keeps this
 * feature free of a foreground service, its permanent notification and a wake lock — none of which
 * could be justified for something that carries one file and stops.
 *
 * Off until switched on, following [com.vibethroughcode.ftree.update.UpdatePreferences]. An app
 * that promises to keep everything on the device should not open its first socket on the strength
 * of a default nobody chose.
 */
class NearbyPreferences(context: Context) {

    private val prefs = context.applicationContext
        .getSharedPreferences("nearby-preferences", Context.MODE_PRIVATE)

    private val _enabled = MutableStateFlow(prefs.getBoolean(KEY_ENABLED, false))

    /**
     * The master switch, checked before anything opens a socket.
     *
     * [NearbyRepository] refuses to start with this off even when something asks it to, which is
     * what makes "no network unless you turn it on" a property of the code rather than of the
     * screen that draws the toggle.
     */
    val enabled: StateFlow<Boolean> = _enabled.asStateFlow()

    fun setEnabled(value: Boolean) {
        prefs.edit().putBoolean(KEY_ENABLED, value).apply()
        _enabled.value = value
    }

    private val _trustedOnly = MutableStateFlow(prefs.getBoolean(KEY_TRUSTED_ONLY, false))

    /**
     * Whether to appear to everybody nearby, or only to devices this one has transferred with
     * before.
     *
     * Narrower than [enabled] rather than a state of it, because they answer different questions:
     * whether this device may be on the network at all, and who it will answer. Neither can make it
     * visible on its own.
     */
    val trustedOnly: StateFlow<Boolean> = _trustedOnly.asStateFlow()

    fun setTrustedOnly(value: Boolean) {
        prefs.edit().putBoolean(KEY_TRUSTED_ONLY, value).apply()
        _trustedOnly.value = value
    }

    private val _trusted = MutableStateFlow(readTrusted())

    /** Devices that have completed a transfer here, by hex device id. Never an address. */
    val trusted: StateFlow<Set<String>> = _trusted.asStateFlow()

    fun remember(deviceId: String) {
        val updated = _trusted.value + deviceId
        prefs.edit().putStringSet(KEY_TRUSTED, updated).apply()
        _trusted.value = updated
    }

    fun forget(deviceId: String) {
        val updated = _trusted.value - deviceId
        prefs.edit().putStringSet(KEY_TRUSTED, updated).apply()
        _trusted.value = updated
    }

    fun forgetAll() {
        prefs.edit().remove(KEY_TRUSTED).apply()
        _trusted.value = emptySet()
    }

    /**
     * A copy, because [android.content.SharedPreferences.getStringSet] hands back an instance the
     * caller must not modify and whose contents are undefined after the next edit.
     */
    private fun readTrusted(): Set<String> =
        prefs.getStringSet(KEY_TRUSTED, emptySet())?.toSet() ?: emptySet()

    private companion object {
        const val KEY_ENABLED = "enabled"
        const val KEY_TRUSTED_ONLY = "trusted-only"
        const val KEY_TRUSTED = "trusted-devices"
    }
}
