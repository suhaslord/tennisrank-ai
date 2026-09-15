const fs = require('node:fs/promises');
const path = require('node:path');
// Serve the same source and assets that were verified for this deployment.
const CDN = '';
const SHEETJS = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
const BLOCKED_TEAM_PHOTOS = [
  '/assets/team-court.jpg',
  '/assets/matchday-awards.jpg',
  '/assets/singles-spotlight.jpg',
];
const PHOTO_PLACEHOLDER_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 900" role="img" aria-label="Abstract tennis court graphic">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#07161d"/>
      <stop offset="0.55" stop-color="#12352f"/>
      <stop offset="1" stop-color="#d96b32"/>
    </linearGradient>
    <radialGradient id="glow" cx="72%" cy="22%" r="58%">
      <stop offset="0" stop-color="#ffffff" stop-opacity=".22"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="900" fill="url(#bg)"/>
  <rect width="1200" height="900" fill="url(#glow)"/>
  <g fill="none" stroke="#ffffff" stroke-opacity=".42" stroke-width="7">
    <path d="M260 118 940 118 1090 782 110 782Z"/>
    <path d="M600 118v664"/>
    <path d="M185 448h830"/>
    <path d="M365 118 310 782M835 118 890 782"/>
    <path d="M462 448 430 782M738 448 770 782"/>
  </g>
  <circle cx="945" cy="230" r="48" fill="#f5ef58" fill-opacity=".9"/>
  <circle cx="930" cy="214" r="5" fill="#ffffff" fill-opacity=".7"/>
</svg>`;

function stripBlockedTeamPhotos(html) {
  return String(html || '')
    .replace('<link rel="preload" as="image" href="/assets/team-court.jpg" fetchpriority="high" />', '')
    .replace('<img src="/assets/team-court.jpg" alt="" fetchpriority="high" decoding="async" />', '')
    .replace('<img class="hero-photo" src="/assets/team-court.jpg" alt="Tennis players and coaches gathered on the court" fetchpriority="high" decoding="async" />', '')
    .replace(/\s*<figure class="season-photo season-photo-awards">[\s\S]*?<\/figure>/, '')
    .replace(/\s*<figure class="season-photo season-photo-singles">[\s\S]*?<\/figure>/, '');
}

function ensureHumanPresentation(html) {
  let out = String(html || '');
  if (!out.includes('human-theme.css')) {
    out = out.replace('</head>', '<link rel="stylesheet" href="/human-theme.css" data-tennisrank-human-theme="true"></head>');
  }
  if (!out.includes('account-settings.css')) {
    out = out.replace('</head>', '<link rel="stylesheet" href="/account-settings.css" data-tennisrank-account-settings-style="true"></head>');
  }
  if (!out.includes('human-copy.js')) {
    const before = '<script src="/brand-assets.js"></script>';
    if (out.includes(before)) out = out.replace(before, '<script src="/human-copy.js" data-tennisrank-human-copy="true"></script>' + before);
    else out = out.replace('</body>', '<script src="/human-copy.js" data-tennisrank-human-copy="true"></script></body>');
  }
  return out;
}

function ensureRuntimePatch(html) {
  let out = String(html || '');
  if (!out.includes('match-result-compat.js')) {
    const before = '<script src="/tesla-motion.js"></script>';
    if (out.includes(before)) out = out.replace(before, '<script src="/match-result-compat.js"></script>' + before);
    else out = out.replace('</body>', '<script src="/match-result-compat.js"></script></body>');
  }
  if (!out.includes('connected-sheet-guard.js')) {
    const before = '<script src="/brand-assets.js"></script>';
    if (out.includes(before)) out = out.replace(before, '<script src="/connected-sheet-guard.js" data-tennisrank-connected-sheet-guard="true"></script>' + before);
    else out = out.replace('</body>', '<script src="/connected-sheet-guard.js" data-tennisrank-connected-sheet-guard="true"></script></body>');
  }
  if (!out.includes('account-settings.js')) {
    const before = '<script src="/brand-assets.js"></script>';
    if (out.includes(before)) out = out.replace(before, '<script src="/account-settings.js" data-tennisrank-account-settings="true"></script>' + before);
    else out = out.replace('</body>', '<script src="/account-settings.js" data-tennisrank-account-settings="true"></script></body>');
  }
  return ensureHumanPresentation(out);
}

function rewrite(html) {
  let out = stripBlockedTeamPhotos(html);
  // index.html already contains the historical runtime bundle. Do not skip new
  // hotfix scripts just because that marker is present.
  if (out.includes('name="tennisrank-runtime"')) return ensureRuntimePatch(out);
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
    `<meta name="tennisrank-runtime" content="coach-ready"><script defer src="${SHEETJS}"></script><link rel="stylesheet" href="${CDN}/production-stability.css"><link rel="stylesheet" href="${CDN}/tesla-authority.css"><link rel="stylesheet" href="${CDN}/tesla-finish.css"><link rel="stylesheet" href="${CDN}/tesla-motion.css"><link rel="stylesheet" href="${CDN}/story-photo-scale.css"><link rel="stylesheet" href="${CDN}/player-dashboard-state.css"><link rel="stylesheet" href="${CDN}/coach-ops.css"><link rel="stylesheet" href="${CDN}/coach-polish.css"><link rel="stylesheet" href="${CDN}/insights.css"><style>#showBootstrap,.bootstrap-form{display:none!important}</style></head>`,
  );

  out = out.replace(
    `<script src="${CDN}/app.js"></script>`,
    `<script src="${CDN}/app.js"></script><script src="${CDN}/import-runtime-fixes.js"></script><script src="${CDN}/import-v2.js"></script><script src="${CDN}/import-delimiter-fix.js"></script><script src="${CDN}/spreadsheet-ml.js"></script><script src="${CDN}/import-v2-fixes.js"></script><script src="${CDN}/import-row-safety-fix.js"></script><script src="${CDN}/import-multiblock-fix.js"></script><script src="${CDN}/spreadsheet-semantic-calibration.js"></script><script src="${CDN}/spreadsheet-ai.js"></script><script src="${CDN}/ai-quota-guard.js"></script><script src="${CDN}/import-auto-sync.js"></script><script src="${CDN}/ranking-policy.js"></script><script src="${CDN}/player-dashboard-state.js"></script><script src="${CDN}/player-insights.js"></script><script src="${CDN}/coach-ops.js"></script><script src="${CDN}/coach-sharing.js"></script><script src="${CDN}/coach-preview-guard.js"></script><script src="${CDN}/coach-polish.js"></script><script src="${CDN}/match-result-compat.js"></script><script src="${CDN}/tesla-motion.js"></script><script src="${CDN}/connected-sheet-guard.js"></script><script src="${CDN}/account-settings.js"></script><script src="${CDN}/brand-assets.js"></script>`,
  );

  out = ensureRuntimePatch(out);
  out = out.replace('<div class="cursor-ball" aria-hidden="true"><span class="cursor-ball-core"></span></div>', '');
  return out;
}

function wantsPhotoPlaceholder(req) {
  const value = req?.query?.asset;
  if (Array.isArray(value)) return value.includes('photo-placeholder');
  if (value === 'photo-placeholder') return true;
  try {
    return new URL(req?.url || '/', 'https://tennisrank.local').searchParams.get('asset') === 'photo-placeholder';
  } catch {
    return false;
  }
}

function servePhotoPlaceholder(req, res) {
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'HEAD') return res.status(200).end();
  return res.status(200).send(PHOTO_PLACEHOLDER_SVG);
}

async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).setHeader('Allow', 'GET, HEAD').end();
    return;
  }
  if (wantsPhotoPlaceholder(req)) return servePhotoPlaceholder(req, res);
  try {
    const html = rewrite(await fs.readFile(path.join(process.cwd(), 'index.html'), 'utf8'));
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
module.exports.ensureRuntimePatch = ensureRuntimePatch;
module.exports.ensureHumanPresentation = ensureHumanPresentation;
module.exports.CDN = CDN;
module.exports.BLOCKED_TEAM_PHOTOS = BLOCKED_TEAM_PHOTOS;
module.exports.PHOTO_PLACEHOLDER_SVG = PHOTO_PLACEHOLDER_SVG;
module.exports.stripBlockedTeamPhotos = stripBlockedTeamPhotos;
module.exports.wantsPhotoPlaceholder = wantsPhotoPlaceholder;
module.exports.servePhotoPlaceholder = servePhotoPlaceholder;