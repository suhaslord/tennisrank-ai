const { test, expect } = require('@playwright/test');

const APP_URL = 'http://127.0.0.1:4173/qa-coach-index.html';

const admin = {
  id: 'admin-profile', email: 'coach@example.test', full_name: 'Coach QA', player_name: null, role: 'admin', must_change_password: false,
};

const currentRows = [
  { Name: 'Aiden Brooks', Gender: 'Boys', Division: 'Singles' },
  { Name: 'Ethan Cole', Gender: 'Boys', Division: 'Singles' },
  { Gender: 'Boys', Division: 'Singles', 'Player 1': 'Aiden Brooks', 'Player 2': 'Ethan Cole', Winner: 'Aiden Brooks', Loser: 'Ethan Cole', Score: '6-3', Date: '2026-08-10' },
];

function dashboard() {
  return {
    needsAttention: { pendingChallenges: 1, pendingScores: 1, importWarnings: 1, playersWithoutAccounts: 2 },
    teamStatus: {
      activePlayers: 3,
      totalPlayers: 3,
      latestImport: { id: 'snap-current', sourceLabel: 'Coach Sheet', rowCount: 3, createdAt: '2026-08-16T20:00:00Z' },
      recentMatches: [],
      nextChallenges: [{ id: 'c1', scheduledFor: '2026-08-18T22:00:00Z', courtLocation: 'Court 1', challenger: 'Ethan Cole', defender: 'Aiden Brooks', teamGender: 'boys' }],
    },
    importWarnings: ['One column needs review.'],
    missingAccounts: [
      { id: 'p2', name: 'Ethan Cole', teamGender: 'boys', division: 'jv', gradeLevel: 9 },
      { id: 'p3', name: 'Mateo Rivera', teamGender: 'boys', division: 'varsity', gradeLevel: 10 },
    ],
    audit: [{ id: 1, action: 'publish_import', actor: 'Coach QA', createdAt: '2026-08-16T20:00:00Z', rankChanges: [] }],
    undoCandidates: [{ id: '11111111-1111-4111-8111-111111111111', teamGender: 'boys', reason: 'manual_move', createdAt: '2026-08-16T20:05:00Z' }],
  };
}

test('coach preview, history, account roster, dashboard and undo work together', async ({ page }) => {
  let previewCalls = 0;
  let publishCalls = 0;
  let restoreCalls = 0;
  let undoCalls = 0;
  let seedCalls = 0;

  await page.addInitScript(({ admin }) => {
    localStorage.setItem('tennisRankAuthSessionV1', JSON.stringify({
      access_token: 'qa-admin-access', refresh_token: 'qa-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: admin.id, email: admin.email },
    }));
  }, { admin });

  await page.route('**/api/**', async route => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const reply = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (path === '/api/config') return reply({ supabaseUrl: 'https://example.supabase.co', publishableKey: 'test-key' });
    if (path === '/api/session') return reply({ profile: admin });
    if (path === '/api/ai-analyze-sheet' && req.method() === 'POST') return reply({
      model: 'gemini-3.6-flash-qa',
      privacy: { redactedBeforeProvider: true },
      ai: {
        supported: true,
        sheetKind: 'roster',
        confidence: 0.99,
        globalGender: 'unknown',
        globalDivision: 'singles',
        mappings: [
          { inputKey: 'Name', target: 'name', confidence: 0.99, reason: 'canonical roster identity' },
          { inputKey: 'Gender', target: 'gender', confidence: 0.99, reason: 'canonical team gender' },
          { inputKey: 'Division', target: 'division', confidence: 0.99, reason: 'canonical tennis event' },
        ],
        warnings: [],
      },
    });
    if (path === '/api/records' && req.method() === 'GET' && url.searchParams.get('mode') === 'history') return reply({ snapshots: [
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', source_label: 'Current Coach Sheet', row_count: 3, created_at: '2026-08-16T20:00:00Z' },
      { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', source_label: 'Previous Coach Sheet', row_count: 2, created_at: '2026-08-15T20:00:00Z' },
    ] });
    if (path === '/api/records' && req.method() === 'GET') return reply({ rows: currentRows, count: currentRows.length });
    if (path === '/api/records' && req.method() === 'POST') {
      const body = req.postDataJSON();
      if (body.action === 'preview') { previewCalls += 1; return reply({ previewHash: 'preview-token', contentHash: 'hash', sourceKey: 'source', sourceLabel: body.source, rowCount: body.rows.length, unchanged: false }); }
      if (body.action === 'publish') { publishCalls += 1; return reply({ saved: body.rows.length, snapshotId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }); }
      if (body.action === 'restore') { restoreCalls += 1; return reply({ restored: true, rows: currentRows, count: currentRows.length, snapshotId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }); }
    }
    if (path === '/api/ladder' && url.searchParams.get('mode') === 'coach' && req.method() === 'GET') return reply(dashboard());
    if (path === '/api/ladder' && url.searchParams.get('mode') === 'coach' && req.method() === 'POST') { undoCalls += 1; return reply({ ok: true, dashboard: dashboard() }); }
    if (path === '/api/ladder') return reply({
      ladder: [
        { player_id: 'p1', team_gender: 'boys', rank_position: 1, previous_rank_position: 1, status: 'available', player: { id: 'p1', profile_id: null, display_name: 'Aiden Brooks', team_gender: 'boys', grade_level: 12, division: 'varsity', active_status: 'active' } },
        { player_id: 'p2', team_gender: 'boys', rank_position: 2, previous_rank_position: 2, status: 'available', player: { id: 'p2', profile_id: null, display_name: 'Ethan Cole', team_gender: 'boys', grade_level: 9, division: 'jv', active_status: 'active' } },
      ],
      settings: [{ team_gender: 'boys', max_challenge_distance: 3 }], viewer: { profileId: admin.id, role: 'admin' },
    });
    if (path === '/api/challenges') return reply({ challenges: [] });
    if (path === '/api/users' && req.method() === 'GET') return reply({ profiles: [admin], roster: [
      { id: 'p1', profile_id: 'player-account', display_name: 'Aiden Brooks', team_gender: 'boys', grade_level: 12, division: 'varsity', active_status: 'active', accountCreated: true, account: { email: 'aiden@example.test' } },
      { id: 'p2', profile_id: null, display_name: 'Ethan Cole', team_gender: 'boys', grade_level: 9, division: 'jv', active_status: 'active', accountCreated: false, account: null },
      { id: 'p3', profile_id: null, display_name: 'Mateo Rivera', team_gender: 'boys', grade_level: 10, division: 'varsity', active_status: 'active', accountCreated: false, account: null },
    ] });
    if (path === '/api/users' && req.method() === 'POST') return reply({ profile: { id: 'new-user' }, linkedPlayerId: req.postDataJSON().playerId }, 201);
    if (path === '/api/admin/seed-ladder') { seedCalls += 1; return reply({ seeded: 2 }); }
    return reply({ error: `Unhandled QA route ${req.method()} ${path}` }, 404);
  });

  page.on('dialog', dialog => dialog.accept());
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#appShell')).toBeVisible();
  await expect(page.locator('#coachOpsDashboard')).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(window.syncToBackend?.__coachOpsPreviewFinal))).toBe(true);
  await expect(page.locator('#coachAttentionGrid')).toContainText('Players without accounts');
  await expect(page.locator('#rosterAccountMatrix')).toContainText('1/3 accounts created');
  await expect(page.locator('#rosterAccountMatrix')).toContainText('Not created');
  await expect(page.locator('#importHistoryList')).toContainText('Previous Coach Sheet');

  await page.locator('#tabCsv').click();
  await page.locator('#csvText').fill('Name,Gender,Division\nAiden Brooks,Boys,Singles\nEthan Cole,Boys,Singles\nMateo Rivera,Boys,Singles');
  await page.locator('#useCsv').click();
  await page.waitForTimeout(350);
  const diagnostics = await page.evaluate(() => ({
    status: document.querySelector('#statusMessage')?.textContent || '',
    modal: Boolean(document.querySelector('#importPreviewModal')),
    coachOps: Boolean(window.TennisRankCoachOps),
    calculate: typeof window.calculateRankings,
    currentRows: (() => { try { return JSON.parse(localStorage.getItem('tennisRankDataSnapshotV1') || 'null')?.rows?.length || 0; } catch { return -1; } })(),
    finalGuard: Boolean(window.syncToBackend?.__coachOpsPreviewFinal),
  }));
  console.log('COACH_PREVIEW_DIAGNOSTICS', JSON.stringify({ previewCalls, ...diagnostics }));
  await expect(page.locator('#importPreviewModal')).toBeVisible();
  await expect(page.locator('#importPreviewBody')).toContainText('Mateo Rivera');
  await page.locator('#importPreviewModal [data-preview-cancel]').last().click();
  await expect(page.locator('#importPreviewModal')).toBeHidden();
  expect(publishCalls).toBe(0);

  await page.locator('#csvText').fill('Name,Gender,Division\nAiden Brooks,Boys,Singles\nEthan Cole,Boys,Singles\nMateo Rivera,Boys,Singles');
  await page.locator('#useCsv').click();
  await expect(page.locator('#importPreviewModal')).toBeVisible();
  await page.locator('#importPreviewModal [data-preview-confirm]').click();
  await expect.poll(() => publishCalls).toBe(1);
  expect(seedCalls).toBeGreaterThan(0);

  await page.locator('[data-restore-import="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]').click();
  await expect.poll(() => restoreCalls).toBe(1);

  await page.locator('#generateInvitePassword').click();
  await expect(page.locator('#invitePassword')).not.toHaveValue('');
  await page.locator('[data-create-account="p2"]').first().click();
  await expect(page.locator('#inviteRosterPlayer')).toHaveValue('p2');
  await expect(page.locator('#inviteFullName')).toHaveValue('Ethan Cole');

  await page.locator('[data-undo-snapshot]').click();
  await expect.poll(() => undoCalls).toBe(1);
});
