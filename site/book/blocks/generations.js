/*
 * A page for every generation - or rather, generations that flow like a book's chapters.
 *
 * A generation of three would leave most of an A4 page empty, and a family of seven generations
 * would become seven sparse pages; so a generation begins wherever the last one ended if its
 * heading and a first row fit, and runs on to a new page, headed "continued", when it does not.
 * Portraits grow as a generation shrinks: two people get large ones, forty get small ones, and
 * every page stays full.
 *
 * Every person lands on exactly one page, and that page is recorded for "Find yourself".
 */

import { PAGE, rect, path, PathData } from '../format.js';
import { lifeLine } from '../family.js';
import { generationName, ROMAN, firstName, andList } from './words.js';

const { w: W, h: H } = PAGE;
const TOP = 60, BOTTOM = H - 48, SIDE = 44;

/**
 * How big each portrait is, from how many share the generation. A small generation sits on one
 * row, so three or four of them can share a page; a large one packs five to a row.
 */
function density(n) {
  if (n <= 2) return { cols: 2, r: 44, name: 14 };
  if (n <= 4) return { cols: n, r: 34, name: 12.5 };
  if (n <= 8) return { cols: 4, r: 30, name: 11.5 };
  return { cols: 5, r: 23, name: 10 };
}
/*
 * A row is exactly as tall as the fullest card in it can be: the portrait, two lines of name, the
 * dates and the relation line (see card()), plus the gap between rows. Deriving it from the card's
 * own spacing is what keeps a two-line name inside its card at every density.
 */
const rowHeight = (d) => d.r * 2 + d.name * 5.05 + 40;

export function generationPages(ctx) {
  const { family, P } = ctx;
  const sections = [];
  for (let g = 0; g < family.generations; g++) {
    const people = family.people.filter((p) => p.gen === g).sort((a, b) => a.x - b.x || a.order - b.order);
    if (people.length) sections.push({ title: generationName(g), numeral: ROMAN[g], people, g });
  }
  if (family.elsewhere.length) {
    // With no joined family at all there is nothing for these people to be "also" beside.
    const alone = !sections.length;
    sections.push({
      title: alone ? 'The family' : 'Also in the family',
      note: alone ? 'Nobody here is linked to anybody else yet.' : 'Recorded without a link to the rest of the tree yet.',
      people: [...family.elsewhere].sort((a, b) => a.order - b.order),
    });
  }

  const pages = [];
  let items = null, y = 0, numeral = null;
  const startPage = () => {
    items = [];
    numeral = null;
    y = TOP;
  };
  const endPage = () => {
    if (!items) return;
    if (numeral) items.unshift(ctx.line(W - 40, 118, numeral, 'display', 120, P.gold, { align: 'end', op: 0.2 }));
    items.push(...ctx.footer(P.inkSoft));
    pages.push(ctx.page(pages.length ? 'Generations, continued' : 'Generations', items, P.paper));
    ctx.pageNo += 1;
    items = null;
  };

  startPage();
  for (const s of sections) {
    const d = density(s.people.length);
    const rh = rowHeight(d);
    const heading = s.note ? 84 : 78;
    const rows = Math.ceil(s.people.length / d.cols);
    const whole = heading + rows * rh;
    // A generation that fits on a page is never split across two: moving it whole to a fresh page
    // costs some white space, and splitting it strands a row under a "continued" heading. Only a
    // generation taller than a page runs on, and then only once at least two rows have fitted.
    const fitsHere = y + whole <= BOTTOM;
    const fitsFresh = TOP + whole <= BOTTOM;
    if (y > TOP && !fitsHere && (fitsFresh || y + heading + 2 * rh > BOTTOM)) { endPage(); startPage(); }
    if (s.numeral && !numeral) numeral = s.numeral;
    header(ctx, items, s.title, subtitle(s), y);
    y += heading;

    for (let i = 0; i < s.people.length; i += d.cols) {
      if (y + rh > BOTTOM) {
        endPage(); startPage();
        if (s.numeral) numeral = s.numeral;
        header(ctx, items, `${s.title}, continued`, null, y, 24);
        y += 52;
      }
      const row = s.people.slice(i, i + d.cols);
      row.forEach((p, k) => card(ctx, items, p, d, rowX(row.length, d.cols, k), y, rh));
      y += rh;
    }
    y += 18;
  }
  endPage();
  return pages;
}

function subtitle(s) {
  if (s.note) return s.note;
  const years = s.people.map((p) => p.by).filter((b) => b !== null);
  if (!years.length) return null;
  const lo = Math.min(...years), hi = Math.max(...years);
  return lo === hi ? `Born in ${lo}` : `Born between ${lo} and ${hi}`;
}

function header(ctx, items, title, sub, y, size = 32) {
  const { P } = ctx;
  items.push(ctx.line(SIDE, y + size, title, 'display', ctx.fit(title, 'display', size, W - 2 * SIDE - 60, 18), P.ink));
  if (sub) items.push(ctx.line(SIDE, y + size + 24, sub, 'text', 12, P.inkSoft, { width: W - 2 * SIDE }));
  items.push(path(String(new PathData().M(SIDE, y + size + (sub ? 40 : 14)).L(W - SIDE, y + size + (sub ? 40 : 14))), { stroke: P.rule, sw: 0.8 }));
}

/** Where card k of a row sits: a short last row is centred rather than left hanging. */
function rowX(inRow, cols, k) {
  const cw = (W - 2 * SIDE) / cols;
  return SIDE + ((W - 2 * SIDE) - inRow * cw) / 2 + k * cw;
}

function card(ctx, items, p, d, x, y, rh) {
  const { P, family } = ctx;
  const cw = (W - 2 * SIDE) / d.cols;
  const cx = x + cw / 2;
  items.push(rect(x + 6, y, cw - 12, rh - 14, { r: 4, fill: p.deceased ? P.aged : P.card }));
  if (p.deceased) items.push(path(String(new PathData().M(x + 6, y + 0.8).L(x + cw - 6, y + 0.8)), { stroke: P.goldSoft, sw: 1.6 }));
  items.push(...ctx.portrait(p, cx, y + d.r + 16, d.r));
  ctx.pageOf.set(p.id, ctx.pageNo);

  const width = cw - 26;
  const name = ctx.lines(cx, y + d.r * 2 + 16 + d.name * 1.9, p.name ?? 'Name not yet recorded', 'strong', d.name, p.name ? P.ink : P.goldSoft, { width, maxLines: 2, lead: d.name * 1.15, align: 'middle' });
  items.push(...name.items);
  let yy = name.bottom + d.name * 1.05;
  const life = lifeLine(p, ctx.options);
  if (life) {
    items.push(ctx.line(cx, yy, life, 'text', d.name * 0.76, P.inkSoft, { align: 'middle', width }));
    yy += d.name * 0.95;
  }
  const parents = family.parentsOf(p.id).map(firstName).filter(Boolean);
  const partners = family.spousesOf(p.id).map(firstName).filter(Boolean);
  const relation = parents.length ? `Child of ${andList(parents)}` : partners.length ? `Married to ${andList(partners)}` : null;
  if (relation) items.push(...ctx.lines(cx, yy + 1, relation, 'text', d.name * 0.7, P.inkSoft, { width, maxLines: 1, align: 'middle', op: 0.9 }).items);
}
