#!/usr/bin/env python3
"""mdview's local reader, for one person. Serves the folders listed in roots.json to
this machine's browser on 127.0.0.1 only.

The window is a workspace: the folders on the left, the open files along the top and the
document in the middle. Markdown, HTML, PDF, pictures and spreadsheets open here with
the engine they have; every other file opens as its own text, because the reader opens
any file it can and a file with no engine of its own is still a file to read. The
browser extension sends a local file to /?open=<path>, which opens it in a tab here.

The library at /library is the other half of the window: it adds, renames and deletes
notes and pictures, makes folders, and searches every note under the roots.

Run: python3 server.py        then open http://mdview.localhost:8765/
"""
import datetime
import html
import json
import os
import pathlib
import re
import secrets
import threading
import shutil
import sys
import time
import urllib.parse
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

HOST, PORT = "127.0.0.1", 8765
HERE = pathlib.Path(__file__).resolve().parent
# The engines — the renderer, the PDF view, the sheet view, the word card. They live
# beside the reader in this repository, and the environment says where they are when
# they do not.
ENGINE = pathlib.Path(os.environ.get("MDVIEW_ENGINE") or (HERE.parent / "extension"))
# The port, the folders and the scratch space can be moved with the environment, so that
# a second reader can be started on another port with another set of folders — which is
# what the interface tests drive.
PORT = int(os.environ.get("MDVIEW_PORT", PORT))
ROOTS_FILE = pathlib.Path(os.environ.get("MDVIEW_ROOTS", str(HERE / "roots.json")))
ROOTS = [pathlib.Path(p).expanduser().resolve() for p in json.loads(ROOTS_FILE.read_text())]
ENGINE_FILES = {"mdview.js", "mdview.css", "lookup.js", "lookup.css", "dictionaries.js", "mermaid.min.js", "pdf.mjs", "pdf.worker.mjs", "pdfview.js", "pdfview.css", "pdfjs-LICENSE", "sheet.js", "sheet.css"}
ENGINE_DIRS = {"cmaps", "standard_fonts", "wasm", "katex"}
MARKDOWN = {".md", ".markdown", ".mdown", ".mkd"}
HTML = {".html", ".htm"}
PDF = {".pdf"}
# A spreadsheet is not a note and not a picture: it is a grid. `.xlsx` is a zip of XML and
# `.csv` is a table already, and the reader draws both with the same engine, so the only
# thing that differs between the two sets is whether there is a zip to open.
SHEETS = {".xlsx", ".xlsm"}
SPREADS = {".csv", ".tsv"}
PICTURES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}
NOTES = MARKDOWN | HTML | PDF
# What the library shows, adds, renames and deletes. A spreadsheet is not a note — the
# note tools keep reading NOTES — but it is a file this reader opens, so it belongs in the
# same list, and a rename here is the same rename.
FILES = NOTES | PICTURES | SHEETS | SPREADS
# Every file type the library takes in, in the words its refusals use. One list, because
# the same sentence is said in five places and a type added to one of them is a type the
# others then refuse.
KINDS = "md, html, pdf, png, jpg, gif, webp, svg, xlsx, xlsm, csv, tsv"
MAX_UPLOAD = 300 * 1024 * 1024
# Files opened once, from the browser's file picker, are kept here for two hours. The
# folder is not one of the roots, so these never appear in the library.
TEMP = HERE / "temp"
TEMP_HOURS = 2
TEMP_ID = re.compile(r"^[A-Za-z0-9_-]{16,40}$")
# Writes come only from the reader's own pages: the origin must be one of these and the
# request must carry the token that the library page was given. A page on another site
# cannot read the token, and the browser will not send the origin for it.
TOKEN = secrets.token_urlsafe(24)
ORIGINS = {"http://mdview.localhost:8765", "http://127.0.0.1:8765", "http://localhost:8765"}
TYPES = {
    ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8", ".md": "text/plain; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json",
    ".bcmap": "application/octet-stream", ".pfb": "application/octet-stream", ".ttf": "font/ttf",
    ".wasm": "application/wasm", ".txt": "text/plain; charset=utf-8", ".woff2": "font/woff2",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12",
    ".csv": "text/csv; charset=utf-8", ".tsv": "text/tab-separated-values; charset=utf-8",
}
# The reader's own files: the workspace's window and the source view of a file with no
# engine of its own. They live here rather than in the engine's folder because they are
# the app's, not the renderer's.
HERE_FILES = {"shim.js", "workspace.css", "workspace.js", "text.css", "imageview.css", "imageview.js"}
# How much of a file is read to decide whether it is text, and how much of it is shown
# when it is. A file past the second number is a file the reader will not draw: the
# window it would need is not a window anyone reads in.
TEXT_HEAD = 65536
TEXT_LIMIT = 4 * 1024 * 1024

# One stylesheet for the app's own pages (library and the top bar above files). The
# reader's note styles come from mdview.css and are left to that file.
APP_CSS = """
:root { color-scheme: light dark; --bg:#f5f6f8; --card:#fff; --ink:#1b2027; --muted:#5a6472;
  --line:#e3e6ea; --accent:#0369a1; --soft:#eef5fa; --badge:#e0f2fe; --badge-ink:#075985; --bad:#b42318; }
@media (prefers-color-scheme: dark) { :root { --bg:#0f1216; --card:#171b21; --ink:#e4e8ee;
  --muted:#9aa5b4; --line:#262c35; --accent:#7cc4ee; --soft:#1a232e; --badge:#14324a; --badge-ink:#9ddcff; --bad:#ff8a80; } }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; }
a { color:inherit; text-decoration:none; }
.wrap { max-width:960px; margin:0 auto; padding:32px 20px 64px; }
header.top { display:flex; align-items:baseline; gap:14px; flex-wrap:wrap; margin-bottom:6px; }
header.top h1 { font-size:1.6rem; font-weight:650; margin:0; letter-spacing:-.01em; }
header.top .sub { color:var(--muted); }
.crumbs { color:var(--muted); font-size:.92rem; margin:10px 0 22px; }
.crumbs a { color:var(--accent); }
.crumbs a:hover { text-decoration:underline; }
h2 { font-size:.82rem; font-weight:650; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin:28px 0 12px; }
.tools { display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin:0 0 6px; }
.tools input[type=search] { flex:1 1 220px; min-width:0; font:inherit; color:var(--ink); background:var(--card);
  border:1px solid var(--line); border-radius:9px; padding:8px 12px; }
.tools select { font:inherit; color:var(--ink); background:var(--card); border:1px solid var(--line); border-radius:9px; padding:7px 10px; }
.chips { display:flex; gap:6px; flex-wrap:wrap; }
.chip, .btn, .act { font:inherit; font-size:.88rem; color:var(--ink); background:var(--card); border:1px solid var(--line);
  border-radius:9px; padding:6px 12px; cursor:pointer; }
.chip.on { background:var(--badge); border-color:var(--accent); color:var(--badge-ink); font-weight:600; }
.btn:hover, .chip:hover, .act:hover { border-color:var(--accent); }
.btn.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
.act { padding:3px 9px; font-size:.82rem; color:var(--muted); }
.act.del:hover { color:var(--bad); border-color:var(--bad); }
.actions { display:flex; gap:8px; margin:12px 0 4px; flex-wrap:wrap; }
#status { min-height:1.4em; color:var(--muted); font-size:.9rem; margin:6px 0 0; }
#status.bad { color:var(--bad); }
.cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(210px,1fr)); gap:12px; }
.card { display:block; background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px 18px; transition:border-color .15s, transform .15s; }
.card:hover { border-color:var(--accent); transform:translateY(-1px); }
.card .name { font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.card .meta { color:var(--muted); font-size:.85rem; margin-top:4px; }
.files { list-style:none; margin:0; padding:0; background:var(--card); border:1px solid var(--line); border-radius:12px; overflow:hidden; }
.files li { display:flex; align-items:center; gap:12px; padding:11px 16px; border-top:1px solid var(--line); }
.files li:first-child { border-top:0; }
.files li:hover { background:var(--soft); }
.files .name { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.files .name a:hover { color:var(--accent); }
.files .when { color:var(--muted); font-size:.85rem; flex:0 0 auto; }
.files .acts { display:flex; gap:6px; flex:0 0 auto; }
.badge { flex:0 0 auto; font-size:.7rem; font-weight:700; letter-spacing:.05em; text-transform:uppercase;
  color:var(--badge-ink); background:var(--badge); border-radius:6px; padding:3px 7px; min-width:48px; text-align:center; }
.empty { color:var(--muted); padding:18px 0; }
a:focus-visible, .card:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible {
  outline:2px solid var(--accent); outline-offset:2px; border-radius:6px; }
.panel { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:6px 16px; margin:10px 0 4px; }
.panel .row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:9px 0; border-top:1px solid var(--line); flex-wrap:wrap; }
.panel .row:first-child { border-top:0; }
.panel .note { color:var(--muted); font-size:.85rem; padding:9px 0 4px; }
select { font:inherit; color:var(--ink); background:var(--card); border:1px solid var(--line); border-radius:9px; padding:6px 10px; max-width:100%; }
.bar { position:sticky; top:0; z-index:50; display:flex; align-items:center; gap:14px; height:44px; padding:0 16px;
  background:var(--card); border-bottom:1px solid var(--line); font:14px/1.4 system-ui,sans-serif; }
.bar > span { min-width:0; }
@media (prefers-reduced-motion: reduce) { .card { transition:none; } .card:hover { transform:none; } }
@media print { .bar, .tools, .actions, .acts, #status { display:none; } }
.bar a { color:var(--accent); font-weight:600; white-space:nowrap; }
.bar a:hover { text-decoration:underline; }
.bar .title { color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; }
"""

# The library's behaviour: filter, type chips, sort, add, new folder, rename, delete.
# Every change goes through /api/ with the token; the page reloads after a change so
# the listing is what is on disk.
LIBRARY_JS = """
(function () {
  const app = document.getElementById("app");
  const DIR = app.dataset.dir;
  const TOKEN = (document.querySelector('meta[name="mdview-token"]') || {}).content || "";
  const q = document.getElementById("q");
  const sortBy = document.getElementById("sort");
  const status = document.getElementById("status");
  const none = document.getElementById("none");
  let kind = "all";

  function say(message, bad) {
    status.textContent = message;
    status.className = bad ? "bad" : "";
  }

  async function api(path, payload, raw) {
    const init = { method: "POST", headers: { "X-Mdview-Token": TOKEN } };
    if (raw) init.body = raw;
    else if (payload) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(payload);
    }
    const res = await fetch(path, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong (" + res.status + ").");
    return data;
  }

  function rows() { return [...app.querySelectorAll("[data-name]")]; }

  function filter() {
    const text = q.value.trim().toLowerCase();
    let shown = 0;
    for (const el of rows()) {
      const folder = el.dataset.kind === "folder";
      const type = kind === "all" || (!folder && el.dataset.kind === kind);
      const ok = type && el.dataset.name.toLowerCase().includes(text);
      el.hidden = !ok;
      if (ok) shown++;
    }
    none.hidden = shown > 0 || rows().length === 0;
  }

  function sort() {
    const by = sortBy.value;
    for (const box of app.querySelectorAll(".cards, ul.files")) {
      const items = [...box.children].filter((el) => el.dataset.name !== undefined);
      items.sort((a, b) => {
        if (by === "name") return a.dataset.name.localeCompare(b.dataset.name, undefined, { numeric: true });
        if (by === "new") return b.dataset.mtime - a.dataset.mtime;
        return a.dataset.mtime - b.dataset.mtime;
      });
      for (const el of items) box.appendChild(el);
    }
  }

  q.addEventListener("input", filter);
  sortBy.addEventListener("change", sort);
  for (const chip of document.querySelectorAll(".chip")) {
    chip.addEventListener("click", () => {
      kind = chip.dataset.kind;
      for (const c of document.querySelectorAll(".chip")) c.classList.toggle("on", c === chip);
      filter();
    });
  }

  document.getElementById("up").addEventListener("change", async (e) => {
    const failed = [];
    const files = [...e.target.files];
    for (const file of files) {
      say("Adding " + file.name + "…");
      try {
        await api("/api/upload?dir=" + encodeURIComponent(DIR) + "&name=" + encodeURIComponent(file.name), null, file);
      } catch (err) {
        failed.push(file.name + ": " + err.message);
      }
    }
    if (failed.length) say(failed.join(" · "), true);
    else location.reload();
  });

  document.getElementById("mk").addEventListener("click", async () => {
    const name = prompt("Name of the new folder");
    if (!name) return;
    try {
      await api("/api/mkdir", { dir: DIR, name: name });
      location.reload();
    } catch (err) {
      say(err.message, true);
    }
  });

  app.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const row = btn.closest("[data-name]");
    try {
      if (btn.dataset.act === "delete") {
        if (!confirm("Delete \\"" + row.dataset.name + "\\"? It is removed from disk and cannot be undone.")) return;
        await api("/api/delete", { path: btn.dataset.path });
        row.remove();
        say("Deleted " + row.dataset.name + ".");
        filter();
      } else if (btn.dataset.act === "rename") {
        const name = prompt("New name", row.dataset.name);
        if (!name || name === row.dataset.name) return;
        await api("/api/rename", { path: btn.dataset.path, name: name });
        location.reload();
      }
    } catch (err) {
      say(err.message, true);
    }
  });

  filter();
})();
"""


SETTINGS_HTML = (
    "<button class=\"btn\" id=\"settings-btn\" type=\"button\" aria-expanded=\"false\" aria-controls=\"settings\">Settings</button>"
    "<section class=\"panel\" id=\"settings\" hidden aria-label=\"Settings\">"
    "<div class=\"row\"><span>Look up a word on double-click</span>"
    "<button class=\"chip\" id=\"define-toggle\" type=\"button\" aria-pressed=\"true\">On</button></div>"
    "<div class=\"row\"><span>Dictionary language</span>"
    "<select id=\"define-lang\" aria-label=\"Dictionary language\">"
    "<option value=\"auto\">Detect from the note</option><option value=\"en\">English</option>"
    "<option value=\"es\">Spanish</option></select></div>"
    "<div class=\"row\"><span>Speaking voice</span><select id=\"say-voice\" aria-label=\"Speaking voice\"></select></div>"
    "<div class=\"row\"><span>Speaking pace</span><select id=\"say-pace\" aria-label=\"Speaking pace\">"
    "<option value=\"\">Voice default</option><option value=\"0.7\">Slower</option><option value=\"1.3\">Faster</option>"
    "</select></div>"
    "<p class=\"note\">These settings are kept in this browser, for the reader's pages.</p>"
    "</section>"
)

SETTINGS_JS = """
(function () {
  const $ = (id) => document.getElementById(id);
  const read = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  };
  const write = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* not kept in a private window; the setting still applies to this page */ }
  };
  const btn = $("settings-btn");
  const panel = $("settings");
  if (!btn || !panel) return;
  btn.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    btn.setAttribute("aria-expanded", String(!panel.hidden));
  });

  const define = $("define-toggle");
  const paintDefine = () => {
    const on = read("mdview:define", "on") !== "off";
    define.textContent = on ? "On" : "Off";
    define.setAttribute("aria-pressed", String(on));
  };
  define.addEventListener("click", () => {
    write("mdview:define", read("mdview:define", "on") !== "off" ? "off" : "on");
    paintDefine();
  });
  paintDefine();

  const lang = $("define-lang");
  lang.value = read("mdview:lang", "auto");
  lang.addEventListener("change", () => write("mdview:lang", lang.value));

  const voice = $("say-voice");
  const pace = $("say-pace");
  const say = () => read("mdview:say", {}) || {};
  const keep = (o) => {
    const out = {};
    if (o.voice) out.voice = o.voice;
    if (o.rate) out.rate = o.rate;
    return out;
  };
  const fillVoices = () => {
    const list = (window.speechSynthesis ? speechSynthesis.getVoices() : []).filter((v) => v && v.name);
    voice.replaceChildren(new Option("Automatic", ""));
    for (const v of list) voice.append(new Option(v.name + " (" + v.lang + ")", v.name));
    voice.value = say().voice || "";
  };
  fillVoices();
  if (window.speechSynthesis) speechSynthesis.addEventListener("voiceschanged", fillVoices);
  voice.addEventListener("change", () => write("mdview:say", keep({ ...say(), voice: voice.value })));

  pace.value = String(say().rate || "");
  pace.addEventListener("change", () => write("mdview:say", keep({ ...say(), rate: pace.value ? Number(pace.value) : 0 })));
})();
"""

RECENT_JS = """
(function () {
  const $ = (id) => document.getElementById(id);
  const box = $("recent");
  if (!box) return;
  const esc = (t) => t.replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");
  let list = [];
  try { list = JSON.parse(localStorage.getItem("mdview:recent") || "[]"); } catch (e) { list = []; }
  if (!Array.isArray(list) || !list.length) return;
  $("recent-section").hidden = false;
  box.innerHTML = list.map((item) =>
    '<li><span class="name"><a href="' + esc(item.url) + '">' + esc(item.name) + '</a></span>' +
    '<span class="when">' + esc(item.folder) + '</span></li>'
  ).join("");
  // The reader keeps each file's place under its own address, so a recent note can say
  // how far it got. "Read to" is the furthest point reached, labelled as such. The key
  // is the address of the page the note is read on — the one the reader wrote it under.
  box.querySelectorAll("li").forEach((li, i) => {
    const item = list[i];
    let r = null;
    const key = "mdview:read:" + location.origin + (item.key || item.url);
    try { r = JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { r = null; }
    const note = !r ? "" : r.done ? "Finished" : r.pct >= 4 ? "Read to " + Math.round(r.pct) + "%" : "";
    const when = li.querySelector(".when");
    if (note) when.textContent = note + " · " + item.folder;
  });
  $("recent-clear").addEventListener("click", () => {
    try { localStorage.removeItem("mdview:recent"); } catch (e) { /* nothing kept, nothing to clear */ }
    $("recent-section").hidden = true;
  });
})();
"""


def recent_recorder(p):
    """Notes the file in the browser's recent list each time it opens. The link in the
    list opens the file in the workspace; the key is the address of the page the file is
    read on, which is where the reader keeps the place they had reached."""
    entry = json.dumps({"url": "/?open=" + urllib.parse.quote(str(p)), "name": p.name,
                        "folder": str(p.parent)}).replace("</", "<\\/")
    return (
        "<script>(function(){try{var k='mdview:recent',e=" + entry + ";"
        "e.key=location.pathname+location.search;"
        "var l=JSON.parse(localStorage.getItem(k)||'[]').filter(function(x){return x.key!==e.key;});"
        "l.unshift(e);localStorage.setItem(k,JSON.stringify(l.slice(0,15)));}catch(x){}})();</script>"
    )


def purge_temp():
    """Removes the opened-once copies that are older than TEMP_HOURS."""
    if not TEMP.is_dir():
        return
    cutoff = time.time() - TEMP_HOURS * 3600
    for d in TEMP.iterdir():
        if d.is_dir() and d.stat().st_mtime < cutoff:
            shutil.rmtree(d, ignore_errors=True)


def temp_file(file_id, name):
    """The path of an opened-once file, if the id and name are what the reader made."""
    if not TEMP_ID.match(file_id):
        raise ApiError("No such file.", 404)
    target = (TEMP / file_id / safe_name(name)).resolve()
    if TEMP.resolve() not in target.parents or not target.is_file():
        raise ApiError("No such file.", 404)
    return target


def do_temp_upload(name, data):
    """Keeps one file to read now, outside the library, and returns where it is shown.
    Any file can be read this way: the reader opens every kind it can, so the copy does
    not have to be one of the kinds the library keeps."""
    name = safe_name(name)
    TEMP.mkdir(exist_ok=True)
    purge_temp()
    file_id = secrets.token_urlsafe(18)
    folder = TEMP / file_id
    folder.mkdir()
    with open(folder / name, "xb") as f:
        f.write(data)
    return {"ok": True, "url": "/open-file/" + file_id + "/" + urllib.parse.quote(name)}


OPEN_HTML = (
    "<label class=\"btn\" title=\"Read a file now without adding it to the library\">Open a file without adding it"
    "<input id=\"open-file\" type=\"file\" hidden></label>"
)

OPEN_JS = """
(function () {
  const TOKEN = (document.querySelector('meta[name="mdview-token"]') || {}).content || "";
  const open = async (file) => {
    const res = await fetch("/api/temp?name=" + encodeURIComponent(file.name), {
      method: "POST",
      headers: { "X-Mdview-Token": TOKEN },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || "The file could not be opened.");
      return;
    }
    location.href = data.url;
  };
  const input = document.getElementById("open-file");
  if (input) input.addEventListener("change", () => input.files[0] && open(input.files[0]));
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    if (e.dataTransfer && e.dataTransfer.files[0]) open(e.dataTransfer.files[0]);
  });
})();
""" 


class ApiError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def allowed(path):
    """A real path inside one of the configured folders, and no link out of them."""
    p = pathlib.Path(path).resolve()
    return any(p == root or root in p.parents for root in ROOTS)


def page(title, body, head=""):
    return (
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
        f"<title>{html.escape(title)}</title>{head}</head><body>{body}</body></html>"
    )


def app_head():
    """The head every page shares: the app's styles, and the token this page's own scripts
    send back with anything they change. The token is here because it has to be on every page
    that can post, and this is the one place they all pass through. It used to be added by
    hand on the library's front page only, so the folder listing — the page with the "Open a
    file without adding it" button on it — handed the reader an empty token, and every file
    someone gave it came back as "That request didn't come from the reader's own pages."""
    return f"<meta name=\"mdview-token\" content=\"{TOKEN}\"><style>{APP_CSS}</style>"


def error_page(message):
    """A short page with a way back, for anything the reader cannot open."""
    body = (
        "<div class=\"wrap\"><header class=\"top\"><h1>mdview</h1></header>"
        f"<p class=\"empty\">{html.escape(message)}</p>"
        "<p><a href=\"/library\">← Back to the library</a></p></div>"
    )
    return page("mdview", body, app_head())


def kind_of(suffix):
    """What the reader makes of a file of this type. A type it has no engine for is text
    until the bytes say otherwise — see file_kind."""
    if suffix == ".pdf":
        return "pdf"
    if suffix in HTML:
        return "html"
    if suffix in MARKDOWN:
        return "md"
    if suffix in SHEETS or suffix in SPREADS:
        return "sheet"
    if suffix in PICTURES:
        return "img"
    return "text"


def kind_badge(suffix):
    label = {"pdf": "PDF", "html": "HTML", "md": "MD", "img": "IMG", "sheet": "SHEET", "text": "TXT"}[kind_of(suffix)]
    return f"<span class=\"badge\">{label}</span>"


def looks_text(path):
    """Whether a file's first bytes read as text: no NUL, and either valid UTF-8 or very
    nearly all printable. A file of a kind the reader has no engine for is shown as its
    own text when it is text, and offered as a download when it is not."""
    try:
        with open(path, "rb") as f:
            chunk = f.read(TEXT_HEAD)
    except OSError:
        return False
    if not chunk:
        return True
    if b"\x00" in chunk:
        return False
    try:
        chunk.decode("utf-8")
        return True
    except UnicodeDecodeError:
        pass
    printable = sum(1 for b in chunk if 32 <= b < 127 or b in (9, 10, 13) or b >= 128)
    return printable / len(chunk) > 0.9


def file_kind(path):
    """The kind of a file: by its name when the reader has an engine for it, and by its
    bytes when it does not. This is what a file is when it is opened — the tree only
    says what its name says, because a tree that read every file to find out would be
    slow on a folder with a thousand of them."""
    suffix = pathlib.Path(path).suffix.lower()
    kind = kind_of(suffix)
    if kind != "text":
        return kind
    return "text" if looks_text(path) else "binary"


def when(path):
    t = datetime.datetime.fromtimestamp(path.stat().st_mtime)
    return t.strftime("%d %b %Y")


def crumbs(cur):
    """The path from the root to the folder being shown, each part a link."""
    for root in ROOTS:
        if cur == root or root in cur.parents:
            parts = [("mdview", "/library")]
            acc = root
            parts.append((root.name, f"/library?dir={urllib.parse.quote(str(root))}"))
            for part in cur.relative_to(root).parts:
                acc = acc / part
                parts.append((part, f"/library?dir={urllib.parse.quote(str(acc))}"))
            links = [f"<a href=\"{href}\">{html.escape(label)}</a>" for label, href in parts]
            return "<div class=\"crumbs\">" + " / ".join(links) + "</div>"
    return ""


SKIP_DIRS = {"node_modules", "__pycache__", "venv", ".venv", "build", "dist", "target"}
# The filesystems that are not files: what is inside them changes under the reader's
# feet and there are thousands of them. The tree does not show them.
SKIP_TREES = {"/proc", "/sys", "/dev"}
INDEX = {"names": [], "ready": False, "built": None}
INDEX_LEVELS = 6        # folders below each root that the index reaches
INDEX_EVERY = 20        # seconds between background rebuilds (a full walk takes about half a second)
INDEX_STALE = 20
REFRESH = threading.Event()

def walk_notes(levels, stop=lambda: False):
    """Every note under the reader's roots, down `levels` folders. Hidden and build folders
    are skipped. `stop()` is asked between folders, so a caller can give the walk a budget;
    the second value says whether the walk finished."""
    found, seen = [], set()
    for root in ROOTS:
        if not root.is_dir():
            continue
        top = len(root.parts)
        for dirpath, dirnames, filenames in os.walk(root):
            if stop():
                return found, False
            depth = len(pathlib.Path(dirpath).parts) - top
            dirnames[:] = [] if depth >= levels else [d for d in dirnames if not d.startswith(".") and d not in SKIP_DIRS]
            for name in filenames:
                path = pathlib.Path(dirpath) / name
                if path.suffix.lower() in FILES and path not in seen:
                    seen.add(path)
                    found.append(path)
    return found, True

def build_index():
    """Keeps a list of the notes under the roots, rebuilt every few minutes in the background,
    so a search reads a list rather than walking the disk while the reader waits."""
    while True:
        names, _ = walk_notes(INDEX_LEVELS)
        INDEX.update(names=names, ready=True, built=time.time())
        REFRESH.wait(INDEX_EVERY)
        REFRESH.clear()

def search_files(q, limit=200, budget=5.0):
    """Notes whose name contains q, under the reader's roots. The folders are walked for each
    search, so a new file is found at once; if the walk runs out of time, the last complete
    index answers instead, and the result says which it was. Returns (paths, complete, when,
    source) where source is "walk", "index" or "partial"."""
    needle = q.lower()
    started = time.monotonic()
    walked, complete = walk_notes(INDEX_LEVELS, stop=lambda: time.monotonic() - started > budget)
    if complete:
        INDEX.update(names=walked, ready=True, built=time.time())
        hits = [p for p in walked if needle in p.name.lower()]
        return hits[:limit], True, INDEX["built"], "walk"
    if INDEX["ready"]:
        hits = [p for p in INDEX["names"] if needle in p.name.lower()]
        return hits[:limit], True, INDEX["built"], "index"
    hits = [p for p in walked if needle in p.name.lower()]
    return hits[:limit], False, None, "partial"

def search_page(q):
    """The notes whose name contains q, in any folder under the reader's roots."""
    found, complete, when, source = search_files(q)
    hits = sorted(set(found), key=lambda p: p.name.lower())
    rows = "".join(
        "<li><span class=\"name\"><a href=\"/?open=" + urllib.parse.quote(str(p)) + "\">" + html.escape(p.name) + "</a></span>"
        "<span class=\"when\">" + html.escape(str(p.parent)) + "</span></li>"
        for p in hits)
    note = (str(len(hits)) + (" note" if len(hits) == 1 else " notes")) if hits else "No notes with that name"
    stamp = time.strftime("%H:%M", time.localtime(when)) if when else ""
    if source == "walk":
        note += " · searched the folders just now, " + str(INDEX_LEVELS) + " folders down"
    elif source == "index":
        note += " · the folders took too long to search, so this is the index of " + stamp + ", " + str(INDEX_LEVELS) + " folders down"
    else:
        note += " · the folders took too long to search, and the index is not built yet; there may be more"
    body = ("<div class=\"wrap\"><header class=\"top\"><h1>Search</h1>"
            "<span class=\"sub\">" + html.escape(q) + " · " + note + "</span></header>"
            "<p><a href=\"/library\">← Back to the library</a></p>"
            "<ul class=\"files\">" + rows + "</ul></div>")
    return page("Search · mdview", body, app_head())

def tree_entries(folder):
    """The names inside a folder: the folders first, then the files, each with the kind
    the reader would make of it. The kind is decided by the name alone — whether the
    bytes are text is decided when the file is opened, which is the only time it
    matters, and a tree that read every file to find out would be slow on a folder with
    a thousand of them. A name that cannot be read — a broken link — is passed over
    rather than ending the listing."""
    out = []
    try:
        entries = sorted(folder.iterdir(), key=lambda e: e.name.lower())
    except OSError:
        return out
    for entry in entries:
        try:
            if str(entry) in SKIP_TREES:
                continue
            if entry.is_dir():
                out.append({"name": entry.name, "path": str(entry), "dir": True, "kind": "dir"})
            elif entry.is_file():
                info = entry.stat()
                out.append({"name": entry.name, "path": str(entry), "dir": False,
                            "kind": kind_of(entry.suffix.lower()),
                            "size": info.st_size, "mtime": int(info.st_mtime)})
        except OSError:
            continue
    return out


# The window's own marks. The workspace belongs to the reader, so it carries the
# reader's glyph for a note and says what the rest are in two or three strokes.
WS_SVG = {
    "folder": '<svg width="24" height="24" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.7 4.4A1.4 1.4 0 013 3h2.8l1.6 2H13a1.4 1.4 0 011.4 1.4v6.2A1.4 1.4 0 0113 14H3a1.4 1.4 0 01-1.3-1.6z" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>',
    "tree": '<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><path d="M5.6 3.6h7.9M5.6 8h7.9M5.6 12.4h7.9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="3.2" cy="3.6" r="1.4" fill="currentColor"/><circle cx="3.2" cy="8" r="1.4" fill="currentColor"/><circle cx="3.2" cy="12.4" r="1.4" fill="currentColor"/></svg>',
    "menu": '<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.4h10M3 8h10M3 11.6h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    "panel": '<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.6" y="2.6" width="12.8" height="10.8" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M6.2 2.6v10.8" stroke="currentColor" stroke-width="1.2"/></svg>',
    "plus": '<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.6v8.8M3.6 8h8.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    "search": '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.3" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.3 10.3L14 14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    "funnel": '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.4 3.2h11.2L9.3 8.4v4.2l-2.6 1.3V8.4z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
}


def workspace():
    """The reader's home: the folders on the left, the open files along the top and the
    document in the middle. It is the reader's own window, so it is drawn on the same
    desk the notes are read on — the choice of light, dark or warm is taken from the
    browser before the first paint."""
    body = (
        "<div class=\"ws\">"
        "<header class=\"ws-top\">"
        "<div class=\"ws-brand\"><span class=\"mark\">M↓</span>mdview</div>"
        "<div class=\"ws-tabs\" id=\"ws-tabs\" role=\"tablist\" aria-label=\"Open files\"></div>"
        f"<button class=\"ws-add\" id=\"ws-add\" type=\"button\" title=\"Open a file\" aria-label=\"Open a file\">{WS_SVG['plus']}</button>"
        "<div class=\"ws-actions\">"
        f"<button class=\"ws-btn\" id=\"ws-menu-btn\" type=\"button\" title=\"Menu\" aria-label=\"Menu\" aria-haspopup=\"true\" aria-expanded=\"false\">{WS_SVG['menu']}</button>"
        f"<button class=\"ws-btn\" id=\"ws-side-toggle\" type=\"button\" title=\"Hide the folders\" aria-label=\"Hide the folders\" aria-pressed=\"true\">{WS_SVG['panel']}</button>"
        "</div>"
        "</header>"
        "<div class=\"ws-body\">"
        "<aside class=\"ws-side\" id=\"ws-side\">"
        "<div class=\"ws-side-head\">"
        f"<button class=\"ws-btn\" id=\"ws-roots-btn\" type=\"button\" title=\"The folders the reader shows\" aria-label=\"The folders the reader shows\">{WS_SVG['tree']}</button>"
        "<div class=\"ws-root\"><button class=\"ws-root-name\" id=\"ws-root-name\" type=\"button\" "
        "title=\"Go to a folder…\">Folders</button>"
        "<span class=\"where\" id=\"ws-root-where\"></span></div>"
        "</div>"
        f"<div class=\"ws-search\">{WS_SVG['search']}<input id=\"ws-filter\" type=\"search\" placeholder=\"Filter files\" aria-label=\"Filter files\">"
        f"<button class=\"ws-more-btn\" id=\"ws-more-btn\" type=\"button\" aria-expanded=\"false\" "
        f"aria-controls=\"ws-more\" aria-label=\"More filters\" title=\"More filters\">{WS_SVG['funnel']}</button></div>"
        # The kinds of file to show in the tree. Folders are always there: the tree is
        # how one gets to the files.
        "<div class=\"ws-kinds\" role=\"group\" aria-label=\"The kinds of file to show\">"
        "<button class=\"ws-chip on\" type=\"button\" data-kind=\"all\">All</button>"
        "<button class=\"ws-chip\" type=\"button\" data-kind=\"md\">MD</button>"
        "<button class=\"ws-chip\" type=\"button\" data-kind=\"html\">HTML</button>"
        "<button class=\"ws-chip\" type=\"button\" data-kind=\"pdf\">PDF</button>"
        "<button class=\"ws-chip\" type=\"button\" data-kind=\"img\">IMG</button>"
        "<button class=\"ws-chip\" type=\"button\" data-kind=\"sheet\">SHEET</button>"
        "<button class=\"ws-chip\" type=\"button\" data-kind=\"text\">OTHER</button>"
        "</div>"
        # The rest of the filter, said with controls rather than with words: which
        # extension, how big, and when it was last touched.
        "<div class=\"ws-more\" id=\"ws-more\" hidden>"
        "<label class=\"ws-field\"><span>Extension</span>"
        "<select id=\"ws-ext\" aria-label=\"The extension of the files to show\">"
        "<option value=\"any\">Any</option></select></label>"
        "<label class=\"ws-field\"><span>Size</span>"
        "<select id=\"ws-size\" aria-label=\"How big the files are\">"
        "<option value=\"any\">Any</option>"
        "<option value=\"gt1mb\">Larger than 1 MB</option>"
        "<option value=\"gt100kb\">Larger than 100 KB</option>"
        "<option value=\"gt10kb\">Larger than 10 KB</option>"
        "<option value=\"lt100kb\">Smaller than 100 KB</option>"
        "<option value=\"lt10kb\">Smaller than 10 KB</option>"
        "</select></label>"
        "<label class=\"ws-field\"><span>Modified</span>"
        "<select id=\"ws-when\" aria-label=\"When the files were last touched\">"
        "<option value=\"any\">Any</option>"
        "<option value=\"today\">Today</option>"
        "<option value=\"week\">The last 7 days</option>"
        "<option value=\"month\">The last 30 days</option>"
        "<option value=\"year\">The last year</option>"
        "<option value=\"old\">Older than a year</option>"
        "</select></label>"
        "<button class=\"ws-clear\" id=\"ws-clear\" type=\"button\">Clear the filters</button>"
        "</div>"
        "<div class=\"ws-tree\" id=\"ws-tree\" role=\"tree\" aria-label=\"Files\"></div>"
        "</aside>"
        "<main class=\"ws-main\" id=\"ws-main\">"
        "<div class=\"ws-empty\" id=\"ws-empty\">"
        f"<span class=\"glyph\">{WS_SVG['folder']}</span>"
        "<h2>Open file</h2><p>Select a file to open</p>"
        "</div>"
        "</main>"
        "</div>"
        "</div>"
        "<input id=\"ws-pick\" type=\"file\" hidden>"
        "<div class=\"ws-pop\" id=\"ws-pop\" hidden>"
        "<h3>Folders</h3><div id=\"ws-roots\"></div><hr>"
        "<button class=\"ws-menu-item\" id=\"ws-go-library\" type=\"button\">Library</button>"
        "<button class=\"ws-menu-item\" id=\"ws-go-folder\" type=\"button\">Go to a folder…</button>"
        "<button class=\"ws-menu-item\" id=\"ws-add-folder\" type=\"button\">Add a folder…</button>"
        f"<hr>{SETTINGS_HTML}</div>"
        # The folder to show: a path, and two things one can do with it — look at it, or
        # add it to the reader's own so that it is there next time.
        "<dialog class=\"ws-dialog\" id=\"ws-folder-dialog\">"
        "<form method=\"dialog\" id=\"ws-folder-form\">"
        "<h2>Go to a folder</h2>"
        "<p class=\"note\">A folder to show in the tree. Added to the reader, it stays "
        "among the folders beside it.</p>"
        "<input type=\"text\" id=\"ws-folder-path\" placeholder=\"~/notes\" "
        "aria-label=\"The folder's path\" autocomplete=\"off\" spellcheck=\"false\">"
        "<p class=\"bad\" id=\"ws-folder-error\" hidden></p>"
        "<menu><button value=\"cancel\" type=\"submit\">Cancel</button>"
        "<button value=\"add\" type=\"submit\" id=\"ws-folder-add\">Add to the reader</button>"
        "<button value=\"go\" type=\"submit\" id=\"ws-folder-go\">Go there</button></menu>"
        "</form>"
        "</dialog>"
        f"<script>{SETTINGS_JS}</script>"
        "<script src=\"/static/workspace.js\"></script>"
    )
    head = (
        "<script>try{var t=localStorage.getItem(\"mdview:theme\");"
        "if(t===\"light\"||t===\"dark\"||t===\"warm\")"
        "document.documentElement.setAttribute(\"data-mdview-theme\",t);}catch(e){}</script>"
        + app_head()
        + "<link rel=\"stylesheet\" href=\"/static/workspace.css\">"
    )
    return page("mdview", body, head)


def library(current):
    """The library's home, or one folder: its subfolders as cards, its notes as rows, and
    the tools to filter, sort, add, make folders, rename and delete."""
    if current is None:
        cards = []
        for root in ROOTS:
            count = sum(1 for f in root.iterdir() if f.is_file() and f.suffix.lower() in FILES) if root.is_dir() else 0
            href = f"/library?dir={urllib.parse.quote(str(root))}"
            cards.append(
                f"<a class=\"card\" href=\"{href}\"><div class=\"name\">{'Home' if root == pathlib.Path.home() else html.escape(root.name)}</div>"
                f"<div class=\"meta\">{count} notes at the top level</div></a>"
            )
        body = (
            "<div class=\"wrap\"><header class=\"top\"><h1>mdview</h1>"
            "<span class=\"sub\">Your notes, folders and PDFs</span></header>"
            "<p><a href=\"/\">← Back to the workspace</a></p>"
            "<form class=\"tools\" action=\"/library\" role=\"search\"><input type=\"search\" name=\"q\" "
            "placeholder=\"Find a note in any folder\" aria-label=\"Find a note in any folder\"></form>"
            f"<div class=\"actions\">{SETTINGS_HTML}{OPEN_HTML}</div>"
            "<section id=\"recent-section\" hidden><h2>Recently opened</h2>"
            "<ul class=\"files\" id=\"recent\"></ul>"
            "<div class=\"actions\"><button class=\"btn\" id=\"recent-clear\" type=\"button\">Clear list</button></div></section>"
            "<h2>Folders</h2>"
            f"<div class=\"cards\">{''.join(cards) or '<p class=\"empty\">No folders are set up yet. Edit roots.json.</p>'}</div>"
            "</div>"
            f"<script>{SETTINGS_JS}{RECENT_JS}{OPEN_JS}</script>"
        )
        return page("mdview", body, app_head())

    cur = pathlib.Path(current)
    folders = []
    notes = []
    total = 0
    for entry in sorted(cur.iterdir(), key=lambda e: e.name.lower()):
        if entry.name.startswith("."):
            continue
        name = html.escape(entry.name, quote=True)
        # A link to something that is not there has no modification time, and asking for
        # one used to end the whole listing: one broken shortcut in a folder — the home
        # folder has two — and the folder came back as "That folder can't be read." There is
        # nothing to show for an entry that cannot be stat'ed, so it is passed over.
        try:
            mtime = int(entry.stat().st_mtime)
        except OSError:
            continue
        if entry.is_dir():
            subs = sum(1 for e in entry.iterdir() if (e.is_file() and e.suffix.lower() in FILES) or e.is_dir())
            href = f"/library?dir={urllib.parse.quote(str(entry))}"
            folders.append(
                f"<a class=\"card\" data-name=\"{name}\" data-kind=\"folder\" data-mtime=\"{mtime}\" href=\"{href}\">"
                f"<div class=\"name\">{html.escape(entry.name)}</div>"
                f"<div class=\"meta\">{subs} items</div></a>"
            )
        elif entry.suffix.lower() in FILES:
            total += 1
            path = html.escape(str(entry), quote=True)
            href = f"/?open={urllib.parse.quote(str(entry))}"
            notes.append(
                f"<li data-name=\"{name}\" data-kind=\"{kind_of(entry.suffix.lower())}\" data-mtime=\"{mtime}\">"
                f"{kind_badge(entry.suffix.lower())}"
                f"<span class=\"name\"><a href=\"{href}\">{html.escape(entry.name)}</a></span>"
                f"<span class=\"when\">{when(entry)}</span>"
                "<span class=\"acts\">"
                f"<button class=\"act\" data-act=\"rename\" data-path=\"{path}\" type=\"button\">Rename</button>"
                f"<button class=\"act del\" data-act=\"delete\" data-path=\"{path}\" type=\"button\">Delete</button>"
                "</span></li>"
            )
    folder_block = f"<h2>Folders</h2><div class=\"cards\">{''.join(folders)}</div>" if folders else ""
    notes_block = (
        f"<h2>Notes</h2><ul class=\"files\">{''.join(notes)}</ul>" if notes
        else "<h2>Notes</h2><p class=\"empty\">No notes in this folder yet. Add some with the button above.</p>"
    )
    if cur in ROOTS:
        up_link = "<a href=\"/library\">Up</a>"
    elif allowed(cur.parent):
        up_link = f"<a href=\"/library?dir={urllib.parse.quote(str(cur.parent))}\">Up</a>"
    else:
        up_link = ""
    sub = f"<span class=\"sub\">{up_link}</span>" if up_link else ""
    tools = (
        "<div class=\"tools\">"
        "<input id=\"q\" type=\"search\" placeholder=\"Filter by name\" aria-label=\"Filter by name\">"
        "<div class=\"chips\" role=\"group\" aria-label=\"Type\">"
        "<button class=\"chip on\" type=\"button\" data-kind=\"all\">All</button>"
        "<button class=\"chip\" type=\"button\" data-kind=\"md\">MD</button>"
        "<button class=\"chip\" type=\"button\" data-kind=\"html\">HTML</button>"
        "<button class=\"chip\" type=\"button\" data-kind=\"pdf\">PDF</button>"
        "<button class=\"chip\" type=\"button\" data-kind=\"img\">IMG</button>"
        "<button class=\"chip\" type=\"button\" data-kind=\"sheet\">SHEET</button>"
        "</div>"
        "<select id=\"sort\" aria-label=\"Sort\">"
        "<option value=\"name\">Name</option><option value=\"new\">Newest first</option>"
        "<option value=\"old\">Oldest first</option></select>"
        "</div>"
        "<div class=\"actions\">"
        "<label class=\"btn primary\">Add files<input id=\"up\" type=\"file\" multiple hidden "
        "accept=\".md,.markdown,.mdown,.mkd,.html,.htm,.pdf,.png,.jpg,.jpeg,.gif,.webp,.svg,"
    ".xlsx,.xlsm,.csv,.tsv\"></label>"
        "<button class=\"btn\" id=\"mk\" type=\"button\">New folder</button>"
        "</div>"
        "<p id=\"status\" role=\"status\"></p>"
        "<p class=\"empty\" id=\"none\" hidden>Nothing here matches that filter.</p>"
    )
    body = (
        f"<div class=\"wrap\" id=\"app\" data-dir=\"{html.escape(str(cur), quote=True)}\">"
        f"<header class=\"top\"><h1>{html.escape(cur.name)}</h1>{sub}</header>"
        f"{crumbs(cur)}{tools}<div class=\"actions\">{SETTINGS_HTML}{OPEN_HTML}</div>{folder_block}{notes_block}</div>"
        f"<script>{LIBRARY_JS}{SETTINGS_JS}{OPEN_JS}</script>"
    )
    head = app_head()
    return page(cur.name, body, head)


ADOPT_JS = """
(function () {
  const TOKEN = (document.querySelector('meta[name="mdview-token"]') || {}).content || "";
  const btn = document.getElementById("add");
  const status = document.getElementById("status");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    const res = await fetch("/api/add-folder", {
      method: "POST",
      headers: { "X-Mdview-Token": TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ path: btn.dataset.folder }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      status.textContent = data.error || "The folder could not be added.";
      status.className = "bad";
      btn.disabled = false;
      return;
    }
    // In the workspace the file belongs in a tab of the window above, not in this
    // frame: the window is asked to open it. On its own, the file is opened here.
    if (window.self !== window.top) {
      try {
        window.top.postMessage({ type: "mdview:open", path: btn.dataset.path }, location.origin);
        return;
      } catch (e) { /* the window above is not ours: open the file here */ }
    }
    location.href = btn.dataset.file;
  });
})();
"""


def adopt_page(p):
    """A file the browser sent from a folder the reader does not have yet. The reader
    shows it once its folder is added, which is a choice the person makes here."""
    folder = html.escape(str(p.parent), quote=True)
    file_url = html.escape("/?open=" + urllib.parse.quote(str(p)), quote=True)
    body = (
        "<div class=\"wrap\"><header class=\"top\"><h1>" + html.escape(p.name) + "</h1></header>"
        f"<p class=\"empty\">This file is in <code>{html.escape(str(p.parent))}</code>, and the reader only "
        "shows the folders it was set up with.</p>"
        "<p><button class=\"btn primary\" id=\"add\" type=\"button\" "
        f"data-folder=\"{folder}\" data-file=\"{file_url}\" "
        f"data-path=\"{html.escape(str(p), quote=True)}\">Add this folder to the reader</button> "
        "<span id=\"status\" role=\"status\"></span></p>"
        "<p>Or read it once, without adding its folder: </p>"
        f"<p>{OPEN_HTML}</p>"
        "<p><a href=\"/\">← Back to the workspace</a></p></div>"
        f"<script>{ADOPT_JS}{OPEN_JS}</script>"
    )
    head = app_head()
    return page(p.name, body, head)


def back_bar(p):
    """The top bar on a file's page: back to the window the reader reads in."""
    return (
        f"<nav class=\"bar\"><a href=\"/\">← Workspace</a>"
        f"<span class=\"title\">{html.escape(p.name)}</span></nav>"
    )


STATIC_REF = re.compile(r"/static/([A-Za-z0-9_.\-]+)(?=['\"])")


def versioned(html_text):
    """The page's references to /static/ files, each with the file's modification time as
    a version, so an edited file is fetched again instead of read from the browser's copy."""
    def stamp(m):
        name = m.group(1)
        for folder in (ENGINE, HERE):
            target = folder / name
            if target.is_file():
                return f"/static/{name}?v={int(target.stat().st_mtime)}"
        return m.group(0)
    return STATIC_REF.sub(stamp, html_text)


def viewer(path, raw=None, bar=None, embed=False):
    body = _viewer(path, raw, bar, embed)
    return versioned(body) if body else body


def _viewer(path, raw=None, bar=None, embed=False):
    """The page that shows one file. Each kind has its own small shell. `raw` is where
    the bytes come from, and `bar` the top bar; a file opened once passes its own.
    `embed` says the page is shown inside the workspace's frame, where the bar back to
    the library would only be in the way."""
    p = pathlib.Path(path)
    name = html.escape(p.name)
    suffix = p.suffix.lower()
    if raw is None:
        raw = "/f" + urllib.parse.quote(str(p))
        base = f"<base href=\"/f{urllib.parse.quote(str(p.parent))}/\">"
        bar = ("" if embed else back_bar(p)) + recent_recorder(p)
    else:
        base = f"<base href=\"{raw.rsplit('/', 1)[0]}/\">"
        bar = bar or ""
    if suffix in MARKDOWN:
        head = base + app_head() + "<link rel=\"stylesheet\" href=\"/static/lookup.css\"><link rel=\"stylesheet\" href=\"/static/mdview.css\">"
        body = (
            bar
            + "<p id=\"note\">Opening…</p>"
            "<script src=\"/static/shim.js\"></script>"
            "<script src=\"/static/dictionaries.js\"></script>"
            "<script src=\"/static/lookup.js\"></script>"
            "<script>"
            f"fetch({json.dumps(raw)}).then(r => r.text()).then(t => {{"
            "  document.getElementById('note').remove();"
            "  const pre = document.createElement('pre'); pre.className = 'raw-source'; pre.textContent = t; document.body.appendChild(pre);"
            "  const s = document.createElement('script'); s.src = '/static/mdview.js'; document.body.appendChild(s);"
            "});</script>"
        )
        return page(p.name, body, head).replace("<html lang=\"en\">", "<html lang=\"en\" data-mdview-page=\"markdown\" style=\"--reader-bar:" + ("0px" if embed else "44px") + "\">", 1)
    if suffix in HTML:
        # The file's own page, in a frame, so its styles cannot reach the reader's chrome.
        # A page of HTML has words in it like any other file, and the lookup card has to
        # live inside that frame to be any use: a card is placed from the word's own box,
        # and a box belongs to the document it is in — and the frame scrolls on its own, so
        # a card outside it would sit still while the words moved under it. So the frame is
        # handed the same files the other pages get, and the reader's theme values with
        # them, because mdview.css is not loaded in there and the card is drawn from it.
        # The paths are absolute for the same reason: a saved page usually carries a <base>
        # pointing at the site it came from, and a relative /static/ would go there.
        body = (
            bar
            + f"<iframe id=\"frame\" src=\"{raw}\" style=\"border:0;width:100%;height:calc(100vh - 44px)\"></iframe>"
            + "<script>"
            "const frame = document.getElementById('frame');"
            "const STATIC = location.origin + '/static/';"
            "const TOKENS = ['bg','card','ink','muted','faint','line','line-strong','accent','accentline',"
            "'accenttint','zebra','radius','radius-sm','float-shadow','def-notch','md-font','md-font-head',"
            "'ui-size','select-bg'];"
            "function dress(d) {"
            "  const head = d.head || d.documentElement;"
            "  const here = getComputedStyle(document.documentElement);"
            "  const style = d.createElement('style');"
            "  style.textContent = ':root{' + TOKENS.map((n) => '--' + n + ':' + here.getPropertyValue('--' + n).trim() + ';').join('') + '}';"
            "  head.appendChild(style);"
            "  const link = d.createElement('link'); link.rel = 'stylesheet'; link.href = STATIC + 'lookup.css';"
            "  head.appendChild(link);"
            "  const words = d.createElement('script'); words.src = STATIC + 'dictionaries.js'; head.appendChild(words);"
            "  const card = d.createElement('script'); card.src = STATIC + 'lookup.js';"
            "  card.onload = () => {"
            "    const w = d.defaultView;"
            "    w.MdviewLookup.setRoot('body');"
            # `code`, unlike on a note page: a manual's code samples are part of the
            # document here, and a word in one is a word the reader may want to know.
            "    w.MdviewLookup.attach(d, { neighbours: false, code: true });"
            "  };"
            "  head.appendChild(card);"
            "}"
            "frame.addEventListener('load', () => {"
            "  const d = frame.contentDocument, w = frame.contentWindow;"
            "  if (!d || !w || w.MdviewLookup) return;"
            "  try { dress(d); } catch (e) { /* a page that refuses the card is still a page */ }"
            "});"
            "</script>"
        )
        return page(p.name, body, app_head())
    if suffix == ".pdf":
        # The pages, their paint and the reader's place in the file are pdfview.js's; this
        # branch was that engine written into a string here, and the engine outgrew it.
        body = (
            bar
            + f"<p id=\"note\">Opening…</p><main id=\"pages\" data-src=\"{html.escape(raw, quote=True)}\"></main>"
            + "<script src=\"/static/shim.js\"></script>"
            + "<script src=\"/static/dictionaries.js\"></script>"
            + "<script src=\"/static/lookup.js\"></script>"
            # the lookup card is attached to the document, not to a page, so it can load
            # before any page exists; the viewer's module then paints under it
            + "<script src=\"/static/mdview.js\"></script>"
            + "<script type=\"module\" src=\"/static/pdfview.js\"></script>"
        )
        head = (
            # The reader's own light, dark or warm, before the first paint: this page's white
            # paper wants the same desk as the note pages, and the bar must not flash light.
            "<script>try{var t=localStorage.getItem(\"mdview:theme\");"
            "if(t===\"light\"||t===\"dark\"||t===\"warm\")"
            "document.documentElement.setAttribute(\"data-mdview-theme\",t);}catch(e){}</script>"
            + app_head()
            + "<link rel=\"stylesheet\" href=\"/static/lookup.css\">"
            + "<link rel=\"stylesheet\" href=\"/static/mdview.css\">"
            + "<link rel=\"stylesheet\" href=\"/static/pdfview.css\">"
        )
        return page(p.name, body, head).replace(
            "<html lang=\"en\">", "<html lang=\"en\" data-mdview-page=\"pdf\">", 1
        )
    if suffix in SHEETS or suffix in SPREADS:
        # The page is a shell with an empty main in it: the file is read by sheet.js from
        # the reader's own /f/ route, so nothing here touches the bytes. A .csv takes the
        # same road as a workbook with no zip step in it, which is why one branch covers
        # both, and why the engine is told which kind it is getting.
        head = (
            base
            + app_head()
            + "<link rel=\"stylesheet\" href=\"/static/lookup.css\">"
            + "<link rel=\"stylesheet\" href=\"/static/mdview.css\">"
            + "<link rel=\"stylesheet\" href=\"/static/sheet.css\">"
        )
        body = (
            bar
            + f"<main id=\"sheet\" data-src=\"{html.escape(raw, quote=True)}\" "
            + f"data-kind=\"{suffix.lstrip('.')}\" data-name=\"{name}\">"
            + "<p class=\"sheet-note\">Opening…</p></main>"
            # The reader's own choice of light, dark or warm is stored by the note page and
            # turned into an attribute on the document element by mdview.js, which this page
            # does not load. Without these two lines a sheet follows the system and not the
            # reader, which is the one way the two pages can disagree about the same desk.
            # The same lookup card the note pages carry, and the same three files in the
            # same order: the detector, the word sense shaper, then the card itself.
            + "<script src=\"/static/shim.js\"></script>"
            + "<script src=\"/static/dictionaries.js\"></script>"
            + "<script src=\"/static/lookup.js\"></script>"
            + "<script src=\"/static/sheet.js\"></script>"
        )
        return page(p.name, body, head).replace(
            "<html lang=\"en\">", "<html lang=\"en\" data-mdview-page=\"sheet\" style=\"--reader-bar:" + ("0px" if embed else "44px") + "\">", 1
        )
    if suffix in PICTURES:
        # A picture is shown at its own pixels on a desk, moved with the hand: the
        # reader's own page for a picture, so it is crisp and it can be looked at
        # closely.
        head = (
            base
            + app_head()
            + "<link rel=\"stylesheet\" href=\"/static/imageview.css\">"
        )
        body = (
            bar
            + f"<main class=\"imgview\">"
            + f"<div class=\"imgview-stage\"><img class=\"imgview-img\" src=\"{html.escape(raw, quote=True)}\" alt=\"{name}\"></div>"
            + "<div class=\"imgview-bar\">"
            + "<button type=\"button\" data-act=\"out\" aria-label=\"Smaller\" title=\"Smaller\">−</button>"
            + "<button type=\"button\" class=\"imgview-level\" data-act=\"level\" aria-label=\"Back to its own size\" title=\"Back to its own size\">100%</button>"
            + "<button type=\"button\" data-act=\"in\" aria-label=\"Bigger\" title=\"Bigger\">+</button>"
            + "<span class=\"imgview-sep\"></span>"
            + "<button type=\"button\" data-act=\"fit\" title=\"The whole picture in the window\">Fit</button>"
            + "<button type=\"button\" data-act=\"one\" title=\"At its own pixels\">1:1</button>"
            + f"<span class=\"imgview-name\">{name}</span>"
            + "<span class=\"imgview-size\"></span>"
            + "</div>"
            + "</main>"
            + "<script src=\"/static/imageview.js\"></script>"
        )
        return page(p.name, body, head).replace(
            "<html lang=\"en\">",
            "<html lang=\"en\"" + ("" if embed else " style=\"--reader-bar:44px\"") + ">",
            1,
        )
    # A kind the reader has no engine for: its own text when the bytes are text, and the
    # file itself when they are not. The reader opens every file it can; this is the
    # last kind of them, and the one that decides.
    if file_kind(p) == "text":
        return text_page(p, bar=bar)
    return binary_page(p, bar=bar)


def human_size(n):
    """A size in bytes, said the way a person says it."""
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} GB"


def text_page(p, bar=""):
    """A file of a kind the reader has no engine for, shown as its own text. The bytes
    are read here, so the page needs nothing else to show the file — and it is the file
    itself, not a summary of it."""
    try:
        with open(p, "rb") as f:
            data = f.read(TEXT_LIMIT)
        size = p.stat().st_size
    except OSError:
        data, size = b"", 0
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        text = data.decode("latin-1")
    lines = text.count("\n") + (1 if text else 0)
    body = (
        bar
        + f"<header class=\"txt-head\"><span class=\"txt-name\">{html.escape(p.name)}</span>"
        + f"<span class=\"txt-meta\">{human_size(size)} · {lines} lines · {html.escape(str(p.parent))}</span></header>"
        + f"<pre class=\"txt-body\">{html.escape(text)}</pre>"
    )
    return page(p.name, body, "<link rel=\"stylesheet\" href=\"/static/text.css\">")


def binary_page(p, bar=""):
    """A file the reader cannot read — a picture of a song, an archive — says so in the
    middle of the page, and offers the file itself."""
    body = (
        bar
        + f"<main class=\"txt-none\"><h1>{html.escape(p.name)}</h1>"
        + "<p>This file is not text, so there is nothing on the page to read.</p>"
        + f"<p><a href=\"/f{urllib.parse.quote(str(p))}\">Take the file</a></p></main>"
    )
    return page(p.name, body, "<link rel=\"stylesheet\" href=\"/static/text.css\">")


def safe_name(name):
    """A plain file or folder name: no path parts, no hidden names, no control characters."""
    if (not isinstance(name, str) or not name.strip() or name in (".", "..") or name.startswith(".")
            or "/" in name or "\\" in name or "\x00" in name or len(name) > 200):
        raise ApiError("That name can't be used.")
    return name.strip()


def inside(path):
    """The path, if it is inside the configured folders; otherwise a refusal."""
    p = pathlib.Path(path)
    if not allowed(p):
        raise ApiError("That isn't in one of your folders.", 403)
    return p


def do_upload(folder, name, data):
    target_dir = inside(folder)
    if not target_dir.is_dir():
        raise ApiError("That folder isn't there any more.", 404)
    name = safe_name(name)
    if pathlib.Path(name).suffix.lower() not in FILES:
        raise ApiError(f"Only notes, pictures and spreadsheets can be added: {KINDS}.")
    target = inside(target_dir / name)
    try:
        with open(target, "xb") as f:
            f.write(data)
    except FileExistsError:
        raise ApiError(f"{name} is already in this folder.", 409)
    return {"ok": True, "name": name}


def do_delete(path):
    target = inside(path)
    if target in ROOTS:
        raise ApiError("A folder you set up can't be deleted here.")
    if not (target.is_file() and target.suffix.lower() in FILES):
        raise ApiError("Only notes, pictures and spreadsheets can be deleted here.")
    target.unlink()
    return {"ok": True}


def do_rename(path, name):
    target = inside(path)
    if not (target.is_file() and target.suffix.lower() in FILES):
        raise ApiError("Only notes, pictures and spreadsheets can be renamed here.")
    name = safe_name(name)
    if not pathlib.Path(name).suffix:
        name += target.suffix
    if pathlib.Path(name).suffix.lower() not in FILES:
        raise ApiError(f"A renamed file keeps one of its types: {KINDS}.")
    dest = inside(target.parent / name)
    if dest.exists():
        raise ApiError(f"{name} is already in this folder.", 409)
    target.rename(dest)
    return {"ok": True, "name": name}


def do_mkdir(folder, name):
    parent = inside(folder)
    if not parent.is_dir():
        raise ApiError("That folder isn't there any more.", 404)
    name = safe_name(name)
    target = inside(parent / name)
    if target.exists():
        raise ApiError(f"{name} is already in this folder.", 409)
    target.mkdir()
    return {"ok": True, "name": name}


def do_add_folder(path, create=False):
    """Adds a folder to the reader's roots and saves roots.json. The folder must exist,
    unless it is to be made: a folder the reader is asked to show and that is not there
    can be made on the spot.

    A folder inside a root is allowed and becomes a root of its own — the reader was
    asked for it by name, and showing it twice (once inside the other folder, once as
    a folder of its own) is better than refusing what was asked for. Only two things
    are refused: a folder the reader already shows by that name, and a folder that
    holds one of the reader's own, which would show the same files twice over."""
    if not isinstance(path, str) or not path.strip():
        raise ApiError("That folder has no name.", 400)
    folder = pathlib.Path(path).expanduser().resolve()
    if not folder.is_dir():
        if folder.exists():
            raise ApiError("Something is there that is not a folder.", 409)
        if not create:
            raise ApiError("That folder isn't there yet.", 404)
        try:
            folder.mkdir(parents=True)
        except OSError as e:
            raise ApiError(f"That folder could not be made: {e}", 500)
    if folder == pathlib.Path(folder.anchor):
        raise ApiError("That is the whole disk.", 409)
    if any(r == folder for r in ROOTS):
        raise ApiError("That folder is one of the reader's own already.", 409)
    if any(folder in r.parents for r in ROOTS):
        raise ApiError("The reader already shows a folder inside that one.", 409)
    ROOTS.append(folder)
    saved = json.loads(ROOTS_FILE.read_text())
    if str(folder) not in saved:
        saved.append(str(folder))
    ROOTS_FILE.write_text(json.dumps(saved, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {"ok": True, "folder": str(folder)}


def tree_allowed(path):
    """Any folder on the machine may be shown in the tree. The reader's roots are what it
    reads; the tree is how it finds what to read, and a folder outside the roots can
    still be opened — the page that offers to add that folder comes up instead."""
    return True


class Handler(BaseHTTPRequestHandler):
    def send(self, status, body, ctype="text/html; charset=utf-8"):
        data = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def send_json(self, status, obj):
        self.send(status, json.dumps(obj), "application/json")

    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        route = urllib.parse.unquote(url.path)
        query = urllib.parse.parse_qs(url.query)
        outside = "That isn't in one of your folders."
        if route == "/healthz":
            return self.send(200, "ok", "text/plain; charset=utf-8")
        if route == "/":
            # The workspace: the reader's home. A file named in the address is opened in
            # it — that is how the extension hands a local file over.
            return self.send(200, workspace())
        if route == "/api/tree":
            # The folders on the left: the roots, and then whatever is inside one. A
            # folder that is not the reader's own is shown only when it is the way up
            # out of one, and it says which folder that way leads to.
            path = query.get("path", [""])[0]
            if not path:
                return self.send_json(200, {"roots": [{"name": r.name or str(r), "path": str(r)} for r in ROOTS]})
            target = pathlib.Path(path)
            if not tree_allowed(target):
                return self.send_json(403, {"error": outside})
            if not target.is_dir():
                if target.exists():
                    return self.send_json(400, {"error": "That is a file, not a folder."})
                return self.send_json(404, {"error": "That folder isn't there."})
            parent = target.parent
            up = str(parent) if parent != target and tree_allowed(parent) else None
            return self.send_json(200, {"path": str(target), "name": target.name or str(target),
                                        "up": up, "entries": tree_entries(target)})
        if route == "/library":
            q = query.get("q", [""])[0].strip()
            if q:
                return self.send(200, search_page(q))
            current = query.get("dir", [None])[0]
            if current is not None and not allowed(current):
                return self.send(404, error_page(outside))
            if current is not None and not pathlib.Path(current).is_dir():
                return self.send(404, error_page("That folder isn't there any more."))
            try:
                return self.send(200, library(current))
            except OSError:
                return self.send(404, error_page("That folder can't be read."))
        if route.startswith("/view/"):
            target = route[len("/view"):]
            if pathlib.Path(target).is_file() and not allowed(target):
                return self.send(200, adopt_page(pathlib.Path(target)))
            if not allowed(target) or not pathlib.Path(target).is_file():
                return self.send(404, error_page(outside))
            try:
                body = viewer(target, embed=query.get("embed", [""])[0] == "1")
            except OSError:
                return self.send(404, error_page("That file can't be read."))
            return self.send(200, body) if body else self.send(415, error_page("This reader doesn't open that kind of file."))
        if route.startswith("/open-file/") or route.startswith("/temp-raw/"):
            try:
                file_id, name = route.split("/", 3)[2:4]
                target = temp_file(file_id, name)
            except (ApiError, ValueError):
                return self.send(404, error_page("That file isn't open any more. Open it again from the library."))
            if route.startswith("/temp-raw/"):
                ctype = TYPES.get(target.suffix.lower(), "application/octet-stream")
                return self.send(200, target.read_bytes(), ctype)
            embed = query.get("embed", [""])[0] == "1"
            back = "" if embed else "<nav class=\"bar\"><a href=\"/library\">← Library</a>" + \
                   f"<span class=\"title\">{html.escape(target.name)} · opened once, not kept in the library</span></nav>"
            raw = f"/temp-raw/{file_id}/{urllib.parse.quote(target.name)}"
            body = viewer(str(target), raw=raw, bar=back, embed=embed)
            return self.send(200, body) if body else self.send(415, error_page("This reader doesn't open that kind of file."))
        if route.startswith("/f/"):
            target = route[len("/f"):]
            if not allowed(target) or not pathlib.Path(target).is_file():
                return self.send(404, "not in your folders")
            ctype = TYPES.get(pathlib.Path(target).suffix.lower(), "application/octet-stream")
            return self.send(200, pathlib.Path(target).read_bytes(), ctype)
        if route.startswith("/static/"):
            name = route[len("/static/"):]
            if name in HERE_FILES:
                target = HERE / name
                if target.is_file():
                    return self.send(200, target.read_bytes(), TYPES.get(target.suffix.lower(), "application/octet-stream"))
            first = name.split("/", 1)[0]
            if (name in ENGINE_FILES or (first in ENGINE_DIRS and "/" in name)) and ".." not in name:
                target = ENGINE / name
                if target.is_file():
                    return self.send(200, target.read_bytes(), TYPES.get(target.suffix.lower(), "application/octet-stream"))
            return self.send(404, "no such reader file")
        return self.send(404, "not found")

    def do_POST(self):
        url = urllib.parse.urlsplit(self.path)
        route = urllib.parse.unquote(url.path)
        query = urllib.parse.parse_qs(url.query)
        if not route.startswith("/api/"):
            return self.send(404, "not found")
        if self.headers.get("Origin", "") not in ORIGINS or self.headers.get("X-Mdview-Token", "") != TOKEN:
            return self.send_json(403, {"error": "That request didn't come from the reader's own pages."})
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = -1
        if length < 0:
            return self.send_json(411, {"error": "The request has no length."})
        if length > MAX_UPLOAD:
            return self.send_json(413, {"error": "That file is too large to add (300 MB at most)."})
        data = self.rfile.read(length)
        try:
            if route == "/api/upload":
                result = do_upload(query.get("dir", [""])[0], query.get("name", [""])[0], data)
            elif route == "/api/temp":
                result = do_temp_upload(query.get("name", [""])[0], data)
            else:
                payload = json.loads(data or b"{}")
                if route == "/api/delete":
                    result = do_delete(payload.get("path", ""))
                elif route == "/api/rename":
                    result = do_rename(payload.get("path", ""), payload.get("name", ""))
                elif route == "/api/mkdir":
                    result = do_mkdir(payload.get("dir", ""), payload.get("name", ""))
                elif route == "/api/add-folder":
                    result = do_add_folder(payload.get("path", ""), bool(payload.get("create")))
                else:
                    raise ApiError("No such action.", 404)
        except ApiError as e:
            return self.send_json(e.status, {"error": str(e)})
        except (OSError, ValueError) as e:
            return self.send_json(500, {"error": f"The change could not be made: {e}"})
        return self.send_json(200, result)

    def log_message(self, format, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), format % args))


if __name__ == "__main__":
    for root in ROOTS:
        if not root.is_dir():
            print(f"note: {root} does not exist yet", file=sys.stderr)
    print(f"mdview reader on http://{HOST}:{PORT}/", file=sys.stderr)
    threading.Thread(target=build_index, daemon=True).start()
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
