/*
 * Advance-width tables for the book's fonts, read straight off the TrueType binary.
 *
 * The composer measures a line of text before it draws it, so it can decide where to break a
 * page — and it does that measuring inside an Android WebView, which has no font-metrics API of
 * its own and no access to whatever `fonttools` or a browser's `TextMetrics` would give it. The
 * only way to get a real answer is to read the same tables the rendering engine reads: `hmtx` for
 * each glyph's advance width, `cmap` to go from a codepoint to the glyph that carries it, and
 * `head`/`hhea`/`OS/2` for the handful of scalar metrics (units per em, ascender, descender, cap
 * height) that turn those advances into a real line-breaking measure.
 *
 * No `fonttools`, no npm package: this file is committed as source and run by both the Node CI
 * runners and the composer's own build step, and pulling in a dependency for four small tables is
 * a worse trade than the ~150 lines below. It parses only what `book_*.ttf` actually contain —
 * `cmap` format 4 (all four fonts, since Latin + Devanagari fits inside the Basic Multilingual
 * Plane) and format 12, kept for a future font whose coverage does not.
 *
 * Output is an ES module, not JSON: the composer imports it inside a WebView as old as Chrome 80,
 * which implements `<script type="module">` but not `import ... assert { type: 'json' }`. A `.js`
 * module with `export default {...}` works everywhere the JSON form doesn't and costs nothing.
 *
 * Run with no arguments to regenerate `site/book/metrics/<name>.js` from the committed TTFs:
 *
 *   node tools/font_metrics.mjs
 *
 * Run with `--check` to fail (exit 1) if the committed metrics files disagree with what the
 * current TTFs would produce — the guard against a font swap that forgot to regenerate them.
 *
 *   node tools/font_metrics.mjs --check
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const fontDir = path.join(repoRoot, 'app', 'src', 'main', 'res', 'font');
const metricsDir = path.join(repoRoot, 'site', 'book', 'metrics');

// The four static, subset book fonts. See docs/fonts.md for why these four and not more.
const FONTS = ['book_display', 'book_text', 'book_strong', 'book_hand'];

/* ---------------------------------------------------------------- sfnt table directory */

function parseDirectory(buf) {
  const numTables = buf.readUInt16BE(4);
  const tables = new Map();
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    const tag = buf.toString('latin1', rec, rec + 4);
    const offset = buf.readUInt32BE(rec + 8);
    const length = buf.readUInt32BE(rec + 12);
    tables.set(tag, { offset, length });
  }
  return tables;
}

function requireTable(buf, tables, tag) {
  const entry = tables.get(tag);
  if (!entry) throw new Error(`missing required table '${tag}'`);
  return entry;
}

/* ---------------------------------------------------------------- head / hhea / hmtx */

function readHead(buf, tables) {
  const { offset } = requireTable(buf, tables, 'head');
  return { unitsPerEm: buf.readUInt16BE(offset + 18) };
}

function readHhea(buf, tables) {
  const { offset } = requireTable(buf, tables, 'hhea');
  return { numberOfHMetrics: buf.readUInt16BE(offset + 34) };
}

/**
 * Per-glyph advance widths, plus the fallback for any glyph index past the end of the array.
 *
 * `hmtx` stores an explicit (advanceWidth, lsb) pair for the first `numberOfHMetrics` glyphs; a
 * font with trailing monospaced or unused glyphs (true here — Devanagari conjuncts formed at
 * shaping time inherit the width of their base consonant) omits an entry for the rest and expects
 * a reader to reuse the last stored advance width. `defaultAdvance` below is exactly that reuse.
 */
function readHmtx(buf, tables, numberOfHMetrics) {
  const { offset } = requireTable(buf, tables, 'hmtx');
  const advances = new Array(numberOfHMetrics);
  for (let i = 0; i < numberOfHMetrics; i++) {
    advances[i] = buf.readUInt16BE(offset + i * 4);
  }
  const defaultAdvance = advances[numberOfHMetrics - 1] ?? 0;
  return { advances, defaultAdvance };
}

/* ---------------------------------------------------------------- OS/2 */

function readOS2(buf, tables) {
  const { offset } = requireTable(buf, tables, 'OS/2');
  const version = buf.readUInt16BE(offset);
  const sTypoAscender = buf.readInt16BE(offset + 68);
  const sTypoDescender = buf.readInt16BE(offset + 70);
  // sCapHeight was added in OS/2 version 2. A version-0/1 font (none of ours, but a future one
  // might be) has no real cap height to read; the typo ascender is the least-wrong stand-in,
  // since both describe roughly the top of a capital letter.
  const sCapHeight = version >= 2 ? buf.readInt16BE(offset + 88) : sTypoAscender;
  return { sTypoAscender, sTypoDescender, sCapHeight };
}

/* ---------------------------------------------------------------- cmap */

/**
 * Format 4: segmented, 16-bit codepoints only — the Basic Multilingual Plane. Latin and Devanagari
 * both live there, so every font this project ships so far uses this format alone.
 */
function readCmapFormat4(buf, subtableOffset, map) {
  const segCountX2 = buf.readUInt16BE(subtableOffset + 6);
  const segCount = segCountX2 / 2;
  const endCodesAt = subtableOffset + 14;
  const startCodesAt = endCodesAt + segCountX2 + 2; // +2 skips reservedPad
  const idDeltasAt = startCodesAt + segCountX2;
  const idRangeOffsetsAt = idDeltasAt + segCountX2;

  for (let seg = 0; seg < segCount; seg++) {
    const end = buf.readUInt16BE(endCodesAt + seg * 2);
    const start = buf.readUInt16BE(startCodesAt + seg * 2);
    const delta = buf.readInt16BE(idDeltasAt + seg * 2);
    const rangeOffsetPos = idRangeOffsetsAt + seg * 2;
    const rangeOffset = buf.readUInt16BE(rangeOffsetPos);
    if (start === 0xffff && end === 0xffff) continue; // the required terminator segment

    for (let cp = start; cp <= end; cp++) {
      let glyphId;
      if (rangeOffset === 0) {
        glyphId = (cp + delta) & 0xffff;
      } else {
        const glyphIndexAddress = rangeOffsetPos + rangeOffset + 2 * (cp - start);
        const raw = buf.readUInt16BE(glyphIndexAddress);
        glyphId = raw === 0 ? 0 : (raw + delta) & 0xffff;
      }
      if (glyphId !== 0) map.set(cp, glyphId);
    }
  }
}

/**
 * Format 12: segmented, 32-bit codepoints — kept for a future font whose coverage reaches past the
 * BMP (an emoji or a supplementary-plane script). None of the current book fonts need it.
 */
function readCmapFormat12(buf, subtableOffset, map) {
  const numGroups = buf.readUInt32BE(subtableOffset + 12);
  const groupsAt = subtableOffset + 16;
  for (let g = 0; g < numGroups; g++) {
    const rec = groupsAt + g * 12;
    const startChar = buf.readUInt32BE(rec);
    const endChar = buf.readUInt32BE(rec + 4);
    const startGlyph = buf.readUInt32BE(rec + 8);
    for (let cp = startChar; cp <= endChar; cp++) {
      const glyphId = startGlyph + (cp - startChar);
      if (glyphId !== 0) map.set(cp, glyphId);
    }
  }
}

/**
 * Picks the one cmap subtable worth reading: a Unicode BMP-or-full-repertoire mapping, in the same
 * preference order every shaping engine uses (full Unicode over BMP-only, Windows platform over
 * the older Macintosh/Unicode ones this project has never had a reason to target).
 */
function readCmap(buf, tables) {
  const { offset } = requireTable(buf, tables, 'cmap');
  const numTables = buf.readUInt16BE(offset + 2);
  const candidates = [];
  for (let i = 0; i < numTables; i++) {
    const rec = offset + 4 + i * 8;
    const platformID = buf.readUInt16BE(rec);
    const encodingID = buf.readUInt16BE(rec + 2);
    const subtableOffset = offset + buf.readUInt32BE(rec + 4);
    const format = buf.readUInt16BE(subtableOffset);
    candidates.push({ platformID, encodingID, subtableOffset, format });
  }

  const rank = (c) => {
    if (c.platformID === 3 && c.encodingID === 10 && c.format === 12) return 0;
    if (c.platformID === 0 && c.format === 12) return 1;
    if (c.platformID === 3 && c.encodingID === 1 && c.format === 4) return 2;
    if (c.platformID === 0 && c.format === 4) return 3;
    return 99;
  };
  candidates.sort((a, b) => rank(a) - rank(b));
  const chosen = candidates.find((c) => rank(c) < 99);
  if (!chosen) throw new Error('no usable Unicode cmap subtable (format 4 or 12) found');

  const map = new Map();
  if (chosen.format === 4) readCmapFormat4(buf, chosen.subtableOffset, map);
  else if (chosen.format === 12) readCmapFormat12(buf, chosen.subtableOffset, map);
  else throw new Error(`chosen cmap subtable has unsupported format ${chosen.format}`);
  return map;
}

/* ---------------------------------------------------------------- putting it together */

function extractMetrics(buf, name) {
  const tables = parseDirectory(buf);
  const head = readHead(buf, tables);
  const hhea = readHhea(buf, tables);
  const { advances: hmtxAdvances, defaultAdvance } = readHmtx(buf, tables, hhea.numberOfHMetrics);
  const os2 = readOS2(buf, tables);
  const cmap = readCmap(buf, tables);

  // Compact on purpose: one entry per codepoint the font actually maps, not one per codepoint in
  // the subsetting range. A composer that measures a codepoint missing from this table has met a
  // glyph this font does not carry, which is exactly the case it needs to fall back for.
  const advances = {};
  for (const cp of [...cmap.keys()].sort((a, b) => a - b)) {
    const glyphId = cmap.get(cp);
    advances[cp] = glyphId < hmtxAdvances.length ? hmtxAdvances[glyphId] : defaultAdvance;
  }

  return {
    name,
    unitsPerEm: head.unitsPerEm,
    ascender: os2.sTypoAscender,
    descender: os2.sTypoDescender,
    capHeight: os2.sCapHeight,
    defaultAdvance,
    advances,
  };
}

function renderModule(metrics) {
  const header =
    `// GENERATED FILE — do not edit by hand.\n` +
    `// Produced by tools/font_metrics.mjs from app/src/main/res/font/${metrics.name}.ttf.\n` +
    `// Regenerate with: node tools/font_metrics.mjs (and check with the --check flag CI runs).\n`;
  const body = JSON.stringify(metrics);
  return `${header}export default ${body};\n`;
}

async function main() {
  const check = process.argv.includes('--check');
  let mismatches = 0;

  for (const name of FONTS) {
    const ttfPath = path.join(fontDir, `${name}.ttf`);
    const outPath = path.join(metricsDir, `${name}.js`);
    const buf = await readFile(ttfPath);
    const metrics = extractMetrics(buf, name);
    const rendered = renderModule(metrics);

    if (check) {
      const existing = await readFile(outPath, 'utf8').catch(() => null);
      if (existing === rendered) {
        console.log(`  ok    ${path.relative(repoRoot, outPath)} matches ${name}.ttf`);
      } else {
        mismatches += 1;
        console.log(existing === null
          ? ` FAIL   ${path.relative(repoRoot, outPath)} is missing`
          : ` FAIL   ${path.relative(repoRoot, outPath)} is stale — regenerate with ` +
            `'node tools/font_metrics.mjs'`);
      }
    } else {
      await writeFile(outPath, rendered);
      console.log(`  wrote ${path.relative(repoRoot, outPath)} ` +
        `(${Object.keys(metrics.advances).length} codepoints)`);
    }
  }

  if (check && mismatches > 0) {
    console.log(`\n${mismatches} of ${FONTS.length} metrics file(s) out of date.`);
    process.exit(1);
  }
}

main();
