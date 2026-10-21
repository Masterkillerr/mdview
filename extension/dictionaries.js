// dictionaries — the parts of the word lookup that belong to no one page: how a
// language is read off the browser's detector, and how English Wiktionary's Spanish
// entries become a card. Loaded before the page scripts, the definition page and the
// background script, so the same text gets the same answer wherever it is looked up.

// The detector reports each language it found and how much of the text that language
// covers. A text is one language only when one language covers most of it, so a few
// quotations in another tongue do not turn a Spanish page into a foreign one.
// `var` and not `const`: the add-on injects this file into a page every time the reader
// asks for a word, and a sandbox outlives them all — a redeclared const is a syntax
// error that would take the whole file, and with it the lookup, down on the second ask.
var DETECT_MIN_SHARE = 60;

// "es" or "en" when that language covers most of the text, "other" for any other
// language, and null when the detector is not sure.
function pickLanguage(result) {
  const found = result && Array.isArray(result.languages) ? result.languages : [];
  const top = found
    .filter((l) => l && l.language !== "und")
    .sort((a, b) => b.percentage - a.percentage)[0];
  if (!top || !(top.percentage >= DETECT_MIN_SHARE)) return null;
  if (top.language === "es" || top.language === "en") return top.language;
  return "other";
}

// English Wiktionary keeps each language under its own heading. Spanish words sit
// under "es", with the definitions written in English. Returns the card's shape, or
// null when the word has no Spanish entry.
function wiktionarySpanish(data, word) {
  const entries = data && Array.isArray(data.es) ? data.es : [];
  const senses = [];
  for (const entry of entries) {
    for (const def of (entry && entry.definitions) || []) {
      const text = plainDefinition(def && def.definition);
      if (!text) continue;
      const example = Array.isArray(def.examples) && def.examples.length ? plainDefinition(def.examples[0]) : "";
      senses.push({ pos: String(entry.partOfSpeech || "").toLowerCase(), def: text, example: example });
    }
  }
  return senses.length ? { word: String(word), phonetic: "", senses: senses } : null;
}

// Wiktionary's definitions are HTML, with links and labels in them. The card wants the
// words only.
function plainDefinition(html) {
  return String(html || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}
