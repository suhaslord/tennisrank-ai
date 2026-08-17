const SAMPLE_CSV = `Name,Gender,Division,Player 1,Player 2,Winner,Loser,Score,Date
Ava Patel,Girls,Singles,,,,,,
Mia Rodriguez,Girls,Singles,,,,,,
Noah Williams,Boys,Singles,,,,,,
Ethan Kim,Boys,Singles,,,,,,
Liam Chen,Boys,Doubles,,,,,,
Oliver Davis,Boys,Doubles,,,,,,
Sofia Garcia,Girls,Doubles,,,,,,
Emma Wilson,Girls,Doubles,,,,,,
,Boys,Singles,Noah Williams,Ethan Kim,Noah Williams,Ethan Kim,6-3,2026-08-03
,Boys,Singles,Ethan Kim,Noah Williams,Ethan Kim,Noah Williams,7-5,2026-08-04
,Girls,Singles,Ava Patel,Mia Rodriguez,Ava Patel,Mia Rodriguez,6-4,2026-08-03
,Boys,Doubles,Liam Chen & Oliver Davis,Marcus Lee & James Park,Liam Chen & Oliver Davis,Marcus Lee & James Park,8-6,2026-08-02
,Girls,Doubles,Sofia Garcia & Emma Wilson,Chloe Brown & Maya Shah,Chloe Brown & Maya Shah,Sofia Garcia & Emma Wilson,8-5,2026-08-03`;

const state = {
  rows: [],
  matches: [],
  rankings: [],
  activeGender: "all",
  activeDivision: "all",
  source: "sample",
  sourceUrl: "",
  lastUpdated: null,
  refreshTimer: null,
  backendAvailable: false,
  analysis: null,
  profile: null,
};

const LOCAL_SNAPSHOT_KEY = "tennisRankDataSnapshotV1";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const on = (target, event, handler, options) => {
  const element = typeof target === "string" ? $(target) : target;
  if (element) element.addEventListener(event, handler, options);
  return element;
};

let revealObserver;
const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

function prefersReducedMotion() {
  return reduceMotionQuery.matches;
}

function setupCursorBall() {
  const ball = $(".cursor-ball");
  if (!ball || !window.matchMedia("(pointer: fine)").matches) return;
  let frame = 0;
  let x = 0;
  let y = 0;

  const paint = () => {
    const radius = Math.max(ball.offsetWidth, ball.offsetHeight) / 2;
    const inset = radius + 2;
    const safeX = Math.min(Math.max(x, inset), window.innerWidth - inset);
    const safeY = Math.min(Math.max(y, inset), window.innerHeight - inset);
    ball.style.transform = `translate3d(${safeX}px, ${safeY}px, 0) translate(-50%, -50%)`;
    frame = 0;
  };

  window.addEventListener("pointermove", event => {
    if (event.pointerType === "touch") return;
    x = event.clientX;
    y = event.clientY;
    ball.classList.add("is-visible");
    if (!frame) frame = requestAnimationFrame(paint);
  }, { passive: true });
  document.addEventListener("pointerdown", () => ball.classList.add("is-pressed"));
  document.addEventListener("pointerup", () => ball.classList.remove("is-pressed"));
  document.documentElement.addEventListener("mouseleave", () => ball.classList.remove("is-visible", "is-pressed"));
  window.addEventListener("blur", () => ball.classList.remove("is-visible", "is-pressed"));
}

function setupTopbarState() {
  const topbar = $(".topbar");
  if (!topbar) return;
  const update = () => topbar.classList.toggle("is-scrolled", window.scrollY > 24);
  update();
  window.addEventListener("scroll", update, { passive: true });
}

function replayAnimation(element, className) {
  if (!element) return;
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}

function animateTicker(element, target, formatter) {
  if (!element) return;
  const end = Number(target);
  if (!Number.isFinite(end)) {
    element.textContent = String(target);
    return;
  }
  const hasPreviousValue = Object.prototype.hasOwnProperty.call(element.dataset, "tickerValue");
  const start = Number(element.dataset.tickerValue || 0);
  element.dataset.tickerValue = String(end);
  const format = formatter || (value => String(Math.round(value)));
  if (!hasPreviousValue || prefersReducedMotion() || start === end) {
    element.textContent = format(end);
    return;
  }
  if (element.dataset.tickerFrame) cancelAnimationFrame(Number(element.dataset.tickerFrame));
  const startedAt = performance.now();
  element.classList.add("is-ticking");
  const step = now => {
    const progress = Math.min((now - startedAt) / 440, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    element.textContent = format(start + (end - start) * eased);
    if (progress < 1) {
      element.dataset.tickerFrame = String(requestAnimationFrame(step));
    } else {
      element.classList.remove("is-ticking");
      delete element.dataset.tickerFrame;
    }
  };
  element.dataset.tickerFrame = String(requestAnimationFrame(step));
}

function animateTickerValues(root) {
  root?.querySelectorAll("[data-ticker-target]").forEach(element => {
    const format = element.dataset.tickerFormat === "percent"
      ? value => `${Math.round(value)}%`
      : value => String(Math.round(value));
    animateTicker(element, Number(element.dataset.tickerTarget), format);
  });
}

function setupScrollReveal() {
  const targets = $$(".story-card, .spotlight-card, .insight-strip, .section-heading, .filter-bar, .ranking-card, .table-card, .matches-card, .data-panel");
  targets.forEach(element => element.classList.add("reveal-on-scroll"));
  if (!("IntersectionObserver" in window)) {
    targets.forEach(element => element.classList.add("is-visible"));
    return;
  }
  if (!revealObserver) {
    revealObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      });
    }, { threshold: 0.08, rootMargin: "0px 0px -40px" });
  }
  targets.filter(element => !element.classList.contains("is-visible")).forEach(element => revealObserver.observe(element));
}

function setupStagger(selector) {
  $$(selector).forEach((element, index) => {
    element.style.setProperty("--stagger-index", index);
    element.classList.add("stagger-item");
  });
}

function setupImageFallbacks() {
  const markImageFailed = image => {
    image.classList.add("image-failed");
    image.parentElement?.classList.add("has-image-fallback");
  };

  const markImageReady = image => {
    image.classList.remove("image-failed");
    image.parentElement?.classList.remove("has-image-fallback");
  };

  const retryImage = image => {
    if (image.dataset.assetRetry === "done") {
      markImageFailed(image);
      return;
    }
    image.dataset.assetRetry = "done";
    const source = new URL(image.currentSrc || image.src, window.location.href);
    source.searchParams.set("asset-retry", "1");
    window.setTimeout(() => { image.src = source.href; }, 180);
  };

  $$("img").forEach(image => {
    if (image.dataset.fallbackBound) return;
    image.dataset.fallbackBound = "true";
    image.addEventListener("error", () => retryImage(image));
    image.addEventListener("load", () => markImageReady(image));
    // Do not hide an image while the browser is still resolving a deployed asset.
    // A delayed load can otherwise be mistaken for a failed image on first paint.
    if (image.complete) {
      if (image.naturalWidth > 0) {
        markImageReady(image);
      } else {
        window.setTimeout(() => {
          if (image.naturalWidth === 0) retryImage(image);
        }, 900);
      }
    }
  });
}

function setBusy(button, busy) {
  if (!button) return;
  button.classList.toggle("is-loading", busy);
  button.disabled = busy;
  button.setAttribute("aria-busy", String(busy));
}

async function withBusy(button, task) {
  setBusy(button, true);
  try {
    return await task();
  } finally {
    setBusy(button, false);
  }
}

function normalizeHeader(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const FIELD_RULES = [
  ["player1", /^(player|athlete|competitor|opponent|team|side|playername|teamname)(1|a)$/i],
  ["player2", /^(player|athlete|competitor|opponent|team|side|playername|teamname)(2|b)$/i],
  ["winner", /(winner|wonby|victor|winningplayer|winners|winnername)/i],
  ["loser", /(loser|lostto|defeated|losingplayer|losers|losername)/i],
  ["gender", /^(gender|sex|boys|girls|male|female|men|women)$/i],
  ["division", /(division|category|format|event|flight|draw|discipline|class|level|matchtype|section|group|bracket|singles|doubles)/i],
  ["result", /(result|outcome|winneris|matchresult|winloss|wonlost|status)/i],
  ["score", /(score|gamescore|resultscore|sets)/i],
  ["date", /(date|playedon|matchdate|timestamp|time)/i],
  ["opponent", /^(opponent|against|versus|opponentname)$/i],
  ["name", /(name|player|athlete|competitor|participant|student|roster|teamname|team)/i],
];

function fieldForHeader(value) {
  const normalized = normalizeHeader(value);
  if (!normalized) return "column";
  const match = FIELD_RULES.find(([, rule]) => rule.test(normalized));
  return match ? match[0] : "column";
}

function parseDelimited(text) {
  const sample = String(text || "").split(/\r?\n/).slice(0, 24).join("\n");
  const delimiters = [",", "\t", ";"];
  const delimiter = delimiters
    .map(candidate => ({ candidate, score: sample.split(candidate).length - 1 }))
    .sort((a, b) => b.score - a.score)[0].candidate;
  const result = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') { cell += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === delimiter && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) result.push(row);
      row = []; cell = "";
    } else cell += char;
  }
  if (cell || row.length) { row.push(cell.trim()); if (row.some(Boolean)) result.push(row); }
  return { matrix: result, delimiter };
}

function detectHeaderRow(matrix) {
  let best = { index: 0, score: -1, mapping: [] };
  matrix.slice(0, 30).forEach((cells, index) => {
    const nonEmpty = cells.filter(Boolean).length;
    if (!nonEmpty) return;
    const mapping = cells.map(fieldForHeader);
    const recognized = mapping.filter(field => field !== "column").length;
    const unique = new Set(mapping.filter(field => field !== "column")).size;
    const score = recognized * 4 + unique * 2 + Math.min(nonEmpty, 8) - index * 0.15;
    if (recognized && score > best.score) best = { index, score, mapping };
  });
  return best;
}

function parseCSV(text) {
  const { matrix, delimiter } = parseDelimited(String(text || "").replace(/^\uFEFF/, ""));
  if (!matrix.length) return [];
  const detected = detectHeaderRow(matrix);
  const headerIndex = detected.index;
  const used = new Map();
  const headers = matrix[headerIndex].map((raw, index) => {
    const field = detected.mapping[index] === "column" ? (normalizeHeader(raw) || `column${index}`) : detected.mapping[index];
    const count = used.get(field) || 0;
    used.set(field, count + 1);
    return count ? `${field}${count + 1}` : field;
  });
  const rows = matrix.slice(headerIndex + 1).map((values, rowIndex) => {
    const row = Object.fromEntries(headers.map((header, index) => [header, String(values[index] || "").trim()]));
    row.__sourceRow = headerIndex + rowIndex + 2;
    return row;
  }).filter(row => Object.entries(row).some(([key, value]) => key !== "__sourceRow" && Boolean(value)));
  rows.__analysis = {
    headerRow: headerIndex + 1,
    delimiter: delimiter === "\t" ? "tab" : delimiter,
    columns: matrix[headerIndex].filter(Boolean),
    mapping: headers.map((header, index) => ({ source: matrix[headerIndex][index] || header, field: header })),
  };
  return rows;
}

function valueFrom(row, aliases) {
  const entries = Object.entries(row);
  for (const alias of aliases) {
    const target = normalizeHeader(alias);
    const found = entries.find(([key, value]) => {
      const normalizedKey = normalizeHeader(key);
      return value && normalizedKey !== "sourcerow" && (normalizedKey === target || normalizedKey.includes(target));
    });
    if (found) return String(found[1]).trim();
  }
  return "";
}

function normalizeGender(value, division = "", row = {}) {
  const sources = [value, division, ...Object.values(row)];
  if (sources.some(source => /^(f|female|girl|girls|women|woman|wta)$/i.test(String(source).trim()) || /\b(female|girl|girls|women|woman|wta)\b/i.test(String(source)))) return "girls";
  if (sources.some(source => /^(m|male|boy|boys|men|man|atp)$/i.test(String(source).trim()) || /\b(male|boy|boys|men|man|atp)\b/i.test(String(source)))) return "boys";
  return "unknown";
}

function normalizeDivision(value, row = {}) {
  const text = `${value || ""} ${Object.values(row).join(" ")}`.toLowerCase();
  return /double|pair|duo|team event|2v2/.test(text) ? "doubles" : "singles";
}

function splitNames(value) {
  return String(value || "")
    .replace(/\s+(?:and|&|\+|vs\.?|versus)\s+/gi, "|")
    .split(/[|;/]/)
    .map(name => name.replace(/^\s*(?:(?:player\s*)?[ab12]\s*[:.)-]\s*|(?:player\s*)?[12]\s*[:.)-]\s*)/i, "").trim())
    .filter(Boolean);
}

function cleanNames(value) {
  return splitNames(value).map(name => name.replace(/\s+/g, " ").trim());
}

function keyFor(name, gender, division) {
  return `${gender}|${division}|${name.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}

function pairLabel(names) {
  const clean = names.filter(Boolean).map(name => name.trim());
  return clean.length > 1 ? [...clean].sort((a, b) => a.localeCompare(b)).join(" & ") : clean[0] || "Unknown team";
}

function isSamePerson(value, target) {
  const a = String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const b = String(target || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function readMatch(row, gender, division) {
  let winner = valueFrom(row, ["winner", "wonby", "victor", "winningplayer", "winners"]);
  let loser = valueFrom(row, ["loser", "lostto", "defeated", "losingplayer", "losers"]);
  const player1 = valueFrom(row, ["player1", "playera", "teama", "team1", "side1", "home", "opponent1"]);
  const player2 = valueFrom(row, ["player2", "playerb", "teamb", "team2", "side2", "away", "opponent2"]);
  const result = valueFrom(row, ["result", "outcome", "winneris", "matchresult", "winloss", "status"]);

  // Also accept a common row-per-player format: Player | Opponent | Result (W/L).
  const player = valueFrom(row, ["player", "name", "athlete", "playername", "student"]);
  const opponent = valueFrom(row, ["opponent", "against", "versus"]);
  if ((!winner || !loser) && player && opponent && result) {
    if (/^\s*(w|win|won|winner)\b/i.test(result)) { winner = player; loser = opponent; }
    if (/^\s*(l|loss|lost|loser)\b/i.test(result)) { winner = opponent; loser = player; }
  }

  if ((!winner || !loser) && player1 && player2) {
    const resultText = `${winner} ${result}`.trim().toLowerCase();
    if (/\b(player\s*1|player\s*a|side\s*1|side\s*a|^1$|^a$)\b/.test(resultText) || isSamePerson(winner, player1)) {
      winner = player1; loser = player2;
    } else if (/\b(player\s*2|player\s*b|side\s*2|side\s*b|^2$|^b$)\b/.test(resultText) || isSamePerson(winner, player2)) {
      winner = player2; loser = player1;
    } else if (/\b(w|win|won)\b/.test(resultText) && !/\b(l|loss|lost)\b/.test(resultText)) {
      winner = player1; loser = player2;
    }
  }
  if (!winner || !loser) return null;
  const winnerNames = cleanNames(winner);
  const loserNames = cleanNames(loser);
  if (!winnerNames.length || !loserNames.length) return null;
  return {
    gender,
    division,
    winner: division === "doubles" ? pairLabel(winnerNames) : winnerNames[0],
    loser: division === "doubles" ? pairLabel(loserNames) : loserNames[0],
    score: valueFrom(row, ["score", "resultscore", "gamescore"]),
    date: valueFrom(row, ["date", "matchdate", "playedon", "timestamp"]),
  };
}

function prepareRows(rows) {
  let currentGender = "";
  let currentDivision = "";
  return rows.map(row => {
    const publicValues = Object.entries(row)
      .filter(([key, value]) => !key.startsWith("__") && String(value || "").trim())
      .map(([, value]) => String(value).trim());
    const sectionText = publicValues.length === 1 && /\b(boys?|girls?|men|women|male|female)\b/i.test(publicValues[0])
      ? publicValues[0]
      : "";
    const directGender = normalizeGender(
      valueFrom(row, ["gender", "sex"]) || sectionText,
      valueFrom(row, ["division", "category", "event", "format", "section", "group"]),
    );
    const directDivision = valueFrom(row, ["division", "category", "format", "event", "type", "discipline", "matchtype", "section", "group"])
      || (/\b(singles?|doubles?|pairs?|2v2)\b/i.test(sectionText) ? sectionText : "");
    if (directGender !== "unknown") currentGender = directGender;
    if (directDivision) currentDivision = normalizeDivision(directDivision);
    const prepared = { ...row };
    if (sectionText) prepared.__sectionRow = true;
    if (!valueFrom(row, ["gender", "sex"]) && currentGender) prepared.__contextGender = currentGender;
    if (!directDivision && currentDivision) prepared.__contextDivision = currentDivision;
    return prepared;
  });
}

function calculateRankings(rows) {
  const entities = new Map();
  const matches = [];
  const ensure = (name, gender, division) => {
    if (!name || gender === "unknown") return;
    const label = division === "doubles" ? pairLabel(cleanNames(name)) : name.trim();
    if (!label) return;
    const key = keyFor(label, gender, division);
    if (!entities.has(key)) entities.set(key, { key, name: label, gender, division, wins: 0, losses: 0 });
    return entities.get(key);
  };

  prepareRows(rows).forEach(row => {
    if (row.__sectionRow) return;
    const divisionText = valueFrom(row, ["division", "category", "format", "event", "type"]);
    const gender = normalizeGender(valueFrom(row, ["gender", "sex"]) || row.__contextGender, divisionText || row.__contextDivision, row);
    let division = normalizeDivision(divisionText || row.__contextDivision || valueFrom(row, ["matchtype", "discipline"]), row);
    const rosterName = valueFrom(row, ["name", "player", "athlete", "playername", "teamname"]);
    const sideText = `${valueFrom(row, ["player1", "playera", "teama", "team1", "side1"])} ${valueFrom(row, ["player2", "playerb", "teamb", "team2", "side2"])}`;
    if (!divisionText && /&|\band\b|\+|\//i.test(sideText)) division = "doubles";
    const match = readMatch(row, gender, division);
    if (rosterName && !match) {
      // Doubles rankings represent pairs, not individual roster members. A
      // single-name doubles roster row is not enough information to create a
      // ranked team, so wait for a pair label or a match side.
      if (division === "doubles") {
        if (/[&+;/]|\band\b/i.test(rosterName)) ensure(pairLabel(cleanNames(rosterName)), gender, division);
      } else {
        ensure(rosterName, gender, division);
      }
    }
    if (match) {
      const winEntity = ensure(match.winner, gender, division);
      const loseEntity = ensure(match.loser, gender, division);
      if (winEntity && loseEntity) {
        winEntity.wins += 1; loseEntity.losses += 1;
        matches.push(match);
      }
    }
  });

  const rankings = [...entities.values()].map(player => ({
    ...player,
    matches: player.wins + player.losses,
    diff: player.wins - player.losses,
    winRate: player.wins + player.losses ? player.wins / (player.wins + player.losses) : 0,
  })).sort((a, b) => b.diff - a.diff || b.winRate - a.winRate || b.wins - a.wins || a.name.localeCompare(b.name));
  return { rankings, matches: matches.sort((a, b) => String(b.date).localeCompare(String(a.date))) };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  }[character]));
}

function analyzeRows(rows, calculated) {
  const metadata = rows.__analysis || {};
  const mapping = metadata.mapping || Object.keys(rows[0] || {})
    .filter(key => !key.startsWith("__"))
    .map(key => ({ source: key, field: key }));
  const fields = [...new Set(mapping.map(item => fieldForHeader(item.field)).filter(field => field !== "column"))];
  const prepared = prepareRows(rows);
  const potentialMatches = prepared.filter(row => {
    const divisionText = valueFrom(row, ["division", "category", "format", "event", "type"]) || row.__contextDivision || "";
    const gender = normalizeGender(valueFrom(row, ["gender", "sex"]) || row.__contextGender, divisionText, row);
    return Boolean(readMatch(row, gender, normalizeDivision(divisionText, row)));
  }).length;
  const unknownGender = prepared.filter(row => {
    const divisionText = valueFrom(row, ["division", "category", "format", "event", "type"]) || row.__contextDivision || "";
    return normalizeGender(valueFrom(row, ["gender", "sex"]) || row.__contextGender, divisionText, row) === "unknown";
  }).length;
  const hasMatchFields = fields.some(field => ["winner", "loser", "player1", "player2", "opponent", "result"].includes(field));
  const warnings = [];
  if (metadata.headerRow > 1) warnings.push(`Found the header row on row ${metadata.headerRow}; title or notes above it were skipped.`);
  if (!hasMatchFields) warnings.push("No match-result columns were found. Roster rows will still load at 0-0.");
  if (!potentialMatches) warnings.push("No complete matches were recognized yet. Check that each result has two sides and a winner, loser, or W/L result.");
  if (unknownGender && !fields.includes("gender")) warnings.push("Boys/Girls was not labeled in the sheet, so those rows cannot be ranked into a gender division yet.");
  const confidence = potentialMatches && (fields.includes("gender") || unknownGender < rows.length / 2) ? "HIGH" : hasMatchFields ? "MEDIUM" : "CHECK";
  return { ...metadata, mapping, fields, potentialMatches, calculatedMatches: calculated.matches.length, rosterRows: Math.max(rows.length - potentialMatches, 0), unknownGender, warnings, confidence };
}

function renderAnalyzer() {
  const card = $("#analyzerCard");
  if (!card || !state.analysis) return;
  const analysis = state.analysis;
  card.classList.add("ready");
  $("#analyzerTitle").textContent = `${analysis.calculatedMatches} match${analysis.calculatedMatches === 1 ? "" : "es"} recognized from ${state.rows.length} rows`;
  const badge = $("#analyzerConfidence");
  badge.textContent = analysis.confidence;
  badge.className = `confidence-badge ${analysis.confidence.toLowerCase()}`;
  $("#analyzerStats").innerHTML = [
    ["Header row", analysis.headerRow ? `Row ${analysis.headerRow}` : "Detected"],
    ["Roster rows", analysis.rosterRows],
    ["Ranked players", state.rankings.length],
  ].map(([label, value]) => `<div class="analyzer-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
  const importantFields = ["name", "gender", "division", "player1", "player2", "winner", "loser", "opponent", "result", "score", "date"];
  const fieldItems = analysis.mapping.filter(item => importantFields.includes(fieldForHeader(item.field)) || importantFields.includes(item.field));
  $("#analyzerFields").innerHTML = fieldItems.length
    ? fieldItems.map(item => `<span class="field-pill"><span>${escapeHtml(item.source)}</span><b>${escapeHtml(fieldForHeader(item.field) === "column" ? item.field : fieldForHeader(item.field))}</b></span>`).join("")
    : `<span class="field-pill muted">No familiar headers yet</span>`;
  $("#analyzerNote").textContent = analysis.warnings.length ? analysis.warnings.join(" ") : "The sheet structure looks good. Rankings will update whenever the source refreshes.";
}

function filteredRankings() {
  return state.rankings.filter(player => (state.activeGender === "all" || player.gender === state.activeGender) && (state.activeDivision === "all" || player.division === state.activeDivision));
}

function displayName(name) { return escapeHtml(name || "Unnamed player"); }
function formatRate(rate) { return `${Math.round(rate * 100)}%`; }
function formatDiff(diff) { return diff > 0 ? `+${diff}` : String(diff); }
function groupTitle(gender, division) { return `${gender === "boys" ? "Boys" : "Girls"} ${division === "singles" ? "singles" : "doubles"}`; }

function identityKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function belongsToPlayer(entityName, playerName) {
  const target = identityKey(playerName);
  if (!target) return false;
  return cleanNames(entityName).some(name => identityKey(name) === target) || identityKey(entityName) === target;
}

function renderPlayerDashboard() {
  const dashboard = $("#playerDashboard");
  if (!dashboard || state.profile?.role !== "player") return;
  const playerName = state.profile.player_name || state.profile.full_name;
  $("#playerDashboardTitle").textContent = `${playerName || "My"} season`;
  const entries = state.rankings.filter(player => belongsToPlayer(player.name, playerName));
  const total = entries.reduce((summary, player) => ({
    wins: summary.wins + player.wins,
    losses: summary.losses + player.losses,
    matches: summary.matches + player.matches,
  }), { wins: 0, losses: 0, matches: 0 });
  const best = [...entries].sort((a, b) => b.diff - a.diff || b.winRate - a.winRate)[0];
  const rank = best ? state.rankings.filter(player => player.gender === best.gender && player.division === best.division).findIndex(player => player.key === best.key) + 1 : 0;
  const rate = total.matches ? total.wins / total.matches : 0;
  $("#playerStatGrid").innerHTML = [
    ["Record", `${total.wins}-${total.losses}`, total.matches ? `${total.matches} matches recorded` : "No matches recorded yet"],
    ["Win rate", formatRate(rate), total.matches ? `${total.wins} wins this season` : "Starts at 0%"],
    ["Best rank", rank ? `#${rank}` : "-", best ? groupTitle(best.gender, best.division) : "Waiting for a matching sheet name"],
    ["Formats", entries.length, entries.length ? entries.map(entry => entry.division).filter((value, index, list) => list.indexOf(value) === index).join(" + ") : "No linked ranking yet"],
  ].map(([label, value, detail]) => `<article class="player-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></article>`).join("");

  const matches = state.matches.filter(match => belongsToPlayer(match.winner, playerName) || belongsToPlayer(match.loser, playerName)).slice(0, 8);
  $("#playerMatchList").innerHTML = matches.length ? matches.map(match => {
    const won = belongsToPlayer(match.winner, playerName);
    const opponent = won ? match.loser : match.winner;
    return `<div class="player-match"><span class="result-badge ${won ? "win" : "loss"}">${won ? "W" : "L"}</span><div><strong>${won ? "Defeated" : "Lost to"} ${displayName(opponent)}</strong><small>${escapeHtml(match.date || "Recent")} · ${escapeHtml(match.division)} · ${escapeHtml(match.score || "Score unavailable")}</small></div></div>`;
  }).join("") : `<div class="empty-state">No matches currently match “${escapeHtml(playerName)}.” Ask an admin to check the spreadsheet name on your account.</div>`;
}

function renderHero() {
  const matches = state.matches.length;
  const activePlayers = state.rankings.filter(player => player.matches > 0);
  const leader = [...activePlayers].sort((a, b) => b.diff - a.diff || b.winRate - a.winRate)[0];
  animateTicker($("#heroDiff"), leader?.diff || 0, value => formatDiff(Math.round(value)));
  $("#heroDiffDetail").textContent = leader ? `${leader.name} leads the current board` : "Add a match to create the first signal";
  $("#heroMatchCount").innerHTML = `<span class="inline-ticker" data-ticker-target="${matches}">0</span> ${matches === 1 ? "match" : "matches"} tracked`;
  animateTickerValues($("#heroMatchCount"));
  $("#heroUpdateState").textContent = state.lastUpdated ? `Updated ${state.lastUpdated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Sample data";
  $("#heroSourceLabel").textContent = state.source === "sheet" ? "Google Sheet" : state.source === "csv" ? "CSV import" : state.source === "backend" ? "Saved board" : "Sample board";
  $("#heroRowCount").textContent = `${state.rows.length} row${state.rows.length === 1 ? "" : "s"} analyzed`;
}

function renderInsight() {
  const played = state.rankings.filter(player => player.matches > 0);
  const leader = [...played].sort((a, b) => b.diff - a.diff || b.winRate - a.winRate || b.wins - a.wins)[0];
  const positive = state.rankings.filter(player => player.diff > 0).length;
  const title = leader ? `${displayName(leader.name)} is setting the pace` : "Your board is ready for its first result";
  const detail = leader
    ? `${leader.wins}-${leader.losses} record in ${leader.division}. ${positive} player${positive === 1 ? "" : "s"} currently above an even record.`
    : "Connect a sheet or add a CSV to turn roster rows into live rankings. Players begin at 0-0.";
  $("#insightStrip").innerHTML = `<div><div class="insight-kicker"><i class="ph-fill ph-sparkle" aria-hidden="true"></i> RANKING SIGNAL</div><strong>${title}</strong><p>${escapeHtml(detail)}</p></div>`;
}

function renderSummary() {
  const players = state.rankings;
  const matches = state.matches;
  const active = filteredRankings();
  const positive = players.filter(p => p.diff > 0).length;
  const tickerMarkup = value => {
    if (typeof value === "number") return `<div class="summary-value" data-ticker-target="${value}">0</div>`;
    const percent = String(value).match(/^(\d+)%$/);
    if (percent) return `<div class="summary-value" data-ticker-target="${percent[1]}" data-ticker-format="percent">0%</div>`;
    return `<div class="summary-value">${escapeHtml(value)}</div>`;
  };
  $("#summaryGrid").innerHTML = [
    ["ph-users", "Tracked players", players.length, `${players.filter(p => p.matches === 0).length} starting at 0-0`],
    ["ph-chart-line-up", "Matches analyzed", matches.length, `${positive} with a winning record`],
    ["ph-trophy", "Top win rate", players.filter(p => p.matches).length ? formatRate(Math.max(...players.filter(p => p.matches).map(p => p.winRate))) : "0%", "calculated from recorded matches"],
    ["ph-funnel", "Showing now", active.length, `${state.activeGender === "all" ? "all teams" : state.activeGender}, ${state.activeDivision === "all" ? "all formats" : state.activeDivision}`],
  ].map(([icon, label, value, detail]) => `<article class="summary-card"><div class="summary-label"><i class="ph ${icon}" aria-hidden="true"></i>${escapeHtml(label)}</div>${tickerMarkup(value)}<div class="summary-detail">${escapeHtml(detail)}</div></article>`).join("");
  animateTickerValues($("#summaryGrid"));
  setupStagger("#summaryGrid .summary-card");
}

function rankingCard(gender, division) {
  const players = state.rankings.filter(p => p.gender === gender && p.division === division);
  const filtered = players.filter(p => state.activeGender === "all" || state.activeGender === gender).filter(p => state.activeDivision === "all" || state.activeDivision === division).slice(0, 5);
  const full = players.slice(0, 5);
  const data = (state.activeGender === "all" && state.activeDivision === "all") ? full : filtered;
  const groupIcon = division === "singles" ? "ph-user" : "ph-users";
  return `<article class="ranking-card">
    <div class="ranking-card-head"><div class="ranking-heading"><div class="ranking-icon"><i class="ph ${groupIcon}" aria-hidden="true"></i></div><div><div class="ranking-title">${groupTitle(gender, division)}</div><div class="ranking-subtitle">${players.length} tracked ${division === "singles" ? "players" : "teams"}</div></div></div></div>
    ${data.length ? data.map((player, index) => `<div class="ranking-row"><div class="rank-number ${index < 3 ? "top" : ""}">#${index + 1}</div><div><div class="rank-name">${displayName(player.name)}</div><div class="rank-record">${player.wins}W - ${player.losses}L, ${formatRate(player.winRate)} win rate</div></div><div class="rank-diff ${player.diff < 0 ? "negative" : ""}">${formatDiff(player.diff)}</div></div>`).join("") : `<div class="empty-state">No players match these filters yet.</div>`}
  </article>`;
}

function renderRankings() {
  const groups = [["boys", "singles"], ["boys", "doubles"], ["girls", "singles"], ["girls", "doubles"]]
    .filter(([gender, division]) => (state.activeGender === "all" || state.activeGender === gender) && (state.activeDivision === "all" || state.activeDivision === division));
  $("#rankingsGrid").innerHTML = groups.map(([gender, division]) => rankingCard(gender, division)).join("");
  setupStagger("#rankingsGrid .ranking-card");
  setupStagger("#rankingsGrid .ranking-row");
  const players = filteredRankings();
  $("#rankingTable").innerHTML = players.length ? players.map((p, index) => `<tr><td>${index + 1}</td><td class="player-cell">${displayName(p.name)}</td><td>${p.gender}</td><td>${p.division}</td><td>${p.wins}-${p.losses}</td><td class="${p.diff < 0 ? "bad" : "good"}">${formatDiff(p.diff)}</td><td>${formatRate(p.winRate)}</td></tr>`).join("") : `<tr><td colspan="7" class="empty-state">No ranking data available.</td></tr>`;
  setupStagger("#rankingTable tr");
}

function renderMatches() {
  const matches = state.matches.filter(match => (state.activeGender === "all" || match.gender === state.activeGender) && (state.activeDivision === "all" || match.division === state.activeDivision)).slice(0, 8);
  $("#matchesList").innerHTML = matches.length ? matches.map(match => `<div class="match-row"><div class="match-meta"><i class="ph ph-calendar-blank" aria-hidden="true"></i>${escapeHtml(match.gender)} ${escapeHtml(match.division)}<br />${escapeHtml(match.date || "Recent")}</div><div class="match-players"><strong>${displayName(match.winner)}</strong><span>def.</span>${displayName(match.loser)}</div><div class="match-score"><i class="ph-fill ph-check-circle" aria-hidden="true"></i>${escapeHtml(match.score || "WIN")}</div></div>`).join("") : `<div class="empty-state">No matches have been recorded yet.</div>`;
  setupStagger("#matchesList .match-row");
}

function render() {
  renderHero(); renderSummary(); renderInsight(); renderRankings(); renderMatches(); renderAnalyzer(); renderPlayerDashboard();
  $("#lastUpdated").textContent = state.lastUpdated ? `Updated ${state.lastUpdated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Sample data";
  replayAnimation($("#insightStrip"), "content-swap");
  replayAnimation($("#rankingsGrid"), "content-swap");
  replayAnimation($("#rankingTable"), "content-swap");
  replayAnimation($("#matchesList"), "content-swap");
  setupScrollReveal();
}

function saveLocalSnapshot(rows, source) {
  if ((state.profile && state.profile.role !== "admin") || !Array.isArray(rows) || !rows.length || source === "sample") return;
  try {
    localStorage.setItem(LOCAL_SNAPSHOT_KEY, JSON.stringify({
      rows,
      source,
      sourceUrl: state.sourceUrl || "",
      savedAt: new Date().toISOString(),
    }));
  } catch {
    // The shared backend can still persist data if browser storage is full or unavailable.
  }
}

function readLocalSnapshot() {
  try {
    const snapshot = JSON.parse(localStorage.getItem(LOCAL_SNAPSHOT_KEY) || "null");
    return Array.isArray(snapshot?.rows) && snapshot.rows.length ? snapshot : null;
  } catch {
    localStorage.removeItem(LOCAL_SNAPSHOT_KEY);
    return null;
  }
}

function loadRows(rows, source = "csv") {
  if (!rows.length) throw new Error("No rows were found. Check that the first row contains column headers.");
  if (source === "csv") {
    state.sourceUrl = "";
    localStorage.removeItem("tennisRankSheetUrl");
  }
  const calculated = calculateRankings(rows);
  state.rows = rows; state.rankings = calculated.rankings; state.matches = calculated.matches; state.analysis = analyzeRows(rows, calculated); state.source = source; state.lastUpdated = new Date();
  saveLocalSnapshot(rows, source);
  render();
}

function loadText(text, source = "csv") {
  const rows = parseCSV(text);
  loadRows(rows, source);
}

function googleCsvUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Enter a valid Google Sheet link.");
  }
  if (url.hostname.toLowerCase() !== "docs.google.com") return input;
  const match = url.pathname.match(/\/spreadsheets\/(?:u\/\d+\/)?d\/([^/]+)/);
  if (!match) return input;
  const gid = url.hash.match(/gid=([0-9]+)/)?.[1] || url.searchParams.get("gid") || "0";
  return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${gid}`;
}

async function fetchSheet() {
  const input = $("#sheetUrl").value.trim() || state.sourceUrl;
  if (!input) throw new Error("Paste a Google Sheet link first.");
  const url = googleCsvUrl(input);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`The sheet could not be loaded (${response.status}). Check sharing permissions.`);
  const text = await response.text();
  if (text.trim().startsWith("<!DOCTYPE html") || text.includes("Sign in to continue")) throw new Error("Google returned a webpage instead of CSV. Set the sheet to Anyone with the link - Viewer.");
  state.sourceUrl = input;
  localStorage.setItem("tennisRankSheetUrl", input);
  loadText(text, "sheet");
}

async function fetchBackendRecords() {
  const response = await window.TennisRankAuth.fetch("/api/records", { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Persistent backend is not configured yet.");
  state.backendAvailable = true;
  const backendStatus = $("#backendStatus");
  backendStatus.textContent = `${payload.count || 0} saved spreadsheet rows available.`;
  backendStatus.className = "connected";
  if (Array.isArray(payload.rows) && payload.rows.length) loadRows(payload.rows, "backend");
  return payload;
}

async function syncToBackend(rows = state.rows) {
  if (state.profile?.role !== "admin") throw new Error("Only an admin can publish team data.");
  if (window.TennisRankCoachOps?.previewAndPublish) return window.TennisRankCoachOps.previewAndPublish(window, rows);
  const response = await window.TennisRankAuth.fetch("/api/records", {
    method: "POST",
    body: JSON.stringify({ rows, source: state.sourceUrl || state.source || "default" }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "The backend could not save this data.");
  state.backendAvailable = true;
  const backendStatus = $("#backendStatus");
  backendStatus.textContent = `${payload.saved || rows.length} rows saved to the database.`;
  backendStatus.className = "connected";
  return payload;
}

async function loadAccounts() {
  if (state.profile?.role !== "admin") return;
  const response = await window.TennisRankAuth.fetch("/api/users", { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Player accounts could not be loaded.");
  const list = $("#accountList");
  list.innerHTML = payload.profiles.length ? payload.profiles.map(account => `<article class="account-row"><span class="account-avatar">${escapeHtml((account.full_name || account.email).split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase())}</span><div><strong>${escapeHtml(account.full_name || account.email)}</strong><small>${escapeHtml(account.email)}${account.player_name ? ` · Sheet name: ${escapeHtml(account.player_name)}` : ""}${account.must_change_password ? " · Password change pending" : ""}</small></div><span class="role-pill">${escapeHtml(account.role)}</span></article>`).join("") : `<div class="empty-state">No accounts have been created yet.</div>`;
}

function setStatus(message, error = false) {
  const element = $("#statusMessage");
  const changed = element.textContent !== message || element.classList.contains("error") !== error;
  element.textContent = message;
  element.classList.toggle("error", error);
  if (changed) replayAnimation(element, "status-change");
}

function startRefresh() {
  clearInterval(state.refreshTimer);
  const seconds = Number($("#refreshRate").value);
  if (seconds && state.source === "sheet") state.refreshTimer = setInterval(() => fetchSheet().then(() => syncToBackend()).catch(error => setStatus(error.message, true)), seconds * 1000);
  if (seconds && state.source === "backend") state.refreshTimer = setInterval(() => fetchBackendRecords().catch(error => setStatus(error.message, true)), seconds * 1000);
  localStorage.setItem("tennisRankRefreshRate", String(seconds));
}

$$('[data-gender]').forEach(button => button.addEventListener("click", () => {
  $$('[data-gender]').forEach(item => { item.classList.remove("active"); item.setAttribute("aria-pressed", "false"); });
  button.classList.add("active"); button.setAttribute("aria-pressed", "true"); state.activeGender = button.dataset.gender; render();
}));
$$('[data-division]').forEach(button => button.addEventListener("click", () => {
  $$('[data-division]').forEach(item => { item.classList.remove("active"); item.setAttribute("aria-pressed", "false"); });
  button.classList.add("active"); button.setAttribute("aria-pressed", "true"); state.activeDivision = button.dataset.division; render();
}));

$$('.source-tab').forEach(button => button.addEventListener("click", () => {
  $$('.source-tab').forEach(item => { item.classList.remove("active"); item.setAttribute("aria-selected", "false"); });
  $$('.source-view').forEach(item => { item.classList.remove("active"); item.hidden = true; });
  button.classList.add("active"); button.setAttribute("aria-selected", "true");
  const view = $(button.dataset.source === "sheet" ? "#sheetSource" : "#csvSource");
  view.classList.add("active"); view.hidden = false;
}));

document.addEventListener("pointerdown", event => {
  const button = event.target.closest("button");
  if (!button || button.disabled || prefersReducedMotion()) return;
  const bounds = button.getBoundingClientRect();
  const ripple = document.createElement("span");
  ripple.className = "ripple";
  ripple.style.left = `${event.clientX - bounds.left}px`;
  ripple.style.top = `${event.clientY - bounds.top}px`;
  button.appendChild(ripple);
  ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
});

function setActiveNav(activeId) {
  $$(".nav-item").forEach(item => item.classList.toggle("active", item.id === activeId));
}

function scrollToSection(selector, activeId) {
  const target = document.querySelector(selector);
  if (!target) return;
  target.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  setActiveNav(activeId);
}

function setupAnchorNavigation() {
  const activeByTarget = {
    top: "navHome",
    rankingsSection: "navRankings",
    statsSection: "navRankings",
    settingsPanel: "navSettings",
    insightStrip: "navInsights",
  };
  $$('a[href^="#"]').forEach(link => on(link, "click", event => {
    const targetId = link.getAttribute("href").slice(1);
    const target = document.getElementById(targetId);
    if (!target) return;
    event.preventDefault();
    scrollToSection(`#${targetId}`, activeByTarget[targetId]);
    history.replaceState(null, "", `#${targetId}`);
  }));
}

function setupSectionNavigation() {
  if (!("IntersectionObserver" in window)) return;
  const targets = [
    [".hero-section", "navHome"],
    ["#insightStrip", "navInsights"],
    ["#rankingsSection", "navRankings"],
    ["#settingsPanel", "navSettings"],
  ].map(([selector, id]) => ({ element: document.querySelector(selector), id })).filter(item => item.element);
  const observer = new IntersectionObserver(entries => {
    const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (visible) setActiveNav(targets.find(item => item.element === visible.target)?.id);
  }, { rootMargin: "-25% 0px -55% 0px", threshold: [0, .2, .5] });
  targets.forEach(item => observer.observe(item.element));
}

on("#openSettings", "click", () => scrollToSection("#settingsPanel", "navSettings"));
on("#heroRankings", "click", () => scrollToSection("#rankingsSection", "navRankings"));
on("#heroData", "click", () => scrollToSection("#settingsPanel", "navSettings"));
on("#navHome", "click", () => scrollToSection("#top", "navHome"));
on("#navRankings", "click", () => scrollToSection("#rankingsSection", "navRankings"));
on("#navSettings", "click", () => scrollToSection("#settingsPanel", "navSettings"));
on("#navInsights", "click", () => scrollToSection("#insightStrip", "navInsights"));
on("#closeSettings", "click", () => scrollToSection("#rankingsSection", "navRankings"));
on("#connectSheet", "click", () => withBusy($("#connectSheet"), async () => {
  setStatus("Loading spreadsheet...");
  try {
    await fetchSheet();
    let saved = false;
    try {
      await syncToBackend();
      saved = true;
    } catch (backendError) {
      setStatus(`Loaded sheet data. ${backendError.message}`);
    }
    startRefresh();
    if (saved) setStatus(`Loaded and saved ${state.rankings.length} players and ${state.matches.length} matches.`);
  } catch (error) {
    setStatus(error.message, true);
  }
}));
on("#refreshNow", "click", () => withBusy($("#refreshNow"), async () => { setStatus("Refreshing..."); try { if (state.source === "sheet") { await fetchSheet(); try { await syncToBackend(); } catch (backendError) { setStatus(`Sheet refreshed. ${backendError.message}`); return; } } else if (state.source === "backend") await fetchBackendRecords(); else render(); setStatus("Data refreshed."); } catch (error) { setStatus(error.message, true); } }));
on("#saveBackend", "click", () => withBusy($("#saveBackend"), async () => { setStatus("Saving current data..."); try { await syncToBackend(); setStatus(`Saved ${state.rows.length} spreadsheet rows to the persistent database.`); } catch (error) { setStatus(error.message, true); $("#backendStatus").textContent = "Database connected, but this account could not publish the data."; $("#backendStatus").className = "error"; } }));
on("#csvFile", "change", event => { const file = event.target.files[0]; if (!file) return; const button = $("#useCsv"); setBusy(button, true); const reader = new FileReader(); reader.onload = async () => { try { loadText(reader.result, "csv"); setStatus("Data loaded. Saving to the shared database..."); try { await syncToBackend(); setStatus(`Loaded and saved ${state.rankings.length} players and ${state.matches.length} matches.`); } catch (error) { setStatus(`Loaded the file, but it was not published: ${error.message}`, true); } } catch (error) { setStatus(error.message, true); } finally { setBusy(button, false); } }; reader.onerror = () => { setStatus("The CSV file could not be read. Try exporting it again.", true); setBusy(button, false); }; reader.readAsText(file); });
on("#useCsv", "click", () => withBusy($("#useCsv"), async () => { try { loadText($("#csvText").value, "csv"); setStatus("Data loaded. Saving to the shared database..."); try { await syncToBackend(); setStatus(`Loaded and saved ${state.rankings.length} players and ${state.matches.length} matches.`); } catch (error) { setStatus(`Loaded the pasted data, but it was not published: ${error.message}`, true); } } catch (error) { setStatus(error.message, true); } }));
on("#refreshRate", "change", startRefresh);
on("#inviteForm", "submit", event => {
  event.preventDefault();
  return withBusy($("#inviteButton"), async () => {
    const status = $("#inviteStatus");
    status.textContent = "Sending invitation...";
    status.classList.remove("error");
    try {
      const response = await window.TennisRankAuth.fetch("/api/users", {
        method: "POST",
        body: JSON.stringify({
          email: $("#inviteEmail").value.trim(),
          fullName: $("#inviteFullName").value.trim(),
          playerName: $("#invitePlayerName").value.trim(),
          role: $("#inviteRole").value,
          temporaryPassword: $("#invitePassword").value,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Invitation failed.");
      event.target.reset();
      status.textContent = `Account created for ${payload.profile.email}. Share the temporary password privately; they must replace it at first sign-in.`;
      await loadAccounts();
    } catch (error) {
      status.textContent = error.message;
      status.classList.add("error");
    }
  });
});
on("#inviteRole", "change", event => {
  const isPlayer = event.target.value === "player";
  $("#invitePlayerName").required = isPlayer;
  $("#invitePlayerName").closest("div").classList.toggle("is-optional", !isPlayer);
});

$$('[data-gender], [data-division]').forEach(button => button.setAttribute("aria-pressed", String(button.classList.contains("active"))));
$$('.source-tab').forEach(button => button.setAttribute("aria-selected", String(button.classList.contains("active"))));
setupSectionNavigation();
setupImageFallbacks();
setupAnchorNavigation();
setupCursorBall();
setupTopbarState();

let appInitialized = false;
async function initializeAuthenticatedApp(profile) {
  if (appInitialized) return;
  appInitialized = true;
  state.profile = profile;
  const isAdmin = profile.role === "admin";
  if (!isAdmin) {
    localStorage.removeItem(LOCAL_SNAPSHOT_KEY);
    localStorage.removeItem("tennisRankSheetUrl");
  }
  const savedUrl = isAdmin ? localStorage.getItem("tennisRankSheetUrl") : "";
  const savedRate = isAdmin ? localStorage.getItem("tennisRankRefreshRate") : "0";
  if (savedUrl) { $("#sheetUrl").value = savedUrl; state.sourceUrl = savedUrl; }
  if (savedRate) $("#refreshRate").value = savedRate;
  $("#csvText").value = SAMPLE_CSV;
  const localSnapshot = isAdmin ? readLocalSnapshot() : null;
  if (localSnapshot) {
    state.sourceUrl = localSnapshot.sourceUrl || state.sourceUrl;
    loadRows(localSnapshot.rows, "local");
    setStatus("Restored the last admin copy saved on this device.");
  } else {
    loadText(SAMPLE_CSV, "sample");
  }
  try {
    const payload = await fetchBackendRecords();
    if (isAdmin) {
      startRefresh();
      await loadAccounts();
    }
    if (Array.isArray(payload.rows) && payload.rows.length) setStatus("Loaded the latest saved data from the shared database.");
    else if (!localSnapshot && isAdmin) setStatus("Database connected. Import data to start the shared board.");
  } catch (error) {
    const backendStatus = $("#backendStatus");
    if (backendStatus) {
      backendStatus.textContent = error.message;
      backendStatus.className = "error";
    }
    if (isAdmin) setStatus(error.message, true);
  }
}

window.addEventListener("tennisrank:auth-ready", event => initializeAuthenticatedApp(event.detail.profile));
if (window.TennisRankAuth?.getProfile()) initializeAuthenticatedApp(window.TennisRankAuth.getProfile());
