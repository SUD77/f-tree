/*
 * The hand role (book_hand, Kalam Regular, #242) at the small end of its documented range,
 * 10-18 pt (docs/book-design-system.md, approved 2026-09-17 in #262's contract corrections: not
 * the gotchas' 9 pt, not acceptance criterion 3's 11 pt).
 *
 * No archetype uses `hand` yet - that is #256-#258 - so this builds the smallest possible book by
 * hand with format.js's own builders, the way a future caption block will, and paints it with the
 * one pipeline both shells share. It deliberately does not add any width margin of its own: the
 * only shrink allowed is text.js's existing DEVANAGARI_MARGIN (measurement) and svg.js's fitText /
 * BookPainter.drawText (paint-time), both keyed off the string's script, not the font. Kalam gets
 * exactly the same treatment Mukta already does.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { FORMAT, PAGE, validateBook, text as textItem } from './format.js';
import { paintPage } from './svg.js';
import { measure, breakLines } from './text.js';
import { METRICS } from './metrics/index.js';

const HAND_SIZE = 10; // the smallest size the hand role is approved for (#262)
const LATIN = 'From the Sharma family, with love';
const DEVANAGARI = 'शर्मा परिवार की ओर से, प्यार सहित';

function bookOf(caption) {
  const width = measure(caption, METRICS.book_hand, HAND_SIZE);
  const item = textItem(40, 100, caption, 'hand', HAND_SIZE, '#2a1a33', { w: width });
  return {
    format: FORMAT,
    size: PAGE,
    fonts: { hand: 'book_hand' },
    fileName: 'test.pdf',
    title: 'test',
    pages: [{ label: 'hand role', items: [item] }],
  };
}

test('the hand role has its own metrics table, reachable the way every other role is', () => {
  assert.ok(METRICS.book_hand, 'METRICS.book_hand is missing');
  assert.equal(METRICS.book_hand.name, 'book_hand');
});

test('a Latin hand-role caption measures and paints at 10 pt', () => {
  const book = bookOf(LATIN);
  assert.deepEqual(validateBook(book), []);
  const svg = paintPage(book, 0, { photo: () => null, font: (k) => k });
  assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'));
  assert.ok(!/NaN|undefined|Infinity/.test(svg), svg);
  assert.ok(svg.includes(LATIN), 'the caption text is missing from the painted page');
  assert.match(svg, /font-family="book_hand"/);
  assert.match(svg, /font-size="10"/);
});

test('a Devanagari hand-role caption measures and paints at 10 pt, with the same shrink mechanism as every other role', () => {
  const book = bookOf(DEVANAGARI);
  assert.deepEqual(validateBook(book), []);
  const svg = paintPage(book, 0, { photo: () => null, font: (k) => k });
  assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'));
  assert.ok(!/NaN|undefined|Infinity/.test(svg), svg);
  assert.ok(svg.includes(DEVANAGARI), 'the caption text is missing from the painted page');
  assert.match(svg, /font-family="book_hand"/);
  // The composer measures wide (DEVANAGARI_MARGIN, text.js) precisely so a shaping engine that
  // comes out a little narrower never needs fitText's shrink; a Latin caption gets no such margin.
  const m = METRICS.book_hand;
  let units = 0;
  for (const ch of DEVANAGARI) {
    const adv = m.advances[ch.codePointAt(0)];
    // Every character has its own advance: Kalam covers it, rather than falling to the default.
    assert.ok(adv !== undefined || ch === ' ', `book_hand has no advance for U+${ch.codePointAt(0).toString(16)}`);
    units += adv ?? m.defaultAdvance;
  }
  const bare = (units / m.unitsPerEm) * HAND_SIZE;
  assert.ok(Math.abs(measure(DEVANAGARI, m, HAND_SIZE) - bare * 1.06) < 1e-9, 'the Devanagari margin is applied to the hand role');
  const latin = LATIN.slice(0, DEVANAGARI.length);
  let latinUnits = 0;
  for (const ch of latin) latinUnits += m.advances[ch.codePointAt(0)] ?? m.defaultAdvance;
  assert.ok(Math.abs(measure(latin, m, HAND_SIZE) - (latinUnits / m.unitsPerEm) * HAND_SIZE) < 1e-9, 'Latin gets no margin');
});

test('breakLines keeps a hand-role caption within its box at 10 pt, in both scripts', () => {
  for (const caption of [LATIN, DEVANAGARI]) {
    const lines = breakLines(caption, METRICS.book_hand, HAND_SIZE, 120);
    assert.ok(lines.length > 0, caption);
    for (const l of lines) assert.ok(measure(l, METRICS.book_hand, HAND_SIZE) <= 120 || !l.includes(' '), `${caption}: "${l}"`);
    assert.equal(lines.join(' '), caption);
  }
});
