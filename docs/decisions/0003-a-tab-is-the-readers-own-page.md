# ADR-0003: A tab in the workspace is the reader's own page in a frame

- Status: accepted
- Date: 2026-10-21

## Context

The workspace shows several files at once, one in each tab. A tab has to hold a
markdown note, a PDF, a picture and a spreadsheet, each of which is a
different program with a different lifecycle — and each of which already
exists as a page the reader serves on its own.

There are two ways to put a document in a tab:

* **the workspace draws it.** The workspace fetches the file and renders it
  itself. That means the workspace knows about markdown, about pdf.js, about
  the spreadsheet's zip: the reader's five engines would become the
  workspace's five engines, and the pages the reader serves on its own would
  be a second implementation of everything.
* **the workspace holds the reader's own page.** Each tab is a frame whose
  address is the reader's route for that file.

## Decision

A tab is **a frame of the reader's own page** (`/view/<path>?embed=1`). The
workspace composes pages; it does not draw documents (F-9).

## Consequences

* One implementation of every kind of file. A PDF in a tab is byte-for-byte
  the page the reader serves when the file is opened on its own.
* The `?embed=1` flag is the only difference between the two: it drops the
  bar that goes back to the library, because the workspace's own bar is above
  it. Nothing else changes, so the file's own address — and therefore the
  place the reader reached in it — is the same in both (ADR-0010).
* The cost: a frame is a document, so it has its own scroll position, its own
  history and its own `localStorage` view. The reader's places and choices
  are keyed by the *address*, so both frames of the same file agree.
* The cost: the reader's page has to know it is in a frame. It does so by the
  flag, and by the way it asks the window above it to open a file (P-10) — a
  link inside a note opens in the workspace's tab bar, not inside the frame.
* The cost: a document that is taller than its frame scrolls inside the frame,
  so the workspace's own scrolling is not the document's. That is the same
  behaviour as a browser tab, and it is what the reader expects.
* The cost: eight frames are kept alive at once. Past that, the oldest is let
  go of and made again when it is asked for.
