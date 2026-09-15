package com.vibethroughcode.ftree.reminders

import com.vibethroughcode.ftree.data.Occasion
import com.vibethroughcode.ftree.data.OccasionKind
import com.vibethroughcode.ftree.data.Person
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZonedDateTime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReminderScheduleTest {

    private val london = ZoneId.of("Europe/London")
    private val kolkata = ZoneId.of("Asia/Kolkata")
    private fun at(zone: ZoneId, text: String) = ZonedDateTime.of(LocalDateTime.parse(text), zone)

    @Test
    fun `before nine the alarm is set for nine today`() {
        val now = at(kolkata, "2026-09-15T07:30")
        assertEquals(at(kolkata, "2026-09-15T09:00"), ReminderSchedule.nextTrigger(now, lastHandled = LocalDate.parse("2026-09-14")))
    }

    @Test
    fun `after nine with the morning dealt with, it is nine tomorrow`() {
        val now = at(kolkata, "2026-09-15T14:00")
        assertEquals(at(kolkata, "2026-09-16T09:00"), ReminderSchedule.nextTrigger(now, lastHandled = LocalDate.parse("2026-09-15")))
    }

    @Test
    fun `a morning still owed is due now, not skipped to tomorrow`() {
        // The phone was off at nine, or the app was updated at ten: today's note is still sent.
        val now = at(kolkata, "2026-09-15T10:15")
        assertEquals(now, ReminderSchedule.nextTrigger(now, lastHandled = LocalDate.parse("2026-09-14")))
        assertTrue(ReminderSchedule.isDue(now, LocalDate.parse("2026-09-14")))
        assertTrue(ReminderSchedule.isDue(now, null))
    }

    @Test
    fun `nothing is owed before nine, or twice in one day`() {
        assertFalse(ReminderSchedule.isDue(at(kolkata, "2026-09-15T08:59"), null))
        assertFalse(ReminderSchedule.isDue(at(kolkata, "2026-09-15T09:30"), LocalDate.parse("2026-09-15")))
        assertTrue(ReminderSchedule.isDue(at(kolkata, "2026-09-15T09:00"), LocalDate.parse("2026-09-14")))
    }

    @Test
    fun `the year turns over`() {
        val now = at(kolkata, "2026-12-31T20:00")
        assertEquals(at(kolkata, "2027-01-01T09:00"), ReminderSchedule.nextTrigger(now, LocalDate.parse("2026-12-31")))
    }

    @Test
    fun `nine o'clock survives the clocks going forward and back`() {
        // British Summer Time starts 29 March 2026 and ends 25 October 2026, both overnight.
        val spring = ReminderSchedule.nextTrigger(at(london, "2026-03-28T21:00"), LocalDate.parse("2026-03-28"))
        assertEquals(LocalDateTime.parse("2026-03-29T09:00"), spring.toLocalDateTime())
        val autumn = ReminderSchedule.nextTrigger(at(london, "2026-10-24T21:00"), LocalDate.parse("2026-10-24"))
        assertEquals(LocalDateTime.parse("2026-10-25T09:00"), autumn.toLocalDateTime())
    }

    @Test
    fun `the day before looks at tomorrow`() {
        val today = LocalDate.parse("2026-12-31")
        assertEquals(today, ReminderSchedule.targetDay(today, ReminderLead.ON_THE_DAY))
        assertEquals(LocalDate.parse("2027-01-01"), ReminderSchedule.targetDay(today, ReminderLead.DAY_BEFORE))
    }

    @Test
    fun `remembrance days come only when asked for`() {
        val day = LocalDate.parse("2026-09-15")
        val birthday = Occasion(Person(name = "Asha"), OccasionKind.BIRTHDAY, day, 0, 60)
        val barsi = Occasion(Person(name = "Ramesh", deceased = true), OccasionKind.DEATH_ANNIVERSARY, day, 0, 12)
        assertEquals(listOf(birthday), ReminderSchedule.select(listOf(birthday, barsi), remembrance = false))
        assertEquals(listOf(birthday, barsi), ReminderSchedule.select(listOf(birthday, barsi), remembrance = true))
    }
}
