const { test, expect } = require('@playwright/test');

test('ranking, import sync, and player dashboard modules load together', async ({ page }) => {
  await page.route('**/api/config', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ supabaseUrl: 'https://example.supabase.co', publishableKey: 'test-key' }),
  }));

  await page.goto('/');
  await expect(page.locator('#authGate')).toBeVisible();

  const loaded = await page.evaluate(() => ({
    ranking: Boolean(window.TennisRankRankingPolicy),
    importSync: Boolean(window.TennisRankImportAutoSync),
    playerDashboard: Boolean(window.TennisRankPlayerDashboard),
    calculateWrapped: Boolean(window.calculateRankings?.__coachRankingPolicy),
  }));
  expect(loaded).toEqual({ ranking: true, importSync: true, playerDashboard: true, calculateWrapped: true });

  const ordered = await page.evaluate(() => window.TennisRankRankingPolicy.sortRankings([
    { name: 'Losing Player', wins: 1, losses: 2 },
    { name: 'New Player', wins: 0, losses: 0 },
    { name: 'Winning Player', wins: 2, losses: 1 },
  ]).map(player => player.name));
  expect(ordered).toEqual(['Winning Player', 'New Player', 'Losing Player']);
});
