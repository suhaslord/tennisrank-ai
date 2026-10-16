-- Coach-only destructive reset for the live imported board.
-- Keeps a rollback snapshot of the current live import, preserves accounts/player records,
-- then clears imported match rows and the current official ladder.

create or replace function public.admin_clear_import(p_coach_profile_id uuid)
returns uuid
language plpgsql
set search_path to 'public'
as $$
declare
  v_source_key text;
  v_rows jsonb := '[]'::jsonb;
  v_row_count integer := 0;
  v_snapshot_id uuid;
  v_boys jsonb := '[]'::jsonb;
  v_girls jsonb := '[]'::jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('tennisrank_import_mutation'));
  if not exists (
    select 1 from public.profiles
    where id = p_coach_profile_id and role = 'admin'
  ) then
    raise exception 'Coach/admin profile required';
  end if;

  select source_key
  into v_source_key
  from public.tennis_records
  order by updated_at desc
  limit 1;

  if v_source_key is not null then
    select
      coalesce(jsonb_agg(raw_data order by row_index, updated_at, record_key), '[]'::jsonb),
      count(*)::integer
    into v_rows, v_row_count
    from public.tennis_records
    where source_key = v_source_key;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'name', p.display_name,
    'division', p.division,
    'gradeLevel', p.grade_level
  ) order by le.rank_position), '[]'::jsonb)
  into v_boys
  from public.ladder_entries le
  join public.players p on p.id = le.player_id
  where le.team_gender = 'boys';

  select coalesce(jsonb_agg(jsonb_build_object(
    'name', p.display_name,
    'division', p.division,
    'gradeLevel', p.grade_level
  ) order by le.rank_position), '[]'::jsonb)
  into v_girls
  from public.ladder_entries le
  join public.players p on p.id = le.player_id
  where le.team_gender = 'girls';

  if v_row_count > 0 or jsonb_array_length(v_boys) > 0 or jsonb_array_length(v_girls) > 0
     or exists (select 1 from public.players where active_status <> 'inactive') then
    insert into public.import_snapshots(
      source_key,
      source_label,
      row_count,
      rows,
      summary,
      content_hash,
      created_by_profile_id
    ) values (
      coalesce(v_source_key, 'empty-board'),
      'Before data removal',
      v_row_count,
      v_rows,
      jsonb_build_object(
        'officialTeams', jsonb_build_object('boys', v_boys, 'girls', v_girls),
        'beforeClear', true,
        'recordSources', (select coalesce(jsonb_agg(to_jsonb(tr) order by updated_at,record_key), '[]'::jsonb) from public.tennis_records tr),
        'rosterState', (select coalesce(jsonb_agg(jsonb_build_object('id',id,'active_status',active_status)), '[]'::jsonb) from public.players)
      ),
      md5(v_rows::text),
      p_coach_profile_id
    )
    returning id into v_snapshot_id;
  end if;

  update public.challenges set status='cancelled', completed_at=now()
  where status in ('pending_response','accepted','scheduled','played','score_submitted','pending_coach_approval');
  perform public.capture_ladder_snapshot('boys','import_sync','clear',v_snapshot_id::text,p_coach_profile_id);
  perform public.capture_ladder_snapshot('girls','import_sync','clear',v_snapshot_id::text,p_coach_profile_id);
  update public.players set active_status='inactive', updated_at=now() where active_status <> 'inactive';

  delete from public.tennis_records where record_key is not null;
  delete from public.ladder_entries where team_gender in ('boys', 'girls');

  insert into public.audit_logs(actor_profile_id, action_type, target_type, target_id, metadata)
  values(
    p_coach_profile_id,
    'clear_import',
    'team_data',
    coalesce(v_snapshot_id::text, 'empty-board'),
    jsonb_build_object(
      'rows_removed', v_row_count,
      'rollback_snapshot_id', v_snapshot_id,
      'player_accounts_preserved', true
    )
  );

  return v_snapshot_id;
end;
$$;

revoke all on function public.admin_clear_import(uuid) from public, anon, authenticated;
grant execute on function public.admin_clear_import(uuid) to service_role;
