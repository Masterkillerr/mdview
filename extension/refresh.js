// mdview — what runs in the background. It sends a local .md, .html, .pdf or picture
// file to the reader on this machine (the local server in ~/mdview-app),
// keeps the "Define with mdview" menu item, and answers the dictionary requests the
// definition page makes. Chrome runs this as a service worker, which takes its extra
// scripts this way; Firefox loads dictionaries.js from the manifest's background list.
if (typeof importScripts === "function") importScripts("dictionaries.js");

(function () {
  "use strict";

  const api = typeof browser !== "undefined" ? browser : typeof chrome !== "undefined" ? chrome : null;
  if (!api || !api.tabs) return;

  const READER = "http://mdview.localhost:8765";
  // A spreadsheet is deliberately not here. Firefox decides a .xlsx is not something it
  // can show and hands it to an application, so no tab is ever created for the add-on to
  // rewrite; the reader's library, its Open button, and a desktop handler are what bring
  // those files in. Adding the type here only made it look handled.
  // The files the reader is sent. Firefox only opens the ones it is willing to show as
  // text — the rest are downloaded before there is a tab to send — so this is the list
  // of kinds the browser will open, not every kind the reader knows how to read.
  const LOCAL_FILE = /\.(md|markdown|mdown|mkd|html?|pdf|png|jpe?g|gif|webp|svg|txt|text|log|json|jsonl|ndjson|csv|tsv|js|mjs|cjs|jsx|ts|tsx|css|scss|less|xml|yml|yaml|toml|ini|cfg|conf|py|rb|sh|bash|zsh|pl|php|java|kt|go|rs|c|h|cc|cpp|hpp|cs|swift|lua|sql|diff|patch|ipynb)$/i;

  // The reader's address for a local file: the workspace, with the file named in the
  // address so it opens in a tab there, beside the folders it belongs to.
  function readerUrl(fileUrl) {
    const path = decodeURIComponent(new URL(fileUrl).pathname);
    return READER + "/?open=" + encodeURIComponent(path);
  }

  // Each file's tab is sent once. A tab reports its address several times while it loads,
  // and sending it again while it is on its way restarts the load every time.
  const sent = new Map();
  if (api.tabs.onUpdated) {
    api.tabs.onUpdated.addListener((tabId, change, tab) => {
      if (change.url && !/^file:/i.test(change.url)) sent.delete(tabId);
      const url = (change.url || (change.status === "complete" && tab && tab.url) || "").replace(/[#?].*$/, "");
      if (!/^file:\/\/\//i.test(url) || !LOCAL_FILE.test(url) || sent.get(tabId) === url) return;
      sent.set(tabId, url);
      api.tabs.update(tabId, { url: readerUrl(url) });
    });
    if (api.tabs.onRemoved) api.tabs.onRemoved.addListener((tabId) => sent.delete(tabId));
  }

  // The toolbar button opens the reader's library.
  if (api.browserAction && api.browserAction.onClicked) {
    api.browserAction.onClicked.addListener(() => api.tabs.create({ url: READER + "/" }));
  }

  // The definition page asks for dictionaries through here, and only these hosts are allowed.
  const DEFINE_HOSTS = ["api.dictionaryapi.dev", "api.datamuse.com", "en.wiktionary.org"];
  function allowedDefineUrl(raw) {
    let url;
    try {
      url = new URL(raw);
    } catch (e) {
      return null;
    }
    if (url.protocol !== "https:") return null;
    return DEFINE_HOSTS.indexOf(url.hostname) === -1 ? null : url.href;
  }

  if (api.runtime && typeof api.runtime.onMessage === "object" && api.runtime.onMessage) {
    api.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || message.type !== "mdview:fetch") return undefined;
      const url = allowedDefineUrl(message.url);
      if (!url) {
        sendResponse({ ok: false, status: 0 });
        return undefined;
      }
      fetch(url, { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" })
        .then((res) => (res.ok ? res.text() : Promise.reject(new Error(String(res.status)))))
        .then((text) => sendResponse({ ok: true, text: text }))
        .catch((e) => sendResponse({ ok: false, status: 0, error: String((e && e.message) || e) }));
      return true;
    });
  }

  // "Define with mdview" on any selected text, in any tab. The language is the reader's
  // choice if one is stored; otherwise a selection of a few words is detected, and a single
  // word is English.
  function languageFor(text) {
    return api.storage.local
      .get("mdview:lang")
      .then((res) => {
        const pref = res && res["mdview:lang"];
        if (pref === "en" || pref === "es") return pref;
        if (String(text).trim().split(/\s+/).length < 5) return "en";
        return api.i18n.detectLanguage(text).then((found) => (pickLanguage(found) === "es" ? "es" : "en"));
      })
      .catch(() => "en");
  }

  if (api.menus && api.menus.onClicked) {
    api.menus
      .removeAll()
      .then(() => api.menus.create({ id: "mdview-define", title: "Define “%s” with mdview", contexts: ["selection"] }));
    // The card opens on the page, at the selected word, the same card the reader shows. The
    // page has its own colours, often under the same names (--accent, --ink), so the card's
    // own are pinned on the card. Where a page cannot be scripted (Firefox's own pages, its
    // PDF viewer, the add-ons site) the definition opens in a tab as before.
    const CARD_COLOURS = `.mdview-define {
      --ink: #1a1a1a; --card: #ffffff; --line: #e2e2e2; --line-strong: #c8c8c8;
      --muted: #555555; --faint: #666666; --accent: #1f4f82;
      --accentline: rgba(31, 79, 130, 0.3); --accenttint: rgba(31, 79, 130, 0.08);
      --zebra: #fafafa; --radius: 10px; --radius-sm: 6px; --radius-xs: 4px;
      --float-shadow: 0 1px 2px rgba(0, 0, 0, 0.06), 0 12px 28px -18px rgba(0, 0, 0, 0.45);
      --ui-size: 16px; --md-font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      --md-font-head: var(--md-font); --select-bg: rgba(31, 79, 130, 0.2);
      color-scheme: light; z-index: 2147483647;
    }`;
    const OPEN_HERE = `(() => {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount || !window.MdviewLookup) return false;
      window.MdviewLookup.setRoot("body");
      window.MdviewLookup.open(sel.getRangeAt(0).cloneRange(), sel.toString());
      return true;
    })()`;
    const inTab = (text) =>
      languageFor(text).then((lang) =>
        api.tabs.create({ url: api.runtime.getURL("define.html") + "?word=" + encodeURIComponent(text) + "&lang=" + lang })
      );
    api.menus.onClicked.addListener((info, tab) => {
      if (info.menuItemId !== "mdview-define" || !info.selectionText) return;
      const text = info.selectionText;
      if (!tab || tab.id == null || tab.id < 0) return inTab(text);
      const where = { frameId: info.frameId || 0 };
      api.tabs
        .insertCSS(tab.id, { ...where, file: "lookup.css" })
        .then(() => api.tabs.insertCSS(tab.id, { ...where, code: CARD_COLOURS }))
        // The card asks the same questions on a page that it asks in the reader, and the
        // two answers it cannot give by itself — which language the text is in, and what
        // Spanish Wiktionary says — live in dictionaries.js. Injected every time, so the
        // file has to survive being injected twice into one sandbox.
        .then(() => api.tabs.executeScript(tab.id, { ...where, file: "dictionaries.js" }))
        .then(() => api.tabs.executeScript(tab.id, { ...where, file: "lookup.js" }))
        .then(() => api.tabs.executeScript(tab.id, { ...where, code: OPEN_HERE }))
        .then((done) => { if (!done || !done[0]) inTab(text); })
        .catch(() => inTab(text));
    });
  }
})();
