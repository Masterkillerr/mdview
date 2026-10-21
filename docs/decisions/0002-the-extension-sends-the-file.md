# ADR-0002: The extension sends the file to the reader instead of rendering it in place

- Status: accepted
- Date: 2026-10-21

## Context

The add-on is installed in Firefox because the reader's notes are opened from
the disk and the reader wants them to look like notes rather than like plain
text. The obvious way to do that is what the Chrome variant does: put the
renderer in the page, where the file already is.

That works for one file. It stops working at the first thing that needs more
than the page:

* **the folder tree.** The page cannot see the disk (ADR-0001), so the tree
  would have to be somewhere else, and the file in the page would be somewhere
  else again — two windows showing one document.
* **the PDF, the spreadsheet and the picture.** Those need pdf.js, a zip
  unpacker and a canvas, and the reader has all three. A `file://` page can
  load them too, but then every kind of file is a different path through the
  add-on, and the add-on grows the reader's engine instead of using it.
* **the other files.** The reader opens *every* file it can, including the
  ones with no engine of their own, as their own text. An add-on that rewrites
  the tab can only rewrite the kinds it knows.

## Decision

The extension **sends** the file: when a tab's address is a local file of a
kind the reader reads, the background script writes the reader's address into
the tab — the workspace, with the file's path named in it.

The extension keeps the two jobs that need the browser's own privileges:

* it sees the tab's address, which is the only way to know that a local file
  was opened;
* it asks the dictionaries on the reader's behalf, from the background script
  (ADR-0007).

## Consequences

* One renderer for every kind of file, and the reader's own copy of it.
* The reader's window is the only place a file is read, so the folder tree and
  the document are in the same window.
* The cost: a tab's address changes when a local file is opened, and the
  reader has to be running. The extension does not retry: a reader that is
  down is a service that systemd is about to restart.
* The cost: the kinds the extension sends are the kinds the *browser* will
  open. Firefox hands a `.xlsx` to an application and there is no tab to send;
  such a file arrives through the reader's own *Open a file* button instead
  (P-13).
* The Chrome variant keeps the other behaviour, because a Chrome extension
  cannot start a local server and its PDF view is its own.
