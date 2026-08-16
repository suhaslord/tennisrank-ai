(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.TennisRankMultiBlockFix = api;
    if (root.TennisRankImportV2) api.wrapImporter(root.TennisRankImportV2);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const HEADER_HINT = /\b(?:player|athlete|student|team|side|opponent|against|versus|vs|result|outcome|winner|loser|score|set|gender|sex|squad|event|division|format|played|date|when|rank|seed|record|wins?|losses?|standing|first|last|surname|given|availability|status|flight|group|category|field|column|x\d+)\b/i;

  function text(value) { return String(value ?? "").trim(); }

  function valueLike(value) {
    const valueText = text(value);
    if (!valueText) return false;
    return /^(?:w|l|win|loss|boys?|girls?|male|female|m|f|singles?|doubles?|2v2)$/i.test(valueText)
      || /^\d+(?:\.\d+)?$/.test(valueText)
      || /\d{1,2}\s*[-–]\s*\d{1,2}/.test(valueText)
      || /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(valueText)
      || /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(valueText);
  }

  function similarFollowers(matrix, index, width, nonEmpty) {
    return matrix.slice(index + 1, index + 5).filter(row => {
      const count = (row || []).filter(value => text(value)).length;
      return count >= Math.max(2, Math.floor(nonEmpty * 0.45)) && Math.abs((row || []).length - width) <= 2;
    }).length;
  }

  function findTableStarts(matrix, importer) {
    const candidates = [];
    for (let index = 0; index < matrix.length - 1; index += 1) {
      const row = matrix[index] || [];
      const values = row.map(text).filter(Boolean);
      const nonEmpty = values.length;
      if (nonEmpty < 2) continue;
      const followers = similarFollowers(matrix, index, row.length, nonEmpty);
      if (followers < 1) continue;

      const mapped = row.map(value => importer.canonicalField ? importer.canonicalField(value) : "column");
      const recognized = mapped.filter(field => field && field !== "column").length;
      const hints = values.filter(value => HEADER_HINT.test(value)).length;
      const dataRatio = values.filter(valueLike).length / nonEmpty;
      const opaqueHeader = nonEmpty >= 4
        && dataRatio <= 0.25
        && values.every(value => value.length <= 40)
        && new Set(values.map(value => value.toLowerCase())).size === nonEmpty
        && followers >= 2;

      // Data rows can contain W/Boys/Singles and therefore look semantic to a
      // header alias system. Requiring a low data-value ratio keeps those rows
      // from becoming false table boundaries while still allowing opaque X01
      // or Field 1 style headers.
      if ((recognized >= 2 || hints >= 2 || (hints >= 1 && nonEmpty >= 4) || opaqueHeader) && dataRatio <= 0.34) {
        candidates.push(index);
      }
    }

    const starts = [];
    for (const index of candidates) {
      if (!starts.length) {
        starts.push(index);
        continue;
      }
      const previous = starts[starts.length - 1];
      if (index - previous <= 2) {
        const previousStrength = (matrix[previous] || []).map(value => importer.canonicalField(value)).filter(field => field !== "column").length;
        const currentStrength = (matrix[index] || []).map(value => importer.canonicalField(value)).filter(field => field !== "column").length;
        if (currentStrength >= previousStrength + 2) starts[starts.length - 1] = index;
      } else {
        starts.push(index);
      }
    }
    return starts;
  }

  function encodeCell(value) {
    const valueText = text(value);
    return /[",\n\r]/.test(valueText) ? `"${valueText.replace(/"/g, '""')}"` : valueText;
  }

  function matrixToCsv(matrix) {
    return matrix.map(row => (row || []).map(encodeCell).join(",")).join("\n");
  }

  function sparseContext(matrix, index) {
    let best = { text: "", score: -1, distance: 99 };
    for (let rowIndex = index - 1; rowIndex >= Math.max(0, index - 4); rowIndex -= 1) {
      const values = (matrix[rowIndex] || []).map(text).filter(Boolean);
      if (!values.length || values.length > 3) continue;
      const joined = values.join(" ");
      let score = 0;
      if (/\btennis\b/i.test(joined)) score += 5;
      if (/\b(?:boys?|girls?|singles?|doubles?|2v2)\b/i.test(joined)) score += 4;
      if (/\b(?:match|results?|standings?|rankings?|ladder|leaderboard)\b/i.test(joined)) score += 2;
      const distance = index - rowIndex;
      if (score > best.score || (score === best.score && distance < best.distance)) best = { text: joined, score, distance };
    }
    return best.text;
  }

  function headerLikeParsedRow(row, importer) {
    if (!row || typeof row !== "object" || typeof importer?.canonicalField !== "function") return false;
    let compared = 0;
    let positionalMatches = 0;
    for (const [rawField, value] of Object.entries(row)) {
      if (rawField.startsWith("__") || !text(value)) continue;
      compared += 1;
      const field = String(rawField).replace(/\d+$/, "");
      const incoming = importer.canonicalField(value);
      if (incoming !== "column" && incoming === field) positionalMatches += 1;
    }
    // Real match rows can legitimately contain two self-describing values such
    // as Boys + Singles. Three or more same-position semantic labels is a much
    // stronger signal that a repeated header row was parsed as data.
    return compared >= 3 && positionalMatches >= 3 && positionalMatches / compared >= 0.4;
  }

  function attachAnalysis(rows, blocks, sourceName) {
    const confidences = blocks.map(block => Number(block.review?.confidence || 0)).filter(Number.isFinite);
    rows.__analysis = {
      headerRow: 1,
      delimiter: "multi-block",
      columns: [],
      mapping: blocks.flatMap(block => block.rows?.__analysis?.mapping || []),
      sourceName,
      blocks: blocks.map(block => ({
        startRow: block.start + 1,
        endRow: block.end,
        context: block.context,
        rows: block.rows.length,
        review: block.review,
      })),
      engine: "v5-multi-block",
      mlConfidence: confidences.length ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : 0,
    };
    return rows;
  }

  function wrapImporter(importer) {
    if (!importer || importer.__multiBlockFix) return importer;
    const baseParseText = importer.parseText.bind(importer);

    importer.parseText = (sourceText, sourceName) => {
      const fullResult = baseParseText(sourceText, sourceName);
      let parsed;
      try { parsed = importer.parseDelimited(String(sourceText || "")); } catch { return fullResult; }
      const matrix = parsed.matrix || [];
      const starts = findTableStarts(matrix, importer);
      if (starts.length < 2) return fullResult;

      const blocks = [];
      for (let blockIndex = 0; blockIndex < starts.length; blockIndex += 1) {
        const start = starts[blockIndex];
        const end = blockIndex + 1 < starts.length ? starts[blockIndex + 1] : matrix.length;
        const slice = matrix.slice(start, end);
        if (slice.length < 2) continue;
        const context = sparseContext(matrix, start);
        const blockSource = [sourceName, context].filter(Boolean).join(" — ");
        const rows = baseParseText(matrixToCsv(slice), blockSource);
        const review = typeof importer.validateInterpretation === "function"
          ? importer.validateInterpretation(rows)
          : { valid: rows.length > 0, confidence: 1 };
        if (!review.valid || !rows.length) continue;
        rows.forEach(row => {
          if (Number.isFinite(Number(row.__sourceRow))) row.__sourceRow = Number(row.__sourceRow) + start;
        });
        blocks.push({ start, end, context, rows, review });
      }

      if (blocks.length < 2) return fullResult;
      const merged = [];
      const seen = new Set();
      for (const block of blocks) {
        for (const row of block.rows) {
          const identity = JSON.stringify(Object.fromEntries(Object.entries(row).filter(([field]) => !field.startsWith("__"))));
          if (seen.has(identity)) continue;
          seen.add(identity);
          merged.push(row);
        }
      }

      const suspiciousFullRows = fullResult.filter(row => headerLikeParsedRow(row, importer)).length;
      const usableFullRows = Math.max(0, fullResult.length - suspiciousFullRows);
      const blockReview = typeof importer.validateInterpretation === "function"
        ? importer.validateInterpretation(merged)
        : { valid: merged.length > 0 };

      // Prefer isolated blocks when they preserve at least as much actual data
      // after subtracting repeated headers that the one-schema parser treated as
      // rows. Otherwise retain the fuller parse to avoid fragmenting normal data.
      const blocksAreBetter = blockReview.valid && (
        merged.length > fullResult.length
        || (suspiciousFullRows > 0 && merged.length >= usableFullRows)
      );
      if (!blocksAreBetter) return fullResult;
      return attachAnalysis(merged, blocks, sourceName || "");
    };

    importer.__multiBlockFix = true;
    return importer;
  }

  return { valueLike, findTableStarts, matrixToCsv, sparseContext, headerLikeParsedRow, attachAnalysis, wrapImporter };
});
