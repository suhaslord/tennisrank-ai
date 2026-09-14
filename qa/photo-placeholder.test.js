const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const render = require('../api/render');
const vercel = require('../vercel.json');

assert.match(render.PHOTO_PLACEHOLDER_SVG, /Abstract tennis court graphic/i);
assert.match(render.PHOTO_PLACEHOLDER_SVG, /<svg/i);
assert.doesNotMatch(render.PHOTO_PLACEHOLDER_SVG, /<image\b/i, 'placeholder must not embed an external or private photo');
assert.equal(render.wantsPhotoPlaceholder({ query: { asset: 'photo-placeholder' } }), true);
assert.equal(render.wantsPhotoPlaceholder({ url: '/api/render?asset=photo-placeholder', query: {} }), true);
assert.equal(render.wantsPhotoPlaceholder({ url: '/api/render', query: {} }), false);

const rewrites = new Map((vercel.rewrites || []).map(item => [item.source, item.destination]));
for (const asset of [
  '/assets/team-court.jpg',
  '/assets/matchday-awards.jpg',
  '/assets/singles-spotlight.jpg',
]) {
  assert.equal(rewrites.get(asset), '/api/render?asset=photo-placeholder', `${asset} should resolve through the existing renderer`);
  assert.equal(fs.existsSync(path.join(__dirname, '..', asset.replace(/^\//, ''))), false, `${asset} must not ship as a team photo`);
}

assert.equal(fs.existsSync(path.join(__dirname, '..', 'api', 'photo-placeholder.js')), false, 'photo fallback must not consume an extra Vercel function slot');

console.log('Privacy-safe photo fallback regression passed: legacy image URLs resolve through the existing renderer without restoring team photos or adding a function.');
