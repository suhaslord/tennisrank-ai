const { test, expect } = require('@playwright/test');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:4173/index.html';

async function mockExternal(page) {
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://cdn.sheetjs.com/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.XLSX = window.XLSX || {};' }));
}

async function gotoStartup(page) {
  test.setTimeout(12000);
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 6500 });
  expect(await page.evaluate(() => document.readyState)).toMatch(/interactive|complete/);
}

test('startup reaches DOMContentLoaded with the full UI layer enabled', async ({ page }) => {
  await mockExternal(page);
  await gotoStartup(page);
  await expect(page.locator('#authGate')).toBeVisible();
  await expect(page.locator('#importPreviewModal')).toBeHidden();
  expect(await page.evaluate(() => Boolean(window.__tennisrankUICohesionInstalled))).toBe(true);
});

test('hidden import preview does not create a mutation-observer startup loop', async ({ page }) => {
  await mockExternal(page);
  await gotoStartup(page);
  const result = await page.evaluate(async () => {
    let modal = document.querySelector('#importPreviewModal');
    const synthetic = !modal;
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'importPreviewModal';
      document.body.appendChild(modal);
    }
    modal.hidden = false;
    modal.style.display = 'none';
    const before = performance.now();
    document.body.classList.add('startup-loop-probe');
    document.body.classList.remove('startup-loop-probe');
    await new Promise(resolve => setTimeout(resolve, 80));
    const outcome = {
      elapsed: performance.now() - before,
      scrollLocked: document.body.classList.contains('coach-modal-open') || document.documentElement.classList.contains('tr-account-open'),
    };
    if (synthetic) modal.remove();
    return outcome;
  });
  expect(result.elapsed).toBeLessThan(1000);
  expect(result.scrollLocked).toBe(false);
});

test('startup has no deferred external script dependency', async ({ page }) => {
  test.setTimeout(12000);
  await page.route('https://cdn.jsdelivr.net/**', route => route.abort());
  await page.route('https://cdn.sheetjs.com/**', route => route.abort());
  await gotoStartup(page);
  const blockers = await page.evaluate(() => [...document.scripts]
    .filter(script => script.defer && /^https?:\/\//.test(script.src))
    .map(script => script.src));
  expect(blockers).toEqual([]);
});
