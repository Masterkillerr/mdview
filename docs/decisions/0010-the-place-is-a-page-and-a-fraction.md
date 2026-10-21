# ADR-0010: The place in a document is a page and a fraction of a page

- Status: accepted
- Date: 2026-10-21

## Context

The reader keeps the place they had reached in a document, so that a long note
or a thousand-page manual is not read twice. The place has to survive:

* the window being closed and opened again;
* the reader being restarted by systemd;
* the window being a different size, or on a screen with a different density;
* the note being edited and its length changing.

The obvious thing to keep is the scroll offset: `scrollY`. It survives the
first two and fails the other two, badly. A note that grows above the place
the reader had reached moves the words they were reading; a window that is
half as wide has different line breaks, so the same offset is a different
paragraph.

## Decision

The place is **a page and a fraction of a page** (F-4):

* for a note, the heading the reader was at and the fraction of it that was
  past;
* for a PDF, the page and the fraction of that page.

Both are measured against the document's own structure, so they mean the same
words whatever the window is doing. Both are kept per file, keyed by the
file's address, in the browser's storage (S-6).

A PDF's page is already a page: the file's own structure is one. A note's
structure is its headings, and the reader picks the heading the reading line
crossed.

## Consequences

* A note read in a narrow window and then in a wide one comes back to the
  same heading and about the same part of it.
* A note that grows above the place keeps the place.
* The cost: the place is only as good as the structure it is measured
  against. A note with no headings has no structure to measure against, and
  its place falls back to a fraction of the document.
* The cost: the fraction has to be measured from the place the page arrives
  at when it is jumped to, which is its top just under the reader's bar. The
  implementation says so in a comment, because it is otherwise mysterious.
* The cost: a PDF's place is a page and a fraction of a page, and a page
  that is a slide has no words to be halfway through — so the fraction of a
  slide is the fraction of its height.
* The reader's recent list shows the place each file was reached, in the
  words the reader would use: "Read to 41 %", "Finished".
