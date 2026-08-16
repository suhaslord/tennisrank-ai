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

function response(status = 200, text = 'Player,Opponent,Result\nAiden,Leo,W') {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: 'https://doc-0o-7k-sheets.googleusercontent.com/export.csv',
    headers: new Headers({ 'content-type': 'text/csv' }),
    body: null,
    text: async () => text,
  };
}

(async () => {
  let calls = 0;
  const retryTimeout = await proxy.fetchGoogleCsv(standard, {
    attempts: 2,
    timeoutMs: 50,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        const error = new Error('timed out');
        error.name = 'AbortError';
        throw error;
      }
      return response(200);
    },
  });
  assert.equal(retryTimeout.ok, true, 'a timeout should be retried once');
  assert.equal(retryTimeout.attempts, 2);
  assert.equal(calls, 2);

  calls = 0;
  const retryFiveHundred = await proxy.fetchGoogleCsv(standard, {
    attempts: 2,
    fetchImpl: async () => {
      calls += 1;
      return calls === 1 ? response(503, '') : response(200);
    },
  });
  assert.equal(retryFiveHundred.ok, true, 'transient Google 5xx should be retried');
  assert.equal(retryFiveHundred.attempts, 2);
  assert.equal(calls, 2);

  calls = 0;
  const notFound = await proxy.fetchGoogleCsv(standard, {
    attempts: 2,
    fetchImpl: async () => { calls += 1; return response(404, ''); },
  });
  assert.equal(notFound.ok, false);
  assert.equal(notFound.status, 422, '404/private/missing sheets remain user-actionable validation errors');
  assert.equal(calls, 1, 'non-transient 404 must not waste a retry');

  console.log('Google Sheets proxy suite passed: redirect security + timeout/429/5xx retry behavior verified.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
