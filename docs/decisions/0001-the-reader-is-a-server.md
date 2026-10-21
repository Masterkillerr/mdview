# ADR-0001: The reader is a server on the loopback, not a page in the browser

- Status: accepted
- Date: 2026-10-21

## Context

The reader shows a person's own files: markdown notes, PDFs, spreadsheets and
pictures. The files live on the disk, and they are read from the disk.

The browser can show a `file://` page, and the extension can render a
markdown file in place — that is what the Chrome variant of this add-on does,
and it works. But three things cannot be done from a `file://` page:

* **it cannot list a folder.** There is no API for "what is in this directory"
  on a `file://` origin; the browser will not let a page read the disk at all,
  and it will not let it read a sibling file without a permission the reader
  has to grant per directory.
* **it cannot be a server for another page.** The reader's own pages — the
  workspace, the library — need to fetch the file's bytes and the folders'
  names from somewhere.
* **it cannot be reached by the extension's background script** in a way that
  survives the reader closing the tab.

Firefox's own local-file access is an opt-in since version 153, and it is
per-directory; a reader that showed the whole home folder would ask for every
directory in it.

## Decision

There is one reader, and it is a **server on the loopback**: a Python program
bound to `127.0.0.1:8765`, started by systemd, serving pages that fetch their
bytes from it.

The browser's `file://` origin is used for exactly one thing: the file the
reader is asked to open, so that the extension can see its address.

## Consequences

* The reader can list folders, because it is a program with a filesystem, not
  a page with a sandbox.
* Every page of the reader's own — the workspace, the library, a note, a PDF —
  is served by the same origin, so they can fetch from it without the
  cross-origin dance that a `file://` page would need.
* The extension can write to the reader: one URL, one method, one contract
  ([the interface](../specification/02-interfaces.md)).
* The cost: a process that has to be running. It is started by systemd and
  restarts itself, so it is running when the reader is; and the reader opens
  a tab that says so when it is not.
* The cost: the reader has to be careful about who may write to it, because a
  page in the same browser can reach `127.0.0.1` (ADR-0008).
* The cost: the reader is not portable to a machine without Python 3, which is
  why the Chrome variant does the other thing.
