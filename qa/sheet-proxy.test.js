const assert = require('node:assert/strict');
const proxy = require('../api/sheet-proxy.js');

assert.equal(proxy.isAllowedGoogleExportHost('docs.google.com'), true, 'docs.google.com is allowed');
assert.equal(proxy.isAllowedGoogleExportHost('doc-0o-7k-sheets.googleusercontent.com'), true, 'Google Sheets export host is allowed');
assert.equal(proxy.isAllowedGoogleExportHost('drive.googleusercontent.com'), true, 'Google-owned googleusercontent subdomain is allowed');
assert.equal(proxy.isAllowedGoogleExportHost('evilgoogleusercontent.com'), false, 'lookalike domain is rejected');
assert.equal(proxy.isAllowedGoogleExportHost('example.com'), false, 'arbitrary redirect host is rejected');

const standard = proxy.parseAllowedUrl('https://docs.google.com/spreadsheets/d/abc123/export?format=csv&gid=0');
assert.equal(standard.hostname, 'docs.google.com');
assert.throws(
  () => proxy.parseAllowedUrl('https://example.com/spreadsheets/d/abc123/export?format=csv'),
  /Only Google Sheets CSV export URLs are allowed/,
  'initial SSRF target remains restricted to docs.google.com',
);

console.log('Google Sheets proxy security suite passed: expected Google export redirects allowed; arbitrary hosts rejected.');
