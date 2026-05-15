const path = require("node:path");
const crypto = require("node:crypto");

const root = __dirname;
loadEnv(path.join(root, ".env"));
installWebSocketRuntime();

const apiBase = (process.env.FOREXCOM_API_BASE || "https://ciapi.cityindex.com/TradingAPI").replace(/\/$/, "");
const streamingBase = (process.env.FOREXCOM_STREAMING_BASE || "https://push.cityindex.com").replace(/\/$/, "");
const appVersion = process.env.FOREXCOM_APP_VERSION || "1";
const appComments = process.env.FOREXCOM_APP_COMMENTS || "Forex Auto Bot engine";
const forexComAppKey = process.env.FOREXCOM_APP_KEY || "";
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const engineUsername = process.env.FOREXCOM_USERNAME || "";
const enginePassword = process.env.FOREXCOM_PASSWORD || "";
const retryMs = Number(process.env.ENGINE_RETRY_MS || 30000);
const botScanMs = Number(process.env.BOT_SCAN_MS || 60000);
const enableLiveTrading = envBool(process.env.ENABLE_LIVE_TRADING);
const appBaseUrl = (process.env.APP_BASE_URL || process.env.PUBLIC_APP_URL || "https://forex-auto-bot.vercel.app").replace(/\/$/, "");
const priceSnapshotMinIntervalMs = Number(process.env.PRICE_SNAPSHOT_MIN_INTERVAL_MS || 5000);
const defaultPriceMarkets = (process.env.PRICE_STREAM_MARKETS || [
  "EUR/USD",
  "GBP/USD",
  "USD/JPY",
  "USD/CHF",
  "AUD/USD",
  "USD/CAD",
  "NZD/USD",
  "EUR/JPY",
  "GBP/JPY",
  "EUR/GBP",
  "EUR/AUD",
  "AUD/JPY",
  "CAD/JPY",
  "GBP/CAD",
  "GBP/AUD",
].join(","))
  .split(",")
  .map((market) => market.trim())
  .filter(Boolean)
  .slice(0, 15);

let supabaseAdminClient;
let lastActivityTitle = "";
let lastActivityAt = 0;

function loadEnv(filePath) {
  const fs = require("node:fs");
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function installWebSocketRuntime() {
  if (typeof globalThis.WebSocket !== "undefined") {
    return;
  }

  try {
    globalThis.WebSocket = require("ws");
  } catch (error) {
    log("websocket-polyfill-error", { error: error.message });
  }
}

function log(event, payload = {}) {
  console.log(JSON.stringify({
    at: new Date().toISOString(),
    event,
    ...payload,
  }));
}

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = data.Message || data.ErrorMessage || response.statusText;
    throw new Error(`FOREX.com API error ${response.status}: ${message}`);
  }

  return data;
}

async function getJson(url, headers = {}) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...headers,
    },
  });

  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error(`Expected JSON from ${url}, got ${response.status} ${response.statusText}.`);
  }

  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = data.Message || data.ErrorMessage || response.statusText;
    throw new Error(`FOREX.com API error ${response.status}: ${message}`);
  }

  return data;
}

async function getSupabaseAdmin() {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for the engine worker.");
  }

  if (!supabaseAdminClient) {
    const { createClient } = await import("@supabase/supabase-js");
    supabaseAdminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  return supabaseAdminClient;
}

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function parseBrokerNumber(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const number = Number(String(value).replace(/[$,\s]/g, ""));
  return Number.isFinite(number) ? number : null;
}

function envBool(value) {
  return ["true", "1", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function findTradingAccounts(account) {
  const directCandidates = [
    account.TradingAccounts,
    account.tradingAccounts,
    account.ClientTradingAccounts,
    account.clientTradingAccounts,
    account.Accounts,
    account.accounts,
  ];

  for (const candidate of directCandidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  for (const value of Object.values(account || {})) {
    if (value && typeof value === "object") {
      const nested = findTradingAccounts(value);
      if (nested.length) {
        return nested;
      }
    }
  }

  return [];
}

function safeAccountSummary(account) {
  const tradingAccounts = findTradingAccounts(account);
  const clientAccounts = Array.isArray(account.clientAccounts)
    ? account.clientAccounts
    : Array.isArray(account.ClientAccounts)
      ? account.ClientAccounts
      : [];
  const firstClientAccount = clientAccounts[0] || {};
  const firstTradingAccount = tradingAccounts[0] || {};

  return {
    logonUserName: firstPresent(account.LogonUserName, account.logonUserName, account.UserName, account.userName),
    clientAccountCurrency: firstPresent(account.ClientAccountCurrency, account.clientAccountCurrency, firstClientAccount.clientAccountCurrency, firstClientAccount.ClientAccountCurrency, account.Currency, account.currency),
    clientAccountId: firstPresent(account.ClientAccountId, account.clientAccountId, firstClientAccount.clientAccountId, firstClientAccount.ClientAccountId, account.ClientId, account.clientId, firstTradingAccount.clientAccountId, firstTradingAccount.ClientAccountId),
    cash: firstPresent(account.Cash, account.cash, firstTradingAccount.Cash, firstTradingAccount.cash),
    balance: firstPresent(account.Balance, account.balance, firstTradingAccount.Balance, firstTradingAccount.balance),
    accountValue: firstPresent(account.AccountValue, account.accountValue, firstTradingAccount.AccountValue, firstTradingAccount.accountValue),
    netEquity: firstPresent(account.NetEquity, account.netEquity, firstTradingAccount.NetEquity, firstTradingAccount.netEquity),
    availableToTrade: firstPresent(account.AvailableToTrade, account.availableToTrade, firstTradingAccount.AvailableToTrade, firstTradingAccount.availableToTrade),
    clientAccountBalance: firstPresent(account.ClientAccountBalance, account.clientAccountBalance),
    tradingAccounts: tradingAccounts.map((item) => ({
      tradingAccountId: firstPresent(item.TradingAccountId, item.tradingAccountId, item.AccountId, item.accountId, item.Id, item.id),
      tradingAccountCode: firstPresent(item.TradingAccountCode, item.tradingAccountCode, item.AccountCode, item.accountCode),
      tradingAccountStatus: firstPresent(item.TradingAccountStatus, item.tradingAccountStatus, item.Status, item.status),
      tradingAccountType: firstPresent(item.TradingAccountType, item.tradingAccountType, item.Type, item.type),
      cash: firstPresent(item.Cash, item.cash),
      balance: firstPresent(item.Balance, item.balance),
      accountValue: firstPresent(item.AccountValue, item.accountValue),
      netEquity: firstPresent(item.NetEquity, item.netEquity),
      availableToTrade: firstPresent(item.AvailableToTrade, item.availableToTrade),
    })),
  };
}

function getPrimaryTradingAccount(account) {
  const tradingAccounts = Array.isArray(account?.tradingAccounts) ? account.tradingAccounts : [];
  return tradingAccounts[0] || null;
}

function normaliseMarginUpdate(update) {
  const output = {};
  update.forEachField((fieldName, fieldPosition, value) => {
    output[fieldName] = value;
  });
  return output;
}

function normalisePriceUpdate(update) {
  const output = {};
  update.forEachField((fieldName, fieldPosition, value) => {
    output[fieldName] = value;
  });
  return output;
}

async function findForexMarket(session, marketName) {
  const clientAccountId = session.account?.clientAccountId;
  if (!clientAccountId) {
    throw new Error("Cannot look up market IDs because FOREX.com did not return a clientAccountId.");
  }

  const searchUrl = new URL(`${apiBase}/market/search`);
  searchUrl.searchParams.set("SearchByMarketName", "true");
  searchUrl.searchParams.set("Query", marketName);
  searchUrl.searchParams.set("MaxResults", "10");
  searchUrl.searchParams.set("ClientAccountId", String(clientAccountId));

  const data = await getJson(searchUrl.toString(), {
    UserName: session.username,
    Session: session.sessionToken,
  });
  const markets = data.Markets || data.markets || data.MarketInformation || data.marketInformation || [];
  const normalizedName = marketName.replace(/\s+/g, "").toUpperCase();
  const selected = markets.find((item) => String(item.Name || item.MarketName || "").replace(/\s+/g, "").toUpperCase() === normalizedName)
    || markets.find((item) => String(item.Name || item.MarketName || "").replace(/\s+/g, "").toUpperCase().includes(normalizedName))
    || markets[0];

  if (!selected) {
    throw new Error(`FOREX.com returned no market for ${marketName}.`);
  }

  return {
    marketId: firstPresent(selected.MarketId, selected.marketId, selected.Id, selected.id),
    marketName: firstPresent(selected.Name, selected.MarketName, selected.marketName, marketName),
  };
}

function pickMarginBalance(margin) {
  const candidateKeys = [
    "NetEquity",
    "netEquity",
    "AccountValue",
    "accountValue",
    "Balance",
    "balance",
    "ClientAccountBalance",
    "clientAccountBalance",
    "Cash",
    "cash",
    "TradingResource",
    "tradingResource",
    "TradeableFunds",
    "tradeableFunds",
    "TotalMarginRequirement",
    "totalMarginRequirement",
    "AvailableToTrade",
    "availableToTrade",
    "TradableFunds",
    "tradableFunds",
    "MarginAvailable",
    "marginAvailable",
  ];

  for (const key of candidateKeys) {
    const value = parseBrokerNumber(margin?.[key]);
    if (value !== null) {
      return { key, value };
    }
  }

  return null;
}

async function loginWithEngineCredentials() {
  if (!engineUsername || !enginePassword || !forexComAppKey) {
    return null;
  }

  const session = await postJson(`${apiBase}/session`, {
    UserName: engineUsername,
    Password: enginePassword,
    AppVersion: appVersion,
    AppComments: appComments,
    AppKey: forexComAppKey,
  });
  const sessionToken = session.Session || session.SessionId || session.SessionToken;
  if (!sessionToken) {
    throw new Error("FOREX.com did not return a session token.");
  }

  const accountBase = apiBase.replace(/\/TradingAPI$/i, "");
  const account = await getJson(`${accountBase}/v2/userAccount/ClientAndTradingAccount`, {
    UserName: engineUsername,
    Session: sessionToken,
  });

  return {
    username: engineUsername,
    sessionToken,
    connectedAt: new Date().toISOString(),
    account: safeAccountSummary(account),
  };
}

async function loadLatestSavedSession() {
  const supabase = await getSupabaseAdmin();
  const { data, error } = await supabase
    .from("broker_connections")
    .select("*")
    .eq("broker", "FOREX.com_SESSION")
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    throw error;
  }

  for (const row of data || []) {
    try {
      const payload = JSON.parse(row.app_key_label || "{}");
      if (payload.sessionToken && payload.account) {
        return {
          username: row.forex_username,
          sessionToken: payload.sessionToken,
          connectedAt: row.created_at,
          account: payload.account,
        };
      }
    } catch (error) {
      log("saved-session-parse-error", { error: error.message });
    }
  }

  return null;
}

async function resolveSession() {
  const credentialSession = await loginWithEngineCredentials();
  if (credentialSession) {
    return credentialSession;
  }

  return loadLatestSavedSession();
}

async function getOrCreateProfile() {
  const supabase = await getSupabaseAdmin();
  const email = process.env.DEFAULT_PROFILE_EMAIL || "marcello@example.com";
  const fullName = process.env.DEFAULT_PROFILE_NAME || "Marcello Gambino";
  const { data: existing, error: findError } = await supabase
    .from("profiles")
    .select("*")
    .eq("email", email)
    .maybeSingle();

  if (findError) {
    throw findError;
  }

  if (existing) {
    return existing;
  }

  const { data, error } = await supabase
    .from("profiles")
    .insert({ email, full_name: fullName })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data;
}

async function saveBotActivity(eventType, title, message, level = "info", details = {}) {
  const now = Date.now();
  const fingerprint = `${eventType}:${title}:${message}`;
  if (fingerprint === lastActivityTitle && now - lastActivityAt < 45000) {
    return;
  }
  lastActivityTitle = fingerprint;
  lastActivityAt = now;

  try {
    const supabase = await getSupabaseAdmin();
    const profile = await getOrCreateProfile();
    const { error } = await supabase
      .from("bot_activity")
      .insert({
        profile_id: profile.id,
        event_type: eventType,
        title,
        message,
        level,
        details,
      });

    if (error) {
      throw error;
    }
  } catch (error) {
    log("bot-activity-save-error", { error: error.message, title });
  }
}

async function loadLatestBotSettings() {
  const supabase = await getSupabaseAdmin();
  const { data, error } = await supabase
    .from("bot_settings")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}

function normaliseBotSettings(row = {}) {
  return {
    botEnabled: Boolean(firstPresent(row.bot_enabled, row.botEnabled, false)),
    autoExecutionAuthorized: Boolean(firstPresent(row.auto_execution_authorized, row.autoExecutionAuthorized, false)),
    riskPerTrade: Number(firstPresent(row.risk_per_trade, row.riskPerTrade, 1)),
    dailyStop: Number(firstPresent(row.daily_stop, row.dailyStop, 4)),
    rewardRiskRatio: Number(firstPresent(row.reward_risk_ratio, row.rewardRiskRatio, 2)),
    maxDailyLossUsd: Number(firstPresent(row.max_daily_loss_usd, row.maxDailyLossUsd, 100)),
    dailyProfitGoalUsd: Number(firstPresent(row.daily_profit_goal_usd, row.dailyProfitGoalUsd, 50)),
    newsFilter: firstPresent(row.news_filter, row.newsFilter, true) !== false,
  };
}

async function runHostedStrategyScan(settings) {
  const response = await fetch(`${appBaseUrl}/api/bot/scan`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      riskPerTrade: settings.riskPerTrade,
      dailyStop: settings.dailyStop,
      rewardRiskRatio: settings.rewardRiskRatio,
    }),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok || !data.ok) {
    throw new Error(data.error || `Strategy scan failed (${response.status}).`);
  }
  return data;
}

async function runHostedLiveTrade(decision, settings) {
  const response = await fetch(`${appBaseUrl}/api/live/trade`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      source: "railway-engine-worker",
      decision,
      quantity: Number(process.env.LIVE_TRADE_QUANTITY || process.env.MAX_LIVE_TRADE_QUANTITY || 1000),
      settings: {
        riskPerTrade: settings.riskPerTrade,
        dailyStop: settings.dailyStop,
        rewardRiskRatio: settings.rewardRiskRatio,
        maxDailyLossUsd: settings.maxDailyLossUsd,
        dailyProfitGoalUsd: settings.dailyProfitGoalUsd,
      },
    }),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok || !data.ok) {
    throw new Error(data.error || `Live trade request failed (${response.status}).`);
  }
  return data;
}

async function runAutoBotCycle() {
  let session = null;
  try {
    const settingsRow = await loadLatestBotSettings();
    const settings = normaliseBotSettings(settingsRow);

    if (!settings.botEnabled) {
      await saveBotActivity(
        "bot_idle",
        "Bot idle",
        "Bot is not enabled. No automatic scans are running.",
        "info",
        { settings }
      );
      return;
    }

    if (!settings.autoExecutionAuthorized) {
      await saveBotActivity(
        "bot_locked",
        "Bot waiting for authorization",
        "Bot is enabled, but automatic execution authorization is not checked.",
        "warning",
        { settings }
      );
      return;
    }

    session = await resolveSession();
    if (!session) {
      await saveBotActivity(
        "broker_wait",
        "Waiting for FOREX.com session",
        "Bot is armed, but the worker does not have a usable FOREX.com session yet.",
        "warning",
        { settings }
      );
      return;
    }

    const scan = await runHostedStrategyScan(settings);
    const decision = scan.decision || scan.selected || {};
    const isTradeSignal = ["BUY", "SELL"].includes(decision.direction);
    if (isTradeSignal && enableLiveTrading) {
      const tradeResult = await runHostedLiveTrade(decision, settings);
      await saveBotActivity(
        "live_trade_sent",
        `${decision.direction} order sent`,
        `${decision.market} ${decision.direction} order was sent through the hosted execution endpoint. FOREX.com response and account reconciliation were recorded.`,
        "success",
        {
          settings,
          clientAccountId: session.account?.clientAccountId,
          decision,
          tradeResult,
        }
      );
      return;
    }

    await saveBotActivity(
      isTradeSignal ? "strategy_signal" : "strategy_hold",
      isTradeSignal ? `${decision.direction} setup found` : "No qualified trade",
      isTradeSignal
        ? `${decision.market} produced a ${decision.direction} setup from real FOREX.com data. ENABLE_LIVE_TRADING is false on this worker, so no real order was sent.`
        : decision.reason || "The strategy scanned real FOREX.com data and chose not to trade.",
      isTradeSignal ? "warning" : "info",
      {
        settings,
        liveTrading: enableLiveTrading,
        clientAccountId: session.account?.clientAccountId,
        decision,
        scannedMarkets: scan.scannedMarkets,
      }
    );
  } catch (error) {
    await saveBotActivity(
      "engine_error",
      "Bot worker error",
      error.message,
      "danger",
      { hasSession: Boolean(session) }
    );
  }
}

async function runAutoBotLoop() {
  log("autobot-loop-started", { botScanMs, liveTrading: enableLiveTrading });
  await saveBotActivity(
    "engine_started",
    "Always-on bot worker started",
    `Worker is online and will check bot settings every ${Math.round(botScanMs / 1000)} seconds.`,
    "success",
    { botScanMs, liveTrading: enableLiveTrading }
  );

  while (true) {
    await runAutoBotCycle();
    await sleep(botScanMs);
  }
}

async function saveAccountSnapshot({ session, margin, itemName }) {
  const supabase = await getSupabaseAdmin();
  const profile = await getOrCreateProfile();
  const balance = pickMarginBalance(margin);
  const primary = getPrimaryTradingAccount(session.account);
  const clientAccountId = session.account.clientAccountId;

  if (!clientAccountId) {
    throw new Error("Cannot save account snapshot because no clientAccountId was returned.");
  }

  const { error } = await supabase
    .from("account_snapshots")
    .upsert({
      profile_id: profile.id,
      broker: "FOREX.com",
      client_account_id: String(clientAccountId),
      trading_account_id: primary?.tradingAccountId ? String(primary.tradingAccountId) : null,
      currency: firstPresent(margin.CurrencyISO, margin.currency, session.account.clientAccountCurrency, "USD"),
      balance_value: balance?.value ?? null,
      balance_key: balance?.key ?? null,
      source: `Lightstreamer ${itemName}`,
      raw_margin: margin,
      raw_account: session.account,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: "broker,client_account_id",
    });

  if (error) {
    throw error;
  }

  log("account-snapshot-saved", {
    clientAccountId,
    balance: balance?.value ?? null,
    balanceKey: balance?.key ?? null,
  });
}

async function savePriceSnapshot({ session, market, price, itemName }) {
  const supabase = await getSupabaseAdmin();
  const profile = await getOrCreateProfile();
  const bid = parseBrokerNumber(firstPresent(price.Bid, price.bid));
  const offer = parseBrokerNumber(firstPresent(price.Offer, price.offer));
  const mid = parseBrokerNumber(firstPresent(price.Price, price.Mid, price.mid));
  const tickDate = firstPresent(price.TickDate, price.tickDate, price.Updated, price.updated, price.receivedAt);

  if (bid === null && offer === null && mid === null) {
    return;
  }

  const { error } = await supabase
    .from("price_snapshots")
    .upsert({
      profile_id: profile.id,
      broker: "FOREX.com",
      market_id: String(market.marketId),
      market_name: market.marketName,
      bid,
      offer,
      mid: mid ?? (bid !== null && offer !== null ? (bid + offer) / 2 : null),
      spread: bid !== null && offer !== null ? offer - bid : null,
      audit_id: firstPresent(price.AuditId, price.auditId),
      tick_date: tickDate,
      source: `Lightstreamer ${itemName}`,
      raw_price: price,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: "broker,market_id",
    });

  if (error) {
    throw error;
  }
}

function streamMargin(session, itemName) {
  return new Promise((resolve, reject) => {
    const ls = require("lightstreamer-client");
    const client = new ls.LightstreamerClient(streamingBase, "STREAMINGALL");
    client.connectionDetails.setUser(session.username);
    client.connectionDetails.setPassword(session.sessionToken);

    const fields = [
      "Cash",
      "Margin",
      "MarginIndicator",
      "NetEquity",
      "OpenTradeEquity",
      "TradeableFunds",
      "PendingFunds",
      "TradingResource",
      "TotalMarginRequirement",
      "CurrencyId",
      "CurrencyISO",
    ];
    const subscription = new ls.Subscription("MERGE", [itemName], fields);
    subscription.setDataAdapter("CLIENTACCOUNTMARGIN");
    subscription.setRequestedSnapshot("yes");

    const startupTimeout = setTimeout(() => {
      client.disconnect();
      reject(new Error(`Timed out waiting for CLIENTACCOUNTMARGIN item ${itemName}.`));
    }, 20000);

    subscription.addListener({
      onItemUpdate(update) {
        clearTimeout(startupTimeout);
        const margin = {
          ...normaliseMarginUpdate(update),
          itemName,
          receivedAt: new Date().toISOString(),
        };
        saveAccountSnapshot({ session, margin, itemName }).catch((error) => {
          log("account-snapshot-save-error", { error: error.message });
        });
      },
      onSubscriptionError(code, message) {
        clearTimeout(startupTimeout);
        client.disconnect();
        reject(new Error(`CLIENTACCOUNTMARGIN subscription error ${code}: ${message} using item ${itemName}`));
      },
    });

    client.addListener({
      onStatusChange(status) {
        log("lightstreamer-status", { status, itemName });
        if (String(status).startsWith("DISCONNECTED")) {
          clearTimeout(startupTimeout);
          reject(new Error(`Lightstreamer disconnected with status ${status}.`));
        }
      },
    });

    client.connect();
    client.subscribe(subscription);
  });
}

async function resolvePriceMarkets(session) {
  const results = await Promise.allSettled(defaultPriceMarkets.map((marketName) => findForexMarket(session, marketName)));
  const markets = results
    .filter((result) => result.status === "fulfilled" && result.value.marketId)
    .map((result) => result.value);
  const failures = results
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason.message);

  if (failures.length) {
    log("price-market-lookup-warning", { failures: failures.slice(0, 5) });
  }

  return markets;
}

function streamPrices(session, markets) {
  return new Promise((resolve, reject) => {
    const ls = require("lightstreamer-client");
    const client = new ls.LightstreamerClient(streamingBase, "STREAMINGALL");
    client.connectionDetails.setUser(session.username);
    client.connectionDetails.setPassword(session.sessionToken);

    const byItemName = new Map(markets.map((market) => [`PRICE.${market.marketId}`, market]));
    const latestByItem = new Map();
    const lastSavedByItem = new Map();
    const fields = [
      "MarketId",
      "TickDate",
      "Bid",
      "Offer",
      "Price",
      "High",
      "Low",
      "Change",
      "Direction",
      "AuditId",
      "StatusSummary",
    ];
    const subscription = new ls.Subscription("MERGE", [...byItemName.keys()], fields);
    subscription.setDataAdapter("PRICES");
    subscription.setRequestedSnapshot("yes");

    const startupTimeout = setTimeout(() => {
      client.disconnect();
      reject(new Error("Timed out waiting for FOREX.com PRICES updates."));
    }, 30000);

    subscription.addListener({
      onItemUpdate(update) {
        clearTimeout(startupTimeout);
        const itemName = update.getItemName();
        const market = byItemName.get(itemName);
        const previous = latestByItem.get(itemName) || {};
        const price = {
          ...previous,
          ...normalisePriceUpdate(update),
          itemName,
          receivedAt: new Date().toISOString(),
        };
        latestByItem.set(itemName, price);
        const lastSavedAt = lastSavedByItem.get(itemName) || 0;
        if (Date.now() - lastSavedAt < priceSnapshotMinIntervalMs) {
          return;
        }
        lastSavedByItem.set(itemName, Date.now());
        savePriceSnapshot({ session, market, price, itemName }).catch((error) => {
          log("price-snapshot-save-error", { market: market?.marketName, error: error.message });
        });
      },
      onSubscriptionError(code, message) {
        clearTimeout(startupTimeout);
        client.disconnect();
        reject(new Error(`PRICES subscription error ${code}: ${message}`));
      },
    });

    client.addListener({
      onStatusChange(status) {
        log("price-lightstreamer-status", { status, markets: markets.length });
        if (String(status).startsWith("DISCONNECTED")) {
          clearTimeout(startupTimeout);
          reject(new Error(`Price Lightstreamer disconnected with status ${status}.`));
        }
      },
    });

    client.connect();
    client.subscribe(subscription);
  });
}

async function runPriceLoop() {
  log("price-engine-started", { markets: defaultPriceMarkets });
  while (true) {
    try {
      const session = await resolveSession();
      if (!session) {
        log("price-no-session", { retryMs });
        await sleep(retryMs);
        continue;
      }

      const markets = await resolvePriceMarkets(session);
      if (!markets.length) {
        throw new Error("No FOREX.com markets could be resolved for price streaming.");
      }

      await saveBotActivity(
        "market_data",
        "Live price stream starting",
        `Subscribing to ${markets.length} FOREX.com markets through Lightstreamer PRICES.`,
        "success",
        { markets }
      );
      await streamPrices(session, markets);
    } catch (error) {
      log("price-engine-error", { error: error.message, retryMs });
      await saveBotActivity(
        "market_data_error",
        "Live price stream error",
        error.message,
        "danger"
      );
      await sleep(retryMs);
    }
  }
}

async function runEngineLoop() {
  log("engine-started", {
    mode: engineUsername ? "env credentials" : "latest saved website session",
    streamingBase,
  });

  while (true) {
    try {
      const session = await resolveSession();
      if (!session) {
        log("no-session", { retryMs });
        await sleep(retryMs);
        continue;
      }

      const clientAccountId = session.account.clientAccountId;
      if (!clientAccountId) {
        throw new Error("FOREX.com session did not include a clientAccountId.");
      }

      const itemNames = [`ID.${clientAccountId}`, "CLIENTACCOUNTMARGIN"];
      let connected = false;
      for (const itemName of itemNames) {
        try {
          log("stream-start", { clientAccountId, itemName });
          await streamMargin(session, itemName);
          connected = true;
          break;
        } catch (error) {
          log("stream-error", { itemName, error: error.message });
        }
      }

      if (!connected) {
        await sleep(retryMs);
      }
    } catch (error) {
      log("engine-error", { error: error.message, retryMs });
      await sleep(retryMs);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

process.on("SIGINT", () => {
  log("engine-stopped", { signal: "SIGINT" });
  process.exit(0);
});

process.on("SIGTERM", () => {
  log("engine-stopped", { signal: "SIGTERM" });
  process.exit(0);
});

Promise.all([
  runEngineLoop(),
  runPriceLoop(),
  runAutoBotLoop(),
]).catch((error) => {
  log("fatal", { error: error.message, id: crypto.randomUUID() });
  process.exit(1);
});
