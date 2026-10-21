# ADR-0005: The corpus is the ground truth, and the failures are written down one by one

- Status: accepted
- Date: 2026-10-21

## Context

The renderer was a single-pass loop of regular expressions. It read a note and
produced HTML that looked right on the notes the reader had, and it got a
number of things wrong that the reader had not noticed: a paragraph was split
at every source line, emphasis was decided by a regular expression rather than
by the delimiter rules, and a list item could swallow its parent.

The rules are not the reader's memory of how markdown works. CommonMark 0.31.2
is a specification with 652 examples, each with its reference HTML. It is the
ground truth, and it is public.

The alternative — writing the rules down and testing against what seemed
right — is how the reader ended up with a renderer that looked fine and was
wrong in ways nobody could point at.

## Decision

The renderer is measured against the **official corpus**, and the suite is the
gate: `node dev/test/run.js` renders all 652 examples plus the
reader's own fixtures and diffs the canonical HTML.

Where the renderer differs from the corpus, the difference is **written down,
one by one**, with the reason. There are 51 of them, and the suite reports
them as *documented* rather than as failures to be fixed, so that a change
that adds a fifty-second is noticed.

## Consequences

* The score is a number that can be compared: 601 of 652 today, 92.2 %.
  Before the rewrite it was 152.
* The 51 deviations are a list of decisions, not a list of bugs: a heading
  under a list item, an HTML block that ends early, a link reference that is
  not matched. Each one is in
  [the audit](../../../dev/AUDIT.md).
* The fixtures add the reader's own extensions — GFM tables, task items,
  frontmatter chips, the safety rules — because the corpus says nothing about
  them.
* The cost: the suite takes a few seconds, and the renderer is bigger than
  the one it replaced. The rewrite was worth it: the reader reads a lot of
  markdown written by other people.
* The cost: a deviation is now a promise. Anyone who fixes one has to remove
  it from the list, and the suite's count has to agree with the list.
* The corpus is the vendor here, not the hand-written golden file (Q-2).
