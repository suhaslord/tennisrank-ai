-- Coach operations safety layer: import history/restore + safe one-step ladder undo.
-- Applied to production on 2026-08-16.

alter table public.tennis_records add column if not exists row_index integer not null default 0;

with ordered as (
  select record_key, row_number() over (partition by source_key order by updated_at, record_key)::integer as rn
  from public.tennis_records
)
update public.tennis_records tr
set row_index = ordered.rn
from ordered
where ordered.record_key = tr.record_key and tr.row_index = 0;

create index if not exists tennis_records_source_order_idx on public.tennis_records(source_key, row_index);

create table if not exists public.import_snapshots (
  id uuid primary key default gen_random_uuid(),
  source_key text not null,
  source_label text not null,
  row_count integer not null check (row_count >= 0),
  rows jsonb not null check (jsonb_typeof(rows) = 'array'),
  summary jsonb not null default '{}'::jsonb,
  content_hash text not null,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  restored_from_snapshot_id uuid references public.import_snapshots(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists import_snapshots_created_idx on public.import_snapshots(created_at desc);
create index if not exists import_snapshots_source_idx on public.import_snapshots(source_key, created_at desc);
alter table public.import_snapshots enable row level security;

create table if not exists public.ladder_snapshots (
  id uuid primary key default gen_random_uuid(),
  team_gender text not null check (team_gender in ('boys','girls')),
  reason text not null,
  reference_type text,
  reference_id text,
  entries jsonb not null check (jsonb_typeof(entries) = 'array'),
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  restored_at timestamptz,
  restored_by_profile_id uuid references public.profiles(id) on delete set null
);
create index if not exists ladder_snapshots_team_created_idx on public.ladder_snapshots(team_gender, created_at desc);
alter table public.ladder_snapshots enable row level security;

create or replace function public.capture_ladder_snapshot(
  p_team_gender text,
  p_reason text,
  p_reference_type text default null,
  p_reference_id text default null,
  p_actor_profile_id uuid default null
) returns uuid
language plpgsql
set search_path to 'public'
as $$
declare
  v_snapshot_id uuid;
  v_entries jsonb;
begin
  if p_team_gender not in ('boys','girls') then raise exception 'Team gender must be boys or girls'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'player_id', le.player_id,
    'rank_position', le.rank_position,
    'previous_rank_position', le.previous_rank_position,
    'status', le.status
  ) order by le.rank_position), '[]'::jsonb)
  into v_entries
  from public.ladder_entries le
  where le.team_gender = p_team_gender;
  insert into public.ladder_snapshots(team_gender, reason, reference_type, reference_id, entries, created_by_profile_id)
  values(p_team_gender, p_reason, p_reference_type, p_reference_id, v_entries, p_actor_profile_id)
  returning id into v_snapshot_id;
  return v_snapshot_id;
end;
$$;

create or replace function public.admin_publish_import(
  p_coach_profile_id uuid,
  p_source_key text,
  p_source_label text,
  p_rows jsonb,
  p_content_hash text,
  p_summary jsonb default '{}'::jsonb,
  p_restored_from_snapshot_id uuid default null
) returns uuid
language plpgsql
set search_path to 'public'
as $$
declare
  v_snapshot_id uuid;
  v_row jsonb;
  v_index bigint;
  v_now timestamptz := now();
begin
  if not exists (select 1 from public.profiles where id = p_coach_profile_id and role = 'admin') then raise exception 'Coach/admin profile required'; end if;
  if nullif(trim(coalesce(p_source_key,'')), '') is null then raise exception 'Source key is required'; end if;
  if nullif(trim(coalesce(p_source_label,'')), '') is null then raise exception 'Source label is required'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'At least one import row is required'; end if;
  if jsonb_array_length(p_rows) > 10000 then raise exception 'Import exceeds 10000 rows'; end if;

  delete from public.tennis_records where source_key = p_source_key;
  for v_row, v_index in select value, ordinality from jsonb_array_elements(p_rows) with ordinality loop
    insert into public.tennis_records(record_key, source_key, raw_data, row_index, updated_at)
    values(md5(p_source_key || ':' || v_index::text || ':' || coalesce(v_row->>'__sourceRow','')), p_source_key, v_row, v_index::integer, v_now);
  end loop;

  insert into public.import_snapshots(source_key, source_label, row_count, rows, summary, content_hash, created_by_profile_id, restored_from_snapshot_id, created_at)
  values(p_source_key, trim(p_source_label), jsonb_array_length(p_rows), p_rows, coalesce(p_summary,'{}'::jsonb), p_content_hash, p_coach_profile_id, p_restored_from_snapshot_id, v_now)
  returning id into v_snapshot_id;

  insert into public.audit_logs(actor_profile_id, action_type, target_type, target_id, metadata)
  values(p_coach_profile_id, case when p_restored_from_snapshot_id is null then 'publish_import' else 'restore_import' end, 'import_snapshot', v_snapshot_id::text,
    jsonb_build_object('source_label', trim(p_source_label), 'row_count', jsonb_array_length(p_rows), 'content_hash', p_content_hash, 'restored_from_snapshot_id', p_restored_from_snapshot_id));
  return v_snapshot_id;
end;
$$;

create or replace function public.admin_restore_import_snapshot(p_coach_profile_id uuid, p_snapshot_id uuid)
returns uuid
language plpgsql
set search_path to 'public'
as $$
declare
  v_snapshot public.import_snapshots%rowtype;
  v_new_snapshot_id uuid;
  v_boys jsonb;
  v_girls jsonb;
begin
  if not exists (select 1 from public.profiles where id = p_coach_profile_id and role = 'admin') then raise exception 'Coach/admin profile required'; end if;
  select * into v_snapshot from public.import_snapshots where id = p_snapshot_id;
  if not found then raise exception 'Import snapshot not found'; end if;
  v_new_snapshot_id := public.admin_publish_import(p_coach_profile_id, v_snapshot.source_key, 'Restored: ' || v_snapshot.source_label, v_snapshot.rows, v_snapshot.content_hash,
    coalesce(v_snapshot.summary,'{}'::jsonb) || jsonb_build_object('restored', true), v_snapshot.id);
  v_boys := coalesce(v_snapshot.summary #> '{officialTeams,boys}', '[]'::jsonb);
  v_girls := coalesce(v_snapshot.summary #> '{officialTeams,girls}', '[]'::jsonb);
  if jsonb_typeof(v_boys) = 'array' and jsonb_array_length(v_boys) > 0 then perform public.admin_seed_ladder(p_coach_profile_id, 'boys', v_boys); end if;
  if jsonb_typeof(v_girls) = 'array' and jsonb_array_length(v_girls) > 0 then perform public.admin_seed_ladder(p_coach_profile_id, 'girls', v_girls); end if;
  return v_new_snapshot_id;
end;
$$;

create or replace function public.admin_undo_ladder_snapshot(p_coach_profile_id uuid, p_snapshot_id uuid)
returns void
language plpgsql
set search_path to 'public'
as $$
declare
  v_snapshot public.ladder_snapshots%rowtype;
  v_item jsonb;
  v_player_id uuid;
  v_target_rank integer;
  v_old_rank integer;
begin
  if not exists (select 1 from public.profiles where id = p_coach_profile_id and role = 'admin') then raise exception 'Coach/admin profile required'; end if;
  select * into v_snapshot from public.ladder_snapshots where id = p_snapshot_id for update;
  if not found then raise exception 'Ladder snapshot not found'; end if;
  if v_snapshot.restored_at is not null then raise exception 'This ladder change was already undone'; end if;
  if v_snapshot.reason = 'import_sync' then raise exception 'Use import history restore for imported ladder changes'; end if;
  if exists(select 1 from public.ladder_snapshots where team_gender = v_snapshot.team_gender and created_at > v_snapshot.created_at) then raise exception 'Only the most recent ladder change can be undone safely'; end if;

  set constraints ladder_entries_gender_rank_unique deferred;
  update public.ladder_entries set rank_position = rank_position + 10000, updated_at = now() where team_gender = v_snapshot.team_gender;
  for v_item in select value from jsonb_array_elements(v_snapshot.entries) loop
    v_player_id := (v_item->>'player_id')::uuid;
    v_target_rank := (v_item->>'rank_position')::integer;
    select rank_position - 10000 into v_old_rank from public.ladder_entries where player_id = v_player_id;
    insert into public.ladder_entries(player_id, team_gender, rank_position, previous_rank_position, status, updated_at)
    values(v_player_id, v_snapshot.team_gender, v_target_rank, nullif(v_item->>'previous_rank_position','')::integer, coalesce(nullif(v_item->>'status',''),'available'), now())
    on conflict (player_id) do update set team_gender=excluded.team_gender, previous_rank_position=case when v_old_rank is null then public.ladder_entries.previous_rank_position else v_old_rank end,
      rank_position=excluded.rank_position, status=excluded.status, updated_at=now();
    if v_old_rank is not null and v_old_rank <> v_target_rank then
      insert into public.rank_history(player_id, old_rank, new_rank, reason, changed_by_profile_id) values(v_player_id, v_old_rank, v_target_rank, 'undo', p_coach_profile_id);
    end if;
  end loop;
  delete from public.ladder_entries le where le.team_gender = v_snapshot.team_gender and not exists (
    select 1 from jsonb_array_elements(v_snapshot.entries) item where (item->>'player_id')::uuid = le.player_id
  );
  if v_snapshot.reason = 'challenge_verify' and v_snapshot.reference_type = 'challenge_match' and v_snapshot.reference_id is not null then
    update public.challenge_matches set approval_status='rejected', verified_by_profile_id=p_coach_profile_id, verified_at=now() where id=v_snapshot.reference_id::uuid;
    update public.challenges c set status='rejected', completed_at=now() from public.challenge_matches cm where cm.id=v_snapshot.reference_id::uuid and c.id=cm.challenge_id;
  end if;
  update public.ladder_snapshots set restored_at=now(), restored_by_profile_id=p_coach_profile_id where id=p_snapshot_id;
  insert into public.audit_logs(actor_profile_id, action_type, target_type, target_id, metadata)
  values(p_coach_profile_id,'undo_ladder_change','ladder_snapshot',p_snapshot_id::text,jsonb_build_object('team_gender',v_snapshot.team_gender,'reason',v_snapshot.reason,'reference_type',v_snapshot.reference_type,'reference_id',v_snapshot.reference_id));
end;
$$;

-- The production migration also replaces admin_move_ladder_player, admin_seed_ladder,
-- and verify_challenge_match so they call capture_ladder_snapshot immediately before
-- a real rank mutation. Keep those definitions synchronized with the production
-- database migration history when changing the ladder RPCs.

with latest as (select source_key from public.tennis_records order by updated_at desc limit 1),
packed as (
  select tr.source_key, coalesce(jsonb_agg(tr.raw_data order by tr.row_index, tr.updated_at, tr.record_key),'[]'::jsonb) as rows, count(*)::integer as row_count
  from public.tennis_records tr join latest l on l.source_key=tr.source_key group by tr.source_key
),
teams as (
  select jsonb_build_object('officialTeams',jsonb_build_object(
    'boys',coalesce((select jsonb_agg(jsonb_build_object('name',p.display_name,'division',p.division,'gradeLevel',p.grade_level) order by le.rank_position) from public.ladder_entries le join public.players p on p.id=le.player_id where le.team_gender='boys'),'[]'::jsonb),
    'girls',coalesce((select jsonb_agg(jsonb_build_object('name',p.display_name,'division',p.division,'gradeLevel',p.grade_level) order by le.rank_position) from public.ladder_entries le join public.players p on p.id=le.player_id where le.team_gender='girls'),'[]'::jsonb)
  ),'backfilled',true) as summary
)
insert into public.import_snapshots(source_key,source_label,row_count,rows,summary,content_hash,created_by_profile_id)
select p.source_key,'Current live board (history enabled)',p.row_count,p.rows,t.summary,md5(p.rows::text),null from packed p cross join teams t
where p.row_count>0 and not exists(select 1 from public.import_snapshots);

revoke all on function public.capture_ladder_snapshot(text,text,text,text,uuid) from public, anon, authenticated;
revoke all on function public.admin_publish_import(uuid,text,text,jsonb,text,jsonb,uuid) from public, anon, authenticated;
revoke all on function public.admin_restore_import_snapshot(uuid,uuid) from public, anon, authenticated;
revoke all on function public.admin_undo_ladder_snapshot(uuid,uuid) from public, anon, authenticated;
grant execute on function public.capture_ladder_snapshot(text,text,text,text,uuid) to service_role;
grant execute on function public.admin_publish_import(uuid,text,text,jsonb,text,jsonb,uuid) to service_role;
grant execute on function public.admin_restore_import_snapshot(uuid,uuid) to service_role;
grant execute on function public.admin_undo_ladder_snapshot(uuid,uuid) to service_role;
