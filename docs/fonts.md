# Bundled fonts

## The app's own fonts

Both are subset to Latin and Latin Extended and keep their variable weight axis, which is why
they are a fraction of the size of the originals (Literata 955 KB -> 185 KB, JetBrains Mono
187 KB -> 65 KB). Text outside that range still renders: Compose falls back to the system fonts
for any glyph these do not carry.

| File | Family | Used for | Licence |
|---|---|---|---|
| `literata.ttf` | Literata (opsz pinned to 16) | people's names | SIL OFL 1.1 |
| `jetbrains_mono.ttf` | JetBrains Mono | dates, years, counts | SIL OFL 1.1 |

Licence texts are shipped in `assets/licenses/` and shown in the app's About screen.

Regenerate with:

```bash
fonttools varLib.instancer Literata[opsz,wght].ttf opsz=16 -o literata_opsz.ttf
pyftsubset literata_opsz.ttf --output-file=literata.ttf --unicodes="$LATIN" \
  --layout-features='kern,liga,calt,onum,lnum,tnum,ccmp,mark,mkmk' --name-IDs='*'
```

## The book's fonts

The book (#200) is composed from a display list in an Android WebView and printed to PDF through
Skia. That pipeline sets two requirements the app's own fonts don't have to meet:

- Devanagari names must never fall back to system boxes — the book is meant to be handed to
  relatives who cannot read Latin script, and a tofu glyph in a printed family tree is a failure
  the reader cannot miss.
- The composer measures a line before it draws it, to decide where a page breaks, and it does that
  in a WebView with no layout-engine access on the Android side. It needs committed advance-width
  tables it can read itself (`tools/font_metrics.mjs`, below) rather than asking the platform.

Both needs point at the same font, chosen once and subset once:

| File | Family | Weight | Used for | Why this face |
|---|---|---|---|---|
| `book_display.ttf` | Rozha One | Regular (static) | headings, generation numerals | The only display-weight candidate that covers Latin *and* Devanagari in one static file — see below for why static matters. |
| `book_text.ttf` | Mukta | Light / 300 (static) | body text, captions | Same family as `book_strong.ttf`, so text and its emphasis share metrics and never visually clash; covers Latin and Devanagari in one static file. |
| `book_strong.ttf` | Mukta | SemiBold / 600 (static) | names, emphasis | The SemiBold static instance of the same family as `book_text.ttf`. |

**Static, not variable, and that is a functional requirement, not a preference.** Skia's PDF
backend renders a variable font's default instance by writing each glyph as its own miniature PDF
program — a Type3 font — rather than embedding real outlines. Type3 glyphs are not selectable,
copyable, or searchable text, and they bloat the file, which defeats the entire point of a printed
book meant to last. Rozha One and Mukta both ship pre-built static instances upstream (Rozha One
has only ever had one weight; Mukta ships Light and SemiBold as separate static files), so no
`varLib.instancer` step was needed here the way it was for Literata above — subsetting starts
directly from the upstream static TTF.

**Reserved Font Name check.** Both `OFL.txt` files were read in full. Neither declares a Reserved
Font Name in its copyright statement — the only place an RFN can be declared — so a subset counts
as an unrestricted Modified Version and the original family and style names (`Rozha One`; `Mukta
Light` / `Mukta SemiBold`) were kept in the subset's `name` table exactly as upstream wrote them.
If a future book font *does* carry an RFN, rename name IDs 1, 4, 6 and 16 to something like `FTree
Book Display` before subsetting, and say so here — do not ship a Modified Version under a Reserved
Font Name.

### Subsetting

Upstream sources (OFL, from Google Fonts' own repository, not a mirror):

```
https://github.com/google/fonts/raw/main/ofl/rozhaone/RozhaOne-Regular.ttf
https://github.com/google/fonts/raw/main/ofl/rozhaone/OFL.txt
https://github.com/google/fonts/raw/main/ofl/mukta/Mukta-Light.ttf
https://github.com/google/fonts/raw/main/ofl/mukta/Mukta-SemiBold.ttf
https://github.com/google/fonts/raw/main/ofl/mukta/OFL.txt
```

Unicode ranges cover everything the book's Latin and Hindi/Devanagari text can contain, plus the
handful of punctuation and control characters Devanagari shaping needs even when nothing else in
the range is used:

```bash
UNICODES="U+0000-007F,U+0080-00FF,U+0100-017F,U+2000-206F,U+20A8-20B9,U+0900-097F,U+A8E0-A8FF,U+200C,U+200D,U+25CC"

pyftsubset RozhaOne-Regular.ttf --output-file=book_display.ttf --unicodes="$UNICODES" \
  --layout-features='*' --name-IDs='*' --glyph-names --notdef-outline --no-hinting

pyftsubset Mukta-Light.ttf --output-file=book_text.ttf --unicodes="$UNICODES" \
  --layout-features='*' --name-IDs='*' --glyph-names --notdef-outline --no-hinting

pyftsubset Mukta-SemiBold.ttf --output-file=book_strong.ttf --unicodes="$UNICODES" \
  --layout-features='*' --name-IDs='*' --glyph-names --notdef-outline --no-hinting
```

What each range is for:

- `U+0000-007F`, `U+0080-00FF`, `U+0100-017F` — Basic Latin, Latin-1 Supplement, Latin Extended-A:
  English names, dates and captions, plus the accented Latin letters transliteration can need.
- `U+2000-206F` — General Punctuation: quotation marks, dashes, and (within this same block)
  U+200C/U+200D, ZWNJ and ZWJ, which several Devanagari conjuncts require to shape correctly.
  Listed a second time below on purpose — see next point.
- `U+20A8-20B9` — Currency Symbols, narrowed to just the range that includes the rupee sign
  (U+20B9), the one currency mark this project has any reason to print.
- `U+0900-097F`, `U+A8E0-A8FF` — Devanagari and Devanagari Extended: the script itself, plus the
  extended block some transliteration and Vedic marks live in.
- `U+200C`, `U+200D` — ZWNJ/ZWJ, called out explicitly even though `U+2000-206F` already includes
  them: Devanagari shaping depends on them so directly that leaving their inclusion implicit,
  behind an unrelated range's boundaries, felt like the kind of thing a future edit could silently
  break by narrowing that range.
- `U+25CC` — dotted circle, the placeholder shaping engines draw a bare combining mark on. Without
  it, an isolated matra with no base consonant (a data-entry mistake this app cannot rule out)
  renders as nothing rather than as a visibly wrong glyph.

`--layout-features='*'` keeps every GSUB/GPOS lookup rather than a hand-picked list: Devanagari
shaping (conjunct formation, reordering matras, half-forms) depends on lookups a Latin-oriented
feature list like Literata's would drop. `--name-IDs='*' --glyph-names --notdef-outline` keep the
full naming table, real glyph names instead of `glyphNNNN`, and a visible `.notdef` box rather than
an empty one — all cheap, all useful for debugging a rendering problem later.

`--no-hinting` is the one flag not carried over from the Literata recipe above, and it is what
brings this pair of scripts inside budget: both upstream fonts ship hand-authored TrueType
instructions sized for on-screen legibility at small point sizes on old, low-DPI hardware, and
those instructions turned out to be roughly half of the subset's `glyf` table — Latin didn't need
them nearly this much. None of that grid-fitting reaches the page: Skia's PDF backend embeds
outlines as vector paths, not a hinted raster, so the bytecode was pure dead weight for this
specific pipeline. Dropping it took the total from roughly 1.04 MB to 0.70 MB.

### Sizes

| File | Size |
|---|---|
| `book_display.ttf` | 183,808 bytes (179.5 KB) |
| `book_text.ttf` | 279,316 bytes (272.8 KB) |
| `book_strong.ttf` | 273,260 bytes (266.9 KB) |
| **Total** | **736,384 bytes (0.70 MB)** |

Comfortably inside the ~0.6–0.9 MB target from #203/#202.

### Licences

`assets/licenses/rozha_one_OFL.txt` and `assets/licenses/mukta_OFL.txt` carry the upstream licence
text (the same file covers both Mukta weights, since they come from one upstream OFL). Both are
named in the About screen's font credits alongside Literata and JetBrains Mono.

### Metrics

`tools/font_metrics.mjs` reads `head`, `hhea`, `hmtx`, `cmap` (format 4, and format 12 for a future
font whose coverage needs it) and `OS/2` straight out of each `book_*.ttf` — no `fonttools`
dependency, because this script also needs to run wherever the composer's own build runs. It writes
one ES module per font to `site/book/metrics/<name>.js`:

```js
export default {
  name: 'book_text',
  unitsPerEm, ascender, descender, capHeight,
  defaultAdvance,       // the advance for any glyph past hmtx's explicit entries
  advances: { <codepoint>: <advance in font units>, ... },  // only for codepoints the font maps
};
```

An ES module rather than JSON because the composer imports it inside an Android WebView as old as
Chrome 80, which has no JSON module support.

Regenerate after any change to a `book_*.ttf`:

```bash
node tools/font_metrics.mjs
```

Check without writing (what CI runs, in both `.github/workflows/desktop.yml` and
`.github/workflows/pages.yml`, beside the existing layout checks):

```bash
node tools/font_metrics.mjs --check
```

It exits non-zero if a committed metrics file doesn't match what the current TTF would produce —
the guard against a font swap that shipped without regenerating its metrics.
