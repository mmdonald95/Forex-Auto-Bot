const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = __dirname;
loadEnv(path.join(root, ".env"));

function safeRequire(modulePath, fallback) {
  try {
    return require(modulePath);
  } catch (error) {
    console.error(`Optional module ${modulePath} could not load:`, error.message);
    return fallback;
  }
}

const { approveTrade, mergeRiskLimits } = safeRequire("./lib/risk-manager", {
  mergeRiskLimits: (limits = {}) => ({
    maxRiskAmount: 100,
    maxRewardRiskRatioMinimum: 2,
    maxSpreadPips: 2,
    requireStopLoss: true,
    ...limits,
  }),
  approveTrade: (trade = {}, limits = {}) => {
    const merged = {
      maxRiskAmount: 100,
      maxRewardRiskRatioMinimum: 2,
      maxSpreadPips: 2,
      requireStopLoss: false,
      ...limits,
    };
    const signal = trade.signal || trade;
    const violations = [];
    const riskAmount = parseBrokerNumber(signal.riskAmount);
    const rewardRiskRatio = parseBrokerNumber(signal.rewardRiskRatio);
    const spreadPips = parseBrokerNumber(signal.spreadPips);

    if (!["BUY", "SELL"].includes(signal.direction)) violations.push("invalid_signal");
    if (riskAmount !== null && riskAmount > merged.maxRiskAmount) violations.push(`risk_amount_over_${merged.maxRiskAmount}`);
    if (rewardRiskRatio !== null && rewardRiskRatio < merged.maxRewardRiskRatioMinimum) violations.push("reward_risk_too_low");
    if (spreadPips !== null && spreadPips > merged.maxSpreadPips) violations.push("spread_too_wide");
    if (merged.requireStopLoss && !signal.stopLoss) violations.push("missing_stop_loss");
    return { approved: violations.length === 0, violations, rejections: violations, limits: merged };
  },
});
const { evaluateValidationReport } = safeRequire("./lib/validation-gate", {
  evaluateValidationReport: (report = {}) => ({
    approved: Boolean(report.backtestPassed && report.paperTradingPassed && Number(report.expectancy || 0) > 0),
    failures: [],
  }),
});
const { buildTradeJournalEntry } = safeRequire("./lib/trade-journal", {
  buildTradeJournalEntry: (event = {}) => ({ ...event, createdAt: new Date().toISOString() }),
});
const strategyStore = [];
const { registerStrategy, listStrategies } = safeRequire("./lib/strategy-registry", {
  registerStrategy: (strategy) => {
    strategyStore.push(strategy);
  },
  listStrategies: () => strategyStore.map((strategy) => ({
    id: strategy.id,
    name: strategy.name,
    version: strategy.version,
    enabled: strategy.enabled !== false,
    parameters: strategy.parameters || {},
  })),
});

const port = Number(process.env.PORT || 3000);
const apiBase = (process.env.FOREXCOM_API_BASE || "https://ciapi.cityindex.com/TradingAPI").replace(/\/$/, "");
const appVersion = process.env.FOREXCOM_APP_VERSION || "1";
const appComments = process.env.FOREXCOM_APP_COMMENTS || "Forex Auto Bot";
const forexComAppKey = process.env.FOREXCOM_APP_KEY || "";
const forexComUsername = process.env.FOREXCOM_USERNAME || "";
const forexComPassword = process.env.FOREXCOM_PASSWORD || "";
const defaultProfileName = process.env.DEFAULT_PROFILE_NAME || "Marcello Gambino";
const defaultProfileEmail = process.env.DEFAULT_PROFILE_EMAIL || "marcello@example.com";
const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const supabaseRestUrl = (process.env.SUPABASE_REST_URL || (supabaseUrl ? `${supabaseUrl}/rest/v1` : "")).replace(/\/$/, "");
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PRIVATE_KEY || "";
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";
const enableLiveTrading = envBool(process.env.ENABLE_LIVE_TRADING);
const sessions = new Map();
const activityEvents = [];
let liveTradingUnlocked = enableLiveTrading;
let localBotSettings = {
  riskPerTrade: 1,
  dailyStop: 4,
  rewardRiskRatio: 2,
  maxDailyLossUsd: 100,
  dailyProfitGoalUsd: 50,
  newsFilter: true,
  botEnabled: false,
  autoExecutionAuthorized: false
};

const defaultPriceMarkets = [
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
];

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

registerStrategy({
  id: "moving-average-profit-rule",
  name: "Moving Average Profit Rule",
  version: "1.0.0",
  parameters: {
    shortWindow: 8,
    longWindow: 21,
    minimumRewardRisk: 2
  },
  generateSignal: generateLiveDataRequiredSignal
});

function loadEnv(filePath) {
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

function maskSecret(value) {
  if (!value) {
    return "";
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text.replace(/\s+/g, " ").trim().slice(0, 300) };
    }
    return { response, data };
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("FOREX.com login timed out. Try again, and confirm the API base URL is correct.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(payload);
}

function logActivity(type, title, message, level = "info", details = {}) {
  activityEvents.unshift({
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    type,
    title,
    message,
    level,
    details,
  });

  if (activityEvents.length > 100) {
    activityEvents.length = 100;
  }
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
  const candidates = [
    account?.TradingAccounts,
    account?.tradingAccounts,
    account?.ClientTradingAccounts,
    account?.clientTradingAccounts,
    account?.Accounts,
    account?.accounts,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  for (const value of Object.values(account || {})) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = findTradingAccounts(value);
      if (nested.length) {
        return nested;
      }
    }
  }

  return [];
}

function safeAccountSummary(account = {}, username = "") {
  const tradingAccounts = findTradingAccounts(account);
  const clientAccounts = Array.isArray(account.clientAccounts)
    ? account.clientAccounts
    : Array.isArray(account.ClientAccounts)
      ? account.ClientAccounts
      : [];
  const firstClientAccount = clientAccounts[0] || {};
  const firstTradingAccount = tradingAccounts[0] || {};

  return {
    logonUserName: firstPresent(account.LogonUserName, account.logonUserName, account.UserName, account.userName, username, defaultProfileName),
    clientAccountCurrency: firstPresent(account.ClientAccountCurrency, account.clientAccountCurrency, firstClientAccount.clientAccountCurrency, firstClientAccount.ClientAccountCurrency, account.Currency, account.currency, "USD"),
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

function pickBalance(source = {}) {
  const keys = [
    "NetEquity",
    "netEquity",
    "AccountValue",
    "accountValue",
    "Balance",
    "balance",
    "ClientAccountBalance",
    "clientAccountBalance",
    "balance_value",
    "Cash",
    "cash",
    "AvailableToTrade",
    "availableToTrade",
    "TradableFunds",
    "tradableFunds",
    "TradeableFunds",
    "tradeableFunds",
    "MarginAvailable",
    "marginAvailable",
  ];

  for (const key of keys) {
    const value = parseBrokerNumber(source?.[key]);
    if (value !== null) {
      return { key, value };
    }
  }

  return null;
}

function supabaseHeaders(prefer = "") {
  const key = supabaseServiceRoleKey || supabaseAnonKey;
  if (!supabaseRestUrl || !key) {
    return null;
  }

  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

async function supabaseFetch(pathname, options = {}) {
  const headers = supabaseHeaders(options.prefer);
  if (!headers) {
    throw new Error("Supabase environment variables are not configured.");
  }

  const response = await fetch(`${supabaseRestUrl}${pathname}`, {
    ...options,
    headers: {
      ...headers,
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.message || data?.hint || `Supabase request failed (${response.status}).`);
  }
  return { data, response };
}

async function countSupabaseRows(table) {
  const headers = supabaseHeaders("count=exact");
  if (!headers) {
    return "--";
  }

  try {
    const response = await fetch(`${supabaseRestUrl}/${table}?select=id&limit=1`, { headers });
    const range = response.headers.get("content-range") || "";
    const match = range.match(/\/(\d+)$/);
    return match ? Number(match[1]) : 0;
  } catch {
    return "--";
  }
}

async function getOrCreateProfile() {
  try {
    const email = encodeURIComponent(defaultProfileEmail);
    const { data } = await supabaseFetch(`/profiles?select=*&email=eq.${email}&limit=1`);
    if (Array.isArray(data) && data[0]) {
      return data[0];
    }

    const created = await supabaseFetch("/profiles", {
      method: "POST",
      prefer: "return=representation",
      body: JSON.stringify([{ email: defaultProfileEmail, full_name: defaultProfileName }]),
    });
    return Array.isArray(created.data) ? created.data[0] : created.data;
  } catch {
    return { full_name: defaultProfileName, email: defaultProfileEmail };
  }
}

async function getLatestAccountSnapshot() {
  try {
    const { data } = await supabaseFetch("/account_snapshots?select=*&broker=eq.FOREX.com&order=updated_at.desc&limit=1");
    return Array.isArray(data) ? data[0] : null;
  } catch {
    return null;
  }
}

async function getLatestPriceSnapshots(limit = 50) {
  try {
    const { data } = await supabaseFetch(`/price_snapshots?select=*&broker=eq.FOREX.com&order=updated_at.desc&limit=${limit}`);
    const seen = new Set();
    return (Array.isArray(data) ? data : [])
      .filter((row) => {
        const key = row.market_id || row.market_name;
        if (!key || seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      })
      .map((row) => {
        const bid = parseBrokerNumber(row.bid);
        const offer = parseBrokerNumber(row.offer);
        const mid = parseBrokerNumber(row.mid);
        return {
          market: row.market_name || row.market_id,
          marketId: row.market_id,
          bid,
          offer,
          mid: mid ?? (bid !== null && offer !== null ? (bid + offer) / 2 : null),
          spread: bid !== null && offer !== null ? offer - bid : null,
          tickDate: row.tick_date,
          updatedAt: row.updated_at,
          auditId: row.audit_id,
          source: row.source || "FOREX.com Lightstreamer PRICES",
        };
      });
  } catch {
    return [];
  }
}

async function getLatestReconciliation() {
  try {
    const { data } = await supabaseFetch("/account_reconciliations?select=*&broker=eq.FOREX.com&order=updated_at.desc&limit=1");
    return Array.isArray(data) ? data[0] : null;
  } catch {
    return null;
  }
}

async function getLatestBotSettings() {
  try {
    const { data } = await supabaseFetch("/bot_settings?select=*&order=updated_at.desc&limit=1");
    const row = Array.isArray(data) ? data[0] : null;
    if (!row) {
      return null;
    }
    return {
      riskPerTrade: Number(firstPresent(row.risk_per_trade, row.riskPerTrade, localBotSettings.riskPerTrade)),
      dailyStop: Number(firstPresent(row.daily_stop, row.dailyStop, localBotSettings.dailyStop)),
      rewardRiskRatio: Number(firstPresent(row.reward_risk_ratio, row.rewardRiskRatio, localBotSettings.rewardRiskRatio)),
      maxDailyLossUsd: Number(firstPresent(row.max_daily_loss_usd, row.maxDailyLossUsd, localBotSettings.maxDailyLossUsd)),
      dailyProfitGoalUsd: Number(firstPresent(row.daily_profit_goal_usd, row.dailyProfitGoalUsd, localBotSettings.dailyProfitGoalUsd)),
      newsFilter: firstPresent(row.news_filter, row.newsFilter, localBotSettings.newsFilter) !== false,
      botEnabled: Boolean(firstPresent(row.bot_enabled, row.botEnabled, localBotSettings.botEnabled)),
      autoExecutionAuthorized: Boolean(firstPresent(row.auto_execution_authorized, row.autoExecutionAuthorized, localBotSettings.autoExecutionAuthorized)),
    };
  } catch {
    return null;
  }
}

async function hydrateBotSettings() {
  const saved = await getLatestBotSettings();
  if (saved) {
    localBotSettings = {
      ...localBotSettings,
      ...saved,
    };
  }
  return localBotSettings;
}

async function getSupabaseActivity(limit = 30) {
  try {
    const { data } = await supabaseFetch(`/bot_activity?select=*&order=created_at.desc&limit=${limit}`);
    return (Array.isArray(data) ? data : []).map((event) => ({
      id: event.id,
      at: event.created_at,
      type: event.event_type,
      title: event.title,
      message: event.message,
      level: event.level || "info",
      details: event.details || {},
    }));
  } catch {
    return [];
  }
}

async function getLatestSavedSession() {
  try {
    const { data } = await supabaseFetch("/broker_connections?select=*&broker=eq.FOREX.com_SESSION&order=created_at.desc&limit=5");
    for (const row of data || []) {
      try {
        const payload = JSON.parse(row.app_key_label || "{}");
        if (payload.sessionToken && payload.account) {
          return {
            username: row.forex_username,
            appKey: payload.appKey || forexComAppKey,
            account: payload.account,
            brokerSession: { Session: payload.sessionToken, SessionId: payload.sessionToken },
            createdAt: row.created_at,
          };
        }
      } catch {
        // Keep looking for a readable session row.
      }
    }
  } catch {
    return null;
  }

  return null;
}

async function loginWithServerCredentials() {
  if (!forexComUsername || !forexComPassword || !forexComAppKey) {
    return null;
  }

  const { response, data } = await fetchJsonWithTimeout(`${apiBase}/session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "Forex Auto Bot",
    },
    body: JSON.stringify({
      UserName: forexComUsername,
      Password: forexComPassword,
      AppVersion: appVersion,
      AppComments: appComments,
      AppKey: forexComAppKey,
    }),
  }, 12000);

  if (!response.ok) {
    throw new Error(data.Message || data.ErrorMessage || data.error || data.raw || `FOREX.com login failed (${response.status}).`);
  }

  const sessionToken = firstPresent(data.Session, data.SessionId, data.SessionToken);
  if (!sessionToken) {
    throw new Error("FOREX.com did not return a session token.");
  }

  let account = {};
  try {
    const accountBase = apiBase.replace(/\/TradingAPI$/i, "");
    const accountResponse = await fetchJsonWithTimeout(`${accountBase}/v2/userAccount/ClientAndTradingAccount`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "Forex Auto Bot",
        UserName: forexComUsername,
        Session: sessionToken,
      },
    }, 12000);
    if (accountResponse.response.ok) {
      account = safeAccountSummary(accountResponse.data, forexComUsername);
    }
  } catch (error) {
    console.error("FOREX.com env account detail load failed:", error.message);
  }

  const session = {
    username: forexComUsername,
    appKey: forexComAppKey,
    account: {
      ...data,
      ...account,
      logonUserName: account.logonUserName || data.UserName || data.userName || forexComUsername,
      clientAccountId: account.clientAccountId || data.ClientAccountId || data.clientAccountId || data.AccountId || data.accountId || null,
      clientAccountCurrency: account.clientAccountCurrency || data.ClientAccountCurrency || data.clientAccountCurrency || "USD",
    },
    brokerSession: data,
    createdAt: new Date().toISOString(),
  };

  await saveBrokerSession(forexComUsername, forexComAppKey, data, session.account);
  return session;
}

async function saveBrokerSession(username, appKey, brokerSession, account) {
  const sessionToken = firstPresent(brokerSession?.Session, brokerSession?.SessionId, brokerSession?.SessionToken);
  if (!sessionToken) {
    return;
  }

  try {
    await supabaseFetch("/broker_connections", {
      method: "POST",
      prefer: "return=minimal",
      body: JSON.stringify([{
        broker: "FOREX.com_SESSION",
        forex_username: username,
        app_key_label: JSON.stringify({
          appKey: maskSecret(appKey),
          sessionToken,
          account,
          savedAt: new Date().toISOString(),
        }),
      }]),
    });
  } catch (error) {
    console.error("Could not save broker session:", error.message);
  }
}

function sessionTokenFrom(session) {
  return firstPresent(session?.brokerSession?.Session, session?.brokerSession?.SessionId, session?.brokerSession?.SessionToken);
}

function forexHeaders(session) {
  const token = sessionTokenFrom(session);
  return {
    Accept: "application/json",
    "User-Agent": "Forex Auto Bot",
    ...(session?.username ? { UserName: session.username } : {}),
    ...(token ? { Session: token } : {}),
  };
}

async function resolveSession(sessionId) {
  if (sessionId && sessions.has(sessionId)) {
    return sessions.get(sessionId);
  }

  try {
    const credentialSession = await loginWithServerCredentials();
    if (credentialSession) {
      return credentialSession;
    }
  } catch (error) {
    console.error("FOREX.com env credential login failed:", error.message);
  }

  return getLatestSavedSession();
}

function normaliseBars(priceBars = []) {
  return priceBars
    .map((bar) => ({
      BarDate: bar.BarDate || bar.barDate || bar.Date || bar.date,
      open: parseBrokerNumber(firstPresent(bar.open, bar.Open, bar.OpenPrice)),
      high: parseBrokerNumber(firstPresent(bar.high, bar.High, bar.HighPrice)),
      low: parseBrokerNumber(firstPresent(bar.low, bar.Low, bar.LowPrice)),
      close: parseBrokerNumber(firstPresent(bar.close, bar.Close, bar.ClosePrice)),
    }))
    .filter((bar) => [bar.open, bar.high, bar.low, bar.close].every((value) => value !== null));
}

async function findForexMarket(session, marketName) {
  if (!session) {
    throw new Error("Connect to FOREX.com first. Real market data requires a broker session.");
  }

  const clientAccountId = session.account?.clientAccountId;
  if (!clientAccountId) {
    throw new Error("FOREX.com did not return a ClientAccountId for market lookup.");
  }

  const searchUrl = new URL(`${apiBase}/market/search`);
  searchUrl.searchParams.set("SearchByMarketName", "true");
  searchUrl.searchParams.set("Query", marketName);
  searchUrl.searchParams.set("MaxResults", "10");
  searchUrl.searchParams.set("ClientAccountId", String(clientAccountId));

  const { response, data } = await fetchJsonWithTimeout(searchUrl.toString(), {
    method: "GET",
    headers: forexHeaders(session),
  }, 12000);

  if (!response.ok) {
    throw new Error(data.Message || data.ErrorMessage || data.error || `FOREX.com market search failed (${response.status}).`);
  }

  const markets = data.Markets || data.markets || data.MarketInformation || data.marketInformation || [];
  const normalizedName = marketName.replace(/\s+/g, "").toUpperCase();
  const selected = markets.find((item) => String(item.Name || item.MarketName || "").replace(/\s+/g, "").toUpperCase() === normalizedName)
    || markets.find((item) => String(item.Name || item.MarketName || "").replace(/\s+/g, "").toUpperCase().includes(normalizedName))
    || markets[0];

  if (!selected) {
    throw new Error(`FOREX.com returned no tradable market for ${marketName}.`);
  }

  return {
    marketId: firstPresent(selected.MarketId, selected.marketId, selected.Id, selected.id),
    marketName: firstPresent(selected.Name, selected.MarketName, selected.marketName, marketName),
    raw: selected,
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";

    req.on("data", chunk => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });

    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });

    req.on("error", reject);
  });
}

function serveStatic(req, res) {
  const url = new URL(req.url, "http://localhost");

  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";

  const safePath = path
    .normalize(pathname)
    .replace(/^(\.\.[/\\])+/, "");

  const filePath = path.join(root, safePath);

  if (!filePath.startsWith(root)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || "application/octet-stream";

  res.writeHead(200, { "Content-Type": contentType });
  fs.createReadStream(filePath).pipe(res);
}

function generateLiveDataRequiredSignal(body = {}) {
  return {
    id: crypto.randomUUID(),
    market: body.market || "EUR/USD",
    direction: "HOLD",
    status: "live_data_required",
    reason: "Real FOREX.com candle and price data is required before this strategy can produce a trade signal.",
    createdAt: new Date().toISOString()
  };
}

function latestTickPrice(data) {
  const ticks = data.PriceTicks || data.priceTicks || [];
  const latest = Array.isArray(ticks) ? ticks[ticks.length - 1] : null;
  return {
    price: parseBrokerNumber(firstPresent(latest?.Price, latest?.price)),
    tickDate: firstPresent(latest?.TickDate, latest?.tickDate),
  };
}

async function fetchLatestTick(session, marketId, priceType) {
  const tickUrl = new URL(`${apiBase}/market/${marketId}/tickhistorybefore`);
  tickUrl.searchParams.set("maxResults", "1");
  tickUrl.searchParams.set("toTimeStampUTC", String(Date.now()));
  tickUrl.searchParams.set("priceType", priceType);

  const { response, data } = await fetchJsonWithTimeout(tickUrl.toString(), {
    method: "GET",
    headers: forexHeaders(session),
  }, 12000);

  if (!response.ok) {
    throw new Error(data.Message || data.ErrorMessage || data.error || `FOREX.com tick request failed (${response.status}).`);
  }

  return latestTickPrice(data);
}

async function fetchRestPriceSnapshot(session, marketName) {
  const marketInfo = await findForexMarket(session, marketName);
  const [bidTick, offerTick, midTick] = await Promise.all([
    fetchLatestTick(session, marketInfo.marketId, "BID"),
    fetchLatestTick(session, marketInfo.marketId, "ASK"),
    fetchLatestTick(session, marketInfo.marketId, "MID"),
  ]);
  const bid = bidTick.price;
  const offer = offerTick.price;
  const mid = midTick.price ?? (bid !== null && offer !== null ? (bid + offer) / 2 : null);
  return {
    market: marketInfo.marketName,
    marketId: marketInfo.marketId,
    bid,
    offer,
    mid,
    spread: bid !== null && offer !== null ? offer - bid : null,
    tickDate: offerTick.tickDate || bidTick.tickDate || midTick.tickDate || null,
    updatedAt: new Date().toISOString(),
    source: "FOREX.com tickhistorybefore",
  };
}

function pipSizeForMarket(marketName = "") {
  return marketName.includes("JPY") ? 0.01 : 0.0001;
}

function average(values = []) {
  const usable = values.filter((value) => Number.isFinite(value));
  return usable.length ? usable.reduce((total, value) => total + value, 0) / usable.length : null;
}

function arrayFromAny(data, keys = []) {
  for (const key of keys) {
    const value = data?.[key];
    if (Array.isArray(value)) {
      return value;
    }
  }

  if (Array.isArray(data)) {
    return data;
  }

  for (const value of Object.values(data || {})) {
    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

function numericValue(source = {}, keys = []) {
  for (const key of keys) {
    const value = parseBrokerNumber(source?.[key]);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function sumByKeys(rows = [], keys = []) {
  return rows.reduce((total, row) => {
    const value = numericValue(row, keys);
    return value === null ? total : total + value;
  }, 0);
}

function getPrimaryTradingAccountId(account = {}) {
  const primary = account.tradingAccounts?.[0] || findTradingAccounts(account)[0] || {};
  return firstPresent(
    primary.tradingAccountId,
    primary.TradingAccountId,
    account.tradingAccountId,
    account.TradingAccountId
  );
}

async function fetchForexOrderResource(session, resourcePath, params = {}) {
  const requestUrl = new URL(`${apiBase}/order/${resourcePath}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      requestUrl.searchParams.set(key, String(value));
    }
  }

  const { response, data } = await fetchJsonWithTimeout(requestUrl.toString(), {
    method: "GET",
    headers: forexHeaders(session),
  }, 15000);

  if (!response.ok) {
    throw new Error(data.Message || data.ErrorMessage || data.error || `${resourcePath} failed (${response.status}).`);
  }

  return data;
}

async function reconcileForexAccount(session) {
  if (!session) {
    throw new Error("Connect to FOREX.com first.");
  }

  const tradingAccountId = getPrimaryTradingAccountId(session.account);
  if (!tradingAccountId) {
    throw new Error("FOREX.com did not return a TradingAccountId.");
  }

  const [positionsResult, historyResult, activeOrdersResult] = await Promise.allSettled([
    fetchForexOrderResource(session, "openpositions", { TradingAccountId: tradingAccountId }),
    fetchForexOrderResource(session, "tradehistory", { TradingAccountId: tradingAccountId, MaxResults: 100 }),
    fetchForexOrderResource(session, "activestoplimitorders", { TradingAccountId: tradingAccountId }),
  ]);

  const positionsData = positionsResult.status === "fulfilled" ? positionsResult.value : {};
  const historyData = historyResult.status === "fulfilled" ? historyResult.value : {};
  const activeOrdersData = activeOrdersResult.status === "fulfilled" ? activeOrdersResult.value : {};
  const positions = arrayFromAny(positionsData, ["OpenPositions", "openPositions", "Positions", "positions"]);
  const tradeHistory = arrayFromAny(historyData, ["TradeHistory", "tradeHistory", "Trades", "trades", "History", "history"]);
  const activeOrders = arrayFromAny(activeOrdersData, ["ActiveStopLimitOrders", "activeStopLimitOrders", "Orders", "orders"]);
  const realizedProfitLoss = sumByKeys(tradeHistory, ["ProfitAndLoss", "RealisedPnl", "RealizedPnl", "PnL", "Profit", "NetProfitAndLoss"]);
  const openProfitLoss = sumByKeys(positions, ["OpenTradeEquity", "OTE", "ProfitAndLoss", "UnrealisedPnl", "UnrealizedPnl", "PnL"]);
  const summary = {
    tradingAccountId: String(tradingAccountId),
    openPositionCount: positions.length,
    activeOrderCount: activeOrders.length,
    tradeHistoryCount: tradeHistory.length,
    realizedProfitLoss,
    openProfitLoss,
    totalProfitLoss: realizedProfitLoss + openProfitLoss,
    reconciledAt: new Date().toISOString(),
    errors: [
      positionsResult.status === "rejected" ? `openpositions: ${positionsResult.reason.message}` : null,
      historyResult.status === "rejected" ? `tradehistory: ${historyResult.reason.message}` : null,
      activeOrdersResult.status === "rejected" ? `activestoplimitorders: ${activeOrdersResult.reason.message}` : null,
    ].filter(Boolean),
  };

  return {
    positions,
    activeOrders,
    tradeHistory,
    summary,
    raw: {
      positions: positionsData,
      tradeHistory: historyData,
      activeOrders: activeOrdersData,
    },
  };
}

async function saveReconciliation(session, reconciliation) {
  try {
    const profile = await getOrCreateProfile();
    await supabaseFetch("/account_reconciliations", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: JSON.stringify([{
        profile_id: profile.id,
        broker: "FOREX.com",
        client_account_id: String(session.account?.clientAccountId || ""),
        trading_account_id: reconciliation.summary.tradingAccountId,
        realized_profit_loss: reconciliation.summary.realizedProfitLoss,
        open_profit_loss: reconciliation.summary.openProfitLoss,
        total_profit_loss: reconciliation.summary.totalProfitLoss,
        open_position_count: reconciliation.summary.openPositionCount,
        active_order_count: reconciliation.summary.activeOrderCount,
        trade_history_count: reconciliation.summary.tradeHistoryCount,
        raw_positions: reconciliation.positions,
        raw_active_orders: reconciliation.activeOrders,
        raw_trade_history: reconciliation.tradeHistory,
        errors: reconciliation.summary.errors,
        updated_at: new Date().toISOString(),
      }]),
    });
  } catch (error) {
    console.error("Could not save reconciliation:", error.message);
  }
}

async function fetchRealCandles(session, marketName, maxResults = 80) {
  const marketInfo = await findForexMarket(session, marketName);
  const barUrl = new URL(`${apiBase}/market/${marketInfo.marketId}/barhistory`);
  barUrl.searchParams.set("interval", "MINUTE");
  barUrl.searchParams.set("span", "15");
  barUrl.searchParams.set("PriceBars", String(maxResults));
  barUrl.searchParams.set("PriceType", "MID");

  const { response, data } = await fetchJsonWithTimeout(barUrl.toString(), {
    method: "GET",
    headers: forexHeaders(session),
  }, 15000);

  if (!response.ok) {
    throw new Error(data.Message || data.ErrorMessage || data.error || `FOREX.com candle request failed (${response.status}).`);
  }

  const rawBars = data.PriceBars || data.priceBars || [];
  const partialBar = data.PartialPriceBar || data.partialPriceBar;
  const combinedBars = [...rawBars];
  if (partialBar) {
    const lastBar = combinedBars[combinedBars.length - 1];
    const lastDate = lastBar?.BarDate || lastBar?.barDate || lastBar?.Timestamp || lastBar?.time;
    const partialDate = partialBar.BarDate || partialBar.barDate || partialBar.Timestamp || partialBar.time;
    if (lastDate && partialDate && lastDate === partialDate) {
      combinedBars[combinedBars.length - 1] = partialBar;
    } else {
      combinedBars.push(partialBar);
    }
  }

  const bars = normaliseBars(combinedBars);
  if (bars.length < 30) {
    throw new Error(`FOREX.com returned only ${bars.length} candle(s) for ${marketName}.`);
  }

  return { marketInfo, bars };
}

function evaluateMovingAverageStrategy({ marketName, candles, price, balance, riskPerTrade, rewardRiskRatio }) {
  const closes = candles.map((bar) => bar.close);
  const recent = candles.slice(-12);
  const previousCloses = closes.slice(0, -1);
  const shortMa = average(closes.slice(-8));
  const longMa = average(closes.slice(-21));
  const previousShortMa = average(previousCloses.slice(-8));
  const previousLongMa = average(previousCloses.slice(-21));
  const pipSize = pipSizeForMarket(marketName);
  const liveMid = price?.mid ?? (price?.bid !== null && price?.offer !== null ? (price.bid + price.offer) / 2 : null);
  const entry = liveMid ?? closes[closes.length - 1];
  const spread = price?.spread ?? null;
  const spreadPips = spread === null ? null : spread / pipSize;
  const riskAmount = Number((balance * (riskPerTrade / 100)).toFixed(2));

  let direction = "HOLD";
  if (shortMa !== null && longMa !== null && previousShortMa !== null && previousLongMa !== null) {
    if (shortMa > longMa && shortMa >= previousShortMa && closes[closes.length - 1] > longMa) {
      direction = "BUY";
    } else if (shortMa < longMa && shortMa <= previousShortMa && closes[closes.length - 1] < longMa) {
      direction = "SELL";
    }
  }

  const recentLow = Math.min(...recent.map((bar) => bar.low));
  const recentHigh = Math.max(...recent.map((bar) => bar.high));
  const minimumStopDistance = pipSize * 10;
  const stopDistance = direction === "BUY"
    ? Math.max(entry - recentLow, minimumStopDistance)
    : direction === "SELL"
      ? Math.max(recentHigh - entry, minimumStopDistance)
      : minimumStopDistance;
  const suggestedStop = direction === "BUY"
    ? Number((entry - stopDistance).toFixed(marketName.includes("JPY") ? 3 : 5))
    : direction === "SELL"
      ? Number((entry + stopDistance).toFixed(marketName.includes("JPY") ? 3 : 5))
      : null;
  const suggestedTakeProfit = direction === "BUY"
    ? Number((entry + stopDistance * rewardRiskRatio).toFixed(marketName.includes("JPY") ? 3 : 5))
    : direction === "SELL"
      ? Number((entry - stopDistance * rewardRiskRatio).toFixed(marketName.includes("JPY") ? 3 : 5))
      : null;

  const approval = approveTrade({
    direction,
    stopLoss: suggestedStop,
    takeProfit: suggestedTakeProfit,
    riskAmount,
    rewardRiskRatio,
    spreadPips: spreadPips ?? 0,
  }, mergeRiskLimits({
    maxRiskAmount: Math.max(riskAmount, 1),
    maxRewardRiskRatioMinimum: rewardRiskRatio,
    maxSpreadPips: 2,
  }));
  const riskViolations = approval.violations || approval.rejections || [];

  return {
    market: marketName,
    direction: approval.approved ? direction : "HOLD",
    rawDirection: direction,
    lastPrice: Number(entry.toFixed(marketName.includes("JPY") ? 3 : 5)),
    shortMa: Number(shortMa.toFixed(marketName.includes("JPY") ? 3 : 5)),
    longMa: Number(longMa.toFixed(marketName.includes("JPY") ? 3 : 5)),
    suggestedStop,
    suggestedTakeProfit,
    expectedRisk: riskAmount,
    expectedProfit: Number((riskAmount * rewardRiskRatio).toFixed(2)),
    rewardRiskRatio,
    priceSource: price?.source || "FOREX.com candle history",
    candleCount: candles.length,
    liveSpread: spreadPips === null ? "--" : Number(spreadPips.toFixed(2)),
    signalStrength: Number(Math.abs((shortMa - longMa) / pipSize).toFixed(2)),
    riskApproved: approval.approved,
    riskViolations,
    reason: approval.approved
      ? `${direction} setup from real FOREX.com candles and live bid/offer price.`
      : `No trade: ${riskViolations.join(" ") || "real data did not produce a qualified signal."}`,
  };
}

function normaliseTradeDirection(direction = "") {
  const value = String(direction).trim().toUpperCase();
  return value === "BUY" || value === "SELL" ? value : null;
}

function oppositeTradeDirection(direction = "") {
  return normaliseTradeDirection(direction) === "BUY" ? "sell" : "buy";
}

function decimalsForMarket(marketName = "") {
  return String(marketName).includes("JPY") ? 3 : 5;
}

function normaliseMarketKey(value = "") {
  return String(value).replace(/\s+/g, "").toUpperCase();
}

function roundMarketPrice(value, marketName) {
  const parsed = parseBrokerNumber(value);
  return parsed === null ? null : Number(parsed.toFixed(decimalsForMarket(marketName)));
}

function liveEntryPrice(direction, price = {}) {
  return direction === "BUY" ? price.offer : price.bid;
}

function isFreshTimestamp(value, maxAgeMs = 120000) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) && Date.now() - timestamp <= maxAgeMs;
}

async function getTodaysLiveBotTradeCount() {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const query = `/bot_activity?select=id&event_type=eq.live_trade_sent&created_at=gte.${encodeURIComponent(startOfDay.toISOString())}`;
    const { data } = await supabaseFetch(query);
    return Array.isArray(data) ? data.length : 0;
  } catch {
    return 0;
  }
}

async function saveSupabaseBotActivity(type, title, message, level = "info", details = {}) {
  logActivity(type, title, message, level, details);
  try {
    const profile = await getOrCreateProfile();
    await supabaseFetch("/bot_activity", {
      method: "POST",
      prefer: "return=minimal",
      body: JSON.stringify([{
        profile_id: profile.id || null,
        event_type: type,
        title,
        message,
        level,
        details,
      }]),
    });
  } catch (error) {
    console.error("Could not save bot activity:", error.message);
  }
}

async function submitForexLiveTrade({ session, decision, quantity }) {
  const marketName = decision.market || decision.marketName;
  const direction = normaliseTradeDirection(decision.direction || decision.rawDirection);
  if (!marketName || !direction) {
    throw new Error("Live order rejected: missing market or BUY/SELL direction.");
  }

  const priceSnapshots = await getLatestPriceSnapshots(50);
  const price = priceSnapshots.find((item) => normaliseMarketKey(item.market) === normaliseMarketKey(marketName));
  if (!price) {
    throw new Error(`Live order rejected: no live FOREX.com bid/offer snapshot for ${marketName}.`);
  }

  if (!isFreshTimestamp(price.updatedAt || price.tickDate)) {
    throw new Error(`Live order rejected: ${marketName} price snapshot is stale. Confirm the Railway worker is running.`);
  }

  if (price.bid === null || price.offer === null || !price.auditId) {
    throw new Error(`Live order rejected: ${marketName} is missing bid, offer, or AuditId from the live price stream.`);
  }

  const pipSize = pipSizeForMarket(marketName);
  const spreadPips = price.spread === null ? null : price.spread / pipSize;
  const maxSpreadPips = Number(process.env.MAX_LIVE_SPREAD_PIPS || 2);
  if (spreadPips === null || spreadPips > maxSpreadPips) {
    throw new Error(`Live order rejected: spread is ${spreadPips === null ? "unknown" : spreadPips.toFixed(2)} pips, above the ${maxSpreadPips} pip limit.`);
  }

  const stopLoss = roundMarketPrice(decision.suggestedStop || decision.stopLoss, marketName);
  const takeProfit = roundMarketPrice(decision.suggestedTakeProfit || decision.takeProfit, marketName);
  if (stopLoss === null || takeProfit === null) {
    throw new Error("Live order rejected: stop loss and take profit are required.");
  }

  const entry = liveEntryPrice(direction, price);
  if (entry === null) {
    throw new Error("Live order rejected: entry price could not be calculated from bid/offer.");
  }

  if (direction === "BUY" && !(stopLoss < entry && takeProfit > entry)) {
    throw new Error("Live order rejected: BUY stop loss must be below entry and take profit must be above entry.");
  }
  if (direction === "SELL" && !(stopLoss > entry && takeProfit < entry)) {
    throw new Error("Live order rejected: SELL stop loss must be above entry and take profit must be below entry.");
  }

  const maxQuantity = Number(process.env.MAX_LIVE_TRADE_QUANTITY || 1000);
  const requestedQuantity = Number(quantity || process.env.LIVE_TRADE_QUANTITY || maxQuantity);
  const safeQuantity = Math.min(requestedQuantity, maxQuantity);
  if (!Number.isFinite(safeQuantity) || safeQuantity <= 0) {
    throw new Error("Live order rejected: invalid live trade quantity.");
  }

  const reconciliation = await reconcileForexAccount(session);
  const maxOpenPositions = Number(process.env.MAX_OPEN_POSITIONS || 1);
  if (reconciliation.summary.openPositionCount >= maxOpenPositions) {
    throw new Error(`Live order rejected: ${reconciliation.summary.openPositionCount} open position(s), max allowed is ${maxOpenPositions}.`);
  }

  const maxDailyLiveTrades = Number(process.env.MAX_DAILY_LIVE_TRADES || 1);
  const todaysBotTrades = await getTodaysLiveBotTradeCount();
  if (todaysBotTrades >= maxDailyLiveTrades) {
    throw new Error(`Live order rejected: daily bot trade cap reached (${todaysBotTrades}/${maxDailyLiveTrades}).`);
  }

  const tradingAccountId = getPrimaryTradingAccountId(session.account);
  if (!tradingAccountId) {
    throw new Error("Live order rejected: FOREX.com did not return a TradingAccountId.");
  }

  const marketInfo = decision.marketId
    ? { marketId: decision.marketId, marketName }
    : await findForexMarket(session, marketName);

  const orderRequest = {
    IfDone: [{
      Stop: {
        Guaranteed: false,
        Direction: oppositeTradeDirection(direction),
        Quantity: safeQuantity,
        Applicability: "GTC",
        TriggerPrice: stopLoss,
        OrderId: 0,
      },
      Limit: {
        Direction: oppositeTradeDirection(direction),
        Quantity: safeQuantity,
        Applicability: "GTC",
        TriggerPrice: takeProfit,
        OrderId: 0,
      },
    }],
    Direction: direction.toLowerCase(),
    BidPrice: price.bid,
    OfferPrice: price.offer,
    AuditId: price.auditId,
    AutoRollover: false,
    MarketId: Number(marketInfo.marketId),
    MarketName: marketInfo.marketName || marketName,
    OrderId: 0,
    Currency: null,
    Quantity: safeQuantity,
    QuoteId: null,
    PositionMethodId: 1,
    TradingAccountId: Number(tradingAccountId),
    Status: null,
    isTrade: true,
    Reference: "StoneX API",
    Source: "StoneX API",
    OrderReference: `ForexAutoBot-${Date.now()}`,
  };

  const { response, data } = await fetchJsonWithTimeout(`${apiBase}/order/newtradeorder`, {
    method: "POST",
    headers: {
      ...forexHeaders(session),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(orderRequest),
  }, 15000);

  if (!response.ok) {
    throw new Error(data.Message || data.ErrorMessage || data.error || data.raw || `FOREX.com order failed (${response.status}).`);
  }

  const afterReconciliation = await reconcileForexAccount(session);
  await saveReconciliation(session, afterReconciliation);

  return {
    orderRequest: {
      ...orderRequest,
      AuditId: price.auditId,
    },
    brokerResponse: data,
    price,
    spreadPips: Number(spreadPips.toFixed(2)),
    reconciliation: afterReconciliation.summary,
  };
}

async function handleApi(req, res) {
  const url = new URL(req.url, "http://localhost");

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      app: "Forex Auto Bot",
      runtime: "vercel-node",
      time: new Date().toISOString()
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/activity") {
    const supabaseEvents = await getSupabaseActivity(30);
    if (!activityEvents.length) {
      logActivity(
        "system",
        "Activity feed ready",
        "The dashboard is now tracking scans, risk checks, bot state changes, and trade attempts.",
        "info"
      );
    }

    sendJson(res, 200, {
      ok: true,
      events: [...supabaseEvents, ...activityEvents]
        .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0))
        .slice(0, 30),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/strategies") {
    sendJson(res, 200, {
      strategies: listStrategies()
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/forexcom/config") {
    sendJson(res, 200, {
      ok: true,
      hasAppKey: Boolean(forexComAppKey),
      appKey: forexComAppKey ? maskSecret(forexComAppKey) : "",
      source: forexComAppKey ? "environment" : "browser-saved key required"
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/forexcom/connect") {
    const body = await readBody(req);
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const appKey = String(body.appKey || forexComAppKey || "").trim();

    if (!username || !password) {
      sendJson(res, 400, {
        ok: false,
        error: "Enter your FOREX.com username and password."
      });
      return;
    }

    if (!appKey) {
      sendJson(res, 400, {
        ok: false,
        error: "Missing FOREX.com AppKey. Paste it once; the browser will remember it for next time."
      });
      return;
    }

    const sessionPayload = {
      UserName: username,
      Password: password,
      AppVersion: appVersion,
      AppComments: appComments,
      AppKey: appKey
    };

    let account = {
      logonUserName: username,
      clientAccountCurrency: "USD",
      clientAccountId: null
    };
    let brokerSession = null;

    try {
      const { response, data } = await fetchJsonWithTimeout(`${apiBase}/session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Forex Auto Bot"
        },
        body: JSON.stringify(sessionPayload)
      }, 12000);

      if (!response.ok) {
        throw new Error(data.Message || data.ErrorMessage || data.error || data.raw || `FOREX.com rejected login (${response.status}).`);
      }

      brokerSession = data;
      const sessionToken = firstPresent(data.Session, data.SessionId, data.SessionToken);
      let fullAccount = null;
      if (sessionToken) {
        try {
          const accountBase = apiBase.replace(/\/TradingAPI$/i, "");
          const accountResponse = await fetchJsonWithTimeout(`${accountBase}/v2/userAccount/ClientAndTradingAccount`, {
            method: "GET",
            headers: {
              Accept: "application/json",
              "User-Agent": "Forex Auto Bot",
              UserName: username,
              Session: sessionToken,
            },
          }, 12000);
          if (accountResponse.response.ok) {
            fullAccount = accountResponse.data;
          }
        } catch (accountError) {
          console.error("FOREX.com account detail load failed:", accountError.message);
        }
      }

      const accountSummary = fullAccount ? safeAccountSummary(fullAccount, username) : {};
      account = {
        ...account,
        ...data,
        ...accountSummary,
        logonUserName: accountSummary.logonUserName || data.UserName || data.userName || username,
        clientAccountId: accountSummary.clientAccountId || data.ClientAccountId || data.clientAccountId || data.AccountId || data.accountId || null,
        clientAccountCurrency: accountSummary.clientAccountCurrency || data.ClientAccountCurrency || data.clientAccountCurrency || "USD"
      };
    } catch (error) {
      sendJson(res, 200, {
        ok: false,
        error: error.message,
        hint: "Confirm the FOREX.com username, password, AppKey, and API environment variables. The server stayed online and did not place any trade."
      });
      return;
    }

    const localSessionId = crypto.randomUUID();
    sessions.set(localSessionId, {
      username,
      appKey,
      account,
      brokerSession,
      createdAt: new Date().toISOString()
    });
    await saveBrokerSession(username, appKey, brokerSession, account);
    logActivity(
      "connection",
      "FOREX.com connected",
      `Connected account ${account.clientAccountId || "unknown"} for ${account.logonUserName || username}.`,
      "success",
      { clientAccountId: account.clientAccountId }
    );

    sendJson(res, 200, {
      ok: true,
      localSessionId,
      account,
      appKey: maskSecret(appKey)
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/forexcom/snapshot") {
    const session = await resolveSession(url.searchParams.get("sessionId"));
    const latest = await getLatestAccountSnapshot();
    const latestReconciliation = await getLatestReconciliation();
    const profile = await getOrCreateProfile();

    if (!session && latest) {
      const balance = pickBalance(latest);
      sendJson(res, 200, {
        ok: true,
        account: {
          logonUserName: profile.full_name || defaultProfileName,
          clientAccountCurrency: latest.currency || "USD",
          clientAccountId: latest.client_account_id,
        },
        accountValue: balance,
        fallbackBalance: balance,
        margin: latest.raw_margin || null,
        positions: latestReconciliation?.raw_positions || [],
        tradeHistory: latestReconciliation?.raw_trade_history || [],
        activeOrders: latestReconciliation?.raw_active_orders || [],
        performanceSummary: latestReconciliation ? {
          realizedProfitLoss: latestReconciliation.realized_profit_loss,
          openProfitLoss: latestReconciliation.open_profit_loss,
          totalProfitLoss: latestReconciliation.total_profit_loss,
          reconciledAt: latestReconciliation.updated_at,
        } : null,
        primaryTradingAccount: latest.trading_account_id ? { tradingAccountId: latest.trading_account_id } : null,
        accountValueSource: latest.source || "Supabase account_snapshots",
      });
      return;
    }

    if (!session) {
      sendJson(res, 200, {
        ok: true,
        account: {
          logonUserName: profile.full_name || defaultProfileName,
          clientAccountCurrency: "USD",
          clientAccountId: null,
        },
        accountValue: null,
        positions: [],
        tradeHistory: [],
        primaryTradingAccount: null,
        accountValueSource: "No active FOREX.com session yet",
      });
      return;
    }

    const balance = pickBalance(session.account) || pickBalance(latest || {});
    let reconciliation = null;
    try {
      reconciliation = await reconcileForexAccount(session);
      await saveReconciliation(session, reconciliation);
    } catch (error) {
      logActivity(
        "reconcile_error",
        "FOREX.com reconciliation failed",
        error.message,
        "warning"
      );
    }

    sendJson(res, 200, {
      ok: true,
      account: session.account,
      accountValue: balance,
      fallbackBalance: latest ? pickBalance(latest) : null,
      positions: reconciliation?.positions || latestReconciliation?.raw_positions || [],
      tradeHistory: reconciliation?.tradeHistory || latestReconciliation?.raw_trade_history || [],
      activeOrders: reconciliation?.activeOrders || latestReconciliation?.raw_active_orders || [],
      performanceSummary: reconciliation?.summary || (latestReconciliation ? {
        realizedProfitLoss: latestReconciliation.realized_profit_loss,
        openProfitLoss: latestReconciliation.open_profit_loss,
        totalProfitLoss: latestReconciliation.total_profit_loss,
        reconciledAt: latestReconciliation.updated_at,
      } : null),
      primaryTradingAccount: session.account?.tradingAccounts?.[0] || null,
      accountValueSource: balance ? "FOREX.com session or Supabase snapshot" : "connected session fallback"
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/forexcom/latest-account-value") {
    const latest = await getLatestAccountSnapshot();
    const balance = latest ? pickBalance(latest) : null;
    sendJson(res, 200, {
      ok: Boolean(balance),
      balance,
      currency: latest?.currency || "USD",
      source: latest?.source || "Supabase account_snapshots",
      updatedAt: latest?.updated_at || null,
      error: balance ? undefined : "No saved account snapshot found yet."
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/forexcom/margin") {
    const latest = await getLatestAccountSnapshot();
    const balance = latest ? pickBalance(latest.raw_margin || latest) : null;
    sendJson(res, 200, {
      ok: Boolean(balance),
      balance,
      margin: latest?.raw_margin || null,
      source: latest?.source || "Supabase account_snapshots",
      warning: "Vercel reads the latest always-on engine snapshot instead of holding a Lightstreamer connection.",
      error: balance ? undefined : "No margin snapshot has been saved yet."
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/supabase/check") {
    const profile = await getOrCreateProfile();
    const counts = {
      brokerConnections: await countSupabaseRows("broker_connections"),
      botSettings: await countSupabaseRows("bot_settings"),
      tradeLogs: await countSupabaseRows("trade_logs"),
      accountSnapshots: await countSupabaseRows("account_snapshots"),
      priceSnapshots: await countSupabaseRows("price_snapshots"),
      accountReconciliations: await countSupabaseRows("account_reconciliations"),
    };
    sendJson(res, 200, { ok: true, profile, counts });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/bot/settings") {
    const body = await readBody(req);
    await hydrateBotSettings();
    const nextBotEnabled = Boolean(body.botEnabled);
    const nextAutoExecutionAuthorized = Boolean(body.autoExecutionAuthorized);
    if (liveTradingUnlocked && nextBotEnabled && !nextAutoExecutionAuthorized) {
      logActivity(
        "risk_rejection",
        "Bot start rejected",
        "Automatic live-trade authorization was missing while live mode was unlocked.",
        "warning"
      );
      sendJson(res, 400, {
        ok: false,
        error: "Automatic live-trade authorization is required before starting the bot in live mode.",
      });
      return;
    }

    localBotSettings = {
      ...localBotSettings,
      riskPerTrade: Number(body.riskPerTrade ?? localBotSettings.riskPerTrade),
      dailyStop: Number(body.dailyStop ?? localBotSettings.dailyStop),
      rewardRiskRatio: Number(body.rewardRiskRatio ?? localBotSettings.rewardRiskRatio),
      maxDailyLossUsd: Number(body.maxDailyLossUsd ?? localBotSettings.maxDailyLossUsd),
      dailyProfitGoalUsd: Number(body.dailyProfitGoalUsd ?? localBotSettings.dailyProfitGoalUsd),
      newsFilter: body.newsFilter !== false,
      botEnabled: nextBotEnabled,
      autoExecutionAuthorized: nextAutoExecutionAuthorized,
    };

    try {
      const profile = await getOrCreateProfile();
      const settingsRow = {
        profile_id: profile.id || null,
        risk_per_trade: localBotSettings.riskPerTrade,
        daily_stop: localBotSettings.dailyStop,
        reward_risk_ratio: localBotSettings.rewardRiskRatio,
        max_daily_loss_usd: localBotSettings.maxDailyLossUsd,
        daily_profit_goal_usd: localBotSettings.dailyProfitGoalUsd,
        news_filter: localBotSettings.newsFilter,
        bot_enabled: localBotSettings.botEnabled,
        auto_execution_authorized: localBotSettings.autoExecutionAuthorized,
        updated_at: new Date().toISOString(),
      };
      await supabaseFetch("/bot_settings", {
        method: "POST",
        prefer: "return=minimal,resolution=merge-duplicates",
        body: JSON.stringify([settingsRow]),
      });
    } catch (error) {
      if (!String(error.message).includes("reward_risk_ratio")) {
        sendJson(res, 500, {
          ok: false,
          error: `Could not save bot settings to Supabase: ${error.message}`,
        });
        return;
      }

      try {
        const profile = await getOrCreateProfile();
        await supabaseFetch("/bot_settings", {
          method: "POST",
          prefer: "return=minimal,resolution=merge-duplicates",
          body: JSON.stringify([{
            profile_id: profile.id || null,
            risk_per_trade: localBotSettings.riskPerTrade,
            daily_stop: localBotSettings.dailyStop,
            max_daily_loss_usd: localBotSettings.maxDailyLossUsd,
            daily_profit_goal_usd: localBotSettings.dailyProfitGoalUsd,
            news_filter: localBotSettings.newsFilter,
            bot_enabled: localBotSettings.botEnabled,
            auto_execution_authorized: localBotSettings.autoExecutionAuthorized,
            updated_at: new Date().toISOString(),
          }]),
        });
        localBotSettings.rewardRiskRatioNeedsMigration = true;
      } catch (retryError) {
        sendJson(res, 500, {
          ok: false,
          error: `Could not save bot settings to Supabase: ${retryError.message}`,
        });
        return;
      }
    }

    logActivity(
      "bot_settings",
      nextBotEnabled ? "Bot armed" : "Bot stopped",
      nextBotEnabled
        ? `Bot armed with ${localBotSettings.riskPerTrade}% risk, $${localBotSettings.maxDailyLossUsd} daily loss cap, and $${localBotSettings.dailyProfitGoalUsd} daily goal.`
        : "Bot stopped. No new automatic trades can be sent.",
      nextBotEnabled ? "success" : "warning",
      { settings: localBotSettings }
    );

    sendJson(res, 200, { ok: true, settings: localBotSettings });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/live/status") {
    await hydrateBotSettings();
    const orderExecutionWired = true;
    sendJson(res, 200, {
      ok: true,
      settings: localBotSettings,
      liveTradingEnabled: liveTradingUnlocked,
      autoExecutionAuthorized: localBotSettings.autoExecutionAuthorized,
      liveExecutionReady: enableLiveTrading && liveTradingUnlocked && localBotSettings.autoExecutionAuthorized && orderExecutionWired,
      botArmed: liveTradingUnlocked && localBotSettings.botEnabled && localBotSettings.autoExecutionAuthorized,
      orderExecutionWired,
      executionMessage: orderExecutionWired
        ? "Live order execution is wired. Real orders still require a valid signal, stop loss, take profit, fresh FOREX.com prices, and risk approval."
        : "The bot can scan real markets, but automatic FOREX.com order placement is not wired yet.",
      dailyLoss: 0,
      dailyProfit: 0,
      limits: {
        maxLiveTradeQuantity: Number(process.env.MAX_LIVE_TRADE_QUANTITY || 1000),
        maxDailyLiveTrades: Number(process.env.MAX_DAILY_LIVE_TRADES || 1),
        maxOpenPositions: Number(process.env.MAX_OPEN_POSITIONS || 1),
        maxLiveSpreadPips: Number(process.env.MAX_LIVE_SPREAD_PIPS || 2),
        maxDailyLossUsd: Number(localBotSettings.maxDailyLossUsd || process.env.MAX_DAILY_LOSS_USD || 100),
        backendMaxDailyLossUsd: Number(process.env.MAX_DAILY_LOSS_USD || 100),
        dailyProfitGoalUsd: Number(localBotSettings.dailyProfitGoalUsd || 0),
        riskPerTrade: Number(localBotSettings.riskPerTrade || 1),
        dailyStop: Number(localBotSettings.dailyStop || 4),
        rewardRiskRatio: Number(localBotSettings.rewardRiskRatio || 2),
      },
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/live/lock") {
    const body = await readBody(req);
    liveTradingUnlocked = Boolean(body.unlocked);
    if (!liveTradingUnlocked) {
      localBotSettings.botEnabled = false;
      localBotSettings.autoExecutionAuthorized = false;
    }

    logActivity(
      "live_lock",
      liveTradingUnlocked ? "Live mode unlocked" : "Live mode locked",
      liveTradingUnlocked
        ? "Live mode was unlocked in the app. The bot still requires authorization and risk approval before any trade."
        : "Live mode was locked and automatic execution authorization was cleared.",
      liveTradingUnlocked ? "warning" : "success"
    );

    sendJson(res, 200, {
      ok: true,
      liveTradingEnabled: liveTradingUnlocked,
      autoExecutionAuthorized: localBotSettings.autoExecutionAuthorized,
      liveExecutionReady: false,
      botArmed: liveTradingUnlocked && localBotSettings.botEnabled && localBotSettings.autoExecutionAuthorized,
      orderExecutionWired: true,
      executionMessage: "Live order execution is wired. The backend still must have ENABLE_LIVE_TRADING=true before real orders can be sent.",
      warning: enableLiveTrading
        ? null
        : "Live mode can be unlocked in the app, but real order execution still requires ENABLE_LIVE_TRADING=true on the backend.",
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/validation/status") {
    const strategies = listStrategies();
    sendJson(res, 200, {
      ok: true,
      validations: strategies.map((strategy) => ({
        strategy,
        approved: false,
        failures: [
          "backtest_required",
          "out_of_sample_required",
          "walk_forward_required",
          "stress_test_required",
          "paper_trading_required",
          "risk_disclosure_required",
        ],
      })),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/live/emergency-stop") {
    localBotSettings.botEnabled = false;
    localBotSettings.autoExecutionAuthorized = false;
    liveTradingUnlocked = false;
    logActivity(
      "kill_switch",
      "Emergency stop activated",
      "Live mode locked, bot stopped, and automatic execution authorization cleared.",
      "danger"
    );
    sendJson(res, 200, { ok: true, liveTradingEnabled: false, botArmed: false });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/live/reconcile") {
    const session = await resolveSession(url.searchParams.get("sessionId"));
    if (!session) {
      sendJson(res, 401, {
        ok: false,
        error: "Connect to FOREX.com first.",
      });
      return;
    }
    const reconciliation = await reconcileForexAccount(session);
    await saveReconciliation(session, reconciliation);
    logActivity(
      "reconcile",
      "FOREX.com orders reconciled",
      `Checked ${reconciliation.positions.length} open position(s), ${reconciliation.activeOrders.length} active order(s), and ${reconciliation.tradeHistory.length} trade history row(s).`,
      reconciliation.summary.errors.length ? "warning" : "info",
      reconciliation.summary
    );
    sendJson(res, 200, {
      ok: true,
      positions: reconciliation.positions,
      activeOrders: reconciliation.activeOrders,
      tradeHistory: reconciliation.tradeHistory,
      summary: reconciliation.summary,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/live/trade") {
    const body = await readBody(req);
    await hydrateBotSettings();

    const decision = body.decision || body.signal || body;
    const direction = normaliseTradeDirection(decision.direction || decision.rawDirection);
    const rejection = !enableLiveTrading
      ? "Backend live execution flag is off. Set ENABLE_LIVE_TRADING=true only when you are ready for real orders."
      : !liveTradingUnlocked
        ? "Live trading is locked in the app."
        : !localBotSettings.botEnabled
          ? "Bot is stopped."
          : !localBotSettings.autoExecutionAuthorized
            ? "Automatic live execution has not been authorized in Bot controls."
            : !direction
              ? "Live order rejected: no BUY or SELL signal."
              : null;

    if (rejection) {
      await saveSupabaseBotActivity(
        "live_trade_rejected",
        "Live trade rejected",
        rejection,
        "warning",
        { decision }
      );
      sendJson(res, 423, { ok: false, error: rejection });
      return;
    }

    const limits = mergeRiskLimits({
      maxRiskAmount: Number(localBotSettings.maxDailyLossUsd || process.env.MAX_DAILY_LOSS_USD || 100),
      maxRewardRiskRatioMinimum: Number(localBotSettings.rewardRiskRatio || 2),
      maxSpreadPips: Number(process.env.MAX_LIVE_SPREAD_PIPS || 2),
      requireStopLoss: true,
    });
    const approval = approveTrade({
      direction,
      stopLoss: decision.suggestedStop || decision.stopLoss,
      takeProfit: decision.suggestedTakeProfit || decision.takeProfit,
      riskAmount: decision.expectedRisk,
      rewardRiskRatio: decision.rewardRiskRatio || localBotSettings.rewardRiskRatio,
      spreadPips: decision.liveSpread === "--" ? null : decision.liveSpread,
    }, limits);
    const approvalViolations = approval.violations || approval.rejections || [];
    if (!approval.approved) {
      await saveSupabaseBotActivity(
        "live_trade_rejected",
        "Risk manager rejected trade",
        approvalViolations.join(" ") || "Risk manager rejected the trade.",
        "warning",
        { decision, approval }
      );
      sendJson(res, 422, {
        ok: false,
        error: approvalViolations.join(" ") || "Risk manager rejected the trade.",
        approval,
      });
      return;
    }

    const session = await resolveSession(body.sessionId);
    if (!session) {
      await saveSupabaseBotActivity(
        "live_trade_rejected",
        "FOREX.com session missing",
        "Live order rejected because the backend could not create or load a FOREX.com session.",
        "danger",
        { decision }
      );
      sendJson(res, 401, {
        ok: false,
        error: "Connect to FOREX.com first or set FOREXCOM_USERNAME, FOREXCOM_PASSWORD, and FOREXCOM_APP_KEY on the backend.",
      });
      return;
    }

    try {
      const tradeResult = await submitForexLiveTrade({
        session,
        decision,
        quantity: body.quantity,
      });
      await saveSupabaseBotActivity(
        "live_trade_sent",
        `${direction} order sent`,
        `${decision.market} ${direction} order sent to FOREX.com with ${tradeResult.orderRequest.Quantity} units, stop ${tradeResult.orderRequest.IfDone[0].Stop.TriggerPrice}, and take profit ${tradeResult.orderRequest.IfDone[0].Limit.TriggerPrice}.`,
        "success",
        {
          decision,
          brokerResponse: tradeResult.brokerResponse,
          spreadPips: tradeResult.spreadPips,
          reconciliation: tradeResult.reconciliation,
        }
      );
      sendJson(res, 200, {
        ok: true,
        message: "Live order sent to FOREX.com and account was reconciled afterward.",
        decision,
        result: tradeResult,
      });
    } catch (error) {
      await saveSupabaseBotActivity(
        "live_trade_rejected",
        "Live order not sent",
        error.message,
        "danger",
        { decision }
      );
      sendJson(res, 422, {
        ok: false,
        error: error.message,
      });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/forexcom/prices") {
    const snapshotPrices = await getLatestPriceSnapshots(50);
    if (snapshotPrices.length) {
      const newest = snapshotPrices
        .map((price) => Date.parse(price.updatedAt || price.tickDate || 0))
        .filter(Number.isFinite)
        .sort((a, b) => b - a)[0];
      const stale = newest ? Date.now() - newest > 120000 : true;
      sendJson(res, 200, {
        ok: true,
        prices: snapshotPrices,
        source: "FOREX.com Lightstreamer PRICES via Supabase",
        warning: stale ? "Price snapshots are older than 2 minutes. Confirm the Railway worker is running." : undefined,
      });
      return;
    }

    const session = await resolveSession(url.searchParams.get("sessionId"));
    if (!session) {
      sendJson(res, 401, {
        ok: false,
        prices: [],
        error: "Connect to FOREX.com first. Live bid/offer prices require a broker session.",
      });
      return;
    }

    const markets = String(url.searchParams.get("markets") || defaultPriceMarkets.join(","))
      .split(",")
      .map((market) => market.trim())
      .filter(Boolean)
      .slice(0, 15);
    const results = await Promise.allSettled(markets.map((market) => fetchRestPriceSnapshot(session, market)));
    const prices = results
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value)
      .filter((price) => price.bid !== null || price.offer !== null || price.mid !== null);

    if (!prices.length) {
      logActivity(
        "market_data",
        "Live prices unavailable",
        "FOREX.com returned no bid/offer prices from Lightstreamer snapshots or REST tick history.",
        "warning",
        { errors: results.filter((result) => result.status === "rejected").map((result) => result.reason.message).slice(0, 5) }
      );
      sendJson(res, 502, {
        ok: false,
        prices: [],
        error: "FOREX.com did not return live bid/offer prices. Confirm the Railway worker is deployed and the price_snapshots table exists.",
        source: "FOREX.com PRICES",
      });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      prices,
      source: "FOREX.com tickhistorybefore",
      warning: "Using real broker tick history because no Lightstreamer price snapshots are saved yet.",
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/forexcom/markets") {
    const session = await resolveSession(url.searchParams.get("sessionId"));
    const query = String(url.searchParams.get("query") || "EUR/USD").toUpperCase();
    const market = await findForexMarket(session, query);
    sendJson(res, 200, { ok: true, markets: [market.raw] });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/forexcom/candles") {
    const session = await resolveSession(url.searchParams.get("sessionId"));
    const market = url.searchParams.get("market") || "EUR/USD";
    const maxResults = Math.min(Number(url.searchParams.get("maxResults") || 80), 120);
    const { marketInfo, bars } = await fetchRealCandles(session, market, maxResults);

    logActivity(
      "chart",
      "Candlestick chart loaded",
      `Loaded ${bars.length} real ${marketInfo.marketName} candles from FOREX.com.`,
      "info",
      { market, marketId: marketInfo.marketId, count: bars.length, source: "FOREX.com barhistory" }
    );
    sendJson(res, 200, { ok: true, bars, market: marketInfo, source: "FOREX.com barhistory" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/demo/positions") {
    sendJson(res, 200, {
      ok: true,
      disabled: true,
      message: "Synthetic demo positions are disabled. Paper trading must be rebuilt from real FOREX.com market data.",
      positions: [],
      summary: {
        openCount: 0,
        closedCount: 0,
        realizedProfitLoss: 0,
      },
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/demo/open") {
    logActivity(
      "paper_trade_disabled",
      "Synthetic paper trade blocked",
      "Paper trading is disabled until it is connected to real FOREX.com market data.",
      "warning"
    );
    sendJson(res, 423, {
      ok: false,
      error: "Synthetic paper trading is disabled. Connect real FOREX.com market data before paper trades are created.",
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/demo/mark") {
    logActivity(
      "paper_trade_disabled",
      "Synthetic paper marking blocked",
      "No simulated P/L was generated because fake paper trade marking is disabled.",
      "warning"
    );
    sendJson(res, 423, {
      ok: false,
      error: "Synthetic P/L marking is disabled. No fake trade results are generated.",
    });
    return;
  }

  if (req.method === "POST" && (url.pathname === "/api/bot/run" || url.pathname === "/api/bot/scan")) {
    const body = await readBody(req);
    const session = await resolveSession(body.sessionId);
    if (!session) {
      sendJson(res, 401, {
        ok: false,
        error: "Connect to FOREX.com first. Strategy scans require real broker candle data.",
      });
      return;
    }

    const scannedMarkets = url.pathname.endsWith("/scan") ? 15 : 1;
    const markets = scannedMarkets === 1 ? [body.market || "EUR/USD"] : defaultPriceMarkets;
    const accountSnapshot = await getLatestAccountSnapshot();
    const balance = pickBalance(accountSnapshot?.raw_margin || accountSnapshot)?.value || 10000;
    const riskPerTrade = Math.min(Number(body.riskPerTrade || 1), 2);
    const rewardRiskRatio = Math.max(Number(body.rewardRiskRatio || 2), 1);
    const priceSnapshots = await getLatestPriceSnapshots(50);
    const priceByMarket = new Map(priceSnapshots.map((price) => [String(price.market).toUpperCase(), price]));

    const results = await Promise.allSettled(markets.map(async (marketName) => {
      const { bars } = await fetchRealCandles(session, marketName, 80);
      const price = priceByMarket.get(String(marketName).toUpperCase()) || null;
      return evaluateMovingAverageStrategy({
        marketName,
        candles: bars,
        price,
        balance,
        riskPerTrade,
        rewardRiskRatio,
      });
    }));

    const decisions = results
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);
    const rejected = results
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason.message);

    if (!decisions.length) {
      sendJson(res, 502, {
        ok: false,
        error: `FOREX.com returned no usable candle data for the ${scannedMarkets} strategy scan.`,
        rejected,
      });
      return;
    }

    const tradeCandidates = decisions
      .filter((item) => item.riskApproved && ["BUY", "SELL"].includes(item.rawDirection))
      .sort((a, b) => b.signalStrength - a.signalStrength);
    const decision = tradeCandidates[0] || decisions.sort((a, b) => b.signalStrength - a.signalStrength)[0];
    logActivity(
      "strategy_scan",
      ["BUY", "SELL"].includes(decision.direction) ? `${decision.direction} setup found` : "No qualified trade",
      ["BUY", "SELL"].includes(decision.direction)
        ? `Scanned ${decisions.length} real market(s). ${decision.market} produced a risk-approved ${decision.direction} setup.`
        : `Scanned ${decisions.length} real market(s). No trade passed the strategy and risk filters.`,
      ["BUY", "SELL"].includes(decision.direction) ? "success" : "info",
      { decision, decisions, rejected, scannedMarkets }
    );

    sendJson(res, 200, {
      ok: true,
      decision,
      selected: decision,
      decisions,
      rejected,
      scannedMarkets: decisions.length,
      priceSource: decision.priceSource,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/signal") {
    const body = await readBody(req);
    const signal = generateLiveDataRequiredSignal(body);

    const limits = mergeRiskLimits(body.riskLimits || {});
    const approval = approveTrade({
      signal: {
        strategyName: "moving-average-profit-rule",
        market: signal.market,
        direction: signal.direction,
        entryPrice: signal.entryPrice,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        riskPercentage: body.riskPercent || 1,
        rewardRiskRatio: signal.rewardRiskRatio,
        spreadPips: 1
      },
      account: { equity: body.balance || 10000, balance: body.balance || 10000 },
      market: { spreadPips: 1 },
      limits
    });

    sendJson(res, 200, {
      signal,
      approval
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/risk/approve") {
    const body = await readBody(req);
    const limits = mergeRiskLimits(body.limits || {});
    const approval = approveTrade({
      signal: body.trade || body.signal || {},
      account: body.account || {},
      market: body.market || {},
      limits,
      state: body.state || {}
    });

    sendJson(res, 200, approval);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/validate") {
    const body = await readBody(req);
    const result = evaluateValidationReport(body);

    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/journal") {
    const body = await readBody(req);
    const entry = buildTradeJournalEntry(body);

    sendJson(res, 200, entry);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/forex/status") {
    sendJson(res, 200, {
      connected: false,
      mode: "safe_demo",
      liveTradingEnabled: envBool(process.env.ENABLE_LIVE_TRADING),
      message: "Server is running. Broker connection is not active in this safe Vercel fallback."
    });
    return;
  }

  sendJson(res, 404, {
    error: "API route not found",
    path: url.pathname
  });
}

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, "http://localhost");

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res);
      return;
    }

    serveStatic(req, res);
  } catch (error) {
    console.error("Server error:", error);

    sendJson(res, 500, {
      error: "Internal server error",
      message: error.message
    });
  }
}

const server = http.createServer(handleRequest);

module.exports = handleRequest;

if (!process.env.VERCEL) {
  server.listen(port, () => {
    console.log(`Forex Auto Bot running at http://localhost:${port}`);
  });
}
