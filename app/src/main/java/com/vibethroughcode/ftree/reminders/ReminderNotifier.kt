package com.vibethroughcode.ftree.reminders

import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.vibethroughcode.ftree.MainActivity
import com.vibethroughcode.ftree.R
import com.vibethroughcode.ftree.data.Occasion
import com.vibethroughcode.ftree.data.OccasionKind
import com.vibethroughcode.ftree.data.RecordedDate

/**
 * The morning's note: one, however many people share the day.
 *
 * On a locked phone it says only that there is a birthday. A family's names and ages are nobody
 * else's business, and a lock screen is read by whoever picks the phone up.
 */
class ReminderNotifier(private val context: Context) {

    @SuppressLint("MissingPermission") // Reminders.canNotify() is checked before every post.
    fun post(occasions: List<Occasion>, lead: ReminderLead) {
        if (occasions.isEmpty()) return
        channel()
        val tomorrow = lead == ReminderLead.DAY_BEFORE
        val birthdays = occasions.filter { it.kind == OccasionKind.BIRTHDAY }
        val lines = occasions.map { context.getString(R.string.reminder_line, it.person.name.orEmpty().trim(), detail(it)) }

        val public = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(
                context.getString(
                    when {
                        birthdays.isNotEmpty() && tomorrow -> R.string.reminder_public_birthday_tomorrow
                        birthdays.isNotEmpty() -> R.string.reminder_public_birthday_today
                        tomorrow -> R.string.reminder_public_remembrance_tomorrow
                        else -> R.string.reminder_public_remembrance_today
                    },
                ),
            )
            .build()

        // One person: the title already says who and what, so the line under it says when they were
        // born, rather than the title again. Several: one line each.
        val single = occasions.singleOrNull()
        val note = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title(occasions, birthdays, tomorrow))
            .setContentText(single?.let(::recorded) ?: lines.joinToString(" · "))
            .apply { if (single == null) setStyle(NotificationCompat.InboxStyle().also { style -> lines.forEach(style::addLine) }) }
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(public)
            .setContentIntent(open(occasions.singleOrNull()?.person?.id))
            .setAutoCancel(true)
            .build()

        NotificationManagerCompat.from(context).notify(NOTIFICATION, note)
    }

    fun cancel() = NotificationManagerCompat.from(context).cancel(NOTIFICATION)

    /** A title that names the one person when there is one, and counts when there are several. */
    private fun title(occasions: List<Occasion>, birthdays: List<Occasion>, tomorrow: Boolean): String {
        val res = context.resources
        val one = birthdays.singleOrNull() ?: occasions.singleOrNull()
        val name = one?.person?.name.orEmpty().trim()
        return when {
            birthdays.size > 1 -> res.getQuantityString(
                if (tomorrow) R.plurals.reminder_title_birthdays_tomorrow else R.plurals.reminder_title_birthdays_today,
                birthdays.size, birthdays.size,
            )
            birthdays.size == 1 && one?.years != null -> context.getString(
                if (tomorrow) R.string.reminder_title_turns_tomorrow else R.string.reminder_title_turns_today,
                name, one.years,
            )
            birthdays.size == 1 -> context.getString(
                if (tomorrow) R.string.reminder_title_birthday_tomorrow else R.string.reminder_title_birthday_today,
                name,
            )
            occasions.size == 1 -> context.getString(
                if (tomorrow) R.string.reminder_title_remembering_tomorrow else R.string.reminder_title_remembering_today,
                name,
            )
            else -> res.getQuantityString(
                if (tomorrow) R.plurals.reminder_title_remembrance_tomorrow else R.plurals.reminder_title_remembrance_today,
                occasions.size, occasions.size,
            )
        }
    }

    /** The same words as a row in "Coming up", so the note and the list say one thing. */
    private fun detail(occasion: Occasion): String {
        val years = occasion.years
        return when (occasion.kind) {
            OccasionKind.BIRTHDAY -> if (years != null) context.getString(R.string.coming_up_turns, years)
            else context.getString(R.string.coming_up_birthday)
            OccasionKind.BIRTH_REMEMBRANCE -> if (years != null) context.getString(R.string.coming_up_would_have_been, years)
            else context.getString(R.string.coming_up_birthday)
            OccasionKind.DEATH_ANNIVERSARY -> if (years != null) {
                context.resources.getQuantityString(R.plurals.coming_up_years_since, years, years)
            } else {
                context.getString(R.string.coming_up_death_day)
            }
        }
    }

    /** "Born 15 September 1942", or "Passed away …" for a death anniversary: the date the day comes from. */
    private fun recorded(occasion: Occasion): String? {
        val locale = context.resources.configuration.locales[0]
        return if (occasion.kind == OccasionKind.DEATH_ANNIVERSARY) {
            RecordedDate.parse(occasion.person.deathDate)?.let { context.getString(R.string.person_died, it.display(locale)) }
        } else {
            RecordedDate.parse(occasion.person.birthDate)?.let { context.getString(R.string.person_born, it.display(locale)) }
        }
    }

    /** Opens the one person the note is about, or People when it is about several. */
    private fun open(personId: String?): PendingIntent = PendingIntent.getActivity(
        context,
        0,
        Intent(context, MainActivity::class.java)
            .setAction(ACTION_OPEN)
            .putExtra(EXTRA_PERSON, personId)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    private fun channel() {
        val manager = context.getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL) != null) return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, context.getString(R.string.reminder_channel_name), NotificationManager.IMPORTANCE_DEFAULT)
                .apply { description = context.getString(R.string.reminder_channel_description) },
        )
    }

    companion object {
        const val CHANNEL = "birthdays"
        const val NOTIFICATION = 417
        const val ACTION_OPEN = "com.vibethroughcode.ftree.action.OPEN_REMINDER"
        const val EXTRA_PERSON = "person"
    }
}
