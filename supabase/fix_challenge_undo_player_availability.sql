-- Applied to production after coach_ops_import_history_and_ladder_undo.
-- When undoing an approved challenge result, the pre-verification snapshot can
-- contain challenge_pending ladder statuses. The challenge and match are
-- rejected by the undo, so both participants must be released back to available.

create or replace function public.admin_undo_ladder_snapshot(
  p_coach_profile_id uuid,
  p_snapshot_id uuid
) returns void
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
  if not exists (select 1 from public.profiles where id = p_coach_profile_id and role = 'admin') then
    raise exception 'Coach/admin profile required';
  end if;
  select * into v_snapshot from public.ladder_snapshots where id = p_snapshot_id for update;
  if not found then raise exception 'Ladder snapshot not found'; end if;
  if v_snapshot.restored_at is not null then raise exception 'This ladder change was already undone'; end if;
  if v_snapshot.reason = 'import_sync' then raise exception 'Use import history restore for imported ladder changes'; end if;
  if exists(select 1 from public.ladder_snapshots where team_gender = v_snapshot.team_gender and created_at > v_snapshot.created_at) then
    raise exception 'Only the most recent ladder change can be undone safely';
  end if;

  set constraints ladder_entries_gender_rank_unique deferred;
  update public.ladder_entries set rank_position = rank_position + 10000, updated_at = now() where team_gender = v_snapshot.team_gender;

  for v_item in select value from jsonb_array_elements(v_snapshot.entries)
  loop
    v_player_id := (v_item->>'player_id')::uuid;
    v_target_rank := (v_item->>'rank_position')::integer;
    select rank_position - 10000 into v_old_rank from public.ladder_entries where player_id = v_player_id;

    insert into public.ladder_entries(player_id, team_gender, rank_position, previous_rank_position, status, updated_at)
    values(
      v_player_id,
      v_snapshot.team_gender,
      v_target_rank,
      nullif(v_item->>'previous_rank_position','')::integer,
      coalesce(nullif(v_item->>'status',''),'available'),
      now()
    )
    on conflict (player_id) do update set
      team_gender = excluded.team_gender,
      previous_rank_position = case when v_old_rank is null then public.ladder_entries.previous_rank_position else v_old_rank end,
      rank_position = excluded.rank_position,
      status = excluded.status,
      updated_at = now();

    if v_old_rank is not null and v_old_rank <> v_target_rank then
      insert into public.rank_history(player_id, old_rank, new_rank, reason, changed_by_profile_id)
      values(v_player_id, v_old_rank, v_target_rank, 'undo', p_coach_profile_id);
    end if;
  end loop;

  delete from public.ladder_entries le
  where le.team_gender = v_snapshot.team_gender
    and not exists (
      select 1 from jsonb_array_elements(v_snapshot.entries) item
      where (item->>'player_id')::uuid = le.player_id
    );

  if v_snapshot.reason = 'challenge_verify' and v_snapshot.reference_type = 'challenge_match' and v_snapshot.reference_id is not null then
    update public.challenge_matches
      set approval_status = 'rejected', verified_by_profile_id = p_coach_profile_id, verified_at = now()
      where id = v_snapshot.reference_id::uuid;
    update public.challenges c
      set status = 'rejected', completed_at = now()
      from public.challenge_matches cm
      where cm.id = v_snapshot.reference_id::uuid and c.id = cm.challenge_id;
    update public.ladder_entries le
      set status = 'available', updated_at = now()
      from public.challenge_matches cm
      join public.challenges c on c.id = cm.challenge_id
      where cm.id = v_snapshot.reference_id::uuid
        and le.player_id in (c.challenger_id, c.defender_id);
  end if;

  update public.ladder_snapshots
  set restored_at = now(), restored_by_profile_id = p_coach_profile_id
  where id = p_snapshot_id;

  insert into public.audit_logs(actor_profile_id, action_type, target_type, target_id, metadata)
  values(
    p_coach_profile_id,
    'undo_ladder_change',
    'ladder_snapshot',
    p_snapshot_id::text,
    jsonb_build_object(
      'team_gender', v_snapshot.team_gender,
      'reason', v_snapshot.reason,
      'reference_type', v_snapshot.reference_type,
      'reference_id', v_snapshot.reference_id
    )
  );
end;
$$;

revoke all on function public.admin_undo_ladder_snapshot(uuid,uuid) from public, anon, authenticated;
grant execute on function public.admin_undo_ladder_snapshot(uuid,uuid) to service_role;
