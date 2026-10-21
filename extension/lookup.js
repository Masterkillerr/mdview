// lookup — the word lookup card: select or double-click a word and a card with its
// definitions, pronunciation and senses opens beside it.
//
// Shared by two apps, and kept in one place for that reason: mdview (this folder) loads it
// before mdview.js, and Bookshelf's PDF reader carries a copy synced from here. Nothing in
// it knows about either app. The host says where readable text is (setRoot), and either
// lets the module listen for double-clicks (attach) or opens the card itself (open), as
// Bookshelf does from its selection bar.
//
//   MdviewLookup.setRoot(".textLayer")        what counts as text to look up
//   MdviewLookup.attach(doc, { neighbours })  double-click / select-to-look-up in doc
//   MdviewLookup.open(range, text)            open the card for a range the host has
//   MdviewLookup.close()
//   MdviewLookup.reposition()                 after the host changes its layout
(function () {
  "use strict";
  if (typeof window === "undefined" || window.MdviewLookup) return;

  // looked for in sibling files only when the host asks (mdview's notes folder)
  let NEIGHBOURS = false;

  // Whether a mono-set block counts as readable text. In a note it does not: a fenced
  // block is code, and a word in code means what that code means, not what a dictionary
  // says. A page of HTML shown as its author wrote it is a different case — its code
  // samples *are* the document — so the host that shows those asks for them.
  let CODE = false;

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

  function button(className, label, title) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = className;
    el.textContent = label;
    if (title) el.title = title;
    return el;
  }

  // the host's "layout changed" signal, forwarded by reposition()
  const REMEASURE_HOOKS = [];
  function onRemeasure(fn) {
    REMEASURE_HOOKS.push(fn);
  }

  /* -------------------------------------------------------- define a word -- */

  // A double-click on a word, answered with the word's definition in a card under
  // the word — the gesture Google put in every reader and that a local-file
  // viewer had no honest answer for until now.
  //
  // What leaves the machine, and why that is the right trade: the word the reader
  // double-clicked, to a dictionary, and nothing else. Not the file it came from,
  // not the file's name, not the rest of the selection, not a user id, not a
  // cookie — there is no identifier to correlate, because nothing is stored
  // beyond the definition the reader already has on screen. It is still a word
  // leaving the machine, which is why it is a deliberate double-click rather than
  // a hover, why the card always names its source, and why the toolbar can turn
  // the whole thing off.
  const DEFINE_MS = 4500;
  const DEFINE_MEM_MAX = 64;
  const DEFINE_LOCAL_MAX = 8;
  const DEFINE_MEM = new Map();
  const DEFINE_DISK = "mdview:def:";
  // Shared with the toolbar panel, which is the reader's way to turn this off.
  const DEFINE_KEY = "mdview:define";
  // What counts as readable text for the lookup: a rendered .md is `.doc`, a plain
  // .html page is its `body`, and a PDF's words are the `.textLayer` pdfview.js draws.
  let DEFINE_ROOT = ".doc";
  // How many senses the expanded card will actually list. `strike` has
  // seventy-one, and a scrollable column of seventy-one definitions is the same
  // exhaustion as the one this card exists to end: the reader came for one word
  // and would be reading a thesaurus. Past this the count is said out loud, and
  // the link at the foot of the card is the way to the rest.
  const DEFINE_LIST_MAX = 20;

  // Two providers, raced rather than chained. The rich one — phonetics, parts of
  // speech, usage examples — is the reason this is worth doing at all, but it is
  // one person's free service and it spends real stretches of time returning
  // Cloudflare 521, which is exactly when a reader most wants the word. The thin
  // one is Princeton's Datamuse: one-line definitions, no phonetics, and it has
  // never been observed down. Whichever answers is the card, and the card says
  // which one it came from rather than implying a pedigree it does not have.
  const DEFINE_PROVIDERS = [
    {
      name: "Free Dictionary",
      hold: 0,
      page: (w) => "https://dictionaryapi.dev/dictionary/" + encodeURIComponent(w),
      url: (w) => "https://api.dictionaryapi.dev/api/v2/entries/en/" + encodeURIComponent(w),
      parse(data, word) {
        const entry = Array.isArray(data) ? data[0] : data;
        if (!entry || !Array.isArray(entry.meanings)) return null;
        const senses = [];
        for (const meaning of entry.meanings) {
          for (const def of meaning.definitions || []) {
            if (!def || !def.definition) continue;
            senses.push({
              pos: String(meaning.partOfSpeech || ""),
              def: cleanDef(def.definition),
              example: def.example ? String(def.example) : "",
            });
          }
        }
        let phonetic = entry.phonetic || "";
        if (!phonetic && Array.isArray(entry.phonetics)) {
          for (const p of entry.phonetics) {
            if (p && p.text) {
              phonetic = String(p.text);
              break;
            }
          }
        }
        return senses.length ? { word: String(entry.word || word), phonetic: phonetic, senses: senses } : null;
      },
    },
    {
      name: "Datamuse",
      // Held back a moment, not because it is worse but because when the rich one
      // is up it is the better answer and a third of a second is not a wait.
      hold: 350,
      page: (w) => "https://www.datamuse.com/words/" + encodeURIComponent(w),
      url: (w) => "https://api.datamuse.com/words?sp=" + encodeURIComponent(w) + "&md=d&max=1",
      parse(data, word) {
        const entry = Array.isArray(data) ? data[0] : data;
        if (!entry || !Array.isArray(entry.defs) || !entry.defs.length) return null;
        const senses = [];
        for (const raw of entry.defs) {
          // "adj\tLasting for a short period of time."
          const at = String(raw).indexOf("\t");
          const tag = at === -1 ? "" : String(raw).slice(0, at).trim();
          senses.push({
            pos: DEFINE_POS[tag] || tag,
            def: cleanDef(at === -1 ? String(raw) : String(raw).slice(at + 1)),
            example: "",
          });
        }
        return senses.length ? { word: String(entry.word || word), phonetic: "", senses: senses } : null;
      },
    },
  ];

  function defineTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error("define: timeout"));
      }, ms);
      promise.then(
        (v) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(e);
        }
      );
    });
  }

  // Asked from the page first, because that is the only route available in the
  // preview harness, and because a `file://` page has no usable origin. Under the
  // add-on the fetch is handed to the background script instead, which carries the
  // host permissions and so is immune to both the page's CSP and to whatever the
  // dictionary decides to send back — a provider that forgot its CORS header must
  // not be the difference between the card working and not.
  // "the add-on did not answer", as distinct from "the dictionary answered and did
// not have the word". Conflating the two costs a second request for every miss.
  const NO_BACKGROUND = { noBackground: true };

  function defineFetch(url) {
    const api =
      typeof browser !== "undefined" ? browser : typeof chrome !== "undefined" ? chrome : null;
    const direct = () =>
      fetch(url, { credentials: "omit", referrerPolicy: "no-referrer" }).then((r) =>
        r.ok ? r.json() : null
      );
    if (api && api.runtime && typeof api.runtime.sendMessage === "function") {
      // Firefox answers with a promise; Chrome with a callback. One shape here,
      // as everywhere else in this file.
      const viaBackground = new Promise((resolve) => {
        let settled = false;
        const done = (res) => {
          if (settled) return;
          settled = true;
          // no answer at all: the add-on is not the one replying, which is the
          // preview harness, and the page's own fetch is then the only route left
          if (!res) return resolve(NO_BACKGROUND);
          if (!res.ok || typeof res.text !== "string") return resolve(null);
          try {
            resolve(JSON.parse(res.text));
          } catch (e) {
            resolve(null);
          }
        };
        try {
          const p = api.runtime.sendMessage({ type: "mdview:fetch", url: url }, done);
          if (p && typeof p.then === "function") p.then(done, () => done(null));
        } catch (e) {
          done(null);
        }
      });
      return viaBackground.then((data) => (data === NO_BACKGROUND ? direct() : data));
    }
    return direct();
  }

  /* ------------------------------------------------- the reader's own glossary -- */

  // What the dictionary has no entry for is not usually a rare word — it is an
  // acronym, a proper noun, a product name, or a phrase. Those are exactly the
  // words a reader of their own notes has already written down somewhere, so the
  // last place asked is the reader's own files: this document first (free, already
  // parsed and on screen), and then its neighbours.
  function localIndex(doc) {
    const index = new Map();
    const put = (term, text) => {
      const key = String(term || "").replace(/\s+/g, " ").trim().toLowerCase();
      if (!key || key.length > 60 || index.has(key)) return;
      index.set(key, { pos: "", def: String(text || "").replace(/\s+/g, " ").trim(), example: "" });
    };

    // A heading that is just a term, defined by whatever follows it. This is the
    // shape of a glossary file, and it is also the shape of the dictionary
    // definition this reader wrote for themselves.
    for (const head of doc.querySelectorAll("h2, h3, h4")) {
      // The anchor link and the fold control are inside the heading by now —
      // `addFolds` has already run — and their text is chrome, not the term. A
      // glossary term indexed as `Memory Management#▾` can never be matched by
      // anything the reader selects.
      const copy = head.cloneNode(true);
      for (const extra of copy.querySelectorAll(".anchor, .fold")) extra.remove();
      const term = (copy.textContent || "").replace(/\s+/g, " ").trim();
      if (!term || term.length > 60 || /[.?!:;,]$/.test(term)) continue;
      let node = head.nextElementSibling;
      let text = "";
      while (node && !/^H[1-4]$/.test(node.tagName)) {
        if (node.matches("ul, ol, p, blockquote")) text += " " + (node.textContent || "");
        node = node.nextElementSibling;
      }
      const clean = text.replace(/\s+/g, " ").trim();
      if (clean) put(term, clean.slice(0, 400));
    }

    // `<dt>`/`<dd>` — a definition list written the way HTML means it.
    for (const dt of doc.querySelectorAll("dt")) {
      const dd = dt.nextElementSibling;
      if (dd && dd.tagName === "DD") put(dt.textContent, dd.textContent);
    }

    // `**Term** — the rest of the line`, and the `**Term:** rest` form mdview
    // already treats as a labeled line. Both are one line of text in a document
    // the reader owns, and both name a term before they explain it.
    for (const el of doc.querySelectorAll("li, p, td, dd")) {
      const strong = el.querySelector(":scope > strong");
      if (!strong) continue;
      const term = (strong.textContent || "").replace(/[:\uFF1A]\s*$/, "").trim();
      if (!term || term.length > 60) continue;
      const rest = (el.textContent || "").slice((strong.textContent || "").length);
      if (rest.trim()) put(term, rest.trim());
    }

    // `.def-term`/`.def-desc` is mdview's own restatement of the last shape, and
    // it exists precisely when the source was one of those lines.
    for (const cell of doc.querySelectorAll(".def-term")) {
      const desc = cell.nextElementSibling;
      if (desc && desc.classList.contains("def-desc")) {
        put((cell.textContent || "").replace(/[:\uFF1A]\s*$/, ""), desc.textContent);
      }
    }
    return index;
  }

  // Raw markdown, for files that are not on screen. Deliberately small: the same
  // three shapes, matched with expressions rather than with the renderer, because
  // rendering forty documents to look up one acronym is not a trade worth making.
  function localIndexFromText(text) {
    const index = new Map();
    const put = (term, body) => {
      const key = String(term || "").replace(/\s+/g, " ").trim().toLowerCase();
      if (!key || key.length > 60 || index.has(key)) return;
      index.set(key, { pos: "", def: String(body || "").replace(/\s+/g, " ").trim(), example: "" });
    };
    const lines = String(text || "").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const head = /^(#{1,4})\s+(.+?)\s*$/.exec(lines[i]);
      if (head) {
        const term = head[2].replace(/[:*_`]/g, "").trim();
        let body = "";
        for (let j = i + 1; j < lines.length && j < i + 6; j++) {
          if (/^\s*$/.test(lines[j])) continue;
          if (/^#{1,4}\s/.test(lines[j])) break;
          body += " " + lines[j].replace(/^\s*(?:[-*+]|\d+\.)\s+/, "").replace(/[*_`]/g, "");
        }
        if (term && body.trim()) put(term, body.trim().slice(0, 400));
      }
      const inline = /^\s*(?:[-*+]|\d+\.)\s+\*\*(.+?)\*\*\s*(?:[:\uFF1A-]\s*)?(.+)$/.exec(lines[i]);
      if (inline) put(inline[1].replace(/[:\uFF1A]\s*$/, "").trim(), inline[2]);
    }
    return index;
  }

  // `file://` has no way to ask what is in a directory, so the neighbours are
  // found the only way they can be: by asking for the directory itself, which
  // Firefox answers with a listing. Capped hard, tried only when the dictionary
  // has already said it does not know the word, and entirely optional — on an
  // engine that will not list the directory it simply finds nothing and the card
  // falls back to the search link, which is a perfectly good answer.
  let localNeighbours = null;
  async function neighbourIndexes() {
    if (!NEIGHBOURS) return [];
    if (localNeighbours) return localNeighbours;
    localNeighbours = (async () => {
      const dir = location.pathname.replace(/[^/]*$/, "");
      if (!dir) return [];
      let listing;
      try {
        const res = await fetch(decodeURIComponent(dir) + "/", { credentials: "omit" });
        if (!res.ok) return [];
        listing = await res.text();
      } catch (e) {
        return [];
      }
      const names = [];
      const re = /href="([^"]+\.md(?:own)?)"/gi;
      let m;
      while ((m = re.exec(listing)) && names.length < DEFINE_LOCAL_MAX) {
        const name = decodeURIComponent(m[1].replace(/^\.\//, "")).split("/").pop();
        if (name && name !== location.pathname.split("/").pop() && names.indexOf(name) === -1) {
          names.push(name);
        }
      }
      const out = [];
      for (const name of names) {
        try {
          const res = await fetch(dir + encodeURIComponent(name), { credentials: "omit" });
          if (!res.ok) continue;
          const index = localIndexFromText(await res.text());
          if (index.size) out.push(index);
        } catch (e) {
          /* a file that will not read is not a reason to fail the lookup */
        }
      }
      return out;
    })();
    return localNeighbours;
  }

  /* ------------------------------------------------------------ the lookup -- */

  function defineCacheGet(word) {
    if (DEFINE_MEM.has(word)) return DEFINE_MEM.get(word);
    return null;
  }

  function defineCachePut(word, value) {
    DEFINE_MEM.delete(word);
    DEFINE_MEM.set(word, value);
    while (DEFINE_MEM.size > DEFINE_MEM_MAX) DEFINE_MEM.delete(DEFINE_MEM.keys().next().value);
    storeSet(DEFINE_DISK + word, value);
  }

  // The first provider to *answer* wins; the first to fail does not. Settling on
  // the first negative result is the bug this shape is written against: the rich
  // provider is down, it fails in a fifth of a second, and a race that resolves
  // there never lets the held-back provider — which has not even started yet — say
  // that it knows the word. So a miss is only a miss once every provider has
  // finished, and `upgrade` lets a slower, better answer still replace the card
  // the reader is already looking at.
  async function defineRemote(word, upgrade) {
    return new Promise((resolve) => {
      let settled = false;
      let left = DEFINE_PROVIDERS.length;
      let best = null;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(best);
      }, DEFINE_MS + 600);

      for (const provider of DEFINE_PROVIDERS) {
        (async () => {
          if (provider.hold) await new Promise((r) => setTimeout(r, provider.hold));
          try {
            const data = await defineTimeout(defineFetch(provider.url(word)), DEFINE_MS);
            const hit = data ? provider.parse(data, word) : null;
            if (hit) {
              const result = { source: provider.name, page: provider.page(word), url: word, ...hit };
              if (!best) {
                best = result;
                if (!settled) {
                  settled = true;
                  clearTimeout(timer);
                  resolve(best);
                }
              } else if (settled && upgrade) {
                upgrade(result);
              }
            }
          } catch (e) {
            /* a provider that is down is the expected case, not an error */
          }
          if (--left === 0 && !settled) {
            settled = true;
            clearTimeout(timer);
            resolve(best);
          }
        })();
      }
    });
  }

  /* Whether a provider's answer is about the thing that was asked. Needed
     because `sp=` on Datamuse is a spelling *search*, not an equality test: asked
     for "emblem on" it returns the entry for "embleton" (measured, not read —
     `sp=emblem%20on` answers `{"word": "embleton"}` with five senses about a
     village in Northumberland, while `sp=emblem` answers with the emblem).
     A different word's senses under this word's headword is the worst thing this
     card can do, and for a *phrase* there is no honest label for it — "of
     emblem on" is not a form of "emblem", it is a phrase that does not exist.
     So a phrase answer must be the phrase; a bare word's may still be a lemma,
     because "asked for *gave*, shown as of give" is a true and useful thing to
     say, and that path already checks it. */
  function defineAnswers(asked, word) {
    const a = String(asked == null ? "" : asked).replace(/\s+/g, " ").trim().toLowerCase();
    const b = String(word == null ? "" : word).replace(/\s+/g, " ").trim().toLowerCase();
    return !!a && a === b;
  }

  /* Whether an entry has any claim on the sentence it was read in. Not the
     ranking's question — `senseScore` weighs part of speech, field and length,
     and never a single word, because a definition and the prose around it rarely
     share vocabulary — but the one thing the homograph probe below needs to know
     before it goes looking for another answer. */
  function defineTouches(senses, ctx) {
    if (!ctx || !ctx.text) return false;
    const words = new Set(String(ctx.text).match(/[a-z]{4,}/g) || []);
    if (!words.size) return false;
    return (senses || []).some((s) =>
      (String((s && s.def) || "").toLowerCase().match(/[a-z]{4,}/g) || []).some((w) => words.has(w))
    );
  }

  const defineAllNoun = (senses) => {
    const list = (senses || []).filter((s) => s && s.def);
    return !!list.length && list.every((s) => String(s.pos || "").toLowerCase() === "noun");
  };

  /* ------------------------------------------------------- the language -- */

  // The language the lookup answers in. The reader's choice in the toolbar panel
  // wins; otherwise the page's own words decide. Only Spanish changes the answer:
  // any other language keeps the English dictionaries, as it always has.
  const LANG_KEY = "mdview:lang";
  // how much of the page is read to tell its language, and the least that is enough
  // to decide on; with less than that there is nothing to decide on, so English
  const DETECT_WORDS = 200;
  const DETECT_LEAST = 40;
  let DOC_LANG = null;

  async function documentLanguage() {
    const pref = await storeGet(LANG_KEY);
    if (pref === "en" || pref === "es") return pref;
    if (DOC_LANG) return DOC_LANG;
    const words = [...document.querySelectorAll(DEFINE_ROOT)]
      .map((el) => el.innerText || el.textContent || "")
      .join(" ")
      .split(/\s+/)
      .filter(Boolean);
    if (words.length < DETECT_LEAST) return "en";
    const found = await detectLanguageOf(words.slice(0, DETECT_WORDS).join(" "));
    if (found) DOC_LANG = found;
    return found === "es" ? "es" : "en";
  }

  // The browser's own detector. The text is read on this machine, not sent anywhere.
  async function detectLanguageOf(text) {
    try {
      const i18n = (typeof browser !== "undefined" ? browser : chrome).i18n;
      return pickLanguage(await i18n.detectLanguage(text));
    } catch (e) {
      return null;
    }
  }

  // Spanish is answered from English Wiktionary's Spanish entry, with the definitions
  // written in English. None of the English rules (phrases, ranking by the sentence,
  // asking a base form) apply to it: Spanish is inflected differently and Wiktionary
  // says for itself which word an entry is only a form of.
  const WIKTIONARY = "https://en.wiktionary.org/api/rest_v1/page/definition/";

  // Wiktionary's titles are case-sensitive past the first letter, and a Spanish page
  // files an acronym under the capitals the reader saw: "IA" is "initialism of
  // inteligencia artificial", while "ia" is an ISO language code. So the spelling the
  // reader read is asked too, and only when the lowercased one had nothing to say.
  async function spanishLookup(word, cased) {
    const spelled = String(cased == null ? "" : cased);
    const spellings =
      spelled && spelled !== word && spelled.slice(1) !== word.slice(1)
        ? [word, spelled]
        : [word];
    let hit = null;
    for (const term of spellings) {
      hit = await spanishEntry(term);
      if (hit) break;
    }
    if (!hit) return null;
    /* Wiktionary files a plural or a feminine form as an entry whose senses only point
       at the word the reader meant — "interlocutoras" is "plural of interlocutora" —
       and a signpost is not a definition, so the word it points at is asked instead.
       Two steps is the ceiling: "interlocutoras" points at a form of "interlocutor".
       An acronym is not a signpost (its initialism *is* the answer) and neither is an
       entry that has anything of its own to say, so neither is followed. */
    const seen = [word];
    for (let step = 0; step < 2; step++) {
      const lemma = spanishLemma(hit.senses);
      if (!lemma || seen.indexOf(lemma) > -1) break;
      seen.push(lemma);
      const next = await spanishEntry(lemma);
      if (!next) break;
      next.of = lemma;
      hit = next;
    }
    return hit;
  }

  /* The word an entry only points at, when every sense it has is such a pointer and
     they all point at the same word. How those pointers read in the Spanish entries
     of English Wiktionary — an acronym is deliberately not one of them: "IA is
     initialism of inteligencia artificial" is the answer itself, and asking for
     "inteligencia artificial" would find nothing at all. */
  const ES_POINTS_AT =
    /^(?:plural|singular|feminine|masculine|feminine plural|masculine plural|female equivalent|male equivalent|alternative letter-case form|alternative form|alternative spelling|misspelling|past participle|present participle|gerund|diminutive|augmentative) of\s+(.+)$/i;

  // "" for an entry that has anything of its own to say, and for one whose senses
  // point at different words: which of them the reader meant is not a question the
  // shape of a word can answer.
  function spanishLemma(senses) {
    let lemma = "";
    for (const sense of senses || []) {
      const m = ES_POINTS_AT.exec(String((sense && sense.def) || "").trim());
      if (!m) return "";
      const word = m[1].replace(/\s*[("“].*$/, "").trim().toLowerCase();
      if (!word || (lemma && lemma !== word)) return "";
      lemma = word;
    }
    return lemma;
  }

  async function spanishEntry(word) {
    // dictionaries.js is loaded wherever this file is, with one exception: the page the
    // add-on injects the card into carries this file alone. Without the parser the entry
    // cannot be read, and "no Spanish entry" is then the true answer rather than a lookup
    // left waiting on a function that is not there.
    if (typeof wiktionarySpanish !== "function") return null;
    const key = "es:" + word;
    const memo = defineCacheGet(key);
    if (memo) return memo;
    const data = await defineTimeout(defineFetch(WIKTIONARY + encodeURIComponent(word)), DEFINE_MS).catch(() => null);
    const hit = data ? wiktionarySpanish(data, word) : null;
    if (!hit) return null;
    const result = {
      source: "Wiktionary",
      page: "https://en.wiktionary.org/wiki/" + encodeURIComponent(word) + "#Spanish",
      url: word,
      ...hit,
    };
    defineCachePut(key, result);
    return result;
  }

  async function defineLookup(word, upgrade, ctx, lang) {
    const key = word.toLowerCase();
    // A word clicked inside a definition starts on the English side whatever the page
    // is written in, because the card's own text is English — but it is not the last
    // word: that is what still answers the Spanish word a card says it is "of".
    const language = lang || (await documentLanguage());
    /* A file is not always in one language: a Spanish report quotes English, a note is
       titled in English and written in Spanish. A lookup that stopped at the language
       the page was counted as left the reader with "no definition" for a word the
       dictionaries do have, so the other side is asked before giving up — and because
       an English definition of a Spanish word (or the reverse) is not the answer the
       page's language promised, the card says which language it had to answer from. */
    if (language === "es") {
      const es = await spanishLookup(key, word);
      if (es) return es;
      const en = await englishLookup(key, upgrade && ((r) => upgrade(languageOf(r, "English"))), ctx);
      return languageOf(en, "English");
    }
    const en = await englishLookup(key, upgrade, ctx);
    if (en) return en;
    return languageOf(await spanishLookup(key, word), "Spanish");
  }

  // An answer from the other language than the page is read as coming from it.
  function languageOf(hit, language) {
    return hit && hit.source ? { ...hit, source: hit.source + " (" + language + ")" } : hit;
  }

  async function englishLookup(key, upgrade, ctx) {
    // a phrase's base form is its verb's: "watches over" is filed as "watch over"
    const parts = key.split(/\s+/);
    const head = parts.length > 1 ? baseForm(parts[0]) : "";
    const base = parts.length > 1 ? (head ? head + " " + parts.slice(1).join(" ") : "") : baseForm(key);
    // One ordering pass over the answer, at one place, so that the card, the cache
    // and any better answer arriving later are all in the same order.
    const finish = (result) => {
      // The sentence decides the order of a word's senses because a word has
      // dozens and the sentence is the only evidence. A phrase is not in that
      // position: the reader named the verb, and a verb the dictionary files under
      // "end up" is one verb. Re-ranking there can only demote the sense the
      // reader is reading — "ended up" leads with "to turn out", which the
      // ranking scored below "to bring to a conclusion" for being a long sentence.
      // Measured on five phrases the provider's own order was right five times and
      // the one it lost ("work out") was a sense no ranking here could have found.
      result.senses = result.ordered ? dedupeSenses(result.senses) : orderSenses(result.senses, ctx);
      return result;
    };

    const memo = defineCacheGet(key);
    if (memo) return finish(memo);

    // Before the bare word, because the bare word is not what the reader was
    // reading: asked for "ended" the card says "to bring to an end", and asked for
    // "end up" it says "to come to a final place or situation; to turn out" — which
    // is the sentence. Costs one extra request, and only when the text beside the
    // word shows a particle, so a word with no particle beside it is asked once, as
    // it always was. The card names the phrase it asked, the same way it already
    // names the base form.
    if (ctx && ctx.phrases) {
      for (const phrase of ctx.phrases) {
        const alt = defineCacheGet(phrase) || (await defineRemote(phrase, null));
        if (sensesUsable(alt && alt.senses) && defineAnswers(phrase, alt.word)) {
          alt.of = phrase;
          alt.ordered = true;
          // cached under the phrase and not under the word: whether "ended" is a
          // phrase or a verb depends on the sentence it was read in, and a reader
          // who meets "ended" again elsewhere should not be handed this answer
          defineCachePut(phrase, alt);
          return finish(alt);
        }
      }
    }

    const remote = await defineRemote(key, (r) => {
      if (upgrade) upgrade(finish({ ...r }));
    });
    if (remote) {
      finish(remote);
      // A word the dictionary only knows as a name or as a form is not an answer
      // to a reader in the middle of a sentence, so the base form is asked
      // instead — and it says so on the card.
      if (!sensesUsable(remote.senses)) {
        if (base) {
          const alt = await defineRemote(base, null);
          if (sensesUsable(alt && alt.senses)) {
            alt.of = base;
            defineCachePut(key, alt);
            return finish(alt);
          }
        }
      }
      defineCachePut(key, remote);
      /* A form of a verb answered only with nouns is usually a different word.
         Asked for "stole" — "It was our bad… Eh? What we stole?" — the provider
         answers that exact spelling with the senses of the ecclesiastical
         garment, because "stole" is a noun too and the index is keyed on the
         string. WordNet files no verb under that spelling, so the entry it finds
         is the homograph: three definitions of a scarf under a headword the
         reader used as a verb, and nothing on the card that could say so.

         The sentence cannot arbitrate it, because nothing on this card matches a
         definition against the words around it. So the probe is built from the
         two facts that are actually in hand: this code already knows the word has
         a verb base form, and every sense that came back is a noun. Two guards
         keep it from firing where the entry is right — a determiner or an
         auxiliary before the word (`ctx.pos`), and a single shared word between
         the sentence and any sense, which is what "the stole was trimmed with
         fur" has and "what we stole" does not.

         It is a probe, not a replacement: the card shows what it has immediately
         and corrects itself if the base form answers better, so nothing waits on
         a second round trip. And the answer is not cached under the reader's
         word — the entry it replaces is a true answer to a true reading of that
         word, and the next reader may be that one. */
      if (
        upgrade &&
        ctx &&
        base &&
        !remote.ordered &&
        ctx.pos !== "noun" &&
        defineAllNoun(remote.senses) &&
        !defineTouches(remote.senses, ctx)
      ) {
        defineRemote(base, null).then((alt) => {
          if (!sensesUsable(alt && alt.senses)) return;
          if (!defineAnswers(base, alt.word)) return;
          alt.of = base;
          upgrade(finish({ ...alt }));
        });
      }
      // When the provider answers a different word than the one asked — asked for
      // "gave" it returns the entry for "give" — the card says so, rather than
      // showing one word's head and another word's meanings.
      if (!remote.of && remote.word && String(remote.word).toLowerCase() !== key) {
        remote.of = String(remote.word).toLowerCase();
      }
      return remote;
    }
    // Nothing at all for the form ("watches over" is filed only as "watch over"): ask the base form.
    if (base) {
      const alt = await defineRemote(base, null);
      if (sensesUsable(alt && alt.senses)) {
        alt.of = base;
        alt.ordered = true;
        defineCachePut(key, alt);
        return finish(alt);
      }
    }
    // Every provider said they do not know the word. That is the common case for
    // an acronym, a proper noun or a phrase, and it is exactly the case the
    // reader's own files answer: this document first (free, already parsed and on
    // screen), then its neighbours.
    let local = LOCAL.get(key);
    if (!local) {
      for (const index of await neighbourIndexes()) {
        if (index.has(key)) {
          local = index.get(key);
          break;
        }
      }
    }
    if (!local) return null;
    const hit = { source: "your own files", page: "", url: key, word: key, phonetic: "", senses: [local] };
    defineCachePut(key, hit);
    return finish(hit);
  }

  /* -------------------------------------------------------------- the card -- */

  let LOCAL = new Map();
  // One panel, and a stack of the words it has been asked about. A definition is
  // prose, and prose hides words: the reader who cannot say what *struggle* means
  // may well not be able to say what *effort* means inside its definition. So the
  // panel asks the same question of its own text, and answers it by becoming a
  // panel about *effort* — the arrow at its head is not a stack of cards to
  // climb, it is the one thing the new state throws away: the word the panel was
  // about before. One panel on the screen, one word lit on the page underneath it,
// and one way back.
  const DEFINE_FRAMES = [];
  let defineCard = null;

  function topFrame() {
    return DEFINE_FRAMES.length ? DEFINE_FRAMES[DEFINE_FRAMES.length - 1] : null;
  }

  const DEFINE_EDGE = 12;
  const DEFINE_GAP = 10;
  const DEFINE_NOTCH = 9;
  /* The window's bar is fixed chrome the panel has to keep out from under, and
     it only exists on a wide enough window. It is measured rather than computed
     from a breakpoint: `--appbar-clear` is declared inside the same media query
     that makes the bar fixed, so reading the token would be reading it from a
     place that does not exist on a narrow window — and the one case where a
     panel drawn under the bar is worst is a short wide window, which is
     exactly the shape that gets one. 8px is the air the rest of the chrome
     keeps off the window's edges. */
  const DEFINE_BAR_AIR = 8;

  /* The bar itself, found once. `placeDefine` runs on every scroll event as well
     as on open and resize, and the masthead is created by `decorate()` before
     `addDefine` is ever reached and never replaced after — so asking the document
     for it again on every frame of a scroll would be a full-document selector per
     frame to fetch an element that cannot have changed. `-1` means "not looked
     for yet", which is different from "looked for and there is none". */
  let DEFINE_BAR = -1;

  function defineBar() {
    if (DEFINE_BAR === -1) {
      try {
        DEFINE_BAR = document.querySelector(".mdview .doc > .mast");
      } catch (e) {
        DEFINE_BAR = null;
      }
    }
    return DEFINE_BAR || null;
  }

  /* This used to be one line: `synth.speak(new SpeechSynthesisUtterance(word))`.
     An utterance with nothing set on it is not a neutral request, it is a
     request for whatever the platform decides a default is — no language, no
     voice, no pace. What comes back is the first voice in the machine's list,
     which on a box with more than one engine installed is as likely to be the
     worst of them as the best, and "the audio is bad" is what that sounds like
     from the outside. Everything below is the part of the request that has to be
     made deliberately. */

  const SAY_KEY = "mdview:say";

  /* A voice is described by its name and by nothing else, and the names are not
     arbitrary: the engines that ship with an operating system name themselves
     after what they are — "espeak", "compact", "eloquence" — while the ones a
     person installed, or the cloud ones, put their quality in the name
     ("natural", "neural", "premium", "google"). This is the whole of the
     judgement, it is matched anywhere in the name and case-insensitively
     because the platforms are inconsistent about both, and it can only ever
     *demote* a voice: a machine with one voice installed still has to be able
     to say a word.

     What it cannot do is spot the voice nobody named: Firefox on a Linux box
     with one engine reports it as "English (Great Britain)" and says nothing
     about what produced it. So this is a tie-breaker among voices that have been
     named, never a claim to know what any of them sounds like — the panel's
     voice list is where a reader with ears settles that. */
  const SAY_GOOD = /natural|neural|premium|enhanced|expressive|google|microsoft|siri/i;
  const SAY_POOR = /espeak|eloquence|compact|pico|dispatcher|robot|mbrola/i;

  let SAY_LIST = [];
  let SAY_LISTENING = false;
  // Which request is current. Reading the voice list and the reader's choice is
  // a promise, and a card can be closed — or the button pressed again — while
  // that promise is in the air; this is how the loser of that race finds out it
  // lost instead of speaking over the word that replaced it.
  let SAY_RUN = 0;

  /* The voice list is not there when the page is. Chrome fills it during the
     first turn of the event loop; Firefox has shipped builds where it arrives
     only with `voiceschanged`, and some where it never does at all. So it is
     asked for at the moment it is needed, the one event that means "it has
     arrived" is listened for once, and two late re-asks are scheduled — because
     the click that does nothing is the one failure this feature cannot have. */
  function sayVoices() {
    const synth = window.speechSynthesis;
    if (!synth) return SAY_LIST;
    const ask = () => {
      try {
        const list = synth.getVoices();
        if (list && list.length) SAY_LIST = list;
      } catch (e) {
        /* still nothing, and still not a failure */
      }
    };
    ask();
    if (!SAY_LISTENING) {
      SAY_LISTENING = true;
      try {
        if (typeof synth.addEventListener === "function") synth.addEventListener("voiceschanged", ask);
        else synth.onvoiceschanged = ask;
      } catch (e) {
        /* an engine without the event is covered by the re-asks below */
      }
      setTimeout(ask, 250);
      setTimeout(ask, 1500);
    }
    return SAY_LIST;
  }

  /* The language the headword is said in. A .md file rarely declares one — mdview
     does not — so the platform's answer to "what language is this person reading
     in" is the best one available, and it is right far more often than letting
     the utterance guess from the text of the word alone. */
  function sayLang() {
    try {
      const tag = String(navigator.language || "");
      if (/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(tag)) return tag;
    } catch (e) {
      /* no navigator to ask */
    }
    return "en-US";
  }

  function sayScore(voice, want) {
    const name = String(voice.name || "");
    // Both sides of the language comparison are normalised. They come from two
    // different places that disagree about capitalisation — a voice says `en-US`
    // or `en_us`, `navigator.language` says `en-US` — and a comparison that
    // never matches is a preference that silently never applies, which is how
    // an `en-GB` voice ends up being chosen on a machine that asked for `en-US`.
    const lang = String(voice.lang || "").replace(/_/g, "-").toLowerCase();
    const wanted = String(want || "").replace(/_/g, "-").toLowerCase();
    let score = 0;
    if (SAY_GOOD.test(name)) score -= 8;
    if (SAY_POOR.test(name)) score += 8;
    // The language asked for exactly, then the same language more loosely
    // (`en-GB` for `en`), then anything: a Spanish voice handed an English
    // headword is worse than a dull English one.
    // A regional subtag counts as the language asked for: `en-us-nyc` is an en-US
    // voice. Without this the one plain US voice ranks below every English persona.
    if (lang && lang === wanted) score -= 6;
    else if (lang && wanted && lang.startsWith(wanted)) score -= 6;
    else if (lang.split("-")[0] && lang.split("-")[0] === wanted.split("-")[0]) score -= 3;
    // espeak's "English (Caribbean)+Alicia" style names are personas: a different
    // pitch and speed on purpose. A plain voice is the default, so a persona only
    // wins when the reader picks it in the panel.
    if (name.includes("+")) score += 4;
    // A local voice is already on the machine; a remote one may have to be
    // fetched before it makes a sound. Only a tie-breaker, and deliberately
    // small: on its own a network voice is usually the better-sounding one, and
    // refusing it would trade audio quality for a quarter of a second.
    if (voice.localService) score -= 1;
    return score;
  }

  /* The voice a press should use. A name the reader chose wins outright, and
     only if it is still installed — a machine that changed its voices must not
     leave the card stuck asking for one that is gone. */
  function sayBest(list, want, chosen) {
    const usable = (list || []).filter((v) => v && typeof v.name === "string");
    if (chosen) {
      for (const voice of usable) if (voice.name === chosen) return voice;
    }
    let best = null;
    let score = Infinity;
    for (const voice of usable) {
      const s = sayScore(voice, want);
      if (s < score) {
        score = s;
        best = voice;
      }
    }
    return best;
  }

  function sayPref() {
    return storeGet(SAY_KEY).then((v) => (v && typeof v === "object" ? v : {}));
  }

  /* The button is a speaker, and a speaker that looks identical whether it is
     talking or stuck gives a reader no way to tell a long word from a dead
     button. It goes dark and its waves become a stop square for as long as
     there is audio, and the next press is that stop. */
  function sayState(on) {
    const card = defineCard;
    if (!card || !card.say) return;
    card.say.classList.toggle("mdview-define-say-on", !!on);
    card.say.setAttribute("aria-label", on ? "Stop" : "Say it aloud");
    if (on) card.say.setAttribute("aria-pressed", "true");
    else card.say.removeAttribute("aria-pressed");
  }

  /* A word that is no longer on the screen has no business still talking: the
     panel can be dismissed halfway through a long one, and the next question
     replaces this one whole. */
  function sayStop() {
    SAY_RUN++;
    if (SAY_AUDIO) {
      SAY_AUDIO.pause();
      SAY_AUDIO = null;
    }
    try {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    } catch (e) {
      /* nothing to stop */
    }
    sayState(false);
  }

  /* Nothing is set on the utterance that the reader has not asked for.
     `lang`, `rate` and `pitch` are all left alone, and that is a correction:
     1.20.2 set them, and the audio came out *worse* than the four-line version
     that came before it. Both settings are a guess made on a machine that is not
     the reader's — and a guess about speech has a way of being audible. Slowing
     a synthetic voice down makes it more obviously synthetic; forcing `en-GB`
     onto an engine whose own default is `en-US` swaps one reading for another
     that is often the worse of the two, because the default is the one the
     engine's author tuned. Those defaults belong to the voice.

     What is left is the part that is genuinely ours: a voice chosen out of
     several, when there are several, and a pace the reader sets for themselves in
     the panel. With one voice installed and nothing stored, this is byte for
     byte the call 1.19 made, and it should sound like 1.19 did. */
  /* A recording of a person saying the word, when Wiktionary has one. On Linux the
     only engine the browser can reach is usually espeak, which makes many words hard to
     recognise; a recording is the word itself. Synthesis is the fallback. */
  const SAY_RECORDINGS = false;
  let SAY_AUDIO = null;
  const SAY_REC = new Map();
  function sayRecording(word) {
    const key = word.toLowerCase();
    if (!/^[a-z][a-z'-]*$/.test(key)) return Promise.resolve("");
    if (SAY_REC.has(key)) return SAY_REC.get(key);
    // Wiktionary's recordings (Wikimedia Commons): the US one first, then any other English one
    const p = fetch("https://en.wiktionary.org/api/rest_v1/page/media-list/" + encodeURIComponent(key))
      .then((r) => (r.ok ? r.json() : {}))
      .then((data) => {
        const files = ((data && data.items) || [])
          .filter((it) => it && it.type === "audio" && typeof it.title === "string")
          .map((it) => it.title.replace(/^File:/, ""));
        const pick = files.find((f) => /^en-us-/i.test(f)) || files.find((f) => /^en-|\(eng\)/i.test(f)) || "";
        return pick ? "https://commons.wikimedia.org/wiki/Special:FilePath/" + encodeURIComponent(pick) : "";
      })
      .catch(() => "");
    SAY_REC.set(key, p);
    return p;
  }

  async function defineSay(frame) {
    if (SAY_AUDIO) {
      SAY_AUDIO.pause();
      SAY_AUDIO = null;
      sayState(false);
      return;
    }
    const spoken = String((frame && frame.word) || "").replace(/\s+/g, " ").trim();
    // ponytail: Wiktionary recordings are off — the system voice (Kokoro) is preferred now.
    // Set SAY_RECORDINGS to true to play a recording first when one exists.
    if (SAY_RECORDINGS && spoken && !(window.speechSynthesis && window.speechSynthesis.speaking)) {
      const run = ++SAY_RUN;
      sayState(true);
      const url = await sayRecording(spoken);
      if (run !== SAY_RUN) return;
      if (url) {
        const audio = new Audio(url);
        SAY_AUDIO = audio;
        const end = () => { if (SAY_AUDIO === audio) SAY_AUDIO = null; sayState(false); };
        audio.onended = end;
        audio.onerror = () => { end(); speakSynth(frame); };
        audio.play().catch(() => { end(); speakSynth(frame); });
        return;
      }
      sayState(false);
    }
    return speakSynth(frame);
  }

  async function speakSynth(frame) {
    const synth = window.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance === "undefined") return;
    // A second press stops it. A headword is one word, but a phrasal verb read
    // as a single string runs on, and a speaker you cannot interrupt is a
    // speaker people stop pressing.
    if (synth.speaking || synth.pending) {
      synth.cancel();
      return;
    }
    const word = String((frame && frame.word) || "").replace(/\s+/g, " ").trim();
    if (!word) return;
    // The button answers the press before the storage read, not after it: the
    // audio is a round trip away and the acknowledgement of the finger is not.
    const run = ++SAY_RUN;
    sayState(true);
    const done = () => sayState(false);
    const pref = await sayPref();
    // Closed, stopped, or a second word asked for while the choice was loading.
    if (run !== SAY_RUN) return;
    const voice = sayBest(sayVoices(), sayLang(), pref && pref.voice);
    const say = new SpeechSynthesisUtterance(word);
    if (voice) say.voice = voice;
    if (typeof pref.rate === "number") say.rate = Math.min(2, Math.max(0.5, pref.rate));
    say.onend = done;
    say.onerror = done;
    // No `cancel()` before this. The press above already returned if anything was
    // talking, so there is nothing to cancel — and `cancel()` followed by
    // `speak()` in the same turn is the documented way to lose an utterance in
    // Firefox, which empties the queue after the new one has been added.
    try {
      synth.speak(say);
    } catch (e) {
      /* a machine with no voices is not a reason to fail */
      done();
    }
  }

  function defineSpeakerIcon() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M4 9v6h4l5 4V5L8 9H4z");
    path.setAttribute("fill", "currentColor");
    const wave = document.createElementNS("http://www.w3.org/2000/svg", "path");
    wave.setAttribute("class", "mdview-define-say-wave");
    wave.setAttribute(
      "d",
      "M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"
    );
    wave.setAttribute("fill", "none");
    wave.setAttribute("stroke", "currentColor");
    wave.setAttribute("stroke-width", "1.8");
    wave.setAttribute("stroke-linecap", "round");
    // The square is in the DOM from the start rather than added while the
    // button is talking: a glyph that appears on the first press makes the icon
    // jump sideways at the exact moment the reader is looking at it, and this is
    // a 24-unit viewBox, so both shapes occupy the same place.
    const stop = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    stop.setAttribute("class", "mdview-define-say-stop");
    stop.setAttribute("x", "7.5");
    stop.setAttribute("y", "7.5");
    stop.setAttribute("width", "9");
    stop.setAttribute("height", "9");
    stop.setAttribute("rx", "2");
    stop.setAttribute("fill", "currentColor");
    svg.appendChild(path);
    svg.appendChild(wave);
    svg.appendChild(stop);
    return svg;
  }

  // Datamuse answers with the part of speech as an abbreviation (`n`, `adj`,
  // `v`). Spelled out, because the label sits above a definition, and "n" above
  // one is a letter rather than a part of speech.
  const DEFINE_POS = {
    n: "noun",
    v: "verb",
    adj: "adjective",
    adv: "adverb",
    prep: "preposition",
    conj: "conjunction",
    pron: "pronoun",
    det: "determiner",
    intj: "interjection",
    abbr: "abbreviation",
    prov: "proverb",
    n_phr: "noun phrase",
    v_phr: "verb phrase",
  };

  /* ------------------------------------------------ which sense comes first -- */

  // Dictionaries write definitions the way a dictionary prints them: with the
  // grammar in the front. "(uncountable) The condition of not being threatened"
  // is a sentence about the dictionary's user, and the reader of a card is looking
  // up a word, not being taught morphology. What is left after that is still worth
  // keeping when the parenthetical also names a field: "(optics, countable)"
  // keeps "optics".
  const DEFINE_GRAMMAR =
    /^(?:un)?countable$|^transitive$|^intransitive$|^ditransitive$|^ambitransitive$|^transitive and intransitive$/i;

  // Which part of speech the top of the scrolled list belongs to, shown on its chip. The
  // headings scroll away with the senses, so without this a reader at sense 4 of "through"
  // cannot tell whether they are among adjectives or adverbs. `data-here` is separate from
  // `aria-pressed`, which is the filter.
  function markHere(card) {
    const body = card.body;
    const groups = body ? body.querySelectorAll(".mdview-define-group") : [];
    let here = groups.length ? groups[0].textContent : "";
    // a heading counts once it is in the top third: a short last section never reaches the very top
    const line = body ? body.getBoundingClientRect().top + Math.max(24, body.clientHeight / 3) : 0;
    for (const g of groups) {
      if (g.getBoundingClientRect().top <= line) here = g.textContent;
    }
    for (const chip of card.jump.children) {
      if (chip.getAttribute("data-pos") === here && groups.length > 1) chip.setAttribute("data-here", "");
      else chip.removeAttribute("data-here");
    }
  }

  function cleanDef(def) {
    let out = String(def == null ? "" : def)
      .replace(/[\s ]+/g, " ")
      // Wiktionary's own footnote marks, which mean nothing outside it
      .replace(/[\s]*[ᵂᴥ]+$/, "")
      .trim();
    out = out.replace(/^\(([^)(]{1,80})\)\s*/, (all, inner) => {
      const parts = inner.split(",").map((s) => s.trim()).filter(Boolean);
      const kept = parts.filter((p) => !DEFINE_GRAMMAR.test(p));
      if (!kept.length) return "";
      if (kept.length === parts.length) return all;
      return "(" + kept.join(", ") + ") ";
    });
    // "…, particularly:" introduces sub-senses that the provider flattens away, so the colon
    // promises a list that is not there. An ellipsis says the sentence is cut, not that
    // something follows.
    out = out.trim().replace(/\s*:$/, " …");
    return out;
  }

  function senseKey(def) {
    return cleanDef(def)
      .toLowerCase()
      .replace(/[.;,:]+$/, "")
      .trim();
  }

  // A definition that names its field is worth much more to a reader who is
  // reading about that field and nothing at all to one who is not, so the field
  // name is matched against the sentence the word was read in. The extra words
  // are there because the reader's sentence will not contain the word
  // "computing" — it will contain "server" or "cache" — and a stem of the
  // marker's own words catches everything else ("financ" in "financial").
  const DEFINE_FIELD = {
    computing: "software code data server api pixel image browser file database program network screen css html kernel memory storage cache render string array function web",
    computer: "software code data server api pixel image browser file database program network screen css html kernel memory storage cache render string array function web",
    programming: "software code function array loop variable compile script api",
    graphics: "image pixel render drawing vector canvas svg graphic",
    mathematics: "number matrix equation algebra vector graph probability set operation formula proof",
    math: "number matrix equation algebra vector graph probability set operation formula proof",
    law: "law court statute clause liability contract crime judge",
    legal: "law court statute clause liability contract crime judge",
    finance: "money cost price market invest asset budget payment profit revenue stock bank",
    financial: "money cost price market invest asset budget payment profit revenue stock bank",
    statistics: "sample mean variance distribution regression probability median",
    medicine: "patient doctor symptom drug clinical pain diagnosis treatment",
    medical: "patient doctor symptom drug clinical pain diagnosis treatment",
    biology: "cell gene protein species blood organism evolution",
    physics: "force energy velocity quantum particle mass gravity motion",
    military: "army soldier battle weapon troops war navy combat",
    religion: "god church faith scripture bible prayer sacred",
    linguistics: "sentence verb noun syntax grammar word clause language speech",
    grammar: "sentence verb noun syntax grammar word clause language speech",
    typography: "type font print page margin typeset glyph line",
    aviation: "aircraft flight pilot runway plane crew",
    nautical: "ship sail naval crew boat port hull sea",
    railway: "train railway track station rail locomotive engine",
    architecture: "building wall roof architect load beam concrete structure",
    music: "note chord melody tempo instrument song band tune",
    sports: "player team match score goal league coach season",
    chemistry: "reaction molecule compound acid atom chemical solution",
    geology: "rock mineral sediment crust magma fault",
    psychology: "behaviour behavior anxiety memory cognition therapist trauma",
    heraldry: "coat arms shield crest blazon motto",
    textiles: "cloth fabric thread weave wool cotton seam",
    painting: "paint pigment brush canvas easel palette painter",
    art: "paint pigment canvas drawing picture gallery artist",
    colour: "colour color hue rgb hsl theme dark light palette",
    color: "colour color hue rgb hsl theme dark light palette",
    physiology: "body muscle nerve organ blood pressure cell",
    anatomy: "body muscle nerve organ bone skin",
    botany: "plant leaf flower seed root grow garden",
    zoology: "animal species bird fish mammal habitat",
    entomology: "insect bee ant larva wing",
    meteorology: "weather cloud rain forecast storm wind temperature",
    journalism: "newspaper article reporter column editorial press",
    politics: "government election party vote minister policy",
    philosophy: "theory argument ethics knowledge mind idea",
    sociology: "society social group culture class institution",
    economics: "money cost price market economy budget trade",
    film: "movie scene camera film cinema actor director",
    dictionary: "word definition meaning spelling letter",
  };

  function fieldHit(part, text) {
    const key = String(part || "").toLowerCase().replace(/\s+/g, " ").trim();
    if (!key || !text) return false;
    const stem = key.length > 5 ? key.slice(0, 5) : key;
    if (stem.length >= 4 && text.indexOf(stem) !== -1) return true;
    const extra = DEFINE_FIELD[key];
    if (!extra) return false;
    for (const w of extra.split(" ")) {
      if (w.length >= 3 && text.indexOf(w) !== -1) return true;
    }
    return false;
  }

  // Registers nobody is looking a word up for, however good the definition is.
  const DEFINE_OLD =
    /\b(obsolete|archaic|dated|rare|proscribed|informal|colloquial|slang|vulgar|offensive|derogatory|historical|nonstandard|non-standard|dialectal|childish|euphemistic|uncommon|literary|poetic|superseded)\b/i;

  // A gloss that is only a name is not a definition of anything: Datamuse's only
  // entry for `struck` is "A surname.", and a card that says so has told the
  // reader nothing about the word they are in the middle of.
  const DEFINE_NAME =
    /\b(surname|given name|male name|female name|family name|first name|last name|proper noun|place name|placename|nickname|the capital of|the capital city)\b/i;

  // Nor is a grammar label: "Past tense of strike." describes the shape of the
  // word, not what it means.
  const DEFINE_FORM =
    /^(past tense|past participle|present participle|plural|third-person singular|gerund|comparative|superlative|alternative form|misspelling|abbreviation|initialism|acronym|inflection) of\b/i;

  function leadingMarker(def) {
    const m = /^\(([^)(]{2,60})\)/.exec(String(def || ""));
    return m ? m[1] : "";
  }

  // The part of speech the word is playing in the sentence it was read in is the
  // strongest signal available, because the reader who double-clicked a noun
  // wants a noun. The field the sentence is about is the second: two definitions
  // can both be nouns and only one of them is about the thing on the page.
  function senseScore(sense, ctx) {
    const def = sense.def || "";
    let k = 0;
    if (ctx && ctx.pos && sense.pos) k += sense.pos === ctx.pos ? 40 : -10;
    const marker = leadingMarker(def);
    if (marker) {
      let hits = 0;
      if (ctx && ctx.text) {
        for (const part of marker.split(",")) if (fieldHit(part, ctx.text)) hits++;
      }
      if (hits) k += 34;
      // A sense that names a field the sentence says nothing about is a specialist's
      // sense of the word, and the general one is what a reader who did not know
      // they needed the specialist is reading for. Not buried — eight places behind
      // a sense the sentence is actually about.
      else k -= 8;
    }
    if (DEFINE_NAME.test(def)) k -= 70;
    if (DEFINE_FORM.test(def)) k -= 55;
    if (DEFINE_OLD.test(marker)) k -= 45;
    // Three clauses is an encyclopaedia entry, and the reader who wanted the core
    // sense is the one who came first.
    if (def.length > 150) k -= 8;
    if ((def.match(/;/g) || []).length >= 2) k -= 6;
    return k;
  }

  function dedupeSenses(senses) {
    const out = [];
    const seen = new Set();
    for (const s of senses || []) {
      if (!s || !s.def) continue;
      const key = senseKey(s.def);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
    return out;
  }

  function orderSenses(senses, ctx) {
    const list = dedupeSenses(senses);
    if (list.length < 2) return list;
    const scored = list.map((s, i) => ({ s, i, k: senseScore(s, ctx) }));
    // The original index breaks every tie, so senses nobody has an opinion about
    // keep the order the provider chose.
    scored.sort((a, b) => b.k - a.k || a.i - b.i);
    return scored.map((x) => x.s);
  }

  // The expanded list is grouped by part of speech, and the groups are ordered by
  // the best sense in each one — so the definition the card led with is still the
  // first thing under the first heading, and the rest is findable by shape rather
  // than by reading.
  function groupSenses(senses) {
    const groups = [];
    const byPos = new Map();
    for (const s of senses) {
      const key = s.pos || "";
      let g = byPos.get(key);
      if (!g) {
        g = { pos: key, senses: [] };
        byPos.set(key, g);
        groups.push(g);
      }
      g.senses.push(s);
    }
    return groups;
  }

  /* -------------------------------------------- a word, or a form of a word -- */

  // A word in a document is very often a form rather than a word, and
  // dictionaries are indexed by word. So when the answer that arrives cannot be
  // about anything the reader is reading — a name, a grammar label — the base form
  // is asked instead. It costs a second request, and only in that case, and the
  // card names the word it really asked.
  const DEFINE_IRREGULAR = {
    struck: "strike", sung: "sing", sunk: "sink", drunk: "drink", swum: "swim",
    rung: "ring", shrunk: "shrink", sprung: "spring", wrung: "wring", flung: "fling",
    hung: "hang", clung: "cling", spun: "spin", begun: "begin", forgotten: "forget",
    chosen: "choose", shaken: "shake", risen: "rise", stolen: "steal", taken: "take",
    given: "give", driven: "drive", known: "know", seen: "see", been: "be",
    written: "write", spoken: "speak", broken: "break", frozen: "freeze",
    proven: "prove", shown: "show", thrown: "throw", worn: "wear", torn: "tear",
    fell: "fall", felt: "feel", held: "hold", kept: "keep", left: "leave",
    lost: "lose", made: "make", meant: "mean", met: "meet", paid: "pay",
    ran: "run", read: "read", said: "say", sent: "send", sold: "sell",
    spent: "spend", stood: "stand", told: "tell", won: "win", wrote: "write",
    drew: "draw", drove: "drive", grew: "grow", knew: "know", rose: "rise",
    saw: "see", spoke: "speak", threw: "throw", wore: "wear", ate: "eat",
    built: "build", brought: "bring", bought: "buy", caught: "catch",
    dealt: "deal", drawn: "draw", done: "do", flew: "fly", forgot: "forget",
    heard: "hear", hid: "hide", laid: "lay", led: "lead", lent: "lend",
    rode: "ride", sang: "sing", slept: "sleep", slid: "slide", sought: "seek",
    stole: "steal", swam: "swim", swept: "sweep", taught: "teach",
    wept: "weep", wound: "wind",
    // Every past tense the "-ed" rule cannot reach and that a reader meets in
    // running text. Thirty of these were missing — "gave", "went" and "took"
    // most of all — and each one costs the reader a card about the wrong word:
    // without the lemma the phrase built is "gave in", which no dictionary files.
    // Forms that are words in their own right ("found", "lay", "lit", "ground",
    // "smelt") are left alone on purpose: the wrong lemma would be worse than
    // none, and a miss falls back to asking the plain word.
    became: "become", bit: "bite", bled: "bleed", bore: "bear", borne: "bear",
    came: "come", chose: "choose", crept: "creep", did: "do", fed: "feed",
    fled: "flee", flew: "fly", flown: "fly", forbade: "forbid", forbidden: "forbid",
    forgave: "forgive", forgiven: "forgive", fought: "fight", gave: "give",
    hidden: "hide", rang: "ring", sank: "sink", sat: "sit", shook: "shake",
    shone: "shine", shot: "shoot", slung: "sling", spilt: "spill",
    swore: "swear", sworn: "swear", thought: "think", took: "take",
    went: "go", woke: "wake", coming: "come", becoming: "become",
  };

  function baseForm(word) {
    const w = String(word || "").toLowerCase();
    if (!/^[a-z]{3,}$/.test(w)) return "";
    if (DEFINE_IRREGULAR[w]) return DEFINE_IRREGULAR[w];
    let m;
    // A doubled consonant: "running" is "run", "stopped" is "stop". The
    // backreference is to the consonant, group 2 — group 1 is the stem, and
    // reading it as the stem meant this rule could never match anything, so every
    // regular verb with a doubled consonant went to the generic "-ed" rule below
    // and became "stopp" and "runn", which no dictionary files.
    m = /^(.+?)([bdfglmnprt])\2(?:ing|ed)$/.exec(w);
    if (m) return m[1] + m[2];
    m = /^(.+?)ied$/.exec(w);
    if (m) return m[1] + "y";
    // A plural in -ies is a stem in -y far more often than a stem in -ie:
    // "studies" is "study", "carries" is "carry". The "-s" rule below used to
    // make those "studie" and "carrie", which are in no dictionary. The few -ie
    // stems ("movies") become "movy", miss, and the card falls back to the plain
    // word — which the provider answers with the entry for "movie".
    m = /^(.+?[^aeiou])ies$/.exec(w);
    if (m && m[1].length >= 2) return m[1] + "y";
    m = /^(.+?)ying$/.exec(w);
    if (m) return m[1] + "ie";
    m = /^(.+?)ing$/.exec(w);
    if (m && m[1].length >= 3) return m[1];
    m = /^(.+?)ed$/.exec(w);
    if (m && m[1].length >= 3) return m[1];
    if (/(?:s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
    if (/[^s]s$/.test(w)) return w.slice(0, -1);
    return "";
  }

  // A phrasal verb is a phrase, and the phrase is what the dictionary indexes:
  // asked for "ended up" the provider matches the word and hands back no
  // definitions at all, while "end up" carries the meaning the reader is in the
  // middle of. Only the sentence knows the particle is there, so the candidates
  // are read off the text beside the word — never guessed from the word alone.
  // These are the particles that make a verb plus a particle into one verb; the
  // ones that merely begin an infinitive or a prepositional phrase ("to", "of",
  // "at", "from") are left out on purpose, or every "went to" would come back as
  // a verb called "go to".
  const DEFINE_PARTICLES = new Set([
    "up", "down", "in", "out", "on", "off", "over", "under", "into", "onto", "upon",
    "through", "across", "around", "about", "along", "away", "back", "apart",
    "together", "aside", "past", "open", "with", "for", "round",
  ]);

  // The phrases worth asking about, longest chain first. Two particles is the
  // ceiling: "came up with" is a different verb from "come up" and the text says
  // which one it is, but "put the box up on the shelf with tape" is a sentence,
  // not a verb, and guessing further would only cost requests.
  function phraseCandidates(block, range, word) {
    const parts = String(word || "").toLowerCase().split(/\s+/).filter(Boolean);
    if (!parts.length || parts.length > 3) return [];
    let head = baseForm(parts[0]) || parts[0];
    // A particle is never the head. This is also what keeps "in order" from
    // answering for the noun: the reader double-clicked *order*, so the word
    // before it is not evidence about the word.
    if (DEFINE_PARTICLES.has(head)) return [];
    if (parts.length > 1) head += " " + parts.slice(1).join(" ");
    const words = head.split(" ").length;

    // The text that follows the word, exactly: the range knows where the reader
    // double-clicked even when the word appears earlier in the same paragraph.
    let rest = "";
    if (block && range) {
      try {
        const r = document.createRange();
        r.selectNodeContents(block);
        r.setStart(range.endContainer, range.endOffset);
        rest = r.toString().slice(0, 80).toLowerCase();
      } catch (e) {
        rest = "";
      }
    }
    const chain = [];
    for (let i = 0; i < 2 && words + chain.length < 3; i++) {
      const m = /^\s+([a-z]+)/.exec(rest);
      if (!m || !DEFINE_PARTICLES.has(m[1])) break;
      chain.push(m[1]);
      rest = rest.slice(m[0].length);
    }

    const out = [];
    for (let i = chain.length; i > 0; i--) {
      out.push(head + " " + chain.slice(0, i).join(" "));
    }
    // a phrase the reader selected is the phrase they meant, chain or no chain
    if (!chain.length && parts.length > 1) out.push(head);
    return out;
  }

  // Whether an answer can be about the word the reader is reading at all.
  function sensesUsable(senses) {
    if (!senses || !senses.length) return false;
    return senses.some((s) => !(DEFINE_NAME.test(s.def) || DEFINE_FORM.test(s.def)));
  }

  /* ------------------------------------------------- the sentence it is in -- */

  const DEFINE_DETERMINER =
    /\b(the|a|an|this|that|these|those|his|her|its|their|our|my|your|some|any|each|every|no|one|two|three|several|many|another|such|both|either|neither|all|most|which|whose)\s*$/;
  const DEFINE_INTENSIFIER =
    /\b(very|quite|most|too|extremely|highly|fairly|rather|perfectly|totally|completely|especially|particularly|relatively|somewhat)\s*$/;
  const DEFINE_AUXILIARY =
    /\b(is|was|are|were|be|been|being|to|will|would|can|could|should|shall|may|might|must|has|have|had|do|does|did|not|never|also|then|than|and|or)\s*$/;

  // Which part of speech the word is playing *here*. Cheap, and wrong only in the
  // direction of saying nothing: every cue it does not recognise leaves `pos`
  // empty, and an empty guess costs the reader nothing, because no sense is
  // penalised for disagreeing with it.
  function guessPos(before, word) {
    const w = String(word || "");
    if (DEFINE_DETERMINER.test(before)) return "noun";
    if (DEFINE_INTENSIFIER.test(before)) return "adjective";
    if (DEFINE_AUXILIARY.test(before)) return "verb";
    if (w.length > 4 && /ly$/.test(w)) return "adverb";
    return "";
  }

  // The sentence the word was read in. The card is anchored to a live range, so
  // this is not a summary of the document or a guess about its topic: it is the
  // words around the word, which is the only evidence there is about which of its
  // senses the reader is in the middle of.
  function defineContext(range, word) {
    const ctx = { text: "", pos: "" };
    const node = range && range.startContainer;
    const host = node && (node.nodeType === 3 ? node.parentElement : node);
    const block =
      host && host.closest
        ? host.closest("p, li, dd, dt, td, th, blockquote, figcaption, h1, h2, h3, h4, h5, h6")
        : null;
    if (!block) return ctx;
    let text = "";
    try {
      text = block.textContent || "";
    } catch (e) {
      return ctx;
    }
    ctx.text = text.slice(0, 600).toLowerCase();
    const w = String(word || "").toLowerCase();
    const at = w ? ctx.text.indexOf(w) : -1;
    if (at > -1) {
      ctx.pos = guessPos(ctx.text.slice(Math.max(0, at - 48), at), w);
    }
    ctx.phrases = phraseCandidates(block, range, w);
    // The word itself must not vote. It is in its own sentence by construction, so
    // a sense whose field is named after the word — "(painting)" for *palette* in a
    // document about colour — would always match itself and win every time. What
    // is left is the reader's other words, which is the only evidence there is.
    if (w) ctx.text = ctx.text.split(w).join(" ");
    return ctx;
  }

  /* The parenthetical at the head of a definition is not the first words of it.
     "Something worthless or of poor quality; junk." is an answer;
     "(slang, mildly vulgar)" is a label saying which corner of the language the
     answer comes from, and rendering it as prose drops a filing note into the
     middle of the sentence. Measured on *crap* — eleven senses, and four of the
     noun senses in a row each opening with the same label, which is not a quirk
     of that word: WordNet's notes come in clusters, so vulgar, archaic and field
     senses arrive as blocks. So the label is lifted off the front and put on a
     line of its own, and a run of senses under the same label prints it once
     instead of once per sense. */
  const DEFINE_TAG = /^\(([^)(]{1,80})\)\s*/;

  function defineTag(def) {
    const raw = String(def == null ? "" : def);
    const m = DEFINE_TAG.exec(raw);
    if (!m) return { tag: "", key: "", text: raw.trim() };
    const rest = raw.slice(m[0].length).trim();
    const parts = m[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return { tag: "", key: "", text: rest };
    /* "(slang, mildly vulgar)" and "(mildly vulgar, slang)" are one label written
       two ways, and the provider writes both in a single answer — *crap* has one
       of each. The run is keyed on the set, so those two senses are one run, and
       the run is printed with the label it was first given, so a list never says
       the same thing two ways in a row. */
    const key = parts.map((s) => s.toLowerCase()).sort().join("|");
    return { tag: parts.join(", "), key: key, text: rest };
  }

  // Anything in brackets inside a definition — "(something)", "(a person's skin)", "(noun)"
  // — is the definition's aside, not its meaning, so it is set quieter and the meaning
  // words lead. Up to 60 characters: a longer bracket is a sentence of its own.
  const DEFINE_PLACEHOLDER = /\([^()]{1,60}\)/g;

  function fillDefinition(el, text) {
    const str = String(text == null ? "" : text);
    let last = 0;
    for (const m of str.matchAll(DEFINE_PLACEHOLDER)) {
      if (m.index > last) el.appendChild(document.createTextNode(str.slice(last, m.index)));
      const span = document.createElement("span");
      span.className = "mdview-define-ph";
      span.textContent = m[0];
      el.appendChild(span);
      last = m.index + m[0].length;
    }
    if (last < str.length) el.appendChild(document.createTextNode(str.slice(last)));
  }

  function defineTagLine(tag) {
    const p = document.createElement("p");
    p.className = "mdview-define-tag";
    p.textContent = tag;
    return p;
  }

  // A sense never says its own part of speech. In the collapsed card there is
  // nothing to compare it with, and the way Google's does it — the reader asked
  // what the word means and the answer is the definition — is the right one. In
  // the expanded list each part of speech is a heading over the senses it
  // governs, so a label on every line would say the same thing twice: "verb,
  // verb, verb", which is exactly the noise that makes a long list tiring to
  // read instead of quick to scan.
  //
  // The field label is the same argument, one level down, and it is the reason
  // `defineTag` hands the sentence over without its label rather than the whole
  // definition being rewritten here.
  function defineSense(sense, quiet, text, n, first) {
    /* A list needs something to count. Measured on *mercy*, whose ten senses
       carry parentheticals that are all grammar notes — `uncountable`,
       `countable` — which `cleanDef` strips, so every label line the field-label
       work can print is empty for this word and the reader gets six paragraphs
       of equal weight and a hairline between them. The senses are genuinely
       distinct: WordNet files forgiveness, the tendency toward it and an
       instance of it as three synsets, so there is nothing to merge, and no
       amount of extra labelling can invent a structure the data does not have.
       The number is that structure, and it is there for the words that have no
       label at all, which is most of them. */
    const row = document.createElement(quiet ? "p" : "div");
    row.className = quiet ? "mdview-define-sense" : "mdview-define-sense mdview-define-sense-row";
    if (!quiet && n) {
      const num = document.createElement("span");
      num.className = "mdview-define-n";
      // The one sense the card led with, and the one the reader is here for; it
      // is the only number in accent ink, which says "start here" without making
      // the others quieter than they have to be. Only the first sense of the whole
      // list, not the first of each part of speech — the numbering restarts per
      // group, so "1" appears twice and the reader would be told where to start
      // twice.
      if (first) num.classList.add("mdview-define-n-first");
      num.textContent = String(n);
      /* Hidden from a screen reader: the numbering is a rail for the eye and a
         way of saying "the third one", and the count it produces is already
         spoken by the disclosure below the list ("See all 11 definitions").
         Read out loud as "one", "two", it prefixes every definition with a
         number the reader did not ask for and buries the sentence. */
      num.setAttribute("aria-hidden", "true");
      row.appendChild(num);
    }
    const body = document.createElement(quiet ? "span" : "div");
    body.className = "mdview-define-def";
    fillDefinition(body, text == null ? sense.def : text);
    row.appendChild(body);
    if (sense.example && !quiet) {
      const eg = document.createElement("div");
      eg.className = "mdview-define-eg";
      eg.textContent = "“" + sense.example + "”";
      /* Inside the text column, not beside the number: an example belongs to the
         definition it illustrates, and as a sibling of the number it was pushed
         out to the margin under the gutter. */
      body.appendChild(eg);
    }
    return row;
  }

  function buildDefine() {
    const card = document.createElement("div");
    card.className = "mdview-define";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "Definition");
    /* The panel is a dialog and a keyboard has to be able to leave it. Escape
       already closes it, and a panel that swallows Tab is a keyboard trap, so it
       does not: the reader walks out into the page and the panel is still there
       when they come back. What it does take is focus on open, because a dialog
       that appears without being focused is a dialog a screen reader never
       mentions — and `preventScroll`, because the word that put the panel on
       screen is the reader's place in the document and the panel must not move
       them off it. */
    card.tabIndex = -1;

    const head = document.createElement("div");
    head.className = "mdview-define-head";
    // The way back, and the only navigation the panel has: it is not a stack of
    // cards to climb, it is the one word this panel is no longer about. It sits at
    // the left of the header where a back arrow is expected, it appears exactly
    // when there is a word before this one, and it is named — "Back to struggle".
    // Always in the DOM, because a panel that grew a button when it needed one
    // would move its own source line as it went.
    const back = button("mdview-define-back", "‹", "Back");
    back.hidden = true;
    back.addEventListener("click", backDefine);
    head.appendChild(back);
    const src = document.createElement("span");
    src.className = "mdview-define-src";
    head.appendChild(src);
    const close = button("mdview-define-x", "×", "Close");
    close.setAttribute("aria-label", "Close");
    // The whole question, not just the layer on top: a reader who dismisses a
    // card dismisses what they were reading about, however deep they were in.
    close.addEventListener("click", () => closeDefine());
    close.setAttribute("aria-label", "Close");
    head.appendChild(close);
    card.appendChild(head);

    const termRow = document.createElement("div");
    termRow.className = "mdview-define-word";
    const say = button("mdview-define-say", "", "Say it");
    say.setAttribute("aria-label", "Say it aloud");
    say.appendChild(defineSpeakerIcon());
    say.addEventListener("click", () => defineSay(topFrame()));
    say.setAttribute("title", "Say it aloud");
    const term = document.createElement("span");
    term.className = "mdview-define-term";
    termRow.appendChild(say);
    termRow.appendChild(term);
    // The senses may have come from the base form, because the word itself is one
    // the dictionary only knows as a name. Saying which word was asked is the
    // difference between a card that is being thorough and one that is quietly
    // answering a different question.
    const of = document.createElement("span");
    of.className = "mdview-define-of";
    of.hidden = true;
    termRow.appendChild(of);
    card.appendChild(termRow);

    const phon = document.createElement("div");
    phon.className = "mdview-define-phon";
    card.appendChild(phon);

    // The pointer row: one press per part of speech the answer actually has, in
    // the order their best sense is ranked, sitting directly above the senses it
    // points at. It is here because a reader who wants the adverbs of a word
    // should not have to go looking for them, and because it is the one piece of
    // navigation in this card that costs the reader no opinion about meaning:
    // every answer has a verb or it has not.
    const jump = document.createElement("div");
    jump.className = "mdview-define-jump";
    jump.setAttribute("role", "group");
    jump.setAttribute("aria-label", "Parts of speech");
    jump.hidden = true;
    card.appendChild(jump);
    card.addEventListener("click", (e) => {
      const ptr = e.target && e.target.closest ? e.target.closest(".mdview-define-jump-b") : null;
      if (!ptr) return;
      defineFilter(ptr.getAttribute("data-pos") || "");
    });

    const body = document.createElement("div");
    body.className = "mdview-define-body";
    card.appendChild(body);

    const more = button("mdview-define-all", "See all definitions", "Show every sense");
    more.addEventListener("click", () => {
      const st = topFrame();
      if (!st) return;
      // the state lives on the frame, so a repaint that replaces the senses cannot
      // collapse a list the reader has opened, and the pill's label cannot drift
      // out of step with what is on the screen
      st.expanded = !st.expanded;
      // the panel just changed height by a couple of hundred pixels, and a notch
      // that has walked off the top of the window has stopped pointing at anything
      paint();
    });
    card.appendChild(more);

    const foot = document.createElement("div");
    foot.className = "mdview-define-foot";
    const web = document.createElement("a");
    web.className = "mdview-define-web";
    web.target = "_blank";
    web.rel = "noopener noreferrer";
    foot.appendChild(web);
    card.appendChild(foot);

    // The controls must not take the selection away from the reader: the word stays
    // highlighted behind the card, which is what makes the card read as attached
    // to that word rather than as a dialog that wandered in. Only the controls,
    // though — the definition is the one piece of text on this page the reader
    // may reasonably want to select and copy, and swallowing `mousedown` over the
    // whole card took that away from them.
    card.addEventListener("mousedown", (e) => {
      if (e.target && e.target.closest && e.target.closest("button, a")) e.preventDefault();
    });

    // A definition is prose, and prose hides words — so the panel asks of its own
    // text the same question the page asks of the document. Only the headword
    // and the senses: the header, the pill and the footer are the panel's
    // furniture, not something the reader is reading a definition out of.
    card.addEventListener("mouseup", (e) => {
      const el = e.target && e.target.nodeType === 1 ? e.target : e.target && e.target.parentElement;
      if (!el) return;
      if (el.closest("button, a")) return;
      if (!el.closest(".mdview-define-term, .mdview-define-body")) return;
      const range = selectionRange();
      if (!range || !card.contains(range.startContainer)) return;
      const text = String(range.toString() || "").trim();
      if (!text) return;
      // the same coalescing as the page: a double-click also ends in a `mouseup`,
      // and the short delay is what lets the second one be the same press
      const twice = typeof e.detail === "number" && e.detail > 1;
      setTimeout(() => openDefine(range, text, true), twice ? 60 : 0);
    });

    card.src = src;
    card.back = back;
    card.say = say;
    card.term = term;
    card.of = of;
    card.jump = jump;
    card.phon = phon;
    card.body = body;
    body.addEventListener("scroll", () => markHere(card), { passive: true });
    card.more = more;
    card.web = web;
    return card;
  }

  // The panel hangs from the word the reader double-clicked in the page. It is the
  // only word it ever hangs from: a word read inside the definition keeps the
  // reader's own highlighted word underneath as the anchor, because that word is
  // still lit on the page and the panel is still under it, whatever the panel has
  // become about.
  function placeDefine() {
    const st = topFrame();
    if (!defineCard || !st || !st.anchor) return false;
    let rect;
    try {
      rect = st.anchor.getBoundingClientRect();
    } catch (e) {
      return false;
    }
    if (!rect || (!rect.width && !rect.height)) return false;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    // the word has scrolled out from under the panel: a definition of a word the
    // reader cannot see is a definition of nothing
    if (rect.bottom < -4 || rect.top > vh + 4) return false;

    /* The top of the window is not the top of the page. On a wide window the
       masthead is a fixed bar, and a panel clamped to the window's edge would
       slide its notch and its first line underneath it — measured at 1440×420,
       where the panel sat at y=12 with the bar occupying 0–48. The word's own
       top edge is left alone: a word under the bar cannot be seen anyway, and
       the card is not the thing that made it unreadable. Only the clamp moves,
       so the panel slides down to clear the bar rather than appearing nowhere. */
    let edgeTop = DEFINE_EDGE;
    const bar = defineBar();
    if (bar) {
      try {
        if (getComputedStyle(bar).position === "fixed") {
          const bh = bar.getBoundingClientRect().bottom;
          if (bh > 0) edgeTop = Math.max(edgeTop, bh + DEFINE_BAR_AIR);
        }
      } catch (e) {
        /* a bar that cannot be measured is a bar the old clamp will do without */
      }
    }

    const card = defineCard;
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    const centre = rect.left + rect.width / 2;
    let left = Math.max(DEFINE_EDGE, Math.min(vw - w - DEFINE_EDGE, centre - w / 2));
    let top = rect.bottom + DEFINE_GAP + DEFINE_NOTCH;
    let above = false;
    if (top + h > vh - DEFINE_EDGE) {
      const up = rect.top - DEFINE_GAP - DEFINE_NOTCH - h;
      if (up >= edgeTop) {
        top = up;
        above = true;
      } else {
        // neither side fits: the word is in the middle of a short window, so the
        // card takes what room there is and stops at the edges
        top = Math.max(edgeTop, Math.min(rect.bottom + DEFINE_GAP, vh - h - DEFINE_EDGE));
      }
    }
    // the bar is taller than the window's own bottom allowance on a very short
    // window, in which case there is nowhere to put it that clears both
    if (top < edgeTop) top = edgeTop;
    card.classList.toggle("above", above);
    card.style.left = Math.round(left) + "px";
    card.style.top = Math.round(top) + "px";
    card.style.setProperty(
      "--def-notch",
      Math.round(Math.max(16, Math.min(w - 16, centre - left))) + "px"
    );
    return true;
  }

  // Which part of speech the reader is looking at, or none. Pressing the pointer
  // that is already down clears it, so the row is its own way back to the whole
  // answer — the reader never has to hunt for a "show all" that is not there.
  function defineFilter(pos) {
    const st = topFrame();
    if (!st) return;
    st.filter = st.filter === pos ? "" : pos;
    paint();
  }

  function filterSenses(senses, pos) {
    const list = senses || [];
    if (!pos) return list;
    const kept = list.filter((s) => s.pos === pos);
    // an answer that no longer has that part of speech — a better one arriving
    // later, say — falls back to the whole thing rather than to nothing
    return kept.length ? kept : list;
  }

  function paint() {
    if (!defineCard) return;
    const card = defineCard;
    const st = topFrame();
    if (!st) return;

    // The arrow is the panel's memory of the word it was about before, so it is
    // there exactly when there is a word before — and it names it.
    const depth = DEFINE_FRAMES.length;
    card.back.hidden = depth < 2;
    if (depth > 1) {
      const was = DEFINE_FRAMES[depth - 2].word;
      card.back.setAttribute("aria-label", "Back to " + was);
      card.back.title = "Back to " + was;
    }

    // The pointer row is built from the answer's own parts of speech, so it never
    // offers a part of speech this word does not have.
    const all = st.ranked || null;
    const groups = all && all.length ? groupSenses(all) : [];
    const senses = st.filter ? filterSenses(all, st.filter) : all;
    card.term.textContent = st.word;
    card.of.hidden = !st.of;
    if (st.of) card.of.textContent = "of " + st.of;
    card.phon.textContent = st.phonetic || "";
    card.phon.hidden = !st.phonetic;

    const jump = card.jump;
    jump.textContent = "";
    // one pointer is not a pointer row: a word with a single part of speech has
    // nothing to jump between
    jump.hidden = groups.length < 2;
    for (const group of groups) {
      if (!group.pos) continue;
      const on = st.filter === group.pos;
      const ptr = button("mdview-define-jump-b", group.pos, "Show the " + group.pos + " senses");
      ptr.setAttribute("data-pos", group.pos);
      ptr.setAttribute("aria-pressed", on ? "true" : "false");
      jump.appendChild(ptr);
    }

    /* Rebuilding the list throws away where the reader was in it. That is free
       when the list is one line and wrong the moment it is twenty: a reader who
       has scrolled down to compare the fourth and fifth senses and then presses
       a pointer to narrow the list is thrown back to the top and has to find the
       pair again. So the offset is read before the list is emptied and written
       back after — except when the panel has just changed word, where the old
       offset belongs to a different answer entirely and keeping it would open
       the new list in the middle. */
    const keepScroll = card.body.scrollTop;
    const sameWord = card.term.textContent === st.word;
    card.body.textContent = "";
    if (!senses) {
      const waiting = document.createElement("p");
      waiting.className = "mdview-define-wait";
      waiting.textContent = "Looking up…";
      card.body.appendChild(waiting);
    } else if (!senses.length) {
      const none = document.createElement("p");
      none.className = "mdview-define-none";
      none.textContent = "No definition here for that.";
      card.body.appendChild(none);
    } else if (!st.expanded || senses.length < 2) {
      // the collapsed card is the one definition the reader is most likely to
      // want, spare and unlabelled, which is the whole reason it is one line.
      // The field label is not a part of speech and does not get cut with it:
      // "(gambling, dice games)" is the difference between a definition of the
      // word and a definition of a homonym, and the reader of one line is exactly
      // the reader who cannot tell which they got.
      const one = defineTag(senses[0].def);
      if (one.tag) card.body.appendChild(defineTagLine(one.tag));
      card.body.appendChild(defineSense(senses[0], true, one.text));
    } else {
      // grouped by part of speech, in ranked order, so the alternatives can be
      // scanned by shape instead of read one by one. Each part of speech is
      // named once, as a heading over the senses it governs — including when a
      // pointer has narrowed the list to one part of speech, where the heading
      // is what tells the reader which one they are looking at.
      const shown = groupSenses(senses);
      /* The cap is a stopping rule, not a wall. `DEFINE_LIST_MAX` keeps a word
         with forty senses from turning the panel into a dictionary, and the tail
         under the list is the reader being told the truth about it — but a truth
         with no way past it is a dead end: the card said there were twenty-three
         senses and then offered nothing at all. `st.limit` is the reader's own
         answer to that ("show me all of them"), and it survives a repaint so a
         better answer arriving later is shown whole rather than re-capped. */
      let budget = st.limit || DEFINE_LIST_MAX;
      let left = 0;
      let any = false;
      for (const group of shown) {
        // A heading is written only once a sense is actually going to sit under it,
        // so a group the cap never reaches does not leave a bare label on screen
        // pointing at nothing.
        let headed = false;
        /* The label of the run the previous sense belonged to, per part of
           speech. It is reset by an unlabelled sense rather than carried across
           it: a label only ever governs the senses printed under it, and letting
           one reach past a sense that has no label would be the card asserting a
           field for a definition it was not given. */
        let run = "";
        let n = 0;
        for (const sense of group.senses) {
          if (budget <= 0) {
            left++;
            continue;
          }
          budget--;
          n++;
          if (!headed && group.pos) {
            const head = document.createElement("p");
            head.className = "mdview-define-group";
            head.textContent = group.pos;
            card.body.appendChild(head);
            headed = true;
          }
          const t = defineTag(sense.def);
          if (t.tag && t.key !== run) card.body.appendChild(defineTagLine(t.tag));
          run = t.tag ? t.key : "";
          const row = defineSense(sense, false, t.text, n, !any);
          any = true;
          card.body.appendChild(row);
        }
      }
      if (left) {
        const tail = button("mdview-define-rest", "", "Show the remaining senses");
        tail.textContent =
          (left === 1 ? "1 more sense" : left + " more senses") + " — show all";
        tail.addEventListener("click", () => {
          st.limit = senses.length;
          paint();
        });
        card.body.appendChild(tail);
      }
    }

    card.more.hidden = !senses || senses.length < 2;
    /* The count is the part the reader cannot get any other way: the list stops at
       `DEFINE_LIST_MAX`, so a word with forty senses shows twenty, and the only
       other place that number appears is the tail below the twentieth. A
       disclosure that opens twenty lines should say how many lines there are. */
    card.more.textContent = st.expanded
      ? "Show fewer"
      : "See all " + (senses ? senses.length : 0) + " definitions";
    card.more.setAttribute("aria-expanded", st.expanded ? "true" : "false");
    card.classList.toggle("open", !!st.expanded);
    if (sameWord) card.body.scrollTop = keepScroll;
    markHere(card);

    /* The panel is named for the word it is about, so a screen reader listing
       dialogs has "Definition of struck" rather than two entries both called
       "Definition". */
    card.setAttribute("aria-label", "Definition of " + st.word);

    const src = card.src;
    src.textContent = "";
    if (st.source) {
      src.appendChild(document.createTextNode("Definitions from "));
      if (st.sourcePage) {
        const link = document.createElement("a");
        link.href = st.sourcePage;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = st.source;
        src.appendChild(link);
      } else {
        src.appendChild(document.createTextNode(st.source));
      }
    } else {
      src.textContent = "Definition";
    }

    // Google's card keeps a small link in this corner whatever it managed to
    // find, and that is the part worth keeping: a definition is somebody's
    // answer, not the only answer, and a reader who wants a different one should
    // not have to select the word again and guess. Always an exit.
    const web = card.web;
    web.textContent = "";
    web.href = googleUrl(st.word);
    web.appendChild(document.createTextNode("Search the web for "));
    const em = document.createElement("em");
    em.textContent = st.word;
    web.appendChild(em);

    // Repainting changes the panel's height, and a notch that has walked off the top
    // of the window has stopped pointing at anything
    placeDefine();
  }

  function googleUrl(word) {
    return "https://www.google.com/search?q=" + encodeURIComponent('"' + word + '"');
  }

  // The whole conversation goes: Escape, a press elsewhere, the `×`, and a word
  // that has been scrolled out from under the panel.
  function closeDefine() {
    sayStop();
    DEFINE_FRAMES.length = 0;
    if (defineCard && defineCard.parentNode) defineCard.parentNode.removeChild(defineCard);
    defineCard = null;
  }

  // Back is not a climb up a stack of cards: it is one word. The frame underneath
  // already holds its answer, so going back costs nothing — no request, no
  // waiting, and the senses return exactly as they were left.
  function backDefine() {
    if (DEFINE_FRAMES.length < 2) return closeDefine();
    DEFINE_FRAMES.pop();
    paint();
  }

  function adoptDefine(frame, answer) {
    frame.ranked = answer.senses;
    frame.phonetic = answer.phonetic || "";
    frame.source = answer.source;
    frame.sourcePage = answer.page || "";
    frame.of = answer.of || "";
  }

  // `inside` is true when the word was read in the panel rather than in the page.
  // Either way there is one panel: a word in the page starts a new conversation,
  // and a word in the definition pushes another step onto the one in progress,
  // keeping the word the reader double-clicked in the page as the anchor — that
  // word is still lit on the page and the panel is still under it, whatever the
  // panel has become about.
  function openDefine(range, text, inside) {
    const word = String(text || "").replace(/\s+/g, " ").trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (!word || word.length > 60) return;
    // one letter is not a definition, and a long selection is a quote the reader
    // is on their way to copy, not a word they are asking about
    if (!/\p{L}/u.test(word)) return;
    if (word.length < 2) return;

    const top = topFrame();
    if (top && word === top.word) return;
    // The new word replaces the old one, so anything the old one was still
    // saying stops here rather than talking over it.
    sayStop();

    let anchor;
    if (inside) {
      // the panel it was read in has gone — a press whose `mouseup` was still in
      // flight when the reader closed it, which happens when they changed their
      // mind twice quickly
      if (!top) return;
      anchor = top.anchor;
    } else {
      // a word in the page is a new question, and it replaces the old one whole
      DEFINE_FRAMES.length = 0;
      anchor = range;
    }

    // The sentence the word was read in, read once and thrown away: it decides
    // the order of the senses and then it is not needed again.
    const ctx = defineContext(range, word);
    const frame = {
      word: word,
      anchor: anchor,
      ranked: null,
      filter: "",
      expanded: false,
      limit: 0,
      of: "",
      phonetic: "",
      source: "",
      sourcePage: "",
      openAt: Date.now(),
    };
    DEFINE_FRAMES.push(frame);

    // Mounted hidden and shown on the next frame, which is what makes the panel
    // arrive rather than be there. The stylesheet makes the state free when the
    // reader has asked for less motion, so this is unconditional. Only the first
    // word of a conversation animates: after that the panel is already on screen
    // and its content is what changed.
    if (!defineCard) {
      defineCard = buildDefine();
      defineCard.classList.add("in");
      document.body.appendChild(defineCard);
      // Shown on the next frame, which is what makes the card arrive rather than
      // be there. The timer beside it is not a second opinion about the
      // animation: a frame does not always come — a throttled or hidden tab may
      // never schedule one — and a panel stuck at `opacity: 0` is not a panel, so
      // whichever lands first shows it and the other finds nothing left to remove.
      const arrive = () => defineCard && defineCard.classList.remove("in");
      requestAnimationFrame(arrive);
      setTimeout(arrive, 120);
      // focus after the arrival frame, so the ring that comes with it is not
      // drawn on a panel still at `opacity: 0`
      try {
        defineCard.focus({ preventScroll: true });
      } catch (e) {
        /* a panel that cannot take focus is still a panel worth reading */
      }
    }
    paint();
    // A panel is anchored to a word, so a word it cannot be anchored to is not a
    // panel worth showing: `placeDefine` fails for a word scrolled out of the
    // window or one with no box of its own, and the honest answer to that is no
    // panel rather than one left with no position at all.
    if (!placeDefine()) return closeDefine();

    defineLookup(word, (better) => {
      // a slower, richer answer replacing one already on screen
      if (topFrame() !== frame) return;
      adoptDefine(frame, better);
      paint();
    }, ctx, inside ? "en" : null).then((hit) => {
      // the reader has already moved on to another word, or closed the panel
      if (topFrame() !== frame) return;
      if (hit) {
        adoptDefine(frame, hit);
        paint();
        return;
      }
      frame.ranked = [];
      frame.source = "";
      frame.sourcePage = "";
      paint();
    });
  }

  // Where the reader pressed. The browser has already selected the word by the
  // time a double-click is delivered, so the selection is the word rather than
  // something re-derived here from coordinates — which also means the word is
  // exactly the one the reader can see highlighted.
  function selectionRange() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    return sel.getRangeAt(0);
  }

  function inReadableText(node) {
    const el = node && node.nodeType === 1 ? node : node && node.parentElement;
    if (!el) return false;
    // code is set in a mono face and means something different; the chrome is
    // selectable-looking but is not the document
    if (!CODE && el.closest("pre, code, kbd, samp")) return false;
    if (el.closest("textarea, input, .mdview-zoom, .mdview-define")) return false;
    if (el.closest(".anchor, .fold, .copy, .toc, .mast, .contents, .endplate")) return false;
    return !!el.closest(DEFINE_ROOT);
  }

  function addDefine(doc, opts) {
    NEIGHBOURS = !!(opts && opts.neighbours);
    CODE = !!(opts && opts.code);
    LOCAL = localIndex(doc);

    // Whether the reader has left the lookup on. Read once, asynchronously,
    // because the index above is worth building either way — it is one pass
    // over the headings — and a storage read should not hold up the rest of the
    // chrome. Absent means on, so an add-on whose panel has never been opened
    // behaves exactly as shipped.
    storeGet(DEFINE_KEY).then((v) => {
      if (v === "off") return;
      try {
        attachDefine(doc);
      } catch (e) {
        /* the lookup is a convenience; a document that cannot have one is still a document */
      }
    });
  }

  function attachDefine(doc) {

    // A double-click is the gesture the reader expects, and a drag across a
    // phrase is the same question asked of two words, so both are answered from
    // one handler: a double-click also ends in a `mouseup`, and the short delay
    // is what lets the second one be recognised as the same press.
    doc.addEventListener("mouseup", (e) => {
      if (!inReadableText(e.target)) return;
      const range = selectionRange();
      if (!range) return;
      const text = String(range.toString() || "").trim();
      if (!text) return;
      const more = typeof e.detail === "number" && e.detail > 1;
      setTimeout(() => openDefine(range, text), more ? 60 : 0);
    });

    doc.addEventListener("keyup", (e) => {
      if (!e.shiftKey) return;
      const range = selectionRange();
      if (range) openDefine(range, range.toString());
    });

    install();
  }

  // The listeners every open card needs, whichever way it was opened: Escape and a press
  // elsewhere close it; a scroll or resize keeps it on its word. Bound once.
  let INSTALLED = false;
  function install() {
    if (INSTALLED) return;
    INSTALLED = true;
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && defineCard) {
        closeDefine();
      }
    });

    // A press anywhere else closes it, but not a press that starts inside it: the
    // panel is anchored to a word, and a reader reaching for the pill — or for a
    // word in the definition — should not have it vanish from under their hand.
    //
    // The panel opens on a `mouseup`, so every `mousedown` it can see belongs to a
    // later gesture and none of them can be the one that opened it. The only
    // exception is the third press of a triple-click, which follows the second
    // by about a hundred milliseconds and would otherwise close the panel the
    // triple-click itself just asked for — so a short window swallows exactly
    // that and nothing else. It was 250ms, which also swallowed a reader who had
    // simply changed their mind quickly.
    document.addEventListener(
      "mousedown",
      (e) => {
        const st = topFrame();
        if (!defineCard || !st) return;
        if (defineCard.contains(e.target)) return;
        if (Date.now() - st.openAt < 150) return;
        closeDefine();
      },
      true
    );

    // The panel hangs from one word, and that word can be scrolled or resized out
    // from under it: a definition of a word the reader cannot see is a definition
    // of nothing.
    const reposition = () => {
      if (defineCard && !placeDefine()) closeDefine();
    };
    // captured, so a scroll inside a container (a PDF viewer's own scroller) counts too
    document.addEventListener("scroll", reposition, { capture: true, passive: true });
    window.addEventListener("resize", reposition);
    onRemeasure(reposition);
  }

  window.MdviewLookup = {
    attach: addDefine,
    setRoot(selector) {
      DEFINE_ROOT = selector;
    },
    open(range, text) {
      if (!range) return;
      install();
      openDefine(range, String(text == null ? range.toString() : text).trim());
    },
    close() {
      if (defineCard) closeDefine();
    },
    reposition() {
      for (const fn of REMEASURE_HOOKS) {
        try { fn(); } catch (e) { /* the card is a frill */ }
      }
    },
  };
})();
