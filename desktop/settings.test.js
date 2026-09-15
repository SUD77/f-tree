/*
 * The rules one setting has on another, and what a settings file is allowed to become.
 *
 * The cross-setting cases are ported from `app/.../update/UpdatePreferences.kt`. They matter more
 * than they look: each one exists for a failure that is silent. A stale banner outliving the
 * setting that produced it, or a release withheld because of a decision the reader made about a
 * different channel, are both things somebody would report as "the updater is broken" without ever
 * being able to say why.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  DEFAULT_SETTINGS, normalise, applyChange, mayCheckForUpdates, shouldOffer,
} = require('./settings.js');

// ------------------------------------------------------------------ defaults

test('the two settings that reach the network are off until switched on', () => {
  // This app makes no request of any kind unless somebody has asked it to, and a default of "on"
  // would quietly make that untrue for everybody who never opened the menu.
  assert.strictEqual(DEFAULT_SETTINGS.checkForUpdates, false);
  assert.strictEqual(DEFAULT_SETTINGS.betaReleases, false);
});

test('the rest default to what most readers want', () => {
  assert.strictEqual(DEFAULT_SETTINGS.familyWords, 'en');
  assert.strictEqual(DEFAULT_SETTINGS.photosOnChart, true);
  assert.strictEqual(DEFAULT_SETTINGS.theme, 'light');
});

test('the defaults cannot be edited by accident', () => {
  // Frozen, so a caller that keeps a reference and writes to it changes nothing. Asserted as "the
  // value did not move" rather than "it threw": these modules are CommonJS and therefore sloppy
  // mode, where a write to a frozen object is ignored in silence rather than raising.
  DEFAULT_SETTINGS.checkForUpdates = true;
  assert.strictEqual(DEFAULT_SETTINGS.checkForUpdates, false);
});

// ------------------------------------------------------------------ reading a stored file

test('a settings file edited into nonsense gives sensible defaults, not strange behaviour', () => {
  // It lives in a directory the reader can open. It can also have been written by a newer version
  // of this app and then opened by an older one.
  const wild = normalise({
    familyWords: 'klingon',
    photosOnChart: 'yes please',
    theme: 42,
    checkForUpdates: 'true',
    betaReleases: 1,
    lastCheckedAt: -5,
    skippedVersion: '   ',
    somethingFromTheFuture: { nested: true },
  });

  assert.strictEqual(wild.familyWords, 'en');
  assert.strictEqual(wild.theme, 'light');
  // The string "true" is not true: only a real boolean turns a network setting on.
  assert.strictEqual(wild.checkForUpdates, false);
  assert.strictEqual(wild.betaReleases, false);
  assert.strictEqual(wild.lastCheckedAt, 0);
  assert.strictEqual(wild.skippedVersion, null);
  assert.ok(!('somethingFromTheFuture' in wild), 'unknown keys are dropped');
});

test('"photos on the chart" is on unless it was explicitly turned off', () => {
  // The odd one out: it defaults to true, so a missing or unreadable value must not read as false
  // and silently strip every photograph from somebody's chart.
  assert.strictEqual(normalise({}).photosOnChart, true);
  assert.strictEqual(normalise({ photosOnChart: undefined }).photosOnChart, true);
  assert.strictEqual(normalise({ photosOnChart: false }).photosOnChart, false);
});

test('nothing at all is still a usable settings object', () => {
  assert.deepStrictEqual(normalise(null), { ...DEFAULT_SETTINGS });
  assert.deepStrictEqual(normalise(undefined), { ...DEFAULT_SETTINGS });
  assert.deepStrictEqual(normalise('a string'), { ...DEFAULT_SETTINGS });
});

// ------------------------------------------------------------------ the cross-setting rules

test('turning update checking off forgets what the last check found', () => {
  // "Leaving a remembered result behind would let a stale banner outlive the setting."
  const before = normalise({
    checkForUpdates: true, lastCheckedAt: 1_700_000_000_000, skippedVersion: 'desktop-v9.9.9',
  });
  const after = applyChange(before, 'checkForUpdates', false);

  assert.strictEqual(after.checkForUpdates, false);
  assert.strictEqual(after.lastCheckedAt, 0);
  assert.strictEqual(after.skippedVersion, null);
});

test('turning it back on does not resurrect the old result', () => {
  const off = applyChange(
    normalise({ checkForUpdates: true, lastCheckedAt: 123, skippedVersion: 'desktop-v1.0.0' }),
    'checkForUpdates', false,
  );
  const on = applyChange(off, 'checkForUpdates', true);

  assert.strictEqual(on.checkForUpdates, true);
  assert.strictEqual(on.lastCheckedAt, 0);
  assert.strictEqual(on.skippedVersion, null);
});

test('changing channel forgets a version skipped on the other one', () => {
  /*
   * "A version skipped on one channel means nothing on the other: leaving it behind would silently
   * hide the first release the reader has just asked to be offered."
   *
   * Somebody who skipped 0.5.0 on stable and then asks for betas is asking to see what is new. The
   * skip would withhold exactly that, and they would have no way of telling why.
   */
  const stable = normalise({ betaReleases: false, skippedVersion: 'desktop-v0.5.0' });
  assert.strictEqual(applyChange(stable, 'betaReleases', true).skippedVersion, null);

  const beta = normalise({ betaReleases: true, skippedVersion: 'desktop-v0.6.0-beta.1' });
  assert.strictEqual(applyChange(beta, 'betaReleases', false).skippedVersion, null);
});

test('setting the channel to what it already is does not clear a skip', () => {
  // Rebuilding the menu re-applies values. A no-op write must stay a no-op, or a reader who opens
  // the preferences dialog and closes it would be asked again about a version they declined.
  const settings = normalise({ betaReleases: true, skippedVersion: 'desktop-v0.6.0-beta.1' });
  assert.strictEqual(
    applyChange(settings, 'betaReleases', true).skippedVersion,
    'desktop-v0.6.0-beta.1',
  );
});

test('an unrelated setting leaves the update state alone', () => {
  const settings = normalise({
    checkForUpdates: true, lastCheckedAt: 999, skippedVersion: 'desktop-v1.2.3',
  });
  const after = applyChange(settings, 'theme', 'dark');

  assert.strictEqual(after.theme, 'dark');
  assert.strictEqual(after.lastCheckedAt, 999);
  assert.strictEqual(after.skippedVersion, 'desktop-v1.2.3');
});

test('a change to something this app does not know about changes nothing', () => {
  const settings = normalise({ theme: 'dark' });
  assert.deepStrictEqual(applyChange(settings, 'nonsense', true), settings);
});

test('applying a change does not mutate what it was given', () => {
  const settings = normalise({ checkForUpdates: true, lastCheckedAt: 5 });
  applyChange(settings, 'checkForUpdates', false);
  assert.strictEqual(settings.lastCheckedAt, 5, 'the original is untouched');
});

// ------------------------------------------------------------------ what the updater asks

test('betas turned on while checking is off still makes no request', () => {
  // The honest arrangement: no setting here can start a request on its own.
  assert.strictEqual(mayCheckForUpdates(normalise({ betaReleases: true })), false);
  assert.strictEqual(
    mayCheckForUpdates(normalise({ checkForUpdates: true, betaReleases: false })), true,
  );
});

test('a version the reader has declined is not offered again', () => {
  const settings = normalise({ skippedVersion: 'desktop-v0.5.0' });
  assert.strictEqual(shouldOffer(settings, 'desktop-v0.5.0'), false);
  assert.strictEqual(shouldOffer(settings, 'desktop-v0.5.1'), true);
});

test('with nothing skipped, everything is offered', () => {
  assert.strictEqual(shouldOffer(normalise({}), 'desktop-v0.5.0'), true);
});

// ------------------------------------------------------------------ nearby sharing

test('nearby sharing is off until switched on, and only a real true turns it on', () => {
  // The third setting that reaches a network. Off means nothing is constructed and nothing binds.
  assert.strictEqual(DEFAULT_SETTINGS.nearbySharing, false);
  assert.strictEqual(normalise({ nearbySharing: 'true' }).nearbySharing, false);
  assert.strictEqual(normalise({ nearbySharing: 1 }).nearbySharing, false);
  assert.strictEqual(normalise({ nearbySharing: true }).nearbySharing, true);
});

test('the device name is the generated one until somebody chooses one', () => {
  assert.strictEqual(DEFAULT_SETTINGS.nearbyName, null);
  assert.strictEqual(normalise({ nearbyName: 42 }).nearbyName, null);
  // Nothing survives cleaning, so it is no name rather than an empty one broadcast twice a second.
  assert.strictEqual(normalise({ nearbyName: '   ' }).nearbyName, null);
});

test('a stored name is cleaned on the way back in, not only on the way out', () => {
  // The settings file is in a folder the reader can edit. A bidirectional override is the one
  // character that lets a device draw itself as another device, so it is stripped here too.
  const override = String.fromCodePoint(0x202e); // written out: the character itself is invisible
  assert.strictEqual(normalise({ nearbyName: `Ankit${override}s phone` }).nearbyName, 'Ankits phone');
  assert.strictEqual(normalise({ nearbyName: '  Study   desk ' }).nearbyName, 'Study desk');
  assert.ok(Buffer.byteLength(normalise({ nearbyName: 'ह'.repeat(40) }).nearbyName) <= 64);
});

test('switching nearby sharing off does not forget the name', () => {
  // A remembered update result is a cache that can go stale; a name is something somebody chose.
  const named = applyChange(normalise({ nearbySharing: true }), 'nearbyName', 'Study desk');
  const off = applyChange(named, 'nearbySharing', false);
  assert.strictEqual(off.nearbySharing, false);
  assert.strictEqual(off.nearbyName, 'Study desk');
});

// ------------------------------------------------------------------ the book usage ledger (#156)

test('nobody has used a book feature until the counter says otherwise', () => {
  assert.deepStrictEqual(DEFAULT_SETTINGS.bookUsage, {});
});

test('a stored count survives normalisation', () => {
  assert.deepStrictEqual(
    normalise({ bookUsage: { 'book.export': 2, 'book.template': 1 } }).bookUsage,
    { 'book.export': 2, 'book.template': 1 },
  );
});

test('a settings file edited into nonsense gives an empty ledger, not a crash', () => {
  // The same promise every other setting makes: a hand-edited or newer-version file starts this
  // one fresh rather than behaving strangely. Nonsense here specifically must not read as "already
  // used a great many times", which is the one wrong direction for a counter to fail in.
  for (const bad of [null, undefined, 'a string', 42, [], ['book.export']]) {
    assert.deepStrictEqual(normalise({ bookUsage: bad }).bookUsage, {});
  }
});

test('a count for an unrecognised key is dropped, not kept as a stray entry', () => {
  assert.deepStrictEqual(
    normalise({ bookUsage: { '': 1, 'book.export': 'lots' } }).bookUsage,
    {},
  );
});

test('a negative or non-integer count is dropped rather than trusted', () => {
  assert.deepStrictEqual(
    normalise({ bookUsage: { 'book.export': -1, 'book.template': 1.5 } }).bookUsage,
    {},
  );
});

test('normalise never hands back the same bookUsage object twice', () => {
  // DEFAULTS.bookUsage is the one non-primitive default this file has. Every other default is a
  // value type, where handing it out by reference is indistinguishable from copying it -- an
  // object is not, and a caller that mutated what normalise() gave them must never be able to
  // reach DEFAULTS itself or another caller's settings through it.
  const first = normalise({});
  const second = normalise({});
  assert.notStrictEqual(first.bookUsage, second.bookUsage);
  assert.notStrictEqual(first.bookUsage, DEFAULT_SETTINGS.bookUsage);

  first.bookUsage['book.export'] = 99;
  assert.deepStrictEqual(second.bookUsage, {});
  assert.deepStrictEqual(DEFAULT_SETTINGS.bookUsage, {});
});

// ------------------------------------------------------------------ birthday reminders (#154)

test('reminders are off until switched on, like everything else that can surprise a reader', () => {
  assert.strictEqual(DEFAULT_SETTINGS.reminders, false);
  assert.strictEqual(DEFAULT_SETTINGS.reminderRemembrance, false);
  assert.strictEqual(normalise({ reminders: 'true' }).reminders, false);
  assert.strictEqual(normalise({ reminders: true }).reminders, true);
});

test('the lead time falls back to "on the day" for anything it does not recognise', () => {
  assert.strictEqual(DEFAULT_SETTINGS.reminderLead, 'day');
  assert.strictEqual(normalise({ reminderLead: 'before' }).reminderLead, 'before');
  assert.strictEqual(normalise({ reminderLead: 'yesterday' }).reminderLead, 'day');
  assert.strictEqual(normalise({}).reminderLead, 'day');
});

test('the day a digest was last shown is a real date or nothing, never trusted as typed', () => {
  assert.strictEqual(DEFAULT_SETTINGS.remindersShownOn, null);
  assert.strictEqual(normalise({ remindersShownOn: '2026-09-15' }).remindersShownOn, '2026-09-15');
  assert.strictEqual(normalise({ remindersShownOn: 'yesterday' }).remindersShownOn, null);
  assert.strictEqual(normalise({ remindersShownOn: 20260915 }).remindersShownOn, null);
});

test('turning reminders off does not need to clear what depends on it', () => {
  // Unlike the updater, there is no stale banner here for a cross-setting rule to protect against:
  // `dueNow` (reminders.js) already returns null while `reminders` is false, whatever the lead time
  // or the remembrance switch say, so there is nothing left behind that could act on its own.
  const on = normalise({ reminders: true, reminderRemembrance: true, reminderLead: 'before' });
  const off = applyChange(on, 'reminders', false);
  assert.strictEqual(off.reminders, false);
  assert.strictEqual(off.reminderRemembrance, true);
  assert.strictEqual(off.reminderLead, 'before');
});

test('applyChange replaces the whole ledger rather than merging into it', () => {
  // Consistent with every other setting here: applyChange sets a key to what it is given. A
  // caller that wants to record one more use reads the current count and writes the whole object
  // back, the same shape record() will take once something in the app actually calls it.
  const before = normalise({ bookUsage: { 'book.export': 1 } });
  const after = applyChange(before, 'bookUsage', { 'book.export': 2 });
  assert.deepStrictEqual(after.bookUsage, { 'book.export': 2 });
});
