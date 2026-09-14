const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const records = require('../api/records');

const rows = [
  { Name: 'Alex Rivera', Gender: 'boys', Division: 'singles', Result: 'W' },
  { Name: 'Maya Patel', Gender: 'girls', Division: 'singles', Result: 'W' },
];
const source = 'Pasted CSV';
const snapshotId = '123e4567-e89b-42d3-a456-426614174000';

const emptyBoardToken = records.previewToken(rows, source, null);
let parsed = records.parsePreviewToken(emptyBoardToken, rows, source);
assert.equal(parsed.valid, true, 'preview token for an empty board should validate');
assert.equal(parsed.expectedLatestSnapshotId, null);

const snapshotToken = records.previewToken(rows, source, snapshotId);
parsed = records.parsePreviewToken(snapshotToken, rows, source);
assert.equal(parsed.valid, true, 'preview token should validate against the exact live snapshot');
assert.equal(parsed.expectedLatestSnapshotId, snapshotId);

assert.equal(
  records.parsePreviewToken(snapshotToken, [...rows, { Name: 'Late change', Gender: 'boys' }], source).valid,
  false,
  'changing rows after preview must invalidate the token',
);
assert.equal(
  records.parsePreviewToken(snapshotToken, rows, 'Different source').valid,
  false,
  'changing the source after preview must invalidate the token',
);
assert.equal(
  records.parsePreviewToken(records.previewHash(rows, source), rows, source).valid,
  false,
  'legacy unversioned preview hashes must fail closed and require a fresh preview',
);
assert.equal(
  records.parsePreviewToken(snapshotToken.replace(snapshotId, '123e4567-e89b-42d3-a456-426614174001'), rows, source).valid,
  false,
  'editing the embedded live snapshot identity must invalidate the token',
);

const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'import_publish_concurrency_guard.sql'), 'utf8');
assert.match(sql, /admin_publish_import_checked/i);
assert.match(sql, /p_expected_latest_snapshot_id/i);
assert.match(sql, /pg_advisory_xact_lock/i);
assert.match(sql, /live team data changed since this preview/i);
assert.doesNotMatch(sql, /as \$\$;/i, 'PL/pgSQL bodies must not contain an extra semicolon after the opening dollar quote');

console.log('Import concurrency regression tests passed: preview tokens bind to the exact live snapshot and SQL mutations are serialized.');
