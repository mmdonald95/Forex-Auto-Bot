# Forex Auto Bot

Forex Auto Bot is a Node.js web app for connecting to a FOREX.com account, viewing account data, displaying live prices/candlestick charts, saving bot settings to Supabase, analyzing strategy signals, and executing controlled live trades when the backend is explicitly armed.

## Features

- FOREX.com sign-in through a local Node backend
- Account value from FOREX.com margin data
- Live price snapshots from FOREX.com
- Candlestick chart UI using FOREX.com OHLC bar history
- Supabase profile, bot settings, broker connection, and trade log storage
- Moving-average strategy engine
- Top-15 forex pair scan
- Reward-to-risk rule before simulated signals are logged
- Always-on engine worker for persistent FOREX.com streaming outside Vercel

## Important Safety Note

This project is not financial advice and does not guarantee profit. Forex trading is risky and can lose money. Live order placement should stay disabled until the strategy, security, and risk controls have been validated.

## Local Setup

Install dependencies:

```powershell
npm install
```

Create a local `.env` file using `.env.example` as a template.

Required environment variables:

```env
PORT=3000
FOREXCOM_API_BASE=https://ciapi.cityindex.com/TradingAPI
FOREXCOM_STREAMING_BASE=https://push.cityindex.com
FOREXCOM_APP_VERSION=1
FOREXCOM_APP_COMMENTS=Forex Auto Bot local prototype
FOREXCOM_APP_KEY=your-forexcom-app-key

SUPABASE_REST_URL=https://your-project.supabase.co/rest/v1/
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

DEFAULT_PROFILE_NAME=Marcello Gambino
DEFAULT_PROFILE_EMAIL=marcello@example.com
```

Run locally:

```powershell
npm start
```

Open:

```text
http://localhost:3000
```

## App Flow

1. Open the landing page.
2. Click **Sign In**.
3. Enter FOREX.com username and password.
4. Leave AppKey blank if it is saved in `.env`.
5. After connection, the app redirects to the dashboard.
6. Use the dashboard to view account value, prices, candles, bot settings, strategy decisions, and live execution controls.

## Supabase Tables

The app expects these tables:

- `profiles`
- `broker_connections`
- `bot_settings`
- `trade_logs`
- `account_snapshots`
- `strategy_validations`

Run `supabase-account-snapshots.sql` in the Supabase SQL editor to add the account snapshot table used by the always-on engine.
Run `supabase-validation-gate.sql` to add the strategy validation gate used before live trading.

## Trading Safety Architecture

Live trading is locked by default. The intended flow is:

1. Market data updates.
2. Strategy Engine generates a signal only.
3. Validation Gate confirms backtest, out-of-sample, walk-forward, stress test, paper trading, and risk disclosure are complete.
4. Risk Manager approves or rejects the trade.
5. Order Manager sends the order only after approval.
6. Broker confirmation and Trade Journal record the event.

The Strategy Engine cannot bypass the Risk Manager. Trades without stop losses, excessive spread, excessive risk, validation failures, loss-limit breaches, or unstable data/broker conditions are rejected and logged.

## What Is Live vs Simulated

Live from FOREX.com:

- Account connection/session
- Account value/margin data
- Market lookup
- Live prices
- Candlestick history

Stored in Supabase:

- User/profile record
- Broker connection metadata
- Bot settings
- Trade logs

Analysis only unless live trading is explicitly armed:

- Bot decisions
- Top-15 scan decisions
- Trade placement

Live FOREX.com order placement is available only when the backend explicitly enables it with `ENABLE_LIVE_TRADING=true`. Keep it disabled until the strategy and risk controls are reliable.

## Always-On Trading Engine

Vercel is good for the public website, but FOREX.com Lightstreamer account value streams need a persistent Node process. Use `engine-worker.js` for that process.

Run it locally:

```powershell
npm run engine
```

Recommended production setup:

1. Keep the website on Vercel.
2. Run `npm run engine` on an always-on host such as Railway, Render background worker, Fly.io, DigitalOcean, or a VPS.
3. Add the same Supabase and FOREX.com environment variables to that host.
4. Add `FOREXCOM_USERNAME` and `FOREXCOM_PASSWORD` only on the always-on engine host if you want the engine to log in by itself.
5. Leave live order placement disabled until strategy behavior and risk controls are validated.

The engine writes the latest `CLIENTACCOUNTMARGIN` balance into Supabase `account_snapshots`. The Vercel dashboard can read that table when Vercel cannot maintain the live Lightstreamer connection itself.

## Live Trade Execution

Live execution is locked by default. To unlock it on an always-on backend, set:

```env
ENABLE_LIVE_TRADING=true
LIVE_TRADING_CONFIRM_TEXT=I UNDERSTAND LIVE TRADING CAN LOSE MONEY
MAX_LIVE_TRADE_QUANTITY=1000
MAX_DAILY_LIVE_TRADES=1
MAX_OPEN_POSITIONS=1
```

The live endpoint:

- Runs the strategy first
- Requires BUY or SELL, never HOLD
- Requires reward:risk of at least 2:1
- Caps risk per trade at 1% in live mode
- Checks the daily live trade limit
- Checks the open position limit
- Sends a FOREX.com market order with attached stop and take-profit limit
- Logs the live order in Supabase `trade_logs`

The official StoneX/CityIndex docs show market trades are sent to `POST /TradingAPI/order/newtradeorder`, and that new trades can include attached conditional closing stop and limit orders.

## Files Not To Commit

Do not commit:

```text
.env
node_modules/
logs/
```

These are already listed in `.gitignore`.

## Next Development Steps

- Verify live prices and candlestick charts across the top 15 pairs
- Use real candle history for all strategy calculations
- Add stronger risk controls and correlation limits
- Add live order reconciliation against FOREX.com fills
- Add live order placement only after strategy behavior is reliable

## Vercel Deployment

This project includes `vercel.json` so Vercel routes traffic through `server.js`.

Add these environment variables in Vercel before deploying:

```env
FOREXCOM_API_BASE=https://ciapi.cityindex.com/TradingAPI
FOREXCOM_STREAMING_BASE=https://push.cityindex.com
FOREXCOM_APP_VERSION=1
FOREXCOM_APP_COMMENTS=Forex Auto Bot
FOREXCOM_APP_KEY=your-forexcom-app-key

SUPABASE_REST_URL=https://your-project.supabase.co/rest/v1/
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

DEFAULT_PROFILE_NAME=Marcello Gambino
DEFAULT_PROFILE_EMAIL=marcello@example.com
```

Vercel is suitable for the website and dashboard prototype. A real always-on trading bot should later run on a persistent backend or VPS because Vercel serverless functions are not designed to hold broker sessions and streams continuously.

Use Vercel for:

- Landing page
- Sign in page
- Dashboard UI
- Supabase reads/writes

Use the always-on engine for:

- FOREX.com Lightstreamer account value stream
- Continuous price/strategy monitoring
- Future live order execution, after risk controls and testing
