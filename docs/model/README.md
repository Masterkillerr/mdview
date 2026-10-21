# The model

The design of the system, drawn. The diagrams are not illustrations of the
specification: each one cites the rule it illustrates, and each unit's own
diagrams cite its unit, so that the drawing and the prose cannot drift apart
without a check failing.

The sources are [PlantUML](https://plantuml.com), and the drawings are laid out
the way the units are:

```
model/
  general/            the system as a whole
  per-use-case/UC-nn/ the drawings of one use case
  per-story/US-nn/    the drawings of one story
  img/
    svg/…             the vector drawings — the ones the documents link to
    png/…             the raster drawings, at twice the scale, for the slides
```

The two formats live apart on purpose: the same diagram twice, side by side, is
one diagram too many.

`bash render.sh` renders every source into the mirrored place under `img/`,
and fails if any of them does not render — the render is a gate.

**Every unit has a drawing of its own.** A use case is a goal and a story is a
slice of one, and neither is written down without a picture of it: the drawing
is where the flow, the states or the conversation are visible, and the prose
points at it. The kind is chosen to suit the unit — a sequence for a
conversation, an activity for a flow with branches, a state machine for a thing
that has states, a communication for a collaboration — and the choice is
recorded in the unit's own description.

The **vectors** are the drawings: they are text, and a change in them is a
change in the model. The **rasters** are made from the vectors, and their
bytes depend on the machine's fonts and its rasteriser, so they are checked
for being made, not for being identical. The layout itself depends on the
version of PlantUML, so the gate is that every diagram draws — not that it
draws the same bytes on every machine.

## The general set

The system as a whole, drawn once. These are the context every unit is drawn
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

## The per-use-case set

Each use case is a goal, and the drawing is the goal as a whole.

| Use case | Diagram | Source |
|---|---|---|
| **UC-01** Open a local file in the workspace | activity | [UC-01/activity-open-a-local-file.puml](per-use-case/UC-01/activity-open-a-local-file.puml) |
| **UC-02** Read a note | activity | [UC-02/activity-read-a-note.puml](per-use-case/UC-02/activity-read-a-note.puml) |
| **UC-03** Browse the folders | activity | [UC-03/activity-browse-the-folders.puml](per-use-case/UC-03/activity-browse-the-folders.puml) |
| **UC-04** Open a file in a tab | activity | [UC-04/activity-open-a-file-in-a-tab.puml](per-use-case/UC-04/activity-open-a-file-in-a-tab.puml) |
| **UC-05** Look a word up | activity | [UC-05/activity-look-a-word-up.puml](per-use-case/UC-05/activity-look-a-word-up.puml) |
| **UC-06** Read a PDF | activity | [UC-06/activity-read-a-pdf.puml](per-use-case/UC-06/activity-read-a-pdf.puml) |
| **UC-07** Look at a picture | activity | [UC-07/activity-look-at-a-picture.puml](per-use-case/UC-07/activity-look-at-a-picture.puml) |
| **UC-08** Read a spreadsheet | activity | [UC-08/activity-read-a-spreadsheet.puml](per-use-case/UC-08/activity-read-a-spreadsheet.puml) |
| **UC-09** Organise the library | activity | [UC-09/activity-organise-the-library.puml](per-use-case/UC-09/activity-organise-the-library.puml) |
| **UC-10** Find a note | activity | [UC-10/activity-find-a-note.puml](per-use-case/UC-10/activity-find-a-note.puml) |
| **UC-11** Add a folder to the reader | activity | [UC-11/activity-add-a-folder.puml](per-use-case/UC-11/activity-add-a-folder.puml) |
| **UC-12** Open a file from outside the folders | activity | [UC-12/activity-open-a-file-outside.puml](per-use-case/UC-12/activity-open-a-file-outside.puml) |
| **UC-13** Set the reader's preferences | activity | [UC-13/activity-set-the-preferences.puml](per-use-case/UC-13/activity-set-the-preferences.puml) |

## The per-story set

Each story is a slice of a goal, and the drawing is the slice in detail.

| Story | Diagram | Source |
|---|---|---|
| **US-01** Send the file the browser opens | sequence, communication | [US-01/sequence-open-a-file.puml](per-story/US-01/sequence-open-a-file.puml), [US-01/communication-open-a-file.puml](per-story/US-01/communication-open-a-file.puml) |
| **US-02** The window: folders on the left, tabs along the top | sequence | [US-02/sequence-the-window-opens.puml](per-story/US-02/sequence-the-window-opens.puml) |
| **US-03** A note is rendered and read | activity, sequence | [US-03/activity-render-a-note.puml](per-story/US-03/activity-render-a-note.puml), [US-03/sequence-render-a-note.puml](per-story/US-03/sequence-render-a-note.puml) |
| **US-04** A file opens in a tab | state | [US-04/state-file-in-the-workspace.puml](per-story/US-04/state-file-in-the-workspace.puml) |
| **US-05** The window comes back as it was left | sequence | [US-05/sequence-the-window-comes-back.puml](per-story/US-05/sequence-the-window-comes-back.puml) |
| **US-06** Browse the folders | activity | [US-06/activity-browse-the-tree.puml](per-story/US-06/activity-browse-the-tree.puml) |
| **US-07** Filter the tree | activity | [US-07/activity-filter-the-tree.puml](per-story/US-07/activity-filter-the-tree.puml) |
| **US-08** Point the tree at a folder | activity | [US-08/activity-point-the-tree-at-a-folder.puml](per-story/US-08/activity-point-the-tree-at-a-folder.puml) |
| **US-09** A file with no engine opens as its text | activity | [US-09/activity-a-file-with-no-engine.puml](per-story/US-09/activity-a-file-with-no-engine.puml) |
| **US-10** A file opened once is kept for two hours | activity | [US-10/activity-a-file-opened-once.puml](per-story/US-10/activity-a-file-opened-once.puml) |
| **US-11** The place the reader reached is kept | sequence | [US-11/sequence-the-place-is-kept.puml](per-story/US-11/sequence-the-place-is-kept.puml) |
| **US-12** A word is looked up | sequence | [US-12/sequence-look-up-a-word.puml](per-story/US-12/sequence-look-up-a-word.puml) |
| **US-13** A PDF is read | sequence | [US-13/sequence-read-a-pdf.puml](per-story/US-13/sequence-read-a-pdf.puml) |
| **US-14** A picture is looked at closely | sequence | [US-14/sequence-look-at-a-picture.puml](per-story/US-14/sequence-look-at-a-picture.puml) |
| **US-15** A spreadsheet is read | activity | [US-15/activity-read-a-spreadsheet.puml](per-story/US-15/activity-read-a-spreadsheet.puml) |
| **US-16** Organise the library, set the preferences | communication | [US-16/communication-organise-the-library.puml](per-story/US-16/communication-organise-the-library.puml) |
| **US-17** A note is found by name | activity | [US-17/activity-find-a-note.puml](per-story/US-17/activity-find-a-note.puml) |
| **US-18** A file from outside the folders | sequence | [US-18/sequence-open-a-file-outside.puml](per-story/US-18/sequence-open-a-file-outside.puml) |

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
