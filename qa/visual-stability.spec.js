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

  const imageLoaded = await page.locator('.auth-visual img').evaluate(img => img.complete && img.naturalWidth > 0);
  expect(imageLoaded).toBe(true);
  await expectVerticalOrder(page, ['#loginEmail', '#loginPassword', '#loginButton']);
  await expectNoHorizontalOverflow(page);
}

test('desktop logged-out shell has no overlap, cursor hack, or overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await expectLoginState(page);
  await expectInsideViewport(page, '#loginEmail');
  await expectInsideViewport(page, '#loginPassword');
  await expectInsideViewport(page, '#loginButton');
  await page.screenshot({ path: 'qa-artifacts/login-desktop.png', fullPage: true });
});

test('mobile logged-out shell fits 390px viewport cleanly', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await expectLoginState(page);
  await expectInsideViewport(page, '#loginEmail');
  await expectInsideViewport(page, '#loginPassword');
  await expectInsideViewport(page, '#loginButton');
  await expectInsideViewport(page, '.auth-card');
  await page.screenshot({ path: 'qa-artifacts/login-mobile.png', fullPage: true });
});
