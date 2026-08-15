-- TennisRank one-time ladder initialization from the existing spreadsheet-derived board.
-- Run after the base ladder migration.

create or replace function public.admin_seed_ladder(
  p_coach_profile_id uuid,
  p_team_gender text,
  p_players jsonb
) returns integer
language plpgsql
set search_path = public
as $$
declare
  v_item jsonb;
  v_name text;
  v_profile_id uuid;
  v_player_id uuid;
  v_rank integer := 0;
begin
  if not exists (
    select 1 from public.profiles where id = p_coach_profile_id and role = 'admin'
  ) then
    raise exception 'Coach/admin profile required';
  end if;

  if p_team_gender not in ('boys', 'girls') then
    raise exception 'Team gender must be boys or girls';
  end if;

  if jsonb_typeof(p_players) <> 'array' or jsonb_array_length(p_players) = 0 then
    raise exception 'At least one player is required';
  end if;

  if exists (select 1 from public.ladder_entries where team_gender = p_team_gender) then
    raise exception 'This ladder has already been initialized';
  end if;

  for v_item in select value from jsonb_array_elements(p_players)
  loop
    v_name := nullif(trim(v_item->>'name'), '');
    if v_name is null then
      continue;
    end if;
    v_rank := v_rank + 1;

    select p.id into v_profile_id
    from public.profiles p
    where lower(trim(coalesce(p.player_name, p.full_name))) = lower(v_name)
    order by case when p.player_name is not null then 0 else 1 end
    limit 1;

    select id into v_player_id
    from public.players
    where team_gender = p_team_gender and lower(trim(display_name)) = lower(v_name)
    limit 1;

    if v_player_id is null then
      insert into public.players (profile_id, display_name, team_gender, division, active_status)
      values (v_profile_id, v_name, p_team_gender, 'varsity', 'active')
      returning id into v_player_id;
    elsif v_profile_id is not null then
      update public.players
      set profile_id = coalesce(profile_id, v_profile_id), updated_at = now()
      where id = v_player_id;
    end if;

    insert into public.ladder_entries (player_id, team_gender, rank_position, previous_rank_position, status)
    values (v_player_id, p_team_gender, v_rank, v_rank, 'available');

    insert into public.rank_history (player_id, old_rank, new_rank, reason, changed_by_profile_id)
    values (v_player_id, v_rank, v_rank, 'import', p_coach_profile_id);
  end loop;

  if v_rank = 0 then
    raise exception 'No valid player names were provided';
  end if;

  insert into public.audit_logs (actor_profile_id, action_type, target_type, target_id, metadata)
  values (
    p_coach_profile_id,
    'seed_ladder',
    'ladder',
    p_team_gender,
    jsonb_build_object('player_count', v_rank)
  );

  return v_rank;
end;
$$;

revoke all on function public.admin_seed_ladder(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.admin_seed_ladder(uuid, text, jsonb) to service_role;
