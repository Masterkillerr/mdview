# ADR-0008: A write needs the reader's origin and the reader's token

- Status: accepted
- Date: 2026-10-21

## Context

The reader writes to the disk: it adds, renames and deletes notes, makes
folders, and adds folders to its own list.

Any page in the browser can reach `http://127.0.0.1:8765`. A page on the
internet can make a request to it — that is what a page is allowed to do, and
the browser will not stop it, because it cannot know what is on the loopback.
A page that gets a write through would delete the reader's notes.

The obvious defence is to check the `Origin` header. It is not enough on its
own: the reader serves on three addresses (`mdview.localhost`, `127.0.0.1`
and `localhost`), and a page served from one of them — a page the reader
itself serves, but one that is not the reader — would pass the check.

## Decision

A write is a `POST` to `/api/…` and it is made only when **both** hold:

* the `Origin` header is one of the reader's own three addresses; and
* the `X-Mdview-Token` header carries the token the reader minted when it
  started.

The token is put in the head of every page the reader serves, as a `<meta>`,
and it is compared in constant time (S-1, P-5).

## Consequences

* A page on the internet cannot write: it has no origin the reader accepts,
  and it cannot read the token out of a page it does not own.
* The token changes when the reader restarts, so a page that was open
  yesterday cannot write today.
* The cost: every write carries two headers, and every page of the reader's
  own has to carry the token. The reader's own scripts read it out of the
  `<meta>`; nothing else knows it.
* The cost: the token is in the page, so a compromise of the reader's own
  page is a compromise of the reader. A note cannot cause one, because a
  note cannot run script (ADR-0006).
* The cost: the reader's own pages have to be same-origin with the API, or
  they have to send the origin — which they do, automatically, for a POST
  with a JSON body.
* The gap: the origin check is reasoned, not attacked. The interface suite
  checks that a write without the token is refused; nothing checks a write
  from a foreign origin, because making that test needs a page on another
  site.
