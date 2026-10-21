#!/usr/bin/env bash
# One command to develop mdview in Firefox:
#
#   bash dev/dev.sh
#
# Loads extension/ as a temporary add-on in a throwaway Firefox profile
# (your real profile is untouched), opens test/kitchen-sink.md, and reloads the
# extension whenever mdview.js, mdview.css or manifest.json change.
# Ctrl+C stops it.
#
# Extra arguments go to `web-ext run`, e.g.:
#   bash dev/dev.sh --args=-headless      # no window
#   bash dev/dev.sh --devtools            # add-on devtools
#   bash dev/dev.sh --browser-console     # extension errors
#   bash dev/dev.sh -u file:///other.md   # open something else
#   MDVIEW_FIREFOX=/usr/bin/firefox-esr bash dev/dev.sh
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
web_ext="$here/node_modules/.bin/web-ext"
config="$here/web-ext-config.cjs"

if [ ! -x "$web_ext" ]; then
  echo "web-ext is not installed yet. Run:" >&2
  echo "  (cd \"$here\" && npm install)" >&2
  exit 1
fi

exec "$web_ext" run --config "$config" "$@"
