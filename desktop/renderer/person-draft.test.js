/*
 * The person panel's staged edits (#148) and date typing (#90's desktop half).
 *
 * There is no Kotlin test table to translate: `PersonEditViewModel.validate()` has none. So the
 * cases here are written from what that function does, and the ones that encode a *decision* rather
 * than arithmetic -- overlapping dates are allowed, a blank form is valid, a death date implies a
 * death -- say which line of the Kotlin they come from.
 */

import test from 'node:test';
import assert from 'node:assert';

import {
  DateProblem, draftFrom, withChange, dateProblems, canSave, isDirty, fieldsFrom, isBlankPerson,
} from './person-draft.js';

const blank = draftFrom({ id: 'p' });

/* ------------------------------------------------------------------ dates */

test('a blank date is not a problem -- most of a tree is people nobody has dates for', () => {
  assert.deepStrictEqual(dateProblems(blank), { birthDate: null, deathDate: null });
  assert.ok(canSave(blank), 'a completely blank form is valid (canSave in the Kotlin)');
});

test('the three precisions are all accepted', () => {
  for (const date of ['1938', '1938-04', '1938-04-17']) {
    assert.strictEqual(dateProblems({ ...blank, birthDate: date }).birthDate, null, date);
  }
});

test('a date the field can hold names its specific problem (#90)', () => {
  const cases = [
    ['38', DateProblem.YEAR_INCOMPLETE],
    ['1938-13', DateProblem.MONTH_OUT_OF_RANGE],
    ['1938-02-30', DateProblem.DAY_NOT_IN_MONTH],
    ['1938-02-29', DateProblem.NOT_A_LEAP_YEAR],
    ['--04', DateProblem.MONTH_ALONE],
  ];
  for (const [date, expected] of cases) {
    assert.strictEqual(dateProblems({ ...blank, birthDate: date }).birthDate, expected, date);
  }
});

test('a lone month or day digit settles into a real date, not an error', () => {
  for (const date of ['1938-4', '1938-4-7', '1938-']) {
    assert.strictEqual(dateProblems({ ...blank, birthDate: date }).birthDate, null, date);
  }
});

test('a date written some other way is unreadable, never guessed at', () => {
  // Text the field did not write came from another program. Reading a year out of "about 1938"
  // would rewrite the record on the next save, and "before" is not "in".
  for (const date of ['not a date', 'about 1938', 'before 1938-04', '17/04/1938', '1938/04/17']) {
    assert.strictEqual(dateProblems({ ...blank, birthDate: date }).birthDate,
      DateProblem.MALFORMED, date);
  }
});

test('an unreadable date nobody retyped is kept exactly as written', () => {
  assert.strictEqual(fieldsFrom({ ...blank, birthDate: 'about 1938' }).birthDate, 'about 1938');
  assert.strictEqual(fieldsFrom({ ...blank, birthDate: '1938-4' }).birthDate, '1938-04');
});

test('surrounding space is not a problem; the tree trims it anyway', () => {
  assert.strictEqual(dateProblems({ ...blank, birthDate: ' 1938 ' }).birthDate, null);
});

test('a death before the birth is refused, and it is the death field that says so', () => {
  const problems = dateProblems({ ...blank, birthDate: '1950', deathDate: '1949-12-31' });
  assert.deepStrictEqual(problems, { birthDate: null, deathDate: DateProblem.DEATH_BEFORE_BIRTH });
  assert.ok(!canSave({ ...blank, birthDate: '1950', deathDate: '1949' }));
});

test('overlapping partial dates are allowed -- "born 1938, died 1938" is real', () => {
  // The Kotlin compares death.latest() with birth.earliest(), not the other way round.
  for (const [birth, death] of [['1938', '1938'], ['1938-04', '1938'], ['1938', '1938-01-01'],
    ['1938-04-17', '1938-04']]) {
    assert.strictEqual(dateProblems({ ...blank, birthDate: birth, deathDate: death }).deathDate,
      null, `${birth} / ${death}`);
  }
});

test('a death field with a problem of its own is reported that way, not also as out of order', () => {
  // An incomplete year is the death field's own problem, so DEATH_BEFORE_BIRTH is never asked.
  const problems = dateProblems({ ...blank, birthDate: '1950', deathDate: '19' });
  assert.strictEqual(problems.deathDate, DateProblem.YEAR_INCOMPLETE);
});

/* ------------------------------------------------------------------ a death and its date */

test('typing a death date says the person has died', () => {
  // onDeathDateChange: `deceased = it.deceased || value.isNotBlank()`
  assert.strictEqual(withChange(blank, 'deathDate', '2001').deceased, true);
  assert.strictEqual(withChange(blank, 'deathDate', '  ').deceased, false);
});

test('clearing "no longer living" takes the death date with it', () => {
  // onDeceasedChange: `deathDate = if (value) it.deathDate else ""`
  const died = { ...blank, deceased: true, deathDate: '2001' };
  assert.deepStrictEqual(withChange(died, 'deceased', false), { ...died, deceased: false, deathDate: '' });
  assert.strictEqual(withChange(blank, 'deceased', true).deathDate, '', 'ticking it invents nothing');
});

test('clearing a death date leaves the person dead -- plenty of deaths have no date', () => {
  const died = { ...blank, deceased: true, deathDate: '2001' };
  assert.strictEqual(withChange(died, 'deathDate', '').deceased, true);
});

/* ------------------------------------------------------------------ dirty */

test('a form straight from a person is not dirty', () => {
  const person = { id: 'p', name: 'Shyam Lal', birthDate: '1938', deceased: true, notes: 'x' };
  assert.ok(!isDirty(draftFrom(person), person));
});

test('any field that differs makes it dirty', () => {
  const person = { id: 'p', name: 'Shyam Lal' };
  for (const [key, value] of [['name', 'Shyam'], ['gender', 'MALE'], ['birthDate', '1938'],
    ['deathDate', '2001'], ['deceased', true], ['notes', 'x']]) {
    assert.ok(isDirty({ ...draftFrom(person), [key]: value }, person), key);
  }
});

test('a trailing space is not an edit, because it is not kept', () => {
  const person = { id: 'p', name: 'Shyam Lal' };
  assert.ok(!isDirty({ ...draftFrom(person), name: 'Shyam Lal  ' }, person));
});

test('the fields handed to the tree name every field, so clearing one clears it', () => {
  const fields = fieldsFrom({ ...blank, name: 'Ravi' });
  assert.deepStrictEqual(Object.keys(fields).sort(),
    ['birthDate', 'deathDate', 'deceased', 'gender', 'name', 'notes']);
  assert.strictEqual(fields.gender, null, 'no gender is null, not the empty string');
});

test('blank means nothing recorded at all, a photograph included', () => {
  assert.ok(isBlankPerson({ id: 'p' }));
  assert.ok(isBlankPerson({ id: 'p', name: '' }));
  assert.ok(!isBlankPerson({ id: 'p', notes: 'x' }));
  assert.ok(!isBlankPerson({ id: 'p', photo: 'photos/a.jpg' }));
  assert.ok(!isBlankPerson({ id: 'p', deceased: true }));
  assert.ok(!isBlankPerson(null));
});

/* ------------------------------------------------------------------ typing a date (#90) */

// `normaliseDateTyping` and its tests are gone: the segmented field in app.js (date-entry.js)
// supersedes them, and date-entry.test.js holds it to date-entry-cases.json instead.

test('a birthday with no year is a date, and orders nothing (#90)', () => {
  // A person holding "--04-17" must stay editable: this used to refuse even a change to the name.
  assert.deepStrictEqual(dateProblems({ ...blank, name: 'Asha', birthDate: '--04-17' }),
    { birthDate: null, deathDate: null });
  assert.strictEqual(dateProblems({ ...blank, birthDate: '--12-31', deathDate: '--01-01' }).deathDate, null);
  // 30 February: date-entry.js now names this specifically, the same as it would for a calendar
  // date with a year (30 April 1938 is DAY_NOT_IN_MONTH too, not a bare MALFORMED).
  assert.strictEqual(dateProblems({ ...blank, birthDate: '--02-30' }).birthDate, DateProblem.DAY_NOT_IN_MONTH);
});
