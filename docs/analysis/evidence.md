# The evidence

Before any requirement is written down, what is true has to be found out. This
document is that: the code that exists, the interface the parts agree on, the
tests that already prove something, and the numbers that were measured rather
than assumed. Every later document is built on this one, and where the code and
a belief disagree, the code is what is written down.

## 1. What the system is

Three pieces, on one machine, for one person.

| Piece | Where | What it is |
|---|---|---|
| **The reader** | `~/mdview/reader/` | A local HTTP server on `127.0.0.1:8765`. It holds the folders the reader shows, serves the pages of every kind of file, and is the only process that writes to the disk. |
| **The extension** | `~/mdview/extension/` | A Firefox add-on (manifest v2). It sends the files the browser opens to the reader, and it looks words up wherever they are. |
| **The engine** | `~/mdview/extension/` | The renderers the reader serves at `/static/…`: the markdown renderer, the PDF view, the spreadsheet view, the word-lookup card. |

The dev tooling (`~/mdview/dev/`) packages the extension, checks the
stylesheet's invariants, checks the vendored assets, and runs the two test
suites. A Chrome variant (`the Chrome variant (not in this repository)`, manifest v3) renders in
place instead of sending the file to the reader; it shares the renderer but not
the reader, and this document is about the Firefox pair.

## 2. The interface between them

The extension and the reader talk over HTTP on the loopback. The extension
never serves anything and the reader never calls the browser.

### What the extension sends

| From | To | What | Where |
|---|---|---|---|
| A tab whose address is a `file://` URL of a readable kind | the reader | `GET /?open=<path>` — the file, named in the address | `refresh.js`, `readerUrl()` |
| The toolbar button | the reader | `GET /` — the workspace | `refresh.js`, `browserAction.onClicked` |
| The page, on a double-click on a word | the background script | `runtime.sendMessage({type: "mdview:fetch", url})` | `lookup.js` |
| The page, on a note that was read | the background script | `runtime.sendMessage({type: "mdview:keep", url, kind, text})` | `mdview.js`, `keepCopy()` |
| A note that links to a local file | the window above it | `postMessage({type: "mdview:open", path})` | `mdview.js`, the click handler |

### What the reader serves

| Route | What | Who asks |
|---|---|---|
| `GET /` | the workspace: the folders on the left, the tabs along the top, the document in the middle | the browser, the extension |
| `GET /view/<path>` | one file's own page — the kind decides which | the workspace, the browser |
| `GET /library` | the library: the folders as cards, the notes as rows, the tools to organise them | the browser |
| `GET /api/tree?path=` | the names inside a folder | the workspace |
| `GET /f/<path>` | the bytes of a file | the engines, inside the reader's own pages |
| `GET /static/<name>` | the engine's scripts and styles | the reader's own pages |
| `GET /healthz` | `ok` | the service, the tests |
| `POST /api/upload`, `/api/temp` | put a file on the disk | the library, the workspace |
| `POST /api/delete`, `/api/rename`, `/api/mkdir`, `/api/add-folder` | change the disk | the library, the workspace |

The full table, with the rules that govern it, is in
[../specification/02-interfaces.md](../specification/02-interfaces.md).

### The write boundary

Every write is a `POST` to `/api/…`, and every `POST` is refused unless two
things hold: the `Origin` header is one of the reader's own three addresses, and
the `X-Mdview-Token` header carries the token that the reader put in every page
it serves. The token is minted when the server starts (`secrets.token_urlsafe`),
so a page that was loaded before the reader restarted cannot write.

## 3. What each kind of file becomes

The reader has an engine for some kinds and a plain view for the rest.

| Kind | What opens it | Where |
|---|---|---|
| Markdown (`.md`, `.markdown`, `.mdown`, `.mkd`) | the CommonMark renderer and the note's chrome | `mdview.js` |
| HTML (`.html`, `.htm`) | the file's own page, in a frame, so its styles cannot reach the reader | `server.py`, `_viewer()` |
| PDF (`.pdf`) | pdf.js, one canvas and one text layer a page, painted near the reader | `pdfview.js` |
| Pictures (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`) | the picture view: its own pixels, moved with the hand | `imageview.js` |
| Spreadsheets (`.xlsx`, `.xlsm`, `.csv`, `.tsv`) | the grid: a workbook is a zip of XML, a CSV is a table already | `sheet.js` |
| Everything else | its own text, if the bytes are text; a page that says so and offers the file, if they are not | `server.py`, `text_page()` |

The decision between text and binary is made when a file is opened, not when a
folder is listed: the tree decides a file's kind by its name, because a tree that
read every file to find out would be slow on a folder with a thousand of them.

## 4. The tests that exist

| Suite | What it proves | How to run | Result now |
|---|---|---|---|
| The corpus | the markdown renderer against the official CommonMark 0.31.2 corpus (652 examples) and 71 local fixtures | `node dev/test/run.js` | **672 passed, 51 failed (92.9 %)**, and the 51 are the documented deviations — 0 unexpected |
| The corpus alone | the same, without the local fixtures | `node dev/test/score-backup.js` | **601/652 (92.2 %)** |
| The stylesheet | the dark palette is declared twice and identically, the warm palette restates every token, and every token is consumed | `node dev/check-css.js` | ok — 27 tokens, 68 consumed, braces 428/428 |
| The vendored assets | pdf.js, mermaid and KaTeX are the versions the manifest records | `node dev/check-vendor.js` | ok — 11/11 |
| The interface | the window, the folders, the tabs, and the page each kind of file opens in | `python3 dev/test/ui.py` | **15 tests, 0 failures** (41 s) |

The interface suite drives a real reader over HTTP with a real browser: a reader
of its own, on a port of its own, with folders of its own, so it never touches
the files the reader really shows.

## 5. What was measured

The measurements, the method and the machine are in
[../operations/performance.md](../operations/performance.md). The numbers that
the specification quotes:

| What | Measured | How |
|---|---|---|
| The workspace page | 0.4 ms, 14.7 KB | 12 requests, the median, over the loopback |
| A folder listing (46 entries) | 1.0 ms, 8.0 KB | the median of 12 requests |
| A note's page | 0.7 ms, 6.7 KB | the median of 12 requests |
| The address to the note on the screen | 0.09 s median | five loads, the median, of a note in a tab |
| The reader's memory | 33.0 MiB resident, after 1 h 14 min of use | `/proc/<pid>/status` |
| The reader's CPU, nobody reading | 3.1 % of a core (0.94 s over 30 s) | `/proc/<pid>/stat`, two samples |
| The renderer's score | 92.2 % of the CommonMark corpus | `test/score-backup.js` |
| The interface suite | 15 tests, 41.4 s | `test/ui.py` |
| The model | 20 diagrams — 7 general, 13 per story — rendered and gated | `docs/model/render.sh` |

The idle CPU is the one number that is a problem: the reader walks its folders
every twenty seconds to keep the library's search index warm, and that walk
costs three per cent of a core for a search that the workspace's tree does not
need. It is in the backlog.

## 6. What is true about the code's shape
| | Lines |
|---|---|
| `reader/server.py` — the reader | 1 498 |
| `reader/workspace.js` — the window | 950 |
| `reader/workspace.css` — the window's styles | 674 |
| `extension/mdview.js` — the renderer and the note's chrome | 4 902 |
| `extension/mdview.css` — the note's styles | 3 320 |
| `extension/lookup.js` — the word-lookup card | 2 418 |
| `extension/sheet.js` — the spreadsheet view | 1 588 |
| `extension/pdfview.js` — the PDF view | 750 |
| `extension/refresh.js` — the extension's background | 142 |
| `extension/define.js` — the definition tab | 143 |

Two facts about the shape matter for the architecture. The reader is a single
file with the pages, the routes and the file logic in it, and the engines are
separate files that know nothing about the reader — they are given a URL and
render what is at it. That is the boundary the architecture is built on: the
reader serves, the engines render.

## 7. What is not there

Written down, because a specification that hides its gaps cannot be planned
from.

* **The Chrome variant is not covered by any of the suites.** Its renderer is
  a copy; its `pdfview.js` differs from the Firefox one; nothing runs against
  it.
* **The extension's own behaviour is not tested.** The corpus covers the
  renderer; nothing drives the extension in a browser (the send-to-the-reader
  rewrite, the menu item, the card's injection into a page it does not own).
* **The parsers are not fuzzed.** The markdown parser is measured against the
  corpus, not against garbage.
* **Nothing measures the reader's memory over time.** The 33 MiB is one sample
  after an afternoon, not a soak.
* **The workbook reader (`sheet.js`) has no tests at all** beyond opening one.
