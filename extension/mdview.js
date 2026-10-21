// mdview — render the plain-text .md a browser shows into styled HTML.
//
// A pragmatic CommonMark 0.31 + GFM subset sized for reading documents:
//   blocks: ATX + setext headings, thematic breaks, fenced/indented code,
//           block quotes (nested, lazy continuation), lists (nested, ordered,
//           loose/tight, task items, lazy continuation), GFM tables (alignment,
//           optional outer pipes), paragraphs with soft/hard breaks, link
//           reference definitions, YAML frontmatter chips, mermaid diagrams.
//   inlines: code spans, links (inline/reference/shortcut), images, autolinks,
//           bare-URL linkification, the spec delimiter algorithm for emphasis
//           and strong emphasis, GFM strikethrough, `==mark==`, backslash
//           escapes, entity/numeric character references, hard line breaks.
//
// Raw HTML is NOT passed through blindly: only a presentational allowlist of
// tags survives, with attributes whitelisted, URL schemes restricted and
// style declarations filtered. Everything else is escaped, so an untrusted
// .md can't run script in a file:// origin.
(function () {
  "use strict";

  /* ------------------------------------------------------------- escaping -- */

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Minimal fallback table; the browser decodes everything for us (see below).
  const NAMED = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0",
    copy: "\u00a9", reg: "\u00ae", trade: "\u2122", hellip: "\u2026",
    mdash: "\u2014", ndash: "\u2013", laquo: "\u00ab", raquo: "\u00bb",
    lsquo: "\u2018", rsquo: "\u2019", ldquo: "\u201c", rdquo: "\u201d",
    times: "\u00d7", divide: "\u00f7", plusmn: "\u00b1", middot: "\u00b7",
    bull: "\u2022", dagger: "\u2020", Dagger: "\u2021", sect: "\u00a7",
    para: "\u00b6", deg: "\u00b0", euro: "\u20ac", pound: "\u00a3",
    yen: "\u00a5", cent: "\u00a2", frac12: "\u00bd", frac14: "\u00bc",
    frac34: "\u00be", larr: "\u2190", rarr: "\u2192", uarr: "\u2191",
    darr: "\u2193", harr: "\u2194", minus: "\u2212", ne: "\u2260",
    le: "\u2264", ge: "\u2265", infin: "\u221e", check: "\u2713",
    cross: "\u2717", heart: "\u2665", star: "\u2606", shy: "\u00ad",
    alpha: "\u03b1", beta: "\u03b2", gamma: "\u03b3", delta: "\u03b4",
    pi: "\u03c0", mu: "\u03bc", sigma: "\u03c3", omega: "\u03c9",
    Omega: "\u03a9", Delta: "\u0394", Sigma: "\u03a3",
  };

  const WIN1252 = {
    0x80: "\u20ac", 0x82: "\u201a", 0x83: "\u0192", 0x84: "\u201e",
    0x85: "\u2026", 0x86: "\u2020", 0x87: "\u2021", 0x88: "\u02c6",
    0x89: "\u2030", 0x8a: "\u0160", 0x8b: "\u2039", 0x8c: "\u0152",
    0x8e: "\u017d", 0x91: "\u2018", 0x92: "\u2019", 0x93: "\u201c",
    0x94: "\u201d", 0x95: "\u2022", 0x96: "\u2013", 0x97: "\u2014",
    0x98: "\u02dc", 0x99: "\u2122", 0x9a: "\u0161", 0x9b: "\u203a",
    0x9c: "\u0153", 0x9e: "\u017e", 0x9f: "\u0178",
  };

  let entitySink = null;
  function namedEntity(name) {
    if (Object.prototype.hasOwnProperty.call(NAMED, name)) return NAMED[name];
    if (typeof document === "undefined" || !document.createElement) return undefined;
    if (!entitySink) entitySink = document.createElement("textarea");
    entitySink.innerHTML = "&" + name + ";";
    const v = entitySink.value;
    return v === "&" + name + ";" ? undefined : v;
  }

  const ENTITY_RE = /&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/g;
  const ENTITY_AT = /^&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/;

  function decodeEntities(s) {
    if (s.indexOf("&") < 0) return s;
    return s.replace(ENTITY_RE, (m) => {
      const body = m.slice(1, -1);
      if (body.charCodeAt(0) === 35 /* # */) {
        const hex = body[1] === "x" || body[1] === "X";
        let cp = hex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        if (!isFinite(cp) || cp === 0 || cp > 0x10ffff) return "\ufffd";
        if (cp >= 0xd800 && cp <= 0xdfff) return "\ufffd";
        if (cp >= 0x80 && cp <= 0x9f && WIN1252[cp]) return WIN1252[cp];
        try { return String.fromCodePoint(cp); } catch (e) { return "\ufffd"; }
      }
      const v = namedEntity(body);
      return v === undefined ? m : v;
    });
  }

  /* --------------------------------------------------------- char classes -- */

  const PUNCT_RE = /[\p{P}\p{S}]/u;
  // CommonMark "Unicode whitespace": Zs (which includes U+00A0) plus tab/LF/FF/CR.
  // It decides inline flanking and link destinations — not block structure.
  const UNI_WS_RE = /^[\t\n\v\f\r\p{Zs}]$/u;
  // Block structure only ever sees spaces and tabs as blank.
  const BLANK_RE = /^[ \t]*$/;
  function isSpace(c) { return c !== undefined && UNI_WS_RE.test(c); }
  function isPunct(c) { return c !== undefined && PUNCT_RE.test(c); }
  function isBlank(s) { return BLANK_RE.test(s); }
  const PUNCT_ESCAPES = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";

  /* --------------------------------------------------------------- urls ---- */

  // Only the script-injecting schemes are refused, so unusual-but-harmless
  // schemes (made-up-scheme:, localhost:) still work like they do in cmark.
  const BAD_SCHEME = /^(?:javascript|vbscript|data|blob)$/i;
  const HAS_SCHEME = /^([a-zA-Z][a-zA-Z0-9+.\-]*):/;

  function safeUrl(raw) {
    const s = String(raw);
    // Test the scheme on a stripped copy (so "java\nscript:" can't sneak by)
    // but hand back the original text.
    const probe = s.replace(/[\u0000-\u0020\u007f]+/g, "");
    const m = HAS_SCHEME.exec(probe);
    if (m && BAD_SCHEME.test(m[1])) return null;
    return s;
  }

  // Percent-encode a destination the way cmark does: keep the RFC 3986
  // unreserved + sub-delim/gen-delim set, encode everything else as UTF-8.
  const HREF_SAFE_CH = /^[A-Za-z0-9\-_.~!$&'()*+,;=:@\/?#%]$/;
  const UTF8_ENCODER = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
  function encodeUrl(raw) {
    const s = String(raw);
    let out = "";
    for (const ch of s) {
      if (HREF_SAFE_CH.test(ch)) { out += ch; continue; }
      let bytes;
      if (UTF8_ENCODER) bytes = UTF8_ENCODER.encode(ch);
      else {
        // minimal UTF-8 encoder for the Node fallback
        const cp = ch.codePointAt(0);
        if (cp < 0x80) bytes = [cp];
        else if (cp < 0x800) bytes = [0xc0 | (cp >> 6), 0x80 | (cp & 63)];
        else if (cp < 0x10000) bytes = [0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)];
        else bytes = [0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)];
      }
      for (const b of bytes) out += "%" + (b < 16 ? "0" : "") + b.toString(16).toUpperCase();
    }
    return out;
  }

  /* ------------------------------------------------- sanitized raw HTML ---- */

  const HTML_TAGS = new Set([
    "a", "abbr", "b", "bdi", "bdo", "big", "br", "caption", "center", "cite",
    "code", "col", "colgroup", "dd", "del", "dfn", "details", "div", "dl",
    "dt", "em", "figcaption", "figure", "h1", "h2", "h3", "h4", "h5", "h6",
    "hr", "i", "img", "ins", "kbd", "li", "mark", "nav", "ol", "p", "picture",
    "pre", "q", "rp", "rt", "ruby", "s", "samp", "section", "small", "source",
    "span", "strong", "sub", "summary", "sup", "table", "tbody", "td", "tfoot",
    "th", "thead", "time", "tr", "tt", "u", "ul", "var", "wbr",
  ]);
  const VOID_TAGS = new Set(["br", "hr", "img", "wbr", "col", "source"]);
  const ATTRS = {
    a: ["href"],
    img: ["src", "alt", "width", "height", "loading", "decoding"],
    ol: ["start", "type"],
    li: ["value"],
    td: ["colspan", "rowspan"],
    th: ["colspan", "rowspan", "scope"],
    time: ["datetime"],
    q: ["cite"],
    blockquote: ["cite"],
    del: ["cite"],
    ins: ["cite"],
    details: ["open"],
    source: ["src", "type", "media"],
  };
  const GLOBAL_ATTRS = ["id", "title", "align", "lang", "dir", "style"];
  const NUMERIC_ATTRS = new Set(["width", "height", "colspan", "rowspan", "value", "start"]);
  const ENUM_ATTRS = {
    ol: { type: /^[1aAiI]$/ },
    img: { loading: /^(lazy|eager)$/, decoding: /^(sync|async|auto)$/ },
    th: { scope: /^(row|col|rowgroup|colgroup)$/ },
  };
  const STYLE_PROPS = new Set([
    "text-align", "width", "height", "min-width", "max-width", "min-height",
    "max-height", "margin", "margin-top", "margin-right", "margin-bottom",
    "margin-left", "padding", "padding-top", "padding-right", "padding-bottom",
    "padding-left", "float", "display", "vertical-align", "font-size",
    "font-weight", "font-style", "line-height", "letter-spacing", "color",
    "background", "background-color", "border", "border-radius", "opacity",
    "white-space", "text-transform", "text-decoration",
  ]);

  function safeStyle(v) {
    const out = [];
    for (const decl of String(v).split(";")) {
      const at = decl.indexOf(":");
      if (at < 0) continue;
      const prop = decl.slice(0, at).trim().toLowerCase();
      const val = decl.slice(at + 1).trim();
      if (!STYLE_PROPS.has(prop)) continue;
      if (/url\s*\(|expression|@import|javascript|\\/i.test(val)) continue;
      if (!/^[a-zA-Z0-9\s.,#%()\-+*'/!]+$/.test(val)) continue;
      out.push(prop + ":" + val);
    }
    return out.join(";");
  }

  const TAG_RE = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>$/;
  const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;

  // Returns a safe tag string, or the input HTML-escaped when it isn't allowed.
  function sanitizeTag(raw) {
    const m = TAG_RE.exec(raw);
    if (!m) return escapeHtml(raw);
    const name = m[2].toLowerCase();
    if (!HTML_TAGS.has(name)) return escapeHtml(raw);
    if (m[1] === "/") return "</" + name + ">";
    const allowed = ATTRS[name] || [];
    const parts = [];
    const seen = {};
    let a;
    ATTR_RE.lastIndex = 0;
    while ((a = ATTR_RE.exec(m[3]))) {
      const key = a[1].toLowerCase();
      if (seen[key]) continue;
      let val = a[2];
      if (val === undefined) {
        if (key === "open" && name === "details") parts.push("open");
        continue;
      }
      if (val[0] === '"' || val[0] === "'") val = val.slice(1, -1);
      if (GLOBAL_ATTRS.indexOf(key) < 0 && allowed.indexOf(key) < 0) continue;
      if (key === "href" || key === "src" || key === "cite") {
        const u = safeUrl(decodeEntities(val));
        if (u === null) continue;
        val = u;
      } else if (key === "style") {
        val = safeStyle(val);
        if (!val) continue;
      } else if (NUMERIC_ATTRS.has(key)) {
        val = val.trim();
        if (!/^\d+$/.test(val)) continue;
      } else if (key === "align") {
        val = val.trim().toLowerCase();
        if (!/^(left|center|right|justify)$/.test(val)) continue;
      } else if (ENUM_ATTRS[name] && ENUM_ATTRS[name][key]) {
        val = val.trim();
        if (!ENUM_ATTRS[name][key].test(val)) continue;
      } else {
        val = decodeEntities(val);
      }
      seen[key] = true;
      parts.push(key + '="' + escapeHtml(val) + '"');
    }
    return "<" + name + (parts.length ? " " + parts.join(" ") : "") + (VOID_TAGS.has(name) ? " />" : ">");
  }

  // Walk a chunk of HTML, keeping allowed tags and escaping everything else.
  function sanitizeFragment(html) {
    let out = "";
    for (let i = 0; i < html.length; ) {
      const lt = html.indexOf("<", i);
      if (lt < 0) { out += html.slice(i); break; }
      out += html.slice(i, lt);
      if (html.startsWith("<!--", lt)) {
        const end = html.indexOf("-->", lt + 4);
        if (end < 0) { out += escapeHtml(html.slice(lt)); break; }
        out += html.slice(lt, end + 3);
        i = end + 3;
        continue;
      }
      const gt = html.indexOf(">", lt);
      if (gt < 0) { out += escapeHtml(html.slice(lt)); break; }
      out += sanitizeTag(html.slice(lt, gt + 1));
      i = gt + 1;
    }
    return out;
  }

  const HTML_BLOCK_TAGS = new Set([
    "address", "article", "aside", "blockquote", "center", "dd", "details",
    "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer", "h1",
    "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol",
    "p", "picture", "pre", "section", "summary", "table", "tbody", "td",
    "tfoot", "th", "thead", "tr", "ul",
  ]);

  /* ---------------------------------------------- inline: emphasis core ---- */

  function runLength(text, i, ch) {
    let n = 0;
    while (text[i + n] === ch) n++;
    return n;
  }

  // CommonMark "flanking" rules for a delimiter run at `pos`.
  function scanDelims(text, pos, ch) {
    const n = runLength(text, pos, ch);
    const before = pos > 0 ? text[pos - 1] : "\n";
    const after = pos + n < text.length ? text[pos + n] : "\n";
    const beforeWs = isSpace(before);
    const afterWs = isSpace(after);
    const beforePunct = isPunct(before);
    const afterPunct = isPunct(after);
    const leftFlank = !afterWs && (!afterPunct || beforeWs || beforePunct);
    const rightFlank = !beforeWs && (!beforePunct || afterWs || afterPunct);
    if (ch === "_") {
      return {
        n,
        canOpen: leftFlank && (!rightFlank || beforePunct),
        canClose: rightFlank && (!leftFlank || afterPunct),
      };
    }
    return { n, canOpen: leftFlank, canClose: rightFlank };
  }

  // Resolve * _ ~ delimiter runs into em/strong/del nodes (spec "process
  // emphasis"), matching nearest openers with the multiple-of-three rule.
  function resolveEmphasis(nodes) {
    for (let guard = 0; guard < 10000; guard++) {
      let matched = false;
      for (let i = 0; i < nodes.length && !matched; i++) {
        const closer = nodes[i];
        if (closer.k !== "delim" || !closer.canClose || closer.n === 0) continue;
        for (let j = i - 1; j >= 0; j--) {
          const opener = nodes[j];
          if (opener.k === "delim" && opener.ch === closer.ch && opener.canOpen && opener.n > 0) {
            if (closer.ch === "~" || closer.ch === "=") {
              if (opener.n !== closer.n) continue;
            } else if (
              (closer.canOpen || opener.canClose) &&
              (opener.n + closer.n) % 3 === 0 &&
              !(opener.n % 3 === 0 && closer.n % 3 === 0)
            ) {
              continue;
            }
            const use = closer.ch === "~" || closer.ch === "=" ? closer.n : opener.n >= 2 && closer.n >= 2 ? 2 : 1;
            const kind = closer.ch === "~" ? "del" : closer.ch === "=" ? "mark" : use === 2 ? "strong" : "em";
            const children = nodes.slice(j + 1, i);
            opener.n -= use;
            closer.n -= use;
            // exhausting a run removes it; a partial run stays a delimiter so
            // the leftover characters can still pair up (***x*** -> <em><strong>)
            const repl = [];
            if (opener.n > 0) repl.push(Object.assign({}, opener));
            repl.push({ k: kind, children });
            if (closer.n > 0) repl.push(Object.assign({}, closer));
            nodes.splice(j, i - j + 1, ...repl);
            matched = true;
            break;
          }
        }
      }
      if (!matched) break;
    }
    return nodes;
  }

  /* ---------------------------------------------------------- inline: links */

  // Labels match after whitespace collapsing + Unicode case folding. JS
  // toLowerCase() doesn't fold the sharp s / ligatures / final sigma, so map
  // those explicitly (spec example: [ẞ] matches [SS]).
  const CASE_FOLD = {
    "\u00df": "ss", "\u1e9e": "ss", "\ufb00": "ff", "\ufb01": "fi", "\ufb02": "fl",
    "\ufb03": "ffi", "\ufb04": "ffl", "\ufb05": "ft", "\ufb06": "st", "\u017f": "s",
    "\u03c2": "\u03c3", "\u00b5": "\u03bc",
  };
  function normalizeLabel(s) {
    return String(s)
      .trim()
      .replace(/[ \t\n\r]+/g, " ")
      .toLowerCase()
      .replace(/[\u00df\u1e9e\ufb00-\ufb06\u017f\u03c2\u00b5]/g, (c) => CASE_FOLD[c]);
  }

  // An unescaped bracket anywhere makes a link label invalid.
  const LABEL_OK = /^(?:[^\[\]\\]|\\.)*$/;
  function validLabel(s) { return s.length > 0 && LABEL_OK.test(s); }

  function unescapePunct(s) {
    return String(s).replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, "$1");
  }

  // Link destinations are terminated by ASCII space/control characters only,
  // so a stray U+00A0 stays part of the URL.
  function isAsciiWs(c) {
    return c === " " || c === "\t" || c === "\n" || c === "\v" || c === "\f" || c === "\r";
  }
  function trimAscii(s) {
    return String(s).replace(/^[ \t\n\v\f\r]+/, "").replace(/[ \t\n\v\f\r]+$/, "");
  }

  // destination [ "title" ] — used by inline links and reference definitions.
  function parseDestTitle(s) {
    s = trimAscii(s);
    let dest = "";
    if (s[0] === "<") {
      let end = -1;
      for (let k = 1; k < s.length; k++) {
        const c = s[k];
        if (c === "\\") { k++; continue; }
        if (c === "<" || c === "\n") return null;
        if (c === ">") { end = k; break; }
      }
      if (end < 0) return null;
      dest = s.slice(1, end);
      s = s.slice(end + 1);
    } else {
      let depth = 0;
      let k = 0;
      let out = "";
      for (; k < s.length; k++) {
        const c = s[k];
        if (c === "\\") {
          if (k + 1 >= s.length) return null;
          out += s.slice(k, k + 2);
          k++;
          continue;
        }
        if (isAsciiWs(c)) break;
        if (c === "(") depth++;
        else if (c === ")") { if (depth === 0) break; depth--; }
        out += c;
      }
      if (depth !== 0) return null;
      dest = out;
      s = s.slice(k);
    }
    const rest = s;
    s = trimAscii(rest);
    let title = "";
    if (s) {
      // the title has to be separated from the destination by whitespace
      if (rest === s) return null;
      const q = s[0];
      const endCh = q === "(" ? ")" : q;
      if (q !== '"' && q !== "'" && q !== "(") return null;
      let end = -1;
      for (let k = 1; k < s.length; k++) {
        const c = s[k];
        if (c === "\\") { k++; continue; }
        if (c === endCh) { end = k; break; }
      }
      if (end < 0) return null;
      title = s.slice(1, end);
      if (trimAscii(s.slice(end + 1)) !== "") return null;
    }
    return {
      dest: decodeEntities(unescapePunct(dest)),
      title: title ? decodeEntities(unescapePunct(title)) : "",
    };
  }

  function findClosingBracket(text, open) {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
      const c = text[i];
      if (c === "\\") { i++; continue; }
      if (c === "`") {
        const n = runLength(text, i, "`");
        const end = text.indexOf("`".repeat(n), i + n);
        if (end >= 0) { i = end + n - 1; continue; }
      }
      // a bracket inside an autolink or raw HTML tag doesn't close the label
      if (c === "<") {
        const gt = text.indexOf(">", i);
        if (gt > i) {
          const span = text.slice(i, gt + 1);
          if (TAG_RE.test(span) || AUTOLINK_RE.test(span) || EMAIL_RE.test(span)) { i = gt; continue; }
        }
      }
      if (c === "[") depth++;
      else if (c === "]") { depth--; if (depth === 0) return i; }
    }
    return -1;
  }

  function findClosingParen(text, open) {
    let depth = 1;
    for (let i = open + 1; i < text.length; i++) {
      const c = text[i];
      if (c === "\\") { i++; continue; }
      if (c === "<") { const e = text.indexOf(">", i); if (e < 0) return -1; i = e; continue; }
      if (c === "(") depth++;
      else if (c === ")") { depth--; if (depth === 0) return i; }
      else if (c === "\n" && text[i + 1] === "\n") return -1;
    }
    return -1;
  }

  const AUTOLINK_RE = /^<([a-zA-Z][a-zA-Z0-9+.\-]{1,31}:[^<>\x00-\x20]*)>/;
  const EMAIL_RE = /^<([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/;
  const BARE_URL = /^(https?:\/\/|www\.)[^\s<]+/;

  function trimUrlEnd(u) {
    let s = u;
    for (;;) {
      const trimmed = s.replace(/[.,:;!?'"*_~]+$/, "");
      if (trimmed !== s) { s = trimmed; continue; }
      const opens = (s.match(/\(/g) || []).length;
      const closes = (s.match(/\)/g) || []).length;
      if (closes > opens && s.endsWith(")")) { s = s.slice(0, -1); continue; }
      break;
    }
    return s;
  }

  /* ------------------------------------------------------------- tokenizer - */

  const BK = "`"; // placeholder to keep template literals readable

  function tokenize(text, ctx) {
    const out = [];
    let buf = "";
    const push = (node) => { flush(); out.push(node); };
    function flush() {
      if (buf) { out.push({ k: "text", v: decodeEntities(buf) }); buf = ""; }
    }

    for (let i = 0; i < text.length; ) {
      const c = text[i];

      /* code span: closes on the next run of exactly as many backticks */
      if (c === BK) {
        const n = runLength(text, i, BK);
        const fence = BK.repeat(n);
        let close = -1;
        let at = text.indexOf(BK, i + n);
        while (at >= 0) {
          const len = runLength(text, at, BK);
          if (len === n) { close = at; break; }
          at = text.indexOf(BK, at + len);
        }
        if (close >= 0) {
          let code = text.slice(i + n, close).replace(/\n/g, " ");
          if (code.length > 2 && code[0] === " " && code[code.length - 1] === " " && code.trim() !== "") {
            code = code.slice(1, -1);
          }
          push({ k: "code", v: decodeEntities(code) });
          i = close + n;
          continue;
        }
        buf += fence;
        i += n;
        continue;
      }

      /* backslash escape + hard break */
      if (c === "\\") {
        const next = text[i + 1];
        if (next === "\n") { push({ k: "br" }); i += 2; continue; }
        if (next !== undefined && PUNCT_ESCAPES.indexOf(next) >= 0) { buf += next; i += 2; continue; }
        buf += "\\";
        i++;
        continue;
      }

      /* entity */
      if (c === "&") {
        const m = ENTITY_AT.exec(text.slice(i));
        if (m) { buf += m[0]; i += m[0].length; continue; }
      }

      /* newline: hard or soft break */
      if (c === "\n") {
        const trailing = /(?: {2,}|\\)$/.exec(buf);
        if (trailing) {
          buf = buf.slice(0, buf.length - trailing[0].length);
          push({ k: "br" });
        } else {
          push({ k: "soft" });
        }
        i++;
        continue;
      }

      /* footnote citation (GFM) — ahead of links, because `[^1]` also looks like
         a shortcut reference. Never inside a link label: the marker is itself an
         <a>, and an <a> inside an <a> is not a document. */
      if (c === "[" && text[i + 1] === "^" && !ctx.inLink) {
        const node = tryFootnoteRef(text, i);
        if (node) { push(node.node); i = node.end; continue; }
      }

      /* images and links */
      if (c === "!" && text[i + 1] === "[") {
        const node = tryLink(text, i + 1, ctx, true);
        if (node) { push(node.node); i = node.end; continue; }
      }
      if (c === "[") {
        const node = tryLink(text, i, ctx, false);
        if (node) { push(node.node); i = node.end; continue; }
      }

      /* autolinks + raw HTML */
      if (c === "<") {
        const am = AUTOLINK_RE.exec(text.slice(i)) || EMAIL_RE.exec(text.slice(i));
        if (am) {
          const url = am[1];
          const isMail = !/^[a-zA-Z][a-zA-Z0-9+.\-]*:/.test(url);
          push({ k: "link", href: isMail ? "mailto:" + url : url, title: "", children: [{ k: "text", v: url }] });
          i += am[0].length;
          continue;
        }
        const gt = text.indexOf(">", i);
        const raw = gt < 0 ? null : text.slice(i, gt + 1);
        if (raw && TAG_RE.test(raw) && HTML_TAGS.has(TAG_RE.exec(raw)[2].toLowerCase())) {
          push({ k: "raw", v: sanitizeTag(raw) });
          i = gt + 1;
          continue;
        }
        if (text.startsWith("<!--", i)) {
          const end = text.indexOf("-->", i + 4);
          if (end > 0) { push({ k: "raw", v: text.slice(i, end + 3) }); i = end + 3; continue; }
        }
        // A broken autolink (e.g. <https://x/y z>) stays literal in one piece
        // instead of letting bare-URL linkification chew on its insides.
        if (/^[ \t]*[a-zA-Z][a-zA-Z0-9+.\-]{1,31}:/.test(text.slice(i + 1))) {
          const gt = text.indexOf(">", i);
          const end = gt < 0 ? text.length : gt + 1;
          buf += text.slice(i, end);
          i = end;
          continue;
        }
        buf += "<";
        i++;
        continue;
      }

      /* bare url linkification (GFM) */
      if ((c === "h" || c === "w") && !ctx.inLink) {
        const prev = i > 0 ? text[i - 1] : "\n";
        if (isSpace(prev) || "([<*_~\"'".indexOf(prev) >= 0) {
          const m = BARE_URL.exec(text.slice(i));
          if (m) {
            const url = trimUrlEnd(m[0]);
            if (url.length > (url.startsWith("www.") ? 4 : 8)) {
              push({
                k: "link",
                href: (url.startsWith("www.") ? "http://" : "") + url,
                title: "",
                children: [{ k: "text", v: url }],
              });
              i += url.length;
              continue;
            }
          }
        }
      }

      /* emphasis / strikethrough / mark delimiters */
      if (c === "*" || c === "_" || c === "~" || c === "=") {
        const d = scanDelims(text, i, c);
        // GFM: only runs of one or two tildes delimit strikethrough
        if (c === "~" && d.n > 2) { buf += c.repeat(d.n); i += d.n; continue; }
        // `==` marks text. Only an exactly-two run delimits: a lone `=` is
        // prose ("if x = 3"), and three or more is a setext underline or a
        // thematic break, which the block parser has already taken.
        if (c === "=" && d.n !== 2) { buf += c.repeat(d.n); i += d.n; continue; }
        if (d.canOpen || d.canClose) {
          push({ k: "delim", ch: c, n: d.n, canOpen: d.canOpen, canClose: d.canClose });
        } else {
          buf += c.repeat(d.n);
        }
        i += d.n;
        continue;
      }

      buf += c;
      i++;
    }
    flush();
    return resolveEmphasis(out);
  }

  // Link or image starting at `open` (the index of "["). Precedence is the
  // spec's: inline link, then full/collapsed reference, then shortcut.
  function tryLink(text, open, ctx, isImage) {
    if (ctx.inLink && !isImage) return null;
    const close = findClosingBracket(text, open);
    if (close < 0) return null;
    const inner = text.slice(open + 1, close);
    let i = close + 1;
    let target = null;

    // link text may hold balanced brackets; only reference labels are strict
    if (text[i] === "(") {
      const end = findClosingParen(text, i);
      if (end >= 0) {
        const parsed = parseDestTitle(text.slice(i + 1, end));
        if (parsed) { target = parsed; i = end + 1; }
      }
    }
    if (!target && text[i] === "[") {
      const refClose = findClosingBracket(text, i);
      if (refClose > 0) {
        const rawLabel = text.slice(i + 1, refClose);
        const key = rawLabel === "" ? inner : rawLabel;
        if (!validLabel(key)) return null;
        const def = ctx.refs[normalizeLabel(key)];
        // a failed full reference deactivates the shortcut fallback
        if (!def) return null;
        target = def;
        i = refClose + 1;
      }
    }
    if (!target && inner !== "" && validLabel(inner)) target = ctx.refs[normalizeLabel(inner)] || null;
    if (!target) return null;
    // Links may not contain links: the innermost one wins, so a label that
    // itself contains a link leaves this bracket as literal text. (Images are
    // fine — a label may hold an image and vice versa.)
    if (!isImage) {
      for (let k = 0; k < inner.length; k++) {
        if (inner[k] === "[" && inner[k - 1] !== "!" && tryLink(inner, k, ctx, false)) return null;
      }
    }
    const children = tokenize(inner, { refs: ctx.refs, inLink: isImage ? ctx.inLink : true });
    if (isImage) {
      return { node: { k: "img", src: target.dest, title: target.title, children }, end: i };
    }
    return { node: { k: "link", href: target.dest, title: target.title, children }, end: i };
  }

  /* ------------------------------------------------------- inline: render -- */

  function renderNodes(nodes) {
    let out = "";
    for (const n of nodes) out += renderNode(n);
    return out;
  }

  function renderNode(n) {
    switch (n.k) {
      case "text": return escapeHtml(n.v);
      case "raw": return n.v;
      case "code": return "<code>" + escapeHtml(n.v) + "</code>";
      case "br": return "<br>";
      case "soft": return "\n";
      case "em": return "<em>" + renderNodes(n.children) + "</em>";
      case "strong": return "<strong>" + renderNodes(n.children) + "</strong>";
      case "del": return "<del>" + renderNodes(n.children) + "</del>";
      case "mark": return "<mark>" + renderNodes(n.children) + "</mark>";
      case "delim": return escapeHtml(n.ch.repeat(n.n));
      case "fnref":
        return '<sup class="fnref"><a href="#fn-' + n.n + '" id="' +
          (n.count === 1 ? "fnref-" + n.n : "fnref-" + n.n + "-" + n.count) +
          '" aria-label="Footnote ' + n.n + '">' + n.n + "</a></sup>";
      case "link": {
        const href = safeUrl(n.href);
        if (href === null) return renderNodes(n.children);
        return (
          '<a href="' + escapeHtml(encodeUrl(href)) + '"' +
          (n.title ? ' title="' + escapeHtml(n.title) + '"' : "") +
          ">" + renderNodes(n.children) + "</a>"
        );
      }
      case "img": {
        const src = safeUrl(n.src);
        const alt = plainText(n.children);
        if (src === null) return escapeHtml(alt);
        return (
          '<img src="' + escapeHtml(encodeUrl(src)) + '" alt="' + alt + '"' +
          (n.title ? ' title="' + escapeHtml(n.title) + '"' : "") + ">"
        );
      }
      default: return "";
    }
  }

  // Plain-text projection of inline nodes — image alt text (nested images
  // contribute their own alt text, raw HTML contributes nothing).
  function plainText(nodes) {
    let out = "";
    for (const n of nodes) {
      switch (n.k) {
        case "text":
        case "code":
        case "delim":
          out += escapeHtml(n.v !== undefined ? n.v : n.ch.repeat(n.n));
          break;
        case "em":
        case "strong":
        case "del":
        case "link":
        case "img":
          out += plainText(n.children);
          break;
        case "br":
        case "soft":
          out += " ";
          break;
        default:
          break;
      }
    }
    return out;
  }

  function renderInline(text, refs) {
    return renderNodes(tokenize(String(text), { refs: refs || Object.create(null), inLink: false }));
  }

  /* ---------------------------------------------------------- blocks: util - */

  function expandLeadingTabs(line) {
    let out = "";
    let col = 0;
    let i = 0;
    for (; i < line.length; i++) {
      const c = line[i];
      if (c === " ") { out += " "; col++; continue; }
      if (c === "\t") { const w = 4 - (col % 4); out += " ".repeat(w); col += w; continue; }
      break;
    }
    return out + line.slice(i);
  }

  function indentOf(line) { return /^ */.exec(line)[0].length; }

  function stripIndent(line, n) {
    let k = 0;
    while (k < n && line[k] === " ") k++;
    return line.slice(k);
  }

  const RE_FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
  const RE_ATX = /^( {0,3})(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
  const RE_HR = /^( {0,3})(?:\*[ \t]*){3,}$|^( {0,3})(?:-[ \t]*){3,}$|^( {0,3})(?:_[ \t]*){3,}$/;
  const RE_QUOTE = /^ {0,3}> ?/;
  const RE_BULLET = /^( {0,3})([-+*])([ \t]+|$)(.*)$/;
  const RE_ORDERED = /^( {0,3})(\d{1,9})([.)])([ \t]+|$)(.*)$/;
  const RE_SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
  const RE_INDENTED = /^ {4}/;
  const RE_TABLE_SEP = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
  // The row above the delimiter: a cell row (pipes on both sides) or a line with
  // a pipe in it that does not start with whitespace (`Name | Purpose`).
  const RE_TABLE_HEAD = /^ {0,3}\|[^|]*\||^ {0,3}[^|\s].*\|/;

  function markerOf(line) {
    const o = RE_ORDERED.exec(line);
    if (o) {
      return {
        indent: o[1].length, ordered: true, delim: o[3], start: parseInt(o[2], 10),
        rest: o[5], markerWidth: o[2].length + 1, padLen: o[4].length,
      };
    }
    const b = RE_BULLET.exec(line);
    if (b) {
      return {
        indent: b[1].length, ordered: false, delim: b[2], start: 1,
        rest: b[4], markerWidth: 1, padLen: b[3].length,
      };
    }
    return null;
  }

  // Can this line begin a block that would interrupt a paragraph (or an item)?
  // `next` is the following line, needed only for the table case below.
  function isBlockStart(line, inParagraph, next) {
    if (RE_FENCE.test(line) && !(RE_FENCE.exec(line)[2][0] === "`" && RE_FENCE.exec(line)[3].indexOf("`") >= 0)) return true;
    if (RE_ATX.test(line)) return true;
    if (RE_HR.test(line)) return true;
    if (RE_QUOTE.test(line)) return true;
    const o = RE_ORDERED.exec(line);
    if (o) {
      if (!inParagraph) return true;
      return o[2] === "1" && !isBlank(o[5]);
    }
    const b = RE_BULLET.exec(line);
    if (b) {
      if (!inParagraph) return true;
      return !isBlank(b[4]);
    }
    if (!inParagraph && RE_INDENTED.test(line)) return true;
    // A GFM table interrupts a paragraph. The delimiter row ends the paragraph
    // and the line above it — here, the paragraph's own last line — becomes the
    // table's header row, which is what cmark-gfm does. Without this a label
    // sitting directly on top of a table (`**Examples:**`) swallows the whole
    // table as literal pipe characters, because a paragraph only stops at a
    // blank line or at a block start.
    if (inParagraph && next !== undefined && RE_TABLE_SEP.test(next) &&
        line.indexOf("|") >= 0 && RE_TABLE_HEAD.test(line)) return true;
    return false;
  }

  /* --------------------------------------------------------- blocks: lists - */

  function splitRow(row) {
    let s = row.trim();
    if (s.startsWith("|")) s = s.slice(1);
    if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
    const cells = [];
    let cur = "";
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === "\\" && s[i + 1] === "|") { cur += "|"; i++; continue; }
      if (c === "|") { cells.push(cur); cur = ""; continue; }
      cur += c;
    }
    cells.push(cur);
    return cells.map((c) => c.trim());
  }

  function contentColumn(m) {
    if (isBlank(m.rest)) return m.indent + m.markerWidth + 1;
    return m.indent + m.markerWidth + (m.padLen >= 1 && m.padLen <= 4 ? m.padLen : 1);
  }

  function fenceCloser(ch, len) {
    return new RegExp("^ {0,3}" + (ch === "`" ? "`" : "~") + "{" + len + ",}[ \\t]*$");
  }

  // A line that is plain paragraph text — a lazy line may be folded onto it
  // without disturbing container structure.
  function isPlainTextLine(line) {
    if (line === undefined) return false;
    return !(
      markerOf(line) || RE_QUOTE.test(line) || RE_FENCE.test(line) ||
      RE_ATX.test(line) || RE_HR.test(line) || RE_INDENTED.test(line)
    );
  }

  // Is the last block opened by these lines an ordinary paragraph (so that a
  // lazy continuation line may join it)?
  function openBlockIsText(sub) {
    if (!sub.length) return false;
    let fence = null;
    for (const line of sub) {
      if (fence) {
        if (fenceCloser(fence.ch, fence.len).test(line)) fence = null;
        continue;
      }
      const fm = RE_FENCE.exec(line);
      if (fm && !(fm[2][0] === "`" && fm[3].indexOf("`") >= 0)) {
        fence = { ch: fm[2][0], len: fm[2].length };
      }
    }
    if (fence) return false;
    const lastLine = sub[sub.length - 1];
    // a blank line ends the paragraph, so nothing can lazily continue it
    return !isBlank(lastLine) && !RE_INDENTED.test(lastLine);
  }

  // A list is loose when a blank line separates blocks *directly* owned by one
  // of its items — a blank inside a nested list, block quote or code fence
  // doesn't count.
  function hasInternalBlank(body) {
    let last = body.length - 1;
    while (last >= 0 && isBlank(body[last])) last--;
    let fence = null;
    for (let i = 0; i <= last; i++) {
      const line = body[i];
      if (fence) {
        if (fenceCloser(fence.ch, fence.len).test(line)) fence = null;
        continue;
      }
      const fm = RE_FENCE.exec(line);
      if (fm && !(fm[2][0] === "`" && fm[3].indexOf("`") >= 0)) {
        fence = { ch: fm[2][0], len: fm[2].length };
        continue;
      }
      if (i === 0 || !isBlank(line)) continue;
      let j = i + 1;
      while (j <= last && isBlank(body[j])) j++;
      if (j > last) continue;
      let p = i - 1;
      while (p >= 0 && isBlank(body[p])) p--;
      const next = body[j];
      const pm = p >= 0 ? markerOf(body[p]) : null;
      // blank between items of a nested list, or inside a nested block quote
      if (pm && indentOf(next) >= contentColumn(pm)) continue;
      if (/^ {0,3}>/.test(body[p] || "") && /^ {0,3}>/.test(next)) continue;
      return true;
    }
    return false;
  }

  /* -------------------------------------------------------- blocks: parser - */

  function parseBlocks(lines, opts) {
    opts = opts || {};
    const tight = !!opts.tight;
    const refs = opts.refs || Object.create(null);
    const ctx = { refs, inLink: false };
    const n = lines.length;
    let out = "";
    let i = 0;

    while (i < n) {
      const line = lines[i];
      if (isBlank(line)) { i++; continue; }

      /* fenced code */
      let fm = RE_FENCE.exec(line);
      if (fm && !(fm[2][0] === "`" && fm[3].indexOf("`") >= 0)) {
        const indent = fm[1].length;
        const fence = fm[2];
        const info = fm[3].trim();
        const closeRe = new RegExp(
          "^ {0,3}" + (fence[0] === "`" ? "`" : "~") + "{" + fence.length + ",}[ \\t]*$"
        );
        const buf = [];
        i++;
        while (i < n && !closeRe.test(lines[i])) {
          buf.push(stripIndent(lines[i], indent));
          i++;
        }
        if (i < n) i++; // closing fence
        const body = buf.join("\n");
        if (/^mermaid\b/.test(info)) {
          out += '<pre class="mermaid">' + escapeHtml(body) + "</pre>\n";
        } else {
          const lang = info.split(/\s+/)[0];
          // data-lang is presentation only: it lets the stylesheet print the
          // language in the block's corner (CSS cannot read a class name).
          out += '<pre class="fence"' + (lang ? ' data-lang="' + escapeHtml(lang) + '"' : "") +
            '><code' + (lang ? ' class="language-' + escapeHtml(lang) + '"' : "") +
            ">" + escapeHtml(body) + (body ? "\n" : "") + "</code></pre>\n";
        }
        continue;
      }

      /* ATX heading */
      let m = RE_ATX.exec(line);
      if (m) {
        let content = m[3] === undefined ? "" : m[3];
        content = /^#+[ \t]*$/.test(content) ? "" : content.replace(/[ \t]+#+[ \t]*$/, "");
        content = content.replace(/[ \t]+$/, "");
        const level = m[2].length;
        out += heading(level, renderInline(content, refs)) + "\n";
        i++;
        continue;
      }

      /* thematic break */
      if (RE_HR.test(line)) { out += "<hr>\n"; i++; continue; }

      /* block quote */
      if (RE_QUOTE.test(line)) {
        const sub = [];
        while (i < n) {
          const L = lines[i];
          if (RE_QUOTE.test(L)) {
            sub.push(L.replace(RE_QUOTE, ""));
            i++;
            continue;
          }
          if (isBlank(L)) break;
          // A lazy line continues the quote's open paragraph only — never a
          // code block or a fence (spec examples 236/237).
          if (openBlockIsText(sub) && !isBlockStart(L, true, lines[i + 1])) {
            if (isPlainTextLine(sub[sub.length - 1])) sub[sub.length - 1] += "\n" + L;
            else sub.push(L);
            i++;
            continue;
          }
          break;
        }
        out += "<blockquote>\n" + parseBlocks(sub, { refs }) + "</blockquote>\n";
        continue;
      }

      /* lists */
      if (markerOf(line)) {
        const list = renderList(lines, i, refs);
        out += list.html + "\n";
        i = list.next;
        continue;
      }

      /* GFM table */
      if (line.indexOf("|") >= 0 && i + 1 < n && RE_TABLE_SEP.test(lines[i + 1]) &&
          RE_TABLE_HEAD.test(line)) {
        const header = splitRow(line);
        const sep = splitRow(lines[i + 1]);
        if (header.length === sep.length && sep.length > 0 && sep.every((c) => /^:?-+:?$/.test(c))) {
          const align = sep.map((c) =>
            c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : ""
          );
          const cell = (tag, text, idx) =>
            "<" + tag + (align[idx] ? ' class="ta-' + align[idx] + '"' : "") + ">" +
            renderInline(text, refs) + "</" + tag + ">";
          const blankHeader = header.every((c) => String(c).trim() === "");
          let html = '<div class="tablewrap"><table>';
          if (!blankHeader) {
            html += "<thead><tr>";
            for (let c = 0; c < header.length; c++) html += cell("th", header[c], c);
            html += "</tr></thead>";
          }
          html += "<tbody>";
          i += 2;
          while (i < n && !isBlank(lines[i]) && lines[i].indexOf("|") >= 0) {
            const row = splitRow(lines[i]);
            html += "<tr>";
            for (let c = 0; c < header.length; c++) html += cell("td", row[c] === undefined ? "" : row[c], c);
            html += "</tr>";
            i++;
          }
          out += html + "</tbody></table></div>\n";
          continue;
        }
      }

      /* indented code */
      if (RE_INDENTED.test(line)) {
        const buf = [];
        while (i < n && (isBlank(lines[i]) || RE_INDENTED.test(lines[i]))) {
          buf.push(stripIndent(lines[i], 4));
          i++;
        }
        while (buf.length && isBlank(buf[buf.length - 1])) buf.pop();
        out += '<pre class="fence"><code>' + escapeHtml(buf.join("\n")) +
          (buf.length ? "\n" : "") + "</code></pre>\n";
        continue;
      }

      /* HTML block (containers only) */
      const hb = /^ {0,3}<(\/?)([a-zA-Z][a-zA-Z0-9-]*)|^ {0,3}<!--/.exec(line);
      if (hb) {
        const tag = (hb[2] || "").toLowerCase();
        const isComment = !hb[2];
        if (isComment || HTML_BLOCK_TAGS.has(tag)) {
          const buf = [];
          while (i < n && !isBlank(lines[i])) {
            buf.push(lines[i]);
            i++;
            if (isComment && buf[buf.length - 1].indexOf("-->") >= 0) break;
          }
          out += sanitizeFragment(buf.join("\n")) + "\n";
          continue;
        }
      }

      /* paragraph (may become a setext heading) */
      const para = [];
      let setext = 0;
      while (i < n) {
        const L = lines[i];
        if (isBlank(L)) break;
        if (para.length) {
          if (RE_SETEXT.test(L)) { setext = L.trim()[0] === "=" ? 1 : 2; i++; break; }
          if (isBlockStart(L, true, lines[i + 1])) break;
        }
        para.push(L.replace(/^ */, ""));
        i++;
      }
      const content = renderInline(para.join("\n"), refs);
      if (setext) out += heading(setext, content) + "\n";
      else out += (tight ? content : "<p>" + content + "</p>") + "\n";
    }
    return out;
  }

  /* -------------------------------------------------------- lists: parser -- */

  function renderList(lines, start, refs) {
    const head = markerOf(lines[start]);
    const n = lines.length;
    const items = [];
    let i = start;

    // Items of one list may sit at different indents (as long as each marker is
    // within 3 columns); changing the marker character/type starts a new list.
    // A thematic break outranks an item marker ("* * *").
    while (i < n) {
      const m = RE_HR.test(lines[i]) ? null : markerOf(lines[i]);
      if (!m || m.ordered !== head.ordered || m.delim !== head.delim) break;
      // Content column: padding of 1-4 spaces sets it, 5+ means "one space,
      // rest is content", and an empty first line always sits at marker + 1.
      const empty = isBlank(m.rest);
      const contentIndent = contentColumn(m);
      const body = [empty || m.padLen <= 4 ? m.rest : " ".repeat(m.padLen - 1) + m.rest];
      let gapAfter = false;
      i++;
      if (empty) {
        // An empty item only continues on a directly following indented line.
        const nx = lines[i];
        if (nx === undefined || isBlank(nx) || indentOf(nx) < contentIndent) {
          let j = i;
          while (j < n && isBlank(lines[j])) j++;
          const nm2 = j < n && j > i ? markerOf(lines[j]) : null;
          if (nm2 && nm2.ordered === head.ordered && nm2.delim === head.delim) {
            items.push({ body, gapAfter: true });
            i = j;
            continue;
          }
          items.push({ body, gapAfter: false });
          continue;
        }
      }
      while (i < n) {
        const L = lines[i];
        if (isBlank(L)) {
          let j = i;
          while (j < n && isBlank(lines[j])) j++;
          if (j >= n) { i = j; break; }
          if (indentOf(lines[j]) >= contentIndent) {
            for (let k = i; k < j; k++) body.push("");
            i = j;
            continue;
          }
          const nm = markerOf(lines[j]);
          if (nm && nm.ordered === head.ordered && nm.delim === head.delim) {
            gapAfter = true;
            i = j; // blank line sits between two items of the same list
          }
          break;
        }
        const ind = indentOf(L);
        const nm = markerOf(L);
        if (nm && ind < contentIndent) break;
        if (ind >= contentIndent) { body.push(L.slice(contentIndent)); i++; continue; }
        // only a paragraph continuation can be lazier than the content column
        if (isBlockStart(L, true, lines[i + 1])) break;
        if (body.length && isBlank(body[body.length - 1])) break;
        // Fold the lazy line into the previous one: it is paragraph text, so the
        // recursive parse must not see it as a fresh block (spec example 312).
        if (isPlainTextLine(body[body.length - 1])) body[body.length - 1] += "\n" + L.replace(/^ */, "");
        else body.push(L.replace(/^ */, ""));
        i++;
      }
      items.push({ body, gapAfter });
    }

    const loose = items.some((it) => it.gapAfter || hasInternalBlank(it.body));
    const ul = !head.ordered;
    let html = ul
      ? '<ul class="task-list">'
      : "<ol" + (head.start !== 1 ? ' start="' + head.start + '"' : "") + ">";
    let hasTask = false;
    for (const it of items) {
      const body = it.body.slice();
      let task = null;
      const tm = body.length ? /^\[([ xX])\](?:[ \t]+|$)/.exec(body[0]) : null;
      if (tm) {
        task = tm[1].toLowerCase() === "x";
        body[0] = body[0].slice(tm[0].length);
        hasTask = true;
      }
      const inner = parseBlocks(body, { tight: !loose, refs });
      const classes = [];
      if (task !== null) classes.push("task-list-item");
      html += "<li" + (classes.length ? ' class="' + classes.join(" ") + '"' : "") + ">" +
        (task !== null
          ? '<input type="checkbox" disabled' + (task ? " checked" : "") + "> "
          : "") +
        inner.replace(/^\n+/, "").replace(/\n+$/, "") + "</li>\n";
    }
    html += ul ? "</ul>" : "</ol>";
    if (ul && !hasTask) html = html.replace('<ul class="task-list">', "<ul>");
    return { html, next: i };
  }

  /* ------------------------------------------------------------- headings -- */

  function stripTags(html) {
    return html.replace(/<[^>]*>/g, "");
  }

  function slugify(htmlText) {
    return decodeEntities(stripTags(htmlText))
      .toLowerCase()
      .trim()
      .replace(/[^\w\u00c0-\uffff \-]/g, "")
      .replace(/\s+/g, "-");
  }

  let slugCounts = null;
  function heading(level, content) {
    const id = slugify(content);
    let uniq = id;
    if (slugCounts) {
      if (slugCounts[id] !== undefined) {
        slugCounts[id]++;
        uniq = id + "-" + slugCounts[id];
      } else {
        slugCounts[id] = 0;
      }
    }
    return "<h" + level + (uniq ? ' id="' + escapeHtml(uniq) + '"' : "") + ">" + content + "</h" + level + ">";
  }

  /* ---------------------------------------------------------- frontmatter -- */

  const FM_KEY = /^[A-Za-z0-9_.@-]+:/;

  function frontmatterChips(lines) {
    if (lines[0] !== "---") return null;
    let end = -1;
    for (let i = 1; i < lines.length && i < 80; i++) {
      if (lines[i] === "---" || lines[i] === "...") { end = i; break; }
    }
    if (end < 1) return null;
    const body = lines.slice(1, end).filter((l) => !isBlank(l));
    if (!body.length || !body.every((l) => FM_KEY.test(l) || /^[ \t]/.test(l))) return null;
    const chips = body
      .filter((l) => !/^[ \t]/.test(l))
      .map((l) => {
        const at = l.indexOf(":");
        return "<span><b>" + escapeHtml(l.slice(0, at).trim()) + "</b> " +
          escapeHtml(l.slice(at + 1).trim()) + "</span>";
      })
      .join("");
    return { html: chips ? '<div class="meta">' + chips + "</div>\n" : "", next: end + 1 };
  }

  /* ------------------------------------------------------ reference defs --- */

  const QUOTE_PREFIX = /^( {0,3}> ?)+/;
  const RE_REF_DEF = /^ {0,3}\[((?:[^\[\]\\]|\\.)+)\]:[ \t]*([\s\S]*)$/;

  // Collect [label]: destination "title" definitions and blank them out.
  // Labels and titles may wrap across lines (never across a blank line), and a
  // definition may not interrupt a paragraph.
  function extractReferences(lines) {
    const refs = Object.create(null);
    let fence = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (fence) {
        if (new RegExp("^ {0,3}" + fence.ch + "{" + fence.len + ",}[ \\t]*$").test(line)) fence = null;
        continue;
      }
      const fm = RE_FENCE.exec(line);
      if (fm && !(fm[2][0] === "`" && fm[3].indexOf("`") >= 0)) {
        fence = { ch: fm[2][0], len: fm[2].length };
        continue;
      }
      if (RE_INDENTED.test(line)) continue;
      const prev = i > 0 ? lines[i - 1] : null;
      if (prev !== null && !isBlank(prev) && !isBlockStart(prev, false)) continue;
      let prefix = "";
      let stripped = line;
      if (line.indexOf(">") >= 0) {
        const qm = QUOTE_PREFIX.exec(line);
        if (qm) { prefix = qm[0]; stripped = line.slice(prefix.length); }
      }
      if (stripped.indexOf("[") < 0) continue;
      const cand = [stripped];
      for (let k = 1; k <= 10 && i + k < lines.length; k++) {
        if (isBlank(lines[i + k])) break;
        cand.push(lines[i + k].replace(QUOTE_PREFIX, ""));
      }
      for (let extra = cand.length - 1; extra >= 0; extra--) {
        const m = RE_REF_DEF.exec(cand.slice(0, extra + 1).join("\n"));
        if (!m || trimAscii(m[2]) === "") continue;
        const parsed = parseDestTitle(m[2]);
        if (!parsed) continue;
        const label = normalizeLabel(m[1]);
        if (!label) continue;
        if (!(label in refs)) refs[label] = parsed;
        for (let k = 0; k <= extra; k++) {
          if (k === 0) { lines[i] = prefix; continue; }
          const qm = QUOTE_PREFIX.exec(lines[i + k]);
          lines[i + k] = qm ? qm[0] : "";
        }
        i += extra;
        break;
      }
    }
    return refs;
  }

  /* ------------------------------------------------------------ footnotes -- */

  // GFM footnotes. Definitions are lifted out of the source the way link
  // reference definitions are, references are numbered in the order they are
  // first used, and the notes are appended as a section at the end.
  //
  // A definition's body is a paragraph that continues lazily, the way every other
  // paragraph in markdown does, and additional paragraphs need four spaces (or a
  // blank line and four spaces) — GFM's own rule, so what the author saw when they
  // wrote it is what they get here.
  //
  // A definition nobody references is not rendered at all. That is GFM's rule and
  // it is also what this renderer already does with an unused link reference
  // definition: a note that nothing points at is not a note, and numbering it
  // would put an uncited lump at the end of the page.
  let footnoteDefs = null;   // normalized label -> the definition's lines
  let footnoteOrder = [];    // entries for referenced notes, in citation order
  let footnoteIndex = null;  // normalized label -> entry in footnoteOrder

  const RE_FOOT_DEF = /^ {0,3}\[\^((?:[^\[\]\\]|\\.){1,999})\]:[ \t]*(.*)$/;
  const RE_FOOT_REF = /^\[\^((?:[^\[\]\\]|\\.){1,999})\]/;
  const FOOT_INDENT = 4;

  function footnoteKey(raw) {
    return normalizeLabel(unescapePunct(raw));
  }

  function extractFootnotes(lines) {
    const defs = Object.create(null);
    let fence = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (fence) {
        if (new RegExp("^ {0,3}" + fence.ch + "{" + fence.len + ",}[ \\t]*$").test(line)) fence = null;
        continue;
      }
      const fm = RE_FENCE.exec(line);
      if (fm && !(fm[2][0] === "`" && fm[3].indexOf("`") >= 0)) {
        fence = { ch: fm[2][0], len: fm[2].length };
        continue;
      }
      if (RE_INDENTED.test(line)) continue;
      const prev = i > 0 ? lines[i - 1] : null;
      if (prev !== null && !isBlank(prev) && !isBlockStart(prev, false)) continue;
      let prefix = "";
      let stripped = line;
      if (line.indexOf(">") >= 0) {
        const qm = QUOTE_PREFIX.exec(line);
        if (qm) { prefix = qm[0]; stripped = line.slice(prefix.length); }
      }
      const m = RE_FOOT_DEF.exec(stripped);
      if (!m) continue;
      const key = footnoteKey(m[1]);
      const body = [m[2]];
      lines[i] = prefix;
      let j = i + 1;
      // true while the definition ends in a paragraph, which is what a lazily
      // continued line would be continuing
      let openPara = m[2].trim() !== "";
      while (j < lines.length) {
        const qm = QUOTE_PREFIX.exec(lines[j]);
        const at = qm ? lines[j].slice(qm[0].length) : lines[j];
        if (isBlank(at)) {
          // blank lines belong to the definition only when an indented line
          // follows them; otherwise they separate it from the next block
          let k = j;
          while (k < lines.length && isBlank(lines[k].replace(QUOTE_PREFIX, ""))) k++;
          if (k < lines.length && indentOf(lines[k].replace(QUOTE_PREFIX, "")) >= FOOT_INDENT) {
            for (; j < k; j++) { body.push(""); lines[j] = prefix; }
            openPara = false;
            continue;
          }
          break;
        }
        const indented = indentOf(at) >= FOOT_INDENT;
        // A line that opens another definition ends this one. Definitions are
        // written one after another with no blank line between them, so without
        // this the note above would swallow every note below it as a lazy
        // paragraph continuation.
        if (!indented && RE_FOOT_DEF.test(at)) break;
        // not indented: this line is either a lazy continuation or the document
        // carrying on, and `isBlockStart(line, true)` is the paragraph-interrupt
        // rule that tells the two apart
        if (!indented && (!openPara || isBlockStart(at, true))) break;
        body.push(indented ? stripIndent(at, FOOT_INDENT) : at);
        lines[j] = prefix;
        openPara = true;
        j++;
      }
      if (key && !(key in defs)) defs[key] = body;
      i = j - 1;
    }
    return defs;
  }

  // The n-th note is the n-th label first cited, not the n-th definition: a note
  // is numbered by where the reader meets it.
  function citeFootnote(raw) {
    const key = footnoteKey(raw);
    if (!key || !footnoteDefs || !(key in footnoteDefs)) return null;
    let entry = footnoteIndex[key];
    if (!entry) {
      entry = { n: footnoteOrder.length + 1, label: key, refs: 0 };
      footnoteIndex[key] = entry;
      footnoteOrder.push(entry);
    }
    entry.refs++;
    return entry;
  }

  function tryFootnoteRef(text, at) {
    if (!footnoteDefs) return null;
    const m = RE_FOOT_REF.exec(text.slice(at));
    const entry = m && citeFootnote(m[1]);
    if (!entry) return null;
    return { node: { k: "fnref", n: entry.n, count: entry.refs }, end: at + m[0].length };
  }

  // One anchor per citation, so a note cited twice can send the reader back to
  // either one; the second and later carry the count they are returning to.
  function backrefs(entry) {
    let out = "";
    for (let k = 1; k <= entry.refs; k++) {
      out += (k > 1 ? " " : "") + '<a class="fnback" href="#' +
        (k === 1 ? "fnref-" + entry.n : "fnref-" + entry.n + "-" + k) + '" aria-label="' +
        (k === 1 ? "Back to the reference" : "Back to reference " + k) + '">↩' +
        (k > 1 ? "<sup>" + k + "</sup>" : "") + "</a>";
    }
    return out;
  }

  function footnoteSection(refs) {
    if (!footnoteOrder.length) return "";
    let html = '<section class="notes" role="doc-endnotes">\n' + heading(2, "Footnotes") + "\n<ol>\n";
    for (const entry of footnoteOrder) {
      const body = parseBlocks(footnoteDefs[entry.label], { refs: refs });
      const back = backrefs(entry);
      // GFM puts the backrefs at the end of the note's first paragraph, and at
      // the end of the note when that paragraph is not the first thing in it.
      const close = body.startsWith("<p>") ? body.indexOf("</p>") : -1;
      const withBack = close < 0
        ? body + back + "\n"
        : body.slice(0, close) + " " + back + body.slice(close);
      html += '<li id="fn-' + entry.n + '">' + withBack + "</li>\n";
    }
    return html + "</ol>\n</section>\n";
  }

  /* ------------------------------------------------------------- pipeline -- */

  function renderMarkdown(text) {
    const raw = String(text == null ? "" : text).replace(/\r\n?/g, "\n");
    let lines = raw.split("\n").map(expandLeadingTabs);
    // the newline that ends the file terminates the last line, it does not
    // start a fresh empty one (matters for unclosed fences)
    if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
    let prefix = "";
    const chips = frontmatterChips(lines);
    if (chips) {
      prefix = chips.html;
      lines = lines.slice(chips.next);
    }
    // Footnotes first: a footnote definition and a link reference definition look
    // alike, and `[^1]: /url` is a note that happens to hold a URL, not a link
    // target — so the note syntax claims the line before the link syntax can.
    footnoteDefs = extractFootnotes(lines);
    const refs = extractReferences(lines);
    footnoteOrder = [];
    footnoteIndex = Object.create(null);
    slugCounts = Object.create(null);
    try {
      // left to right on purpose: the body is parsed (and its citations
      // numbered) before the notes, which are numbered by first citation
      return prefix + parseBlocks(lines, { refs }) + footnoteSection(refs);
    } finally {
      footnoteDefs = null;
      footnoteOrder = [];
      footnoteIndex = null;
    }
  }

  /* -------------------------------------------------------------- mount ---- */

  /* ----------------------------------------------------------------- math -- */

  // Math is written \( ... \) inline and \[ ... \] (or $$ ... $$) as a display. A markdown
  // parser reads `\(` as an escaped bracket and drops the backslash, so the formulas are
  // lifted out before it runs, as a word it cannot touch, and put back after it. The
  // renderer itself is not changed: `renderMarkdown()` still emits what the spec suite scores.
  function inlineMath(line, parts) {
    // code spans are left alone: `\(` in code is code
    const pieces = line.split(/(`+[^`]*`+)/);
    return pieces.map((piece, k) => {
      if (k % 2 === 1) return piece;
      // only \( ... \) inside a line: `\[` there is an escaped bracket, as in `manage-bde \[-status\]`
      return piece.replace(/\\\((.+?)\\\)/g, (m, tex) => "MDVIEWMATHI" + (parts.push({ tex: tex.trim() }) - 1) + "X");
    }).join("");
  }

  function extractMath(src, parts) {
    const lines = src.split("\n");
    const out = [];
    let fence = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (fence) {
        out.push(line);
        if (f && f[1][0] === fence[0] && f[1].length >= fence.length && /^\s*$/.test(line.slice(f[0].length))) fence = null;
        continue;
      }
      if (f) { fence = f[1]; out.push(line); continue; }
      const open = /^\s*(\\\[|\$\$)(.*)$/.exec(line);
      if (open) {
        const closer = open[1] === "\\[" ? "\\]" : "$$";
        const chunks = [];
        let rest = open[2];
        let end = rest.indexOf(closer);
        let j = i;
        let trailing = "";
        if (end >= 0) {
          chunks.push(rest.slice(0, end));
          trailing = rest.slice(end + closer.length);
          // `\[note\] and more` is text with escaped brackets; a one-line formula is the whole line
          if (trailing.trim()) end = -1;
        } else {
          chunks.push(rest);
          // a display formula is a few lines; a bracket that never closes nearby is not one
          for (j = i + 1; j < lines.length && j <= i + 40; j++) {
            end = lines[j].indexOf(closer);
            if (end >= 0) {
              chunks.push(lines[j].slice(0, end));
              trailing = lines[j].slice(end + closer.length);
              break;
            }
            chunks.push(lines[j]);
          }
        }
        if (end >= 0) {
          out.push("", "MDVIEWMATHD" + (parts.push({ tex: chunks.join("\n").trim() }) - 1) + "X", "");
          if (trailing.trim()) out.push(inlineMath(trailing, parts));
          i = j;
          continue;
        }
        // never closed: it was not math, so the line stays as it was
      }
      out.push(inlineMath(line, parts));
    }
    return out.join("\n");
  }

  function restoreMath(html, parts) {
    if (!parts.length) return html;
    const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return html
      .replace(/<p>\s*MDVIEWMATHD(\d+)X\s*<\/p>/g, (m, k) => `<div class="math display">${esc(parts[k].tex)}</div>`)
      .replace(/MDVIEWMATH([ID])(\d+)X/g, (m, kind, k) =>
        `<span class="math ${kind === "D" ? "display" : "inline"}">${esc(parts[k].tex)}</span>`);
  }

  // Like the diagram script, the formula engine comes only when a file has a formula. Until it
  // arrives, or if it never does, the formula shows as its own text.
  let katexLoading = null;
  function loadKatex() {
    if (typeof katex !== "undefined") return Promise.resolve();
    if (!katexLoading) {
      katexLoading = new Promise((resolve, reject) => {
        const css = document.createElement("link");
        css.rel = "stylesheet";
        css.href = "/static/katex/katex.min.css";
        document.head.appendChild(css);
        const s = document.createElement("script");
        s.src = "/static/katex/katex.min.js";
        s.onload = () => resolve();
        s.onerror = () => reject(new Error("katex.min.js did not load"));
        document.head.appendChild(s);
      });
    }
    return katexLoading;
  }

  function renderMath(root) {
    const els = Array.from(root.querySelectorAll(".math"));
    if (!els.length) return;
    loadKatex()
      .then(() => {
        for (const el of els) {
          const tex = el.textContent;
          try {
            katex.render(tex, el, { displayMode: el.classList.contains("display"), throwOnError: false, strict: "ignore" });
            el.dataset.tex = tex;
          } catch (e) {
            el.classList.add("math-error");
          }
        }
      })
      .catch((e) => console.warn(`[mdview] formulas stay as text`, e));
  }

  // The diagram script is too big to send with every file, so it comes only when a file
  // has a diagram. The Chrome build already loads it with the page, and then this does
  // nothing.
  let mermaidLoading = null;
  function loadMermaid() {
    if (typeof mermaid !== "undefined") return Promise.resolve();
    if (!mermaidLoading) {
      mermaidLoading = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "/static/mermaid.min.js";
        s.onload = () => resolve();
        s.onerror = () => reject(new Error("mermaid.min.js did not load"));
        document.head.appendChild(s);
      });
    }
    return mermaidLoading;
  }

  // A diagram is drawn once, in the palette the page had at that moment. When the reader
  // changes theme, the source goes back into the block and the diagram is drawn again.
  function rerunDiagrams() {
    const pres = Array.from(document.querySelectorAll('pre.mermaid[data-processed="true"]'));
    if (!pres.length) return;
    for (const pre of pres) {
      pre.removeAttribute("data-processed");
      pre.textContent = pre.dataset.source;
    }
    loadMermaid()
      .then(() => {
        mermaid.initialize(mermaidTheme());
        return mermaid.run({ nodes: pres });
      })
      .catch((e) => console.warn(`[mdview ${VERSION}] a diagram failed to render`, e));
  }

  /* mermaid's built-in themes are their own palettes and mostly keep light
     node fills, which leaves a bright diagram sitting on a dark page. Render
     with `base` and hand it the same colours the stylesheet uses instead, so
     diagrams follow the document in both schemes. */
  function mermaidTheme() {
    // the reader's own theme decides, not the OS: a dark reader on a light system still gets
    // a dark diagram, and warm (light underneath) gets its own cream palette below
    const forced = document.documentElement.getAttribute("data-mdview-theme");
    const osDark = !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    const dark = forced === "dark" || (!forced && osDark);
    const font = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Inter, sans-serif';
    const config = {
      startOnLoad: false,
      theme: "base",
      themeVariables: dark
        ? {
            darkMode: true,
            fontFamily: font,
            background: "#0f1216",
            primaryColor: "#1b2430",
            primaryTextColor: "#e4e8ee",
            primaryBorderColor: "#3a434f",
            secondaryColor: "#212831",
            secondaryTextColor: "#e4e8ee",
            secondaryBorderColor: "#3a434f",
            tertiaryColor: "#171c23",
            tertiaryTextColor: "#e4e8ee",
            tertiaryBorderColor: "#3a434f",
            textColor: "#e4e8ee",
            lineColor: "#9aa5b4",
            mainBkg: "#1b2430",
            nodeBorder: "#3a434f",
            nodeTextColor: "#e4e8ee",
            clusterBkg: "#151a20",
            clusterBorder: "#2a323d",
            edgeLabelBackground: "#0f1216",
            titleColor: "#e4e8ee",
            pie1: "#4a90b8",
            pie2: "#7f8fa0",
            pie3: "#3f6d88",
            pie4: "#5c6b7a",
          }
        : {
            darkMode: false,
            fontFamily: font,
            background: "#f7f8fa",
            primaryColor: "#eef4f9",
            primaryTextColor: "#1b2027",
            primaryBorderColor: "#a9c4d6",
            secondaryColor: "#e9eff4",
            secondaryTextColor: "#1b2027",
            secondaryBorderColor: "#b9cddb",
            tertiaryColor: "#f2f5f8",
            tertiaryTextColor: "#1b2027",
            tertiaryBorderColor: "#ccd2da",
            textColor: "#1b2027",
            lineColor: "#5a6472",
            mainBkg: "#eef4f9",
            nodeBorder: "#a9c4d6",
            nodeTextColor: "#1b2027",
            clusterBkg: "#f1f4f7",
            clusterBorder: "#ccd2da",
            edgeLabelBackground: "#f7f8fa",
            titleColor: "#1b2027",
          },
    };
    if (forced === "warm") {
      Object.assign(config.themeVariables, {
        background: "#f1e9db",
        primaryColor: "#f4ecd9",
        primaryBorderColor: "#c9b48a",
        secondaryColor: "#efe6d2",
        secondaryBorderColor: "#d2bf97",
        tertiaryColor: "#f8f1e3",
        tertiaryBorderColor: "#d9cba9",
        mainBkg: "#f4ecd9",
        nodeBorder: "#c9b48a",
        clusterBkg: "#f5eedf",
        clusterBorder: "#d9cba9",
        edgeLabelBackground: "#f1e9db",
        lineColor: "#6b6151",
      });
    }
    return config;
  }

  /* ------------------------------------------------------ reading memory -- */

  // Everything above this line describes the document. This describes the reader,
  // which is the part that decides whether a long file gets finished or gets
  // opened and abandoned. What holds a reader in a file they did not want to read
  // is an unfinished thing they can see: how far in they are, which parts are
  // already behind them, and a way back that costs one click instead of a search.
  //
  // None of it is a fact about the markdown, so none of it is in the renderer, and
  // none of it is in the document: `renderMarkdown()` still emits exactly what the
  // spec suite scores. It is kept per URL, in the extension's own storage when
  // there is one — a content script sees `browser.storage` on a `file://` page,
  // where `localStorage` can be an opaque origin that remembers nothing — and in
  // `localStorage` otherwise, which is what the preview harness has, so the whole
  // loop is exercisable without the add-on installed.
  const READ_PREFIX = "mdview:read:";

  function prefersCalm() {
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) {
      return false;
    }
  }

  /* ------------------------------------------------------------ landed here -- */

  // Which element the reader has just arrived at. `:target` cannot answer this on
  // a page the script builds — the browser resolves the fragment while the
  // document loads, before the headings exist, so Chromium matches nothing and
  // Firefox can end up pointing at a section the reader has already left — so
  // the mark is put on by hand, and taken off by the same clock that ends the
  // fade in `mdview-land`. A mark that outlives the moment it announces stops
  // meaning "you are here" and starts meaning "something is selected".
  const LAND_MS = 2600;
  let landTimer = 0;
  function land(fragment) {
    if (!fragment) return null;
    let el = null;
    try {
      el = document.getElementById(decodeURIComponent(fragment));
    } catch (e) {
      return null; // malformed % in the fragment
    }
    if (!el) return null;
    for (const old of document.querySelectorAll(".is-landed")) old.classList.remove("is-landed");
    el.classList.add("is-landed");
    clearTimeout(landTimer);
    landTimer = setTimeout(() => el.classList.remove("is-landed"), LAND_MS);
    return el;
  }

  function extStorage() {
    try {
      const api =
        typeof browser !== "undefined" ? browser
        : typeof chrome !== "undefined" ? chrome
        : null;
      if (api && api.storage && api.storage.local) return api.storage.local;
    } catch (e) { /* no extension storage on this page */ }
    return null;
  }

  // One shape for both halves of the API: Chrome uses the callback when it is
  // given one, Firefox ignores it and returns a promise.
  function storeGet(key) {
    const store = extStorage();
    if (store) {
      return new Promise((resolve) => {
        let settled = false;
        const done = (v) => {
          if (settled) return;
          settled = true;
          resolve(v == null ? null : v);
        };
        try {
          const p = store.get(key, (res) => done(res && key in res ? res[key] : null));
          if (p && typeof p.then === "function") {
            p.then((res) => done(res && key in res ? res[key] : null), () => done(null));
          }
        } catch (e) {
          done(null);
        }
      });
    }
    try {
      const raw = localStorage.getItem(key);
      return Promise.resolve(raw == null ? null : JSON.parse(raw));
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  function storeSet(key, value) {
    const store = extStorage();
    if (store) {
      return new Promise((resolve) => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        try {
          const p = store.set({ [key]: value }, done);
          if (p && typeof p.then === "function") p.then(done, done);
        } catch (e) {
          done();
        }
      });
    }
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* not persisted, not a problem */ }
    return Promise.resolve();
  }

  function countWords(text) {
    return ((text || "").match(/[\p{L}\p{N}'’-]+/gu) || []).length;
  }

  let READ = null;         // this document's record, or null until it loads
  let READ_MINUTES = 0;    // how long the whole document is, for "N min left"
  let READ_HEADS = [];     // the h2/h3 that divide it, with their own length
  const READ_SUBS = [];    // repaint on a change worth showing
  const READ_TICKS = [];   // notice every new position
  let readSave = 0;

  // The hash is dropped: a link to a section is still the same document.
  // The address a note's records are kept under: the page without its #section and without the
  // reader's own `v` number, which changes whenever the file does and would start every record
  // (where the reader was, what they folded, their checkpoint) over each time it is rewritten.
  function docKey() {
    try {
      const u = new URL(location.href);
      u.searchParams.delete("v");
      // built by hand: a URL whose last parameter was deleted still prints a bare "?"
      const rest = u.searchParams.toString();
      return u.origin + u.pathname + (rest ? "?" + rest : "");
    } catch (e) {
      return location.href.split("#")[0];
    }
  }

  function readKey() { return READ_PREFIX + docKey(); }

  function freshRead() { return { pct: 0, y: 0, done: false, a: null }; }

  function onRead(fn) {
    READ_SUBS.push(fn);
    // if the record is already here, the new subscriber should not have to wait
    if (READ) {
      try { fn(READ); } catch (e) { /* a frill */ }
    }
  }

  function onReadTick(fn) { READ_TICKS.push(fn); }

  // For anything that shows where the reader is, not only what the record holds: it is
  // asked again on every move of the window, and once when the record changes.
  function onPosition(fn) {
    onRead(fn);
    onReadTick(() => fn(READ));
  }

  function paintRead() {
    for (const fn of READ_SUBS) {
      try { fn(READ); } catch (e) { /* a frill failing is not the document failing */ }
    }
  }

  function saveRead() {
    clearTimeout(readSave);
    readSave = setTimeout(() => {
      if (READ) storeSet(readKey(), READ);
    }, 700);
  }

  // A tab that is closed mid-read should still remember where it was.
  function flushRead() {
    clearTimeout(readSave);
    if (READ) storeSet(readKey(), READ);
  }

  function loadRead() {
    // The browser's own scroll restoration is turned off for the reader's pages: it scrolls to
    // the old pixel offset the moment the page is tall enough, and while the page is still being
    // built that is the bottom of a short page. That scroll was then taken for the reader's, and
    // wrote "finished, at the very top" over the record.
    try { history.scrollRestoration = "manual"; } catch (e) { /* the page is left to the browser */ }
    let loaded;
    try {
      loaded = storeGet(readKey());
    } catch (e) {
      loaded = Promise.resolve(null);
    }
    window.addEventListener("pagehide", flushRead);
    return loaded.then(
      (v) => {
        READ = v && typeof v === "object"
          ? {
              pct: Math.max(0, Math.min(100, +v.pct || 0)),
              y: Math.max(0, +v.y || 0),
              done: !!v.done,
              // the place in the text where the reader stopped, if the record has one
              a: v.a && typeof v.a.i === "number" && typeof v.a.t === "string"
                ? { i: v.a.i, t: v.a.t, f: Math.max(0, Math.min(1, +v.a.f || 0)) }
                : null,
            }
          : freshRead();
        // "finished, at the masthead" is what a page that was not yet built once wrote over the
        // record; it is not a reader who has read the note, so it is not believed
        if (READ.done && READ.a && READ.a.i === 0) READ = freshRead();
        paintRead();
        markSections();
        resumeFromAnchor();
      },
      () => {
        READ = freshRead();
        paintRead();
      }
    );
  }

  // What the record keeps is one fact: that the reader got to the end. Which sections
  // are behind the reader is not kept anywhere; it is asked of the window (passedHeads),
  // so a re-read follows where the reader is now rather than what they have scrolled past.
  function markSections() {
    if (!READ || !READ_HEADS.length) return;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (max > 0 && window.scrollY >= max - 48 && !READ.done) {
      READ.done = true;
      saveRead();
      paintRead();
    }
  }

  // The sections the window is past right now: a heading counts once it has left the top
  // of the window. At the end of the file every section does, because the last ones may
  // never get that high.
  function passedHeads() {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    // the end counts once the end of the file is on screen: the plate is in view, or the
    // window is at the bottom. A document that fits the window shows its plate at once.
    const plate = document.querySelector(".endplate");
    const atEnd = (!!plate && plate.getBoundingClientRect().top < window.innerHeight) || (max > 0 && window.scrollY >= max - 48);
    return READ_HEADS.filter((h) => atEnd || h.el.getBoundingClientRect().bottom <= 0).map((h) => h.id);
  }

  function readCount() { return passedHeads().length; }

  // The words between a heading and the next one of any level, so the outline can
  // say how long each hop is. An estimate at the same 220wpm the header uses.
  function sectionWords(head) {
    let words = 0;
    let el = head.nextElementSibling;
    while (el && !/^H[1-6]$/.test(el.tagName)) {
      words += countWords(el.textContent);
      el = el.nextElementSibling;
    }
    return words;
  }

  function sectionMin(id) {
    for (const h of READ_HEADS) if (h.id === id) return h.min;
    return 0;
  }

  // A heading that repeats the title above it ("Operating Systems", then an h3 that says
  // "OPERATING SYSTEMS") says the same thing twice. It stays in the document for the
  // outline and for screen readers; only the sight of it is taken away.
  function markEchoHeading(doc) {
    const heads = Array.from(doc.querySelectorAll("h1, h2, h3, h4, h5, h6"));
    const title = heads[0];
    const next = heads[1];
    if (!title || title.tagName !== "H1" || !next) return;
    const words = (el) => (el.textContent || "").replace(/[#▾]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
    if (words(next) && words(next) === words(title)) next.classList.add("is-echo");
  }

  // A bare web address in the text (the link is the address itself) is kept on one line
  // and cut short with an ellipsis, rather than breaking at the hyphens inside it. The link
  // is still the whole address, and the title shows it on hover.
  function markBareUrls(doc) {
    for (const a of doc.querySelectorAll("a[href]")) {
      if (!/^https?:\/\//i.test((a.textContent || "").trim())) continue;
      a.classList.add("bare-url");
      if (!a.title) a.title = a.getAttribute("href");
    }
  }

  // A reading the author marked as a machine's (an OCR transcript, say: its note opens with
  // "Machine-read") is set apart. Its columns and line breaks are the picture's, not prose,
  // so it sits in a quieter block with a rule, up to the next heading.
  function markTranscripts(doc) {
    for (const note of Array.from(doc.querySelectorAll("p"))) {
      if (!/^\s*machine-read\b/i.test(note.textContent || "")) continue;
      const box = document.createElement("div");
      box.className = "transcript";
      note.before(box);
      let el = note;
      while (el && !/^H[1-6]$/.test(el.tagName)) {
        const next = el.nextElementSibling;
        box.appendChild(el);
        el = next;
      }
    }
  }

  // Lightweight, dependency-free highlighting for the fenced blocks the reader
  // already knows how to render. It only touches bash/shell, so a block in
  // another language is left exactly as the author wrote it.
  function highlightJson(src) {
    let s = escapeHtml(src);
    // keys: "..." followed by :
    s = s.replace(/"([^"\\]+)"(\s*:)/g, '<span class="tok-key">"$1"</span>$2');
    // remaining strings
    s = s.replace(/"(?:[^"\\]|\\.)*"/g, (m) => m.indexOf("tok-") >= 0 ? m : '<span class="tok-str">' + m + "</span>");
    s = s.replace(/\b(true|false|null)\b/g, '<span class="tok-kw">$1</span>');
    s = s.replace(/-?\b\d+\.?\d*\b/g, '<span class="tok-num">$&</span>');
    s = s.replace(/[{}\[\],:]/g, '<span class="tok-op">$&</span>');
    return s;
  }

  function highlightGeneric(src) {
    let s = escapeHtml(src);
    s = s.replace(/#.*|\/\/[^\n]*/g, (m) => '<span class="tok-cmt">' + m + "</span>");
    s = s.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, (m) => '<span class="tok-str">' + m + "</span>");
    s = s.replace(/\b\d+\.?\d*\b/g, (m) => '<span class="tok-num">' + m + "</span>");
    return s;
  }

  const KW = {
    c: new Set(["auto","break","case","char","const","continue","default","do","double","else","enum","extern","float","for","goto","if","inline","int","long","register","restrict","return","short","signed","sizeof","static","struct","switch","typedef","union","unsigned","void","volatile","while"]),
    cpp: new Set(["alignas","alignof","and","and_eq","asm","auto","bitand","bitor","bool","break","case","catch","char","char8_t","char16_t","char32_t","class","compl","concept","const","consteval","constexpr","constinit","const_cast","continue","co_await","co_return","co_yield","decltype","default","delete","do","double","dynamic_cast","else","enum","explicit","export","extern","false","float","for","friend","goto","if","inline","int","long","mutable","namespace","new","noexcept","not","not_eq","nullptr","operator","or","or_eq","private","protected","public","register","reinterpret_cast","requires","return","short","signed","sizeof","static","static_assert","static_cast","struct","switch","template","this","thread_local","throw","true","try","typedef","typeid","typename","union","unsigned","using","virtual","void","volatile","wchar_t","while","xor","xor_eq"]),
    java: new Set(["abstract","assert","boolean","break","byte","case","catch","char","class","const","continue","default","do","double","else","enum","extends","final","finally","float","for","goto","if","implements","import","instanceof","int","interface","long","native","new","package","private","protected","public","return","short","static","strictfp","super","switch","synchronized","this","throw","throws","transient","try","void","volatile","while","true","false","null"]),
    js: new Set(["const","let","var","function","return","if","else","for","while","do","switch","case","break","continue","new","class","extends","import","export","default","try","catch","finally","throw","async","await","true","false","null","undefined","this","super","typeof","instanceof","in","of","yield","delete","void"]),
    ts: new Set(["const","let","var","function","return","if","else","for","while","do","switch","case","break","continue","new","class","extends","import","export","default","try","catch","finally","throw","async","await","true","false","null","undefined","this","super","typeof","instanceof","in","of","yield","delete","void","interface","type","enum","implements","public","private","protected","readonly","namespace","abstract","as","is","keyof","infer","never","unknown","any","boolean","number","string","symbol","bigint","object"]),
    go: new Set(["break","case","chan","const","continue","default","defer","else","fallthrough","for","func","go","goto","if","import","interface","map","package","range","return","select","struct","switch","type","var","true","false","iota","nil"]),
    rust: new Set(["as","async","await","break","const","continue","crate","dyn","else","enum","extern","false","fn","for","if","impl","in","let","loop","match","mod","move","mut","pub","ref","return","self","Self","static","struct","super","trait","true","type","unsafe","use","where","while"]),
    php: new Set(["abstract","and","array","as","break","callable","case","catch","class","clone","const","continue","declare","default","die","do","echo","else","elseif","empty","enddeclare","endfor","endforeach","endif","endswitch","endwhile","eval","exit","extends","final","finally","fn","for","foreach","function","global","goto","if","implements","include","include_once","instanceof","insteadof","interface","isset","list","match","namespace","new","or","print","private","protected","public","readonly","require","require_once","return","static","switch","throw","trait","try","unset","use","var","while","xor","yield","true","false","null"]),
    ruby: new Set(["alias","and","begin","break","case","class","def","defined?","do","else","elsif","end","ensure","false","for","if","in","module","next","nil","not","or","redo","rescue","retry","return","self","super","then","true","undef","unless","until","when","while","yield"]),
    python: new Set(["and","as","assert","async","await","break","class","continue","def","del","elif","else","except","False","finally","for","from","global","if","import","in","is","lambda","None","nonlocal","not","or","pass","raise","return","True","try","while","with","yield","print","input","len","range","str","int","float","list","dict","set","tuple","bool","open","file","map","filter","zip","sorted","reversed","any","all","sum","min","max","abs","round","pow","bin","hex","oct","chr","ord","isinstance","hasattr","getattr","setattr","delattr","property","staticmethod","classmethod","super","object","type","dict","list","tuple","set","frozenset","bytes","bytearray","memoryview","slice","enumerate","id","hash","dir","vars","locals","globals","exec","eval","compile","breakpoint","help","copyright","credits","license"]),
    sql: new Set(["select","from","where","and","or","not","insert","into","values","update","set","delete","create","table","drop","alter","add","column","primary","key","foreign","references","join","inner","left","right","full","outer","on","group","by","order","having","limit","offset","as","distinct","count","sum","avg","min","max","union","all","null","true","false","case","when","then","else","end","begin","commit","rollback","transaction","index","view","trigger","procedure","function","database","schema"]),
    sh: new Set(["if","then","else","elif","fi","for","while","do","done","case","esac","in","function","return","export","local","readonly","unset","shift","exit","break","continue","trap","source","alias","unalias","echo","cd","pwd","ls","cat","grep","sed","awk","find","xargs","test"]),
  };

  function escHtml2(x) { return String(x).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

  function highlightCStyle(src, kwSet) {
    const escaped = escHtml2(src);
    const re = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d+\.?\d*\b|[A-Za-z_$][\w$]*\b|[+\-*/%=&|<>!?:;,\.\[\]{}()]+/g;
    return escaped.replace(re, (m, offset) => {
      if (m.startsWith("//") || m.startsWith("/*")) return '<span class="tok-cmt">' + m + "</span>";
      if (m.startsWith('"') || m.startsWith("'") || m.startsWith("`")) return '<span class="tok-str">' + m + "</span>";
      if (/^\d/.test(m)) return '<span class="tok-num">' + m + "</span>";
      if (kwSet && kwSet.has(m)) return '<span class="tok-kw">' + m + "</span>";
      if (/^[+\-*/%=&|<>!?:;,\.\[\]{}()]+$/.test(m)) return '<span class="tok-op">' + m + "</span>";
      const rest = escaped.slice(offset + m.length);
      if (/^\s*\(/.test(rest)) return '<span class="tok-fn">' + m + "</span>";
      if (/^[A-Z][A-Z0-9_]{2,}$/.test(m)) return '<span class="tok-const">' + m + "</span>";
      if (/^[A-Z]/.test(m)) return '<span class="tok-type">' + m + "</span>";
      return m;
    });
  }

  function highlightHash(src, kwSet) {
    const re = /#.*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b\d+\.?\d*\b|[A-Za-z_][\w]*\b|[+\-*/%=&|<>!?:;,\.\[\]{}()]+/g;
    return escHtml2(src).replace(re, (m) => {
      if (m.startsWith("#")) return '<span class="tok-cmt">' + m + "</span>";
      if (m.startsWith('"') || m.startsWith("'")) return '<span class="tok-str">' + m + "</span>";
      if (/^\d/.test(m)) return '<span class="tok-num">' + m + "</span>";
      if (kwSet && kwSet.has(m)) return '<span class="tok-kw">' + m + "</span>";
      if (/^[+\-*/%=&|<>!?:;,\.\[\]{}()]+$/.test(m)) return '<span class="tok-op">' + m + "</span>";
      return m;
    });
  }

  function highlightSql(src) {
    const re = /--[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^'\\]|\\.)*'|\b\d+\.?\d*\b|[A-Za-z_][\w]*\b/g;
    return escHtml2(src).replace(re, (m) => {
      if (m.startsWith("--") || m.startsWith("/*")) return '<span class="tok-cmt">' + m + "</span>";
      if (m.startsWith("'")) return '<span class="tok-str">' + m + "</span>";
      if (/^\d/.test(m)) return '<span class="tok-num">' + m + "</span>";
      if (KW.sql.has(m.toLowerCase())) return '<span class="tok-kw">' + m + "</span>";
      return m;
    });
  }

  function highlightJson(src) {
    let s = escHtml2(src);
    s = s.replace(/"([^"\\]+)"(\s*:)/g, '<span class="tok-key">"$1"</span>$2');
    s = s.replace(/"(?:[^"\\]|\\.)*"/g, (m) => m.indexOf("tok-") >= 0 ? m : '<span class="tok-str">' + m + "</span>");
    s = s.replace(/\b(true|false|null)\b/g, '<span class="tok-kw">$1</span>');
    s = s.replace(/-?\b\d+\.?\d*\b/g, '<span class="tok-num">$&</span>');
    s = s.replace(/[{}\[\],:]/g, '<span class="tok-op">$&</span>');
    return s;
  }

  function highlightHtml(src) {
    const re = /<!--[\s\S]*?-->|<\/?[A-Za-z][\w-]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g;
    return escHtml2(src).replace(re, (m) => {
      if (m.startsWith("<!--")) return '<span class="tok-cmt">' + m + "</span>";
      if (m.startsWith('"') || m.startsWith("'")) return '<span class="tok-str">' + m + "</span>";
      if (m.startsWith("<")) return m.replace(/[A-Za-z][\w-]*/, (t) => '<span class="tok-kw">' + t + "</span>");
      return m;
    });
  }

  function highlightCss(src) {
    const re = /\/\*[\s\S]*?\*\/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|#[0-9a-fA-F]{3,8}\b|\b\d+\.?\d*(px|em|rem|%|vh|vw)?\b|[A-Za-z-]+\s*:/g;
    return escHtml2(src).replace(re, (m) => {
      if (m.startsWith("/*")) return '<span class="tok-cmt">' + m + "</span>";
      if (m.startsWith('"') || m.startsWith("'")) return '<span class="tok-str">' + m + "</span>";
      if (m.startsWith("#")) return '<span class="tok-num">' + m + "</span>";
      if (/^[A-Za-z-]+\s*:$/.test(m)) return '<span class="tok-key">' + m + "</span>";
      if (/\d/.test(m)) return '<span class="tok-num">' + m + "</span>";
      return m;
    });
  }

  function highlightYaml(src) {
    const re = /#.*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b\d+\.?\d*\b|[A-Za-z_][\w-]*\s*:/g;
    return escHtml2(src).replace(re, (m) => {
      if (m.startsWith("#")) return '<span class="tok-cmt">' + m + "</span>";
      if (m.startsWith('"') || m.startsWith("'")) return '<span class="tok-str">' + m + "</span>";
      if (/^\d/.test(m)) return '<span class="tok-num">' + m + "</span>";
      if (/\s*:$/.test(m)) return '<span class="tok-key">' + m + "</span>";
      return m;
    });
  }

  const COMMON_KW = new Set(["if","else","elif","for","while","do","switch","case","break","continue","return","function","def","class","import","export","from","const","let","var","new","try","catch","finally","throw","async","await","true","false","null","None","True","False","and","or","not","in","is","public","private","protected","static","void","int","string","bool","boolean","float","double","long","char","struct","enum","interface","extends","implements","package","namespace","using","include","require","print","echo","fn","mut","pub","crate","mod","use","let","match","impl","trait","type","where","async","await","yield","lambda","with","as","pass","raise","except","global","nonlocal","del","assert","and","or","not","in","is","lambda"]);
  function highlightGeneric(src) {
    const escaped = escHtml2(src);
    const re = /#.*|\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d+\.?\d*\b|[A-Za-z_$][\w$]*\b/g;
    return escaped.replace(re, (m, offset) => {
      if (m.startsWith("#") || m.startsWith("//") || m.startsWith("/*")) return '<span class="tok-cmt">' + m + "</span>";
      if (m.startsWith('"') || m.startsWith("'") || m.startsWith("`")) return '<span class="tok-str">' + m + "</span>";
      if (/^\d/.test(m)) return '<span class="tok-num">' + m + "</span>";
      const rest = escaped.slice(offset + m.length);
      if (COMMON_KW.has(m)) return '<span class="tok-kw">' + m + "</span>";
      if (/^\s*\(/.test(rest)) return '<span class="tok-fn">' + m + "</span>";
      if (/^[A-Z][A-Z0-9_]{2,}$/.test(m)) return '<span class="tok-const">' + m + "</span>";
      if (/^[A-Z]/.test(m)) return '<span class="tok-type">' + m + "</span>";
      return m;
    });
  }

  function isTerminalLang(lang) {
    return lang === "powershell" || lang === "pwsh" || lang === "ps1" ||
           lang === "bat" || lang === "cmd" || lang === "console" ||
           lang === "terminal";
  }

  function promptMatch(line, lang) {
    let m;
    if (lang === "powershell" || lang === "pwsh" || lang === "ps1") {
      m = line.match(/^(PS\s+\S[^>]*>)(.*)$/);
      if (m) return { prompt: m[1], rest: m[2] };
      m = line.match(/^(>>)(.*)$/);
      if (m) return { prompt: m[1], rest: m[2] };
      return null;
    }
    if (lang === "bat" || lang === "cmd") {
      m = line.match(/^([A-Za-z]:\\[^>]*>)(.*)$/);
      if (m) return { prompt: m[1], rest: m[2] };
      m = line.match(/^(>>)(.*)$/);
      if (m) return { prompt: m[1], rest: m[2] };
      return null;
    }
    // console / terminal: try common prompt shapes
    m = line.match(/^(PS\s+\S[^>]*>)(.*)$/);
    if (m) return { prompt: m[1], rest: m[2] };
    m = line.match(/^([A-Za-z]:\\[^>]*>)(.*)$/);
    if (m) return { prompt: m[1], rest: m[2] };
    m = line.match(/^([\w.@-]+[\$#])(\s+.*)$/);
    if (m && m[1].length <= 60) return { prompt: m[1], rest: m[2] };
    m = line.match(/^([\$#])(\s.*)$/);
    if (m) return { prompt: m[1], rest: m[2] };
    return null;
  }

  function highlightTerminal(src, lang) {
    const lines = String(src == null ? "" : src).replace(/\r\n?/g, "\n").split("\n");
    const isPs = (lang === "powershell" || lang === "pwsh" || lang === "ps1");
    const out = [];
    for (const line of lines) {
      const pm = promptMatch(line, lang);
      if (pm) {
        const promptHtml = '<span class="tok-cmt">' + escHtml2(pm.prompt) + "</span>";
        let cmdHtml = escHtml2(pm.rest);
        // colour strings, variables, numbers
        cmdHtml = cmdHtml.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, (m) => '<span class="tok-str">' + m + "</span>");
        cmdHtml = cmdHtml.replace(/\$[A-Za-z_][\w]*/g, (m) => '<span class="tok-var">' + m + "</span>");
        cmdHtml = cmdHtml.replace(/\b\d+\.?\d*\b/g, (m) => '<span class="tok-num">' + m + "</span>");
        cmdHtml = cmdHtml.replace(/[|;]/g, (m) => '<span class="tok-op">' + m + "</span>");
        // windows paths
        cmdHtml = cmdHtml.replace(/[A-Za-z]:\\[^\s<]+/g, (m) => '<span class="tok-str">' + m + "</span>");
        if (isPs) {
          cmdHtml = cmdHtml.replace(/\b[A-Z][a-z]+-[A-Za-z]+\b/g, (m) => '<span class="tok-fn">' + m + "</span>");
          cmdHtml = cmdHtml.replace(/(?<![A-Za-z<])--?[A-Za-z][\w-]*/g, (m) => '<span class="tok-flag">' + m + "</span>");
        } else {
          // bat / cmd / console / terminal: command name, slash-flags
          cmdHtml = cmdHtml.replace(/^\s*([A-Za-z][\w-]*)/, (m, c) => m.replace(c, '<span class="tok-fn">' + c + "</span>"));
          cmdHtml = cmdHtml.replace(/(^|\s)(\/[A-Za-z][\w-]*)/g, (m, lead, flag) => lead + '<span class="tok-flag">' + flag + "</span>");
          cmdHtml = cmdHtml.replace(/(?<![A-Za-z<])--?[A-Za-z][\w-]*/g, (m) => '<span class="tok-flag">' + m + "</span>");
        }
        out.push(promptHtml + cmdHtml);
      } else if (/^-{3,}\s*$/.test(line) || /^={3,}\s*$/.test(line)) {
        // separator rule
        out.push('<span class="tok-cmt">' + escHtml2(line) + "</span>");
      } else {
        const labelMatch = line.match(/^(\s*)([A-Za-z][\w ]*?)(\s*:\s*)(.*)$/);
        if (labelMatch && labelMatch[2].trim().length > 0 && labelMatch[2].trim().length <= 24) {
          const lead = escHtml2(labelMatch[1]);
          const label = '<span class="tok-key">' + escHtml2(labelMatch[2]) + "</span>";
          const colon = escHtml2(labelMatch[3]);
          let value = escHtml2(labelMatch[4]);
          value = value.replace(/[A-Za-z]:\\[^\s<]+/g, (m) => '<span class="tok-str">' + m + "</span>");
          value = value.replace(/\b\d+\.?\d*\b/g, (m) => '<span class="tok-num">' + m + "</span>");
          out.push(lead + label + colon + value);
        } else {
          let html = escHtml2(line);
          html = html.replace(/[A-Za-z]:\\[^\s<]+/g, (m) => '<span class="tok-str">' + m + "</span>");
          html = html.replace(/\b\d+\.?\d*\b/g, (m) => '<span class="tok-num">' + m + "</span>");
          out.push(html);
        }
      }
    }
    return out.join("\n");
  }

  function highlightPowershellGeneric(src) {
    const escaped = escHtml2(src);
    let s = escaped.replace(/#.*$/gm, (m) => '<span class="tok-cmt">' + m + "</span>");
    s = s.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, (m) => '<span class="tok-str">' + m + "</span>");
    s = s.replace(/\b[A-Z][a-z]+-[A-Za-z]+\b/g, (m) => '<span class="tok-fn">' + m + "</span>");
    s = s.replace(/\$[A-Za-z_][\w]*/g, (m) => '<span class="tok-var">' + m + "</span>");
    s = s.replace(/(?<![A-Za-z])--?[A-Za-z][\w-]*/g, (m) => '<span class="tok-flag">' + m + "</span>");
    s = s.replace(/\b\d+\.?\d*\b/g, (m) => '<span class="tok-num">' + m + "</span>");
    s = s.replace(/[|;,]/g, (m) => '<span class="tok-op">' + m + "</span>");
    return s;
  }

  function highlightCode(doc) {
    for (const pre of Array.from(doc.querySelectorAll("pre.fence"))) {
      const code = pre.querySelector("code");
      if (!code) continue;
      const lang = String(pre.getAttribute("data-lang") || "").toLowerCase();
      const src = code.textContent || "";
      if (!src.trim()) continue;
      let out = null;
      if (lang === "bash" || lang === "sh" || lang === "shell") {
        const re = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|#.*|\$[A-Za-z_][\w]*|\b\d+\.?\d*\b|--?[A-Za-z][\w-]*|[|&<>;]+/g;
        out = escHtml2(src).replace(re, (m) => {
          if (m.startsWith("#")) return '<span class="tok-cmt">' + m + "</span>";
          if (m.startsWith('"') || m.startsWith("'")) return '<span class="tok-str">' + m + "</span>";
          if (m.startsWith("$")) return '<span class="tok-var">' + m + "</span>";
          if (/^\d/.test(m)) return '<span class="tok-num">' + m + "</span>";
          if (m.startsWith("-")) return '<span class="tok-flag">' + m + "</span>";
          if (KW.sh.has(m)) return '<span class="tok-kw">' + m + "</span>";
          if (/^[+\-*/%=&|<>!?:;,\.\[\]{}()]+$/.test(m)) return '<span class="tok-op">' + m + "</span>";
          return m;
        });
      } else if (lang === "js" || lang === "javascript" || lang === "ts" || lang === "typescript" || lang === "jsx" || lang === "tsx") out = highlightCStyle(src, (lang.startsWith("t") ? KW.ts : KW.js));
      else if (lang === "java") out = highlightCStyle(src, KW.java);
      else if (lang === "c" || lang === "cpp" || lang === "c++" || lang === "cc" || lang === "h" || lang === "hpp" || lang === "cs" || lang === "csharp" || lang === "c#") out = highlightCStyle(src, KW.cpp);
      else if (lang === "go" || lang === "golang") out = highlightCStyle(src, KW.go);
      else if (lang === "rust" || lang === "rs") out = highlightCStyle(src, KW.rust);
      else if (lang === "php") out = highlightCStyle(src, KW.php);
      else if (lang === "py" || lang === "python") out = highlightHash(src, KW.python);
      else if (lang === "ruby" || lang === "rb") out = highlightHash(src, KW.ruby);
      else if (lang === "sql") out = highlightSql(src);
      else if (lang === "json") out = highlightJson(src);
      else if (lang === "html" || lang === "xml" || lang === "svg") out = highlightHtml(src);
      else if (lang === "css" || lang === "scss" || lang === "less") out = highlightCss(src);
      else if (lang === "yaml" || lang === "yml") out = highlightYaml(src);
      else if (isTerminalLang(lang)) {
        const hasPrompt = src.split(/\n/).some((l) => promptMatch(l, lang));
        out = hasPrompt ? highlightTerminal(src, lang) : highlightPowershellGeneric(src);
      } else out = highlightGeneric(src);
      code.innerHTML = out;
    }
  }

  function escapeHtmlDiagram(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

  // Turns a fenced block that is really a box-drawing diagram into a small
  // set of nodes and arrows. Returns an HTML string, or null when the block
  // does not look like a diagram we can parse.
  function parseAsciiDiagram(text) {
    const lines = String(text == null ? "" : text).replace(/\r\n?/g, "\n").split("\n");
    const boxes = [];
    for (let r = 0; r < lines.length; r++) {
      let c = 0;
      while (true) {
        const idx = lines[r].indexOf("\u250c", c);
        if (idx === -1) break;
        c = idx;
        const right = lines[r].indexOf("\u2510", c + 1);
        if (right === -1) { c++; continue; }
        let bottom = -1;
        for (let rr = r + 1; rr < lines.length; rr++) {
          if (lines[rr].charAt(c) === "\u2514") { bottom = rr; break; }
        }
        if (bottom === -1) { c++; continue; }
        if (lines[bottom].charAt(right) !== "\u2518") { c++; continue; }
        const content = [];
        for (let rr = r + 1; rr < bottom; rr++) {
          let row = lines[rr].slice(c + 1, right);
          // misaligned ASCII boxes sometimes include their own vertical rule
          row = row.replace(/^\s*[\u2502\u2503|]\s?/, "").replace(/\s*[\u2502\u2503|]\s*$/, "");
          content.push(row.replace(/\s+$/g, ""));
        }
        // drop leading/trailing blank lines
        while (content.length && content[0].trim() === "") content.shift();
        while (content.length && content[content.length - 1].trim() === "") content.pop();
        boxes.push({ r, c, right, bottom, content });
        c = right + 1;
      }
    }
    if (boxes.length < 2) return null;
    boxes.sort((a, b) => a.c - b.c || a.r - b.r);

    let html = '<div class="ascii-diagram">';
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      const nodeText = b.content.map((l) => escapeHtmlDiagram(l.trim())).join("<br>");
      html += '<div class="ad-node">' + nodeText + "</div>";
      if (i >= boxes.length - 1) continue;
      const next = boxes[i + 1];
      const top = Math.min(b.r, next.r);
      const bottom = Math.max(b.bottom, next.bottom);
      const left = b.right + 1;
      const rightCol = next.c - 1;
      const labelLines = [];
      let rightArrow = false, leftArrow = false;
      for (let rr = top; rr <= bottom; rr++) {
        const line = lines[rr] || "";
        const slice = (rightCol >= left) ? line.slice(left, rightCol + 1) : "";
        const cleaned = slice.replace(/[\u2500-\u257F\u2190-\u21FF\u2580-\u259F\u25B6\u25C0\u25BA\u25C4\u25B8\u25C2\u2502\u2503]/g, " ").trim();
        if (cleaned) labelLines.push(cleaned);
        if (/[\u25B6\u2192\u25BA]/.test(slice)) rightArrow = true;
        if (/[\u25C0\u2190\u25C4]/.test(slice)) leftArrow = true;
      }
      const label = labelLines.map(escapeHtmlDiagram).join("<br>");
      const dir = (leftArrow && rightArrow) ? "both" : (leftArrow ? "left" : "right");
      html += '<div class="ad-arrow ad-' + dir + '">';
      if (label) html += '<div class="ad-label">' + label + "</div>";
      html += '<div class="ad-line"></div>';
      html += "</div>";
    }
    html += "</div>";
    return html;
  }

  // A graphical fallback for any ASCII block we cannot turn into nodes: render
  // the exact text as a scalable SVG picture with its own backdrop, so the
  // diagram behaves like an image rather than a code listing.
  function renderAsciiSvg(text) {
    const lines = String(text == null ? "" : text).replace(/\r\n?/g, "\n").split("\n");
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    if (!lines.length) return null;
    const charW = 7.4, lineH = 15, padX = 18, padY = 16;
    const maxCols = Math.max.apply(null, lines.map((l) => l.length));
    const w = Math.ceil(maxCols * charW + padX * 2);
    const h = Math.ceil(lines.length * lineH + padY * 2);
    let svg = '<svg class="ascii-svg" viewBox="0 0 ' + w + " " + h + '" width="100%" style="max-width:' + w + 'px" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="ASCII diagram">';
    svg += '<defs><linearGradient id="adbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="' + "var(--fence)" + '"/><stop offset="100%" stop-color="' + "var(--card)" + '"/></linearGradient></defs>';
    svg += '<rect x="0.5" y="0.5" width="' + (w - 1) + '" height="' + (h - 1) + '" rx="14" fill="url(#adbg)" stroke="color-mix(in srgb, var(--line) 60%, var(--accent) 40%)" />';
    for (let i = 0; i < lines.length; i++) {
      const y = padY + (i + 1) * lineH - 3;
      svg += '<text x="' + padX + '" y="' + y + '" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="12.5" fill="var(--ink)" xml:space="preserve">' + escapeHtmlDiagram(lines[i]) + "</text>";
    }
    svg += "</svg>";
    return '<div class="ascii-svg-wrap">' + svg + "</div>";
  }

  function markDiagrams(doc) {
    for (const pre of Array.from(doc.querySelectorAll("pre.fence"))) {
      if (!/[\u2500-\u257F\u2580-\u259F\u2190-\u21FF]/.test(pre.textContent || "")) continue;
      const html = parseAsciiDiagram(pre.textContent || "");
      if (html) {
        const wrap = document.createElement("div");
        wrap.className = "ascii-diagram-wrap";
        wrap.innerHTML = html;
        pre.replaceWith(wrap);
      } else {
        const svgHtml = renderAsciiSvg(pre.textContent || "");
        if (svgHtml) {
          const wrap = document.createElement("div");
          wrap.className = "ascii-svg-wrap";
          wrap.innerHTML = svgHtml;
          pre.replaceWith(wrap);
        } else {
          pre.classList.add("diagram");
        }
      }
    }
  }

  function bindSections(doc) {
    let heads;
    try {
      heads = doc.querySelectorAll("h2[id], h3[id], h4[id]");
    } catch (e) {
      return;
    }
    READ_HEADS = [];
    for (const el of heads) {
      READ_HEADS.push({ el, id: el.id, min: Math.max(1, Math.round(sectionWords(el) / 220)) });
    }
    READ_MINUTES = Math.max(1, Math.round(countWords(doc.textContent) / 220));
  }

  // Where the reader stopped is kept as a place in the text, not as a number of pixels: the
  // block at the top of the window, and how far into it the window is. A pixel offset is wrong
  // as soon as the page is laid out differently (a picture that loads late, a narrower window),
  // and a note full of pictures is laid out differently every time it is opened.
  let RESUME_HOLD = false;

  // What names a block: its first words, and the file name of its first picture, so a block
  // that is only a picture is not mistaken for any other picture.
  function blockText(el) {
    const text = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60);
    const img = el.querySelector && el.querySelector("img");
    const file = img ? (img.getAttribute("src") || "").split("/").pop() : "";
    return file ? text + "\u0001" + file : text;
  }

  function readingBlocks() {
    const doc = document.querySelector(".mdview .doc");
    if (!doc) return [];
    // The masthead is left out: on a wide window it is the fixed bar at the top, which is always
    // "the block at the top of the window", so every position was recorded as the masthead.
    return Array.from(doc.children).filter(
      (el) => !el.classList.contains("cp-line") && !el.classList.contains("cp-bar") && !el.classList.contains("mast")
    );
  }

  // How much of the top of the window is the fixed bar on a wide window: the text that matters
  // starts below it.
  function barHeight() {
    const mast = document.querySelector(".mdview .doc > .mast");
    if (!mast || getComputedStyle(mast).position !== "fixed") return 0;
    return Math.max(0, mast.getBoundingClientRect().bottom);
  }

  function readingAnchor() {
    const blocks = readingBlocks();
    const bar = barHeight();
    for (let i = 0; i < blocks.length; i++) {
      const r = blocks[i].getBoundingClientRect();
      if (r.height > 0 && r.bottom > bar + 8) {
        return { i, t: blockText(blocks[i]), f: Math.max(0, Math.min(1, (bar - r.top) / r.height)) };
      }
    }
    return null;
  }

  // The page's scroll position for a place in the text, or null if the text is not there now.
  function anchorTop(a) {
    const blocks = readingBlocks();
    let el = blocks[a.i];
    if (!el || blockText(el) !== a.t) {
      // the note was edited or regenerated and the block moved: the same words, nearest to where
      // it was (a note can repeat a short line, like "Features" under every file system)
      el = null;
      let best = Infinity;
      blocks.forEach((b, i) => {
        if (blockText(b) === a.t && Math.abs(i - a.i) < best) {
          best = Math.abs(i - a.i);
          el = b;
        }
      });
    }
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.top + window.scrollY + a.f * r.height - barHeight();
  }

  // Puts the page back where the reader left it, and keeps it there while the page settles.
  // When it is first built the page is not the height it will be: pictures above the place have
  // not loaded, so a position worked out then is too high and the scroll is not even possible
  // yet. So the place is looked up again every moment until the page has finished loading, or the
  // reader takes over (a wheel, a touch, a key, a click), whichever comes first.
  function resumeFromAnchor() {
    if (!READ || RESUME_HOLD) return;
    // A `#section` in the address is a request to go there, unless the page is only being reloaded:
    // clicking the outline leaves its `#section` in the address, and a reload after reading on
    // would otherwise go back to that heading, not to where the reader got to.
    let reloaded = false;
    try { reloaded = performance.getEntriesByType("navigation")[0].type === "reload"; } catch (e) { /* not known: the hash wins */ }
    // an anchor on the first block is the masthead, which is where a record written by a page that
    // was not yet built points; it is not a place in the text
    const usable = !!READ.a && READ.a.i > 0 && READ.y >= 200 && (!location.hash || reloaded);
    // a record from before places existed, or one that named the masthead, has only the pixel
    // offset: better than the top, and the first scroll after it records a real place
    const pixels = !usable && (!READ.a || READ.a.i === 0) && READ.y >= 200 && (!location.hash || reloaded);
    let lastSet = null;
    const back = () => {
      if (!usable && !pixels) return;
      const top = usable ? anchorTop(READ.a) : READ.y;
      if (top === null) return;
      // instantly: the page's own smooth scrolling would start over at every retry and never arrive
      if (Math.abs(window.scrollY - top) > 2) {
        window.scrollTo({ top: Math.max(0, top), left: 0, behavior: "instant" });
        lastSet = window.scrollY;
      }
    };
    // The page is held from the start whether or not there is a place to go back to: until it has
    // settled, its scrolling is the page being built, not the reader reading.
    RESUME_HOLD = true;
    const events = ["wheel", "touchstart", "keydown", "mousedown", "pointerdown"];
    let poll = 0;
    let longest = 0;
    const release = () => {
      if (!RESUME_HOLD) return;
      RESUME_HOLD = false;
      clearInterval(poll);
      clearTimeout(longest);
      for (const e of events) window.removeEventListener(e, release, true);
    };
    for (const e of events) window.addEventListener(e, release, { capture: true, passive: true });
    back();
    // The page is settled once its pictures are all in and nothing has moved for a moment. The
    // `load` event is no guide: the pictures are put in the page after it has fired, so on a slow
    // machine the hold used to end while they were still arriving, and each one that landed above
    // the place pushed it down — the reader came back to an earlier section than the one they left.
    let quietSince = Date.now();
    poll = setInterval(() => {
      // moved by something other than this: a dragged scrollbar, say. The reader has taken over.
      if (lastSet !== null && Math.abs(window.scrollY - lastSet) > 3) { release(); return; }
      back();
      const waiting = Array.from(document.querySelectorAll(".mdview .doc img")).some((img) => !img.complete);
      if (waiting) quietSince = Date.now();
      else if (Date.now() - quietSince > 1200) release();
    }, 120);
    longest = setTimeout(release, 30000);
  }

  // Called by the progress line, which already runs on scroll: one listener per
  // page is the whole point, so the reader's position is read once and shared.
  function notePosition(pct, y, max) {
    if (!READ) return;
    // while the page is being put back where the reader left it, its own scrolling is not
    // the reader's, and must not be written over the place it is being put back to
    if (RESUME_HOLD) return;
    let shown = false;
    if (max > 0 && pct > READ.pct) {
      READ.pct = pct;
      shown = true;
    }
    READ.y = Math.round(y);
    READ.a = readingAnchor() || READ.a;
    if (max > 0 && pct >= 98 && !READ.done) {
      READ.done = true;
      shown = true;
    }
    saveRead();
    markSections();
    if (shown) paintRead();
    for (const fn of READ_TICKS) {
      try { fn(); } catch (e) { /* a frill */ }
    }
  }

  /* ------------------------------------------------------------- outline -- */

  // One entry in an outline: what the section is called, and how much reading is
  // behind it. "2m" is the difference between a list of links and a list of next
  // steps — the whole reason a reader picks the short section first and finishes
  // one more.
  // The heading's own words, without the reader chrome inside it. The anchor is
  // already in the heading by the time the narrow-window contents is built, and
  // its `#` is a link, not part of the section's name.
  function headingText(head) {
    const copy = head.cloneNode(true);
    for (const a of copy.querySelectorAll(".anchor, .fold")) a.remove();
    return (copy.textContent || "").replace(/\s+/g, " ").trim();
  }

  // The outline indents h3 under h2. A document whose shallowest heading is an h3 has no
  // h2 to sit under, so its entries are the top level and stay flush.
  function outlineClass(head, heads) {
    const top = Math.min(...Array.from(heads, (h) => +h.tagName[1]));
    // a level below the top one is indented once, two below it twice
    return "toc-h" + Math.min(4, 2 + (+head.tagName[1] - top));
  }

  function outlineLink(head) {
    const link = document.createElement("a");
    link.href = "#" + head.id;
    const label = document.createElement("span");
    label.className = "toc-label";
    label.textContent = headingText(head);
    link.appendChild(label);
    const min = sectionMin(head.id);
    if (min) {
      const size = document.createElement("span");
      size.className = "toc-min";
      size.textContent = min + "m";
      size.title = "about " + min + " min";
      link.appendChild(size);
    }
    return link;
  }

  // Both outlines double as the reader's own record: every section whose heading
  // is behind them is ticked and dimmed, so the list fills in as the file is read.
  // The marks follow the window, so a re-read shows where the reader is now: a section
  // the window is past is dimmed and ticked, the first section it is not past carries
  // the dot, and scrolling back up takes the marks back.
  // A section passed on the way down flashes its row once. The newest one only, so a
  // jump past several sections does not flash them all, and nothing flashes on a jump up.
  function trackReadMarks(root) {
    let lastY = null;
    const paint = () => {
      const y = window.scrollY;
      const behind = new Set(passedHeads());
      const items = Array.from(root.querySelectorAll("li[data-head]"));
      let fresh = null;
      for (const item of items) {
        const now = behind.has(item.dataset.head);
        if (now && !item.classList.contains("is-read")) fresh = item;
        item.classList.toggle("is-read", now);
      }
      // the first paint sets the baseline and flashes nothing, so a file opened part-way
      // through does not replay its earlier sections
      if (fresh && lastY !== null && y > lastY && !prefersCalm()) {
        fresh.classList.remove("just-read");
        void fresh.offsetWidth; // restart the flash if it is already running
        fresh.classList.add("just-read");
      }
      lastY = y;
      const next = items.find((item) => !item.classList.contains("is-read"));
      for (const item of items) item.classList.toggle("is-next", item === next);
    };
    onPosition(paint);
  }

  // A browser tab has no sidebar, so a wide window leaves the document sitting
  // in a band with nothing on either side. The stylesheet gives the headings a
  // margin to expand into from 1280px; this builds its contents from the ids
  // the renderer already puts on h2/h3. Returns null when an outline would be
  // pointless, in which case the layout stays a plain centred column.
  function buildOutline(docEl) {
    let heads;
    try {
      heads = docEl.querySelectorAll("h2[id], h3[id], h4[id]");
    } catch (e) {
      return null;
    }
    if (heads.length < 3) return null;

    const nav = document.createElement("nav");
    nav.className = "toc";
    nav.setAttribute("aria-label", "On this page");

    const label = document.createElement("p");
    label.className = "toc-title";
    label.textContent = "On this page";
    nav.appendChild(label);

    const list = document.createElement("ul");
    for (const head of heads) {
      const item = document.createElement("li");
      item.className = outlineClass(head, heads);
      item.dataset.head = head.id;
      item.appendChild(outlineLink(head));
      list.appendChild(item);
    }
    nav.appendChild(list);
    trackReadMarks(nav);
    onPosition(() => {
      label.textContent = READ_HEADS.length
        ? "On this page · " + readCount() + "/" + READ_HEADS.length
        : "On this page";
    });
    return nav;
  }

  // Mark the section you are currently reading. Without it the outline is just
  // a list of links competing with the text for attention.
  function trackOutline(nav, docEl) {
    const links = Object.create(null);
    for (const link of nav.querySelectorAll("a")) links[link.hash.slice(1)] = link;
    const heads = docEl.querySelectorAll("h2[id], h3[id], h4[id]");
    let last = 0;
    let trailing = 0;

    function mark() {
      let current = null;
      for (const head of heads) {
        if (head.getBoundingClientRect().top <= 120) current = head.id;
        else break;
      }
      for (const id in links) {
        const on = id === current;
        if (on) links[id].setAttribute("aria-current", "true");
        else links[id].removeAttribute("aria-current");
      }
      keepInView(current);
    }

    /* An outline that has scrolled the reader's own position out of its own box
       is not telling them where they are. The margin outline is a sticky column
       with a `max-height`, so on a document with more headings than fit — the
       long ones, which is most of the reason to have an outline at all — the row
       marked as current is very often above or below the part of the list on
       screen. It is brought back, but only when it has actually gone out: a
       reader who has scrolled the outline themselves to look ahead is not yanked
       back on every pass, and the box is never scrolled when nothing is marked.

       The outline's own offset is moved by hand rather than with
       `scrollIntoView`, which would also scroll the page — the one thing the
       reader did not ask for while reading the page. */
    let held = "";
    function keepInView(id) {
      if (!id || id === held) return;
      held = id;
      const link = links[id];
      if (!link) return;
      // nothing to do unless the outline itself is a scrollable box
      if (nav.scrollHeight <= nav.clientHeight + 2) return;
      const box = nav.getBoundingClientRect();
      const item = link.parentElement.getBoundingClientRect();
      if (item.top >= box.top + 8 && item.bottom <= box.bottom - 8) return;
      nav.scrollTop +=
        item.top < box.top + 8
          ? item.top - box.top - 8
          : item.bottom - box.bottom + 8;
    }

    // Deliberately not rAF-throttled: this runs at most every 120ms, which is
    // cheap, and unlike a frame callback it still runs in a background tab.
    function onScroll() {
      const now = Date.now();
      if (now - last >= 120) {
        last = now;
        mark();
        return;
      }
      clearTimeout(trailing);
      trailing = setTimeout(() => {
        last = Date.now();
        mark();
      }, 130);
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    mark();
  }

  /* ------------------------------------------------------------ reader ui -- */

  // Everything below is chrome, not markdown. It is added to the rendered tree
  // after mount, so the renderer's output stays exactly what the spec tests
  // expect, and so a failure here can never cost you the document. The payoff is
  // that a local .md ends up looking like a designed page — file name, reading
  // time, copyable code, linkable headings, a progress line — which is the whole
  // argument for reading markdown instead of a PDF.
  const THEME_KEY = "mdview:theme";
  const THEMES = ["auto", "light", "dark", "warm"];
  const THEME_LABEL = { auto: "Auto", light: "Light", dark: "Dark", warm: "Warm" };

  // The reading width. The stylesheet's default is fluid — the page fills the
  // window the way a hosted markdown file does — because that is what this is
  // usually read beside. The two alternatives are a reading measure, for reading
  // a document end to end, and a cap-free column, for reading one alongside the
  // thing it came from. Neither is a fact about the document, so it is the
  // reader's call: cycled from the header and remembered, like the theme.
  // a new key, so the Narrow default reaches readers whose old saved "fluid" was only the
  // old default written down; a width chosen from now on is kept under this key
  const WIDTH_KEY = "mdview:reading-width";
  const WIDTHS = ["narrow", "fluid", "full"];
  const WIDTH_LABEL = { narrow: "Narrow", fluid: "Fluid", full: "Full" };

  // The face the document is set in. Sans is the default — the face of the tool
  // these notes are written next to, and the one that keeps a 150-character line
  // legible — and Serif is the same page set as a book, for reading a document
  // end to end. It is a measurement choice as much as a taste one: a text face at
  // the same `font-size` reads smaller and sits tighter, so the stylesheet carries
  // the face's own size, leading and code size along with it.
  const FONT_KEY = "mdview:font";
  const FONTS = ["sans", "serif"];
  const FONT_LABEL = { sans: "Sans", serif: "Serif" };

  function storedTheme() {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      return THEMES.includes(saved) ? saved : "auto";
    } catch (e) {
      return "auto"; // opaque origin: no memory between documents
    }
  }

  function applyTheme(theme) {
    const root = document.documentElement;
    if (theme === "auto") root.removeAttribute("data-mdview-theme");
    else root.setAttribute("data-mdview-theme", theme);
    rerunDiagrams();
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (e) { /* not persisted, not a problem */ }
  }

  function storedWidth() {
    try {
      const saved = localStorage.getItem(WIDTH_KEY);
      return WIDTHS.includes(saved) ? saved : "narrow";
    } catch (e) {
      return "narrow"; // opaque origin: no memory between documents
    }
  }

  // Everything that measured the column has to measure the new one, and there are
  // two kinds of listener. A resize event is what the changes that only need a
  // re-read listen for (the table fitter, the reading progress); a pass that has
  // to *undo* its own markup to measure again registers a hook, because it cannot
  // do that on every pixel of a window drag but must do it when the reader picks a
  // different face or width.
  const REMEASURE_HOOKS = [];

  function onRemeasure(fn) {
    REMEASURE_HOOKS.push(fn);
  }

  function remeasure() {
    for (const fn of REMEASURE_HOOKS) {
      try {
        fn();
      } catch (e) { /* a frill failing is not the document failing */ }
    }
    try {
      window.dispatchEvent(new Event("resize"));
    } catch (e) { /* nothing listening */ }
  }

  // The default is the absence of the attribute, so a document whose reader has
  // never touched this control carries no width state at all.
  function applyWidth(width) {
    const root = document.documentElement;
    if (width === "fluid") root.removeAttribute("data-mdview-width");
    else root.setAttribute("data-mdview-width", width);
    remeasure();
    try {
      localStorage.setItem(WIDTH_KEY, width);
    } catch (e) { /* not persisted, not a problem */ }
  }

  function storedFont() {
    try {
      const saved = localStorage.getItem(FONT_KEY);
      return FONTS.includes(saved) ? saved : "sans";
    } catch (e) {
      return "sans"; // opaque origin: no memory between documents
    }
  }

  // `sans` is the default and the absence of the attribute, like the width modes.
  function applyFont(font) {
    const root = document.documentElement;
    if (font === "sans") root.removeAttribute("data-mdview-font");
    else root.setAttribute("data-mdview-font", font);
    remeasure();
    try {
      localStorage.setItem(FONT_KEY, font);
    } catch (e) { /* not persisted, not a problem */ }
  }

  function button(className, label, title) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = className;
    el.textContent = label;
    if (title) el.title = title;
    return el;
  }

  function copyText(text) {
    try {
      return navigator.clipboard.writeText(text).then(() => true, () => false);
    } catch (e) {
      return Promise.resolve(false);
    }
  }

  // What the tab should say. The first `#` of the document is the only name the
  // document gives itself; it is read off a copy with the anchor link removed,
  // because that link's `#` is reader chrome and not part of the title. Capped,
  // because a heading that is a whole sentence is not a tab title and the browser
  // would cut it somewhere worse anyway.
  function documentTitle(doc) {
    const h = doc.querySelector("h1");
    if (!h) return "";
    const copy = h.cloneNode(true);
    for (const a of copy.querySelectorAll(".anchor, .fold")) a.remove();
    let text = (copy.textContent || "").replace(/\s+/g, " ").trim();
    if (text.length > 90) text = text.slice(0, 89).trimEnd() + "…";
    return text;
  }

  // A word count is the only "metadata" a .md file lacks that a PDF shows off in
  // its sidebar, so put it where it belongs: a slim line above the document.
  //
  // The document's own size is measured once. It used to be measured every time
  // this was asked, and `doc.textContent` at that moment includes whatever
  // chrome has already been put into the document — the header is in there before
  // the first reading of it, the endplate is not until after the second — so the
  // header and the endplate could quote different figures for the same file, and
  // a figure that moved when a box was ticked made the reading time jump by three
  // minutes. The size is a fact about the markdown; only the tick count moves.
  let STATS_BASE = null;

  function readingStats(doc) {
    if (!STATS_BASE) {
      const words = countWords(doc.textContent);
      STATS_BASE = words
        ? [words.toLocaleString() + " words", "≈ " + Math.max(1, Math.round(words / 220)) + " min read"]
        : [];
    }
    const boxes = doc.querySelectorAll('input[type="checkbox"]');
    const done = doc.querySelectorAll('input[type="checkbox"]:checked').length;
    const bits = STATS_BASE.slice();
    if (boxes.length) bits.push(done + " of " + boxes.length + " tasks done");
    return bits;
  }

  function masthead(file, doc) {
    const head = document.createElement("header");
    head.className = "mast";

    // The row inside the bar. On a desktop window the stylesheet gives this
    // element the page's own width and padding, which is what makes the bar's
    // contents line up with the text column.
    const row = document.createElement("div");
    row.className = "mast-in";

    // The reader's own bar already names the file, so the name is shown here only when
    // there is no such bar: a file opened straight from disk in the extension.
    if (!document.querySelector("nav.bar")) {
      const name = document.createElement("span");
      name.className = "mast-file";
      name.textContent = file;
      row.appendChild(name);
    }

    const meta = document.createElement("span");
    meta.className = "mast-meta";
    const facts = document.createElement("span");
    facts.className = "mast-stats";
    facts.textContent = readingStats(doc).join(" · ");
    // the one place the running build is visible without opening a console
    facts.title = location.href + " — rendered by mdview " + VERSION;
    meta.appendChild(facts);

    // How much of the file is behind the reader, next to what is in the file. It
    // is the cheapest possible nudge and the one that survives a glance: a
    // number that is not 100 is an unfinished thing.
    const readChip = document.createElement("span");
    readChip.className = "mast-read is-empty";
    meta.appendChild(readChip);
    onRead((rec) => {
      let text = "";
      if (rec && READ_HEADS.length) {
        if (rec.done) text = "Read ✓";
      }
      readChip.textContent = text;
      readChip.classList.toggle("is-empty", !text);
      readChip.classList.toggle("is-done", !!(rec && rec.done));
      if (text) readChip.setAttribute("aria-label", rec.done ? "Finished" : "Progress: " + text);
      else readChip.removeAttribute("aria-label");
    });

    row.appendChild(meta);

    const actions = document.createElement("span");
    actions.className = "mast-actions";

    let font = storedFont();
    const fontBtn = button("mast-btn", "", "");
    const paintFont = () => {
      fontBtn.textContent = "Font: " + FONT_LABEL[font];
      fontBtn.title = "Typeface: " + FONT_LABEL[font] + " — click to change";
      fontBtn.setAttribute("aria-label", "Typeface: " + FONT_LABEL[font]);
    };
    paintFont();
    fontBtn.addEventListener("click", () => {
      font = FONTS[(FONTS.indexOf(font) + 1) % FONTS.length];
      applyFont(font);
      paintFont();
    });
    actions.appendChild(fontBtn);

    let width = storedWidth();
    const widthBtn = button("mast-btn", "", "");
    const paintWidth = () => {
      widthBtn.textContent = "Width: " + WIDTH_LABEL[width];
      widthBtn.title = "Reading width: " + WIDTH_LABEL[width] + " — click to change";
      widthBtn.setAttribute("aria-label", "Reading width: " + WIDTH_LABEL[width]);
    };
    paintWidth();
    widthBtn.addEventListener("click", () => {
      width = WIDTHS[(WIDTHS.indexOf(width) + 1) % WIDTHS.length];
      applyWidth(width);
      paintWidth();
    });
    actions.appendChild(widthBtn);

    let theme = storedTheme();
    const themeBtn = button("mast-btn", "", "");
    const paintTheme = () => {
      themeBtn.textContent = "Theme: " + THEME_LABEL[theme];
      themeBtn.title = "Theme: " + THEME_LABEL[theme] + " — click to change";
    };
    paintTheme();
    themeBtn.addEventListener("click", () => {
      theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
      applyTheme(theme);
      paintTheme();
    });
    actions.appendChild(themeBtn);

    // Reading the whole file, or studying it by sections. The label is the mode
    // (like every control in this row) and it is revealed only when the document
    // has sections to fold — `addFolds` takes the `hidden` off.
    const studyBtn = button(
      "mast-btn mast-study",
      "Mode: Read",
      "Reading — click to study this file by sections"
    );
    studyBtn.hidden = true;
    actions.appendChild(studyBtn);

    const printBtn = button(
      "mast-btn",
      "Print",
      "Print or save as PDF — the same document, no export step"
    );
    printBtn.addEventListener("click", () => window.print());
    actions.appendChild(printBtn);

    row.appendChild(actions);
    head.appendChild(row);
    return head;
  }

  function addCopyButtons(doc) {
    for (const pre of doc.querySelectorAll("pre.fence")) {
      const code = pre.querySelector("code");
      if (!code || !code.textContent.trim()) continue;
      const btn = button("copy", "Copy", "Copy this block");
      btn.addEventListener("click", () => {
        copyText(code.textContent).then((ok) => {
          btn.textContent = ok ? "Copied" : "Press \u2318C";
          btn.classList.add("done");
          setTimeout(() => {
            btn.textContent = "Copy";
            btn.classList.remove("done");
          }, 1400);
        });
      });
      pre.appendChild(btn);
    }
  }

  // Top-level headings already carry ids for the outline; this makes them
  // addressable by hand as well, which is how people share a section of a doc.
  function addHeadingAnchors(doc) {
    for (const heading of doc.querySelectorAll("h2[id], h3[id], h4[id]")) {
      const anchor = document.createElement("a");
      anchor.className = "anchor";
      anchor.href = "#" + heading.id;
      anchor.textContent = "#";
      anchor.title = "Copy a link to this section";
      anchor.setAttribute("aria-label", "Link to this section");
      anchor.addEventListener("click", () => {
        copyText(location.href.split("#")[0] + "#" + heading.id).then((ok) => {
          if (!ok) return;
          anchor.classList.add("done");
          anchor.title = "Link copied";
          setTimeout(() => {
            anchor.classList.remove("done");
            anchor.title = "Copy a link to this section";
          }, 1400);
        });
      });
      heading.appendChild(anchor);
    }
  }

  // Mounted on <body> rather than inside the document: both are fixed to the
  // viewport, and neither should be part of the printout.
  function addReadingProgress() {
    const bar = document.createElement("div");
    bar.className = "mdview-progress";
    bar.setAttribute("aria-hidden", "true");
    const toTop = button("mdview-totop", "↑", "Back to top");
    toTop.setAttribute("aria-label", "Back to top");
    toTop.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: prefersCalm() ? "auto" : "smooth" });
    });
    document.body.appendChild(bar);
    // beside the reader's own top bar when it has one, so the control never sits on the text
    const topBar = document.querySelector("nav.bar");
    if (topBar) {
      toTop.classList.add("in-bar");
      topBar.appendChild(toTop);
    } else {
      document.body.appendChild(toTop);
    }

    function paint() {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const y = window.scrollY;
      const pct = max > 0 ? Math.max(0, Math.min(100, (y / max) * 100)) : 100;
      bar.style.width = pct + "%";
      // a full line that has somewhere to glow is the moment the file is finished
      bar.classList.toggle("is-done", max > 0 && pct >= 99.5);
      /* Once the reader is a screen down, not at a fixed number of pixels. 900
         was a screen's worth on the window it was written on and a screen and a
         half on a laptop with the panel open, and four screens on a tall one —
         so the control that exists to save a long scroll was itself waiting for
         a long scroll to become visible. */
      // once the end plate is on screen it carries its own "Start over", so the corner
      // button steps aside rather than sitting on the last lines of the file
      const plate = document.querySelector(".endplate");
      const atPlate = !!plate && plate.getBoundingClientRect().top < window.innerHeight;
      toTop.classList.toggle("show", y > window.innerHeight * 0.9 && !atPlate);
      // the reader's own record is kept in step by the one scroll listener the
      // page already has, rather than one per thing that wants to know
      notePosition(max > 0 ? pct : 0, y, max);
    }

    // Same deliberately-timer-free throttle as the outline: a leading-edge run
    // every 120ms keeps this cheap and still works in a background tab.
    let last = 0;
    let trailing = 0;
    function onScroll() {
      const now = Date.now();
      if (now - last >= 120) {
        last = now;
        paint();
        return;
      }
      clearTimeout(trailing);
      trailing = setTimeout(() => {
        last = Date.now();
        paint();
      }, 130);
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    paint();
  }

  // GitHub's alert syntax (`> [!NOTE]`) turned into real callouts. This is done
  // after rendering rather than in the renderer, so the markdown output the spec
  // suite scores stays exactly CommonMark, and a document that uses the markers
  // still reads as an ordinary quote anywhere else.
  //
  // The vocabulary is Obsidian's, drawn on mdview's five palettes. The five names
  // mdview already drew keep their own colour and label, so every card this
  // reader produced before is the card it produces now; the rest of Obsidian's
  // set and its aliases are accepted and take the nearest of the five, which is
  // what turns `> [!question]` from a quote full of stray brackets into the card
  // the writer meant. Each entry is [label, palette].
  const CALLOUTS = {
    note: ["Note", "note"],
    info: ["Info", "note"],
    todo: ["Todo", "note"],
    abstract: ["Abstract", "note"],
    summary: ["Summary", "note"],
    tldr: ["Tldr", "note"],
    tip: ["Tip", "tip"],
    hint: ["Hint", "tip"],
    success: ["Success", "tip"],
    check: ["Check", "tip"],
    done: ["Done", "tip"],
    example: ["Example", "tip"],
    important: ["Important", "important"],
    question: ["Question", "important"],
    help: ["Help", "important"],
    faq: ["Faq", "important"],
    warning: ["Warning", "warning"],
    attention: ["Attention", "warning"],
    caution: ["Caution", "caution"],
    danger: ["Danger", "caution"],
    error: ["Error", "caution"],
    failure: ["Failure", "caution"],
    fail: ["Fail", "caution"],
    missing: ["Missing", "caution"],
    bug: ["Bug", "caution"],
    quote: ["Quote", "note"],
    cite: ["Cite", "note"],
  };

  // `[!type]`, with Obsidian's optional fold marker after it. The marker is
  // accepted and the card renders open: folding a quote means rebuilding it
  // around a disclosure, and a card whose text is visible beats one the reader
  // cannot open. A type not in the table is not a callout at all.
  const CALLOUT_MARK = /^\s*\[!([a-z]+)\][-+]?\s*/i;

  function addCallouts(doc) {
    for (const quote of doc.querySelectorAll("blockquote")) {
      const first = quote.firstElementChild;
      if (!first) continue;
      const kind = CALLOUT_MARK.exec(first.textContent || "");
      if (!kind) continue;
      const card = CALLOUTS[kind[1].toLowerCase()];
      if (!card) continue;
      const walker = document.createTreeWalker(first, NodeFilter.SHOW_TEXT);
      const text = walker.nextNode();
      if (text) {
        text.nodeValue = text.nodeValue.replace(CALLOUT_MARK, "");
        if (!text.nodeValue.trim() && !first.children.length) first.remove();
      }
      quote.classList.add("callout", "callout-" + card[1]);
      quote.setAttribute("data-callout", card[0]);
    }
  }

  // A list where *every* item leads with a short bolded term and a colon is a
  // specification, not a bulleted list: `**Routing**: send it somewhere`. As
  // bullets those bury their terms inside paragraphs; as rows they become a
  // two-column table that needs no table markup. Visual only — the nodes are
  // moved, never rewritten, so the text of the document is unchanged.
  // Wide enough for a real term ("No Over-fetching/Under-fetching"), narrow
  // enough that the term column can never crowd the description beside it.
  const DEF_TERM_MAX = 34;

  function markDefinitionLists(doc) {
    const qualified = [];
    for (const list of doc.querySelectorAll("ul:not(.task-list)")) {
      // A list inside a labeled line is that line's sub-list, not a specification
      // of its own: three examples under `In security context:` are three bullets
      // under a sentence, and setting them as rows put them one column further in
      // and gave three short terms the width of a document-wide term column. The
      // outer list has already been restructured by the time this one is reached,
      // so the test is against the wrapper, not against the source.
      if (list.closest(".def-desc")) continue;
      const items = Array.from(list.children).filter((el) => el.tagName === "LI");
      if (items.length < 2) continue;
      // every item, or none: one ordinary bullet in the middle would break the
      // alignment that makes the whole thing worth doing
      const usable = items.every((li) => {
        const term = li.firstElementChild;
        if (!term || term.tagName !== "STRONG" || term.children.length) return false;
        if (!/[:\uFF1A]\s*$/.test(term.textContent || "")) return false;
        if ((term.textContent || "").trim().length > DEF_TERM_MAX) return false;
        // A nested list is fine: it ends up inside the description cell, which is
        // where an example belongs. A paragraph, fence, quote or table is not —
        // an item like that is not a labeled line, and its own block would have
        // to be re-flowed under a term it no longer sits beside.
        return !li.querySelector("pre, blockquote, table, p, dl");
      });
      if (!usable) continue;

      for (const li of items) {
        const term = li.firstElementChild;
        const termBox = document.createElement("span");
        termBox.className = "def-term";
        const descBox = document.createElement("span");
        descBox.className = "def-desc";
        li.insertBefore(termBox, term);
        termBox.appendChild(term);
        while (termBox.nextSibling) descBox.appendChild(termBox.nextSibling);
        // always two children: the desktop layout places them two-per-row, and a
        // missing cell would shift every row after it into the wrong column
        li.appendChild(descBox);
      }
      qualified.push(list);
    }
    if (!qualified.length) return;

    // One alignment for the whole file. `max-content` per list would size each
    // column to that list's longest term, so five lists would put their
    // descriptions at five different left edges; one shared width puts them all
    // in a single column. It has to be measured *before* the grid applies —
    // afterwards a term is a grid item as wide as its track, which is the very
    // thing being decided. Hence the wrapper is created and measured first, and
    // the `defs` class is added at the end.
    //
    // The retry is for the page being assembled at zero width (a viewer that
    // mounts late, a hidden tab): there every term measures about one character,
    // and a confident wrong number is worse than the `100%`/40% cap the
    // stylesheet falls back to.
    //
    // Recorded in `em` rather than pixels: the body font is fluid, so a column
    // frozen in px would be too narrow for its own terms in a wider window — and
    // a term that wraps breaks the alignment that justified the exercise.
    let tries = 0;
    const lockColumn = () => {
      let widest = 0;
      const sizes = [];
      if (doc.getBoundingClientRect().width >= 200) {
        for (const term of doc.querySelectorAll(".def-term")) {
          const size = parseFloat(getComputedStyle(term).fontSize) || 16;
          const w = term.getBoundingClientRect().width / size;
          sizes.push(w);
          widest = Math.max(widest, w);
        }
      }
      // The 10em cap exists for one stray sentence-label among many short terms.
      // When the widest term is in line with the rest (within 1.8x the median),
      // it is no outlier: let the column take it, up to 16em, rather than wrap
      // half the labels of a short list.
      sizes.sort((a, b) => a - b);
      const median = sizes[sizes.length >> 1] || 0;
      if (widest <= 16 && widest <= median * 1.8) doc.style.setProperty("--def-term-cap", "16em");
      if (widest < 0.5 && ++tries < 6) {
        requestAnimationFrame(lockColumn);
        return;
      }
      if (widest >= 0.5) doc.style.setProperty("--def-term-w", (widest + 0.04).toFixed(3) + "em");
      for (const list of qualified) list.classList.add("defs");
    };
    lockColumn();

    // `em` survives a window resize by design — the column is the same width in
    // the reader's units at any size — but not a change of face: the same term set
    // in a serif is a different number of `em`, and a term that no longer fits
    // wraps, which is the one thing this treatment exists to prevent. So the column
    // is re-locked when the reader changes the type or the width: the grid comes
    // off long enough for the terms to measure as the inline text they are, and
    // goes back on in the same frame — no paint happens in between, so nothing
    // flickers. It is registered rather than listening for a resize because that
    // would mean measuring every term on every pixel of a window drag.
    onRemeasure(() => {
      for (const list of qualified) list.classList.remove("defs");
      tries = 0;
      lockColumn();
    });
  }

  // A two-column table whose left column is nothing but short labels is a
  // specification sheet — `| Semester | VII |` — and what makes it read like one
  // is typographic, not structural: the labels step back, the figures line up in
  // a column, and the rows tighten to a reading rhythm. Nothing is moved or
  // rewritten here; the table still says exactly what the markdown says.
  //
  // 48 characters is roughly the longest a label can be and still be scanned as
  // a label rather than read as a sentence. It is a shape test, not a guess at
  // what the table is about, so a `Field | Value` sheet and a
  // `Dimension | Strategy` sheet both qualify and a two-column table of prose
  // does not.
  const KV_LABEL_MAX = 48;

  function markKeyValueTables(doc) {
    for (const wrap of doc.querySelectorAll(".tablewrap")) {
      const table = wrap.querySelector("table");
      if (!table) continue;
      const head = table.querySelector("thead tr");
      const rows = Array.from(table.querySelectorAll("tbody tr"));
      // three columns is a grid, and a sheet of one row is a sentence
      if (!head || head.children.length !== 2 || rows.length < 2) continue;
      const labels = rows.map((row) => row.children[0]);
      if (labels.some((cell) => !cell)) continue;
      const longest = Math.max(...labels.map((cell) => (cell.textContent || "").trim().length));
      if (longest > KV_LABEL_MAX) continue;
      // A label/value sheet, not a data grid: the first header should read as a
      // key and the second as its value/description. A two-column data table
      // (e.g. Name/Status, Command/What opens is a mapping, not a grid) only
      // qualifies when one side is genuinely a key or a description.
      const h0 = head.children[0].textContent.trim();
      const h1 = head.children[1].textContent.trim();
      const keyish = /property|field|key|term|setting|option|parameter|attribute|label|flag|switch/i.test(h0);
      const valueish = /value|description|meaning|result|purpose|what|open|definition/i.test(h1);
      if (!keyish && !valueish) continue;
      wrap.classList.add("kv");
      for (const row of rows) {
        const value = row.children[1];
        const text = value ? (value.textContent || "").trim() : "";
        // "VII" is not a figure and "48" is, so only an all-digit cell is set in
        // tabular numerals — roman numerals and prose stay exactly as typed
        if (value && text && /^[\d\s.,%:/+()-]+$/.test(text)) value.classList.add("num");
      }
    }
  }

  // A paragraph that is nothing but a bracketed note is the transcriber talking,
  // not the author — `[Illegible/corrupted character sequence omitted.]`. Set as
  // body text it reads as something the document claims; set quietly it reads as
  // a hole in the source, which is what it is.
  function markEditorialGaps(doc) {
    for (const para of doc.querySelectorAll("p")) {
      if (para.children.length) continue;
      const text = (para.textContent || "").trim();
      if (text.length < 3 || text.length > 240) continue;
      if (!/^\[[^\]]+\]$/.test(text)) continue;
      para.classList.add("gap");
    }
  }

  // A term and an illustration of it are two different things, and in one ink the
  // reader only finds that out by reading both. The writer has already drawn the
  // boundary — the word `Example:` — so the illustration steps back to the muted
  // ink the notes are set in and the definition keeps the ink it is being read
  // for. Two shapes qualify, and both are the writer's signpost doing the work:
  // a list item that *opens* with it, and a paragraph or table cell that *ends*
  // with one (`… system components. Examples: altering logs, patching binaries.`,
  // the shape a glossary writes its third column in). The signpost has to open
  // the item or begin a sentence — `See Examples: below.` is a cross-reference,
  // not an illustration — and the run after it has to be a single clause, because
  // an example that runs on into a second sentence is prose with an example in
  // it, which is a different thing again.
  const EG_OPEN = /^\s*(?:For\s+)?Examples?\s*:/i;
  const EG_TAIL = /(?:^|[.!?:;]\s)((?:For\s+)?Examples?)\s*:/i;
  const EG_TAIL_MAX = 200;

  function markExamples(doc) {
    for (const item of doc.querySelectorAll("li")) {
      const text = (item.textContent || "").replace(/\s+/g, " ").trim();
      if (EG_OPEN.test(text)) item.classList.add("eg");
    }

    for (const block of doc.querySelectorAll("p, td, dd")) {
      const nodes = [...block.childNodes];
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (node.nodeType !== Node.TEXT_NODE) continue;
        const hit = EG_TAIL.exec(node.nodeValue);
        if (!hit) continue;
        const at = hit.index + hit[0].indexOf(hit[1]);
        // the run has to be the tail of the block, and one sentence
        const tail = node.nodeValue.slice(at) +
          nodes.slice(i + 1).map((n) => n.textContent || "").join("");
        const run = tail.trim();
        if (run.length > EG_TAIL_MAX || /[.!?]\s/.test(run)) continue;
        // only the marker's own text node has to be split; whatever follows it
        // (a `<code>` run, a `<strong>`) is the rest of the sentence and moves
        // into the span with it rather than being left behind in the ink
        const span = document.createElement("span");
        span.className = "eg";
        const rest = node.splitText(at);
        node.parentNode.insertBefore(span, rest);
        const moving = [];
        for (let n = rest; n; n = n.nextSibling) moving.push(n);
        for (const n of moving) span.appendChild(n);
        break;
      }
    }
  }

  // `**Topics and subtopics:**` is a field label in a specification, not a
  // sentence. As a paragraph it carries the weight and the leading of body text
  // and pulls the eye off the list it introduces; as a label it names the block
  // and stays out of the way. Recognised by shape — a paragraph that is a single
  // bold run ending in a colon — and only set as one when it is short enough to
  // be a label rather than a sentence that happens to be bold.
  const LABEL_MAX = 42;

  function markLabelParagraphs(doc) {
    for (const para of doc.querySelectorAll("p")) {
      const only = para.children.length === 1 ? para.firstElementChild : null;
      if (!only || only.tagName !== "STRONG" || only.children.length) continue;
      // The paragraph has to be *nothing but* the label. `children` counts
      // elements, so `**Meaning:** a set of rules and conventions …` looked like
      // a single bold run and the whole sentence was uppercased and tracked —
      // the shape of a definition line, which is most of the prose in a
      // glossary, set as an eyebrow and made hard to read. A text node beside
      // the strong run means a sentence that opens with a bold phrase.
      if ([...para.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.nodeValue.trim() !== "")) continue;
      const text = (only.textContent || "").trim();
      if (text.length > LABEL_MAX || !/[:\uFF1A]$/.test(text)) continue;
      para.classList.add("label");
      // the small capitals already mark it as a label; the colon is left in the text (copy and
      // search see it) but not drawn
      const last = only.lastChild;
      if (last && last.nodeType === Node.TEXT_NODE && /[:\uFF1A]\s*$/.test(last.nodeValue)) {
        const m = /([:\uFF1A])(\s*)$/.exec(last.nodeValue);
        last.nodeValue = last.nodeValue.slice(0, m.index);
        const colon = document.createElement("span");
        colon.className = "label-colon";
        colon.textContent = m[1];
        only.appendChild(colon);
      }
    }
  }

  // A bibliography is a list whose items are entries rather than points: each one
  // runs to several lines, so the hanging indent is what lets the eye find where
  // the next entry begins. Recognised by shape — four or more items, each a
  // sentence ending in a period with its year in the back half — because that is
  // what a citation *is*; a list of points that happens to mention a date stays a
  // list of points.
  function markReferenceLists(doc) {
    for (const list of doc.querySelectorAll("ul")) {
      const items = Array.from(list.children).filter((el) => el.tagName === "LI");
      if (items.length < 4) continue;
      const citation = items.every((li) => {
        const text = (li.textContent || "").trim();
        const year = /\b(?:19|20)\d{2}\b/.exec(text);
        return text.length > 45 && text.split(/\s+/).length >= 6 && !!year &&
          year.index > text.length * 0.5 && /[.!?]$/.test(text) &&
          !li.querySelector("ul, ol, pre, blockquote, table, p, dl");
      });
      if (citation) list.classList.add("refs");
    }
  }

  // A table wider than its card hides its last columns behind a horizontal
  // scroll, and a reader whose scrollbars only appear while scrolling has no way
  // to know the table continues: it just looks like a table that stops
  // mid-column. Two moves, in this order.
  //
  // First, fit. `th` is set on one line because a one-line header scans better,
  // but a two-line header is a much smaller price than a hidden column, so a
  // table that does not fit is given permission to wrap — and keeps it only when
  // that actually bought width, which leaves a table whose width comes from its
  // body cells with its tidy headers. The label column of a spec sheet gets the
  // same permission for the same reason.
  //
  // Then, only if it is still too wide, say so: a soft shadow at each edge of
  // the card, pinned to the card rather than to the table so it reads as the
  // card's own depth, and a keyboard focus so the arrow keys scroll it the way
  // they scroll any region.
  function fitTables(doc) {
    const cards = Array.from(doc.querySelectorAll(".tablewrap"));
    if (!cards.length) return;

    const overflowing = (card) => card.scrollWidth - card.clientWidth > 1;
    // how much of the card the label column may take up and still be worth
    // pinning — past this it is a block of content, not a key to the rows
    const LABEL_SHARE = 0.42;

    function paint(card) {
      const max = card.scrollWidth - card.clientWidth;
      card.style.setProperty("--sx", card.scrollLeft + "px");
      card.classList.toggle("at-start", card.scrollLeft <= 1);
      card.classList.toggle("at-end", card.scrollLeft >= max - 1);
    }

    function measure(card) {
      // The room a card has is the only input to this (there is no text-size
      // control), so a card whose width has not changed cannot change its
      // answer — and re-deciding means forcing a layout per card, which is not
      // something to do on every resize event. Height counts as room too now
      // that a card's height decides whether its head is worth pinning: a
      // window dragged taller is the same question asked again.
      const room = card.clientWidth + "x" + window.innerHeight;
      if (card.mdviewRoom === room) return;
      card.mdviewRoom = room;

      // The shadows are absolutely positioned inside the card, so a stale offset
      // would leave one of them hanging past the content and make the card wider
      // than it is — the measurement below has to happen with them gone. They are
      // put back, at a real offset, before anything is painted.
      card.classList.remove("scroll-x", "at-start", "at-end", "sticky-col", "tall");
      card.style.setProperty("--sx", "0px");

      card.classList.remove("autofit");
      const plain = card.scrollWidth;
      if (overflowing(card)) {
        card.classList.add("autofit");
        if (card.scrollWidth >= plain) card.classList.remove("autofit");
      }
      if (!overflowing(card)) {
        // A table that fits across can still be taller than the window, and the
        // head is the one part of a table that can be looked up — so a table
        // with an end you cannot see keeps its head in view, pinned to the
        // window rather than to the card (see the stylesheet). The class also
        // makes the page the card's scrollport, which is what a sticky head
        // travels with; safe to say here and only here, because the table fits.
        // 64px is the app bar and its air — the token behind it is a `calc` of
        // two clamps and cannot be read back as a number.
        const table = card.querySelector("table");
        card.classList.toggle(
          "tall",
          !!table && table.getBoundingClientRect().height > window.innerHeight - 64
        );
        card.removeAttribute("tabindex");
        card.removeAttribute("role");
        card.removeAttribute("aria-label");
        return;
      }
      card.classList.add("scroll-x");
      // A wide table is read by its first column: that is what says which row you
      // are in while the rest of it slides past, so the label column stays put.
      // Not when it is itself most of what you can see, though — sticking that
      // would leave nothing to scroll and cover what there is.
      const label = card.querySelector("tbody td:first-child, thead th:first-child");
      const labelW = label ? label.getBoundingClientRect().width : 0;
      card.classList.toggle("sticky-col", labelW > 0 && labelW < card.clientWidth * LABEL_SHARE);
      // a region you can scroll is a region you can reach: name it, so the focus
      // ring lands on something that is announced as something
      card.tabIndex = 0;
      card.setAttribute("role", "group");
      card.setAttribute("aria-label", "Scrollable table");
      paint(card);
    }

    for (const card of cards) {
      card.addEventListener("scroll", () => paint(card), { passive: true });
      measure(card);
    }

    // Same leading-edge timer the outline and the progress line use: cheap, and
    // unlike a frame callback it still runs in a background tab.
    let last = 0;
    let trailing = 0;
    function remeasure() {
      const now = Date.now();
      if (now - last >= 120) {
        last = now;
        for (const card of cards) measure(card);
        return;
      }
      clearTimeout(trailing);
      trailing = setTimeout(() => {
        last = Date.now();
        for (const card of cards) measure(card);
      }, 130);
    }
    window.addEventListener("resize", remeasure, { passive: true });
    // late fonts and images move columns without a resize
    window.addEventListener("load", remeasure, { once: true });
    // the first frame after mount, in case the tree had no layout yet when the
    // pass above ran
    requestAnimationFrame(remeasure);
  }

  // Pictures that stand alone in a paragraph, or run together in one, become figures:
  // a run is a grid, and each picture is captioned with its alt text (the converter
  // writes "heading · p. N"). A picture with no alt text gets no caption rather than
  // a filename. The numbers come from CSS, so a figure without a caption is not counted.
  function markFigures(doc) {
    for (const p of doc.querySelectorAll("p")) {
      if (!p.querySelector(":scope > img")) continue;
      // A picture inside a sentence is lifted out of it: the text on either side stays
      // a paragraph, and the picture becomes a block, so no word is left on its line.
      const out = [];
      let run = null; // the figure grid the pictures are being added to, if any
      let text = []; // the text nodes waiting for their paragraph
      const flushText = () => {
        if (text.some((n) => n.nodeType !== 3 || n.textContent.trim())) {
          const q = document.createElement("p");
          q.append(...text);
          out.push(q);
        }
        text = [];
      };
      for (const n of [...p.childNodes]) {
        if (n.nodeName === "IMG") {
          flushText();
          if (!run) {
            run = document.createElement("div");
            run.className = "figures";
            out.push(run);
          }
          run.appendChild(figureFor(doc, n));
        } else if (n.nodeName === "BR" || (n.nodeType === 3 && !n.textContent.trim())) {
          continue;
        } else {
          run = null;
          text.push(n);
        }
      }
      flushText();
      for (const b of out) if (b.classList.contains("figures") && b.children.length === 1) b.classList.add("single");
      p.replaceWith(...out);
    }
  }

  function figureFor(doc, img) {
    const fig = document.createElement("figure");
    fig.className = "pic";
    fig.appendChild(img);
    const alt = (img.getAttribute("alt") || "").trim();
    // an alt text that only names the picture's kind (or its page) says nothing a reader can use
    if (alt && !/^(Picture from page \d+|Slide \d+ picture|Picture|Image|p\. \d+)$/i.test(alt)) {
      const cap = document.createElement("figcaption");
      cap.textContent = alt;
      fig.appendChild(cap);
    }
    return fig;
  }

  // Click to enlarge. Only offered where enlarging actually reveals something: a
  // raster image that is being downscaled, or anything vector — an SVG file, or a
  // diagram — which stays sharp at any size, or any picture in a figure, since a
  // figure is a picture the reader is meant to look at. Called twice: once after
  // mount, and again when mermaid has finished, since the diagrams do not exist
  // until then.
  function addZoom(doc) {
    const targets = [];
    for (const img of doc.querySelectorAll("img")) {
      if (img.classList.contains("zoomable")) continue;
      const shown = img.getBoundingClientRect().width;
      const vector = /\.svg(?:[?#]|$)/i.test(img.currentSrc || img.src || "");
      // a picture written as HTML (`<div><img></div>`, as the converter writes it) is not a
      // markdown figure, and it has usually not loaded yet, so its size is not known: a picture
      // that stands alone in its block is a picture to look at, like one in a figure
      const holder = img.parentElement;
      const alone = !!holder && holder !== doc && holder.childElementCount === 1 && !holder.textContent.trim() && !img.closest("a");
      const figure = !!img.closest("figure.pic") || alone;
      if (vector || figure || (img.naturalWidth && shown && img.naturalWidth > shown + 8)) {
        targets.push({ target: img, content: img });
      }
    }
    // Listen on the block, not the <svg>: a click inside a diagram lands on some
    // inner <g>/<text> whose own hit area is easy to miss, and the block around it
    // is the thing the reader is actually pointing at.
    for (const pre of doc.querySelectorAll("pre.mermaid")) {
      const svg = pre.querySelector("svg");
      if (svg && !pre.classList.contains("zoomable")) targets.push({ target: pre, content: svg });
    }
    if (!targets.length) return;

    // The pictures in reading order, so the enlarged view can step through them.
    // Diagrams are not in it: each one is looked at on its own.
    const pictures = targets.filter((t) => t.content.tagName === "IMG").map((t) => t.content);
    let overlay = null;
    let openedAt = 0;
    let shownAt = -1;

    function close(impatient) {
      if (!overlay) return;
      // A double-click would otherwise open and immediately close this, since the
      // second click lands on the overlay that the first one just put there.
      // Escape is always honoured.
      if (impatient && Date.now() - openedAt < 300) return;
      // the focus goes back to whatever opened the overlay, which is the image or
      // the diagram under it — a reader who opened a picture to look at it should
      // end up back on the picture, not at the top of the tab order
      const back = overlay.__mdviewFrom || null;
      overlay.remove();
      overlay = null;
      shownAt = -1;
      document.removeEventListener("keydown", onKey);
      if (back && back.isConnected) {
        try {
          back.focus({ preventScroll: true });
        } catch (e) {
          /* the thing that opened it may not be focusable; nothing to restore */
        }
      }
    }

    function onKey(e) {
      if (e.key === "Escape") close(false);
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
    }

    // Moves the enlarged view to the picture before or after this one, wrapping at
    // either end, and updates the "3 / 12" count beside the controls.
    function step(by) {
      if (!overlay || shownAt === -1 || pictures.length < 2) return;
      shownAt = (shownAt + by + pictures.length) % pictures.length;
      overlay.querySelector(".mdview-zoom-inner").replaceChildren(pictures[shownAt].cloneNode(true));
      overlay.querySelector(".mdview-zoom-count").textContent = shownAt + 1 + " / " + pictures.length;
    }

    function open(content, from) {
      overlay = document.createElement("div");
      overlay.__mdviewFrom = from || null;
      overlay.className = "mdview-zoom";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-label", "Enlarged view — click or press Escape to close");
      const box = document.createElement("div");
      box.className = "mdview-zoom-inner";
      box.appendChild(content.cloneNode(true));
      overlay.appendChild(box);
      shownAt = pictures.indexOf(content);
      if (shownAt !== -1 && pictures.length > 1) {
        const bar = document.createElement("div");
        bar.className = "mdview-zoom-step";
        const prev = button("mdview-zoom-prev", "‹", "Previous picture");
        const next = button("mdview-zoom-next", "›", "Next picture");
        const count = document.createElement("span");
        count.className = "mdview-zoom-count";
        count.textContent = shownAt + 1 + " / " + pictures.length;
        prev.addEventListener("click", (e) => {
          e.stopPropagation();
          step(-1);
        });
        next.addEventListener("click", (e) => {
          e.stopPropagation();
          step(1);
        });
        // a click between the buttons is not a click on the backdrop either
        bar.addEventListener("click", (e) => e.stopPropagation());
        bar.append(prev, count, next);
        overlay.appendChild(bar);
      }
      /* Clicking the backdrop closes, but a reader who has opened an image to
         read it should not have to aim at the backdrop to leave it — and on a
         touch screen there is no backdrop to aim at. The enlarged thing fills
         the window, so the way out has to be on top of it, not behind it. */
      const dismiss = button("mdview-zoom-x", "×", "Close");
      dismiss.setAttribute("aria-label", "Close the enlarged view");
      // It closes even inside the 300ms the double-click guard holds the
      // backdrop for. That guard exists so the second click of the pair that
      // opened the overlay does not close it again; a press on a button that
      // says "Close" is not that second click, and honouring it is the whole
      // reason the button is there.
      dismiss.addEventListener("click", (e) => {
        e.stopPropagation();
        close(false);
      });
      overlay.appendChild(dismiss);
      overlay.addEventListener("click", () => close(true));
      document.body.appendChild(overlay);
      document.addEventListener("keydown", onKey);
      // focus it so Escape and Tab belong to the thing that is open, and so a
      // keyboard reader is told it opened
      try {
        overlay.tabIndex = -1;
        overlay.focus({ preventScroll: true });
      } catch (e) {
        /* an overlay that will not take focus is still dismissible by click */
      }
      openedAt = Date.now();
    }

    for (const { target, content } of targets) {
      target.classList.add("zoomable");
      target.title = "Click to enlarge";
      // focusable, so the overlay can hand focus back to it and so a keyboard
      // reader can open it without a pointer at all
      if (!target.hasAttribute("tabindex")) target.tabIndex = 0;
      target.addEventListener("click", () => open(content, target));
      target.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        open(content, target);
      });
    }
  }

  // The cheapest way to get a reader back into a long file is not to make them
  // find their place again. One click, in the corner the reading eye is not using
  // (the back-to-top button owns the other), and only when there is a place to go
  // back to: past the first screen, not already finished, and not already under
  // the reader's feet — it takes itself away the moment they arrive.
  function addResume() {
    const pill = document.createElement("div");
    pill.className = "mdview-resume";

    const go = button("mdview-resume-go", "", "");
    const arrow = document.createElement("span");
    arrow.className = "mdview-resume-arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "→";
    const dismiss = button("mdview-resume-x", "×", "Not now — this page will stop asking");
    dismiss.setAttribute("aria-label", "Dismiss");

    pill.appendChild(go);
    pill.appendChild(dismiss);
    document.body.appendChild(pill);

    let gone = false;
    let target = 0;

    go.addEventListener("click", () => {
      gone = true;
      pill.classList.remove("show");
      try {
        window.scrollTo({ top: target, behavior: prefersCalm() ? "auto" : "smooth" });
      } catch (e) {
        document.documentElement.scrollTop = target;
      }
    });
    dismiss.addEventListener("click", () => {
      gone = true;
      pill.classList.remove("show");
    });

    function offer() {
      if (gone || !READ || READ.done) {
        pill.classList.remove("show");
        return;
      }
      const max = document.documentElement.scrollHeight - window.innerHeight;
      target = Math.max(0, Math.min(max, READ.y));
      if (max <= 0 || READ.pct < 8 || READ.pct > 97 || target < window.innerHeight * 0.6) {
        pill.classList.remove("show");
        return;
      }
      // nothing to offer someone who is already standing there
      if (Math.abs(window.scrollY - target) < 320) {
        pill.classList.remove("show");
        return;
      }
      const left = Math.max(1, Math.round((READ_MINUTES * (100 - READ.pct)) / 100));
      const text = "Continue at " + Math.round(READ.pct) + "% · " + left + " min left";
      go.textContent = text;
      go.appendChild(arrow);
      go.setAttribute("aria-label", text + " — go back to where this file was left off");
      pill.classList.add("show");
    }

    onRead(offer);
    onReadTick(offer);
  }

  // Where the document ends. A page that simply stops leaves the reader reading
  // the scrollbar to find out whether they are done, and a file that trails off
  // never feels finished — which is what makes a session feel abandoned rather
  // than done. The tick is drawn by the reader's own record, so it is earned and
  // it arrives in the one place they are guaranteed to be looking.
  function addEndPlate(doc) {
    const facts = readingStats(doc);

    const plate = document.createElement("div");
    plate.className = "endplate";

    const mark = document.createElement("span");
    mark.className = "endplate-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = "✓";

    const note = document.createElement("p");
    note.className = "endplate-note";
    note.textContent = "End of document";

    const line = document.createElement("p");
    line.className = "endplate-stats";

    const again = button(
      "endplate-again",
      "Start over",
      "Clear this document's place and go back to the top"
    );
    again.addEventListener("click", () => {
      if (READ) {
        READ.pct = 0;
        READ.done = false;
        saveRead();
        paintRead();
      }
      // The fold record too, when this file is being studied. "Read again" is
      // the only button in the document that means "start this over", and it
      // used to clear the reading place while leaving the study record intact —
      // so a finished set of questions could only be reset by toggling out of
      // study mode and back, which is not a thing anybody would think to do.
      if (FOLD && (FOLD.s || Object.keys(FOLD.o).length || Object.keys(FOLD.f).length)) {
        FOLD.o = {};
        FOLD.f = {};
        saveFold();
        // and show it: the sections close in front of the reader, rather than
        // waiting for the next reload to agree with the label
        if (FOLD_PAINT) FOLD_PAINT();
      }
      try {
        window.scrollTo({ top: 0, behavior: prefersCalm() ? "auto" : "smooth" });
      } catch (e) {
        document.documentElement.scrollTop = 0;
      }
    });

    // Its wording depends on which mode the file is in, and the fold record
    // arrives asynchronously — so it asks, rather than guessing at build time.
    FOLD_LISTENERS.push(() => {
      const studying = !!(FOLD && FOLD.s);
      again.textContent = "Start over";
      again.title = studying
        ? "Close every section again and go back to the top"
        : "Clear this document's place and go back to the top";
      again.setAttribute("aria-label", again.title);
    });

    plate.appendChild(mark);
    plate.appendChild(note);
    plate.appendChild(line);
    plate.appendChild(again);
    doc.appendChild(plate);

    onPosition((rec) => {
      plate.classList.toggle("is-done", !!(rec && rec.done));
      const bits = [];
      if (READ_HEADS.length) {
        bits.push(readCount() + " of " + READ_HEADS.length + " sections read");
      }
      for (const b of facts) bits.push(b);
      line.textContent = bits.join(" · ");
    });
  }

  // The margin outline is hidden below 1280px, which left narrow windows with no
  // way to navigate a long document at all. Same headings, as a disclosure.
  function addContents(doc, anchorAfter) {
    const heads = doc.querySelectorAll("h2[id], h3[id], h4[id]");
    if (heads.length < 3) return;

    const box = document.createElement("details");
    box.className = "contents";
    const summary = document.createElement("summary");
    summary.textContent = "Contents";
    box.appendChild(summary);

    const list = document.createElement("ul");
    for (const head of heads) {
      const item = document.createElement("li");
      item.className = outlineClass(head, heads);
      item.dataset.head = head.id;
      item.appendChild(outlineLink(head));
      list.appendChild(item);
    }
    box.appendChild(list);
    trackReadMarks(box);
    onPosition(() => {
      summary.textContent = READ_HEADS.length
        ? "Contents · " + readCount() + "/" + READ_HEADS.length
        : "Contents";
    });

    if (anchorAfter && anchorAfter.nextSibling) doc.insertBefore(box, anchorAfter.nextSibling);
    else doc.insertBefore(box, doc.firstChild);
  }

  /* ------------------------------------------------------ folds and study -- */

  // Two features that are one mechanism. Folding is the reading convenience — a
  // long document read as a stack of parts. Study is the same mechanism used as
  // retrieval practice: the heading is the question, the section is the answer,
  // and the file opens as a list of questions. Nothing here is a fact about the
  // markdown: the headings are the renderer's, the range is found by walking
  // siblings, and the state is per URL in the reader's own storage. What is
  // stored is deliberately small — `f` is the set of folded sections, `o` the
  // set already opened while studying, `s` which mode the file is in — so a file
  // half-read in one mode is not half-read in the other.
  const FOLD_PREFIX = "mdview:fold:";

  let FOLD = null; // this document's fold record, or null until it loads
  let foldSave = 0;

  /* Things outside `addFolds` whose wording depends on the fold state. Called
     from its `paint()`, so they see the mirror first and the store's answer
     when it lands. */
  const FOLD_LISTENERS = [];

  /* `addFolds`' own paint, reachable from outside. Clearing the record is not
     the same as showing the cleared record: without this, "Study again" emptied
     the stored opens and left the four sections on screen still open, with a
     label that still said 4/18 — correct on the next reload and wrong right
     now. */
  let FOLD_PAINT = null;

  function foldKey() { return FOLD_PREFIX + docKey(); }

  function freshFold() { return { s: 0, o: {}, f: {} }; }

  function normalizeFold(v) {
    const rec = freshFold();
    if (v && typeof v === "object") {
      rec.s = v.s ? 1 : 0;
      if (v.o && typeof v.o === "object") rec.o = v.o;
      if (v.f && typeof v.f === "object") rec.f = v.f;
    }
    return rec;
  }

  function saveFold() {
    clearTimeout(foldSave);
    foldSave = setTimeout(() => {
      if (!FOLD) return;
      const key = foldKey();
      storeSet(key, FOLD);
      // mirrored so the next load can fold before the async store answers
      try {
        localStorage.setItem(key, JSON.stringify(FOLD));
      } catch (e) { /* the extension's own storage is the real one */ }
    }, 150);
  }

  function foldMirror() {
    try {
      const raw = localStorage.getItem(foldKey());
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  // A heading with nothing between it and the next heading is not a section, it
  // is a label — and the page was drawing it as a ruled, double-spaced section
  // that closes nothing. Measured on `0 A Clase…_hybrid.md`, whose PDF extract
  // is thirty-one `## Page N` labels: 55.4px per label (32.4px of heading, a 23px
  // gap, a hairline) for a page full of air. A bare heading loses the air; a
  // heading whose next heading is a sibling or a parent loses the closing rule
  // as well, because a rule is what a section gets for closing. A heading whose
  // child headings follow it keeps its rule — that one really is a section.
  function markBareHeadings(doc) {
    let heads;
    try {
      heads = [...doc.children].filter(
        (el) => /^H[2-6]$/.test(el.tagName) && el.id
      );
    } catch (e) {
      return;
    }
    for (const head of heads) {
      const level = +head.tagName[1];
      let content = false;
      let next = null; // the next heading's level; null when none follows
      for (let el = head.nextElementSibling; el; el = el.nextElementSibling) {
        if (el.classList.contains("endplate")) break;
        const m = /^H([1-6])$/.exec(el.tagName);
        if (m) {
          next = +m[1];
          break;
        }
        if (el.tagName === "HR") continue; // a rule is something, if not much
        content = true;
        break;
      }
      if (content) continue;
      head.classList.add("is-bare");
      if (next === null || next <= level) head.classList.add("is-marker");
    }
  }

  // The fold control. The caret sits after the heading's words, where an
  // accordion puts it, because both of the heading's margins are already taken:
  // an absolutely-positioned caret in the left one would land in the `#`
  // anchor's slot at every width above 1024px. Folded state is the one state it
  // has to show by itself — a reader who folded something three days ago and
  // wonders where the text went is looking at the caret.
  function addFolds(doc, mast) {
    let heads;
    try {
      heads = [...doc.children].filter(
        (el) => /^H[2-6]$/.test(el.tagName) && el.id
      );
    } catch (e) {
      return;
    }
    if (!heads.length) return;

    const ranges = new Map();
    for (const head of heads) {
      const level = +head.tagName[1];
      const range = [];
      for (let el = head.nextElementSibling; el; el = el.nextElementSibling) {
        if (el.classList.contains("endplate")) break;
        if (/^H[1-6]$/.test(el.tagName) && +el.tagName[1] <= level) break;
        range.push(el);
      }
      if (range.length) ranges.set(head.id, range);
    }
    if (!ranges.size) return;

    const buttons = new Map();
    for (const head of heads) {
      if (!ranges.has(head.id)) continue;
      const fold = button("fold", "▾", "Fold this section");
      fold.setAttribute("aria-expanded", "true");
      fold.setAttribute("aria-label", "Fold this section");
      fold.addEventListener("click", () => toggle(head.id));
      head.appendChild(fold);
      buttons.set(head.id, fold);
    }

    const studyBtn = mast && mast.querySelector(".mast-study");
    if (studyBtn) studyBtn.removeAttribute("hidden");

    function isFolded(id) {
      if (!FOLD) return false;
      return FOLD.s ? !FOLD.o[id] : !!FOLD.f[id];
    }

    function paint() {
      for (const [id, range] of ranges) {
        const folded = isFolded(id);
        for (const el of range) {
          if (folded) el.setAttribute("data-mdview-fold", "");
          else el.removeAttribute("data-mdview-fold");
        }
        const btn = buttons.get(id);
        if (btn) {
          btn.textContent = folded ? "▸" : "▾";
          btn.setAttribute("aria-expanded", folded ? "false" : "true");
          btn.title = folded ? "Open this section" : "Fold this section";
          btn.setAttribute("aria-label", btn.title);
        }
      }
      if (studyBtn) {
        const on = !!(FOLD && FOLD.s);
        /* In study mode the reader is working through a list of questions, and
           the one piece of chrome that is on screen the whole time said nothing
           about how far along they were — the only count was on the endplate,
           which on the fixture is 2,731px down a document that runs past 10,000.
           The control that *is* the mode carries it instead. No new chrome: the
           button is already there saying "Study", and this is the number that
           belongs to it. */
        let label = on ? "Mode: Study" : "Mode: Read";
        let title = on
          ? "Studying — sections stay folded until you open them; click to read normally"
          : "Reading — click to study this file by sections";
        if (on && READ_HEADS.length) {
          // `READ_HEADS` is a list of `{el, id, min}` records, not of ids — a Set of the
          // records themselves never matches a heading id, and the count sat at
          // zero while every section was demonstrably open.
          const known = new Set(READ_HEADS.map((h) => h.id));
          let done = 0;
          for (const id in FOLD.o) {
            if (known.has(id)) done++;
          }
          label = done >= READ_HEADS.length
            ? "Study · done"
            : "Study · " + done + "/" + READ_HEADS.length;
          title =
            done >= READ_HEADS.length
              ? "Every section opened — click to read normally"
              : "Studying — " + done + " of " + READ_HEADS.length +
                " sections opened; click to read normally";
        }
        studyBtn.textContent = label;
        studyBtn.title = title;
        studyBtn.setAttribute("aria-label", title);
      }
      // Anything else whose wording depends on the fold state — the endplate's
      // own reset — repaints with it, rather than guessing once at build time
      // and being wrong by the time the store answers.
      for (const fn of FOLD_LISTENERS) {
        try {
          fn();
        } catch (e) {
          /* a listener failing is not the fold state failing */
        }
      }
    }

    function toggle(id) {
      if (!FOLD) FOLD = freshFold();
      const set = FOLD.s ? FOLD.o : FOLD.f;
      if (set[id]) delete set[id];
      else set[id] = 1;
      paint();
      saveFold();
      // A table opened out of a folded section was measured while it was
      // hidden — a card with no width, so the fitting it needs is re-decided
      // from the room it has. The same for anything else that measured the
      // page: the fold changed the shape of the document, and the passes that
      // read the shape are told so.
      remeasure();
    }

    if (studyBtn) {
      studyBtn.addEventListener("click", () => {
        if (!FOLD) FOLD = freshFold();
        FOLD.s = FOLD.s ? 0 : 1;
        paint();
        saveFold();
        remeasure();
      });
    }

    // its own paint, reachable from the endplate's reset (see `FOLD_PAINT`)
    FOLD_PAINT = paint;

    // the mirror answers now, the store answers next, and the store wins
    FOLD = normalizeFold(foldMirror());
    paint();
    let loaded;
    try {
      loaded = storeGet(foldKey());
    } catch (e) {
      loaded = Promise.resolve(null);
    }
    loaded.then(
      (v) => {
        if (v && typeof v === "object") {
          FOLD = normalizeFold(v);
          paint();
        } else if (FOLD && (FOLD.s || Object.keys(FOLD.f).length || Object.keys(FOLD.o).length)) {
          saveFold(); // the mirror is the only copy of this file's state
        }
      },
      () => { /* the mirror is what we have */ }
    );
  }

  /* -------------------------------------------------------- define a word -- */

  // The lookup card lives in lookup.js, shared with Bookshelf, and is loaded before this
  // file. These two are what the rest of mdview calls.
  function addDefine(doc) {
    if (!window.MdviewLookup) return;
    window.MdviewLookup.attach(doc, { neighbours: true });
    onRemeasure(() => window.MdviewLookup.reposition());
  }

  function setDefineRoot(selector) {
    if (window.MdviewLookup) window.MdviewLookup.setRoot(selector);
  }

  // An open box you cannot tick. `- [ ]` rendered as a 13px square with a border,
  // an accent fill when set and a hover transition on its border — every signal
  // that it is a control, and `disabled` underneath all of it. In a note-keeping
  // reader an unchecked box is the one thing in the document that is genuinely
  // yours rather than the author's, and it was the one thing you could not touch.
  //
  // What is deliberately not done here: the file is never written. A `- [x]` in
  // the markdown is a fact about the document and stays exactly as it is; only
  // the open boxes answer, and the tick is the reader's own state, kept per URL
  // the way folds and reading position already are.
  const TICK_PREFIX = "mdview:ticks:";

  function tickKey() {
    return TICK_PREFIX + docKey();
  }

  function addTaskToggles(doc) {
    const items = doc.querySelectorAll("li.task-list-item");
    if (!items.length) return;
    const open = [];
    for (let i = 0; i < items.length; i++) {
      const box = items[i].querySelector('input[type="checkbox"]');
      if (!box || box.checked) continue;
      box.disabled = false;
      box.removeAttribute("disabled");
      box.title = "Tick this off — remembered for this file, never written to it";
      open.push({ i: i, box: box });
    }
    if (!open.length) return;

    const tickMirror = () => {
      try {
        return JSON.parse(localStorage.getItem(tickKey()) || "{}") || {};
      } catch (e) {
        return {};
      }
    };
    let saved = tickMirror();

    // The count in the header is a fact about the document, and a tick is now a
    // fact about the reader — so both places that quote the count are rewritten
    // when one changes, or the bar would disagree with the boxes two seconds
    // after the reader touched one.
    const recount = () => {
      for (const sel of [".mast-stats", ".endplate-stats"]) {
        const el = doc.querySelector(sel);
        if (!el) continue;
        const bits = readingStats(doc);
        if (bits.length) el.textContent = bits.join(" · ");
      }
    };

    for (const { i, box } of open) {
      box.checked = !!saved[i];
      box.addEventListener("change", () => {
        if (box.checked) saved[i] = 1;
        else delete saved[i];
        storeSet(tickKey(), saved);
        try {
          localStorage.setItem(tickKey(), JSON.stringify(saved));
        } catch (e) {
          /* opaque origin: the add-on's own storage is the real one */
        }
        recount();
      });
    }
    recount();

    // The mirror is read on the next load, from the extension's storage.
    storeGet(tickKey()).then((v) => {
      if (!v || typeof v !== "object") return;
      saved = v;
      for (const { i, box } of open) {
        const want = !!v[i];
        if (box.checked !== want) box.checked = want;
      }
      recount();
    });
  }

  // A table written as HTML in the file is not wrapped by the renderer, which only wraps the
  // ones it draws from markdown. It gets the same card, so a wide one scrolls inside its
  // column instead of widening the whole page.
  function wrapRawTables(doc) {
    for (const t of doc.querySelectorAll("table")) {
      if (t.closest(".tablewrap")) continue;
      const card = document.createElement("div");
      card.className = "tablewrap";
      t.parentNode.insertBefore(card, t);
      card.appendChild(t);
    }
  }

  function decorate(doc) {
    let file = location.pathname.split("/").pop() || "";
    try {
      file = decodeURIComponent(file);
    } catch (e) { /* malformed %: show the raw name */ }
    file = file.replace(/[#?].*$/, "");
    const mast = file ? masthead(file, doc) : null;
    if (mast) doc.insertBefore(mast, doc.firstChild);
    wrapRawTables(doc);
    addCallouts(doc);
    markDefinitionLists(doc);
    markKeyValueTables(doc);
    markEditorialGaps(doc);
    markExamples(doc);
    markLabelParagraphs(doc);
    markReferenceLists(doc);
    fitTables(doc);
    addCopyButtons(doc);
    addHeadingAnchors(doc);
    markBareHeadings(doc);
    markFigures(doc);
    addZoom(doc);
    addFolds(doc, mast);
    addContents(doc, mast);
    addEndPlate(doc);
    addTaskToggles(doc);
    addReadingProgress();
    addResume();
    addDefine(doc);
    addCheckpoints(doc);
  }

  /* ---------------------------------------------------------- checkpoints -- */

  // A checkpoint is a mark the reader sets on a line of text to say "I stopped here", the
  // way a debugger leaves a breakpoint. It is not a study tick: the ticks follow the scroll,
  // a checkpoint is only set or cleared by a click. A line depends on the width it is shown
  // at, so a checkpoint is kept as text, not as a place on the screen: it is found again by
  // its text and drawn on whichever line that text falls on now. Kept per URL, not in the file.
  const CHECK_PREFIX = "mdview:check:";
  const CHECK_SNIP = 32; // characters of text that name a checkpoint

  function checkKey() { return CHECK_PREFIX + docKey(); }

  // The text of one block, and the text nodes that make it up, each with its start.
  function textOf(block) {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let text = "";
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      nodes.push({ node: n, start: text.length });
      text += n.nodeValue;
    }
    return { text, nodes };
  }

  // The box of the character at `o` in its block, as it is drawn at the current width.
  function lineBoxAt(block, o) {
    const { text, nodes } = textOf(block);
    if (!text.length) return null;
    const at = Math.min(Math.max(o, 0), text.length - 1);
    const first = nodes.find((n) => at < n.start + n.node.nodeValue.length);
    if (!first) return null;
    const range = document.createRange();
    range.setStart(first.node, at - first.start);
    range.setEnd(first.node, Math.min(at - first.start + 1, first.node.nodeValue.length));
    const boxes = range.getClientRects();
    return boxes.length ? boxes[0] : null;
  }

  // Which character of the block is under the pointer, or null.
  function charAtPoint(block, x, y) {
    let node = null;
    let off = 0;
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      if (p) { node = p.offsetNode; off = p.offset; }
    } else if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      if (r) { node = r.startContainer; off = r.startOffset; }
    }
    if (!node || node.nodeType !== 3 || !block.contains(node)) return null;
    const hit = textOf(block).nodes.find((n) => n.node === node);
    return hit ? hit.start + Math.min(off, node.nodeValue.length) : null;
  }

  function addCheckpoints(doc) {
    const blocks = Array.from(doc.children);
    if (!blocks.length) return;
    let marks = []; // { i, o, t }: block, character, and the text that names it
    const drawn = []; // the line marks on screen, each tied to its checkpoint

    const bar = document.createElement("div");
    bar.className = "cp-bar";
    const label = document.createElement("span");
    const jump = document.createElement("button");
    jump.type = "button";
    jump.textContent = "Go to checkpoint";
    const clear = document.createElement("button");
    clear.type = "button";
    clear.textContent = "Clear";
    bar.append(label, jump, clear);

    const paint = () => {
      label.textContent = marks.length ? "Checkpoint set" : "No checkpoint";
      jump.disabled = marks.length === 0;
      clear.disabled = marks.length === 0;
    };
    const save = () => { storeSet(checkKey(), marks.map((m) => ({ i: m.i, o: m.o, t: m.t }))); };

    // The block a checkpoint is in, and where its text is now: its own place if the text is
    // still there, otherwise the first block that has the text.
    const locate = (m) => {
      const own = blocks[m.i];
      const candidates = own ? [own, ...blocks] : blocks;
      for (const b of candidates) {
        const text = textOf(b).text;
        if (text.slice(m.o, m.o + m.t.length) === m.t) return { block: b, o: m.o };
        const at = text.indexOf(m.t);
        if (at >= 0) return { block: b, o: at };
      }
      return null;
    };

    // Every checkpoint is drawn on the line its text is on at the current width.
    const draw = () => {
      for (const el of drawn) el.remove();
      drawn.length = 0;
      const top0 = doc.getBoundingClientRect().top;
      for (const m of marks) {
        const found = locate(m);
        const box = found && lineBoxAt(found.block, found.o);
        if (!box || !box.height) continue; // hidden (a folded section): nothing to show
        const el = document.createElement("div");
        el.className = "cp-line";
        el.style.top = box.top - top0 + "px";
        el.style.height = box.height + "px";
        el.checkpoint = m;
        doc.appendChild(el);
        drawn.push(el);
      }
    };

    // a click on the line of a checkpoint clears it; a click anywhere else in the text sets one
    doc.addEventListener("click", (e) => {
      if (e.target.closest("a, button, summary, input, textarea, select, label, .anchor, .cp-bar")) return;
      if (window.getSelection && !window.getSelection().isCollapsed) return; // the reader is selecting
      const existing = drawn.find((el) => {
        const r = el.getBoundingClientRect();
        return e.clientY >= r.top && e.clientY <= r.bottom;
      });
      if (existing) {
        marks = marks.filter((m) => m !== existing.checkpoint);
      } else {
        let block = e.target;
        while (block && block.parentElement !== doc) block = block.parentElement;
        if (!block) return;
        const o = charAtPoint(block, e.clientX, e.clientY);
        if (o === null) return;
        const i = blocks.indexOf(block);
        if (i < 0) return;
        const t = textOf(block).text.slice(o, o + CHECK_SNIP);
        if (!t.trim()) return;
        marks = [{ i, o, t }]; // one at a time: the newest replaces the one before
      }
      draw();
      paint();
      save();
    });

    jump.addEventListener("click", () => {
      const at = marks
        .map((m) => { const f = locate(m); return f && { f, box: lineBoxAt(f.block, f.o) }; })
        .filter((x) => x && x.box)
        .map((x) => ({ box: x.box, y: x.box.top + window.scrollY }))
        .sort((a, b) => a.y - b.y);
      if (!at.length) return;
      const target = at.find((t) => t.box.top > 8) || at[0];
      window.scrollTo({ top: target.y - 120, behavior: prefersCalm() ? "auto" : "smooth" });
    });
    clear.addEventListener("click", () => { marks = []; draw(); paint(); save(); });

    const mast = doc.querySelector(":scope > .mast");
    doc.insertBefore(bar, mast ? mast.nextSibling : doc.firstChild);
    paint();

    // the record comes back asynchronously; the lines are drawn once it does
    storeGet(checkKey()).then((saved) => {
      if (!Array.isArray(saved)) return;
      // one at a time: a record from before that held several keeps the newest only
      marks = saved
        .filter((m) => m && typeof m.i === "number" && typeof m.o === "number" && typeof m.t === "string" && m.t.trim())
        .slice(-1);
      draw();
      paint();
    });

    // the lines move with the text when the width changes, so they are drawn again then
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(draw).observe(doc);
    else window.addEventListener("resize", draw);
  }

  /* --------------------------------------------------------------- mount -- */

  const VERSION = (() => {
    try {
      return browser.runtime.getManifest().version;
    } catch (e) {
      return "dev";
    }
  })();

  // The source is whatever the browser's plain-text view put on the page. That
  // is a <pre> in Firefox; if a viewer ever drops it straight onto the body,
  // accept that too — but only when the body holds nothing but text, so an HTML
  // file opened from disk is never mistaken for markdown.
  function sourceText() {
    const body = document.body;
    if (!body) return null;
    const pre = body.querySelector("pre");
    if (pre) return pre.textContent || "";
    if (!body.children.length) return body.textContent || "";
    return null;
  }

  // What this page is. pdfview.html names itself; otherwise a .html file is a page
  // already and anything else this script runs on is markdown.
  function pageKind() {
    const named = document.documentElement.getAttribute("data-mdview-page");
    if (named) return named;
    return /\.html?$/i.test(location.pathname) ? "html" : "markdown";
  }

  // A local page's text goes to the background script, so the settings page's library can
  // open a copy of it later. Only local file pages send anything, and the background keeps
  // the copy only when the library holds that file.
  function keepCopy(kind, text) {
    if (location.protocol !== "file:" || typeof text !== "string") return;
    const api = typeof browser !== "undefined" ? browser : typeof chrome !== "undefined" ? chrome : null;
    if (!api || !api.runtime || typeof api.runtime.sendMessage !== "function") return;
    try {
      const sent = api.runtime.sendMessage({
        type: "mdview:keep",
        url: location.href.replace(/[#?].*$/, ""),
        kind,
        text,
      });
      if (sent && typeof sent.catch === "function") sent.catch(() => {});
    } catch (e) {
      /* no background to answer: nothing to keep */
    }
  }

  function bootstrap() {
    // Reloading or updating the add-on re-injects this script into pages that
    // are already rendered, where the first <pre> is a code block — rendering
    // it again would replace the document with the markup of that block.
    if (document.querySelector(".mdview")) return;

    // Not markdown: the page stays as it is and gets only the lookup. Its own
    // rendering (pdf.js for a PDF) is somebody else's job and runs independently.
    const kind = pageKind();
    if (kind !== "markdown") {
      setDefineRoot(kind === "pdf" ? ".textLayer" : "body");
      if (kind === "html") keepCopy("html", document.documentElement.outerHTML);
      addDefine(document.body);
      return;
    }

    // Before anything is painted, so an explicit light/dark choice never flashes
    // the other one on the way in. Cosmetic: failing here is not a reason to skip
    // rendering the document.
    try {
      applyTheme(storedTheme());
      applyWidth(storedWidth());
      applyFont(storedFont());
    } catch (e) { /* theming, width and type are optional */ }

    const src = sourceText();
    if (src === null) {
      // Silently doing nothing is the one failure mode this extension cannot
      // afford: the page looks exactly like mdview not being installed at all.
      console.warn(
        `[mdview ${VERSION}] loaded on ${location.href} but found no plain-text source to render`
      );
      return;
    }
    if (!src.trim()) return;
    keepCopy("md", src);

    // .doc wraps the markdown so it can be one grid item next to the outline;
    // the outline can only stick if it lives beside a full-height sibling.
    const wrap = document.createElement("div");
    wrap.className = "mdview";
    const doc = document.createElement("div");
    doc.className = "doc";
    const mathParts = [];

    try {
      doc.innerHTML = restoreMath(renderMarkdown(extractMath(src, mathParts)), mathParts);
    } catch (e) {
      // Leave the page as it is rather than half-rendered, and put the reason
      // where it can be found instead of losing it.
      console.error(`[mdview ${VERSION}] failed to render ${location.href}`, e);
      document.documentElement.setAttribute("data-mdview-error", String((e && e.message) || e));
      return;
    }

    markEchoHeading(doc);
    markBareUrls(doc);
    markTranscripts(doc);
    markDiagrams(doc);
    highlightCode(doc);
    wrap.appendChild(doc);
    // the sections and their lengths, before anything reads them: the outline
    // prints one, and the reader's own record counts them
    bindSections(doc);
    const outline = buildOutline(doc);
    if (outline) wrap.appendChild(outline);

    // The reader's own top bar (← Library) is not part of the note, so it is kept
    // when the note's page is cleared for the rendered one.
    const appBar = document.querySelector("body > nav.bar");
    document.body.textContent = "";
    if (appBar) document.body.appendChild(appBar);
    document.body.appendChild(wrap);
    document.documentElement.setAttribute("data-mdview", VERSION);

    // The reader's own record, loaded before the chrome that displays it is
    // built. It arrives asynchronously, so everything that shows it subscribes
    // and paints again when it lands.
    loadRead();

    try {
      decorate(doc);
    } catch (e) {
      // The chrome is a nicety; the document has to survive it going wrong.
      console.warn(`[mdview ${VERSION}] reader chrome failed`, e);
    }

    if (mathParts.length) renderMath(doc);

    // only once the tree is in the document: a detached element reports every
    // heading at top 0, which would mark the outline's last entry as current
    if (outline) trackOutline(outline, doc);

    const file = (location.pathname.split("/").pop() || "").replace(/[#?].*$/, "");
    // The tab strip is the reader's map of what is open, and
    // `deepseek_markdown_20260930_0f7a83.md` says nothing about what is behind it:
    // the document's own title is what someone looking for it would say out loud.
    // The file name is the fallback (and is on the page's own chip either way).
    const named = documentTitle(doc);
    try {
      document.title = named || decodeURIComponent(file) || document.title;
    } catch (e) { /* malformed %: the tab keeps whatever it already says */ }

    let diagrams = 0;
    if (wrap.querySelector("pre.mermaid")) {
      diagrams = wrap.querySelectorAll("pre.mermaid").length;
      // the source is kept so a theme change can draw the diagram again
      for (const pre of wrap.querySelectorAll("pre.mermaid")) pre.dataset.source = pre.textContent;
      loadMermaid()
        .then(() => {
          mermaid.initialize(mermaidTheme());
          // the <svg> only exists once this resolves, so zoom is wired up after it
          return mermaid.run({ nodes: wrap.querySelectorAll("pre.mermaid") });
        })
        .then(() => addZoom(doc))
        .catch((e) => console.warn(`[mdview ${VERSION}] a diagram failed to render`, e));
    }
    if (location.hash) {
      const target = land(location.hash.slice(1));
      if (target) target.scrollIntoView();
    }
    // every in-page jump, including the ones the outline and the citations make
    window.addEventListener("hashchange", () => land(location.hash.slice(1)));
    // A note's links are written relative to the file, and the <base> above
    // makes them resolve under /f/, which serves the raw bytes. Send any local
    // note/picture/pdf/html link back through the reader instead, so a .md
    // linked from a .md opens rendered rather than as plain text.
    const READABLE = /\.(md|markdown|mdown|mkd|html?|pdf|png|jpe?g|gif|webp|svg|txt|text|log|json|jsonl|ndjson|csv|tsv|js|mjs|cjs|jsx|ts|tsx|css|scss|less|xml|yml|yaml|toml|ini|cfg|conf|py|rb|sh|bash|zsh|pl|php|java|kt|go|rs|c|h|cc|cpp|hpp|cs|swift|lua|sql|diff|patch|ipynb)$/i;
    document.addEventListener("click", (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      if (!a) return;
      let url;
      try { url = new URL(a.href); } catch (err) { return; }
      const m = url.pathname.match(/^\/f\/(.+)$/);
      if (!m) return;
      if (!READABLE.test(m[1])) return;
      e.preventDefault();
      // In the reader's workspace this page is a frame, and the file it points at
      // belongs in the workspace's tab bar rather than in this frame: the workspace is
      // asked to open it. A page that is not in the reader's own window opens it here.
      if (window.self !== window.top) {
        try {
          window.top.postMessage({ type: "mdview:open", path: "/" + m[1] }, location.origin);
          return;
        } catch (err) { /* the window above is not ours: open it here */ }
      }
      location.href = "/view/" + m[1] + url.search + url.hash;
    });
    // A picture in a note is a figure the reader may want to look at closely, and the
    // reader has a view for that: the picture at its own pixels, moved with the hand.
    // So a click on a picture opens it there — in a tab of the window above when the
    // note is read in one, and in a tab of its own when it is not.
    document.addEventListener("click", (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const img = e.target && e.target.closest ? e.target.closest("img") : null;
      if (!img) return;
      let url;
      try {
        url = new URL(img.src); // the resolved address, with the page's own base
      } catch (err) {
        return;
      }
      const m = url.pathname.match(/^\/f\/(.+)$/);
      if (!m) return;
      e.preventDefault();
      const path = "/" + m[1];
      if (window.self !== window.top) {
        try {
          window.top.postMessage({ type: "mdview:open", path }, location.origin);
          return;
        } catch (err) {
          /* the window above is not ours: open the picture in a tab of its own */
        }
      }
      window.open("/?open=" + encodeURIComponent(path), "_blank");
    });
    // The reader sets a <base> so the note's pictures are found beside it, and a base makes a
    // `#section` link mean "that folder, at #section": every link into the page (the outline,
    // a footnote, a citation) would leave it. Links that point into the document are followed
    // here instead, by hand, with the address kept as it is.
    document.addEventListener("click", (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest && e.target.closest("a[href^='#']");
      if (!a) return;
      let id = a.getAttribute("href").slice(1);
      try { id = decodeURIComponent(id); } catch (err) { return; }
      const to = id ? document.getElementById(id) : document.documentElement;
      if (!to) return;
      e.preventDefault();
      try {
        history.pushState(null, "", location.pathname + location.search + (id ? "#" + encodeURIComponent(id) : ""));
      } catch (err) { /* an address that cannot be changed still scrolls */ }
      if (id) land(id);
      if (!id) window.scrollTo({ top: 0, behavior: prefersCalm() ? "auto" : "smooth" });
      else to.scrollIntoView({ behavior: prefersCalm() ? "auto" : "smooth", block: "start" });
    });

    console.info(
      `[mdview ${VERSION}] rendered ${location.href}: ` +
        `${doc.querySelectorAll("h1, h2, h3, h4, h5, h6").length} headings, ` +
        `${doc.querySelectorAll("table").length} tables, ${diagrams} diagrams` +
        (outline ? ", outline shown" : "") +
        `, title "${document.title}"`
    );
  }

  if (typeof document !== "undefined" && document.body) bootstrap();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { renderMarkdown: renderMarkdown, renderInline: renderInline };
  }
})();
