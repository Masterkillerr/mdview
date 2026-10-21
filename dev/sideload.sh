#!/usr/bin/env bash
# Sideload the built mdview.xpi into a Firefox profile, so mdview survives
# restarts. Temporary add-ons (about:debugging) do not: they vanish when
# Firefox closes, and your .md files silently go back to plain text.
#
#   bash sideload.sh                 # newest *.default-esr profile
#   MDVIEW_PROFILE=~/.mozilla/firefox/xxxx.default bash sideload.sh
#
# Requires xpinstall.signatures.required = false in that profile (ESR honours
# it), because mdview.xpi is not signed by Mozilla.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
xpi="$here/../extension/mdview.xpi"
# the Firefox build is the source of truth; keep the root copy fresh too
loose="$here/../mdview.xpi"

[ -f "$xpi" ] || { echo "no $xpi — build it first: bash build.sh" >&2; exit 1; }

root="${MDVIEW_PROFILE_ROOT:-$HOME/.mozilla/firefox}"
profile="${MDVIEW_PROFILE:-$(ls -d "$root"/*.default-esr 2>/dev/null | head -1 || true)}"
if [ -z "${profile:-}" ] || [ ! -d "$profile" ]; then
  echo "could not find a Firefox profile under $root" >&2
  echo "set MDVIEW_PROFILE=<profile dir> (see about:support -> Profile Folder)" >&2
  exit 1
fi

dest="$profile/extensions/mdview@example.com.xpi"
mkdir -p "$profile/extensions"
cp -f "$xpi" "$dest"
cp -f "$xpi" "$loose"

version="$(unzip -p "$dest" manifest.json | tr -d '\n ' | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')"
echo "mdview $version -> $dest"

if pgrep -x firefox >/dev/null 2>&1 || pgrep -x firefox-esr >/dev/null 2>&1; then
  echo
  echo "Firefox is running: a sideloaded copy is only picked up at startup."
  echo "Restart Firefox, then open about:addons and enable mdview if it shows"
  echo "as disabled (sideloaded add-ons need one manual enable)."
else
  echo
  echo "Start Firefox and enable mdview in about:addons if it shows as disabled."
fi
