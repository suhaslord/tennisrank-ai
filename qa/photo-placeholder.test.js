const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const placeholder = require('../api/photo-placeholder');
const vercel = require('../vercel.json');

assert.match(placeholder.SVG, /Abstract tennis court graphic/i);
assert.match(placeholder.SVG, /<svg/i);
assert.doesNotMatch(placeholder.SVG, /<image\b/i, 'placeholder must not embed an external or private photo');

const rewrites = new Map((vercel.rewrites || []).map(item => [item.source, item.destination]));
for (const asset of [
  '/assets/team-court.jpg',
  '/assets/matchday-awards.jpg',
  '/assets/singles-spotlight.jpg',
]) {
  assert.equal(rewrites.get(asset), '/api/photo-placeholder', `${asset} should resolve to the privacy-safe fallback`);
  assert.equal(fs.existsSync(path.join(__dirname, '..', asset.replace(/^\//, ''))), false, `${asset} must not ship as a team photo`);
}

console.log('Privacy-safe photo placeholder regression passed: legacy image URLs resolve without restoring team photos.');
