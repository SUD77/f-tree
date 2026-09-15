/*
 * The rules of the date field, apart from any widget (#90).
 *
 * The field is three slots -- `YYYY`, `MM`, `DD` -- with the hyphens already drawn, so a date is
 * typed as digits alone: `19380417` fills all three, and there is no separator key to hunt for on a
 * phone keyboard. Leaving the year slot empty is how a birthday without a year is recorded; tapping
 * it later is how the year is added.
 *
 * A faithful port of `ui/person/DateEntry.kt`, held to the same table --
 * `desktop/renderer/date-entry-cases.json` -- so a shortcut learned on the phone is true on the
 * laptop too. Deliberately free of DOM types, like the Kotlin is free of Android ones, so every rule
 * is tested apart from any widget.
 */

import { PartialDate, parseRecordedDate } from '../../site/playground/dates.js';

/** The three slots a date is typed into. */
export const DateSlot = Object.freeze({ YEAR: 'year', MONTH: 'month', DAY: 'day' });

/**
 * Why the date in a field cannot be kept. The Kotlin's `DateProblem`, by name, so the two shells
 * say the same thing about the same date.
 */
export const DateProblem = Object.freeze({
  /** One to three digits of a year. */
  YEAR_INCOMPLETE: 'YEAR_INCOMPLETE',
  MONTH_OUT_OF_RANGE: 'MONTH_OUT_OF_RANGE',
  DAY_OUT_OF_RANGE: 'DAY_OUT_OF_RANGE',
  /** 31 April: no such day in that month in any year. */
  DAY_NOT_IN_MONTH: 'DAY_NOT_IN_MONTH',
  /** 29 February in a year that had none. */
  NOT_A_LEAP_YEAR: 'NOT_A_LEAP_YEAR',
  /** A day with no month is not a date. */
  DAY_WITHOUT_MONTH: 'DAY_WITHOUT_MONTH',
  /** A month with no year and no day says too little to keep. */
  MONTH_ALONE: 'MONTH_ALONE',
  /** Anything else a stored string might hold; only reachable through data typed elsewhere. */
  MALFORMED: 'MALFORMED',
  DEATH_BEFORE_BIRTH: 'DEATH_BEFORE_BIRTH',
});

const SEPARATORS = new Set([' ', '-', '/', '.', ',']);
const SEP = '[-\\s./,]';
const YEARLESS_WHOLE = new RegExp(`^--(\\d{1,2})${SEP}(\\d{1,2})$`);
const COMPACT_WHOLE = /^(\d{4})(\d{2})(\d{2})$/;
const SEPARATED_WHOLE = new RegExp(`^(\\d{4})${SEP}+(\\d{1,2})(?:${SEP}+(\\d{1,2}))?$`);
const POSITIONAL = /^(\d{0,4})(?:-(\d{0,2})(?:-(\d{0,2}))?)?$/;
const POSITIONAL_YEARLESS = /^(\d{0,2})(?:-(\d{0,2}))?$/;

const emptyParts = () => ({ year: '', month: '', day: '' });
const isEmptyParts = (parts) => parts.year === '' && parts.month === '' && parts.day === '';

/** The Kotlin's `DateParts.get(slot)` operator, for the one place that needs a slot generically. */
function partsGet(parts, slot) {
  if (slot === DateSlot.YEAR) return parts.year;
  if (slot === DateSlot.MONTH) return parts.month;
  return parts.day;
}

/** A lone month or day digit padded (`4` becomes `04`). Also the identity on anything else. */
const pad = (digits) => (digits.length === 1 ? `0${digits}` : digits);

/**
 * What the three slots encode to -- a valid date encodes to its stored form (`1938`, `1938-04`,
 * `1938-04-17`, `--04-17`), and a combination that is not a date still has a string of its own
 * (`1938--17`, `--04`, `---17`) rather than being lost. [decode] is its total, lossless inverse.
 */
export function encode(parts) {
  if (isEmptyParts(parts)) return '';
  if (parts.month === '' && parts.day === '') return parts.year;
  // An empty year is written `-`, which is what makes `--04-17` the ISO form.
  let out = parts.year === '' ? '-' : parts.year;
  out += `-${parts.month}`;
  if (parts.day !== '') out += `-${parts.day}`;
  return out;
}

/** The slots a stored or typed string stands for. Never fails: see [encode]. */
export function decode(text) {
  // A date written some other way, by some other program: shown as if it had been pasted, so there
  // is something to correct, but `problem` still calls it unreadable -- see there.
  return positional(text) ?? enter(emptyParts(), DateSlot.YEAR, text.trim()).parts;
}

/** The slots for text in the field's own form, or null for text written any other way. */
function positional(text) {
  const t = text.trim();
  if (t === '') return emptyParts();
  if (t.startsWith('--')) {
    const m = POSITIONAL_YEARLESS.exec(t.slice(2));
    return m ? { year: '', month: m[1] ?? '', day: m[2] ?? '' } : null;
  }
  const m = POSITIONAL.exec(t);
  return m ? { year: m[1] ?? '', month: m[2] ?? '', day: m[3] ?? '' } : null;
}

/**
 * A whole date arriving at once -- pasted, or typed by a test -- in any of the ways people write
 * one year first. Day-first and month-first orders are never guessed between: `04/05/1938` is
 * two different days depending on who wrote it, and the precision here is a statement of fact.
 */
function readWhole(text) {
  const t = text.trim();
  let m = YEARLESS_WHOLE.exec(t);
  if (m) return { year: '', month: pad(m[1]), day: pad(m[2]) };
  m = COMPACT_WHOLE.exec(t);
  if (m) return { year: m[1], month: m[2], day: m[3] };
  m = SEPARATED_WHOLE.exec(t);
  if (m) return { year: m[1], month: pad(m[2]), day: pad(m[3] ?? '') };
  return null;
}

/**
 * A slot's text has changed to `text`; what the three slots hold now, and where the caret goes.
 *
 * - A year moves on at its fourth digit; a month at its second, or at once when its first digit
 *   could only be one month (`4` is April, so it becomes `04`); a day likewise from `4` up.
 * - Any separator a person reaches for -- space, `-`, `/`, `.`, `,` -- finishes a slot, padding a
 *   lone digit. In an empty slot it just moves on, so a space first means "no year".
 * - Digits past a slot's end spill into the next slot when it is empty, so typing never stalls.
 *
 * @returns {{parts: {year: string, month: string, day: string}, focus: string}}
 */
export function enter(parts, slot, text) {
  const whole = readWhole(text);
  if (whole) {
    const focus = whole.month !== '' ? DateSlot.DAY : whole.year !== '' ? DateSlot.MONTH : DateSlot.YEAR;
    return { parts: whole, focus };
  }
  const digits = Array.from(text).filter((c) => c >= '0' && c <= '9').join('');
  // A separator only counts in text that is otherwise digits: pasted words are not a keystroke.
  const chars = Array.from(text);
  const separated = chars.some((c) => SEPARATORS.has(c))
    && chars.every((c) => (c >= '0' && c <= '9') || SEPARATORS.has(c));
  // Whether a digit was typed rather than one taken away. Backspacing "17" down to "7" must leave
  // "7", not pad it to "07" -- only a slot that has just grown gets the one-digit-means pad.
  const grew = digits.length > partsGet(parts, slot).length;

  switch (slot) {
    case DateSlot.YEAR: {
      const next = { ...parts, year: digits.slice(0, 4) };
      const spill = digits.slice(4);
      if (spill !== '' && parts.month === '') return enter(next, DateSlot.MONTH, spill);
      if (next.year.length === 4 && digits.length > parts.year.length) {
        return { parts: next, focus: DateSlot.MONTH };
      }
      if (separated) return { parts: next, focus: DateSlot.MONTH };
      return { parts: next, focus: DateSlot.YEAR };
    }
    case DateSlot.MONTH: {
      const month = digits.slice(0, 2);
      const spill = digits.slice(2);
      if (month.length === 1 && ((grew && month[0] >= '2') || separated)) {
        return { parts: { ...parts, month: `0${month}` }, focus: DateSlot.DAY };
      }
      if (month === '' && separated) return { parts: { ...parts, month: '' }, focus: DateSlot.DAY };
      if (month.length === 2 && spill !== '' && parts.day === '') {
        return enter({ ...parts, month }, DateSlot.DAY, spill);
      }
      if (month.length === 2 && digits.length > parts.month.length) {
        return { parts: { ...parts, month }, focus: DateSlot.DAY };
      }
      return { parts: { ...parts, month }, focus: DateSlot.MONTH };
    }
    case DateSlot.DAY: {
      const day = digits.slice(0, 2);
      if (day.length === 1 && ((grew && day[0] >= '4') || separated)) {
        return { parts: { ...parts, day: `0${day}` }, focus: DateSlot.DAY };
      }
      return { parts: { ...parts, day }, focus: DateSlot.DAY };
    }
    default:
      throw new RangeError(`not a slot: ${slot}`);
  }
}

/**
 * Backspace in a slot that is already empty: step back into the one before and take its last
 * digit, so deleting runs back through the whole date one press per digit -- the hyphens are
 * drawn, not typed, and are never in the way.
 */
export function backspace(parts, slot) {
  switch (slot) {
    case DateSlot.YEAR: return { parts, focus: DateSlot.YEAR };
    case DateSlot.MONTH: return { parts: { ...parts, year: parts.year.slice(0, -1) }, focus: DateSlot.YEAR };
    case DateSlot.DAY: return { parts: { ...parts, month: parts.month.slice(0, -1) }, focus: DateSlot.MONTH };
    default: throw new RangeError(`not a slot: ${slot}`);
  }
}

/**
 * The string as it will be kept: a lone month or day digit padded (`1938-4` is `1938-04`).
 * A person who stops after typing `1` in the month and taps Save meant January, not an error.
 */
export function settle(text) {
  const parts = decode(text);
  return encode({ ...parts, month: pad(parts.month), day: pad(parts.day) });
}

/** Days a month can have in any year, so February is allowed its 29th here. */
export function maxDays(month) {
  if (month === 2) return 29;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
}

/** The Gregorian leap rule, ported from `java.time.Year.isLeap` rather than imported. */
function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** What is wrong with a field's text, or null when it is blank or a date that can be kept. */
export function problem(text) {
  if (text.trim() === '') return null;
  // Everything typed into the field is in its own form, so anything else came from another
  // program -- "about 1938", "before 1938". Reading a year out of it and calling that a date would
  // rewrite the record on the next save, and "before" is not "in". Unreadable, then: kept as
  // written until somebody retypes it.
  if (positional(text) === null) return DateProblem.MALFORMED;
  const parts = decode(settle(text));
  const month = parts.month === '' ? null : Number(parts.month);
  const day = parts.day === '' ? null : Number(parts.day);
  if (parts.year !== '' && parts.year.length < 4) return DateProblem.YEAR_INCOMPLETE;
  if (month !== null && (month < 1 || month > 12)) return DateProblem.MONTH_OUT_OF_RANGE;
  if (day !== null && (day < 1 || day > 31)) return DateProblem.DAY_OUT_OF_RANGE;
  if (month !== null && day !== null && day > maxDays(month)) return DateProblem.DAY_NOT_IN_MONTH;
  if (month === 2 && day === 29 && parts.year.length === 4 && !isLeapYear(Number(parts.year))) {
    return DateProblem.NOT_A_LEAP_YEAR;
  }
  if (day !== null && month === null) return DateProblem.DAY_WITHOUT_MONTH;
  if (parts.year === '' && month !== null && day === null) return DateProblem.MONTH_ALONE;
  if (parseRecordedDate(settle(text)) === null) return DateProblem.MALFORMED;
  return null;
}

/**
 * Whether a problem can be shown while the person is still typing in the field.
 *
 * Only once the slot it is about is complete: `19` is a year on its way, not a mistake, and
 * flashing red at every keystroke teaches people to ignore the colour. Everything else waits
 * until the field is left.
 */
export function isFinal(problem_, text) {
  const raw = decode(text);
  switch (problem_) {
    case DateProblem.MONTH_OUT_OF_RANGE: return raw.month.length === 2;
    case DateProblem.DAY_OUT_OF_RANGE:
    case DateProblem.DAY_NOT_IN_MONTH: return raw.day.length === 2;
    case DateProblem.NOT_A_LEAP_YEAR: return raw.day.length === 2 && raw.year.length === 4;
    case DateProblem.DEATH_BEFORE_BIRTH: return true;
    default: return false;
  }
}

/**
 * Death before birth, which needs both dates. Only two calendar dates can be out of order --
 * a birthday with no year orders nothing -- and overlapping partial dates are fine: "born 1938,
 * died 1938" is a real thing to record.
 */
export function isDeathBeforeBirth(birthText, deathText) {
  const birth = parseRecordedDate(settle(birthText));
  const death = parseRecordedDate(settle(deathText));
  if (!(birth instanceof PartialDate) || !(death instanceof PartialDate)) return false;
  return death.latest() < birth.earliest();
}
