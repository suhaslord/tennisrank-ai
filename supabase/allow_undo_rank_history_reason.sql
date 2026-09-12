-- Allow safe Coach Ops undo actions to record the rank reversal in rank_history.
alter table public.rank_history
  drop constraint if exists rank_history_reason_check;

alter table public.rank_history
  add constraint rank_history_reason_check
  check (reason = any (array[
    'challenge'::text,
    'manual'::text,
    'injury_restore'::text,
    'import'::text,
    'undo'::text
  ]));
