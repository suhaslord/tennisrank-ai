const { test, expect } = require('@playwright/test');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:4173/qa-index.html';

async function showApp(page) {
  await page.evaluate(() => {
    document.body.classList.remove('auth-loading', 'role-player');
    document.body.classList.add('role-admin');
    document.querySelector('#authGate').hidden = true;
    document.querySelector('#appShell').hidden = false;
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(160);
}

test('story photography is slightly smaller without breaking Tesla-MD layout', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await showApp(page);

  const metrics = await page.evaluate(() => {
    const story = document.querySelector('.story-card');
    const storyImage = document.querySelector('.story-card .story-image');
    const spotlight = document.querySelector('.spotlight-card');
    const spotlightImage = document.querySelector('.spotlight-card .spotlight-image');
    const rect = node => node.getBoundingClientRect();
    return {
      storyRatio: rect(storyImage).width / rect(story).width,
      spotlightRatio: rect(spotlightImage).width / rect(spotlight).width,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  expect(metrics.storyRatio).toBeGreaterThan(0.40);
  expect(metrics.storyRatio).toBeLessThan(0.49);
  expect(metrics.spotlightRatio).toBeGreaterThan(0.40);
  expect(metrics.spotlightRatio).toBeLessThan(0.49);
  expect(metrics.overflow).toBeLessThanOrEqual(2);

  await page.screenshot({ path: 'qa-artifacts/story-photos-desktop.png', fullPage: false });
});

test('photo adjustment does not change the mobile stacking', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await showApp(page);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
});
