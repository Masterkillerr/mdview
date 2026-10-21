# 03 — Features

What each kind of file becomes, and what the window does. The rules here are
numbered `F-` and are cited by the flows in
[../analysis/use-case-descriptions.md](../analysis/use-case-descriptions.md) and
by the stories in [../analysis/stories.md](../analysis/stories.md).

## 1. The kinds of file

| Kind | What opens it | Where |
|---|---|---|
| Markdown | the renderer and the note's chrome | `mdview.js` |
| HTML | the file's own page, in a frame | `server.py` |
| PDF | pdf.js, a paint and a text layer a page | `pdfview.js` |
| Picture | the picture view | `imageview.js` |
| Spreadsheet | the grid | `sheet.js` |
| Everything else | its own text, or a page that says it is not text | `server.py`, `text.css` |

**Rule F-1** — the extension sends a local file to the reader's workspace and
does not render it itself. The address it writes is the workspace with the
file's path named in it.

**Rule F-2** — the workspace reveals the file in the tree: the folders on the
way to it are opened, the tree is moved to the folder that holds it, and the
file is shown where it lives.

## 2. The note

![a note being rendered, and the place being kept](../model/img/svg/per-story/US-03/sequence-render-a-note.svg)

*The note's page fetches the bytes, the renderer parses them, and the place the
reader reached is written down as a page and a fraction of a page (F-3, F-4).*

The same, as a flow — and where it branches:

![the rendering of a note, and where it branches](../model/img/svg/per-story/US-03/activity-render-a-note.svg)

*The kind of the file decides the page, and the branches are the parts of a note
that are drawn by something else: a diagram by mermaid, maths by KaTeX. A note's
raw HTML is filtered on the way through (F-3, S-4).*

**Rule F-3** — one renderer draws every note. It is a real block parser and a
spec-faithful inline tokenizer, measured against the official CommonMark 0.31.2
corpus: 601 of its 652 examples, with the 51 that differ documented one by one.
The GFM extensions the reader declares — tables with alignment, task items,
strikethrough, autolinks, footnotes, frontmatter chips — are rendered as the
extensions say, and a diagram is drawn by mermaid and maths by KaTeX, both in
the reader's own colours.

**Rule F-4** — the place the reader reached is a page and a fraction of a page,
never a pixel offset, so that a window opened at another size comes back to the
same words. It is kept per file, in the browser's storage (S-6).

The note's own chrome carries the title, the word count, the reading time, the
outline of the headings, the reader's choices (desk, width, face), the
checkpoint the reader set, and the progress of the reading.

## 3. The window

**Rule F-5** — the workspace shows the folders on the left, the open files
along the top and the document in the middle. With nothing open, the middle
says *Open file / Select a file to open*.

**Rule F-6** — the tree is browsed one folder at a time. The reader asks for
the names inside a folder and gets the names, the kinds, the sizes and the
dates; it never walks the disk on the reader's behalf without being asked, and
it never reads a file's bytes to find out what the file is.

![the tree, one folder at a time](../model/img/svg/per-story/US-06/activity-browse-the-tree.svg)

*The tree, as a flow: a folder is asked for and answered, a folder is opened,
and the way up is taken (F-6, F-8).*

![the filters, and what each of them keeps](../model/img/svg/per-story/US-07/activity-filter-the-tree.svg)

*The filters, as a flow: a name, a kind, an extension, a size, a date. The
folders are kept whatever — they are the way to the files (F-7).*

**Rule F-7** — the filters are controls, not a language. The kind chips, the
extension, the size and the date are choices from a list; the name is a plain
search field. Folders are never filtered out, because they are the way to the
files.

**Rule F-8** — a refusal is readable and names the folder: what is wrong,
with which path, and what the reader can do about it.

**Rule F-9** — every tab in the workspace is one of the reader's own pages in a
frame, so a PDF in a tab is the same page the reader serves on its own. A file
opened once — picked with the *+* button, or dropped on the window — is kept
for two hours outside the reader's folders and never enters the library.

**Rule F-10** — the window's state — the folder the tree stands in, the open
files, the filters — is kept in the browser's storage under one key, and
nowhere else.

## 4. The word

![a word being looked up](../model/img/svg/per-story/US-12/sequence-look-up-a-word.svg)

*The card asks the background script, and the background script asks the
dictionary — never the other way round (F-11, S-2, S-3).*

**Rule F-11** — the card asks the background script for the word, never the
dictionary itself. A page's own fetch is subject to that page's rules, and the
background script holds the permissions (S-3).

**Rule F-12** — only the three hosts the extension declares are asked for a
word, and the answer is the rich dictionary first, the thin one when the rich
one has nothing, and the Spanish source for a Spanish word (S-2).

**Rule F-13** — the card is a card on the page: it is placed from the word's
own box, so that it sits where the word is and scrolls with it. The card can
speak the word aloud, in the voice and at the pace the reader chose.

**Rule F-14** — where a page cannot hold the card — a page of the browser's
own, its PDF viewer, the add-ons site — the definition opens in a tab of the
reader's own instead, and the page is left as it was.

## 5. The PDF

![the states of a file in the workspace](../model/img/svg/per-story/US-04/state-file-in-the-workspace.svg)

*The states of a file in the window: closed, open, and held across a reload
(F-9, F-10).*

**Rule F-15** — the boxes come first, the paints second. Every page gets its
box at the size the file says as soon as the file opens, so that the
scrollbar and the page count are right at once; only the pages near the reader
are painted, and the canvas held is under a budget of 48 MiB.

**Rule F-16** — a page is two things laid over each other: a paint — a canvas of
pixels — and the file's own text, invisible, sitting exactly over the words so
the pointer can select them and the card can read them.

**Rule F-17** — the tools are in the window's own bar at the bottom of the
file, not in the reader's bar at the top: the page number, the page count, the
page buttons and the zoom are there whether the file is read on its own or in a
frame.

**Rule F-18** — a drag that starts on a word is a selection and not a move; the
hand takes the page around the words, and the middle button takes the words as
well. A finger still scrolls.

![a PDF being read](../model/img/svg/per-story/US-13/sequence-read-a-pdf.svg)

*The file, its boxes and its paints, the tools at the bottom, and the place it
was left at. The boxes come first so that a long book is a scrollbar and not a
blank window (F-15, F-17, F-18).*

## 6. The picture

**Rule F-19** — a picture is shown at its own pixels and is not shrunk to fit
the window: a shrunk picture is a soft one. At a whole number of times the
size the pixels stay squares rather than being smoothed into each other.

**Rule F-20** — the zoom is about the pointer — what is under the pointer stays
under the pointer — and the steps are sizes a reader would ask for.

**Rule F-21** — a picture bigger than the window is moved with the hand, and
the cursor is a hand over it.

![a picture being looked at closely](../model/img/svg/per-story/US-14/sequence-look-at-a-picture.svg)

*The picture at its own pixels, the zoom about the pointer, and the hand that
moves it (F-19, F-20, F-21).*

**Rule F-28** — a picture in a note opens in the picture view when it is
clicked: in a tab of the window above when the note is read in one, and in a
tab of its own when it is not. A figure in a document is read by looking at
it, and the picture view is where a picture can be looked at closely — the
same view that a picture opened from the tree opens in, so there is one place
where a picture is looked at.

## 7. The spreadsheet

**Rule F-22** — a workbook and a CSV are the same engine: a workbook is a zip of
XML that is unpacked in the browser, and a CSV is a table already. The only
difference between the two is the zip.

## 8. The library

**Rule F-23** — the library keeps notes, pictures and spreadsheets: the kinds
it can add, rename and delete. A refusal names the kinds it keeps.

![the library, and who talks to whom](../model/img/svg/per-story/US-16/communication-organise-the-library.svg)

*The objects that take part in organising the library: the page asks, the
reader decides, the disk holds, and the browser's storage keeps the reader's
choices (F-23, F-27).*

**Rule F-24** — the search says which answer it gave: the folders walked just
now, or the index built in the background. A reader who is told "13 notes"
should know whether the number is the truth or a copy of it.

![a note being found by name](../model/img/svg/per-story/US-17/activity-find-a-note.svg)

*The walk with a budget, the index behind it, and the answer saying which of
the two it was (F-24).*

**Rule F-25** — a folder the reader already shows by that name is refused; a
folder *inside* one the reader shows is not refused but added, because it was
asked for by name and showing it twice is better than refusing what was asked
for. A folder that holds one of the reader's own is refused, because it would
show the same files twice over.

**Rule F-26** — a file outside the reader's folders is never silently refused
and never silently shown: the page says where the file is and offers the two
ways forward, adding the folder or reading the file once.

![a file from outside the folders](../model/img/svg/per-story/US-18/sequence-open-a-file-outside.svg)

*The offer, and the two ways forward: add the folder that holds it, or read
it once without keeping it (F-26).*

## 9. The reader's choices

**Rule F-27** — the reader's choices — the light, dark or warm desk, the
reading width, the face, the dictionary language, the voice and the pace — live
in the browser's storage and nowhere else, and every page of the reader's own
applies them when it opens. The reader keeps nothing about the person who
reads (S-6).
