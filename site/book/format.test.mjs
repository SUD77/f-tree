/*
 * Book format 2, held to the one rule that keeps it cheap: a book declares the lowest format that
 * draws it. Heirloom uses nothing new, so it stays format 1 and its bytes never move - book.test.mjs
 * guards that with the goldens, and validateBook now refuses any book whose declared format and
 * drawn format disagree, so every composed book proves the rule as a side effect.
 *
 * golden/format2-conformance.json is the other half: a book that draws with everything format 2
 * adds, written by hand and read by both painters. #246 paints it in Kotlin against this file, so
 * what it exercises is the contract - a clipped arch over a photograph, a symbol drawn several
 * times, a use turned by `tf`, a use dimmed by `op`, and a silhouette use of a symbol that carries
 * a stroke, which is what proves the stroke is dropped.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FORMAT, FORMAT_MAX, formatOf, validateBook, group, use } from './format.js';
import { paintPage } from './svg.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.join(here, p), 'utf8');

const CONFORMANCE = JSON.parse(read('golden/format2-conformance.json'));

/** A book with just enough in it to be valid, so a test can say one thing at a time. */
const book = (over = {}) => ({
  format: FORMAT,
  template: 'test', title: 'T', fileName: 'T.pdf',
  size: { w: 595, h: 842 },
  fonts: { text: 'book_text' },
  defs: {}, photos: [],
  pages: [{ label: 'One', items: [] }],
  ...over,
});

const page = (...items) => [{ label: 'One', items }];
const MARK = { mark: { items: [
  { t: 'path', d: 'M0 0 L10 0 L10 10 Z', fill: '#f2b84b', stroke: '#b9822a', sw: 0.8 },
  { t: 'circle', cx: 5, cy: 5, r: 2, fill: '#ffe7a6' },
] } };
const paint = (b, i = 0) => paintPage(b, i, { photo: () => 'data:image/jpeg;base64,', font: (k) => k });

test('a book that draws with nothing new is format 1', () => {
  const heirloom = JSON.parse(read('golden/sample-heirloom.json'));
  assert.equal(heirloom.format, FORMAT);
  assert.equal(formatOf(heirloom), FORMAT);
  assert.deepEqual(validateBook(heirloom), []);
  assert.equal(formatOf(book({ pages: page({ t: 'group', items: [{ t: 'rect', x: 0, y: 0, w: 1, h: 1 }] }) })), FORMAT);
});

test('a clip, a use or a symbol is what makes a book format 2', () => {
  assert.equal(formatOf(book({ pages: page(group([], { clip: 'M0 0 L1 0 L1 1 Z' })) })), FORMAT_MAX);
  assert.equal(formatOf(book({ symbols: MARK, pages: page(use('mark')) })), FORMAT_MAX);
  assert.equal(formatOf(book({ symbols: {} })), FORMAT_MAX);
  // Nested: a clip four groups down still counts, or a book could hide one and claim format 1.
  assert.equal(formatOf(book({ pages: page(group([group([group([use('mark')])])])) })), FORMAT_MAX);
});

test('validateBook reads both formats, and no others', () => {
  assert.deepEqual(validateBook(book()), []);
  assert.deepEqual(validateBook(book({ format: FORMAT_MAX, symbols: MARK, pages: page(use('mark')) })), []);
  assert.deepEqual(validateBook(CONFORMANCE), []);
  for (const format of [0, 3, '2', undefined]) {
    assert.ok(validateBook(book({ format })).some((p) => p.startsWith('format ')), `format ${format}`);
  }
});

test('a book declares the lowest format that draws it, and neither less nor more', () => {
  const low = validateBook(book({ format: FORMAT, symbols: MARK, pages: page(use('mark')) }));
  assert.ok(low.some((p) => /draws as format 2/.test(p)), low.join('; '));
  const high = validateBook(book({ format: FORMAT_MAX }));
  assert.ok(high.some((p) => /draws as format 1/.test(p)), high.join('; '));
});

test('a clip a painter could not follow is refused, not drawn as an empty page', () => {
  const clipped = (clip) => validateBook(book({ format: FORMAT_MAX, pages: page({ t: 'group', clip, items: [] }) }));
  assert.deepEqual(clipped('M0 0 L10 0 L10 10 Z'), []);
  for (const bad of ['', '   ', 'm0 0 l10 0 z', 'M0 0 A5 5 0 0 1 10 10', { d: 'M0 0' }, 42]) {
    assert.ok(clipped(bad).some((p) => p.endsWith('clip path data')), JSON.stringify(bad));
  }
});

test('a use names a symbol the book carries', () => {
  const problems = validateBook(book({ format: FORMAT_MAX, symbols: MARK, pages: page(use('missing')) }));
  assert.deepEqual(problems, ['page 1 item 0: unknown symbol missing']);
  assert.ok(validateBook(book({ format: FORMAT_MAX, pages: page(use('mark')) })).some((p) => /unknown symbol/.test(p)));
  assert.ok(validateBook(book({ format: FORMAT_MAX, symbols: MARK, pages: page({ t: 'use', ref: 'mark', tf: [1, 0, 0, 1, 2] }) }))
    .some((p) => p.endsWith('transform')));
});

/*
 * Symbols may be built from symbols - the art compiler (#247) makes a courtyard out of lamps - so
 * nesting is allowed, and a cycle is refused here rather than left to hang a painter.
 */
test('a symbol may use another symbol, but never itself', () => {
  const symbols = {
    diya: { items: [{ t: 'path', d: 'M0 0 L4 0 L2 4 Z', fill: '#f2b84b' }] },
    pair: { items: [use('diya'), use('diya', { tf: [1, 0, 0, 1, 6, 0] })] },
    row: { items: [group([use('pair')], { tf: [1, 0, 0, 1, 0, 0] })] },
  };
  assert.deepEqual(validateBook(book({ format: FORMAT_MAX, symbols, pages: page(use('row')) })), []);

  const loop = { a: { items: [use('b')] }, b: { items: [use('a')] } };
  assert.ok(validateBook(book({ format: FORMAT_MAX, symbols: loop, pages: page(use('a')) }))
    .some((p) => /used through itself/.test(p)));
  const self = { a: { items: [group([use('a')])] } };
  assert.ok(validateBook(book({ format: FORMAT_MAX, symbols: self, pages: page(use('a')) }))
    .some((p) => /used through itself/.test(p)));

  const deep = Object.fromEntries('abcdef'.split('').map((id, i, all) =>
    [id, { items: all[i + 1] ? [use(all[i + 1])] : [{ t: 'path', d: 'M0 0 L1 1 Z', fill: '#f2b84b' }] }]));
  assert.ok(validateBook(book({ format: FORMAT_MAX, symbols: deep, pages: page(use('a')) }))
    .some((p) => /nested more than/.test(p)));
});

test('a symbol holds art, not words and not somebody\'s photograph', () => {
  const words = { s: { items: [{ t: 'text', x: 0, y: 0, s: 'Aangan', font: 'text', size: 10, fill: '#2a1a33' }] } };
  assert.ok(validateBook(book({ format: FORMAT_MAX, symbols: words, pages: page(use('s')) }))
    .some((p) => p === 'symbol s item 0: type text'));
  const photo = { s: { items: [{ t: 'image', id: 'p1', x: 0, y: 0, w: 10, h: 10, clip: 'rect' }] } };
  assert.ok(validateBook(book({ format: FORMAT_MAX, symbols: photo, pages: page(use('s')) }))
    .some((p) => p === 'symbol s item 0: type image'));
  assert.ok(validateBook(book({ format: FORMAT_MAX, symbols: { s: {} }, pages: page(use('s')) }))
    .some((p) => p === 'symbol s: no items'));
});

test('the conformance book draws with everything format 2 adds', () => {
  assert.equal(CONFORMANCE.format, FORMAT_MAX);
  assert.equal(formatOf(CONFORMANCE), FORMAT_MAX);
  const items = CONFORMANCE.pages.flatMap((p) => p.items);
  const uses = items.filter((it) => it.t === 'use');
  const clipped = items.filter((it) => it.t === 'group' && it.clip !== undefined);
  assert.ok(clipped.some((g) => g.items.some((c) => c.t === 'image')), 'no clipped photograph');
  assert.ok(uses.filter((u) => u.ref === 'diya').length >= 3, 'a symbol is not reused');
  assert.ok(uses.some((u) => u.tf), 'no use is turned by a tf');
  assert.ok(uses.some((u) => u.op !== undefined && u.fill === undefined), 'no use is dimmed by an op');
  const shadows = uses.filter((u) => u.fill !== undefined);
  assert.ok(shadows.length, 'no silhouette use');
  const stroked = (id, seen = []) => CONFORMANCE.symbols[id].items.some((it) =>
    it.stroke !== undefined || (it.t === 'use' && !seen.includes(it.ref) && stroked(it.ref, [...seen, id])));
  assert.ok(shadows.every((u) => stroked(u.ref)), 'a silhouette whose symbol has no stroke proves nothing');
});

test('the SVG painter expands every use, so pages joined into one file cannot collide', () => {
  const svg = CONFORMANCE.pages.map((_, i) => paint(CONFORMANCE, i)).join('');
  assert.ok(!/<use\b/.test(svg), 'a use survived into the print file');
  assert.ok(!/NaN|undefined|Infinity/.test(svg), 'the print file holds a non-number');
  assert.ok(/<clipPath id="[^"]+"><path d="M197.5 420/.test(svg), 'the arch is not a clipPath');
  const ids = [...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'the joined pages repeat an id');
  for (const [, ref] of svg.matchAll(/url\(#([^)]+)\)/g)) assert.ok(ids.includes(ref), `#${ref} resolves to nothing`);
  // The lamp is authored once and stands in nine places across the two pages: two on the first
  // (the lamp and its shadow), and seven on the second, four of them through lamp-pair.
  const bowl = CONFORMANCE.symbols.diya.items[0].d;
  assert.equal(svg.split(`d="${bowl}"`).length - 1, 9);
});

test('a silhouette use keeps the shape and drops the stroke', () => {
  const shadows = CONFORMANCE.pages[0].items.filter((it) => it.t === 'use' && it.fill !== undefined);
  const svg = paint({ ...CONFORMANCE, pages: [{ label: 'Shadow', items: shadows }] });
  assert.ok(!/stroke/.test(svg), svg);
  assert.equal(svg.split('fill="#2a1a33"').length - 1, CONFORMANCE.symbols.diya.items.length);

  // Down through a nested use as well: a compound motif casts one shadow, not a stack of drawings.
  const nested = book({
    format: FORMAT_MAX,
    symbols: { ...MARK, pair: { items: [use('mark'), use('mark', { tf: [1, 0, 0, 1, 12, 0] })] } },
    pages: page(use('pair', { fill: '#17122e', op: 0.35 })),
  });
  assert.deepEqual(validateBook(nested), []);
  const shadow = paint(nested);
  assert.ok(!/stroke/.test(shadow), shadow);
  assert.equal(shadow.split('fill="#17122e"').length - 1, 4);
  assert.ok(!/#f2b84b|#ffe7a6/.test(shadow), 'the symbol\'s own colours leaked into its shadow');
});

test('the painter refuses a symbol it cannot find, rather than drawing a gap', () => {
  assert.throws(() => paint(book({ format: FORMAT_MAX, symbols: MARK, pages: page(use('missing')) })), /unknown symbol missing/);
});
