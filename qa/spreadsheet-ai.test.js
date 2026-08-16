const assert = require("node:assert/strict");
const server = require("../api/sheet-proxy.js");
const client = require("../spreadsheet-ai.js");
const ml = require("../spreadsheet-ml.js");
const importer = require("../import-v2.js");
const fixes = require("../import-v2-fixes.js");
const calibration = require("../spreadsheet-semantic-calibration.js");
fixes.patchImporter(importer);
calibration.wrapImporter(importer, ml);

{
  const rows = [
    { opaque1: "Aiden Shah", opaque2: "Leo Kim", opaque3: "W", opaque4: "Boys", opaque5: "Singles", email: "aiden@example.com" },
    { opaque1: "Maya Lee", opaque2: "Zoe Rivera", opaque3: "L", opaque4: "Girls", opaque5: "Singles", email: "maya@example.com" },
    { opaque1: "Aiden Shah", opaque2: "Ravi Patel", opaque3: "W", opaque4: "Boys", opaque5: "Singles", email: "aiden@example.com" },
  ];
  const payload = server.buildRedactedPayload(rows, "Aiden's Boys Singles Results", {});
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes("Aiden Shah"), false, "real player names never leave the server for the AI provider");
  assert.equal(serialized.includes("Maya Lee"), false, "all detected names are redacted");
  assert.equal(serialized.includes("aiden@example.com"), false, "emails are redacted");
  assert.match(serialized, /PERSON_\d{3}/, "name-shaped values become stable person tokens");
  assert.match(serialized, /EMAIL_REDACTED/, "emails become a non-identifying placeholder");
  assert.equal(payload.samples[0].opaque1, payload.samples[2].opaque1, "the same person gets the same token so relationships remain inferable");
  assert.equal(payload.sourceContext.includes("boys"), true, "only useful tennis context survives from the source name");
  assert.equal(payload.sourceContext.toLowerCase().includes("aiden"), false, "source-name PII is removed");
}

{
  const rows = [
    { c1: "Aiden Shah", c2: "Leo Kim", c3: "W", c4: "Boys", c5: "Singles" },
    { c1: "Maya Lee", c2: "Zoe Rivera", c3: "L", c4: "Girls", c5: "Singles" },
  ];
  rows.__analysis = { mapping: ["c1", "c2", "c3", "c4", "c5"].map(field => ({ source: field, field })) };
  const ai = {
    supported: true,
    sheetKind: "match_log",
    confidence: 0.97,
    globalGender: "unknown",
    globalDivision: "singles",
    mappings: [
      { inputKey: "c1", target: "name", confidence: 0.98, reason: "primary athlete" },
      { inputKey: "c2", target: "opponent", confidence: 0.98, reason: "other athlete" },
      { inputKey: "c3", target: "result", confidence: 0.99, reason: "W/L values" },
      { inputKey: "c4", target: "gender", confidence: 0.99, reason: "Boys/Girls values" },
      { inputKey: "c5", target: "division", confidence: 0.99, reason: "Singles values" },
    ],
    warnings: [],
  };
  const mapped = client.applyAiMapping(rows, ai);
  assert.equal(mapped.length, rows.length, "AI schema application never creates or drops rows");
  assert.deepEqual(
    { name: mapped[0].name, opponent: mapped[0].opponent, result: mapped[0].result, gender: mapped[0].gender, division: mapped[0].division },
    { name: "Aiden Shah", opponent: "Leo Kim", result: "W", gender: "Boys", division: "Singles" },
    "AI mapping changes keys while preserving original values exactly",
  );
  assert.equal(mapped[0].c1, undefined, "misnamed source key is removed after remapping");
  assert.equal(mapped.__analysis.ai.status, "applied");
}

{
  const rows = [
    { first: "Aiden", last: "Shah", standing: "1", recordish: "9-1" },
    { first: "Leo", last: "Kim", standing: "2", recordish: "7-3" },
  ];
  const ai = {
    supported: true,
    sheetKind: "standings",
    confidence: 0.96,
    globalGender: "boys",
    globalDivision: "singles",
    mappings: [
      { inputKey: "first", target: "firstName", confidence: 0.99, reason: "first name" },
      { inputKey: "last", target: "lastName", confidence: 0.99, reason: "last name" },
      { inputKey: "standing", target: "rank", confidence: 0.97, reason: "ordinal" },
      { inputKey: "recordish", target: "record", confidence: 0.97, reason: "W-L aggregate" },
    ],
    warnings: [],
  };
  const mapped = client.applyAiMapping(rows, ai);
  assert.equal(mapped[0].name, "Aiden Shah", "separate first/last columns are joined deterministically after AI schema selection");
  assert.equal(mapped[0].gender, "boys");
  assert.equal(mapped[0].division, "singles");
  assert.equal(mapped[0].rank, "1");
  assert.equal(mapped[0].record, "9-1");
}

{
  const validated = server.validateAiResult({
    supported: true,
    sheetKind: "match_log",
    confidence: 1.2,
    globalGender: "unknown",
    globalDivision: "unknown",
    mappings: [
      { inputKey: "real", target: "result", confidence: 0.9, reason: "valid" },
      { inputKey: "invented", target: "winner", confidence: 1, reason: "must be removed" },
      { inputKey: "real", target: "notAField", confidence: 1, reason: "must be removed" },
    ],
    warnings: ["x"],
  }, ["real"]);
  assert.equal(validated.confidence, 1, "AI confidence is clamped to a valid range");
  assert.equal(validated.mappings.length, 1, "AI cannot map nonexistent columns or unsupported target fields");
  assert.equal(validated.mappings[0].inputKey, "real");
}

(async () => {
  const rows = importer.parseText([
    "Thing A,Thing B,Thing C,Thing D,Thing E",
    "Aiden Shah,Leo Kim,W,Boys,Singles",
    "Maya Lee,Zoe Rivera,L,Girls,Singles",
  ].join("\n"), "Tennis Results");
  const fakeAuth = {
    async fetch(path) {
      assert.equal(path, "/api/ai-analyze-sheet");
      return {
        ok: true,
        async json() {
          return {
            model: "gemini-test",
            privacy: { redactedBeforeProvider: true },
            ai: {
              supported: true,
              sheetKind: "match_log",
              confidence: 0.98,
              globalGender: "unknown",
              globalDivision: "unknown",
              mappings: [
                { inputKey: "name", target: "name", confidence: 0.96, reason: "player" },
                { inputKey: "opponent", target: "opponent", confidence: 0.96, reason: "opponent" },
                { inputKey: "result", target: "result", confidence: 0.99, reason: "W/L" },
                { inputKey: "gender", target: "gender", confidence: 0.99, reason: "team gender" },
                { inputKey: "division", target: "division", confidence: 0.99, reason: "event type" },
              ],
              warnings: [],
            },
          };
        },
      };
    },
  };
  const enhanced = await client.enhanceRows(rows, { source: "file", sourceName: "weird.xlsx", importer, auth: fakeAuth });
  const review = importer.validateInterpretation(enhanced);
  assert.equal(review.valid, true, "AI-assisted rows still pass the independent local validator");
  assert.ok(["applied-and-validated", "verified-kept-local"].includes(enhanced.__analysis.ai.status));
  console.log("Spreadsheet AI privacy + schema verification suite passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
