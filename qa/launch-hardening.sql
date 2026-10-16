-- Execute after launch_hardening.sql inside a transaction, then ROLLBACK.
-- Fixtures use existing account IDs and are never committed.
do $$
declare
  coach uuid; account uuid; defender uuid; challenger uuid; challenge uuid; match uuid;
  snapshot uuid; restored uuid; blocked boolean; seeded integer; proposed jsonb;
begin
  select id into coach from public.profiles where role='admin' order by created_at limit 1;
  select id into account from public.profiles where id<>coach order by created_at limit 1;
  update public.profiles set role='player',player_name='QA Challenger' where id=account;
  if coach is null or account is null then raise exception 'Regression requires existing coach and player accounts'; end if;
  perform public.admin_clear_import_checked(coach);
  perform public.admin_seed_ladder(coach,'boys','[{"name":"QA Defender"},{"name":"QA Challenger"}]');
  select id into defender from public.players where display_name='QA Defender';
  select id into challenger from public.players where display_name='QA Challenger';
  update public.players set profile_id=null where profile_id=account;
  update public.players set profile_id=account where id=challenger;
  proposed:=jsonb_build_array(now()+interval '1 day');
  challenge:=public.create_ladder_challenge(account,defender,proposed);
  update public.challenges set created_at=now()-interval '49 hours' where id=challenge;
  update public.players set active_status='injured' where id=defender;
  update public.ladder_entries set status='injury_hold' where player_id=defender;
  if public.expire_ladder_challenges()<>1 then raise exception 'Response deadline did not expire'; end if;
  if (select status from public.challenges where id=challenge)<>'expired' then raise exception 'Expired challenge stayed open'; end if;
  if (select status from public.ladder_entries where player_id=challenger)<>'available' then raise exception 'Expiration did not release challenger'; end if;
  if (select status from public.ladder_entries where player_id=defender)<>'injury_hold' then raise exception 'Expiration erased injury hold'; end if;
  update public.players set active_status='active' where id=defender;
  update public.ladder_entries set status='available' where player_id=defender;
  challenge:=public.create_ladder_challenge(account,defender,proposed);
  -- A player cannot accept an unlinked opponent's challenge by exploiting NULL comparisons.
  blocked:=false;
  begin perform public.respond_ladder_challenge(account,challenge,'accept',null,null);
  exception when others then blocked:=true; end;
  if not blocked then raise exception 'Unlinked defender authorization was bypassed'; end if;
  perform public.respond_ladder_challenge(coach,challenge,'accept',null,null);
  match:=public.submit_ladder_match(account,challenge,challenger,'6-2 6-3');
  perform public.admin_seed_ladder(coach,'boys','[{"name":"QA Challenger"},{"name":"QA Defender"}]');
  if (select approval_status from public.challenge_matches where id=match)<>'rejected' then raise exception 'Roster refresh retained a pending score'; end if;
  blocked:=false;
  begin perform public.verify_challenge_match(match,coach);
  exception when others then blocked:=true; end;
  if not blocked then raise exception 'Cancelled challenge was approved'; end if;
  -- Independently verify the approval guard, even against a legacy inconsistent score.
  update public.challenge_matches set approval_status='pending' where id=match;
  blocked:=false;
  begin perform public.verify_challenge_match(match,coach);
  exception when others then blocked:=sqlerrm='Challenge is no longer awaiting approval'; end;
  if not blocked then raise exception 'Approval did not recheck challenge status'; end if;
  update public.challenge_matches set approval_status='rejected' where id=match;
  perform public.admin_seed_ladder(coach,'boys','[{"name":"QA Defender"},{"name":"QA Challenger"}]');
  challenge:=public.create_ladder_challenge(account,defender,proposed);
  perform public.respond_ladder_challenge(coach,challenge,'accept',null,null);
  match:=public.submit_ladder_match(account,challenge,challenger,'6-2 6-3');
  update public.challenges set created_at=now()-interval '200 hours' where id=challenge;
  if public.expire_ladder_challenges()<>0 then raise exception 'Coach approval wait incorrectly expired a played match'; end if;
  update public.players set active_status='injured' where id=defender;
  update public.ladder_entries set status='injury_hold' where player_id=defender;
  perform public.verify_challenge_match(match,coach);
  if (select rank_position from public.ladder_entries where player_id=challenger)<>1 then raise exception 'Valid approval failed to move challenger'; end if;
  if (select status from public.ladder_entries where player_id=defender)<>'injury_hold' then raise exception 'Approval erased injury hold'; end if;
  -- Manually seeded ladders with no imported rows must still be restorable.
  snapshot:=public.admin_clear_import_checked(coach);
  if snapshot is null then raise exception 'Ladder-only reset has no recovery snapshot'; end if;
  if exists(select 1 from public.ladder_entries) then raise exception 'Reset left official rankings'; end if;
  if exists(select 1 from public.players where active_status<>'inactive') then raise exception 'Reset left demo players active'; end if;
  perform public.admin_seed_ladder(coach,'girls','[{"name":"QA Girls Player"}]');
  restored:=public.admin_restore_import_snapshot_checked(coach,snapshot);
  if restored is null then raise exception 'Ladder-only restore failed'; end if;
  if (select count(*) from public.ladder_entries where team_gender='boys')<>2 then raise exception 'Boys ladder was not restored'; end if;
  if exists(select 1 from public.ladder_entries where team_gender='girls') then raise exception 'Empty girls snapshot did not clear girls ladder'; end if;
  if (select profile_id from public.players where id=challenger) is distinct from account then raise exception 'Account link changed during restore'; end if;
  if (select status from public.ladder_entries where player_id=defender)<>'injury_hold' then raise exception 'Restore lost saved injury state'; end if;
  -- Verify supported 101-player rosters are complete in the actual database.
  select public.admin_seed_ladder(coach,'boys',jsonb_agg(jsonb_build_object('name','QA Player '||n) order by n)) into seeded from generate_series(1,101) n;
  if seeded<>101 or (select count(*) from public.ladder_entries where team_gender='boys')<>101 then raise exception 'Roster truncated'; end if;
  -- Reset/restore preserves all imported sources, not only the latest one.
  insert into public.tennis_records(record_key,source_key,raw_data,row_index,updated_at) values
    ('qa-source-one','qa-one','{"name":"QA Player 1"}',1,now()-interval '1 day'),
    ('qa-source-two','qa-two','{"name":"QA Player 2"}',1,now());
  snapshot:=public.admin_clear_import_checked(coach);
  perform public.admin_restore_import_snapshot_checked(coach,snapshot);
  if (select count(*) from public.tennis_records where source_key in ('qa-one','qa-two'))<>2 then raise exception 'Reset recovery lost an imported source'; end if;
  -- Function ACLs must remain private.
  if has_function_privilege('anon','public.admin_clear_import(uuid)','execute')
     or has_function_privilege('authenticated','public.expire_ladder_challenges()','execute')
     or not has_function_privilege('service_role','public.verify_challenge_match(uuid,uuid)','execute') then raise exception 'Function privileges changed'; end if;
end;
$$;
select 'Database regressions passed; fixtures rolled back' as result;
