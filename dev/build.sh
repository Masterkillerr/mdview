#!/usr/bin/env bash
# mdview build: packages the Firefox extension. The extension redirects local files to
# the reader and defines words from a menu, so the package holds those scripts — and the
# lookup card the menu injects into the page it was asked on, because a file the package
# does not carry is a file `insertCSS`/`executeScript` cannot inject, and the card then
# falls back to a tab on every page. The rest of the reader's scripts and styles stay in
# extension/, where reader/server.py serves them from.
#
#   bash dev/build.sh
set -euo pipefail

dev="$(cd "$(dirname "$0")" && pwd)"
bin="$(cd "$dev/.." && pwd)"
firefox="$bin/extension"
shared=(refresh.js define.html define.js dictionaries.js lookup.css lookup.js icon.svg)

# the stylesheet's own invariants: the dark palette declared twice and identical, warm
# restating every dark token, nothing declared or used alone. A drift stops the build
# rather than shipping a half-palette that only shows up on one of the three ways into dark.
echo "checking stylesheet invariants"
node "$dev/check-css.js"

echo "checking vendored engine assets"
node "$dev/check-vendor.js" --quiet

echo "packaging $firefox/mdview.xpi"
rm -f "$firefox/mdview.xpi" "$bin/mdview.xpi"
(cd "$firefox" && zip -q -X -r "mdview.xpi" manifest.json "${shared[@]}")
cp -f "$firefox/mdview.xpi" "$bin/mdview.xpi"

echo "done:"
ls -l "$firefox/mdview.xpi" "$bin/mdview.xpi"
