#!/usr/bin/env node
// Score one or more mdview builds against the CommonMark corpus, so the audit
// can quote before/after numbers. The current build exports renderMarkdown();
// the 1.3 build has no exports, so it is driven through a stubbed DOM.
//
//   node dev/test/score-backup.js                         # dated backup
//   node dev/test/score-backup.js a.js b.js               # comparison
"use strict";

const fs = require("fs");
const path = require("path");
const { canon } = require("./canon.js");

const DEFAULT_OLD = path.join(__dirname, "..", "backup-2026-09-29", "firefox", "mdview.js");
const DEFAULT_NEW = path.join(__dirname, "..", "..", "mdview-ext", "mdview.js");

const spec = JSON.parse(fs.readFileSync(path.join(__dirname, "spec.json"), "utf8"));

// Returns a render(markdown) -> html function for any mdview generation.
function loadRenderer(file) {
  const resolved = path.resolve(file);
  if (resolved !== DEFAULT_OLD) {
    try {
      const mod = require(resolved);
      if (mod && typeof mod.renderMarkdown === "function") return mod.renderMarkdown;
      delete require.cache[require.resolve(resolved)];
    } catch (e) { /* fall through to the DOM stub */ }
  }
  const source = fs.readFileSync(resolved, "utf8");
  return (md) => {
    let html = "";
    const wrap = { className: "", innerHTML: "", querySelector: () => null, querySelectorAll: () => [] };
    const pre = { textContent: md };
    const body = { querySelector: () => pre, textContent: "", appendChild: (el) => { html = el.innerHTML; } };
    const doc = { body, title: "", createElement: () => wrap, getElementById: () => null, querySelector: () => null };
    const location = { pathname: "/tmp/doc.md", hash: "" };
    const matchMedia = () => ({ matches: false });
    new Function("document", "location", "matchMedia", "mermaid", "module", source)(
      doc, location, matchMedia, undefined, { exports: {} }
    );
    return html;
  };
}

function score(file) {
  const render = loadRenderer(file);
  const per = new Map();
  let pass = 0;
  for (const ex of spec) {
    let actual;
    try { actual = canon(render(ex.markdown)); } catch (e) { actual = "!! threw"; }
    const bucket = per.get(ex.section) || { pass: 0, total: 0 };
    if (actual === canon(ex.html)) { pass++; bucket.pass++; } else bucket.fail = (bucket.fail || 0) + 1;
    bucket.total++;
    per.set(ex.section, bucket);
  }
  return { pass, per };
}

const files = process.argv.slice(2);
const list = files.length ? files : [DEFAULT_OLD, DEFAULT_NEW];
const results = list.map((f) => ({ file: f, ...score(f) }));

for (const r of results) {
  console.log(
    path.relative(process.cwd(), r.file) + ": " + r.pass + "/" + spec.length +
    " (" + ((r.pass / spec.length) * 100).toFixed(1) + "%)"
  );
}

if (results.length > 1) {
  console.log("\n| section | " + results.map((r) => path.basename(path.dirname(r.file))).join(" | ") + " |");
  console.log("| --- |" + results.map(() => " ---: |").join(""));
  for (const section of results[0].per.keys()) {
    console.log("| " + section + " | " + results.map((r) => {
      const b = r.per.get(section) || { pass: 0, total: 0 };
      return b.pass + "/" + b.total;
    }).join(" | ") + " |");
  }
  console.log("| **total** | " + results.map((r) => "**" + r.pass + "/" + spec.length + "**").join(" | ") + " |");
}
