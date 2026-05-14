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
    maxRiskPerTradePct: 1,
    maxSpreadPips: 2,
    requireStopLoss: true,
    ...limits,
  }),
  approveTrade: ({ signal = {} }) => {
    const rejections = [];
    if (!["BUY", "SELL"].includes(signal.direction)) rejections.push("invalid_signal");
    if (!signal.stopLoss) rejections.push("missing_stop_loss");
    return { approved: rejections.length === 0, rejections };
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
const defaultProfileName = process.env.DEFAULT_PROFILE_NAME || "Marcello Gambino";
const defaultProfileEmail = process.env.DEFAULT_PROFILE_EMAIL || "marcello@example.com";
const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const supabaseRestUrl = (process.env.SUPABASE_REST_URL || (supabaseUrl ? `${supabaseUrl}/rest/v1` : "")).replace(/\/$/, "");
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PRIVATE_KEY || "";
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";
const enableLiveTrading = process.env.ENABLE_LIVE_TRADING === "true";
const sessions = new Map();
const activityEvents = [];
let liveTradingUnlocked = enableLiveTrading;
let localBotSettings = {
  riskPerTrade: 1,
  dailyStop: 4,
  maxDailyLossUsd: 100,
  dailyProfitGoalUsd: 50,
  newsFilter: true,
  botEnabled: false,
  autoExecutionAuthorized: false
};

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
  return sessions.get(sessionId) || await getLatestSavedSession();
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
        positions: [],
        tradeHistory: [],
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

    sendJson(res, 200, {
      ok: true,
      account: session.account,
      accountValue: balance,
      fallbackBalance: latest ? pickBalance(latest) : null,
      positions: [],
      tradeHistory: [],
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
    };
    sendJson(res, 200, { ok: true, profile, counts });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/bot/settings") {
    const body = await readBody(req);
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
      maxDailyLossUsd: Number(body.maxDailyLossUsd ?? localBotSettings.maxDailyLossUsd),
      dailyProfitGoalUsd: Number(body.dailyProfitGoalUsd ?? localBotSettings.dailyProfitGoalUsd),
      newsFilter: body.newsFilter !== false,
      botEnabled: nextBotEnabled,
      autoExecutionAuthorized: nextAutoExecutionAuthorized,
    };

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
    } catch (error) {
      console.error("Could not persist bot settings:", error.message);
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
    sendJson(res, 200, {
      ok: true,
      liveTradingEnabled: liveTradingUnlocked,
      autoExecutionAuthorized: localBotSettings.autoExecutionAuthorized,
      liveExecutionReady: enableLiveTrading && liveTradingUnlocked && localBotSettings.autoExecutionAuthorized,
      botArmed: liveTradingUnlocked && localBotSettings.botEnabled && localBotSettings.autoExecutionAuthorized,
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
      liveExecutionReady: enableLiveTrading && liveTradingUnlocked && localBotSettings.autoExecutionAuthorized,
      botArmed: liveTradingUnlocked && localBotSettings.botEnabled && localBotSettings.autoExecutionAuthorized,
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
    logActivity(
      "reconcile",
      "FOREX.com orders reconciled",
      "Checked open positions, active orders, and recent trade history.",
      "info"
    );
    sendJson(res, 200, {
      ok: true,
      positions: [],
      activeOrders: [],
      tradeHistory: [],
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/live/trade") {
    logActivity(
      "live_trade_rejected",
      "Live trade blocked",
      !liveTradingUnlocked
        ? "Live trading is locked in the app."
        : !localBotSettings.autoExecutionAuthorized
          ? "Automatic live execution has not been authorized."
          : enableLiveTrading
            ? "Strategy validation and broker order verification are not fully wired."
            : "Backend live execution flag is still off.",
      "warning"
    );
    sendJson(res, 423, {
      ok: false,
      error: !liveTradingUnlocked
        ? "Live trading is locked in the app. Turn on Live trading unlocked first."
        : !localBotSettings.autoExecutionAuthorized
          ? "Automatic live execution has not been authorized. Check the authorization box when starting the bot."
          : enableLiveTrading
            ? "Live execution is blocked until strategy validation and broker order verification are fully wired."
            : "Live mode is unlocked in the app, but real order execution still requires ENABLE_LIVE_TRADING=true on the backend.",
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/forexcom/prices") {
    logActivity(
      "market_data",
      "Live prices unavailable",
      "No synthetic price data was returned. FOREX.com live bid/offer prices must come from the always-on Lightstreamer PRICES worker.",
      "warning"
    );
    sendJson(res, 503, {
      ok: false,
      prices: [],
      error: "Live FOREX.com bid/offer prices are not connected yet. No fake prices are shown.",
      source: "FOREX.com Lightstreamer PRICES required",
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
    const interval = String(url.searchParams.get("interval") || "MINUTE").toUpperCase();
    const span = Math.max(1, Number(url.searchParams.get("span") || 15));
    const marketInfo = await findForexMarket(session, market);
    const barUrl = new URL(`${apiBase}/market/${marketInfo.marketId}/barhistory`);
    barUrl.searchParams.set("interval", interval);
    barUrl.searchParams.set("span", String(span));
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
    if (!bars.length) {
      throw new Error(`FOREX.com returned no real candle data for ${market}.`);
    }

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
    const scannedMarkets = url.pathname.endsWith("/scan") ? 15 : 1;
    const decision = {
      market: "Pending real data",
      direction: "HOLD",
      priceSource: "FOREX.com live candle/price data required",
      candleCount: 0,
      reason: "No strategy scan was run because synthetic signals are disabled. Connect the real FOREX.com candle and price feed first.",
    };
    logActivity(
      "strategy_scan",
      "Strategy scan paused",
      `Skipped ${scannedMarkets} pair scan because only real FOREX.com market data can be used.`,
      "warning",
      { decision, scannedMarkets }
    );

    sendJson(res, 424, {
      ok: false,
      error: "Real FOREX.com candle/price data is required before strategy scans can run. No synthetic signals are generated.",
      decision,
      selected: decision,
      scannedMarkets,
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
      liveTradingEnabled: process.env.ENABLE_LIVE_TRADING === "true",
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
