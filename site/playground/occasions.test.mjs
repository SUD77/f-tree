/*
 * occasions.js held to occasion-cases.json, the table the app's OccasionCasesTest.kt reads too.
 */

import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

import { upcoming, next, census, on, localToday } from './occasions.js';

const table = JSON.parse(readFileSync(new URL('./occasion-cases.json', import.meta.url), 'utf8'));
const cast = (rows) => rows.map(([id, name, birthDate, deathDate, deceased]) => ({ id, name, birthDate, deathDate, deceased }));
const flat = (o) => [o.person.id, o.kind, o.date, o.daysAway, o.years];

test('the table is the format this reads', () => {
  assert.strictEqual(table.format, 1);
});

for (const c of table.upcoming) {
  test(`upcoming: ${c.why}`, () => {
    assert.deepStrictEqual(upcoming(cast(c.people), c.today, c.days).map(flat), c.expect);
  });
}

for (const c of table.next) {
  test(`next: ${c.why}`, () => {
    const found = next(cast(c.people), c.today);
    assert.deepStrictEqual(found && flat(found), c.expect);
  });
}

for (const c of table.census) {
  test(`census: ${c.why}`, () => {
    assert.deepStrictEqual(census(cast(c.people), c.today), c.expect);
  });
}

test('a reminder morning is a one-day window', () => {
  const people = cast([['a', 'A', '1990-09-15', null, false], ['b', 'B', '1990-09-16', null, false]]);
  assert.deepStrictEqual(on(people, '2026-09-15').map((o) => o.person.id), ['a']);
});

test('today is read from the local calendar, not UTC', () => {
  // 23:30 on 31 December, local time, is still 31 December here whatever UTC says.
  assert.strictEqual(localToday(new Date(2026, 11, 31, 23, 30)), '2026-12-31');
});
