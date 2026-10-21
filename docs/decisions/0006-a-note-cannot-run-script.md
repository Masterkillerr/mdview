# ADR-0006: A note cannot run script

- Status: accepted
- Date: 2026-10-21

## Context

The reader shows a person's own notes, and the notes are written in a text
editor, often by somebody else, often copied from a chat. Some of them carry
raw HTML.

A `file://` origin is not a harmless origin. A page on it can be shown other
files from the same directory in some browsers, and the reader's own pages
carry the token that lets them write to the disk. A note that could run script
would be a way for a note to reach the reader's own pages.

The reader's renderer is the reader's own code, and it sees the raw HTML of
every note.

## Decision

Raw HTML is **not** passed through. Only a presentational allow-list of tags
survives, with the attributes whitelisted, the URL schemes restricted to the
safe ones, and the style declarations filtered. Everything else is escaped and
shown as text (S-4).

## Consequences

* A note can say `<b>` and it is bold. A note that says `<script>` is shown
  the words `<script>`.
* The renderer's output is safe to put in the reader's page, which is what
  makes the reader's own pages safe to put in a frame (ADR-0003).
* The cost: a note that uses HTML for something the allow-list does not
  have — a table with attributes, a `<details>`, a `<mark>` with a colour —
  is shown as text rather than as the author meant it. The allow-list is
  generous enough for the notes the reader has; it is not a browser.
* The cost: the filtering is a place where a mistake is a hole. The rules
  are in the renderer's `rawHtml` and are covered by the corpus's raw-HTML
  fixtures and by the reader's own fixtures.
* The cost: the reader's *own* pages are trusted, and the distinction is
  carried by the fact that the reader builds them rather than reading them.
  A note never becomes a reader's page.
* This is the one rule in the specification that a reader of the code should
  be most careful about, and it is why the extension's own
  `web_accessible_resources` is empty: nothing of the add-on's is reachable
  from a note.
