# The manual

How the reader is used. The order is the order a reader meets it.

## The window

The reader's home is a **workspace**: the folders on the left, the open files
along the top, and the document in the middle. With nothing open, the middle
says *Open file / Select a file to open*.

| | |
|---|---|
| The folders on the left | the tree. Click a folder to open it, click the arrow at the top to go up a level. |
| The name above the tree | the folder the tree is standing in. Click it to point the tree somewhere else. |
| The three dots on a folder | go to that folder, add it to the reader's own, open it in the library, copy its path. |
| The filter box | filters the tree by name. |
| The kind chips | show one kind of file, or all of them. |
| The funnel | the rest of the filter: the extension, the size, the date. |
| The tabs along the top | the open files. Click one to switch, click its × to close it. |
| The **+** | open a file from the disk, without adding it to the reader's folders. |
| The list on the right | the reader's library, and its settings. |
| The rectangle on the far right | put the folders away. `Ctrl+B` does the same. |

A file can also be **dropped** on the window.

## Reading a note

A note is a markdown file, rendered as CommonMark with the reader's own
chrome: the title, the word count, the reading time, the outline of the
headings, the reader's choices, and the progress of the reading.

| | |
|---|---|
| **Font**, **Width**, **Theme** | the face, the measure and the desk. The desk has three: light, dark and warm. |
| **Mode** | read, or plain — plain is the markdown as it was written. |
| **Print** | print the note. |
| **Go to checkpoint** | go back to the place the reader set. |
| **Contents** | the outline. |
| A double-click on a word | the card with the word's meanings, and a speaker to hear it. |

The reader keeps the place in every note, and shows it in the library's
*Recently opened* list: *Read to 41 %*, or *Finished*.

## Reading a PDF

A PDF is a document in the same window. The bar at the bottom carries the
page number, the page count, the page buttons and the zoom.

| | |
|---|---|
| The page number | a field: type a page and press Enter to jump there. |
| **Fit width** / **Fit page** | the whole width of the page, or the whole page. |
| **−** / **+** | the zoom, in steps. |
| A drag on the page | moves it, when it is bigger than the window. |
| A drag on a word | selects it, as in any other document. |
| The middle button | moves the page, whatever is under the pointer. |

## Looking at a picture

A picture is shown at its own pixels, and is not shrunk to fit the window.

| | |
|---|---|
| **−** / **+** | the zoom, about the pointer. |
| **Fit** | the whole picture in the window. |
| **1:1** | its own pixels. |
| A drag | moves it, with the hand. |
| `Ctrl` and the wheel | zooms about the pointer. |

## Reading a spreadsheet

A workbook's sheets are drawn as a grid, and a CSV is drawn the same way.

## The library

The library is the other half of the window: the folders as cards, the notes
as rows, and the tools to organise them.

| | |
|---|---|
| The search box | finds a note by name in any folder under the reader's roots. |
| The type chips | one kind of note, or all of them. |
| **Add files** | puts files into the folder. |
| **New folder** | makes a folder. |
| **Rename**, **Delete** | on a row. |
| **Open a file without adding it** | reads a file for two hours, and leaves no trace of it. |
| **Settings** | the dictionary's language, the voice and the pace. |

## Looking a word up, anywhere

The extension's own menu item, *Define “%s” with mdview*, works on any page
in the browser, not only in the reader. Where the page allows a card, the card
opens on the page; where it does not — the browser's own pages, its PDF
viewer — the definition opens in a tab of the reader's own.

## What is kept, and where

| What | Where |
|---|---|
| The open files, the folder the tree stands in, the filters | the browser's storage, under `mdview:workspace` |
| The place in a note | `mdview:read:<the note's address>` |
| The place in a PDF | `mdview:pdf:<the file's address>` |
| The desk, the width, the face | `mdview:theme`, `mdview:reading-width`, `mdview:font` |
| The dictionary's language, the voice | `mdview:lang`, `mdview:say` |
| The files opened recently | `mdview:recent` |

None of it is anywhere else, and the reader keeps nothing about the person who
reads (S-5, S-6).
