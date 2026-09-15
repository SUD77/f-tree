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
 *   group   items [tf] [op]                                  tf: affine [a b c d e f]
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

/** Bumped when a painter would have to change to draw a book. Painters refuse a newer format. */
export const FORMAT = 1;

/** A4 in PostScript points. Android's PdfDocument takes whole points, so these must stay integers. */
export const PAGE = Object.freeze({ w: 595, h: 842 });

/** Coordinates are rounded so the same tree gives the same bytes on every engine. */
export const r2 = (n) => Math.round(n * 100) / 100;

const ITEM_TYPES = new Set(['rect', 'circle', 'path', 'text', 'image', 'group']);
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

export function group(items, { tf, op } = {}) {
  const o = { t: 'group', items };
  if (tf) o.tf = tf.map((v) => Math.round(v * 10000) / 10000);
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

/*
 * Validation. The composer runs this on everything it produces in tests, and a painter can run it
 * on anything it is handed; a book that fails it is a composer bug, never something to draw
 * approximately.
 */
export function validateBook(book) {
  const problems = [];
  const where = (p, i) => `page ${p + 1} item ${i}`;
  if (book?.format !== FORMAT) problems.push(`format ${book?.format} is not ${FORMAT}`);
  if (!book?.size || book.size.w !== PAGE.w || book.size.h !== PAGE.h) problems.push('page size is not A4');
  if (!Array.isArray(book?.pages) || !book.pages.length) problems.push('no pages');
  const defs = book?.defs ?? {};
  const checkFill = (f, at) => {
    if (f === undefined) return;
    if (typeof f === 'string') { if (!COLOUR.test(f)) problems.push(`${at}: colour ${f}`); return; }
    if (!f || typeof f.ref !== 'string' || !defs[f.ref]) problems.push(`${at}: unknown gradient ${f?.ref}`);
  };
  const walk = (items, p, depth) => items.forEach((it, i) => {
    const at = where(p, i);
    if (!ITEM_TYPES.has(it.t)) { problems.push(`${at}: type ${it.t}`); return; }
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
      if (it.tf && (it.tf.length !== 6 || it.tf.some((v) => !Number.isFinite(v)))) problems.push(`${at}: transform`);
      walk(it.items ?? [], p, depth + 1);
    }
    for (const k of ['x', 'y', 'w', 'h', 'cx', 'cy', 'r', 'size', 'sw']) {
      if (it[k] !== undefined && !Number.isFinite(it[k])) problems.push(`${at}: ${k} is not a number`);
    }
  });
  (book?.pages ?? []).forEach((page, p) => walk(page.items ?? [], p, 0));
  for (const [id, g] of Object.entries(defs)) {
    if (!['linear', 'radial'].includes(g.type)) problems.push(`gradient ${id}: type ${g.type}`);
    if (g.units !== undefined && g.units !== 'item') problems.push(`gradient ${id}: units ${g.units}`);
    if (g.units === 'item' && g.type !== 'radial') problems.push(`gradient ${id}: only radial gradients can be item-relative`);
    if (!Array.isArray(g.stops) || g.stops.length < 2) problems.push(`gradient ${id}: stops`);
    for (const s of g.stops ?? []) if (!COLOUR.test(s[1])) problems.push(`gradient ${id}: stop colour ${s[1]}`);
  }
  return problems;
}
