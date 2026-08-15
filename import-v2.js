(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.TennisRankImportV2 = api;
    if (root.document) api.installBrowser(root);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const FIELD_ALIASES = [
    ["player1", /^(?:home|host|player1|playera|athlete1|athletea|competitor1|competitora|team1|teama|side1|sidea|playername1|playernamea|teamname1|teamnamea)$/i],
    ["player2", /^(?:away|visitor|guest|player2|playerb|athlete2|athleteb|competitor2|competitorb|team2|teamb|side2|sideb|playername2|playernameb|teamname2|teamnameb)$/i],
    ["winner", /^(winner|wonby|victor|winningplayer|winnername|winningteam|won)$/i],
    ["loser", /^(loser|lostto|defeated|losingplayer|losername|losingteam)$/i],
    ["gender", /^(gender|sex|teamgender|playergender)$/i],
    ["division", /^(division|category|format|event|flight|draw|discipline|class|level|matchtype|matchformat|section|group|bracket)$/i],
    ["result", /^(result|outcome|winneris|matchresult|winloss|wl|worl|status)$/i],
    ["score", /^(score|gamescore|resultscore|setscore|sets|finalscore)$/i],
    ["date", /^(date|playedon|matchdate|timestamp|time|day)$/i],
    ["opponent", /^(opponent|against|versus|vs|opponentname|opposingplayer|opposingteam)$/i],
    ["firstName", /^(firstname|first|givenname)$/i],
    ["lastName", /^(lastname|last|surname|familyname)$/i],
    ["wins", /^(wins|win|w|victories|victory)$/i],
    ["losses", /^(losses|loss|l|defeats|defeat)$/i],
    ["record", /^(record|wlrecord|winlossrecord|overallrecord|seasonrecord)$/i],
    ["rank", /^(rank|ranking|position|standing|standings|ladderrank|seed|seedrank)$/i],
    ["name", /^(name|player|athlete|competitor|participant|student|roster|playername|athletename|teamname|team)$/i],
  ];

  function normalizeHeader(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]/g, "");
  }

  function canonicalField(value) {
    const normalized = normalizeHeader(value);
    if (!normalized) return "column";
    if (/^(boy|boys|girl|girls|male|female|men|women)$/.test(normalized)) return "gender";
    if (/^(single|singles|double|doubles|2v2)$/.test(normalized)) return "division";
    const match = FIELD_ALIASES.find(([, rule]) => rule.test(normalized));
    return match ? match[0] : "column";
  }

  function countDelimiter(line, delimiter) {
    let quoted = false;
    let count = 0;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      const next = line[i + 1];
      if (char === '"' && quoted && next === '"') { i += 1; continue; }
      if (char === '"') quoted = !quoted;
      else if (!quoted && char === delimiter) count += 1;
    }
    return count;
  }

  function detectDelimiter(text) {
    const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim()).slice(0, 24);
    const candidates = [",", "\t", ";", "|"];
    let best = { delimiter: ",", score: -Infinity };
    for (const delimiter of candidates) {
      const counts = lines.map(line => countDelimiter(line, delimiter)).filter(Boolean);
      if (!counts.length) continue;
      const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
      const variance = counts.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / counts.length;
      const consistency = counts.length / Math.max(lines.length, 1);
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

  function rowHeaderScore(cells, index) {
    const nonEmpty = cells.filter(value => String(value).trim()).length;
    if (!nonEmpty) return { score: -Infinity, mapping: [] };
    const mapping = cells.map(canonicalField);
    const recognized = mapping.filter(field => field !== "column").length;
    const unique = new Set(mapping.filter(field => field !== "column")).size;
    const matchSignal = mapping.some(field => ["winner", "loser", "player1", "player2", "opponent", "result", "record", "wins", "losses", "name"].includes(field));
    const score = recognized * 5 + unique * 2 + Math.min(nonEmpty, 10) + (matchSignal ? 4 : 0) - index * 0.12;
    return { score, mapping };
  }

  function detectHeaderRow(matrix) {
    let best = { index: 0, score: -Infinity, mapping: [] };
    matrix.slice(0, 40).forEach((cells, index) => {
      const candidate = rowHeaderScore(cells, index);
      if (candidate.score > best.score && candidate.mapping.some(field => field !== "column")) {
        best = { index, score: candidate.score, mapping: candidate.mapping };
      }
    });
    return best;
  }

  function looksLikeRepeatedHeader(values, headers) {
    let compared = 0;
    let matches = 0;
    for (let i = 0; i < Math.max(values.length, headers.length); i += 1) {
      const value = normalizeHeader(values[i]);
      if (!value) continue;
      compared += 1;
      const incoming = canonicalField(values[i]);
      const expected = String(headers[i] || "").replace(/\d+$/, "");
      if (incoming !== "column" && incoming === expected) matches += 1;
    }
    return compared >= 2 && matches >= Math.min(2, compared);
  }

  function extractScoreFromResult(value) {
    const text = String(value || "");
    const matches = text.match(/\b(?:\d{1,2}\s*[-–]\s*\d{1,2})(?:\s*,?\s*(?:\d{1,2}\s*[-–]\s*\d{1,2}))*\b/);
    return matches ? matches[0].replace(/–/g, "-").replace(/\s+/g, "") : "";
  }

  function normalizeResultCell(value) {
    const text = String(value || "").trim();
    if (/^(home|host|player\s*1|player\s*a|side\s*1|side\s*a)$/i.test(text)) return "Player A";
    if (/^(away|visitor|guest|player\s*2|player\s*b|side\s*2|side\s*b)$/i.test(text)) return "Player B";
    if (/^(w|win|won|winner)\b/i.test(text) || /\b(w|win|won)\s*$/i.test(text)) return "W";
    if (/^(l|loss|lost|loser)\b/i.test(text) || /\b(l|loss|lost)\s*$/i.test(text)) return "L";
    return text;
  }

  function postProcessRow(row) {
    if (!row.name && (row.firstName || row.lastName)) {
      row.name = [row.firstName, row.lastName].filter(Boolean).join(" ").trim();
    }
    if (row.result) {
      const originalResult = String(row.result).trim();
      const extracted = extractScoreFromResult(originalResult);
      if (!row.score && extracted) row.score = extracted;
      const wonAgainst = originalResult.match(/^(?:def\.?|beat|defeated)\s+(.+?)(?:\s+\d{1,2}\s*[-–]\s*\d{1,2}.*)?$/i);
      const lostAgainst = originalResult.match(/^(?:lost\s+to|fell\s+to)\s+(.+?)(?:\s+\d{1,2}\s*[-–]\s*\d{1,2}.*)?$/i);
      if (!row.opponent && wonAgainst) row.opponent = wonAgainst[1].trim();
      if (!row.opponent && lostAgainst) row.opponent = lostAgainst[1].trim();
      if (wonAgainst) row.result = "W";
      else if (lostAgainst) row.result = "L";
      else row.result = normalizeResultCell(originalResult);
    }
    if (row.record) {
      const match = String(row.record).match(/(\d+)\s*[-–/]\s*(\d+)/);
      if (match) {
        row.__aggregateWins = Number(match[1]);
        row.__aggregateLosses = Number(match[2]);
      }
    }
    if (row.wins !== undefined && String(row.wins).trim() !== "") {
      const wins = Number(String(row.wins).replace(/[^\d.-]/g, ""));
      if (Number.isFinite(wins) && wins >= 0) row.__aggregateWins = wins;
    }
    if (row.losses !== undefined && String(row.losses).trim() !== "") {
      const losses = Number(String(row.losses).replace(/[^\d.-]/g, ""));
      if (Number.isFinite(losses) && losses >= 0) row.__aggregateLosses = losses;
    }
    if (row.rank !== undefined && String(row.rank).trim() !== "") {
      const rank = Number(String(row.rank).replace(/[^\d.]/g, ""));
      if (Number.isFinite(rank) && rank > 0) row.__sourceRank = rank;
    }
    return row;
  }

  function parseText(text, sourceName) {
    const { matrix, delimiter } = parseDelimited(text);
    if (!matrix.length) return [];
    const detected = detectHeaderRow(matrix);
    const headerIndex = detected.index;
    const used = new Map();
    const rawHeaders = matrix[headerIndex] || [];
    const headers = rawHeaders.map((raw, index) => {
      const canonical = detected.mapping[index] === "column" ? (normalizeHeader(raw) || `column${index + 1}`) : detected.mapping[index];
      const count = used.get(canonical) || 0;
      used.set(canonical, count + 1);
      return count ? `${canonical}${count + 1}` : canonical;
    });
    const rows = [];
    matrix.slice(headerIndex + 1).forEach((values, offset) => {
      if (looksLikeRepeatedHeader(values, headers)) return;
      const row = Object.fromEntries(headers.map((header, index) => [header, String(values[index] ?? "").trim()]));
      row.__sourceRow = headerIndex + offset + 2;
      if (sourceName) row.__sheetName = sourceName;
      postProcessRow(row);
      if (Object.entries(row).some(([key, value]) => !key.startsWith("__") && String(value || "").trim())) rows.push(row);
    });
    rows.__analysis = {
      headerRow: headerIndex + 1,
      delimiter: delimiter === "\t" ? "tab" : delimiter === "|" ? "pipe" : delimiter,
      columns: rawHeaders.filter(Boolean),
      mapping: headers.map((header, index) => ({ source: rawHeaders[index] || header, field: header })),
      sourceName: sourceName || "",
      engine: "v2",
    };
    return rows;
  }

  function sectionHints(name) {
    const text = String(name || "");
    let gender = "";
    let division = "";
    if (/\b(girls?|women|female)\b/i.test(text)) gender = "Girls";
    else if (/\b(boys?|men|male)\b/i.test(text)) gender = "Boys";
    if (/\b(doubles?|pairs?|2v2)\b/i.test(text)) division = "Doubles";
    else if (/\b(singles?)\b/i.test(text)) division = "Singles";
    return { gender, division };
  }

  function mergeWorksheetRows(sheets) {
    const merged = [];
    const sheetNames = [];
    for (const sheet of sheets || []) {
      const name = String(sheet.name || "Sheet");
      const text = String(sheet.text || "");
      if (!text.trim()) continue;
      const rows = parseText(text, name);
      if (!rows.length) continue;
      const hints = sectionHints(name);
      rows.forEach(row => {
        if (hints.gender && !row.gender) row.gender = hints.gender;
        if (hints.division && !row.division) row.division = hints.division;
        merged.push(row);
      });
      sheetNames.push(name);
    }
    merged.__analysis = {
      headerRow: 1,
      delimiter: "workbook",
      columns: [],
      mapping: [],
      sourceName: sheetNames.join(", "),
      sheets: sheetNames,
      engine: "v2",
    };
    return merged;
  }

  function googleCsvUrl(input) {
    let url;
    try { url = new URL(String(input || "").trim()); }
    catch { throw new Error("Enter a valid spreadsheet link."); }

    const host = url.hostname.toLowerCase();
    const gid = url.hash.match(/(?:^|[&#])gid=(\d+)/)?.[1] || url.searchParams.get("gid") || "0";

    if (host === "docs.google.com") {
      const published = url.pathname.match(/^\/spreadsheets\/d\/e\/([^/]+)/);
      if (published) {
        return `https://docs.google.com/spreadsheets/d/e/${published[1]}/pub?output=csv&gid=${encodeURIComponent(gid)}`;
      }
      const standard = url.pathname.match(/\/spreadsheets\/(?:u\/\d+\/)?d\/([^/]+)/);
      if (standard) {
        return `https://docs.google.com/spreadsheets/d/${standard[1]}/export?format=csv&gid=${encodeURIComponent(gid)}`;
      }
    }

    if (host === "drive.google.com") {
      const id = url.searchParams.get("id");
      if (id) return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${encodeURIComponent(gid)}`;
    }

    return url.href;
  }

  function googleCsvProxyUrl(input) {
    const target = googleCsvUrl(input);
    const parsed = new URL(target);
    if (parsed.hostname.toLowerCase() === "docs.google.com") {
      return `/api/sheet-proxy?url=${encodeURIComponent(target)}`;
    }
    return target;
  }

  function keyForSummary(name, gender, division) {
    return `${String(gender || "").toLowerCase()}|${String(division || "singles").toLowerCase()}|${String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "")}`;
  }

  function inferGender(value, row) {
    const text = `${value || ""} ${row?.division || ""} ${row?.__sheetName || ""}`;
    if (/\b(girls?|women|female|f)\b/i.test(text)) return "girls";
    if (/\b(boys?|men|male|m)\b/i.test(text)) return "boys";
    return "unknown";
  }

  function inferDivision(value, row) {
    const text = `${value || ""} ${row?.__sheetName || ""}`;
    return /\b(doubles?|pairs?|2v2)\b/i.test(text) ? "doubles" : "singles";
  }

  function enhancedCalculateRankings(rows, legacyCalculate) {
    const base = typeof legacyCalculate === "function" ? legacyCalculate(rows) : { rankings: [], matches: [] };
    const map = new Map((base.rankings || []).map(item => [keyForSummary(item.name, item.gender, item.division), { ...item }]));
    let summaryCount = 0;

    (rows || []).forEach(row => {
      const wins = Number.isFinite(row.__aggregateWins) ? row.__aggregateWins : null;
      const losses = Number.isFinite(row.__aggregateLosses) ? row.__aggregateLosses : null;
      const sourceRank = Number.isFinite(row.__sourceRank) ? row.__sourceRank : null;
      if (wins === null && losses === null && sourceRank === null) return;
      const name = String(row.name || row.player || row.athlete || row.playername || row.teamname || "").trim();
      if (!name) return;
      const gender = inferGender(row.gender || row.sex, row);
      if (gender === "unknown") return;
      const division = inferDivision(row.division || row.event || row.format || row.matchtype, row);
      const key = keyForSummary(name, gender, division);
      const existing = map.get(key) || { key, name, gender, division, wins: 0, losses: 0, matches: 0, diff: 0, winRate: 0 };
      if (wins !== null) existing.wins = wins;
      if (losses !== null) existing.losses = losses;
      existing.matches = existing.wins + existing.losses;
      existing.diff = existing.wins - existing.losses;
      existing.winRate = existing.matches ? existing.wins / existing.matches : 0;
      if (sourceRank !== null) existing.sourceRank = sourceRank;
      map.set(key, existing);
      summaryCount += 1;
    });

    const rankings = [...map.values()];
    const rankedSourceRows = rankings.filter(item => Number.isFinite(item.sourceRank)).length;
    const honorSourceRank = rankedSourceRows >= 2 && rankedSourceRows >= Math.ceil(rankings.length * 0.5);
    rankings.sort((a, b) => {
      if (honorSourceRank) {
        const ar = Number.isFinite(a.sourceRank) ? a.sourceRank : Number.POSITIVE_INFINITY;
        const br = Number.isFinite(b.sourceRank) ? b.sourceRank : Number.POSITIVE_INFINITY;
        if (ar !== br) return ar - br;
      }
      return b.diff - a.diff || b.winRate - a.winRate || b.wins - a.wins || a.name.localeCompare(b.name);
    });
    return { rankings, matches: base.matches || [], summaryRowsApplied: summaryCount };
  }

  function fileKind(file) {
    const name = String(file?.name || "").toLowerCase();
    if (/\.(xlsx|xlsm|xlsb|xls|ods|fods|numbers)$/i.test(name)) return "workbook";
    if (/\.(csv|tsv|txt)$/i.test(name)) return "text";
    if (/spreadsheet|excel|opendocument|numbers/i.test(String(file?.type || ""))) return "workbook";
    return "text";
  }

  async function workbookRowsFromFile(file, XLSX) {
    if (!XLSX || typeof XLSX.read !== "function") {
      throw new Error("Spreadsheet support is still loading. Try the file again in a moment.");
    }
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
    const sheets = [];
    for (const name of workbook.SheetNames || []) {
      const sheet = workbook.Sheets[name];
      if (!sheet) continue;
      const text = XLSX.utils.sheet_to_csv(sheet, { blankrows: false, FS: ",", RS: "\n" });
      if (text.trim()) sheets.push({ name, text });
    }
    const rows = mergeWorksheetRows(sheets);
    if (!rows.length) throw new Error("No usable tennis rows were found in this workbook.");
    return rows;
  }

  function installCompatibilityUI(doc) {
    const input = doc.querySelector("#csvFile");
    if (input) {
      input.accept = [
        ".csv", ".tsv", ".txt", ".xlsx", ".xls", ".xlsm", ".xlsb", ".ods", ".fods", ".numbers",
        "text/csv", "text/tab-separated-values",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.oasis.opendocument.spreadsheet",
      ].join(",");
      const label = doc.querySelector('label[for="csvFile"]');
      if (label) label.textContent = "Upload a spreadsheet file";
    }
    const tab = doc.querySelector("#tabCsv");
    if (tab) {
      const icon = tab.querySelector("i");
      tab.childNodes.forEach(node => { if (node.nodeType === 3) node.textContent = ""; });
      tab.append(icon ? icon : doc.createTextNode(""));
      tab.append(doc.createTextNode(" Spreadsheet file"));
    }
    const textLabel = doc.querySelector('label[for="csvText"]');
    if (textLabel) textLabel.textContent = "Or paste CSV / TSV data";

    const tabs = doc.querySelector(".source-tabs");
    if (tabs && !doc.querySelector(".import-compatibility")) {
      const bar = doc.createElement("div");
      bar.className = "import-compatibility";
      bar.innerHTML = "<span>Works with</span><b>Google Sheets</b><b>Excel</b><b>CSV / TSV</b><b>ODS</b><b>Numbers</b>";
      tabs.insertAdjacentElement("afterend", bar);
    }

    const guide = doc.querySelector(".format-guide");
    if (guide) {
      const strong = guide.querySelector("strong");
      const code = guide.querySelector("code");
      const span = guide.querySelector("span");
      if (strong) strong.textContent = "Flexible column recognition";
      if (code) code.textContent = "Player · Opponent · W/L · Winner · Loser · Record · Rank · Score · Date";
      if (span) span.textContent = "Title rows, repeated headers, separate Boys/Girls or Singles/Doubles tabs, and common coach-export layouts are normalized automatically.";
    }
  }

  function installBrowser(win) {
    const doc = win.document;
    const boot = () => {
      installCompatibilityUI(doc);

      const legacyCalculate = typeof win.calculateRankings === "function" ? win.calculateRankings : null;
      win.parseCSV = parseText;
      win.googleCsvUrl = googleCsvProxyUrl;
      if (legacyCalculate) win.calculateRankings = rows => enhancedCalculateRankings(rows, legacyCalculate);

      const input = doc.querySelector("#csvFile");
      if (input && !input.dataset.importV2Bound) {
        input.dataset.importV2Bound = "true";
        input.addEventListener("change", async event => {
          const file = event.target.files?.[0];
          if (!file || fileKind(file) !== "workbook") return;
          event.stopImmediatePropagation();
          const button = doc.querySelector("#useCsv");
          try {
            if (typeof win.setBusy === "function") win.setBusy(button, true);
            if (typeof win.setStatus === "function") win.setStatus(`Reading ${file.name}...`);
            const rows = await workbookRowsFromFile(file, win.XLSX);
            if (typeof win.loadRows !== "function") throw new Error("The TennisRank importer is not ready yet.");
            win.loadRows(rows, "file");
            if (typeof win.setStatus === "function") win.setStatus(`Loaded ${rows.length} rows from ${rows.__analysis?.sheets?.length || 1} worksheet(s). Saving to the shared database...`);
            if (typeof win.syncToBackend === "function") {
              try {
                await win.syncToBackend();
                if (typeof win.setStatus === "function") win.setStatus(`Loaded and saved the workbook data from ${file.name}.`);
              } catch (error) {
                if (typeof win.setStatus === "function") win.setStatus(`Loaded the workbook, but it was not published: ${error.message}`, true);
              }
            }
          } catch (error) {
            if (typeof win.setStatus === "function") win.setStatus(error.message, true);
          } finally {
            if (typeof win.setBusy === "function") win.setBusy(button, false);
          }
        }, true);
      }
    };

    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", boot, { once: true });
    else boot();
  }

  return {
    normalizeHeader,
    canonicalField,
    detectDelimiter,
    parseDelimited,
    detectHeaderRow,
    parseText,
    sectionHints,
    mergeWorksheetRows,
    googleCsvUrl,
    googleCsvProxyUrl,
    enhancedCalculateRankings,
    fileKind,
    workbookRowsFromFile,
    installCompatibilityUI,
    installBrowser,
  };
});
