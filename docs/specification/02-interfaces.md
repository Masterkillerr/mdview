# 02 — Interfaces

What goes over the wire between the extension and the reader, and what the
reader serves. The rules here are numbered `P-` and are cited by the flows in
[../analysis/use-case-descriptions.md](../analysis/use-case-descriptions.md) and
by the model in [../model/](../model/).

## 1. The reader's routes

Every route the reader answers. Nothing else is served.

| Route | Method | What it answers | Who asks |
|---|---|---|---|
| `/` | GET | the workspace | the browser, the extension |
| `/` | GET `?open=<path>` | the workspace, with that file open in a tab | the extension, the library's links |
| `/library` | GET | the library | the browser |
| `/library` | GET `?dir=<path>` | the library, standing in that folder | the browser |
| `/library` | GET `?q=<text>` | the search | the browser |
| `/view/<path>` | GET | one file's own page — the kind decides which | the workspace, the browser |
| `/view/<path>` | GET `?embed=1` | the same page without the bar that goes back to the library | the workspace |
| `/open-file/<id>/<name>` | GET | a file kept for two hours, outside the reader's folders | the workspace, the library |
| `/f/<path>` | GET | the bytes of a file | the engines, inside the reader's own pages |
| `/static/<name>` | GET | an engine's script or style | the reader's own pages |
| `/api/tree` | GET | the roots, or the names inside a folder | the workspace |
| `/api/tree` | GET `?path=<path>` | the names inside that folder, with each one's kind, size and date | the workspace |
| `/healthz` | GET | `ok` | the service, the tests |
| `/api/upload` | POST | put a file into a folder | the library |
| `/api/temp` | POST | keep a file for two hours | the library, the workspace |
| `/api/delete` | POST | remove a file | the library |
| `/api/rename` | POST | rename a file | the library |
| `/api/mkdir` | POST | make a folder | the library |
| `/api/add-folder` | POST | add a folder to the reader's own | the workspace, the library's adoption page |

**Rule P-1** — the reader serves on the loopback only, and answers only the
routes in this table. A path that is not in the table is not found.

**Rule P-2** — a path in a route is a path on the disk: it is quoted once by
the caller and unquoted once by the reader, and the reader resolves it before
it uses it. A path that resolves outside the reader's roots is not served.

**Rule P-3** — the reader answers `GET /view/<path>` for a file it is allowed
to show, and the *kind* of the file decides which page it is: the renderer, the
frame, the picture view, the grid or the text view. There is one route and five
pages, not five routes.

**Rule P-4** — a file outside the reader's roots is never served as a
document. The reader answers with the page that offers to add the folder that
holds it (F-26), or with a refusal that names the reason.

**Rule P-5** — a change is a `POST` to `/api/…`, and it is made only when the
`Origin` header is one of the reader's own three addresses **and** the
`X-Mdview-Token` header carries the token the reader minted when it started.
Every other `POST` is refused with 403 and a reason (S-1).

**Rule P-6** — `/static/` serves only the files on the allow-list: the
engine's scripts and styles from the engine's folder, and the reader's own
files from the reader's folder. A name that is not on the list is not found,
and a name with a `..` in it never escapes.

**Rule P-7** — the pages the reader serves carry the modification time of
every file they cite, so that an edited engine is fetched again rather than
read from the browser's copy.

**Rule P-8** — the reader answers `GET /api/tree` with the names in a folder
and the *facts about the names* — the kind, the size, the date — and never
with the contents of the files. A tree that read every file to find out what
they were would be slow on a folder with a thousand of them (F-6).

## 2. The tree's answer

```json
{
  "path": "~/notes",
  "name": "OS",
  "up": "~",
  "entries": [
    { "name": "first.md", "path": "~/notes/first.md", "dir": false,
      "kind": "md", "size": 1567, "mtime": 1791819027 },
    { "name": "img", "path": "~/notes/img", "dir": true, "kind": "dir" }
  ]
}
```

`up` is the folder above, when the reader may show it; it is absent at the top.
With no path at all, the answer is the list of roots:

```json
{ "roots": [ { "name": "OS", "path": "~/notes" } ] }
```

The kind is decided by the name alone. Whether the bytes are text is decided
when the file is opened, which is the only time it matters.

## 3. The extension's own messages

The extension and the reader meet at one URL; the extension also talks to its
own background script, and the engine asks the window above it to open a file.

![the extension sending a local file, and the workspace opening it](../model/img/svg/per-story/US-01/sequence-open-a-file.svg)

*The whole path, from the browser opening a local file to the note on the
screen. Every step crosses the reader's HTTP interface except the last, which
crosses the extension's message interface (F-1, F-2, P-13).*

The same opening, arranged by the objects rather than by the time — which of
them know about the file, and which are only told:

![the same opening, by object](../model/img/svg/per-story/US-01/communication-open-a-file.svg)

*The reader holds the disk and the routes; the workspace holds the tree and
the tabs; the frame holds the page; the engine holds the drawing. The workspace
tells the state where the file is, and the tab is the reader's own page in a
frame (F-2, A-3).*

| Message | From | To | What |
|---|---|---|---|
| `mdview:fetch` | the card, the definition tab | the background script | *fetch this URL and give me the text* |
| `mdview:keep` | the renderer | the background script | *keep a copy of this page* |
| `mdview:open` | the renderer, in a frame | the window above it | *open this file in a tab* |

**Rule P-9** — the background script answers `mdview:fetch` for the three
dictionary hosts and for nothing else; every other URL is refused before the
request is made (S-2).

**Rule P-10** — the `mdview:open` message is sent only to the window that
holds the frame, and only with the origin the frame came from. A frame that
cannot reach its window opens the file itself.

## 4. The dictionary's answer

The card asks for a word and gets text back. The background script asks the
free dictionary first, and the thin one when the rich one has no entry:

| Host | What it is asked |
|---|---|
| `api.dictionaryapi.dev` | `/api/v2/entries/en/<word>` — the senses, the parts of speech, the phonetics, the examples |
| `api.datamuse.com` | `/words?md=d&max=1&sp=<word>` — one line a sense, no phonetics |
| `en.wiktionary.org` | `/api/rest_v1/page/definition/<word>` — for a Spanish word |

**Rule P-11** — the requests carry no credentials, no referrer and no cache,
and they are made by the background script, which holds the permissions (S-3).

## 5. The extension's watch on the tabs

The extension watches the address of every tab. A tab whose address is a
`file://` URL of a kind the reader reads is sent to the reader, once: a tab
reports its address several times while it loads, and sending it again while it
is on its way restarts the load every time.

**Rule P-12** — a tab is sent once per address. The reader's address is not a
`file://` URL, so the watch cannot send it back to the reader.

**Rule P-13** — the kinds the extension sends are the kinds the browser will
open. A `.xlsx` is not one of them: Firefox decides that a workbook is not
something it can show and hands it to an application, so there is no tab to
send. The reader's library and its *Open a file* button are how such a file
arrives.
