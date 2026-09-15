/*
 * The Aangan motif library, as used by the style frames. Every function draws onto a Page (kit.mjs)
 * with palette tokens, never raw colours, so the same art recolours for another template.
 */

import { D, smooth, poly, resample, wobble, ellipsePts, cutShape, rng, rotateAt, r2 } from './kit.mjs';

export const PALETTE = {
  paper: '#F6ECDA', paperDeep: '#EAD7B5', card: '#FFF8EC',
  ink: '#2A1A33', inkSoft: '#5E4A66',
  night: '#1C1638', deep: '#0D0A1F', glow: '#3A2352', dusk: '#7A3E63',
  gold: '#F2B84B', flame: '#FFE7A6', brass: '#B9822A',
  marigold: '#F2A71B', saffron: '#E8762B', sindoor: '#C23B2E', rani: '#D6336C',
  peacock: '#0F7B7A', indigo: '#3B4A8C', leaf: '#5A8A3C', leafDeep: '#2F5A2A',
  stone: '#D9A77A', clay: '#B5562A', skin: '#B97A52', silver: '#D9D2CA', sky: '#F3DDB8', wash: '#8DB0D8', haze: '#5A3462',
};

// ---------------------------------------------------------------------------------------------
// Light

/** Warm light without a soft mask: stacked translucent discs, which a PDF draws with plain alpha. */
export function glowDiscs(p, x, y, r, { colour = 'gold', strength = 1 } = {}) {
  for (const [k, a] of [[1, 0.05], [0.72, 0.07], [0.48, 0.1], [0.3, 0.16]]) p.circle(x, y, r * k, { fill: colour, op: a * strength });
}

function drawDiya(p, s, { unknown }) {
  const x = 0, y = 0;
  const fx = x + 0.5 * s, fy = y - 0.07 * s;
  glowDiscs(p, fx, fy - 0.25 * s, 1.25 * s);
  const bowl = new D().M(x - 0.5 * s, y)
    .C(x - 0.45 * s, y + 0.3 * s, x - 0.15 * s, y + 0.36 * s, x, y + 0.36 * s)
    .C(x + 0.22 * s, y + 0.36 * s, x + 0.42 * s, y + 0.2 * s, x + 0.58 * s, y - 0.08 * s)
    .Q(x + 0.3 * s, y + 0.07 * s, x, y + 0.075 * s)
    .Q(x - 0.3 * s, y + 0.065 * s, x - 0.5 * s, y).Z();
  if (unknown) {
    p.path(String(bowl), { fill: 'clay', op: 0.4 });
    p.path(String(bowl), { stroke: 'brass', sw: s * 0.07, dash: [s * 0.1, s * 0.075] });
  } else {
    p.cut(String(bowl), 'clay', { shadow: 0.22, dx: s * 0.03, dy: s * 0.05 });
    const band = new D().M(x - 0.42 * s, y + 0.1 * s).Q(x, y + 0.26 * s, x + 0.46 * s, y + 0.06 * s)
      .Q(x, y + 0.2 * s, x - 0.42 * s, y + 0.1 * s).Z();
    p.path(String(band), { fill: 'saffron' });
    for (let i = -1; i <= 1; i++) p.circle(x + i * 0.16 * s, y + 0.2 * s - Math.abs(i) * 0.02 * s, s * 0.028, { fill: 'flame' });
    p.path(String(new D().M(x - 0.44 * s, y + 0.02 * s).Q(x, y + 0.1 * s, x + 0.5 * s, y - 0.05 * s)), { stroke: 'flame', sw: s * 0.025, op: 0.5 });
  }
  const h = 0.62 * s, w = 0.15 * s;
  const outer = new D().M(fx, fy).C(fx + w, fy - h * 0.15, fx + w * 0.85, fy - h * 0.58, fx + w * 0.1, fy - h)
    .C(fx - w * 0.75, fy - h * 0.6, fx - w, fy - h * 0.15, fx, fy).Z();
  p.path(String(outer), { fill: p.lin(fx, fy, fx, fy - h, [[0, 'saffron'], [0.35, 'gold'], [1, 'flame']]) });
  const core = new D().M(fx, fy - h * 0.05).C(fx + w * 0.45, fy - h * 0.2, fx + w * 0.35, fy - h * 0.45, fx + w * 0.05, fy - h * 0.62)
    .C(fx - w * 0.3, fy - h * 0.45, fx - w * 0.45, fy - h * 0.2, fx, fy - h * 0.05).Z();
  p.path(String(core), { fill: 'card' });
}

/** A diya, lit. (x, y) is the middle of its rim, s its width. `unknown` cuts the bowl as the
 *  dashed brass outline: the app's own mark for a name nobody recorded - still lit, a lamp kept. */
export function diya(p, x, y, s, { unknown = false } = {}) {
  const id = unknown ? 'diya-u' : 'diya';
  p.symbol(id, (g) => drawDiya(g, 10, { unknown }));
  p.use(id, [s / 10, 0, 0, s / 10, x, y]);
}

/** A diya afloat on a leaf boat (dona), with its reflection. */
export function floatingDiya(p, x, y, s, { unknown = false } = {}) {
  const id = unknown ? 'fdiya-u' : 'fdiya';
  p.symbol(id, (g) => {
    const S = 10;
    // the reflection, broken by ripples
    for (let i = 0; i < 4; i++) g.path(String(new D().M(S * 0.5 - S * (0.16 - i * 0.03), S * (0.5 + i * 0.42)).L(S * 0.5 + S * (0.16 - i * 0.03), S * (0.5 + i * 0.42))
      .L(S * 0.5 + S * (0.12 - i * 0.025), S * (0.72 + i * 0.42)).L(S * 0.5 - S * (0.12 - i * 0.025), S * (0.72 + i * 0.42)).Z()), { fill: 'gold', op: 0.34 - i * 0.07 });
    g.path(String(new D().M(-S * 0.85, S * 0.12).Q(0, S * 0.62, S * 0.95, S * 0.02).Q(S * 0.1, S * 0.3, -S * 0.85, S * 0.12).Z()), { fill: 'leafDeep' });
    g.path(String(new D().M(-S * 0.7, S * 0.14).Q(0, S * 0.44, S * 0.8, S * 0.06)), { stroke: 'leaf', sw: S * 0.05 });
    drawDiya(g, S * 0.8, { unknown });
  });
  p.use(id, [s / 10, 0, 0, s / 10, x, y]);
}

/** Someone seen from behind, sitting on a step: generic figures in a scene, never a particular
 *  relative. (x, base) is where they sit; s their height. */
export function sittingBack(p, x, base, s, kind, { fill = 'deep', rim = 'gold', drape = 'rani', flip = false } = {}) {
  p.group((g) => {
    const k = kind === 'child' ? 0.78 : 1;
    const S = s;
    const torso = new D().M(-0.34 * S, 0).C(-0.37 * S, -0.22 * S, -0.31 * S, -0.5 * S, -0.21 * S, -0.58 * S)
      .C(-0.15 * S, -0.62 * S, -0.08 * S, -0.63 * S, -0.055 * S, -0.68 * S).L(0.055 * S, -0.68 * S)
      .C(0.08 * S, -0.63 * S, 0.15 * S, -0.62 * S, 0.21 * S, -0.58 * S).C(0.31 * S, -0.5 * S, 0.37 * S, -0.22 * S, 0.34 * S, 0).Z();
    g.path(String(torso), { fill });
    g.path(String(new D().M(0.21 * S, -0.58 * S).C(0.31 * S, -0.5 * S, 0.37 * S, -0.22 * S, 0.34 * S, 0)), { stroke: rim, sw: 0.9, op: 0.75 });
    const hx = 0, hy = -0.79 * S, hrx = 0.1 * S * (kind === 'child' ? 1.12 : 1), hry = 0.12 * S * (kind === 'child' ? 1.08 : 1);
    g.path(smooth(ellipsePts(hx, hy, hrx, hry, 18)), { fill });
    g.path(String(new D().M(hx + hrx * 0.2, hy - hry).C(hx + hrx * 1.3, hy - hry * 0.8, hx + hrx * 1.3, hy + hry * 0.6, hx + hrx * 0.5, hy + hry * 0.95)), { stroke: rim, sw: 0.8, op: 0.7 });
    if (kind === 'elder') {
      const d = new D().M(-hrx * 1.2, hy + hry * 0.1).C(-hrx * 1.35, hy - hry * 1.45, hrx * 1.35, hy - hry * 1.45, hrx * 1.2, hy + hry * 0.1)
        .C(0.2 * S, -0.62 * S, 0.33 * S, -0.4 * S, 0.3 * S, 0).L(-0.22 * S, 0)
        .C(-0.26 * S, -0.3 * S, -0.22 * S, -0.58 * S, -hrx * 1.2, hy + hry * 0.1).Z();
      g.path(String(d), { fill: drape, op: 0.55 });
      g.path(String(d), { fill: fill, op: 0.45 });
      g.path(String(new D().M(-hrx * 1.2, hy + hry * 0.1).C(-0.22 * S, -0.58 * S, -0.26 * S, -0.3 * S, -0.22 * S, 0)), { stroke: drape, sw: S * 0.045 });
      g.path(String(new D().M(-hrx * 1.2, hy + hry * 0.1).C(-0.22 * S, -0.58 * S, -0.26 * S, -0.3 * S, -0.22 * S, 0)), { stroke: 'gold', sw: S * 0.014 });
      g.path(String(new D().M(-hrx * 1.2, hy + hry * 0.1).C(-hrx * 1.35, hy - hry * 1.45, hrx * 1.35, hy - hry * 1.45, hrx * 1.2, hy + hry * 0.1)), { stroke: 'gold', sw: S * 0.014, op: 0.8 });
    } else if (kind === 'woman') {
      g.circle(hx, hy + hry * 0.62, hrx * 0.46, { fill });
      g.path(String(new D().M(0.2 * S, -0.58 * S).C(0.05 * S, -0.45 * S, -0.2 * S, -0.25 * S, -0.33 * S, 0).L(-0.12 * S, 0)
        .C(0, -0.25 * S, 0.18 * S, -0.42 * S, 0.3 * S, -0.5 * S).Z()), { fill: drape });
      g.path(String(new D().M(0.2 * S, -0.58 * S).C(0.05 * S, -0.45 * S, -0.2 * S, -0.25 * S, -0.33 * S, 0)), { stroke: 'gold', sw: S * 0.018 });
    } else if (kind === 'child') {
      for (const sd of [-1, 1]) g.circle(sd * hrx * 1.02, hy + hry * 0.25, hrx * 0.36, { fill });
      g.path(String(new D().M(-0.3 * S, -0.1 * S).Q(0, -0.16 * S, 0.3 * S, -0.1 * S)), { stroke: drape, sw: S * 0.05 });
    } else {
      g.path(String(new D().M(-0.22 * S, -0.56 * S).Q(0, -0.6 * S, 0.22 * S, -0.56 * S)), { stroke: drape, sw: S * 0.04, op: 0.9 });
    }
  }, { tf: [flip ? -1 : 1, 0, 0, 1, x, base] });
}

/** An akash kandil: the star-cut paper lantern, lit from inside, with its paper tails. */
export function kandil(p, x, top, drop, s, { body = 'rani', trim = 'marigold', cord = 'gold', seed = 'k' } = {}) {
  const y = top + drop;
  p.path(String(new D().M(x, top).L(x, y - s * 0.55)), { stroke: cord, sw: 0.8 });
  p.circle(x, y, s * 1.6, { fill: p.rad(x, y, s * 1.6, [[0, 'gold', 0.45], [0.5, 'saffron', 0.12], [1, 'saffron', 0]]) });
  // tails first, so the body sits over their roots
  const rand = rng(seed);
  const tails = [trim, body, 'saffron', body, trim];
  tails.forEach((c, i) => {
    const tx = x + (i - 2) * s * 0.16, len = s * (1.1 + rand() * 0.5 + (i === 2 ? 0.35 : 0));
    const pts = [];
    for (let k = 0; k <= 8; k++) pts.push([tx + Math.sin(k * 0.9 + i) * s * 0.05, y + s * 0.42 + (len * k) / 8]);
    p.path(smooth(pts, { closed: false }), { stroke: c, sw: s * 0.07, cap: 'round' });
  });
  // the star body: an eight-pointed cut, two squares turned against each other
  const star = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 - Math.PI / 2, rr = i % 2 === 0 ? s * 0.62 : s * 0.42;
    star.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * 1.05]);
  }
  p.cut(poly(star), body, { shadow: 0.25 });
  // light through the paper: an inner cut star
  const inner = star.map(([px, py]) => [x + (px - x) * 0.55, y + (py - y) * 0.55]);
  p.path(poly(inner), { fill: 'flame', op: 0.92 });
  p.circle(x, y, s * 0.12, { fill: trim });
  p.path(poly([[x - s * 0.14, y - s * 0.6], [x + s * 0.14, y - s * 0.6], [x + s * 0.08, y - s * 0.72], [x - s * 0.08, y - s * 0.72]]), { fill: trim });
}

// ---------------------------------------------------------------------------------------------
// Flora

function drawMarigold(p, x, y, R, seed, { a, b, c, shadow }) {
  const rand = rng(seed);
  const ring = (rr, lobes, amp) => {
    const ph = rand() * 6.28, pts = [];
    const n = lobes * 3;
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      const rad = rr * (1 + amp * Math.sin(lobes * t + ph) + 0.03 * (rand() - 0.5));
      pts.push([x + Math.cos(t) * rad, y + Math.sin(t) * rad]);
    }
    return smooth(pts);
  };
  p.cut(ring(R, 11, 0.09), a, { shadow, dx: R * 0.08, dy: R * 0.12 });
  p.path(ring(R * 0.7, 9, 0.1), { fill: b });
  p.path(ring(R * 0.4, 7, 0.12), { fill: c });
  p.circle(x + R * 0.05, y - R * 0.05, R * 0.12, { fill: a, op: 0.8 });
}

/** A marigold: one of three cut variants per colouring, drawn once and placed with `use`. */
export function marigold(p, x, y, R, seed, { a = 'saffron', b = 'marigold', c = 'gold', shadow = 0.18 } = {}) {
  const v = [...String(seed)].reduce((h, ch) => (h * 31 + ch.codePointAt(0)) >>> 0, 3) % 3;
  const id = `mg-${a}-${b}-${c}-${v}`;
  p.symbol(id, (g) => drawMarigold(g, 0, 0, 10, `mg${v}`, { a, b, c, shadow }));
  p.use(id, [R / 10, 0, 0, R / 10, x, y]);
}

/** A mango leaf hanging from (x, y) at an angle (degrees, 0 = straight down). */
export function mangoLeaf(p, x, y, len, angle, fill = 'leaf', { rib = true, shadow = 0.16 } = {}) {
  const id = `leaf-${fill}-${rib ? 1 : 0}-${shadow}`;
  p.symbol(id, (g) => {
    const L = 10;
    const d = new D().M(0, 0).C(L * 0.3, L * 0.18, L * 0.24, L * 0.72, 0, L).C(-L * 0.24, L * 0.72, -L * 0.3, L * 0.18, 0, 0).Z();
    g.cut(String(d), fill, { shadow, dx: 0.35, dy: 0.6 });
    if (rib) g.path(String(new D().M(0, L * 0.06).Q(L * 0.03, L * 0.5, 0, L * 0.9)), { stroke: 'paper', sw: 0.3, op: 0.55 });
  });
  p.use(id, rotateAt(angle, x, y, len / 10));
}

/** A peepal leaf, pointing up: the heart with a drip tip. */
export function peepal(p, x, y, s, angle = 0, fill = 'leaf') {
  p.group((g) => {
    const d = new D().M(0, 0).C(s * 0.55, -s * 0.05, s * 0.62, -s * 0.62, s * 0.18, -s * 0.86)
      .Q(s * 0.05, -s * 0.94, 0, -s * 1.25).Q(-s * 0.05, -s * 0.94, -s * 0.18, -s * 0.86)
      .C(-s * 0.62, -s * 0.62, -s * 0.55, -s * 0.05, 0, 0).Z();
    g.cut(String(d), fill, { shadow: 0.16 });
    g.path(String(new D().M(0, -s * 0.02).L(0, -s * 1.1)), { stroke: 'paper', sw: 0.6, op: 0.5 });
  }, { tf: rotateAt(angle, x, y) });
}

/** A lotus, open, sitting on (x, y). */
export function lotus(p, x, y, s, { a = 'rani', b = 'marigold', leaf = 'leaf' } = {}) {
  const petal = (ang, len, wd, fill) => {
    p.group((g) => {
      const d = new D().M(0, 0).C(wd, -len * 0.25, wd * 0.7, -len * 0.8, 0, -len).C(-wd * 0.7, -len * 0.8, -wd, -len * 0.25, 0, 0).Z();
      g.cut(String(d), fill, { shadow: 0.14 });
    }, { tf: rotateAt(ang, x, y) });
  };
  p.cut(String(new D().M(x - s * 0.9, y).Q(x, y + s * 0.34, x + s * 0.9, y).Q(x, y + s * 0.12, x - s * 0.9, y).Z()), leaf);
  for (const [ang, fill] of [[-70, a], [70, a], [-38, b], [38, b], [0, a]]) petal(ang, s * (ang === 0 ? 0.95 : 0.78), s * 0.24, fill);
}

/** A string of marigold beads along a quadratic swag from (x1, y1) to (x2, y2), sagging by `sag`. */
export function mala(p, x1, y1, x2, y2, sag, bead, seed, { colours = ['saffron', 'marigold'], leaves = 6, tassel = false } = {}) {
  const cx = (x1 + x2) / 2, cy = Math.max(y1, y2) + sag;
  const at = (t) => [(1 - t) ** 2 * x1 + 2 * (1 - t) * t * cx + t * t * x2, (1 - t) ** 2 * y1 + 2 * (1 - t) * t * cy + t * t * y2];
  let len = 0, prev = at(0);
  for (let i = 1; i <= 60; i++) { const q = at(i / 60); len += Math.hypot(q[0] - prev[0], q[1] - prev[1]); prev = q; }
  const n = Math.max(2, Math.round(len / (bead * 1.55)));
  const rand = rng(seed);
  for (let i = 0; i <= n; i++) {
    const [bx, by] = at(i / n);
    if (leaves && i % Math.max(2, Math.round(n / leaves)) === 1) mangoLeaf(p, bx, by, bead * 2.6, (rand() - 0.5) * 50, rand() > 0.5 ? 'leaf' : 'leafDeep', { rib: false, shadow: 0.12 });
  }
  for (let i = 0; i <= n; i++) {
    const [bx, by] = at(i / n);
    marigold(p, bx, by, bead, `${seed}${i}`, { a: colours[i % colours.length], b: i % 2 ? 'gold' : 'marigold', c: 'gold', shadow: 0.15 });
  }
  if (tassel) for (const [tx, ty] of [at(0), at(1)]) {
    for (let k = 1; k <= 3; k++) marigold(p, tx, ty + k * bead * 1.5, bead * (1 - k * 0.12), `${seed}t${tx}${k}`, { shadow: 0.12 });
  }
}

/** A toran: a straight cord across the top of a doorway (or a page) hung with mango leaves and
 *  marigolds - the thing every Indian door wears for a festival. */
export function toran(p, x1, x2, y, { leaf = 26, seed = 'toran', swags = 0 } = {}) {
  const rand = rng(seed);
  p.path(String(new D().M(x1, y).L(x2, y)), { stroke: 'clay', sw: 1.2 });
  const n = Math.round((x2 - x1) / (leaf * 0.62));
  for (let i = 0; i <= n; i++) {
    const x = x1 + ((x2 - x1) * i) / n;
    mangoLeaf(p, x, y, leaf * (0.86 + 0.28 * ((i % 3) / 2)), (rand() - 0.5) * 14, i % 2 ? 'leafDeep' : 'leaf');
  }
  if (swags) {
    const w = (x2 - x1) / swags;
    for (let i = 0; i < swags; i++) mala(p, x1 + i * w, y + 2, x1 + (i + 1) * w, y + 2, leaf * 0.9, leaf * 0.16, `${seed}s${i}`, { leaves: 0 });
  }
  for (let i = 0; i <= n; i += 2) {
    const x = x1 + ((x2 - x1) * i) / n;
    marigold(p, x, y + 1, leaf * 0.24, `${seed}m${i}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Pattern

/** A rangoli: a lotus heart, rings of petals, a ring of kolam dots. Seeded by the family. */
export function rangoli(p, cx, cy, R, seed, { colours = ['rani', 'marigold', 'peacock', 'saffron'], ground = 'card' } = {}) {
  const rand = rng(seed);
  p.cut(cutShape(ellipsePts(cx, cy, R * 1.02, R * 1.02, 72), R * 0.01, `${seed}g`), ground, { shadow: 0.1 });
  const ringPetals = (rr, count, len, wd, fill, offset = 0) => {
    for (let i = 0; i < count; i++) {
      const a = ((i + offset) / count) * Math.PI * 2;
      const ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux;
      const P = (al, ac) => [cx + ux * (rr + al) + vx * ac, cy + uy * (rr + al) + vy * ac];
      const d = new D().M(...P(0, 0)).C(...P(len * 0.3, wd), ...P(len * 0.75, wd), ...P(len, 0)).C(...P(len * 0.75, -wd), ...P(len * 0.3, -wd), ...P(0, 0)).Z();
      p.path(String(d), { fill: typeof fill === 'function' ? fill(i) : fill });
    }
  };
  ringPetals(R * 0.7, 24, R * 0.3, R * 0.07, (i) => (i % 2 ? colours[0] : colours[1]));
  ringPetals(R * 0.72, 24, R * 0.18, R * 0.035, 'card', 0.5);
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    p.circle(cx + Math.cos(a) * R * 0.62, cy + Math.sin(a) * R * 0.62, R * 0.018, { fill: colours[2] });
  }
  ringPetals(R * 0.3, 12, R * 0.28, R * 0.1, (i) => (i % 2 ? colours[2] : colours[3]));
  ringPetals(R * 0.12, 8, R * 0.2, R * 0.075, colours[0], 0.5);
  p.circle(cx, cy, R * 0.13, { fill: 'gold' });
  p.circle(cx, cy, R * 0.06, { fill: colours[3] });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    p.circle(cx + Math.cos(a) * R * 0.94, cy + Math.sin(a) * R * 0.94, R * 0.025, { fill: colours[(i + Math.floor(rand() * 2)) % 4] });
  }
}

/** A paisley (kairi), pointing `angle` degrees. */
export function paisley(p, x, y, s, angle, fill = 'rani', inner = 'marigold') {
  p.group((g) => {
    const d = new D().M(0, s * 0.5).C(s * 0.55, s * 0.5, s * 0.6, -s * 0.2, s * 0.2, -s * 0.45)
      .C(s * 0.05, -s * 0.55, -s * 0.05, -s * 0.8, -s * 0.2, -s * 0.95)
      .C(-s * 0.3, -s * 0.6, -s * 0.55, -s * 0.35, -s * 0.5, 0).C(-s * 0.45, s * 0.3, -s * 0.25, s * 0.5, 0, s * 0.5).Z();
    g.cut(String(d), fill, { shadow: 0.15 });
    g.circle(0, s * 0.1, s * 0.22, { fill: inner });
    g.circle(0, s * 0.1, s * 0.09, { fill: 'card' });
  }, { tf: rotateAt(angle, x, y) });
}

// ---------------------------------------------------------------------------------------------
// Frames

/** The opening of an arch, as dense points: up the left jamb, over, down the right. */
export function archPts(x, y, w, h, { kind = 'cusped', lobes = 7, depth = 0.05 } = {}) {
  const s = kind === 'round' ? w / 2 : w * 0.62;
  const half = [];
  const P0 = [x, y + s], P3 = [x + w / 2, y];
  const P1 = kind === 'round' ? [x, y + s * 0.45] : [x, y + s * 0.4];
  const P2 = kind === 'round' ? [x + w * 0.225, y] : [x + w * 0.19, y + s * 0.07];
  const N = 44;
  for (let i = 0; i <= N; i++) {
    const t = i / N, u = 1 - t;
    half.push([u * u * u * P0[0] + 3 * u * u * t * P1[0] + 3 * u * t * t * P2[0] + t * t * t * P3[0],
      u * u * u * P0[1] + 3 * u * u * t * P1[1] + 3 * u * t * t * P2[1] + t * t * t * P3[1]]);
  }
  let curve = [...half, ...half.slice(0, -1).reverse().map(([px, py]) => [2 * x + w - px, py])];
  if (kind === 'cusped') {
    const cx = x + w / 2, cy = y + s;
    const n = curve.length;
    curve = curve.map(([px, py], i) => {
      const t = i / (n - 1);
      const a = curve[Math.max(0, i - 1)], b = curve[Math.min(n - 1, i + 1)];
      let nx = -(b[1] - a[1]), ny = b[0] - a[0];
      const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
      if ((px - cx) * nx + (py - cy) * ny < 0) { nx = -nx; ny = -ny; }
      const off = w * depth * Math.pow(Math.abs(Math.sin(Math.PI * lobes * t)), 0.6);
      return [px + nx * off, py + ny * off];
    });
  }
  return [[x, y + h], ...curve, [x + w, y + h]];
}

export const archPath = (x, y, w, h, o) => poly(archPts(x, y, w, h, o));

/** A carved jharokha frame around an arch opening; `inner` draws what is seen through it. */
export function archFrame(p, x, y, w, h, { band = 14, kind = 'cusped', stone = 'stone', trim = 'gold', inner, eave = true, sill = true, seed = 'arch' } = {}) {
  const opening = archPath(x, y, w, h, { kind });
  const outer = poly(archPts(x - band, y - band * 1.25, w + band * 2, h + band * 1.25, { kind: 'pointed' }));
  if (inner) p.group(inner, { clip: opening });
  p.cut(`${outer}${opening}`, stone, { shadow: 0.22, dx: 1.6, dy: 2.2, soft: true, rule: 'evenodd' });
  // the carving: a second, inner band in a deeper tone, and the gold line over the clip edge
  const mid = poly(archPts(x - band * 0.45, y - band * 0.55, w + band * 0.9, h + band * 0.55, { kind: 'pointed' }));
  p.path(`${mid}${opening}`, { fill: 'clay', rule: 'evenodd', op: 0.28 });
  p.path(opening, { stroke: trim, sw: 1.4 });
  // a lotus finial at the apex
  lotusBud(p, x + w / 2, y - band * 1.25, band * 0.9);
  if (eave) {
    const ey = y - band * 1.25 - band * 0.2;
    const ew = w + band * 3.2;
    p.cut(cutShape([[x + w / 2 - ew / 2, ey - band * 0.5], [x + w / 2 + ew / 2, ey - band * 0.5], [x + w / 2 + ew / 2 - band * 0.6, ey + band * 0.15], [x + w / 2 - ew / 2 + band * 0.6, ey + band * 0.15]], 0.6, `${seed}e`), 'clay', { shadow: 0.25 });
  }
  if (sill) {
    const sy = y + h;
    p.cut(cutShape([[x - band * 1.6, sy], [x + w + band * 1.6, sy], [x + w + band * 1.3, sy + band * 0.85], [x - band * 1.3, sy + band * 0.85]], 0.5, `${seed}s`), 'clay', { shadow: 0.25 });
    // brackets under the sill
    for (const bx of [x + band * 0.2, x + w - band * 0.2]) {
      p.cut(String(new D().M(bx - band * 0.5, sy + band * 0.85).L(bx + band * 0.5, sy + band * 0.85).Q(bx + band * 0.3, sy + band * 2.4, bx, sy + band * 2.6).Q(bx - band * 0.3, sy + band * 2.4, bx - band * 0.5, sy + band * 0.85).Z()), 'stone', { shadow: 0.2 });
    }
  }
}

export function lotusBud(p, x, y, s) {
  p.cut(String(new D().M(x, y - s * 1.1).C(x + s * 0.55, y - s * 0.6, x + s * 0.5, y, x, y).C(x - s * 0.5, y, x - s * 0.55, y - s * 0.6, x, y - s * 1.1).Z()), 'marigold', { shadow: 0.2 });
  p.path(String(new D().M(x, y - s * 0.95).C(x + s * 0.2, y - s * 0.6, x + s * 0.18, y - s * 0.15, x, y - s * 0.05).C(x - s * 0.18, y - s * 0.15, x - s * 0.2, y - s * 0.6, x, y - s * 0.95).Z()), { fill: 'saffron' });
}

/** A round medallion: its content clipped to the circle, a gold line over the edge, a ring of
 *  small petals. `departed` hangs a marigold mala along its foot. */
export function medallion(p, cx, cy, rr, { inner, petals = true, departed = false, unknown = false, seed = 'med', ground = 'card' } = {}) {
  if (rr < 14) { petals = false; departed = false; }
  if (petals && !unknown) {
    const count = Math.max(16, Math.round((2 * Math.PI * rr) / 7));
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux;
      const P = (al, ac) => [cx + ux * (rr + al) + vx * ac, cy + uy * (rr + al) + vy * ac];
      const len = rr * 0.16, wd = rr * 0.06;
      p.path(String(new D().M(...P(0, 0)).C(...P(len * 0.3, wd), ...P(len * 0.8, wd), ...P(len, 0)).C(...P(len * 0.8, -wd), ...P(len * 0.3, -wd), ...P(0, 0)).Z()), { fill: i % 2 ? 'saffron' : 'marigold' });
    }
  }
  p.circle(cx + 1.2, cy + 1.8, rr, { fill: 'ink', op: 0.18 });
  p.circle(cx, cy, rr, { fill: ground });
  const clip = String(new D().M(cx - rr, cy).C(cx - rr, cy - rr * 0.552, cx - rr * 0.552, cy - rr, cx, cy - rr)
    .C(cx + rr * 0.552, cy - rr, cx + rr, cy - rr * 0.552, cx + rr, cy).C(cx + rr, cy + rr * 0.552, cx + rr * 0.552, cy + rr, cx, cy + rr)
    .C(cx - rr * 0.552, cy + rr, cx - rr, cy + rr * 0.552, cx - rr, cy).Z());
  if (inner) p.group(inner, { clip });
  if (unknown) p.circle(cx, cy, rr, { stroke: 'brass', sw: Math.max(1, rr * 0.035), dash: [rr * 0.12, rr * 0.09] });
  else p.circle(cx, cy, rr, { stroke: 'gold', sw: Math.max(1, rr * 0.04) });
  if (departed) mala(p, cx - rr * 0.98, cy + rr * 0.3, cx + rr * 0.98, cy + rr * 0.3, rr * 0.86, Math.max(2.2, rr * 0.075), `${seed}mala`, { leaves: 0 });
}

// ---------------------------------------------------------------------------------------------
// People: faceless paper-cut busts. Nobody's face is invented; what differs is hair, drape and
// age - enough to tell a grandmother from a grandson at a glance.

export function bust(p, cx, by, s, kind, { cloth = 'indigo', drape = 'marigold', hair = 'ink', specs = false, bg } = {}) {
  const child = kind === 'girl' || kind === 'boy';
  const hy = by - s * (child ? 0.62 : 0.66), hrx = s * (child ? 0.19 : 0.165), hry = s * (child ? 0.205 : 0.2);
  const female = kind === 'woman' || kind === 'girl';
  const sw = s * (child ? 0.36 : 0.46);
  if (bg) p.circle(cx, by - s * 0.5, s * 0.55, { fill: bg });
  // long hair falls behind the shoulders
  if (kind === 'woman' && !specs) p.cut(smooth([[cx - hrx * 1.12, hy - hry * 0.2], [cx - hrx * 1.3, hy + hry * 1.6], [cx - hrx * 0.9, hy + hry * 2.3], [cx + hrx * 0.9, hy + hry * 2.3], [cx + hrx * 1.3, hy + hry * 1.6], [cx + hrx * 1.12, hy - hry * 0.2]]), hair, { shadow: 0 });
  if (kind === 'girl') for (const sd of [-1, 1]) {
    p.circle(cx + sd * hrx * 1.25, hy + hry * 0.55, hrx * 0.42, { fill: hair });
    p.circle(cx + sd * hrx * 1.08, hy + hry * 0.22, hrx * 0.18, { fill: 'rani' });
  }
  // shoulders and neck
  const top = by - s * 0.4;
  const shoulders = new D().M(cx - sw, by).C(cx - sw, by - s * 0.2, cx - sw * 0.76, top + s * 0.03, cx - s * 0.12, top)
    .L(cx + s * 0.12, top).C(cx + sw * 0.76, top + s * 0.03, cx + sw, by - s * 0.2, cx + sw, by).Z();
  p.rect(cx - s * 0.06, hy + hry * 0.6, s * 0.12, top - hy, { fill: 'skin' });
  p.cut(String(shoulders), cloth, { shadow: 0.2 });
  // a block print on the cloth: small dots in rows, kept inside the shoulders
  for (let r = 0; r < 3; r++) for (let c = -3; c <= 3; c++) {
    const dy = top + s * (0.14 + r * 0.085), half = sw * (0.45 + r * 0.14);
    const dx = cx + c * s * 0.085 + (r % 2) * s * 0.042;
    if (Math.abs(dx - cx) < half && Math.abs(dx - cx) > s * 0.05) p.circle(dx, dy, s * 0.011, { fill: 'card', op: 0.45 });
  }
  // collar, with its border
  p.path(poly([[cx - s * 0.075, top], [cx, top + s * 0.1], [cx + s * 0.075, top]]), { fill: 'skin' });
  p.path(String(new D().M(cx - s * 0.085, top).L(cx, top + s * 0.112).L(cx + s * 0.085, top)), { stroke: 'gold', sw: s * 0.014 });
  if (!female && kind !== 'person') {
    p.path(String(new D().M(cx, top + s * 0.1).L(cx, by - s * 0.05)), { stroke: 'ink', sw: 0.5, op: 0.35 });
    for (let i = 0; i < 3; i++) p.circle(cx + s * 0.02, top + s * (0.15 + i * 0.07), s * 0.012, { fill: 'gold' });
  }
  if (female && !child) {
    // a dupatta or pallu across one shoulder, with its border
    const d = new D().M(cx + sw * 0.55, top + s * 0.02).C(cx + sw * 0.15, top + s * 0.18, cx - sw * 0.3, by - s * 0.1, cx - sw * 0.62, by)
      .L(cx - sw * 0.2, by).C(cx + sw * 0.05, by - s * 0.14, cx + sw * 0.5, top + s * 0.2, cx + sw * 0.86, top + s * 0.1).Z();
    p.cut(String(d), drape, { shadow: 0.22 });
    p.path(String(new D().M(cx + sw * 0.55, top + s * 0.02).C(cx + sw * 0.15, top + s * 0.18, cx - sw * 0.3, by - s * 0.1, cx - sw * 0.62, by)), { stroke: 'gold', sw: s * 0.022 });
    p.path(String(new D().M(cx + sw * 0.62, top + s * 0.06).C(cx + sw * 0.22, top + s * 0.21, cx - sw * 0.22, by - s * 0.08, cx - sw * 0.5, by)), { stroke: 'sindoor', sw: s * 0.01, dash: [s * 0.02, s * 0.018] });
  }
  if (kind === 'person') {
    const d = new D().M(cx - sw, by).C(cx - sw * 0.9, top + s * 0.02, cx - s * 0.1, top - s * 0.02, cx, top + s * 0.06)
      .C(cx + s * 0.1, top - s * 0.02, cx + sw * 0.9, top + s * 0.02, cx + sw, by).L(cx + sw * 0.7, by)
      .C(cx + sw * 0.4, top + s * 0.25, cx - sw * 0.4, top + s * 0.25, cx - sw * 0.7, by).Z();
    p.cut(String(d), drape, { shadow: 0.15 });
  }
  // ears, head, and the paper's shadow side
  for (const sd of [-1, 1]) p.circle(cx + sd * hrx * 0.98, hy + hry * 0.08, hrx * 0.2, { fill: 'skin' });
  p.cut(smooth(ellipsePts(cx, hy, hrx, hry, 24)), 'skin', { shadow: 0.12 });
  p.path(String(new D().M(cx + hrx * 0.2, hy - hry * 0.98).C(cx + hrx * 1.15, hy - hry * 0.7, cx + hrx * 1.15, hy + hry * 0.75, cx + hrx * 0.1, hy + hry)
    .C(cx + hrx * 0.75, hy + hry * 0.5, cx + hrx * 0.8, hy - hry * 0.5, cx + hrx * 0.2, hy - hry * 0.98).Z()), { fill: 'ink', op: 0.12 });
  // hair
  if (female) {
    const cap = new D().M(cx - hrx * 1.08, hy + hry * 0.15).C(cx - hrx * 1.15, hy - hry * 1.2, cx + hrx * 1.15, hy - hry * 1.2, cx + hrx * 1.08, hy + hry * 0.15)
      .C(cx + hrx * 0.8, hy - hry * 0.45, cx + hrx * 0.1, hy - hry * 0.62, cx, hy - hry * 0.7)
      .C(cx - hrx * 0.1, hy - hry * 0.62, cx - hrx * 0.8, hy - hry * 0.45, cx - hrx * 1.08, hy + hry * 0.15).Z();
    p.cut(String(cap), hair, { shadow: 0.25, dx: s * 0.004, dy: s * 0.012 });
    p.path(String(new D().M(cx, hy - hry * 0.7).C(cx - hrx * 0.5, hy - hry * 0.95, cx - hrx * 0.9, hy - hry * 0.6, cx - hrx * 1.0, hy - hry * 0.1)), { stroke: 'card', sw: s * 0.006, op: 0.25 });
    if (specs) p.circle(cx + hrx * 0.95, hy - hry * 0.55, hrx * 0.42, { fill: hair }); // the bun, peeking
    if (kind === 'woman') for (const sd of [-1, 1]) p.circle(cx + sd * hrx * 1.0, hy + hry * 0.38, s * 0.013, { fill: 'gold' });
  } else if (kind === 'person') {
    p.path(String(new D().M(cx - hrx * 1.05, hy - hry * 0.05).C(cx - hrx, hy - hry * 1.25, cx + hrx, hy - hry * 1.25, cx + hrx * 1.05, hy - hry * 0.05)
      .C(cx + hrx * 0.6, hy - hry * 0.65, cx - hrx * 0.6, hy - hry * 0.65, cx - hrx * 1.05, hy - hry * 0.05).Z()), { fill: hair });
  } else {
    const recede = specs ? 0.25 : 0;
    const cap = new D().M(cx - hrx * 1.04, hy - hry * (0.05 + recede)).C(cx - hrx * 1.1, hy - hry * 1.3, cx + hrx * 1.2, hy - hry * 1.25, cx + hrx * 1.04, hy - hry * (0.1 + recede))
      .C(cx + hrx * 0.7, hy - hry * (0.72 + recede * 0.4), cx - hrx * 0.2, hy - hry * (0.55 + recede * 0.6), cx - hrx * 1.04, hy - hry * (0.05 + recede)).Z();
    p.cut(String(cap), hair, { shadow: 0.25, dx: s * 0.004, dy: s * 0.012 });
    if (kind === 'boy') p.path(String(new D().M(cx - hrx * 0.1, hy - hry * 1.02).Q(cx + hrx * 0.05, hy - hry * 1.4, cx + hrx * 0.4, hy - hry * 1.25).Q(cx + hrx * 0.2, hy - hry * 1.05, cx - hrx * 0.1, hy - hry * 1.02).Z()), { fill: hair });
  }
  if (specs) {
    for (const sd of [-1, 1]) p.circle(cx + sd * hrx * 0.42, hy + hry * 0.02, hrx * 0.28, { stroke: 'ink', sw: Math.max(0.5, s * 0.012), op: 0.85 });
    p.path(String(new D().M(cx - hrx * 0.14, hy).Q(cx, hy - hry * 0.08, cx + hrx * 0.14, hy)), { stroke: 'ink', sw: Math.max(0.5, s * 0.012), op: 0.85 });
  }
}

/** The avatar chosen from what the record says: gender and life stage, and a variant by id. */
export function avatarFor(person, { now = 2026 } = {}) {
  const by = person.birth ?? null;
  const age = by ? (person.died ?? now) - by : person.stage === 'elder' ? 70 : 40;
  const elder = age >= 60, child = age < 13;
  const h = [...String(person.id ?? person.name ?? 'x')].reduce((a, c) => (a * 31 + c.codePointAt(0)) >>> 0, 7);
  const cloths = ['indigo', 'peacock', 'clay', 'leafDeep', 'rani', 'saffron', 'sindoor'];
  const drapes = ['marigold', 'rani', 'saffron', 'peacock', 'gold'];
  const g = person.gender;
  const kind = child ? (g === 'FEMALE' ? 'girl' : g === 'MALE' ? 'boy' : 'person') : g === 'FEMALE' ? 'woman' : g === 'MALE' ? 'man' : 'person';
  let cloth = cloths[h % cloths.length];
  if (kind === 'man' && elder) cloth = ['card', 'paperDeep', 'indigo'][h % 3];
  let drape = drapes[(h >> 3) % drapes.length];
  if (drape === cloth) drape = 'gold';
  return { kind, cloth, drape, hair: elder ? 'silver' : 'ink', specs: elder };
}

// ---------------------------------------------------------------------------------------------
// Architecture and landscape

export function shikhara(p, x, base, w, h, fill, { flag = true, rib = 'ink', seed = 'sh' } = {}) {
  const body = [[x - w / 2, base], [x - w * 0.5, base - h * 0.35], [x - w * 0.42, base - h * 0.62], [x - w * 0.24, base - h * 0.84], [x - w * 0.1, base - h * 0.9],
    [x + w * 0.1, base - h * 0.9], [x + w * 0.24, base - h * 0.84], [x + w * 0.42, base - h * 0.62], [x + w * 0.5, base - h * 0.35], [x + w / 2, base]];
  p.cut(smooth(wobble(resample(body, 5), w * 0.006, seed), { tension: 0.9 }), fill, { shadow: 0.22 });
  for (let i = 1; i < 6; i++) {
    const yy = base - h * 0.14 * i, ww = w * (0.5 - 0.05 * i * i * 0.18) * 2 * (1 - i * 0.07);
    p.path(String(new D().M(x - ww / 2, yy).Q(x, yy - h * 0.03, x + ww / 2, yy)), { stroke: rib, sw: 0.6, op: 0.25 });
  }
  p.cut(smooth(ellipsePts(x, base - h * 0.93, w * 0.16, h * 0.035, 16)), fill, { shadow: 0.2 });
  p.path(String(new D().M(x - w * 0.05, base - h * 0.96).Q(x, base - h * 1.06, x + w * 0.05, base - h * 0.96).Z()), { fill });
  if (flag) {
    p.path(String(new D().M(x, base - h * 1.02).L(x, base - h * 1.22)), { stroke: fill, sw: 0.8 });
    p.path(poly([[x, base - h * 1.22], [x + w * 0.32, base - h * 1.18], [x, base - h * 1.12]]), { fill: 'saffron' });
  }
}

export function dome(p, x, base, w, h, fill, { seed = 'dome' } = {}) {
  p.cut(String(new D().M(x - w * 0.42, base).L(x - w * 0.42, base - h * 0.3).L(x + w * 0.42, base - h * 0.3).L(x + w * 0.42, base).Z()), fill, { shadow: 0.2 });
  const b = base - h * 0.3;
  p.cut(String(new D().M(x - w / 2, b).C(x - w * 0.62, b - h * 0.45, x - w * 0.1, b - h * 0.5, x, b - h * 0.72)
    .C(x + w * 0.1, b - h * 0.5, x + w * 0.62, b - h * 0.45, x + w / 2, b).Z()), fill, { shadow: 0.2 });
  p.path(String(new D().M(x, b - h * 0.7).L(x, b - h * 0.86)), { stroke: fill, sw: 1 });
  p.circle(x, b - h * 0.88, w * 0.04, { fill });
}

export function chhatri(p, x, base, w, fill, { seed = 'ch' } = {}) {
  const h = w * 0.9;
  for (const px of [x - w * 0.38, x + w * 0.38]) p.rect(px - w * 0.04, base - h * 0.5, w * 0.08, h * 0.5, { fill });
  p.cut(String(new D().M(x - w * 0.55, base - h * 0.5).L(x + w * 0.55, base - h * 0.5).L(x + w * 0.45, base - h * 0.58).L(x - w * 0.45, base - h * 0.58).Z()), fill, { shadow: 0.18 });
  p.cut(String(new D().M(x - w * 0.42, base - h * 0.58).C(x - w * 0.42, base - h * 0.95, x + w * 0.42, base - h * 0.95, x + w * 0.42, base - h * 0.58).Z()), fill, { shadow: 0.18 });
  p.path(String(new D().M(x, base - h * 0.86).L(x, base - h)), { stroke: fill, sw: 0.8 });
}

/** A ghat's bamboo umbrella. */
export function umbrella(p, x, base, w, fill = 'marigold', rim = 'saffron') {
  p.path(String(new D().M(x, base).L(x, base - w * 0.8)), { stroke: 'clay', sw: Math.max(0.8, w * 0.03) });
  p.cut(String(new D().M(x - w / 2, base - w * 0.72).Q(x - w * 0.2, base - w * 0.86, x, base - w * 1.02).Q(x + w * 0.2, base - w * 0.86, x + w / 2, base - w * 0.72)
    .Q(x, base - w * 0.66, x - w / 2, base - w * 0.72).Z()), fill, { shadow: 0.25 });
  for (let i = -2; i <= 2; i++) p.path(String(new D().M(x, base - w * 1.0).L(x + i * w * 0.24, base - w * 0.7)), { stroke: rim, sw: 0.6, op: 0.8 });
}

/** A haveli facade: parapet with kangura merlons, rows of windows (arched, shuttered, latticed), a
 *  balcony, pots on the sills, and an arched door - with a mandana border if asked for. */
export function haveli(p, x, base, w, h, fill, { trim = 'card', door = 'peacock', seed = 'hv', lit = false, jharokha = true, windows = 2, mandanaDoor = false, shutter = 'peacock' } = {}) {
  const rand = rng(seed);
  const top = base - h;
  p.cut(cutShape([[x, base], [x, top + 8], [x + w, top + 8], [x + w, base]], 0.5, seed, 12), fill, { shadow: 0.2, soft: true });
  const m = Math.max(4, Math.round(w / 14));
  for (let i = 0; i < m; i++) {
    const mx = x + (w * (i + 0.5)) / m, mw = (w / m) * 0.62;
    p.path(String(new D().M(mx - mw / 2, top + 9).L(mx - mw / 2, top + 3).Q(mx, top - 3, mx + mw / 2, top + 3).L(mx + mw / 2, top + 9).Z()), { fill });
  }
  p.rect(x - 2, top + 8, w + 4, 3, { fill: trim, op: 0.9 });
  // storey bands
  const dw = Math.min(w * 0.34, 42), dh = Math.min(h * 0.3, dw * 1.6);
  const rowsSpace = h - dh - 34;
  const rows = Math.max(1, Math.min(3, Math.floor(rowsSpace / 52)));
  const styles = lit ? ['arch', 'arch', 'arch'] : ['arch', 'shutter', 'jaali'];
  for (let r = 0; r < rows; r++) {
    const wy = top + 24 + r * 52, wh = 26, ww = 17;
    if (r > 0) p.path(String(new D().M(x + 3, wy - 12).L(x + w - 3, wy - 12)), { stroke: trim, sw: 1.4, op: 0.6 });
    const n = Math.max(2, Math.round(w / 44));
    for (let i = 0; i < n; i++) {
      const cx = x + (w * (i + 0.5)) / n;
      const centre = n % 2 === 1 && i === Math.floor(n / 2);
      if (jharokha && r === 0 && centre) {
        const jw = 32, jx = cx - jw / 2, jy = wy - 4;
        p.path(archPath(jx, jy, jw, wh + 8, { kind: 'cusped', lobes: 5 }), { fill: lit ? 'flame' : 'ink', op: lit ? 0.9 : 0.55 });
        p.cut(String(new D().M(jx - 4, jy + wh + 8).L(jx + jw + 4, jy + wh + 8).L(jx + jw, jy + wh + 14).L(jx, jy + wh + 14).Z()), trim, { shadow: 0.2 });
        for (let b = 0; b < 6; b++) p.path(String(new D().M(jx + 2 + b * (jw - 4) / 5, jy + wh + 1).L(jx + 2 + b * (jw - 4) / 5, jy + wh + 8)), { stroke: trim, sw: 1 });
        p.cut(String(new D().M(jx - 5, jy + 2).C(jx - 2, jy - 14, jx + jw + 2, jy - 14, jx + jw + 5, jy + 2).Z()), trim, { shadow: 0.2 });
        continue;
      }
      if (lit) { p.path(archPath(cx - ww / 2, wy, ww, wh, { kind: 'cusped', lobes: 5 }), { fill: 'flame', op: 0.85 }); continue; }
      windowCut(p, cx - ww / 2, wy, ww, wh, styles[r % 3], { frame: trim, shutter, glass: 'ink' });
      if ((i + r) % 3 === 1) pot(p, cx, wy + wh + 2, 11);
    }
  }
  // the door
  const dx = x + w / 2 - dw / 2;
  if (mandanaDoor) mandana(p, dx, base - dh, dw, dh, { ground: 'clay', chalk: 'card', band: 8 });
  p.path(archPath(dx - 3, base - dh - 3, dw + 6, dh + 3, { kind: 'pointed' }), { fill: trim });
  p.path(archPath(dx, base - dh, dw, dh, { kind: 'pointed' }), { fill: door });
  p.path(String(new D().M(x + w / 2, base - dh * 0.72).L(x + w / 2, base)), { stroke: 'ink', sw: 0.6, op: 0.4 });
  for (const sd of [-1, 1]) for (let r = 0; r < 3; r++) p.circle(x + w / 2 + sd * dw * 0.24, base - dh * (0.55 - r * 0.16), 1.2, { fill: 'gold' });
}

export function tulsi(p, x, base, s) {
  p.cut(poly([[x - s * 0.5, base], [x + s * 0.5, base], [x + s * 0.4, base - s * 0.12], [x - s * 0.4, base - s * 0.12]]), 'clay', { shadow: 0.2 });
  p.cut(poly([[x - s * 0.36, base - s * 0.12], [x + s * 0.36, base - s * 0.12], [x + s * 0.3, base - s * 0.72], [x - s * 0.3, base - s * 0.72]]), 'saffron', { shadow: 0.2 });
  p.cut(poly([[x - s * 0.42, base - s * 0.72], [x + s * 0.42, base - s * 0.72], [x + s * 0.36, base - s * 0.82], [x - s * 0.36, base - s * 0.82]]), 'clay', { shadow: 0.2 });
  lotus(p, x, base - s * 0.34, s * 0.2, { a: 'card', b: 'marigold', leaf: 'clay' });
  const rand = rng(`tulsi${x}`);
  p.path(String(new D().M(x, base - s * 0.82).L(x, base - s * 1.3)), { stroke: 'leafDeep', sw: s * 0.03 });
  for (let i = 0; i < 44; i++) {
    const t = rand(), a = -Math.PI / 2 + (rand() - 0.5) * 2.6 * (1 - t * 0.5), rr = s * (0.06 + t * 0.42);
    peepal(p, x + Math.cos(a) * rr * 0.75, base - s * 0.86 + Math.sin(a) * rr, s * (0.075 + (1 - t) * 0.03), (a + Math.PI / 2) * 57 + (rand() - 0.5) * 40, i % 3 ? 'leaf' : 'leafDeep');
  }
}

/** A canopy of overlapping hand-cut leaf masses. */
export function canopy(p, cx, cy, rx, ry, seed, { count = 18, colours = ['leafDeep', 'leaf', 'leafDeep', 'leaf'] } = {}) {
  const rand = rng(seed);
  const blobs = [];
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2, d = Math.sqrt(rand());
    blobs.push([cx + Math.cos(a) * rx * d * 0.8, cy + Math.sin(a) * ry * d * 0.75, (0.28 + rand() * 0.2) * Math.min(rx, ry * 1.4), i]);
  }
  blobs.sort((a, b) => a[1] - b[1]);
  for (const [bx, by, br, i] of blobs) {
    p.cut(cutShape(ellipsePts(bx, by, br * 1.25, br, 20), br * 0.08, `${seed}${i}`, 5), colours[i % colours.length], { shadow: 0.2, dx: 1.5, dy: 2.2 });
  }
}

export function bird(p, x, y, s, fill = 'ink', op = 0.7) {
  p.path(String(new D().M(x - s, y - s * 0.1).Q(x - s * 0.45, y - s * 0.55, x, y).Q(x + s * 0.45, y - s * 0.55, x + s, y - s * 0.1)
    .Q(x + s * 0.45, y - s * 0.3, x, y + s * 0.12).Q(x - s * 0.45, y - s * 0.3, x - s, y - s * 0.1).Z()), { fill, op });
}

export function stars(p, seed, count, box, fill = 'flame') {
  const rand = rng(seed);
  for (let i = 0; i < count; i++) {
    const x = box.x + rand() * box.w, y = box.y + Math.pow(rand(), 1.3) * box.h;
    const big = rand() > 0.93;
    if (big) {
      const s = 2 + rand() * 2;
      p.path(String(new D().M(x, y - s).Q(x + s * 0.18, y - s * 0.18, x + s * 0.7, y).Q(x + s * 0.18, y + s * 0.18, x, y + s).Q(x - s * 0.18, y + s * 0.18, x - s * 0.7, y).Q(x - s * 0.18, y - s * 0.18, x, y - s).Z()), { fill, op: 0.85 });
    } else p.circle(x, y, 0.3 + rand() * 0.7, { fill, op: 0.25 + rand() * 0.55 });
  }
}

/** A sky lantern rising. */
export function skyLantern(p, x, y, s, op = 1) {
  p.circle(x, y, s * 1.8, { fill: p.rad(x, y, s * 1.8, [[0, 'gold', 0.4 * op], [1, 'saffron', 0]]) });
  p.path(String(new D().M(x - s * 0.45, y - s * 0.6).Q(x, y - s * 0.75, x + s * 0.45, y - s * 0.6).L(x + s * 0.32, y + s * 0.55).Q(x, y + s * 0.62, x - s * 0.32, y + s * 0.55).Z()),
    { fill: p.lin(x, y - s * 0.7, x, y + s * 0.6, [[0, 'saffron'], [1, 'flame']]), op });
  p.circle(x, y + s * 0.5, s * 0.12, { fill: 'card', op });
}

// ---------------------------------------------------------------------------------------------
// Detail: what turns a flat block of colour into a wall somebody lives behind.

/** A window: 'arch' (cusped, dark glass), 'shutter' (two shutters ajar), 'jaali' (a lattice). */
export function windowCut(p, x, y, w, h, style, { frame = 'card', shutter = 'peacock', glass = 'ink', sill = true } = {}) {
  if (style === 'shutter') {
    p.cut(poly([[x - 3, y - 3], [x + w + 3, y - 3], [x + w + 3, y + h + 3], [x - 3, y + h + 3]]), frame, { shadow: 0.2 });
    p.rect(x, y, w, h, { fill: glass, op: 0.7 });
    p.path(poly([[x, y], [x + w * 0.34, y + h * 0.06], [x + w * 0.34, y + h * 0.94], [x, y + h]]), { fill: shutter });
    p.path(poly([[x + w, y], [x + w * 0.66, y + h * 0.06], [x + w * 0.66, y + h * 0.94], [x + w, y + h]]), { fill: shutter });
    for (const sx of [x + w * 0.17, x + w * 0.83]) for (let i = 1; i < 4; i++) p.path(String(new D().M(sx - w * 0.1, y + (h * i) / 4).L(sx + w * 0.1, y + (h * i) / 4)), { stroke: 'ink', sw: 0.4, op: 0.35 });
  } else {
    p.path(archPath(x - 3, y - 3, w + 6, h + 3, { kind: 'cusped', lobes: 5 }), { fill: frame });
    p.path(archPath(x, y, w, h, { kind: 'cusped', lobes: 5 }), { fill: glass, op: style === 'jaali' ? 0.45 : 0.62 });
    if (style === 'jaali') {
      for (let r = 0; r < Math.floor(h / 5); r++) for (let c = 0; c < Math.floor(w / 5); c++) {
        const cx = x + 2.5 + c * 5 + (r % 2) * 2.5, cy = y + h * 0.3 + r * 5;
        if (cx < x + w - 1 && cy < y + h - 1) p.circle(cx, cy, 1.3, { fill: frame });
      }
    }
  }
  if (sill) p.cut(poly([[x - 5, y + h + 2], [x + w + 5, y + h + 2], [x + w + 3, y + h + 6], [x - 3, y + h + 6]]), frame, { shadow: 0.2 });
}

/** A clay pot of leaves on a sill. */
export function pot(p, x, y, s, { leafFill = ['leaf', 'leafDeep'] } = {}) {
  const rand = rng(`pot${x}${y}`);
  for (let i = 0; i < 7; i++) M_leaf(p, x + (rand() - 0.5) * s * 0.6, y - s * 0.55, s * (0.5 + rand() * 0.35), (rand() - 0.5) * 120 + 180, leafFill[i % 2]);
  p.cut(String(new D().M(x - s * 0.42, y - s * 0.55).L(x + s * 0.42, y - s * 0.55).L(x + s * 0.3, y).L(x - s * 0.3, y).Z()), 'clay', { shadow: 0.2 });
  p.rect(x - s * 0.46, y - s * 0.62, s * 0.92, s * 0.1, { fill: 'saffron' });
}
const M_leaf = (p, x, y, len, ang, fill) => mangoLeaf(p, x, y, len, ang, fill, { rib: false, shadow: 0.1 });

/** Mandana: a painted border in chalk-white on red ochre, around a door. The house's own art. */
export function mandana(p, x, y, w, h, { ground = 'clay', chalk = 'card', band = 11 } = {}) {
  const outer = archPts(x - band, y - band, w + band * 2, h + band, { kind: 'pointed' });
  const inner = archPts(x, y, w, h, { kind: 'pointed' });
  p.path(`${poly(outer)}${poly(inner)}`, { fill: ground, rule: 'evenodd' });
  const mid = archPts(x - band / 2, y - band / 2, w + band, h + band / 2, { kind: 'pointed' });
  p.path(poly(mid.slice(1, -1), false), { stroke: chalk, sw: 0.9, dash: [3, 2.2] });
  const pts = resample(mid.slice(1, -1), 7, false);
  pts.forEach(([px, py], i) => { if (i % 2 === 0) p.circle(px, py, 1.1, { fill: chalk }); });
  for (const sd of [-1, 1]) {
    const cx = x + w / 2 + sd * (w / 2 + band * 2.2), cy = y + h * 0.45;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      p.circle(cx + Math.cos(a) * band * 0.9, cy + Math.sin(a) * band * 0.9, 1.4, { fill: chalk });
    }
    p.circle(cx, cy, band * 0.35, { stroke: chalk, sw: 0.9 });
  }
}

/** A band of rangoli along the foot of a page: petals, dots, a line. */
export function rangoliBand(p, x1, x2, y, { size = 9, colours = ['rani', 'marigold', 'peacock', 'saffron'] } = {}) {
  p.path(String(new D().M(x1, y - size * 1.1).L(x2, y - size * 1.1)), { stroke: 'gold', sw: 0.8 });
  p.path(String(new D().M(x1, y + size * 1.1).L(x2, y + size * 1.1)), { stroke: 'gold', sw: 0.8 });
  const n = Math.round((x2 - x1) / (size * 2.4));
  for (let i = 0; i <= n; i++) {
    const cx = x1 + ((x2 - x1) * i) / n;
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux;
      const P = (al, ac) => [cx + ux * al + vx * ac, y + uy * al + vy * ac];
      p.path(String(new D().M(...P(0, 0)).C(...P(size * 0.3, size * 0.28), ...P(size * 0.75, size * 0.2), ...P(size, 0)).C(...P(size * 0.75, -size * 0.2), ...P(size * 0.3, -size * 0.28), ...P(0, 0)).Z()), { fill: colours[(i + k) % colours.length] });
    }
    p.circle(cx, y, size * 0.2, { fill: 'gold' });
    if (i < n) p.circle(cx + (x2 - x1) / n / 2, y, size * 0.14, { fill: colours[i % colours.length] });
  }
}

/** A paper-cut profile, facing right: the silhouette-portrait tradition, for a hero who has no
 *  photograph. It is a shape, not a likeness. (cx, base) is the middle of the shoulders' foot. */
export function profile(p, cx, base, s, kind, { fill = 'indigo', hair = 'ink', rim = 'gold', drape = 'marigold' } = {}) {
  const P = (x, y) => [cx + x * s, base + y * s];
  const female = kind === 'woman';
  const body = [P(-0.5, 0), P(-0.47, -0.17), P(-0.33, -0.29), P(-0.17, -0.35), P(-0.16, -0.46), P(-0.19, -0.6), P(-0.13, -0.75), P(-0.02, -0.83),
    P(0.1, -0.835), P(0.19, -0.78), P(0.225, -0.69), P(0.232, -0.625), P(0.272, -0.575), P(0.243, -0.548), P(0.252, -0.522), P(0.236, -0.507),
    P(0.246, -0.488), P(0.222, -0.466), P(0.214, -0.442), P(0.165, -0.42), P(0.12, -0.402), P(0.128, -0.345), P(0.21, -0.3), P(0.38, -0.2), P(0.5, 0)];
  p.cut(smooth(body, { tension: 0.85 }), fill, { shadow: 0.25, soft: true });
  p.path(smooth(body.slice(9, 20), { closed: false, tension: 0.85 }), { stroke: rim, sw: s * 0.008, op: 0.8 });
  if (female) {
    p.cut(smooth([P(0.2, -0.74), P(0.12, -0.84), P(-0.02, -0.855), P(-0.15, -0.79), P(-0.22, -0.66), P(-0.2, -0.5), P(-0.13, -0.47), P(-0.1, -0.6), P(0.02, -0.73), P(0.14, -0.745)]), hair, { shadow: 0.2 });
    p.cut(smooth(ellipsePts(cx - 0.24 * s, base - 0.58 * s, 0.075 * s, 0.07 * s, 14)), hair, { shadow: 0.2 });
    p.circle(cx + 0.04 * s, base - 0.55 * s, 0.012 * s, { fill: 'gold' });
    p.cut(smooth([P(0.21, -0.3), P(0.05, -0.2), P(-0.1, -0.06), P(-0.2, 0), P(0.1, 0), P(0.3, -0.12), P(0.4, -0.18)], { tension: 0.9 }), drape, { shadow: 0.2 });
  } else {
    p.cut(smooth([P(0.21, -0.72), P(0.14, -0.83), P(0.0, -0.865), P(-0.14, -0.8), P(-0.2, -0.66), P(-0.17, -0.52), P(-0.12, -0.53), P(-0.08, -0.64), P(0.04, -0.72), P(0.15, -0.73)]), hair, { shadow: 0.2 });
    p.path(String(new D().M(cx + 0.12 * s, base - 0.345 * s).Q(cx + 0.02 * s, base - 0.3 * s, cx + 0.03 * s, base - 0.22 * s)), { stroke: 'gold', sw: s * 0.01 });
  }
}
