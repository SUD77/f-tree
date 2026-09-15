/*
 * The six Aangan style frames (#240), drawn with the sample family (site/playground/sample-family.ftree).
 * These are the approval gate for the storybook: hand-placed compositions of the kit's motifs,
 * built only from what Book format 2 will carry, so a frame that looks right is one the painters
 * can actually draw.
 *
 *   node site/book/art/style-frames/frames.mjs [out-dir] [page ...]
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { Page, D, poly, smooth, cutShape, ellipsePts, resample, wobble, rng, translate } from './kit.mjs';
import * as M from './motifs.mjs';

const W = 595, H = 842;

// ---------------------------------------------------------------------------------------------
// 1. Cover: the river at night. A lamp afloat for each person, the eldest furthest away, drifting
//    toward the family on the near steps. The far bank is a town of lit windows.

/** A far block of the town: a cut skyline of roofs with a scatter of lit windows. */
function town(p, x, base, w, h, fill, seed, { lights = 'flame', density = 0.5 } = {}) {
  const rand = rng(seed);
  const top = base - h;
  const pts = [[x, base], [x, top + 4]];
  const m = Math.max(3, Math.round(w / 9));
  for (let i = 0; i <= m; i++) pts.push([x + (w * i) / m, top + (i % 2 ? 0 : 3)]);
  pts.push([x + w, base]);
  p.cut(poly(wobble(resample(pts, 8), 0.4, seed)), fill, { shadow: 0.25 });
  const cols = Math.max(2, Math.floor(w / 9)), rows = Math.max(1, Math.floor((h - 10) / 11));
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (rand() > density) continue;
    const wx = x + 4 + (c * (w - 8)) / cols, wy = top + 9 + r * 11;
    p.rect(wx, wy, 2.4, 3.6, { fill: lights, op: 0.55 + rand() * 0.4, r: 0.8 });
  }
}

/** A branch of cut leaves reaching in from the page edge: the lightbox's nearest layer. */
function branch(p, pts, seed, { fill = 'deep', leafFill = ['deep', 'night'], leaves = 22, size = 16, rim } = {}) {
  const rand = rng(seed);
  const d = smooth(pts, { closed: false });
  p.path(d, { stroke: fill, sw: size * 0.32, cap: 'round' });
  for (let i = 0; i < leaves; i++) {
    const t = rand(), k = Math.min(pts.length - 2, Math.floor(t * (pts.length - 1)));
    const a = pts[k], b = pts[k + 1], u = t * (pts.length - 1) - k;
    const x = a[0] + (b[0] - a[0]) * u, y = a[1] + (b[1] - a[1]) * u;
    const ang = (rand() - 0.5) * 140 + (rand() > 0.5 ? 30 : -30);
    M.mangoLeaf(p, x, y, size * (0.9 + rand() * 0.8), ang, leafFill[i % leafFill.length], { rib: false, shadow: 0 });
  }
  if (rim) p.path(d, { stroke: rim, sw: 0.6, op: 0.35 });
}

function cover() {
  const p = new Page(M.PALETTE, { id: 'cv' });
  const horizon = 462;
  p.rect(0, 0, W, H, { fill: p.lin(0, 0, 0, horizon, [[0, 'deep'], [0.36, 'night'], [0.74, 'glow'], [1, 'dusk']]) });
  p.circle(W / 2, horizon, 400, { fill: p.rad(W / 2, horizon, 400, [[0, 'saffron', 0.36], [0.4, 'rani', 0.12], [1, 'rani', 0]]) });
  M.stars(p, 'Kumar', 160, { x: 0, y: 40, w: W, h: 320 });
  for (const [x, y, s] of [[150, 372, 6.5], [452, 356, 7.5], [512, 410, 4.5], [104, 424, 4], [392, 120, 3.6], [206, 96, 3.2]]) M.skyLantern(p, x, y, s);

  // 1 far temples, hazed and backlit
  for (const [x, h, k] of [[26, 58, 'dome'], [80, 80, 'sh'], [136, 50, 'ch'], [190, 66, 'dome'], [252, 90, 'sh'], [306, 56, 'dome'], [356, 76, 'sh'], [414, 48, 'ch'], [466, 84, 'sh'], [526, 60, 'dome'], [578, 74, 'sh']]) {
    if (k === 'sh') M.shikhara(p, x, horizon - 4, h * 0.48, h, 'haze', { flag: h > 82, seed: `f${x}`, rib: 'glow' });
    else if (k === 'dome') M.dome(p, x, horizon - 4, h * 0.8, h * 0.8, 'haze');
    else M.chhatri(p, x, horizon - 4, h * 0.75, 'haze');
  }
  // 2 the town on the far bank
  const blocks = [[-6, 50, 50], [44, 38, 38], [82, 56, 58], [138, 44, 44], [182, 60, 36], [242, 40, 54], [282, 56, 42], [338, 46, 60], [384, 58, 40], [442, 42, 52], [484, 60, 44], [544, 58, 56]];
  for (const [x, w, h] of blocks) town(p, x, horizon + 12, w, h, 'glow', `t${x}`);
  // 3 the far ghat, its steps and umbrellas
  for (let i = 0; i < 3; i++) p.cut(cutShape([[-10, horizon + 10 + i * 6], [W + 10, horizon + 10 + i * 6], [W + 10, horizon + 17 + i * 6], [-10, horizon + 17 + i * 6]], 0.3, `fs${i}`, 30), i % 2 ? 'night' : 'glow', { shadow: 0.3 });
  for (const [x, c] of [[70, 'marigold'], [196, 'rani'], [330, 'marigold'], [452, 'saffron'], [540, 'rani']]) M.umbrella(p, x, horizon + 12, 16, c, 'gold');

  // 4 the river, its reflections, and the lamps
  const river = horizon + 28, bank = 742;
  p.rect(0, river, W, bank - river, { fill: p.lin(0, river, 0, bank, [[0, 'dusk'], [0.22, 'glow'], [0.6, 'night'], [1, 'deep']]) });
  const rr = rng('ripples');
  for (let i = 0; i < 80; i++) {
    const x = rr() * W, y = river + 3 + rr() * 64, l = 3 + rr() * 16;
    p.rect(x, y, 1.1, l * 0.7, { fill: 'gold', op: 0.12 + rr() * 0.22 });
  }
  for (let i = 0; i < 50; i++) {
    const y = river + 10 + Math.pow(rr(), 0.8) * (bank - river - 14), x = rr() * W, l = 10 + ((y - river) / (bank - river)) * 60;
    p.path(String(new D().M(x, y).Q(x + l / 2, y - 1.4, x + l, y)), { stroke: 'flame', sw: 0.6, op: 0.07 + rr() * 0.1 });
  }
  const bx = 70, byb = 560, bs = 28;
  p.path(String(new D().M(bx - bs, byb).Q(bx, byb + bs * 0.3, bx + bs, byb - bs * 0.08).L(bx + bs * 0.7, byb + bs * 0.06).Q(bx, byb + bs * 0.2, bx - bs * 0.75, byb + bs * 0.05).Z()), { fill: 'deep' });
  p.path(String(new D().M(bx + bs * 0.3, byb - 2).L(bx + bs * 0.28, byb - bs * 0.95)), { stroke: 'deep', sw: 1.6 });
  p.circle(bx + bs * 0.28, byb - bs * 1.02, bs * 0.1, { fill: 'deep' });

  const people = 23, unknown = new Set([2, 21]);
  p.circle(372, 650, 260, { fill: p.rad(372, 650, 260, [[0, 'gold', 0.26], [0.45, 'saffron', 0.1], [1, 'saffron', 0]]) });
  const lr = rng('flotilla');
  const lamps = [];
  for (let i = 0; i < people; i++) {
    const t = (i + 0.5) / people;
    const y = river + 14 + Math.pow(t, 1.6) * (bank - river - 26);
    const sway = Math.sin(t * Math.PI * 1.15 + 0.7) * (40 + t * 70);
    const lane = (i % 2 ? 1 : -1) * (4 + t * 58) * (0.55 + lr() * 0.5);
    lamps.push({ x: 392 - t * 20 + sway * 0.8 + lane, y, s: 5.5 + Math.pow(t, 1.6) * 50, unknown: unknown.has(i) });
  }
  lamps.sort((a, b) => a.y - b.y);
  for (const l of lamps) M.floatingDiya(p, l.x, l.y, l.s, { unknown: l.unknown });

  // 5 the near bank in silhouette: three steps whose top faces catch the lamps' light
  for (const [i, y] of [[0, bank], [1, bank + 34], [2, bank + 70]]) {
    p.cut(cutShape([[-10, y + 6 - i], [W + 10, y - 4 + i], [W + 10, H + 10], [-10, H + 10]], 1, `bank${i}`, 14), 'deep', { shadow: 0.55, dy: -1.5, dx: 0, soft: true, shadowFill: 'deep' });
    p.path(cutShape([[-10, y + 6 - i], [W + 10, y - 4 + i], [W + 10, y + 12 + i], [-10, y + 20 - i]], 0.6, `top${i}`, 20), { fill: p.lin(0, y, 0, y + 20, [[0, 'dusk', 0.75 - i * 0.18], [1, 'deep', 0]]) });
    p.path(String(new D().M(-10, y + 6 - i).L(W + 10, y - 4 + i)), { stroke: 'gold', sw: 0.8, op: 0.5 - i * 0.12 });
  }
  p.circle(446, 800, 130, { fill: p.rad(446, 800, 130, [[0, 'gold', 0.22], [1, 'gold', 0]]) });
  p.group((g) => M.rangoli(g, 0, 0, 86, 'Kumar', { ground: 'paperDeep' }), { tf: [1, 0, 0, 0.4, 446, 802], op: 0.94 });
  M.sittingBack(p, 70, bank + 8, 88, 'elder', { drape: 'sindoor', fill: 'deep' });
  M.sittingBack(p, 116, bank + 8, 62, 'child', { drape: 'marigold', fill: 'deep' });
  M.sittingBack(p, 162, bank + 8, 92, 'woman', { drape: 'saffron', fill: 'deep' });
  // a brass lota and a basket of marigolds beside them
  const lx = 206, ly = bank + 6;
  p.path(String(new D().M(lx - 11, ly).C(lx - 16, ly - 14, lx - 8, ly - 22, lx - 4, ly - 24).L(lx - 5, ly - 30).L(lx + 5, ly - 30).L(lx + 4, ly - 24).C(lx + 8, ly - 22, lx + 16, ly - 14, lx + 11, ly).Z()), { fill: 'gold', stroke: 'saffron', sw: 0.6 });
  p.path(String(new D().M(lx - 10, ly - 14).Q(lx, ly - 11, lx + 10, ly - 14)), { stroke: 'saffron', sw: 0.8 });
  p.path(String(new D().M(lx + 18, ly).Q(lx + 36, ly + 8, lx + 54, ly).L(lx + 50, ly - 12).L(lx + 22, ly - 12).Z()), { fill: 'clay', stroke: 'gold', sw: 0.5 });
  for (let i = 0; i < 7; i++) M.marigold(p, lx + 25 + (i % 4) * 7.5, ly - 13 - Math.floor(i / 4) * 5, 4.4, `bk${i}`, { shadow: 0.2 });
  const pr = rng('petals');
  for (let i = 0; i < 26; i++) {
    const x = 250 + pr() * (W - 270), y = bank + 18 + pr() * (H - bank - 26);
    if (x > 340 && x < 552 && y > 772 && y < 832) continue;
    M.marigold(p, x, y, 2.2 + pr() * 1.6, `pt${i}`, { shadow: 0.25 });
  }

  // 6 the nearest layer: branches reaching in at the edges
  branch(p, [[-20, 70], [30, 110], [58, 170], [66, 250], [50, 330]], 'bl', { size: 17, leaves: 26 });
  branch(p, [[-20, 300], [22, 336], [36, 400]], 'bl2', { size: 14, leaves: 12 });
  branch(p, [[615, 60], [560, 104], [540, 160], [548, 230]], 'br', { size: 17, leaves: 22 });
  branch(p, [[615, 250], [574, 296], [566, 350]], 'br2', { size: 13, leaves: 10 });

  M.toran(p, -12, W + 12, 14, { leaf: 30, seed: 'cover-toran', swags: 5 });
  M.kandil(p, 96, 14, 128, 27, { body: 'rani', trim: 'marigold', seed: 'k1' });
  M.kandil(p, 502, 14, 178, 23, { body: 'peacock', trim: 'gold', seed: 'k2' });

  p.text(W / 2, 234, 'शुभ दीपावली', { font: 'display', size: 56, fill: 'gold', align: 'middle' });
  p.text(W / 2, 280, 'from the Kumar family', { font: 'display', size: 25, fill: 'card', align: 'middle' });
  p.text(W / 2, 316, 'Twenty-three lamps, one for each of us.', { font: 'hand', size: 16, fill: 'flame', align: 'middle', op: 0.95 });
  p.text(22, H - 14, 'Made with f-tree', { font: 'text', size: 7.5, fill: 'card', op: 0.6 });
  return p;
}

// ---------------------------------------------------------------------------------------------
// Shared furniture for the day pages

/** Photographs stand-ins for the frames live outside the repo (FTREE_FRAME_PHOTOS); without them
 *  the portrait falls back to its avatar, exactly as the book will for a person with no photo. */
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
function folio(p, n, { ink = 'inkSoft', credit = true } = {}) {
  const right = n % 2 === 1;
  const x = right ? W - 44 : 44;
  M.diya(p, right ? x - 16 : x + 2, H - 30, 11);
  p.text(right ? x : x + 16, H - 25.5, String(n), { font: 'strong', size: 8.5, fill: ink, align: right ? 'end' : 'start' });
  if (credit) p.text(right ? 44 : W - 44, H - 25.5, 'Made with f-tree', { font: 'text', size: 7, fill: ink, align: right ? 'start' : 'end', op: 0.7 });
}

/** A torn paper note, tilted, with a strip of tape: the book's handwritten voice. */
function note(p, x, y, w, lines, { angle = -3, size = 13.5, seed = 'note', fill = 'card', ink = 'ink' } = {}) {
  const h = lines.length * size * 1.35 + size * 1.1;
  p.group((g) => {
    const pts = [[0, 0], [w, 0], [w, h], [0, h]];
    g.cut(cutShape(pts, 1.1, seed, 7), fill, { shadow: 0.2, soft: true, dx: 0.8, dy: 1.3 });
    lines.forEach((l, i) => g.text(w / 2, size * 1.25 + i * size * 1.35, l, { font: 'hand', size, fill: ink, align: 'middle' }));
    g.group((t) => t.rect(-18, -6, 36, 12, { fill: 'gold', op: 0.45 }), { tf: [Math.cos(0.1), Math.sin(0.1), -Math.sin(0.1), Math.cos(0.1), w / 2, -1] });
  }, { tf: M.rotate ? undefined : [Math.cos(angle * Math.PI / 180), Math.sin(angle * Math.PI / 180), -Math.sin(angle * Math.PI / 180), Math.cos(angle * Math.PI / 180), x, y] });
}

/** A person in a medallion: their photograph, or the avatar their record chooses. */
function portrait(p, cx, cy, r, person, o = {}) {
  const look = M.avatarFor(person);
  const href = person.photo ? photo(person.photo) : null;
  M.medallion(p, cx, cy, r, {
    departed: person.died !== undefined && person.died !== null,
    unknown: !person.name,
    seed: person.id ?? person.name,
    ground: person.name ? 'paperDeep' : 'card',
    petals: o.petals ?? true,
    inner: (g) => {
      if (!person.name) { M.diya(g, cx - r * 0.15, cy + r * 0.25, r * 0.9); return; }
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

/** A patang on its string, tail fluttering. */
function kite(p, x, y, s, fill, trim, seed) {
  const rand = rng(seed);
  p.path(smooth([[x, y + s], [x - s * 0.8, y + s * 2.2], [x - s * 0.4, y + s * 3.6], [x - s * 1.6, y + s * 5.4]], { closed: false }), { stroke: 'inkSoft', sw: 0.5, op: 0.6 });
  p.cut(poly([[x, y - s], [x + s * 0.85, y], [x, y + s], [x - s * 0.85, y]]), fill, { shadow: 0.18 });
  p.path(poly([[x, y - s], [x + s * 0.85, y], [x, y]]), { fill: trim, op: 0.9 });
  p.path(String(new D().M(x, y - s).L(x, y + s)), { stroke: 'card', sw: 0.5, op: 0.7 });
  p.cut(poly([[x, y + s], [x + s * 0.3, y + s * 1.45], [x - s * 0.3, y + s * 1.45]]), trim, { shadow: 0.15 });
}

// ---------------------------------------------------------------------------------------------
// 2. Opening: the featured person in the window of a haveli. The page never says "featured".

function opening() {
  const p = new Page(M.PALETTE, { id: 'op' });
  paperGround(p, 'opening');
  // the wall: sandstone, its cornice, and two niches
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
    const y = wy + 42 + row * 32;
    if (y > wy + wh - 10) break;
    p.path(String(new D().M(wx + 4, y).L(wx + ww - 4, y)), { stroke: 'clay', sw: 0.5, op: 0.22 });
    for (let x = wx + (row % 2 ? 26 : 0) + jr() * 10; x < wx + ww; x += 52) p.path(String(new D().M(x, y).L(x, y + 32)), { stroke: 'clay', sw: 0.5, op: 0.18 });
  }
  for (const nx of [wx + 58, wx + ww - 58]) {
    p.path(M.archPath(nx - 20, wy + 190, 40, 62, { kind: 'pointed' }), { fill: 'clay', op: 0.9 });
    p.path(M.archPath(nx - 16, wy + 196, 32, 56, { kind: 'pointed' }), { fill: p.lin(0, wy + 196, 0, wy + 252, [[0, 'saffron', 0.5], [1, 'gold', 0.9]]) });
    M.diya(p, nx - 3, wy + 244, 20);
  }
  // the window and who stands in it
  const ax = W / 2 - 96, ay = wy + 104, aw = 192, ah = 250;
  M.archFrame(p, ax, ay, aw, ah, {
    band: 16, seed: 'hero',
    inner: (g) => {
      g.rect(ax - 20, ay - 20, aw + 40, ah + 40, { fill: g.lin(0, ay, 0, ay + ah, [[0, 'sky'], [0.7, 'paper'], [1, 'paperDeep']]) });
      g.circle(ax + aw * 0.7, ay + 70, 26, { fill: 'gold', op: 0.55 });
      for (const [x, h, k] of [[ax + 20, 44, 'sh'], [ax + 62, 30, 'dome'], [ax + 118, 54, 'sh'], [ax + 160, 34, 'dome']]) {
        if (k === 'sh') M.shikhara(g, x, ay + ah * 0.66, h * 0.5, h, 'stone', { flag: false, seed: `hs${x}`, rib: 'clay' });
        else M.dome(g, x, ay + ah * 0.66, h * 0.8, h * 0.8, 'stone');
      }
      g.rect(ax - 20, ay + ah * 0.66, aw + 40, 60, { fill: 'peacock', op: 0.35 });
      for (let i = 0; i < 5; i++) g.path(String(new D().M(ax + 90 + i * 18, ay + ah * 0.72 + i * 4).L(ax + 104 + i * 18, ay + ah * 0.72 + i * 4)), { stroke: 'card', sw: 0.8, op: 0.6 });
      M.bird(g, ax + 140, ay + 104, 5, 'inkSoft', 0.6); M.bird(g, ax + 156, ay + 96, 4, 'inkSoft', 0.6);
      M.profile(g, ax + aw * 0.36, ay + ah + 2, 190, 'man', { fill: 'indigo', hair: 'ink', rim: 'gold' });
    },
  });
  M.mala(p, ax - 8, ay + 12, ax + aw + 8, ay + 12, 30, 5.2, 'hero-mala', { leaves: 4, tassel: true });
  M.diya(p, ax + 8, ay + ah - 4, 22);
  M.diya(p, ax + aw - 30, ay + ah - 4, 22);
  // pilasters either side of the window, a painted frieze under the cornice, bells on chains
  for (const px of [ax - 46, ax + aw + 30]) {
    p.cut(cutShape([[px, ay - 10], [px + 16, ay - 10], [px + 16, ay + ah + 8], [px, ay + ah + 8]], 0.3, `pil${px}`, 12), 'paperDeep', { shadow: 0.2 });
    p.cut(String(new D().M(px - 5, ay - 10).L(px + 21, ay - 10).L(px + 16, ay - 22).L(px, ay - 22).Z()), 'clay', { shadow: 0.2 });
    M.lotusBud(p, px + 8, ay - 22, 7);
    for (let i = 0; i < 6; i++) p.circle(px + 8, ay + 14 + i * 42, 2.2, { fill: 'clay', op: 0.7 });
  }
  M.rangoliBand(p, wx + 10, wx + ww - 10, wy + 44, { size: 7 });
  for (const bx of [ax - 38, ax + aw + 38]) {
    p.path(String(new D().M(bx, ay - 26).L(bx, ay + 40)), { stroke: 'brass', sw: 0.8, dash: [2, 1.4] });
    p.path(String(new D().M(bx - 7, ay + 52).Q(bx - 7, ay + 38, bx, ay + 38).Q(bx + 7, ay + 38, bx + 7, ay + 52).Z()), { fill: 'gold', stroke: 'brass', sw: 0.6 });
    p.circle(bx, ay + 54, 1.8, { fill: 'brass' });
  }
  M.toran(p, wx - 20, wx + ww + 20, wy + 26, { leaf: 22, seed: 'op-toran', swags: 0 });
  branch(p, [[-20, -10], [26, 30], [48, 70], [52, 118]], 'op-bl', { size: 16, leaves: 18, leafFill: ['leaf', 'leafDeep'], fill: 'leafDeep' });
  branch(p, [[615, -10], [570, 26], [548, 66], [546, 104]], 'op-br', { size: 16, leaves: 16, leafFill: ['leafDeep', 'leaf'], fill: 'leafDeep' });
  M.marigold(p, 48, 72, 6, 'opm1'); M.marigold(p, 552, 64, 6, 'opm2');

  p.text(W / 2, 566, 'Ankit · born 1990', { font: 'hand', size: 15, fill: 'inkSoft', align: 'middle' });
  p.text(W / 2, 612, 'This is Ankit’s story', { font: 'display', size: 34, fill: 'ink', align: 'middle' });
  lines(p, W / 2, 646, [
    'Ankit was born in 1990, the eldest of three children of Vinod',
    'and Anita Kumar, and a brother to Neha and Rohan. His story',
    'begins long before him, with the people who lit the first lamps',
    'in this family, and it goes on in his son, Aarav.',
  ]);
  // the people nearest him, a quiet row
  const near = [
    { id: 'vinod', name: 'Vinod', gender: 'MALE', birth: 1962, kin: 'पिता' },
    { id: 'anita', name: 'Anita', gender: 'FEMALE', birth: 1965, kin: 'माता' },
    { id: 'priya', name: 'Priya', gender: 'FEMALE', birth: 1992, kin: 'पत्नी' },
    { id: 'aarav', name: 'Aarav', gender: 'MALE', birth: 2019, kin: 'बेटा' },
  ];
  near.forEach((n, i) => {
    const cx = W / 2 + (i - 1.5) * 92;
    portrait(p, cx, 758, 22, n, { petals: false });
    p.text(cx, 796, n.name, { font: 'strong', size: 9.5, fill: 'ink', align: 'middle' });
    p.text(cx, 809, n.kin, { font: 'hand', size: 10, fill: 'inkSoft', align: 'middle' });
  });
  folio(p, 2);
  return p;
}

// ---------------------------------------------------------------------------------------------
// 3. Two courtyards: the grandparents' households, side by side. One side is not recorded yet,
//    and the page says so in its own way rather than leaving a gap.

function doorway(p, x, y, w, h, { door = 'peacock', seed, open = true, wall = 'stone', painted = false }) {
  p.cut(cutShape([[x, y + 12], [x + w, y + 12], [x + w, y + h], [x, y + h]], 0.8, seed, 12), wall, { shadow: 0.25, soft: true });
  const m = Math.round(w / 14);
  for (let i = 0; i < m; i++) {
    const mx = x + (w * (i + 0.5)) / m, mw = (w / m) * 0.62;
    p.cut(String(new D().M(mx - mw / 2, y + 14).L(mx - mw / 2, y + 6).Q(mx, y - 4, mx + mw / 2, y + 6).L(mx + mw / 2, y + 14).Z()), 'stone', { shadow: 0.2 });
  }
  p.rect(x - 4, y + 12, w + 8, 5, { fill: 'clay' });
  const dw = w * 0.42, dh = h * 0.62, dx = x + w / 2 - dw / 2, dy = y + h - dh;
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
  M.windowCut(p, x + w * 0.1 - 10, y + 40, 20, 30, painted ? 'shutter' : 'jaali', { frame: 'card', shutter: door });
  M.windowCut(p, x + w * 0.9 - 10, y + 40, 20, 30, painted ? 'shutter' : 'jaali', { frame: 'card', shutter: door });
  M.pot(p, x + w * 0.1, y + h - 1, 16);
}

function courtyards() {
  const p = new Page(M.PALETTE, { id: 'ct' });
  paperGround(p, 'courtyards');
  p.text(W / 2, 74, 'Two courtyards', { font: 'display', size: 36, fill: 'ink', align: 'middle' });
  p.text(W / 2, 100, 'Where Vinod and Anita grew up', { font: 'hand', size: 15, fill: 'inkSoft', align: 'middle' });
  // floor
  p.cut(cutShape([[-10, 368], [W + 10, 368], [W + 10, 420], [-10, 420]], 0.6, 'floor', 20), 'paperDeep', { shadow: 0.15 });
  for (let i = 0; i < 18; i++) p.path(String(new D().M(i * 36 - 20, 420).L(i * 36 + 6, 368)), { stroke: 'stone', sw: 0.6, op: 0.6 });
  doorway(p, 40, 132, 230, 240, { door: 'peacock', seed: 'dl', open: true, wall: 'stone', painted: true });
  doorway(p, 325, 132, 230, 240, { door: 'indigo', seed: 'dr', open: false, wall: 'wash' });
  M.tulsi(p, W / 2, 404, 52);
  M.diya(p, 430, 382, 18);

  // father's side
  const L = [
    { id: 'raj', name: 'Raj Kumar', gender: 'MALE', birth: 1938, died: 2010, life: '1938 – 2010', kin: 'दादा' },
    { id: 'sushila', name: 'Sushila Devi', gender: 'FEMALE', birth: 1942, life: 'b. 1942', kin: 'दादी', photo: 'grandmother.jpg' },
  ];
  const lc = [92, 222];
  M.mala(p, lc[0] + 46, 480, lc[1] - 46, 480, 10, 3.2, 'ct-mala', { leaves: 1 });
  L.forEach((n, i) => {
    portrait(p, lc[i], 482, 40, n);
    p.text(lc[i], 546, n.name, { font: 'strong', size: 12, fill: 'ink', align: 'middle' });
    p.text(lc[i], 561, n.life, { font: 'text', size: 10, fill: 'inkSoft', align: 'middle' });
    p.text(lc[i], 578, n.kin, { font: 'hand', size: 12, fill: 'clay', align: 'middle' });
  });
  lines(p, 155, 612, ['Father’s side. Vinod grew up here,', 'and Meena was born to Raj Kumar', 'and Kamla Devi (1948 – 2019).'], { size: 11, lead: 16 });

  // mother's side: not recorded yet
  const rc = [375, 505];
  rc.forEach((cx, i) => {
    portrait(p, cx, 482, 40, { id: `unk${i}`, name: null });
  });
  p.text(440, 546, 'Anita’s parents', { font: 'strong', size: 12, fill: 'ink', align: 'middle' });
  p.text(440, 566, 'Their names are still to be found.', { font: 'hand', size: 13, fill: 'clay', align: 'middle' });
  lines(p, 440, 612, ['Mother’s side. A lamp is kept for', 'each of them until someone', 'remembers.'], { size: 11, lead: 16 });

  note(p, 150, 672, 290, ['A family is two courtyards', 'learning to share one lamp.'], { angle: -2.2, seed: 'ct-note' });
  M.rangoliBand(p, 44, W - 44, 780, { size: 8 });
  folio(p, 4);
  return p;
}

// ---------------------------------------------------------------------------------------------
// 4. Our lane: the wider family, a house to each household.

function lane() {
  const p = new Page(M.PALETTE, { id: 'ln' });
  paperGround(p, 'lane', { ground: 'sky', cloud: 'paper' });
  p.text(44, 84, 'Our lane', { font: 'display', size: 38, fill: 'ink' });
  p.text(44, 110, 'Ankit’s wider family, door by door', { font: 'hand', size: 15, fill: 'inkSoft' });
  for (const [x, y, s] of [[430, 86, 7], [452, 76, 5], [470, 94, 6], [496, 70, 4.5]]) M.bird(p, x, y, s, 'inkSoft', 0.6);
  // the town beyond the lane, pale with distance
  for (const [x, h, k] of [[40, 70, 'dome'], [120, 110, 'sh'], [210, 64, 'ch'], [300, 96, 'dome'], [392, 130, 'sh'], [470, 72, 'ch'], [548, 104, 'dome']]) {
    if (k === 'sh') M.shikhara(p, x, 330, h * 0.5, h, 'paperDeep', { flag: true, seed: `lf${x}`, rib: 'stone' });
    else if (k === 'dome') M.dome(p, x, 330, h * 0.8, h * 0.8, 'paperDeep');
    else M.chhatri(p, x, 330, h * 0.75, 'paperDeep');
  }
  for (const [x, w, h] of [[-4, 70, 60], [66, 60, 44], [150, 80, 70], [236, 70, 50], [330, 90, 64], [436, 70, 48], [512, 90, 66]]) p.cut(cutShape([[x, 334], [x, 334 - h], [x + w, 334 - h], [x + w, 334]], 0.6, `lr${x}`, 10), 'stone', { shadow: 0.1, op: 0.55 });
  kite(p, 470, 150, 13, 'rani', 'marigold', 'k1');
  kite(p, 540, 196, 9, 'peacock', 'gold', 'k2');
  // bunting across the lane
  const flags = [];
  for (let i = 0; i <= 22; i++) flags.push([i * 28 - 8, 222 + Math.sin(i * 0.7) * 6 + (i % 5) * 1.5]);
  p.path(smooth(flags, { closed: false }), { stroke: 'clay', sw: 0.7 });
  const cols = ['rani', 'marigold', 'peacock', 'saffron', 'indigo'];
  flags.forEach(([x, y], i) => { if (i % 1 === 0) p.cut(poly([[x - 7, y], [x + 7, y + 0.5], [x, y + 15]]), cols[i % 5], { shadow: 0.15 }); });

  const houses = [
    { x: 14, w: 142, h: 236, fill: 'indigo', door: 'saffron', shutter: 'saffron', mandana: false, title: 'Meena', kin: 'बुआ · father’s half-sister', people: [['Meena Kumari', 'b. 1970']] },
    { x: 156, w: 140, h: 276, fill: 'saffron', door: 'peacock', shutter: 'peacock', mandana: true, title: 'Bhola Prasad’s house', kin: 'grandfather’s brother', people: [['Bhola Prasad', '1935 – 1999'], ['Arun Prasad', 'b. 1966']] },
    { x: 296, w: 146, h: 250, fill: 'peacock', door: 'marigold', shutter: 'marigold', mandana: false, title: 'The Sharmas', kin: 'Priya’s family', people: [['Gopal Sharma', '1940 – 2008'], ['Lata Sharma', 'b. 1944']] },
    { x: 442, w: 140, h: 290, fill: 'rani', door: 'indigo', shutter: 'indigo', mandana: true, title: 'The Lal brothers', kin: 'great-grandfather’s brothers', people: [['Ram Lal', '1900 – 1968'], ['Hari Lal', '1902 – 1970']] },
  ];
  const base = 560;
  for (const hs of houses) {
    M.haveli(p, hs.x, base, hs.w, hs.h, hs.fill, { trim: 'card', door: hs.door, seed: hs.title, windows: 3, jharokha: true, shutter: hs.shutter, mandanaDoor: hs.mandana });
    // the nameboard over the door
    const bx = hs.x + hs.w / 2, by = base - 86;
    p.cut(cutShape([[bx - 52, by - 12], [bx + 52, by - 12], [bx + 52, by + 8], [bx - 52, by + 8]], 0.4, `${hs.title}b`, 10), 'card', { shadow: 0.2 });
    p.rect(bx - 49, by - 9, 98, 14, { stroke: 'gold', sw: 0.6 });
    p.text(bx, by + 2.5, hs.title, { font: 'strong', size: hs.title.length > 16 ? 8.2 : 9.5, fill: 'ink', align: 'middle' });
    M.toran(p, bx - 26, bx + 26, base - 68, { leaf: 10, seed: `${hs.title}t` });
  }
  // the lane itself, and a little kolam at each door
  p.cut(cutShape([[-10, base], [W + 10, base], [W + 10, base + 30], [-10, base + 30]], 0.6, 'street', 20), 'stone', { shadow: 0.25 });
  for (const hs of houses) {
    const cx = hs.x + hs.w / 2;
    p.group((g) => M.rangoli(g, 0, 0, 22, hs.title, { ground: 'card' }), { tf: [1, 0, 0, 0.35, cx, base + 16] });
  }
  // who lives behind each door
  houses.forEach((hs) => {
    const cx = hs.x + hs.w / 2;
    p.text(cx, 622, hs.kin, { font: 'hand', size: 11, fill: 'clay', align: 'middle' });
    hs.people.forEach(([n, life], i) => {
      p.text(cx, 646 + i * 30, n, { font: 'strong', size: 10.5, fill: 'ink', align: 'middle' });
      p.text(cx, 659 + i * 30, life, { font: 'text', size: 9.5, fill: 'inkSoft', align: 'middle' });
    });
  });
  p.text(W / 2, 760, 'Every door on this lane opens to family.', { font: 'hand', size: 16, fill: 'ink', align: 'middle' });
  M.mala(p, W / 2 - 110, 776, W / 2 + 110, 776, 8, 2.8, 'lane-mala', { leaves: 3 });
  folio(p, 9);
  return p;
}

// ---------------------------------------------------------------------------------------------
// 5. Everyone: the register. Calm, dense, and nobody left out.

function register() {
  const p = new Page(M.PALETTE, { id: 'rg' });
  paperGround(p, 'register', { ground: 'paper' });
  p.text(44, 84, 'Everyone in our family', { font: 'display', size: 32, fill: 'ink' });
  p.text(44, 108, 'Twenty-three people, five generations', { font: 'hand', size: 14, fill: 'inkSoft' });
  // a vine climbing the outer edge
  const vine = [];
  for (let i = 0; i <= 20; i++) vine.push([566 + Math.sin(i * 0.9) * 8, 40 + i * 38]);
  p.path(smooth(vine, { closed: false }), { stroke: 'leafDeep', sw: 1.6 });
  vine.forEach(([x, y], i) => {
    if (i === 0 || i === 20) return;
    M.mangoLeaf(p, x, y, 16, i % 2 ? 60 : -60, i % 3 ? 'leaf' : 'leafDeep', { rib: true });
    if (i % 4 === 2) M.marigold(p, x, y, 5, `rv${i}`);
  });

  const groups = [
    ['Ankit’s own family', [['Ankit Kumar', '1990', 2, 'm', 1990], ['Priya Sharma', '1992', 7, 'f', 1992], ['Aarav Kumar', '2019', 8, 'm', 2019]]],
    ['Parents, brother and sister', [['Vinod Kumar', '1962', 5, 'm', 1962], ['Anita Kumar', '1965', 5, 'f', 1965], ['Neha Kumar', '1993', 6, 'f', 1993], ['Rohan Kumar', '1998', 6, 'm', 1998]]],
    ['Father’s side', [['Raj Kumar', '1938 – 2010', 4, 'm', 1938, 2010], ['Sushila Devi', '1942', 4, 'f', 1942], ['Kamla Devi', '1948 – 2019', 4, 'f', 1948, 2019], ['Meena Kumari', '1970', 9, 'f', 1970],
      ['Shyam Lal', '1905 – 1978', 3, 'm', 1905, 1978], [null, '1909 – 1981', 12, 'f', 1909, 1981], ['Bhola Prasad', '1935 – 1999', 9, 'm', 1935, 1999], ['Arun Prasad', '1966', 9, 'm', 1966], ['Ram Lal', '1900 – 1968', 9, 'm', 1900, 1968], ['Hari Lal', '1902 – 1970', 9, 'm', 1902, 1970]]],
    ['Priya’s family', [['Gopal Sharma', '1940 – 2008', 9, 'm', 1940, 2008], ['Lata Sharma', '1944', 9, 'f', 1944]]],
    ['Also in the family', [['Ishwar Dutt', '1928 – 1994', 11, 'm', 1928, 1994], ['Savitri Bai', '1931', 11, 'f', 1931], ['Mohan Lal', '1955', 11, 'm', 1955], [null, '', 12, 'u']]],
  ];
  M.mala(p, 44, 124, 250, 124, 6, 2.6, 'rg-mala', { leaves: 3 });
  const colX = [44, 300], colW = 236, top = 164, pitch = 21;
  const heightOf = (g) => 36 + g[1].length * pitch;
  const total = groups.reduce((a, g) => a + heightOf(g), 0);
  let col = 0, y = top, used = 0;
  for (const [title, rows] of groups) {
    if (col === 0 && used > 0 && used + heightOf([title, rows]) / 2 > total / 2) { col = 1; y = top; }
    used += heightOf([title, rows]);
    const x = colX[col];
    p.text(x, y, title, { font: 'display', size: 13.5, fill: 'clay' });
    p.path(String(new D().M(x, y + 7).L(x + colW, y + 7)), { stroke: 'gold', sw: 0.7 });
    p.circle(x + colW, y + 7, 1.8, { fill: 'gold' });
    y += 24;
    for (const [name, life, page, g, birth, died] of rows) {
      const person = { id: name ?? `u${page}${life}`, name, gender: g === 'f' ? 'FEMALE' : g === 'm' ? 'MALE' : 'UNSPECIFIED', birth, died };
      portrait(p, x + 8, y - 3.5, 8, person, { petals: false });
      p.text(x + 22, y, name ?? 'Name not yet recorded', { font: name ? 'strong' : 'hand', size: name ? 9.6 : 10, fill: name ? 'ink' : 'brass' });
      const lifeText = life ? (died ? life : `b. ${life}`) : '';
      p.text(x + colW - 26, y, lifeText, { font: 'text', size: 9, fill: 'inkSoft', align: 'end' });
      p.text(x + colW, y, String(page), { font: 'strong', size: 9, fill: 'clay', align: 'end' });
      y += pitch;
    }
    y += 12;
  }
  note(p, 316, 668, 210, ['Find yourself, then turn', 'to your page.'], { angle: 2.5, size: 13, seed: 'rg-note' });
  // a courtyard corner under the first column
  p.group((g) => M.rangoli(g, 0, 0, 58, 'Kumar', { ground: 'card' }), { tf: [1, 0, 0, 0.38, 160, 776] });
  M.tulsi(p, 92, 770, 62);
  M.diya(p, 170, 768, 18); M.diya(p, 204, 776, 16); M.diya(p, 236, 768, 18);
  M.mala(p, 44, 668, 268, 668, 14, 3.4, 'rg-mala2', { leaves: 4 });
  folio(p, 10);
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
  // the courtyard wall at night
  const wy = 250, wh = 380;
  p.cut(cutShape([[-10, wy + 14], [W + 10, wy + 14], [W + 10, wy + wh], [-10, wy + wh]], 0.8, 'rwall', 16), 'glow', { shadow: 0.4, soft: true, shadowFill: 'deep' });
  const mr = 22;
  for (let i = 0; i < mr; i++) {
    const mx = (W * (i + 0.5)) / mr, mw = (W / mr) * 0.64;
    p.cut(String(new D().M(mx - mw / 2, wy + 16).L(mx - mw / 2, wy + 6).Q(mx, wy - 5, mx + mw / 2, wy + 6).L(mx + mw / 2, wy + 16).Z()), 'glow', { shadow: 0.3, shadowFill: 'deep' });
  }
  p.rect(-6, wy + 14, W + 12, 5, { fill: 'night' });
  const niches = [
    { cx: 172, title: 'Shyam Lal’s wife', rel: 'Ankit’s great-grandmother · 1909 – 1981', note: 'Remembered as a fierce cook.' },
    { cx: 423, title: 'A child, name unknown', rel: 'not yet placed in the tree', note: 'Third from the left in the 1955 wedding photograph.' },
  ];
  for (const n of niches) {
    const ax = n.cx - 62, ay = wy + 60, aw = 124, ah = 176;
    p.circle(n.cx, ay + ah * 0.66, 120, { fill: p.rad(n.cx, ay + ah * 0.66, 120, [[0, 'gold', 0.25], [1, 'gold', 0]]) });
    M.archFrame(p, ax, ay, aw, ah, {
      band: 12, stone: 'dusk', trim: 'brass', eave: false, seed: n.title,
      inner: (g) => {
        g.rect(ax - 10, ay - 10, aw + 20, ah + 20, { fill: g.lin(0, ay, 0, ay + ah, [[0, 'night'], [0.6, 'clay'], [1, 'saffron']]) });
        M.glowDiscs(g, n.cx, ay + ah - 40, 70, { strength: 1.4 });
        M.diya(g, n.cx - 12, ay + ah - 18, 36, { unknown: true });
      },
    });
    M.mala(p, ax - 4, ay - 4, ax + aw + 4, ay - 4, 22, 3.6, `${n.title}m`, { leaves: 2, tassel: true });
    p.text(n.cx, ay + ah + 58, n.title, { font: 'strong', size: 12.5, fill: 'card', align: 'middle' });
    p.text(n.cx, ay + ah + 74, n.rel, { font: 'text', size: 9.5, fill: 'flame', align: 'middle' });
    const words = n.note.split(' ');
    const half = Math.ceil(words.length / 2);
    const noteLines = n.note.length > 32 ? [words.slice(0, half).join(' '), words.slice(half).join(' ')] : [n.note];
    noteLines.forEach((l, i) => p.text(n.cx, ay + ah + 94 + i * 14, l, { font: 'hand', size: 11.5, fill: 'gold', align: 'middle' }));
  }
  // floor and closing words
  p.cut(cutShape([[-10, wy + wh], [W + 10, wy + wh], [W + 10, H + 10], [-10, H + 10]], 0.8, 'rfloor', 16), 'deep', { shadow: 0.4, dy: -1.5, soft: true, shadowFill: 'deep' });
  lines(p, W / 2, 690, ['Some names are missing, but they are not forgotten.', 'A lamp is kept for each of them, until someone remembers.'], { font: 'hand', size: 15, lead: 21, fill: 'flame' });
  p.text(W / 2, 752, 'If you know who they were, add them to the family tree.', { font: 'text', size: 10.5, fill: 'card', align: 'middle' });
  folio(p, 12, { ink: 'flame' });
  return p;
}

// ---------------------------------------------------------------------------------------------
// The system sheet: palette, type, avatars and frames, for the review.

function system() {
  const p = new Page(M.PALETTE, { id: 'sy' });
  paperGround(p, 'system');
  p.text(44, 70, 'Aangan · the system', { font: 'display', size: 28, fill: 'ink' });
  const tokens = Object.keys(M.PALETTE);
  tokens.forEach((t, i) => {
    const x = 44 + (i % 9) * 58, y = 96 + Math.floor(i / 9) * 52;
    p.cut(cutShape([[x, y], [x + 46, y], [x + 46, y + 28], [x, y + 28]], 0.5, t, 8), t, { shadow: 0.2 });
    p.text(x, y + 40, t, { font: 'text', size: 8, fill: 'inkSoft' });
  });
  let y = 272;
  for (const [role, size, sample] of [['display', 30, 'Two courtyards · शुभ दीपावली'], ['hand', 17, 'A lamp is kept for each of them · दादी'], ['strong', 13, 'Sushila Devi · सुशीला देवी'], ['text', 12.5, 'Ankit was born in 1990, the eldest of three children.']]) {
    p.text(44, y, role, { font: 'text', size: 8, fill: 'clay' });
    p.text(110, y, sample, { font: role, size, fill: 'ink' });
    y += size + 18;
  }
  const people = [
    ['child', 'FEMALE', 2018], ['child', 'MALE', 2016], ['youth', 'FEMALE', 1999], ['youth', 'MALE', 1997], ['adult', 'FEMALE', 1972], ['adult', 'MALE', 1968],
    ['elder', 'FEMALE', 1944], ['elder', 'MALE', 1940], ['adult', 'UNSPECIFIED', 1980], ['elder', 'FEMALE', 1930, 2001], ['unknown', 'FEMALE'],
  ];
  people.forEach(([stage, g, birth, died], i) => {
    const cx = 72 + (i % 6) * 90, cy = 452 + Math.floor(i / 6) * 108;
    portrait(p, cx, cy, 34, { id: `s${i}`, name: stage === 'unknown' ? null : 'x', gender: g, birth, died });
    p.text(cx, cy + 52, stage === 'unknown' ? 'name not known' : died ? 'departed' : `${stage}, ${g.toLowerCase()}`, { font: 'text', size: 8, fill: 'inkSoft', align: 'middle' });
  });
  const ax = 510 - 26;
  M.archFrame(p, ax - 10, 580, 72, 96, { band: 9, seed: 'sys-arch', inner: (g) => { g.rect(ax - 20, 570, 100, 120, { fill: 'sky' }); M.bust(g, ax + 26, 680, 80, 'woman', { cloth: 'peacock', drape: 'marigold' }); } });
  p.text(44, 760, 'Faceless on purpose: a face the record doesn’t hold is never invented. Photographs are never tinted.', { font: 'text', size: 9.5, fill: 'inkSoft' });
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
