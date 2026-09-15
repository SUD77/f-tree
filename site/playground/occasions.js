/*
 * The family's coming days: whose birthday it is, and whom the family remembers (#230, #154).
 *
 * A port of `data/Occasions.kt`, held to the same table (`occasion-cases.json`), so the desktop's
 * list and its reminder give the answer the phone gives.
 *
 * A day needs a month and a day. A year alone has nothing to fall on, and a yearless date (#90) is
 * exactly as good as a full one here. The living get birthdays; the departed get two quieter days,
 * the one they were born on and the one they died on.
 *
 * Dates are `YYYY-MM-DD` strings in and out, and day counts go through `Date.UTC`, never local time:
 * a birthday is a day on the calendar, and a timezone would only make midnight disagree with itself.
 */

import { PartialDate, YearlessDate, parseRecordedDate } from './dates.js';

export const WINDOW_DAYS = 30;
/** Nobody is wished a happy 111th: that old and "living" is a death nobody recorded. */
export const OLDEST_LIVING = 110;
/** A remembrance past this many years comes round without its number. */
export const REMEMBERED_YEARS = 100;

const KINDS = ['BIRTHDAY', 'BIRTH_REMEMBRANCE', 'DEATH_ANNIVERSARY'];
const DAY = 86400000;

const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const pad = (n, w = 2) => String(n).padStart(w, '0');
const iso = (y, m, d) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

function utc(text) {
  const [y, m, d] = text.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Today on this machine's own calendar, as `YYYY-MM-DD`. */
export function localToday(now = new Date()) {
  return iso(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

const named = (p) => typeof p.name === 'string' && p.name.trim() !== '';
const departed = (p) => p.deceased === true || Boolean(p.deathDate);

function dayOfYear(recorded) {
  if (recorded instanceof YearlessDate) return [recorded.month, recorded.day];
  if (recorded instanceof PartialDate && recorded.month != null && recorded.day != null) {
    return [recorded.month, recorded.day];
  }
  return null;
}

/** 29 February keeps to February in a year without one: the 28th, the person's own month. */
const fall = (y, m, d) => (m === 2 && d === 29 && !isLeap(y) ? iso(y, 2, 28) : iso(y, m, d));

function occasion(person, kind, recorded, today) {
  const md = recorded && dayOfYear(recorded);
  if (!md) return null;
  const since = recorded instanceof PartialDate ? recorded.year : null;
  const thisYear = Number(today.slice(0, 4));
  // The first time a day comes round is a year after it happened.
  let year = Math.max(thisYear, (since ?? 0) + 1);
  let date = fall(year, ...md);
  if (date < today) {
    year += 1;
    date = fall(year, ...md);
  }
  return {
    person,
    kind,
    date,
    daysAway: Math.round((utc(date) - utc(today)) / DAY),
    years: since == null ? null : year - since,
  };
}

function birthday(person, today) {
  const o = occasion(person, 'BIRTHDAY', parseRecordedDate(person.birthDate), today);
  return o && (o.years ?? 0) > OLDEST_LIVING ? null : o;
}

function remembrance(person, kind, value, today) {
  const o = occasion(person, kind, parseRecordedDate(value), today);
  if (o && (o.years ?? 0) > REMEMBERED_YEARS) o.years = null;
  return o;
}

function occasionsOf(person, today) {
  if (!departed(person)) return [birthday(person, today)].filter(Boolean);
  return [
    remembrance(person, 'BIRTH_REMEMBRANCE', person.birthDate, today),
    remembrance(person, 'DEATH_ANNIVERSARY', person.deathDate, today),
  ].filter(Boolean);
}

// The living first on any day, then the remembered; names compared code unit by code unit, as the
// Kotlin does, so the two can never order a day differently.
function order(a, b) {
  const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
  return a.daysAway - b.daysAway
    || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind)
    || cmp(a.person.name.trim().toLowerCase(), b.person.name.trim().toLowerCase())
    || cmp(a.person.id, b.person.id);
}

/** Every occasion from `today` (`YYYY-MM-DD`) for `days` days, today included, in order. */
export function upcoming(people, today, days = WINDOW_DAYS) {
  return [...people]
    .filter(named)
    .flatMap((p) => occasionsOf(p, today))
    .filter((o) => o.daysAway < days)
    .sort(order);
}

/** What a reminder on `date` is about. */
export const on = (people, date) => upcoming(people, date, 1);

/** The soonest living birthday within a year, for the line that says when the next one is. */
export function next(people, today) {
  return upcoming(people, today, 366).find((o) => o.kind === 'BIRTHDAY') ?? null;
}

/** Of the living, named people: who a reminder covers, who has no day and month, who is presumed departed. */
export function census(people, today) {
  const counts = { covered: 0, noDay: 0, presumedDeparted: 0 };
  for (const p of people) {
    if (!named(p) || departed(p)) continue;
    if (!dayOfYear(parseRecordedDate(p.birthDate))) counts.noDay += 1;
    else if (!birthday(p, today)) counts.presumedDeparted += 1;
    else counts.covered += 1;
  }
  return counts;
}
