create table if not exists public.account_reconciliations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  broker text not null,
  client_account_id text not null,
  trading_account_id text,
  realized_profit_loss numeric not null default 0,
  open_profit_loss numeric not null default 0,
  total_profit_loss numeric not null default 0,
  open_position_count integer not null default 0,
  active_order_count integer not null default 0,
  trade_history_count integer not null default 0,
  raw_positions jsonb not null default '[]'::jsonb,
  raw_active_orders jsonb not null default '[]'::jsonb,
  raw_trade_history jsonb not null default '[]'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (broker, client_account_id)
);

create index if not exists account_reconciliations_broker_updated_idx
  on public.account_reconciliations (broker, updated_at desc);

alter table public.account_reconciliations enable row level security;

drop policy if exists "Service role can manage account reconciliations" on public.account_reconciliations;
create policy "Service role can manage account reconciliations"
  on public.account_reconciliations
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "Anon can read account reconciliations" on public.account_reconciliations;
create policy "Anon can read account reconciliations"
  on public.account_reconciliations
  for select
  using (true);
