package com.vibethroughcode.ftree.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.vibethroughcode.ftree.FTreeApplication
import com.vibethroughcode.ftree.MainActivity
import com.vibethroughcode.ftree.data.Person
import com.vibethroughcode.ftree.data.YearlessDate
import com.vibethroughcode.ftree.ui.people.ComingUpEmptyTag
import com.vibethroughcode.ftree.ui.people.ComingUpTag
import com.vibethroughcode.ftree.ui.people.ComingUpToggleTag
import com.vibethroughcode.ftree.ui.people.PeopleFilterEveryoneTag
import com.vibethroughcode.ftree.ui.people.PeopleFilterLivingTag
import com.vibethroughcode.ftree.ui.people.PeopleListTag
import com.vibethroughcode.ftree.ui.people.PeopleSearchFieldTag
import com.vibethroughcode.ftree.ui.people.RememberingTag
import com.vibethroughcode.ftree.ui.person.PersonNameTag
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * "Coming up" at the top of People (#230). Every date is worked out from today, so the test says
 * the same thing on whichever day it runs.
 */
@RunWith(AndroidJUnit4::class)
class ComingUpTest {

    @get:Rule
    val rule = createAndroidComposeRule<MainActivity>()

    private val app: FTreeApplication
        get() = InstrumentationRegistry.getInstrumentation()
            .targetContext.applicationContext as FTreeApplication

    private val today = LocalDate.now()

    /** A date [daysAway] from today in a year long past, so the age it gives is known. */
    private fun born(daysAway: Long, yearsAgo: Long): String =
        today.plusDays(daysAway).minusYears(yearsAgo).format(DateTimeFormatter.ISO_LOCAL_DATE)

    private fun yearless(daysAway: Long): String = today.plusDays(daysAway).let { "--%02d-%02d".format(it.monthValue, it.dayOfMonth) }

    @Before
    fun emptyTheTree() {
        app.container.database.clearAllTables()
        rule.waitUntil(5_000) {
            rule.onAllNodesWithText("Build your family tree").fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun seed(vararg people: Person) {
        runBlocking { people.forEach { app.container.familyRepository.addPerson(it) } }
        rule.onNodeWithTag(NavPeopleTag).performClick()
        rule.waitUntil(5_000) { rule.onAllNodesWithTag(PeopleListTag).fetchSemanticsNodes().isNotEmpty() }
    }

    @Test
    fun todayAndTomorrowAreSaidInWordsWithTheAgeTurned() {
        // Kept clear of 29 February, which keeps to the 28th some years and would move "today".
        val asha = Person(name = "Asha Devi", birthDate = born(0, 60))
        val meera = Person(name = "Meera Rani", birthDate = yearless(1))
        seed(asha, meera)

        rule.onNodeWithTag(ComingUpTag).assertIsDisplayed()
        rule.onNode(hasContentDescription("Asha Devi, turns 60, Today")).assertIsDisplayed()
        // No year recorded, so no age to state: just the day.
        rule.onNode(hasContentDescription("Meera Rani, birthday, Tomorrow")).assertIsDisplayed()
    }

    @Test
    fun aTapOpensThePerson() {
        val asha = Person(name = "Asha Devi", birthDate = born(2, 40))
        seed(asha)

        rule.onNode(hasContentDescription("Asha Devi, turns 40", substring = true)).performClick()
        rule.waitUntil(5_000) { rule.onAllNodesWithTag(PersonNameTag).fetchSemanticsNodes().isNotEmpty() }
    }

    @Test
    fun theDepartedAreRememberedUnderTheirOwnHeadingAndLivingHidesThem() {
        val nani = Person(name = "Kamla Devi", birthDate = born(3, 90), deceased = true)
        val ravi = Person(name = "Ravi Kumar", birthDate = born(4, 30))
        seed(nani, ravi)

        rule.onNodeWithTag(RememberingTag).assertIsDisplayed()
        rule.onNode(hasContentDescription("Kamla Devi, would have been 90", substring = true)).assertIsDisplayed()

        rule.onNodeWithTag(PeopleFilterLivingTag).performClick()
        rule.waitForIdle()
        assertTrue(rule.onAllNodesWithTag(RememberingTag).fetchSemanticsNodes().isEmpty())
        rule.onNode(hasContentDescription("Ravi Kumar, turns 30", substring = true)).assertIsDisplayed()

        rule.onNodeWithTag(PeopleFilterEveryoneTag).performClick()
        rule.onNodeWithTag(RememberingTag).assertIsDisplayed()
    }

    @Test
    fun threeShowUntilAskedForAll() {
        val people = (0L until 5L).map { Person(name = "Person $it", birthDate = born(it + 2, 20 + it)) }
        seed(*people.toTypedArray())

        fun shown() = (0 until 5).count {
            rule.onAllNodes(hasContentDescription("Person $it,", substring = true)).fetchSemanticsNodes().isNotEmpty()
        }
        assertEquals(3, shown())

        rule.onNodeWithText("Show all 5").performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(PeopleListTag).performScrollToNode(hasContentDescription("Person 4,", substring = true))
        assertEquals(5, shown())

        rule.onNodeWithTag(ComingUpToggleTag).performClick()
        rule.waitForIdle()
        assertEquals(3, shown())
    }

    @Test
    fun anEmptyWindowSaysWhenTheNextOneIs() {
        val later = today.plusDays(45)
        seed(Person(name = "Asha Devi", birthDate = yearless(45)))

        val day = YearlessDate(later.monthValue, later.dayOfMonth).display(Locale.getDefault())
        rule.onNodeWithTag(ComingUpEmptyTag).assertIsDisplayed()
        rule.onNodeWithText("No birthdays in the next 30 days. Next: Asha Devi, $day.").assertIsDisplayed()
    }

    @Test
    fun aTreeWithoutDaysInvitesOne() {
        seed(Person(name = "Asha Devi", birthDate = "1960"))
        rule.onNodeWithText("Birthdays appear here once someone has a day and month recorded.").assertIsDisplayed()
    }

    @Test
    fun searchingPutsTheBandAway() {
        seed(Person(name = "Asha Devi", birthDate = born(0, 60)))
        rule.onNodeWithTag(ComingUpTag).assertIsDisplayed()

        rule.onNode(hasContentDescription("Search")).performClick()
        rule.onNodeWithTag(PeopleSearchFieldTag).performTextInput("Asha")
        rule.waitUntil(5_000) { rule.onAllNodesWithTag(ComingUpTag).fetchSemanticsNodes().isEmpty() }
    }
}
