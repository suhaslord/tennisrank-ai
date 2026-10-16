const { test, expect } = require('@playwright/test');

const BASE = 'http://tennisrank.test';
const LOCAL = 'http://127.0.0.1:4173';

async function installMocks(page) {
  const profile = { id: 'coach', role: 'admin', full_name: 'Coach QA', must_change_password: false };
  const state = {
    rows: [{ winner: 'Demo Alpha', loser: 'Demo Beta', score: '6-3', gender: 'Boys', division: 'Singles' }],
    clears: 0,
    fail: false,
  };
  await page.addInitScript(() => {
    localStorage.setItem('tennisRankAuthSessionV1', JSON.stringify({ access_token: 'qa-token', refresh_token: 'qa-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'coach' } }));
  });
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('https://cdn.sheetjs.com/**', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route(`${BASE}/**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/')) return route.fulfill({ response: await route.fetch({ url: `${LOCAL}${url.pathname}${url.search}` }) });
    const reply = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/config') return reply({ supabaseUrl: 'https://fake.supabase.test', publishableKey: 'qa-key' });
    if (url.pathname === '/api/session') return reply({ profile });
    if (url.pathname === '/api/records') {
      if (request.method() === 'POST') {
        expect(request.postDataJSON()).toEqual({ action: 'clear' });
        state.clears += 1;
        if (state.fail) return reply({ error: 'Reset temporarily unavailable. Try again.' }, 503);
        state.rows = [];
        return reply({ cleared: true, snapshotId: 'rollback', message: 'Imported data removed.' });
      }
      return reply({ rows: state.rows, count: state.rows.length, snapshots: [] });
    }
    if (url.pathname === '/api/ladder') return reply({ ladder: [], settings: [], viewer: { role: 'admin' } });
    if (url.pathname === '/api/users') return reply({ profiles: [profile], roster: [] });
    if (url.pathname === '/api/challenges') return reply({ challenges: [] });
    return reply({});
  });
  await page.goto(`${BASE}/admin`);
  await expect(page.locator('#rankingTable')).toContainText('Demo Alpha');
  return state;
}

for (const width of [390, 1440]) test(`recoverable reset confirms in-page and persists after reload at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const state = await installMocks(page);
  const remove = page.locator('#trEssentialBar').getByRole('button', { name: 'Remove data', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Remove team data?' });
  await remove.click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('A rollback snapshot is kept in Import History.');
  await expect(dialog.getByRole('button', { name: 'Keep data' })).toBeFocused();
  const box = await dialog.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(900);
  await page.screenshot({ path: `qa-artifacts/reset-dialog-${width}.png` });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(remove).toBeFocused();
  expect(state.clears).toBe(0);
  await remove.click();
  await dialog.getByRole('button', { name: 'Keep data' }).click();
  expect(state.clears).toBe(0);
  await expect(page.locator('#rankingTable')).toContainText('Demo Alpha');
  await remove.click();
  const reloaded = page.waitForEvent('domcontentloaded');
  await dialog.getByRole('button', { name: 'Remove data', exact: true }).click();
  await reloaded;
  await expect(page.locator('#appShell')).toBeVisible();
  await expect(page.locator('#rankingTable')).toContainText('No ranking data');
  expect(state.clears).toBe(1);
  expect(state.rows).toHaveLength(0);
  await expect(page.locator('#ladderList')).not.toContainText('Demo Alpha');
  await expect(page.locator('#accountMenu')).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => {
    const header = document.querySelector('.topbar').getBoundingClientRect();
    const intro = document.querySelector('.ladder-kicker').getBoundingClientRect();
    return intro.top >= header.bottom;
  })).toBe(true);
  for (const selector of ['#ladderExperience .ladder-empty', '#ladderExperience .ladder-kicker', '#ladderExperience .ladder-metric-label']) {
    await expect(page.locator(selector).first()).toHaveCSS('color', 'rgb(103, 107, 99)');
  }
  await page.screenshot({ path: `qa-artifacts/launch-empty-${width}.png` });
});

test('reset failure keeps saved rows and allows retry', async ({ page }) => {
  const state = await installMocks(page);
  state.fail = true;
  const remove = page.locator('#trEssentialBar').getByRole('button', { name: 'Remove data', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Remove team data?' });
  await remove.click();
  await dialog.getByRole('button', { name: 'Remove data', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Reset temporarily unavailable');
  await expect(remove).toBeEnabled();
  await expect(page.locator('#rankingTable')).toContainText('Demo Alpha');
  state.fail = false;
  await remove.click();
  const reloaded = page.waitForEvent('domcontentloaded');
  await dialog.getByRole('button', { name: 'Remove data', exact: true }).click();
  await reloaded;
  await expect(page.locator('#rankingTable')).toContainText('No ranking data');
  expect(state.clears).toBe(2);
});
