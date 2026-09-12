const { test, expect } = require('@playwright/test');

const base = process.env.QA_BASE || 'http://127.0.0.1:4173/qa-index.html';

test('TennisRank logo system stays crisp and non-disruptive', async ({ page }) => {
  await page.goto(base, { waitUntil: 'networkidle' });

  const authMark = page.locator('.auth-brand-lockup .tr-logo-mark');
  await expect(authMark).toBeVisible();
  await expect(page.locator('.topbar .tr-logo-wordmark')).toHaveCount(1);
  await expect(page.locator('#accountAvatar .tr-logo-mark')).toHaveCount(1);

  const favicon = await page.locator('link[rel="icon"]').getAttribute('href');
  expect(favicon).toContain('data:image/svg+xml');

  const theme = await page.locator('meta[name="theme-color"]').getAttribute('content');
  expect(theme).toBe('#f5f5f7');

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  const mobileTextDisplay = await page.locator('.tr-logo-wordmark-text').evaluate(el => getComputedStyle(el).display);
  expect(mobileTextDisplay).toBe('none');
});
