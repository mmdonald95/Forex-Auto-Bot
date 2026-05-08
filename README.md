# Forex Auto Bot

Forex Auto Bot is a Node.js web app for connecting to a FOREX.com account, viewing account data, displaying live prices/candlestick charts, saving bot settings to Supabase, and running demo-mode trading strategy simulations.

## Features

- FOREX.com sign-in through a local Node backend
- Account value from FOREX.com margin data
- Live price snapshots from FOREX.com
- Candlestick chart UI using FOREX.com OHLC bar history
- Supabase profile, bot settings, broker connection, and trade log storage
- Demo-mode moving-average strategy engine
- Top-15 forex pair scan in simulation mode
- Reward-to-risk rule before simulated signals are logged

## Important Safety Note

This project is not financial advice and does not guarantee profit. Forex trading is risky and can lose money. Live order placement should stay disabled until the app has been tested in demo mode, reviewed for compliance/security, and given proper risk controls.

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
6. Use the dashboard to view account value, prices, candles, bot settings, and demo bot decisions.

## Supabase Tables

The app expects these tables:

- `profiles`
- `broker_connections`
- `bot_settings`
- `trade_logs`

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
- Demo trade logs

Simulation only:

- Bot decisions
- Top-15 scan decisions
- Trade placement

Live FOREX.com order placement is not enabled yet.

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
- Add demo P/L tracking
- Add live order placement only after demo-mode testing is reliable
