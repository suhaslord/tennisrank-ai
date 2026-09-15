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
  `src="${cdn}/import-certainty-gate.js"`,
  `src="${cdn}/spreadsheet-universal.js"`,
  `src="${cdn}/repeated-header-runtime-guard.js"`,
  `src="${cdn}/google-workbook-bridge.js"`,
  `src="${cdn}/coach-essential.js"`,
]) {
  assert.ok(out.includes(value), `missing quoted rewritten attribute: ${value}`);
}

const importSync = out.indexOf(`${cdn}/import-auto-sync.js`);
const ranking = out.indexOf(`${cdn}/ranking-policy.js`);
const dashboard = out.indexOf(`${cdn}/player-dashboard-state.js`);
const coachOps = out.indexOf(`${cdn}/coach-ops.js`);
const previewGuard = out.indexOf(`${cdn}/coach-preview-guard.js`);
const certainty = out.indexOf(`${cdn}/import-certainty-gate.js`);
const universal = out.indexOf(`${cdn}/spreadsheet-universal.js`);
const repeated = out.indexOf(`${cdn}/repeated-header-runtime-guard.js`);
const workbookBridge = out.indexOf(`${cdn}/google-workbook-bridge.js`);
const coachEssential = out.indexOf(`${cdn}/coach-essential.js`);
const matchDedup = out.indexOf(`${cdn}/match-dedup-guard.js`);
const sheetGuard = out.indexOf(`${cdn}/connected-sheet-guard.js`);
const accountSettings = out.indexOf(`${cdn}/account-settings.js`);
const uiCohesion = out.indexOf(`${cdn}/ui-cohesion.js`);
const brandAssets = out.indexOf(`${cdn}/brand-assets.js`);
assert.ok(importSync > 0 && ranking > importSync && dashboard > ranking && coachOps > dashboard && previewGuard > coachOps, 'runtime order must be importer sync -> ranking policy -> player dashboard -> coach ops -> final preview guard');
assert.ok(certainty > previewGuard && universal > certainty && repeated > universal && workbookBridge > repeated && coachEssential > workbookBridge, 'core importer runtime must be parser-inserted in deterministic dependency order');
assert.ok(matchDedup > previewGuard && sheetGuard > matchDedup && accountSettings > sheetGuard && uiCohesion > accountSettings && brandAssets > uiCohesion, 'late integrity/safety/UI patches must load before final brand assets');
for (const [src] of render.CORE_RUNTIME_SCRIPTS) {
  const count = out.split(`src="${src}"`).length - 1;
  assert.equal(count, 1, `${src} should be present exactly once`);
  assert.ok(out.indexOf(`src="${src}"`) < brandAssets, `${src} must load before brand-assets.js so branding never creates a dynamic startup queue`);
}
assert.ok(out.includes(`${cdn}/player-dashboard-state.css`));
assert.ok(out.includes(`${cdn}/coach-ops.css`));
assert.ok(out.includes(`${cdn}/account-settings.css`));
assert.ok(out.includes(`${cdn}/ui-cohesion.css`));
assert.ok(out.includes(`${cdn}/coach-console-theme.css`));
assert.ok(out.includes('<script async src="https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js" data-tennisrank-sheetjs="async"></script>'), 'SheetJS must load without blocking DOMContentLoaded');
assert.equal(out.includes('<script defer src="https://cdn.sheetjs.com/'), false, 'external SheetJS must never be a deferred startup dependency');
assert.equal(out.includes('class="cursor-ball"'), false);

console.log('render rewrite tests passed');

// Rendering must use deployed files even when an external CDN is unavailable.
const fs = require('node:fs');
const html = render.rewrite(fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8'));
for (const match of html.matchAll(/(?:src|href)="(\/[^"?#]+)"/g)) {
  assert.ok(fs.existsSync(require('node:path').join(__dirname, '..', match[1])), `missing deployed asset ${match[1]}`);
}
for (const [src] of render.CORE_RUNTIME_SCRIPTS) {
  assert.equal(html.split(`src="${src}"`).length - 1, 1, `real rendered index should include ${src} exactly once`);
  assert.ok(html.indexOf(`src="${src}"`) < html.indexOf('src="/brand-assets.js"'), `${src} must be ahead of branding in the real rendered index`);
}
assert.ok(html.includes('data-tennisrank-sheetjs="async"'), 'the real rendered index must use non-blocking SheetJS');
assert.equal(html.includes('<script defer src="https://cdn.sheetjs.com/'), false, 'the real rendered index must not wait for SheetJS before DOMContentLoaded');
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
  assert.ok(response.body.includes('data-tennisrank-sheetjs="async"'));
  for (const [src] of render.CORE_RUNTIME_SCRIPTS) assert.ok(response.body.includes(`src="${src}"`));
}).finally(() => { global.fetch = nativeFetch; });
