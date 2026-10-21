#!/usr/bin/env bash
# Renders the diagrams, and fails if any of them does not render.
#
#   bash docs/model/render.sh
#
# The sources are laid out the way the drawings are:
#
#   general/          the system as a whole
#   per-story/US-nn/  the diagrams of one story
#
# and the rendered images go into img/ with the same shape, under a folder
# for the format:
#
#   img/svg/general/…, img/svg/per-story/US-nn/…
#   img/png/general/…, img/png/per-story/US-nn/…
#
# The two formats live apart because the same diagram twice, side by side, is
# one diagram too many: the vector is the one the documents link to, and the
# raster is the one for the slides.
#
# Each diagram is rendered twice: the vector (SVG) for the documents, and the
# raster (PNG) at twice the scale for the slides. A raster at one device pixel
# per CSS pixel is a soft diagram on a screen that has more of them, which is
# the same reason the picture view shows a picture at its own pixels (F-19).
# The PNG is made from the SVG, so the two are the same drawing.
#
# The render is a gate: a diagram that failed to render leaves an error file
# behind, and the script fails rather than letting it be committed silently.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
out="$here/img"

rm -rf "$out"
mkdir -p "$out/svg" "$out/png"

cd "$here"
count=0
while IFS= read -r src; do
  dir="$(dirname "$src")"
  name="$(basename "$src" .puml)"
  svg="$out/svg/$dir"
  png="$out/png/$dir"
  mkdir -p "$svg" "$png"
  plantuml -tsvg -o "$svg" "$src"
  if command -v rsvg-convert >/dev/null 2>&1; then
    rsvg-convert -z 2 -f png "$svg/$name.svg" -o "$png/$name.png"
  else
    # no vector rasteriser here: PlantUML's own PNG, at one pixel per CSS pixel
    plantuml -tpng -o "$png" "$src"
    echo "note: rsvg-convert is not here, so the PNG is PlantUML's own and is soft" >&2
  fi
  count=$((count + 1))
done < <(find . -name "*.puml" | sed 's|^\./||' | sort)

# a diagram that failed to render leaves an error file behind
if find "$out" -name "*.err" | grep -q .; then
  echo "a diagram did not render:" >&2
  find "$out" -name "*.err" -exec cat {} \; >&2
  exit 1
fi

echo "rendered $count diagrams into $out (svg and png, apart)"
