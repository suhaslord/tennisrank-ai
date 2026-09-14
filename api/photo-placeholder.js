const { allowApi } = require('./_supabase');

const SVG = `<?xml version="1.0" encoding="UTF-8"?>
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

module.exports = function handler(req, res) {
  allowApi(res, 'GET,HEAD,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).end();
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'HEAD') return res.status(200).end();
  return res.status(200).send(SVG);
};

module.exports.SVG = SVG;
