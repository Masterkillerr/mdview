# mdview renderer audit (2026-09-29)

Scope: the markdown renderer in `bin/mdview-ext/mdview.js` (v1.3, the version
that shipped 2026-07-24) measured against **CommonMark 0.31.2**, with
"pleasing-looking .md rendering" as the goal. `bin/mdview-ext` stays the source
of truth; the Chrome copy is synced from it by `bin/mdview-dev/build.sh`.

## Method

* `test/spec.json` — the official CommonMark 0.31.2 corpus, all **652** examples
  with their reference HTML.
* `test/run.js` — renders every corpus example plus **56 local fixtures** (GFM
  extensions, frontmatter, mermaid, safety rules) and diffs canonical HTML.
  Canonicalisation ignores only cosmetic differences: attribute order/quoting,
  self-closing slashes, generated `id`/`class` attributes and insignificant
  whitespace (whitespace inside `<pre>`/`<code>` is significant).
* `test/score-backup.js` — scores any build against the corpus alone, used for
  the before/after table below.
* `test/preview.html` + `serve.js` — loads the real extension sources against
  `test/kitchen-sink.md` so the result can be eyeballed in a browser (light and
  dark, mermaid included).
* Ambiguous cases (list indentation, lazy continuation, blank lines, `* a *`)
  were settled by differential probing against the reference implementation
  (commonmark.js 0.31.2, fetched from jsdelivr during the audit and not vendored).

    node bin/mdview-dev/test/run.js            # corpus + fixtures, exit 1 on regression
    node bin/mdview-dev/test/run.js -v -s links  # show diffs for one section
    node bin/mdview-dev/test/score-backup.js     # before/after corpus table
    node bin/mdview-dev/serve.js 8731            # then open /mdview-dev/test/preview.html

## Result

| renderer | CommonMark corpus |
| --- | ---: |
| mdview 1.3 (before) | 152/652 · 23.3% |
| mdview 1.4 (after) | **601/652 · 92.2%** |

With the local fixtures: **657 passed / 51 failed**, and all 51 remaining
failures are the documented deviations below — zero unexpected failures, so the
suite is a usable regression gate.

| section | before | after |
| --- | ---: | ---: |
| Tabs | 1/11 | 9/11 |
| Backslash escapes | 1/13 | 12/13 |
| Entity and numeric character references | 3/17 | 13/17 |
| Precedence | 1/1 | 1/1 |
| Thematic breaks | 9/19 | 19/19 |
| ATX headings | 7/18 | 18/18 |
| Setext headings | 5/27 | 27/27 |
| Indented code blocks | 0/12 | 12/12 |
| Fenced code blocks | 4/29 | 29/29 |
| HTML blocks | 0/44 | 21/44 |
| Link reference definitions | 3/27 | 26/27 |
| Paragraphs | 2/8 | 8/8 |
| Blank lines | 1/1 | 1/1 |
| Block quotes | 11/25 | 25/25 |
| List items | 6/48 | 48/48 |
| Lists | 3/26 | 26/26 |
| Inlines | 1/1 | 1/1 |
| Code spans | 7/22 | 22/22 |
| Emphasis and strong emphasis | 54/132 | 132/132 |
| Links | 13/90 | 85/90 |
| Images | 3/22 | 22/22 |
| Autolinks | 5/19 | 18/19 |
| Raw HTML | 5/20 | 6/20 |
| Hard line breaks | 4/15 | 15/15 |
| Soft line breaks | 0/2 | 2/2 |
| Textual content | 3/3 | 3/3 |
| **total** | **152/652** | **601/652** |

The old renderer was a single-pass line loop of regexes; the new one is a real
block parser (container blocks, lazy continuation, tight/loose lists) plus a
spec-faithful inline tokenizer with the delimiter-stack emphasis algorithm.

## Defects found and fixed

### Visible in ordinary documents

1. **Paragraphs were split at every source line.** `foo\nbar` rendered as two
   `<p>`s; soft line breaks are now joined, with two-space/backslash hard breaks
   producing `<br>`.
2. **Indented code blocks did not exist** (0/12) — 4-space-indented code was
   swallowed into paragraphs.
3. **Setext headings did not exist** (0/27) — `Title\n=====` was plain text.
   `---` after a paragraph is a heading underline, not an `<hr>`.
4. **Headings only went to h4**; `## text ##` closing sequences and `### ###`
   were mishandled; h5/h6 had no styling.
5. **Nested lists emitted invalid HTML** (`ul.nest`/`li.cont` put `<ul>` as a
   direct child of `<ul>`), mixing bullet and ordered nesting broke the list,
   and a blank line between items split one list into two. Lists are now parsed
   recursively with correct content columns (including the ≥5-space padding case
   and empty items), lazy continuation, ordered `start`, and tight/loose
   detection that ignores blanks inside nested blocks or code fences.
6. **Block quotes** did not nest, dropped lazy continuation, and could not hold
   other blocks.
7. **Software rendering bugs in block scaffolding**: unclosed fences picked up a
   phantom trailing line; fence indentation was not stripped; tilde fences were
   unsupported; code blocks with blank whitespace-only lines kept their padding.
8. **Frontmatter detection was too eager** — any `---` … `---` region became
   chips, eating thematic breaks (spec example 96). It now requires YAML-ish
   `key:` lines.

### Inline rendering

9. **Emphasis was regex-based** (54/132): `***both***` rendered as
   `*<strong>both</strong>*`, `**a *b* c**` and intraword `_` were wrong, and
   `*` immediately inside words misbehaved. Replaced with the spec delimiter-run
   algorithm (now 132/132), including Unicode-whitespace flanking (U+00A0 is
   whitespace here but not for block structure).
10. **Code spans** (7/22): a span closed on a *substring* of a longer backtick
    run, so `` ` `` ` `` broke; entities inside spans were double-escaped.
11. **Links did not percent-encode destinations** — spaces, UTF-8, quotes and
    backslashes all produced broken/illegal `href`s (`</my uri>` → `/my%20uri`).
    Also fixed: `<…>` destinations, escape-aware titles, the required whitespace
    between destination and title, the inline → full → collapsed → shortcut
    precedence, labels that may not contain unescaped brackets, Unicode case
    folding (`[ẞ]` matching `[SS]`), innermost-link-wins, images using shortcut
    references and nested-image alt text.
12. **Entities**: `&amp;`-style text was double-escaped and nothing was decoded.
    The browser path now uses the platform's own entity table (a detached
    `<textarea>`), so all HTML5 named entities work, plus numeric/C1 remapping.
    *Verified in a real browser*: `&auml; &copy; &#169; &#x2603; &HilbertSpace;`
    render as `ä © © ☃ ℋ`.
13. **GFM gaps**: strikethrough, bare-URL linkification (with trailing-punctuation
    trimming) and task-list checkboxes are now supported; tables gained
    alignment, optional outer pipes, escaped pipes and cell-count validation.
14. **Link reference definitions** (3/27): multi-line labels/destinations/titles,
    definitions inside block quotes, "a definition may not interrupt a
    paragraph", and escaped brackets in labels.

### Safety

15. `[x](javascript:alert(1))` produced a **working `javascript:` link** — in a
    `file://` origin. Now `javascript:`, `vbscript:`, `data:` and `blob:` URLs
    are stripped (harmless custom schemes such as `made-up-scheme:` still work).
16. Raw HTML was escaped wholesale, so READMEs lost their `<div align>`, badges,
    `<details>`, `<kbd>` etc. It now passes through a **presentational allowlist**
    with whitelisted attributes, URL checks, filtered `style` declarations and
    no `on*` handlers; anything else (`<script>`, `<svg>`, …) is escaped as text.

## Documented deviations (all 51 remaining failures)

| area | examples | rationale |
| --- | ---: | --- |
| HTML blocks + raw HTML | 43 | Only an allowlist of presentational tags passes through; unknown tags are escaped as text. Deliberate: an untrusted `.md` must not inject script into a `file://` page. |
| Entity references under Node | 5 | Node has no HTML5 entity table; the browser path resolves these (verified). |
| Tabs | 2 | Tabs are expanded to 4-column tab stops at the start of a line instead of being fully column-tracked inside containers. |
| Bare-URL autolinking | 1 | mdview linkifies bare URLs (a GFM extension); CommonMark expects plain text. |

## Known gaps worth a follow-up

* `mermaid.min.js` (3.5 MB) is injected and parsed on every `.md` view even when
  there is no diagram — lazy-load it through `web_accessible_resources`.
* Fenced code emits `class="language-x"` but nothing highlights it yet.
* Reference definitions nested deeper than one container level (e.g. inside a
  list item) are still not collected.
* Footnotes, definition lists and `srcset`/`target` attributes are
  unimplemented. (`:target` anchor highlighting is done, see below.)

## Reading style

Rendering correctness is only half of "pleasing"; the stylesheet was rewritten
around a small token block at the top of `mdview.css`, so the look can be
retuned in one place:

* `--measure` — the prose measure, in `ch` (68, ≈78 characters). Using `ch`
rather than `px` keeps the line length constant across fonts and platforms.
* `--md-font-body` / `--md-font-head` / `--md-font-mono` — font stacks.
* palette tokens (`--ink`, `--muted`, `--line`, `--accent`, `--fence`, …) with a
  dark block that redeclares the same names under `prefers-color-scheme: dark`.
* `--bleed` — how far code blocks and tables may reach into the margin. `0px` on
  small screens, `min(9vw, 9rem)` from 1024px, `min(14vw, 15rem)` from 1600px.
  A browser tab has no sidebar, so on a desktop window the alternative to
  stretching the text to an unreadable line length is to let the wide blocks
  use that space. Type scales fluidly (`clamp(16px, 15.1px + 0.2vw, 18px)`).
* The measure itself also opens up on large screens (76ch from 1400px, 82ch from
  1800px) — 832px at 1920px rather than 690px — but past ~100 characters the
  remaining gain is not worth the reading cost, which is why the margin gets an
  outline instead (below).

Two editorial touches on the same token block: the `h1` is set at `1.95em` with tight
tracking, and a paragraph directly under it is treated as a **lede** — one size step up,
`--muted`, with a hairline under it closing the title block the way a standfirst does in
print. A document that goes straight from `#` to `##` simply has no title block to close.

## Filling a wide window

Measured at 1920px before this pass: 690px of prose in a 1920px window, i.e. 81
characters and 36% of the width, with 608px of empty background on each side.
Widening the text alone can't fix that, so `bootstrap()` now builds an outline:

* `buildOutline()` collects `h2[id]` and `h3[id]` from the rendered document and
  returns a `<nav class="toc">` of links, or `null` when there are fewer than
  three (a two-item outline is not worth a margin).
* The markdown is wrapped in `.doc` so the outline has a full-height sibling —
a sticky grid item only travels as far as its own grid area.
* `.mdview:has(> .toc)` becomes a two-column grid from 1280px, and the outline is
  `position: sticky` in the second column with its own scroll. Where the outline
  exists the bleed is switched off (`--bleed: 0px`), since the margin is now
  occupied — code blocks line up with the prose instead.
* `trackOutline()` marks the section being read with `aria-current` on a passive,
rAF-throttled scroll listener.
* Without an outline — a short document, or a window under 1280px — the layout
  falls back to the plain centred column with the wide-block bleed, verified in
  both states.

Other decisions worth knowing:

* **Mermaid follows the page.** Mermaid's built-in themes are their own palettes
  and keep light node fills, which left a bright diagram on a dark page. Diagrams
  now render with `theme: "base"` plus theme variables taken from the same hex
  values as the stylesheet (see `mermaidTheme()` in `mdview.js`).
* **Re-injection is a no-op.** `bootstrap()` returns early if a `.mdview` root
  already exists: reloading or updating the add-on re-injects the content script
  into documents that are already rendered, where the first `<pre>` is a code
  block, and rendering that again would replace the page with the code block's
  markup.
* **`data-lang` on `<pre>` is presentation only** (the language label in the
  block's corner); the test canonicaliser ignores `data-*` attributes.
* Fenced code gets a language label and a card; tables shrink to their content
  (`fit-content`) between the prose width and the bleed cap; task-list checkboxes
  are drawn with `appearance: none` plus a data-URI check (pseudo-elements don't
  render on inputs in Firefox); `:target` headings get a soft highlight;
  `@media print` and `prefers-reduced-motion` are handled.

## Reader chrome (1.5.0 – 1.5.1)

Rendering the markdown well is only half of it: the reason to read a `.md` instead of a
PDF is that it can be *nicer* to read. So mdview is no longer only typography — it now
adds the affordances a document reader is expected to have.

* **A document header** (`.mast`) above the first heading: the file name in a chip, then
  `1,740 words · ≈ 8 min read` and, when the document has task items, `3/8 done`.
* **A theme toggle** (auto → light → dark) that sets `data-mdview-theme` on `<html>`
  before the first paint, so an explicit choice never flashes the other palette, and
  remembers itself in `localStorage` (silently, if the origin is opaque).
* **Print / PDF**, next to it — the pitch against a PDF, made clickable. Print styles
  already strip the chrome, so the printout is the document and nothing else.
* **Copy buttons** on every fenced code block. Quiet at 45% opacity, full on hover or
  focus, `Copied` for a moment after the click, and always visible where there is no
  hover to reveal them (`@media (hover: none)`). The language label moved left so the two
  never overlap; measured clear at 1440px (button ends 7px from the card edge, label 60px).
* **Heading anchors** on top-level `h2`–`h4`: a `#` in the left margin from 1024px that
  copies an absolute link to that section while still navigating to it — the ids were
  already there for the outline.
* **A reading-progress line** at the top of the viewport and a **back-to-top button** that
  appears past 900px of scroll, both fixed, both timer-free-throttled like the outline,
  both honouring `prefers-reduced-motion` for the smooth scroll.
* **Callouts** (1.5.1): `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`
  become bordered cards with a small-caps label, the marker text removed. Implemented in
  `decorate()` — a `blockquote` is matched and re-classed *after* rendering — so the
  markdown output the suite scores is still plain CommonMark, and the same document
  degrades to an ordinary quote anywhere mdview is not running. Colours are mid-tone hex
  values plus an 11–13% same-hue wash, chosen so one set reads on both palettes: measured
  `note`/`tip`/`important`/`warning`/`caution` at `rgb(108,182,224)`, `rgb(58,169,129)`,
  `rgb(139,92,246)`, `rgb(210,153,34)`, `rgb(229,83,75)` over a `#0f1216` page, ink
  `#e4e8ee`. `note` borrows `var(--accent)` so it follows the theme.
* **Click to enlarge** (1.5.1): a diagram, an SVG file, or a raster image that is being
  downscaled gets `cursor: zoom-in` and opens in a fixed overlay — click anywhere or
  Escape to close. Vector artwork is always offered (it stays sharp); a small raster that
  is already at natural size is not, because enlarging it would only make it blurrier.
* **Contents** (1.5.1): the same headings as the margin outline, as a `<details>` under
  the masthead, shown **only below 1280px** — the margin outline has no room there, so
  narrow windows previously had no navigation at all. Verified at 430px: `display: block`,
  11 items, 379px wide, zero horizontal overflow.

Two rules hold this together:

1. **None of it touches the renderer.** `decorate()` runs after the tree is mounted, so
   `renderMarkdown()` still emits exactly what the CommonMark suite scores, and a failure
   in the chrome cannot cost you the document (it is wrapped in a try/catch that warns).
   That is also why the copy buttons and the header are `dimmed`/hidden in `@media print`.
2. **The dark palette is declared twice** in the stylesheet — once under
   `@media (prefers-color-scheme: dark)` (with `:not([data-mdview-theme="light"])` so an
   explicit light choice wins over the system) and once for
   `:root[data-mdview-theme="dark"]`. Keep the two in sync; CSS has no way to share them.

Tuning lives in the same place as the rest of the design: the tokens at the top of
`mdview.css`, and the "reader chrome" section at the bottom of it.

### Definition lists (1.5.2)

Real technical markdown is full of this list shape:

```markdown
*   **Routing:** Directing incoming requests to the correct microservice.
*   **Aggregation & Composition:** Calling multiple microservices at once…
```

The sample document that prompted it is *nothing but* that shape — 14 items in 5 lists.
As bullets, each term is buried in the middle of a paragraph and the left edge of the page
carries no information. So a `ul` in which **every** item leads with a plain `<strong>`
ending in a colon (and where no item contains block content, and no term is longer than 34
characters) is re-classed as `ul.defs` and set as rows:

* **Aligned columns from 768px.** The grid lives on the `ul`, not on the `li` (the `li` is
  `display: contents`), so a *single* term column serves the whole document instead of one
  column per row. This was the first bug: a grid per item gave every row its own
  `max-content` width and the descriptions started at 10 different x positions.
* **One width for the file**, measured in `markDefinitionLists()` and shared through
  `--def-term-w`, so five lists put their descriptions in one column rather than five.
  Recorded in `em`, not `px`: the body font is fluid, and a pixel width would be too narrow
  for its own terms in a wider window — a wrapped term defeats the alignment.
* **Rows, not bullets.** No marker, a hairline between rows (on the cells, where the
  space between columns is padding rather than `column-gap`, so the line stays unbroken),
  term in ink, description in `--muted`.
* **Below 768px it is just a sentence again** — term, colon, description flowing inline,
  hairlines still separating the rows.

Visual only: the nodes are *moved* (the `<strong>` into a `.def-term` span, everything after
it into `.def-desc`), never rewritten, so the text of the document is unchanged, `select`
and copy behave as before, and — like the callouts — nothing here is the renderer's
doing, so the CommonMark suite still scores 657/0 unexpected.

**The one real trap.** The measurement has to happen while the terms are still plain inline
text: once the grid applies, a term *is* its track, and measuring it returns the width being
decided. It also has to happen when the document has a layout width at all. In this
preview environment the body measured **0px wide** during `decorate()`, so every term
measured one character (`Stateless:` 9px, `Multiple Endpoints:` 14px) and the whole column
was confidently locked to 14px. The measurement now retries across a few frames until a
real layout exists, and the stylesheet falls back to a `min(100%, 40%)` cap if it never
does — so the failure mode of a missing measurement is rows that are merely aligned per
list, not a collapsed column.

### Three bugs the browser caught, not the tests

1. **Diagrams did not exist yet.** `mermaid.run()` is asynchronous, so wiring zoom up
   during `decorate()` found zero `<svg>` elements and every diagram stayed dead. Zoom is
   now re-run when that promise resolves.
2. **The click target was too small.** Listening on the `<svg>` missed ordinary clicks,
   which land on whatever inner `<g>`/`<foreignObject>` shape is under the pointer. The
   listener is on the `pre.mermaid` block instead — that is what the reader is pointing at.
3. **A double-click would open and instantly close the overlay**, because the second click
   lands on the overlay the first one just created. Closing by pointer is ignored for
   300ms after opening; Escape always closes. (Found by accident: the preview harness
   retries a click when the DOM changes under it, which surfaced this immediately.)

### Dev-loop lesson from the same evening

An injected or cached stylesheet is indistinguishable from a change that did not work,
and two hours went into exactly that confusion. So [serve.js](serve.js) now sends
`cache-control: no-store` and [test/preview.html](test/preview.html) cache-busts the
stylesheet with a timestamp on every load. If a CSS edit seems to do nothing, check the
sheet the browser actually holds before believing anything else.

## The shape of a specification (1.5.3)

The document that prompted this pass is a 240-line course syllabus: an `#` title, a `>`
translation note, thirteen `---` rules, ten tables, five units built from the same three
parts. None of it is a defect, but it is written to a template, and three of the shapes a
template produces were not being read by the stylesheet at all: label/value tables,
`**Bold label:**` paragraphs, and bracketed transcriber's notes. All four treatments below
run in `decorate()`, after the renderer has produced its HTML, so the renderer's own output
— and therefore the CommonMark score — is untouched (657 passed, 51 documented, 0
unexpected, before and after).

**Label/value sheets** (`markKeyValueTables`). Eight of the ten tables in that document are
two columns of `Field | Value`. The test is shape, not vocabulary: exactly two columns, at
least two body rows, every left-hand cell present and no longer than 48 characters. The
sheet then stops pretending to be a data grid — it shrinks to its content instead of
stretching across the measure (measured: a seven-row sheet came out **595px** inside a
769px measure), the labels step back to `--muted`, the label column is held to one line from
768px up, an all-digit value is set in tabular numerals (17 cells on the syllabus), and the
rows tighten from 0.6em to 0.44em of block padding. The header row stays: it is the column
caption, and dropping it would be the one change here that removes something the document
said.

**Labels** (`markLabelParagraphs`). `**Topics and subtopics:**` is a field label, not a
sentence; ten paragraphs in the syllabus are that shape. As body text each one carries the
weight and the leading of prose and pulls the eye off the list it introduces. As a label
(0.76em, tracked, uppercase, `--muted`; 1.55em above and 0.55em below, and 0 directly under
a heading) it names the block and gets out of the way. Detected by shape — a paragraph that
is one bold run ending in a colon, 42 characters or fewer — so a bolded sentence is left
as a sentence.

**Source notes** (`markEditorialGaps`). Five paragraphs in that document are nothing but
`[Illegible/corrupted character sequence in the original PDF omitted.]`. Set as body text
they read as claims the document makes; italic and `--faint`, they read as what they are —
holes in the source. The whole paragraph has to be one bracketed run, so a sentence that
merely ends in a bracket is not touched.

**References** (`markReferenceLists`). A bibliography is a list of entries rather than
points, and each entry is several lines long, so the hanging indent is what lets the eye
find where the next one starts. A bullet between two citations is noise, so the markers go,
and the italic title keeps the ink while the rest of the entry steps back to `--muted`.
Recognised by shape: four or more items, each a sentence ending in a period with its year in
the back half. That last clause is load-bearing. A first version asked for eight words and
rejected `E. Evans, Domain-Driven Design. Addison Wesley, 2004.` (seven), which silently
excluded the entire collection — the kind of near miss that looks like a classifier being
cautious. A list of points that happens to mention a date (`Microservices arrived around
2014…`) stays a list of points: the fixture holds both, and the measurement is one `.refs`
list of five entries beside seven ordinary ones.

**The title block** (stylesheet only). A `>` blockquote directly under the `#` is a
standfirst — a translation note, a provenance line, the document describing itself — so it
now closes the title block the way the lede paragraph does: the left rule goes, and a
hairline with 1.35em of air takes its place, at 1.02em in `--muted`. Callouts are exempt, so
`> [!NOTE]` under a title still gets its own card.

Verified numerically (the preview harness has no compositing, so no screenshots) on the real
syllabus and on [test/kitchen-sink.md](test/kitchen-sink.md) at 1440px and 430px, in both
palettes: 8 sheets and 2 grids, 10 labels, 5 gaps, 1 reference list; the fixture's sheet is
the only table converted there and its new reference list is the only one of the two
candidate lists taken; no table that did not overflow before overflows now; below 768px the
labels wrap again rather than forcing a horizontal scrollbar; and the dark palette reaches
all of it (`gap` `rgb(113,125,140)`, reference entries `rgb(154,165,180)` with titles at
`rgb(228,232,238)`).

## Why a page can stay plain text with the add-on loaded

**Root cause (confirmed 2026-09-29): Firefox had not granted mdview access to local
files.** `"permissions": ["file:///*"]` — added during the visual pass, not present in
1.3 — turns file access into a host permission the user has to grant. Until it is granted,
Firefox does not inject the content script into `file://` pages at all, so a `.md` tab
stays raw text while the add-on looks perfectly healthy in `about:debugging`. Granting it
in `about:addons` → mdview → **Permissions** (the "Can't read or change data on this
site" state) fixes it immediately.

1.3 declared no `permissions` block at all — only `content_scripts.matches` — and injected
with no grant required, which is why it worked "perfectly" before. Two consequences worth
keeping in mind:

* **Installing is a two-step job**: install, then grant file access. Without the grant the
  add-on is a no-op that looks installed. Same requirement on Chrome/Brave/Edge, where the
  switch is *Details* → **Allow access to file URLs**.
* Whether dropping the `file:///*` declaration again (1.3's shape, content scripts only)
  removes the need for the grant is **untested** — grants cannot be exercised headlessly,
  and the currently installed build relies on the one already granted.

A `.md` tab showing raw markdown does **not** mean the stylesheet is stale — it usually
means the content script never ran. Content scripts only run on a page that loads after
the add-on is installed, and (as above) only where file access has been granted. Both
failure modes look identical on screen, so 1.4.3 makes the add-on say what it did:

* `[mdview <version>] rendered <url>: N headings, N tables, N diagrams` — it ran and worked.
* `[mdview <version>] loaded on <url> but found no plain-text source to render` — it ran
  and bailed (the browser's plain-text view changed shape).
* `[mdview <version>] failed to render <url>` + the exception — it ran and threw; the page
  is left untouched and `data-mdview-error` is set on `<html>`.
* **Nothing at all** in the Browser Console (`Ctrl+Shift+J` on the `.md` tab) — the script
  was never injected, which is a permission problem, not a renderer problem.

The renderer itself is not in question: the same document renders with 16 headings,
10 tables and an outline through the preview harness, which loads `mermaid.min.js` and
`mdview.js` in the content-script order the manifest declares.

### What the probes showed, and why they misled

Measured in scratch profiles (Firefox 153.0esr, headless **and** visible, temporary and
sideloaded add-ons) — every one of these probes ran **without** a granted file permission:

| probe | manifest | result |
|---|---|---|
| background script | `file:///*` | runs; tab url and title readable |
| `tabs.executeScript` on the file tab | any variant | `Missing host permission for the tab` — **the one signal that matched reality** |
| content script | `matches: ["file:///*"]` + `include_globs: ["*.md"]` | never runs |
| content script | `matches: ["<all_urls>"], run_at: document_start` | never runs |
| content script | `matches: ["file:///*"]` on a local **.html** page | never runs (so it was not about plain-text documents) |
| control: content script on `http://127.0.0.1:…` | `matches: ["<all_urls>"]` | runs immediately |
| `tabs.create` / `tabs.update` to a `file://` url | `file:///*` declared | `Illegal URL` — Firefox refuses extension-initiated navigation to `file://` |

`permissions.contains({origins: ["file:///*"]})` returned **true** in that same state, so
it is not a usable check for "can mdview actually run here" — it reflects the declaration,
not the effective grant. The `executeScript` error was the honest signal, and it was in the
very first probe of the evening.

The lesson: an extension cannot be diagnosed from inside; the state that matters lives in
the browser's permission store and only a real click reveals it. The console lines above
and a manual grant were what actually settled it.

### What 1.5.3 does about it

Firefox 153 turned this into a **separate class of permission** — "Access local files on
your computer", off by default for every extension including ones already installed — and it
cannot be requested at runtime: `browser.permissions.request({origins: ["file:///*"]})` does
not prompt, and there is no workaround
([thread](https://discourse.mozilla.org/t/requesting-file-permission-dynamically-via-browser-permissions-request/148722)).
The honest check does exist now, though: `browser.extension.isAllowedFileSchemeAccess()`
returns a meaningful value as of 153, which is what [refresh.js](../mdview-ext/refresh.js)
asks on startup — `permissions.contains()` remains useless, since it reports the declaration
rather than the grant.

So the state stops being silent, and stops living only in a console:

* a **red `!` badge** on the toolbar icon whenever file access is off;
* a **toolbar panel** ([popup.html](../mdview-ext/popup.html) +
  [popup.js](../mdview-ext/popup.js)) that names the state, prints the three steps, copies
them to the clipboard, and re-renders the open `.md` tabs;
* the console warning stays for the pre-153 path, where `tabs.executeScript` is the only
  probe available.

The panel renders through the same stylesheet as the documents, so it is the same palette in
the same two schemes, and it was verified the same way everything else here is —
[test/popup.html](test/popup.html) fetches the shipped markup, runs the shipped script
against a stubbed API, and takes `?access=on|off|unknown`. All three states check out (dot
colour, the disclosure appearing only when access is off, the badge text `"!"` with
`#c2410c`, and a re-render that reached the two `file://` tabs and not the `https` one).

## Wide tables (1.5.4 – 1.5.5)

The syllabus has ten tables and two of them were wider than the card they sit in — a
three-column competency table 52px over, a five-column evaluation table **300px** over —
with nothing on screen to say a column was missing. With overlay scrollbars the card just
looked like a table that stops mid-column. That was the one defect the previous pass knew
about and left.

Two moves now, both in `fitTables`, after render.

**Fit first.** `th` is `white-space: nowrap` because a one-line header scans better, and
that is exactly what set the width: the five-column table's headers were wider than its
cells. A table that does not fit its card is given permission to wrap its header row, and
keeps the permission only when wrapping actually bought width — so a table whose width
comes from its body cells keeps its tidy headers. Measured on the syllabus at 1440px:
**819 → 767** and **1067 → 767**; both tables now fit, no hidden columns at all, and the
three-column table is also 236px *shorter* (698 → 462) because its body cells finally get
the room they were owed. The sink's path table covers the other half of the rule: its paths
break at the slash, so it fits without touching the header treatment (min-content 599px
inside a 767px card).

**Then say so.** A table still wider than its card — the sink's nine-column assessment
grid, 144px over at 1440px — keeps its scroll but stops hiding it: a soft shadow at each
edge, drawn over the table, pinned to the card by `--sx` (the card's own `scrollLeft`), and
faded out at the end it points at, so it never reads as a smudge on a table with nothing
left to see. `--scrollfade` is `rgba(15, 23, 42, 0.13)` in light and `rgba(0, 0, 0, 0.55)`
in dark, declared in all three palettes like every other token. The card also takes
`tabindex="0"`, `role="group"` and a name, so the arrow keys scroll it and the focus ring
lands on something that is announced as something.

**A pinned label column (1.5.5).** A table that is still too wide is read by its first
column — that is what says which row you are in while the rest of it slides past — so that
column stays put (`position: sticky; left: 0`) and the columns it labels travel underneath
it. Its cells are given their own opaque background by row parity (`--card`, `--zebra`, and
the header's `--thbg`), because a pinned column you can see the table through is worse than
one that moves. It casts a shadow only once there is content underneath to cast it on —
the same `at-start` state the edge shadows key off. Verified on the nine-column grid:
the first cell holds x=180 while the next column travels 79.6px with `scrollLeft`, and the
backgrounds are opaque in both palettes (`rgb(21,26,32)` card, `rgb(18,22,28)` zebra in
dark).

Not every first column is a key, so `fitTables` refuses to pin one that takes 42% or more
of the card: at that size it is a block of content, and pinning it would cover far more
than it reveals. The sink's integrity-hash table is the fixture for that — 568px of a
767px card (74%), still 118px too wide, and it scrolls as one piece.

**A bug the browser caught, not the tests.** The shadows are absolutely positioned inside
the card, which makes them part of its *scrollable overflow*: a stale `--sx` left the
right-hand shadow hanging past the content end, so the card measured itself wider than it
was (942px instead of 767px) and then held on to a scroll for a table that fitted. The fix
is ordering — `measure()` removes both shadows and resets `--sx` before it reads
`scrollWidth`, and puts them back at a real offset before anything is painted. Only a
resize back *up* after a scroll leaves an offset behind, which is why it survived the first
pass of checking.

Verification was numeric throughout (this preview never composites: screenshots are blank
and CSS transitions freeze at their previous value): both documents at 1440 and 430px,
light and dark; shadow geometry `left = scrollLeft` and
`left = scrollLeft + clientWidth − 2.7em` in all three positions (`at-start`, mid,
`at-end`), with the opacity rules read with the transition disabled; zero overflowing
tables in the syllabus at 1440px after two consecutive resize passes; no page-level
horizontal scroll at 430px; and `npm test` unchanged at 657 passed / 51 documented / 0
unexpected.

## Footnotes (1.6.0)

The biggest reading gap left in a format meant to replace PDF was that footnotes did not
exist. `Rendering is the whole point.[^1]` rendered as that literal text, and the
`[^1]: The first note.` that carried the note was joined to the definition below it as an
ordinary paragraph — so a document that used notes read as a document with bracketed
garbage in the prose and a stray paragraph at the bottom.

GFM footnotes are three passes, all in the renderer, so they are part of the document
(they print, they go in the outline, they are not chrome):

**Definitions are lifted out** like link reference definitions, and before them, because
`[^1]: /url` is a note that holds a URL rather than a link target. A definition's body is a
paragraph that continues lazily, the way every other paragraph in markdown does, and extra
paragraphs, lists and fences need four spaces — GFM's rule, so what the author saw when
they wrote it is what they get. A definition nobody cites is dropped, which is GFM's rule
and also what this renderer already does with an unused link reference definition.

**Citations are numbered by where the reader meets them**, not by the order the
definitions happen to be written: the note written last can be note 1. The same note cited
twice is one entry with a back-link for each place it was called from (`↩`, `↩2`), and the
back-link sits at the end of the note's first paragraph, which is where GitHub puts it.

**A note is apparatus**, so the section steps back — a rule across the page instead of the
heading underline, the section name tracked and uppercase in `--faint`, entries in
`--muted` — while the numbers stay in `--accent`, because they are what ties a note to its
place in the text. The marker is a raised number with no brackets: brackets would be a
second piece of punctuation after the sentence's own. Following a citation jumps and
highlights the note (`li:target`, the same tint a heading gets) and each marker and note
carries `scroll-margin-top`, so the line you came from is still in view when you land.

Two deliberate refusals, both of them GitHub bugs rather than features: a marker inside a
link label stays literal, because the marker is itself an `<a>` and an `<a>` inside an `<a>`
is not a document; and a definition line cannot interrupt a paragraph, matching the rule
this renderer already applies to link reference definitions.

**The bug the fixture caught.** Footnotes are written one after another with no blank line
between them, and the first version swallowed every note below it into the note above —
`Alpha[^b] beta[^a]` produced one note reading `about a [^b]: about b`. A line that opens a
definition now ends the one before it, which is what the “numbered by first citation”
fixture asserts: adjacent definitions, `[^b]` cited first so it is note 1 and `[^a]` is
note 2.

Ten fixtures in `test/run.js` cover the cases that are easy to get wrong — numbering by
citation, a note cited twice, an uncited definition, an undefined citation, a wrapped line,
an indented paragraph, a definition inside a fence, a marker inside a link label, and a
definition after a paragraph. The suite is 667 passed / 51 documented / 0 unexpected, up by
exactly the ten fixtures. In the browser: markers at 0.72em in `--accent` with no
underline, the notes section at 0.94em in `--muted` under a 1px `--line` rule, `:target`
tinting the note it lands on, four notes from six citations on the fixture page, the
outline carrying a `Footnotes` entry, and no page-level horizontal scroll at 430 or 1440px
in either palette.

## Prose rhythm, and the table a paragraph swallowed (1.6.1)

Three notes written the way a plain `.md` note is written — a list of labeled bullets, a
table, a heading every few paragraphs — turned up four separate things.

**A table directly under a line of text rendered as literal pipe text.**

```
**Examples:**
| Protocol | Purpose |
|---|---|
| **HTTP/HTTPS** | Web requests and responses |
```

came out as one paragraph reading `Examples: | Protocol | Purpose | |---|---| ...`, because
the table branch of the block parser is only reached when the table starts a block, and a
paragraph runs to the next blank line: `**Examples:**` opened a paragraph and consumed the
header row, the delimiter row and every body row after it. A GFM table interrupts a
paragraph — the delimiter row ends it and the line above it becomes the header row, which is
what cmark-gfm does — so `isBlockStart` now takes the following line and reports a table
start when the current line could be a header row and the next one is a delimiter row. The
same check is passed at the two lazy-continuation sites (a block quote, and a list item
whose text is less indented than its content column), since the same swallow happens there.
Five fixtures pin it down: interrupting a paragraph, a paragraph with body text above it,
inside a list item, inside a quote, and the negative case (a line with a pipe in it and no
delimiter row stays a paragraph). The suite is 667 → 672 passed, 51 documented, 0
unexpected.

**The reading measure was being overridden on exactly the windows it was written for.** The
base was `68ch`, then `76ch` from 1400px and `82ch` from 1800px, on the theory that a fixed
column in a 1920px window reads as a strip. But `ch` is the width of a zero, and the zero is
wider than the average character: measured against the text actually in these documents,
76ch put the body at **90–96 characters a line** at 1440px. Widening the measure is the one
change that reliably makes prose harder to read, so the base is now `62ch` and the only
wide-screen step is `64ch` from 1400px — **78.5 characters** at 1440 and at 1920, with the
extra room going to the page surface and the outline instead of to the lines. Nothing below
1400px changed.

**The vertical rhythm was four numbers where one was meant.** Measured on those documents,
the gap between blocks came out as: 20.7px under a paragraph, 23.4px under a table, 24.3px
under a code fence, 27px around a diagram — and a section break was 49px above the dot row
but 52.1px below it, because the heading's own margin was larger than the break's. No single
gap was wrong, which is exactly why it read as uneven. Every flow block now takes one step,
`--rhythm` (1.15em), including the boxed ones: a border is already what separates a table or
a fence from the text, and the block's own padding stands its text further from its edge than
the edge stands from the paragraph beside it, so the extra space was never buying anything.
A thematic break takes `--rhythm-rule` (2.2em) on both sides, and a heading directly under it
gives up its own opening margin, because the break has already announced the section and the
heading does not need to announce it again — without that the heading's larger margin won the
collapse and pushed the dots off centre. Measured after: every flow gap 20.7px, every section
break 39.6px above and below, a label 21.2px above and 7.5px below (the one deliberate
asymmetry — a label names the block it introduces), and a heading 17.4px from its first
paragraph against 20.7px between paragraphs, so a heading still binds downward. The gaps a
reader meets are now 20.7 / 39.6 / 52.1 with one intentional 17.4, and they hold across 3cfc0f,
89f593 and 0f7a83.

**A screenshot of one break found two more.** Between the last paragraph of a section and the
heading of the next, 123px of air hung around a row of three dots set at `opacity: 0.75` on
`--faint` — light enough that the space read as a hole in the page, a rendering fault, rather
than as a mark the document meant to make. A break nobody can see is just a gap, so the dots
are drawn at full strength (and a little larger: 1.9px) and the air around them is 39.6px
instead of 61.5px, symmetric. Three `--` in a row should read as a deliberate pause, not as an
accident.

**And a sentence was being uppercased.** `**Meaning:** a set of rules and conventions for how
two or more parties communicate.` rendered as a tracked uppercase eyebrow — that whole
sentence, `MEANING: A SET OF RULES AND CONVENTIONS…` — because `markLabelParagraphs` asked
whether the paragraph had one *element* child, and text nodes are not elements. So a paragraph
that was a short bold run followed by a long sentence looked exactly like a paragraph that was
nothing but a short bold run. That is the shape of a definition line, which is most of the
prose in a glossary, so the treatment was landing on the document's actual content rather than
on the names of its blocks. The pass now requires the paragraph to hold nothing but the strong
run: a text node beside it means a sentence that opens with a bold phrase, and sentences keep
sentence case. On `0f7a83.md` the two `**Meaning:** …` definitions render as ordinary prose
and only the two real labels (`Examples:`, `Key facts:`) still qualify. Worth noting how it
surfaced: the first version of this check used `para.childNodes.some(...)`, a `NodeList` has no
`.some`, and the `try/catch` around each decoration pass — there so that a failed frill can
never cost a reader their document — swallowed the `TypeError` and silently removed *every*
label in the file. The pass is a decoration and so invisible to the spec suite; the browser's
console log is what caught it, which is why the chrome warns instead of failing quietly.

**On a wide window the document was a strip, and the outline belonged to nothing.** The
screenshot that started this was a ~4300px window: the text card was 841px (22% of it) and the
outline sat 72px to the card's right, adrift in about 1350px of background on either side. The
stylesheet's own comment says the outline "lives in the right margin" of the page and is what
makes a desktop-width tab read as a document rather than a strip — but a margin is *inside* a
page, and the page ended before the outline began, so the one element meant to anchor the
composition was the thing floating in the void. From 1280px the surface is now the whole
composition: a page carrying the text column plus the outline in its own right margin
(15rem, behind the hairline it already had), sized to its contents so it can never stretch
into a letterbox, with margins that scale with the window — 150px a side at 3840px instead of
96px, an inner margin of 72px, and 84px of desk above the sheet so it sits *on* something.
At 3840px the page is 1263px (33%) with the text at 649px and the outline 72px to its right,
inside the page; at 1440px it is 1034px with the text column in exactly the place it occupied
before. Nothing about the reading experience changed: 649px, ~78 characters, at every width.

Two measurement mistakes on the way, both worth recording. `width: max-content` on the grid
handed the text column's width to a **table** in the document (437px of a 649px measure),
because a track's max-content contribution is whatever its widest child happens to be and a
table is narrower than the measure; the page width is now written out as measure + margin
column + gap. And the surface's `max-width` from the 1024px rule silently clamped the result
to 735px, which is why the whole fix looked like it did nothing until that one line was
taken back. Both were invisible in the CSS and only showed up as numbers.

The page shadow became a token (`--page-shadow`), so the sheet has one definition wherever it
is drawn and the dark palettes only override a value — which retires the two duplicated dark
`@media` blocks that existed only to restate the shadow for the dark card.

**And the header became the window's bar.** Framing the page was only half of it: the
masthead — filename, reading time, theme, print — lived *inside* the page, so on a wide window
every pixel of the interface was still inside that third-of-a-window sheet. It is app chrome,
not document, and it now spans the window as a fixed bar (48px from 1024px up, the desk
colour, one hairline) whose contents line up with the page's text: the filename's left edge
*is* the text column's left edge and the buttons' right edge is the page's inner right edge —
239px and 1186px at 1440px, 1432px at 3840px — from 1100px to 3840px. The page starts below
it, and a heading reached by `#anchor` lands 24px clear of it (`scroll-margin-top` follows the
bar's height). `position: fixed` with `left`/`right: 0` rather than `width: 100vw`, because a
fixed box is sized by the viewport where `100vw` counts the scrollbar and would put a
horizontal scrollbar on a page that has none.

**`---` is a rule now, and the width is the reader's.** The break was three dots — a scene break,
quieter than a line, chosen so a document using `---` between every section wouldn't stack rules.
What it communicated was that `---` had not been rendered at all: the source says "break" and the
page showed a smudge floating in space. It is a rule across the text now, at GitHub's proportions
(0.25em of `--line-strong`, `--rhythm-rule` of air on either side), because that is what every
markdown renderer draws and therefore what a reader expects to see. The parser was checked before
the styling was touched: across all fourteen of those documents the count of source `---` lines
equals the count of rendered `<hr>` elements, and no document's leading `---` is being eaten as
frontmatter. The break was being rendered the whole time; it just did not look like one.

"The document is not responsive, it's always strip-like, it should be resizable." Fair — and it
is a decision the stylesheet has no business making alone. A third control in the header (`Width`,
next to the theme button) cycles **Normal → Wide → Full**, remembered in `localStorage` under
`mdview:width` exactly like the theme. Normal is the reading measure (646px at 1440px), Wide is
1.3× (841px), Full is deliberately past any reading measure (1295px) for reading a file beside
the tool it came from. The choice is a *scale* on `--measure-base`, not a width, so the wide-
screen steps still apply on top of it, and the page is capped at `max-width: 100%` — measured
against `100%` rather than `100vw`, because that is the measurement that already excludes the
scrollbar — so on a window too narrow for the chosen width the text column takes what is there
rather than producing a horizontal scrollbar.

**Density: the page was set like a book and read like a set of notes.** The reference point that
matters for these files is the place they are usually read — a code host — and measured against
GitHub's markdown stylesheet, scaled from its 16px body to mdview's 18px, the rhythm was airy to
the point of being wrong: a heading sat **52.1px** above itself (2.9 body-`em`) where a wiki or a
code host uses 24px, a section break carried 39.6px above and below, a paragraph gap was 1.15em,
and the body was set at `line-height: 1.72`. Every one of those is now GitHub's proportion:
heading top 1.6 body-`em`, paragraph 1em, break 1.6em, line-height 1.62, the desk above the page
56px instead of 84. The heading ladder is now written *in body-`em`* and the numbers look strange
for it — `h2 { margin-top: 1.16em }` is 1.6em of the body, because a margin in `em` is relative to
the heading's own size — and that is exactly why the old ones were so far out: `2.1em` reads as "a
bit over two lines" and means 52px. Same document, before and after: h2 gaps 52.1 → 28.8px, flow
gaps 20.7 → 18px, section breaks 39.6 → 28.8px, line-height 31.3 → 29.2px. Table bodies are now
striped (`--zebra`, the token the sticky column already painted), because across a table several
columns wide it is the row, not the cell, that the eye has to carry.

Two bugs, both of the kind that present as "nothing happened". The bar's rules sat *earlier* in
the stylesheet than the header's own, at equal specificity, so the base `flex-wrap: wrap` and
`padding-bottom` silently beat the bar's declarations; they are declared with the rest of the
header now. And `--page-w` contains `64ch` — a unit that follows the font of whichever element
**consumes** it, not the one that declared it — so on the bar, whose type is 0.8em, the inset
it computed was 304px instead of 239px and its contents sat 65px right of the text. Registering
`--page-w` with `@property` as a `<length>` makes it compute once, where the page's font
applies, and inherit as a length; without `@property` support the bar's contents are off-centre
by that difference and nothing else changes.

**A title followed straight by a heading had no title block.** These notes open `# gait /
bear / convenient` and then `## Gait` — no lede, so none of the lede's treatment, and the page
began with a lone bold line that read as a sibling of the first heading. When the h1 is the
only thing before a heading it now closes with the same 1px `--line` hairline the lede and every
h2 already use, 0.35em under the title; a document with a lede after its title (3cfc0f) is
unchanged. No new token, no new palette entry — it is the rule the page was already using.

## The page is fluid: the strip was a reading measure used as a page (1.7.0)

> btw, github .md can expand horizontally, I never got why ours can't as if it was made for
> mobile, it should only be responsive.

It *could* expand — the width control already cycled Normal → Wide → Full — but the default was
the reading measure, and the reading measure was also the page: `.mdview` was
`max-width: 62ch`, so at 1440px the document was a 646px card in the middle of the window with the
remaining 700px given away as margin. A hosted markdown file does the opposite: the *page* is a
container that fills the window up to a cap (GitHub's is 1280px) and the text is whatever the
container gives it. mdview had the reading measure sitting in the container's place, so expanding
was a setting you had to find and the page read as a phone layout until you did.

So the default is fluid, and the reading measure became a mode the reader opts into:

| mode | what the text column is |
| --- | --- |
| **Fluid** (default, no attribute) | the page, up to `--measure-cap` (`74rem`, 1184px) |
| **Narrow** (`data-mdview-width="narrow"`) | `--read-measure`: 62ch, 64ch from 1400px |
| **Full** (`data-mdview-width="full"`) | the window, minus the page's own padding |

Measured, fluid, at seven widths (page = the card, text = its content box):

| window | page | text | chars/line |
| ---: | ---: | ---: | ---: |
| 480px | 451 (the window) | 415 | — |
| 1024px | 994 (the window) | 933 | 124 |
| 1280px | 1250 (the window) | 882 | 114 |
| 1440px | 1411 (the window) | 1027 | 130 |
| 1920px | 1726 (the cap) | 1184 | 150 |
| 3840px | 1796 (the cap) | 1184 | 150 |

The cap takes over somewhere around an 1800px window; below it the page *is* the window, which is
the "it should only be responsive" part. Narrow is unchanged from 1.6.1 — 649px of text, ~80
characters, at every width from 1280px up — and Full at 1920px is a 1348px column (171
characters), which is what it is for. Below the cap all three modes measure identically (480px and
1024px), which is what a width control should do when there is nothing left to give it.

**Wider text is not only longer lines: the wide tables stopped scrolling.** The 1.6.1 retune
narrowed the measure to 62ch and accepted, in writing, that the five-column table in `059d7a.md`
no longer fit and would take the designed `scroll-x` + sticky-column path. A 1184px column fits
it: on the kitchen-sink fixture at 1920px, **0 of 8** table cards scroll in Fluid and in Full where
**3** do in Narrow (max overflow 265px). The narrow column is still there for the reader who wants
it; it is no longer the price of the default.

**The card moved out of the document and into the page.** The surface used to be the document
inside the page (`.doc` carried the background, hairline, radius and shadow, on a `.mdview` that
was only a capped wrapper). A fluid page has to be its own surface, so `.mdview` is now
`box-sizing: border-box; width: min(100%, var(--page-w)); max-width: none` with the padding,
background, radius and shadow, and `.doc` is inert. `border-box` is load-bearing twice over: it
makes `--page-w` mean the page's real width, padding included, and it lets the app bar mirror the
page (below). The hairline is a `0 0 0 1px var(--line)` ring rather than a border, because a border
would sit *inside* the border box and pull the text 1px right of the bar.

**The app bar stopped computing an inset and started being the page.** Its contents were aligned
with `padding: 0 calc((100% - var(--page-w)) / 2 + var(--page-pad-x))`, which assumes the page is
narrower than the window — as soon as the page is wider, which is now the normal case rather than
the exception, the inset goes negative, the `padding` declaration is invalid, and the bar's
contents spread across the whole window. The bar now carries a row (`.mast-in`) with the page's own
three declarations (`width: min(100%, var(--page-w))`, `padding: 0 var(--page-pad-x)`, `margin: 0
auto` inside a fixed full-width frame), so the alignment is a consequence of the two sharing a rule
instead of two numbers being made to agree. Measured at 1920px the row and the page have the same
left edge and the same width (82px / 1726px), the chip sits 0px from the text column's left edge,
and that holds at 480, 1024, 1280, 1440, 1920 and 3840 in all three modes. `@property --page-w`
still earns its place, for Narrow: its `62ch` follows the font of whichever element consumes it and
the bar's type is 0.8em. Fluid and Full would not notice, because `rem` does not.

**`--bleed` became a Narrow-mode device.** It exists to give code and tables part of the margin
when the column is too small for them; in a fluid page those blocks already have the whole page,
and reaching past it pushes a code card out through the page's own edge. The 1600px and 1920px
steps are scoped to `[data-mdview-width="narrow"]` now, and in Fluid a fence measures exactly the
text column (1184px at 1920px). No page-level horizontal scrollbar appeared at any of the eight
widths tested, in either palette.

**Three things were found by measuring rather than by looking.**

* The base rule's `max-width: var(--measure)` survived into the wide-screen block, so the first
  fluid measurement — taken at a 2880px viewport — reported a 1796px page whose *used* width was
  1184px, with the text column quietly down to 572px. A page that is `border-box` and wants to be
  `--page-w` wide has to say `max-width: none`: the base value is the text column, and the page is
  wider than the text inside it. Nothing in the stylesheet said so; the numbers did.
* `--page-shadow` was declared in the light tokens and in the `prefers-color-scheme` dark block but
  not in `:root[data-mdview-theme="dark"]`, so a reader who *chose* dark got the light sheet's
  shadow — measured as `rgba(15, 23, 42, 0.35)` under a dark ring. The two dark blocks carry a
  comment asking to be kept in sync; this is the drift that comment is about.
* Changing the width now re-fires a `resize` event. The table fitter caches its answer per card
  width, and a column the reader just changed is a resize as far as it is concerned; without the
  event a table kept the fitting it was given at the old width until the window happened to move.

Verdict: `npm test` 672 passed / 51 documented / 0 unexpected, `web-ext lint` 0 errors / 0 notices /
15 warnings (the pre-existing `UNSAFE_VAR_ASSIGNMENT` in `mermaid.min.js`), and the xpi is 1,027,050
bytes. What is *not* verified is how any of it looks: the preview screenshot path is unavailable in
this environment, so every number above comes from `getBoundingClientRect` and `getComputedStyle`,
and whether 150 characters is the right cap for a fluid page is the reader's call — it is one token
(`--measure-cap`).

## Small things that change how it reads (1.7.1)

Each of these is one decision, and each one is here because of what it does to a reader rather than
to the markup.

**The browser's own furniture now follows the palette.** `color-scheme` was never set, so the
scrollbar, the task-list checkboxes and the `details` triangle kept the operating system's light
rendering. On a dark page the scrollbar is the tallest object on the screen and it was the only
bright one. `:root { color-scheme: light }` with `dark` in both dark blocks (`light`/`dark`, not
`light dark`: mdview decides the palette, so the page and the browser must not disagree about it);
measured as `colorScheme: light / dark / light` across the three theme states.

**Anchors move instead of teleporting.** `html { scroll-behavior: smooth }`, off again under
`prefers-reduced-motion` — the back-to-top button had always scrolled smoothly and a followed link
jumped, which made the two ends of the same page behave like different documents. A reader who sees
the page travel keeps their sense of where the thing they left is; a jump that arrives with no
motion reads as a different page. Verified by following an outline link: the target heading lands
at exactly its `scroll-margin-top` of 72px (the 48px bar plus 24px of air) instead of under the bar,
and the outline's `aria-current` moves with it.

**A table's figures line up.** `font-variant-numeric: tabular-nums` on every cell. A table is read
down its columns and compared across its rows, and proportional digits make that the one thing the
eye cannot do: `1111` is narrower than `9999`, so a column of figures wanders left and right and
every comparison costs a re-read.

**The tab says what the document is.** `document.title` was the file name, and
`deepseek_markdown_20260930_0f7a83.md` says nothing about what is behind it — with sixteen of these
exports open, the tab strip was a list of hashes. It is now the document's own `#` heading, read off
a copy with the anchor link removed (that link's `#` is chrome, not title), capped at 90 characters
with an ellipsis because one of these files has a 205-character H1, and falling back to the file name
when there is no `#`. In the browser the log line now carries it: `title "swing / protocol / gRPC /
Thrift"`, `title "mdview rendering check"`.

**And one that was measured, disliked, and taken back out.** `scrollbar-gutter: stable` stops the page
shifting half a scrollbar sideways when a scrollbar appears mid-read, which is the classic layout
shift. It also cost the app bar's mirror: a *reserved* gutter is not part of the containing block a
fixed element is sized by, while the body it centres the page in is, so on a document too short to
scroll (at 1440px) the page sat at 77px and the bar's row at 85px — the bar's contents 7px right of
the text column on every short document, to fix a 7.5px shift on a rare one. The mirror is the more
valuable of the two, and the trade-off is recorded in the stylesheet where the rule would have gone.

Verdict: `npm test` 672 / 51 / 0 unchanged (none of this touches the parser), `web-ext lint` 0 errors
/ 0 notices / 15 warnings, both manifests 1.7.1. Everything above was verified from the live page in
the harness — `getComputedStyle` for the tokens, `getBoundingClientRect` for the alignment
(0px between the filename chip and the text column on a short document and on a long one), the
console log for the title, and a followed link for the landing offset.

## The text itself: a reading face, and the metrics that come with it (1.8.0)

Everything above is about the page. The text on it was whatever `system-ui` resolves to, which on
this machine is **Noto Sans** (`fc-match system-ui` → `NotoSans-Regular.ttf`) — a *UI* face: drawn
for buttons and labels and short strings, chosen by the desktop environment for those jobs, and put
here to carry 150-character lines. That is the whole of the complaint about the text, and it is the
same complaint as the fluid page's: a decision made for one context applied to another.

So the face became a choice — a fourth control in the bar (`Type`, next to `Width`), cycling
**Sans → Serif**, remembered in `localStorage` under `mdview:font` exactly like the theme and the
width.

* **Sans** is the default and the absence of the attribute: what the page has always been.
* **Serif** is the same page set as a book. The stack is `Noto Serif, "Bitstream Charter", Charter,
  "Iowan Old Style", "Source Serif 4", Georgia, "TeX Gyre Schola", "Palatino Linotype",
  "Liberation Serif", "DejaVu Serif", serif` — every entry a text face with a real italic, so `em`
  is never a synthesised slant (a faux italic on a long line is the one thing that always looks
  wrong).

Which face those names land on was checked rather than assumed, because the two engines disagree:
Chrome does not match `"Bitstream Charter"` by that name at all (it measures identically to an
unknown family's fallback, Times-metric), and Firefox does — so leading with Charter would have
shown one face in the Firefox extension and a different one in any Chromium preview of the same
file, which is exactly the kind of difference that costs an hour of arguing about a screenshot.
Noto Serif leads instead: installed here, matched by both engines, and wide enough that the fluid
page's 150 characters become 141 — a small readability dividend rather than a cost.

**A face is not a skin: it moves the measurements.** Type at the same `font-size` from a different
face and three numbers are wrong at once, so the serif mode carries its own:

| | sans | serif | why |
| --- | ---: | ---: | --- |
| body size (at 1440px) | 18px | 18.36px | `--type-size: 1.02` — a text face's x-height reads smaller |
| leading | 29.16px | 30.48px | `--type-leading: 1.66` — shorter ascenders close the line gap up |
| inline code | 13.85px | 14.71px | `--code-size: 0.89em` — mono beside a serif reads smaller |
| h1 tracking | −0.91px | −0.43px | a serif is already tight at display sizes |
| characters per line | 150 | 141 | the fluid cap, measured |

All three are tokens, and the body's font-size is now the clamp *times* `--type-size`, so the two
decisions (how big the page is, how big the face is) stay separate.

**And switching the face broke a definition list, which is worth recording because it is the sort of
thing only a number would show.** The term column is locked in `em` on purpose — so a window resize
moves it with the text — but a *face* is not an `em`: the same terms set in a serif are a different
number of `em`, and on `0f7a83.md` one term no longer fit, so it wrapped to two lines (term heights
`[44, 84]` in serif against `[42, 52]` in sans), which destroys the alignment the whole treatment
exists to create. The column is now re-locked when the reader changes the type or the width: the grid
comes off, the terms measure as the inline text they are, and it goes back on in the same frame — no
paint in between, so nothing flickers. Measured after: `--def-term-w` 5.842em (sans) → 6.313em
(serif), all term heights single-line, descriptions still left-aligned with each other.

The widths and the face are also a reminder that a "just a font" change is a layout change: the pass
that needs to *undo* its own markup to measure again cannot listen for a resize (that would mean
measuring every term on every pixel of a window drag), so it registers a hook that only the reader's
own choices fire — `onRemeasure`, next to the resize the table fitter and the progress bar already
listen for.

Verdict: `npm test` 672 / 51 / 0, `web-ext lint` 0 errors / 0 notices / 15 warnings, both manifests
1.8.0. Verified live: the control cycles and persists (`Sans` → `Serif`, `data-mdview-font` and
`localStorage` agreeing), the used face is `Noto Serif` by measurement rather than by name, no page
overflow at 1440 or 3840px in either face, the four buttons and the file chip share the bar at
1024px without a wrap (`chip.right` 158 ≤ `actions.left` 1068, row 47px tall in a 48px bar), and the
definition-list numbers above.

What is *not* settled is the one thing I cannot measure: how it looks. The preview screenshot path
is unavailable in this environment, so the face is a recommendation made from font metadata and
metrics — and if Noto Serif reads as too wide or too plain on the actual screen, the stack is one
line and the alternative faces are already installed (`fc-match` lists Charter, Schola, Pagella,
P052, Latin Modern).

## The other components: lists, boxes, and one label that set the width of 66 rows (1.8.1)

A real document — `0x61694f`, eleven `###` sections of `**Label:** value` lines, a three-column
summary grid, four `---` — turned up five things, four of them in the components rather than in the
text.

**One long label was setting the width of every row in the document.** The definition-list column
is one shared width across the whole file, so that every description starts at the same x. In this
document the 66 terms have a median width of **5.4em** and one outlier at **14.4em**
(`How it relates to earlier terms:`), and the outlier was what the column was locked to: 260px, or
22% of the text width, with descriptions pushed 80px past where 65 of them needed to start. The
track is now `min(--def-term-w, --def-term-cap, 40%)` with `--def-term-cap: 10em` — a label longer
than that is a sentence, not a term. Measured after: the column is 180px, **one** row in the
document is taller (the long label wraps inside its own cell), and the other 65 rows keep their
space. The cap is a token, and it never binds on a document whose terms are all short.

**A list inside a labeled line is that line's sub-list.** The Insert section is
`- **In security context:** …` with three examples under it (`SQL injection:`, `Command injection:`,
`XSS:`), and since the pass walked *every* `ul`, the three examples were set as rows of a second
definition list nested inside the first: one column further in, with three short terms handed the
width of the document-wide term column. They are three bullets under a sentence, so a list that is
already inside a `.def-desc` is now left as a list. Measured: 12 definition lists → 11, and the eight
sub-lists inside descriptions stay bullets.

**A wide code block hid its own overflow.** `fitTables` gives a wide table a soft shadow at each
edge, pinned to the card and fading out at the end it points at — and a fence with a long line, which
hides exactly the same thing, had nothing. It has the same 2.7em of shade now, drawn the no-JS way:
two opaque gradient layers with `background-attachment: local` and two shadow layers with `scroll`, so
the shadows travel with the text and are visible on a side only while there is something left to
reach on that side. Verified as `local, local, scroll, scroll` with four layers, and the block's
height is unchanged (85px before and after), because backgrounds are not layout.

**Two list states that were being drawn the same as their neighbours.** Nested ordered lists were
`decimal` at every depth — every renderer does that, and it means the depth of a list can only be
read by counting indents. They are now `1.` → `a.` → `i.`, the way a printed outline numbers itself.
And a checked `- [x]` was a ticked box on otherwise ordinary text: the item is struck through in
`--line-strong` (a mark *over* the words, not part of them) and stepped back to `--faint`, while the
box keeps its accent because it is the state and not the line — text decorations do not propagate
into replaced elements, so the declaration sits on the item and the box is untouched (measured:
`text-decoration-line: line-through` on the item, `none` on the checkbox, background still the
accent).

**And an observation about the two engines that is worth having written down.** The stylesheet uses
fractional weights (520 for a table's first column, 620 for a header, 640 for `strong`), which the two
engines resolve differently: on this machine's static Noto Sans, **Chrome synthesises an in-between
weight** for 500 and 520 (measured widths 230.21 / 233.09 / 236.82 for 400 / 520 / 700) while
**Firefox snaps them to the nearest real face** (520 → bold). The intent survives either way — a kv
sheet's labels step back, a grid's first column carries the key — but the two builds are not
pixel-identical, and that is a fact about the extension, not about the document.

Verdict: `npm test` 672 / 51 / 0, `web-ext lint` 0 errors / 0 notices / 15 warnings, both manifests
1.8.1. Everything above was measured in the harness: the term column (260 → 180px, one wrapped row),
the counts of definition lists (12 → 11) and sub-lists (8), the fence's background layers and
unchanged height, the ordered-list marker types by depth, and the checked item's decoration, colour
and checkbox background. What is still not verified is how any of it *looks*: the preview screenshot
path is unavailable here, so these are geometry and computed style, not pixels.

## The head of a long table, and the row under the pointer (1.8.2)

A survey of the eighteen `deepseek_markdown_*.md` documents in `~` says what these files are made of:
**2,404 lines, two code fences, no images, and a table in every single one** — up to 55 pipe lines in
a file, and always the same shape: `Term | Meaning | Context / Examples`, three columns of prose in
which a row is two or three wrapped lines tall. So the tables are where the reading happens, and two
things were still costing the reader something.

**A table taller than the window loses its head.** The head is the one part of a table that can be
looked up — which column am I in, what is this column called — and a table with an end you cannot see
loses it to the page scroll. `fitTables` now marks such a card `tall`, and the head is pinned to the
window instead of to the card: `position: sticky` with the same offset as the app bar, so rows slide
underneath it and the names stay in view. Measured on `0x55cc9c`, whose first table is 836.6px in a
900px window: the head sits at **48px — the bar's own bottom edge, mast measured at 48 — while the
card's top is at 0.5, −199 and −499**, and is released when the card's bottom reaches it (head bottom
−362.6 against card bottom −361.9). Below 1024px there is no bar and the token is unset, so the offset
falls back to 2px, the height of the reading-progress line — the one other thing fixed to the top of
the window — and the same document measured at 700px pins at 2px.

Making that work needed one non-obvious line. A card with `overflow: auto` **is a scroll container,
and a scroll container is what a sticky head pins to** — inside one, a head can never travel with the
page. `overflow-x: clip` still hides what does not fit, is *not* a scroll container, and is the one
value that can be paired with `overflow-y: visible` (any other pairing turns `visible` into `auto`),
which leaves the page as the head's scrollport. It is said only for the cards whose table **fits**
across — the class is added in the branch where `fitTables` has just proved it — so nothing is ever
hidden by it, and a card whose table needs its width keeps `auto` and simply does not pin. Verified
in the harness: on the same page, `clip/visible` on the four fitting cards and `auto/auto` with
`scroll-x`, `sticky-col`, `tabindex=0` and a working `scrollLeft` on the two that overflow, with no
page-level horizontal scrollbar either way. Because it is one class and one branch, a JS failure
leaves the old, safe behaviour — a scrolling card — rather than a clipped table.

Two details that are only visible if you look for them. Under `border-collapse: collapse` the rule
below a header belongs to the table's border grid and does not travel with the cell, so a pinned head
would be a head with no bottom edge: the line is drawn inside the cell instead (`inset 0 -1px 0`
`--line-strong`, measured as `rgb(204, 210, 218)`, exactly the token). And a pinned head is a screen
thing, so the print block puts it back — `position: static`, the hairline back on the border.

**And the row under the pointer is lit.** A three-column table of prose has to be carried across the
width of the card and back on every row, so the row being read is now the one at a slightly different
value: `--rowof` one step past the zebra in the same direction each palette goes (`#eef2f7` on white,
`#1e2631` above the dark card, against zebras of `#f8fafc` and `#12161c`). It is the last thing in the
tables section of the stylesheet on purpose, and measuring is what put it there: the first version sat
next to the zebra it modifies, and on a `scroll-x` card the pinned label column stayed zebra-coloured
while the rest of the hovered row lit — the pinned column paints its own background from a rule
further down with the same weight, so order decided it. Moved to the end, the hovered row measured
`rgb(238, 242, 247)` in all nine cells of a `sticky-col` card, the pinned first column included.

**One thing looked at and not done.** The definition-list column is one shared width for the whole
file, and in `0x61694f` the per-list term maxima are `6.35 ×5, 6.42, 7.84, 8.02, 8.18, 8.92, 9.02 em`
— so eleven lists are laid out at the width two of them need, about 47px of gutter per row on the
other nine. Sizing each list to its own terms was rejected anyway: the raggedness arrives on every
section of every document (descriptions starting at eleven different x positions), while the cost is
2.6em of gutter on rows whose descriptions are a hundred characters long. The uniform column is the
stronger grid, and 2.6em of 1027px of text is not what is wrong with the page. `--def-term-cap` stays
as the guard for the label that is really a sentence.

Verdict: `npm test` 672 / 51 / 0, `web-ext lint` 0 errors / 0 notices / 15 warnings (the pre-existing
`UNSAFE_VAR_ASSIGNMENT` in `mermaid.min.js`), both manifests 1.8.2. Everything above is geometry and
computed style measured in the harness — pinned offsets, the released head, overflow pairs,the hovered row's cells, the resolved `--rowof` — because the preview screenshot path is unavailable here.
Whether a head floating under the bar *looks* right is the reader's call, not this machine's: asked and
answered on 2026-09-30, the reader kept the pinned head as built and kept Noto Serif as the reading
face. Both are settled choices now, not open questions — do not re-open them without evidence from
the screen.

## Finishing a file: the reader's own record (1.9.0)

The brief for this pass was not typographic. It was "make it psychologically addicting" — the
wanted outcome is that the eighteen `deepseek_markdown_*.md` documents, which are *have to*
reading rather than *want to* reading, actually get read through instead of opened and
abandoned. That is a behaviour problem, and the honest levers on it are three, none of which
is a font:

1. **An unfinished thing you can see.** A file with a visible, incomplete state pulls at the
   reader; the same file with no state at all is a blank chore every time it is opened
   (the Zeigarnik effect).
2. **A goal that is part-full.** A bar at 40% is a reason to continue in a way that no bar at
   all is, and it works at any scale — the file, or the section.
3. **A way back that costs nothing.** The most expensive part of resuming a long file is
   finding the place again. Today that cost is paid with the scrollbar and the search box.

None of the three is a fact about the markdown, so none of it went into the renderer: the
record lives outside `.mdview` and outside `renderMarkdown()`, the spec suite is untouched
(672 / 51 / 0 before and after), and a document that reaches any other markdown renderer
still has none of it — as it should.

**The record.** One entry per URL (hash dropped, because a link to a section is still the same
document): furthest percent read, the offset to come back to, the sections already behind the
reader, and whether it is finished. It is kept in `browser.storage.local` when there is an
extension to ask, and in `localStorage` otherwise — the harness has no `browser` object, which
is what made the whole loop verifiable without installing anything, and a `file://` page can be
an opaque origin where `localStorage` throws and remembers nothing. That is also why the
manifest gained the `storage` permission (MV2 and MV3): the per-document record cannot depend
on an origin the reader's browser may refuse to give it. Writes are debounced 700ms and flushed
on `pagehide`, so closing a tab mid-read still remembers the place and a scroll does not write
to storage sixty times a second.

**The outline became a record of the work.** Each section whose heading has left the top of the
window is ticked and dimmed, in both the margin outline and the narrow-window `Contents`
disclosure, and both counters climb (`On this page · 6/17`). A mark is never taken away by
scrolling back up: it is a fact about what has been seen, and a page that un-reads itself would
just feel punitive — the one place where a *less* accurate UI would be the better one. The
honesty limit is worth stating: a reader who jumps to the bottom of a file they have read before
is marked as having read all of it, because the rule is scroll position, not attention. That is
the right trade here — the marks set a floor under the display, and the percent is what carries
the pull.

**And each entry now says how long it is** (`2m`), from the words between that heading and the
next one of any level, at the same 220wpm the header already uses. This is the "one more
section" nudge: an outline of links says where you could go, an outline of lengths says how
little it would cost.

**The way back.** A pill in the bottom-left corner (the back-to-top button owns the other one),
which appears only when there is genuinely a place to go back to: past 8%, not finished, at
least 60% of a screen down, and not already under the reader's feet — it retires itself once
scroll is within 320px of the target, so it cannot nag someone who has arrived by hand. One
click returns to the stored offset; `×` dismisses it for that page load only (a dismissal that
persisted would be a dismissal of the whole mechanic). It is deliberately *not* an automatic
restore of the scroll position: silently reopening a file halfway down is a surprise, and this
pass is about removing friction, not about taking the wheel.

**The end, marked.** Where the document stops there is now a plate: a hairline, `End of
Document`, the section count, the same word and minute figures the header shows, and a `Read
Again` that clears the record and returns to the top. The tick above it is held in the layout
and hidden until the record says finished, so it arrives — in the one place a reader who has
just finished is guaranteed to be looking — without moving anything. A page that simply stops
leaves the reader reading the scrollbar to find out whether they are done; a session that does
not end visibly is the one that feels abandoned.

**The bar knows too.** A chip beside the file's own statistics reads `62% read`, or `Read ✓` in
accent when it is finished. The separator is a pseudo-element on the chip, so it exists only
when the chip has something to say. Because it is the same token block, it needed no palette
work: measured in dark, `--card` `rgb(21, 26, 32)`, `--line` `rgb(38, 44, 53)`, `--muted`
`rgb(154, 165, 180)`, the tick in `--accent` `rgb(108, 182, 224)`, read outline entries in
`--faint` `rgb(113, 125, 140)` against `rgb(154, 165, 180)` unread, and the tick itself reading
`content: " ✓"`.

**Two bugs, and one measurement lesson.** The narrow-window `Contents` list had been printing a
stray `#` after every entry since 1.5.1 — it is built inside `decorate()`, *after*
`addHeadingAnchors` has put the `#` anchor inside each heading, so `textContent` picked the link
up, while the margin outline (built before `decorate`) was clean and the two lists disagreed. The
shared entry builder now reads the heading with the anchor removed, the way the tab title already
did. And the harness's scroll: `scrollTop` and `window.scrollTo(y)` did nothing at all for the
first half of this pass, because the stylesheet sets `scroll-behavior: smooth` on `html` and this
preview renderer never composites a frame — the smooth animation starts and never advances, so
the scroll offset never moves. `scrollTo({ top: y, behavior: "instant" })` scrolls immediately.
Worth writing down: in this environment a *frozen* transition and a *failed* scroll look exactly
like broken code, and both are the environment.

Verified in the harness on `0x55cc9c` and on the fixture, light and dark, 1440 and 430px: a fresh
key starts genuinely empty (chip absent, `0/5`, plate unticked, no stored record); at 50% the
chip, the outline count, the marks and the stored record all agree, with `pct` 49.997 and the
offset rounded; a reload of the same URL restores `50% read`, `2/5`, two ticks, and offers
`Continue at 50% · 2 min left` with the click calling `scrollTo({ top: 1912, … })` and retiring
the pill; the bottom flips the chip to `Read ✓`, ticks the plate, sets `opacity: 1` on the mark
(with transitions disabled — this renderer freezes them), fills the progress line and stores
`done: true`; `Read Again` clears all of it back to `0 of 5`; and the fixture walks to `17 of 17
sections read · 1,340 words · ≈ 6 min read · 1/2 done` with zero page overflow and no console
output beyond the usual render line. `npm test` 672 / 51 / 0, `web-ext lint` 0 errors / 0 notices
/ 15 warnings, both manifests 1.9.0, the Chrome copy byte-identical and the xpi matching source.

**Deliberately not built:** streaks, points, badges, or anything counted per day. Those are the
cheap half of the word "addicting" — they reward opening the file, which is the behaviour that
already works — while the expensive half is rewarding *finishing* it, which is what a per-file
record does. No new colours either: the whole pass is made of tokens that already existed in
both palettes.

## One page, one system: symmetry, cohesion, cleanliness (1.9.1)

The brief was a question rather than a list — "what about symetry, and visual harmony cohesion and
cleaness?" — which is the kind of brief that has to be answered with numbers, because harmony is
either two measurements that agree or it is a mood. So this pass read the page's *furniture* the
way 1.7.x read its blocks: find the same object twice, compare the two sets of numbers, and keep
only the differences that mean something. Six came out.

**The bar's row was two materials.** The filename chip measured 27.1px tall with `--shadow` under
it and the three buttons beside it 29px with no shadow — same row, same border, same 99px pill,
one control floating and three flat. The chip takes the buttons' `0.25em` of vertical padding
(28.5px against 29px, the residual half-pixel being the mono face's deliberate 0.94em) and gives
up its shadow: `--shadow` belongs to *surfaces* — a card, the page, a key cap — and everything on
the bar sits on the bar.

**The two corner pills were two controls.** `.mdview-resume` and `.mdview-totop` are the same
object in mirrored corners (same `clamp(12px, 2.2vw, 28px)` inset, same bottom edge, same radius,
both fixed) and nothing else about them agreed: 13.5px of type against 15px, a bespoke two-layer
shadow against the resting one, 27.9px of height against 34.5px. And a shared token alone would
*not* have fixed it — the totop is a `<button>` (border-box) and the resume a `<div>
(content-box), so one `--float-h` of 34.16px came out 34.2px on one side and 35.6px on the other.
Both now declare `box-sizing: border-box`, both take `--float-h`, both take the new
`--float-shadow`, and both are sized from `--ui-size` — the page's own type size, which until now
was a `calc()` literal written inside `.mdview` and reachable from nothing outside it, which is
exactly why the two fixed pills were the only chrome on the page that did not follow the reader's
Type control. Measured at 1439px: 34.16px and 34.16px tall, 21.73px and 21.73px from the bottom
edge, one shadow; at 430px, 30.4px and 30.4px — the pair scales with the window as one thing. (In serif mode both
are 31.0px, so the two pills are chrome that now follows the Type control like the bar does.) The
inner button needed `line-height: 1` to stop it standing 35.6px tall inside its own pill, and the
two ratios are deliberately different: the round pill's glyph takes 0.83 of the page's type and
the text pill's label 0.75, because a glyph has to be larger than a word to read at the same
weight. What the pair shares is the token, not the ratio — and that is the improvement: before,
the pills were 1.92× the body's type on a wide window and 2.23× on a narrow one; now they are
1.90× and 1.96×, so the relationship holds instead of drifting.

**The narrow `Contents` card was padded twice.** It is a `<details>`, so the generic rule gives it
`0.7em 1.05em` of padding of its own *and* its summary and list carry an inset — two insets for
one card. At a 430px window the title started 15.36px in from the card and the list 13.25px,
because `em` padding follows the element it is set on and the title is set at 0.82 of the card's
type; the open-state rule stopped 15px short of the card it divides; and the top strip, being the
summary's box rather than the card's, was not clickable edge to edge. The card's padding is `0`
now and the inset lives on the two children, so the summary's box *is* the card's width: one
13.96px inset, measured, for the title, the rule and the list — from the single `--eyebrow: 0.82`
that sets the title's size and divides its padding back into the card's em. The label also takes
`font-weight: 500` like the margin outline's own title, where it had been inheriting 600 from the
generic `summary` rule, so the two versions of one label read as one label. The closed card is
34.8px tall instead of 52.1px.

**One radius vocabulary.** `3px`, `4px` and `5px` were doing one job between them — `mark`, a
targeted heading, a footnote target, a task checkbox, a focus ring, a `kbd` — and a lone `999px`
sat beside eight `99px` pills. There is now `--radius-xs: 4px` for the washes and small boxes,
`kbd` takes `--radius-sm` beside inline `code` (both are the same small bordered mono box), and
the frontmatter pill takes `99px`. What is left in the sheet is `--radius-xs`, `--radius-sm`,
`--radius`, `--page-radius`, the pill `99px`, and the print resets' `0`.

**Checked, and deliberately left.** The end plate is the one mirror-symmetric element on the page
and it is exact: `Read Again` centres on the column's centre to 0.00px (563.73 against 563.73),
with the tick and the label centred in the same way, and the hairline above it runs the column
like the header's. The margin outline's title sits at the rail's x rather than indented to the
entries' text: the card version has no rail, so its title takes the list's inset, and in both
places the title aligns to the outline's own frame. The block rhythm came through untouched —
18px between flow blocks, 28.8px around a rule, 15.4px from an `h2` down to its first block,
14.4px from an `h3` — which is 1.7.1's relationship at today's type size (1em and 1.6em exactly).

**And the alignment the earlier passes bought is still exact**, which is the thing a harmony pass
can most easily break: the page's content box, a paragraph, an `h2` and the bar's filename chip
all start at 43.2px, and the bar's last control, the page's content right edge and the outline's
right edge all end at 1381.87px, with no page overflow at 1439 or 430px, light or dark. Both
`--float-*` tokens are declared in the light block and in *both* dark blocks — the drift that bit
`--page-shadow` in 1.7.1.

Verdict: `npm test` 672 / 51 / 0 (unchanged: no renderer code was touched — the pass is entirely
in the stylesheet, plus two version numbers), `web-ext lint` 0 errors / 0 notices / 15 warnings,
both manifests 1.9.1, the Chrome copy byte-identical and the xpi matching source.

## One meaning per colour: the palette as a language (1.9.2)

The brief was five words — "what about the psychology of colors?" — and the useful reading of it is a
question about language: does each colour mean one thing, and does the meaning survive where it is
actually read? A palette can be pretty and still be lying — a signal word set at 2.26:1, the same green
typed three times, the reader's own mark fainter than the page. So this pass measured every colour's
job in both palettes and changed the four places where the numbers said the colour was not saying what
it was meant to say. The renderer is untouched: the pass is the stylesheet, three literals in the
popup, and two version numbers.

**The callouts had only ever been measured on the dark page.** The 1.5.1 note is explicit — the
mid-tones were "chosen so one set reads on both palettes: measured … **over a `#0f1216` page**". They
do read there. On the light page the same colours, which also draw the 3px rule and the small-caps
label (0.7em of mono, 12.6px at today's type), measured against their own washes:

| callout | light before | light after | dark before | dark after |
|---|---|---|---|---|
| note | `#0369a1` · 5.28 | *(accent)* · 5.07 | `#6cb6e0` · 6.22 | *(accent)* · 6.46 |
| tip | `#3aa981` · **2.64** | `#2a795d` · 4.54 | `#3aa981` · 5.10 | *(same)* · 5.10 |
| important | `#8b5cf6` · **3.69** | `#7a45f5` · 4.51 | `#8b5cf6` · **3.69** | `#9c74f7` · 4.52 |
| warning | `#d29922` · **2.26** | `#8a6416` · 4.63 | `#d29922` · 5.61 | *(same)* · 5.85 |
| caution | `#e5534b` · **3.23** | `#cd271e` · 4.52 | `#e5534b` · 4.23 | `#e75d55` · 4.51 |

A warning label that has to be squinted at is a warning the reader misses; `important` failed in both
palettes and had been passing only in the 1.5.1 measurement's imagination (at 3.69 against a light wash
and 3.69 against a dark one — a mid-tone is the one value that can be equally wrong in both). The set
is now declared per palette — five meanings, one colour each, each held to 4.5:1 against its own wash —
and the wash is *derived*, `color-mix(in srgb, var(--callout-edge, var(--accent)) 11%, transparent)`,
so the rule, the label and the card are one value by construction instead of three copies of one hex.
(Two ratios move without a colour moving — the light note's and the dark warning's — because their
washes had been 8% and 13% and are now the same 11% as every other card.)
The hues are the 1.5.1 hues, made to hold their contrast: green to spruce, violet to a fuller violet,
amber to a gold-brown (which is what readable amber is on white — GitHub's warning browns the same
way), red to a stop-sign red. Dark keeps tip and warning, since they passed, and moves only the two
that did not. `note` follows `--accent`, so it has no per-palette value and follows the theme as it
always did.

**The panel had its own copies, and one was a typo.** The popup's two status dots and its help card's
3px rule carried literals: `#3aa981` for access on, `#e0534b` for off — a digit away from the callout
caution red `#e5534b` — and `#e0534b` again. The popup loads the same stylesheet, so those were a
third copy of the same two meanings, and in the light palette the on-dot measured 2.93:1 on the panel.
Both dots and the rule now take `--callout-tip` / `--callout-caution`; measured on the popup harness,
on-state `rgb(42,121,93)` light and `rgb(58,169,129)` dark, off-state `rgb(205,39,30)` and
`rgb(231,93,85)`, the help edge the same (the light on-dot 2.93 → 5.26).

**The reader's own mark was the faintest thing on the page.** The author's highlighter (`mark`) reads
at 11.70:1 of ink on its wash — the loudest inline object in the document. The reader's own act of
selecting text was `--accenttint` at 8%, the *ambient* wash a targeted heading and a hovered control
also use, and measured 1.12:1 against the page: a mark you cannot see, and one that cannot be told
apart from a hover. `--select-bg` is `color-mix(in srgb, var(--accent) 20%, transparent)` — an
act-level tint, derived from the accent so one declaration holds in both palettes and a reader who
changes the accent gets a selection that matches it — measured 1.35:1 against the light page and 1.46
against the dark one, with the ink still at 12.15 and 9.72. The sheet also carried the rule twice
(`.mdview ::selection`, once without the ink colour); it is one rule now.

**The bar named the file in fine print.** `.mast-file` was `--faint`: 2.85:1 against the bar, the
quietest element in the row, under even the 3:1 floor for non-text, while the section count beside it
sat at 6:1. A document's name is the one thing in that row the reader should never have to work for, so
the chip takes `--muted` (5.65 light, 7.52 dark). The rest of `--faint` stays where it is: the
outline's minutes, the anchor glyph, the endplate — garnish and a closing whisper, not content.

**The contract is written down now**, in the token block where the next edit will see it: *hue says
what kind of note it is, temperature says how urgent.* Blue is the reader's own thread — links, focus,
selection, the progress line, the current section, the done tick, quotations and notes — and it is
never an alarm. Green is the one green: advice. Violet: importance without alarm. Amber: attention.
Red: stop. The only hue that appears twice is the warm one — `mark`'s highlighter yellow and the
warning's amber — and they are kept apart on purpose: one is a wash behind words, the other a 3px rule
beside a label, and the lightness gap (76% against 31%) means the two cannot be read as one object. If
they ever meet, an author's vivid mark inside a pale warning card, that is the right way round.

**Checked and deliberately left.** The plain `blockquote`'s accent edge — a callout *is* a blockquote
with a label and a wash, and the blue rule is what ties the two together. The `mark` pair, at 11.70:1
light and 8.85:1 dark. The neutral surfaces: `--zebra` steps away from the card in the same direction
in both palettes and `--rowof` one step further, which is the whole of what a table row has to say.
And the endplate stays faint — the reward there is the accent tick; the plate is the page's closing
whisper.

Verdict: `npm test` 672 / 51 / 0 (unchanged: no renderer code was touched), `web-ext lint` 0 errors /
0 notices / 15 warnings, both manifests 1.9.2, both dark blocks extracted and diffed — 28 declarations
each, identical — the Chrome copy byte-identical and the xpi matching source (1,040,860 bytes).
Measured in the harness rather than trusted: the five callouts report their computed values in the
light palette, under the attribute dark palette and under the media-query dark palette, all three
agreeing; `::selection` resolves to `color(srgb … / 0.2)` on the accent of each palette; and the popup
harness renders both dot states out of the same tokens.

## Folds, recall, and the space that says nothing (1.10.0)

The brief was three features and one question — foldable sections, a recall mode, the warm palette, and
"what about the management of blank spaces? they normally disrupt a lot and are boring" — and the
question turned out to be a bug report about the reader's own files.

**The blank space was headings that label nothing.** The survey: 123 `.md` files, none of them padded
with `&nbsp;` or `<br>` (the usual suspects), none with runs of blank lines (CommonMark drops them
anyway) — but 214 headings with nothing between them and the next heading, and 73 of those sit before
a *sibling or a parent* rather than a child. Two files are almost nothing else: `0 A Clase …_hybrid.md`
is a failed PDF extract whose whole body is thirty-one `## Page N` markers, and
`deepseek_markdown_20260929_454943.md` has forty-two of them in front of real `#` titles. Measured on
the first, every marker was being drawn as a complete section: 32.4px of ruled heading (a 19.8px line,
5.95px of `padding-bottom`, a hairline) plus 23px of collapsed margins — **55.4px per label, 1,717px of
empty rows for the file**, with a hover-only `#` as the only thing on the line.

A pass added after render (`markBareHeadings()`) tells the two apart. A heading whose next heading is
*deeper* is a container: it keeps its rule — its subheadings are what it closes over — and loses the
air (`margin-bottom` 0.35em, and the following heading's `margin-top` 0.45em instead of 1.16em),
measured at 8.7–9.1px from the rule to its child. A heading whose next heading is a sibling or a parent
is a *marker*: it loses the rule too, because a rule is what a section gets for closing and this one
closes nothing. After: **34.7px per marker** (a 25.8px line plus an 8.9px gap), 37% less, and the wall
of empty ruled sections reads as a list of page names. Normal headings are untouched at 15.4px to their
first block — the 1.7.1 number, re-measured.

**Folding.** The caret sits after the heading's words, where an accordion puts it — not in the margin,
because the margin already belongs to the `#` anchor at every width above 1024px, and moving either of
them would break an alignment the 1.9.1 pass had just made exact. It is chrome, not type: one size on
an h2 and an h6, off `--ui-size` like the corner pills, with a 24.1px target (a real click target, not
a glyph); the heading's own line box grows for it by 0.05px at 1440 and 0.18px at 430. A section's
range is the siblings after it, up to the next heading of the same or shallower level, and the endplate
is never inside one. State lives per URL in `mdview:fold:<href>` as three small sets — `f` folded, `o`
opened while studying, `s` the mode. Verified in the harness: one click folded a section of a table, a
paragraph and an `hr` (`aria-expanded` false, `▾` → `▸`), the record was written, and a reload restored
it — immediately, because the same record is mirrored into `localStorage` and read synchronously for
the first paint: extension storage can take a moment, and a studied file that flashes its whole text
before folding is worse than one that starts folded. Unfolding re-measures the page, which matters: a
table opened out of a fold had been measured while hidden (a 0px card, room `0x900`) and comes back at
its real `326x900`, fitted again — the fold changes the shape of the document, so the passes that read
the shape are told.

**Recall.** Study is folding used as retrieval practice: the file opens as a list of headings, and the
reader unfolds what they can recall. One control in the bar shows the mode, `Read`/`Study`. The two
sets are deliberately separate — a file half-read in one mode is not half-read in the other — so the
study set and the reading set never fight. Verified on `0x55cc9c`: Study folded 13 elements across 5
sections; opening the second stored `o: { access-control-security-concepts: 1 }`, showed it (`▾`) and
left the other four closed; switching back to Read restored that mode's own fold (1 section, 3 elements
hidden) with the study set intact; a reload restored Study, every caret at `▸`. Print unfolds
everything: a folded section is a screen state, and paper has only one shape.

**Paper.** The fourth palette is declared *after* the two dark blocks, and that position is
load-bearing: the `prefers-color-scheme` block matches every explicit theme except `light`, so on a
dark system it applies to a warm reader too and the warm block has to come later to win. It also has to
restate everything that block declares — all 28 tokens, verified by extracting and diffing the three
blocks — and two of them are easy to forget and obvious when forgotten: `color-scheme` (a warm page
with dark scrollbars is the one thing this palette must not be) and the checkbox tick, drawn white
here because the accent it sits on is dark. The values are the light palette's *relationships* on warm
paper rather than its values: card `#fbf6ec`, and everything read on it re-measured — ink 14.24:1,
muted 5.64 (bar 5.04), faint 3.10 (2.77), the accent 5.12 on the card and 4.54 on its own wash, the
four callout colours 4.50–4.52 on theirs, selection 1.32 with the ink still at 10.78. The highlighter
is unchanged: a pen is a pen on any paper, and its ink still reads at 11.70:1.

**Checked and deliberately left.** The popup's own palette follows the system rather than the reader's
choice — the choice lives in the *page's* storage, which a `moz-extension://` panel cannot read. That
was already true of Light and Dark; Warm only makes it visible, and closing it means writing the theme
into extension storage as well. And the reading record still marks a folded section as its heading
scrolls past: the record is a map of position through the file, not a claim of comprehension.

Verdict: `npm test` 672 / 51 / 0 (unchanged — the renderer is untouched and the pass is chrome plus the
stylesheet), `web-ext lint` 0 errors / 0 notices / 15 warnings, both manifests 1.10.0, both dark blocks
still identical, the Chrome copy byte-identical and the xpi matching source (1,044,789 bytes). Measured
in the harness: the fold record written, read back and mirrored; a folded table's fitting re-decided on
unfold; the Study and Read sets kept apart across a reload; the warm palette's tokens resolving on the
live page with `color-scheme: light`; and no page overflow at 1440 or 430.

## The stylesheet's own housekeeping (1.10.1)

The question was "how could we improve the css?", and the honest answer was that almost nothing left to
improve was in how the page looked — it was in what the sheet was carrying, plus two faults only a
stylesheet audit finds. So this pass is dead weight out, one real fix in each of the two places the
sheet had drifted from its own rules, and one new tool so that the heaviest of the maintenance work
stops being a comment asking a human to be careful.

**The dark palette, declared twice, is now checked rather than promised.** The
`prefers-color-scheme` block and the explicit-choice block hold the same 28 tokens and must stay
identical; the warm block must restate all 28 or a warm reader gets dark scrollbars and a dark
checkbox tick. Both were true and hand-verified twice — but a verification that lives in one session
is not a property of the file. `mdview-dev/check-css.js` now asserts them, and `build.sh` runs it
before syncing anything, so a drift stops the build instead of shipping a half-palette that only
shows up on one of the three ways into dark. It checks six things: braces balance; the two dark
blocks declare the same tokens with the same values; every dark token is declared by the light
`:root` and restated by warm; each dark block sets `color-scheme: dark` and warm sets `light`; every
custom property the sheet declares is consumed by something (the sheet itself, the popup, the three
scripts — `--quote` is the case: the reader page never uses it and `popup.html` does); and every
`var(--x)` reference resolves to a declaration or to one of the two tokens mdview.js sets at runtime
(`--sx`, `--def-term-w`). Proven by mutation — four sabotaged copies in a tmpdir, one dark value
changed, one warm token deleted, one `var(--muted)` misspelled, one closing brace removed — and each
fails with the drift named (`dark: --bg is "#0f1217" under the system and "#0f1216" when chosen`).
The shipped file reports: dark declared twice and identical (28 tokens), warm restates all of them,
62 tokens all consumed, braces 303/303.

**The keyboard had no ring on the three newest controls.** The sheet has a focus vocabulary — 2px
`--accent`, offset of 1 or 2px — on links, summaries, the bar buttons, the outline links, the
endplate button and the resume pill. The fold caret and the copy button, added in the last two
passes, lit only their own opacity when focused, and the back-to-top pill had no focus rule at all.
All three now carry the same ring (offset 1px inside a heading or a card, 2px on the fixed pill).
Verified in the harness that the three rules parse and target exactly those controls in the live
CSSOM; the other half — a keyboard user sees them — cannot be measured there, because this harness
cannot synthesize keyboard focus, so that half is the browser's spec behaviour rather than a
measurement.

**The phone step was written below the number that owns it.** `@media (max-width: 640px)` set
`.mdview { font-size: 15.5px }` — a size the tokens had already decided, re-decided on the page. Two
things fell out of that: the serif face's size correction (×1.02) never applied below 640px — the
face stepped up above the breakpoint and not below it — and every control sized off `--ui-size`
stayed at the desktop base beside 15.5px text. The block now sets `--type-base: 15.5px` on `:root`:
one number, and the page and everything that hangs off it follow. Measured at 430: page 15.5px in
sans; **15.81px with 26.24px leading in serif** (15.5 / 25.73 before — leading and code were never
blocked, the size was); corner pill 29.4px (was 30.4); fold target 20.8px (was 21.5 — the target and
the text it sits beside now move together); no page overflow. At 1440 nothing moved: fold target
24.1×24.1, the 1.10.0 measurement.

**Dead weight, and two rules saying the same thing twice.** Around twenty fallback literals came out
of the fixed chrome (`var(--card, #fff)`, `var(--float-shadow, …)`, and friends). They could only
ever fire if the same sheet had failed to declare its own tokens — and they were a second, stale
palette: the `--float-shadow` fallback still carried the pre-1.9.1 single-shadow value, and
`--card, #fff` would paint a white card for a warm-paper reader. The four that can genuinely be
absent stay: `--sx` and `--def-term-w` (set by mdview.js), `--appbar-h` (unset below the bar) and
`--callout-edge` (falls back to the accent). Verified nothing moved with the literals gone: the
totop's border `rgb(227, 230, 234)`, its shadow, colour and fill, the progress line's
`rgb(3, 105, 161)` and the body's `rgb(247, 248, 250)` all compute to their tokens. The duplicates
were a second `text-wrap: balance` block on h1–h4 (the h1–h6 block already sets it) and a
`.mdview td { border-bottom }` restating the shared `th, td` rule. The empty `print` banner promised
a section the file keeps at its *end* — where it has to be, to beat the page surface, the fixed bar
and the folds — and the block now says so instead of leaving a signpost with no room behind it.
Reduced motion stopped everything inside `.mdview` and missed the three fixed controls outside it;
print now asks for `orphans/widows: 2` on paragraphs. One comment was still talking about "the dots"
the 1.10.0 pass had replaced with a rule.

**Checked and deliberately left.** `light-dark()` would collapse the two dark blocks into one
declaration — the one structural change that would remove this file's central duplication — but it is
unparseable before Firefox 120 / Chrome 123, and an unsupported custom property computes to nothing,
so on an old ESR the page would paint a white background in dark mode, not a slightly different
shade. Guarding it with `@supports` means maintaining both systems at once; the build-time check buys
the same safety without that risk. `@layer` has nothing to layer against — the page's only other
author CSS is the markdown's own allowlisted tags — and the cascade order that matters (the
pinned-column hover, the bar over its base rules, print over everything) is deliberate and commented
where it happens. Logical properties would be churn with no RTL or vertical-writing requirement. And
a duplicate-declaration scan over the sheet found nothing dead beyond what is fixed here: every
other repeated selector is a documented override in a media query, a state, or print.

Verdict: `npm test` 672 / 51 / 0 (the renderer is untouched), `web-ext lint` 0 errors / 0 notices /
15 warnings, both manifests 1.10.1, the new css check green and mutation-tested, the Chrome copy
byte-identical and the xpi matching source.

## The mark on the section you just landed in (1.10.2)

The brief was a screenshot and a question — "how would u make this look better?" — of
`deepseek_markdown_20261001_167a32.md`, a 19-section glossary. Read as a design critique it had one
answer, and it was the loudest thing in the picture: the pale blue slab over `Command Prompts`.

**It was the landing mark, and every part of it was wrong.** That wash is the "you arrived here"
highlight — `:target` on the heading — and in the reader's own capture it filled the heading's line,
stole the left margin, and did it with a 0.35em halo (`box-shadow: 0 0 0 0.35em`) that turned a
25-character heading into a full-measure band. Three things followed from the styling, and one from
using `:target` at all:

* it turned the heading's own hairline **off** (`border-bottom-color: transparent`) for as long as
the mark was up — so the one section the reader is looking at is the one section that stops looking
like a section;
* the halo pushed the heading's left edge ~6px left of every other heading (the band started at x=33
while the text column starts at 48 in the screenshot), so the landed heading read as *indented*
against its siblings rather than first in a column;
* a full-measure fill is a table row's vocabulary: it says "this row is selected", not "this is where
you are";
* and it never went away. `:target` is a *location*, so the mark stayed up while the reader read on,
ending up pointing at a section they had already left — while the outline in the margin was already
saying where they were, in the reader's own colour, with `aria-current` on the row.

Last, `:target` cannot do this job on a page a script builds. The browser resolves the fragment while
the document loads, before `decorate()` has made a single heading; Firefox re-evaluates and catches
up, which is why the band appears in the screenshots at all, but **Chromium matches nothing** — so
in the Chrome copy of the extension a link into a section had no mark whatsoever. Reproduced here:
with `#maintain` in the URL, `document.querySelector(':target')` is `null` after the render, in both
the load and the jump case.

**The fix is a landing, not a location.** `land(fragment)` (mdview.js) puts an `.is-landed` class on
the element the fragment names — on load and on every `hashchange`, which covers the outline links
and the citation jumps — and takes it off on the same clock that ends the fade. The style is a wash
plus a 3px accent bar drawn *outside* the box (`box-shadow: -3px 0 0`), so nothing moves when it
arrives; the heading keeps its hairline; there is no halo. `mdview-land` holds the wash for the first
45% of 2.6s and then fades it to transparent, and where the reader asked for less motion there is no
animation at all — the wash is simply there, and then simply gone, because a fade is motion and a
highlight is not. Headings and the citation notes share the one rule now; the note keeps its `--muted`
text, so nothing has to change colour on arrival and change back when the mark fades.

Verified in the harness. The jump path: `location.hash = '#provide'` marked the right heading 33ms
later, `mdview-land 2600ms` running, start state `rgba(3, 105, 161, 0.08)` with a `rgb(3, 105, 161)`
bar, the heading's rule still `rgb(227, 230, 234)`, end state transparent, the heading's box
byte-identical before and after (no reflow), and the class gone by 2.8s. The load path, with the mark
temporarily set to 20s so it could not fade before the tool call arrived: `#maintain` marked
`Maintain`, with `:target` false — the Chromium gap, visible. And a citation landing with the same
rule: `#fn-1` washed and barred, its text still `--muted`.

**Seen, and left for now.** The screenshot is a good page with one flaw; the other candidates it
suggested are taste, not repair, and each would be a pass of its own: the *section rhythm* (a
one-word term heading and three short bullets repeat 19 times, at 29px between sections and 15px
from the term to its first line — a glossary shape could tighten the first and open the second); the
*fold caret* (19 faint triangles, one per heading, which could become a rail in the left margin at
desktop widths, doubling as collapse-all); the *measure* (at an 18px browser default the 74rem cap
puts ~115 characters on a line — the fluid default is deliberate, and the Width control already
offers the book column, but the cap is in `rem` and so does not track the type); and de-emphasising
the `Example:` lines that fill these entries, which is a new decoration pass rather than a style.

Verdict: `npm test` 672 / 51 / 0 (unchanged), `web-ext lint` 0 errors / 0 notices / 15 warnings, both
manifests 1.10.2, css check green (dark declared twice and identical, braces 307/307), Chrome copy
byte-identical, xpi rebuilt.

## An illustration is not a definition (1.11.0)

The 1.10.2 section above ends by naming four things its screenshot suggested and leaving all four for
later. The brief came back at the same file — "anything to polish so everything is appealing as it
could?" — and of the four, one was not taste at all. Three were questions about typography (the section
rhythm, the caret, the measure); the fourth was an information problem wearing typography's clothes.

**The problem.** In this glossary the definition of a term and an illustration of it are set in exactly
the same ink. `Provide` is three bullets: *To supply or make available. / A component provides a
service, API, feature, or functionality. / Example: A service provides file-sharing capabilities.* Two
of those answer the question the heading asks and one does not, and the reader cannot tell which two
without reading all three. It is not a stray case either — 7 of this file's 93 list items are examples,
and each of the three `Meaning` cells in its table ends with one, so the third column reads
*definition, definition, illustration* with the boundary only in the writing. Across the 127 `.md`
files in this home directory, 33 lines open with an example signpost and 17 more carry one after a
sentence boundary: a glossary, a spec sheet and a textbook chapter all write this way.

**The pass.** `markExamples` (mdview.js) finds the two shapes the signpost makes, and both are the
*writer* doing the marking — no guessing at what an example is:

* a list item that opens with it (`Example:`, `Examples:`, `For example:`, any case), which is one
  line that answers with an instance; and
* a paragraph or table cell that ends with one — `… system components. Examples: altering logs,
  patching binaries.` — where the run after the signpost is split out into a span and the rest of the
  cell keeps its ink.

The guards are what keep this from swallowing prose, and each one is a counterexample rather than a
length limit. The signpost has to open the item or begin a sentence, so **`See Examples: below.` is a
cross-reference** and **`There are many examples: some of them are listed here.` is a mention** — both
untouched. The run after it has to be the tail of the block and a single clause, so **`Examples:
alpha, beta. This trait is required.`** stays in ink, because an example followed by another sentence
is prose that contains an example, not an illustration. A run of 200 characters or more is left alone
for the same reason. All four were checked against the regexes directly.

**The style is one step, and only on the text.** The illustration takes the muted ink the notes are
already set in (`--muted`), and nothing else moves: not the marker, not the size, not the leading —
those are what the list *is*, and shifting any of them would make the line look broken rather than
quiet. An item that is only the signpost and then a list is a third case, and it is the opposite one:
the signpost steps back, because it is a signpost, and **the list under it keeps the ink** (`li.eg >
:is(ul, ol) { color: var(--ink) }`), because those cases are what the entry is for.

Verified on `deepseek_markdown_20261001_167a32.md` at 1440: **10 marks** — 3 spans in the table's
`Meaning` cells and 7 list items — at `rgb(90, 100, 114)`; in dark `rgb(154, 165, 180)` and in warm
`rgb(107, 97, 81)`, so the step survives all three palettes. That is **5.65:1 against the page** in
light (6.0:1 on the card the table sits in), 7.52:1 in dark and 5.04:1 in warm, against the
definition's 15.41 / 15.27 / 12.72 — the illustration reads at about a third of the ink of the thing
it illustrates. Under the `Examples:` signpost in *Control, Regulate, or Direct* the nested list is
back at `rgb(27, 32, 39)`, and the section above it is unchanged. **And nothing reflows:** unwrapping
the three spans in the live page and normalising the cells leaves the cells at 70px, the table card
at 255 / 1041 and the document at 3978px — identical, which is what a colour-only rule should do.

**Seen, and deliberately left.** The qualifier lines that fill the rest of this document — `In
Windows:`, `Types:`, `Mechanisms:`, `In security,` — keep their ink. They sit in the same position as
an example and would be the obvious thing to sweep up with it, but they are not illustrations: they
enumerate the term's own kinds and conditions, which is the content the heading is asking for. A rule
that demoted them too would be demoting the answer. The three other candidates from the 1.10.2
screenshot (section rhythm, caret, measure) are still there, still taste.

The kitchen sink gained the three shapes (a whole-item example, a signpost that opens a list, and an
inline tail) so `npm run dev` shows the pass without needing this glossary.

Verdict: `npm test` 672 / 51 / 0 (the renderer is untouched), `web-ext lint` 0 errors / 0 notices /
15 warnings, both manifests 1.11.0, css check green (braces 309/309), Chrome copy byte-identical, xpi
1,047,536 bytes matching source.

## The card under the word (1.12.0)

Double-click a word, get its definition in a card anchored to that word. The gesture is Google's; the
answer is not.

### What leaves the machine, and why that is the trade

The word the reader double-clicked, to a dictionary, and nothing else. Not the file it came from, not
the file's name, not the rest of the selection, not an id, not a cookie — there is nothing to
correlate, because nothing is stored beyond the definition the reader already has on screen. It is
still a word leaving the machine, which is why it is a deliberate double-click rather than a hover,
why the card names its source in the header, why the toolbar can turn the whole thing off, and why
`data_collection_permissions` moved from a bare `required: ["none"]` to
`required: ["none"], optional: ["technicalAndInteraction"]`. The required half is still true — the
add-on collects nothing on its own account — and the optional half is the honest admission that a
feature now exists which can transmit something at the reader's request. `web-ext lint` accepts the
combination (0 errors), which is the only machine that gets a vote on it.

Two host permissions are new: `https://api.dictionaryapi.dev/*` and `https://api.datamuse.com/*`,
in `permissions` (MV2) and `host_permissions` (MV3).

### Two providers, raced

The rich one (phonetics, parts of speech, usage examples) is the reason this is worth doing, and it
is one person's free service: it returned Cloudflare **521** on all four attempts while this was
built. The thin one is Princeton's Datamuse — one-line definitions, no phonetics, never observed down,
and it echoes `access-control-allow-origin: null`, which is exactly what a `file://` page needs.
Whichever answers first is the card, and the header says which one it was. The rich provider is held
back 350ms rather than started second, so when it *is* up it wins by head start and no card ever
waits on it.

**The race resolves on the first answer, not the first failure.** That is the whole bug this shape is
written against: the rich provider fails in a fifth of a second, and a race that settles there never
lets the held-back provider — which has not started yet — say that it knows the word. The card said
"No definition here for that" for `security` until that was fixed. A miss is only a miss once every
provider has finished.

### Why the fetch goes through the background script

A content script's `fetch` is the *page's* fetch: subject to the page's CSP and to whatever CORS
headers the dictionary happens to send, on an origin that is opaque for `file://`. The 521 responses
carry no `Access-Control-Allow-Origin` at all, which is what turns an outage into a CORS error rather
than a "no entry". From `refresh.js` the request carries the add-on's host permissions and neither
applies. The message may only name a URL on the two declared dictionary hosts — the card renders
whatever comes back, and "a URL that came from the page" is not a thing worth building on when the
answer is two hostnames. A direct fetch remains as the fallback, which is also the only route
available in the preview harness.

### The reader's own files, last

What a dictionary has no entry for is not a rare word — it is an acronym, a proper noun or a phrase.
Those are exactly the words a reader of their own notes has written down. So the last place asked is
their own files: this document first, from four shapes already understood by the renderer (a heading
that is just a term defined by what follows it, `dt`/`dd`, `**Term** rest`, and mdview's own
`.def-term`/`.def-desc`), then the neighbours. Verified: AUDIT.md indexes **171** terms, and
selecting the heading `Visible in ordinary documents` returns "Definitions from your own files".

Two traps in that index, both found by testing. The heading text arrives with the anchor link and the
fold control inside it — `addFolds` has already run — so a glossary term indexed as
`Memory Management#▾` can never be matched by anything the reader selects; the index clones the
heading and strips `.anchor`/`.fold` first. And the neighbour scan reads a *directory listing* over
`file://`, which Firefox answers and Chrome generally does not: capped at 8 files, once per document,
entirely optional, and it degrades to the search link rather than failing.

### The card

Anchored to the word, below it by default and above it when the window has no room, clamped to the
viewport, with `--def-notch` carrying the word's centre to the notch. The notch is two stacked
border-triangles, not one rotated square: a square's own edges paint *over* the card's fill, so its
bottom half shows and the notch reads as a diamond sitting on top of the card. The inner triangle
reaches one pixel past the card's edge so it also covers the card's own hairline.

Collapsed it is Google's shape exactly: source line, pronounce button, one definition with no
part-of-speech label, a full-width "See all definitions", and a small italic link at bottom right.
Expanded, the senses are labelled and the list is capped at `min(50vh, 24rem)` and scrolls — a card
taller than the window is a card whose last sense is unreachable. The card lives outside `.mdview`,
so the spec suite never sees it, and it is in the `@media print` block with the rest of the fixed
chrome.

### Selecting the definition

`mousedown` is prevented on the controls only — a control must not take focus or collapse the
selection of the word behind the card — and **not** on the body. Blocking it over the whole card was
what stopped the reader selecting the definition text, which is the one piece of text on the page
they may reasonably want to copy. Verified: the headword and the definition are both selectable,
`user-select: auto`, a press on a control is `defaultPrevented`, a press on the body is not, and the
card does not close. `::selection` is declared for the card as well, since `.mdview ::selection` does
not reach outside `.mdview` and the selection would otherwise come out in the browser's default blue.

### Colour

The card is drawn entirely from the document's own tokens, so it follows Light/Dark/Warm with no
extra work: `--card` `#ffffff` / `rgb(21,26,32)` / `rgb(251,246,236)`, with the notch inner edge
matching `--card` on all three. Measured contrast: definition text 16.37 / 14.22 / 14.24; header 6.0
/ 7.01 / 5.64; "Search the web" 6.0 / 7.01 / 5.64. That last one was **3.03 / 4.18 / 3.10** in
`--faint` until it was moved to `--muted` — the one control in the card that is neither decoration
nor an echo of a definition, so it is held to the same 4.5:1 floor as the definition. The `×` stays
at `--faint` to match `.mdview-resume-x` and clears the 3:1 non-text floor on all three palettes.

### What it refuses

A word with no box of its own, or one scrolled out of the window, gets no card at all rather than one
left with no position. One letter is not a definition. `pre`, `code`, `kbd`, `samp`, the outline, the
masthead, the end plate, folds, anchors and copy buttons are all chrome, not the document — checked
directly against the predicate: refused for code fences, inline code, masthead, fold, anchor, copy
button and end plate; accepted only for real body prose.

### The switch

The toolbar panel carries "Double-click a word to define it", because the new host permissions are
granted once and are otherwise irrevocable. Absent means on, so an add-on whose panel has never been
opened behaves exactly as shipped. The panel and the page share `mdview:define`, and their
`localStorage` fallbacks now JSON on the way in and parse on the way out — they did not agree before,
so the switch silently never took and every page read it as on.

### Verdict

`npm test` 672 / 51 / 0 (the renderer is untouched), `web-ext lint` 0 errors / 0 notices / 15
warnings — byte-identical to the 1.9-era backup, so no regression — `check-css` green (braces
345/345), both manifests 1.12.0, Chrome copy byte-identical, xpi 1,061,354 bytes matching source.

**Not verified:** the neighbour scan. The preview harness cannot list a directory (it 404s on one), so
the `file://` directory-listing step has not been exercised end to end. Everything up to it — the
current-document index, all 171 terms — is. The whole path is inside `try`/`catch`, capped, and
degrades to the search link, so the worst case is that it does nothing.

## The word inside the word (1.12.1)

> **Superseded by 1.14.0.** This section describes the stack of cards 1.12.1 shipped: a
> second panel opened on top of the first, each with its own notch. That was withdrawn — see
> "One panel, not a stack (1.14.0)". What follows is kept as the record of why it was built,
> because the reason it was built (keeping the first word visible while the second is read) turned
> out to be the reason it was clutter.

A definition is prose, and prose hides words. The reader who cannot say what *struggle* means may
well not be able to say what *effort* means inside the definition of it, and 1.12.0 answered that
question with nothing at all: the card refused every press inside itself. So the card now asks the
same question of its own text that the page asks of the document.

### A stack of cards, not a card that replaces itself

The first instinct — one card, push its state, swap the text — is wrong, and visibly so. It throws
away the thing the reader was holding: which word the new definition belongs to. Google's nested
card keeps the first card on screen with its word still highlighted, and the new one hangs off the
inner word. That is what this does too.

`DEFINE_STACK` holds the cards oldest-first. Each card owns its own state (`card.st`: word, anchor
range, senses, phonetic, source, page, open time) rather than the module owning one card's worth of
variables, because two open cards cannot both be reading the same `defineWord`. Everything that used
to take no argument now takes the card: `placeDefine(card)`, `paint(card)`, `defineSay(card)`,
`googleUrl(word)`.

Only the card **on top** can be answered further. A word read in an older card means the reader has
changed their mind about the ones in between, so `openDefine` drops everything above the parent
first: the stack is a path, not a history. The reader can go as deep as the dictionary goes — three
levels verified — and every notch still lands on its own word.

### One arrow, and nothing else

`‹` at the left of the child's header, in the same `--faint` as the `×` opposite it (light
`rgb(139,149,163)`, dark `rgb(113,125,140)`, warm `rgb(151,139,122)` — identical to the `×` in each
palette, so the 3.03 / 4.18 / 3.10 non-text floor measured for 1.12.0 holds for it by construction).
A real `<button>`, so `:focus-visible` and Tab reach it; `aria-label` and `title` both read
"Back to *struggle*", which is the one piece of breadcrumb the design allows itself — for a screen
reader, not for the eye. It shipped at 15×20px because that was the `×`'s size too; 1.14.0 grew
both hit areas (see "One panel, not a stack"), and the glyphs did not change.

No crumb trail, no tab strip, no "1 / 3", no hover-up stack. The arrow is the whole of it, which is
what was asked for and happens to be the right amount: a reader two definitions deep wants a door
out of the second card, not a map.

The other exits keep their 1.12.0 meanings: **Escape**, a **press anywhere outside all the cards**,
and the **`×`** dismiss the whole question, however deep. The arrow alone closes one level — and it
closes it by removing the child from the DOM, so the parent returns with its own text, its own
scroll position and its own highlight exactly as it was left, with **zero fetches** (asserted: a
`window.fetch` counter stood at 0 across the click).

### Anchoring a card to a word inside a card

The same `placeDefine` does it unchanged — it already worked in viewport coordinates, and a word in
a card is in viewport coordinates too. Verified, for `literal > without > failing`:

| card  | anchor centre | notch | gap under the word |
| ----- | ------------- | ----- | ------------------ |
| literal  | 248 | 188px | 23px |
| without  | 344 | 188px | 23px |
| failing  | 319 | 188px | 23px |

Two extra rules matter for a word inside a card:

* **The parent's list of senses scrolls, so it clips.** `defineClip` returns the parent's body box
  and `placeDefine` treats a word outside it as off-screen. Scrolling the first card's senses to the
  bottom dropped the child and kept the parent — a notch pointing at a line that has scrolled out
  from under the card is a notch pointing at nothing. Scrolling the parent's body also *moves* the
  child (`restack` is wired to the body's own `scroll`), so the notch tracks the word until it goes.
* **A repaint orphans the anchor.** `paint` rebuilds the body from scratch, and a range over a node
  that is no longer there has no box at all — the notch would go stale or the card would vanish.
  `reanchor(card)` finds each child's word again in the text that replaced it (`findWordRange`,
  whole words only: `effort` inside `ineffort` is part of a different word) and drops the child, with
  its own descendants, if the word is gone. Proven by forcing a parent repaint with a child open:
  the anchor node changed identity, the old one was detached (`isConnected === false`), the new one
  was connected, inside the new body, and the notch still landed on the word. With senses replaced
  by text that no longer contained the word, the child went and the parent stayed.

`restack` walks the stack in order and truncates from the first card it cannot place, which is what
makes "the parent left the screen" take its descendants with it — the children point into words
that were inside it.

### What it refuses

* The card's **furniture**: the header, the source line, the pill, the "Search the web" link and the
  speaker button. Only `.mdview-define-term` and `.mdview-define-body` are readable text, so a
  double-click on the header opens nothing (asserted).
* A word in a **sense the reader cannot see**: senses 2+ are `display: none` on the collapsed card,
  so the range has no box and the card is refused rather than shown. This also caught a case I did
  not anticipate — re-anchoring onto a word that survived the repaint but landed in a hidden sense.
* The **same word again** in the card it is already open on: no duplicate card.
* A press on the **parent** while the child is open: the outside-press guard now tests every card in
  the stack, so reaching for a word in the first card's text does not dismiss the two on top of it.
* A card that has **already gone**, when the reader changed their mind quickly enough that the
  `mouseup` arrives after the `mousedown` that closed it.

The 1.12.0 rule that `mousedown` is prevented on controls **only** survives: the child's definition
text is still selectable (`user-select: auto`, press not `defaultPrevented`), a press on the new
arrow is.

### Verdict

`npm test` 672 / 51 / 0 (the renderer is untouched), `check-css` green (dark declared twice and
identical across 28 tokens, warm restates all of them, 62 tokens all consumed, braces 347/347),
`node --check` clean, both manifests 1.12.1, Chrome copy byte-identical, xpi rebuilt and verified
against source.

**Not verified:** screenshots. The preview host stopped compositing (`no frames`) and did not recover
on reload, resize or navigation, so the visual confirmation of the arrow is the computed style and
the geometry above — the header child order (`back`, `src`, `x`), the glyph, the colour in all three
palettes, the measured 15×20 box, and the child's top-left hit test landing on the child's own arrow
over the parent's — rather than a picture of it. Also still unverified from 1.12.0: the Free
Dictionary provider's `parse()` path (the service is still 521, so Datamuse remains the live one)
and the neighbour-file scan, which the harness cannot exercise.

## The sense you actually wanted (1.13.0)

"Some word, we get the definition we need upright (is this smart or random?)." It was random, for
three separate reasons, all of which are now measured rather than argued.

### Reason one: the request asked for one definition

The Datamuse request was `?sp=<word>&md=d&max=1`. `max=1` returns one word form with its definitions,
so for many words the card had nothing to choose from. `struck` returned **"A surname."** — that was
the entire answer, shown as *the* definition. `tampering` returned one sense; `granularity` two.

The obvious fix — raise `max` — is a trap, and a quick look shows why: `sp=struck&max=6` returns
`struck`, **stuck**, **truck**, **strick**, **struct**, **streck** in that order. Definitions of
`truck` under the word `struck` are not a shorter list, they are a wrong one. `max=1` was right.

### Reason two: a word in a document is often a *form*, and dictionaries index words

`struck` is the past participle of *strike*, and the entry for it is a surname. So when an answer
arrives that cannot be about anything the reader is reading — a name gloss, or a grammar label like
"Past tense of strike." — the base form is asked instead, and **the card names it**: the headword row
reads `struck` in `of strike` (`--faint`, 0.8em). Measured: `struck` went from "A surname." to
**"To have a sharp or sudden physical effect, as of a blow."**, with verb and noun pointers and 71
senses behind the pill.

The base form comes from ~90 irregular forms (`struck→strike`, `swum→swim`, `written→write`,
`clung→cling`, …) plus the regular rules, including the doubled consonant (`running→run`,
`stopped→stop`) and `-ies→y`. It costs a second request, and only when the first answer was
unusable. A wrong guess is harmless by construction: the lemma is only used when the direct answer
was a name or a label.

### Reason three: nothing looked at the sentence the word was in

The card is anchored to a live range, so the sentence around the word is already in hand — and the
senses were being shown in whatever order Datamuse chose. `orderSenses` now scores each sense:

| signal | points |
| ------ | ------ |
| the part of speech the word is playing in that sentence | +40 / −10 |
| the sense names a field the sentence is about | +34 |
| the sense names a field the sentence says nothing about | −8 |
| a gloss that is only a name | −70 |
| a grammar label ("Past tense of …") | −55 |
| `obsolete`, `archaic`, `slang`, `proscribed`, `literary`, … | −45 |
| over 150 characters, or three clauses | −8 / −6 |

Ties break on the provider's own order, so a word nobody has an opinion about is unchanged.
`guessPos` is deliberately timid — a determiner, an intensifier or an auxiliary before the word, or
`-ly` on it — and every cue it does not recognise leaves the guess empty, because an empty guess
costs nothing while a wrong one would.

Fields are matched by the marker's own words (`financ` finds "financial") and by a keyword table
(`computing` knows `server`, `cache`, `html`, `pixel`), because the reader's sentence will not
contain the word "computing".

**Measured on real sentences from AUDIT.md**, same answers, before and after:

| word | the sentence it was read in | before | after |
| ---- | -------------------------- | ------ | ----- |
| canonical | "…renders every corpus example… and diffs canonical **html**" | "According to recognised or orthodox rules." | **"(mathematics, computing) In canonical form."** |
| palette | "One meaning per **colour**: the palette as a language" | "(painting) A thin board on which a painter lays and mixes colours." | **"A set of colours available to be used (or mixed)."** |
| opacity | "Copy buttons… Quiet at 45% **opacity**" | "…not allowing light to pass through." | unchanged, and correct for CSS |
| disclosure | "The panel renders through the same stylesheet…" | "The act of revealing something." | unchanged, and correct |

Two of four moved, both for the better, and the two that were already right stayed put. That is the
honest result: ranking fixes the cases with evidence and refuses to touch the ones without.

**A bug this measurement caught, which reasoning had not:** the context always contains the word
being looked up, so a sense whose field was named after the word matched *itself* — `(painting)`
won for *palette* in a document about colour, every time, because "palette" was in the sentence. The
word is now removed from its own context before matching (`ctx.text.split(w).join(" ")`). Left in, the
field rule would have rewarded exactly the definitions it was meant to demote.

### Pointers to the parts of speech

Grouping the senses by part of speech was already asked for and is now also a row of pointers above
the senses: one press per part of speech the answer actually has, in ranked order. Pressing one shows
that part's meanings; pressing it again clears it, so the row is its own way back and there is no
"show all" control to hunt for. `aria-pressed` marks the one in force; the row is `role="group"`
labelled "Parts of speech"; it is hidden entirely when the word has a single part of speech, because
one pointer is not a pointer row.

Verified on `struck` (of strike): pointers `verb`, `noun`; default shows the ranked verb sense;
pressing **noun** switches the card to "A work stoppage (or otherwise concerted stoppage of an
activity)…"; pressing it again returns to the ranked default.

### A list that ends

`strike` has 71 senses, and a scrollable column of 71 definitions is the same exhaustion the card
exists to end. The expanded card lists at most 20, grouped with headings that are written only when a
sense is actually going to sit under them (a group the cap never reaches leaves no bare label), and
then says what it left out — "51 more senses" — with the web link below it for the rest. A chosen
part of speech is filtered first, so the count is of what the reader asked for.

### What this did not do

No "remember this sense" control. It was built and removed: ranking is the card's job, and a control
that asks the reader to be the ranker is the same exhaustion wearing a different hat. Nothing is
remembered between sessions, nothing new is stored, and no new permission or host was added.

### Verdict

`npm test` 672 / 51 / 0 (the renderer is untouched), `check-css` green (dark declared twice and
identical across 28 tokens, warm restates all of them, 62 tokens all consumed, braces 352/352),
`node --check` clean, `web-ext lint` 0 errors / 0 notices / 15 warnings, both manifests 1.13.0,
Chrome copy byte-identical, xpi rebuilt and verified against source. 1.12.1's nested card still works
with everything above in place: `struck > sudden`, the arrow reading "Back to struck", the notch
exactly on the inner word, no pointers on a single-part-of-speech word, and the arrow returning to
the parent.

**Not verified:** screenshots, for the reason given in 1.12.1 — the preview host stopped compositing
and did not recover. The ranking is verified by measurement rather than by eye, which is the stronger
evidence anyway; the pointer row's *appearance* is inferred from its computed styles. Also still
unverified from 1.12.0: the Free Dictionary provider's `parse()` path (still 521) and the
neighbour-file scan.

## One panel, not a stack (1.14.0)

"The retreating arrow encapsulated the meaning that it goes to the previous search word, so we only
had a panel, not multiple."

That is what the arrow said from the start, and 1.12.1 built a stack of cards instead: a second
panel opened on top of the first, each with its own notch pointing at its own word, the parent
left on screen underneath. It worked, every part of it was verified, and it was still wrong — two
overlapping panels on a reading page is noise, and the reader has to work out which one they are
reading. The arrow only means "the word before this one" if there is one panel changing what it is
about.

### What it is now

One panel in the document, always. `DEFINE_FRAMES` is a stack of **frames** — plain objects holding
the word, its anchor, its senses, its chosen part of speech, whether its list is open — and
`defineCard` is the single element they are painted into. The panel's anchor is always the word the
reader double-clicked **in the page**, so drilling into a definition does not move the panel at all:
the reader's own word stays lit underneath it, and the notch stays on it. That is the one thing
1.12.1's design was trying to preserve, and it comes for free once there is one panel.

Verified: `struck` (of *strike*) → double-click "sudden" → **still one panel in the DOM**, headword
`sudden`, notch and position unchanged (`188px`, `samePosition: true`), arrow present and reading
**"Back to struck"**. Pressing it returns to `struck` with its senses exactly as they were and
**0 fetches**; at depth 1 the arrow is `hidden`. `sudden` also happens to have three parts of speech
and got three pointers, so the 1.13.0 navigation rides on the same panel.

The exits keep their meanings and all close the whole conversation: Escape, a press elsewhere, the
`×`, and scrolling the word out from under the panel. A press *inside* the panel does not close it,
and the definition body is still selectable (`user-select: auto`, press not `defaultPrevented`) while
control presses still are — 1.12.0's rule survived the rewrite.

### Both header controls got bigger

"The retreating arrow is not ergonomical, make it longer." It was 15×20px — measured, documented,
and accepted on the grounds that it matched the `×` beside it. Matching is a reason for two glyphs
to look alike; it is not a reason for a control to be hard to hit. The arrow's *glyph* is unchanged
(`‹`, `--faint`, same weight); what grew is the box you press, to **34×29**, and the `×` went to
**29×29** rather than leaving one control twice as easy to miss as the one beside it. Both clear
WCAG 2.5.8's 24×24 floor for a pointer target, and both keep the hairline look at rest because the
background only appears on hover.

### `hidden` needs to be stated where the layout is

The arrow got its `display: inline-flex` when it grew, and that silently defeated it: an author
`display` beats the user-agent stylesheet's `[hidden] { display: none }`, so the arrow stayed in the
header of every *first* card — 34 invisible pixels pushing the source line 38px right of the column
it belongs to. Caught by measuring the source line's left edge against the card's padding edge
(535 where it should have been 497), not by looking.

The same trap was already holding two more elements, both invisible-but-laid-out: the pointer row
(`display: flex`, so a word with one part of speech had an empty ~8px strip under it) and the pill
(`display: block`, so **"See all definitions" had been offered for every single-sense word since
1.12.0**). One rule fixes all three where the layout is declared:

```css
.mdview-define-back[hidden],
.mdview-define-jump[hidden],
.mdview-define-all[hidden] { display: none; }
```

Verified by forcing both states in the live page: hidden → `none` for all three, un-hidden → `block`
/ `flex`. The `of strike` note has no author `display` and was never affected (`none` / `block`).

### What it cost to simplify

Three whole mechanisms are gone, and they existed only because two panels needed to coexist:

* **`defineClip`** — a word inside another panel needed the parent's scrolling body as a clip, so a
  notch could not point at a line that had scrolled out from under the panel.
* **`reanchor`** and **`findWordRange`** — a repaint replaced the text a child's notch pointed into,
  so every parent repaint had to find each child's word again in the new text nodes and drop the
  child (with its own descendants) when the word was gone.
* **`dropDefineFrom`** — DOM teardown for an arbitrary suffix of the stack.

With one panel and one anchor, none of that has anything to do: the anchor is a live range in the
document, which is exactly what 1.12.0 had before nesting existed. The frame stack still matters —
it is what makes going back free — but it holds data, not elements.

The one thing lost is deliberate: the reader can no longer see the parent definition while reading
the child. The arrow is named ("Back to *struck*"), the panel is under the word they double-clicked,
and nothing about where they are has to be inferred.

### Verdict

`npm test` 672 / 51 / 0 (the renderer is untouched), `check-css` green, `node --check` clean,
`web-ext lint` 0 errors / 0 notices / 15 warnings, both manifests 1.14.0, Chrome copy
byte-identical, xpi rebuilt and verified against source. A `grep` for the removed stack
(`DEFINE_STACK`, `topDefine`, `dropDefineFrom`, `reanchor`, `findWordRange`, `defineClip`, `restack`,
`card.st`) finds nothing.

**Still not verified:** screenshots — the preview host stopped compositing and has not recovered
since 1.12.1, so the single panel's appearance is inferred from computed styles and geometry (one
element, unchanged position, arrow `hidden` toggled by depth) rather than seen. Also unchanged from
1.12.0: the Free Dictionary provider's `parse()` path (still 521) and the neighbour-file scan.

## The category once, not on every line (1.14.1)

*On the expanded list, "verb, verb, verb."*

The expanded list already grouped its senses by part of speech and wrote a heading over each
group — and then also stamped the part of speech onto every single sense inside it, in the same
accent, the same size, in the same uppercase. So a word with six verb senses and three noun
senses read:

    VERB                                  ← the group heading
      VERB  To have a sharp or sudden physical effect, as of a blow.
      VERB  To hit.
      VERB  To deliver a quick blow or thrust.
    VERB
      VERB  To manufacture, as by stamping.
      VERB  To sound by percussion, with blows.
    NOUN
      NOUN  A work stoppage.

Eleven words of category label for nine definitions, and every one of them was information the
line above it had already given. On a long word — *strike* has 71 senses — that is the
difference between scanning a list and reading it, which is the whole reason the list is grouped
in the first place.

The fix is to say it once, in the place where it can govern more than one line. A sense no longer
says its own part of speech; the heading does.

**What that removed:** the `mdview-define-pos` element and its CSS rule, which after the change
were unreachable — every sense in the expanded list sits under a heading for its own group, and
the collapsed card never labelled its one sense. `grep` for the class across both sources returns
nothing. One fewer DOM node per sense, and one fewer rule in a stylesheet that already has 350.

**Two decisions inside it.** A group the 20-sense cap never reaches still gets no heading,
because a label pointing at nothing is worse than no label — so the heading is written lazily, on
the first sense that actually appears under it. And a pointer that has narrowed the list to one
part of speech now *does* get a heading, where before it deliberately did not: filtering to
"noun" and seeing eight lines each stamped NOUN was the same noise in a smaller box, and the
heading is what tells the reader which part of speech they are looking at. Eight senses under one
heading also saves eight hairlines' worth of scanning.

Measured in the harness, `labels: 0` everywhere:

| word | groups written | senses | per-sense labels |
|---|---|---|---|
| *struck* (of *strike*), expanded | `verb` | 20 + "51 more senses" | 0 |
| *struck*, pointer **noun** | `noun` | 20 | 0 |
| *example* | `noun`, `verb` | 7 | 0 |
| *rendering* (single part of speech) | `noun` | 4 | 0 |
| *instrument*, drilled into from a definition | `noun`, `verb` | 12 | 0 |

Nesting, the back arrow and the single panel are unchanged by this: one `.mdview-define` in the
DOM through all of it, `Back to struck` still on the drill, the parent's filter still pressed when
the arrow returned to it.

### Verdict

`npm test` 672 / 51 / 0, `check-css` green (28 dark tokens twice, 62 consumed, braces 353/353),
`node --check` clean, `web-ext lint` 0 errors / 0 notices / 15 warnings, both manifests 1.14.1,
Chrome copy byte-identical, xpi rebuilt and verified against source.

**Still not verified:** screenshots — the preview host still has not composited since 1.12.1, so
this is evidenced by DOM counts and computed styles, not seen. Unchanged from 1.12.0: the Free
Dictionary provider's `parse()` path (the service is still 521, and its CORS failure is in the
console of every lookup), and the neighbour-file scan.

## The verb and its particle (1.15.0)

*"Phrases like 'ended up' — the dictionary doesn't get them."*

It doesn't, and it is worth being exact about why. Asked for **ended up** the provider returns
`{"word":"ended up","score":289080}` — the word is indexed, and it carries **no definitions at
all**. The meanings hang off the lemma: **end up** answers *"To come to a final place, condition,
or situation, sometimes unplanned or unexpected; to turn out."*, which is exactly the sentence
the reader is sitting in. Before this, double-clicking `ended` in "the build ended up taking three
hours" gave you the definition of *end*, and there was no honest way to get the other one.

**Where the phrase comes from.** Only the sentence knows the particle is there, so the candidates
are read off the text beside the word — the live range, not the paragraph, because the same word
can appear twice in a block with different particles after it. The head is lemmatised, then up to
two particles are read off in a row, **longest chain first**:

| the reader clicked | sentence | asked | card shows |
|---|---|---|---|
| `ended` | the build **ended up** taking three hours | `end up` | "to turn out" |
| `comes` | she **comes up with** an idea every morning | `come up with` | "to manage to produce by inventing" |
| `gave` | the kernel **gave in** to pressure | `give in` | "to relent, yield, surrender" |
| `turned` | they **turned down** the offer | `turn down` | "to refuse, decline, or deny" |
| `taken` | the team was **taken apart** by the merger | `take apart` | "to dismantle into component pieces" |
| `ended up` (dragged) | as above | `end up` | "to turn out" |

Longest first because `came up with` and `come up` are different verbs and the text is what says
which one it is. Two particles is the ceiling: `put the box up on the shelf with tape` is a
sentence, not a verb.

**The cost is one request, and only sometimes.** A word with no particle beside it builds no
candidates and is asked exactly once, as before; when a phrase answers, the bare word is never
asked at all. Measured on every probe: a phrase hit is two fetches (both providers), the same as a
plain word — `give in words`, `turn down words`, `take apart words`.

**A particle is never the head**, which is what keeps this from hijacking ordinary words. `back`,
`over`, `in`, `out`, `order` after `in`, `charge` after `in` — all four verified to ask the plain
word and nothing else. Only a particle *after* the word builds a candidate; the word before it is
not evidence about the word the reader clicked.

**The ranking stands down for a phrase.** `orderSenses` exists because a word has dozens of senses
and the sentence is the only evidence about which one. A phrase is not in that position — the
reader named the verb. Re-ranking actively made it worse: the sense of *end up* that says "to turn
out" scored below "to bring to a conclusion" for being a long sentence. Measured across five
phrases, the provider's own order is right five times and the one it loses (*work out* asked in
"we worked out the answer") was a sense no ranking here could have found anyway. So a phrase is
deduplicated but not reordered, and `finish()` says why in three lines.

### Two bugs this exposed, both older than the feature

The phrase path leans on `baseForm`, and testing it found that the lemmatiser had been quietly
wrong for a long time:

* **The doubled-consonant rule could never match.** It read `/^(.+?)([bdfglmnprt])\1(?:ing|ed)$/`
  — `\1` is the *stem*, not the consonant, so the backreference asked the word to repeat itself
  from the beginning and never did. Every regular verb with a doubled consonant therefore fell
  through to the generic `-ed` rule: **stopped → "stopp"**, **running → "runn"**, which no
  dictionary files. One character: `\2`.
* **`-ies` went to `-ie`.** `studies → "studie"`, `carries → "carrie"`, `flies → "flie"`. A stem in
  `-y` is now handled before the `-s` rule; the few `-ie` stems (`movies → "movy"`) miss, and the
  card falls back to the plain word.
* **Thirty irregular forms were missing**, `gave` and `went` and `took` among them — and a missing
  lemma means the phrase built is `gave in`, which is the bug this section is about. The table now
  carries 125. Forms that are words in their own right (`found`, `lay`, `lit`, `ground`, `smelt`)
  are left out on purpose: a wrong lemma is worse than none.

The lemmatiser was then checked, form by form, against 54 words — the ones that changed, the ones
that did not, and the ones that must stay empty — with every one correct except `box`, where the
expectation was wrong rather than the code (`baseForm("box")` should be `""`). **This check is not
in the suite**: `npm test` scores rendered markdown and has no unit tests for JavaScript helpers, so
the lemmatiser is verified by hand, not by `npm test`.

**A silent substitution the card can no longer hide.** When a provider answers a *different* word
than the one asked, the card now says so — asked for `gave`, the entry that comes back is `give`.
The two provider `page()` functions were also encoding their word, so a phrase's "Definitions from"
link was a URL with a raw space in it. **Limitation, measured:** Datamuse echoes the query word
back (`{"word":"gave"}`), so when *it* substitutes the lemma the card cannot see it and shows one
word's head over another word's meanings. Detecting that would cost a second request on every
inflected verb, which is not a trade worth making; when the provider names the word it answered,
the card names it too.

### Verdict

`npm test` 672 / 51 / 0, `check-css` green (28 dark tokens twice, 62 consumed, braces 353/353),
`node --check` clean, `web-ext lint` 0 errors / 15 warnings, both manifests 1.15.0, Chrome copy
byte-identical, xpi rebuilt and verified against source.

**Still not verified:** screenshots — the preview host has not composited since 1.12.1. The
phrase mechanism is evidenced by the requests actually issued and the senses actually returned
(both logged), not by a picture. Unchanged: the Free Dictionary `parse()` path (the service is
still 521, and its CORS failure is in the console of every lookup, phrase or not) and the
neighbour-file scan.

## Nine small things that were wrong (1.16.0)

A pass over the chrome for things a reader would notice and could not easily say. No new
features and no new controls: every item either fixes a measured defect or makes something that
was already there easier to hit or easier to read.

**Two of them were real bugs, both found by measuring rather than by looking.**

1. **The panel drew itself over the app bar.** `placeDefine` clamped to the *window's* edges
   (`DEFINE_EDGE`, 12px), but on a window 1024px and wider the masthead is a fixed 48px bar.
   At 1440×420 the card clamped to y=12 and painted straight over the toolbar, notch and all —
   the fixed bar is z-index 15 and the card is 40, so the card wins. The clamp is now measured
   against the bar when the bar is actually fixed (`DEFINE_BAR_AIR`, 8px of air): the same word
   at the same size now lands at y=56, clear of the bar's 48. The bar is measured rather than
   inferred from a breakpoint because `--appbar-clear` is declared *inside* the media query that
   makes the bar fixed, so reading the token would be reading it from a place that does not
   exist on a narrow window.
2. **The hidden corner pills were still in the tab order.** `.mdview-totop` and `.mdview-resume`
   are switched off with `opacity: 0; pointer-events: none` — neither of which removes an
   element from being focusable. Tabbing along a page landed on an invisible "Back to top" and
   an invisible "Not now": both announced themselves, neither could be aimed at. `visibility:
   hidden` now carries the state, transitioned with a 0.18s delay on the way out and none on the
   way in so the arrival still fades. Verified: `focus()` succeeds while `.show` is on the class
   and does nothing when it is not.

**The rest are polish with a measurement attached.**

3. **The card's sense list kept the platform scrollbar.** Measured 15px of it — a quarter of the
   collapsed card's width, with the window's own colours. The card lives outside `.mdview`, so
   the rule that thins code blocks, diagrams and tables never reached it. It carries the same
   `scrollbar-width` / `scrollbar-color` now, and so does the margin outline, which had the same
   gap for the same reason.
4. **A list of twenty senses threw away where you were in it.** Every repaint does
   `body.textContent = ""`, which resets the offset — so a reader who had scrolled down to
   compare the fourth and fifth senses and then pressed a pointer to narrow the list was thrown
   back to the top. The offset is read before the list is emptied and written back after, except
   when the panel has changed word, where the old offset belongs to a different answer. Measured:
   scrolled to 139, pressed a pointer, list of 20 → 4 senses, offset 96.7 — the clamp of the
   restored value, not a reset to 0.
5. **The pointer row was not a target.** `verb` and `noun` measured 36×19 and 39×19: the
   navigation the card exists to offer, at 10.8px type, smaller than the close button beside it.
   Now `max(1.75em, 24px)` tall and inline-flex centred — the `max()` matters, because `1.75em`
   on its own scaled with `--ui-size` and measured 22px on a desktop window but 19px on a narrow
   one at default type, which is the same shrinking the change was meant to stop. 24px now on
   both (42×24 at 384px wide, 46×24 at 1440px). The glyphs stay small because they are furniture
   next to a 1.45em headword. The pressed one is also 600 weight now, which is a second channel
   besides colour for "this is the filter you are under".
6. **The two header controls were two different sizes.** 34×29 and 25×25, side by side in one
   row, told apart by glyph. Same box now, and like the pointer row it keeps a 24px floor rather
   than tracking the reader's type size down (30×25 at 384px wide, 35×29 at 1440px).
7. **"See all definitions" was the loudest thing in the card after the headword** — a
   full-width bordered button offering more of a list, outranking the definition itself. It is a
   quiet full-width row now (full width kept, so the target is still the whole line), and it
   says how many: `See all 6 definitions`. The list stops at `DEFINE_LIST_MAX`, so a word with
   forty senses shows twenty, and the only other place that number appeared was the tail under
   the twentieth.
8. **"of *give*" was set at 0.8em in `--faint`.** That is the card telling the reader which word
   it is actually answering — information, not furniture — at 3.0:1 on light paper and 4.2:1 on
   dark. Now 0.88em in `--muted` (6.4:1 and 7.1:1).
9. **Back-to-top waited for 900px.** A screen's worth on the window it was written on, a screen
   and a half with the panel open, four screens on a tall one — so the control that exists to
   save a long scroll was itself waiting for a long scroll. Now `window.innerHeight * 0.9`.

Smaller still: the header's source line ellipsises instead of wrapping (a source line that wraps
pushes the panel taller, and the panel's height is what decides whether the word still fits
under it); a long headword wraps inside the card rather than widening it; "Looking up…" is set
in the card's fine print instead of the definition's size, so a glance can tell "still looking"
from "this is the answer"; the panel takes focus on open with `preventScroll` and is named
`Definition of <word>` rather than `Definition` (it does **not** trap Tab — a keyboard reader
walks out into the page and the panel is still there); and the enlarged-image overlay finally has
a way out that is not the backdrop. `mdview-zoom-x` is `--float-h` square in the corner the
corner pills use, and it closes even inside the 300ms the double-click guard holds the backdrop
for — a press on a button that says "Close" is not the second click of the pair that opened it,
which is a bug the first version of this button had.

### Verdict

`npm test` 672 / 51 / 0, `check-css` green (28 dark tokens twice, 62 consumed, braces 357/357),
`node --check` clean, `web-ext lint` 0 errors / 0 notices / 15 warnings, both manifests 1.16.0,
Chrome copy byte-identical, xpi rebuilt and the new code confirmed *inside* the extracted xpi.

**Still not verified:** screenshots — the preview host has not composited since 1.12.1, so every
claim above is a computed style, a measured box or a DOM count rather than a picture.

## A box you could see but not press (1.17.0)

Widening the lens off the definition card to the rest of the page. Three changes, and the first
one is the only functional change mdview has made to the reading surface in a long while.

### 1. The task-list checkbox was an affordance that lied

`- [ ]` rendered as a 13px square with a border, an accent fill when set, a hover transition on
its border and a `:checked` rule that strikes the line through — and `disabled` underneath all of
it. Measured: `disabled: true`, and a `.click()` left `checked` unchanged. Every signal said
control; the thing was inert. In a note-keeping reader the unchecked box is the one item in the
document that is genuinely the reader's rather than the author's, and it was the one thing they
could not touch.

It answers now. The rules it follows are the ones the rest of this codebase already follows:

* **The file is never written.** A `- [x]` in the markdown is a fact about the document and stays
  exactly as it is — still disabled, still 1em, still quiet. Only the open boxes answer.
* **The tick is the reader's state**, keyed per URL (`mdview:ticks:<href>`, mirrors the fold and
  reading records) and mirrored to `localStorage` so it is there on the next load. Verified:
  ticked in one session, `{"1":1}` in storage, restored on reload with both lines struck.
* **It is a target.** 1.18em (~16px, up from 13), `cursor: pointer`, `touch-action: manipulation`
  so a tap is not delayed, plus a ring on hover and one on `:focus-visible` — a keyboard reader
  can now reach a box that was not in the tab order at all.
* **The document's own box renders exactly as it always did** — 13×13, `cursor: default`, full
  ink. An earlier draft of this dimmed it to 0.75 opacity to mark it as not-pressable, which was
  quietly changing how the *document* reads in a reader for documents someone has to study. The
  size difference carries the distinction on its own; nothing else about an author's `- [x]` is
  touched.

Wiring it in caught a bug that was not part of the job. The header's word count is read from
`doc.textContent`, and by the time a tick handler re-counts, the endplate has been appended to
that document — so ticking one box moved the header from "1,769 words · ≈ 8 min read" to
"2,315 · ≈ 11 min". The reading time jumped three minutes because the reader pressed a checkbox.
The size of the document is a fact about the markdown and is now measured once (`STATS_BASE`),
which also settles a discrepancy that had been there all along: the header and the endplate used
to quote different word counts for the same file, because each was measured at a different moment
in the chrome being added. Both now say 1,729.

### 2. "56 more senses" was a wall, not a warning

The list stops at `DEFINE_LIST_MAX`, and the tail under it told the reader the truth about that —
"1 more sense", "56 more senses" — as `<p>` text with nothing attached to it. The card said there
were more and then offered no way to any of them. It is a button now: full width, quiet until
pressed, reading "56 more senses — show all", with a `↓` after the count. The reader's answer is
kept on the frame as `st.limit`, so it survives a repaint and a better answer arriving later is
shown whole rather than re-capped.

Verified on *line*, which Datamuse answers with 76 senses: 20 shown, tail present, pressed →
76 shown, tail gone. Filtering to one part of speech and back again returns all 76 with no tail —
the choice is not lost because the reader looked at something else.

### 3. The outline lost the reader's own position

The margin outline is a sticky column with a `max-height`, so on a document with more headings than
fit — the long ones, which is most of the reason to want an outline — the row marked as current
was routinely scrolled out of the outline's own box. The outline was tracking the section and
showing it to nobody. Measured on the 23-heading fixture at 1440×520 (outline box 442px,
content 589px): reading section 14 left the outline at `scrollTop` 0 with the current row off the
bottom; it now moves to 68 and the row is inside the box.

Three things it deliberately does not do. It moves the outline's own `scrollTop` by hand rather
than with `scrollIntoView`, which would also scroll the page — the reader did not ask to move
while reading. It does nothing when the current row is already visible, so a reader who has
scrolled the outline themselves to look ahead is not yanked back (verified: `movedBy: 0`). And it
does nothing when nothing is marked, which is the top of the document before the first heading.

### Also measured, and left alone

Worth recording because each looked like a defect and was not. Footnote citations measure 9×14,
which looked far too small — but the small box is the `<sup>`, and the `<a>` inside it is
`tabIndex: 0` with `href` and an `aria-label`, so the citation is perfectly reachable; only the
visual could be argued with. A 280-character inline `code` token does not widen the page:
`overflow-wrap: break-word` on `.mdview` already handles it (`docScrollX: false`). And the panel
correctly shows no focus ring for a mouse user — `matches(':focus-visible')` is `false` after a
double-click, while a keyboard reader still gets one.

### Verdict

`npm test` 672 / 51 / 0, `check-css` green (28 dark tokens twice, 62 consumed, braces 363/363),
`node --check` clean, `web-ext lint` 0 errors / 0 notices / 15 warnings, both manifests 1.17.0,
Chrome copy byte-identical, xpi rebuilt and the new code confirmed *inside* the extracted xpi.

**Still not verified:** screenshots — the preview host has not composited since 1.12.1, so the box
and cursor work above is evidenced by measured geometry, computed styles and DOM state, not by a
picture. The tick persistence was verified across two loads of the same URL; it has not been
verified through the add-on's own `storage` area on a `file://` page, where `localStorage` may be
unavailable and the mirror is the fallback rather than the source.

## Studying a file and being told nothing (1.18.0)

The study mode — the same folding used as retrieval practice, where the headings become the
questions — had never been looked at. Two things are wrong with it, and both are the same shape of
problem as the "56 more senses" wall fixed in 1.17.0: state the reader accumulates, with nothing
on screen that reports it or clears it.

### 1. The one piece of chrome that is always there said nothing

Entering study mode folds the document down to a list of questions. On the fixture that is 71
blocks hidden and 18 headings as questions, and once you are working through them the **only**
record of how far you had got was on the endplate — 2,731px down a document that runs past 10,000.
Measured: opened three sections, scrolled position unchanged, and the header said "Study".

The header button is already the control that *is* the mode, so the count goes there rather than
into anything new: `Study · 3/18`, with the title carrying the same fact in words and the `aria-label`
matching it. Nothing is added to the page; a label that said one word now says two.

The number has to come from somewhere, and that turned out to be the interesting part. `FOLD.o` is
keyed by heading id and `READ_HEADS` — the list the outline and the reading record are built from —
is a list of `{el, id, min}` **records**, not of ids. A `Set` of the records never matches a string,
so the count sat at `0/18` while every section was demonstrably open. Caught by measuring the label
against the carets rather than by reading the code.

### 2. "Read again" could not start a study session over

The endplate's reset is the only button in the document meaning "start this over". It cleared the
reading place and left the fold record intact, so a finished set of questions could only be reset by
toggling out of study mode and back — which is not a thing anybody would think to try. It clears
the fold record now, in both modes, and says which one it is: `Read again` /
"Clear this document's place", or `Study again` / "Close every section again".

Two things had to be built for that, both small:

* **`FOLD_LISTENERS`** — the endplate is built before the fold record has loaded, so guessing its
  wording at build time meant it would say "Read again" on a file that is in study mode. It subscribes
  to the fold `paint()` instead and sees the mirror first and the store's answer when it lands.
* **`FOLD_PAINT`** — clearing the record is not the same as showing the cleared record. The first
  version emptied `FOLD.o`, saved it, and left the three open sections on screen still open with a
  label still reading `3/18`: right on the next reload, wrong right then. The endplate now reaches
  the fold paint and the page agrees immediately.

Verified in study mode: three opened → `Study · 3/18`; press `Study again` → `Study · 0/18`, zero
carets expanded, 70 blocks hidden again, still in study mode, storage cleared. In reading mode the
same button now also re-opens folded sections — 15 folded → all 18 expanded.

### Verdict

`npm test` 672 / 51 / 0, `check-css` green (28 dark tokens twice, 62 consumed, braces 363/363),
`node --check` clean, `web-ext lint` 0 errors / 0 notices / 15 warnings, both manifests 1.18.0,
Chrome copy byte-identical, xpi rebuilt and the new code confirmed *inside* the extracted xpi.

**Still not verified:** screenshots — the preview host has not composited since 1.12.1, so the
label and the reset above are evidenced by DOM and storage state rather than by a picture.

**Still not exercised, and worth saying plainly:** the fixture has no overflowing code block and no
callout, so the wide-code and callout styling remain unmeasured here; both were built in earlier
versions and neither was touched in this one.

## A label that was a filing note in the middle of the sentence (1.19.0)

Datamuse writes a sense label in front of a definition — `(slang, mildly vulgar)`,
`(gambling, dice games)`, `(typography, of typefaces)` — and `cleanDef` already strips the
grammar notes out of it (`uncountable`, `transitive`), so what reaches the card is the field
and register, inline, as the first clause of the sentence. On *crap* that is eleven senses of
which four consecutive noun senses each open with the same label, because WordNet's notes come
in clusters rather than one at a time.

### What was wrong about the way it was shown

Three attempts, each corrected by looking at it:

1. **Its own line, `--muted`, behind a `--line-strong` bar** — too small to find. Measured at
   0.86em of a 12.71px body, 10.93px of grey on white.
2. **A full-width `--accenttint` band with an accent bar** — findable at last, and a blue slab in
   a card that is otherwise ink on white with one accent for the part-of-speech heading. A card
   reading as a box from another product.
3. **`--muted` again, no band** — the complaint this time was about colour: `--muted` is this
   card's *supporting* ink (the source line, the examples, `of base form`), and a field label is
   not supporting text, it is a scope marker. Grey made it read as furniture greyed out.

What is there now: the label is the heading's colour exactly (`--accent`), 400 weight, sentence
case, on its own line. Two ranks of the same ink is a hierarchy; two ranks of different inks are
two unrelated things. Contrast is the heading's, since it is the heading's ink — 5.93:1 light,
7.83:1 dark, 5.12:1 warm.

### The run, and why a run is honest

A label is printed once for a run of senses rather than once per sense, keyed on the *set* of
terms sorted and lowercased, because the provider writes the same label both ways: *crap* returns
`(slang, mildly vulgar)` and `(mildly vulgar, slang)` in one answer. The run is printed with the
label it was first given, so the list never says the same thing two ways in a row. The run is
reset by an unlabelled sense and at each part-of-speech heading — a label only ever governs the
senses printed under it.

### The thing the label complaint was really about

The senses were hard to tell apart, and the rule between them was doing almost none of the work:
`--rule` is `rgba(15,23,42,0.06)`, 1.06:1 against the card. The sense separator and the
part-of-speech heading now use `--line-strong` — 1.53:1 light, 1.75:1 dark, which is a table
border and about the weight a reader is looking for. Senses also take a hanging indent
(`padding-left: 0.85rem; text-indent: -0.85rem`) so continuation lines land under the first word
instead of back at the margin.

`DEFINE_TAG` and `defineTag` split the label off at render time only. The stored record is
untouched, so every definition already in the cache — 50 words, 76 KB on the machine this was
measured on — is read correctly by the new card with no migration.

### Measured

`bold` at 360px: 7 labels over 16 senses, no definition text starting with a stray `(`, label
colour equal to heading colour, every run-opening label carrying a rule and every label directly
under a heading carrying none (two hairlines with a label between them would be a rendering
fault). At a 420px viewport no label wraps and none overflows the body. Filtering to one part of
speech rebuilds the list and the runs regroup. Both schemes checked.

**Not verified:** screenshots — the preview host has not composited since 1.12.1, so all of the
above is computed styles, geometry and DOM order, not pictures. The Free Dictionary provider's
`parse()` path still never runs (521 on every call), so the label splitting is exercised against
Datamuse's `defs` strings only.

## Six definitions and nothing to tell them apart (1.20.0)

The complaint after 1.19.0 was that the senses are "supposedly distinct definitions, that are
visually almost indistinguishable". The data explains why no amount of labelling could have
fixed it.

### The words the label work cannot help

`mercy`, from Datamuse, all ten senses:

```
n  (uncountable)  Forgiveness or compassion, especially toward those less fortunate.
n  (uncountable)  Relenting; forbearance to cause or allow harm to another.
n  (uncountable)  A tendency toward forgiveness, pity, or compassion.
n  (countable)    Instances of forbearance or forgiveness.
n  (countable)    A blessing; something to be thankful for.
v                 To show mercy; to pardon or treat leniently because of mercy
v                 To feel mercy
n  (uncountable)  A children's game in which two players stand opposite …
n                 A female given name from English.
n                 A surname from French.
```

Every parenthetical is a grammar note, and `cleanDef` strips all of them by design. So *mercy*
produces **zero** field labels and the reader gets six paragraphs of equal weight with a
hairline between them. Field labels are not a structure that always exists; they turn up for
some entries and not others, and the words a reader is most likely to look up are not
necessarily the ones that carry them.

And there is nothing to merge. WordNet files forgiveness, the tendency toward it and an
instance of it as three separate synsets, so senses 1, 3 and 4 read alike and *are* distinct —
which is the whole design question: the card has to make three genuinely different meanings
feel different when they share five words.

### What the list is now

An ordered list. Each sense gets a number in a gutter and the definition hangs off it, and the
hairline between senses is **gone**. Six definitions with a rule above the last five is six
horizontal lines asking to be read as a table; a numbered list with air between the items says
the same thing with none of the ink. Rules remain where they mark a change of *kind* — a
part-of-speech heading, and a field label that starts a new run — so `mercy` now has two rules
and `crap` has its heading and its field labels, instead of one rule per sense.

The number is `--faint` (3.03:1 light, 4.18:1 dark, the floor this card already sets for its own
furniture) and the first sense of the card is the only one in accent ink: "start here", without
making anything else quieter than it has to be. The numbers are `aria-hidden`, because the count
they produce is already spoken by the disclosure below the list ("See all 11 definitions") and a
screen reader should not be made to hear "one", "two" before every sentence. Numbering restarts
per part of speech, as dictionaries do.

### Three things measurement caught

1. **The hanging indent was still on the row.** `.mdview-define-sense` carries
   `padding-left: 0.85rem; text-indent: -0.85rem` for the collapsed card's single sense; on a
   flex row that does the opposite of its job — the first line was pulled back to x=47 and
   every wrapped line sat at x=61, 14px of drift, in a card whose entire purpose here is a left
   edge the eye can follow. The row now zeroes both and the gutter *is* the indent.
2. **The gap was 11.2px, not the 9.6px intended.** 0.7rem against a 16px root. Now 0.6rem.
3. **Both parts of speech' first sense went accent**, because the highlight was keyed on `n === 1`
   and the counter restarts per group — the reader was told where to start twice. It is now a
   flag set once for the whole list.

### Measured

`mercy`: 10 senses numbered 1–8 (noun) and 1–2 (verb), every wrapped line at x=47, gaps a uniform
9.6px, exactly one accent number, two rules left in the card, all numbers `aria-hidden`.
`crap`: 11 senses with 7 field labels, the run of four `(slang, mildly vulgar)` senses still one
label, numbering and labels interleaving correctly. `struck` at the 20-sense cap: the gutter holds
13px from 1 through 20 — no jump at two digits, because `min-width: 1.2em` governs — and the tail
still reads "51 more senses — show all". At a 400px viewport: no drift, no overflow. Dark scheme
checked.

**Not verified:** screenshots, for the eleventh time — the preview host has not composited since
1.12.1, so all of this is computed styles, geometry and DOM order. Free Dictionary's `parse()`
path still never runs, so only Datamuse's `defs` strings have been exercised.

### 1.20.1 — the word after the wrap

The collapsed card's single definition still carried `padding-left: 0.85rem; text-indent:
-0.85rem` from before the number rail existed. In a list that hanging indent is how the eye
learns which lines belong to the same item; with one definition there is no list, so the first
line sat at the card's edge and every line after it sat 0.85rem further in. It was visible on
*tier* — "A row or range, especially one at a higher or lower / **level** than another." — where
the word after the wrap looked indented for no reason a reader could name.

The rule is gone and the collapsed sense is a paragraph with `margin: 0`, which is all it ever
was. Measured on that exact card: four lines, all starting at x=26, flush with the card's
content edge. The expanded list is unaffected — its alignment comes from the rail, and it was
never reading this rule, which is why nothing in the test suite or the earlier measurements of
1.20.0 caught it: the two states were measured separately and only the list was measured.

`text-indent` now appears once in the whole stylesheet, at [mdview.css:810](mdview.css#L810), on
the references list — a real hanging indent in a real list, which is where it belongs.

## The voice was never chosen (1.20.2)

"The audio is bad" is a complaint about a *voice*, and the button that draws it never picked one.
The whole of the speech code was four lines:

```js
synth.cancel();
synth.speak(new SpeechSynthesisUtterance(((frame && frame.word) || "").replace(/\s+/g, " ")));
```

An utterance with nothing set on it is not a neutral request. `voice` is unset, which in
practice means *whatever voice the platform puts first* — as likely the worst engine on the
machine as the best. So the audio was a property of the operating system, not of mdview, and
mdview had no way to express an opinion about it. Three defects behind that:

**The voice list is not there when the page is.** `getVoices()` returns `[]` on a cold start in
Chrome and, on some Firefox builds, fills only when `voiceschanged` fires. The old code never
asked, so it could never have chosen even if it had tried. `sayVoices()` asks at the moment of
use, listens once for that event, and re-asks at 250 ms and 1500 ms.

**`cancel()` immediately followed by `speak()` loses the utterance in Firefox**, which empties
the queue after the new one has been added. 1.20.2 moved the speak a turn later; 1.20.3 found
out there was nothing to move, because the press already returns when anything is talking, so
there is nothing to cancel (below).

**The ranking compared languages that could never match.** `sayScore` lower-cases the voice's
`lang` (`en-us`) and compared it with `want` as the platform spells it (`en-US`), so the
exact-language bonus never fired once. Measured on an `en-US` machine: an `en-US` neural voice
scored −11 and an `en-GB` "Enhanced" voice scored −12, so the *wrong* dialect won. This is the
1.20.1 lesson again — a branch that reads correctly is not a branch that runs. Both sides are
normalised now; the neural voice wins at −14.

Ranking is by name, because the name is the only description the platform gives: `natural`,
`neural`, `premium`, `enhanced`, `google`, `microsoft` earn −8; `espeak`, `eloquence`,
`compact`, `pico`, `dispatcher`, `robot` lose 8. It can only demote, never exclude — a machine
with one voice installed still has to be able to say a word.

The button now also answers the press: it darkens, its waves become a stop square, `aria-label`
becomes "Stop", and the next press stops it. A word that is no longer on screen is stopped too
(closing the card, asking a new word), guarded by a run counter so a request still waiting on the
stored preference cannot speak over the one that replaced it.

And because no ranking can fix a machine with nothing to rank, the popup grew a voice picker
(`mdview:say`, read by `defineSay` and written by the panel). It appears only when there is a
choice — with one voice it says so instead, naming the voice and what a second engine is worth.

**Measured** (harness, `SpeechSynthesisUtterance` and `speechSynthesis` stubbed so the utterance's
properties are observable):

* this machine's real list, one voice `English (Great Britain)`: `text "mercy"`, `lang en-GB`
  (the voice's own), `rate 0.92`, `pitch 1`; button flips to the stop state synchronously with
  the press, before the storage read resolves. — **all three of those were undone in 1.20.3,
  at the reader's report that the audio came out worse than before this version shipped.**
* add `Google UK English Female` and the next press uses it; a stored `{voice}` wins outright; a
  stored name that is no longer installed falls back to automatic instead of to silence.
* second press while speaking: one cancel, no second utterance, button returns to idle. Closing
  the card mid-word: one cancel.
* cold start, list empty at the press and full a moment later: the first press still speaks with
  `lang` set and no voice, and the second uses the list.
* popup: 0 voices → row hidden, "no speech voices found"; 1 → row hidden and the voice named;
  2 (+1 duplicate name) → select with `Automatic` and two names, 127 px inside the 340 px panel,
  no overflow; a stored name that has gone resets the select to `Automatic`.
* dark scheme: idle `rgb(108,182,224)` on `rgb(21,26,32)`, speaking `rgb(228,232,238)` on
  `rgb(21,26,32)`.

**The honest limit.** This machine has one speech engine: `espeak-ng`, through speech-dispatcher,
with 675 English variants of it and no neural voice anywhere (`/usr/lib/speech-dispatcher-modules`
holds `sd_espeak-ng`, `sd_espeak-ng-mbrola`, `sd_openjtalk`, `sd_generic`, `sd_dummy`). Nothing in
an extension can make espeak-ng sound good, and the version cannot tell it apart from a good
voice anyway: Firefox reports it as the featureless `English (Great Britain)`. An earlier draft of
this fix demoted small-synthesis voices by name to a slower, lower delivery; the measurement above
showed that branch cannot fire on this machine, and inconsistent pacing across machines is worse
than one honest pace, so it was removed. What this version fixes is everything the extension does
control — the request it makes, the voice it picks from what exists, and the reader's ability to
override that — plus the panel now tells the truth when there is nothing to choose.

**Not verified:** the audio itself. No sound can be played or measured from this environment, so
the voice choice, the rate and the dialect are argued from the code and from the utterance's
properties — the reader's ears are the only verification that 0.92 is the right pace.

### 1.20.3 — take the opinion back out of it

"The audio is terrible, actually worse than when I asked u." The reader had 1.20.2 loaded, so
the regression is ours and there are exactly three things 1.20.2 added to the utterance:
`voice`, `lang` and `rate`. Only one of them is a choice the extension should ever be making.

* `rate: 0.92` — a judgement about legibility, made on a machine that is not the reader's.
  Slowing a synthetic voice down does not make it clearer; it makes the cadence more
  conspicuous, which on `espeak-ng` is the whole of what is wrong with it already.
* `lang: "en-GB"` — read off the voice's own tag. It is meant to be harmless, and it is the
  one most likely to be actively harmful: the engine's default is the variant its author tuned,
  and forcing a tag swaps it for one nobody chose. `espeak-ng`'s `en-gb` is the weakest English
  variant it ships, and forcing it onto a reader who heard the `en-US` default before is a
  downgrade dressed as a fix.
* `voice` — this one is ours to set, and stays.

So all three of `lang`, `rate` and `pitch` are now **left unset**, and the only properties the
utterance can carry are the voice (chosen, when there is a choice) and a pace the reader sets
in the panel. With one voice installed and nothing stored, the call is now identical to the
four-line one from 1.19 — which is the correct floor for a feature whose problem is that the
operating system is the one making the decisions.

The `cancel()`-then-`speak()` workaround went with it, and not because it was wrong: the press
already returns early when `synth.speaking || synth.pending`, so there was never anything to
cancel, and removing the `cancel()` removes the whole class of the Firefox race rather than
scheduling around it.

**Pace is now the reader's.** A `Voice default / Slower / Faster` select in the panel, stored
in the same record as the voice. It is written through one `writeSay()` that merges both fields,
because two independent writes to one key clobber each other — a bug that would only surface an
hour later, as a voice that had quietly gone back to automatic. A stored rate that is not one of
the three offered (hand-edited, or left by another version) reads as "no opinion".

**Two defects found while measuring this**, both in code added hours earlier:

* the pace options were appended without clearing the select first, so every repaint doubled
  them — and `paintSay` is called again whenever the voice list turns up late;
* that repaint was gated on there already being two voices to choose between, which is exactly
  the case where it is not needed. A panel opened on a cold browser said "no speech voices
  found" and never recovered, while the code beside it carried a comment saying that was the
  lie it existed to prevent.

**Measured:** with nothing stored, the utterance carries `text "mercy"`, the chosen voice, and
**no `lang`, no `rate` and no `pitch` at all** — each of the three absent from the stubbed
utterance object rather than set to a default — and exactly one `speak` per press. With
`{"rate": 0.7}` stored, `rate 0.7` and nothing else changes. In the panel: choosing a voice
then a pace yields `{"voice":"Google UK English Female","rate":0.7}`; clearing the pace keeps
the voice; clearing the voice leaves `{}`; the pace list holds three options after any number of
repaints; and a list that arrives after the panel opened replaces "no speech voices found" with
the picker on its own.

**Not verified:** the audio, again. The claim that this version is no worse than 1.19 is a claim
about the *request* being byte-identical, not a claim about what the voice does with it.

### 1.20.4 — a village in Northumberland, under the headword *emblem*

A screenshot of the card for **emblem** showed five senses about a place — "A village and civil
parish (served by Embleton and District Parish Council) in Cumberland district…", "A suburb of
Perth, Western Australia." — under the headword the reader had double-clicked, labelled
**"of emblem on"**.

The label is the whole of the diagnosis. `of` is set when the answer came from somewhere other
than the bare word, and it was set to the *phrase* `emblem on`: `phraseCandidates` had chained
the preposition that follows the noun, the phrase lookup ran, and something came back that the
lookup never checked.

It was **Embleton**. Measured, not guessed:

```
sp=emblem%20on&md=d&max=1  ->  {"word": "embleton", defs: [ …the five above… ]}
sp=emblem&md=d&max=1       ->  {"word": "emblem",  defs: [ "A representative symbol…" ]}
```

`sp=` on Datamuse is a spelling **search**, not an equality test, and "emblem on" matches
"embleton". The bare-word path already guarded against this — asked for "gave" it checks that
what came back really is "give" before printing `of give`. The phrase path did not, because there
is no honest label for a phrase substitution: "of emblem on" is not a form of "emblem", it is a
phrase that does not exist, and there was nothing to print that would make it one.

`defineAnswers(asked, word)` now decides it, and the phrase branch requires the answer to be the
phrase. Deliberately narrow — the bare word is untouched, so `gave` → `of give` still works.

**Measured** (harness, `fetch` stubbed with the two payloads captured from the live API, on a
fixture reading "the **emblem** on her coat"):

* after the guard: four requests, both providers for `emblem on` and then both for `emblem`;
  `of` **hidden**; first sense "A picture placed on the field of the escutcheon." (the heraldry
  sense, ranked first from the sentence about a coat); source still Datamuse. The phrase answer
  is rejected and the bare word answers.
* the same run without the guard was not taken — the broken behaviour is established by the
  reader's screenshot and by the code path, not by a measurement, and saying otherwise here
  would be dressing an inference up as a result. The payloads are the same two, so re-running it
  is a single click away whenever the harness grows a way to turn the guard off.
* still working, on a fixture reading "She **gave** the book away… he would **give** up…":
  `gave` → `of give` with *give*'s senses; `give up` → `of give up` with the phrasal senses.
  The guard rejects substitutions, it does not reject phrases.

**Known and not fixed:** `phraseCandidates` still offers a noun-plus-preposition as a phrase,
because it only knows that "on" is a particle and not that a noun does not take one. That costs
two wasted requests per lookup of such a word before the bare word answers. Tightening it means
teaching the candidate builder about parts of speech, which is a bigger change than a wrong
answer is worth; the guard is what makes the cost harmless.

### 1.20.5 — a stole is not a verb

Second wrong-word screenshot: the card for **stole**, read in *"It was our bad… Eh? What we
stole?"*, showed three definitions of the ecclesiastical garment — "A scarf-like garment, often
made of fur", "(botany) A stolon" — and the reader was looking at the past tense of *steal*.

This one is not the 1.20.4 bug and the guard from it cannot see it, because here the provider is
honest about the word: `sp=stole` answers `{"word": "stole"}`, exactly as asked. What it does
is answer the *homograph*: "stole" is also a noun, the index is keyed on the string, and
WordNet files no verb under that spelling at all — so the only entry for the exact spelling *is*
the garment. Measured:

```
sp=stole&md=d&max=1  ->  {"word":"stole", defs:[ "n A garment consisting of…", "n A scarf-like garment…", "n (botany) A stolon." ]}
sp=steal&md=d&max=1  ->  {"word":"steal", defs:[ "v To take illegally, or without the owner's permission…" ]}
```

**The sentence cannot arbitrate this, and that is the finding.** The obvious fix — score the two
entries against the words around the word and show the better one — cannot work here, because
nothing on this card matches a definition against prose. `senseScore` weighs part of speech
(+40/−10 against `ctx.pos`), a field marker against the document (+34), and length; it never
compares a single word. "What we stole" shares nothing with any sense of either entry, both
score zero, and the garment survives by default. Adding lexical overlap to the *ranking* would be
a much larger change with its own false positives, so the probe is built from the two facts that
are genuinely in hand instead:

* this code already knows the word has a **verb base form** — `DEFINE_IRREGULAR` carries
  `stole: "steal"` — so the word is a form, and dictionaries are indexed by words;
* **every sense that came back is a noun**, which is the shape of an answer about another word
  rather than a wrong ranking of the right one.

Two guards keep it from firing where the entry is right. A determiner or auxiliary before the
word (`ctx.pos === "noun"`) means the reader is reading a noun. And `defineTouches()` — a single
shared word of four letters or more between the sentence and any sense — is what "the stole was
trimmed with fur" has and "what we stole" does not.

It is a **probe, not a replacement**: the card shows what it has immediately, and corrects itself
if the base form answers. Nothing waits on a second round trip, and the answer is deliberately
**not cached under the reader's word** — the entry it replaces is a true answer to a true reading
of "stole", and the next reader may be that one.

**Measured** (harness, `fetch` stubbed with the payloads captured from the live API):

* *"It was our bad… Eh? What we **stole**?"* — four requests (`stole` to both providers, then
  `steal` to both), card head `stole` / **`of steal`**, first sense "To take illegally, or
  without the owner's permission…".
* *"The **stole** was trimmed with fur at the collar."* — **two** requests, `steal` never asked,
  `of` hidden, first sense "A scarf-like garment, often made of fur." The shared word is enough.

Two things found on the way, both caught by measurement rather than reading:

* the first attempt passed the probe's callback where `defineRemote`'s second argument is **not**
  "here is the answer" — it is "a *later, better* provider answered", and it only fires for a
  provider that did not answer first. The probe fired (the request went out) and did nothing. It
  takes the promise;
* a card served from `DEFINE_MEM` short-circuits before the probe, so a second lookup of the same
  word in one page never probes. Correct as written — the entry is cached and it is the same
  entry — but it is why the first measurement of this fix read "nothing happened" and had to be
  taken against a freshly loaded page.

**Known and not fixed:** `senseScore` still never looks at a word. A homograph whose senses do
share vocabulary with the sentence, and which is not an inflected form, is still answered with the
wrong word — *bow*, *arm*, *saw* — and the only thing that catches those is the provider
happening to file both meanings under the one spelling. Making the card read the sentence properly
is a much bigger piece of work than a probe, and it is the honest next version rather than a patch.

## Files

* `bin/mdview-ext/mdview.js` — rewritten renderer (1.4.3), plus the load/render/
  failure logging described above so a silent no-op is impossible.
* `bin/mdview-ext/mdview.css` — rewritten reading stylesheet (tokens, fluid type,
  wide-screen bleed, list/table/code/quote/raw-HTML styling, dark mode, print).
* `bin/mdview-ext/refresh.js` — reloads open `.md` tabs when the add-on loads, so
  the dev loop doesn't leave a stale render behind. Needs `tabs` to see those tabs at
  all (a background script needs no file grant for that); the fallback query keeps it
  working when the url filter can't see them, and it logs how many tabs it refreshed.
* `bin/mdview-ext/manifest.json`, `bin/mdview-ext-chrome/manifest.json` — 1.3 → 1.20.5
  (`tabs` added; Firefox keeps `file:///*`, and both gained `browser_action` / `action` for
  the popup).
* `bin/mdview-ext/popup.html`, `bin/mdview-ext/popup.js` — the toolbar panel (1.5.3):
  file-access state, the steps to grant it, and a button that re-renders the open `.md` tabs.
  Declared as `browser_action` in the Firefox manifest and `action` in the Chrome one.
* `bin/mdview-ext/mdview.xpi`, `bin/mdview.xpi` — repackaged build.
* `bin/mdview-dev/dev.sh` + `web-ext-config.cjs` — one command (`npm run dev`)
  launches Firefox with the extension in a throwaway profile and reloads it on
  every source change.
* `bin/mdview-dev/` — test corpus + runner, fixtures, preview page, static
  server, build script (which now runs the stylesheet check `check-css.js` first), and
  `backup-2026-09-29/` with the untouched 1.3 sources.
