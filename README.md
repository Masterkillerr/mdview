# mdview

A reader for one person's notes, on one machine, that opens **every** file it
can and shows it well.

A local server holds your folders and serves the pages; a small Firefox
add-on sends the files the browser opens to it. Markdown is rendered as
CommonMark, PDFs are read in place with their pages and their zoom, pictures
are shown at their own pixels, spreadsheets are grids, and every other file is
its own text.

```
  the browser                    the reader (127.0.0.1:8765)
  ┌───────────────────┐          ┌──────────────────────────────────┐
  │  the extension    │  ─HTTP─▶│  /            the workspace      │
  │  background       │          │  /view/…      a file's own page  │
  │  script           │          │  /library     organise           │
  │                   │          │  /api/tree    the folders        │
  │  the word card    │◀─pages──│  /f/…         the bytes          │
  └───────────────────┘          │  /static/…   the engines         │
                                 └──────────────────────────────────┘
```

## The three trees

| | |
|---|---|
| [`reader/`](reader/) | the local server, the window, and the source view |
| [`extension/`](extension/) | the Firefox add-on and the engines it ships: the renderer, the PDF view, the sheet view, the word card |
| [`dev/`](dev/) | the tooling: the test suites, the checks, the packaging |
| [`docs/`](docs/) | the analysis, the specification, the decisions, the model and the operations |

## Running it

The reader needs Python 3 and nothing else.

```bash
cp reader/roots.example.json reader/roots.json   # the folders to show
python3 reader/server.py                         # on 127.0.0.1:8765
```

Open <http://mdview.localhost:8765/> — or `localhost:8765`, or
`127.0.0.1:8765`. The reader finds its engines beside itself, in
`../extension`; the `MDVIEW_ENGINE` variable says where they are when they are
somewhere else, and `MDVIEW_PORT` and `MDVIEW_ROOTS` move the port and the
folders.

To run it as a service:

```bash
cp dev/mdview-reader.service ~/.config/systemd/user/
systemctl --user enable --now mdview-reader.service
```

`reader/open.sh` starts the service if it is not running and opens the reader
in a window of its own.

## The extension

```bash
cd dev && npm install && npm run build     # writes extension/mdview.xpi
npm run sideload                           # installs it into a Firefox profile
```

Firefox has to be told to allow an unsigned add-on
(`xpinstall.signatures.required = false` in `about:config`), and the add-on has
to be enabled in `about:addons`.

`npm run dev` runs web-ext with a throwaway profile, which reloads the add-on
whenever a file changes.

## The tests

```bash
node dev/test/run.js         # the renderer against the CommonMark corpus
python3 dev/test/ui.py       # the window, driven in a real browser
node dev/check-css.js        # the stylesheet's palette invariants
node dev/check-vendor.js     # the vendored assets' versions
bash dev/build.sh            # the checks above, then the package
```

The corpus suite scores the renderer against the official CommonMark 0.31.2
corpus — 652 examples — and the reader's own fixtures for the GFM extensions
and the safety rules. The interface suite starts a reader of its own, on a port
of its own, with folders of its own, and drives it in a browser.

The interface suite needs Playwright (`pip install playwright && playwright
install chromium`).

## The documents

[`docs/`](docs/) holds the analysis and the specification: what must it do and
where each requirement is proved, the use cases, the stories and the backlog,
the architecture, the interface, the features, the security, the quality
gates, the decision records, the UML model and the operations.

The documents are checked by the method's own script:

```bash
bash ~/.config/opencode/skills/analysis-architecture/scripts/check-docs.sh docs
```

## What is in here, and what is not

The vendored assets — pdf.js, mermaid and KaTeX — are in `extension/`, with
their licences, and `dev/vendor-manifest.json` records the version of each and
where it came from. `dev/check-vendor.js` checks them against that manifest.

The reader's own state — the folders it shows, the files opened once — is not
in the repository: `reader/roots.json` is yours, and it is listed in
`.gitignore`.

## The licence

See [LICENSE](LICENSE).
