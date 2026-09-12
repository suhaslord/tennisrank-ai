-- Preserve coach spreadsheet roster metadata while keeping ladder imports idempotent.
-- Applied to production as migration: preserve_roster_metadata_and_player_links.
create or replace function public.admin_seed_ladder(p_coach_profile_id uuid, p_team_gender text, p_players jsonb)
returns integer
language plpgsql
set search_path to 'public'
as $function$
declare
  v_item jsonb;
  v_name text;
  v_division text;
  v_grade_level integer;
  v_profile_id uuid;
  v_player_id uuid;
  v_rank integer := 0;
  v_old_rank integer;
  v_removed integer := 0;
  v_cancelled integer := 0;
  v_target_ids uuid[] := array[]::uuid[];
  v_current_ids uuid[] := array[]::uuid[];
  v_seen_names text[] := array[]::text[];
  v_changed boolean := false;
begin
  if not exists (select 1 from public.profiles where id = p_coach_profile_id and role = 'admin') then
    raise exception 'Coach/admin profile required';
  end if;
  if p_team_gender not in ('boys', 'girls') then raise exception 'Team gender must be boys or girls'; end if;
  if jsonb_typeof(p_players) <> 'array' or jsonb_array_length(p_players) = 0 then raise exception 'At least one player is required'; end if;

  for v_item in select value from jsonb_array_elements(p_players)
  loop
    v_name := nullif(trim(v_item->>'name'), '');
    if v_name is null then continue; end if;
    if lower(v_name) = any(v_seen_names) then continue; end if;
    v_seen_names := array_append(v_seen_names, lower(v_name));

    v_division := case when lower(trim(coalesce(v_item->>'division', ''))) in ('varsity', 'jv') then lower(trim(v_item->>'division')) else null end;
    v_grade_level := case when trim(coalesce(v_item->>'gradeLevel', '')) ~ '^(9|10|11|12)$' then (v_item->>'gradeLevel')::integer else null end;

    select id into v_player_id from public.players
      where team_gender = p_team_gender and lower(trim(display_name)) = lower(v_name)
      order by case when active_status = 'active' then 0 else 1 end, created_at limit 1;

    v_profile_id := null;
    select p.id into v_profile_id from public.profiles p
      where p.role = 'player' and lower(trim(coalesce(p.player_name, p.full_name))) = lower(v_name)
      order by case when p.player_name is not null then 0 else 1 end, p.created_at limit 1;

    if v_profile_id is not null and exists (
      select 1 from public.players linked where linked.profile_id = v_profile_id and (v_player_id is null or linked.id <> v_player_id)
    ) then v_profile_id := null; end if;

    if v_player_id is null then
      insert into public.players (profile_id, display_name, team_gender, grade_level, division, active_status)
      values (v_profile_id, v_name, p_team_gender, v_grade_level, coalesce(v_division, 'varsity'), 'active')
      returning id into v_player_id;
    else
      update public.players set
        profile_id = coalesce(profile_id, v_profile_id), display_name = v_name,
        grade_level = coalesce(v_grade_level, grade_level), division = coalesce(v_division, division),
        active_status = case when active_status = 'injured' then 'injured' else 'active' end, updated_at = now()
      where id = v_player_id;
    end if;
    v_target_ids := array_append(v_target_ids, v_player_id);
  end loop;

  v_rank := coalesce(array_length(v_target_ids, 1), 0);
  if v_rank = 0 then raise exception 'No valid player names were provided'; end if;
  select coalesce(array_agg(player_id order by rank_position), array[]::uuid[]) into v_current_ids
    from public.ladder_entries where team_gender = p_team_gender;
  v_changed := v_current_ids is distinct from v_target_ids;
  if not v_changed then return v_rank; end if;

  update public.challenges set status = 'cancelled'
    where team_gender = p_team_gender and status in ('pending_response','accepted','scheduled','played','score_submitted','pending_coach_approval');
  get diagnostics v_cancelled = row_count;
  set constraints ladder_entries_gender_rank_unique deferred;
  update public.ladder_entries set previous_rank_position = rank_position, rank_position = rank_position + 10000, updated_at = now()
    where team_gender = p_team_gender;

  for v_rank in 1..array_length(v_target_ids, 1)
  loop
    v_player_id := v_target_ids[v_rank];
    select previous_rank_position into v_old_rank from public.ladder_entries where player_id = v_player_id;
    if found then
      update public.ladder_entries le set team_gender = p_team_gender, rank_position = v_rank,
        status = case when p.active_status = 'injured' then 'injury_hold' else 'available' end, updated_at = now()
      from public.players p where le.player_id = v_player_id and p.id = le.player_id;
    else
      insert into public.ladder_entries (player_id, team_gender, rank_position, previous_rank_position, status)
      select p.id, p_team_gender, v_rank, v_rank, case when p.active_status = 'injured' then 'injury_hold' else 'available' end
      from public.players p where p.id = v_player_id;
      v_old_rank := null;
    end if;
    if v_old_rank is null or v_old_rank <> v_rank then
      insert into public.rank_history (player_id, old_rank, new_rank, reason, changed_by_profile_id)
      values (v_player_id, coalesce(v_old_rank, v_rank), v_rank, 'import', p_coach_profile_id);
    end if;
  end loop;

  delete from public.ladder_entries where team_gender = p_team_gender and not (player_id = any(v_target_ids));
  get diagnostics v_removed = row_count;
  update public.players set active_status = 'inactive', updated_at = now()
    where team_gender = p_team_gender and not (id = any(v_target_ids));
  insert into public.audit_logs (actor_profile_id, action_type, target_type, target_id, metadata)
  values (p_coach_profile_id, 'sync_ladder_from_import', 'ladder', p_team_gender,
    jsonb_build_object('player_count', array_length(v_target_ids,1),'removed_count',v_removed,'cancelled_challenges',v_cancelled,'metadata_preserved',true));
  return array_length(v_target_ids, 1);
end;
$function$;
