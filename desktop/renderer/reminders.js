/*
 * When a reminder is due, and what it says (#154).
 *
 * Desktop reminders exist only while f-tree is open: there is no tray, no login item, and no
 * process running once the window is closed. What that buys back is the same-day catch-up --
 * somebody who opens the app once a week still gets today's reminder the moment they do, because
 * `dueNow` asks "is it past nine, and have we not already told them today" rather than "did an
 * alarm fire at nine sharp". It also means turning the switch off needs no scheduler to cancel:
 * `dueNow` simply returns null while `reminders` is false, so off is off at once, everywhere this
 * gets called from (`renderer/app.js`'s `checkReminders`, on startup, on a tree opening, on the
 * window regaining focus, and on a 15-minute interval robust to the machine having slept through a
 * shorter one).
 *
 * Pure, and deliberately not read against the wall clock itself: `now` is passed in, so the tests
 * can hold it still and the smoke harness can move only the hour -- `FTREE_SMOKE_REMINDER_HOUR`,
 * read in `preload.js` and applied in `app.js`'s `remindersClock` -- without lying about the date a
 * "birthday today" assertion depends on.
 *
 * A port of nothing in particular: Android's half of #154 schedules through `AlarmManager`, which
 * this app has no equivalent of and does not want one, precisely because "while f-tree is open" is
 * the whole design. What is shared is the wording, kept identical by eye against the phone's
 * strings so a family member switching devices reads the same sentence either way.
 */

import { localToday } from '../../site/playground/occasions.js';
import { displayName } from '../../site/playground/model.js';

const DAY_MS = 86400000;

/** `today` plus one calendar day, both `YYYY-MM-DD` -- the same UTC-anchored arithmetic occasions.js uses, so a date never disagrees with itself across a timezone. */
function tomorrowOf(today) {
  const [y, m, d] = today.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d) + DAY_MS);
  const pad = (n) => String(n).padStart(2, '0');
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/**
 * Whether a digest should be checked for right now, and which day it would be about.
 *
 * Null unless reminders are on, it is at or past nine in the morning on this machine's own clock,
 * and today has not already shown one -- a digest is one a day, however many occasions share it.
 * `target` is the day the reminder describes: today itself "on the day", or tomorrow when the lead
 * time is "the day before", so a birthday somebody would otherwise miss on a day they never opened
 * the app is said a day early instead.
 */
export function dueNow(settings, now = new Date()) {
  if (!settings?.reminders) return null;
  if (now.getHours() < 9) return null;
  const today = localToday(now);
  if (settings.remindersShownOn === today) return null;
  const target = settings.reminderLead === 'before' ? tomorrowOf(today) : today;
  return { today, target };
}

/**
 * The detail line for one occasion -- verbatim the same words the "Coming up" band's rows and a
 * reminder's body both use, from one place, so the two can never drift apart.
 */
export function detailFor(occasion) {
  const { kind, years } = occasion;
  if (kind === 'BIRTHDAY') return years == null ? 'birthday' : `turns ${years}`;
  if (kind === 'BIRTH_REMEMBRANCE') return years == null ? 'birthday' : `would have been ${years}`;
  // DEATH_ANNIVERSARY.
  if (years == null) return 'the day they died';
  return years === 1 ? '1 year since they died' : `${years} years since they died`;
}

function birthdayTitle(birthdays, tomorrow) {
  if (birthdays.length > 1) {
    return `${birthdays.length} birthdays ${tomorrow ? 'tomorrow' : 'today'}`;
  }
  const { person, years } = birthdays[0];
  const name = displayName(person);
  if (tomorrow) {
    return years == null ? `Tomorrow is ${name}'s birthday` : `Tomorrow: ${name} turns ${years}`;
  }
  return years == null ? `It's ${name}'s birthday today` : `${name} turns ${years} today`;
}

function remembranceTitle(remembered, tomorrow) {
  if (remembered.length > 1) {
    return `${remembered.length} remembrance days ${tomorrow ? 'tomorrow' : 'today'}`;
  }
  return `Remembering ${displayName(remembered[0].person)} ${tomorrow ? 'tomorrow' : 'today'}`;
}

/**
 * The one notification a day, or null when there is nothing worth showing.
 *
 * `occasions` is what `on()` in occasions.js already answered for the target day -- the living
 * before the remembered, alphabetical within each. Remembrance is dropped first unless it was asked
 * for: that switch is off by default, and somebody who never turned it on should never meet a barsi
 * in a notification. A birthday always outranks remembrance in the title, the same ordering the list
 * itself uses. `personId` is set only when there is exactly one occasion left -- the one case where
 * a click can usefully land on a person rather than on the list.
 */
export function digest(occasions, { lead, remembrance }) {
  const relevant = occasions.filter((o) => o.kind === 'BIRTHDAY' || remembrance);
  if (relevant.length === 0) return null;

  const birthdays = relevant.filter((o) => o.kind === 'BIRTHDAY');
  const remembered = relevant.filter((o) => o.kind !== 'BIRTHDAY');
  const tomorrow = lead === 'before';

  return {
    title: birthdays.length > 0 ? birthdayTitle(birthdays, tomorrow) : remembranceTitle(remembered, tomorrow),
    body: relevant.map((o) => `${displayName(o.person)} — ${detailFor(o)}`).join('\n'),
    personId: relevant.length === 1 ? relevant[0].person.id : null,
  };
}
