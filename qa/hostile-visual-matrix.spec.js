const { test, expect } = require('@playwright/test');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:4173/qa-ai-index.html';
const SUPABASE = 'https://fake.supabase.test';

const VIEWPORTS = [
  { name: '320x568', width: 320, height: 568 },
  { name: '360x640', width: 360, height: 640 },
  { name: '375x667', width: 375, height: 667 },
  { name: '390x844', width: 390, height: 844 },
  { name: '412x915', width: 412, height: 915 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '820x1180', width: 820, height: 1180 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '1365x768', width: 1365, height: 768 },
  { name: '1440x1000', width: 1440, height: 1000 },
];

const BOARDS = [
  ['boys|singles', 'Boys Singles'],
  ['girls|singles', 'Girls Singles'],
  ['boys|doubles', 'Boys Doubles'],
  ['girls|doubles', 'Girls Doubles'],
  ['mixed|doubles', 'Mixed Doubles'],
];

const POSITIONS = [0, 0.12, 0.27, 0.42, 0.58, 0.73, 0.88, 1];

const ROWS = [
  { winner: 'Noah', loser: 'Liam', score: '6-3 6-4', gender: 'Boys', division: 'Singles', date: '2026-09-15' },
  { winner: 'Noah', loser: 'Ethan', score: '6-2 6-2', gender: 'Boys', division: 'Singles', date: '2026-09-14' },
  { winner: 'Jack', loser: 'Noah', score: '7-5 6-4', gender: 'Boys', division: 'Singles', date: '2026-09-13' },
  { winner: 'Liam', loser: 'Jack', score: '6-4 6-3', gender: 'Boys', division: 'Singles', date: '2026-09-12' },
  { winner: 'Ethan', loser: 'Jack', score: '6-1 6-2', gender: 'Boys', division: 'Singles', date: '2026-09-11' },
  { winner: 'Ava', loser: 'Mia', score: '6-4 6-3', gender: 'Girls', division: 'Singles', date: '2026-09-15' },
  { winner: 'Zoe', loser: 'Emma', score: '6-2 6-1', gender: 'Girls', division: 'Singles', date: '2026-09-14' },
  { winner: 'Mia', loser: 'Zoe', score: '7-5 6-4', gender: 'Girls', division: 'Singles', date: '2026-09-13' },
  { winner: 'Ava', loser: 'Emma', score: '6-0 6-2', gender: 'Girls', division: 'Singles', date: '2026-09-12' },
  { winner: 'Ethan & Noah', loser: 'Jack & Liam', score: '6-2 6-4', gender: 'Boys', division: 'Doubles', date: '2026-09-15' },
  { winner: 'Ben & Sam', loser: 'Ethan & Noah', score: '7-5 6-4', gender: 'Boys', division: 'Doubles', date: '2026-09-14' },
  { winner: 'Jack & Liam', loser: 'Ben & Sam', score: '6-3 6-3', gender: 'Boys', division: 'Doubles', date: '2026-09-13' },
  { winner: 'Ava & Zoe', loser: 'Emma & Mia', score: '6-1 6-3', gender: 'Girls', division: 'Doubles', date: '2026-09-15' },
  { winner: 'Nina & Priya', loser: 'Ava & Zoe', score: '7-6 6-4', gender: 'Girls', division: 'Doubles', date: '2026-09-14' },
  { winner: 'Emma & Mia', loser: 'Nina & Priya', score: '6-4 6-2', gender: 'Girls', division: 'Doubles', date: '2026-09-13' },
  { winner: 'Olivia & Ravi', loser: 'Ben & Sophia', score: '7-5 6-4', gender: 'Mixed', division: 'Doubles', date: '2026-09-15' },
  { winner: 'Maya & Arjun', loser: 'Olivia & Ravi', score: '6-4 3-6 10-7', gender: 'Mixed', division: 'Doubles', date: '2026-09-14' },
  { winner: 'Ben & Sophia', loser: 'Maya & Arjun', score: '6-3 6-2', gender: 'Mixed', division: 'Doubles', date: '2026-09-13' },
];

function bodyOf(request) {
  try { return request.postDataJSON() || {}; } catch { return {}; }
}

async function installMocks(page) {
  const profile = {
    id: 'hostile-admin', email: 'hostile@example.test', full_name: 'TennisRank Admin',
    player_name: null, role: 'admin', must_change_password: false,
  };
  const savedRows = ROWS.map(row => ({ ...row }));

  await page.addInitScript(({ profile }) => {
    localStorage.setItem('tennisRankAuthSessionV1', JSON.stringify({
      access_token: 'qa-access', refresh_token: 'qa-refresh',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: profile.id, email: profile.email },
    }));
  }, { profile });

  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://cdn.sheetjs.com/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.XLSX = window.XLSX || {};' }));
  await page.route(`${SUPABASE}/auth/v1/**`, route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

  await page.route('**/api/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const ok = value => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
    if (path === '/api/config') return ok({ supabaseUrl: SUPABASE, publishableKey: 'qa-public-key' });
    if (path === '/api/session') return ok({ profile });
    if (path === '/api/users') return ok({ profiles: [], roster: [] });
    if (path === '/api/challenges') return ok({ challenges: [] });
    if (path === '/api/admin/seed-ladder') return ok({ seeded: 0 });
    if (path === '/api/records' && request.method() === 'GET') return ok({ rows: savedRows, count: savedRows.length, snapshots: [] });
    if (path === '/api/records' && request.method() === 'POST') {
      const body = bodyOf(request);
      if (body.action === 'preview') return ok({ previewHash: 'hostile-preview', rowCount: body.rows?.length || 0, warnings: [] });
      if (body.action === 'publish') {
        savedRows.splice(0, savedRows.length, ...(body.rows || []));
        return ok({ saved: savedRows.length, snapshotId: 'hostile-snapshot' });
      }
      return ok({ saved: savedRows.length });
    }
    if (path === '/api/ladder') return ok({
      ladder: [],
      settings: [
        { team_gender: 'boys', max_challenge_distance: 3 },
        { team_gender: 'girls', max_challenge_distance: 3 },
      ],
      viewer: { profileId: profile.id, role: profile.role },
      needsAttention: {}, teamStatus: {}, audit: [], undoCandidates: [], missingAccounts: [], importWarnings: [],
    });
    if (path.startsWith('/api/admin/')) return ok({ ok: true, ladder: [], audit: [], undoCandidates: [] });
    return ok({});
  });
}

async function assertHealthyFrame(page, label) {
  const health = await page.evaluate(() => {
    const html = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    const preview = document.querySelector('#importPreviewModal');
    const account = document.querySelector('#trAccountSettingsShell');
    const visible = node => Boolean(node && !node.hidden && getComputedStyle(node).display !== 'none' && node.getClientRects().length);
    const modalOpen = visible(preview) || visible(account) || Boolean(document.querySelector('dialog[open]'));
    const offenders = [...document.querySelectorAll('button,input,select,textarea,a[href],[role="tab"]')]
      .filter(node => {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden' || node.getClientRects().length === 0) return false;
        const r = node.getBoundingClientRect();
        return r.right > innerWidth + 3 || r.left < -3;
      })
      .slice(0, 12)
      .map(node => ({ tag: node.tagName, id: node.id, text: (node.textContent || '').trim().slice(0, 50), rect: node.getBoundingClientRect().toJSON?.() || {} }));
    return {
      scrollWidth: document.documentElement.scrollWidth,
      viewport: innerWidth,
      modalOpen,
      htmlOverflowY: html.overflowY,
      bodyOverflowY: body.overflowY,
      bodyPosition: body.position,
      offenders,
    };
  });
  expect(health.scrollWidth, `${label}: horizontal page overflow`).toBeLessThanOrEqual(health.viewport + 3);
  expect(health.offenders, `${label}: clipped/offscreen controls`).toEqual([]);
  if (!health.modalOpen) {
    expect(health.htmlOverflowY, `${label}: html scroll lock`).not.toBe('hidden');
    expect(health.bodyOverflowY, `${label}: body scroll lock`).not.toBe('hidden');
    expect(health.bodyPosition, `${label}: body fixed outside a modal`).not.toBe('fixed');
  }
}

async function assertPageCanScroll(page, label) {
  const can = await page.evaluate(async () => {
    const max = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    if (max < 30) return { max, moved: true };
    window.scrollTo(0, 0);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    window.scrollTo(0, Math.min(max, 180));
    await new Promise(r => setTimeout(r, 40));
    const moved = scrollY > 0;
    window.scrollTo(0, 0);
    return { max, moved };
  });
  expect(can.moved, `${label}: page could not scroll despite ${can.max}px scroll range`).toBe(true);
}

async function shot(page, path) {
  await page.screenshot({ path, type: 'jpeg', quality: 48, fullPage: false, animations: 'disabled' });
}

async function showLogin(page) {
  await page.evaluate(() => {
    document.body.classList.remove('role-admin', 'role-player');
    document.querySelector('#authGate').hidden = false;
    document.querySelector('#appShell').hidden = true;
    window.scrollTo(0, 0);
  });
}

async function showApp(page) {
  await page.evaluate(() => {
    document.body.classList.remove('auth-loading', 'role-player');
    document.body.classList.add('role-admin');
    document.querySelector('#authGate').hidden = true;
    document.querySelector('#appShell').hidden = false;
    window.dispatchEvent(new CustomEvent('tennisrank:auth-ready', { detail: { profile: { role: 'admin' } } }));
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(50);
}

async function openPreview(page) {
  await showApp(page);
  await page.locator('#settingsPanel').scrollIntoViewIfNeeded();
  await page.locator('#tabCsv').click();
  await page.locator('#csvText').fill([
    'Winner,Loser,Score,Gender,Division,Date',
    'Noah,Liam,6-3,Boys,Singles,2026-09-15',
    'Ava,Mia,6-4,Girls,Singles,2026-09-15',
  ].join('\n'));
  await page.locator('#useCsv').click();
  await expect(page.locator('#importPreviewModal')).toBeVisible({ timeout: 5000 });
}

test('hostile 500-state visual matrix', async ({ page }) => {
  test.setTimeout(25 * 60 * 1000);
  await installMocks(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });

  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error?.stack || error)));
  let count = 0;

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await expect(page.locator('#appShell')).toBeVisible({ timeout: 7000 });
    await expect(page.locator('#ladderExperience')).toBeVisible();
    await assertPageCanScroll(page, `${viewport.name} initial`);
    await assertHealthyFrame(page, `${viewport.name} initial`);

    for (const [boardKey, boardLabel] of BOARDS) {
      const tab = page.locator(`[data-ladder-board="${boardKey}"]`);
      await tab.click();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('#ladderBoardTitle')).toHaveText(boardLabel);

      const maxScroll = await page.evaluate(() => Math.max(0, document.documentElement.scrollHeight - innerHeight));
      for (let index = 0; index < POSITIONS.length; index += 1) {
        const ratio = POSITIONS[index];
        await page.evaluate(y => window.scrollTo(0, y), Math.round(maxScroll * ratio));
        await page.waitForTimeout(20);
        await assertHealthyFrame(page, `${viewport.name}/${boardKey}/${index}`);
        await shot(page, `qa-artifacts/hostile-matrix/${viewport.name}/boards/${boardKey.replace('|', '-')}-${index + 1}.jpg`);
        count += 1;
      }
    }

    // Ten cross-state screenshots per viewport = 100 additional distinct frames.
    await showLogin(page);
    await expect(page.locator('#authGate')).toBeVisible();
    await assertHealthyFrame(page, `${viewport.name}/login`);
    await shot(page, `qa-artifacts/hostile-matrix/${viewport.name}/states/01-login.jpg`); count += 1;

    await showApp(page);
    await page.locator('#accountMenu').click();
    await expect(page.locator('#trAccountSettingsShell')).toBeVisible();
    await assertHealthyFrame(page, `${viewport.name}/account`);
    await shot(page, `qa-artifacts/hostile-matrix/${viewport.name}/states/02-account.jpg`); count += 1;
    await page.locator('[data-account-close]').last().click();
    await expect(page.locator('#trAccountSettingsShell')).toBeHidden();

    await page.locator('#ladderExperience').scrollIntoViewIfNeeded();
    await assertHealthyFrame(page, `${viewport.name}/rankings`);
    await shot(page, `qa-artifacts/hostile-matrix/${viewport.name}/states/03-rankings.jpg`); count += 1;

    await page.locator('#settingsPanel').scrollIntoViewIfNeeded();
    await page.locator('#tabSheet').click();
    await assertHealthyFrame(page, `${viewport.name}/import-sheet`);
    await shot(page, `qa-artifacts/hostile-matrix/${viewport.name}/states/04-import-sheet.jpg`); count += 1;

    await page.locator('#tabCsv').click();
    await assertHealthyFrame(page, `${viewport.name}/import-csv`);
    await shot(page, `qa-artifacts/hostile-matrix/${viewport.name}/states/05-import-csv.jpg`); count += 1;

    await openPreview(page);
    await assertHealthyFrame(page, `${viewport.name}/preview`);
    await shot(page, `qa-artifacts/hostile-matrix/${viewport.name}/states/06-import-preview.jpg`); count += 1;
    await page.locator('[data-preview-cancel]').first().click();
    await expect(page.locator('#importPreviewModal')).toBeHidden();
    await assertPageCanScroll(page, `${viewport.name} after preview close`);
    await assertHealthyFrame(page, `${viewport.name}/preview-closed`);
    await shot(page, `qa-artifacts/hostile-matrix/${viewport.name}/states/07-scroll-recovered.jpg`); count += 1;

    await page.locator('#accountsPanel').scrollIntoViewIfNeeded();
    await assertHealthyFrame(page, `${viewport.name}/accounts`);
    await shot(page, `qa-artifacts/hostile-matrix/${viewport.name}/states/08-player-accounts.jpg`); count += 1;

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(30);
    await assertHealthyFrame(page, `${viewport.name}/bottom`);
    await shot(page, `qa-artifacts/hostile-matrix/${viewport.name}/states/09-bottom.jpg`); count += 1;

    await page.evaluate(() => {
      const old = document.querySelector('#hostileChallengeDialog');
      old?.remove();
      const dialog = document.createElement('dialog');
      dialog.id = 'hostileChallengeDialog';
      dialog.className = 'challenge-dialog';
      dialog.innerHTML = '<div class="challenge-dialog-inner"><h3>Challenge player</h3><p>Confirm the matchup before sending.</p><button class="challenge-action primary">Send challenge</button><button>Cancel</button></div>';
      document.body.appendChild(dialog);
      dialog.showModal();
    });
    await expect(page.locator('#hostileChallengeDialog')).toBeVisible();
    await assertHealthyFrame(page, `${viewport.name}/challenge-dialog`);
    await shot(page, `qa-artifacts/hostile-matrix/${viewport.name}/states/10-challenge-dialog.jpg`); count += 1;
    await page.evaluate(() => document.querySelector('#hostileChallengeDialog')?.remove());
  }

  expect(count).toBe(500);
  expect(pageErrors, `page errors during hostile matrix:\n${pageErrors.join('\n---\n')}`).toEqual([]);
});
