# Troubleshooting

The symptoms, and what they mean. Each one names the thing to look at.

## The reader's address does not answer

```bash
systemctl --user status mdview-reader.service
curl -s http://127.0.0.1:8765/healthz
```

| Symptom | Cause | What to do |
|---|---|---|
| `healthz` answers `ok` but the tab says *not found* | the tab is at an address the reader does not have — an old `/view/…` address from before the workspace | open the reader at `/` |
| `healthz` does not answer | the service is down | `systemctl --user start mdview-reader.service`, and read `journalctl --user -u mdview-reader.service` |
| The service restarts in a loop | the reader's own files are missing, or `roots.json` is not valid JSON | the journal says which; the file is `reader/roots.json` |

## A local file does not open in the reader

| Symptom | Cause | What to do |
|---|---|---|
| The file is still plain text | the extension is not installed, or is disabled | `about:addons`; the add-on is `mdview@example.com` |
| The file was downloaded instead of opened | the browser will not show that kind — Firefox hands a `.xlsx` to an application | open it from the reader's library, or with the *+* button |
| The file opened in the reader but says *That isn't in one of your folders* | the file is not under the reader's roots | the page offers to add the folder that holds it |

## A note looks wrong

| Symptom | Cause | What to do |
|---|---|---|
| A block of text where a table should be | a documented deviation | the list of the 51 is in `dev/AUDIT.md`; the score is `node dev/test/run.js` |
| Raw HTML shown as words | the allow-list does not have that tag (ADR-0006) | it is a safety rule, not a bug |
| The theme is the wrong one | the reader's choice and the system's choice disagree | the note's own **Theme** button; the choice is `mdview:theme` in the browser's storage |

## A word does not look up

| Symptom | Cause | What to do |
|---|---|---|
| The card says it could not reach the dictionary | the hosts cannot be reached, or the extension has not been allowed them | `about:addons` → the extension → permissions; the three hosts are `api.dictionaryapi.dev`, `api.datamuse.com` and `en.wiktionary.org` |
| The card says there is no entry in either dictionary | the word is not in the free dictionary and not in the thin one | the thin one is `api.datamuse.com`; a Spanish word is asked for in Spanish |
| The card did not open and nothing happened | the page cannot hold a card | the definition opens in a tab of the reader's own (F-14) |
| The card is in the wrong language | the language is automatic and it guessed | the library's **Settings** → *Dictionary language* |

## The window is empty or the tree is empty

| Symptom | Cause | What to do |
|---|---|---|
| The tree shows nothing | the folder it stands in is empty, or the filter is on | the funnel: the extension, the size or the date may be set; **Clear the filters** puts them back |
| The tree shows a folder that is not there | it was renamed or moved | click the arrow at the top to go up |
| A file does not appear in the tree | the tree lists the names as they are; a file with a name that begins with a dot is listed, but a *broken link* is passed over | — |

## A write is refused

| Symptom | Cause | What to do |
|---|---|---|
| *"That request didn't come from the reader's own pages."* | the origin or the token was missing (S-1) | the token changes when the reader restarts; reload the reader's page |
| *"That isn't in one of your folders."* | the change is outside the reader's roots | add the folder first, from the *+* on a folder's row |
| *"Only notes, pictures and spreadsheets can be added"* | the library keeps those kinds (F-23) | the refusal names them; the reader opens the other kinds, it just does not keep them |

## A PDF is slow or blank

| Symptom | Cause | What to do |
|---|---|---|
| The first pages are blank for a moment | the paint is made as the reader reaches the page (F-15) | it arrives |
| A page says *"This page could not be drawn."* | the page's paint failed | the rest of the file is unaffected |
| The reader uses a lot of memory on a long PDF | the engine holds up to 48 MiB of canvas and lets go of the pages behind | the budget is the engine's (`pdfview.js`) |

## The reader is slow

| Symptom | Cause | What to do |
|---|---|---|
| 3 % of a core with nobody reading | the background index walks the folders every twenty seconds (RNF-08) | it is in the backlog; the walk is the cause, not a fault |
| The tree is slow in a folder with many files | the listing is the names of one folder | the filter is the answer; the tree does not read the files (F-6) |

## Getting the numbers

The measurements and the method that produced them are in
[performance.md](performance.md).
