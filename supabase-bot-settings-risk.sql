alter table public.bot_settings
add column if not exists max_daily_loss_usd numeric;

alter table public.bot_settings
add column if not exists daily_profit_goal_usd numeric;
