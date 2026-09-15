/*
 * The six Aangan style frames (#240), drawn with the sample family (site/playground/sample-family.ftree).
 * These are the approval gate for the storybook: hand-placed compositions of the kit's motifs,
 * built only from what Book format 2 will carry, so a frame that looks right is one the painters
 * can actually draw.
 *
 *   node site/book/art/style-frames/frames.mjs [out-dir] [page ...]
 *
 * Portraits for the photograph treatment come from FTREE_FRAME_PHOTOS and are never committed.
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { Page, D, poly, smooth, cutShape, ellipsePts, resample, wobble, rng } from './kit.mjs';
import * as M from './motifs.mjs';

const W = 595, H = 842;

// ---------------------------------------------------------------------------------------------
// Shared furniture

function photo(name) {
  const dir = process.env.FTREE_FRAME_PHOTOS;
  if (!dir || !existsSync(`${dir}/${name}`)) return null;
  return `data:image/jpeg;base64,${readFileSync(`${dir}/${name}`).toString('base64')}`;
}

/** Handmade paper: the flat ground and a few large, faint clouds of fibre. */
function paperGround(p, seed, { ground = 'paper', cloud = 'paperDeep' } = {}) {
  p.rect(0, 0, W, H, { fill: ground });
  const rand = rng(seed);
  for (let i = 0; i < 7; i++) {
    const cx = rand() * W, cy = rand() * H, rx = 90 + rand() * 160, ry = 60 + rand() * 120;
    p.path(cutShape(ellipsePts(cx, cy, rx, ry, 20, rand() * 3), 14, `${seed}c${i}`, 20), { fill: cloud, op: 0.22 });
  }
}

/** The folio: a small diya and the page's number at the outer foot of the page. */
function folio(p, n, { ink = 'inkSoft', credit = true, y = H - 25.5 } = {}) {
  const right = n % 2 === 1;
  const x = right ? W - 44 : 44;
  M.diya(p, right ? x - 16 : x + 2, y - 4.5, 11);
  p.text(right ? x : x + 16, y, String(n), { font: 'strong', size: 8.5, fill: ink, align: right ? 'end' : 'start' });
  if (credit) p.text(right ? 44 : W - 44, y, 'Made with f-tree', { font: 'text', size: 7, fill: ink, align: right ? 'start' : 'end', op: 0.7 });
}

/** The book's one handwritten note: a torn card and a strip of tape. */
function note(p, x, y, w, lines, { angle = -3, size = 13.5, seed = 'note' } = {}) {
  const h = lines.length * size * 1.35 + size * 1.1;
  const a = (angle * Math.PI) / 180;
  p.group((g) => {
    g.cut(cutShape([[0, 0], [w, 0], [w, h], [0, h]], 1.1, seed, 7), 'card', { shadow: 0.22, soft: true, dx: 0.8, dy: 1.3 });
    lines.forEach((l, i) => g.text(w / 2, size * 1.25 + i * size * 1.35, l, { font: 'hand', size, fill: 'ink', align: 'middle' }));
    g.group((t) => t.rect(-18, -6, 36, 12, { fill: 'gold', op: 0.45 }), { tf: [Math.cos(0.1), Math.sin(0.1), -Math.sin(0.1), Math.cos(0.1), w / 2, -1] });
  }, { tf: [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), x, y] });
}

/** A person in a medallion: their photograph in a carved ring, or the avatar their record chooses. */
function portrait(p, cx, cy, r, person, o = {}) {
  const look = M.avatarFor(person);
  const href = person.photo ? photo(person.photo) : null;
  M.medallion(p, cx, cy, r, {
    departed: person.died !== undefined && person.died !== null,
    unknown: !person.name,
    seed: person.id ?? person.name,
    ground: person.name ? 'paperDeep' : 'card',
    photo: !!href,
    carved: o.carved ?? !!href,
    petals: o.petals ?? false,
    inner: (g) => {
      if (!person.name) { M.diya(g, cx - r * 0.15, cy + r * 0.25, r * 0.9, { unknown: true }); return; }
      if (href) { g.image(href, cx - r, cy - r, 2 * r, 2 * r); return; }
      g.circle(cx, cy, r, { fill: g.rad(cx, cy - r * 0.2, r * 1.2, [[0, 'card'], [1, 'paperDeep']]) });
      M.bust(g, cx, cy + r * 1.02, r * 1.6, look.kind, look);
    },
  });
}

function lines(p, x, y, list, { font = 'text', size = 13, lead = 19, fill = 'ink', align = 'middle' } = {}) {
  list.forEach((l, i) => p.text(x, y + i * lead, l, { font, size, fill, align }));
  return y + (list.length - 1) * lead;
}

/** A ghat house on the far bank: a kangura parapet, a few arched windows lit, sometimes a chhatri. */
function town(p, x, base, w, h, fill, seed, { lights = 'flame' } = {}) {
  const rand = rng(seed);
  const top = base - h;
  p.cut(poly(wobble(resample([[x, base], [x, top + 3], [x + w, top + 3], [x + w, base]], 8), 0.4, seed)), fill, { shadow: 0.25 });
  const m = Math.max(3, Math.round(w / 8));
  for (let i = 0; i < m; i++) { const mx = x + (w * (i + 0.5)) / m; p.path(String(new D().M(mx - 2, top + 4).L(mx - 2, top + 1).Q(mx, top - 2, mx + 2, top + 1).L(mx + 2, top + 4).Z()), { fill }); }
  const cols = Math.max(1, Math.floor(w / 18)), rows = Math.max(1, Math.floor((h - 12) / 16));
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (rand() > 0.62) continue;
    const wx = x + (w * (c + 0.5)) / cols - 2.6, wy = top + 9 + r * 16;
    p.path(M.archPath(wx, wy, 5.2, 7.5, { kind: 'pointed' }), { fill: lights, op: 0.6 + rand() * 0.35 });
  }
  if (rand() > 0.55) M.chhatri(p, x + w * (0.25 + rand() * 0.5), top + 2, 14, fill);
}

/** A branch of cut leaves reaching in from the page edge: the lightbox's nearest layer. */
function branch(p, pts, seed, { fill = 'deep', leafFill = ['deep', 'night'], leaves = 22, size = 16 } = {}) {
  const rand = rng(seed);
  p.path(smooth(pts, { closed: false }), { stroke: fill, sw: size * 0.32, cap: 'round' });
  for (let i = 0; i < leaves; i++) {
    const t = rand(), k = Math.min(pts.length - 2, Math.floor(t * (pts.length - 1)));
    const a = pts[k], b = pts[k + 1], u = t * (pts.length - 1) - k;
    M.mangoLeaf(p, a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, size * (0.9 + rand() * 0.8), (rand() - 0.5) * 140 + (rand() > 0.5 ? 30 : -30), leafFill[i % leafFill.length], { rib: false, shadow: 0 });
  }
}

function kite(p, x, y, s, fill, trim) {
  p.path(smooth([[x, y + s], [x - s * 0.8, y + s * 2.2], [x - s * 0.4, y + s * 3.6], [x - s * 1.6, y + s * 5.4]], { closed: false }), { stroke: 'inkSoft', sw: 0.5, op: 0.6 });
  p.cut(poly([[x, y - s], [x + s * 0.85, y], [x, y + s], [x - s * 0.85, y]]), fill, { shadow: 0.2 });
  p.path(poly([[x, y - s], [x + s * 0.85, y], [x, y]]), { fill: trim, op: 0.9 });
  p.path(String(new D().M(x, y - s).L(x, y + s)), { stroke: 'card', sw: 0.5, op: 0.7 });
  p.cut(poly([[x, y + s], [x + s * 0.3, y + s * 1.45], [x - s * 0.3, y + s * 1.45]]), trim, { shadow: 0.15 });
}

/** A rangoli drawn on the ground, seen at an angle. */
const groundRangoli = (p, cx, cy, R, seed, { op = 0.9, tilt = 0.4, ground = 'card' } = {}) =>
  p.group((g) => M.rangoli(g, 0, 0, R, seed, { ground }), { tf: [1, 0, 0, tilt, cx, cy], op });

function petals(p, seed, count, box, avoid) {
  const rand = rng(seed);
  for (let i = 0; i < count; i++) {
    const x = box.x + rand() * box.w, y = box.y + rand() * box.h;
    if (avoid && x > avoid.x && x < avoid.x + avoid.w && y > avoid.y && y < avoid.y + avoid.h) continue;
    M.marigold(p, x, y, 2.2 + rand() * 1.6, `${seed}${i}`, { shadow: 0.25 });
  }
}

// ---------------------------------------------------------------------------------------------
// 1. Cover: the river at night. A lamp afloat for each person, the eldest furthest away, drifting
//    toward the family on the near steps.

function cover() {
  const p = new Page(M.PALETTE, { id: 'cv' });
  const horizon = 470;
  p.rect(0, 0, W, H, { fill: p.lin(0, 0, 0, horizon, [[0, 'deep'], [0.36, 'night'], [0.74, 'glow'], [1, 'dusk']]) });
  p.circle(W / 2, horizon, 400, { fill: p.rad(W / 2, horizon, 400, [[0, 'saffron', 0.36], [0.4, 'rani', 0.12], [1, 'rani', 0]]) });
  M.stars(p, 'Kumar', 150, { x: 0, y: 40, w: W, h: 330 });
  // lantern light near the title, so the thumbnail's top band carries the lamps' warmth
  for (const [x, y, s] of [[120, 256, 8.5], [482, 236, 9.5], [520, 320, 5.5], [78, 350, 5], [396, 118, 3.8], [206, 102, 3.4], [452, 398, 4.2]]) M.skyLantern(p, x, y, s);

  for (const [x, h, k] of [[26, 58, 'dome'], [80, 80, 'sh'], [136, 50, 'ch'], [190, 66, 'dome'], [252, 90, 'sh'], [306, 56, 'dome'], [356, 76, 'sh'], [414, 48, 'ch'], [466, 84, 'sh'], [526, 60, 'dome'], [578, 74, 'sh']]) {
    if (k === 'sh') M.shikhara(p, x, horizon - 4, h * 0.48, h, 'haze', { seed: `f${x}`, rib: 'glow' });
    else if (k === 'dome') M.dome(p, x, horizon - 4, h * 0.8, h * 0.8, 'haze');
    else M.chhatri(p, x, horizon - 4, h * 0.75, 'haze');
  }
  for (const [x, w, h] of [[-6, 50, 50], [44, 38, 38], [82, 56, 58], [138, 44, 44], [182, 60, 36], [242, 40, 54], [282, 56, 42], [338, 46, 60], [384, 58, 40], [442, 42, 52], [484, 60, 44], [544, 58, 56]]) town(p, x, horizon + 12, w, h, 'glow', `t${x}`);
  // the far ghat: steps, chhatris and umbrellas on the landing, boats moored below
  for (let i = 0; i < 4; i++) p.cut(cutShape([[-10, horizon + 10 + i * 5.5], [W + 10, horizon + 10 + i * 5.5], [W + 10, horizon + 17 + i * 5.5], [-10, horizon + 17 + i * 5.5]], 0.3, `fs${i}`, 30), i % 2 ? 'night' : 'glow', { shadow: 0.3 });
  for (const x of [34, 262, 508]) M.chhatri(p, x, horizon + 12, 22, 'night');
  for (const [x, c] of [[100, 'marigold'], [196, 'rani'], [338, 'marigold'], [440, 'saffron'], [566, 'rani']]) M.umbrella(p, x, horizon + 12, 16, c, 'gold');
  const river = horizon + 32, bank = 738;
  p.rect(0, river, W, bank - river, { fill: p.lin(0, river, 0, bank, [[0, 'dusk'], [0.22, 'glow'], [0.6, 'night'], [1, 'deep']]) });
  for (const [x, s] of [[150, 18], [300, 14], [470, 20]]) p.path(String(new D().M(x - s, river + 2).Q(x, river + 2 + s * 0.3, x + s, river - 1).L(x + s * 0.7, river + 2 + s * 0.06).Q(x, river + 2 + s * 0.2, x - s * 0.75, river + 3).Z()), { fill: 'deep' });
  const rr = rng('ripples');
  for (let i = 0; i < 44; i++) p.rect(rr() * W, river + 6 + rr() * 50, 1.1, (3 + rr() * 14) * 0.7, { fill: 'gold', op: 0.1 + rr() * 0.2 });
  for (let i = 0; i < 26; i++) {
    const y = river + 10 + Math.pow(rr(), 0.8) * (bank - river - 14), x = rr() * W, l = 10 + ((y - river) / (bank - river)) * 60;
    p.path(String(new D().M(x, y).Q(x + l / 2, y - 1.4, x + l, y)), { stroke: 'flame', sw: 0.6, op: 0.07 + rr() * 0.1 });
  }

  // one lamp for each of the 23; two of them for people whose names nobody recorded
  const people = 23, unknown = new Set([2, 21]);
  p.circle(380, 650, 260, { fill: p.rad(380, 650, 260, [[0, 'gold', 0.26], [0.45, 'saffron', 0.1], [1, 'saffron', 0]]) });
  const lr = rng('drift');
  const lamps = [];
  for (let i = 0; i < people; i++) {
    const t = (i + 0.5) / people;
    const s = 6 + Math.pow(t, 1.6) * 46;
    const y = river + 16 + Math.pow(t, 1.5) * (bank - river - 30);
    let x = 0, tries = 0;
    do {
      x = 380 + Math.sin(t * 5.2 + 1.3) * (30 + t * 70) + (lr() - 0.5) * (40 + t * 170);
      tries++;
    } while (tries < 30 && lamps.some((l) => Math.abs(l.x - x) < (l.s + s) * 0.62 && Math.abs(l.y - y) < (l.s + s) * 0.34));
    lamps.push({ x: Math.min(W - 40, Math.max(250, x)), y, s, unknown: unknown.has(i) });
  }
  lamps.sort((a, b) => a.y - b.y);
  for (const l of lamps) M.floatingDiya(p, l.x, l.y, l.s, { unknown: l.unknown });

  // the near ghat: the family sits on the landing's edge; the riser in front hides where they sit
  const landing = bank;
  p.cut(cutShape([[-10, landing + 4], [W + 10, landing - 4], [W + 10, H + 10], [-10, H + 10]], 1, 'land', 14), 'deep', { shadow: 0.55, dy: -1.5, dx: 0, soft: true, shadowFill: 'deep' });
  p.path(cutShape([[-10, landing + 4], [W + 10, landing - 4], [W + 10, landing + 26], [-10, landing + 32]], 0.6, 'landtop', 20), { fill: p.lin(0, landing, 0, landing + 30, [[0, 'dusk', 0.75], [1, 'glow', 0.3]]) });
  p.path(String(new D().M(-10, landing + 4).L(W + 10, landing - 4)), { stroke: 'gold', sw: 0.9, op: 0.5 });
  M.sittingBack(p, 64, landing + 30, 128, 'elder', { drape: 'sindoor', fill: 'deep' });
  M.sittingBack(p, 128, landing + 30, 138, 'man', { drape: 'marigold', fill: 'deep' });
  M.sittingBack(p, 176, landing + 30, 88, 'child', { drape: 'marigold', fill: 'glow', lean: -12 });
  M.sittingBack(p, 232, landing + 30, 134, 'woman', { drape: 'saffron', fill: 'deep' });
  const lx = 292, ly = landing + 24;
  p.path(String(new D().M(lx - 11, ly).C(lx - 16, ly - 14, lx - 8, ly - 22, lx - 4, ly - 24).L(lx - 5, ly - 30).L(lx + 5, ly - 30).L(lx + 4, ly - 24).C(lx + 8, ly - 22, lx + 16, ly - 14, lx + 11, ly).Z()), { fill: 'gold', stroke: 'saffron', sw: 0.6 });
  p.path(String(new D().M(lx - 10, ly - 14).Q(lx, ly - 11, lx + 10, ly - 14)), { stroke: 'saffron', sw: 0.8 });
  // the riser of the landing, in front of them, then two treads down
  p.cut(cutShape([[-10, landing + 28], [W + 10, landing + 24], [W + 10, H + 10], [-10, H + 10]], 0.8, 'riser', 16), 'deep', { shadow: 0.5, dy: -1.2, dx: 0, soft: true, shadowFill: 'deep' });
  p.path(String(new D().M(-10, landing + 28).L(W + 10, landing + 24)), { stroke: 'gold', sw: 0.8, op: 0.45 });
  for (const y of [landing + 62, landing + 90]) p.path(String(new D().M(-10, y).L(W + 10, y - 2)), { stroke: 'dusk', sw: 1.4, op: 0.5 });
  p.circle(462, landing + 62, 80, { fill: p.rad(462, landing + 62, 80, [[0, 'gold', 0.16], [1, 'gold', 0]]) });
  groundRangoli(p, 462, landing + 64, 50, 'Kumar', { op: 0.62, tilt: 0.32, ground: 'paperDeep' });
  petals(p, 'cvp', 16, { x: 300, y: landing + 36, w: W - 320, h: H - landing - 46 }, { x: 400, y: landing + 44, w: 124, h: 42 });

  branch(p, [[-20, 70], [30, 110], [58, 170], [66, 250], [50, 330]], 'bl', { size: 17, leaves: 26 });
  branch(p, [[615, 60], [560, 104], [540, 160], [548, 230]], 'br', { size: 17, leaves: 22 });
  M.toran(p, -12, W + 12, 14, { leaf: 30, seed: 'cover-toran', swags: 5 });
  M.kandil(p, 110, 14, 96, 26, { body: 'rani', trim: 'marigold', seed: 'k1' });
  M.kandil(p, 488, 14, 120, 24, { body: 'peacock', trim: 'gold', seed: 'k2' });

  p.text(W / 2, 218, 'शुभ दीपावली', { font: 'display', size: 58, fill: 'gold', align: 'middle' });
  p.text(W / 2, 270, 'from the Kumar family', { font: 'display', size: 34, fill: 'card', align: 'middle' });
  p.text(W / 2, 310, 'Twenty-three lamps, one for each of us.', { font: 'hand', size: 17, fill: 'flame', align: 'middle' });
  p.text(22, H - 14, 'Made with f-tree', { font: 'text', size: 7.5, fill: 'card', op: 0.6 });
  return p;
}

// ---------------------------------------------------------------------------------------------
// 2. Opening: the featured person at the window of a haveli, looking out at the river. Seen from
//    behind, so nobody's face is invented. The page never says "featured".

function opening() {
  const p = new Page(M.PALETTE, { id: 'op' });
  paperGround(p, 'opening');
  const wx = 70, wy = 96, ww = W - 140, wh = 420;
  p.cut(cutShape([[wx, wy + 18], [wx + ww, wy + 18], [wx + ww, wy + wh], [wx, wy + wh]], 0.8, 'wall', 14), 'stone', { shadow: 0.25, soft: true });
  const mr = Math.round(ww / 16);
  for (let i = 0; i < mr; i++) {
    const mx = wx + (ww * (i + 0.5)) / mr, mw = (ww / mr) * 0.66;
    p.cut(String(new D().M(mx - mw / 2, wy + 20).L(mx - mw / 2, wy + 10).Q(mx, wy - 2, mx + mw / 2, wy + 10).L(mx + mw / 2, wy + 20).Z()), 'stone', { shadow: 0.2 });
  }
  p.rect(wx - 6, wy + 18, ww + 12, 7, { fill: 'clay' });
  const jr = rng('blocks');
  for (let row = 0; row < 12; row++) {
    const y = wy + 70 + row * 32;
    if (y > wy + wh - 10) break;
    p.path(String(new D().M(wx + 4, y).L(wx + ww - 4, y)), { stroke: 'clay', sw: 0.5, op: 0.22 });
    for (let x = wx + (row % 2 ? 26 : 0) + jr() * 10; x < wx + ww; x += 52) p.path(String(new D().M(x, y).L(x, y + 32)), { stroke: 'clay', sw: 0.5, op: 0.18 });
  }
  M.rangoliBand(p, wx + 10, wx + ww - 10, wy + 44, { size: 7 });
  const ax = W / 2 - 96, ay = wy + 104, aw = 192, ah = 250;
  // niches either side, each with its lamp, and small jaali windows above them
  for (const nx of [wx + 50, wx + ww - 50]) {
    p.path(M.archPath(nx - 20, wy + 200, 40, 62, { kind: 'pointed' }), { fill: 'clay', op: 0.9 });
    p.path(M.archPath(nx - 16, wy + 206, 32, 56, { kind: 'pointed' }), { fill: p.lin(0, wy + 206, 0, wy + 262, [[0, 'saffron', 0.5], [1, 'gold', 0.9]]) });
    M.diya(p, nx - 3, wy + 254, 20);
    M.windowCut(p, nx - 11, wy + 96, 22, 34, 'jaali', { frame: 'card' });
    M.chhajja(p, nx - 13, wy + 88, 26, 'clay');
  }
  M.archFrame(p, ax, ay, aw, ah, {
    band: 17, seed: 'hero',
    inner: (g) => {
      g.rect(ax - 20, ay - 20, aw + 40, ah + 40, { fill: g.lin(0, ay, 0, ay + ah, [[0, 'sky'], [0.7, 'paper'], [1, 'paperDeep']]) });
      g.circle(ax + aw * 0.72, ay + 74, 26, { fill: 'gold', op: 0.55 });
      for (const [x, h, k] of [[ax + 20, 44, 'sh'], [ax + 62, 30, 'dome'], [ax + 118, 54, 'sh'], [ax + 160, 34, 'dome']]) {
        if (k === 'sh') M.shikhara(g, x, ay + ah * 0.64, h * 0.5, h, 'stone', { seed: `hs${x}`, rib: 'clay' });
        else M.dome(g, x, ay + ah * 0.64, h * 0.8, h * 0.8, 'stone');
      }
      g.rect(ax - 20, ay + ah * 0.64, aw + 40, 60, { fill: 'peacock', op: 0.35 });
      for (let i = 0; i < 6; i++) g.path(String(new D().M(ax + 40 + i * 22, ay + ah * 0.7 + (i % 3) * 5).L(ax + 56 + i * 22, ay + ah * 0.7 + (i % 3) * 5)), { stroke: 'card', sw: 0.8, op: 0.6 });
      M.bird(g, ax + 128, ay + 104, 5, 'inkSoft', 0.6); M.bird(g, ax + 146, ay + 94, 4, 'inkSoft', 0.6);
      M.backBust(g, ax + aw / 2 - 6, ay + ah + 4, 172, 'man', { cloth: 'indigo', hair: 'ink' });
    },
  });
  M.mala(p, ax - 8, ay + 12, ax + aw + 8, ay + 12, 30, 5.2, 'hero-mala', { leaves: 4, tassel: true });
  M.diya(p, ax + 8, ay + ah - 4, 22);
  M.diya(p, ax + aw - 30, ay + ah - 4, 22);
  // lamps along the parapet for the night to come
  for (let i = 0; i < 9; i++) M.diya(p, wx + 30 + i * ((ww - 60) / 8) - 5, wy + 6, 11);
  M.toran(p, wx - 20, wx + ww + 20, wy + 26, { leaf: 22, seed: 'op-toran', swags: 0 });
  branch(p, [[-20, -10], [26, 30], [48, 70], [52, 118]], 'op-bl', { size: 16, leaves: 18, leafFill: ['leaf', 'leafDeep'], fill: 'leafDeep' });
  branch(p, [[615, -10], [570, 26], [548, 66], [546, 104]], 'op-br', { size: 16, leaves: 16, leafFill: ['leafDeep', 'leaf'], fill: 'leafDeep' });

  p.text(W / 2, 566, 'Ankit · born 1990', { font: 'hand', size: 15, fill: 'inkSoft', align: 'middle' });
  p.text(W / 2, 612, 'This is Ankit’s story', { font: 'display', size: 34, fill: 'ink', align: 'middle' });
  lines(p, W / 2, 646, [
    'Ankit was born in 1990, the eldest of three children of Vinod',
    'and Anita Kumar, and a brother to Neha and Rohan. His story',
    'begins long before him, with the people who lit the first lamps',
    'in this family, and it goes on in his son, Aarav.',
  ]);
  const near = [
    { id: 'vinod', name: 'Vinod', gender: 'MALE', birth: 1962, kin: 'पिताजी' },
    { id: 'anita', name: 'Anita', gender: 'FEMALE', birth: 1965, kin: 'माँ' },
    { id: 'priya', name: 'Priya', gender: 'FEMALE', birth: 1992, kin: 'पत्नी' },
    { id: 'aarav', name: 'Aarav', gender: 'MALE', birth: 2019, kin: 'बेटा' },
  ];
  near.forEach((n, i) => {
    const cx = W / 2 + (i - 1.5) * 92;
    portrait(p, cx, 740, 20, n);
    p.text(cx, 774, n.name, { font: 'strong', size: 9.5, fill: 'ink', align: 'middle' });
    p.text(cx, 787, n.kin, { font: 'hand', size: 10, fill: 'clay', align: 'middle' });
  });
  M.laceBand(p, H, 26, { fill: 'peacock', side: 'bottom' });
  folio(p, 2, { y: H - 48 });
  return p;
}

// ---------------------------------------------------------------------------------------------
// 3. Two courtyards: the grandparents' households. One side is not recorded yet, and the page
//    keeps a place for them rather than leaving a gap.

function doorway(p, x, y, w, h, { door = 'peacock', seed, open = true, wall = 'stone', painted = false }) {
  p.cut(cutShape([[x, y + 12], [x + w, y + 12], [x + w, y + h], [x, y + h]], 0.8, seed, 12), wall, { shadow: 0.25, soft: true });
  const m = Math.round(w / 14);
  for (let i = 0; i < m; i++) {
    const mx = x + (w * (i + 0.5)) / m, mw = (w / m) * 0.62;
    p.cut(String(new D().M(mx - mw / 2, y + 14).L(mx - mw / 2, y + 6).Q(mx, y - 4, mx + mw / 2, y + 6).L(mx + mw / 2, y + 14).Z()), wall, { shadow: 0.2 });
  }
  p.rect(x - 4, y + 12, w + 8, 5, { fill: 'clay' });
  for (let i = 0; i < 6; i++) M.diya(p, x + 16 + i * ((w - 32) / 5) - 4, y + 4, 9);
  const dw = w * 0.42, dh = h * 0.6, dx = x + w / 2 - dw / 2, dy = y + h - dh;
  if (painted) M.mandana(p, dx - 8, dy - 10, dw + 16, dh + 10, { band: 12 });
  p.path(M.archPath(dx - 8, dy - 10, dw + 16, dh + 10, { kind: 'cusped' }), { fill: painted ? 'card' : 'clay' });
  if (open) {
    p.path(M.archPath(dx, dy, dw, dh, { kind: 'cusped' }), { fill: p.lin(0, dy, 0, dy + dh, [[0, 'gold', 0.9], [1, 'saffron', 0.8]]) });
    p.path(poly([[dx, dy + dh * 0.28], [dx + dw * 0.3, dy + dh * 0.33], [dx + dw * 0.3, dy + dh], [dx, dy + dh]]), { fill: door });
    p.path(poly([[dx + dw, dy + dh * 0.28], [dx + dw * 0.7, dy + dh * 0.33], [dx + dw * 0.7, dy + dh], [dx + dw, dy + dh]]), { fill: door });
  } else {
    p.path(M.archPath(dx, dy, dw, dh, { kind: 'cusped' }), { fill: door });
    p.path(String(new D().M(dx + dw / 2, dy + dh * 0.2).L(dx + dw / 2, dy + dh)), { stroke: 'ink', sw: 0.8, op: 0.4 });
    for (const sd of [-1, 1]) for (let r = 0; r < 4; r++) p.circle(dx + dw / 2 + sd * dw * 0.22, dy + dh * (0.4 + r * 0.14), 1.6, { fill: 'gold' });
  }
  M.toran(p, dx - 10, dx + dw + 10, dy - 12, { leaf: 15, seed: `${seed}t` });
  if (!open) for (const cx of [x + w * 0.13, x + w * 0.87]) M.aala(p, cx, y + h - 58, 26, 42, { wall, seed: `${seed}a${cx}` });
  for (const cx of [x + w * 0.12, x + w * 0.88]) {
    M.windowCut(p, cx - 10, y + 44, 20, 30, painted ? 'shutter' : 'jaali', { frame: 'card', shutter: door });
    M.chhajja(p, cx - 12, y + 36, 24, painted ? 'clay' : 'card');
  }
  p.cut(poly([[dx - 14, y + h], [dx + dw + 14, y + h], [dx + dw + 10, y + h + 6], [dx - 10, y + h + 6]]), 'clay', { shadow: 0.2 });
  if (open) M.pot(p, x + w * 0.1, y + h - 1, 16);
}

function courtyards() {
  const p = new Page(M.PALETTE, { id: 'ct' });
  paperGround(p, 'courtyards');
  p.text(W / 2, 74, 'Two courtyards', { font: 'display', size: 36, fill: 'ink', align: 'middle' });
  p.text(W / 2, 100, 'Where Vinod and Anita grew up', { font: 'hand', size: 15, fill: 'inkSoft', align: 'middle' });
  p.cut(cutShape([[-10, 368], [W + 10, 368], [W + 10, 424], [-10, 424]], 0.6, 'floor', 20), 'paperDeep', { shadow: 0.15 });
  for (let i = 0; i < 18; i++) p.path(String(new D().M(i * 36 - 20, 424).L(i * 36 + 6, 368)), { stroke: 'stone', sw: 0.6, op: 0.6 });
  doorway(p, 40, 132, 230, 240, { door: 'peacock', seed: 'dl', open: true, wall: 'stone', painted: true });
  doorway(p, 325, 132, 230, 240, { door: 'indigo', seed: 'dr', open: false, wall: 'wash' });
  M.ladi(p, 262, 150, 333, 150, 16);
  M.tulsi(p, W / 2, 406, 50);
  M.sparklerChild(p, 236, 414, 58, { cloth: 'rani', girl: true });
  M.diya(p, 430, 384, 16);

  // father's side: a couple joined by a mauli; the grandfather who has died wears the garland on
  // his frame, and his wife, who is living, does not
  const L = [
    { id: 'raj', name: 'Raj Kumar', gender: 'MALE', birth: 1938, died: 2010, life: '1938 – 2010', kin: 'दादा' },
    { id: 'sushila', name: 'Sushila Devi', gender: 'FEMALE', birth: 1942, life: 'b. 1942', kin: 'दादी', photo: 'grandmother.jpg' },
  ];
  const lc = [92, 222];
  M.diya(p, (lc[0] + lc[1]) / 2 - 4, 500, 18);
  L.forEach((n, i) => {
    portrait(p, lc[i], 480, 38, n, { carved: true });
    p.text(lc[i], 552, n.name, { font: 'strong', size: 12, fill: 'ink', align: 'middle' });
    p.text(lc[i], 567, n.life, { font: 'text', size: 10, fill: 'inkSoft', align: 'middle' });
    p.text(lc[i], 584, n.kin, { font: 'hand', size: 12, fill: 'clay', align: 'middle' });
  });
  lines(p, 157, 618, ['Father’s side. Vinod grew up here,', 'and Meena was born to Raj Kumar', 'and Kamla Devi (1948 – 2019).'], { size: 11, lead: 16 });

  // mother's side: the closed door keeps two lamps in its own wall
  p.text(441, 470, 'नाना · नानी', { font: 'hand', size: 13, fill: 'clay', align: 'middle' });
  p.text(441, 490, 'Anita’s parents', { font: 'strong', size: 12, fill: 'ink', align: 'middle' });
  p.text(441, 508, 'Their names are still to be found.', { font: 'hand', size: 12.5, fill: 'clay', align: 'middle' });
  lines(p, 441, 552, ['Mother’s side. Two lamps are kept', 'in the wall of this house, one for', 'each of them, until someone', 'remembers.'], { size: 11, lead: 16 });

  note(p, 150, 684, 290, ['A family is two courtyards', 'learning to share one lamp.'], { angle: -2.2, seed: 'ct-note' });
  M.laceBand(p, H, 26, { fill: 'rani', side: 'bottom' });
  folio(p, 4, { y: H - 48 });
  return p;
}

// ---------------------------------------------------------------------------------------------
// 4. Our lane at dusk: the wider family, a house to each household, lights going up.

function lane() {
  const p = new Page(M.PALETTE, { id: 'ln' });
  p.rect(0, 0, W, H, { fill: 'paper' });
  p.rect(0, 0, W, 560, { fill: p.lin(0, 0, 0, 560, [[0, 'sky'], [0.55, 'marigold', 0.55], [1, 'rani', 0.5]]) });
  p.rect(0, 0, W, 560, { fill: p.lin(0, 0, 0, 200, [[0, 'paper'], [1, 'paper', 0]]) });
  p.text(44, 84, 'Our lane', { font: 'display', size: 38, fill: 'ink' });
  p.text(44, 110, 'Ankit’s wider family, door by door', { font: 'hand', size: 15, fill: 'inkSoft' });
  for (const [x, y, s] of [[300, 90, 6], [318, 80, 4.5], [336, 96, 5]]) M.bird(p, x, y, s, 'inkSoft', 0.6);
  kite(p, 470, 124, 13, 'rani', 'marigold');
  kite(p, 540, 170, 9, 'peacock', 'gold');
  for (const [x, y, s] of [[410, 200, 5], [232, 176, 4]]) M.skyLantern(p, x, y, s);
  // the town beyond, then the roofs of the lane: tanks, washing, strings of lights
  for (const [x, h, k] of [[40, 70, 'dome'], [120, 110, 'sh'], [210, 64, 'ch'], [300, 96, 'dome'], [392, 124, 'sh'], [470, 72, 'ch'], [548, 104, 'dome']]) {
    if (k === 'sh') M.shikhara(p, x, 300, h * 0.5, h, 'dayHaze', { seed: `lf${x}`, rib: 'dayMid' });
    else if (k === 'dome') M.dome(p, x, 300, h * 0.8, h * 0.8, 'dayHaze');
    else M.chhatri(p, x, 300, h * 0.75, 'dayHaze');
  }
  p.rect(-4, 296, W + 8, 12, { fill: 'dayHaze' });
  for (const [x, w, h] of [[-4, 72, 50], [68, 62, 36], [130, 84, 58], [214, 72, 42], [286, 92, 54], [378, 70, 40], [448, 72, 60], [520, 80, 46]]) {
    p.cut(cutShape([[x, 310], [x, 310 - h], [x + w, 310 - h], [x + w, 310]], 0.6, `lr${x}`, 10), 'dayMid', { shadow: 0.15 });
    for (let i = 0; i < Math.floor(w / 12); i++) p.path(String(new D().M(x + 4 + i * 12, 310 - h + 3).L(x + 4 + i * 12, 310 - h).Q(x + 7 + i * 12, 310 - h - 3, x + 10 + i * 12, 310 - h).L(x + 10 + i * 12, 310 - h + 3).Z()), { fill: 'dayMid' });
  }

  const houses = [
    { x: 14, w: 142, h: 236, fill: 'indigo', door: 'saffron', shutter: 'saffron', roof: 'chhatri', plate: 'Meena', kin: 'बुआ · father’s half-sister', people: [['Meena Kumari', 'b. 1970']] },
    { x: 156, w: 140, h: 262, fill: 'saffron', door: 'peacock', shutter: 'peacock', mandana: true, plate: 'Bhola Prasad', kin: 'grandfather’s brother', people: [['Bhola Prasad', '1935 – 1999'], ['Arun Prasad', 'b. 1966']] },
    { x: 296, w: 146, h: 244, fill: 'peacock', door: 'marigold', shutter: 'marigold', roof: 'eave', plate: 'Sharma', kin: 'ससुराल · Priya’s family', people: [['Gopal Sharma', '1940 – 2008'], ['Lata Sharma', 'b. 1944']] },
    { x: 442, w: 140, h: 272, fill: 'rani', door: 'indigo', shutter: 'indigo', mandana: true, plate: 'Lal', kin: 'great-grandfather’s brothers', people: [['Ram Lal', '1900 – 1968'], ['Hari Lal', '1902 – 1970']] },
  ];
  const base = 560;
  M.waterTank(p, 60, base - 236 + 2, 20);
  M.waterTank(p, 490, base - 272 + 2, 22);
  M.clothesline(p, 100, base - 236 + 6, 180, base - 262 + 6, 'wash1');
  M.clothesline(p, 330, base - 244 + 6, 420, base - 272 + 8, 'wash2', ['card', 'indigo', 'marigold', 'rani']);
  for (const hs of houses) {
    M.haveli(p, hs.x, base, hs.w, hs.h, hs.fill, { trim: 'card', door: hs.door, seed: hs.plate, windows: 3, jharokha: true, shutter: hs.shutter, mandanaDoor: hs.mandana, roof: hs.roof });
    const top = base - hs.h;
    for (let i = 0; i < 7; i++) M.diya(p, hs.x + 10 + i * ((hs.w - 20) / 6) - 3.5, top + 3, 7.5);
    const bx = hs.x + hs.w / 2;
    // a nameplate beside the door and the otla, the raised step every door has
    const pw = Math.max(34, hs.plate.length * 5.4 + 12);
    p.cut(cutShape([[bx - pw / 2, base - 104], [bx + pw / 2, base - 104], [bx + pw / 2, base - 90], [bx - pw / 2, base - 90]], 0.3, `${hs.plate}n`, 8), 'card', { shadow: 0.25 });
    p.rect(bx - pw / 2 + 2, base - 102, pw - 4, 10, { stroke: 'gold', sw: 0.5 });
    p.text(bx, base - 94, hs.plate, { font: 'strong', size: 8, fill: 'ink', align: 'middle' });
    p.cut(poly([[bx - 30, base], [bx + 30, base], [bx + 34, base + 7], [bx - 34, base + 7]]), 'stone', { shadow: 0.25 });
    M.toran(p, bx - 26, bx + 26, base - 68, { leaf: 10, seed: `${hs.plate}t` });
  }
  M.ladi(p, -4, 330, 300, 318, 24);
  M.ladi(p, 290, 318, 600, 332, 26, { colours: ['flame', 'marigold', 'rani', 'gold'] });
  M.ladi(p, 20, 408, 580, 404, 18, { colours: ['gold', 'peacock', 'rani', 'flame'] });

  p.cut(cutShape([[-10, base + 7], [W + 10, base + 7], [W + 10, base + 36], [-10, base + 36]], 0.6, 'street', 20), 'stone', { shadow: 0.25 });
  for (const hs of houses) M.kolam(p, hs.x + hs.w / 2, base + 22, 18, { tilt: 0.36 });
  M.sparklerChild(p, 150, base + 30, 64, { cloth: 'marigold', girl: false });
  M.sparklerChild(p, 452, base + 30, 58, { cloth: 'rani', girl: true, flip: true });

  houses.forEach((hs) => {
    const cx = hs.x + hs.w / 2;
    p.text(cx, 630, hs.kin, { font: 'hand', size: 11, fill: 'clay', align: 'middle' });
    hs.people.forEach(([n, life], i) => {
      p.text(cx, 654 + i * 30, n, { font: 'strong', size: 10.5, fill: 'ink', align: 'middle' });
      p.text(cx, 667 + i * 30, life, { font: 'text', size: 9.5, fill: 'inkSoft', align: 'middle' });
    });
  });
  p.text(W / 2, 760, 'Every door on this lane opens to family.', { font: 'hand', size: 16, fill: 'ink', align: 'middle' });
  M.laceBand(p, H, 26, { fill: 'indigo', side: 'bottom' });
  folio(p, 9, { y: H - 48 });
  return p;
}

// ---------------------------------------------------------------------------------------------
// 5. Everyone: the register. Calm, balanced, and nobody left out.

function register() {
  const p = new Page(M.PALETTE, { id: 'rg' });
  paperGround(p, 'register');
  M.laceBand(p, 0, 26, { fill: 'clay', side: 'top' });
  p.text(44, 104, 'Everyone in our family', { font: 'display', size: 32, fill: 'ink' });
  p.text(44, 128, 'Twenty-three people, five generations', { font: 'hand', size: 14, fill: 'inkSoft' });

  const groups = [
    ['Ankit’s own family', [['Ankit Kumar', '1990', 2, 'm', 1990], ['Priya Sharma', '1992', 7, 'f', 1992], ['Aarav Kumar', '2019', 8, 'm', 2019]]],
    ['Parents, brother and sister', [['Vinod Kumar', '1962', 5, 'm', 1962], ['Anita Kumar', '1965', 5, 'f', 1965], ['Neha Kumar', '1993', 6, 'f', 1993], ['Rohan Kumar', '1998', 6, 'm', 1998]]],
    ['Father’s side', [['Raj Kumar', '1938 – 2010', 4, 'm', 1938, 2010], ['Sushila Devi', '1942', 4, 'f', 1942], ['Kamla Devi', '1948 – 2019', 4, 'f', 1948, 2019], ['Meena Kumari', '1970', 9, 'f', 1970],
      ['Shyam Lal', '1905 – 1978', 3, 'm', 1905, 1978], [null, '1909 – 1981', 12, 'f', 1909, 1981, 'Shyam Lal’s wife'], ['Bhola Prasad', '1935 – 1999', 9, 'm', 1935, 1999], ['Arun Prasad', '1966', 9, 'm', 1966], ['Ram Lal', '1900 – 1968', 9, 'm', 1900, 1968], ['Hari Lal', '1902 – 1970', 9, 'm', 1902, 1970]]],
    ['Priya’s family', [['Gopal Sharma', '1940 – 2008', 9, 'm', 1940, 2008], ['Lata Sharma', '1944', 9, 'f', 1944]]],
    ['Also in the family', [['Ishwar Dutt', '1928 – 1994', 11, 'm', 1928, 1994], ['Savitri Bai', '1931', 11, 'f', 1931], ['Mohan Lal', '1955', 11, 'm', 1955], [null, '', 12, 'u', undefined, undefined, 'A child in a 1955 photograph']]],
  ];
  // one flowing list, cut where the two columns balance; a section that crosses says so
  const flat = [];
  for (const [title, rows] of groups) { flat.push({ head: title }); rows.forEach((r) => flat.push({ row: r, group: title })); }
  const colX = [44, 312], colW = 236, top = 172, pitch = 22;
  const heights = flat.map((f) => (f.head ? 34 : pitch));
  const total = heights.reduce((a, b) => a + b, 0);
  let acc = 0, cut = flat.length;
  for (let i = 0; i < flat.length; i++) { acc += heights[i]; if (acc >= total / 2 + 30) { cut = i + 1; break; } }
  const drawCol = (items, x, continued) => {
    let y = top;
    if (continued && !items[0].head) items = [{ head: `${continued}, continued` }, ...items];
    for (const it of items) {
      if (it.head) {
        if (y > top) y += 4;
        p.text(x, y, it.head, { font: 'display', size: 13.5, fill: 'clay' });
        p.path(String(new D().M(x, y + 7).L(x + colW, y + 7)), { stroke: 'gold', sw: 0.8 });
        p.circle(x + colW, y + 7, 1.8, { fill: 'gold' });
        y += 30;
        continue;
      }
      const [name, life, page, g, birth, died, rel] = it.row;
      const person = { id: name ?? rel, name, gender: g === 'f' ? 'FEMALE' : g === 'm' ? 'MALE' : 'UNSPECIFIED', birth, died };
      portrait(p, x + 11, y - 4, 11, person);
      const label = name ?? rel;
      p.text(x + 28, y, label, { font: name ? 'strong' : 'hand', size: name ? 10 : 10.5, fill: name ? 'ink' : 'brass' });
      const lifeText = life ? (died ? life : `b. ${life}`) : '';
      const lifeX = x + colW - 22;
      p.text(lifeX, y, lifeText, { font: 'text', size: 9.2, fill: 'inkSoft', align: 'end' });
      const from = x + 28 + label.length * 5.3 + 6, to = lifeX - 56;
      if (to > from) p.path(String(new D().M(from, y - 2).L(to, y - 2)), { stroke: 'inkSoft', sw: 0.9, dash: [0.1, 3.2], cap: 'round', op: 0.55 });
      p.text(x + colW, y, String(page), { font: 'strong', size: 9.5, fill: 'clay', align: 'end' });
      y += pitch;
    }
    return y;
  };
  const leftEnd = drawCol(flat.slice(0, cut), colX[0]);
  const lastHead = [...flat.slice(0, cut)].reverse().find((f) => f.head)?.head;
  drawCol(flat.slice(cut), colX[1], flat[cut]?.head ? null : lastHead);

  // a strip across the foot: the tulsi, a deepstambh with its lamps, a thali of diyas
  const gy = 790;
  p.cut(cutShape([[-10, gy], [W + 10, gy], [W + 10, H + 10], [-10, H + 10]], 0.6, 'rg-floor', 20), 'paperDeep', { shadow: 0.15 });
  for (let i = 0; i < 18; i++) p.path(String(new D().M(i * 36 - 20, H).L(i * 36 + 6, gy)), { stroke: 'stone', sw: 0.6, op: 0.5 });
  M.tulsi(p, 150, gy + 6, 78);
  const dx = W / 2, db = gy + 8, top2 = 596;
  p.cut(poly([[dx - 20, db], [dx + 20, db], [dx + 15, db - 12], [dx - 15, db - 12]]), 'stone', { shadow: 0.2 });
  p.cut(poly([[dx - 8, db - 12], [dx + 8, db - 12], [dx + 5, top2 + 20], [dx - 5, top2 + 20]]), 'stone', { shadow: 0.25, soft: true });
  for (let i = 0; i < 7; i++) {
    const yy = db - 28 - i * ((db - top2 - 56) / 6), half = 28 - i * 3;
    p.cut(poly([[dx - half, yy], [dx + half, yy], [dx + half - 3, yy + 4], [dx - half + 3, yy + 4]]), 'clay', { shadow: 0.2 });
    for (const sd of [-1, 1]) M.diya(p, dx + sd * (half - 6) - 3, yy - 1, 9);
  }
  M.lotusBud(p, dx, top2 + 20, 9);
  const tx = W - 150, ty = gy + 2;
  p.cut(smooth(ellipsePts(tx, ty, 46, 11, 24)), 'gold', { shadow: 0.25 });
  p.path(smooth(ellipsePts(tx, ty, 38, 8, 20)), { stroke: 'saffron', sw: 0.8 });
  for (const [ox, oy] of [[-24, -2], [0, -5], [24, -2]]) M.diya(p, tx + ox - 4, ty + oy, 16);
  for (let i = 0; i < 6; i++) M.marigold(p, tx - 30 + i * 12, ty + 4 + (i % 2) * 2, 3.4, `thali${i}`);
  folio(p, 10, { y: H - 16 });
  return p;
}

// ---------------------------------------------------------------------------------------------
// 6. Still to be found: the names nobody recorded, each with a lamp kept in a niche.

function remembrance() {
  const p = new Page(M.PALETTE, { id: 'rm' });
  p.rect(0, 0, W, H, { fill: p.lin(0, 0, 0, H, [[0, 'deep'], [0.5, 'night'], [1, 'glow']]) });
  M.stars(p, 'remember', 110, { x: 0, y: 30, w: W, h: 210 });
  for (const [x, y, s] of [[96, 180, 6], [480, 150, 7], [410, 214, 4.5], [170, 226, 4]]) M.skyLantern(p, x, y, s);
  p.text(W / 2, 96, 'Still to be found', { font: 'display', size: 36, fill: 'card', align: 'middle' });
  p.text(W / 2, 124, 'Two names in our family are waiting to be remembered.', { font: 'hand', size: 15, fill: 'flame', align: 'middle' });
  const wy = 250, wh = 380;
  p.cut(cutShape([[-10, wy + 14], [W + 10, wy + 14], [W + 10, wy + wh], [-10, wy + wh]], 0.8, 'rwall', 16), 'glow', { shadow: 0.4, soft: true, shadowFill: 'deep' });
  for (let i = 0; i < 22; i++) {
    const mx = (W * (i + 0.5)) / 22, mw = (W / 22) * 0.64;
    p.cut(String(new D().M(mx - mw / 2, wy + 16).L(mx - mw / 2, wy + 6).Q(mx, wy - 5, mx + mw / 2, wy + 6).L(mx + mw / 2, wy + 16).Z()), 'glow', { shadow: 0.3, shadowFill: 'deep' });
  }
  p.rect(-6, wy + 14, W + 12, 5, { fill: 'night' });
  const niches = [
    { cx: 172, title: 'Shyam Lal’s wife', rel: 'Ankit’s great-grandmother · 1909 – 1981', note: ['Remembered as a fierce cook.'] },
    { cx: 423, title: 'A child, name unknown', rel: 'not yet placed in the tree', note: ['Third from the left in the', '1955 wedding photograph.'] },
  ];
  for (const n of niches) {
    const ax = n.cx - 62, ay = wy + 60, aw = 124, ah = 176;
    p.circle(n.cx, ay + ah * 0.66, 120, { fill: p.rad(n.cx, ay + ah * 0.66, 120, [[0, 'gold', 0.22], [0.5, 'gold', 0.08], [1, 'gold', 0]]) });
    M.archFrame(p, ax, ay, aw, ah, {
      band: 12, stone: 'dusk', trim: 'brass', eave: false, seed: n.title,
      inner: (g) => {
        g.rect(ax - 10, ay - 10, aw + 20, ah + 20, { fill: g.lin(0, ay, 0, ay + ah, [[0, 'night'], [0.6, 'clay'], [1, 'saffron']]) });
        M.glowDiscs(g, n.cx, ay + ah - 40, 80, { strength: 1.5 });
        M.diya(g, n.cx - 12, ay + ah - 18, 36, { unknown: true });
      },
    });
    M.mala(p, ax - 4, ay - 4, ax + aw + 4, ay - 4, 22, 3.6, `${n.title}m`, { leaves: 2, tassel: true });
    p.text(n.cx, ay + ah + 58, n.title, { font: 'strong', size: 12.5, fill: 'card', align: 'middle' });
    p.text(n.cx, ay + ah + 74, n.rel, { font: 'text', size: 9.5, fill: 'flame', align: 'middle' });
    n.note.forEach((l, i) => p.text(n.cx, ay + ah + 96 + i * 15, l, { font: 'hand', size: 12, fill: 'gold', align: 'middle' }));
  }
  // the courtyard floor, a rangoli laid on it, petals
  p.cut(cutShape([[-10, wy + wh], [W + 10, wy + wh], [W + 10, H + 10], [-10, H + 10]], 0.8, 'rfloor', 16), 'dusk', { shadow: 0.45, dy: -1.5, soft: true, shadowFill: 'deep' });
  p.rect(0, wy + wh, W, H - wy - wh, { fill: p.lin(0, wy + wh, 0, H, [[0, 'glow', 0.2], [1, 'night', 0.75]]) });
  p.group((g) => M.rangoli(g, 0, 0, 80, 'remember', { ground: 'paperDeep', colours: ['gold', 'saffron', 'card', 'rani'] }), { tf: [1, 0, 0, 0.3, W / 2, 792], op: 0.75 });
  petals(p, 'rmp', 18, { x: 30, y: 758, w: W - 60, h: 70 }, { x: 190, y: 752, w: 220, h: 80 });
  lines(p, W / 2, 686, ['Some names are missing, but they are not forgotten.', 'A lamp is kept for each of them, until someone remembers.'], { font: 'hand', size: 15, lead: 21, fill: 'flame' });
  p.text(W / 2, 740, 'Perhaps someone reading this remembers.', { font: 'text', size: 10.5, fill: 'card', align: 'middle' });
  folio(p, 12, { ink: 'flame' });
  return p;
}

// ---------------------------------------------------------------------------------------------
// The system sheet: palette, type, people and frames, for the review.

function system() {
  const p = new Page(M.PALETTE, { id: 'sy' });
  paperGround(p, 'system');
  M.laceBand(p, 0, 26, { fill: 'peacock', side: 'top' });
  p.text(44, 84, 'Aangan · the system', { font: 'display', size: 28, fill: 'ink' });
  Object.keys(M.PALETTE).forEach((t, i) => {
    const x = 44 + (i % 9) * 58, y = 102 + Math.floor(i / 9) * 50;
    p.cut(cutShape([[x, y], [x + 46, y], [x + 46, y + 26], [x, y + 26]], 0.5, t, 8), t, { shadow: 0.2 });
    p.text(x, y + 38, t, { font: 'text', size: 8, fill: 'inkSoft' });
  });
  let y = 276;
  for (const [role, size, sample] of [['display', 28, 'Two courtyards · शुभ दीपावली'], ['hand', 16, 'A lamp is kept for each of them · दादी'], ['strong', 13, 'Sushila Devi · सुशीला देवी'], ['text', 12, 'Ankit was born in 1990, the eldest of three children.']]) {
    p.text(44, y, role, { font: 'text', size: 8, fill: 'clay' });
    p.text(110, y, sample, { font: role, size, fill: 'ink' });
    y += size + 16;
  }
  const people = [
    ['child', 'FEMALE', 2018], ['child', 'MALE', 2016], ['youth', 'FEMALE', 1999], ['youth', 'MALE', 1997], ['adult', 'FEMALE', 1972], ['adult', 'MALE', 1968],
    ['elder', 'FEMALE', 1944], ['elder', 'MALE', 1940], ['adult', 'UNSPECIFIED', 1980], ['departed', 'FEMALE', 1930, 2001],
  ];
  people.forEach(([stage, g, birth, died], i) => {
    const cx = 74 + (i % 6) * 90, cy = 448 + Math.floor(i / 6) * 112;
    portrait(p, cx, cy, 32, { id: `s${i}`, name: 'x', gender: g, birth, died });
    p.text(cx, cy + (died ? 64 : 48), died ? 'departed: mala on the frame' : `${stage}, ${g.toLowerCase()}`, { font: 'text', size: 8, fill: 'inkSoft', align: 'middle' });
  });
  portrait(p, 434, 560, 32, { id: 'ph', name: 'Sushila Devi', gender: 'FEMALE', birth: 1942, photo: 'grandmother.jpg' });
  p.text(434, 612, 'photograph, never tinted', { font: 'text', size: 8, fill: 'inkSoft', align: 'middle' });
  M.aala(p, 524, 586, 40, 58, { seed: 'sys-aala' });
  p.text(524, 612, 'name not known', { font: 'text', size: 8, fill: 'inkSoft', align: 'middle' });
  M.archFrame(p, 62, 656, 84, 108, { band: 10, seed: 'sys-arch', eave: false, inner: (g) => { g.rect(52, 646, 104, 128, { fill: 'sky' }); M.backBust(g, 104, 766, 96, 'woman', { cloth: 'peacock', drape: 'marigold' }); } });
  p.text(104, 800, 'hero with no photograph', { font: 'text', size: 8, fill: 'inkSoft', align: 'middle' });
  M.sittingBack(p, 236, 770, 90, 'elder', { fill: 'ink', drape: 'sindoor', rim: 'gold' });
  M.sparklerChild(p, 300, 770, 60, { cloth: 'rani' });
  p.text(268, 800, 'people in scenes, seen from behind', { font: 'text', size: 8, fill: 'inkSoft', align: 'middle' });
  lines(p, 470, 690, ['Faceless on purpose: a face the', 'record doesn’t hold is never', 'invented. Photographs are', 'never tinted.'], { font: 'hand', size: 12, lead: 16, fill: 'ink' });
  return p;
}

const PAGES = { cover, opening, courtyards, lane, register, remembrance, system };

const out = process.argv[2] ?? 'out';
const want = process.argv.slice(3);
mkdirSync(out, { recursive: true });
for (const [name, fn] of Object.entries(PAGES)) {
  if (want.length && !want.includes(name)) continue;
  writeFileSync(`${out}/${name}.svg`, fn().svg());
  console.log(`${out}/${name}.svg`);
}
