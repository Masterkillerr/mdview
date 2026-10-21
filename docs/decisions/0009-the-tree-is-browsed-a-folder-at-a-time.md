# ADR-0009: The tree is browsed a folder at a time, and the kind is decided by the name

- Status: accepted
- Date: 2026-10-21

## Context

The reader shows the folders the reader has. One of them is the home
directory, and the home directory holds about sixteen hundred names at its top
level, and tens of thousands below it.

Two decisions follow from that, and they pull in opposite directions.

**How much of the disk is listed at once.** A tree that shows everything is a
tree of tens of thousands of rows, and the browser has to build every one of
them before the reader sees anything. The reader's library had this problem
first: it built an index of every note in the background, every twenty seconds,
to answer a search — which is why the reader burns three per cent of a core
with nobody reading it (RNF-08).

**How the reader knows what a file is.** The tree wants to say "this is a
note", "this is a picture", "this is a source file" so that it can draw the
right mark and the filter can pick the right kind. The only way to know
whether an unknown file is text is to read its first bytes.

## Decision

**The tree is browsed one folder at a time.** The reader asks for the names
inside a folder and gets them; nothing walks the disk on the reader's behalf
without being asked (F-6, P-8). The folders above are reachable one level at
a time, so the tree can be pointed at any folder on the machine without any
of them being listed first.

**The kind is decided by the name.** `kind_of` looks at the suffix and says
`md`, `html`, `pdf`, `img`, `sheet` or `text`. Whether the bytes are text is
decided when the file is *opened*, which is the only time it matters: a file
with no engine opens as its own text, and one that is not text says so and
offers the file.

The background index stays, for the library's search, which is the one place
that needs every name at once.

## Consequences

* The tree is fast whatever the disk holds: the answer is the names of one
  folder, and the home directory's sixteen hundred names are one answer of
  8 KB and a millisecond.
* The reader's memory does not grow with the size of the disk: the tree's
  answers are held while the reader is in them and dropped when the reader
  moves away.
* The cost: the tree cannot search. Finding a file by name across every
  folder is the library's search, which walks the disk with a budget (F-24).
* The cost: the mark of a file in the tree is a guess from its name — a
  `.zip` shows as a file with no engine until it is opened, and then it says
  it is not text. The guess is right for every kind the reader has an engine
  for, which is every kind it draws.
* The cost: the tree holds one level of history per expanded folder. The
  reader's own home directory with every folder open is the worst case, and
  it is a few hundred kilobytes.
* The background index is still there, and it is still the reason the reader
  burns 3.1 % of a core with nobody reading it. Removing it — and letting the
  search walk every time — is in the backlog.
