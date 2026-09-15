const assert = require('node:assert/strict');
const render = require('../api/render.js');

const source = `<!doctype html><html><head>
<link rel="stylesheet" href="./style.css" />
<link rel="stylesheet" href="./ladder.css" />
<link rel="stylesheet" href="./challenge-ui.css" />
<link rel="stylesheet" href="./challenge-ui-fixes.css" />
</head><body>
<img src="/assets/team-court.jpg" />
<script src="./auth.js"></script>
<script src="./lib/ladder-engine.js"></script>
<script src="./app.js"></script>
<script src="./ladder.js"></script>
<script src="./challenge-ui.js"></script>
<script src="./challenge-ui-state.js"></script>
<div class="cursor-ball" aria-hidden="true"><span class="cursor-ball-core"></span></div>
</body></html>`;

const out = render.rewrite(source);
const cdn = render.CDN;

for (const value of [
  `href="${cdn}/style.css"`,
  `href="${cdn}/ladder.css"`,
  `href="${cdn}/challenge-ui.css"`,
  `href="${cdn}/challenge-ui-fixes.css"`,
  `src="${cdn}/auth.js"`,
  `src="${cdn}/app.js"`,
  `src="${cdn}/assets/team-court.jpg"`,
  `href="${cdn}/account-settings.css"`,
  `href="${cdn}/ui-cohesion.css"`,
  `href="${cdn}/coach-console-theme.css"`,
  `src="${cdn}/match-dedup-guard.js"`,
  `src="${cdn}/connected-sheet-guard.js"`,
  `src="${cdn}/account-settings.js"`,
  `src="${cdn}/ui-cohesion.js"`,
]) {
  assert.ok(out.includes(value), `missing quoted rewritten attribute: ${value}`);
}

const importSync = out.indexOf(`${cdn}/import-auto-sync.js`);
const ranking = out.indexOf(`${cdn}/ranking-policy.js`);
const dashboard = out.indexOf(`${cdn}/player-dashboard-state.js`);
const coachOps = out.indexOf(`${cdn}/coach-ops.js`);
const previewGuard = out.indexOf(`${cdn}/coach-preview-guard.js`);
const matchDedup = out.indexOf(`${cdn}/match-dedup-guard.js`);
const sheetGuard = out.indexOf(`${cdn}/connected-sheet-guard.js`);
const accountSettings = out.indexOf(`${cdn}/account-settings.js`);
const uiCohesion = out.indexOf(`${cdn}/ui-cohesion.js`);
const brandAssets = out.indexOf(`${cdn}/brand-assets.js`);
assert.ok(importSync > 0 && ranking > importSync && dashboard > ranking && coachOps > dashboard && previewGuard > coachOps, 'runtime order must be importer sync -> ranking policy -> player dashboard -> coach ops -> final preview guard');
assert.ok(matchDedup > previewGuard && sheetGuard > matchDedup && accountSettings > sheetGuard && uiCohesion > accountSettings && brandAssets > uiCohesion, 'late integrity/safety/UI patches must load before final brand assets');
assert.ok(out.includes(`${cdn}/player-dashboard-state.css`));
assert.ok(out.includes(`${cdn}/coach-ops.css`));
assert.ok(out.includes(`${cdn}/account-settings.css`));
assert.ok(out.includes(`${cdn}/ui-cohesion.css`));
assert.ok(out.includes(`${cdn}/coach-console-theme.css`));
assert.equal(out.includes('class="cursor-ball"'), false);

console.log('render rewrite tests passed');

// Rendering must use deployed files even when an external CDN is unavailable.
const fs = require('node:fs');
const html = render.rewrite(fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8'));
for (const match of html.matchAll(/(?:src|href)="(\/[^"?#]+)"/g)) {
  assert.ok(fs.existsSync(require('node:path').join(__dirname, '..', match[1])), `missing deployed asset ${match[1]}`);
}
const nativeFetch = global.fetch;
global.fetch = () => { throw new Error('Renderer must not need the network'); };
const response = {
  status(code) { this.code = code; return this; },
  setHeader() { return this; },
  send(body) { this.body = body; return this; },
  end() { return this; },
};
render({method:'GET'}, response).then(() => {
  assert.equal(response.code, 200);
  assert.ok(response.body.includes('/coach-ops.js'));
  assert.ok(response.body.includes('/match-dedup-guard.js'));
  assert.ok(response.body.includes('/connected-sheet-guard.js'));
  assert.ok(response.body.includes('/account-settings.js'));
  assert.ok(response.body.includes('/account-settings.css'));
  assert.ok(response.body.includes('/ui-cohesion.js'));
  assert.ok(response.body.includes('/ui-cohesion.css'));
  assert.ok(response.body.includes('/coach-console-theme.css'));
}).finally(() => { global.fetch = nativeFetch; });
