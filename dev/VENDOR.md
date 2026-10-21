# Vendored engine assets

`bin/mdview-ext` holds the renderers the reader serves: pdf.js, mermaid and KaTeX.
They are not packaged in `mdview.xpi` — the extension only redirects files to
`~/mdview-app/server.py`, which serves these from `ENGINE_FILES` / `ENGINE_DIRS`
at `/static`. Nothing in this repository would notice if one of them drifted,
rotted, or was edited without the edit being written down, so:

```sh
node bin/mdview-dev/check-vendor.js              # offline: digests vs vendor-manifest.json
node bin/mdview-dev/check-vendor.js --upstream   # fetch the packages and diff (network)
node bin/mdview-dev/check-vendor.js --interfaces # wasm imports/exports vs recorded baseline
node bin/mdview-dev/check-vendor.js --record     # after a deliberate upgrade
```

The offline check runs from `build.sh`, like the stylesheet check: a drift stops
the build rather than shipping an engine whose only symptom is one document type
rendering wrong. Everything is recorded in `vendor-manifest.json`, which is the
single source of truth for what came from where.

## What is vendored

| Asset | From | State |
| --- | --- | --- |
| `pdf.mjs`, `pdf.worker.mjs` | pdfjs-dist 6.3.289 | patched (2 and 4 hunks) |
| `wasm/`, `cmaps/`, `standard_fonts/`, `pdfjs-LICENSE` | pdfjs-dist 6.3.289 | stock |
| `mermaid.min.js` | mermaid 11.16.0 | stock, byte-identical |
| `katex/katex.min.js`, `katex/LICENSE` | katex 0.16.11 | stock |
| `katex/katex.min.css` | katex 0.16.11 | patched (1 hunk) |
| `katex/fonts/` | katex 0.16.11 | intentional subset (20 of 60 files) |

## The local patches

Everything below is the *entire* difference between these files and their
upstream packages. On an upgrade, re-apply exactly this.

**1. `Map.prototype.getOrInsert` / `getOrInsertComputed` polyfill** — prepended to
`pdf.mjs` and `pdf.worker.mjs`. pdf.js 6.3 requires these (V8 13.4+ / Chrome
134+); the reader runs on Electron/Chrome 130.

```js
if (typeof Map.prototype.getOrInsert !== "function") {
  Map.prototype.getOrInsert = function (key, value) {
    if (this.has(key)) return this.get(key);
    this.set(key, value);
    return value;
  };
}
if (typeof Map.prototype.getOrInsertComputed !== "function") {
  Map.prototype.getOrInsertComputed = function (key, makeValue) {
    if (this.has(key)) return this.get(key);
    const value = makeValue(key);
    this.set(key, value);
    return value;
  };
}
```

**2. `toHex()` in `pdf.worker.mjs`**, replacing the `Uint8Array#toHex()` the ESM
build omits, and the one call site that used it:

```js
function toHex(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}
```

```js
return shadow(this, "fingerprints", [toHex(hashOriginal), hashModified ? toHex(hashModified) : null]);
```

Without it any PDF with a trailer `/ID` — that is, every real PDF — fails to load
with `n.toHex is not a function`.

**3. `katex.min.css`**: every `@font-face` keeps only its `.woff2` source; the
`woff` and `truetype` fallbacks are dropped, which is why `katex/fonts/` keeps
only the 20 `.woff2` faces. The manifest records this folder as `mode: "subset"`,
so `--upstream` requires every file present locally to match upstream byte for
byte while treating the omitted ones as intentional.

**4.** The trailing `//# sourceMappingURL=` comment is removed from both pdf.js
bundles, since the maps are not shipped.

## Upgrading a vendored package

1. Bump `packages.<name>.version` (and any `version` on the assets) in
   `vendor-manifest.json` and drop the cached upstream copy:
   `rm -rf ~/.cache/mdview-vendor/<name>@<old>`.
2. Copy the new files into `bin/mdview-ext`.
3. Re-apply the patches above, in this order — polyfill first, then the file's own
   edits — then `--record --upstream`, which writes fresh digests and hunk counts.
   Read its `rec` lines: they are the record of how far the new copy differs.
4. `--record --interfaces` to refresh the wasm boundary baseline, then
   `--upstream` and `--interfaces` once more to confirm a clean run.

## The wasm boundary baseline

`wasm_modules` in the manifest records each decoder's sha256 plus the parts of
`wasm-objdump -x` that describe its boundary: imports, exports, memory limits.
That is what makes a decoder upgrade reviewable — a changed import list or a
memory maximum that is now unbounded shows up as a diff instead of being buried
in a binary. `--interfaces` needs wabt's `wasm-objdump` (`WABT_BIN_DIRECTORY`, or
on `PATH`; the distro package is enough for this, no exact version pinned).

## Findings and open questions

- `wasm/quickjs-eval.js` and `wasm/quickjs-eval.wasm` (≈475 KiB) are referenced by
  nothing the reader loads: the only `.wasm` names in `pdf.mjs` / `pdf.worker.mjs`
  are `jbig2.wasm`, `openjpeg.wasm` and `qcms_bg.wasm`. They are kept stock and
  recorded rather than deleted — the reader passes `wasmUrl`, and pdf.js may still
  reach the sandbox on a code path that does not name the file literally.
  `grep -ri quickjs bin/mdview-ext --include='*.js' --include='*.mjs'` re-checks it,
  and the journal measurement below confirms it has never been requested.
- `mermaid.min.js` is the 3.5 MB single-file bundle. Mermaid also ships
  `dist/mermaid.esm.min.mjs` (29.8 KiB) plus a `dist/chunks/` pool loaded per
  diagram type. That trades one big file for many small ones plus dynamic
  imports, which suits a server-served reader but not a single-file drop.
- The ~128 KiB of `vscode-jsonrpc` / `vscode-languageserver-*` inside that bundle
  is a transitive dependency of langium, mermaid's parser framework for its
  railroad/peg/gitGraph diagrams. It looks removable and is not.

## What the journal says

The reader is a systemd user service, so its request log is a free record of which
engine files real documents actually pull. Over 2026-10-08 → 2026-10-18, 16 PDFs
and 18 math documents:

```sh
journalctl --user -u mdview-reader.service -o cat --since "30 days ago" \
  | grep -o -E '/static/[a-zA-Z0-9_./-]+' | sort | uniq -c | sort -rn
```

| Requested | Never requested |
| --- | --- |
| `pdf.mjs`, `pdf.worker.mjs` (16 each) | `cmaps/*` (1.7 MB, 169 files) |
| `qcms_bg.wasm` (once) | `standard_fonts/*` (820 KB, 16 files) |
| `katex/katex.min.js`, `.min.css`, and 5 of the 20 faces | `jbig2.wasm`, `openjpeg.wasm` |
| `mermaid.min.js` (14) | `quickjs-eval.{js,wasm}` (475 KB) |
| | both `*_nowasm_fallback.js` (596 KB) |

Roughly 4 MB of the served engine has never been exercised. Read that as *inert so
far*, not *removable*: these are exactly the fallback paths for scanned PDFs
(JBIG2/JPEG 2000), CJK documents without embedded CMaps, and standard-font
fallbacks — and the reader serves them from localhost, so the cost is disk, not
bandwidth. Re-run the command after reading a new class of document before
concluding anything.

## What this check cannot see

- It proves an asset is *what we recorded*, not that anything still *uses* it.
  Unreferenced files (see quickjs above) pass the check.
- Hunk counts are a proxy for "the patches are still applied". A reordered or
  reformatted upstream file can change the count without changing behaviour, and
  two edits close enough to merge into one hunk count as one.
- Digest drift means the file changed, never that it broke. The reader has to be
  exercised for that.
