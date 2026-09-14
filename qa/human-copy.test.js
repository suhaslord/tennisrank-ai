const assert = require('node:assert/strict');
const copy = require('../human-copy');

assert.equal(copy.humanizeText('Authentication failed.'), 'We couldn’t sign you in.');
assert.equal(copy.humanizeText('Import cancelled. The live board was not changed.'), 'Import canceled. Nothing changed.');
assert.equal(
  copy.humanizeText('Live team data changed since this preview. Preview the latest board again before publishing.'),
  'The team data changed while you were reviewing this. Preview it again before publishing.',
);
assert.equal(
  copy.humanizeText('Database connected · 24 rows published with rollback history'),
  'Saved · 24 rows live · Undo available',
);

const staticText = copy.COPY.map(([, value]) => value).join('\n');
assert.match(staticText, /Sign in to see your team\./);
assert.match(staticText, /Coach tools/);
assert.match(staticText, /Player accounts/);
assert.doesNotMatch(staticText, /private team workspace/i);
assert.doesNotMatch(staticText, /sheet analyzer/i);
assert.doesNotMatch(staticText, /import safety check/i);

console.log('Human copy regression passed: key auth, coach, import, and account text stays concise and natural.');
