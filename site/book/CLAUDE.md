# The family book

The storybook redesign ("Aangan", umbrella #239) is the book's current work. Before you change
anything in the book, read [docs/storybook-plan.md](../../docs/storybook-plan.md). It covers the
idea, the approved decisions, where to start, and the traps.

Then read:
- [docs/book-design-system.md](../../docs/book-design-system.md), the visual language;
- [docs/family-book.md](../../docs/family-book.md), the Book format and the composer's promises.

The approved style frames in `art/style-frames/approved/` are the visual contract. Where a
document and a frame disagree, the frame wins.

Rules that are easy to break without noticing:
- **The composer is deterministic.** It never reads the clock, the locale, the DOM or the network,
  and it never uses `Math.random`. Its output is held by `golden.txt`.
- **Heirloom's output must stay byte-identical.** A new Book feature appears only in books that
  use it (the lowest format that draws a book).
- **The art invents nobody.** People with no photograph are faceless, or seen from behind.
  Everyone in scope appears in the register. Lamps that count people count exactly one each.
- **Only what both painters can draw:**
  - paths using absolute `M L H V C Q Z`;
  - linear and radial gradients;
  - opacity;
  - group clips, symbols and `use` (Book format 2).

  No filters, masks, blend modes or raster art. `svg.js` and `app/.../book/BookPainter.kt` must
  stay twins.
- **Keep the PDF under 10 MB,** and keep the cover legible at 150 px wide.
- **Never commit a real family's data or photographs.**
