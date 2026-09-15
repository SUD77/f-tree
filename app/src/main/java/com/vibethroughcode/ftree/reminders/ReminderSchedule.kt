package com.vibethroughcode.ftree.reminders

import com.vibethroughcode.ftree.data.Occasion
import com.vibethroughcode.ftree.data.OccasionKind
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZonedDateTime

/**
 * When the morning's reminder is due, and what it is about. Pure, so the awkward cases — a clock
 * change, a phone switched on at noon, the last day of the year — are settled in JVM tests rather
 * than by waiting for them.
 */
object ReminderSchedule {

    /** Late enough not to wake anybody, early enough to call before the day fills up. */
    val MORNING: LocalTime = LocalTime.of(9, 0)

    /**
     * The next moment to deal with a morning, never skipping one that has not been dealt with.
     *
     * A morning still owed — past nine, not yet [lastHandled] — is due now: the phone was off at
     * nine, or asleep through it, or the app was only just updated. Otherwise it is nine o'clock
     * today if that is still ahead, or tomorrow. The zone does the arithmetic, so a clock that
     * springs forward or falls back still lands on nine.
     */
    fun nextTrigger(now: ZonedDateTime, lastHandled: LocalDate?): ZonedDateTime {
        val today = now.toLocalDate()
        val nine = now.with(MORNING).withSecond(0).withNano(0)
        return when {
            !now.isBefore(nine) && lastHandled != today -> now
            now.isBefore(nine) -> nine
            else -> ZonedDateTime.of(today.plusDays(1), MORNING, now.zone)
        }
    }

    /** Whether a morning is owed at [now]. */
    fun isDue(now: ZonedDateTime, lastHandled: LocalDate?): Boolean =
        !now.toLocalTime().isBefore(MORNING) && lastHandled != now.toLocalDate()

    /** The day a reminder sent today is about. */
    fun targetDay(today: LocalDate, lead: ReminderLead): LocalDate =
        if (lead == ReminderLead.DAY_BEFORE) today.plusDays(1) else today

    /** What goes in the note: every birthday, and the remembered only when that was asked for. */
    fun select(occasions: List<Occasion>, remembrance: Boolean): List<Occasion> =
        occasions.filter { remembrance || it.kind == OccasionKind.BIRTHDAY }
}
