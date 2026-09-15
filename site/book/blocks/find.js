/*
 * Find yourself: everyone in the book, alphabetically, with the page they are on.
 *
 * The first thing anybody does with a family book is look for their own name. The index makes that
 * a glance instead of a leaf through, and it is the page most likely to be screenshotted and sent
 * on - "I'm on page 6". Order is by a fold of each name's own characters (family.js sortKey), so
 * it is the same order on every engine; names in Devanagari follow names in Latin script, as a
 * bilingual index conventionally does.
 *
 * People whose name was never recorded cannot be looked up, and are counted instead of listed.
 */

import { PAGE, path, PathData } from '../format.js';
import { sortKey, byKey } from '../family.js';

const { w: W, h: H } = PAGE;
const TOP = 150, BOTTOM = H - 56, SIDE = 44, COLS = 3, GAP = 22, LEAD = 15;

export function findYourself(ctx) {
  const { family, P } = ctx;
  const named = family.people.filter((p) => p.name && ctx.pageOf.has(p.id));
  if (named.length < 6) return [];   // a handful of names needs no index; the pages are the index
  named.sort((a, b) => byKey(sortKey(a.name), sortKey(b.name)) || byKey(a.id, b.id));

  const colW = (W - 2 * SIDE - GAP * (COLS - 1)) / COLS;
  const perCol = Math.floor((BOTTOM - TOP) / LEAD);
  const pages = [];
  for (let start = 0; start < named.length; start += perCol * COLS) {
    const first = start === 0;
    const items = [];
    items.push(ctx.line(SIDE, 84, first ? 'Find yourself' : 'Find yourself, continued', 'display', 30, P.ink));
    if (first) {
      const unknown = family.people.filter((p) => !p.name).length;
      const note = unknown ? ` ${unknown === 1 ? 'One person' : `${unknown} people`} whose name was never recorded ${unknown === 1 ? 'is' : 'are'} in the book too.` : '';
      items.push(...ctx.lines(SIDE, 108, `Everyone in this book, and the page they are on.${note}`, 'text', 11, P.inkSoft, { width: W - 2 * SIDE, maxLines: 2, lead: 15 }).items);
    }
    const chunk = named.slice(start, start + perCol * COLS);
    chunk.forEach((p, i) => {
      const c = Math.floor(i / perCol), r = i % perCol;
      const x = SIDE + c * (colW + GAP), y = TOP + r * LEAD;
      const pageLabel = String(ctx.pageOf.get(p.id));
      const numW = ctx.measure(pageLabel, 'strong', 9) + 2;
      const nameW = colW - numW - 10;
      const size = ctx.fit(p.name, 'text', 9.5, nameW, 7);
      items.push(ctx.line(x, y, p.name, 'text', size, P.ink, { width: nameW }));
      items.push(ctx.line(x + colW, y, pageLabel, 'strong', 9, P.goldSoft, { align: 'end', width: numW }));
    });
    // Hairlines between the columns, which is where the eye loses its place in a long list.
    const rules = new PathData();
    for (let c = 1; c < COLS; c++) {
      const x = SIDE + c * (colW + GAP) - GAP / 2;
      rules.M(x, TOP - 12).L(x, Math.min(BOTTOM, TOP + Math.min(perCol, chunk.length) * LEAD));
    }
    if (chunk.length > perCol) items.push(path(String(rules), { stroke: P.rule, sw: 0.6 }));
    items.push(...ctx.footer(P.inkSoft));
    pages.push(ctx.page(first ? 'Find yourself' : 'Find yourself, continued', items, P.paper));
    ctx.pageNo += 1;
  }
  return pages;
}
