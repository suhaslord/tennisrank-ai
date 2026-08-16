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

test('story photography is compact and balanced on desktop', async ({ page }) => {
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
      storyHeight: rect(storyImage).height,
      spotlightHeight: rect(spotlightImage).height,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  expect(metrics.storyRatio).toBeGreaterThan(0.28);
  expect(metrics.storyRatio).toBeLessThan(0.34);
  expect(metrics.spotlightRatio).toBeGreaterThan(0.28);
  expect(metrics.spotlightRatio).toBeLessThan(0.34);
  expect(metrics.storyHeight).toBeLessThanOrEqual(330);
  expect(metrics.spotlightHeight).toBeLessThanOrEqual(330);
  expect(metrics.overflow).toBeLessThanOrEqual(2);

  await page.locator('.story-rail').scrollIntoViewIfNeeded();
  await page.waitForTimeout(220);
  await page.screenshot({ path: 'qa-artifacts/story-photos-desktop.png', fullPage: false });
});

test('story photography stays compact on mobile without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await showApp(page);

  const metrics = await page.evaluate(() => {
    const storyImage = document.querySelector('.story-card .story-image').getBoundingClientRect();
    const spotlightImage = document.querySelector('.spotlight-card .spotlight-image').getBoundingClientRect();
    return {
      storyHeight: storyImage.height,
      spotlightHeight: spotlightImage.height,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  expect(metrics.storyHeight).toBeLessThanOrEqual(190);
  expect(metrics.spotlightHeight).toBeLessThanOrEqual(190);
  expect(metrics.overflow).toBeLessThanOrEqual(2);

  await page.locator('.story-rail').scrollIntoViewIfNeeded();
  await page.waitForTimeout(220);
  await page.screenshot({ path: 'qa-artifacts/story-photos-mobile.png', fullPage: false });
});
