const assert = require("node:assert/strict");
const policy = require("../ranking-policy.js");

assert.equal(policy.detectGender("Mixed Doubles"), "mixed");
assert.equal(policy.detectGender("Co-ed"), "mixed");
assert.equal(policy.detectGender("", "Doubles", { partner1Gender: "M", partner2Gender: "F" }), "mixed");
assert.equal(policy.detectGender("Boys", "Doubles"), "boys");
assert.equal(policy.detectGender("Girls", "Doubles"), "girls");

assert.equal(policy.detectDivision("Mixed Doubles"), "doubles");
assert.equal(policy.detectDivision("XD"), "doubles");
assert.equal(policy.detectDivision("2D"), "doubles");
assert.equal(policy.detectDivision("Singles"), "singles");

assert.deepEqual(policy.splitPairNames("Alex&Ben"), ["Alex", "Ben"]);
assert.deepEqual(policy.splitPairNames("Maya / Zoe"), ["Maya", "Zoe"]);
assert.deepEqual(policy.splitPairNames("Ravi + Noah"), ["Ravi", "Noah"]);
assert.deepEqual(policy.splitPairNames("Emma and Olivia"), ["Emma", "Olivia"]);

console.log("doubles and mixed doubles tests passed");