# The model

The design of the system, drawn. The diagrams are not illustrations of the
specification: each one cites the rule it illustrates, and each of the
story's own diagrams cites its story, so that the drawing and the prose cannot
drift apart without a check failing.

The sources are [PlantUML](https://plantuml.com), and the drawings are laid out
the way the stories are:

```
model/
  general/            the system as a whole
  per-story/US-nn/    the diagrams of one story
  img/
    svg/…             the vector drawings — the ones the documents link to
    png/…             the raster drawings, at twice the scale, for the slides
```

The two formats live apart on purpose: the same diagram twice, side by side, is
one diagram too many.

`bash render.sh` renders every source into the mirrored place under `img/`,
and fails if any of them does not render — the render is a gate.

## The general set

The system as a whole, drawn once. These are the context every story is drawn
in.

| Type | Source | What it shows |
|---|---|---|
| Use case | [general/use-cases.puml](general/use-cases.puml) | The four actors against the thirteen use cases, from the outside |
| Class (domain) | [general/domain-class.puml](general/domain-class.puml) | The concepts, their attributes and their operations: a root, a folder, a file, a kind, a tab, a place, a choice |
| Class (design) | [general/design-class.puml](general/design-class.puml) | The objects the code holds — the workspace, its state, the tree's answer, a tab, a frame — and the interfaces they are given |
| Component | [general/component.puml](general/component.puml) | The components and the **interfaces** between them: the reader's HTTP interface, the extension's messages, a file's own page |
| Package | [general/package.puml](general/package.puml) | The **layers**, in the order they may depend on each other, and the dependencies allowed between them |
| Activity | [general/activity-write-a-change.puml](general/activity-write-a-change.puml) | A change on the disk, and every way it can be refused |
| Deployment | [general/deployment.puml](general/deployment.puml) | The service, the browser, the disk and the three dictionary hosts |
| Timing | [general/timing.puml](general/timing.puml) | The budget from the tab's address to the note on the screen |

## The per-story set

Each story is a slice of a goal, and the diagram that tells the story's story
is the one that suits it. Every story's folder holds the drawings of that
story, and nothing else.

| Story | Diagram | Source | What it shows |
|---|---|---|---|
| **US-01** Send the file the browser opens | sequence | [US-01/sequence-open-a-file.puml](per-story/US-01/sequence-open-a-file.puml) | The whole path, from the browser opening a local file to the note on the screen |
| | communication | [US-01/communication-open-a-file.puml](per-story/US-01/communication-open-a-file.puml) | The same opening, arranged by the objects: which know about the file, and which are only told |
| **US-03** A note is rendered and read | activity | [US-03/activity-render-a-note.puml](per-story/US-03/activity-render-a-note.puml) | The rendering of a note, and where it branches |
| | sequence | [US-03/sequence-render-a-note.puml](per-story/US-03/sequence-render-a-note.puml) | The bytes, the parse, and the place being kept |
| **US-04** A file opens in a tab | state | [US-04/state-file-in-the-workspace.puml](per-story/US-04/state-file-in-the-workspace.puml) | The states of a file in the window: closed, open, held |
| **US-06** Browse the folders | activity | [US-06/activity-browse-the-tree.puml](per-story/US-06/activity-browse-the-tree.puml) | The tree, one folder at a time, and the way up |
| **US-07** Filter the tree | activity | [US-07/activity-filter-the-tree.puml](per-story/US-07/activity-filter-the-tree.puml) | The filters, and what each of them keeps |
| **US-12** A word is looked up | sequence | [US-12/sequence-look-up-a-word.puml](per-story/US-12/sequence-look-up-a-word.puml) | The card, the background script, and the three hosts |
| **US-13** A PDF is read | sequence | [US-13/sequence-read-a-pdf.puml](per-story/US-13/sequence-read-a-pdf.puml) | The boxes first, the paints second, the tools, and the hand |
| **US-14** A picture is looked at closely | sequence | [US-14/sequence-look-at-a-picture.puml](per-story/US-14/sequence-look-at-a-picture.puml) | The picture at its own pixels, the zoom about the pointer, and the hand |
| **US-16** Organise the library, set the preferences | communication | [US-16/communication-organise-the-library.puml](per-story/US-16/communication-organise-the-library.puml) | The objects that take part: the page asks, the reader decides, the disk holds, the browser's storage keeps |
| **US-17** A note is found by name | activity | [US-17/activity-find-a-note.puml](per-story/US-17/activity-find-a-note.puml) | The walk with a budget, the index behind it, and which answer it gave |
| **US-18** A file from outside the folders | sequence | [US-18/sequence-open-a-file-outside.puml](per-story/US-18/sequence-open-a-file-outside.puml) | The offer, and the two ways forward |

The requirements these diagrams realise are in
[../analysis/requirements.md](../analysis/requirements.md); the stories are in
[../analysis/stories.md](../analysis/stories.md); the rules they illustrate
are in [../specification/](../specification/); the decisions behind them are in
[../decisions/](../decisions/).

## Notation

| Element | Meaning |
|---|---|
| `«external»` | An actor or a system outside the software |
| `«interface»` | A contract with several implementations |
| `#` | A protected attribute |
| `+` / `-` | A public / private operation |
| a vertical bar in a sequence | The call in progress — the object is busy |
| a note on an element | a rule that the element must obey |
| a dashed arrow | a request that is asked for and answered, not a change |

## A note on the tooling

The PlantUML these are written in is an old one, and four of its habits are
worth knowing before changing a diagram:

* an arrow between two **packages** needs an alias (`package "A" as A`), or it
  is a syntax error;
* a **semicolon** in a label ends the statement;
* in a **sequence** diagram an `alt` is closed with `end` and not `endif`,
  `note bottom of` is not understood, and a label that starts with a quote is
  a syntax error;
* the **timing diagram** does not render at all (it throws in the ruler), which
  is why the budget is drawn as a sequence with the times on the messages.

`render.sh` is the gate: it fails if any diagram does not render, so a broken
one cannot be committed silently.
