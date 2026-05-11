create table if not exists public.account_snapshots (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  broker text not null,
  client_account_id text not null,
  trading_account_id text,
  currency text,
  balance_value numeric,
  balance_key text,
  source text,
  raw_margin jsonb,
  raw_account jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (broker, client_account_id)
);

alter table public.account_snapshots enable row level security;

drop policy if exists "Service role can manage account snapshots" on public.account_snapshots;
create policy "Service role can manage account snapshots"
on public.account_snapshots
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists "Anon can read account snapshots" on public.account_snapshots;
create policy "Anon can read account snapshots"
on public.account_snapshots
for select
using (true);
