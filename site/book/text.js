/*
 * Measuring and breaking text, from the fonts' own advance widths.
 *
 * The composer decides every line so both painters draw the same lines. It cannot ask a font
 * engine - there is none in a hidden WebView worth trusting, and node has none at all - so it
 * reads the advance width of each character from tables generated out of the very font files the
 * painters embed (tools/font_metrics.mjs). That is exact for Latin. Devanagari is shaped: a
 * conjunct is usually narrower than the sum of its parts, a matra may sit over its consonant, so a
 * sum of advances overestimates it. Overestimating is the safe direction - the line breaks a
 * little early - and a painter shrinks the rare line that still comes out too wide (format.js).
 */

/** Devanagari lines are given a little extra room on top of the sum of their advances. */
const DEVANAGARI_MARGIN = 1.06;
const isDevanagari = (cp) => (cp >= 0x0900 && cp <= 0x097f) || (cp >= 0xa8e0 && cp <= 0xa8ff);

export function measure(s, metrics, size) {
  if (!metrics) throw new Error('measure: no metrics for this font');
  let units = 0;
  let deva = false;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (isDevanagari(cp)) deva = true;
    const adv = metrics.advances[cp];
    units += adv === undefined ? metrics.defaultAdvance : adv;
  }
  return (units / metrics.unitsPerEm) * size * (deva ? DEVANAGARI_MARGIN : 1);
}

/**
 * Greedy line breaking at spaces. A word longer than the line is left whole on its own line - the
 * painter's shrink makes it fit - rather than broken mid-word, which in Devanagari would split a
 * syllable. Past `maxLines` the last line ends in an ellipsis.
 */
export function breakLines(s, metrics, size, width, maxLines = Infinity) {
  const words = String(s).trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && measure(candidate, metrics, size) > width) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = `${kept[maxLines - 1]} ${lines.slice(maxLines).join(' ')}`;
  while (last.length > 1 && measure(`${last}…`, metrics, size) > width) last = last.slice(0, -1).trimEnd();
  kept[maxLines - 1] = `${last}…`;
  return kept;
}

/** The largest size, no bigger than `size` and no smaller than `min`, at which `s` fits one line. */
export function fitSize(s, metrics, size, width, min) {
  const w = measure(s, metrics, size);
  if (w <= width) return size;
  return Math.max(min, size * (width / w));
}
