package com.vibethroughcode.ftree.reminders

import android.Manifest
import android.app.AlarmManager
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import androidx.core.app.NotificationManagerCompat
import com.vibethroughcode.ftree.data.FamilyRepository
import com.vibethroughcode.ftree.data.Occasions
import com.vibethroughcode.ftree.data.OccasionCensus
import java.time.ZonedDateTime
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Birthday reminders (#154): one alarm a morning, and nothing else.
 *
 * Nothing is scheduled per person. At nine the alarm asks the database what the day holds, sends
 * one note however many people share it, and sets itself for tomorrow — so an edit, a delete or an
 * import can never leave a stale reminder behind, and there is no schedule to keep in step with
 * the tree.
 *
 * The alarm is inexact (`AlarmManager.set`), which needs no permission of its own: a birthday note
 * that arrives at five past nine has lost nothing. Setting it again after a restart needs
 * `RECEIVE_BOOT_COMPLETED`, and the receiver that uses it is disabled in the manifest and switched
 * on only with the reminders — so until then the permission is declared and inert, which is
 * checkable by reading [setRestartReceiver].
 *
 * This package is the only code in the app that schedules anything, as `update/` is the only code
 * that opens a socket.
 */
class Reminders(
    context: Context,
    private val preferences: ReminderPreferences,
    private val repository: FamilyRepository,
    private val clock: () -> ZonedDateTime = ZonedDateTime::now,
) {
    private val context = context.applicationContext
    private val notifier = ReminderNotifier(this.context)

    /*
     * One morning at a time. A process started by the alarm also re-arms from Application.onCreate,
     * which can set a second alarm for "now" while the first is still being delivered.
     */
    private val delivering = Mutex()

    /** Whether Android will actually show a note: the runtime permission on 13 and later, the app's own switch before. */
    fun canNotify(): Boolean {
        val granted = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        return granted && NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    /**
     * Switched on. Only called once permission is in hand.
     *
     * A morning already past counts as dealt with, so turning this on at two in the afternoon on
     * somebody's birthday does not answer with a note about something the list is already showing.
     */
    fun enable() {
        val now = clock()
        if (ReminderSchedule.isDue(now, preferences.lastHandled)) preferences.lastHandled = now.toLocalDate()
        preferences.setEnabled(true)
        setRestartReceiver(true)
        arm()
    }

    /** Switched off: the alarm cancelled, the restart receiver off again, and any note still showing taken down. */
    fun disable() {
        preferences.setEnabled(false)
        alarmIntent().let { alarms().cancel(it); it.cancel() }
        setRestartReceiver(false)
        notifier.cancel()
    }

    /** Set the alarm again if reminders are on. Safe to call as often as liked: one PendingIntent, replaced. */
    fun ensure() {
        if (preferences.enabled.value) arm()
    }

    /**
     * The morning's work, from the alarm or from a restart: send what is owed, then set tomorrow's.
     * Does nothing at all with the switch off, so a stray alarm left by an old install cannot send
     * anything.
     */
    suspend fun deliver() = delivering.withLock {
        if (!preferences.enabled.value) return@withLock
        val now = clock()
        if (ReminderSchedule.isDue(now, preferences.lastHandled)) {
            val target = ReminderSchedule.targetDay(now.toLocalDate(), preferences.lead.value)
            val occasions = ReminderSchedule.select(
                Occasions.on(repository.allPeople(), target),
                preferences.remembrance.value,
            )
            if (occasions.isNotEmpty() && canNotify()) notifier.post(occasions, preferences.lead.value)
            preferences.lastHandled = now.toLocalDate()
        }
        arm()
    }

    /** Who a reminder covers, for the line under the switch. */
    suspend fun census(): OccasionCensus = Occasions.census(repository.allPeople(), clock().toLocalDate())

    private fun arm() {
        val at = ReminderSchedule.nextTrigger(clock(), preferences.lastHandled)
        alarms().set(AlarmManager.RTC_WAKEUP, at.toInstant().toEpochMilli(), alarmIntent())
    }

    private fun alarms() = context.getSystemService(AlarmManager::class.java)

    private fun alarmIntent(): PendingIntent = PendingIntent.getBroadcast(
        context,
        0,
        Intent(context, ReminderReceiver::class.java),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    /** Whether a morning alarm is set, without setting one. */
    fun isArmed(): Boolean = PendingIntent.getBroadcast(
        context,
        0,
        Intent(context, ReminderReceiver::class.java),
        PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE,
    ) != null

    private fun setRestartReceiver(on: Boolean) {
        context.packageManager.setComponentEnabledSetting(
            ComponentName(context, ReminderRestartReceiver::class.java),
            if (on) PackageManager.COMPONENT_ENABLED_STATE_ENABLED else PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
            PackageManager.DONT_KILL_APP,
        )
    }
}
