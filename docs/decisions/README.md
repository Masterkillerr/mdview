# The decisions

One record per decision that could reasonably have gone the other way, in the
format of Michael Nygard's "Documenting Architecture Decisions" (2011): the
context, the decision, the consequences.

The records say **why**; the [specification](../specification/) says **what**. A
rule in the specification that looks arbitrary should have a record behind it,
and the specification links to it.

| Record | Decision |
|---|---|
| [ADR-0001](0001-the-reader-is-a-server.md) | The reader is a server on the loopback, not a page in the browser |
| [ADR-0002](0002-the-extension-sends-the-file.md) | The extension sends the file to the reader instead of rendering it in place |
| [ADR-0003](0003-a-tab-is-the-readers-own-page.md) | A tab in the workspace is the reader's own page in a frame |
| [ADR-0004](0004-one-route-for-every-file.md) | One route for every file; the kind of the file decides the page |
| [ADR-0005](0005-the-corpus-is-the-ground-truth.md) | The corpus is the ground truth, and the failures are written down one by one |
| [ADR-0006](0006-a-note-cannot-run-script.md) | A note cannot run script |
| [ADR-0007](0007-the-dictionary-requests-go-through-the-background.md) | The dictionary requests go through the background script |
| [ADR-0008](0008-a-write-needs-the-origin-and-the-token.md) | A write needs the reader's origin and the reader's token |
| [ADR-0009](0009-the-tree-is-browsed-a-folder-at-a-time.md) | The tree is browsed a folder at a time, and the kind is decided by the name |
| [ADR-0010](0010-the-place-is-a-page-and-a-fraction.md) | The place in a document is a page and a fraction of a page |
