# Building and testing

## The two suites

| Suite | Command | What it proves |
|---|---|---|
| The corpus | `node dev/test/run.js` | the renderer against the official CommonMark 0.31.2 corpus (652 examples) and 71 local fixtures |
| The interface | `python3 dev/test/ui.py` | the window, the folders, the tabs, and the page each kind of file opens in |

The corpus suite prints the score and the sections that do worst:

```
CommonMark corpus + fixtures: 672 passed, 51 failed (92.9%)
  deviations (documented): 51   unexpected: 0
```

`unexpected: 0` is the number that matters: the 51 failures are the
documented deviations, and a fifty-second would be a change to the
specification, not a surprise.

To see one section's differences:

```bash
node dev/test/run.js -v -s links
```

To score the corpus alone, without the local fixtures:

```bash
node dev/test/score-backup.js
```

The interface suite needs Playwright and a browser:

```bash
pip install playwright && playwright install chromium
python3 dev/test/ui.py          # the whole suite, about 36 s
python3 dev/test/ui.py -k tab   # only the tests whose name holds "tab"
```

It starts a **reader of its own**, on a port of its own, with folders of its
own, in a temporary directory that is removed afterwards (Q-7). It never reads
or writes the files the reader really shows. The two environment variables it
uses are:

| Variable | What it changes |
|---|---|
| `MDVIEW_PORT` | the port the reader listens on |
| `MDVIEW_ROOTS` | the file the folders are read from |
| `MDVIEW_APP` | where `server.py` is (the default is `~/mdview/reader`) |

## The checks

```bash
node dev/check-css.js       # the stylesheet's palette invariants
node dev/check-vendor.js    # the vendored assets' versions
```

The stylesheet check knows that the dark palette is declared twice — once for
a system in dark mode and once for the reader's own choice — and that the two
must be identical; that the warm palette restates every token the dark one
declares; and that no token is declared and not used. A drift stops the build
rather than shipping a half-palette that only shows up on one of the three
ways into dark.

The vendor check compares pdf.js, mermaid and KaTeX against the manifest, and
works offline.

## The package

```bash
bash dev/build.sh
```

It runs the two checks above, then writes `extension/mdview.xpi` and
copies it to `bin/mdview.xpi`. The package holds the extension's own files —
the background script, the definition tab, the card and its styles — and not
the reader's, which the reader serves from its own folder.

To install it into a Firefox profile:

```bash
bash dev/sideload.sh
```

It copies the package into the newest `*.default-esr` profile's `extensions`
folder. Firefox has to be told to allow the unsigned package
(`xpinstall.signatures.required = false` in `about:config`), and the add-on
has to be enabled in `about:addons`.

## The diagrams

```bash
bash reader/docs/model/render.sh
```

It renders the PlantUML sources into `reader/docs/model/img/` — the
vector under `svg/` (which is what the documents link to) and the raster under
`png/`, both mirroring the sources' own shape, `general/` and
`per-story/US-nn/` — and fails if any of them does not render.

## The documents

```bash
bash ~/.config/opencode/skills/analysis-architecture/scripts/check-docs.sh reader/docs
```

Five checks: the links point at files that exist, the rule numbers are
unique, the traceability matrix is complete, every catalogue entry has a
description, and every identifier the prose cites is defined somewhere.

## The whole gate, in order

```bash
node dev/test/run.js
node dev/check-css.js
node dev/check-vendor.js
python3 dev/test/ui.py
bash reader/docs/model/render.sh
bash dev/build.sh
```

The first three are the build's own gates and run inside `build.sh`. The
interface suite is run before a change that touches the window — it needs a
browser and a second reader — and the diagram render before a change that
touches a diagram or the rules it cites.
