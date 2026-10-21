// mdview's workspace — the folders on the left, the open files along the top and the
// document in the middle. It is the reader's own window: the same file tree, the same
// open files, the same desk the notes are read on.
//
// The state — which folder the tree is rooted at, which files are open, which folders
// are open — is kept in this browser, so the window comes back the way it was left.

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const KEY = "mdview:workspace";
  const FRAMES = 8; // how many open files keep a live page behind them
  const TOKEN = (document.querySelector('meta[name="mdview-token"]') || {}).content || "";

  const SVG = {
    chevron: '<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    folder: '<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.7 4.4A1.4 1.4 0 013 3h2.8l1.6 2H13a1.4 1.4 0 011.4 1.4v6.2A1.4 1.4 0 0113 14H3a1.4 1.4 0 01-1.3-1.6z" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
    file: '<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1.8h5l3 3v9.4a1 1 0 01-1 1H4a1 1 0 01-1-1V2.8a1 1 0 011-1z" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M9 1.8v3h3" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
    image: '<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="6" cy="6.4" r="1.1" fill="currentColor"/><path d="M3.2 11.2l3.3-3.1 2.2 2 2.3-1.9 2.8 3" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
    grid: '<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><rect x="2.2" y="2.6" width="11.6" height="10.8" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M2.2 6.2h11.6M6.6 6.2v7.2" stroke="currentColor" stroke-width="1.1"/></svg>',
    up: '<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 12.4V4.2M4.4 7.8L8 4.2l3.6 3.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  // The mark on each kind of file. A note has the reader's own glyph; the rest say what
  // they are in two or three strokes.
  function iconFor(kind) {
    if (kind === "md") return '<span class="ws-glyph md">M↓</span>';
    if (kind === "html") return '<span class="ws-glyph html">&lt;/&gt;</span>';
    if (kind === "pdf") return '<span class="ws-glyph pdf">PDF</span>';
    if (kind === "sheet") return SVG.grid;
    if (kind === "img") return SVG.image;
    return SVG.file;
  }

  const state = { root: null, tabs: [], active: null, side: true, open: [], kind: "all", ext: "any", size: "any", when: "any" };
  const folders = new Map(); // path -> the entries inside it
  const frames = new Map(); // tab id -> the page behind it
  const expanded = new Set(); // the folders that are open in the tree
  let roots = [];

  // ── The state, kept in this browser ──────────────────────────────────────

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      const s = raw ? JSON.parse(raw) : null;
      if (!s || typeof s !== "object") return;
      if (typeof s.root === "string") state.root = s.root;
      if (Array.isArray(s.tabs)) {
        state.tabs = s.tabs.filter((t) => t && typeof t.src === "string" && typeof t.name === "string");
      }
      if (typeof s.active === "string") state.active = s.active;
      if (typeof s.side === "boolean") state.side = s.side;
      if (Array.isArray(s.open)) state.open = s.open.filter((p) => typeof p === "string");
      if (typeof s.kind === "string") state.kind = s.kind;
      if (typeof s.ext === "string") state.ext = s.ext;
      if (typeof s.size === "string") state.size = s.size;
      if (typeof s.when === "string") state.when = s.when;
    } catch (e) {
      /* a window with no memory starts empty */
    }
  }

  function save() {
    try {
      state.open = [...expanded];
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      /* not kept, not a problem */
    }
  }

  // ── The folders ──────────────────────────────────────────────────────────

  async function ask(path) {
    const url = path ? "/api/tree?path=" + encodeURIComponent(path) : "/api/tree";
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return res.json().catch(() => null);
  }

  async function loadRoots() {
    const data = await ask("");
    roots = (data && data.roots) || [];
    if (!state.root || !roots.some((r) => r.path === state.root)) {
      state.root = roots.length ? roots[0].path : null;
    }
  }

  async function loadFolder(path) {
    if (folders.has(path)) return folders.get(path);
    const data = await ask(path);
    const folder = {
      entries: (data && data.entries) || [],
      up: (data && data.up) || null,
      name: (data && data.name) || path.split("/").pop() || path,
    };
    folders.set(path, folder);
    return folder;
  }

  // The rows of the tree: the folder's contents, and under every open folder its own.
  function rows() {
    const out = [];
    const walk = (path, depth, parent) => {
      const folder = folders.get(path);
      if (!folder) return;
      for (const e of folder.entries) {
        const row = { name: e.name, path: e.path, dir: e.dir, kind: e.kind, size: e.size, mtime: e.mtime, depth, parent };
        out.push(row);
        if (e.dir && expanded.has(e.path)) walk(e.path, depth + 1, e.path);
      }
    };
    if (state.root) walk(state.root, 0, state.root);
    return out;
  }

  // ── The filter ───────────────────────────────────────────────────────────

  // How big, said the way a person says it.
  const SIZES = {
    gt1mb: { label: "Larger than 1 MB", test: (n) => n > 1048576 },
    gt100kb: { label: "Larger than 100 KB", test: (n) => n > 102400 },
    gt10kb: { label: "Larger than 10 KB", test: (n) => n > 10240 },
    lt100kb: { label: "Smaller than 100 KB", test: (n) => n < 102400 },
    lt10kb: { label: "Smaller than 10 KB", test: (n) => n < 10240 },
  };

  // When it was last touched, said the way a person says it.
  const DAY = 86400000;
  const WHEN = {
    today: { label: "Today", test: (t, now) => t >= now - (now % DAY) },
    week: { label: "The last 7 days", test: (t, now) => t >= now - 7 * DAY },
    month: { label: "The last 30 days", test: (t, now) => t >= now - 30 * DAY },
    year: { label: "The last year", test: (t, now) => t >= now - 365 * DAY },
    old: { label: "Older than a year", test: (t, now) => t < now - 365 * DAY },
  };

  function extensionOf(name) {
    return (name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "").toLowerCase();
  }

  // The extensions in the tree as it stands: the filter offers the ones that are
  // really there, and no others.
  function extensionsHere() {
    const found = new Set();
    for (const r of rows()) {
      if (!r.dir) {
        const ext = extensionOf(r.name);
        if (ext) found.add(ext);
      }
    }
    return [...found].sort();
  }

  function fillExtensions() {
    const select = $("ws-ext");
    const wanted = state.ext || "any";
    const here = extensionsHere();
    const options = ['<option value="any">Any</option>'];
    for (const ext of here) {
      const label = ext.length > 12 ? ext.slice(0, 12) + "…" : ext;
      options.push(`<option value="${htmlEscape(ext)}">.${htmlEscape(label)}</option>`);
    }
    select.innerHTML = options.join("");
    select.value = here.includes(wanted) ? wanted : "any";
    if (select.value !== wanted) state.ext = "any";
  }

  function htmlEscape(text) {
    return String(text).replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");
  }

  // Whether a file is what the filter asked for. The folders are never asked about:
  // they are the way to the files.
  function fileMatches(r) {
    const ext = extensionOf(r.name);
    if (state.ext && state.ext !== "any" && ext !== state.ext) return false;
    if (state.size && state.size !== "any") {
      const rule = SIZES[state.size];
      if (rule && !rule.test(Number(r.size || 0))) return false;
    }
    if (state.when && state.when !== "any") {
      const rule = WHEN[state.when];
      if (rule && !rule.test(Number(r.mtime || 0) * 1000, Date.now())) return false;
    }
    return true;
  }

  // What the filter keeps: the files that are what was asked for, the ones whose name
  // was asked for, and the folders on the way to them.
  function visible() {
    const all = rows();
    const kind = state.kind || "all";
    let kept = all;
    if (kind !== "all") {
      kept = kept.filter((r) => r.dir || r.kind === kind);
    }
    const needle = $("ws-filter").value.trim().toLowerCase();
    const byName = (r) => !needle || r.name.toLowerCase().includes(needle);
    const byTerms = (r) => r.dir || fileMatches(r);
    if (!needle && !byTermsChanged()) return kept;

    const kids = new Map();
    for (const r of kept) {
      const list = kids.get(r.parent) || [];
      list.push(r);
      kids.set(r.parent, list);
    }
    const keep = new Set();
    const mark = (r) => {
      if (byName(r) && byTerms(r)) {
        keep.add(r.path);
        return true;
      }
      let any = false;
      for (const k of kids.get(r.path) || []) if (mark(k)) any = true;
      if (any) keep.add(r.path);
      return any;
    };
    for (const r of kept) mark(r);
    return kept.filter((r) => keep.has(r.path));
  }

  // Whether any of the controls beyond the kind and the name are asking for
  // something particular.
  function byTermsChanged() {
    return (state.ext && state.ext !== "any") ||
      (state.size && state.size !== "any") ||
      (state.when && state.when !== "any");
  }

  function paintTree() {
    // The extensions on offer are the ones the tree really has, so the list is brought
    // up to date whenever the tree changes.
    if (!$("ws-more").hidden) fillExtensions();
    const box = $("ws-tree");
    const shown = visible();
    const open = new Set(state.tabs.map((t) => t.path));
    const active = state.active ? (state.tabs.find((t) => t.id === state.active) || {}).path : null;
    const frag = document.createDocumentFragment();
    // The way up, when there is one: the folder above the one the tree is showing.
    const here = folders.get(state.root);
    if (here && here.up) {
      const up = document.createElement("button");
      up.type = "button";
      up.className = "ws-row up";
      up.dataset.up = here.up;
      up.title = here.up;
      const ico = document.createElement("span");
      ico.className = "ico";
      ico.innerHTML = SVG.up;
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = here.up.split("/").filter(Boolean).pop() || "/";
      up.append(ico, name);
      frag.appendChild(up);
    }
    for (const r of shown) {
      const row = document.createElement("div");
      row.className = "ws-row" + (r.dir ? " dir" : "") + (open.has(r.path) ? " open" : "") + (r.path === active ? " on" : "");
      row.dataset.path = r.path;
      row.dataset.dir = r.dir ? "1" : "";
      row.setAttribute("role", "treeitem");
      row.setAttribute("tabindex", "0");
      row.style.paddingLeft = 4 + r.depth * 13 + "px";
      const chev = document.createElement("span");
      chev.className = "chev" + (r.dir ? (expanded.has(r.path) ? " open" : "") : " leaf");
      chev.innerHTML = SVG.chevron;
      const ico = document.createElement("span");
      ico.className = "ico";
      ico.innerHTML = r.dir ? SVG.folder : iconFor(r.kind);
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = r.name;
      row.append(chev, ico, name);
      if (r.dir) {
        // The three dots: what can be done with this folder.
        const dots = document.createElement("button");
        dots.type = "button";
        dots.className = "dots";
        dots.textContent = "···";
        dots.title = "What to do with this folder";
        dots.setAttribute("aria-label", "What to do with " + r.name);
        dots.addEventListener("click", (e) => {
          e.stopPropagation();
          openFolderMenu(r.path, dots);
        });
        row.appendChild(dots);
      }
      row.title = r.path;
      frag.appendChild(row);
    }
    box.replaceChildren(frag);
    if (!shown.length) {
      const empty = document.createElement("p");
      empty.className = "ws-note";
      const needle = $("ws-filter").value.trim();
      const kind = state.kind || "all";
      empty.textContent = needle
        ? "Nothing here is like that."
        : kind === "all"
          ? "This folder is empty."
          : "No files of that kind here.";
      box.appendChild(empty);
    }
  }

  function paintSide() {
    const here = folders.get(state.root);
    const root = roots.find((r) => r.path === state.root);
    $("ws-root-name").textContent = root ? root.name : (here && here.name) || state.root || "Folders";
    $("ws-root-where").textContent = state.root || "";
  }

  // One folder up: the tree shows the folder above the one it is showing.
  async function goUp(path) {
    await goTo(path);
  }

  // The tree shows this folder: the one the reader is standing in.
  async function goTo(path) {
    state.root = path;
    expanded.clear();
    folders.delete(path);
    await loadFolder(path);
    paintSide();
    paintTree();
    paintRoots();
    save();
  }

  async function toggle(path) {
    if (expanded.has(path)) {
      expanded.delete(path);
    } else {
      expanded.add(path);
      await loadFolder(path);
    }
    save();
    paintTree();
  }

  // The kind of a file, when it is not in the tree already: the folder it is in says.
  async function kindOf(path) {
    const root = roots.find((r) => path === r.path || path.startsWith(r.path + "/"));
    if (!root) return kindFromName(path);
    const parent = path.split("/").slice(0, -1).join("/") || "/";
    let folder = folders.get(parent);
    if (!folder) folder = await loadFolder(parent);
    const hit = (folder.entries || []).find((e) => e.path === path);
    return hit ? hit.kind : kindFromName(path);
  }

  // What a file's name says about it, for a file the tree has not seen: a note is a note
  // by its name, and so is a PDF.
  function kindFromName(path) {
    const name = path.split("/").pop() || "";
    const suffix = (name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "").toLowerCase();
    if (["md", "markdown", "mdown", "mkd"].includes(suffix)) return "md";
    if (["html", "htm"].includes(suffix)) return "html";
    if (suffix === "pdf") return "pdf";
    if (["xlsx", "xlsm", "csv", "tsv"].includes(suffix)) return "sheet";
    if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(suffix)) return "img";
    return null;
  }

  // Where a file is: the folders on the way to it are opened, so the tree shows the file
  // where it lives rather than leaving it in a folder nobody has opened.
  async function reveal(path) {
    const root = roots.find((r) => path === r.path || path.startsWith(r.path + "/"));
    if (root && root.path !== state.root) {
      state.root = root.path;
      folders.delete(root.path);
      await loadFolder(root.path);
      paintSide();
    }
    const parts = path.split("/").filter(Boolean);
    let cur = "";
    for (let i = 0; i < parts.length - 1; i++) {
      cur += "/" + parts[i];
      if (state.root && cur.startsWith(state.root)) {
        expanded.add(cur);
        await loadFolder(cur);
      }
    }
  }

  // ── The open files ───────────────────────────────────────────────────────

  function tabId() {
    return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function openFile(path, name, kind) {
    const known = state.tabs.find((t) => t.path === path);
    if (known) {
      activate(known.id);
      return known;
    }
    const tab = {
      id: tabId(),
      path,
      name: name || path.split("/").pop(),
      kind: kind || null,
      src: viewUrl(path),
    };
    state.tabs.push(tab);
    activate(tab.id);
    paintTree();
    return tab;
  }

  // The address of a file's own page. Each part of the path is escaped on its own, so a
  // name with a # or a ? in it is still the name it is.
  function viewUrl(path) {
    return "/view" + path.split("/").map(encodeURIComponent).join("/") + "?embed=1";
  }

  function activate(id) {
    state.active = id;
    paintTabs();
    paintMain();
    paintTree();
    save();
  }

  function closeTab(id) {
    const at = state.tabs.findIndex((t) => t.id === id);
    if (at === -1) return;
    state.tabs.splice(at, 1);
    const frame = frames.get(id);
    if (frame) {
      frame.remove();
      frames.delete(id);
    }
    if (state.active === id) {
      const next = state.tabs[Math.min(at, state.tabs.length - 1)];
      state.active = next ? next.id : null;
    }
    paintTabs();
    paintMain();
    paintTree();
    save();
  }

  function paintTabs() {
    const box = $("ws-tabs");
    const frag = document.createDocumentFragment();
    for (const tab of state.tabs) {
      const el = document.createElement("div");
      el.className = "ws-tab" + (tab.id === state.active ? " on" : "");
      el.dataset.id = tab.id;
      el.setAttribute("role", "tab");
      el.setAttribute("tabindex", "0");
      el.setAttribute("aria-selected", String(tab.id === state.active));
      el.title = tab.path;
      const ico = document.createElement("span");
      ico.className = "ico";
      ico.innerHTML = iconFor(tab.kind);
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = tab.name;
      const x = document.createElement("button");
      x.type = "button";
      x.className = "x";
      x.title = "Close";
      x.setAttribute("aria-label", "Close " + tab.name);
      x.textContent = "×";
      x.addEventListener("click", (e) => {
        e.stopPropagation();
        closeTab(tab.id);
      });
      el.append(ico, name, x);
      el.addEventListener("click", () => activate(tab.id));
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate(tab.id);
        }
      });
      frag.appendChild(el);
    }
    box.replaceChildren(frag);
  }

  // The page behind a tab. Only the files being read keep a live page; the rest are
  // let go of and made again when they are asked for.
  function frameFor(tab) {
    let frame = frames.get(tab.id);
    if (!frame) {
      frame = document.createElement("iframe");
      frame.className = "ws-frame";
      frame.title = tab.name;
      frame.src = tab.src;
      frames.set(tab.id, frame);
      $("ws-main").appendChild(frame);
      while (frames.size > FRAMES) {
        const oldest = frames.keys().next().value;
        if (oldest === tab.id) break;
        const dead = frames.get(oldest);
        if (dead) dead.remove();
        frames.delete(oldest);
      }
    }
    return frame;
  }

  function paintMain() {
    const tab = state.tabs.find((t) => t.id === state.active) || null;
    $("ws-empty").hidden = !!tab;
    for (const [id, frame] of frames) {
      frame.hidden = !tab || id !== tab.id;
    }
    if (tab) {
      const frame = frameFor(tab);
      frame.hidden = false;
    }
  }

  // ── The menu ─────────────────────────────────────────────────────────────

  async function paintRoots() {
    const box = $("ws-roots");
    const frag = document.createDocumentFragment();
    for (const r of roots) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "ws-menu-item" + (r.path === state.root ? " on" : "");
      const text = document.createElement("span");
      const name = document.createElement("div");
      name.textContent = r.name;
      const where = document.createElement("span");
      where.className = "path";
      where.textContent = r.path;
      text.append(name, where);
      item.appendChild(text);
      item.addEventListener("click", async () => {
        state.root = r.path;
        expanded.clear();
        folders.delete(r.path);
        await loadFolder(r.path);
        paintSide();
        paintTree();
        paintRoots();
        save();
        hidePop();
      });
      frag.appendChild(item);
    }
    box.replaceChildren(frag);
  }

  function hidePop() {
    $("ws-pop").hidden = true;
    $("ws-menu-btn").setAttribute("aria-expanded", "false");
    $("ws-menu-btn").classList.remove("on");
  }

  function togglePop() {
    const pop = $("ws-pop");
    const open = pop.hidden;
    pop.hidden = !open;
    $("ws-menu-btn").setAttribute("aria-expanded", String(open));
    $("ws-menu-btn").classList.toggle("on", open);
    if (open) {
      paintRoots();
      $("ws-roots").scrollIntoView({ block: "nearest" });
    }
  }

  // ── A file opened once, from the browser's own picker ────────────────────

  async function openPicked(file) {
    const res = await fetch("/api/temp?name=" + encodeURIComponent(file.name), {
      method: "POST",
      headers: { "X-Mdview-Token": TOKEN },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || "That file could not be opened.");
      return;
    }
    const tab = {
      id: tabId(),
      path: data.url,
      name: file.name,
      kind: kindFromName(file.name),
      src: data.url + "?embed=1",
    };
    state.tabs.push(tab);
    activate(tab.id);
  }

  // ── The menu that comes out of a folder's three dots ─────────────────────

  let folderMenu = null;

  function hideFolderMenu() {
    if (folderMenu) {
      folderMenu.remove();
      folderMenu = null;
    }
  }

  function menuItem(label, onClick) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "ws-menu-item";
    item.textContent = label;
    item.addEventListener("click", () => {
      hideFolderMenu();
      onClick();
    });
    return item;
  }

  // What can be done with a folder, said relative to that folder: the tree can be
  // put there, the folder can join the reader's own, the library can show it.
  function openFolderMenu(path, anchor) {
    hideFolderMenu();
    const menu = document.createElement("div");
    menu.className = "ws-menu";
    menu.setAttribute("role", "menu");

    menu.appendChild(menuItem("Go to this folder", async () => {
      await goTo(path);
    }));

    const isRoot = roots.some((r) => r.path === path);
    if (!isRoot) {
      menu.appendChild(menuItem("Add to the reader", async () => {
        const res = await fetch("/api/add-folder", {
          method: "POST",
          headers: { "X-Mdview-Token": TOKEN, "Content-Type": "application/json" },
          body: JSON.stringify({ path, create: true }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          alert(data.error || "That folder could not be added.");
          return;
        }
        await loadRoots();
        await goTo(data.folder);
      }));
    }

    const inLibrary = roots.some((r) => path === r.path || path.startsWith(r.path + "/"));
    if (inLibrary) {
      menu.appendChild(menuItem("Open in the library", () => {
        location.href = "/library?dir=" + encodeURIComponent(path);
      }));
    }

    menu.appendChild(menuItem("Copy the path", async () => {
      try {
        await navigator.clipboard.writeText(path);
      } catch (e) {
        /* the browser would not give it: nothing to say */
      }
    }));

    document.body.appendChild(menu);
    folderMenu = menu;

    // Beside the dots it came out of, and above them when there is no room below.
    const at = anchor.getBoundingClientRect();
    const height = menu.offsetHeight;
    const width = menu.offsetWidth;
    const top = at.bottom + 6 + height > window.innerHeight ? at.top - height - 6 : at.bottom + 6;
    menu.style.left = Math.max(8, Math.min(at.right - width, window.innerWidth - width - 8)) + "px";
    menu.style.top = Math.max(8, top) + "px";
  }

  // ── The window ───────────────────────────────────────────────────────────

  function paintSideState() {
    document.querySelector(".ws-body").classList.toggle("side-off", !state.side);
    $("ws-side-toggle").setAttribute("aria-pressed", String(state.side));
    $("ws-side-toggle").title = state.side ? "Hide the folders" : "Show the folders";
  }

  async function start() {
    load();
    for (const p of state.open) expanded.add(p);

    await loadRoots();
    paintSide();
    if (state.root) await loadFolder(state.root);
    paintTree();
    paintSideState();

    // The tabs the last visit left open.
    for (const t of state.tabs) {
      if (t.kind == null && t.path && t.path.charAt(0) === "/") {
        // The kind is not remembered between visits; the tree knows it.
        t.kind = await kindOf(t.path);
      }
    }
    if (!state.tabs.some((t) => t.id === state.active)) {
      state.active = state.tabs.length ? state.tabs[0].id : null;
    }
    paintTabs();
    paintMain();

    // A file the address asks for — the extension sends one when a local file is opened.
    const wanted = new URLSearchParams(location.search).get("open");
    if (wanted) {
      history.replaceState(null, "", location.pathname);
      const name = wanted.split("/").pop();
      await reveal(wanted);
      const kind = await kindOf(wanted);
      paintTree();
      openFile(wanted, name, kind);
      const row = $("ws-tree").querySelector('.ws-row[data-path="' + CSS.escape(wanted) + '"]');
      if (row) row.scrollIntoView({ block: "center" });
    }

    // The folders: the way up, a click opens or closes one, a file opens in a tab.
    const useRow = async (row) => {
      if (row.dataset.dir) {
        await toggle(row.dataset.path);
      } else {
        const name = row.querySelector(".name").textContent;
        openFile(row.dataset.path, name, row.dataset.kind || null);
      }
    };
    $("ws-tree").addEventListener("click", async (e) => {
      const up = e.target.closest(".ws-row.up");
      if (up) {
        await goUp(up.dataset.up);
        return;
      }
      const row = e.target.closest(".ws-row");
      if (!row) return;
      await useRow(row);
    });
    $("ws-tree").addEventListener("keydown", async (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const row = e.target.closest(".ws-row");
      if (!row) return;
      e.preventDefault();
      if (row.dataset.up) {
        await goUp(row.dataset.up);
        return;
      }
      await useRow(row);
    });

    // A note that links to another note asks the window above to open it: the file
    // belongs in the tab bar, not in the frame it was linked from.
    window.addEventListener("message", async (e) => {
      if (e.origin !== location.origin) return;
      const data = e.data;
      if (!data || data.type !== "mdview:open" || typeof data.path !== "string") return;
      const path = decodeURIComponent(data.path);
      const name = path.split("/").pop();
      await loadRoots();
      await reveal(path);
      const kind = await kindOf(path);
      paintTree();
      openFile(path, name, kind);
    });

    $("ws-filter").addEventListener("input", paintTree);

    // The rest of the filter: extension, size and when. A control, not a word to
    // remember, and the extensions on offer are the ones the tree really has.
    $("ws-more-btn").addEventListener("click", () => {
      const panel = $("ws-more");
      const open = panel.hidden;
      if (open) fillExtensions();
      panel.hidden = !open;
      $("ws-more-btn").setAttribute("aria-expanded", String(open));
    });
    $("ws-ext").addEventListener("change", (e) => {
      state.ext = e.target.value || "any";
      save();
      paintTree();
    });
    $("ws-size").addEventListener("change", (e) => {
      state.size = e.target.value || "any";
      save();
      paintTree();
    });
    $("ws-when").addEventListener("change", (e) => {
      state.when = e.target.value || "any";
      save();
      paintTree();
    });
    $("ws-clear").addEventListener("click", () => {
      state.kind = "all";
      state.ext = "any";
      state.size = "any";
      state.when = "any";
      $("ws-filter").value = "";
      $("ws-ext").value = "any";
      $("ws-size").value = "any";
      $("ws-when").value = "any";
      for (const c of document.querySelectorAll(".ws-chip")) c.classList.toggle("on", (c.dataset.kind || "all") === "all");
      save();
      paintTree();
    });

    // The kinds of file to show: all of them, or one kind at a time.
    for (const chip of document.querySelectorAll(".ws-chip")) {
      chip.addEventListener("click", () => {
        state.kind = chip.dataset.kind || "all";
        for (const c of document.querySelectorAll(".ws-chip")) c.classList.toggle("on", c === chip);
        save();
        paintTree();
      });
    }
    // The kind the last visit was left on.
    for (const chip of document.querySelectorAll(".ws-chip")) {
      chip.classList.toggle("on", (chip.dataset.kind || "all") === (state.kind || "all"));
    }
    $("ws-size").value = state.size || "any";
    $("ws-when").value = state.when || "any";

    $("ws-add").addEventListener("click", () => $("ws-pick").click());
    $("ws-pick").addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (file) openPicked(file);
    });

    // A file dropped on the window is opened like one picked from the disk.
    document.addEventListener("dragover", (e) => e.preventDefault());
    document.addEventListener("drop", (e) => {
      e.preventDefault();
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) openPicked(file);
    });

    $("ws-menu-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      togglePop();
    });
    // The mark beside the folder's name opens the same list: the folders the reader shows.
    $("ws-roots-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      togglePop();
    });
    document.addEventListener("click", (e) => {
      if (e.target && e.target.closest && !e.target.closest("#ws-pop")) hidePop();
      if (folderMenu && e.target && e.target.closest && !e.target.closest(".ws-menu")) hideFolderMenu();
    });

    $("ws-side-toggle").addEventListener("click", () => {
      state.side = !state.side;
      paintSideState();
      save();
    });

    $("ws-go-library").addEventListener("click", () => {
      location.href = "/library";
    });

    // The folder to show: a path in a dialog of its own. The dialog does two things
    // with the answer — look at that folder, or add it to the reader's own so that it
    // is there next time. Which of the two is offered first is what the reader asked
    // for when the dialog opened.
    function openFolderDialog(prefer) {
      hidePop();
      const dialog = $("ws-folder-dialog");
      const input = $("ws-folder-path");
      const error = $("ws-folder-error");
      input.value = state.root || "";
      error.textContent = "";
      error.hidden = true;
      dialog.classList.toggle("prefer-add", prefer === "add");
      dialog.classList.toggle("prefer-go", prefer !== "add");
      dialog.showModal();
      input.focus();
      input.select();
    }

    $("ws-go-folder").addEventListener("click", () => openFolderDialog("go"));
    $("ws-add-folder").addEventListener("click", () => openFolderDialog("add"));
    // The folder's own name: the way to point the tree somewhere else.
    $("ws-root-name").addEventListener("click", () => openFolderDialog("go"));

    $("ws-folder-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const dialog = $("ws-folder-dialog");
      const input = $("ws-folder-path");
      const error = $("ws-folder-error");
      const what = e.submitter ? e.submitter.value : "go";
      if (what === "cancel") {
        dialog.close();
        return;
      }
      const value = input.value.trim();
      if (!value) {
        error.textContent = "The folder needs a path.";
        error.hidden = false;
        return;
      }
      if (what === "add") {
        const res = await fetch("/api/add-folder", {
          method: "POST",
          headers: { "X-Mdview-Token": TOKEN, "Content-Type": "application/json" },
          body: JSON.stringify({ path: value, create: true }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          error.textContent = data.error || "That folder could not be added.";
          error.hidden = false;
          return;
        }
        await loadRoots();
        await goTo(data.folder);
        dialog.close();
        return;
      }
      // Go there: the tree shows that folder, and the reader remembers it.
      const res = await fetch("/api/tree?path=" + encodeURIComponent(value));
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        error.textContent = data.error || "That folder isn't there.";
        error.hidden = false;
        return;
      }
      await goTo(data.path);
      dialog.close();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        hidePop();
        hideFolderMenu();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        state.side = !state.side;
        paintSideState();
        save();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
