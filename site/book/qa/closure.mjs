/*
 * The static import closure of a composer entry file, walked the same way Android stages it.
 *
 * `bookEngine()` (app/build.gradle.kts) is what decides which JS files ship inside the release:
 * it seeds a queue with `site/book/compose.js`, matches only static relative `import`/`export`
 * specifiers with a regex, and resolves them breadth-first. Nothing that isn't reachable that way
 * is ever staged into the WebView, and nothing reachable that way escapes it -- so this is also
 * the exact set of files the banned-API guard has to cover. A fixed file list has to be remembered;
 * this walk cannot go stale, because it is the same computation Gradle performs.
 *
 * The regex below is a deliberate line-for-line port of Gradle's Kotlin one:
 *   Regex("""^\s*(?:import|export)\b[^'"]*['"](\.{1,2}/[^'"]+)['"]""", RegexOption.MULTILINE)
 * Keep the two in sync; a change to one without the other is a guard that stops matching what
 * actually ships.
 */

import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

export const IMPORT_SPECIFIER = /^\s*(?:import|export)\b[^'"]*['"](\.{1,2}\/[^'"]+)['"]/gm;

/**
 * Every file reachable from `entryFile` by a static relative import/export, entryFile included.
 * Mirrors `bookEngine()`'s BFS: a file is visited once, and every relative specifier its own text
 * names is queued, resolved against that file's own directory.
 */
export function importClosure(entryFile) {
  const found = new Set();
  const order = [];
  const queue = [path.resolve(entryFile)];
  while (queue.length) {
    const file = queue.shift();
    const real = realpathSync(file);
    if (found.has(real)) continue;
    found.add(real);
    order.push(real);
    const text = readFileSync(real, 'utf8');
    for (const m of text.matchAll(IMPORT_SPECIFIER)) {
      queue.push(path.resolve(path.dirname(real), m[1]));
    }
  }
  return order;
}

/** Strips block and line comments the same way the old fixed-list test did. */
export function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
}

/** Today's banned substrings (book.test.mjs's own list, unchanged). */
export const BANNED_APIS = ['new Date', 'Date.now', 'localeCompare', 'Intl.', 'document.', 'window.', 'Math.random', 'requestAnimationFrame', 'setTimeout', 'fetch('];

/**
 * Every violation found across `files` (absolute paths), as `{ file, banned }`. Only `.js`/`.mjs`
 * files are scanned -- the closure also carries `.json` templates, which are data, not code, and
 * cannot call anything.
 *
 * `allow`, keyed by basename, narrows which of `banned`'s substrings are tolerated in one specific
 * file. It exists for exactly two pre-existing, reviewed entries (book.test.mjs wires them up) and
 * is not how a new violation gets past this guard -- widening it, or adding a file to it, is itself
 * the kind of change a reviewer has to see and mean.
 */
export function bannedApiViolations(files, { banned = BANNED_APIS, allow = new Map() } = {}) {
  const violations = [];
  for (const file of files) {
    if (!/\.m?js$/.test(file)) continue;
    const allowed = allow.get(path.basename(file)) ?? new Set();
    const src = stripComments(readFileSync(file, 'utf8'));
    for (const b of banned) {
      if (allowed.has(b)) continue;
      if (src.includes(b)) violations.push({ file, banned: b });
    }
  }
  return violations;
}
