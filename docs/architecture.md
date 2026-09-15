# Architecture

How f-tree is built, and why it is built that way. This is the long-form companion to the
[README](../README.md) — read it if you want to change the app, or if you are curious how a
family tree is modelled once you accept that families are not trees.

**Contents**

- [Package layout](#package-layout)
- [Data model](#data-model)
- [Relationship rules](#relationship-rules)
- [Deletion](#deletion)
- [The chart](#the-chart)
- [Reading it instead of drawing it](#reading-it-instead-of-drawing-it)
- [Photographs](#photographs)
- [Naming a relationship in another language](#naming-a-relationship-in-another-language)
- [Relating two people](#relating-two-people)
- [Turned sideways](#turned-sideways)
- [Accessibility](#accessibility)
- [Updating in place](#updating-in-place)
- [Nearby sharing](#nearby-sharing)
- [The family book](#the-family-book)
- [Design decisions worth knowing](#design-decisions-worth-knowing)

---

## Package layout

```
data/       Room entities, DAOs, the repository, photo storage
graph/      pure graph logic: traversal, relationship rules, chart layout
transfer/   the .ftree format, export, import, duplicate matching
update/     the optional updater
nearby/     nearby sharing: discovery, handshake, transfer — see docs/nearby-protocol.md
ui/         Compose screens, one package per area
```

Two rules shape the layout of the code:

1. **Anything worth reasoning about is pure.** The chart layout, the relationship rules and the
   duplicate matcher take plain data and return plain data — no Room, no Compose. They run off the
   main thread and are tested directly on the JVM, which is why the trickiest logic in the app is
   also the cheapest to test.
2. **No DI framework.** [`AppContainer`](../app/src/main/java/com/vibethroughcode/ftree/AppContainer.kt)
   wires one repository by hand. For an app this size a compiler plugin would add indirection
   without removing any.

## Data model

A **graph of people and typed edges**, because real families are not trees.

`people` — every descriptive field is optional. A null name *is* the unknown-person mechanism.
Dates are partial ISO-8601 (`1938`, `1938-04`, `1938-04-17`), plus `--04-17` for a birthday with no
known year, so nobody has to invent a day they do not know, and no separate "approximate" flag is needed: the precision is the statement. Age is
derived, never stored. `photoId` is a bare file name, never a path, so a photo survives a reinstall.

`relationships` — `PARENT` (directed, parent → child), `SPOUSE` and `SIBLING` (symmetric). Symmetric
edges are stored in canonical id order, so a **unique index on `(from, to, type)`** makes duplicate
prevention a database guarantee rather than a race the app has to win. The type is persisted by
*name* with an `UNKNOWN` fallback, so a new relationship kind needs no migration and a row written by
a newer version is degraded rather than dropped.

`person_origins` — where an imported person came from. This is what makes a later import recognise
them with certainty instead of by comparing names.

**Siblings are derived** from shared parents in SQL rather than stored. They stay correct when a
parent is added later, and the graph never accumulates O(n²) redundant edges. An explicit `SIBLING`
edge exists only for siblings whose parents are unknown — the one case derivation cannot express.

## Relationship rules

Rejected at the point of creation, not defended against at every read: self-reference, a duplicate
edge, an edge that would make someone their own ancestor, and a parent who is also recorded as their
child's spouse or sibling.

## Deletion

Deleting asks *what happens to the connections*, not whether you are sure:

- **Keep as unknown** — clears the details but keeps the node and every edge, so losing one name does
  not tear a hole in the family.
- **Delete completely** — removes the person and, by cascade, their edges.

## The chart

Ego-centric on purpose. Laying out a whole family produces something no phone can show and no person
can read, so the chart draws one person's ancestors above and descendants below, siblings beside
them, and everything else is reached by re-focusing. Cousins and siblings' descendants are left out:
they multiply width far faster than they add meaning, and they are one tap away.

Only the neighbourhood is loaded, a generation at a time, one batched query per ring — so a tree of
thousands opens as fast as a tree of ten. Everything is painted into a single `Canvas`; pan and zoom
live in float state read *only inside the draw lambda*, so dragging re-runs the draw phase and
nothing else, and offscreen nodes cost a bounds check each.

Notation: marriage is a doubled rule, a couple's children hang from one connector while a
half-sibling hangs from their own, and a person with no name has a dashed brass edge — the gap is in
what the family remembers, not a fault in the record.

Every card opens with a circular portrait. With a photograph it is the square the reader framed;
without one it is the person's initial on a ground coloured by gender, so a chart of a hundred
faceless cards still reads as people rather than as a wall of identical discs. A person whose name
was never recorded keeps the dashed brass ring they have everywhere else. The disc is part of the
card at every zoom and whether or not photographs are switched on, which is what lets
**Settings → Photos on the chart** be turned off on a very large tree without anybody moving.

Photographs on a drawn surface have no `AsyncImage` to hang from, so `ui/tree/ChartPhotos.kt` is the
equivalent for a canvas: it asks only for the faces the viewport can see, decodes them off the main
thread at 160px in `RGB_565` — about fifty kilobytes each — and holds them in snapshot state, so a
face arriving re-runs the draw phase and nothing else. What is held is capped, so panning across a
thousand people trades faces in and out rather than accumulating them.

## Reading it instead of drawing it

Both charts are pictures. To read a name you pinch, to reach a relative you pan, and a canvas holds
nothing at all for a screen reader — which is why the chart describes itself and then points at the
people list. But that list is alphabetical and has no family in it. Between *a picture you must
zoom* and *a list with no shape* there was nothing, and **Compact** is that missing middle: the same
people the focused chart draws, composed rather than painted, so they can be read at any text size,
tapped with a thumb and spoken aloud.

Generations run down the page, oldest at the top, each headed by a ruled label carrying its count,
with the people laid across it — a row is how a generation is drawn everywhere, and side by side is
also what makes the view compact, since a column of full-width rows would show fewer people per
screen than the chart it exists to relieve.

**A tap moves you.** Touching anybody re-centres the whole view on them, and that is the only
interaction. It needs no back button and keeps no history, because every walk is undone by a single
tap in the band it came from: if she is now above you, you are now below her. The centre is a block
of its own rather than a card in a row, and tapping it opens the same sheet the charts open, so
there is one set of things you can do with a person rather than three.

`CompactFamily` (`graph/CompactFamily.kt`) is built from the layout the chart has **already**
produced, not from a second walk of the graph. The rules about who appears — ancestors, descendants,
the focus's siblings, everyone's partners, and deliberately not cousins or nieces — are subtle and
live in `TreeLayoutEngine`; deriving from its output means the two views cannot drift into showing
different families, and switching between them costs nothing because nothing is loaded twice. It is
pure data, so the awkward parts are tested on the JVM: who belongs to a generation by descent as
against who married into it, and where the doubled rule may be drawn.

That distinction is what the headings count. A step-grandmother is family and is shown, attached to
the grandparent she married — but she is not a fifth grandparent, and *Grandparents · 4* means four
grandparents. Someone who married twice is placed *between* their two spouses so the marriages read
along the row, and the rule is drawn only between people who actually wed: three people in one group
make two marriages, not three.

Absence is shown rather than hidden. A generation nobody has recorded still gets its heading and an
invitation to fill it in, exactly as on a person's page — an empty rule reads as "not written down
yet", which is the subject of this app, while a missing one reads as "not supported". Only parents
and children get that treatment: they are the two directions the view walks in, and four empty
headings would bury the family that *is* recorded.

Nothing here is a second notation. Marriage is the chart's doubled rule, an unrecorded name keeps
its dashed brass ring, and the years are the same span in the same monospace as everywhere else a
person is listed.

## Photographs

A picked photograph is always framed before it is kept. The window is a fixed circle and the picture
moves behind it, which makes the awkward case impossible: the picture can never be smaller than the
circle, so there is no way to frame a crescent of empty space and no error to explain. The sums are
in `ui/person/CircleCrop.kt`, kept free of any Android type so the part that can be wrong — which
pixels end up saved — is tested on the JVM rather than checked by eye.

What is stored is the square, not a circle: roundness is drawn by every place that shows a face, so
a round image would only mean carrying an alpha channel to save a shape we redraw anyway. It is kept
at 512px, which is sharper than any circle in the app can show even on a 4x screen, and costs about
twenty kilobytes a person rather than several hundred.

## Naming a relationship in another language

English kinship is two numbers: how many generations up to a shared ancestor, how many back down.
"Uncle" needs neither the side of the family nor a birth order, so `termFor(up, down)` throws both
away. Hindi needs them, and so does most of the world outside western Europe.

So the distances stay exactly as they were and a `KinshipPath` rides alongside, carrying the genders
the line actually ran through and — where the dates prove it — which of two siblings was born first.
Nothing about English changed, which is why every existing answer and the web viewer still agree.

`graph/HindiKinship.kt` reads that path and returns an *enum*, not a string, so the risky part —
which of five words English calls "uncle" — is plain Kotlin under JVM test. The spelling lives in
`res/values/kinship_hi.xml`, a flat list a Hindi speaker can review in one sitting.

Two properties are worth the tests they get. First, **a word is claimed only when the record earns
it**: ताऊ is an elder brother and चाचा a younger one, so with no birth years the app says
पिता के भाई and offers to sharpen it. Second, **every relationship must agree with its opposite
number** — if B is A's मामा then A must be B's भांजा or भांजी, computed independently from the other
end of the graph. Over every ordered pair of a whole family that is not a property you can satisfy by
accident, and cousins are the sharpest case: a फुफेरा भाई must see you as his ममेरा भाई.

Hindi falls back to English where it genuinely has no word — second cousins, great-uncles — because
that is what Hindi speakers do, and because a Devanagari compound nobody says would be worse than
the English word.

## Relating two people

Two questions with different failure modes, so they are answered separately (`graph/Kinship.kt`,
pure and JVM-tested):

- **The word for it** comes from the nearest shared ancestor — generations *up* to them and back
  *down* to the other person — and those two numbers produce every term English actually has.
  Nearest, then most symmetric: measured through a grandparent instead, two siblings would come out
  as first cousins. There is no word for most relationships, so this half is often absent.
  An explicit `SIBLING` edge is recorded precisely when the parents are *not* known, so each such
  group is given one unnamed stand-in ancestor to measure through — otherwise an aunt reachable only
  through her brother comes back as merely "related", the gap in the record swallowing a word the
  family uses every day. The stand-in is never shown; it has no name to show.
  A marriage at one *end* of the line is named too, because English names those: an uncle's wife is
  an aunt, a wife's mother a mother-in-law. Where it has no single word the pieces still say who
  somebody married — "married to Ankit's first cousin once removed" — which beats the flat
  "related by marriage" that every relative anybody married into the family used to get. A marriage
  in the *middle* is not nameable and is not named; "my aunt's husband's brother" is what he is, and
  the chain says it better than an invented word could.
- **The line between them** is a breadth-first search over *every* edge kind. Marriage is walked as
  well as blood, because "my wife's mother" is exactly what gets asked and no blood-only search can
  answer it. Blood steps are enqueued before marriage ones, so where two routes are the same length
  the one through the family wins — reaching a cousin via their husband is a true answer and a
  useless one.

The chain is always shown and the sentence only when there is one to give: a line amounting to
"these two are related somehow" tells a reader nothing the chain does not tell them exactly. On a
real 148-person tree that names 55% of all 21,756 ordered pairs, up from 31% when only blood
counted; the rest read their answer off the chain. `Kinship` returns the term as a *structure*, not a
string; the English lives in `ui/common/KinshipLabels.kt` with the rest of the app's words.

**Shown on the chart, the line is drawn on its own** rather than lit up inside the whole tree.
Fading the other hundred and forty people still leaves them on the page, and at the scale a whole
family needs, a faded hundred and forty is what the eye actually sees. So the chart lays out just
the people on the line — plus whoever holds it together, which is why `peopleToDraw` adds the parent
two siblings are derived through: a sibling step carries no edge of its own, and without him the
answer arrives as two loose cards. He is on the chart without being in the sentence. *Clear* puts
the rest of the family back.


---

## Turned sideways

A phone on its side has about three hundred and sixty density-independent pixels of height, and the
app was spending a third of them on its own furniture: a title bar, a mode switch, a line of counts
and a navigation bar, all stacked along the axis a family tree is read down.

On a short window — which is a question about the window, not the orientation, so a tablet on its
side keeps the bottom bar and a phone in a split screen does not — the three destinations move to a
`NavigationRail` on the leading edge, and the chart's title bar, mode switch and actions fold into
one row. That is roughly a hundred and forty dp given back to the drawing, which on a real family is
the difference between two generations on screen and four.

Reading matter goes the other way. A list of names stretched across a landscape phone puts the name
at one edge and the date at the other with a hand's width of nothing between them, so the lists,
forms and the settings are held to a readable measure and centred (`ui/common/Windowing.kt`). The
charts are exempt: they are pictures, not prose, and they want every pixel.

The compact view answers the same question a third way, because it is neither. Its cards turn on
their side — a face above a name is the better shape when height is what there is plenty of, and in
landscape that same card is a third of the screen — and the centre lays its marriages beside the
name instead of under it. Together that is four generations in view where there would have been two,
in the view whose whole purpose is fitting a family on a screen.

## Accessibility

The person list, person pages and every form honour the system text size in full and carry content
descriptions. The chart grows its cards with the text size so nothing is clipped.

Text painted onto a canvas is invisible to a screen reader, and giving every node its own semantics
would mean composing a node per person on every pan. So the charts describe themselves and point
elsewhere — and **Compact** is what they now point at: the same family, composed rather than
painted, where every person is one stop that announces "Vinod Kumar, 1962" and one action that
re-centres the view on them. Generations are headings, counts are text, and the whole thing grows
with the system text size instead of being scaled down to fit a fixed card.

A person's page remains the fullest account of any one individual, spelling out every relationship
in words; Compact is the route *between* people that the charts could not offer.

## Updating in place

`update/` is one of two packages in the app that open a socket — the other is `nearby/`, below —
and each is deliberately kept in its own package so that claim is checkable by reading rather than
by trust. The updater is off until switched on in Settings: `UpdateRepository` refuses to make a
request while the preference is false, so "no network unless you ask for it" is a property of the
code and not of the interface.

**Why it exists.** Sideloading a new APK over the old one keeps the app's data directory — that is
ordinary Android behaviour, and it is the whole point. Without an updater, moving to a new version
means exporting, uninstalling, reinstalling and importing, four steps in which a family can be lost.

**What it checks before installing anything.** Three things, in this order:

1. the download's SHA-256 against the `digest` GitHub publishes for the asset,
2. that the archive's package name is this app,
3. that its signing certificate matches the copy already installed.

The third is the one that protects the tree. An APK signed with a different key *cannot* update this
one — Android refuses it — and the only way to install it would be to uninstall first, taking the
family with it. Checking here means that is refused by this app with an explanation, rather than
discovered at the end of a download.

`INTERNET` and `REQUEST_INSTALL_PACKAGES` exist only for this. They are two of the six permissions
the app now declares — the other four belong to nearby sharing, below — and there is still no sync,
no account, and no backend for either feature to answer to.

## Nearby sharing

`nearby/` is the app's other networked package, and the only other code that opens a socket. It is
off until one of the two nearby screens is open: nothing is announced and nothing is listened for
otherwise, and the receiver has to accept a transfer explicitly, by name, before a single byte of
family data moves. What arrives is handed to the same importer that a file shared through a chat
app already goes through — see [merge behaviour](ftree-format.md#merge-behaviour) — matching,
conflicts, add-never-replace, so a transfer decides nothing about a family that file-based import
did not already decide.

The protocol itself — the beacon, the Diffie-Hellman handshake, the six-digit code, the frame
layout — is written down in full in [nearby-protocol.md](nearby-protocol.md), because two
independent implementations, this app's Kotlin and the desktop app's JavaScript, have to agree on
it byte for byte rather than merely close enough.

## The family book

The book (#200) is the app's first designed, printable output, and it is deliberately built as
**one JS composer, run directly on the desktop and inside a hidden WebView on Android**, rather
than as two implementations of the same layout. Full spec in
[family-book.md](family-book.md); this is the shape of it, and why it is shaped that way.

`site/book/compose.js` reads a `.ftree` document and hands back a **Book**: a versioned display
list of pages, each a flat list of drawing primitives (`rect`, `path`, `text`, `image`, `group`)
with every coordinate, line break and font already decided. A painter draws exactly what it is
given and decides nothing — that split is what makes the phone and the laptop produce the same
book from the same tree, and it is why a new template (Diwali, say) is data plus at most a new
composer block, never a change to either painter.

**Porting the layout to Kotlin was rejected on purpose.** A second implementation of line
breaking, generation packing and Devanagari-safe text measurement would drift from the JavaScript
one the moment either changed, in a feature whose entire premise is that both shells produce
identical bytes. Android instead hosts the same `compose.js` inside a `WebView` nobody ever
shows — `BookComposer` (`app/src/main/java/com/vibethroughcode/ftree/book/BookComposer.kt`) loads
it from the app's own assets, blocks the network at three independent points (a `WebViewClient`
that answers every request itself, `setBlockNetworkLoads`, and a page-level Content-Security-Policy
allowing only its own origin), and uses it purely as a script engine: call in with the tree and
the options, get a `Book` back as JSON. It is the same trade the desktop makes with Electron
(see [desktop.md](desktop.md#why-electron-and-not-the-apps-own-code)) — a second runtime, once,
instead of a second implementation kept in step by hand forever.

**The two native painters** turn that one `Book` into pixels, and nothing else:
`site/book/svg.js` on the desktop (SVG, printed through a hidden `BrowserWindow`'s `printToPDF`),
and `app/src/main/java/com/vibethroughcode/ftree/book/BookPainter.kt` on Android (`Canvas`,
drawn into both the preview and a `PdfDocument` via `BookPrinter.kt`). Both painters take the same
one liberty the format allows: a line of text measured wider than the composer's width is shrunk,
never grown, which only ever happens on a Devanagari conjunct the composer's advance tables
under-measure by a few per cent.

**Determinism is the property that makes any of this trustworthy.** The composer takes `now` as
an argument rather than reading the clock, sorts names by a fold of their own characters rather
than a locale collation, and rounds every coordinate to 0.01pt — so the same tree produces the
same `Book` in Node, in Electron, and inside an Android `WebView` built on a different Chromium.
`site/book/*.test.mjs` holds a golden hash per fixture and template (`golden.txt`); a composer
change that shifts a single coordinate fails there before it ever reaches a painter, on either
shell.

---

## Design decisions worth knowing

| Decision | Why |
|---|---|
| Edges, not a GEDCOM-style family/union table | Maps directly onto "add a parent", and makes merge far simpler |
| Siblings derived, not stored | Stays correct as parents are added; avoids O(n²) edges |
| Partial dates, no "approximate" flag | The precision *is* the statement about what is known |
| Enum names persisted, not ordinals | Readable in the database and in exports; stable across releases (R8 is told not to rename them) |
| No dynamic colour | Brass means "not known" throughout, including in the chart's notation; a wallpaper-derived palette would reassign that meaning |
| One `Canvas` for the chart | At a few hundred people, a composable per node costs far more than the drawing |
| Backup file instead of transactional undo | A file the user can re-import is a far simpler promise, and it cannot itself go wrong |
| The path kept beside the distances, not instead of them | English answers, their tests, and the web viewer are all untouched by adding a second language |
| Hindi rules return an enum, not a string | Puts the part that can be wrong under JVM test, and leaves the words in a list somebody can review |
| Descriptive term rather than a guess at चाचा/ताऊ | Guessing is wrong half the time in a way a family notices at once |
| A mandatory circular crop, stored square | The face is shown in a circle everywhere; framing it as a rectangle and hoping would mean choosing one thing and seeing another |
| Photographs off changes drawing, never layout | A setting that rearranged a hundred and fifty people would cost more than the memory it saves |
| A rail on a short window, not a bottom bar | A bottom bar takes eighty of a landscape phone's three hundred and sixty dp from the axis a tree is read along |
| Compact derived from the chart's own layout, not a second walk of the graph | Two views of one family cannot disagree about who is in it, and switching costs nothing |
| A tap in Compact walks rather than opens | Walking is the thing a family tree is *for*; opening a page is a step you take once you have arrived |
| No history behind the walk | The graph is symmetric, so every walk is already undone by one tap in the band it came from |
| Compact still shows photographs when the chart's are off | That switch buys back the cost of decoding faces while panning a canvas, which is a cost this view does not have |
| Nearby sharing carries a file, and stops | Everything that decides what happens to a family — matching, conflicts, add-never-replace — is the importer that was already there. A transport that also merged would be a second answer to a question already answered |
| A custom UDP beacon rather than mDNS | About eighty lines each side and the same logic in both languages, against a responder that has to share port 5353 with Avahi and Bonjour and behaves differently on three operating systems |
| Diffie-Hellman over a fixed MODP group, not X25519 | Built-in X25519 needs API 33; the floor is 26. `BigInteger` and `node:crypto` reach every supported device with no dependency |
| Counter nonces, never random | A repeated GCM nonce does not leak a message, it leaks the authentication key. A counter cannot repeat, and it is testable because it is deterministic |
| The nearby `deviceId` is not `sourceTreeId` | Broadcasting the id stamped into every exported file would turn file provenance into a device tracker that follows somebody between networks |
| A generated display name, not the device name | Consumer device names are somebody's real name, and the default would announce it to a café twice a second |
| Visibility only while the screen is open | A device advertising itself while nobody is looking is one somebody has forgotten they configured |


---

## Where to go next

- [The `.ftree` format and merge behaviour](ftree-format.md)
- [Nearby sharing: the protocol](nearby-protocol.md)
- [The data model, field by field](data-model.md)
- [Hindi kinship terms](kinship-hindi.md)
- [The family book, in full](family-book.md)
- [Building, testing and releasing](building.md)
- [The website and the browser viewer](site.md)
