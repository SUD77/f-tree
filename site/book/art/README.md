# Book art

The storybook's illustrations: vector paper-cut, drawn by the composer into a Book and painted by
both shells. The design rules are in [docs/book-design-system.md](../../../docs/book-design-system.md),
and the umbrella issue is #239.

```
art/
  style-frames/        the approved look (#240): kit.mjs, motifs.mjs, frames.mjs, render.sh
  src/papercut/        authored SVG sources, not shipped (#247, #253, #254)
    scenes/  avatars/  frames/  motifs/  ornaments/
    swatches.json      authoring colour → palette token
  papercut/            generated JS modules, committed, statically imported (#247)
  procedural/          seeded generators: rangoli, torans, diya rows (#255)
```

## Rules for anything drawn here

1. **Only what the painters can draw.**
   - Allowed: absolute `M L H V C Q Z` paths (the compiler converts arcs and relative commands),
     circles, rects, linear and radial gradients, groups with a matrix, opacity and a clip path,
     and symbols placed with `use`.
   - Not allowed: filters, masks, patterns, blend modes, embedded images, or text inside art.
2. **Colour is a token.**
   - Paint with the hexes in `src/papercut/swatches.json`. The compiler maps each one to its
     palette token and refuses any colour it doesn't know.
   - Never use `brass` except for *name not known*.
3. **Leave room for words.**
   - Mark where text may sit with `<rect data-zone="text">`, and where it must never sit with
     `data-zone="busy"`.
   - Mark a face's area with `data-zone="face"`.
   - Put the anchor on the root element: `data-anchor="bottom-center"`.
4. **Budgets.**
   - After compiling: an avatar ≤ 2.5 KB, a frame ≤ 4 KB, a scene ≤ 40 KB.
   - Repeated things (flowers, leaves, lamps) are one symbol placed many times, never copies.
5. **Nobody is invented.** No faces on people, and no figure in a scene that could be read as a
   particular relative. See *Principles* in the design system.
6. **Deterministic.** Wobble and scatter come from `seeded()` with a seed made of the chapter and
   person ids, never the page number, so an unrelated edit doesn't reshuffle a picture.
7. **Provenance.** Everything here is original work made for f-tree under the repository's MIT
   licence. No stock art, no traced artwork, no AI-generated raster. If you adapt a public-domain
   pattern, say so in the SVG's `<desc>`.

## Working on art

- **Render and look.**
  - `site/book/art/style-frames/render.sh <out> <fonts>` renders every frame at 2x with the
    book's own fonts. `<fonts>` must hold `book_display.ttf`, `book_text.ttf`, `book_strong.ttf`
    (all in `app/src/main/res/font/`) and `book_hand.ttf` (Kalam Regular, added by #242).
  - Set `FTREE_FRAME_PHOTOS` to a folder of stand-in portraits to see the photograph treatment.
    Never commit photographs of real people.
- **Look at the result twice:** at full size, and scaled to a phone's chat thumbnail (about 150 px
  wide).
- **Refine at least three times** before asking for review, and compare against the approved style
  frames, not against memory.
