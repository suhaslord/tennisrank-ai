const COMMIT = '84db39f1a40d07531aee4b6471c59af3d77b41fa';
const CDN = `https://cdn.jsdelivr.net/gh/suhaslord/tennisrank-ai@${COMMIT}`;
const SHEETJS = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';

function rewrite(html) {
  let out = String(html || '');
  out = out
    .replaceAll('src="/assets/', `src="${CDN}/assets/`)
    .replaceAll('href="/assets/', `href="${CDN}/assets/`)
    .replaceAll('href="./style.css"', `href="${CDN}/style.css"`)
    .replaceAll('href="./ladder.css"', `href="${CDN}/ladder.css"`)
    .replaceAll('href="./challenge-ui.css"', `href="${CDN}/challenge-ui.css"`)
    .replaceAll('href="./challenge-ui-fixes.css"', `href="${CDN}/challenge-ui-fixes.css"`)
    .replaceAll('src="./auth.js"', `src="${CDN}/auth.js"`)
    .replaceAll('src="./lib/ladder-engine.js"', `src="${CDN}/lib/ladder-engine.js"`)
    .replaceAll('src="./app.js"', `src="${CDN}/app.js"`)
    .replaceAll('src="./ladder.js"', `src="${CDN}/ladder.js"`)
    .replaceAll('src="./challenge-ui.js"', `src="${CDN}/challenge-ui.js"`)
    .replaceAll('src="./challenge-ui-state.js"', `src="${CDN}/challenge-ui-state.js"`);

  out = out.replace(
    '</head>',
    `<script defer src="${SHEETJS}"></script><link rel="stylesheet" href="${CDN}/production-stability.css"><link rel="stylesheet" href="${CDN}/tesla-authority.css"><link rel="stylesheet" href="${CDN}/tesla-finish.css"><link rel="stylesheet" href="${CDN}/tesla-motion.css"><link rel="stylesheet" href="${CDN}/story-photo-scale.css"><link rel="stylesheet" href="${CDN}/player-dashboard-state.css"><link rel="stylesheet" href="${CDN}/coach-ops.css"><style>#showBootstrap,.bootstrap-form{display:none!important}</style></head>`,
  );

  out = out.replace(
    `<script src="${CDN}/app.js"></script>`,
    `<script src="${CDN}/app.js"></script><script src="${CDN}/import-runtime-fixes.js"></script><script src="${CDN}/import-v2.js"></script><script src="${CDN}/import-delimiter-fix.js"></script><script src="${CDN}/spreadsheet-ml.js"></script><script src="${CDN}/import-v2-fixes.js"></script><script src="${CDN}/import-row-safety-fix.js"></script><script src="${CDN}/import-multiblock-fix.js"></script><script src="${CDN}/spreadsheet-semantic-calibration.js"></script><script src="${CDN}/spreadsheet-ai.js"></script><script src="${CDN}/ai-quota-guard.js"></script><script src="${CDN}/import-auto-sync.js"></script><script src="${CDN}/ranking-policy.js"></script><script src="${CDN}/player-dashboard-state.js"></script><script src="${CDN}/coach-ops.js"></script><script src="${CDN}/coach-preview-guard.js"></script><script src="${CDN}/tesla-motion.js"></script><script src="${CDN}/brand-assets.js"></script>`,
  );

  out = out.replace('<div class="cursor-ball" aria-hidden="true"><span class="cursor-ball-core"></span></div>', '');
  return out;
}

async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).setHeader('Allow', 'GET, HEAD').end();
    return;
  }
  try {
    const response = await fetch(`${CDN}/index.html`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Frontend source returned ${response.status}`);
    const html = rewrite(await response.text());
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'HEAD') return res.status(200).end();
    return res.status(200).send(html);
  } catch (error) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).send('<!doctype html><meta charset="utf-8"><title>TennisRank</title><p style="font-family:system-ui;padding:24px">TennisRank is temporarily unavailable. Please refresh.</p>');
  }
}

module.exports = handler;
module.exports.rewrite = rewrite;
module.exports.CDN = CDN;
module.exports.COMMIT = COMMIT;
