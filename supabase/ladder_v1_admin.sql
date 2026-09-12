-- TennisRank ladder admin controls
-- Run after ladder_v1.sql and ladder_v1_workflow.sql.

create or replace function public.admin_set_player_status(
  p_coach_profile_id uuid,
  p_player_id uuid,
  p_status text,
  p_reason text default null
) returns void
language plpgsql
set search_path = public
as $$
declare
  v_entry_status text;
begin
  if not exists (
    select 1 from public.profiles where id = p_coach_profile_id and role = 'admin'
  ) then
    raise exception 'Coach/admin profile required';
  end if;

  if p_status not in ('active', 'injured', 'inactive') then
    raise exception 'Unsupported player status';
  end if;

  if not exists (select 1 from public.players where id = p_player_id for update) then
    raise exception 'Player not found';
  end if;

  if p_status = 'active' then
    if exists (
      select 1 from public.challenges c
      where c.status in ('pending_response', 'accepted', 'scheduled', 'played', 'score_submitted', 'pending_coach_approval')
        and (c.challenger_id = p_player_id or c.defender_id = p_player_id)
    ) then
      v_entry_status := 'challenge_pending';
    else
      v_entry_status := 'available';
    end if;
  else
    v_entry_status := 'injury_hold';
  end if;

  update public.players
  set active_status = p_status, updated_at = now()
  where id = p_player_id;

  update public.ladder_entries
  set status = v_entry_status, updated_at = now()
  where player_id = p_player_id;

  insert into public.audit_logs (actor_profile_id, action_type, target_type, target_id, reason, metadata)
  values (
    p_coach_profile_id,
    'set_player_status',
    'player',
    p_player_id::text,
    p_reason,
    jsonb_build_object('status', p_status, 'ladder_status', v_entry_status)
  );
end;
$$;

create or replace function public.admin_move_ladder_player(
  p_coach_profile_id uuid,
  p_player_id uuid,
  p_new_rank integer,
  p_reason text default null
) returns void
language plpgsql
set search_path = public
as $$
declare
  v_team_gender text;
  v_old_rank integer;
  v_max_rank integer;
  v_player uuid;
  v_from integer;
  v_to integer;
begin
  if not exists (
    select 1 from public.profiles where id = p_coach_profile_id and role = 'admin'
  ) then
    raise exception 'Coach/admin profile required';
  end if;

  select team_gender, rank_position
    into v_team_gender, v_old_rank
  from public.ladder_entries
  where player_id = p_player_id
  for update;

  if v_old_rank is null then
    raise exception 'Player is not on a ladder';
  end if;

  select count(*)::integer into v_max_rank
  from public.ladder_entries
  where team_gender = v_team_gender;

  if p_new_rank < 1 or p_new_rank > v_max_rank then
    raise exception 'New rank is outside the ladder';
  end if;

  if p_new_rank = v_old_rank then
    return;
  end if;

  if exists (
    select 1 from public.challenges c
    where c.status in ('pending_response', 'accepted', 'scheduled', 'played', 'score_submitted', 'pending_coach_approval')
      and (c.challenger_id = p_player_id or c.defender_id = p_player_id)
  ) then
    raise exception 'Resolve the player''s open challenge before manually changing rank';
  end if;

  set constraints ladder_entries_gender_rank_unique deferred;

  -- Move the selected row out of the way temporarily so the range can shift safely.
  update public.ladder_entries
  set previous_rank_position = v_old_rank,
      rank_position = v_max_rank + 1000,
      updated_at = now()
  where player_id = p_player_id;

  if p_new_rank < v_old_rank then
    for v_player, v_from in
      select player_id, rank_position
      from public.ladder_entries
      where team_gender = v_team_gender
        and rank_position >= p_new_rank
        and rank_position < v_old_rank
      order by rank_position desc
      for update
    loop
      v_to := v_from + 1;
      update public.ladder_entries
      set previous_rank_position = v_from, rank_position = v_to, updated_at = now()
      where player_id = v_player;

      insert into public.rank_history (player_id, old_rank, new_rank, reason, changed_by_profile_id)
      values (v_player, v_from, v_to, 'manual', p_coach_profile_id);
    end loop;
  else
    for v_player, v_from in
      select player_id, rank_position
      from public.ladder_entries
      where team_gender = v_team_gender
        and rank_position > v_old_rank
        and rank_position <= p_new_rank
      order by rank_position
      for update
    loop
      v_to := v_from - 1;
      update public.ladder_entries
      set previous_rank_position = v_from, rank_position = v_to, updated_at = now()
      where player_id = v_player;

      insert into public.rank_history (player_id, old_rank, new_rank, reason, changed_by_profile_id)
      values (v_player, v_from, v_to, 'manual', p_coach_profile_id);
    end loop;
  end if;

  update public.ladder_entries
  set rank_position = p_new_rank, updated_at = now()
  where player_id = p_player_id;

  insert into public.rank_history (player_id, old_rank, new_rank, reason, changed_by_profile_id)
  values (p_player_id, v_old_rank, p_new_rank, 'manual', p_coach_profile_id);

  insert into public.audit_logs (actor_profile_id, action_type, target_type, target_id, reason, metadata)
  values (
    p_coach_profile_id,
    'manual_rank_move',
    'player',
    p_player_id::text,
    p_reason,
    jsonb_build_object('old_rank', v_old_rank, 'new_rank', p_new_rank, 'team_gender', v_team_gender)
  );
end;
$$;

revoke all on function public.admin_set_player_status(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_move_ladder_player(uuid, uuid, integer, text) from public, anon, authenticated;
grant execute on function public.admin_set_player_status(uuid, uuid, text, text) to service_role;
grant execute on function public.admin_move_ladder_player(uuid, uuid, integer, text) to service_role;
