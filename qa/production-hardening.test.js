const assert = require('node:assert/strict');
const records = require('../api/records');
const sheetProxy = require('../api/sheet-proxy');

function response({ status = 200, url, contentType = 'text/csv; charset=utf-8', text = 'Name,Gender,Division\nAlex,boys,singles\n' }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    body: null,
    headers: {
      get(name) {
        const key = String(name || '').toLowerCase();
        if (key === 'content-type') return contentType;
        if (key === 'content-length') return String(Buffer.byteLength(text, 'utf8'));
        return null;
      },
    },
    async text() { return text; },
  };
}

async function run() {
  const validLarge = Array.from({ length: 1001 }, (_, i) => ({
    Name: `Player ${i + 1}`,
    Gender: i % 2 ? 'girls' : 'boys',
    Division: 'singles',
  }));
  assert.equal(records.validateRows(validLarge), '', '1,001-row season should be accepted');

  const duplicateRows = [
    { Name: 'Alex Rivera', Gender: 'boys', Division: 'singles' },
    { Name: 'Alex Rivera', Gender: 'boys', Division: 'singles' },
  ];
  const duplicateCopy = JSON.parse(JSON.stringify(duplicateRows));
  assert.equal(records.validateRows(duplicateRows), '', 'duplicate rows should be handled downstream rather than rejected as malformed');
  assert.deepEqual(duplicateRows, duplicateCopy, 'validation must never mutate imported rows');

  const tooMany = Array.from({ length: 10001 }, (_, i) => ({ Name: `Player ${i}` }));
  assert.match(records.validateRows(tooMany), /too large/i, '10,001 rows must be rejected');

  assert.match(records.validateRows([{ Name: 'Valid' }, {}]), /every spreadsheet row/i, 'blank rows must be rejected at the publish boundary');
  assert.match(records.validateRows([{ __row: 1 }]), /every spreadsheet row/i, 'metadata-only rows must be rejected');
  assert.match(records.validateRows([['Alex', 'boys']]), /every spreadsheet row/i, 'array-shaped rows must be rejected');

  const oversized = Array.from({ length: 3800 }, (_, i) => ({ Name: `Player ${i}`, Notes: 'x'.repeat(1200) }));
  assert.match(records.validateRows(oversized), /4 MB/i, 'payloads above the server publish limit must be rejected');

  const standard = sheetProxy.parseAllowedUrl('https://docs.google.com/spreadsheets/d/abc123/export?format=csv&gid=0');
  assert.equal(standard.hostname, 'docs.google.com');
  const published = sheetProxy.parseAllowedUrl('https://docs.google.com/spreadsheets/d/e/pub123/pub?output=csv');
  assert.equal(published.hostname, 'docs.google.com');
  assert.throws(() => sheetProxy.parseAllowedUrl('https://evil.example/spreadsheets/d/abc/export?format=csv'), /Only Google Sheets/i);
  assert.throws(() => sheetProxy.parseAllowedUrl('https://docs.google.com/spreadsheets/d/abc123/edit'), /Only Google Sheets CSV export URLs/i);

  const target = standard.href;
  let attempts = 0;
  const retryResult = await sheetProxy.fetchGoogleCsv(target, {
    attempts: 2,
    timeoutMs: 1000,
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) return response({ status: 503, url: target, text: 'temporary' });
      return response({ status: 200, url: target });
    },
  });
  assert.equal(retryResult.ok, true);
  assert.equal(retryResult.attempts, 2, 'transient Google errors should retry exactly once here');
  assert.equal(attempts, 2);

  const htmlResult = await sheetProxy.fetchGoogleCsv(target, {
    attempts: 1,
    timeoutMs: 1000,
    fetchImpl: async () => response({ status: 200, url: target, contentType: 'text/html; charset=utf-8', text: '<html>Sign in</html>' }),
  });
  assert.equal(htmlResult.ok, false);
  assert.equal(htmlResult.status, 422);
  assert.match(htmlResult.error, /sign-in page/i);

  const redirected = await sheetProxy.fetchGoogleCsv(target, {
    attempts: 1,
    timeoutMs: 1000,
    fetchImpl: async () => response({ status: 200, url: 'https://attacker.example/export.csv' }),
  });
  assert.equal(redirected.ok, false);
  assert.equal(redirected.status, 422);
  assert.match(redirected.error, /redirected outside/i);

  assert.equal(sheetProxy.reserveProviderCall(1000000), true);
  assert.equal(sheetProxy.reserveProviderCall(1000001), true);
  assert.equal(sheetProxy.reserveProviderCall(1000002), true);
  assert.equal(sheetProxy.reserveProviderCall(1000003), true);
  assert.equal(sheetProxy.reserveProviderCall(1000004), false, 'AI provider calls should be rate limited after four calls per minute');

  console.log('production hardening stress tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
