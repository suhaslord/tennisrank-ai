const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'human-theme.css'), 'utf8');
const brand = fs.readFileSync(path.join(__dirname, '..', 'brand-assets.js'), 'utf8');

assert.match(css, /\.auth-visual\s*\{[\s\S]*display:\s*none\s*!important/i, 'login side visual must stay removed');
assert.match(css, /\.auth-gate\s*\{[\s\S]*grid-template-columns:\s*1fr\s*!important/i, 'login must remain single-column');
assert.match(css, /\.accounts-panel\s*\{[\s\S]*background:\s*var\(--human-surface\)/i, 'accounts panel should stay on the light theme');
assert.match(css, /body\.role-admin[\s\S]*var\(--human-bg\)/i, 'admin surface should use the warm neutral theme');
assert.match(brand, /human-theme\.css/);
assert.match(brand, /human-copy\.js/);

console.log('Human theme regression passed: no side photo, warm login, and light account settings remain enforced.');
