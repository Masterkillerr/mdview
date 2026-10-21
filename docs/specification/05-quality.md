# 05 — Quality

The gates, the measurements and the definition of done. The rules here are
numbered `Q-` and are cited by the
[backlog](../analysis/backlog.md) and by the
[operations](../operations/).

## 1. The rules

| Rule | Statement |
|---|---|
| **Rule Q-1** | A unit test may not depend on the wall clock, the network, the browser or the disk. |
| **Rule Q-2** | The golden vectors are the official corpus, never written by hand. |
| **Rule Q-3** | A change to the reader's interface changes the interface suite in the same commit. |
| **Rule Q-4** | A feature that cannot be measured does not ship; if it cannot be measured, the measurement is written down as a target. |
| **Rule Q-5** | The renderer's score is measured against the corpus, and the examples it fails are documented one by one. |
| **Rule Q-6** | A change to the reader's routes changes the route table in the interface specification. |
| **Rule Q-7** | The interface suite drives a reader of its own, on a port of its own, with folders of its own, and never touches the files the reader really shows. |
| **Rule Q-8** | The measurement method is written down with the number, so that it can be reproduced. |

## 2. The test plan

### The levels

| Level | What it covers | Where it runs | Must be |
|---|---|---|---|
| Corpus | the markdown renderer against the official CommonMark 0.31.2 corpus (652 examples) and 71 local fixtures for the GFM extensions and the safety rules | `node dev/test/run.js` | byte-for-byte the canonical HTML, except for the documented deviations |
| Interface | the window, the folders, the tabs, the page each kind of file opens in, the write boundary | `python3 dev/test/ui.py` | no clock, no network, no reader of its own |
| Invariants | the stylesheet's palette (the dark one declared twice and identical, the warm one restating every token, every token consumed) | `node dev/check-css.js` | no dark or warm token declared alone |
| Vendored | the versions of pdf.js, mermaid and KaTeX against the manifest | `node dev/check-vendor.js` | offline, and the recorded hashes |
| Model | the diagrams render, and every one of them cites the rules it illustrates | `bash reader/docs/model/render.sh` | the render fails if any diagram does not render |
| Packaging | the extension is built, and its contents are the files it needs | `bash dev/build.sh` | the checks run before the package is written |
| Live | the extension in a real browser: the send, the menu item, the card on a page it does not own | by hand, in the browser the reader uses | recorded in the reader's own notes |

### What the suites prove now

| Suite | Result |
|---|---|
| The corpus and the fixtures | 672 passed, 51 failed (92.9 %), and the 51 are the documented deviations — 0 unexpected |
| The corpus alone | 601 of 652 (92.2 %) |
| The interface | 15 tests, 0 failures, 41.4 s |
| The stylesheet | ok — 27 tokens, 68 consumed, braces 428/428 |
| The vendored assets | ok — 11/11 |

### What is not covered yet

This is the part that matters.

- **The extension's own behaviour is not tested.** The send to the reader
  (RF-01), the menu item, and the card's injection into a page the extension
  does not own are exercised by hand, every day, and nothing would fail if
  they broke.
- **The parsers are not fuzzed.** The markdown parser is measured against the
  corpus and against nothing else. It is the reader's attack surface (S-4).
- **The workbook reader has no tests** beyond opening one.
- **The library's writes, the search and the preferences have no tests.**
- **The PDF's canvas budget is not measured** under a long document.
- **The reader's memory is not soaked.** One sample after an afternoon is not a
  soak.
- **The security rules are reasoned, not attacked.** One of them is tested —
  a write without the token is refused — and the origin check and a page from
  another site are not.
- **The Chrome variant is not covered at all**, and its renderer is a copy.

## 3. The measurements

The method is in [../operations/performance.md](../operations/performance.md).
The numbers the specification quotes:

| What | Target | Measured |
|---|---|---|
| The workspace's answer for a folder of 100 entries | ≤ 50 ms | 1.0 ms |
| The address to the note on the screen | ≤ 1.5 s | 0.09 s |
| The reader's memory while reading | ≤ 64 MiB | 33.0 MiB |
| The reader's CPU with nobody reading | ≤ 1 % of a core | 3.1 % — **not met** |
| The renderer's score against the corpus | ≥ 90 % | 92.2 % |
| The interface suite's run | ≤ 60 s | 41.4 s |
| The PDF's canvas held at once | ≤ 48 MiB | enforced in the engine, not measured |

**Rule Q-9** — a number that does not meet its target is written down as a
number that does not meet its target, and the gap goes in the backlog. The
reader's idle CPU is the one that does not meet its target today.

## 4. The definition of done

A feature is done when:

1. it is specified — a use case with a flow, a story with acceptance criteria;
2. it is implemented behind the layers of [01-architecture.md](01-architecture.md),
   with no platform code in the core and no rendering in the reader;
3. it has a test at its own level: a fixture for the renderer, an interface
   test for the window, an invariant check for the stylesheet;
4. it is cited in the traceability matrix, with the test that proves it and an
   honest state;
5. it is visible in the window and in the documentation;
6. it is measured, or the measurement is written down as a target.

## 5. The gates that run before a change lands

```bash
node dev/test/run.js        # the corpus and the fixtures
node dev/check-css.js       # the stylesheet's invariants
node dev/check-vendor.js    # the vendored assets
python3 dev/test/ui.py      # the interface
bash dev/build.sh           # the checks above, then the package
```

The first three are the build's own gates: `build.sh` runs them and stops if
one fails. The interface suite is not in the build, because it needs a browser
and a second reader; it is run before a change that touches the window.
