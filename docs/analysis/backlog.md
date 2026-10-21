# The backlog

Ordered by **what unblocks the most** and by **what the reader is waiting
for** — not by identifier, not by size. The state of every slice is the state
in the [traceability matrix](requirements.md#5-traceability-matrix): `done`,
`partial` (say which part), `planned`.

The size scale is **S** = half a day, **M** = two days, **L** = a week, for one
person who knows the code.

---

## Now — the gaps the analysis found

| # | Story | Size | Value | Depends on | State |
|---|---|---|---|---|---|
| 1 | **US-18** The reader's own tests for the extension's send (RF-01) | M | The seam between the two halves of the system has no test; the corpus and the interface suite both stop at the reader's HTTP door | a browser that can load the add-on | planned |
| 2 | **US-12** Tests for the word lookup: the injection, the host allow-list, the speech (RF-12, RF-13, RF-21, RF-24) | M | The card is the one thing that runs on somebody else's page, and nothing would fail if it broke | the dictionary hosts being reachable | partial |
| 3 | **US-16** Tests for the library's writes and for the spreadsheet view (RF-15, RF-19) | M | The only part of the reader that writes to the disk is the part with the least proof | — | partial |
| 4 | The reader's background index, when nobody is searching (RNF-08) | S | The reader burns 3.1 % of a core every day to keep a search index warm that the workspace's tree does not use | — | planned |
| 5 | A picture in a note opens in the picture view (RF-28) | S | A figure in a document is read by looking at it, and there was no way to look at one closely | — | done |

## Next — the reading

| # | Story | Size | Value | Depends on | State |
|---|---|---|---|---|---|
| 6 | **US-13** The PDF's canvas budget, measured under a long document (RNF-05) | S | The engine enforces the budget in code; nothing has watched it hold | a long PDF | partial |
| 7 | **US-03** A fuzz pass over the markdown parser | M | The parser is measured against the corpus and against nothing else; it is the reader's attack surface | — | planned |
| 8 | **US-17** A test for the search, and for the answer it says it gave (RF-16) | S | The search's honesty about its own answer is a rule nobody checks | — | partial |
| 9 | A soak for the reader's memory (RNF-02) | S | One sample after an afternoon is not a soak | — | planned |

## Later — the rest of the system

| # | Story | Size | Value | Depends on | State |
|---|---|---|---|---|---|
| 10 | The Chrome variant shares the reader's engine instead of copying it | L | Two copies of a renderer drift; the copy is already a different `pdfview` | — | planned |
| 11 | The library becomes a view of the tree rather than a second way round | L | Two ways of looking at the same folders is one too many | — | planned |
| 12 | The reader can write notes of its own | L | It reads everything and writes nothing | — | planned |

## Done

The list stays, so that a new reader sees what "done" means here.

| Story | Size | What it took |
|---|---|---|
| **US-02** The window: folders on the left, tabs along the top | L | The workspace is a page of its own, and the tree is asked for one folder at a time |
| **US-03** A note is rendered and read | L | The renderer was rewritten as a real block parser and measured against the corpus: 601 of 652 |
| **US-04** A file opens in a tab | M | Every kind of file became one of the reader's own pages, and a tab is one of those pages in a frame |
| **US-05** The window comes back as it was left | S | The state went into the browser, under one key |
| **US-06** The tree is browsed a folder at a time | M | The tree asks the reader for a folder's names; the reader answers with the names |
| **US-07** The tree is filtered | M | The kind chips, and then the panel with the extension, the size and the date |
| **US-08** The tree is pointed at a folder | M | The three dots on a folder's row, and the dialog that takes a path |
| **US-09** A file with no engine opens as its text | M | The reader's own view of a file it has no engine for |
| **US-10** A file opened once is kept for two hours | S | The reader's own copy, outside its folders, swept after two hours |
| **US-11** The place the reader reached is kept | M | A page and a fraction of a page, per file, in the browser |
| **US-12** A word is looked up | L | The card, the three hosts, the speech, and the tab that takes the card's place where a card cannot live |
| **US-13** A PDF is read | L | pdf.js, the boxes first and the paints second, and the window's own bar of tools |
| **US-14** A picture is looked at closely | M | The picture's own pixels, the zoom about the pointer, the hand, and a picture in a note opening in the same view |
| **US-15** A spreadsheet is read | L | The grid, and the zip behind a workbook |
| **US-16** The library, and the reader's choices | M | The library's cards and rows, and the light, dark and warm desks |
| **US-17** A note is found by name | S | The walk with a budget, and the index behind it |
| **US-18** A file from outside the reader's folders | M | The page that offers the folder, and the two ways forward |
