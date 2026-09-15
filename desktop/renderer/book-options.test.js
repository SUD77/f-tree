import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_OPTIONS, withTemplate, scopeFor, todayIso, formatEstimate,
  decisionAllowance, canSave, decisionMessage, nextBookUsage, bookRequest,
} from './book-options.js';

test('DEFAULT_OPTIONS opens on the whole tree, without photos left off or dates widened', () => {
  assert.equal(DEFAULT_OPTIONS.scopeKind, 'everyone');
  assert.equal(DEFAULT_OPTIONS.photos, true);
  assert.equal(DEFAULT_OPTIONS.livingDates, false);
  assert.equal(DEFAULT_OPTIONS.titleOverride, null);
});

test('withTemplate keeps a template that still exists', () => {
  const templates = [{ id: 'heirloom' }, { id: 'diwali' }];
  assert.equal(withTemplate(templates, 'diwali'), 'diwali');
});

test('withTemplate falls back to the catalogue\'s first entry', () => {
  const templates = [{ id: 'heirloom' }, { id: 'diwali' }];
  assert.equal(withTemplate(templates, 'gone'), 'heirloom');
  assert.equal(withTemplate(templates, null), 'heirloom');
  assert.equal(withTemplate([], 'anything'), null);
});

test('scopeFor is everyone unless a branch was asked for and a person is known', () => {
  assert.deepEqual(scopeFor({ scopeKind: 'everyone' }, 'p1'), { kind: 'everyone' });
  assert.deepEqual(scopeFor({ scopeKind: 'branch' }, 'p1'), { kind: 'branch', personId: 'p1' });
  // Asked for a branch, but the dialog was not opened from a person: never a request naming nobody.
  assert.deepEqual(scopeFor({ scopeKind: 'branch' }, null), { kind: 'everyone' });
});

test('todayIso reads the local calendar date, not UTC', () => {
  // A date built from local components, so this holds wherever the test runner's TZ is set.
  const date = new Date(2026, 8, 5); // 5 September 2026, month is zero-based
  assert.equal(todayIso(date), '2026-09-05');
});

test('formatEstimate rounds to kilobytes below one megabyte, and to one decimal above it', () => {
  assert.equal(formatEstimate(0), 'About 0 MB');
  assert.equal(formatEstimate(-5), 'About 0 MB');
  assert.equal(formatEstimate(1), 'About 1 KB');
  assert.equal(formatEstimate(420_000), 'About 420 KB');
  assert.equal(formatEstimate(999_999), 'About 1000 KB');
  assert.equal(formatEstimate(1_000_000), 'About 1.0 MB');
  assert.equal(formatEstimate(3_400_000), 'About 3.4 MB');
  assert.equal(formatEstimate(9_842_000), 'About 9.8 MB');
});

test('decisionAllowance is empty unless the decision is Limited', () => {
  assert.deepEqual(decisionAllowance({ kind: 'allowed' }), {});
  assert.deepEqual(decisionAllowance({ kind: 'locked', reason: 'quota-used' }), {});
  assert.deepEqual(decisionAllowance(null), {});
  const limited = { kind: 'limited', allowance: { maxGenerations: 2 }, reason: 'generation-scope' };
  assert.deepEqual(decisionAllowance(limited), { maxGenerations: 2 });
});

test('canSave is false only for Locked', () => {
  assert.equal(canSave({ kind: 'allowed' }), true);
  assert.equal(canSave({ kind: 'limited', allowance: {} }), true);
  assert.equal(canSave({ kind: 'locked', reason: 'quota-used' }), false);
  assert.equal(canSave(null), true);
});

test('decisionMessage says nothing for a plain Allowed', () => {
  assert.equal(decisionMessage({ kind: 'allowed' }), null);
  assert.equal(decisionMessage(null), null);
});

test('every reason policy.js can hand back has a sentence', () => {
  // The reason codes documented at the top of site/book/policy.js. A code with no sentence here
  // would leave the dialog silent about why a book was limited or locked -- the same trap
  // nearby-words.test.js guards `nearby/problems.js` against.
  const REASONS = [
    'unknown-feature', 'quota-used', 'generation-scope', 'premium-template',
    'not-included', 'malformed-rule',
  ];
  for (const reason of REASONS) {
    const message = decisionMessage({ kind: 'locked', reason });
    assert.equal(typeof message, 'string', `no sentence for reason "${reason}"`);
    assert.ok(message.length > 0, `empty sentence for reason "${reason}"`);
  }
});

test('nextBookUsage counts one feature up, and starts anybody unseen at one', () => {
  assert.deepEqual(nextBookUsage({}, 'book.export'), { 'book.export': 1 });
  assert.deepEqual(
    nextBookUsage({ 'book.export': 2, 'book.template': 5 }, 'book.export'),
    { 'book.export': 3, 'book.template': 5 },
  );
  // Never the same object back, so a caller cannot mutate settings.bookUsage by accident.
  const usage = { 'book.export': 1 };
  assert.notEqual(nextBookUsage(usage, 'book.export'), usage);
});

test('nextBookUsage recovers from a corrupted or hand-edited count', () => {
  assert.deepEqual(nextBookUsage(null, 'book.export'), { 'book.export': 1 });
  assert.deepEqual(nextBookUsage({ 'book.export': 'lots' }, 'book.export'), { 'book.export': 1 });
});

test('bookRequest carries the free tier and the family\'s own shape', () => {
  assert.deepEqual(bookRequest({ templateId: 'heirloom', generations: 5, people: 42 }), {
    feature: 'book.export',
    templateId: 'heirloom',
    templateTier: 'free',
    generations: 5,
    people: 42,
  });
});
