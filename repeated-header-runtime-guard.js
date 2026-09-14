(function (root) {
  'use strict';

  function wrapCurrentParser() {
    const importer = root?.TennisRankImportV2;
    const multiBlock = root?.TennisRankMultiBlockFix;
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

  function install() {
    for (const delay of [0, 25, 100, 300, 1000, 2000]) {
      root?.setTimeout?.(wrapCurrentParser, delay);
    }
  }

  root.TennisRankRepeatedHeaderGuard = { wrapCurrentParser, install };
  if (root?.document) install();
})(typeof globalThis !== 'undefined' ? globalThis : this);
