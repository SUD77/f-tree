package com.vibethroughcode.ftree.reminders

import android.Manifest
import android.app.NotificationManager
import android.content.ComponentName
import android.content.pm.PackageManager
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.vibethroughcode.ftree.FTreeApplication
import com.vibethroughcode.ftree.data.Person
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The morning's note, delivered for real: posted once, not twice, and gone with the switch.
 *
 * The clock is pinned to half past ten today, so the morning is always owed whatever time the test
 * runs; the people are dated from today for the same reason.
 */
@RunWith(AndroidJUnit4::class)
class RemindersTest {

    private val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as FTreeApplication
    private val container = app.container
    private val today = LocalDate.now()
    private val halfPastTen = ZonedDateTime.of(today, LocalTime.of(10, 30), ZonedDateTime.now().zone)
    private val reminders = Reminders(app, container.reminderPreferences, container.familyRepository) { halfPastTen }
    private val manager = app.getSystemService(NotificationManager::class.java)

    private fun born(daysAway: Long, yearsAgo: Long): String =
        today.plusDays(daysAway).minusYears(yearsAgo).format(DateTimeFormatter.ISO_LOCAL_DATE)

    private fun shown() = manager.activeNotifications.filter { it.id == ReminderNotifier.NOTIFICATION }

    /*
     * Posting and cancelling both go through the system's notification service, which answers a
     * moment later: read too soon, a note just sent is not there yet, and one just cancelled is.
     */
    private fun settled(count: Int): List<android.service.notification.StatusBarNotification> {
        val until = System.currentTimeMillis() + 3_000
        while (shown().size != count && System.currentTimeMillis() < until) Thread.sleep(50)
        return shown().also { assertEquals(count, it.size) }
    }

    /** Nothing arrives: waits long enough that a late note would have landed. */
    private fun nothingShown() {
        Thread.sleep(500)
        assertTrue(shown().isEmpty())
    }

    @Before
    fun start() {
        InstrumentationRegistry.getInstrumentation().uiAutomation
            .grantRuntimePermission(app.packageName, Manifest.permission.POST_NOTIFICATIONS)
        reminders.disable()
        container.database.clearAllTables()
        container.reminderPreferences.setLead(ReminderLead.ON_THE_DAY)
        container.reminderPreferences.setRemembrance(false)
        container.reminderPreferences.lastHandled = null
    }

    @After
    fun finish() = reminders.disable()

    /** On, with this morning still owed — as it is the morning after the switch went on. */
    private fun switchedOnYesterday() {
        reminders.enable()
        container.reminderPreferences.lastHandled = today.minusDays(1)
    }

    @Test
    fun oneNoteNamesTheBirthdayAndASecondAlarmSendsNothing() = runBlocking {
        container.familyRepository.addPerson(Person(name = "Asha Devi", birthDate = born(0, 60)))
        container.familyRepository.addPerson(Person(name = "Ravi Kumar", birthDate = born(1, 30)))
        switchedOnYesterday()

        reminders.deliver()
        val note = settled(1).single().notification
        assertEquals("Asha Devi turns 60 today", note.extras.getString("android.title"))
        // One person: the line under the title says when they were born, not the title again.
        assertTrue(note.extras.getCharSequence("android.text").toString().startsWith("Born "))
        assertEquals(today, container.reminderPreferences.lastHandled)
        assertTrue("tomorrow's alarm is set", reminders.isArmed())

        manager.cancelAll()
        settled(0)
        reminders.deliver()
        nothingShown() // the same morning is not sent twice
    }

    @Test
    fun severalShareOneNote() = runBlocking {
        listOf("Asha Devi", "Meera Rani", "Neha Kumar").forEachIndexed { i, name ->
            container.familyRepository.addPerson(Person(name = name, birthDate = born(0, 30L + i)))
        }
        switchedOnYesterday()

        reminders.deliver()
        assertEquals("3 birthdays today", settled(1).single().notification.extras.getString("android.title"))
    }

    @Test
    fun theDayBeforeLooksAtTomorrowAndRemembranceWaitsToBeAskedFor() = runBlocking {
        container.familyRepository.addPerson(Person(name = "Kamla Devi", birthDate = born(1, 90), deceased = true))
        container.familyRepository.addPerson(Person(name = "Ravi Kumar", birthDate = born(1, 30)))
        container.reminderPreferences.setLead(ReminderLead.DAY_BEFORE)
        switchedOnYesterday()

        reminders.deliver()
        val note = settled(1).single().notification
        assertEquals("Tomorrow: Ravi Kumar turns 30", note.extras.getString("android.title"))
        assertFalse(
            "a remembrance day is not sent until asked for",
            note.extras.getCharSequenceArray("android.textLines").orEmpty().any { it.contains("Kamla") },
        )

        manager.cancelAll()
        settled(0)
        container.reminderPreferences.setRemembrance(true)
        container.reminderPreferences.lastHandled = today.minusDays(1)
        reminders.deliver()
        val lines = settled(1).single().notification.extras.getCharSequenceArray("android.textLines").orEmpty()
        assertTrue(lines.any { it.toString() == "Kamla Devi — would have been 90" })
    }

    @Test
    fun aMorningWithNothingInItSendsNothingButCountsAsDealtWith() = runBlocking {
        container.familyRepository.addPerson(Person(name = "Asha Devi", birthDate = born(10, 60)))
        switchedOnYesterday()

        reminders.deliver()
        nothingShown()
        assertEquals(today, container.reminderPreferences.lastHandled)
    }

    @Test
    fun switchingOnAfterNineDoesNotAnswerWithANoteAboutToday() = runBlocking {
        container.familyRepository.addPerson(Person(name = "Asha Devi", birthDate = born(0, 60)))
        reminders.enable()

        reminders.deliver()
        nothingShown()
    }

    @Test
    fun switchingOffCancelsTheAlarmTheNoteAndTheRestartReceiver() = runBlocking {
        container.familyRepository.addPerson(Person(name = "Asha Devi", birthDate = born(0, 60)))
        switchedOnYesterday()
        val restart = ComponentName(app, ReminderRestartReceiver::class.java)
        assertEquals(PackageManager.COMPONENT_ENABLED_STATE_ENABLED, app.packageManager.getComponentEnabledSetting(restart))
        reminders.deliver()
        settled(1)

        reminders.disable()
        settled(0)
        assertFalse(reminders.isArmed())
        assertEquals(PackageManager.COMPONENT_ENABLED_STATE_DISABLED, app.packageManager.getComponentEnabledSetting(restart))

        // A stray alarm after switching off sends nothing.
        container.reminderPreferences.lastHandled = null
        reminders.deliver()
        nothingShown()
        assertNull(container.reminderPreferences.lastHandled)
    }
}
