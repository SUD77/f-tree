/*
 * `date-entry.js` held to `date-entry-cases.json`, the table `DateEntryTest.kt` reads too, so
 * typing a date works the same way on the phone and on the laptop (#90).
 */

import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

import {
  DateSlot, DateProblem, encode, decode, enter, backspace, settle, problem, isFinal, isDeathBeforeBirth,
} from './date-entry.js';

const table = JSON.parse(readFileSync(new URL('./date-entry-cases.json', import.meta.url)));

const slot = (name) => DateSlot[name.toUpperCase()];

test('the table is the format this test reads', () => {
  assert.strictEqual(table.format, 1);
});

test('every string the slots can hold survives a round trip', () => {
  for (const text of table.roundTrip) {
    assert.strictEqual(encode(decode(text)), text, text);
  }
});

test('typing into a slot fills and moves on as the table says', () => {
  for (const [before, slotName, text, after, focus] of table.enter) {
    const edit = enter(decode(before), slot(slotName), text);
    const name = `${before} + ${slotName}:'${text}'`;
    assert.strictEqual(encode(edit.parts), after, name);
    assert.strictEqual(edit.focus, slot(focus), name);
  }
});

test('backspace in an empty slot steps back through the date', () => {
  for (const [before, slotName, after, focus] of table.backspace) {
    const edit = backspace(decode(before), slot(slotName));
    const name = `${before} ${slotName}`;
    assert.strictEqual(encode(edit.parts), after, name);
    assert.strictEqual(edit.focus, slot(focus), name);
  }
});

test('a lone month or day digit is padded when the date is kept', () => {
  for (const [text, settled] of table.settle) assert.strictEqual(settle(text), settled, text);
});

test('each problem is named and shown only once it is real', () => {
  for (const row of table.problem) {
    const [text, expected, final] = row;
    const found = problem(text);
    assert.strictEqual(found, expected, text);
    if (found != null) assert.strictEqual(isFinal(found, text), final, text);
  }
});

test('only two calendar dates can be out of order', () => {
  for (const [birth, death, expected] of table.deathBeforeBirth) {
    assert.strictEqual(isDeathBeforeBirth(birth, death), expected, `${birth} / ${death}`);
  }
});

test('DateProblem carries the Kotlin enum names, unchanged', () => {
  for (const name of ['YEAR_INCOMPLETE', 'MONTH_OUT_OF_RANGE', 'DAY_OUT_OF_RANGE', 'DAY_NOT_IN_MONTH',
    'NOT_A_LEAP_YEAR', 'DAY_WITHOUT_MONTH', 'MONTH_ALONE', 'MALFORMED', 'DEATH_BEFORE_BIRTH']) {
    assert.strictEqual(DateProblem[name], name);
  }
});
