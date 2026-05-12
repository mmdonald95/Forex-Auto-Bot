alter table public.bot_settings
add column if not exists max_daily_loss_usd numeric;
