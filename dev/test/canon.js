// Shared HTML canonicalizer for the mdview renderer tests.
"use strict";

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

// Canonical HTML: attribute order / quoting / self-closing / cosmetic
// id+class differences and insignificant whitespace must not count as a
// rendering difference. Whitespace inside <pre>/<code> is significant.
function canon(html) {
  const out = [];
  const stack = [];
  let i = 0;
  let buf = "";
  const preserved = () => stack.indexOf("pre") >= 0 || stack.indexOf("code") >= 0;
  const flush = () => {
    if (!buf) return;
    if (preserved()) out.push("T" + buf);
    else {
      const v = buf.replace(/\s+/g, " ").trim();
      if (v) out.push("T" + v);
    }
    buf = "";
  };
  while (i < html.length) {
    const c = html[i];
    if (c !== "<") { buf += c; i++; continue; }
    let j = i + 1;
    let q = null;
    while (j < html.length) {
      const d = html[j];
      if (q) { if (d === q) q = null; }
      else if (d === '"' || d === "'") q = d;
      else if (d === ">") break;
      j++;
    }
    if (j >= html.length) { buf += html.slice(i); break; }
    const raw = html.slice(i, j + 1);
    const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([\s\S]*?)(\/?)>$/.exec(raw);
    if (!m) { buf += raw; i = j + 1; continue; }
    flush();
    const name = m[2].toLowerCase();
    const closing = m[1] === "/";
    const attrs = [];
    const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let a;
    while ((a = re.exec(m[3]))) {
      const key = a[1].toLowerCase();
      if (key === "id" || key === "class") continue;
      if (/^data-/.test(key)) continue; // data-* attributes are presentation only
      const val = a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4];
      attrs.push(key + (val === undefined ? "" : "=" + val));
    }
    attrs.sort();
    out.push("G<" + (closing ? "/" : "") + name + (attrs.length ? " " + attrs.join(" ") : "") + ">");
    if (closing) {
      const k = stack.lastIndexOf(name);
      if (k >= 0) stack.splice(k, 1);
    } else if (!VOID.has(name)) {
      stack.push(name);
    }
    i = j + 1;
  }
  flush();
  return out.join("\n");
}

module.exports = { canon, VOID };
