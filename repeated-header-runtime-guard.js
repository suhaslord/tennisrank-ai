(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.TennisRankRepeatedHeaderGuard = api;
    if (root.document) api.install();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  function wrapCurrentParser(target = root) {
    const importer = target?.TennisRankImportV2;
    const multiBlock = target?.TennisRankMultiBlockFix;
    if (!importer || typeof importer.parseText !== 'function' || typeof multiBlock?.cleanRepeatedHeaders !== 'function') return false;
    if (importer.parseText.__repeatedHeaderRuntimeGuard) return true;

    const baseParse = importer.parseText;
    const guardedParse = function (textInput, sourceName) {
      const rows = baseParse.call(importer, textInput, sourceName);
      return multiBlock.cleanRepeatedHeaders(rows, importer, sourceName);
    };
    guardedParse.__repeatedHeaderRuntimeGuard = true;
    guardedParse.__baseParse = baseParse;
    importer.parseText = guardedParse;
    return true;
  }

  function install(target = root) {
    for (const delay of [0, 25, 100, 300, 1000, 2000]) {
      target?.setTimeout?.(() => wrapCurrentParser(target), delay);
    }
  }

  return { wrapCurrentParser, install };
});
