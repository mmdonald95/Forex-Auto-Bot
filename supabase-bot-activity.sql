create table if not exists public.bot_activity (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  title text not null,
  message text not null,
  level text not null default 'info',
  details jsonb,
  created_at timestamptz not null default now()
);

create index if not exists bot_activity_created_at_idx
on public.bot_activity (created_at desc);

alter table public.bot_activity enable row level security;

drop policy if exists "Service role can manage bot activity" on public.bot_activity;
create policy "Service role can manage bot activity"
on public.bot_activity
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists "Anon can read bot activity" on public.bot_activity;
create policy "Anon can read bot activity"
on public.bot_activity
for select
using (true);

alter table public.bot_settings
add column if not exists auto_execution_authorized boolean default false;

alter table public.bot_settings
add column if not exists bot_enabled boolean default false;

alter table public.bot_settings
add column if not exists updated_at timestamptz default now();
