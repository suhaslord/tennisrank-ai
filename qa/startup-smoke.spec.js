const { test, expect } = require('@playwright/test');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:4173/index.html';

function watchRequests(page) {
  const pending = new Map();
  const started = Date.now();
  page.on('request', request => pending.set(request.url(), { method: request.method(), type: request.resourceType(), at: Date.now() - started }));
  page.on('requestfinished', request => pending.delete(request.url()));
  page.on('requestfailed', request => pending.delete(request.url()));
  return pending;
}

async function navigateWithDiagnostics(page, pending, label) {
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 7000 });
  } catch (error) {
    const snapshot = [...pending.entries()].map(([url, info]) => ({ url, ...info }));
    console.error(`[startup-smoke:${label}] DOMContentLoaded did not fire. Pending requests:`, JSON.stringify(snapshot, null, 2));
    console.error(`[startup-smoke:${label}] document snapshot:`, await page.evaluate(() => ({
      readyState: document.readyState,
      scripts: [...document.scripts].map(script => ({ src: script.src, async: script.async, defer: script.defer })),
      styles: [...document.querySelectorAll('link[rel="stylesheet"]')].map(link => ({ href: link.href, media: link.media })),
    })).catch(() => ({ unavailable: true })));
    throw error;
  }
}

test.describe.configure({ mode: 'serial' });

test('startup reaches DOMContentLoaded with external network removed', async ({ page }) => {
  test.setTimeout(12000);
  const pending = watchRequests(page);
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://cdn.sheetjs.com/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.XLSX = window.XLSX || {};' }));
  await navigateWithDiagnostics(page, pending, 'mocked-external');
  expect(await page.evaluate(() => document.readyState)).toMatch(/interactive|complete/);
});

test('startup has no deferred external script dependency', async ({ page }) => {
  test.setTimeout(12000);
  const pending = watchRequests(page);
  await page.route('https://cdn.jsdelivr.net/**', route => route.abort());
  await page.route('https://cdn.sheetjs.com/**', route => route.abort());
  await navigateWithDiagnostics(page, pending, 'external-aborted');
  const blockers = await page.evaluate(() => [...document.scripts]
    .filter(script => script.defer && /^https?:\/\//.test(script.src))
    .map(script => script.src));
  expect(blockers).toEqual([]);
});
