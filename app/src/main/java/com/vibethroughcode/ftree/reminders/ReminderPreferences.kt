package com.vibethroughcode.ftree.reminders

import android.content.Context
import java.time.LocalDate
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Whether a reminder comes on the day itself or the day before, for time to call or to post a card. */
enum class ReminderLead { ON_THE_DAY, DAY_BEFORE }

/**
 * Birthday reminders (#154): off until switched on, and what they remember between mornings.
 *
 * Off by default for the reason the updater is: the app asks Android for nothing until somebody has
 * chosen the thing that needs it. [lead] is persisted by name, so `proguard-rules.pro` keeps it —
 * R8 renaming it would quietly move everybody's reminder to the default.
 */
class ReminderPreferences(context: Context) {

    private val prefs = context.applicationContext
        .getSharedPreferences("reminder-preferences", Context.MODE_PRIVATE)

    private val _enabled = MutableStateFlow(prefs.getBoolean(KEY_ENABLED, false))
    val enabled: StateFlow<Boolean> = _enabled.asStateFlow()

    fun setEnabled(value: Boolean) {
        prefs.edit().putBoolean(KEY_ENABLED, value).apply()
        _enabled.value = value
    }

    private val _remembrance = MutableStateFlow(prefs.getBoolean(KEY_REMEMBRANCE, false))

    /**
     * Whether the days the departed are remembered on come as reminders too. Off by default, and a
     * choice of its own: "Coming up" always lists them, but a note on the phone is a different
     * thing to receive about somebody who has died, and nobody should get one by default.
     */
    val remembrance: StateFlow<Boolean> = _remembrance.asStateFlow()

    fun setRemembrance(value: Boolean) {
        prefs.edit().putBoolean(KEY_REMEMBRANCE, value).apply()
        _remembrance.value = value
    }

    private val _lead = MutableStateFlow(
        prefs.getString(KEY_LEAD, null)
            ?.let { name -> ReminderLead.entries.firstOrNull { it.name == name } }
            ?: ReminderLead.ON_THE_DAY,
    )
    val lead: StateFlow<ReminderLead> = _lead.asStateFlow()

    fun setLead(value: ReminderLead) {
        prefs.edit().putString(KEY_LEAD, value.name).apply()
        _lead.value = value
    }

    /**
     * The last morning dealt with, whether or not it held a birthday. What stops a restart, a
     * change of time zone or a second alarm from sending one morning's note twice.
     */
    var lastHandled: LocalDate?
        get() = prefs.getString(KEY_LAST_HANDLED, null)?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
        set(value) = prefs.edit().putString(KEY_LAST_HANDLED, value?.toString()).apply()

    private companion object {
        const val KEY_ENABLED = "enabled"
        const val KEY_REMEMBRANCE = "remembrance"
        const val KEY_LEAD = "lead"
        const val KEY_LAST_HANDLED = "last-handled"
    }
}
