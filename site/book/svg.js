/*
 * The SVG painter: a Book (format.js) drawn as one SVG document per page.
 *
 * The desktop previews these pages as they are and prints them to PDF through Chromium, so this
 * is the desktop's whole renderer; Android's painter draws the same items onto a Canvas. Neither
 * makes a layout decision - if a page looks wrong, the fault is in the composer, and it is wrong
 * on both.
 *
 * One liberty is allowed, and fitText takes it: a line wider than the width the composer measured
 * it at is shrunk to fit. The composer measures from advance tables and Chromium shapes with
 * HarfBuzz, so a Devanagari conjunct can differ by a few per cent; shrinking by that much is
 * invisible, and overflowing a card is not.
 *
 * Format 2's symbols are expanded inline rather than drawn as <use href="#id">. A page has to be a
 * document on its own: the desktop joins every page into one file to print it, and a symbol that
 * kept its id would then meet a copy of itself on the next page. Expanding costs some markup and
 * buys a page that can be previewed, printed or saved alone.
 */

import { FORMAT, FORMAT_MAX } from './format.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * @param book      a Book
 * @param index     which page
 * @param resolve   { photo(id) -> href or null, font(key) -> CSS font-family, idPrefix }
 */
export function paintPage(book, index, resolve) {
  if (book.format !== FORMAT && book.format !== FORMAT_MAX) throw new Error(`svg: cannot paint book format ${book.format}`);
  const page = book.pages[index];
  const prefix = resolve.idPrefix ?? `p${index}-`;
  const state = { defs: new Map(), clips: [], n: 0, depth: 0, prefix, book, resolve };
  const body = page.items.map((it) => item(it, state)).join('');
  const defs = [...state.defs.values()].join('') + state.clips.join('');
  const { w, h } = book.size;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}pt" height="${h}pt" role="img" aria-label="${esc(`Page ${index + 1} of ${book.pages.length}: ${page.label}`)}">`
    + (defs ? `<defs>${defs}</defs>` : '') + body + '</svg>';
}

function fillAttr(fill, state) {
  if (fill === undefined) return 'none';
  if (typeof fill === 'string') return fill;
  const id = state.prefix + fill.ref;
  if (!state.defs.has(id)) state.defs.set(id, gradient(id, state.book.defs[fill.ref]));
  return `url(#${id})`;
}

function gradient(id, g) {
  const stops = g.stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a === undefined || a === 1 ? '' : ` stop-opacity="${a}"`}/>`).join('');
  if (g.units === 'item') {
    // Relative to the circle it fills: the centre offset and radius are in units of its radius.
    return `<radialGradient id="${id}" gradientUnits="objectBoundingBox" cx="${0.5 + g.cx / 2}" cy="${0.5 + g.cy / 2}" r="${g.r / 2}">${stops}</radialGradient>`;
  }
  if (g.type === 'radial') return `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${g.cx}" cy="${g.cy}" r="${g.r}">${stops}</radialGradient>`;
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}">${stops}</linearGradient>`;
}

function stroke(it) {
  if (!it.stroke) return '';
  let s = ` stroke="${it.stroke}" stroke-width="${it.sw}"`;
  if (it.dash) s += ` stroke-dasharray="${it.dash.join(' ')}"`;
  if (it.cap) s += ` stroke-linecap="${it.cap}"`;
  if (it.join) s += ` stroke-linejoin="${it.join}"`;
  return s;
}

const opacity = (it) => (it.op !== undefined ? ` opacity="${it.op}"` : '');

const transform = (it) => (it.tf ? ` transform="matrix(${it.tf.join(' ')})"` : '');

/** A clip shape, kept in the page's own defs under an id nothing else on the page can take. */
function clipPath(shape, state) {
  const id = `${state.prefix}clip${state.n++}`;
  state.clips.push(`<clipPath id="${id}">${shape}</clipPath>`);
  return id;
}

/*
 * Silhouette mode: one fill for everything the symbol draws, and no strokes at all. A shadow of a
 * lamp is the shape of the lamp, not a drawing of it, so a symbol's own gold hairline must not
 * survive into the shadow cast from it. A nested use inherits the fill, so a compound motif casts
 * one shadow rather than a stack of them.
 */
function silhouette(it, fill) {
  const { stroke, sw, dash, cap, join, ...rest } = it;
  if (it.t === 'group') return { ...rest, items: (it.items ?? []).map((c) => silhouette(c, fill)) };
  return { ...rest, fill };
}

function expand(it, state) {
  const symbol = state.book.symbols?.[it.ref];
  if (!symbol) throw new Error(`svg: unknown symbol ${it.ref}`);
  if (state.depth >= 5) throw new Error(`svg: symbol ${it.ref} is used too deep`);   // validateBook refuses the cycle; this stops a bad book hanging the preview
  state.depth++;
  const items = it.fill === undefined ? symbol.items : symbol.items.map((c) => silhouette(c, it.fill));
  const body = items.map((c) => item(c, state)).join('');
  state.depth--;
  return `<g${transform(it)}${opacity(it)}>${body}</g>`;
}

function item(it, state) {
  switch (it.t) {
    case 'rect':
      return `<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}"${it.r ? ` rx="${it.r}"` : ''} fill="${fillAttr(it.fill, state)}"${stroke(it)}${opacity(it)}/>`;
    case 'circle':
      return `<circle cx="${it.cx}" cy="${it.cy}" r="${it.r}" fill="${fillAttr(it.fill, state)}"${stroke(it)}${opacity(it)}/>`;
    case 'path':
      return `<path d="${it.d}" fill="${fillAttr(it.fill, state)}"${it.rule === 'evenodd' ? ' fill-rule="evenodd"' : ''}${stroke(it)}${opacity(it)}/>`;
    case 'text': {
      const anchor = it.align === 'middle' ? ' text-anchor="middle"' : it.align === 'end' ? ' text-anchor="end"' : '';
      const family = esc(state.resolve.font(state.book.fonts[it.font]));
      return `<text x="${it.x}" y="${it.y}" font-family="${family}" font-size="${it.size}" fill="${fillAttr(it.fill, state)}"${anchor}${it.w !== undefined ? ` data-w="${it.w}"` : ''}${opacity(it)}>${esc(it.s)}</text>`;
    }
    case 'image': {
      const href = state.resolve.photo(it.id);
      if (!href) return '';   // a photograph the archive has lost: the portrait's ring still stands
      const shape = it.clip === 'circle'
        ? `<circle cx="${it.x + it.w / 2}" cy="${it.y + it.h / 2}" r="${Math.min(it.w, it.h) / 2}"/>`
        : `<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}"/>`;
      const id = clipPath(shape, state);
      return `<image href="${esc(href)}" x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"${opacity(it)}/>`;
    }
    case 'group': {
      const tf = transform(it);
      const clip = it.clip === undefined ? '' : ` clip-path="url(#${clipPath(`<path d="${it.clip}"/>`, state)})"`;
      const body = it.items.map((c) => item(c, state)).join('');
      // A clip is in the group's own coordinates, so where there is a transform the clip goes
      // inside it, on a group of its own. That is the order a Canvas painter takes: save, concat,
      // clipPath, draw. Without a transform the two coordinate systems are the same one group.
      return tf && clip ? `<g${tf}${opacity(it)}><g${clip}>${body}</g></g>` : `<g${tf}${clip}${opacity(it)}>${body}</g>`;
    }
    case 'use':
      return expand(it, state);
    default:
      throw new Error(`svg: unknown item type ${it.t}`);
  }
}

/**
 * Shrinks, never grows, any line that Chromium measures wider than the composer did. Run it in a
 * document where the fonts have loaded (document.fonts.ready), or it measures the fallback face.
 * Returns how many lines it had to touch, which the tests watch: for Latin text it should be none.
 */
export function fitText(root) {
  let corrected = 0;
  for (const el of root.querySelectorAll('text[data-w]')) {
    const want = Number(el.getAttribute('data-w'));
    const got = el.getComputedTextLength();
    if (want > 0 && got > want * 1.005) {
      const size = Number(el.getAttribute('font-size'));
      el.setAttribute('font-size', String(Math.round(size * (want / got) * 100) / 100));
      corrected++;
    }
  }
  return corrected;
}
