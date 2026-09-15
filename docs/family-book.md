# The family book

A family book is the tree as a designed, printable PDF: a cover, the whole family on one page, the
family in numbers, a page for each generation, an index to find yourself in, and a closing page
that asks who is missing. It is made on the device, offline, by the same code on Android and on
the desktop. Tracked in #200.

## One composer, two painters

```
 .ftree document ──► composeBook(doc, options, template, allowance) ──► Book (a display list)
                     site/book/compose.js, run by both shells                │
                                                                             ├─► desktop: svg.js → SVG pages
                                                                             │   → hidden window → printToPDF
                                                                             └─► Android: WebView returns the
                                                                                 Book → Canvas painter →
                                                                                 PdfDocument
```

The composer is written once, in JavaScript. Every decision about the page is made there: where
each person goes, how each line of text breaks, which pages exist. It hands each shell a **Book**:
a list of pages, each a list of drawing items with every coordinate already settled. A painter
draws the items it is given and decides nothing. That split is what lets the desktop and the phone
produce the same book from the same tree. It is also why a new template never costs two
implementations: a template chooses among the things the composer knows how to draw, and the
painters never learn anything new.

The composer reads the viewer's own model and layout (`site/playground/model.js`,
`site/playground/layout.js`). So the book's tree page and the chart agree about who sits where,
and a kinship fix reaches both at once.

## The Book, format 1

`site/book/format.js` is the source of truth. This section is what a painter must honour.

```
{ format: 1, template, title, fileName, size: { w: 595, h: 842 },
  fonts: { display, text, strong },          // role → font file key (book_display, ...)
  defs:  { <id>: gradient },
  photos: [ { id, px } ],                    // which portraits to fetch, and at what resolution
  pages: [ { label, items: [ ... ] } ] }
```

Pages are A4 in PostScript points. Android's `PdfDocument` takes whole points, so the size is an
integer pair and never changes.

| item | fields | notes |
|---|---|---|
| `rect` | `x y w h [r] [fill] [stroke sw dash] [op]` | `r` is a corner radius |
| `circle` | `cx cy r [fill] [stroke sw dash] [op]` | |
| `path` | `d [fill] [stroke sw dash cap join] [rule] [op]` | `d` uses absolute `M L H V C Q Z` only; `rule` is `nonzero` (default) or `evenodd` |
| `text` | `x y s font size fill [align] [w] [op]` | one line; `y` is the baseline; `align` is `start` (default), `middle` or `end`; `font` is a role |
| `image` | `id x y w h clip [op]` | `id` is a person; `clip` is `circle` or `rect`; the photograph covers the box (centre crop) |
| `group` | `items [tf] [op]` | `tf` is an affine `[a b c d e f]`, SVG's `matrix()` order |

**Fills.** A fill is `#rrggbb` or `{ ref }` naming a gradient in `defs`. A missing fill means no
fill. Opacity is only ever `op`, on an item or a gradient stop, never an alpha in a colour.

**Gradients** are `{ type: 'linear', x1 y1 x2 y2, stops }` or
`{ type: 'radial', cx cy r, stops }`, with `stops` as `[offset, colour, opacity]`. They are in user
space: page coordinates after any group transform. The one exception is `units: 'item'`, allowed
only on a radial gradient that fills a circle. Its centre and radius are then in units of that
circle's radius, from its centre. That is how one glow serves every star on a page. SVG expresses
it with `objectBoundingBox`; Android builds a `RadialGradient` per circle.

**Text is never wrapped by a painter.** The composer breaks lines using advance tables generated
from the embedded fonts (`tools/font_metrics.mjs`), and gives each line the width `w` it measured.
A painter whose font engine measures a line wider than `w` shrinks its size until it fits. It never
grows one. For Latin text the tables are exact and nothing shrinks. For Devanagari, shaping makes
a conjunct narrower than the sum of its parts, so the composer allows a 6% margin and the shrink
covers the rest. `svg.js`'s `fitText` returns how many lines it touched; the preview reports it.

**Photographs** are fetched by person id at the `px` in `book.photos`. The composer chooses it from
the size a portrait prints at: about 170 pixels per inch, never under 96 or over 200. Android's
`PdfDocument` stores bitmaps losslessly, so that choice is what keeps a family's book small enough
to send in a chat app. A photograph the painter cannot load is left out, and the portrait's ring
still stands.

**Refuse, don't approximate.** A painter refuses a `format` it does not know. `validateBook` lists
everything a painter may rely on. The composer's tests run it on every book they make.

## Fonts

Three static files embedded in the release, all covering Latin and Devanagari in one face:
`book_display` (Rozha One), `book_text` (Mukta Light) and `book_strong` (Mukta SemiBold). They
live in `app/src/main/res/font/`, which the desktop package copies too. See [fonts.md](fonts.md).
They are static rather than variable because Skia's PDF backend, used by both Chromium and
`PdfDocument`, writes variable fonts as Type3 outlines, which can't be selected or searched.

## Templates are data

A template is a JSON document (`site/book/templates/`) that chooses:

- a palette;
- three font roles from the embedded files;
- which pages, in which order (`cover` first, always);
- a cover motif, `stars` or `lamps`;
- optional ornaments (`lanterns`, `rangoli`);
- a few lines of cover copy with placeholders: `{family}`, `{from-family}`, `{count}`,
  `{count-words}`, `{Count-words}`.

`template.js` refuses anything else: an unknown key, a colour that isn't `#rrggbb`, a block it
does not know, markup in the copy, a newer `format`. Templates ship inside the release today. The
same rules are what make an on-demand download (#214) safe to add later.

| template | look |
|---|---|
| `heirloom` | Night sky: the family as a constellation, eldest at the centre, each generation an orbit further out |
| `diwali` | The same sky with every person a lamp, a rangoli ring, hanging lanterns, *शुभ दीपावली* |

## What the composer promises

- **Deterministic.** No clock (`options.now` is required), no locale (names sort by a fold of
  their own characters, and Devanagari keeps its vowel signs), no randomness (the starfield is
  seeded by the family's name), coordinates rounded to 0.01 pt. The same tree gives the same bytes
  in node, Electron and an Android WebView. `golden.txt` holds a hash for every fixture and
  template.
- **Private by default.** The departed keep every date on record. The living show only the year
  they were born, unless the reader switches on full dates. No page gives a living person an age:
  the longest life on the numbers page is searched for among the departed only.
- **Honest.** Every mark in the constellation is one person, and every figure on the numbers page
  is counted from the record. People with no link to the main family are kept, in a section of
  their own, but not given a generation number that would claim a relationship.
- **Synchronous and headless.** No DOM, timers or animation frames. A WebView that is not
  attached to a window fires none of them.

## Pages

| block | what it is |
|---|---|
| `cover` | The chat thumbnail: the family's name, the constellation, one sentence. Legible at 150 px wide |
| `tree` | Everyone joined to the family, from the viewer's layout. With less than about 44 pt between people, names would fall under 6 pt, so the page becomes a night silhouette and the names move to the generation pages |
| `numbers` | A star chart plotted on time (across: year of birth, down: generation), then up to six facts |
| `generations` | Generations flow like chapters. A generation that fits on a page is never split; portraits grow as a generation shrinks |
| `find` | *Find yourself*: every named person with their page, in three columns. Left out below six names |
| `closing` | *Is someone missing?*, the edition's month, and the QR code to the website |

## Options and the allowance

`options`: `now` (required), `scope` (`{kind:'everyone'}` or `{kind:'branch', personId}`, the same
cut as sharing a branch), `title`, `photos`, `livingDates`.

`allowance` is what the policy switch (#156, [premium.md](premium.md)) granted. Today it is always
empty, which means everything. `maxGenerations` keeps that many generations from the eldest down;
`attribution: false` leaves out the f-tree credit. Both are tested, so the day a policy uses them
is a policy change, not a composer change.

## Working on it

- `node --test site/book/*.test.mjs` runs the tests. Regenerate the goldens with `UPDATE_GOLDEN=1`
  once a change is meant.
- Serve the repository root (`python3 -m http.server`) and open `/site/book/preview.html` to see
  every template with every fixture, painted by the SVG painter the desktop prints with.
