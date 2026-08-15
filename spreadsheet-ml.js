(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TennisRankSpreadsheetML = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MODEL_VERSION = "tennisrank-schema-nb-1.0.0";
  const LABELS = [
    "name", "firstName", "lastName", "opponent", "player1", "player2", "winner", "loser",
    "result", "score", "date", "gender", "division", "wins", "losses", "record", "rank", "column",
  ];

  // TennisRank-specific supervised corpus. The runtime model is trained once from
  // this corpus and then used only for inference. No team/private spreadsheet data
  // is used for training.
  const TRAIN_HEADERS = {
    name: ["name", "player", "athlete", "competitor", "participant", "student", "roster", "player name", "athlete name", "team name", "entrant", "member", "player/team", "person"],
    firstName: ["first name", "firstname", "given name", "forename", "first", "given"],
    lastName: ["last name", "lastname", "surname", "family name", "family", "last"],
    opponent: ["opponent", "against", "versus", "vs", "opponent name", "opposing player", "opposing team", "played against", "rival", "other player"],
    player1: ["home", "host", "player 1", "player a", "athlete 1", "athlete a", "competitor 1", "competitor a", "team 1", "team a", "side 1", "side a", "home player", "home team"],
    player2: ["away", "visitor", "guest", "player 2", "player b", "athlete 2", "athlete b", "competitor 2", "competitor b", "team 2", "team b", "side 2", "side b", "away player", "away team"],
    winner: ["winner", "won by", "victor", "winning player", "winner name", "winning team", "won", "match winner", "result winner"],
    loser: ["loser", "lost to", "defeated", "losing player", "loser name", "losing team", "match loser"],
    result: ["result", "outcome", "winner is", "match result", "win loss", "w/l", "wl", "w or l", "status", "decision", "finish"],
    score: ["score", "game score", "result score", "set score", "sets", "final score", "match score", "scoreline", "final"],
    date: ["date", "played on", "match date", "timestamp", "time", "day", "match day", "played", "fixture date"],
    gender: ["gender", "sex", "team gender", "player gender", "boys/girls", "team sex"],
    division: ["division", "category", "format", "event", "flight", "draw", "discipline", "class", "level", "match type", "match format", "section", "group", "bracket", "singles/doubles", "event type"],
    wins: ["wins", "win", "w", "victories", "victory", "matches won", "won matches", "w count"],
    losses: ["losses", "loss", "l", "defeats", "defeat", "matches lost", "lost matches", "l count"],
    record: ["record", "w-l record", "win loss record", "overall record", "season record", "record w/l", "record wl"],
    rank: ["rank", "ranking", "position", "standing", "standings", "ladder rank", "seed", "seed rank", "place", "order", "current rank"],
    column: ["notes", "comments", "school", "coach", "location", "court", "round", "id", "email", "phone", "team code", "season", "year", "grade", "class year", "age", "misc", "remarks", "comment", "venue"],
  };

  const TRAIN_VALUES = {
    name: ["Aiden Shah", "Leo Kim", "Maya Lee", "Zoe Rivera", "Alex & Ben"],
    firstName: ["Aiden", "Leo", "Maya", "Zoe", "Alex"],
    lastName: ["Shah", "Kim", "Lee", "Rivera", "Patel"],
    opponent: ["Leo Kim", "Aiden Shah", "Zoe Lee", "Maya Shah", "Chris & Dan"],
    player1: ["Aiden Shah", "Maya Lee", "Alex & Ben", "Ravi Patel", "Emma Wilson"],
    player2: ["Leo Kim", "Zoe Rivera", "Chris & Dan", "Noah Smith", "Olivia Brown"],
    winner: ["Aiden Shah", "Maya Lee", "Alex & Ben", "Ravi Patel", "Emma Wilson"],
    loser: ["Leo Kim", "Zoe Rivera", "Chris & Dan", "Noah Smith", "Olivia Brown"],
    result: ["W", "L", "Win", "Loss", "Home", "Away", "Team A", "Team B"],
    score: ["6-3, 6-4", "7-5, 6-2", "6-7, 6-3, 10-8", "8-6", "6-0, 6-1"],
    date: ["8/12/2026", "2026-08-12", "Aug 12 2026", "08-12-26", "2026/08/12"],
    gender: ["Boys", "Girls", "M", "F", "Male", "Female"],
    division: ["Singles", "Doubles", "1 Singles", "2 Singles", "Varsity Singles", "JV Doubles", "2v2"],
    wins: ["0", "2", "5", "8", "12"],
    losses: ["0", "1", "3", "6", "9"],
    record: ["8-1", "6-3", "4-4", "10/2", "2-7"],
    rank: ["1", "2", "3", "7", "12"],
    column: ["Coach Lee", "Court 3", "River Islands", "Round 2", "2026"],
  };

  const EXPECTED_POSITIONS = {
    name: [0], firstName: [0], lastName: [1], opponent: [1], player1: [0], player2: [1],
    winner: [2], loser: [3], result: [2], score: [3, 4], date: [4, 5], gender: [2, 3],
    division: [3, 4], wins: [2], losses: [3], record: [2], rank: [0], column: [4, 5],
  };

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function compact(value) {
    return normalizeText(value).replace(/\s+/g, "");
  }

  function headerVariants(value) {
    const clean = normalizeText(value);
    if (!clean) return [""];
    const variants = new Set([
      clean,
      clean.toUpperCase(),
      clean.replace(/ /g, "_"),
      clean.replace(/ /g, "-"),
      clean.replace(/ /g, ""),
      `match ${clean}`,
      `season ${clean}`,
      `current ${clean}`,
      `${clean} field`,
    ]);
    return [...variants];
  }

  function ratio(values, predicate) {
    const usable = values.filter(value => String(value || "").trim());
    if (!usable.length) return 0;
    return usable.filter(predicate).length / usable.length;
  }

  function looksNumeric(value) { return /^[-+]?\d+(?:\.\d+)?$/.test(String(value || "").trim()); }
  function looksSmallInt(value) { return /^\d{1,2}$/.test(String(value || "").trim()); }
  function looksDate(value) {
    const text = String(value || "").trim();
    return /^(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})$/.test(text)
      || /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i.test(text);
  }
  function looksScore(value) { return /\d{1,2}\s*[-–]\s*\d{1,2}/.test(String(value || "")); }
  function looksResult(value) { return /^(?:w|l|win|loss|won|lost|home|away|team\s*[ab]|player\s*[ab])\b/i.test(String(value || "").trim()); }
  function looksGender(value) { return /^(?:boys?|girls?|male|female|men|women|m|f)$/i.test(String(value || "").trim()); }
  function looksDivision(value) { return /\b(?:singles?|doubles?|2v2|varsity|jv)\b/i.test(String(value || "")); }
  function looksRecord(value) { return /^\d{1,2}\s*[-/]\s*\d{1,2}$/.test(String(value || "").trim()); }
  function looksPair(value) { return /(?:\s&\s|\s\+\s|\band\b)/i.test(String(value || "")); }
  function looksName(value) {
    const text = String(value || "").trim();
    if (!text || looksResult(text) || looksGender(text) || looksDivision(text) || looksDate(text) || looksScore(text)) return false;
    return /^[A-Za-z][A-Za-z'.-]*(?:\s+(?:&\s+)?[A-Za-z][A-Za-z'.-]*){0,5}$/.test(text);
  }

  function bucket(name, value, tokens) {
    if (value >= 0.75) tokens.push(`${name}:high`);
    else if (value >= 0.4) tokens.push(`${name}:mid`);
    else if (value > 0) tokens.push(`${name}:low`);
  }

  function featureTokens(header, values, context = {}) {
    const tokens = [];
    const normalized = normalizeText(header);
    const dense = compact(header);
    normalized.split(/\s+/).filter(Boolean).forEach(token => tokens.push(`h:w:${token}`));
    for (let i = 0; i < dense.length - 2; i += 1) tokens.push(`h:g3:${dense.slice(i, i + 3)}`);
    for (let i = 0; i < dense.length - 3; i += 1) tokens.push(`h:g4:${dense.slice(i, i + 4)}`);

    normalizeText(context.sheetName).split(/\s+/).filter(Boolean).forEach(token => tokens.push(`s:w:${token}`));
    const usable = (values || []).map(value => String(value ?? "").trim()).filter(Boolean).slice(0, 24);
    bucket("v:numeric", ratio(usable, looksNumeric), tokens);
    bucket("v:smallint", ratio(usable, looksSmallInt), tokens);
    bucket("v:date", ratio(usable, looksDate), tokens);
    bucket("v:score", ratio(usable, looksScore), tokens);
    bucket("v:result", ratio(usable, looksResult), tokens);
    bucket("v:gender", ratio(usable, looksGender), tokens);
    bucket("v:division", ratio(usable, looksDivision), tokens);
    bucket("v:record", ratio(usable, looksRecord), tokens);
    bucket("v:name", ratio(usable, looksName), tokens);
    bucket("v:pair", ratio(usable, looksPair), tokens);

    if (usable.length) {
      const uniqueRatio = new Set(usable.map(value => value.toLowerCase())).size / usable.length;
      if (uniqueRatio >= 0.8) tokens.push("v:unique:high");
      else if (uniqueRatio >= 0.4) tokens.push("v:unique:mid");
      const avgLength = usable.reduce((sum, value) => sum + value.length, 0) / usable.length;
      if (avgLength >= 12) tokens.push("v:length:long");
      else if (avgLength >= 5) tokens.push("v:length:medium");
      else tokens.push("v:length:short");
    }

    const position = Number(context.position);
    const total = Number(context.totalColumns);
    if (Number.isFinite(position) && Number.isFinite(total) && total > 0) {
      if (position === 0) tokens.push("p:first");
      if (position === 1) tokens.push("p:second");
      if (position === total - 1) tokens.push("p:last");
      const third = position / Math.max(total - 1, 1);
      tokens.push(third < 0.34 ? "p:early" : third > 0.66 ? "p:late" : "p:middle");
    }
    return tokens;
  }

  function createTrainingDocuments() {
    const documents = [];
    LABELS.forEach(label => {
      const headers = TRAIN_HEADERS[label] || [];
      const values = TRAIN_VALUES[label] || [];
      const expected = EXPECTED_POSITIONS[label] || [0];
      headers.forEach((header, headerIndex) => {
        headerVariants(header).forEach((variant, variantIndex) => {
          const position = expected[(headerIndex + variantIndex) % expected.length];
          documents.push({
            label,
            tokens: featureTokens(variant, values, {
              position,
              totalColumns: Math.max(position + 2, 5),
              sheetName: label === "record" || label === "rank" ? "Season Standings" : "Varsity Results",
            }),
          });
        });
      });

      // Content-driven examples teach the model to recover useful fields even
      // when a spreadsheet uses opaque headers such as "Column C".
      if (!["player1", "player2", "winner", "loser", "firstName", "lastName"].includes(label)) {
        ["Column A", "Field 2", "Data", ""].forEach((header, index) => {
          const position = expected[index % expected.length];
          documents.push({ label, tokens: featureTokens(header, values, { position, totalColumns: 6, sheetName: "Tennis Export" }) });
        });
      }
    });
    return documents;
  }

  function trainNaiveBayes(documents) {
    const alpha = 0.75;
    const classDocs = Object.fromEntries(LABELS.map(label => [label, 0]));
    const classTotals = Object.fromEntries(LABELS.map(label => [label, 0]));
    const counts = Object.fromEntries(LABELS.map(label => [label, new Map()]));
    const vocabulary = new Set();

    documents.forEach(document => {
      classDocs[document.label] += 1;
      document.tokens.forEach(token => {
        vocabulary.add(token);
        counts[document.label].set(token, (counts[document.label].get(token) || 0) + 1);
        classTotals[document.label] += 1;
      });
    });

    return { alpha, classDocs, classTotals, counts, vocabulary, documentCount: documents.length };
  }

  const MODEL = trainNaiveBayes(createTrainingDocuments());

  function classifyColumn(header, values, context = {}) {
    const tokens = featureTokens(header, values, context);
    const totalDocs = MODEL.documentCount;
    const vocabSize = Math.max(MODEL.vocabulary.size, 1);
    const raw = LABELS.map(label => {
      const prior = Math.log((MODEL.classDocs[label] + 1) / (totalDocs + LABELS.length));
      const denominator = MODEL.classTotals[label] + MODEL.alpha * vocabSize;
      let score = prior;
      tokens.forEach(token => {
        const count = MODEL.counts[label].get(token) || 0;
        score += Math.log((count + MODEL.alpha) / denominator);
      });
      return { label, score };
    });

    // Temperature softens Naive Bayes' natural overconfidence.
    const temperature = 2.15;
    const max = Math.max(...raw.map(item => item.score / temperature));
    const exps = raw.map(item => Math.exp(item.score / temperature - max));
    const total = exps.reduce((a, b) => a + b, 0) || 1;
    const predictions = raw.map((item, index) => ({ label: item.label, confidence: exps[index] / total, score: item.score }))
      .sort((a, b) => b.confidence - a.confidence);
    return { predictions, top: predictions[0], margin: (predictions[0]?.confidence || 0) - (predictions[1]?.confidence || 0) };
  }

  const ANCHORS = new Set(["name", "opponent", "player1", "player2", "winner", "loser", "result", "score", "record", "wins", "losses", "rank"]);

  function headerLooksLikeData(label, value) {
    const text = String(value || "").trim();
    if (!text) return false;
    if (["name", "opponent", "player1", "player2", "winner", "loser", "firstName", "lastName"].includes(label)) {
      const known = Object.values(TRAIN_HEADERS).flat().some(alias => compact(alias) === compact(text));
      return !known && looksName(text) && /\s/.test(text);
    }
    if (label === "result") return looksResult(text);
    if (label === "score") return looksScore(text);
    if (label === "date") return looksDate(text);
    if (label === "gender") return looksGender(text);
    if (label === "division") return looksDivision(text);
    if (label === "record") return looksRecord(text);
    if (["wins", "losses", "rank"].includes(label)) return looksSmallInt(text);
    return false;
  }

  function analyzeOrientation(matrix, sourceName) {
    let best = { index: 0, score: -Infinity, semanticCount: 0, anchorCount: 0, predictions: [], confidence: 0 };
    const limit = Math.min(matrix.length, 48);
    for (let index = 0; index < limit; index += 1) {
      const header = matrix[index] || [];
      const totalColumns = Math.max(header.length, ...matrix.slice(index + 1, index + 10).map(row => row.length), 0);
      if (totalColumns < 2) continue;
      const predictions = [];
      const assigned = [];
      for (let column = 0; column < totalColumns; column += 1) {
        const values = matrix.slice(index + 1, index + 13).map(row => row[column]).filter(value => String(value || "").trim());
        const classified = classifyColumn(header[column], values, { position: column, totalColumns, sheetName: sourceName });
        predictions.push(classified);
        if (classified.top.label !== "column" && classified.top.confidence >= 0.34) assigned.push({ column, ...classified.top, header: header[column] });
      }
      const unique = new Set(assigned.map(item => item.label));
      const anchorCount = assigned.filter(item => ANCHORS.has(item.label)).length;
      const semanticCount = assigned.length;
      const confidence = semanticCount ? assigned.reduce((sum, item) => sum + item.confidence, 0) / semanticCount : 0;
      const dataPenalty = assigned.reduce((sum, item) => sum + (headerLooksLikeData(item.label, item.header) ? 0.85 : 0), 0);
      const score = assigned.reduce((sum, item) => sum + item.confidence * 2.4, 0)
        + semanticCount * 0.55
        + unique.size * 0.25
        + anchorCount * 0.8
        - dataPenalty
        - index * 0.025;
      if (score > best.score) best = { index, score, semanticCount, anchorCount, predictions, confidence };
    }
    return best;
  }

  function transpose(matrix) {
    const width = Math.max(0, ...matrix.map(row => row.length));
    return Array.from({ length: width }, (_, column) => matrix.map(row => row[column] ?? ""));
  }

  function inferTable(matrix, sourceName = "") {
    const normal = analyzeOrientation(matrix, sourceName);
    const transposedMatrix = transpose(matrix);
    const transposed = analyzeOrientation(transposedMatrix, sourceName);
    const useTranspose = transposed.semanticCount >= 2
      && transposed.anchorCount >= 1
      && (normal.semanticCount < 2 || transposed.score > normal.score + 2.25);
    const chosen = useTranspose ? transposed : normal;
    return {
      ...chosen,
      orientation: useTranspose ? "transposed" : "rows",
      matrix: useTranspose ? transposedMatrix : matrix,
      modelVersion: MODEL_VERSION,
    };
  }

  function predictionThreshold(label) {
    if (["score", "date", "gender", "division", "result", "record"].includes(label)) return 0.48;
    if (["rank", "wins", "losses"].includes(label)) return 0.54;
    if (["name", "opponent", "player1", "player2", "winner", "loser", "firstName", "lastName"].includes(label)) return 0.58;
    return 0.62;
  }

  function reconcilePredictions(rawHeaders, matrix, headerIndex, sourceName, predictions) {
    const totalColumns = rawHeaders.length;
    const mapped = rawHeaders.map((header, column) => {
      const classified = predictions?.[column] || classifyColumn(
        header,
        matrix.slice(headerIndex + 1, headerIndex + 13).map(row => row[column]),
        { position: column, totalColumns, sheetName: sourceName },
      );
      const candidates = classified.predictions.filter(item => item.label !== "column");
      const best = candidates[0];
      return {
        source: header,
        column,
        field: best && best.confidence >= predictionThreshold(best.label) ? best.label : "column",
        confidence: best?.confidence || 0,
        margin: classified.margin || 0,
        candidates,
      };
    });

    const fields = new Set(mapped.filter(item => item.field !== "column").map(item => item.field));
    const nameLikeUnknown = mapped.filter(item => item.field === "column" && item.candidates.some(candidate => ["name", "opponent", "player1", "player2"].includes(candidate.label)));
    const hasResult = fields.has("result");
    const hasWinnerPointer = fields.has("winner") || fields.has("loser");
    const hasAggregate = fields.has("record") || fields.has("wins") || fields.has("losses") || fields.has("rank");

    // Cross-column reconciliation resolves the otherwise ambiguous name-like
    // columns from the structure of the rest of the sheet.
    if (hasResult && nameLikeUnknown.length) {
      const roles = ["name", "opponent"];
      nameLikeUnknown.slice(0, 2).forEach((item, index) => { item.field = roles[index]; item.confidence = Math.max(item.confidence, 0.58); });
    } else if (hasWinnerPointer && nameLikeUnknown.length) {
      const roles = ["player1", "player2"];
      nameLikeUnknown.slice(0, 2).forEach((item, index) => { item.field = roles[index]; item.confidence = Math.max(item.confidence, 0.58); });
    } else if (hasAggregate && nameLikeUnknown.length) {
      nameLikeUnknown[0].field = "name";
      nameLikeUnknown[0].confidence = Math.max(nameLikeUnknown[0].confidence, 0.58);
    }

    // Do not let two weak ML guesses claim the same semantic field. Keep the
    // strongest and return the other to "column" unless it was reconciled above.
    const bestByField = new Map();
    mapped.forEach(item => {
      if (item.field === "column") return;
      const current = bestByField.get(item.field);
      if (!current || item.confidence > current.confidence) bestByField.set(item.field, item);
    });
    mapped.forEach(item => {
      if (item.field === "column") return;
      if (bestByField.get(item.field) !== item && !["name", "player1", "player2"].includes(item.field)) item.field = "column";
    });
    return mapped;
  }

  function sectionHints(text) {
    const value = String(text || "");
    let gender = "";
    let division = "";
    if (/\b(girls?|women|female)\b/i.test(value)) gender = "Girls";
    else if (/\b(boys?|men|male)\b/i.test(value)) gender = "Boys";
    if (/\b(doubles?|pairs?|2v2)\b/i.test(value)) division = "Doubles";
    else if (/\b(singles?)\b/i.test(value)) division = "Singles";
    return { gender, division };
  }

  function scoreWinnerFromCell(value) {
    const score = String(value || "").trim();
    const sets = [...score.matchAll(/(\d{1,2})\s*[-–]\s*(\d{1,2})/g)].map(match => [Number(match[1]), Number(match[2])]);
    if (!sets.length) return null;
    const a = sets.filter(set => set[0] > set[1]).length;
    const b = sets.filter(set => set[1] > set[0]).length;
    if (a === b) return null;
    return a > b ? "W" : "L";
  }

  function parseOutcomeMatrix(matrix, sourceName = "") {
    if (!Array.isArray(matrix) || matrix.length < 3) return null;
    let best = null;
    for (let headerIndex = 0; headerIndex < Math.min(matrix.length - 2, 12); headerIndex += 1) {
      const header = matrix[headerIndex] || [];
      if (header.length < 3) continue;
      const columnNames = header.slice(1).filter(value => String(value || "").trim());
      const dataRows = matrix.slice(headerIndex + 1, headerIndex + 12).filter(row => String(row?.[0] || "").trim());
      if (columnNames.length < 2 || dataRows.length < 2) continue;
      const columnNameRatio = ratio(columnNames, looksName);
      const rowNameRatio = ratio(dataRows.map(row => row[0]), looksName);
      const outcomes = dataRows.flatMap(row => row.slice(1, 1 + columnNames.length)).filter(value => String(value || "").trim());
      const outcomeRatio = ratio(outcomes, value => looksResult(value) || looksScore(value));
      const score = columnNameRatio * 2 + rowNameRatio * 2 + outcomeRatio * 4;
      if (columnNameRatio >= 0.6 && rowNameRatio >= 0.6 && outcomeRatio >= 0.45 && (!best || score > best.score)) {
        best = { headerIndex, columnNames, dataRows, score, confidence: Math.min(0.99, score / 8) };
      }
    }
    if (!best) return null;

    const hints = sectionHints(sourceName);
    const rows = [];
    const seenPairs = new Set();
    best.dataRows.forEach((sourceRow, rowOffset) => {
      const player = String(sourceRow[0] || "").trim();
      best.columnNames.forEach((opponent, columnOffset) => {
        const opponentName = String(opponent || "").trim();
        if (!player || !opponentName || player.toLowerCase() === opponentName.toLowerCase()) return;
        const raw = String(sourceRow[columnOffset + 1] || "").trim();
        if (!raw) return;
        const pairKey = [player.toLowerCase(), opponentName.toLowerCase()].sort().join("::");
        if (seenPairs.has(pairKey)) return;
        let result = "";
        if (looksResult(raw)) {
          if (/^(?:w|win|won|home|team\s*a|player\s*a)\b/i.test(raw)) result = "W";
          else if (/^(?:l|loss|lost|away|team\s*b|player\s*b)\b/i.test(raw)) result = "L";
        }
        if (!result && looksScore(raw)) result = scoreWinnerFromCell(raw) || "";
        if (!result) return;
        seenPairs.add(pairKey);
        const row = {
          name: player,
          opponent: opponentName,
          result,
          score: looksScore(raw) ? raw.replace(/–/g, "-") : "",
          __sourceRow: best.headerIndex + rowOffset + 2,
        };
        if (hints.gender) row.gender = hints.gender;
        if (hints.division) row.division = hints.division;
        rows.push(row);
      });
    });
    if (!rows.length) return null;
    rows.__analysis = {
      engine: "v3-hybrid-ml-matrix",
      modelVersion: MODEL_VERSION,
      orientation: "outcome-matrix",
      headerRow: best.headerIndex + 1,
      confidence: best.confidence,
      mapping: [
        { source: "row labels", field: "name", method: "matrix", confidence: best.confidence },
        { source: "column labels", field: "opponent", method: "matrix", confidence: best.confidence },
        { source: "matrix cells", field: "result", method: "matrix", confidence: best.confidence },
      ],
    };
    return rows;
  }

  function assessRows(rows) {
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) return { valid: false, confidence: 0, level: "LOW", reason: "No usable rows were found." };
    const semanticSets = list.map(row => new Set(Object.keys(row || {}).filter(key => !key.startsWith("__"))));
    const interpreted = semanticSets.filter(fields =>
      (fields.has("name") && fields.has("opponent") && fields.has("result"))
      || (fields.has("player1") && fields.has("player2") && (fields.has("winner") || fields.has("result")))
      || (fields.has("winner") && fields.has("loser"))
      || (fields.has("name") && (fields.has("record") || fields.has("wins") || fields.has("losses") || fields.has("rank")))
      || (fields.has("name") && (fields.has("gender") || fields.has("division")))
    ).length;
    const structural = interpreted / list.length;
    const modelConfidence = Number(rows.__analysis?.mlConfidence ?? rows.__analysis?.confidence ?? 0);
    const confidence = Math.max(0, Math.min(1, structural * 0.72 + modelConfidence * 0.28));
    if (structural >= 0.8 && confidence >= 0.62) return { valid: true, confidence, level: "HIGH", reason: "The model and tennis structure agree." };
    if (structural >= 0.45 && confidence >= 0.46) return { valid: true, confidence, level: "MEDIUM", reason: "Most rows are interpretable, but some columns should be reviewed." };
    return {
      valid: false,
      confidence,
      level: "LOW",
      reason: "TennisRank could not confidently identify enough player/result/ranking structure to publish this sheet safely.",
    };
  }

  return {
    MODEL_VERSION,
    LABELS,
    modelStats: { trainingDocuments: MODEL.documentCount, vocabularySize: MODEL.vocabulary.size },
    classifyColumn,
    inferTable,
    reconcilePredictions,
    parseOutcomeMatrix,
    assessRows,
    transpose,
    sectionHints,
    looksName,
    looksScore,
    looksResult,
    looksDate,
    looksGender,
    looksDivision,
    looksRecord,
  };
});
