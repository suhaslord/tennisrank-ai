-- Performance indexes added after the live Supabase advisor audit.
-- Existing unused-index notices on the empty ladder tables are intentionally ignored until real traffic exists.

create index if not exists audit_logs_actor_profile_idx
  on public.audit_logs(actor_profile_id);

create index if not exists challenge_matches_submitted_profile_idx
  on public.challenge_matches(submitted_by_profile_id);

create index if not exists challenge_matches_verified_profile_idx
  on public.challenge_matches(verified_by_profile_id);

create index if not exists challenge_matches_winner_idx
  on public.challenge_matches(winner_id);

create index if not exists rank_history_challenge_match_idx
  on public.rank_history(challenge_match_id);

create index if not exists rank_history_changed_profile_idx
  on public.rank_history(changed_by_profile_id);
