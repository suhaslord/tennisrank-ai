const assert = require("node:assert/strict");
const delimiterFix = require("../import-delimiter-fix.js");

function encodeCell(value, delimiter) {
  const text = String(value ?? "");
  if (text.includes('"') || text.includes("\n") || text.includes("\r") || text.includes(delimiter)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function encodeMatrix(matrix, delimiter) {
  return matrix.map(row => row.map(value => encodeCell(value, delimiter)).join(delimiter)).join("\n");
}

// Deterministic pseudo-random generator so the stress suite is reproducible.
let seed = 0x5eed1234;
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 0x100000000;
}

const embeddedCommaTsv = [
  "Player\tScore\tNote",
  "Smith, Alex\t6-3, 6-4\tWindy, late",
  "Kim, Leo\t7-5, 6-2\tIndoor, fast",
].join("\n");
assert.equal(delimiterFix.detectDelimiter(embeddedCommaTsv), "\t", "commas inside TSV cells must not become separators");

const delimiters = [",", "\t", ";", "|"];
const values = [
  "Aiden Shah",
  "Leo, Kim",
  "6-3, 6-4",
  "Boys",
  "Singles",
  "W",
  "L",
  'Court "One"',
  "Windy, late",
  "2026-08-15",
  "8-1",
  "",
];
const headerPool = ["Player", "Opponent", "Result", "Score", "Gender", "Division", "Date", "Note"];
let cases = 0;

for (const delimiter of delimiters) {
  for (let round = 0; round < 1000; round += 1) {
    const rowCount = 3 + Math.floor(random() * 8);
    const columnCount = 3 + Math.floor(random() * 6);
    const matrix = [];
    matrix.push(Array.from({ length: columnCount }, (_, index) => headerPool[index] || `Column ${index + 1}`));
    for (let rowIndex = 1; rowIndex < rowCount; rowIndex += 1) {
      const row = [];
      for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
        row.push(values[Math.floor(random() * values.length)]);
      }
      if (!row.some(Boolean)) row[0] = "Aiden Shah";
      matrix.push(row);
    }

    const encoded = encodeMatrix(matrix, delimiter);
    const parsed = delimiterFix.parseDelimited(encoded);
    assert.equal(parsed.delimiter, delimiter, `round ${round}: delimiter ${JSON.stringify(delimiter)}`);
    assert.deepEqual(
      parsed.matrix,
      matrix.map(row => row.map(value => String(value ?? "").trim())),
      `round ${round}: round-trip ${JSON.stringify(delimiter)}`,
    );
    cases += 1;
  }
}

console.log(`Delimiter fuzz suite passed: ${cases} deterministic CSV/TSV/semicolon/pipe round-trips.`);
