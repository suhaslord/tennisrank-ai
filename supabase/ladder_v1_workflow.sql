-- TennisRank ladder workflow functions
-- Run after ladder_v1.sql. All functions are SECURITY INVOKER and executable only by service_role.

create or replace function public.respond_ladder_challenge(
  p_actor_profile_id uuid,
  p_challenge_id uuid,
  p_action text,
  p_scheduled_for timestamptz default null,
  p_court_location text default null
) returns void
language plpgsql
set search_path = public
as $$
declare
  v_challenger_id uuid;
  v_defender_id uuid;
  v_challenger_profile_id uuid;
  v_defender_profile_id uuid;
  v_status text;
  v_actor_is_admin boolean;
begin
  select c.challenger_id, c.defender_id, c.status, cp.profile_id, dp.profile_id
    into v_challenger_id, v_defender_id, v_status, v_challenger_profile_id, v_defender_profile_id
  from public.challenges c
  join public.players cp on cp.id = c.challenger_id
  join public.players dp on dp.id = c.defender_id
  where c.id = p_challenge_id
  for update of c;

  if v_status is null then
    raise exception 'Challenge not found';
  end if;

  select exists (
    select 1 from public.profiles where id = p_actor_profile_id and role = 'admin'
  ) into v_actor_is_admin;

  if p_action in ('accept', 'decline') then
    if p_actor_profile_id <> v_defender_profile_id and not v_actor_is_admin then
      raise exception 'Only the defender or an admin may accept or decline this challenge';
    end if;
    if v_status <> 'pending_response' then
      raise exception 'Challenge is not waiting for a response';
    end if;

    if p_action = 'accept' then
      update public.challenges
      set status = case when p_scheduled_for is null then 'accepted' else 'scheduled' end,
          responded_at = now(),
          scheduled_for = p_scheduled_for,
          court_location = nullif(trim(coalesce(p_court_location, '')), '')
      where id = p_challenge_id;
    else
      update public.challenges
      set status = 'declined', responded_at = now(), completed_at = now()
      where id = p_challenge_id;

      update public.ladder_entries
      set status = 'available', updated_at = now()
      where player_id in (v_challenger_id, v_defender_id);
    end if;
  elsif p_action = 'schedule' then
    if p_actor_profile_id not in (v_challenger_profile_id, v_defender_profile_id) and not v_actor_is_admin then
      raise exception 'Only a challenge participant or admin may schedule the match';
    end if;
    if v_status not in ('accepted', 'scheduled') then
      raise exception 'Challenge must be accepted before it can be scheduled';
    end if;
    if p_scheduled_for is null then
      raise exception 'A scheduled time is required';
    end if;

    update public.challenges
    set status = 'scheduled',
        scheduled_for = p_scheduled_for,
        court_location = nullif(trim(coalesce(p_court_location, '')), '')
    where id = p_challenge_id;
  else
    raise exception 'Unsupported challenge action';
  end if;

  insert into public.audit_logs (actor_profile_id, action_type, target_type, target_id, metadata)
  values (
    p_actor_profile_id,
    'challenge_' || p_action,
    'challenge',
    p_challenge_id::text,
    jsonb_build_object('scheduled_for', p_scheduled_for, 'court_location', p_court_location)
  );
end;
$$;

create or replace function public.submit_ladder_match(
  p_actor_profile_id uuid,
  p_challenge_id uuid,
  p_winner_player_id uuid,
  p_score_summary text
) returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_match_id uuid;
  v_challenger_id uuid;
  v_defender_id uuid;
  v_challenger_profile_id uuid;
  v_defender_profile_id uuid;
  v_status text;
  v_actor_is_admin boolean;
begin
  if nullif(trim(coalesce(p_score_summary, '')), '') is null then
    raise exception 'Score summary is required';
  end if;

  select c.challenger_id, c.defender_id, c.status, cp.profile_id, dp.profile_id
    into v_challenger_id, v_defender_id, v_status, v_challenger_profile_id, v_defender_profile_id
  from public.challenges c
  join public.players cp on cp.id = c.challenger_id
  join public.players dp on dp.id = c.defender_id
  where c.id = p_challenge_id
  for update of c;

  if v_status is null then
    raise exception 'Challenge not found';
  end if;

  if v_status not in ('accepted', 'scheduled', 'played') then
    raise exception 'Challenge is not ready for score submission';
  end if;

  if p_winner_player_id not in (v_challenger_id, v_defender_id) then
    raise exception 'Winner must be one of the challenge players';
  end if;

  select exists (
    select 1 from public.profiles where id = p_actor_profile_id and role = 'admin'
  ) into v_actor_is_admin;

  if p_actor_profile_id not in (v_challenger_profile_id, v_defender_profile_id) and not v_actor_is_admin then
    raise exception 'Only a challenge participant or admin may submit this score';
  end if;

  if exists (select 1 from public.challenge_matches where challenge_id = p_challenge_id) then
    raise exception 'A score has already been submitted for this challenge';
  end if;

  insert into public.challenge_matches (
    challenge_id, score_summary, winner_id, approval_status, submitted_by_profile_id
  ) values (
    p_challenge_id, trim(p_score_summary), p_winner_player_id, 'pending', p_actor_profile_id
  ) returning id into v_match_id;

  update public.challenges
  set status = 'pending_coach_approval'
  where id = p_challenge_id;

  insert into public.audit_logs (actor_profile_id, action_type, target_type, target_id, metadata)
  values (
    p_actor_profile_id,
    'submit_match_score',
    'challenge_match',
    v_match_id::text,
    jsonb_build_object('challenge_id', p_challenge_id, 'winner_id', p_winner_player_id)
  );

  return v_match_id;
end;
$$;

create or replace function public.reject_challenge_match(
  p_match_id uuid,
  p_coach_profile_id uuid,
  p_reason text default null
) returns void
language plpgsql
set search_path = public
as $$
declare
  v_challenge_id uuid;
  v_challenger_id uuid;
  v_defender_id uuid;
begin
  if not exists (
    select 1 from public.profiles where id = p_coach_profile_id and role = 'admin'
  ) then
    raise exception 'Coach/admin profile required';
  end if;

  select cm.challenge_id, c.challenger_id, c.defender_id
    into v_challenge_id, v_challenger_id, v_defender_id
  from public.challenge_matches cm
  join public.challenges c on c.id = cm.challenge_id
  where cm.id = p_match_id and cm.approval_status = 'pending'
  for update of cm, c;

  if v_challenge_id is null then
    raise exception 'Pending challenge match not found';
  end if;

  update public.challenge_matches
  set approval_status = 'rejected',
      verified_by_profile_id = p_coach_profile_id,
      verified_at = now()
  where id = p_match_id;

  update public.challenges
  set status = 'rejected', completed_at = now()
  where id = v_challenge_id;

  update public.ladder_entries
  set status = 'available', updated_at = now()
  where player_id in (v_challenger_id, v_defender_id);

  insert into public.audit_logs (actor_profile_id, action_type, target_type, target_id, reason)
  values (p_coach_profile_id, 'reject_challenge_match', 'challenge_match', p_match_id::text, p_reason);
end;
$$;

revoke all on function public.respond_ladder_challenge(uuid, uuid, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.submit_ladder_match(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.reject_challenge_match(uuid, uuid, text) from public, anon, authenticated;

grant execute on function public.respond_ladder_challenge(uuid, uuid, text, timestamptz, text) to service_role;
grant execute on function public.submit_ladder_match(uuid, uuid, uuid, text) to service_role;
grant execute on function public.reject_challenge_match(uuid, uuid, text) to service_role;
