package com.vibethroughcode.ftree.ui

import androidx.compose.ui.input.key.Key
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performKeyInput
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.pressKey
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.vibethroughcode.ftree.FTreeApplication
import com.vibethroughcode.ftree.MainActivity
import com.vibethroughcode.ftree.data.PartialDate
import com.vibethroughcode.ftree.data.YearlessDate
import com.vibethroughcode.ftree.ui.person.DateSlot
import com.vibethroughcode.ftree.ui.person.EditBornFieldTag
import com.vibethroughcode.ftree.ui.person.EditNameFieldTag
import com.vibethroughcode.ftree.ui.person.EditSaveTag
import com.vibethroughcode.ftree.ui.person.PersonEditTag
import com.vibethroughcode.ftree.ui.person.dateSlotTag
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The date field as a person meets it (#90): digits only, the hyphens already drawn, the caret
 * moving on by itself, and a birthday that can be kept without a year and given one later.
 *
 * The rules themselves are JVM-tested against the table the desktop shares (`DateEntryTest`); this
 * is about the widget - focus, the read-back line, and when an error is allowed to show.
 */
@RunWith(AndroidJUnit4::class)
class DateFieldTest {

    @get:Rule
    val rule = createAndroidComposeRule<MainActivity>()

    private val year get() = rule.onNodeWithTag(dateSlotTag(EditBornFieldTag, DateSlot.YEAR))
    private val month get() = rule.onNodeWithTag(dateSlotTag(EditBornFieldTag, DateSlot.MONTH))
    private val day get() = rule.onNodeWithTag(dateSlotTag(EditBornFieldTag, DateSlot.DAY))

    @Before
    fun startANewPerson() {
        val app = InstrumentationRegistry.getInstrumentation()
            .targetContext.applicationContext as FTreeApplication
        app.container.database.clearAllTables()
        rule.waitUntil(5_000) {
            rule.onAllNodesWithText("Add your first person").fetchSemanticsNodes().isNotEmpty()
        }
        rule.onNodeWithText("Add your first person").performClick()
        rule.waitForIdle()
    }

    private fun save() {
        rule.onNodeWithTag(EditSaveTag).performScrollTo().performClick()
        rule.waitForIdle()
    }

    @Test
    fun eachSlotMovesOnWhenItIsFullSoADateIsDigitsAlone() {
        year.performTextInput("1938")
        rule.waitForIdle()
        month.assertIsFocused()

        // 4 can only be April, so it is 04 and the caret is already in the day.
        month.performTextInput("4")
        rule.waitForIdle()
        month.assertTextEquals("04")
        day.assertIsFocused()

        day.performTextInput("17")
        rule.waitForIdle()
        // Read back as it will be kept, which is what catches a month and day swapped.
        rule.onNodeWithText(PartialDate(1938, 4, 17).display()).assertIsDisplayed()
    }

    @Test
    fun aBirthdayCanBeKeptWithoutAYearAndGivenOneLater() {
        rule.onNodeWithTag(EditNameFieldTag).performTextInput("Dadi")
        month.performTextInput("0417")
        rule.waitForIdle()
        val birthday = YearlessDate(4, 17).display()
        rule.onNodeWithText("$birthday · year not known").assertIsDisplayed()
        save()
        rule.onNodeWithText("Born $birthday").assertIsDisplayed()

        // The year turns up later: tap the year slot and type it.
        rule.onNodeWithTag(PersonEditTag).performClick()
        rule.waitForIdle()
        year.performTextInput("1938")
        save()
        rule.onNodeWithText("Born ${PartialDate(1938, 4, 17).display()}").assertIsDisplayed()
    }

    @OptIn(ExperimentalTestApi::class)
    @Test
    fun backspaceRunsBackThroughTheHyphens() {
        year.performTextInput("1938")
        month.performTextInput("04")
        rule.waitForIdle()
        day.assertIsFocused()

        // The day is empty, so backspace takes the month's last digit - one press per digit.
        day.performKeyInput { pressKey(Key.Backspace) }
        rule.waitForIdle()
        month.assertTextEquals("0")
        month.assertIsFocused()
    }

    @Test
    fun anUnfinishedYearIsNotAnErrorUntilTheFieldIsLeft() {
        year.performTextInput("19")
        rule.waitForIdle()
        rule.onAllNodesWithText("A year has four digits, like 1938").fetchSemanticsNodes().let {
            check(it.isEmpty()) { "an error flashed while the year was still being typed" }
        }

        rule.onNodeWithTag(EditNameFieldTag).performClick()
        rule.waitForIdle()
        rule.onNodeWithText("A year has four digits, like 1938").assertIsDisplayed()
    }
}
