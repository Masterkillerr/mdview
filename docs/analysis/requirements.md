# Requirements catalogue and traceability

What the system must do, who needs it, and where each requirement is realised
and proved. The normative behaviour is in the
[specification](../specification/); this document is the index that connects a
requirement to the use case that covers it, the story that delivers it, the
element that implements it and the test that proves it.

The evidence these requirements come from is in [evidence.md](evidence.md).

## 1. Actors

| Actor | Kind | Description |
|---|---|---|
| `Reader` | Human | The person whose notes these are. Reads them, looks words up, organises them, and reads the PDFs and the pictures among them. |
| `Browser` | External system | Firefox, or the Edge window the reader opens the app in. Hosts the extension, the reader's pages, and the browser's own storage. |
| `Dictionaries` | External system | `api.dictionaryapi.dev`, `api.datamuse.com` and `en.wiktionary.org`. The only hosts the reader talks to. |
| `Disk` | External system | The filesystem: the notes, the PDFs, the spreadsheets and the pictures the reader shows, and the folders it is allowed to show. |

## 2. Functional requirements

| ID | Requirement | Priority | Source |
|---|---|---|---|
| RF-01 | The extension must send a local file the browser opens to the reader's workspace, with the file named in the address. | Must | UC-01 |
| RF-02 | The reader must render CommonMark 0.31 with the GFM extensions it declares: tables, task items, strikethrough, autolinks, footnotes and frontmatter chips. | Must | UC-02 |
| RF-03 | The reader must open every file it can: markdown, HTML, PDF, pictures and spreadsheets with their own engines, and every other file as its own text. | Must | UC-02, UC-07, UC-08 |
| RF-04 | The reader must refuse, in words the reader can act on, a file it cannot open. | Must | UC-12 |
| RF-05 | The workspace must show the folders on the left, the open files along the top and the document in the middle. | Must | UC-03 |
| RF-06 | The workspace must open a file in a tab, and a second file in a second tab, without disturbing the first. | Must | UC-04 |
| RF-07 | The workspace must keep its state — the folder the tree is rooted at, the open files, the filters — across a reload. | Must | UC-04 |
| RF-08 | The workspace must browse any folder on the machine, one folder at a time, and must say plainly when a folder cannot be shown. | Must | UC-03 |
| RF-09 | The workspace must filter the tree by name, by kind, by extension, by size and by when the file was last touched. | Should | UC-03 |
| RF-10 | The workspace must let the reader point the tree at any folder, and add a folder to the reader's own. | Should | UC-11 |
| RF-11 | The reader must keep the place the reader had reached in a note and in a PDF, and reopen the file there. | Must | UC-02, UC-06 |
| RF-12 | The reader must let a word be looked up by double-clicking it, in a note, in a PDF, and in a page of the reader's own. | Must | UC-05 |
| RF-13 | The dictionary requests must be made by the background script, and only for the three hosts the extension declares. | Must | UC-05 |
| RF-14 | The reader must open a file that is not in one of its folders by offering to add the folder that holds it. | Should | UC-12 |
| RF-15 | The library must add, rename and delete notes and pictures, and make folders, inside the reader's folders. | Should | UC-09 |
| RF-16 | The library must find a note by its name in any folder under the reader's roots. | Should | UC-10 |
| RF-17 | The PDF view must paint the pages near the reader, and must let the reader turn pages and zoom. | Must | UC-06 |
| RF-18 | The picture view must show a picture at its own pixels, and must let the reader move it and zoom it. | Must | UC-07 |
| RF-19 | The spreadsheet view must show a workbook's grid and a CSV's table. | Must | UC-08 |
| RF-20 | The reader must keep the reader's own choices — the light, dark or warm desk, the reading width, the face and the dictionary language — and must offer them in every page. | Must | UC-13 |
| RF-21 | The reader must be able to speak a word aloud from the lookup card. | Should | UC-05 |
| RF-22 | The reader must refuse a write that did not come from its own pages, with the reason. | Must | UC-09, UC-11 |
| RF-23 | The reader must not run the script of a note it did not write. | Must | UC-02 |
| RF-24 | The reader must not send anything off the machine except the dictionary requests. | Must | UC-05 |
| RF-25 | The extension must define a selected word on any page: in a card on that page where the page allows it, and in a tab where it does not. | Must | UC-05 |
| RF-26 | The reader must keep the files it has opened recently, with the place each was reached. | Should | UC-02 |
| RF-27 | The reader must keep the reader's own choices and the reader's place in the browser, and nowhere else. | Must | UC-13 |
| RF-28 | A picture in a note must open in the picture view when it is clicked. | Should | UC-07 |

## 3. Non-functional requirements

Each of these carries a measure, and each measure is either measured or named as
a target. The method is in
[../operations/performance.md](../operations/performance.md).

| ID | Requirement | Measure | Priority |
|---|---|---|---|
| RNF-01 | The workspace's answer for a folder of 100 entries | ≤ 50 ms | Must |
| RNF-02 | The reader's memory while reading | ≤ 64 MiB resident | Must |
| RNF-03 | The renderer's score against the CommonMark 0.31.2 corpus | ≥ 90 % | Must |
| RNF-04 | The time from the tab's address being written to the note being on the screen | ≤ 1.5 s | Must |
| RNF-05 | The PDF view's canvas, held at once | ≤ 48 MiB | Must |
| RNF-06 | What leaves the machine | the three dictionary hosts, and nothing else | Must |
| RNF-07 | The interface suite's run | ≤ 60 s | Should |
| RNF-08 | The reader's CPU while nobody is reading | ≤ 1 % of a core | Should |

## 4. Use cases

Every one of these is described, in full, in
[use-case-descriptions.md](use-case-descriptions.md).

| ID | Use case | Actor | Requirements |
|---|---|---|---|
| UC-01 | Open a local file in the workspace | Reader | RF-01 |
| UC-02 | Read a note | Reader | RF-02, RF-03, RF-11, RF-23, RF-26 |
| UC-03 | Browse the folders | Reader | RF-05, RF-08, RF-09 |
| UC-04 | Open a file in a tab | Reader | RF-06, RF-07 |
| UC-05 | Look a word up | Reader | RF-12, RF-13, RF-21, RF-24, RF-25 |
| UC-06 | Read a PDF | Reader | RF-11, RF-17 |
| UC-07 | Look at a picture | Reader | RF-03, RF-18 |
| UC-08 | Read a spreadsheet | Reader | RF-03, RF-19 |
| UC-09 | Organise the library | Reader | RF-15, RF-22 |
| UC-10 | Find a note | Reader | RF-16 |
| UC-11 | Add a folder to the reader | Reader | RF-10, RF-22 |
| UC-12 | Open a file from outside the reader's folders | Reader | RF-04, RF-14 |
| UC-13 | Set the reader's preferences | Reader | RF-20, RF-27 |

## 5. Traceability matrix

Every requirement points at the use case that covers it, the story that
delivers it, the element that implements it and the test that proves it. A row
without a test is a plan, not a fact: the **state** column says which, and
`planned` is written down rather than left blank.

The tests are named as they are run: `@test/run.js@` is the corpus suite,
`@test/ui.py::test_…@` is the interface suite.

| Requirement | Use case | Story | Design element | Test | State |
|---|---|---|---|---|---|
| RF-01 | UC-01 | US-01 | @refresh.js:readerUrl@ | — | planned |
| RF-02 | UC-02 | US-03 | @mdview.js:renderMarkdown@ | @test/run.js@ (the corpus, 652 examples) | verified |
| RF-03 | UC-02, UC-07, UC-08 | US-09, US-10 | @server.py:_viewer@ | @test/ui.py::test_a_file_with_no_engine_opens_as_its_text@, @test/ui.py::test_a_picture_opens_at_its_own_size@, @test/ui.py::test_a_pdf_opens_with_its_page_tools@ | verified |
| RF-04 | UC-12 | US-18 | @server.py:error_page@ | @test/ui.py::test_a_file_outside_the_folders_offers_to_add_its_folder@ | verified |
| RF-05 | UC-03 | US-02 | @workspace.js:paintTree@ | @test/ui.py::test_the_window_opens_with_the_folders_on_the_left@ | verified |
| RF-06 | UC-04 | US-04 | @workspace.js:openFile@ | @test/ui.py::test_a_file_opens_in_a_tab@ | verified |
| RF-07 | UC-04 | US-05 | @workspace.js:save@ | @test/ui.py::test_the_tabs_come_back_after_a_reload@ | verified |
| RF-08 | UC-03 | US-06 | @server.py:tree_entries@ | @test/ui.py::test_going_up_moves_the_tree_one_level@ | verified |
| RF-09 | UC-03 | US-07 | @workspace.js:visible@ | @test/ui.py::test_the_tree_filters_by_kind@, @test/ui.py::test_the_filter_panel_filters_by_extension@ | verified |
| RF-10 | UC-11 | US-08 | @workspace.js:openFolderMenu@ | @test/ui.py::test_the_three_dots_reposition_the_tree@ | verified |
| RF-11 | UC-02, UC-06 | US-11, US-13 | @mdview.js:docKey@, @pdfview.js:place@ | @test/ui.py::test_the_reading_place_is_kept@ | verified |
| RF-12 | UC-05 | US-12 | @lookup.js:attach@ | — | partial |
| RF-13 | UC-05 | US-12 | @refresh.js:allowedDefineUrl@ | — | partial |
| RF-14 | UC-12 | US-18 | @server.py:adopt_page@ | @test/ui.py::test_a_file_outside_the_folders_offers_to_add_its_folder@ | verified |
| RF-15 | UC-09 | US-16 | @server.py:do_rename@ | — | partial |
| RF-16 | UC-10 | US-17 | @server.py:search_files@ | — | partial |
| RF-17 | UC-06 | US-13 | @pdfview.js:controls@ | @test/ui.py::test_a_pdf_opens_with_its_page_tools@ | verified |
| RF-18 | UC-07 | US-14 | @imageview.js:zoomTo@ | @test/ui.py::test_a_picture_opens_at_its_own_size@ | verified |
| RF-19 | UC-08 | US-15 | @sheet.js@ | — | partial |
| RF-20 | UC-13 | US-16 | @mdview.js:applyTheme@ | — | partial |
| RF-21 | UC-05 | US-12 | @lookup.js:speak@ | — | partial |
| RF-22 | UC-09, UC-11 | US-18 | @server.py:do_POST@ | @test/ui.py::test_a_write_without_the_token_is_refused@ | verified |
| RF-23 | UC-02 | US-03 | @mdview.js:rawHtml@ | @test/run.js@ (the raw-HTML fixtures) | verified |
| RF-24 | UC-05 | US-12 | @refresh.js:DEFINE_HOSTS@ | — | partial |
| RF-25 | UC-05 | US-12 | @refresh.js:menus.onClicked@ | — | planned |
| RF-26 | UC-02 | US-11 | @server.py:recent_recorder@ | @test/ui.py::test_the_reading_place_is_kept@ | verified |
| RF-27 | UC-13 | US-16 | @workspace.js:save@ | @test/ui.py::test_the_tabs_come_back_after_a_reload@ | verified |
| RF-28 | UC-07 | US-14 | @mdview.js:the image click@ | @test/ui.py::test_a_picture_in_a_note_opens_in_the_picture_view@ | verified |
| RNF-01 | UC-03 | US-02 | @server.py:tree_entries@ | @operations/performance.md@ (1.0 ms median) | verified |
| RNF-02 | UC-03 | US-02 | @server.py@ | @operations/performance.md@ (33.0 MiB) | verified |
| RNF-03 | UC-02 | US-03 | @mdview.js@ | @test/score-backup.js@ (601/652) | verified |
| RNF-04 | UC-01 | US-01 | @server.py:workspace@ | @operations/performance.md@ (0.09 s median) | verified |
| RNF-05 | UC-06 | US-13 | @pdfview.js:BUDGET@ | — | partial |
| RNF-06 | UC-05 | US-12 | @refresh.js:allowedDefineUrl@ | — | partial |
| RNF-07 | UC-03 | US-02 | @test/ui.py@ | @test/ui.py@ (41.4 s) | verified |
| RNF-08 | UC-03 | US-02 | @server.py:build_index@ | @operations/performance.md@ (3.1 % of a core, idle) | partial |

The rows that are **partial** are the ones where the behaviour exists and is
exercised by hand but has no test that would fail if it broke. The row that is
**planned** (RF-01) is the one the interface suite cannot reach: it is the
extension's behaviour, and the suite drives the reader, not the browser's
add-on machinery.

## 6. The gaps

Written down, because the matrix is only as good as its honesty.

| Requirement | Status | Note |
|---|---|---|
| RF-01 (the extension's send) | planned | The send is exercised by hand every day; no test drives the extension in a browser. The address it builds is one line, and it is the seam between the two halves of the system. |
| RF-12, RF-13, RF-21, RF-24, RF-25 (the lookup) | partial | The card works — it was driven by hand against the dictionary hosts — but no test covers the injection, the host allow-list or the speech. |
| RF-15, RF-16, RF-19, RF-20 (the library, the search, the spreadsheets, the preferences) | partial | Each is a page the reader shows and each works, but none has a test that would fail if it broke. |
| RF-25 | planned | The Chrome variant's behaviour is not covered at all, and its renderer is a copy rather than the same file. |
| RNF-05 | partial | The canvas budget is enforced by the engine and reported in the code, but nothing measures it under a long document. |
| RNF-08 | partial | Measured 3.1 % of a core with nobody reading: the background index walks the folders every 20 s, and the workspace's tree does not need that index at all. It is in the backlog. |
| — | missing | The parsers are not fuzzed. The markdown parser is measured against the corpus, not against garbage. |
| — | missing | The workbook reader has no tests beyond opening one. |
| — | missing | Nothing measures the reader's memory over time. One sample after an afternoon is not a soak. |
