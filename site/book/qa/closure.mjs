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

/**
 * Blanks out the contents of string and template literals, keeping every character's position (so
 * offsets found in the result still index correctly into the original, comment-stripped source).
 * Used only so brace-matching in `functionSpan` cannot be thrown off by a stray `{` or `}` inside a
 * string.
 */
function maskStrings(src) {
  return src.replace(/`(?:\\.|\$\{[^{}]*\}|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, (m) =>
    m[0] + 'x'.repeat(m.length - 2) + m[m.length - 1]);
}

/**
 * The `[start, end)` character span of the body of the function named `name` in `src`, or `null`
 * if no such function is found. Recognizes `function NAME(` and `const NAME = ` (including a
 * curried arrow like `const NAME = (a) => (b) => { ... }`, where the body is the first `{...}`
 * block reached, since the parameter lists themselves never contain braces here).
 *
 * `src` should already have comments stripped and strings masked (same length, so offsets line up
 * with the comment-stripped, un-masked source that callers scan for banned substrings).
 */
export function functionSpan(src, name) {
  const re = new RegExp(`(?:\\bfunction\\s+${name}\\s*\\(|\\bconst\\s+${name}\\s*=)`);
  const m = re.exec(src);
  if (!m) return null;
  const open = src.indexOf('{', m.index);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return [m.index, i + 1];
    }
  }
  return null;
}

/** Today's banned substrings (book.test.mjs's own list, unchanged). */
export const BANNED_APIS = ['new Date', 'Date.now', 'localeCompare', 'Intl.', 'document.', 'window.', 'Math.random', 'requestAnimationFrame', 'setTimeout', 'fetch('];

/** `file`'s path relative to `repoRoot`, posix-style, or its basename if no `repoRoot` is given. */
function keyFor(file, repoRoot) {
  return repoRoot ? path.relative(repoRoot, file).split(path.sep).join('/') : path.basename(file);
}

/**
 * Every violation found across `files` (absolute paths), as `{ file, banned }`. Only `.js`/`.mjs`
 * files are scanned -- the closure also carries `.json` templates, which are data, not code, and
 * cannot call anything.
 *
 * `allow`, keyed by `file`'s path relative to `repoRoot` (never a bare basename -- two files with
 * the same name in different directories must not share an exception), maps to a list of
 * `{ banned, fn }`: the substring is tolerated only inside the named function's own body, found by
 * `functionSpan`. A second, unrelated occurrence of the same substring elsewhere in the file is
 * still a violation. This exists for exactly two pre-existing, reviewed entries (book.test.mjs
 * wires them up) and is not how a new violation gets past this guard -- widening it, or adding a
 * file to it, is itself the kind of change a reviewer has to see and mean.
 */
export function bannedApiViolations(files, { banned = BANNED_APIS, allow = new Map(), repoRoot } = {}) {
  const violations = [];
  for (const file of files) {
    if (!/\.m?js$/.test(file)) continue;
    const exceptions = allow.get(keyFor(file, repoRoot)) ?? [];
    const src = stripComments(readFileSync(file, 'utf8'));
    const spanSrc = maskStrings(src);
    for (const b of banned) {
      const relevant = exceptions.filter((e) => e.banned === b);
      if (relevant.length === 0) {
        if (src.includes(b)) violations.push({ file, banned: b });
        continue;
      }
      const spans = relevant.map((e) => functionSpan(spanSrc, e.fn)).filter(Boolean);
      let idx = -1;
      let outside = false;
      while ((idx = src.indexOf(b, idx + 1)) !== -1) {
        if (!spans.some(([start, end]) => idx >= start && idx < end)) outside = true;
      }
      if (outside) violations.push({ file, banned: b });
    }
  }
  return violations;
}

/**
 * Exceptions in `allow` (same shape as `bannedApiViolations`'s) that no longer match anything: the
 * file is not in `files` at all, the named function no longer exists, or the function's body no
 * longer contains the banned substring it was written to excuse. A guard that only ever narrows is
 * not enough -- an exception nobody re-checks is a hole with a comment taped over it. Once a bug an
 * exception was carved out for is fixed (or the code around it changes shape), the exception itself
 * must be deleted, and this is what forces that.
 */
export function staleExceptions(files, allow, { repoRoot } = {}) {
  const byKey = new Map(files.map((f) => [keyFor(f, repoRoot), f]));
  const stale = [];
  for (const [key, exceptions] of allow) {
    const file = byKey.get(key);
    if (!file) {
      for (const { banned, fn } of exceptions) stale.push({ file: key, banned, fn, reason: 'file is not in the closure' });
      continue;
    }
    const src = stripComments(readFileSync(file, 'utf8'));
    const spanSrc = maskStrings(src);
    for (const { banned, fn } of exceptions) {
      const span = functionSpan(spanSrc, fn);
      if (!span) {
        stale.push({ file: key, banned, fn, reason: `function ${fn} not found` });
        continue;
      }
      let idx = -1;
      let found = false;
      while ((idx = src.indexOf(banned, idx + 1)) !== -1) {
        if (idx >= span[0] && idx < span[1]) { found = true; break; }
      }
      if (!found) stale.push({ file: key, banned, fn, reason: `${fn} no longer contains ${banned}` });
    }
  }
  return stale;
}
