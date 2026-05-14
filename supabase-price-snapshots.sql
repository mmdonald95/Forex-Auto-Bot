create table if not exists public.price_snapshots (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  broker text not null,
  market_id text not null,
  market_name text not null,
  bid numeric,
  offer numeric,
  mid numeric,
  spread numeric,
  audit_id text,
  tick_date text,
  source text,
  raw_price jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (broker, market_id)
);

create index if not exists price_snapshots_broker_updated_idx
  on public.price_snapshots (broker, updated_at desc);

alter table public.price_snapshots enable row level security;

drop policy if exists "Service role can manage price snapshots" on public.price_snapshots;
create policy "Service role can manage price snapshots"
  on public.price_snapshots
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "Anon can read price snapshots" on public.price_snapshots;
create policy "Anon can read price snapshots"
  on public.price_snapshots
  for select
  using (true);
