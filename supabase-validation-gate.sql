create table if not exists public.strategy_validations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete cascade,
  strategy_id text not null,
  strategy_name text,
  backtest_passed boolean not null default false,
  out_of_sample_passed boolean not null default false,
  walk_forward_passed boolean not null default false,
  stress_test_passed boolean not null default false,
  paper_trading_passed boolean not null default false,
  risk_disclosure_accepted boolean not null default false,
  expectancy numeric,
  profit_factor numeric,
  max_drawdown_pct numeric,
  total_trades integer,
  paper_trading_days integer,
  report jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists strategy_validations_profile_strategy_idx
on public.strategy_validations (profile_id, strategy_id, updated_at desc);
