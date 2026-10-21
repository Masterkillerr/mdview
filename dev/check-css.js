#!/usr/bin/env node
// mdview stylesheet audit: the invariants mdview.css cannot state in itself.
//
// The dark palette is declared twice — once for "follow the system" and once for
// the masthead's explicit choice — with a comment asking a human to keep the two
// in sync, and the warm palette has to restate every token the dark one does or
// a warm reader gets a dark scrollbar on light paper. This turns those promises
// into something the build runs: a drift stops the build instead of shipping a
// half-palette that only shows up on one of the three ways into dark.
//
//   node dev/check-css.js                          # the shipped stylesheet
//   node dev/check-css.js --css /tmp/x.css
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const ext = path.join(root, "extension");

const argAt = process.argv.indexOf("--css");
const cssPath =
  argAt !== -1 && process.argv[argAt + 1]
    ? path.resolve(process.argv[argAt + 1])
    : path.join(ext, "mdview.css");
const css = fs.readFileSync(cssPath, "utf8");

// Every file a token may be consumed by. mdview.js sets `--sx` and
// `--def-term-w` from measurements at runtime rather than declaring them, which
// is why the reverse check below has an allowance list.
const CONSUMERS = ["mdview.css", "popup.html", "popup.js", "refresh.js", "mdview.js"];
const SET_AT_RUNTIME = ["--sx", "--def-term-w", "--def-notch"];

const problems = [];

/* --------------------------------------------------------------- extraction */

// The text of the first {…} block that follows `marker`, braces counted so a
// nested block (the media query's own selector) is not mistaken for its end.
function blockAfter(text, marker) {
  const at = text.indexOf(marker);
  if (at === -1) return null;
  // -1 because a marker like `:root {` already ends with the opening brace
  const open = text.indexOf("{", at + marker.length - 1);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(open + 1, i);
  }
  return null;
}

// name -> value, in the order declared. Comments are stripped first so their
// prose cannot be read as a declaration; values (data URIs included) carry no
// semicolons of their own, so a declaration always ends at its first one.
function tokensIn(block) {
  const out = new Map();
  if (!block) return out;
  const clean = block.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /(--[a-z0-9-]+)\s*:\s*([^;{}]+);/g;
  let m;
  while ((m = re.exec(clean))) out.set(m[1], m[2].trim().replace(/\s+/g, " "));
  return out;
}

const light = tokensIn(blockAfter(css, ":root {"));
const mediaOuter = blockAfter(css, "@media (prefers-color-scheme: dark)") || "";
const mediaDark = tokensIn(blockAfter(mediaOuter, ':root:not([data-mdview-theme="light"])'));
const attrDarkRaw = blockAfter(css, ':root[data-mdview-theme="dark"]') || "";
const attrDark = tokensIn(attrDarkRaw);
const warmRaw = blockAfter(css, ':root[data-mdview-theme="warm"]') || "";
const warm = tokensIn(warmRaw);

for (const [what, map] of [
  ["light :root", light],
  ["dark under the system", mediaDark],
  ["dark chosen by hand", attrDark],
  ["warm", warm],
]) {
  if (!map.size) problems.push(`could not read the ${what} token block`);
}

/* ------------------------------------------- the dark palette, declared twice */

if (mediaDark.size && attrDark.size) {
  if (mediaDark.size !== attrDark.size) {
    problems.push(
      `the two dark blocks declare ${mediaDark.size} and ${attrDark.size} tokens — one of them is missing something`
    );
  }
  for (const [name, value] of mediaDark) {
    if (!attrDark.has(name)) problems.push(`dark: ${name} is under the system but not when chosen`);
    else if (attrDark.get(name) !== value) {
      problems.push(`dark: ${name} is "${value}" under the system and "${attrDark.get(name)}" when chosen`);
    }
  }
  for (const name of attrDark.keys()) {
    if (!mediaDark.has(name)) problems.push(`dark: ${name} is when chosen but not under the system`);
  }
  if (!/color-scheme:\s*dark/.test(mediaOuter)) problems.push("the system dark block does not set color-scheme: dark");
  if (!/color-scheme:\s*dark/.test(attrDarkRaw)) problems.push("the chosen dark block does not set color-scheme: dark");
}

/* -------------------------------------- what the light and warm blocks owe dark */

for (const name of attrDark.keys()) {
  if (light.size && !light.has(name)) problems.push(`${name}: declared dark but not in the light :root`);
  if (warm.size && !warm.has(name)) problems.push(`${name}: declared dark but not restated in the warm block`);
}
if (warm.size && !/color-scheme:\s*light/.test(warmRaw)) {
  problems.push("the warm block does not set color-scheme: light (a warm page with dark furniture is not warm)");
}

/* ----------------------------------------------------- tokens used and declared */

const declared = new Set();
{
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /(--[a-z0-9-]+)\s*:/g;
  let m;
  while ((m = re.exec(clean))) declared.add(m[1]);
}

// the audited file stands in for the shipped mdview.css, so --css points the
// token checks at a copy as well as at the palette checks
const consumers = CONSUMERS.filter(
  (f) => f === "mdview.css" || fs.existsSync(path.join(ext, f))
).map((f) => [f, f === "mdview.css" ? css : fs.readFileSync(path.join(ext, f), "utf8")]);

for (const name of [...declared].sort()) {
  const escape = name.replace(/-/g, "\\-");
  const reCss = new RegExp(`var\\(\\s*${escape}\\s*[,)]`);
  const usedSomewhere = consumers.some(([file, text]) =>
    file.endsWith(".js")
      ? text.includes(`"${name}"`) || text.includes(`'${name}'`)
      : reCss.test(text)
  );
  if (!usedSomewhere) problems.push(`${name} is declared but nothing consumes it`);
}

const undeclared = new Set();
for (const [file, text] of consumers) {
  if (file.endsWith(".js")) continue;
  const re = /var\(\s*(--[a-z0-9-]+)\s*[,)]/g;
  let m;
  while ((m = re.exec(text))) {
    if (!declared.has(m[1]) && !SET_AT_RUNTIME.includes(m[1])) undeclared.add(`${file}: ${m[1]}`);
  }
}
for (const u of undeclared) problems.push(`${u} is used but declared nowhere`);

/* ------------------------------------------------------------------- braces */

const open = (css.match(/\{/g) || []).length;
const close = (css.match(/\}/g) || []).length;
if (open !== close) problems.push(`unbalanced braces: ${open} open, ${close} close`);

/* ------------------------------------------------------------------- verdict */

const label = path.relative(root, cssPath) || cssPath;
if (problems.length) {
  console.error(`css check: ${problems.length} problem(s) in ${label}`);
  for (const p of problems) console.error(`  x ${p}`);
  process.exit(1);
}
console.log(
  `css check: ok (${label}) — dark declared twice and identical (${attrDark.size} tokens), ` +
    `warm restates all of them, ${declared.size} tokens all consumed, braces ${open}/${close}`
);
