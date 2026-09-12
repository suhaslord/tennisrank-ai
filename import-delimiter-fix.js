(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.TennisRankDelimiterFix = api;
    if (root.document && root.TennisRankImportV2) api.patchImporter(root.TennisRankImportV2);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function countDelimiter(line, delimiter) {
    let quoted = false;
    let count = 0;
    for (let i = 0; i < String(line || "").length; i += 1) {
      const char = line[i];
      const next = line[i + 1];
      if (char === '"' && quoted && next === '"') {
        i += 1;
        continue;
      }
      if (char === '"') quoted = !quoted;
      else if (!quoted && char === delimiter) count += 1;
    }
    return count;
  }

  function detectDelimiter(text) {
    const lines = String(text || "")
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .filter(line => line.trim())
      .slice(0, 24);
    const candidates = [",", "\t", ";", "|"];
    let best = { delimiter: ",", score: -Infinity };

    for (const delimiter of candidates) {
      // Include zero-count rows instead of throwing them away. This is the key
      // distinction between a real delimiter and punctuation that happens to
      // occur inside data cells. Example: a TSV row can legitimately contain
      // several commas in names, scores and notes while the header contains
      // none. Ignoring the header's zero comma count made commas appear more
      // consistent than tabs.
      const counts = lines.map(line => countDelimiter(line, delimiter));
      const positive = counts.filter(value => value > 0);
      if (!positive.length) continue;
      const mean = counts.reduce((a, b) => a + b, 0) / Math.max(counts.length, 1);
      const variance = counts.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / Math.max(counts.length, 1);
      const consistency = positive.length / Math.max(lines.length, 1);
      const score = mean * 3 + consistency * 8 - variance * 1.5;
      if (score > best.score) best = { delimiter, score };
    }
    return best.delimiter;
  }

  function parseDelimited(text) {
    const input = String(text || "").replace(/^\uFEFF/, "");
    const delimiter = detectDelimiter(input);
    const matrix = [];
    let row = [];
    let cell = "";
    let quoted = false;

    for (let i = 0; i < input.length; i += 1) {
      const char = input[i];
      const next = input[i + 1];
      if (char === '"' && quoted && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === delimiter && !quoted) {
        row.push(cell.trim());
        cell = "";
      } else if ((char === "\n" || char === "\r") && !quoted) {
        if (char === "\r" && next === "\n") i += 1;
        row.push(cell.trim());
        if (row.some(value => String(value).trim())) matrix.push(row);
        row = [];
        cell = "";
      } else {
        cell += char;
      }
    }

    if (cell || row.length) {
      row.push(cell.trim());
      if (row.some(value => String(value).trim())) matrix.push(row);
    }
    return { matrix, delimiter };
  }

  function patchImporter(importer) {
    if (!importer || importer.__delimiterConsistencyFix) return importer;
    importer.detectDelimiter = detectDelimiter;
    importer.parseDelimited = parseDelimited;
    importer.__delimiterConsistencyFix = true;
    return importer;
  }

  return { countDelimiter, detectDelimiter, parseDelimited, patchImporter };
});
