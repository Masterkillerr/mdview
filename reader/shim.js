// Stands in for the browser's language detector on the reader's own pages. It counts
// common Spanish and English words in the sample and reports the larger share, which is
// enough to choose the dictionary.
(function () {
  const ES = new Set("de la que el en y a los las por con para una un es se del al lo como más pero sus le ya o este porque esta entre cuando muy sin sobre también son hay fue ser".split(" "));
  const EN = new Set("the of and to in is that it for with as on are be this was by at from or an have not but which they their can".split(" "));
  window.browser = Object.assign(window.browser || {}, {
    i18n: {
      detectLanguage(text) {
        let es = 0, en = 0;
        for (const w of String(text).toLowerCase().match(/[a-záéíóúñü]+/g) || []) {
          if (ES.has(w)) es++;
          else if (EN.has(w)) en++;
        }
        const total = es + en;
        if (!total) return Promise.resolve({ isReliable: false, languages: [] });
        const lang = es >= en ? "es" : "en";
        const share = Math.round((Math.max(es, en) / total) * 100);
        return Promise.resolve({ isReliable: true, languages: [{ language: lang, percentage: share }] });
      },
    },
  });
})();
