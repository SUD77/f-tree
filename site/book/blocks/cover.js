/*
 * The cover, which is also the thumbnail.
 *
 * A PDF sent in a chat app is shown as its first page, about 150 pixels wide, with the file name
 * under it and the caption usually dropped. So the cover has to explain itself at that size: the
 * family's name large enough to read, one image, and a sentence for whoever opens it. The image is
 * the family itself - every star (or, at Diwali, every lamp) is one person, the eldest at the
 * centre and each generation an orbit further out - so no two families' covers are alike.
 */

import { PAGE, group, path, circle, PathData } from '../format.js';
import { starfield, sparkleData, lamp, lantern, rangoliRing } from './art.js';
import { countWords, fill } from './words.js';

const { w: W, h: H } = PAGE;

export function sky(ctx, id = 'sky') {
  const { P } = ctx;
  return ctx.gradient(id, {
    type: 'radial', cx: W / 2, cy: H * 0.58, r: H * 0.75,
    stops: [[0, P.glow, 1], [0.55, P.night, 1], [1, P.deep, 1]],
  });
}

export const halo = (ctx) => ctx.gradient('halo', { type: 'radial', cx: 0, cy: 0, r: 1, units: 'item', stops: [[0, ctx.P.flame, 0.55], [1, ctx.P.flame, 0]] });

/**
 * Where each person sits in the sky. The angle comes from the person's place across the tree's own
 * layout, so families that sit together on the tree sit together in the sky; the gap at the foot
 * of the circle is where people with no link to the main family are placed, apart but present.
 */
export function orbitPositions(family, { cx, cy, rMin, rMax }) {
  const G = family.generations;
  const joined = family.people.filter((p) => p.gen !== null);
  const xs = joined.map((p) => p.x);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const ring = (g) => (G <= 1 ? (rMin + rMax) / 2 : rMin + (g / (G - 1)) * (rMax - rMin));
  const pos = new Map();
  for (const p of joined) {
    const u = maxX > minX ? (p.x - minX) / (maxX - minX) : 0.5;
    const a = -Math.PI / 2 + (u - 0.5) * Math.PI * 1.8;
    pos.set(p.id, { x: cx + Math.cos(a) * ring(p.gen), y: cy + Math.sin(a) * ring(p.gen) });
  }
  const apart = family.elsewhere;
  apart.forEach((p, i) => {
    const a = Math.PI / 2 + (apart.length > 1 ? (i / (apart.length - 1) - 0.5) * Math.PI * 0.16 : 0);
    const r = rMax + 16;
    pos.set(p.id, { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  });
  return { pos, ring };
}

/** The constellation: faint orbits, a line from each parent, a firmer one between partners. */
export function constellation(ctx, { cx, cy, rMin = 34, rMax = 225, motif = 'stars' }) {
  const { family, P } = ctx;
  const { pos, ring } = orbitPositions(family, { cx, cy, rMin, rMax });
  const n = family.people.length;
  const size = Math.max(2.4, Math.min(9, 9 * Math.sqrt(30 / Math.max(n, 1))));
  const items = [];
  for (let g = 0; g < family.generations; g++) items.push(circle(cx, cy, ring(g), { stroke: P.mist, sw: 0.45, op: 0.28 }));

  const descent = new PathData();
  for (const p of family.people) {
    const c = pos.get(p.id);
    for (const parent of family.parentsOf(p.id)) {
      const a = pos.get(parent.id);
      if (a) descent.M(a.x, a.y).L(c.x, c.y);
    }
  }
  const partners = new PathData();
  const seen = new Set();
  for (const p of family.people) for (const s of family.spousesOf(p.id)) {
    const key = p.id < s.id ? `${p.id} ${s.id}` : `${s.id} ${p.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const a = pos.get(p.id), b = pos.get(s.id);
    partners.M(a.x, a.y).L(b.x, b.y);
  }
  if (!descent.empty) items.push(path(String(descent), { stroke: P.gold, sw: 0.7, op: 0.55 }));
  if (!partners.empty) items.push(path(String(partners), { stroke: P.gold, sw: 1.4, op: 0.85, cap: 'round' }));

  const glow = motif === 'lamps' ? ctx.gradient('lampGlow', { type: 'radial', cx: 0, cy: 0, r: 1, units: 'item', stops: [[0, P.flame, 0.8], [1, P.clay, 0]] }) : null;
  const light = halo(ctx);
  const stars = new PathData();
  for (const p of family.people) {
    const c = pos.get(p.id);
    if (motif === 'lamps') {
      items.push(...lamp(c.x, c.y, size * 1.25, { unknown: !p.name, clay: P.clay, flame: P.flame, gold: P.gold, glow: glow.ref }));
      continue;
    }
    items.push(circle(c.x, c.y, size * 2.2, { fill: light, op: p.deceased ? 0.9 : 0.55 }));
    if (!p.name) items.push(circle(c.x, c.y, size * 0.55, { stroke: P.gold, sw: 0.8, dash: [1.6, 1.3] }));
    else if (p.deceased) {
      // Remembered: a steady gold point inside a ring, not a twinkle.
      items.push(circle(c.x, c.y, size * 0.42, { fill: P.gold }));
      items.push(circle(c.x, c.y, size * 0.8, { stroke: P.gold, sw: 0.5, op: 0.8 }));
    } else sparkleData(c.x, c.y, size, stars);
  }
  if (!stars.empty) items.push(path(String(stars), { fill: P.star }));
  return group(items);
}

/** "The Sharma Family" set as a name: the surname large, "Family" beneath it. */
function titleItems(ctx, top, colour) {
  const { family } = ctx;
  const m = /^The (.+) Family$/.exec(family.title);
  const items = [];
  if (m) {
    const size = ctx.fit(`The ${m[1]}`, 'display', 60, 470, 30);
    items.push(ctx.line(W / 2, top, `The ${m[1]}`, 'display', size, colour, { align: 'middle' }));
    items.push(ctx.line(W / 2, top + size * 0.95, 'Family', 'display', size * 0.62, colour, { align: 'middle', op: 0.92 }));
    return { items, bottom: top + size * 0.95 };
  }
  const size = ctx.fit(family.title, 'display', 62, 470, 28);
  items.push(ctx.line(W / 2, top + size * 0.6, family.title, 'display', size, colour, { align: 'middle' }));
  return { items, bottom: top + size * 0.6 };
}

export function cover(ctx) {
  const { P, tpl, facts, family } = ctx;
  const c = tpl.cover;
  const items = [nightGround(ctx), starfield(`${family.title} sky`, 260, { x: 0, y: 0, w: W, h: H }, P.star)];
  const cy = c.ornaments.includes('rangoli') ? 560 : 540;

  let bottom;
  if (c.greeting) {
    items.push(ctx.line(W / 2, 112, c.greeting, 'display', ctx.fit(c.greeting, 'display', 44, 470, 26), P.gold, { align: 'middle' }));
    const sub = fill(c.subtitle ?? '{family}', ctx);
    items.push(ctx.line(W / 2, 160, sub, 'display', ctx.fit(sub, 'display', 30, 480, 18), P.star, { align: 'middle' }));
    bottom = 160;
  } else {
    const t = titleItems(ctx, 112, P.star);
    items.push(...t.items);
    bottom = t.bottom;
  }
  const sentence = c.line ? fill(c.line, ctx) : standfirst(facts);
  items.push(...ctx.lines(W / 2, bottom + 34, sentence, 'text', 13, P.gold, { width: 430, maxLines: 2, lead: 18, align: 'middle' }).items);

  if (c.ornaments.includes('lanterns')) {
    const glow = ctx.gradient('lanternGlow', { type: 'radial', cx: 0, cy: 0, r: 1, units: 'item', stops: [[0, P.flame, 0.8], [1, P.clay, 0]] });
    for (const [x, drop] of [[70, 90], [W - 70, 130]]) {
      items.push(...lantern(x, drop, { body: P.lanternBody, top: P.lanternTop, cord: P.goldSoft, glow: glow.ref }));
    }
  }
  if (c.ornaments.includes('rangoli')) items.push(...rangoliRing(W / 2, cy, 250, 24, [P.petalA, P.petalB], P.gold));
  items.push(constellation(ctx, { cx: W / 2, cy, rMax: c.ornaments.includes('rangoli') ? 205 : 225, motif: c.motif }));
  if (ctx.attribution) items.push(ctx.line(W / 2, H - 34, 'Made with f-tree', 'text', 8, P.mist, { align: 'middle' }));
  return ctx.page('Cover', items);
}

/** The ground of a night page: a full-bleed rectangle filled with the sky gradient. */
export function nightGround(ctx) {
  const ref = sky(ctx);
  return { t: 'rect', x: 0, y: 0, w: W, h: H, fill: ref };
}

/** "Twenty-three people across five generations, remembered since 1900." */
export function standfirst(facts) {
  const people = facts.people === 1 ? 'One person' : `${countWords(facts.people, true)} people`;
  const gens = facts.generations > 1 ? ` across ${countWords(facts.generations)} generations` : '';
  const since = facts.earliest ? `, remembered since ${facts.earliest}` : '';
  return `${people}${gens}${since}.`;
}
