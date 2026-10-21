# mdview

A reader for one person's notes, on one machine, that opens **every** file it
can and shows it well.

This is the documentation of the app: what it must do, how it is shaped, why
it is like this, what it costs, and what is still missing.

## The app in one picture

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

The extension sends the files the browser opens to the reader; the reader
holds the folders, serves the pages, and is the only thing that writes to the
disk.

## Where to look

| Question | Document |
|---|---|
| What is true today — the code, the tests, the numbers | [analysis/evidence.md](analysis/evidence.md) |
| What must it do, and where each requirement is proved | [analysis/requirements.md](analysis/requirements.md) |
| What is a goal, in full | [analysis/use-case-descriptions.md](analysis/use-case-descriptions.md) |
| What is a slice of work | [analysis/stories.md](analysis/stories.md) |
| What is next | [analysis/backlog.md](analysis/backlog.md) |
| What it is, and the principles it obeys | [specification/00-overview.md](specification/00-overview.md) |
| How it is shaped | [specification/01-architecture.md](specification/01-architecture.md) |
| What goes over the wire | [specification/02-interfaces.md](specification/02-interfaces.md) |
| What each kind of file becomes | [specification/03-features.md](specification/03-features.md) |
| What is refused, and why | [specification/04-security.md](specification/04-security.md) |
| How we know it works | [specification/05-quality.md](specification/05-quality.md) |
| Why is it like this | [decisions/](decisions/) |
| What does it look like | [model/](model/) |
| How do I run it | [operations/](operations/) |

## The three trees it lives in

| | |
|---|---|
| `~/mdview/reader/` | the reader: the server, the window's own files, and this documentation |
| `~/mdview/extension/` | the extension and the engines: the renderer, the PDF view, the sheet view, the word card |
| `~/mdview/dev/` | the tooling: the corpus suite, the interface suite, the checks, the packaging |

## The three commands

```bash
node dev/test/run.js        # the corpus: the renderer against CommonMark
python3 dev/test/ui.py      # the interface: the window, driven in a browser
bash dev/build.sh           # the checks, then the package
```

The corpus is at 601 of the 652 official examples (92.2 %), with the 51
differences documented one by one. The interface suite is 15 tests, 0 failures.
The state of every requirement, and what is still missing, is in
[the gaps](analysis/requirements.md#6-the-gaps).

## The checks on these documents

```bash
bash ~/.config/opencode/skills/analysis-architecture/scripts/check-docs.sh reader/docs
```

Five checks: the links point at files that exist, the rule numbers are
unique, the traceability matrix is complete, every catalogue entry has a
description, and every identifier the prose cites is defined somewhere.
