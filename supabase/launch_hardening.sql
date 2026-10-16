-- Apply as one transaction after the earlier TennisRank migrations.
-- Reuses live function definitions so snapshot instrumentation and permissions survive.
begin;

create or replace function public.expire_ladder_challenges() returns integer
language plpgsql set search_path to 'public' as $$
declare v_count integer; v_players uuid[];
begin
  perform pg_advisory_xact_lock(hashtext('tennisrank_import_mutation'));
  with expired as (
    update public.challenges c set status='expired',completed_at=now()
    from public.team_settings s
    where c.team_gender=s.team_gender
      and c.status in ('pending_response','accepted','scheduled')
      and not exists(select 1 from public.challenge_matches cm where cm.challenge_id=c.id and cm.approval_status in ('pending','verified'))
      and (c.created_at + make_interval(hours => s.challenge_expiration_hours) <= now()
        or (c.status='pending_response' and c.created_at + make_interval(hours => s.response_deadline_hours) <= now()))
    returning c.challenger_id,c.defender_id
  ) select count(*)::integer,array_agg(player_id) into v_count,v_players
    from (select unnest(array[challenger_id,defender_id]) as player_id from expired) ids;
  update public.ladder_entries le
    set status=case when p.active_status='injured' then 'injury_hold' else 'available' end,updated_at=now()
    from public.players p
    where le.player_id=p.id and p.id=any(coalesce(v_players,array[]::uuid[]))
      and not exists(select 1 from public.challenges c where c.status in ('pending_response','accepted','scheduled','played','score_submitted','pending_coach_approval') and p.id in (c.challenger_id,c.defender_id));
  if v_count>0 then
    insert into public.audit_logs(action_type,target_type,metadata) values('expire_challenges','challenge',jsonb_build_object('count',v_count/2));
  end if;
  return v_count/2;
end;
$$;
revoke all on function public.expire_ladder_challenges() from public,anon,authenticated;
grant execute on function public.expire_ladder_challenges() to service_role;

create or replace function public.invalidate_closed_challenge_scores() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  if new.status in ('cancelled','declined','expired','rejected') then
    update public.challenge_matches set approval_status='rejected'
    where challenge_id=new.id and approval_status='pending';
  end if;
  return new;
end;
$$;
revoke all on function public.invalidate_closed_challenge_scores() from public,anon,authenticated;
drop trigger if exists invalidate_closed_challenge_scores on public.challenges;
create trigger invalidate_closed_challenge_scores after update of status on public.challenges
for each row execute function public.invalidate_closed_challenge_scores();

create or replace function public.preserve_ladder_injury_hold() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  if new.status='available' and exists(select 1 from public.players where id=new.player_id and active_status='injured') then new.status:='injury_hold'; end if;
  return new;
end;
$$;
revoke all on function public.preserve_ladder_injury_hold() from public,anon,authenticated;
drop trigger if exists preserve_ladder_injury_hold on public.ladder_entries;
create trigger preserve_ladder_injury_hold before insert or update of status on public.ladder_entries
for each row execute function public.preserve_ladder_injury_hold();

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


create or replace function public.admin_restore_import_snapshot(p_coach_profile_id uuid,p_snapshot_id uuid)
returns uuid language plpgsql set search_path to 'public' as $$
declare v_snapshot public.import_snapshots%rowtype; v_new_id uuid; v_team text; v_roster jsonb; v_item jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('tennisrank_import_mutation'));
  if not exists(select 1 from public.profiles where id=p_coach_profile_id and role='admin') then raise exception 'Coach/admin profile required'; end if;
  select * into v_snapshot from public.import_snapshots where id=p_snapshot_id;
  if not found then raise exception 'Import snapshot not found'; end if;
  -- Save the current board before replacing both teams and all imported sources.
  perform public.admin_clear_import(p_coach_profile_id);
  if jsonb_array_length(v_snapshot.rows)>0 then
    v_new_id:=public.admin_publish_import(p_coach_profile_id,v_snapshot.source_key,'Restored: '||v_snapshot.source_label,
      v_snapshot.rows,v_snapshot.content_hash,coalesce(v_snapshot.summary,'{}'::jsonb)||jsonb_build_object('restored',true),v_snapshot.id);
  else
    insert into public.import_snapshots(source_key,source_label,row_count,rows,summary,content_hash,created_by_profile_id,restored_from_snapshot_id)
    values(v_snapshot.source_key,'Restored: '||v_snapshot.source_label,0,'[]'::jsonb,coalesce(v_snapshot.summary,'{}'::jsonb)||jsonb_build_object('restored',true),v_snapshot.content_hash,p_coach_profile_id,v_snapshot.id)
    returning id into v_new_id;
    insert into public.audit_logs(actor_profile_id,action_type,target_type,target_id,metadata)
    values(p_coach_profile_id,'restore_import','import_snapshot',v_new_id::text,jsonb_build_object('restored_from_snapshot_id',v_snapshot.id,'row_count',0));
  end if;
  if jsonb_typeof(v_snapshot.summary->'recordSources')='array' then
    delete from public.tennis_records where record_key is not null;
    insert into public.tennis_records(record_key,source_key,raw_data,row_index,updated_at)
    select item->>'record_key',item->>'source_key',item->'raw_data',(item->>'row_index')::integer,(item->>'updated_at')::timestamptz
    from jsonb_array_elements(v_snapshot.summary->'recordSources') item;
  end if;
  foreach v_team in array array['boys','girls'] loop
    v_roster:=coalesce(v_snapshot.summary #> array['officialTeams',v_team],'[]'::jsonb);
    if jsonb_typeof(v_roster)<>'array' then raise exception 'Invalid saved team roster'; end if;
    if jsonb_array_length(v_roster)>0 then perform public.admin_seed_ladder(p_coach_profile_id,v_team,v_roster); end if;
  end loop;
  -- Injury state belongs to the saved roster, while account links remain current.
  for v_item in select value from jsonb_array_elements(coalesce(v_snapshot.summary->'rosterState','[]'::jsonb)) loop
    if v_item->>'active_status' in ('active','injured','inactive') then
      update public.players set active_status=v_item->>'active_status',updated_at=now() where id=(v_item->>'id')::uuid;
    end if;
  end loop;
  update public.ladder_entries le set status=case when p.active_status='injured' then 'injury_hold' else 'available' end,updated_at=now()
  from public.players p where p.id=le.player_id and le.team_gender in ('boys','girls');
  return v_new_id;
end;
$$;
revoke all on function public.admin_restore_import_snapshot(uuid,uuid) from public,anon,authenticated;
grant execute on function public.admin_restore_import_snapshot(uuid,uuid) to service_role;

-- Add a common mutation lock without replacing newer production implementations.
do $$
declare v_function record; v_def text; v_next text;
begin
  for v_function in select oid,proname from pg_proc where pronamespace='public'::regnamespace and proname in (
    'create_ladder_challenge','respond_ladder_challenge','submit_ladder_match','verify_challenge_match','reject_challenge_match',
    'admin_seed_ladder','admin_set_player_status','admin_move_ladder_player','admin_undo_ladder_snapshot','admin_publish_import') loop
    v_def:=pg_get_functiondef(v_function.oid);
    if position('tennisrank_import_mutation' in v_def)=0 then
      v_next:=regexp_replace(v_def,'\mbegin\M',E'begin\n  perform pg_advisory_xact_lock(hashtext(''tennisrank_import_mutation''));','i');
      if v_next=v_def then raise exception 'Could not lock function %',v_function.proname; end if;
      v_def:=v_next;
    end if;
    if v_function.proname in ('create_ladder_challenge','respond_ladder_challenge','submit_ladder_match') and position('expire_ladder_challenges' in v_def)=0 then
      v_def:=regexp_replace(v_def,'\mbegin\M',E'begin\n  perform public.expire_ladder_challenges();','i');
    end if;
    if v_function.proname='verify_challenge_match' and position('Challenge is no longer awaiting approval' in v_def)=0 then
      v_def:=regexp_replace(v_def,'\mbegin\M',E'begin\n  perform pg_advisory_xact_lock(hashtext(''tennisrank_import_mutation''));\n  if not exists(select 1 from public.challenge_matches cm join public.challenges c on c.id=cm.challenge_id where cm.id=p_match_id and cm.approval_status=''pending'' and c.status=''pending_coach_approval'') then raise exception ''Challenge is no longer awaiting approval''; end if;','i');
    end if;
    if v_function.proname='admin_seed_ladder' and position('Roster entries must be unique' in v_def)=0 then
      v_def:=regexp_replace(v_def,'\mbegin\M',E'begin\n  if jsonb_typeof(p_players) is distinct from ''array'' then raise exception ''A roster array is required''; end if;\n  if jsonb_array_length(p_players)>1000 or exists(select 1 from jsonb_array_elements(p_players) item where nullif(trim(item->>''name''),'''') is null or length(trim(item->>''name''))>160) or (select count(distinct lower(trim(item->>''name''))) from jsonb_array_elements(p_players) item)<>jsonb_array_length(p_players) then raise exception ''Roster entries must be unique, named, and within the 1000-player limit''; end if;','i');
    end if;
    -- SQL NOT IN with a null participant profile must never grant permission.
    v_def:=replace(v_def,'p_actor_profile_id <> v_defender_profile_id and not v_actor_is_admin','p_actor_profile_id is distinct from v_defender_profile_id and not v_actor_is_admin');
    v_def:=replace(v_def,'p_actor_profile_id not in (v_challenger_profile_id, v_defender_profile_id) and not v_actor_is_admin','p_actor_profile_id is distinct from v_challenger_profile_id and p_actor_profile_id is distinct from v_defender_profile_id and not v_actor_is_admin');
    execute v_def;
  end loop;
end;
$$;

-- Repair pending submissions belonging to already closed challenges.
update public.challenge_matches cm set approval_status='rejected'
from public.challenges c where c.id=cm.challenge_id and cm.approval_status='pending'
  and c.status in ('cancelled','declined','expired','rejected');
commit;
