/*
 * The Book: what the composer hands to a painter.
 *
 * A book is a display list, not a document. Every coordinate is already decided, every line of
 * text already broken, so a painter only has to draw what it is given. That is what lets one
 * composer, written once in JavaScript, produce the same PDF on the desktop (painted as SVG and
 * printed by Chromium) and on Android (painted onto android.graphics.pdf.PdfDocument): the two
 * painters share a vocabulary of seven items and nothing else.
 *
 * The vocabulary is deliberately small. A template changes what is drawn - its palette, its art,
 * which blocks it uses - never how drawing works, so a new template never needs a painter change.
 * The full contract, with the rules each painter must follow, is docs/family-book.md.
 *
 *   rect    x y w h [r] [fill] [stroke sw dash] [op]
 *   circle  cx cy r [fill] [stroke sw dash] [op]
 *   path    d [fill] [stroke sw dash cap join] [rule] [op]   d: absolute M L H V C Q Z only
 *   text    x y s font size fill [align] [w] [op]            y is the baseline; one line only
 *   image   id x y w h clip [op]                             id: a person; clip: circle | rect
 *   group   items [tf] [clip] [op]                           tf: affine [a b c d e f]
 *   use     ref [tf] [fill] [op]                             ref: a symbol in book.symbols
 *
 * Format 2 adds the last two lines and book.symbols, and nothing else. A book declares the lowest
 * format that draws it, so a book that never clips and never reuses art is still format 1 and its
 * bytes never move - that is how the storybook (#239) could be given clipped arches and reusable
 * paper-cut art without Heirloom's pages changing by a byte.
 *
 *   group.clip    an absolute path `d` in the group's own coordinates, filled nonzero. The clip
 *                 lies inside the group's own transform, as a painter's save / concat / clipPath
 *                 does.
 *   book.symbols  { <id>: { items } } - art authored once and drawn many times. A symbol holds
 *                 shapes only (no text, no photographs), and may use another symbol, but never
 *                 itself: a cycle is refused here rather than hung in a painter.
 *   use.fill      silhouette mode: every item of the symbol is drawn in that one fill and every
 *                 stroke is dropped, all the way down through nested uses. That is how a paper
 *                 shadow or a tint is drawn from art that is already on the page, and it is why a
 *                 symbol's own hairline must never leak into its shadow.
 *
 * A fill is a "#rrggbb" colour or { ref } naming a gradient in book.defs. A gradient is in user
 * space - page coordinates, after any group transform - unless it says `units: 'item'`, which only
 * a radial gradient filling a circle may: then its centre and radius are in units of that circle's
 * radius, from its centre. That is how one glow serves every star on a page without a gradient
 * per star, and it is the one relative convention SVG (objectBoundingBox) and
 * android.graphics.RadialGradient (built per circle) both express exactly.
 *
 * Text has no wrapping in it. The composer breaks lines from the fonts' own advance tables and
 * gives each line a width `w` it was measured to fit; a painter whose font engine measures the
 * line wider shrinks it to `w`, and never grows it. Shaping differs a little between engines, and
 * this is the only place that difference is allowed to show.
 */

/**
 * Bumped when a painter would have to change to draw a book. Painters refuse a newer format.
 *
 * FORMAT is the vocabulary every painter has always had; FORMAT_MAX is the newest one this release
 * draws. A book carries the lowest of them that draws it (formatOf), so an older app is never
 * handed a book it would draw half-right, and a book that uses nothing new keeps the format - and
 * the bytes - it always had.
 */
export const FORMAT = 1;
export const FORMAT_MAX = 2;

/** A4 in PostScript points. Android's PdfDocument takes whole points, so these must stay integers. */
export const PAGE = Object.freeze({ w: 595, h: 842 });

/** Coordinates are rounded so the same tree gives the same bytes on every engine. */
export const r2 = (n) => Math.round(n * 100) / 100;

const ITEM_TYPES = new Set(['rect', 'circle', 'path', 'text', 'image', 'group', 'use']);
/* A symbol is art, drawn anywhere on any page: a line of text would need a role no symbol knows it
 * has, and a photograph belongs to one person, so neither may be hidden inside one. */
const SYMBOL_ITEM_TYPES = new Set(['rect', 'circle', 'path', 'group', 'use']);
const SYMBOL_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
/** How deep one symbol may use another. Deep enough to build a courtyard of lamps, shallow enough
 *  that a painter's recursion stays a few frames. */
const SYMBOL_DEPTH = 4;
const PATH_COMMANDS = /^[MLHVCQZ0-9eE.,\s-]*$/;
const COLOUR = /^#[0-9a-f]{6}$/;

/*
 * Builders. Blocks use these rather than writing objects by hand, so optional keys are left out
 * rather than written as null - the JSON is smaller and a painter never has to tell "absent" from
 * "null" apart.
 */

function paint(o, { fill, stroke, sw, dash, op } = {}) {
  if (fill !== undefined && fill !== null) o.fill = fill;
  if (stroke) { o.stroke = stroke; o.sw = r2(sw ?? 1); }
  if (dash) o.dash = dash.map(r2);
  if (op !== undefined && op !== 1) o.op = r2(op);
  return o;
}

export const rect = (x, y, w, h, style = {}) =>
  paint({ t: 'rect', x: r2(x), y: r2(y), w: r2(w), h: r2(h), ...(style.r ? { r: r2(style.r) } : {}) }, style);

export const circle = (cx, cy, r, style = {}) => paint({ t: 'circle', cx: r2(cx), cy: r2(cy), r: r2(r) }, style);

export function path(d, style = {}) {
  const o = paint({ t: 'path', d }, style);
  if (style.cap) o.cap = style.cap;
  if (style.join) o.join = style.join;
  if (style.rule) o.rule = style.rule;
  return o;
}

export function text(x, y, s, font, size, fill, { align = 'start', w, op } = {}) {
  const o = { t: 'text', x: r2(x), y: r2(y), s, font, size: r2(size), fill };
  if (align !== 'start') o.align = align;
  if (w !== undefined) o.w = r2(w);
  if (op !== undefined && op !== 1) o.op = r2(op);
  return o;
}

export const image = (id, x, y, w, h, clip = 'circle', op) =>
  ({ t: 'image', id, x: r2(x), y: r2(y), w: r2(w), h: r2(h), clip, ...(op !== undefined && op !== 1 ? { op: r2(op) } : {}) });

const affine = (tf) => tf.map((v) => Math.round(v * 10000) / 10000);

export function group(items, { tf, clip, op } = {}) {
  const o = { t: 'group', items };
  if (tf) o.tf = affine(tf);
  if (clip) o.clip = String(clip);
  if (op !== undefined && op !== 1) o.op = r2(op);
  return o;
}

/**
 * Draws a symbol. With `fill` it is silhouette mode - one fill for everything the symbol draws,
 * every stroke dropped - which is how a paper shadow or a tint reuses art already on the page.
 */
export function use(ref, { tf, fill, op } = {}) {
  const o = { t: 'use', ref };
  if (tf) o.tf = affine(tf);
  if (fill !== undefined && fill !== null) o.fill = fill;
  if (op !== undefined && op !== 1) o.op = r2(op);
  return o;
}

/** A path-data builder that only ever writes the commands the format allows, rounded. */
export class PathData {
  constructor() { this.parts = []; }
  M(x, y) { this.parts.push(`M${r2(x)} ${r2(y)}`); return this; }
  L(x, y) { this.parts.push(`L${r2(x)} ${r2(y)}`); return this; }
  Q(x1, y1, x, y) { this.parts.push(`Q${r2(x1)} ${r2(y1)} ${r2(x)} ${r2(y)}`); return this; }
  C(x1, y1, x2, y2, x, y) { this.parts.push(`C${r2(x1)} ${r2(y1)} ${r2(x2)} ${r2(y2)} ${r2(x)} ${r2(y)}`); return this; }
  Z() { this.parts.push('Z'); return this; }
  get empty() { return this.parts.length === 0; }
  toString() { return this.parts.join(''); }
}

/**
 * The lowest format that draws this book: 2 once it clips a group, carries symbols or uses one,
 * and 1 for everything else. The composer writes what this returns, so a feature reaches a book's
 * `format` only when the book actually draws with it.
 */
export function formatOf(book) {
  if (book?.symbols !== undefined) return FORMAT_MAX;
  let newer = false;
  const walk = (items) => (items ?? []).forEach((it) => {
    if (it?.t === 'use' || (it?.t === 'group' && it.clip !== undefined)) newer = true;
    if (it?.t === 'group') walk(it.items);
  });
  (book?.pages ?? []).forEach((page) => walk(page.items));
  return newer ? FORMAT_MAX : FORMAT;
}

/*
 * Validation. The composer runs this on everything it produces in tests, and a painter can run it
 * on anything it is handed; a book that fails it is a composer bug, never something to draw
 * approximately.
 */
export function validateBook(book) {
  const problems = [];
  const declared = book?.format;
  if (declared !== FORMAT && declared !== FORMAT_MAX) problems.push(`format ${declared} is not ${FORMAT} or ${FORMAT_MAX}`);
  else if (declared !== formatOf(book)) problems.push(`format ${declared} is declared, but this book draws as format ${formatOf(book)}`);
  if (!book?.size || book.size.w !== PAGE.w || book.size.h !== PAGE.h) problems.push('page size is not A4');
  if (!Array.isArray(book?.pages) || !book.pages.length) problems.push('no pages');
  const defs = book?.defs ?? {};
  const symbols = book?.symbols ?? {};
  if (book?.symbols !== undefined && (typeof symbols !== 'object' || Array.isArray(symbols))) problems.push('symbols is not a map');
  const checkFill = (f, at) => {
    if (f === undefined) return;
    if (typeof f === 'string') { if (!COLOUR.test(f)) problems.push(`${at}: colour ${f}`); return; }
    if (!f || typeof f.ref !== 'string' || !defs[f.ref]) problems.push(`${at}: unknown gradient ${f?.ref}`);
  };
  const checkTf = (tf, at) => {
    if (tf && (tf.length !== 6 || tf.some((v) => !Number.isFinite(v)))) problems.push(`${at}: transform`);
  };
  /* A clip that is empty, or written in commands a painter does not read, would cut everything
   * away rather than a little: refuse it instead of drawing a blank page. */
  const isClip = (d) => typeof d === 'string' && d.trim() !== '' && PATH_COMMANDS.test(d);
  const walk = (items, where, depth, inSymbol) => items.forEach((it, i) => {
    const at = `${where} item ${i}`;
    if (!(inSymbol ? SYMBOL_ITEM_TYPES : ITEM_TYPES).has(it.t)) { problems.push(`${at}: type ${it.t}`); return; }
    checkFill(it.fill, at);
    if (it.fill?.ref && defs[it.fill.ref]?.units === 'item' && it.t !== 'circle') problems.push(`${at}: an item-relative gradient on a ${it.t}`);
    if (it.stroke !== undefined && !COLOUR.test(it.stroke)) problems.push(`${at}: stroke ${it.stroke}`);
    if (it.op !== undefined && !(it.op >= 0 && it.op <= 1)) problems.push(`${at}: opacity ${it.op}`);
    if (it.t === 'path' && (typeof it.d !== 'string' || !PATH_COMMANDS.test(it.d))) problems.push(`${at}: path data`);
    if (it.t === 'text' && (typeof it.s !== 'string' || !book.fonts?.[it.font])) problems.push(`${at}: text font ${it.font}`);
    if (it.t === 'text' && /\n/.test(it.s)) problems.push(`${at}: text holds a line break`);
    if (it.t === 'image' && !['circle', 'rect'].includes(it.clip)) problems.push(`${at}: clip ${it.clip}`);
    if (it.t === 'group') {
      if (depth > 4) problems.push(`${at}: groups nested too deep`);
      checkTf(it.tf, at);
      if (it.clip !== undefined && !isClip(it.clip)) problems.push(`${at}: clip path data`);
      walk(it.items ?? [], at, depth + 1, inSymbol);
    }
    if (it.t === 'use') {
      checkTf(it.tf, at);
      if (typeof it.ref !== 'string' || !symbols[it.ref]) problems.push(`${at}: unknown symbol ${it.ref}`);
    }
    for (const k of ['x', 'y', 'w', 'h', 'cx', 'cy', 'r', 'size', 'sw']) {
      if (it[k] !== undefined && !Number.isFinite(it[k])) problems.push(`${at}: ${k} is not a number`);
    }
  });
  (book?.pages ?? []).forEach((page, p) => walk(page.items ?? [], `page ${p + 1}`, 0, false));
  for (const [id, s] of Object.entries(symbols)) {
    if (!SYMBOL_ID.test(id)) problems.push(`symbol ${id}: not an id`);
    if (!Array.isArray(s?.items)) { problems.push(`symbol ${id}: no items`); continue; }
    walk(s.items, `symbol ${id}`, 0, true);
  }
  /*
   * A symbol may use another - the art is built from motifs, and a courtyard is lamps - but one
   * that reaches itself would expand forever. Refuse the cycle here, where the composer's tests
   * see it, rather than in a painter that has to hang or guess.
   */
  const usesOf = (items, out = []) => {
    for (const it of items ?? []) {
      if (it?.t === 'use' && typeof it.ref === 'string') out.push(it.ref);
      if (it?.t === 'group') usesOf(it.items, out);
    }
    return out;
  };
  const chase = (id, trail) => {
    if (trail.includes(id)) { problems.push(`symbol ${id}: used through itself (${[...trail, id].join(' -> ')})`); return; }
    if (trail.length >= SYMBOL_DEPTH) { problems.push(`symbol ${id}: symbols nested more than ${SYMBOL_DEPTH} deep`); return; }
    for (const ref of usesOf(symbols[id]?.items)) if (symbols[ref]) chase(ref, [...trail, id]);
  };
  for (const id of Object.keys(symbols)) chase(id, []);
  for (const [id, g] of Object.entries(defs)) {
    if (!['linear', 'radial'].includes(g.type)) problems.push(`gradient ${id}: type ${g.type}`);
    if (g.units !== undefined && g.units !== 'item') problems.push(`gradient ${id}: units ${g.units}`);
    if (g.units === 'item' && g.type !== 'radial') problems.push(`gradient ${id}: only radial gradients can be item-relative`);
    if (!Array.isArray(g.stops) || g.stops.length < 2) problems.push(`gradient ${id}: stops`);
    for (const s of g.stops ?? []) if (!COLOUR.test(s[1])) problems.push(`gradient ${id}: stop colour ${s[1]}`);
  }
  return problems;
}
