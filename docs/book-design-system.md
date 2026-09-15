# Aangan: the storybook's design system

This is the visual language of the storybook family book (#239). It is for anyone drawing a page,
adding a motif, or building a new template on the same art. The engineering contract, the Book
format and the composer's promises, is in [family-book.md](family-book.md). The asset rules are in
[`site/book/art/README.md`](../site/book/art/README.md).

The style frames in `site/book/art/style-frames/` are the reference for all of it (#240). If this
document and a frame disagree, the approved frame wins and this document is fixed.

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
   - A person without a photograph is drawn faceless: a paper-cut bust in a medallion, or a
     profile silhouette in a hero frame. Hair, drape and age tell a grandmother from a grandson.
     A face does not.
   - People in scenes are small, seen from behind or in silhouette, and never stand for a
     particular relative.
2. **One lamp per person.** Wherever lamps count people, as on the cover, each lamp is exactly one
   person. Decorative lamps never appear in the same picture as counting lamps.
3. **The notation stays the app's.**
   - *Name not known* is the dashed `brass` perimeter, and on a lamp it is a dashed bowl, still
     lit.
   - *No longer living* is a thin marigold garland at the foot of the frame, plus the word
     "Late" or the dates.
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
- Kin words (दादी, नानी…) are set in `hand` under a name, in `clay`.

## Palette

Art refers only to tokens, never to raw colour, so a template can recolour everything.

| group | token | hex | role |
|---|---|---|---|
| paper | `paper` | `#F6ECDA` | day ground |
| | `paperDeep` | `#EAD7B5` | fibre clouds, medallion grounds, floors |
| | `card` | `#FFF8EC` | notes, nameboards, chalk lines |
| ink | `ink` | `#2A1A33` | text, shadows |
| | `inkSoft` | `#5E4A66` | secondary text |
| night | `night`, `deep`, `glow`, `dusk` | `#1C1638` `#0D0A1F` `#3A2352` `#7A3E63` | sky and night layers, darkening toward the reader |
| light | `gold`, `flame` | `#F2B84B` `#FFE7A6` | lamplight, frame lines |
| | `brass` | `#B9822A` | **only** for *name not known* |
| cut paper | `marigold`, `saffron`, `sindoor`, `rani`, `peacock`, `indigo`, `leaf`, `leafDeep` | | flowers, cloth, doors, walls |
| | `stone`, `clay`, `wash`, `sky` | `#D9A77A` `#B5562A` `#8DB0D8` `#F3DDB8` | walls, earth, blue-washed walls, day sky |
| people | `skin`, `silver` | `#B97A52` `#D9D2CA` | one warm paper tone for every face; elders' hair |

`skin` is one paper colour for everyone, on purpose: the book does not guess anybody's
complexion.

## Paper and depth

- **Flat colour only.** Each layer is one token, or one linear or radial gradient.
- **Paper shadow.**
  - Every cut layer casts a shadow: the same shape, offset about 1.1 pt across and 1.6 pt down,
    in `ink` at 15–25% opacity.
  - Large layers use the *soft* shadow: three offsets fading out. That is the lightbox look, and
    it costs only plain opacity.
- **Hand-cut edges.** Outlines are sampled, nudged by a seeded low-frequency wobble and smoothed.
  Nothing is geometrically perfect.
- **Handmade paper.** Day pages carry seven large, faint clouds of `paperDeep`. There is no speck
  grain: thousands of tiny marks bloat the PDF.
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
  - figures: faceless bust, profile silhouette, seated figure seen from behind.
- **Cultural care.**
  - No religious symbols stand for a family: no Om, swastika, tilak, cross or crescent on a
    person.
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
| hero, no photo | profile silhouette in an arch | 150–200 pt tall |
| story medallion | bust in a round medallion with a marigold-petal ring | 36–90 pt across |
| register cameo | bust in a plain gold ring, no petals or garland | 16 pt across |

**Name not known:** the medallion's ring is the dashed brass perimeter, with a lit lamp inside.

**Photographs:**
- Clipped to the frame, with a gold line drawn over the clip edge. That hides Android's jagged
  clip and joins the photo to the art.
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
