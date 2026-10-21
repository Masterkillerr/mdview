#!/usr/bin/env node
// mdview renderer audit: run the official CommonMark corpus (test/spec.json)
// plus mdview's own GFM/extension fixtures through mdview.js and diff the HTML.
//
//   node dev/test/run.js                             # everything, summary
//   node dev/test/run.js -v Emphasis                 # show diffs for a section
//   node dev/test/run.js -x                          # also list passing sections
"use strict";

const path = require("path");
const fs = require("fs");

const MDVIEW = path.join(__dirname, "..", "..", "extension", "mdview.js");
const { renderMarkdown, renderInline } = require(MDVIEW);
const { canon } = require("./canon.js");

/* ------------------------------------------------------------------ corpus */

const spec = JSON.parse(fs.readFileSync(path.join(__dirname, "spec.json"), "utf8"));

// Sections where mdview intentionally diverges from the reference renderer.
const KNOWN_DEVIATIONS = {
  "HTML blocks": "raw HTML blocks are restricted to container tags and sanitized",
  "Raw HTML": "only an allowlist of presentational tags is passed through",
  "Tabs": "tabs are expanded to 4-column tab stops instead of being preserved verbatim",
  "Entity and numeric character references": "Node has no HTML5 entity table; the browser path uses DOMParser/textarea",
  "Autolinks": "mdview additionally linkifies bare URLs (a GFM extension, not in CommonMark)",
};

// Individual corpus examples whose only difference is one of the documented
// deviations above (raw-HTML allowlist, Node's missing entity table). Anything
// outside this table is a genuine regression.
const KNOWN_FAILURES = {
  21: "raw HTML block for <a .../> (allowlist)",
  201: "raw inline HTML <bar> (allowlist)",
  491: "raw inline HTML <foo bar> (allowlist)",
  494: "raw inline HTML <b> (allowlist)",
  503: "entity table missing under Node (browser path resolves it)",
  524: "raw inline HTML <bar attr=...> (allowlist)",
  536: "raw inline HTML <bar attr=...> (allowlist)",
};

const sectionFilter = (() => {
  const at = process.argv.findIndex((a) => a === "--section" || a === "-s");
  const raw = at >= 0 ? process.argv[at + 1] : null;
  return raw ? raw.toLowerCase() : null;
})();
const verbose = process.argv.includes("-v") || process.argv.includes("--verbose");
const showPassing = process.argv.includes("-x");

let pass = 0;
let fail = 0;
const perSection = new Map();
const failures = [];

for (const ex of spec) {
  const name = ex.section;
  if (!perSection.has(name)) perSection.set(name, { pass: 0, fail: 0 });
  const bucket = perSection.get(name);
  let actual;
  let expected = ex.html;
  try {
    actual = canon(renderMarkdown(ex.markdown));
  } catch (e) {
    actual = "!! threw: " + e.message;
  }
  const want = canon(expected);
  if (actual === want) {
    pass++;
    bucket.pass++;
  } else {
    fail++;
    bucket.fail++;
    failures.push({ section: name, example: ex.example, markdown: ex.markdown, expected: want, actual });
  }
}

/* --------------------------------------------------------------- fixtures */

// mdview's own behaviours (GFM extensions, safety, frontmatter) checked with
// exact expected HTML.
const FIX = "fixtures";
const fixtures = [
  ["table alignment", "| a | b | c |\n| :- | :-: | -: |\n| 1 | 2 | 3 |",
    '<div class="tablewrap"><table><thead><tr><th class="ta-left">a</th><th class="ta-center">b</th><th class="ta-right">c</th></tr></thead><tbody><tr><td class="ta-left">1</td><td class="ta-center">2</td><td class="ta-right">3</td></tr></tbody></table></div>'],
  ["table without outer pipes", "a | b\n--- | ---\n1 | 2",
    '<div class="tablewrap"><table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table></div>'],
  ["escaped pipe in table", "| a | b |\n| - | - |\n| x \\| y | z |",
    '<div class="tablewrap"><table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>x | y</td><td>z</td></tr></tbody></table></div>'],
  ["loose nested list right", "- a *em*\n- b\n  - b1\n  - b2\n- c",
    '<ul><li>a <em>em</em></li><li>b<ul><li>b1</li><li>b2</li></ul></li><li>c</li></ul>'],
  ["loose list gets paragraphs", "- a\n\n- b\n\n  1. x\n  2. y",
    '<ul><li><p>a</p></li><li><p>b</p><ol><li>x</li><li>y</li></ol></li></ul>'],
  ["ordered list start", "5. five\n6. six\n7. seven", '<ol start="5"><li>five</li><li>six</li><li>seven</li></ol>'],
  ["task list", "- [ ] todo\n- [x] done",
    '<ul class="task-list"><li class="task-list-item"><input type="checkbox" disabled> todo</li><li class="task-list-item"><input type="checkbox" disabled checked> done</li></ul>'],
  ["strikethrough", "a ~~gone~~ b", "<p>a <del>gone</del> b</p>"],
  ["single tilde strikethrough (GFM)", "a ~x~ b", "<p>a <del>x</del> b</p>"],
  ["triple tilde is literal", "a ~~~x~~~ b", "<p>a ~~~x~~~ b</p>"],
  ["bare url trailing punctuation", "see https://example.com/a(b). and (https://x.dev)",
    '<p>see <a href="https://example.com/a(b)">https://example.com/a(b)</a>. and (<a href="https://x.dev">https://x.dev</a>)</p>'],
  ["www autolink", "go to www.example.com now", '<p>go to <a href="http://www.example.com">www.example.com</a> now</p>'],
  ["entity in code span", "`a&amp;b` &#65;", "<p><code>a&amp;b</code> A</p>"],
  ["entity in code block is literal", "```\n&amp;\n```", '<pre class="fence"><code>&amp;amp;\n</code></pre>'],
  ["hard break two spaces", "a  \nb", "<p>a<br>\nb</p>"],
  ["hard break backslash", "a\\\nb", "<p>a<br>\nb</p>"],
  ["frontmatter chips", "---\ntitle: Hello\ntags: a, b\n---\n\n# Head",
    '<div class="meta"><span><b>title</b> Hello</span><span><b>tags</b> a, b</span></div>\n<h1 id="head">Head</h1>'],
  ["frontmatter not confused with hr", "---\nFoo\n---\nBar",
    "<hr>\n<h2>Foo</h2>\n<p>Bar</p>"],
  ["mermaid fence", "```mermaid\ngraph TD;\nA-->B;\n```", '<pre class="mermaid">graph TD;\nA--&gt;B;</pre>'],
  ["javascript link is stripped", "[x](javascript:alert(1))", "<p>x</p>"],
  ["data url image is stripped", "![a](data:text/html,<script>1</script>)", "<p>a</p>"],
  ["details/summary allowed", "<details><summary>more</summary>\n\nhidden\n\n</details>",
    '<details><summary>more</summary>\n<p>hidden</p>\n</details>'],
  ["kbd and br allowed", "press <kbd>Ctrl</kbd><br>now", "<p>press <kbd>Ctrl</kbd><br>now</p>"],
  ["script tag escaped", "a <script>alert(1)</script> b",
    "<p>a &lt;script&gt;alert(1)&lt;/script&gt; b</p>"],
  ["event handler attribute dropped", '<a href="#" onclick="x()">y</a>', '<p><a href="#">y</a></p>'],
  ["div align center passes", '<div align="center">\n<img src="logo.png" alt="logo">\n</div>',
    '<div align="center">\n<img src="logo.png" alt="logo">\n</div>'],
  ["html block yields to markdown after a blank line", '<div align="center">\n\n# Title\n\n</div>',
    '<div align="center">\n<h1 id="title">Title</h1>\n</div>'],
  ["heading anchor dedupe", "# Same\n\n# Same\n\n# Same!",
    '<h1 id="same">Same</h1>\n<h1 id="same-1">Same</h1>\n<h1 id="same-2">Same!</h1>'],
  ["loose list item with two paragraphs", "- a\n\n  b\n\n- c",
    "<ul><li><p>a</p>\n<p>b</p></li><li><p>c</p></li></ul>"],
  ["nested blockquote", "> a\n>\n> > b", "<blockquote>\n<p>a</p>\n<blockquote>\n<p>b</p>\n</blockquote>\n</blockquote>"],
  ["reference link with title", "[a]: /u \"t\"\n\nsee [a] and [a][] and [a](/x)",
    '<p>see <a href="/u" title="t">a</a> and <a href="/u" title="t">a</a> and <a href="/x">a</a></p>'],
  ["image with title", '![alt](/i.png "logo")', '<p><img src="/i.png" alt="alt" title="logo"></p>'],
  ["strong emphasises nesting", "***both*** and **a *b* c**",
    "<p><em><strong>both</strong></em> and <strong>a <em>b</em> c</strong></p>"],
  ["intraword underscore is literal", "snake_case_name stays", "<p>snake_case_name stays</p>"],
  ["indented code keeps content", "    a\n     b", '<pre class="fence"><code>a\n b\n</code></pre>'],
  ["fence indent stripping", "  ```\n  a\n   b\n  ```", '<pre class="fence"><code>a\n b\n</code></pre>'],
  ["lazy paragraph continuation", "Foo\nbar\nbaz", "<p>Foo\nbar\nbaz</p>"],
  ["setext heading", "Title\n=====\n\nSub\n---", '<h1 id="title">Title</h1>\n<h2 id="sub">Sub</h2>'],
  // --- regressions fixed by the CommonMark audit ---
  ["url is percent-encoded", "[x](</my uri>) and [y](foo\\bar)",
    '<p><a href="/my%20uri">x</a> and <a href="foo%5Cbar">y</a></p>'],
  ["escaped angle destination is not a link", "[link](<foo\\>)", "<p>[link](&lt;foo&gt;)</p>"],
  ["title with escaped quote", '[x](/u "a \\"b\\"")', '<p><a href="/u" title="a &quot;b&quot;">x</a></p>'],
  ["empty link text", "[](./target.md) and []()", '<p><a href="./target.md"></a> and <a href=""></a></p>'],
  ["failed reference kills the shortcut", "[foo][bar][baz]\n\n[baz]: /url1\n[foo]: /url2",
    '<p>[foo]<a href="/url1">bar</a></p>'],
  ["nested image alt text", "![foo ![bar](/u)](/u2)", '<p><img src="/u2" alt="foo bar"></p>'],
  ["image inside link", "[![m](i)](/u)", '<p><a href="/u"><img src="i" alt="m"></a></p>'],
  ["inner link wins", "[foo [bar](/uri)](/uri)", '<p>[foo <a href="/uri">bar</a>](/uri)</p>'],
  ["javascript autolink is stripped", "<javascript:alert(1)>", "<p>javascript:alert(1)</p>"],
  ["javascript entity link is stripped", "[x](&#106;avascript:alert(1))", "<p>x</p>"],
  ["style declarations are filtered", '<span style="position:fixed;color:red">x</span>',
    '<p><span style="color:red">x</span></p>'],
  ["unknown tag is escaped", "<my-widget>hi</my-widget>", "<p>&lt;my-widget&gt;hi&lt;/my-widget&gt;</p>"],
  ["comment passes through", "a <!-- note --> b", "<p>a <!-- note --> b</p>"],
  ["hard break in blockquote", "> a  \n> b", "<blockquote>\n<p>a<br>\nb</p>\n</blockquote>"],
  ["lazy line is not a nested list", "- a\n - b\n  - c\n   - d\n    - e",
    "<ul><li>a</li><li>b</li><li>c</li><li>d - e</li></ul>"],
  ["indented code blank line loses padding", "    a\n      \n    b", '<pre class="fence"><code>a\n  \nb\n</code></pre>'],
  ["three backticks inside one", "` `` `", "<p><code>``</code></p>"],
  ["fence content keeps blank first line", "`````\n\n```\naaa", '<pre class="fence"><code>\n```\naaa\n</code></pre>'],
  // --- footnotes (GFM) ---
  ["footnote: citation, numbering and the notes section", "Text.[^1]\n\n[^1]: The note.",
    '<p>Text.<sup><a href="#fn-1" aria-label="Footnote 1">1</a></sup></p>\n' +
    '<section role="doc-endnotes"><h2>Footnotes</h2><ol>' +
    '<li><p>The note. <a href="#fnref-1" aria-label="Back to the reference">↩</a></p></li>' +
    "</ol></section>"],
  ["footnote: numbered by first citation, not by definition order",
    "Alpha[^b] beta[^a]\n\n[^a]: about a\n[^b]: about b",
    '<p>Alpha<sup><a href="#fn-1" aria-label="Footnote 1">1</a></sup> beta<sup>' +
    '<a href="#fn-2" aria-label="Footnote 2">2</a></sup></p>\n' +
    '<section role="doc-endnotes"><h2>Footnotes</h2><ol>' +
    '<li><p>about b <a href="#fnref-1" aria-label="Back to the reference">↩</a></p></li>' +
    '<li><p>about a <a href="#fnref-2" aria-label="Back to the reference">↩</a></p></li>' +
    "</ol></section>"],
  ["footnote: cited twice gets one note and two back-links", "Alpha[^x] bravo[^x]\n\n[^x]: about x",
    '<p>Alpha<sup><a href="#fn-1" aria-label="Footnote 1">1</a></sup> bravo<sup>' +
    '<a href="#fn-1" aria-label="Footnote 1">1</a></sup></p>\n' +
    '<section role="doc-endnotes"><h2>Footnotes</h2><ol><li><p>about x ' +
    '<a href="#fnref-1" aria-label="Back to the reference">↩</a> ' +
    '<a href="#fnref-1-2" aria-label="Back to reference 2">↩<sup>2</sup></a></p></li></ol></section>'],
  ["footnote: a definition nobody cites is dropped", "No citation here.\n\n[^ghost]: Nobody points at this.",
    "<p>No citation here.</p>"],
  ["footnote: a citation with no definition stays literal", "Point.[^nope]", "<p>Point.[^nope]</p>"],
  ["footnote: a wrapped line stays in the note",
    "Text.[^1]\n\n[^1]: A note that\nrests on a second line.\n\nAfterwards.",
    '<p>Text.<sup><a href="#fn-1" aria-label="Footnote 1">1</a></sup></p>\n<p>Afterwards.</p>\n' +
    '<section role="doc-endnotes"><h2>Footnotes</h2><ol>' +
    '<li><p>A note that rests on a second line. ' +
    '<a href="#fnref-1" aria-label="Back to the reference">↩</a></p></li></ol></section>'],
  ["footnote: an indented paragraph joins the note", "Text.[^1]\n\n[^1]: First.\n\n    Second, indented.",
    '<p>Text.<sup><a href="#fn-1" aria-label="Footnote 1">1</a></sup></p>\n' +
    '<section role="doc-endnotes"><h2>Footnotes</h2><ol><li>' +
    '<p>First. <a href="#fnref-1" aria-label="Back to the reference">↩</a></p>\n' +
    "<p>Second, indented.</p></li></ol></section>"],
  ["footnote: a definition inside a fence is code", "```\n[^1]: not a note\n```",
    '<pre class="fence"><code>[^1]: not a note\n</code></pre>'],
  ["footnote: a marker inside a link label stays literal", "[a [^1] b](/u)\n\n[^1]: note.",
    '<p><a href="/u">a [^1] b</a></p>'],
  ["footnote: a definition does not interrupt a paragraph", "text\n[^1]: a note\n\n[^1]",
    "<p>text [^1]: a note</p>\n<p>[^1]</p>"],

  // A GFM table interrupts a paragraph: the delimiter row ends the paragraph and
  // the line above it becomes the header row. Without this the common shape
  // `**Examples:**` directly on top of a table renders as literal pipe text.
  ["table: interrupts a paragraph", "**Examples:**\n| a | b |\n| - | - |\n| 1 | 2 |",
    '<p><strong>Examples:</strong></p>\n' +
    '<div class="tablewrap"><table><thead><tr><th>a</th><th>b</th></tr></thead>' +
    "<tbody><tr><td>1</td><td>2</td></tr></tbody></table></div>"],
  ["table: interrupts a paragraph after body text", "Options:\n| a | b |\n| - | - |\n| 1 | 2 |\n\nAfter.",
    "<p>Options:</p>\n" +
    '<div class="tablewrap"><table><thead><tr><th>a</th><th>b</th></tr></thead>' +
    "<tbody><tr><td>1</td><td>2</td></tr></tbody></table></div>\n<p>After.</p>"],
  ["table: interrupts a paragraph inside a list item", "- item\n\n  **Examples:**\n  | a | b |\n  | - | - |\n  | 1 | 2 |",
    "<ul><li><p>item</p>\n<p><strong>Examples:</strong></p>\n" +
    '<div class="tablewrap"><table><thead><tr><th>a</th><th>b</th></tr></thead>' +
    "<tbody><tr><td>1</td><td>2</td></tr></tbody></table></div></li></ul>"],
  ["table: interrupts a paragraph inside a quote", "> **Examples:**\n> | a | b |\n> | - | - |\n> | 1 | 2 |",
    "<blockquote>\n<p><strong>Examples:</strong></p>\n" +
    '<div class="tablewrap"><table><thead><tr><th>a</th><th>b</th></tr></thead>' +
    "<tbody><tr><td>1</td><td>2</td></tr></tbody></table></div>\n</blockquote>"],
  ["table: a pipe line with no delimiter row stays a paragraph", "a | b\n\nnot a table",
    "<p>a | b</p>\n<p>not a table</p>"],
];

for (const [name, markdown, expected] of fixtures) {
  if (!perSection.has(FIX)) perSection.set(FIX, { pass: 0, fail: 0 });
  const bucket = perSection.get(FIX);
  let actual;
  try { actual = canon(renderMarkdown(markdown)); } catch (e) { actual = "!! threw: " + e.message; }
  const want = canon(expected);
  if (actual === want) { pass++; bucket.pass++; }
  else {
    fail++;
    bucket.fail++;
    failures.push({ section: FIX + ": " + name, example: "-", markdown, expected: want, actual });
  }
}

/* ----------------------------------------------------------------- report */

const sections = [...perSection.keys()].filter((s) => !sectionFilter || s.toLowerCase().includes(sectionFilter));
const shown = failures.filter((f) => !sectionFilter || f.section.toLowerCase().includes(sectionFilter));

if (showPassing || sectionFilter) {
  console.log("per section:");
  for (const s of sections) {
    const b = perSection.get(s);
    const flag = b.fail === 0 ? "ok  " : "FAIL";
    const note = KNOWN_DEVIATIONS[s] ? "   [by design: " + KNOWN_DEVIATIONS[s] + "]" : "";
    console.log("  " + flag + " " + String(b.pass).padStart(4) + "/" + String(b.pass + b.fail).padEnd(4) + " " + s + note);
  }
  console.log("");
}

if (verbose) {
  for (const f of shown.slice(0, Number(process.env.LIMIT || 25))) {
    console.log("--- " + f.section + " #" + f.example + " ---");
    console.log("  md:       " + JSON.stringify(f.markdown));
    console.log("  expected: " + JSON.stringify(f.expected));
    console.log("  actual:   " + JSON.stringify(f.actual));
  }
  if (shown.length > Number(process.env.LIMIT || 25)) {
    console.log("... " + (shown.length - Number(process.env.LIMIT || 25)) + " more");
  }
  console.log("");
}

const totalFail = failures.length;
const isDeviation = (f) => {
  if (KNOWN_FAILURES[f.example]) return true;
  const base = f.section.startsWith(FIX + ":") ? FIX : f.section;
  return Object.keys(KNOWN_DEVIATIONS).some((k) => base.toLowerCase().includes(k.toLowerCase()));
};
const deviations = failures.filter(isDeviation);
const unexpected = failures.filter((f) => !isDeviation(f));

console.log(
  "CommonMark corpus + fixtures: " + pass + " passed, " + totalFail + " failed" +
  (pass + totalFail ? " (" + ((pass / (pass + totalFail)) * 100).toFixed(1) + "%)" : "")
);
console.log(
  "  deviations (documented): " + deviations.length +
  "   unexpected: " + unexpected.length +
  (unexpected.length ? "  <-- " + unexpected.map((f) => f.section + " #" + f.example).join(", ") : "")
);
const bySec = new Map();
for (const f of failures) bySec.set(f.section, (bySec.get(f.section) || 0) + 1);
if (bySec.size && !verbose) {
  const worst = [...bySec.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log("worst sections: " + worst.map(([s, c]) => s + " (" + c + ")").join(", "));
}
process.exit(unexpected.length === 0 ? 0 : 1);
