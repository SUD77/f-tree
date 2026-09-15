package com.vibethroughcode.ftree.ui.settings

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.LocalActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vibethroughcode.ftree.R
import com.vibethroughcode.ftree.reminders.ReminderLead
import com.vibethroughcode.ftree.ui.common.SectionRule

const val SettingsRemindersToggleTag = "settings-reminders-toggle"
const val SettingsRemindersRemembranceTag = "settings-reminders-remembrance"
const val SettingsRemindersDayBeforeTag = "settings-reminders-day-before"
const val SettingsRemindersNoteTag = "settings-reminders-note"
const val SettingsRemindersOpenSystemTag = "settings-reminders-open-system"

/**
 * Birthday reminders (#154), read the way the updater's switch is: off until turned on, and the
 * sentence under it says exactly what turning it on does.
 *
 * Android is asked to allow notifications at the moment the switch is turned on and at no other
 * time, and the switch moves only once it has said yes. Refused, the switch stays off and says why;
 * refused for good — Android stops asking after the second no — it offers the system page where
 * that can be undone. Turned off later in Android's own settings, a warning says reminders cannot
 * be shown, rather than the switch pretending otherwise.
 *
 * [focus] brings the block into view when People's bell sent the reader here.
 */
@Composable
fun ReminderSettings(viewModel: SettingsViewModel, focus: Boolean, onFocused: () -> Unit) {
    val context = LocalContext.current
    val activity = LocalActivity.current
    val enabled by viewModel.remindersEnabled.collectAsStateWithLifecycle()
    val lead by viewModel.reminderLead.collectAsStateWithLifecycle()
    val remembrance by viewModel.reminderRemembrance.collectAsStateWithLifecycle()
    val canNotify by viewModel.canNotify.collectAsStateWithLifecycle()
    val census by viewModel.reminderCensus.collectAsStateWithLifecycle()
    var refused by rememberSaveable { mutableStateOf(false) }
    var refusedForGood by rememberSaveable { mutableStateOf(false) }
    val here = remember { BringIntoViewRequester() }

    LifecycleResumeEffect(Unit) {
        viewModel.refreshReminders()
        onPauseOrDispose {}
    }
    LaunchedEffect(focus) {
        if (focus) {
            here.bringIntoView()
            onFocused()
        }
    }

    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            refused = false
            refusedForGood = false
            viewModel.enableReminders()
        } else {
            refused = true
            refusedForGood = activity
                ?.let { !ActivityCompat.shouldShowRequestPermissionRationale(it, Manifest.permission.POST_NOTIFICATIONS) }
                ?: false
        }
    }

    val openSystemSettings = {
        context.startActivity(
            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName),
        )
    }

    Column(Modifier.bringIntoViewRequester(here)) {
        SectionRule(stringResource(R.string.settings_section_reminders))

        SettingsSwitch(
            title = stringResource(R.string.settings_reminders_toggle),
            body = stringResource(if (enabled) R.string.settings_reminders_on else R.string.settings_reminders_off),
            checked = enabled,
            onCheckedChange = { wanted ->
                when {
                    !wanted -> viewModel.disableReminders()
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
                        PackageManager.PERMISSION_GRANTED -> ask.launch(Manifest.permission.POST_NOTIFICATIONS)
                    else -> viewModel.enableReminders()
                }
            },
            tag = SettingsRemindersToggleTag,
        )

        val note = when {
            !enabled && refused -> stringResource(R.string.settings_reminders_denied)
            enabled && !canNotify -> stringResource(R.string.settings_reminders_blocked)
            enabled -> census?.let { coverage(it.covered, it.noDay, it.presumedDeparted) }
            else -> null
        }
        val warning = (!enabled && refused) || (enabled && !canNotify)
        if (note != null) {
            Text(
                note,
                style = MaterialTheme.typography.bodySmall,
                color = if (warning) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(bottom = 4.dp).testTag(SettingsRemindersNoteTag),
            )
        }
        if ((!enabled && refusedForGood) || (enabled && !canNotify)) {
            TextButton(onClick = openSystemSettings, modifier = Modifier.testTag(SettingsRemindersOpenSystemTag)) {
                Text(stringResource(R.string.settings_reminders_open_settings))
            }
        }

        if (enabled) {
            Text(
                stringResource(R.string.settings_reminders_when),
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.padding(top = 12.dp, bottom = 8.dp),
            )
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                SegmentedButton(
                    selected = lead == ReminderLead.ON_THE_DAY,
                    onClick = { viewModel.setReminderLead(ReminderLead.ON_THE_DAY) },
                    shape = SegmentedButtonDefaults.itemShape(index = 0, count = 2),
                ) { Text(stringResource(R.string.settings_reminders_on_the_day)) }
                SegmentedButton(
                    selected = lead == ReminderLead.DAY_BEFORE,
                    onClick = { viewModel.setReminderLead(ReminderLead.DAY_BEFORE) },
                    shape = SegmentedButtonDefaults.itemShape(index = 1, count = 2),
                    modifier = Modifier.testTag(SettingsRemindersDayBeforeTag),
                ) { Text(stringResource(R.string.settings_reminders_day_before)) }
            }
            SettingsSwitch(
                title = stringResource(R.string.settings_reminders_remembrance),
                body = stringResource(R.string.settings_reminders_remembrance_body),
                checked = remembrance,
                onCheckedChange = viewModel::setReminderRemembrance,
                tag = SettingsRemindersRemembranceTag,
            )
        }
    }
}

/** "Covers 42 people. 106 have no day and month recorded." — who is left out is said, never skipped in silence. */
@Composable
private fun coverage(covered: Int, noDay: Int, presumed: Int): String = buildList {
    add(pluralStringResource(R.plurals.settings_reminders_covers, covered, covered))
    if (noDay > 0) add(pluralStringResource(R.plurals.settings_reminders_no_day, noDay, noDay))
    if (presumed > 0) add(pluralStringResource(R.plurals.settings_reminders_presumed, presumed, presumed))
}.joinToString(" ")
