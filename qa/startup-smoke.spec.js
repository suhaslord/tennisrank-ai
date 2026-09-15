const { test, expect } = require('@playwright/test');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:4173/index.html';

const GROUPS = {
  integrity: ['match-dedup-guard.js', 'connected-sheet-guard.js', 'account-settings.js', 'ui-cohesion.js'],
  importer: ['match-result-compat.js', 'import-auto-sync.js', 'import-certainty-gate.js', 'spreadsheet-universal.js', 'repeated-header-runtime-guard.js', 'google-workbook-bridge.js', 'coach-essential.js'],
  ladder: ['ladder.js', 'challenge-ui.js', 'challenge-ui-state.js'],
  brand: ['brand-assets.js', 'human-copy.js', 'ui-cohesion.js', 'account-settings.js'],
};

function watchRequests(page) {
  const pending = new Map();
  const started = Date.now();
  page.on('request', request => pending.set(request.url(), { method: request.method(), type: request.resourceType(), at: Date.now() - started }));
  page.on('requestfinished', request => pending.delete(request.url()));
  page.on('requestfailed', request => pending.delete(request.url()));
  return pending;
}

async function mockExternal(page) {
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://cdn.sheetjs.com/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.XLSX = window.XLSX || {};' }));
}

async function suppressScripts(page, names) {
  for (const name of new Set(names)) {
    await page.route(`**/${name}`, route => route.fulfill({ status: 200, contentType: 'application/javascript', body: `/* startup isolation: ${name} */` }));
  }
}

async function reachesDomContentLoaded(page, label, suppressed = []) {
  test.setTimeout(10000);
  const pending = watchRequests(page);
  await mockExternal(page);
  await suppressScripts(page, suppressed);
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 5500 });
    console.log(`[startup-isolation:${label}] PASS with suppressed=${suppressed.join(',') || 'none'}`);
    return true;
  } catch (error) {
    const snapshot = [...pending.entries()].map(([url, info]) => ({ url, ...info }));
    console.error(`[startup-isolation:${label}] FAIL with suppressed=${suppressed.join(',') || 'none'} pending=${JSON.stringify(snapshot)}`);
    return false;
  }
}

test('baseline startup reaches DOMContentLoaded', async ({ page }) => {
  expect(await reachesDomContentLoaded(page, 'baseline')).toBe(true);
});

for (const [label, scripts] of Object.entries(GROUPS)) {
  test(`startup isolation: suppress ${label}`, async ({ page }) => {
    expect(await reachesDomContentLoaded(page, label, scripts)).toBe(true);
  });
}

test('startup isolation: suppress all recent suspect groups', async ({ page }) => {
  expect(await reachesDomContentLoaded(page, 'all-suspects', Object.values(GROUPS).flat())).toBe(true);
});

test('startup has no deferred external script dependency', async ({ page }) => {
  test.setTimeout(10000);
  const pending = watchRequests(page);
  await page.route('https://cdn.jsdelivr.net/**', route => route.abort());
  await page.route('https://cdn.sheetjs.com/**', route => route.abort());
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 5500 });
  } catch (error) {
    console.error('[startup-isolation:external-aborted] pending=', JSON.stringify([...pending.entries()]));
    throw error;
  }
  const blockers = await page.evaluate(() => [...document.scripts]
    .filter(script => script.defer && /^https?:\/\//.test(script.src))
    .map(script => script.src));
  expect(blockers).toEqual([]);
});
