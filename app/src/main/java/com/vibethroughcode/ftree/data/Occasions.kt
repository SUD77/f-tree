package com.vibethroughcode.ftree.data

import java.time.LocalDate
import java.time.temporal.ChronoUnit

/** What a day in somebody's year is: their birthday, or a day they are remembered on. */
enum class OccasionKind { BIRTHDAY, BIRTH_REMEMBRANCE, DEATH_ANNIVERSARY }

/**
 * One day coming round for one person. [years] is the age turned, or the years since, and null when
 * the record holds no year — or when the number is past saying (see [Occasions.REMEMBERED_YEARS]).
 */
data class Occasion(
    val person: Person,
    val kind: OccasionKind,
    val date: LocalDate,
    val daysAway: Int,
    val years: Int?,
)

/** Of the living people in a tree, who a birthday reminder can cover and who it cannot, and why. */
data class OccasionCensus(val covered: Int, val noDay: Int, val presumedDeparted: Int)

/**
 * The family's coming days: whose birthday it is, and whom the family remembers (#230, #154).
 *
 * Pure, and held to `site/playground/occasion-cases.json` alongside `occasions.js`, so the phone's
 * list, its morning reminder and the desktop's list can never disagree about a day.
 *
 * A day needs a month and a day. A year alone has nothing to fall on, and a yearless date (#90) is
 * exactly as good as a full one here — "17 April" is the fact a family actually uses. The living get
 * birthdays; the departed get two quieter days, the one they were born on and the one they died on.
 *
 * Nothing is scheduled per person. A reminder asks [on] the morning it fires, so an edit, a delete
 * or an import can never leave a stale reminder behind.
 */
object Occasions {

    /** "Coming up" looks this far: today and the 29 days after it. */
    const val WINDOW_DAYS = 30

    /**
     * Nobody is wished a happy 111th. A tree holds plenty of ancestors whose death was never
     * recorded, and a living person that old is almost surely one of them. They are counted by
     * [census] rather than dropped in silence.
     */
    const val OLDEST_LIVING = 110

    /** A remembrance past this many years comes round without its number. */
    const val REMEMBERED_YEARS = 100

    fun upcoming(people: List<Person>, today: LocalDate, days: Int = WINDOW_DAYS): List<Occasion> =
        people.asSequence()
            .filterNot { it.isUnnamed }
            .flatMap { occasionsOf(it, today) }
            .filter { it.daysAway < days }
            .sortedWith(ORDER)
            .toList()

    /** What a reminder on [date] is about. */
    fun on(people: List<Person>, date: LocalDate): List<Occasion> = upcoming(people, date, days = 1)

    /** The soonest living birthday within a year, for the line that says when the next one is. */
    fun next(people: List<Person>, today: LocalDate): Occasion? =
        upcoming(people, today, days = 366).firstOrNull { it.kind == OccasionKind.BIRTHDAY }

    fun census(people: List<Person>, today: LocalDate): OccasionCensus {
        var covered = 0
        var noDay = 0
        var presumed = 0
        for (person in people) {
            if (person.isUnnamed || person.isNoLongerLiving) continue
            val born = RecordedDate.parse(person.birthDate)
            when {
                born?.dayOfYear() == null -> noDay++
                birthday(person, born, today) == null -> presumed++
                else -> covered++
            }
        }
        return OccasionCensus(covered, noDay, presumed)
    }

    private fun occasionsOf(person: Person, today: LocalDate): Sequence<Occasion> {
        val born = RecordedDate.parse(person.birthDate)
        if (!person.isNoLongerLiving) return listOfNotNull(birthday(person, born, today)).asSequence()
        val died = RecordedDate.parse(person.deathDate)
        return listOfNotNull(
            remembrance(person, OccasionKind.BIRTH_REMEMBRANCE, born, today),
            remembrance(person, OccasionKind.DEATH_ANNIVERSARY, died, today),
        ).asSequence()
    }

    private fun birthday(person: Person, born: RecordedDate?, today: LocalDate): Occasion? {
        val occasion = occasion(person, OccasionKind.BIRTHDAY, born, today) ?: return null
        return occasion.takeUnless { (it.years ?: 0) > OLDEST_LIVING }
    }

    private fun remembrance(person: Person, kind: OccasionKind, date: RecordedDate?, today: LocalDate): Occasion? {
        val occasion = occasion(person, kind, date, today) ?: return null
        return if ((occasion.years ?: 0) > REMEMBERED_YEARS) occasion.copy(years = null) else occasion
    }

    private fun occasion(person: Person, kind: OccasionKind, recorded: RecordedDate?, today: LocalDate): Occasion? {
        val (month, day) = recorded?.dayOfYear() ?: return null
        val since = (recorded as? PartialDate)?.year
        // The first time a day comes round is a year after it happened: the day of birth itself is
        // nobody's birthday, and a death last week is not yet an anniversary.
        var year = maxOf(today.year, (since ?: 0) + 1)
        var date = fall(year, month, day)
        if (date < today) {
            year += 1
            date = fall(year, month, day)
        }
        return Occasion(
            person = person,
            kind = kind,
            date = date,
            daysAway = ChronoUnit.DAYS.between(today, date).toInt(),
            years = since?.let { year - it },
        )
    }

    /** 29 February keeps to February in a year without one: the 28th, the person's own month. */
    private fun fall(year: Int, month: Int, day: Int): LocalDate =
        if (month == 2 && day == 29 && !java.time.Year.isLeap(year.toLong())) LocalDate.of(year, 2, 28)
        else LocalDate.of(year, month, day)

    private fun RecordedDate.dayOfYear(): Pair<Int, Int>? = when (this) {
        is YearlessDate -> month to day
        is PartialDate -> if (month != null && day != null) month to day else null
    }

    // The living first on any day, then the remembered; names compared as the JavaScript port
    // compares them, code unit by code unit, so the two can never order a day differently.
    private val ORDER = compareBy<Occasion>(
        { it.daysAway },
        { it.kind.ordinal },
        { it.person.name.orEmpty().trim().lowercase() },
        { it.person.id },
    )
}
