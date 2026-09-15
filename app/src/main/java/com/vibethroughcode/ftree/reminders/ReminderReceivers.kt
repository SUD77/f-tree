package com.vibethroughcode.ftree.reminders

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.vibethroughcode.ftree.FTreeApplication
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/** Reads the tree off the main thread and lets the broadcast go only once the note is sent. */
private fun BroadcastReceiver.deliverReminders(context: Context) {
    val reminders = (context.applicationContext as FTreeApplication).container.reminders
    val pending = goAsync()
    CoroutineScope(Dispatchers.IO).launch {
        try {
            reminders.deliver()
        } finally {
            pending.finish()
        }
    }
}

/** The morning alarm. Not exported: nothing but this app's own alarm can reach it. */
class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) = deliverReminders(context)
}

/**
 * After a restart, an update of the app, or a change of clock or time zone — each of which clears or
 * misplaces an alarm — send whatever morning is owed and set the next one.
 *
 * Disabled in the manifest and enabled only while reminders are on ([Reminders.enable]), so the
 * boot permission does nothing until somebody has asked for reminders. Not exported: these
 * broadcasts come from the system, which reaches a receiver that is not.
 */
class ReminderRestartReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action in RESTART_ACTIONS) deliverReminders(context)
    }

    private companion object {
        val RESTART_ACTIONS = setOf(
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            Intent.ACTION_TIME_CHANGED,
            Intent.ACTION_TIMEZONE_CHANGED,
        )
    }
}
