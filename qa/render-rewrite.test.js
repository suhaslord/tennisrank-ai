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
]) {
  assert.ok(out.includes(value), `missing quoted rewritten attribute: ${value}`);
}

const importSync = out.indexOf(`${cdn}/import-auto-sync.js`);
const ranking = out.indexOf(`${cdn}/ranking-policy.js`);
const dashboard = out.indexOf(`${cdn}/player-dashboard-state.js`);
const coachOps = out.indexOf(`${cdn}/coach-ops.js`);
const previewGuard = out.indexOf(`${cdn}/coach-preview-guard.js`);
assert.ok(importSync > 0 && ranking > importSync && dashboard > ranking && coachOps > dashboard && previewGuard > coachOps, 'runtime order must be importer sync -> ranking policy -> player dashboard -> coach ops -> final preview guard');
assert.ok(out.includes(`${cdn}/player-dashboard-state.css`));
assert.ok(out.includes(`${cdn}/coach-ops.css`));
assert.equal(out.includes('class="cursor-ball"'), false);

console.log('render rewrite tests passed');
