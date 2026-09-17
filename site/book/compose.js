/*
 * composeBook: a family, a template and some options in; a Book out (format.js).
 *
 * This is the one place the book is laid out. The desktop runs it in its renderer; Android runs
 * this same file inside a hidden WebView and paints what it returns. Nothing here may read the
 * clock, the locale, the DOM or the network - see family.js - and it runs synchronously, because a
 * WebView that is not attached to a window never fires an animation frame and throttles timers.
 */

import { formatOf, PAGE, text, circle, image, rect } from './format.js';
import { measure, breakLines, fitSize } from './text.js';
import { readFamily, familyFacts } from './family.js';
import { validateTemplate } from './template.js';
import { METRICS } from './metrics/index.js';
import { cover } from './blocks/cover.js';
import { treePage } from './blocks/tree.js';
import { numbersPage } from './blocks/numbers.js';
import { generationPages } from './blocks/generations.js';
import { findYourself } from './blocks/find.js';
import { closingPage } from './blocks/closing.js';

const BLOCKS = {
  cover: (ctx) => [cover(ctx)],
  tree: (ctx) => [treePage(ctx)],
  numbers: (ctx) => [numbersPage(ctx)],
  generations: (ctx) => generationPages(ctx),
  find: (ctx) => findYourself(ctx),
  closing: (ctx) => [closingPage(ctx)],
};

/** Every block a template may name. template.js refuses any other. */
export const BLOCK_NAMES = Object.keys(BLOCKS);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * @param doc       the .ftree document (tree.json), exactly as either shell exports it
 * @param options   { now: 'YYYY-MM-DD', scope, title, photos: bool, livingDates: bool, words: 'en'|'hi' }
 * @param template  a template document, validated here (template.js)
 * @param allowance what the policy granted: { maxGenerations?, attribution? } - empty means all
 */
export function composeBook(doc, options, template, allowance = {}) {
  const tpl = validateTemplate(template);
  // A format-2 (storybook) template validates here but has no `pages` to walk. Say so, rather
  // than fail on the loop below, until the story planner (#251) draws it.
  if (tpl.format !== 1) throw new Error(`composeBook: "${tpl.id}" is a format-${tpl.format} storybook template, which this composer cannot draw yet`);
  const now = /^(\d{4})-(\d{2})/.exec(options?.now ?? '');
  if (!now) throw new Error('composeBook: options.now must be an ISO date - the composer never reads the clock');

  const family = readFamily(doc, options, allowance);
  const ctx = context(family, options, tpl, allowance, { year: Number(now[1]), month: Number(now[2]) });
  const pages = [];
  for (const name of tpl.pages) {
    for (const page of BLOCKS[name](ctx, pages.length + 1)) {
      pages.push(page);
      ctx.pageNo = pages.length + 1;
    }
  }
  const photos = budgetPhotos(ctx.photos, options?.photoBudget ?? PHOTO_BUDGET);
  // A book declares the lowest format that draws it, so the format is read off the pages rather
  // than written by hand: a book reaches format 2 the day it first clips or reuses something, and
  // never a release before that.
  const book = {
    template: tpl.id,
    title: family.title,
    fileName: fileName(family.title, tpl),
    size: { ...PAGE },
    fonts: { ...tpl.fonts },
    defs: ctx.defs,
    photos,
    pages,
  };
  return { format: formatOf(book), ...book };
}

/*
 * What a book's photographs may cost. Android's PdfDocument keeps a bitmap losslessly - roughly
 * 1.8 bytes a pixel once deflated - so a family with a photograph for everyone could otherwise
 * make a book no chat app will carry. Past the budget every portrait comes down together, to no
 * less than 96 pixels, which still prints cleanly at the sizes the pages use. The desktop embeds
 * JPEG and comes in well under it either way.
 */
const PHOTO_BUDGET = 9_000_000;
const LOSSLESS_BYTES_PER_PIXEL = 1.8;

function budgetPhotos(asked, budget) {
  const list = [...asked].map(([id, px]) => ({ id, px })).sort((a, b) => (a.id < b.id ? -1 : 1));
  const cost = (scale) => list.reduce((sum, p) => sum + Math.pow(Math.max(96, Math.round(p.px * scale)), 2) * LOSSLESS_BYTES_PER_PIXEL, 0);
  if (cost(1) <= budget) return list;
  let lo = 0, hi = 1;
  for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; if (cost(mid) <= budget) lo = mid; else hi = mid; }
  return list.map((p) => ({ id: p.id, px: Math.max(96, Math.round(p.px * lo)) }));
}

/**
 * About how large the PDF will be, for the book screen to say before anyone waits for it:
 * `lossless` for Android's PdfDocument, JPEG otherwise. Fonts and vector pages are a near-constant;
 * photographs are the part that grows.
 */
export function estimateBytes(book, { lossless }) {
  const base = 420_000 + book.pages.length * 18_000;
  const perPixel = lossless ? LOSSLESS_BYTES_PER_PIXEL : 0.22;
  return Math.round(base + book.photos.reduce((sum, p) => sum + p.px * p.px * perPixel, 0));
}

function fileName(title, tpl) {
  const clean = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim() || 'Family';
  return `${clean} ${tpl.fileSuffix ?? 'Book'}.pdf`;
}

/**
 * The toolkit every block draws through. Blocks never build text or photographs by hand: going
 * through here is what keeps every line measured, every photograph at a size the PDF can afford,
 * and every date within the privacy rule.
 */
function context(family, options, tpl, allowance, now) {
  const P = tpl.palette;
  const metricsOf = (role) => METRICS[tpl.fonts[role]];
  const defs = {};
  const photos = new Map();
  const ctx = {
    family,
    facts: familyFacts(family),
    tpl,
    P,
    options: { photos: options.photos !== false, livingDates: options.livingDates === true, words: options.words === 'hi' ? 'hi' : 'en' },
    attribution: allowance.attribution !== false,
    now: { ...now, label: `${MONTHS[now.month - 1]} ${now.year}` },
    defs,
    photos,
    pageNo: 1,
    pageOf: new Map(),

    measure: (s, role, size) => measure(s, metricsOf(role), size),
    fit: (s, role, size, width, min) => fitSize(s, metricsOf(role), size, width, min),

    /** One line, carrying the width it was measured to fit so a painter can hold it there. */
    line(x, y, s, role, size, fill, { align = 'start', width, op } = {}) {
      const w = width ?? measure(s, metricsOf(role), size);
      return text(x, y, s, role, size, fill, { align, w, op });
    },

    /** A paragraph broken into lines. Returns the items and where the next line would go. */
    lines(x, y, s, role, size, fill, { width, maxLines, lead = size * 1.35, align = 'start', op } = {}) {
      const broken = breakLines(s, metricsOf(role), size, width, maxLines);
      const items = broken.map((l, i) => text(x, y + i * lead, l, role, size, fill, { align, w: width, op }));
      return { items, bottom: y + (broken.length - 1) * lead, count: broken.length };
    },

    gradient(id, def) {
      defs[id] = def;
      return { ref: id };
    },

    /**
     * A person's portrait: their photograph when they have one and photographs are wanted, their
     * initial on a ground coloured by gender otherwise, and the dashed ring when nobody recorded
     * their name. The resolution is decided here, from the size the portrait prints at: about
     * 170 pixels an inch, never under 96 or over 200, which is what a family's PDF can carry.
     */
    portrait(p, cx, cy, r, { ring = P.gold, unknownRing = P.goldSoft } = {}) {
      const items = [];
      if (p.photo && ctx.options.photos) {
        const px = Math.min(200, Math.max(96, Math.ceil(((2 * r) / 72) * 170)));
        photos.set(p.id, Math.max(photos.get(p.id) ?? 0, px));
        items.push(image(p.id, cx - r, cy - r, 2 * r, 2 * r, 'circle'));
      } else if (p.name) {
        const ground = p.gender === 'FEMALE' ? P.female : p.gender === 'MALE' ? P.male : P.other;
        items.push(circle(cx, cy, r, { fill: ground }));
        const initial = Array.from(p.name.trim())[0];
        items.push(text(cx, cy + r * 0.38, initial, 'display', r * 1.1, P.ink, { align: 'middle', w: r * 1.6, op: 0.8 }));
      }
      items.push(p.name
        ? circle(cx, cy, r + Math.max(1.5, r * 0.07), { stroke: ring, sw: Math.max(0.6, r * 0.025) })
        : circle(cx, cy, r, { stroke: unknownRing, sw: Math.max(0.8, r * 0.035), dash: [Math.max(2, r * 0.1), Math.max(1.6, r * 0.08)] }));
      return items;
    },

    /** The quiet line at the foot of an interior page. */
    footer(ink) {
      const items = [text(PAGE.w - 40, PAGE.h - 22, String(ctx.pageNo), 'text', 7.5, ink, { align: 'end', w: 30, op: 0.85 })];
      if (ctx.attribution) items.push(text(40, PAGE.h - 22, 'Made with f-tree', 'text', 7, ink, { w: 120, op: 0.75 }));
      return items;
    },

    page(label, items, ground) {
      return { label, items: ground ? [rect(0, 0, PAGE.w, PAGE.h, { fill: ground }), ...items] : items };
    },
  };
  return ctx;
}
