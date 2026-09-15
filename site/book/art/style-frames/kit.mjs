/*
 * The Aangan style frames' drawing kit.
 *
 * Everything here emits only what Book format 2 will carry: absolute M L C Q Z paths, circles,
 * rects, linear and radial gradients, groups with a matrix and an opacity, group clips, and one
 * line of text per item. No filters, masks, blend modes or patterns - if a frame needs one of
 * those to look right, the look is not drawable by the painters and the frame is wrong.
 *
 * Paper-cut edges come from outlines that are sampled, nudged along their normals by a seeded,
 * low-frequency wobble, and smoothed back into cubic curves: the hand of someone cutting with
 * scissors, not the noise of a filter.
 */

export const r2 = (v) => Math.round(v * 100) / 100;

/** mulberry32, seeded from a string, the same generator the composer uses. */
export function rng(seed) {
  let a = 7;
  for (const ch of String(seed)) a = Math.imul(a ^ ch.codePointAt(0), 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------
// Paths

export class D {
  constructor() { this.s = []; }
  M(x, y) { this.s.push(`M${r2(x)} ${r2(y)}`); return this; }
  L(x, y) { this.s.push(`L${r2(x)} ${r2(y)}`); return this; }
  C(a, b, c, d, x, y) { this.s.push(`C${r2(a)} ${r2(b)} ${r2(c)} ${r2(d)} ${r2(x)} ${r2(y)}`); return this; }
  Q(a, b, x, y) { this.s.push(`Q${r2(a)} ${r2(b)} ${r2(x)} ${r2(y)}`); return this; }
  Z() { this.s.push('Z'); return this; }
  toString() { return this.s.join(''); }
}

/** A closed Catmull-Rom spline through points, as cubics. */
export function smooth(pts, { closed = true, tension = 1 } = {}) {
  const n = pts.length;
  const d = new D().M(pts[0][0], pts[0][1]);
  const at = (i) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const k = tension / 6;
    d.C(p1[0] + (p2[0] - p0[0]) * k, p1[1] + (p2[1] - p0[1]) * k,
      p2[0] - (p3[0] - p1[0]) * k, p2[1] - (p3[1] - p1[1]) * k, p2[0], p2[1]);
  }
  if (closed) d.Z();
  return String(d);
}

export function poly(pts, closed = true) {
  const d = new D().M(...pts[0]);
  for (let i = 1; i < pts.length; i++) d.L(...pts[i]);
  if (closed) d.Z();
  return String(d);
}

/** Resample a polyline so no two points are further than `step` apart. */
export function resample(pts, step, closed = true) {
  const out = [];
  const n = pts.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = Math.max(1, Math.ceil(len / step));
    for (let j = 0; j < k; j++) out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}

/** Nudge each point along its normal: the scissors' hand. */
export function wobble(pts, amp, seed, { closed = true, freq = 3 } = {}) {
  const rand = rng(seed);
  const ph1 = rand() * 6.28, ph2 = rand() * 6.28;
  const n = pts.length;
  return pts.map((p, i) => {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    let nx = -(b[1] - a[1]), ny = b[0] - a[0];
    const l = Math.hypot(nx, ny) || 1;
    nx /= l; ny /= l;
    if (!closed && (i === 0 || i === n - 1)) return p;
    const t = i / n;
    const w = amp * (0.55 * Math.sin(t * 6.28 * freq + ph1) + 0.3 * Math.sin(t * 6.28 * freq * 2.7 + ph2) + 0.35 * (rand() - 0.5));
    return [p[0] + nx * w, p[1] + ny * w];
  });
}

export function ellipsePts(cx, cy, rx, ry, n = 32, rot = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.cos(a) * rx, y = Math.sin(a) * ry;
    pts.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]);
  }
  return pts;
}

/** A hand-cut version of any outline. */
export const cutShape = (pts, amp, seed, step = 6) => smooth(wobble(resample(pts, step), amp, seed));

// ---------------------------------------------------------------------------------------------
// The page: an SVG writer restricted to the painters' vocabulary.

export class Page {
  constructor(palette, { w = 595, h = 842, id = 'p' } = {}) {
    this.P = palette; this.w = w; this.h = h; this.id = id;
    this.defs = []; this.body = []; this.stack = [this.body]; this.n = 0;
  }
  col(c) { return c && c.startsWith('#') ? c : c && c.startsWith('url(') ? c : (this.P[c] ?? c); }
  push(s) { this.stack[this.stack.length - 1].push(s); return this; }
  attrs({ fill, stroke, sw, op, rule, dash, cap, join } = {}) {
    let a = ` fill="${fill ? this.col(fill) : 'none'}"`;
    if (stroke) a += ` stroke="${this.col(stroke)}" stroke-width="${r2(sw ?? 1)}"`;
    if (dash) a += ` stroke-dasharray="${dash.map(r2).join(' ')}"`;
    if (cap) a += ` stroke-linecap="${cap}"`;
    if (join) a += ` stroke-linejoin="${join}"`;
    if (rule) a += ` fill-rule="${rule}"`;
    if (op !== undefined && op < 1) a += ` opacity="${r2(op)}"`;
    return a;
  }
  path(d, o = {}) { return this.push(`<path d="${d}"${this.attrs(o)}/>`); }
  circle(cx, cy, r, o = {}) { return this.push(`<circle cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(r)}"${this.attrs(o)}/>`); }
  rect(x, y, w, h, o = {}) { return this.push(`<rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}"${o.r ? ` rx="${r2(o.r)}"` : ''}${this.attrs(o)}/>`); }
  /** A cut-paper layer: its shadow first (the same shape, offset, in ink), then the paper. */
  cut(d, fill, { shadow = 0.18, dx = 1.1, dy = 1.6, op, shadowFill = 'ink', soft = false, rule } = {}) {
    const ev = rule === 'evenodd' ? ' fill-rule="evenodd"' : '';
    if (shadow && soft) {
      // the lightbox shadow: three offsets, fading - a paper layer standing off the one behind it
      for (const [k, a] of [[3, 0.35], [2, 0.3], [1, 0.45]]) this.push(`<path d="${d}"${ev} transform="translate(${r2(dx * k)} ${r2(dy * k)})" fill="${this.col(shadowFill)}" opacity="${r2(shadow * a)}"/>`);
    } else if (shadow) this.push(`<path d="${d}"${ev} transform="translate(${dx} ${dy})" fill="${this.col(shadowFill)}" opacity="${shadow}"/>`);
    return this.path(d, { fill, op, rule });
  }
  text(x, y, s, { font = 'text', size = 12, fill = 'ink', align = 'start', op, ls } = {}) {
    const anchor = align === 'middle' ? ' text-anchor="middle"' : align === 'end' ? ' text-anchor="end"' : '';
    const esc = String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    return this.push(`<text x="${r2(x)}" y="${r2(y)}" font-family="book_${font}" font-size="${r2(size)}" fill="${this.col(fill)}"${anchor}${ls ? ` letter-spacing="${ls}"` : ''}${op !== undefined ? ` opacity="${op}"` : ''}>${esc}</text>`);
  }
  lin(x1, y1, x2, y2, stops) {
    const id = `${this.id}g${this.n++}`;
    this.defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${r2(x1)}" y1="${r2(y1)}" x2="${r2(x2)}" y2="${r2(y2)}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${this.col(c)}" stop-opacity="${a}"/>`).join('')}</linearGradient>`);
    return `url(#${id})`;
  }
  rad(cx, cy, r, stops) {
    const id = `${this.id}g${this.n++}`;
    this.defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(r)}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${this.col(c)}" stop-opacity="${a}"/>`).join('')}</radialGradient>`);
    return `url(#${id})`;
  }
  /** A group: optional affine matrix, opacity and a clip path in the group's own coordinates. */
  group(fn, { tf, op, clip } = {}) {
    let open = '<g';
    if (tf) open += ` transform="matrix(${tf.map(r2).join(' ')})"`;
    if (op !== undefined) open += ` opacity="${op}"`;
    if (clip) {
      const id = `${this.id}c${this.n++}`;
      this.defs.push(`<clipPath id="${id}" clipPathUnits="userSpaceOnUse"><path d="${clip}"/></clipPath>`);
      open += ` clip-path="url(#${id})"`;
    }
    const items = [];
    this.stack.push(items);
    fn(this);
    this.stack.pop();
    return this.push(`${open}>${items.join('')}</g>`);
  }
  /** Book format 2's symbols: drawn once into defs, placed any number of times with `use`. */
  symbol(id, fn) {
    this.syms ??= new Set();
    if (this.syms.has(id)) return this;
    this.syms.add(id);
    const items = [];
    this.stack.push(items);
    fn(this);
    this.stack.pop();
    this.defs.push(`<g id="${this.id}-${id}">${items.join('')}</g>`);
    return this;
  }
  use(id, tf, { op } = {}) {
    return this.push(`<use href="#${this.id}-${id}" transform="matrix(${tf.map(r2).join(' ')})"${op !== undefined ? ` opacity="${op}"` : ''}/>`);
  }
  image(href, x, y, w, h) {
    return this.push(`<image href="${href}" x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}" preserveAspectRatio="xMidYMid slice"/>`);
  }
  svg() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${this.w} ${this.h}" width="${this.w}" height="${this.h}"><defs>${this.defs.join('')}</defs>${this.body.join('')}</svg>`;
  }
}

export const T = (a, b, c, d, e, f) => [a, b, c, d, e, f];
export const translate = (x, y) => [1, 0, 0, 1, x, y];
export const scaleAt = (s, x, y) => [s, 0, 0, s, x, y];
export const rotateAt = (deg, x, y, s = 1) => {
  const a = (deg * Math.PI) / 180, c = Math.cos(a) * s, sn = Math.sin(a) * s;
  return [c, sn, -sn, c, x, y];
};
