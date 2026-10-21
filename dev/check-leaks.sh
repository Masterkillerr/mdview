#!/usr/bin/env bash
# The leak check: nothing in this repository may say who wrote it or where it
# was written.
#
#   bash dev/check-leaks.sh
#
# It looks for the machine's paths, an address, a token, the reader's own
# state, and the extension's name. It is a blunt instrument on purpose: a leak
# that a pattern misses is still a leak.
#
# The name of the person is deliberately not in this script: the script is in
# the repository, and a check that carried the name would carry the leak with
# it. Look for that by hand, or in a copy of this script kept outside the
# repository.
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
cd "$root"

problems=0
note() { printf '%s\n' "$*"; }
fail() { printf 'LEAK: %s\n' "$*"; problems=$((problems + 1)); }

# The vendored assets are third-party code, recorded by digest in
# vendor-manifest.json, and cannot be edited here — so they are read, not
# searched. The CommonMark corpus is a public standard, and its examples
# carry addresses of their own.
vendored=(
  --exclude=pdf.mjs --exclude=pdf.worker.mjs --exclude=mermaid.min.js
  --exclude-dir=cmaps --exclude-dir=standard_fonts --exclude-dir=wasm --exclude-dir=katex
  --exclude=spec.json
)

echo "== a home path, or any path of a person's machine"
if grep -rInE "/home/[a-z]|/Users/[a-z]|C:\\\\Users" . --exclude-dir=node_modules --exclude-dir=.git "${vendored[@]}" 2>/dev/null \
  | grep -vE "\.svg:|\.png:|Binary file" | grep -v "check-leaks.sh" | head -20 | grep -q .; then
  grep -rInE "/home/[a-z]|/Users/[a-z]|C:\\\\Users" . --exclude-dir=node_modules --exclude-dir=.git "${vendored[@]}" 2>/dev/null \
    | grep -vE "\.svg:|\.png:|Binary file" | grep -v "check-leaks.sh" | head -20
  fail "a path of somebody's machine is in the tree"
else
  echo "ok  none"
fi

echo "== an address, a token or a key"
if grep -rInE "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY" . \
  --exclude-dir=node_modules --exclude-dir=.git "${vendored[@]}" 2>/dev/null \
  | grep -vE "\.svg:|\.png:|Binary file" | grep -v "check-leaks.sh" | grep -v "mdview@example.com" | grep -vE "email|mailto" | head -20 | grep -q .; then
  grep -rInE "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|gh[pousr]_[A-Za-z0-9]{20,}" . \
    --exclude-dir=node_modules --exclude-dir=.git "${vendored[@]}" 2>/dev/null \
    | grep -vE "\.svg:|\.png:|Binary file" | grep -v "check-leaks.sh" | grep -v "mdview@example.com" | head -20
  fail "an address, a token or a key is in the tree"
else
  echo "ok  none"
fi

echo "== the folders and the files of the person who wrote it"
if grep -rInE "drive-md|clase-so-intro|mdview-demo|ntfs-notes|audiorelay|orden-del-curso|Introducción General|RESUMEN ARQUI|meTQwRc|passwords\.csv" . \
  --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null \
  | grep -vE "\.svg:|\.png:|Binary file" | grep -v "check-leaks.sh" | head -20 | grep -q .; then
  grep -rInE "drive-md|clase-so-intro|mdview-demo|ntfs-notes|audiorelay|orden-del-curso|Introducción General|RESUMEN ARQUI|meTQwRc|passwords\.csv" . \
    --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null \
    | grep -vE "\.svg:|\.png:|Binary file" | grep -v "check-leaks.sh" | head -20
  fail "a folder or a file name of theirs is in the tree"
else
  echo "ok  none"
fi

echo "== the state of the reader"
if [ -f reader/roots.json ]; then
  fail "reader/roots.json is in the tree: it holds the folders they read"
else
  echo "ok  none"
fi
if [ -d reader/temp ] && [ -n "$(ls -A reader/temp 2>/dev/null)" ]; then
  fail "reader/temp holds copies of their files"
else
  echo "ok  none"
fi

echo "== the extension's name"
if grep -rInE '"id":\s*"mdview@' extension/manifest.json 2>/dev/null | grep -v "mdview@example.com" | grep -q .; then
  grep -rInE '"id":\s*"mdview@' extension/manifest.json | grep -v "mdview@example.com"
  fail "the add-on's name says who wrote it"
else
  echo "ok  none"
fi

echo
if [ "$problems" -eq 0 ]; then
  echo "nothing in this tree says who wrote it or where"
  exit 0
fi
echo "$problems problem(s) found"
exit 1
