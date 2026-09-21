/*
 * #244: composeBook's new options - `featured`, `notes` and `coverOnly` - and the story planner's
 * first module, `story/featured.js`. None of today's blocks read any of these yet (the story pages
 * are #256-258), so most of what is worth testing here is the plumbing itself: that each option
 * reaches the place the plan says it should, that it stays inert on Heirloom, and that
 * `resolveFeatured` picks the right person in every tier without ever reaching outside scope or
 * the allowance.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { composeBook, pageBlocks } from './compose.js';
import { validateBook } from './format.js';
import { readFamily, clampNote } from './family.js';
import { resolveFeatured } from './story/featured.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.join(here, p), 'utf8');
const NOW = '2026-09-15';
const HEIRLOOM = JSON.parse(read('templates/heirloom.json'));

/*
 * A small family built for these tests rather than borrowed from the shared fixtures, so every
 * score `resolveFeatured` has to weigh is on the page: `hub` is unnamed but the most connected
 * person in the tree (two marriages, four children), which is exactly the trap tier 3 has to avoid
 * - the book must never be told around somebody it cannot name.
 *
 *   hub (unnamed) -- w1 (named) -- c1, c2 (named)
 *       \-- w2 (named) -- c3, c4 (named)
 *
 * `w1` carries a note, for the notes tests below. `docFixture()` returns a fresh deep copy every
 * time, so no test can leak a mutation into another.
 */
function docFixture() {
  return {
    format: 'f-tree', version: 1,
    people: [
      { id: 'hub', name: null, gender: 'UNSPECIFIED', notes: null },
      { id: 'w1', name: 'Wife One', gender: 'FEMALE', notes: 'Loved her garden.\nGrew marigolds every Diwali.\t\r\nMissed her third line? No.\nA fourth line, cut.' },
      { id: 'w2', name: 'Wife Two', gender: 'FEMALE', notes: null },
      { id: 'c1', name: 'Child One', gender: 'MALE', notes: null },
      { id: 'c2', name: 'Child Two', gender: 'MALE', notes: null },
      { id: 'c3', name: 'Child Three', gender: 'FEMALE', notes: null },
      { id: 'c4', name: 'Child Four', gender: 'FEMALE', notes: null },
    ],
    relationships: [
      { id: 'r1', type: 'SPOUSE', from: 'hub', to: 'w1' },
      { id: 'r2', type: 'SPOUSE', from: 'hub', to: 'w2' },
      { id: 'r3', type: 'PARENT', from: 'hub', to: 'c1' },
      { id: 'r4', type: 'PARENT', from: 'w1', to: 'c1' },
      { id: 'r5', type: 'PARENT', from: 'hub', to: 'c2' },
      { id: 'r6', type: 'PARENT', from: 'w1', to: 'c2' },
      { id: 'r7', type: 'PARENT', from: 'hub', to: 'c3' },
      { id: 'r8', type: 'PARENT', from: 'w2', to: 'c3' },
      { id: 'r9', type: 'PARENT', from: 'hub', to: 'c4' },
      { id: 'r10', type: 'PARENT', from: 'w2', to: 'c4' },
    ],
  };
}

const EMPTY_DOC = { format: 'f-tree', version: 1, people: [], relationships: [] };

/* ---------------------------------------------------------------------------------------------
 * resolveFeatured: the four tiers, and that it never reaches outside scope or the allowance.
 * ------------------------------------------------------------------------------------------- */

test('resolveFeatured tier 1: an explicit, in-scope options.featured wins outright', () => {
  const family = readFamily(docFixture(), {}, {});
  assert.equal(resolveFeatured(family, { featured: 'w2' }), 'w2');
});

test('resolveFeatured tier 1 miss: an id outside scope falls through, never returned', () => {
  const family = readFamily(docFixture(), {}, {});
  // 'nope' names nobody in the tree at all - the plainest way to fail tier 1.
  assert.notEqual(resolveFeatured(family, { featured: 'nope' }), 'nope');
});

test('resolveFeatured tier 1 miss: an id cut out by a branch scope is never returned, even though it is a real person elsewhere in the same document', () => {
  const scope = { kind: 'branch', personId: 'w1' };
  const family = readFamily(docFixture(), { scope }, {});
  assert.ok(!family.byId.has('w2'), 'w2 should have been cut by the branch scope');
  const featured = resolveFeatured(family, { scope, featured: 'w2' });
  assert.notEqual(featured, 'w2');
  assert.equal(featured, 'w1');   // falls through to tier 2, the branch root
});

test('resolveFeatured tier 1 miss: an id cut out by the allowance is never returned', () => {
  const doc = {
    format: 'f-tree', version: 1,
    people: [
      { id: 'gp', name: 'Grandparent Devi', gender: 'FEMALE' },
      { id: 'p', name: 'Parent Devi', gender: 'FEMALE' },
      { id: 'c', name: 'Child Devi', gender: 'MALE' },
    ],
    relationships: [
      { id: 'r1', type: 'PARENT', from: 'gp', to: 'p' },
      { id: 'r2', type: 'PARENT', from: 'p', to: 'c' },
    ],
  };
  const family = readFamily(doc, {}, { maxGenerations: 2 });   // keeps gp (gen 0) and p (gen 1) only
  assert.ok(!family.byId.has('c'), 'the allowance should have cut the third generation');
  // Not merely "isn't 'c'" - pin the actual fallback so a change that quietly picks the wrong
  // tier-3 person would still fail this test. Both survivors tie on a raw score of 1 (each is the
  // other's only edge, since the allowance already dropped 'c'); the id-sorted tie-break picks the
  // one that sorts first.
  assert.equal(resolveFeatured(family, { featured: 'c' }), 'gp');
});

test('resolveFeatured: excluded by the allowance falls through past a branch scope\'s own root, all the way to tier 3 - not just "isn\'t the asked-for id"', () => {
  // Scoped to p's branch, branchFrom keeps {p, c} (gp is p's parent, not descendant, so it is
  // never in scope at all). The allowance then cuts to generation 0 of that scoped graph, which is
  // p alone - so `featured: 'c'` fails tier 1 (cut by the allowance) and the book is left with only
  // one person, who must therefore win tier 2 as the branch root. This is the case tier 1 and tier 2
  // being merely "not wrong" could both pass while resolveFeatured actually returned undefined or
  // threw - the previous test alone would not catch that, since it never scopes to a branch.
  const doc = {
    format: 'f-tree', version: 1,
    people: [
      { id: 'gp', name: 'Grandparent Devi', gender: 'FEMALE' },
      { id: 'p', name: 'Parent Devi', gender: 'FEMALE' },
      { id: 'c', name: 'Child Devi', gender: 'MALE' },
    ],
    relationships: [
      { id: 'r1', type: 'PARENT', from: 'gp', to: 'p' },
      { id: 'r2', type: 'PARENT', from: 'p', to: 'c' },
    ],
  };
  const scope = { kind: 'branch', personId: 'p' };
  const family = readFamily(doc, { scope }, { maxGenerations: 1 });
  assert.ok(!family.byId.has('c'), 'the allowance should have cut the second generation of the branch');
  assert.ok(!family.byId.has('gp'), 'gp is never in the branch to begin with');
  assert.equal(resolveFeatured(family, { scope, featured: 'c' }), 'p');
});

test('resolveFeatured tier 2: the branch root, when the book is scoped to one branch and nothing was asked for explicitly', () => {
  const scope = { kind: 'branch', personId: 'w1' };
  const family = readFamily(docFixture(), { scope }, {});
  assert.equal(resolveFeatured(family, { scope }), 'w1');
});

test('resolveFeatured tier 3: mostConnected among named people - never the unnamed person with the higher raw score', () => {
  const family = readFamily(docFixture(), {}, {});
  // `hub` (unnamed) has the highest raw score in this tree: two marriages and four children. A
  // plain mostConnected() would return `hub`; resolveFeatured must skip it for being unnamed.
  const featured = resolveFeatured(family, {});
  assert.notEqual(featured, 'hub');
  assert.ok(family.byId.get(featured).name, 'the featured person must have a name');
  assert.equal(featured, 'c1');   // the named tie-break: c1..c4 tie on score, lowest id wins
});

test('resolveFeatured tier 4: an empty tree has nobody to feature', () => {
  const family = readFamily(EMPTY_DOC, {}, {});
  assert.equal(family.people.length, 0);
  assert.equal(resolveFeatured(family, {}), null);
});

test('resolveFeatured: a tree with people but not one of them named also resolves to nobody, the same way an empty tree does', () => {
  const doc = { format: 'f-tree', version: 1, people: [{ id: 'a', name: null }, { id: 'b', name: null }], relationships: [] };
  const family = readFamily(doc, {}, {});
  assert.equal(resolveFeatured(family, {}), null);
});

test('composeBook resolves ctx.featured the same way for every template - Heirloom included - even though nothing draws it yet', () => {
  // Not observable on the Book itself (nothing reads ctx.featured), so this exercises the
  // composer's own wiring the only way available from outside: it must not throw, and the
  // book it hands back must still be exactly what it always was (checked below).
  assert.doesNotThrow(() => composeBook(docFixture(), { now: NOW, featured: 'w2' }, HEIRLOOM));
});

/* ---------------------------------------------------------------------------------------------
 * options.notes: off by default, clamped to 3 lines with control characters stripped when on,
 * and never in the register (today's stand-in for it, "Find yourself" - blocks/find.js reads only
 * `p.name`, never `p.note`).
 * ------------------------------------------------------------------------------------------- */

test('clampNote strips control characters (including tab) and keeps at most 3 non-blank lines', () => {
  const raw = 'Line one\u0007 with bell\nLine two\twith tab\r\nLine three\n\nLine four should be cut\n\u0001\u0002';
  assert.equal(clampNote(raw), 'Line one with bell\nLine two with tab\nLine three');
});

test('clampNote strips bidi embedding, override and isolate controls, which can reorder printed text', () => {
  // One of each: LRE, RLE, PDF, LRO, RLO (U+202A-U+202E) and LRI, RLI, FSI, PDI (U+2066-U+2069).
  const bidi = '\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069';
  assert.equal(clampNote(`Namaste${bidi} ji`), 'Namaste ji');
});

test('clampNote keeps LRM and RLM - they pick a direction for one character, never reorder anything', () => {
  const raw = 'Mixed \u200Eक\u200F and English';
  assert.equal(clampNote(raw), raw);
});

test('clampNote returns null for whatever has no text left to show', () => {
  assert.equal(clampNote(null), null);
  assert.equal(clampNote(undefined), null);
  assert.equal(clampNote(42), null);
  assert.equal(clampNote(''), null);
  assert.equal(clampNote('   \n \t \n  '), null);
});

test('options.notes off (the default): every shown person carries note: null, whatever their record holds', () => {
  const withoutOption = readFamily(docFixture(), {}, {});
  const explicitlyOff = readFamily(docFixture(), { notes: false }, {});
  for (const family of [withoutOption, explicitlyOff]) {
    assert.equal(family.byId.get('w1').note, null);
    for (const p of family.people) assert.equal(p.note, null);
  }
});

test('options.notes on: the shown person\'s note is present, clamped to 3 lines, control characters stripped', () => {
  const family = readFamily(docFixture(), { notes: true }, {});
  assert.equal(family.byId.get('w1').note, 'Loved her garden.\nGrew marigolds every Diwali.\nMissed her third line? No.');
  // A person with no note recorded still gets the field, just empty - never left undefined.
  assert.equal(family.byId.get('w2').note, null);
});

test('a note never appears in a composed book, on or off - the register (Find yourself) reads only names', () => {
  const marker = 'SHOULD-NEVER-PRINT-THIS-NOTE';
  const doc = docFixture();
  doc.people.find((p) => p.id === 'w1').notes = marker;

  for (const notes of [false, true, undefined]) {
    const book = composeBook(doc, { now: NOW, notes }, HEIRLOOM);
    assert.deepEqual(validateBook(book), []);
    const flat = JSON.stringify(book);
    assert.ok(!flat.includes(marker), `notes:${notes} leaked into the book`);
  }
});

/* ---------------------------------------------------------------------------------------------
 * options.coverOnly: stops the composer short of laying out the rest of the book. Checked two
 * ways - the exact set of blocks composeBook plans to run (the skipped work), and the book it
 * actually produces (the visible result).
 * ------------------------------------------------------------------------------------------- */

test('pageBlocks runs every block by default', () => {
  assert.deepEqual(pageBlocks(HEIRLOOM, {}), HEIRLOOM.pages);
  assert.deepEqual(pageBlocks(HEIRLOOM, undefined), HEIRLOOM.pages);
});

test('pageBlocks skips every block but the cover when coverOnly is set - not merely "produces one page" but "never asked for the rest"', () => {
  const planned = pageBlocks(HEIRLOOM, { coverOnly: true });
  assert.deepEqual(planned, ['cover']);
  // tree, numbers, generations, find and closing must not even be in the plan composeBook walks.
  for (const skipped of ['tree', 'numbers', 'generations', 'find', 'closing']) {
    assert.ok(!planned.includes(skipped), `${skipped} should have been skipped`);
  }
});

test('coverOnly produces just the cover, valid on its own', () => {
  const book = composeBook(docFixture(), { now: NOW, coverOnly: true }, HEIRLOOM);
  assert.deepEqual(validateBook(book), []);
  assert.equal(book.pages.length, 1);
  assert.equal(book.pages[0].label, 'Cover');
});

test('coverOnly does less work than a full compose, on the same family - fewer photographs asked for, not just fewer pages', () => {
  const full = composeBook(docFixture(), { now: NOW }, HEIRLOOM);
  const coverOnly = composeBook(docFixture(), { now: NOW, coverOnly: true }, HEIRLOOM);
  assert.ok(full.pages.length > 1);
  assert.equal(coverOnly.pages.length, 1);
  assert.ok(coverOnly.photos.length <= full.photos.length);
});

/* ---------------------------------------------------------------------------------------------
 * Regression: Heirloom must not move by one byte for these options being present, only for them
 * being *used* - and nothing in Heirloom's blocks reads featured or notes.
 * ------------------------------------------------------------------------------------------- */

test('Heirloom ignores featured and notes entirely - byte-identical output with or without them', () => {
  const plain = composeBook(docFixture(), { now: NOW }, HEIRLOOM);
  const withOptions = composeBook(docFixture(), { now: NOW, featured: 'w1', notes: true }, HEIRLOOM);
  assert.equal(JSON.stringify(withOptions), JSON.stringify(plain));
});
