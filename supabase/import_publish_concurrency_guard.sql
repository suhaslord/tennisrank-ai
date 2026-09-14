-- Serialize coach import mutations and reject publishes based on a stale preview.
-- The checked wrappers preserve the existing RPCs for compatibility while making
-- every API-driven publish/restore/clear share one transaction-scoped lock.

create or replace function public.admin_publish_import_checked(
  p_coach_profile_id uuid,
  p_source_key text,
  p_source_label text,
  p_rows jsonb,
  p_content_hash text,
  p_summary jsonb default '{}'::jsonb,
  p_restored_from_snapshot_id uuid default null,
  p_expected_latest_snapshot_id uuid default null
) returns uuid
language plpgsql
set search_path to 'public'
as $$
declare
  v_latest_snapshot_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('tennisrank_import_mutation'));

  select id
  into v_latest_snapshot_id
  from public.import_snapshots
  order by created_at desc, id desc
  limit 1;

  if v_latest_snapshot_id is distinct from p_expected_latest_snapshot_id then
    raise exception 'Live team data changed since this preview. Preview the latest board again before publishing.';
  end if;

  return public.admin_publish_import(
    p_coach_profile_id,
    p_source_key,
    p_source_label,
    p_rows,
    p_content_hash,
    p_summary,
    p_restored_from_snapshot_id
  );
end;
$$;

create or replace function public.admin_restore_import_snapshot_checked(
  p_coach_profile_id uuid,
  p_snapshot_id uuid
) returns uuid
language plpgsql
set search_path to 'public'
as $$
begin
  perform pg_advisory_xact_lock(hashtext('tennisrank_import_mutation'));
  return public.admin_restore_import_snapshot(p_coach_profile_id, p_snapshot_id);
end;
$$;

create or replace function public.admin_clear_import_checked(
  p_coach_profile_id uuid
) returns uuid
language plpgsql
set search_path to 'public'
as $$
begin
  perform pg_advisory_xact_lock(hashtext('tennisrank_import_mutation'));
  return public.admin_clear_import(p_coach_profile_id);
end;
$$;

revoke all on function public.admin_publish_import_checked(uuid,text,text,jsonb,text,jsonb,uuid,uuid) from public, anon, authenticated;
revoke all on function public.admin_restore_import_snapshot_checked(uuid,uuid) from public, anon, authenticated;
revoke all on function public.admin_clear_import_checked(uuid) from public, anon, authenticated;

grant execute on function public.admin_publish_import_checked(uuid,text,text,jsonb,text,jsonb,uuid,uuid) to service_role;
grant execute on function public.admin_restore_import_snapshot_checked(uuid,uuid) to service_role;
grant execute on function public.admin_clear_import_checked(uuid) to service_role;
