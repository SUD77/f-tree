/*
 * Templates are data, and are read as though they came from a stranger.
 *
 * Today every template ships inside the release. One day they may be downloaded (#214), and a
 * downloaded file is content the app renders, so the rule is set now: a template is a JSON
 * document that chooses among things the composer already knows how to draw - a palette, three
 * font roles, which pages in which order, a few lines of copy - and can do nothing else. There is
 * no script in it and no way to reference anything outside it. Anything unexpected is refused
 * rather than guessed at, so a template written for a newer app fails loudly on an older one
 * instead of drawing a book half-right.
 */

export const TEMPLATE_FORMAT = 1;

export const BLOCKS = ['cover', 'tree', 'numbers', 'generations', 'find', 'closing'];

/** The font files a template may choose among - the ones the release embeds. */
export const FONT_KEYS = ['book_display', 'book_text', 'book_strong'];

export const PALETTE_KEYS = [
  'night', 'deep', 'glow', 'gold', 'goldSoft', 'star', 'mist',
  'paper', 'ink', 'inkSoft', 'aged', 'card', 'rule',
  'female', 'male', 'other',
  'clay', 'flame', 'petalA', 'petalB', 'lanternBody', 'lanternTop',
];

const COLOUR = /^#[0-9a-f]{6}$/;
const ID = /^[a-z][a-z0-9-]{1,31}$/;
const TOP = new Set(['format', 'id', 'name', 'fonts', 'palette', 'pages', 'cover', 'fileSuffix']);
const COVER = new Set(['motif', 'greeting', 'subtitle', 'line', 'ornaments']);
const ORNAMENTS = ['lanterns', 'rangoli'];

function fail(msg) {
  throw new Error(`template: ${msg}`);
}

const plainText = (v, max, what) => {
  if (typeof v !== 'string' || !v.trim() || v.length > max || /[\u0000-\u001f<>]/.test(v)) fail(`${what} must be plain text under ${max} characters`);
  return v;
};

/**
 * Copy that counts people may say it both ways - `{ one, other }` - because "One lamps" is the
 * first thing a new reader with a tree of one would see. A plain string is used for every count.
 */
function plural(v, max, what) {
  if (typeof v === 'string') return { one: plainText(v, max, what), other: v };
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join() !== 'one,other') fail(`${what} must be text, or { one, other }`);
  return { one: plainText(v.one, max, `${what}.one`), other: plainText(v.other, max, `${what}.other`) };
}

export function validateTemplate(t) {
  if (!t || typeof t !== 'object' || Array.isArray(t)) fail('not an object');
  if (t.format !== TEMPLATE_FORMAT) fail(`format ${t.format} - this app reads format ${TEMPLATE_FORMAT}`);
  for (const k of Object.keys(t)) if (!TOP.has(k)) fail(`unknown key "${k}"`);
  if (typeof t.id !== 'string' || !ID.test(t.id)) fail('id must be lower-case letters, digits and hyphens');
  const name = plainText(t.name, 40, 'name');

  const fonts = {};
  for (const role of ['display', 'text', 'strong']) {
    if (!FONT_KEYS.includes(t.fonts?.[role])) fail(`font for "${role}" must be one of ${FONT_KEYS.join(', ')}`);
    fonts[role] = t.fonts[role];
  }
  if (Object.keys(t.fonts).length !== 3) fail('fonts has keys other than display, text and strong');

  const palette = {};
  for (const k of PALETTE_KEYS) {
    const v = t.palette?.[k];
    if (typeof v !== 'string' || !COLOUR.test(v)) fail(`palette.${k} must be a #rrggbb colour`);
    palette[k] = v;
  }
  for (const k of Object.keys(t.palette)) if (!PALETTE_KEYS.includes(k)) fail(`unknown palette key "${k}"`);

  if (!Array.isArray(t.pages) || !t.pages.length) fail('pages must list blocks');
  for (const p of t.pages) if (!BLOCKS.includes(p)) fail(`unknown block "${p}"`);
  if (new Set(t.pages).size !== t.pages.length) fail('a block is listed twice');
  if (t.pages[0] !== 'cover') fail('the first page must be the cover - it is the one a chat app shows');

  const c = t.cover ?? {};
  for (const k of Object.keys(c)) if (!COVER.has(k)) fail(`unknown cover key "${k}"`);
  if (!['stars', 'lamps'].includes(c.motif)) fail('cover.motif must be "stars" or "lamps"');
  const ornaments = c.ornaments ?? [];
  if (!Array.isArray(ornaments) || ornaments.some((o) => !ORNAMENTS.includes(o))) fail(`cover.ornaments may only be ${ORNAMENTS.join(', ')}`);
  const cover = {
    motif: c.motif,
    greeting: c.greeting === undefined ? null : plainText(c.greeting, 40, 'cover.greeting'),
    subtitle: c.subtitle === undefined ? null : plainText(c.subtitle, 60, 'cover.subtitle'),
    line: c.line === undefined ? null : plural(c.line, 80, 'cover.line'),
    ornaments: [...ornaments],
  };

  const fileSuffix = t.fileSuffix === undefined ? 'Book' : plainText(t.fileSuffix, 20, 'fileSuffix');
  return Object.freeze({ format: t.format, id: t.id, name, fonts, palette, pages: [...t.pages], cover, fileSuffix });
}
