package com.vibethroughcode.ftree.ui.person

import com.vibethroughcode.ftree.data.PartialDate
import com.vibethroughcode.ftree.data.RecordedDate
import java.time.Year

/**
 * The rules of the date field, apart from any widget (#90).
 *
 * The field is three slots — `YYYY`, `MM`, `DD` — with the hyphens already drawn, so a date is
 * typed as digits alone: `19380417` fills all three, and there is no separator key to hunt for on a
 * phone keyboard. Leaving the year slot empty is how a birthday without a year is recorded; tapping
 * it later is how the year is added.
 *
 * Deliberately free of Android types, like `CircleCrop.kt`, so every rule is JVM-tested. The desktop
 * port (`desktop/renderer/date-entry.js`) is held to the same table, `date-entry-cases.json`, so a
 * shortcut learned on the phone is true on the laptop too.
 */
enum class DateSlot { YEAR, MONTH, DAY }

/**
 * What the three slots hold, as the digits typed — `"4"` is a month still being typed.
 *
 * The form keeps a single string, not this, so saving, validation and every test stay string-based.
 * [encode] and [DateEntry.decode] are a total, lossless pair between the two: a valid date encodes
 * to its stored form (`1938`, `1938-04`, `1938-04-17`, `--04-17`), and a combination that is not a
 * date still has a string of its own (`1938--17`, `--04`, `---17`) rather than being lost.
 */
data class DateParts(val year: String = "", val month: String = "", val day: String = "") {

    val isEmpty: Boolean get() = year.isEmpty() && month.isEmpty() && day.isEmpty()

    operator fun get(slot: DateSlot): String = when (slot) {
        DateSlot.YEAR -> year
        DateSlot.MONTH -> month
        DateSlot.DAY -> day
    }

    fun encode(): String = when {
        isEmpty -> ""
        month.isEmpty() && day.isEmpty() -> year
        else -> buildString {
            // An empty year is written `-`, which is what makes `--04-17` the ISO form.
            append(year.ifEmpty { "-" })
            append('-').append(month)
            if (day.isNotEmpty()) append('-').append(day)
        }
    }
}

/** What a keystroke leaves behind: the slots, and the slot that should hold the caret next. */
data class DateEdit(val parts: DateParts, val focus: DateSlot)

/** Why the date in a field cannot be kept. The desktop's `DateProblem` has the same names. */
enum class DateProblem {
    /** One to three digits of a year. */
    YEAR_INCOMPLETE,
    MONTH_OUT_OF_RANGE,
    DAY_OUT_OF_RANGE,

    /** 31 April: no such day in that month in any year. */
    DAY_NOT_IN_MONTH,

    /** 29 February in a year that had none. */
    NOT_A_LEAP_YEAR,

    /** A day with no month is not a date. */
    DAY_WITHOUT_MONTH,

    /** A month with no year and no day says too little to keep. */
    MONTH_ALONE,

    /** Anything else a stored string might hold; only reachable through data typed elsewhere. */
    MALFORMED,
    DEATH_BEFORE_BIRTH,
}

object DateEntry {

    private val SEPARATORS = setOf(' ', '-', '/', '.', ',')
    private const val SEP = """[-\s./,]"""
    private val YEARLESS_WHOLE = Regex("""^--(\d{1,2})$SEP(\d{1,2})$""")
    private val COMPACT_WHOLE = Regex("""^(\d{4})(\d{2})(\d{2})$""")
    private val SEPARATED_WHOLE = Regex("""^(\d{4})$SEP+(\d{1,2})(?:$SEP+(\d{1,2}))?$""")
    private val POSITIONAL = Regex("""^(\d{0,4})(?:-(\d{0,2})(?:-(\d{0,2}))?)?$""")
    private val POSITIONAL_YEARLESS = Regex("""^(\d{0,2})(?:-(\d{0,2}))?$""")

    /** The slots a stored or typed string stands for. Never fails: see [DateParts]. */
    fun decode(text: String): DateParts {
        positional(text)?.let { return it }
        // A date written some other way, by some other program: shown as if it had been pasted, so
        // there is something to correct, but [problem] still calls it unreadable - see there.
        return enter(DateParts(), DateSlot.YEAR, text.trim()).parts
    }

    /** The slots for text in the field's own form, or null for text written any other way. */
    private fun positional(text: String): DateParts? {
        val t = text.trim()
        if (t.isEmpty()) return DateParts()
        return if (t.startsWith("--")) {
            POSITIONAL_YEARLESS.matchEntire(t.substring(2))?.let { DateParts("", it.groupValues[1], it.groupValues[2]) }
        } else {
            POSITIONAL.matchEntire(t)?.let { DateParts(it.groupValues[1], it.groupValues[2], it.groupValues[3]) }
        }
    }

    /**
     * A whole date arriving at once — pasted, or typed by a test — in any of the ways people write
     * one year first. Day-first and month-first orders are never guessed between: `04/05/1938` is
     * two different days depending on who wrote it, and the precision here is a statement of fact.
     */
    private fun readWhole(text: String): DateParts? {
        val t = text.trim()
        YEARLESS_WHOLE.matchEntire(t)?.let { return DateParts("", pad(it.groupValues[1]), pad(it.groupValues[2])) }
        COMPACT_WHOLE.matchEntire(t)?.let { return DateParts(it.groupValues[1], it.groupValues[2], it.groupValues[3]) }
        SEPARATED_WHOLE.matchEntire(t)?.let {
            return DateParts(it.groupValues[1], pad(it.groupValues[2]), it.groupValues[3].let(::pad))
        }
        return null
    }

    private fun pad(digits: String): String = if (digits.length == 1) "0$digits" else digits

    /**
     * A slot's text has changed to [text]; what the three slots hold now, and where the caret goes.
     *
     * - A year moves on at its fourth digit; a month at its second, or at once when its first digit
     *   could only be one month (`4` is April, so it becomes `04`); a day likewise from `4` up.
     * - Any separator a person reaches for — space, `-`, `/`, `.`, `,` — finishes a slot, padding a
     *   lone digit. In an empty slot it just moves on, so a space first means "no year".
     * - Digits past a slot's end spill into the next slot when it is empty, so typing never stalls.
     */
    fun enter(parts: DateParts, slot: DateSlot, text: String): DateEdit {
        readWhole(text)?.let { whole ->
            val focus = if (whole.month.isNotEmpty()) DateSlot.DAY else if (whole.year.isNotEmpty()) DateSlot.MONTH else DateSlot.YEAR
            return DateEdit(whole, focus)
        }
        val digits = text.filter(Char::isDigit)
        // A separator only counts in text that is otherwise digits: pasted words are not a keystroke.
        val separated = text.any { it in SEPARATORS } && text.all { it.isDigit() || it in SEPARATORS }
        // Padding and moving on answer a digit typed, never one deleted: backspacing `17` to `7` is
        // on the way to a different day, not a request for the 7th.
        val grew = digits.length > parts[slot].length

        return when (slot) {
            DateSlot.YEAR -> {
                val next = parts.copy(year = digits.take(4))
                val spill = digits.drop(4)
                when {
                    spill.isNotEmpty() && parts.month.isEmpty() -> enter(next, DateSlot.MONTH, spill)
                    next.year.length == 4 && digits.length > parts.year.length -> DateEdit(next, DateSlot.MONTH)
                    separated -> DateEdit(next, DateSlot.MONTH)
                    else -> DateEdit(next, DateSlot.YEAR)
                }
            }
            DateSlot.MONTH -> {
                val month = digits.take(2)
                val spill = digits.drop(2)
                when {
                    month.length == 1 && ((grew && month[0] >= '2') || separated) ->
                        DateEdit(parts.copy(month = "0$month"), DateSlot.DAY)
                    month.isEmpty() && separated -> DateEdit(parts.copy(month = ""), DateSlot.DAY)
                    month.length == 2 && spill.isNotEmpty() && parts.day.isEmpty() ->
                        enter(parts.copy(month = month), DateSlot.DAY, spill)
                    month.length == 2 && digits.length > parts.month.length ->
                        DateEdit(parts.copy(month = month), DateSlot.DAY)
                    else -> DateEdit(parts.copy(month = month), DateSlot.MONTH)
                }
            }
            DateSlot.DAY -> {
                val day = digits.take(2)
                if (day.length == 1 && ((grew && day[0] >= '4') || separated)) {
                    DateEdit(parts.copy(day = "0$day"), DateSlot.DAY)
                } else {
                    DateEdit(parts.copy(day = day), DateSlot.DAY)
                }
            }
        }
    }

    /**
     * Backspace in a slot that is already empty: step back into the one before and take its last
     * digit, so deleting runs back through the whole date one press per digit — the hyphens are
     * drawn, not typed, and are never in the way.
     */
    fun backspace(parts: DateParts, slot: DateSlot): DateEdit = when (slot) {
        DateSlot.YEAR -> DateEdit(parts, DateSlot.YEAR)
        DateSlot.MONTH -> DateEdit(parts.copy(year = parts.year.dropLast(1)), DateSlot.YEAR)
        DateSlot.DAY -> DateEdit(parts.copy(month = parts.month.dropLast(1)), DateSlot.MONTH)
    }

    /**
     * The string as it will be kept: a lone month or day digit padded (`1938-4` is `1938-04`).
     * A person who stops after typing `1` in the month and taps Save meant January, not an error.
     */
    fun settle(text: String): String {
        val parts = decode(text)
        return parts.copy(month = pad(parts.month), day = pad(parts.day)).encode()
    }

    /** What is wrong with a field's text, or null when it is blank or a date that can be kept. */
    fun problem(text: String): DateProblem? {
        if (text.isBlank()) return null
        // Everything typed into the field is in its own form, so anything else came from another
        // program - "about 1938", "before 1938". Reading a year out of it and calling that a date
        // would rewrite the record on the next save of that person, and "before" is not "in".
        // Unreadable, then: kept as written until somebody retypes it.
        if (positional(text) == null) return DateProblem.MALFORMED
        val parts = decode(settle(text))
        val month = parts.month.toIntOrNull()
        val day = parts.day.toIntOrNull()
        return when {
            parts.year.isNotEmpty() && parts.year.length < 4 -> DateProblem.YEAR_INCOMPLETE
            month != null && month !in 1..12 -> DateProblem.MONTH_OUT_OF_RANGE
            day != null && day !in 1..31 -> DateProblem.DAY_OUT_OF_RANGE
            month != null && day != null && day > maxDays(month) -> DateProblem.DAY_NOT_IN_MONTH
            month == 2 && day == 29 && parts.year.length == 4 && !Year.isLeap(parts.year.toLong()) ->
                DateProblem.NOT_A_LEAP_YEAR
            day != null && month == null -> DateProblem.DAY_WITHOUT_MONTH
            parts.year.isEmpty() && month != null && day == null -> DateProblem.MONTH_ALONE
            RecordedDate.parse(settle(text)) == null -> DateProblem.MALFORMED
            else -> null
        }
    }

    /** Days a month can have in any year, so February is allowed its 29th here. */
    fun maxDays(month: Int): Int = when (month) {
        2 -> 29
        4, 6, 9, 11 -> 30
        else -> 31
    }

    /**
     * Whether a problem can be shown while the person is still typing in the field.
     *
     * Only once the slot it is about is complete: `19` is a year on its way, not a mistake, and
     * flashing red at every keystroke teaches people to ignore the colour. Everything else waits
     * until the field is left.
     */
    fun isFinal(problem: DateProblem, text: String): Boolean {
        val raw = decode(text)
        return when (problem) {
            DateProblem.MONTH_OUT_OF_RANGE -> raw.month.length == 2
            DateProblem.DAY_OUT_OF_RANGE, DateProblem.DAY_NOT_IN_MONTH -> raw.day.length == 2
            DateProblem.NOT_A_LEAP_YEAR -> raw.day.length == 2 && raw.year.length == 4
            DateProblem.DEATH_BEFORE_BIRTH -> true
            else -> false
        }
    }

    /**
     * Death before birth, which needs both dates. Only two calendar dates can be out of order —
     * a birthday with no year orders nothing — and overlapping partial dates are fine: "born 1938,
     * died 1938" is a real thing to record.
     */
    fun isDeathBeforeBirth(birthText: String, deathText: String): Boolean {
        val birth = RecordedDate.parse(settle(birthText)) as? PartialDate ?: return false
        val death = RecordedDate.parse(settle(deathText)) as? PartialDate ?: return false
        return death.latest().isBefore(birth.earliest())
    }
}
