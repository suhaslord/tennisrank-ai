const COMMIT = 'b4f88940e8a4d2b9df233d39ed07c516483f5321';
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
    `<script defer src="${SHEETJS}"></script><link rel="stylesheet" href="${CDN}/production-stability.css"><link rel="stylesheet" href="${CDN}/tesla-authority.css"><link rel="stylesheet" href="${CDN}/tesla-finish.css"><link rel="stylesheet" href="${CDN}/tesla-motion.css"><style>#showBootstrap,.bootstrap-form{display:none!important}</style></head>`,
  );

  // Runtime interception initializes first. Deterministic parsing remains the
  // fail-safe; the trained schema model rescues unfamiliar layouts; global
  // semantic calibration then rejects unsupported/non-tennis interpretations
  // before any data is allowed to publish.
  out = out.replace(
    `<script src="${CDN}/app.js"></script>`,
    `<script src="${CDN}/app.js"></script><script src="${CDN}/import-runtime-fixes.js"></script><script src="${CDN}/import-v2.js"></script><script src="${CDN}/spreadsheet-ml.js"></script><script src="${CDN}/import-v2-fixes.js"></script><script src="${CDN}/spreadsheet-semantic-calibration.js"></script><script src="${CDN}/tesla-motion.js"></script>`,
  );

  out = out.replace('<div class="cursor-ball" aria-hidden="true"><span class="cursor-ball-core"></span></div>', '');
  return out;
}

module.exports = async function handler(req, res) {
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
};
