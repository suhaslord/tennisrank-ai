const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const api = fs.readFileSync(path.join(root, 'api/admin/ladder.js'), 'utf8');
const adminSql = fs.readFileSync(path.join(root, 'supabase/ladder_v1_admin.sql'), 'utf8');
const safetySql = fs.readFileSync(path.join(root, 'supabase/ladder_v1_admin_safety.sql'), 'utf8');

assert.match(api, /context\.profile\.role\s*!==\s*["']admin["']/, 'admin ladder endpoint must reject non-admin users');
assert.match(api, /new Set\(\[["']active["'],\s*["']injured["'],\s*["']inactive["']\]\)/, 'status endpoint must allow only active/injured/inactive');
assert.match(api, /Number\.isInteger\(rank\).*rank\s*<\s*1/s, 'move endpoint must require a positive integer rank');
assert.match(api, /admin_set_player_status/, 'status action must use the guarded status RPC');
assert.match(api, /admin_move_ladder_player/, 'move action must use the guarded move RPC');

assert.match(adminSql, /create or replace function public\.admin_move_ladder_player/i, 'manual move RPC must exist');
assert.match(adminSql, /New rank is outside the ladder/i, 'manual move RPC must enforce ladder bounds');
assert.match(adminSql, /Resolve the player''s open challenge before manually changing rank/i, 'manual move must reject players with an open challenge');
assert.match(adminSql, /set constraints ladder_entries_gender_rank_unique deferred/i, 'manual move must defer rank uniqueness while shifting rows');
assert.match(adminSql, /rank_position\s*=\s*v_max_rank\s*\+\s*1000/i, 'manual move must move target out of the way before shifting ranks');
assert.match(adminSql, /reason, changed_by_profile_id\)\s*values\s*\(p_player_id, v_old_rank, p_new_rank, 'manual'/is, 'manual move must write rank history');
assert.match(adminSql, /'manual_rank_move'/, 'manual move must write an audit event');

assert.match(safetySql, /create or replace function public\.admin_set_player_status/i, 'status safety RPC must exist');
assert.match(safetySql, /if p_status <> 'active' then/i, 'injured/inactive status must enter the hold path');
assert.match(safetySql, /update public\.challenges\s+set status = 'cancelled'/is, 'putting a player on hold must cancel their open challenge');
assert.match(safetySql, /v_other_player := case/i, 'status hold must identify the opponent');
assert.match(safetySql, /set status = 'available'.*p\.active_status = 'active'/is, 'status hold must release an active opponent');
assert.match(safetySql, /v_entry_status := 'injury_hold'/i, 'injured/inactive player must be unavailable for challenges');
assert.match(safetySql, /'cancel_challenge_for_status_hold'/, 'automatic challenge cancellation must be audited');
assert.match(safetySql, /'set_player_status'/, 'status change itself must be audited');

console.log('Coach ladder backend contracts passed: move bounds/shifting/audit plus injury hold/cancel/opponent release.');
