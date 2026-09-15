package com.vibethroughcode.ftree.ui.person

import androidx.compose.foundation.clickable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.error
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vibethroughcode.ftree.R
import com.vibethroughcode.ftree.data.RecordedDate
import com.vibethroughcode.ftree.data.YearlessDate
import com.vibethroughcode.ftree.ui.theme.FTreeText
import java.time.Month
import java.time.format.TextStyle as MonthStyle

/** Test tags for the month and day slots; the year slot carries the field's own tag. */
fun dateSlotTag(tag: String, slot: DateSlot): String = if (slot == DateSlot.YEAR) tag else "$tag.${slot.name.lowercase()}"

/**
 * A birth or death date typed as digits into `YYYY-MM-DD`, with the hyphens already there (#90).
 *
 * One outlined field to the eye, three text fields underneath: each slot moves on when it is full,
 * so `19380417` needs no separator key — the one a phone keyboard hides behind a layout switch. An
 * empty year slot is a birthday with no year; tapping it later adds one. The rules are in
 * [DateEntry]; this only draws them and moves the caret.
 *
 * The three share one interaction source, so the outline and the floating label behave exactly as
 * an [androidx.compose.material3.OutlinedTextField] would. Under it, the supporting line reads the
 * date back as it will be kept — "17 April 1938" — which is what catches a month and day typed the
 * wrong way round, a mistake no validation can see.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun DateField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    problem: DateProblem?,
    tag: String,
) {
    val parts = DateEntry.decode(value)
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val requesters = remember { DateSlot.entries.associateWith { FocusRequester() } }
    var pendingFocus by remember { mutableStateOf<DateSlot?>(null) }

    // The read-back line is the point of the field, so the whole of it - not only the slot with the
    // caret, which is all a text field brings into view by itself - is kept above the keyboard.
    val whole = remember { BringIntoViewRequester() }
    val keyboard = WindowInsets.ime.getBottom(LocalDensity.current)
    LaunchedEffect(focused, keyboard) {
        if (focused) whole.bringIntoView()
    }

    LaunchedEffect(pendingFocus) {
        pendingFocus?.let { requesters.getValue(it).requestFocus() }
        pendingFocus = null
    }

    fun apply(edit: DateEdit, from: DateSlot) {
        val encoded = edit.parts.encode()
        if (encoded != value) onValueChange(encoded)
        if (edit.focus != from) pendingFocus = edit.focus
    }

    val shown = problem?.takeIf { !focused || DateEntry.isFinal(it, value) }
    val active = focused || !parts.isEmpty
    val style = FTreeText.record.copy(
        fontSize = 16.sp,
        lineHeight = 24.sp,
        color = MaterialTheme.colorScheme.onSurface,
    )
    val ghost = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.55f)
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val slotWidth = { chars: Int ->
        // Mono digits, measured rather than guessed, plus room for the caret after the last one.
        with(density) { measurer.measure("0".repeat(chars), style).size.width.toDp() } + 2.dp
    }
    val ghosts = mapOf(
        DateSlot.YEAR to stringResource(R.string.edit_date_ghost_year),
        DateSlot.MONTH to stringResource(R.string.edit_date_ghost_month),
        DateSlot.DAY to stringResource(R.string.edit_date_ghost_day),
    )
    val names = mapOf(
        DateSlot.YEAR to stringResource(R.string.edit_date_slot_year, label),
        DateSlot.MONTH to stringResource(R.string.edit_date_slot_month, label),
        DateSlot.DAY to stringResource(R.string.edit_date_slot_day, label),
    )
    val errorText = shown?.let { problemText(it, value) }

    Box(Modifier.bringIntoViewRequester(whole)) {
        OutlinedTextFieldDefaults.DecorationBox(
            value = value,
            innerTextField = {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .fillMaxWidth()
                        // A tap on the field but between or beside the slots lands where typing would.
                        .clickable(interactionSource = null, indication = null) {
                            pendingFocus = when {
                                parts.isEmpty -> DateSlot.YEAR
                                parts.month.isNotEmpty() || parts.day.isNotEmpty() -> DateSlot.DAY
                                else -> DateSlot.MONTH
                            }
                        },
                ) {
                    DateSlot.entries.forEach { slot ->
                        if (slot != DateSlot.YEAR) {
                            // Ink once the slot after it holds digits, so a finished date reads as one
                            // date; faint while it is still only the shape of one.
                            Text(
                                text = "-",
                                style = style,
                                color = when {
                                    !active -> style.color.copy(alpha = 0f)
                                    parts[slot].isNotEmpty() -> style.color
                                    else -> ghost
                                },
                            )
                        }
                        // Each slot keeps its own caret, started afresh at the end whenever a rule rather
                        // than a keystroke sets the text (`4` becoming `04`): that is where the next digit goes.
                        val text = parts[slot]
                        var field by remember(text) { mutableStateOf(TextFieldValue(text, TextRange(text.length))) }
                        BasicTextField(
                            value = field,
                            onValueChange = { next ->
                                if (next.text == field.text) {
                                    field = next // the caret moved; nothing was typed
                                } else {
                                    apply(DateEntry.enter(parts, slot, next.text), slot)
                                }
                            },
                            singleLine = true,
                            textStyle = style,
                            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.Number,
                                imeAction = ImeAction.Next,
                            ),
                            interactionSource = interaction,
                            decorationBox = { inner ->
                                Box {
                                    if (field.text.isEmpty() && active) Text(ghosts.getValue(slot), style = style, color = ghost)
                                    inner()
                                }
                            },
                            modifier = Modifier
                                .width(slotWidth(if (slot == DateSlot.YEAR) 4 else 2))
                                .focusRequester(requesters.getValue(slot))
                                .onPreviewKeyEvent { event ->
                                    if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                                    val caret = field.selection
                                    when {
                                        event.key == Key.Backspace && field.text.isEmpty() && slot != DateSlot.YEAR -> {
                                            apply(DateEntry.backspace(parts, slot), slot)
                                            true
                                        }
                                        event.key == Key.DirectionLeft && caret.collapsed && caret.start == 0 &&
                                            slot != DateSlot.YEAR -> {
                                            pendingFocus = DateSlot.entries[slot.ordinal - 1]
                                            true
                                        }
                                        event.key == Key.DirectionRight && caret.collapsed &&
                                            caret.start == field.text.length && slot != DateSlot.DAY -> {
                                            pendingFocus = DateSlot.entries[slot.ordinal + 1]
                                            true
                                        }
                                        else -> false
                                    }
                                }
                                .semantics {
                                    contentDescription = names.getValue(slot)
                                    if (errorText != null) error(errorText)
                                }
                                .testTag(dateSlotTag(tag, slot)),
                        )
                    }
                }
            },
            enabled = true,
            singleLine = true,
            visualTransformation = VisualTransformation.None,
            interactionSource = interaction,
            isError = shown != null,
            label = { Text(label) },
            supportingText = {
                Text(
                    text = errorText ?: readBack(value, problem) ?: stringResource(R.string.edit_date_support),
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
            },
        )
    }
}

/** The date as it will be kept, in words; null while there is nothing whole to read back. */
@Composable
private fun readBack(value: String, problem: DateProblem?): String? {
    if (problem != null) return null
    val locale = LocalConfiguration.current.locales[0]
    return when (val date = RecordedDate.parse(DateEntry.settle(value))) {
        null -> null
        is YearlessDate -> stringResource(R.string.edit_date_readback_yearless, date.display(locale))
        else -> date.display(locale)
    }
}

@Composable
private fun problemText(problem: DateProblem, value: String): String {
    val parts = DateEntry.decode(DateEntry.settle(value))
    return when (problem) {
        DateProblem.YEAR_INCOMPLETE -> stringResource(R.string.edit_date_year_incomplete)
        DateProblem.MONTH_OUT_OF_RANGE -> stringResource(R.string.edit_date_month_range)
        DateProblem.DAY_OUT_OF_RANGE -> stringResource(R.string.edit_date_day_range)
        DateProblem.DAY_NOT_IN_MONTH -> {
            val month = parts.month.toInt()
            val name = Month.of(month).getDisplayName(MonthStyle.FULL_STANDALONE, LocalConfiguration.current.locales[0])
            stringResource(R.string.edit_date_day_not_in_month, name, DateEntry.maxDays(month))
        }
        DateProblem.NOT_A_LEAP_YEAR -> stringResource(R.string.edit_date_not_leap, parts.year)
        DateProblem.DAY_WITHOUT_MONTH -> stringResource(R.string.edit_date_day_without_month)
        DateProblem.MONTH_ALONE -> stringResource(R.string.edit_date_month_alone)
        DateProblem.MALFORMED -> stringResource(R.string.edit_date_invalid)
        DateProblem.DEATH_BEFORE_BIRTH -> stringResource(R.string.edit_death_before_birth)
    }
}
