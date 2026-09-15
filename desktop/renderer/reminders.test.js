/*
 * When a reminder fires, and what it says (#154).
 *
 * `dueNow` and `digest` are pure, so these are ordinary unit tests rather than anything that needs
 * a window -- the smoke harness (`main.js`'s `runRemindersSmoke`, gated on `FTREE_SMOKE_REMINDERS`)
 * is what proves the real switch, the real clock and a real notification actually meet.
 */

import test from 'node:test';
import assert from 'node:assert';

import { dueNow, detailFor, digest } from './reminders.js';

const at = (hour) => new Date(2026, 8, 15, hour, 0, 0); // 15 September 2026, local time.

/* ------------------------------------------------------------------ dueNow */

test('nothing is due while reminders are off, whatever time it is', () => {
  assert.strictEqual(dueNow({ reminders: false }, at(9)), null);
  assert.strictEqual(dueNow({}, at(9)), null);
  assert.strictEqual(dueNow(null, at(9)), null);
});

test('nothing is due before nine in the morning', () => {
  assert.strictEqual(dueNow({ reminders: true }, at(8)), null);
  assert.notStrictEqual(dueNow({ reminders: true }, at(9)), null);
});

test('on the day, the target is today', () => {
  const due = dueNow({ reminders: true, reminderLead: 'day' }, at(9));
  assert.deepStrictEqual(due, { today: '2026-09-15', target: '2026-09-15' });
});

test('the day before, the target is tomorrow -- across a month end too', () => {
  const due = dueNow({ reminders: true, reminderLead: 'before' }, at(9));
  assert.deepStrictEqual(due, { today: '2026-09-15', target: '2026-09-16' });

  const endOfMonth = dueNow(
    { reminders: true, reminderLead: 'before' },
    new Date(2026, 8, 30, 9, 0, 0),
  );
  assert.deepStrictEqual(endOfMonth, { today: '2026-09-30', target: '2026-10-01' });
});

test('a digest already shown today is not due again', () => {
  assert.strictEqual(
    dueNow({ reminders: true, remindersShownOn: '2026-09-15' }, at(9)),
    null,
  );
  // Yesterday's mark does not stop today's check.
  assert.notStrictEqual(
    dueNow({ reminders: true, remindersShownOn: '2026-09-14' }, at(9)),
    null,
  );
});

/* ------------------------------------------------------------------ detailFor */

test('detail wording matches the table in docs/birthdays.md, kind by kind', () => {
  assert.strictEqual(detailFor({ kind: 'BIRTHDAY', years: 60 }), 'turns 60');
  assert.strictEqual(detailFor({ kind: 'BIRTHDAY', years: null }), 'birthday');
  assert.strictEqual(detailFor({ kind: 'BIRTH_REMEMBRANCE', years: 90 }), 'would have been 90');
  assert.strictEqual(detailFor({ kind: 'BIRTH_REMEMBRANCE', years: null }), 'birthday');
  assert.strictEqual(detailFor({ kind: 'DEATH_ANNIVERSARY', years: 12 }), '12 years since they died');
  assert.strictEqual(detailFor({ kind: 'DEATH_ANNIVERSARY', years: 1 }), '1 year since they died');
  assert.strictEqual(detailFor({ kind: 'DEATH_ANNIVERSARY', years: null }), 'the day they died');
});

/* ------------------------------------------------------------------ digest */

const asha = { id: 'asha', name: 'Asha' };
const ravi = { id: 'ravi', name: 'Ravi' };
const ramesh = { id: 'ramesh', name: 'Ramesh' };

test('nothing due makes no digest', () => {
  assert.strictEqual(digest([], { lead: 'day', remembrance: false }), null);
});

test('remembrance is dropped unless it was asked for, even when it is all there is', () => {
  const occasions = [{ person: ramesh, kind: 'DEATH_ANNIVERSARY', years: 3 }];
  assert.strictEqual(digest(occasions, { lead: 'day', remembrance: false }), null);
  assert.notStrictEqual(digest(occasions, { lead: 'day', remembrance: true }), null);
});

test('one birthday with a known age, on the day', () => {
  const result = digest(
    [{ person: asha, kind: 'BIRTHDAY', years: 60 }],
    { lead: 'day', remembrance: false },
  );
  assert.strictEqual(result.title, 'Asha turns 60 today');
  assert.strictEqual(result.body, 'Asha — turns 60');
  assert.strictEqual(result.personId, 'asha');
});

test('one birthday with no known age, on the day', () => {
  const result = digest(
    [{ person: asha, kind: 'BIRTHDAY', years: null }],
    { lead: 'day', remembrance: false },
  );
  assert.strictEqual(result.title, "It's Asha's birthday today");
});

test('several birthdays, on the day', () => {
  const result = digest(
    [
      { person: asha, kind: 'BIRTHDAY', years: 60 },
      { person: ravi, kind: 'BIRTHDAY', years: 36 },
    ],
    { lead: 'day', remembrance: false },
  );
  assert.strictEqual(result.title, '2 birthdays today');
  assert.strictEqual(result.body, 'Asha — turns 60\nRavi — turns 36');
  // More than one occasion: nothing to land a click on in particular.
  assert.strictEqual(result.personId, null);
});

test('the day before: known age, unknown age, and several', () => {
  assert.strictEqual(
    digest([{ person: asha, kind: 'BIRTHDAY', years: 60 }], { lead: 'before', remembrance: false }).title,
    'Tomorrow: Asha turns 60',
  );
  assert.strictEqual(
    digest([{ person: asha, kind: 'BIRTHDAY', years: null }], { lead: 'before', remembrance: false }).title,
    "Tomorrow is Asha's birthday",
  );
  assert.strictEqual(
    digest(
      [{ person: asha, kind: 'BIRTHDAY', years: 60 }, { person: ravi, kind: 'BIRTHDAY', years: null }],
      { lead: 'before', remembrance: false },
    ).title,
    '2 birthdays tomorrow',
  );
});

test('remembrance only, once remembrance is on: one and several, today and tomorrow', () => {
  const one = [{ person: ramesh, kind: 'DEATH_ANNIVERSARY', years: 3 }];
  const several = [
    { person: ramesh, kind: 'DEATH_ANNIVERSARY', years: 3 },
    { person: asha, kind: 'BIRTH_REMEMBRANCE', years: 90 },
  ];
  assert.strictEqual(digest(one, { lead: 'day', remembrance: true }).title, 'Remembering Ramesh today');
  assert.strictEqual(digest(one, { lead: 'before', remembrance: true }).title, 'Remembering Ramesh tomorrow');
  assert.strictEqual(digest(several, { lead: 'day', remembrance: true }).title, '2 remembrance days today');
  assert.strictEqual(digest(several, { lead: 'before', remembrance: true }).title, '2 remembrance days tomorrow');
});

test('a birthday and a remembrance together: the title is about the birthday', () => {
  const result = digest(
    [{ person: asha, kind: 'BIRTHDAY', years: 60 }, { person: ramesh, kind: 'DEATH_ANNIVERSARY', years: 3 }],
    { lead: 'day', remembrance: true },
  );
  assert.strictEqual(result.title, 'Asha turns 60 today');
  assert.strictEqual(result.body, 'Asha — turns 60\nRamesh — 3 years since they died');
  assert.strictEqual(result.personId, null);
});

test('a remembrance birth line reads "would have been", never "turns"', () => {
  const result = digest(
    [{ person: ramesh, kind: 'BIRTH_REMEMBRANCE', years: 90 }],
    { lead: 'day', remembrance: true },
  );
  assert.strictEqual(result.body, 'Ramesh — would have been 90');
});
