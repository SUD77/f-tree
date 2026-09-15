package com.vibethroughcode.ftree.ui.people

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridScope
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.outlined.NotificationsNone
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vibethroughcode.ftree.R
import com.vibethroughcode.ftree.data.Occasion
import com.vibethroughcode.ftree.data.OccasionKind
import com.vibethroughcode.ftree.data.YearlessDate
import com.vibethroughcode.ftree.ui.common.PersonAvatar
import com.vibethroughcode.ftree.ui.common.displayName
import com.vibethroughcode.ftree.ui.theme.FTreeText
import com.vibethroughcode.ftree.ui.theme.FTreeTheme
import java.time.format.DateTimeFormatter

const val ComingUpTag = "coming-up"
const val ComingUpToggleTag = "coming-up-toggle"
const val ComingUpEmptyTag = "coming-up-empty"
const val RememberingTag = "coming-up-remembering"
const val ComingUpBellTag = "coming-up-bell"
fun comingUpRowTag(occasion: Occasion): String = "coming-up-${occasion.person.id}-${occasion.kind.name.lowercase()}"

/** How many of each group show before "Show all": enough to answer "anyone soon?" at a glance. */
private const val FOLDED = 3

/**
 * "Coming up", at the top of People (#230): the family's next 30 days, as rows in the list's own grid.
 *
 * Emitted into the People grid rather than drawn as one block above it, so each day takes a column
 * like any person does — one on a phone, three on a tablet — and scrolls away with the list instead
 * of standing over it. Living birthdays come first; the days the departed are remembered on follow
 * under their own heading, on the ground the chart already uses for them.
 */
fun LazyGridScope.comingUp(
    band: ComingUp,
    showRemembering: Boolean,
    expanded: Boolean,
    onToggle: () -> Unit,
    onOpenPerson: (String) -> Unit,
    remindersOn: Boolean = false,
    onReminders: (() -> Unit)? = null,
) {
    val remembering = if (showRemembering) band.remembering else emptyList()
    val folded = band.birthdays.size > FOLDED || remembering.size > FOLDED
    val birthdays = if (expanded) band.birthdays else band.birthdays.take(FOLDED)
    val remembered = if (expanded) remembering else remembering.take(FOLDED)

    item(key = "coming-up-heading", span = { GridItemSpan(maxLineSpan) }) {
        RuledHeading(
            label = stringResource(R.string.coming_up_title),
            trailing = stringResource(R.string.coming_up_window),
            modifier = Modifier.testTag(ComingUpTag),
            action = onReminders?.let { open ->
                {
                    // The switch where the need is felt: filled when reminders are on, outlined when not.
                    IconButton(onClick = open, modifier = Modifier.testTag(ComingUpBellTag)) {
                        Icon(
                            if (remindersOn) Icons.Filled.Notifications else Icons.Outlined.NotificationsNone,
                            contentDescription = stringResource(
                                if (remindersOn) R.string.coming_up_reminders_on else R.string.coming_up_reminders_off,
                            ),
                            tint = if (remindersOn) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            },
        )
    }
    if (band.birthdays.isEmpty()) {
        item(key = "coming-up-empty", span = { GridItemSpan(maxLineSpan) }) {
            val next = band.next
            val locale = LocalConfiguration.current.locales[0]
            Text(
                text = if (next != null) {
                    stringResource(
                        R.string.coming_up_none_soon,
                        next.person.displayName(),
                        YearlessDate(next.date.monthValue, next.date.dayOfMonth).display(locale),
                    )
                } else {
                    stringResource(R.string.coming_up_none_recorded)
                },
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 8.dp)
                    .testTag(ComingUpEmptyTag),
            )
        }
    }
    items(birthdays, key = { "coming-up-${it.person.id}-${it.kind}" }) { occasion ->
        OccasionRow(occasion, onClick = { onOpenPerson(occasion.person.id) })
    }
    if (remembered.isNotEmpty()) {
        item(key = "coming-up-remembering", span = { GridItemSpan(maxLineSpan) }) {
            RuledHeading(
                label = stringResource(R.string.coming_up_remembering),
                modifier = Modifier.testTag(RememberingTag),
            )
        }
        items(remembered, key = { "coming-up-${it.person.id}-${it.kind}" }) { occasion ->
            OccasionRow(occasion, onClick = { onOpenPerson(occasion.person.id) })
        }
    }
    if (folded) {
        item(key = "coming-up-toggle", span = { GridItemSpan(maxLineSpan) }) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp)) {
                TextButton(onClick = onToggle, modifier = Modifier.testTag(ComingUpToggleTag)) {
                    Text(
                        if (expanded) stringResource(R.string.coming_up_show_fewer)
                        else stringResource(R.string.coming_up_show_all, band.birthdays.size + remembering.size),
                    )
                }
            }
        }
    }
}

/** The heading over the list itself, once there is a band above it to tell apart from. */
fun LazyGridScope.listHeading(label: String) {
    item(key = "people-heading", span = { GridItemSpan(maxLineSpan) }) {
        RuledHeading(label = label)
    }
}

/** A ruled label in the mono voice — the compact view's band heading, so the app has one kind of heading. */
@Composable
private fun RuledHeading(
    label: String,
    modifier: Modifier = Modifier,
    trailing: String? = null,
    action: (@Composable () -> Unit)? = null,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            // An icon button brings its own 48dp of room, so the row gives back what it would pad.
            .padding(start = 20.dp, end = if (action != null) 8.dp else 20.dp, top = if (action != null) 2.dp else 14.dp, bottom = if (action != null) 0.dp else 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = label.uppercase(),
            style = FTreeText.sectionLabel,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.semantics { heading() },
        )
        HorizontalDivider(modifier = Modifier.weight(1f), thickness = 1.dp, color = FTreeTheme.accents.rule)
        if (trailing != null) {
            Text(text = trailing, style = FTreeText.recordSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        action?.invoke()
    }
}

/**
 * One day: when, whose, and what it is.
 *
 * The date is a block of its own at the start of the row, in the mono, so a column of days reads
 * down the list the way the years do in a person's row.
 */
@Composable
private fun OccasionRow(occasion: Occasion, onClick: () -> Unit) {
    val locale = LocalConfiguration.current.locales[0]
    val soon = occasion.daysAway <= 1
    val accent = MaterialTheme.colorScheme.primary
    val remembered = occasion.kind != OccasionKind.BIRTHDAY
    val detail = occasionDetail(occasion)
    // A calendar leaf: the month over the day, and under it the weekday — or "Today" and
    // "Tomorrow", the two a person acts on. The month is always there because the window crosses
    // into the next one, and "10" after "24" is otherwise a puzzle.
    val weekday = when (occasion.daysAway) {
        0 -> stringResource(R.string.coming_up_today)
        1 -> stringResource(R.string.coming_up_tomorrow)
        else -> DateTimeFormatter.ofPattern("EEE", locale).format(occasion.date)
    }
    val month = DateTimeFormatter.ofPattern("MMM", locale).format(occasion.date)
    val whenSpoken = when (occasion.daysAway) {
        0 -> stringResource(R.string.coming_up_today)
        1 -> stringResource(R.string.coming_up_tomorrow)
        else -> DateTimeFormatter.ofPattern("EEEE d MMMM", locale).format(occasion.date)
    }
    val name = occasion.person.displayName()
    val spoken = stringResource(R.string.coming_up_a11y, name, detail, whenSpoken)

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .then(if (remembered) Modifier.background(FTreeTheme.accents.deceasedSurface) else Modifier)
            .clickable(onClick = onClick)
            .defaultMinSize(minHeight = 64.dp)
            .padding(horizontal = 20.dp, vertical = 10.dp)
            // One stop for a screen reader, in the order a person would say it.
            .clearAndSetSemantics {
                contentDescription = spoken
                role = Role.Button
                onClick { onClick(); true }
            }
            .testTag(comingUpRowTag(occasion)),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Column(Modifier.width(56.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                text = month.uppercase(locale),
                style = FTreeText.recordSmall,
                color = if (occasion.daysAway == 0) accent else MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
            )
            Text(
                text = occasion.date.dayOfMonth.toString(),
                style = FTreeText.record.copy(fontSize = 20.sp, lineHeight = 22.sp),
                color = if (occasion.daysAway == 0) accent else MaterialTheme.colorScheme.onSurface,
            )
            Text(
                text = weekday,
                style = FTreeText.recordSmall,
                color = if (soon) accent else MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                maxLines = 1,
            )
        }
        PersonAvatar(occasion.person, decorative = true)
        Column(Modifier.weight(1f)) {
            Text(
                text = name,
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = detail,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** "turns 60", "would have been 90", "12 years since they died" — the same words the desktop uses. */
@Composable
fun occasionDetail(occasion: Occasion): String {
    val years = occasion.years
    return when (occasion.kind) {
        OccasionKind.BIRTHDAY ->
            if (years != null) stringResource(R.string.coming_up_turns, years) else stringResource(R.string.coming_up_birthday)
        OccasionKind.BIRTH_REMEMBRANCE ->
            if (years != null) stringResource(R.string.coming_up_would_have_been, years) else stringResource(R.string.coming_up_birthday)
        OccasionKind.DEATH_ANNIVERSARY ->
            if (years != null) pluralStringResource(R.plurals.coming_up_years_since, years, years)
            else stringResource(R.string.coming_up_death_day)
    }
}
