# ADR-0004: One route for every file; the kind of the file decides the page

- Status: accepted
- Date: 2026-10-21

## Context

The reader opens five kinds of file, each with its own page and its own
engine: markdown, HTML, PDF, picture and spreadsheet — and, for everything
else, its own text.

The obvious design is a route per kind: `/md/<path>`, `/pdf/<path>`,
`/picture/<path>`. That is how the code was written at first, and it has three
problems.

* **The caller has to know the kind.** The extension sees the file's name and
  would have to decide the route; the workspace's tree would have to know it
  too; the library's links would have to know it. The kind is already decided
  in one place — the reader's `kind_of` — and every other place would be a
  second copy of it that goes stale (A-6).
* **A file with no engine has no route.** "Open any file" (D4) means there is
  a route for the kinds nobody thought of, and a kind nobody thought of has
  no name to put in a route.
* **The adoption page breaks.** A file outside the reader's folders is
  answered with a page that offers to add its folder. That page is not a kind
  of file; it is a *situation*, and it has to be reachable for every kind.

## Decision

There is **one route for a file**: `/view/<path>`. The reader decides the kind
by the name, decides the page by the kind, and serves it (P-3).

The kind is decided in one place, `kind_of`, and the bytes are consulted only
when the name is not enough — which is when a file is opened, and not when a
folder is listed (ADR-0009).

## Consequences

* The caller asks for a file, not for a kind of file. The extension, the
  tree, the library and the notes' own links all say the same thing.
* A new kind is one branch in `_viewer` and one rule in
  [03-features.md](../specification/03-features.md). No route, no caller's
  change.
* The flags ride on the same route: `?embed=1` is the page without the bar,
  and it is the only difference between a tab and a page on its own.
* The cost: the reader decides the kind on every request, and it is decided
  by the name each time. That is a suffix comparison and a set lookup; it is
  not worth caching.
* The cost: the reader's pages have different shapes under one route, so a
  reader of the code cannot tell what a path will answer without knowing the
  kinds. The route table in
  [02-interfaces.md](../specification/02-interfaces.md) says it, and the
  feature table says what each kind becomes.
