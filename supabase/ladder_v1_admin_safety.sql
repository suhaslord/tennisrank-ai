-- Safety refinement for ladder admin status changes.
-- Apply after ladder_v1_admin.sql.

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
  v_challenge record;
  v_other_player uuid;
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

  if p_status <> 'active' then
    -- An injury/inactive hold immediately ends open competition involving this player.
    -- The opponent becomes available again if they are still an active roster member.
    for v_challenge in
      select id, challenger_id, defender_id
      from public.challenges
      where status in ('pending_response', 'accepted', 'scheduled', 'played', 'score_submitted', 'pending_coach_approval')
        and (challenger_id = p_player_id or defender_id = p_player_id)
      for update
    loop
      update public.challenges
      set status = 'cancelled', completed_at = now()
      where id = v_challenge.id;

      v_other_player := case
        when v_challenge.challenger_id = p_player_id then v_challenge.defender_id
        else v_challenge.challenger_id
      end;

      update public.ladder_entries le
      set status = 'available', updated_at = now()
      from public.players p
      where le.player_id = v_other_player
        and p.id = v_other_player
        and p.active_status = 'active';

      insert into public.audit_logs (actor_profile_id, action_type, target_type, target_id, reason, metadata)
      values (
        p_coach_profile_id,
        'cancel_challenge_for_status_hold',
        'challenge',
        v_challenge.id::text,
        p_reason,
        jsonb_build_object('held_player_id', p_player_id, 'new_status', p_status)
      );
    end loop;

    v_entry_status := 'injury_hold';
  else
    if exists (
      select 1 from public.challenges c
      where c.status in ('pending_response', 'accepted', 'scheduled', 'played', 'score_submitted', 'pending_coach_approval')
        and (c.challenger_id = p_player_id or c.defender_id = p_player_id)
    ) then
      v_entry_status := 'challenge_pending';
    else
      v_entry_status := 'available';
    end if;
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

revoke all on function public.admin_set_player_status(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_set_player_status(uuid, uuid, text, text) to service_role;
