# Aangan: the storybook's design system

This is the visual language of the storybook family book (#239). It is for anyone drawing a page,
adding a motif, or building a new template on the same art. The engineering contract, the Book
format and the composer's promises, is in [family-book.md](family-book.md). The asset rules are in
[`site/book/art/README.md`](../site/book/art/README.md).

The style frames in `site/book/art/style-frames/` are the reference for all of it. Ankit approved
them on 2026-09-16 (#240), and the rendered pages are in `style-frames/approved/`. If this document
and a frame disagree, the approved frame wins and this document is fixed. The plan and the handoff
are in [storybook-plan.md](storybook-plan.md).

## The idea

A family is a row of lamps in a courtyard (*aangan*), and each person is one lamp. The book is
built like a **paper-cut lightbox**: layers of cut paper, lamplight glowing between them, and
handmade paper underneath. Sanjhi, the paper-stencil art of Braj, is the craft it borrows from.
Mandana wall painting, rangoli and kolam, and the torans on every festival doorway supply its
ornament.

The book alternates between two kinds of page:
- **Night pages:** the cover, the pages that remember, and the closing. Indigo sky and warm light.
- **Day pages:** the chapters of the story. Cream paper and saturated cut-paper colour.

The alternation is what gives the book its breath.

## Principles

1. **The art invents nobody.**
   - A person without a photograph is drawn faceless: a paper-cut bust in a medallion, or, at
     hero size, a figure seen from behind at a window, looking at the view. Hair, drape and age
     tell a grandmother from a grandson. A face does not.
   - People in scenes are small, seen from behind or in silhouette, and never stand for a
     particular relative.
2. **One lamp per person.** Wherever lamps count people, as on the cover, each lamp is exactly one
   person. Decorative lamps never appear in the same picture as counting lamps.
3. **The notation stays the app's.**
   - *Name not known* is the dashed `brass` perimeter, and on a lamp it is a dashed bowl, still
     lit.
   - *No longer living* is a marigold mala hung beneath the frame, plus the word "Late" or the
     dates. It hangs on the frame, never on the person, and never runs toward a living person's
     portrait. Garlanding a living person's photograph reads as a death omen.
   - *Name not known* in a scene is an **aala**, a niche in the wall of their own house, with a
     lamp kept in it. In lists, the person is named by relation ("Shyam Lal's wife") in `hand`, in
     `brass`.
   - `brass` means *name not known* and nothing else.
4. **Photographs are never altered.** No tint, filter or duotone. The frame joins them to the
   art, and the picture stays as the family took it.
5. **Composition, not labels.** The featured person is larger, central or first. The book never
   prints "featured".
6. **Readable before beautiful.** No text over busy art, and no size below the floors in
   *Density*.

## Typography

Four roles, all static faces, all covering Latin and Devanagari, all OFL:

| role | face | use | sizes (pt) |
|---|---|---|---|
| `display` | Rozha One | chapter titles, the cover, numerals | 28–56 |
| `hand` | Kalam Regular | captions, notes, quotes, kin words: the book's handwritten voice | 10–18 |
| `text` | Mukta Light | story sentences, register dates | 9–13 |
| `strong` | Mukta SemiBold | names | 9–16 |

- A page uses at most three sizes.
- Story sentences are set 13/19, centred when under five lines and ranged left otherwise.
- The register is set 9.6/21.
- Kin words (दादी, नानी…) are set in `hand` under a name, in `clay`. Parents are पिताजी / माँ
  (approved). The in-laws' household is ससुराल. Where Hindi has no everyday word, the English is
  used.

## Palette

Art refers only to tokens, never to raw colour, so a template can recolour everything.

| group | token | hex | role |
|---|---|---|---|
| paper | `paper` | `#F6ECDA` | day ground |
| | `paperDeep` | `#EAD7B5` | fibre clouds, medallion grounds, floors |
| | `card` | `#FFF8EC` | notes, nameboards, chalk lines |
| ink | `ink` | `#2A1A33` | text, shadows |
| | `inkSoft` | `#5E4A66` | secondary text |
| night | `night`, `deep`, `glow`, `dusk`, `haze` | `#1F1840` `#17122E` `#3A2352` `#7A3E63` `#5A3462` | sky and night layers, darkening toward the reader (`deep` is lifted from black so home inkjets don't flood) |
| light | `gold`, `flame` | `#F2B84B` `#FFE7A6` | lamplight, frame lines |
| | `brass` | `#B9822A` | **only** for *name not known* |
| cut paper | `marigold`, `saffron`, `sindoor`, `rani`, `peacock`, `indigo`, `leaf`, `leafDeep` | | flowers, cloth, doors, walls |
| | `stone`, `clay`, `wash`, `sky` | `#D9A77A` `#B5562A` `#6F93C7` `#F3DDB8` | walls, earth, blue-washed walls, day sky |
| | `dayHaze`, `dayMid` | `#E9B777` `#D99A62` | far and middle distance on day and dusk pages: opaque steps, never transparent overlaps |
| people | `skin`, `silver` | `#B97A52` `#D9D2CA` | one warm paper tone for every face; elders' hair |

`skin` is one paper colour for everyone, on purpose: the book does not guess anybody's
complexion.

## Paper and depth

- **Flat colour only.** Each layer is one token, or one linear or radial gradient.
- **Paper shadow.**
  - Every cut layer casts a shadow: the same shape, offset about 1.7 pt across and 2.3 pt down,
    in `ink` at 20–25% opacity.
  - Large layers use the *soft* shadow: three offsets fading out. That is the lightbox look, and
    it costs only plain opacity.
- **Hand-cut edges.** Outlines are sampled, nudged by a seeded low-frequency wobble and smoothed.
  Nothing is geometrically perfect.
- **Handmade paper.** Day pages carry seven large, faint clouds of `paperDeep`. There is no speck
  grain: thousands of tiny marks bloat the PDF.
- **Sanjhi bands.** A page may carry one band along its top or foot. It is one colour of paper,
  26–30 pt deep, with a scalloped inner edge, and keri (mango) and lotus shapes cut through it
  with the even-odd rule. Keep the cut-outs at least 6 mm inside the trim, and keep folios and
  footers clear of the band.
- **Light.**
  - Lamplight is stacked translucent discs (`glowDiscs`), not gradients. A PDF draws discs with
    plain alpha, but every gradient with transparent stops becomes a soft mask.
  - Keep radial glows to about ten per page.

## Illustration

- **Scenes** are 3–6 layers, back to front: sky, far skyline, midground, foreground, light. Near
  layers are darker on night pages. Every scene leaves a clear **text zone**. Nothing tall rises
  into a title.
- **Motifs**, in `site/book/art/`:
  - light: diya (lit, and the unknown variant), floating diya on a leaf boat, akash kandil, sky
    lantern;
  - flora: marigold (three cut variants), mango leaf, peepal, lotus, mala (marigold string),
    toran;
  - architecture: jharokha arches (cusped, pointed, round), haveli facade (kangura parapet;
    arched, shuttered and jaali windows; balcony; pots), shikhara, dome, chhatri, ghat umbrella,
    tulsi vrindavan;
  - pattern: rangoli, rangoli band, mandana border, paisley;
  - figures: faceless bust, the hero seen from behind at a window, seated figures seen from
    behind, a child with a phuljhadi;
  - places: aala niche, kolam, ladi lights, water tank, washing line, chhajja, deepstambh, Sanjhi
    band.
- **Scenes are lit for Diwali:** diyas on parapets and sills, *ladi* string lights, akash
  kandils. They are Indian streets, with water tanks on the roofs, washing lines, chhajja eaves,
  otla steps, and kolam at the doors.
- **Rangoli is used at most twice in a book**, varied. Doorsteps get a kolam instead.
- **Cultural care.**
  - No religious symbols stand for a family: no Om, swastika, tilak, cross or crescent on a
    person. No bindi or sindoor on faceless women. No pennants on temples.
  - A couple where one has died is joined by a diya between the frames, never by a mauli
    thread.
  - Clothing is shown as drape and border, across communities.
  - Diwali's own imagery (lamps, rangoli, torans, lanterns) belongs to the Diwali template, not to
    the people in it.

## People

**Avatars** are chosen from the record alone:
- **Gender:** female, male, or unspecified. Any unrecorded value is unspecified.
- **Life stage:** child under 13, youth under 30, adult under 60, elder. It is taken from the
  birth year against the book's date. With no year, it comes from the generation's distance to
  the featured person.
- **Variant:** cloth and drape come from a stable hash of the person's id, so one person looks the
  same on every page.
- **Elders** get silver hair and spectacles.
- **Collage.** Hair and drape are separate cut layers with their own shadows. Cloth carries a
  block-print dot and a border.

Sizes:

| use | form | size |
|---|---|---|
| hero, no photo | seen from behind at an arch window: collar, both ears, hair cut in clumps | 150–200 pt tall |
| story medallion | bust in a thin gold bezel; a couple's pair share a carved ring | 36–90 pt across |
| register cameo | bust in a plain gold bezel, no garland | 22 pt across |

**Name not known:** in a scene, an aala niche with a lit lamp and a perforated brass rim; in a
medallion, the dashed brass perimeter with a lamp inside.

**Photographs:**
- Mounted like a print: a cream mat inside a carved wooden ring, and a gold line drawn over the
  clip edge. That hides Android's jagged clip and joins the photo to the art.
- Hero photographs print at 72 mm at most. The source is 512 px, and they are never upscaled.

## Page furniture

- **Margins.** A4 is 595 × 842 pt. The text-safe area is inset 42 pt at the sides, 54 pt at the
  top and 50 pt at the foot. Art may bleed.
- **Folio.** A small lit diya and the page number at the outer foot, with "Made with f-tree"
  quietly at the opposite corner.
- **Chapter openings** each use a different composition: arch window, full scene, doorways, lane,
  register, niches.
- **Continuation pages** reuse the chapter's motif smaller.
- **A chapter ending early** closes with a tailpiece: a diya and a short mala.
- **Relationships are composition.**
  - A marriage is a marigold string between two frames.
  - Children stand below their parents.
  - Siblings share one ground line.
  - Households are doorways, and wider family is a lane of houses.
- **The handwritten note,** a torn card with a strip of tape, is the book's voice. Use one per page
  at most.

## Density

These floors are enforced by the composer's tests (#245), not left to taste:

| rule | limit |
|---|---|
| body text | ≥ 10.5 pt |
| names | ≥ 9 pt |
| captions | ≥ 8 pt |
| anything | ≥ 7 pt |
| hero pages | 1–2 people |
| family pages | ≤ 8 people |
| gatherings | ≤ 12 people |
| lane | 4 houses × ≤ 8 names |
| register | ≤ 48 rows a page |
| continuation page | ≥ 3 entries |

- **Variety:** no two consecutive pages share both a composition and an art placement.
- **Collisions:** no text sits in an art zone marked `busy`, and no text overlaps other text.

## Reviewing art

Render the frames or pages, look at them at full size and at thumbnail size, and compare them with
the approved frames:

```
site/book/art/style-frames/render.sh <out-dir> <fonts-dir> [page ...]
```

Every scene gets at least three passes of render, look and refine before review.
