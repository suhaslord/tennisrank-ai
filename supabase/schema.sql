-- Run this once in the Supabase SQL Editor.
create table if not exists public.tennis_records (
  record_key text primary key,
  raw_data jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists tennis_records_updated_at_idx
  on public.tennis_records (updated_at);

-- The table is accessed only by the Vercel API using the service-role key.
-- No public read/write policy is created intentionally.
alter table public.tennis_records enable row level security;
