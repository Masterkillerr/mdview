// define — the definition of a word the reader selected, opened by the "Define with
// mdview" menu item. It is a tab rather than a card on the page because a tab is where
// every page allows it, Firefox's own PDF viewer included. The word comes in the
// address; the dictionaries are asked through the background script, which holds
// their permissions.
const api = typeof browser !== "undefined" ? browser : chrome;

const FREE_DICTIONARY = "https://api.dictionaryapi.dev/api/v2/entries/en/";
const DATAMUSE = "https://api.datamuse.com/words?md=d&max=1&sp=";
const WIKTIONARY = "https://en.wiktionary.org/api/rest_v1/page/definition/";
// Datamuse tags each sense with a single letter
const DATAMUSE_POS = { n: "noun", v: "verb", adj: "adjective", adv: "adverb", u: "interjection" };
const MAX_SENSES = 30;

// Free Dictionary: phonetics, parts of speech and examples.
function parseFreeDictionary(data) {
  const entry = Array.isArray(data) ? data[0] : data;
  if (!entry || !Array.isArray(entry.meanings)) return null;
  const senses = [];
  for (const meaning of entry.meanings) {
    for (const def of meaning.definitions || []) {
      if (!def || !def.definition) continue;
      senses.push({
        pos: String(meaning.partOfSpeech || ""),
        def: String(def.definition),
        example: def.example ? String(def.example) : "",
      });
    }
  }
  let phonetic = entry.phonetic || "";
  if (!phonetic && Array.isArray(entry.phonetics)) {
    const withText = entry.phonetics.find((p) => p && p.text);
    if (withText) phonetic = String(withText.text);
  }
  return senses.length ? { phonetic: String(phonetic), senses } : null;
}

// Datamuse: one line per sense and no phonetics. Asked when the other has nothing.
function parseDatamuse(data) {
  const entry = Array.isArray(data) ? data[0] : data;
  if (!entry || !Array.isArray(entry.defs) || !entry.defs.length) return null;
  const senses = entry.defs.map((raw) => {
    // "adj\tLasting for a short period of time."
    const text = String(raw);
    const at = text.indexOf("\t");
    const tag = at === -1 ? "" : text.slice(0, at).trim();
    return { pos: DATAMUSE_POS[tag] || tag, def: at === -1 ? text : text.slice(at + 1), example: "" };
  });
  return { phonetic: "", senses };
}

// The background script answers { ok, text } for a dictionary that replied.
function ask(url) {
  return api.runtime
    .sendMessage({ type: "mdview:fetch", url })
    .then((reply) => (reply && reply.ok ? JSON.parse(reply.text) : null))
    .catch(() => null);
}

// The rich dictionary first; the thin one when the rich one has no entry or is down.
// Spanish has its own source: English Wiktionary's Spanish entry, with English definitions.
async function lookup(word, lang) {
  if (lang === "es") {
    const hit = wiktionarySpanish(await ask(WIKTIONARY + encodeURIComponent(word)), word);
    if (!hit) return null;
    return { ...hit, source: "Wiktionary", page: "https://en.wiktionary.org/wiki/" + encodeURIComponent(word) + "#Spanish" };
  }
  const encoded = encodeURIComponent(word);
  const rich = parseFreeDictionary(await ask(FREE_DICTIONARY + encoded));
  if (rich) return { ...rich, source: "Free Dictionary", page: "https://dictionaryapi.dev/dictionary/" + encoded };
  const thin = parseDatamuse(await ask(DATAMUSE + encoded));
  if (thin) return { ...thin, source: "Datamuse", page: "https://www.datamuse.com/words/" + encoded };
  return null;
}

// The selection, trimmed of punctuation at its ends, if it is one word.
function oneWord(text) {
  const word = String(text || "").trim().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
  return /^[\p{L}'’-]+$/u.test(word) ? word : null;
}

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function show(nodes) {
  document.querySelector("main").replaceChildren(...nodes);
}

function render(word, entry) {
  if (!entry) {
    show([el("h1", word), el("p", "No entry for this word in either dictionary.", "status")]);
    return;
  }
  const nodes = [el("h1", word)];
  if (entry.phonetic) nodes.push(el("p", entry.phonetic, "phonetic"));
  // senses grouped under their part of speech, in the order the dictionary gave them
  let list = null;
  let lastPos = null;
  entry.senses.slice(0, MAX_SENSES).forEach((sense) => {
    if (!list || sense.pos !== lastPos) {
      if (sense.pos) nodes.push(el("h2", sense.pos));
      list = el("ol");
      nodes.push(list);
      lastPos = sense.pos;
    }
    const item = el("li", sense.def);
    if (sense.example) item.appendChild(el("em", sense.example));
    list.appendChild(item);
  });
  if (entry.senses.length > MAX_SENSES) {
    nodes.push(el("p", `${entry.senses.length - MAX_SENSES} more on the dictionary's page.`, "status"));
  }
  const foot = el("footer", "From ");
  const link = el("a", entry.source);
  link.href = entry.page;
  foot.appendChild(link);
  nodes.push(foot);
  show(nodes);
}

async function start() {
  const word = oneWord(new URLSearchParams(location.search).get("word"));
  if (!word) {
    document.title = "mdview";
    show([el("p", "Select a single word to define.", "status")]);
    return;
  }
  document.title = `${word} · mdview`;
  show([el("p", "Looking up…", "status")]);
  try {
    const lang = new URLSearchParams(location.search).get("lang") === "es" ? "es" : "en";
    render(word, await lookup(word, lang));
  } catch (e) {
    show([el("h1", word), el("p", "Could not look that up. Check the connection and try again.", "status")]);
  }
}

// Not started when a test loads only the functions above.
if (typeof document !== "undefined" && document.querySelector("main")) start();
