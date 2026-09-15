/*
 * Small pieces of English the book writes about a family.
 *
 * Numbers are spelled out where a sentence reads them aloud ("five generations") and left as
 * figures where the eye scans them (a page number, a year). Placeholders in a template's copy are
 * filled here, so a template can say "from {from-family}" without knowing whether the family's name
 * is in English or in Hindi.
 */

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** 23 -> "twenty-three"; past ninety-nine a figure reads better than words. */
export function countWords(n, capital = false) {
  let s;
  if (n < 20) s = ONES[n];
  else if (n < 100) s = TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');
  else s = String(n);
  return capital ? s[0].toUpperCase() + s.slice(1) : s;
}

export const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth',
  'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth'];

export const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV'];

export const generationName = (g) => (g < ORDINALS.length ? `The ${ORDINALS[g]} generation` : `Generation ${g + 1}`);

const DEVANAGARI = /[\u0900-\u097F]/;

/** "from the Sharma family", or "शर्मा परिवार की ओर से" when the family's name is in Hindi. */
export function fromFamily(title) {
  if (DEVANAGARI.test(title)) return `${title} की ओर से`;
  const m = /^The (.+) Family$/.exec(title);
  return m ? `from the ${m[1]} family` : `from ${title}`;
}

export function fill(copy, ctx) {
  return copy
    .split('{from-family}').join(fromFamily(ctx.family.title))
    .split('{family}').join(ctx.family.title)
    .split('{count-words}').join(countWords(ctx.facts.people))
    .split('{Count-words}').join(countWords(ctx.facts.people, true))
    .split('{count}').join(String(ctx.facts.people));
}

export const firstName = (p) => (p?.name ? p.name.trim().split(/\s+/)[0] : null);

/** "Shyam and Kamla", "Shyam, Kamla and Ravi". */
export function andList(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
