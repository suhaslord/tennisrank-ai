const { test, expect } = require('@playwright/test');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:4173/qa-index.html';

async function expectNoHorizontalOverflow(page) {
  const size = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth }));
  expect(size.scroll).toBeLessThanOrEqual(size.viewport + 2);
}

async function expectInsideViewport(page, selector) {
  const box = await page.locator(selector).boundingBox();
  expect(box).not.toBeNull();
  const viewport = page.viewportSize();
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
}

async function expectVerticalOrder(page, selectors) {
  const boxes = [];
  for (const selector of selectors) boxes.push(await page.locator(selector).boundingBox());
  boxes.forEach(box => expect(box).not.toBeNull());
  for (let i = 1; i < boxes.length; i += 1) {
    expect(boxes[i].y).toBeGreaterThanOrEqual(boxes[i - 1].y + boxes[i - 1].height - 1);
  }
}

async function css(page, selector, property) {
  return page.locator(selector).evaluate((node, prop) => getComputedStyle(node)[prop], property);
}

async function expectLoginState(page) {
  await expect(page.locator('#authGate')).toBeVisible();
  await expect(page.locator('#loginForm')).toBeVisible();
  await expect(page.locator('#passwordForm')).toBeHidden();
  await expect(page.locator('#bootstrapForm')).toBeHidden();
  await expect(page.locator('#appShell')).toBeHidden();
  await expect(page.locator('.cursor-ball')).toHaveCount(0);

  const cursors = await page.evaluate(() => ({
    body: getComputedStyle(document.body).cursor,
    button: getComputedStyle(document.querySelector('#loginButton')).cursor,
    input: getComputedStyle(document.querySelector('#loginEmail')).cursor,
  }));
  expect(cursors.body).not.toBe('none');
  expect(cursors.button).toBe('pointer');
  expect(cursors.input).toBe('text');

  expect(await css(page, '.auth-card', 'backgroundColor')).toBe('rgb(255, 255, 255)');
  expect(await css(page, '#authTitle', 'color')).toBe('rgb(23, 26, 32)');
  expect(await css(page, '#loginButton', 'backgroundColor')).toBe('rgb(243, 107, 33)');
  expect(await css(page, '#authTitle', 'fontWeight')).toBe('500');
  expect(await css(page, '#authStatus', 'color')).toBe('rgb(92, 94, 98)');
  const visualBefore = await page.locator('.auth-visual').evaluate(node => getComputedStyle(node, '::before').display);
  expect(visualBefore).toBe('none');

  const imageLoaded = await page.locator('.auth-visual img').evaluate(img => img.complete && img.naturalWidth > 0);
  expect(imageLoaded).toBe(true);
  await expectVerticalOrder(page, ['#loginEmail', '#loginPassword', '#loginButton']);
  await expectNoHorizontalOverflow(page);
}

async function showAdminImport(page) {
  await page.evaluate(() => {
    document.body.classList.remove('auth-loading', 'role-player');
    document.body.classList.add('role-admin');
    document.querySelector('#authGate').hidden = true;
    document.querySelector('#appShell').hidden = false;
    document.querySelector('#settingsPanel').scrollIntoView({ block: 'start' });
    document.querySelector('.topbar')?.classList.add('is-scrolled');
  });
  await page.waitForTimeout(100);
}

test('desktop login follows Tesla palette and has no overlap or overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await expectLoginState(page);
  await expectInsideViewport(page, '#loginEmail');
  await expectInsideViewport(page, '#loginPassword');
  await expectInsideViewport(page, '#loginButton');
  await page.screenshot({ path: 'qa-artifacts/login-desktop.png', fullPage: true });
});

test('mobile login fits 390px viewport and preserves Tesla contrast', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await expectLoginState(page);
  await expectInsideViewport(page, '#loginEmail');
  await expectInsideViewport(page, '#loginPassword');
  await expectInsideViewport(page, '#loginButton');
  await expectInsideViewport(page, '.auth-card');
  await page.screenshot({ path: 'qa-artifacts/login-mobile.png', fullPage: true });
});

test('desktop import is a white editorial workspace, not a dark admin card', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await showAdminImport(page);
  await expect(page.locator('#settingsPanel')).toBeVisible();
  await expect(page.locator('.import-compatibility')).toContainText('Excel');
  expect(await css(page, '#settingsPanel', 'backgroundColor')).toBe('rgb(255, 255, 255)');
  expect(await css(page, '#settingsPanel', 'color')).toBe('rgb(23, 26, 32)');
  expect(await css(page, '#analyzerCard', 'backgroundColor')).toBe('rgb(255, 255, 255)');
  expect(await css(page, '#connectSheet', 'backgroundColor')).toBe('rgb(243, 107, 33)');
  expect(await css(page, '#settingsPanel h2', 'fontWeight')).toBe('500');
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: 'qa-artifacts/import-desktop.png', fullPage: true });
});

test('mobile import controls stay inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await showAdminImport(page);
  await expectInsideViewport(page, '#settingsPanel');
  await expectInsideViewport(page, '#sheetUrl');
  await expectInsideViewport(page, '#connectSheet');
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: 'qa-artifacts/import-mobile.png', fullPage: true });
});
