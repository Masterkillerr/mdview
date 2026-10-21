// Writes extension/define.css: the part of mdview.css that the word-definition
// card needs, and nothing that restyles a page. An .html file the reader opens is
// not a rendered markdown document, so it must not inherit `body { background }`,
// `html { scroll-behavior }` and the rest of the page shell. What survives:
//
//   - every rule whose selector mentions `.mdview-define`
//   - the custom properties (`--*`) declared on `:root`, which the card's colours
//     and type are built from; the other `:root` declarations (color-scheme,
//     scrollbar and form-control colours) are the page's to decide, so they go
//   - the @keyframes the kept rules use
//
// Run by build.sh, so define.css is never hand-edited and cannot fall behind
// mdview.css. Usage: node split-define-css.js [path/to/mdview.css] [out.css]

"use strict";

const fs = require("fs");
const path = require("path");

const here = __dirname;
const input = process.argv[2] || path.join(here, "..", "extension", "mdview.css");
const output = process.argv[3] || path.join(here, "..", "extension", "define.css");

// Top-level-or-nested `prelude { body }` blocks, comments already removed.
function blocks(src) {
  const out = [];
  let depth = 0;
  let start = 0;
  let last = 0;
  let prelude = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "{") {
      if (depth === 0) {
        prelude = src.slice(last, i).trim();
        // an @import or @charset ends in `;` and shares no block with what follows
        prelude = prelude.slice(prelude.lastIndexOf(";") + 1).trim();
        start = i + 1;
      }
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) {
        out.push({ prelude, body: src.slice(start, i) });
        last = i + 1;
      }
    }
  }
  return out;
}

const DEFINE = ".mdview-define";

function keep(list, keyframes) {
  const out = [];
  for (const b of list) {
    if (/^@(media|supports)\b/.test(b.prelude)) {
      const inner = keep(blocks(b.body), keyframes);
      if (inner.length) out.push(`${b.prelude} {\n${inner.join("\n")}\n}`);
    } else if (/^@keyframes\b/.test(b.prelude)) {
      keyframes.push(b);
    } else if (b.prelude.startsWith("@")) {
      continue;
    } else if (b.prelude.startsWith(":root")) {
      const vars = b.body
        .split(";")
        .map((d) => d.trim())
        .filter((d) => d.startsWith("--"));
      if (vars.length) out.push(`${b.prelude} {\n  ${vars.join(";\n  ")};\n}`);
    } else if (b.prelude.includes(DEFINE)) {
      out.push(`${b.prelude} {${b.body}}`);
    }
  }
  return out;
}

const css = fs
  .readFileSync(input, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

const keyframes = [];
const rules = keep(blocks(css), keyframes);
const body = rules.join("\n");

// keyframes only where a kept rule names them, so the file carries no dead animation
const used = keyframes.filter((k) => {
  const name = k.prelude.replace(/^@keyframes\s+/, "").trim();
  return new RegExp(`\\b${name}\\b`).test(body);
});

const header =
  "/* Generated from mdview.css by dev/split-define-css.js. Do not edit:\n" +
  "   the definition card's styles only, for pages that are not rendered markdown. */\n";
const frames = used.map((k) => `${k.prelude} {${k.body}}`).join("\n");

fs.writeFileSync(output, header + body + (frames ? "\n" + frames : "") + "\n");
console.log(`wrote ${path.relative(process.cwd(), output)}: ${rules.length} rule blocks, ${used.length} keyframes`);
