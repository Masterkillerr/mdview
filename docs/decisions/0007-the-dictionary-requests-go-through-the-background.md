# ADR-0007: The dictionary requests go through the background script

- Status: accepted
- Date: 2026-10-21

## Context

The card that shows a word's meanings is a panel of JavaScript that lives in
the page the reader was looking at. It has to ask a dictionary what the word
means.

A page's own `fetch` is the **page's** fetch. It is subject to the page's
content security policy, to whatever cross-origin headers the dictionary
happens to send, and to the origin the page is on — which, for a note read
from the disk, is a `file://` origin where a cross-origin request is opaque
and a blocked one is silent.

From the extension's background script the same request carries the add-on's
host permissions, and neither the page's policy nor the dictionary's headers
decide anything.

The alternative — the card fetches the dictionary itself — fails in a way that
is hard to diagnose: the card works on one site, does nothing on another, and
the reason is a header.

## Decision

The card asks the **background script** for the word, and the background
script asks the dictionary (F-11, S-3). The background script answers only
for the three hosts the extension declares, and it checks the URL before it
makes the request, not after (S-2, P-9).

The reader's own pages — the workspace, the library — are same-origin with
the reader, but they still ask the background script, so that there is one
path for a word and one place where the hosts are listed.

## Consequences

* One place holds the permissions, the host list and the request shape.
* The card works the same in a note, in a PDF's text layer and in the
  reader's own pages, because the request does not depend on the page.
* The cost: the lookup is a round trip through the extension. On a page the
  extension cannot reach — the reader's own `127.0.0.1` origin, for
  instance, which the extension has no permission for — the card falls back
  to a tab of the reader's own (F-14).
* The cost: the extension declares the three hosts in its manifest, and
  Firefox will ask the reader to allow them. That is a permission prompt for
  three dictionary hosts, and it is the price of the card working on any
  page.
* The cost: the definition tab (`define.html`) asks the background script
  too, so that the same word in the same reader answers the same way.
