/*
 * The whole family on one page.
 *
 * Drawn from the viewer's own layout (site/playground/layout.js, generations as rows), so the book
 * and the chart agree about who sits where. The page has a legibility floor: when there is not
 * room for a name at 6 points or more under every portrait - about 44 points from one person to
 * the next - it stops pretending and becomes a night sky of the whole family instead, the same
 * connectors and one star per person, and leaves the names to the generation pages that follow.
 */

import { PAGE, path, rect, circle, group, PathData } from '../format.js';
import { lifeYears } from '../family.js';
import { starfield, sparkleData } from './art.js';
import { nightGround } from './cover.js';
import { ROMAN } from './words.js';

const { w: W, h: H } = PAGE;
const MIN_PITCH = 44;

/**
 * Fits the layout into a box. Across is scaled to fit; down may stretch up to 2.2 times as far,
 * because a family tree is wider than it is tall and a portrait page is the other way round.
 */
function fit(layout, box, keep) {
  const M = layout.metrics;
  const nodes = layout.nodes.filter((n) => keep.has(n.id));
  const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs) + M.NODE_W;
  const minY = Math.min(...ys), maxY = Math.max(...ys) + M.NODE_H;
  const sx = Math.min(box.w / (maxX - minX), 1);
  const sy = Math.min(box.h / (maxY - minY), sx * 2.2);
  const ox = box.x + (box.w - (maxX - minX) * sx) / 2;
  const oy = box.y + (box.h - (maxY - minY) * sy) / 2;
  const tx = (x, y) => [ox + (x - minX) * sx, oy + (y - minY) * sy];
  const centre = new Map(nodes.map((n) => [n.id, tx(n.x + M.NODE_W / 2, n.y + M.NODE_H / 2)]));
  const lines = new PathData();
  const joined = (link) => [link.a, link.b, ...(link.parents ?? []), ...(link.childIds ?? [])].filter(Boolean).every((id) => keep.has(id));
  for (const list of [layout.couples, layout.descents, layout.siblings]) {
    for (const link of list) {
      if (!joined(link)) continue;
      for (const [a, b, c, d] of link.segments) lines.M(...tx(a, b)).L(...tx(c, d));
    }
  }
  return { centre, lines, pitch: (M.NODE_W + M.SIBLING_GAP) * sx, sy, M };
}

/*
 * Only the joined family is drawn here. People with no link to it have their own section in the
 * generation pages; placed on this page they sit on a shelf of their own below the tree and shrink
 * everybody else to make room for a gap.
 */
export function treePage(ctx) {
  const { family } = ctx;
  const keep = new Set(family.people.filter((p) => p.gen !== null).map((p) => p.id));
  if (!keep.size) for (const p of family.people) keep.add(p.id);
  if (!keep.size) return ctx.page('The whole family', [...ctx.footer(ctx.P.inkSoft)], ctx.P.paper);
  const named = fit(family.layout, { x: 44, y: 150, w: W - 88, h: 630 }, keep);
  return named.pitch >= MIN_PITCH ? namedTree(ctx, named) : silhouette(ctx, keep);
}

function namedTree(ctx, L) {
  const { family, P } = ctx;
  const items = [
    ctx.line(44, 84, 'The whole family', 'display', 30, P.ink),
    ...ctx.lines(44, 108, 'Eldest at the top. Partners sit side by side, and children hang from the line between them.', 'text', 11, P.inkSoft, { width: 480, maxLines: 2, lead: 15 }).items,
    path(String(L.lines), { stroke: P.goldSoft, sw: 0.8 }),
  ];
  const r = Math.min(14, L.pitch * 0.17);
  const card = L.pitch * 0.84;
  for (const p of family.people) {
    const at = L.centre.get(p.id);
    if (!at) continue;
    const [x, y] = at;
    if (p.deceased) {
      items.push(rect(x - card / 2, y - r - 7, card, r * 2 + 36, { r: 3, fill: P.aged }));
      items.push(path(String(new PathData().M(x - card / 2, y - r - 7).L(x + card / 2, y - r - 7)), { stroke: P.goldSoft, sw: 1.2 }));
    }
    items.push(...ctx.portrait(p, x, y - 4, r));
    const name = p.name ?? 'Name not recorded';
    const nameSize = 7.4;
    const named = ctx.lines(x, y + r + 9, name, 'strong', nameSize, p.name ? P.ink : P.goldSoft, { width: L.pitch - 8, maxLines: 2, lead: 8.6, align: 'middle' });
    items.push(...named.items);
    const years = lifeYears(p);
    if (years) items.push(ctx.line(x, named.bottom + 8.4, years, 'text', 6.4, P.inkSoft, { align: 'middle', width: L.pitch - 8 }));
  }
  items.push(...ctx.footer(P.inkSoft));
  return ctx.page('The whole family', items, P.paper);
}

function silhouette(ctx, keep) {
  const { family, P, facts } = ctx;
  const L = fit(family.layout, { x: 40, y: 150, w: W - 80, h: 640 }, keep);
  const items = [
    nightGround(ctx),
    starfield(`${family.title} tree`, 160, { x: 0, y: 0, w: W, h: H }, P.star),
    ctx.line(44, 80, 'The whole family', 'display', 30, P.star),
    ...ctx.lines(44, 104, `${facts.people} people are more than one page can name, so every generation has pages of its own.`, 'text', 11, P.gold, { width: 480, maxLines: 2, lead: 15 }).items,
    path(String(L.lines), { stroke: P.gold, sw: 0.4, op: 0.55 }),
  ];
  const stars = new PathData();
  const size = Math.max(1.6, Math.min(3.2, L.pitch * 0.12));
  for (const p of family.people) {
    const at = L.centre.get(p.id);
    if (!at) continue;
    const [x, y] = at;
    if (!p.name) items.push(circle(x, y, size * 0.7, { stroke: P.gold, sw: 0.5, dash: [0.9, 0.7] }));
    else if (p.deceased) items.push(circle(x, y, size * 0.6, { fill: P.gold }));
    else sparkleData(x, y, size, stars);
  }
  if (!stars.empty) items.push(path(String(stars), { fill: P.star }));

  // Generation numerals down the margin, level with the middle of each generation's row.
  const rows = new Map();
  for (const p of family.people) {
    if (p.gen === null) continue;
    const at = L.centre.get(p.id);
    if (!at) continue;
    const e = rows.get(p.gen) ?? { sum: 0, n: 0 };
    e.sum += at[1]; e.n++; rows.set(p.gen, e);
  }
  const numerals = [];
  for (const [g, e] of [...rows].sort((a, b) => a[0] - b[0])) {
    numerals.push(ctx.line(22, e.sum / e.n + 3, ROMAN[g] ?? String(g + 1), 'display', 9, P.gold, { align: 'middle' }));
  }
  items.push(group(numerals));
  items.push(...ctx.footer(P.mist));
  return ctx.page('The whole family', items);
}
