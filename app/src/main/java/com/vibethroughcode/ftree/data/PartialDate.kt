package com.vibethroughcode.ftree.data

import java.time.DateTimeException
import java.time.LocalDate
import java.time.MonthDay
import java.time.Year
import java.time.chrono.IsoChronology
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeFormatterBuilder
import java.time.format.FormatStyle
import java.util.Locale

/**
 * Anything a birth or death date field can hold: a [PartialDate] on the calendar, or a
 * [YearlessDate] — a day of the year whose year nobody knows (#90).
 *
 * The two are kept apart on purpose. Age, seniority and every ordering in the app are questions
 * about *when*, and a birthday without a year cannot answer them, so everything that asks those
 * questions keeps using [PartialDate.parse] and sees a yearless date as unknown — which it is, for
 * them. Only the places that *show* a date, or compare two dates for identity, read the wider type.
 */
sealed interface RecordedDate {
    /** The string that gets persisted. */
    fun serialize(): String

    /** How the date reads to a person, never more precise than what is known. */
    fun display(locale: Locale = Locale.getDefault()): String

    /** True when the two could describe the same day, allowing for whatever each leaves out. */
    fun isCompatibleWith(other: RecordedDate): Boolean

    companion object {
        /** Returns null for anything that is neither a real partial date nor a real day of the year. */
        fun parse(value: String?): RecordedDate? = PartialDate.parse(value) ?: YearlessDate.parse(value)
    }
}

/**
 * A day and month with no year: "her birthday is 17 April; nobody remembers the year".
 *
 * Stored as `--04-17`, the ISO 8601 / vCard form for exactly this, so the file still says what it
 * means to anything else that reads it. A reader that predates it sees a string its parser refuses
 * and treats the date as unknown, which is the right degradation: the tree still opens everywhere.
 *
 * Only day-and-month is accepted. "Born in April, year unknown" says almost nothing and would be one
 * more shape for every reader to handle.
 */
data class YearlessDate(val month: Int, val day: Int) : RecordedDate {

    override fun serialize(): String = "--%02d-%02d".format(month, day)

    /** `17 April`, or `April 17` where the locale puts the month first in a long date. */
    override fun display(locale: Locale): String {
        val long = DateTimeFormatterBuilder.getLocalizedDateTimePattern(
            FormatStyle.LONG, null, IsoChronology.INSTANCE, locale,
        )
        val monthFirst = long.indexOf('M').let { it >= 0 && it < long.indexOf('d') }
        return DateTimeFormatter.ofPattern(if (monthFirst) "MMMM d" else "d MMMM", locale)
            .format(MonthDay.of(month, day))
    }

    /**
     * The same day of the year, or a calendar date whose known parts agree with it.
     *
     * `--04-17` could be `1938`, `1938-04` or `1938-04-17`, but not `1938-05` or `1938-04-18` — and
     * not `1938` either when the day is 29 February, because 1938 had no such day.
     */
    override fun isCompatibleWith(other: RecordedDate): Boolean = when (other) {
        is YearlessDate -> other == this
        is PartialDate ->
            (other.month == null || other.month == month) &&
                (other.day == null || other.day == day) &&
                !(month == 2 && day == 29 && !Year.isLeap(other.year.toLong()))
    }

    override fun toString(): String = serialize()

    companion object {
        private val PATTERN = Regex("""^--(\d{2})-(\d{2})$""")

        /** Returns null for anything that is not a well-formed, real day of the year. */
        fun parse(value: String?): YearlessDate? {
            val match = PATTERN.matchEntire(value?.trim().orEmpty()) ?: return null
            val (m, d) = match.destructured
            return try {
                MonthDay.of(m.toInt(), d.toInt())
                YearlessDate(m.toInt(), d.toInt())
            } catch (_: DateTimeException) {
                null
            }
        }
    }
}

/**
 * A date that may be known only to the year or the month.
 *
 * Family history is full of "born sometime in 1938", so a full [LocalDate] would force people to
 * invent a day they do not know. Stored as a partial ISO-8601 string — `1938`, `1938-04`, or
 * `1938-04-17` — which sorts correctly as text and needs no separate "is approximate" flag: the
 * precision *is* the statement about how much is known.
 */
data class PartialDate(
    val year: Int,
    val month: Int? = null,
    val day: Int? = null,
) : Comparable<PartialDate>, RecordedDate {

    /** The ISO-8601 string that gets persisted. */
    override fun serialize(): String = when {
        month == null -> "%04d".format(year)
        day == null -> "%04d-%02d".format(year, month)
        else -> "%04d-%02d-%02d".format(year, month, day)
    }

    /** Earliest instant this date could refer to; used for age arithmetic and ordering. */
    fun earliest(): LocalDate = LocalDate.of(year, month ?: 1, day ?: 1)

    /** Latest instant this date could refer to. */
    fun latest(): LocalDate {
        if (month == null) return LocalDate.of(year, 12, 31)
        val firstOfMonth = LocalDate.of(year, month, 1)
        return if (day == null) firstOfMonth.withDayOfMonth(firstOfMonth.lengthOfMonth())
        else firstOfMonth.withDayOfMonth(day)
    }

    /** True when the two dates could describe the same day, allowing for differing precision. */
    fun isCompatibleWith(other: PartialDate): Boolean =
        !earliest().isAfter(other.latest()) && !other.earliest().isAfter(latest())

    override fun isCompatibleWith(other: RecordedDate): Boolean = when (other) {
        is PartialDate -> isCompatibleWith(other)
        is YearlessDate -> other.isCompatibleWith(this)
    }

    /**
     * How the date reads to a person: `1938`, `April 1938`, `17 April 1938`.
     *
     * Only as precise as what is known — showing `1938-01-01` for "sometime in 1938" would be
     * claiming a day nobody recorded.
     */
    override fun display(locale: Locale): String = when {
        month == null -> year.toString()
        day == null -> DateTimeFormatter.ofPattern("LLLL yyyy", locale).format(earliest())
        else -> DateTimeFormatter.ofLocalizedDate(FormatStyle.LONG)
            .withLocale(locale)
            .format(earliest())
    }

    override fun compareTo(other: PartialDate): Int = earliest().compareTo(other.earliest())

    override fun toString(): String = serialize()

    companion object {
        private val PATTERN = Regex("""^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$""")

        /** Returns null for anything that is not a well-formed, real partial date. */
        fun parse(value: String?): PartialDate? {
            val match = PATTERN.matchEntire(value?.trim().orEmpty()) ?: return null
            val (y, m, d) = match.destructured
            val year = y.toInt()
            val month = m.takeIf { it.isNotEmpty() }?.toInt()
            val day = d.takeIf { it.isNotEmpty() }?.toInt()
            return try {
                PartialDate(year, month, day).also { it.earliest(); it.latest() }
            } catch (_: DateTimeException) {
                null
            }
        }

        fun ofYear(year: Int): PartialDate = PartialDate(year)
    }
}

/**
 * Whole years between two partial dates, or null when it cannot be stated.
 *
 * Computed from the earliest possible instants, which is the conventional reading of "born in
 * 1938" and keeps the answer stable as precision improves.
 */
fun yearsBetween(from: PartialDate, to: PartialDate): Int? {
    val start = from.earliest()
    val end = to.earliest()
    if (end.isBefore(start)) return null
    return java.time.Period.between(start, end).years
}
