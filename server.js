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
const liveTradingConfirmText = process.env.LIVE_TRADING_CONFIRM_TEXT || "I UNDERSTAND LIVE TRADING CAN LOSE MONEY";
const sessions = new Map();
const demoPositions = [];
let localBotSettings = {
  riskPerTrade: 1,
  dailyStop: 4,
  maxDailyLossUsd: 100,
  dailyProfitGoalUsd: 50,
  newsFilter: true,
  botEnabled: false
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
  generateSignal: generateDemoSignal
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

function demoPriceRows() {
  const base = [
    ["EUR/USD", 1.08124],
    ["GBP/USD", 1.27485],
    ["USD/JPY", 156.42],
    ["USD/CHF", 0.9062],
    ["AUD/USD", 0.6618],
    ["USD/CAD", 1.3665],
    ["NZD/USD", 0.6041],
    ["EUR/GBP", 0.8483],
    ["EUR/JPY", 169.15],
    ["GBP/JPY", 199.42],
    ["AUD/JPY", 103.54],
    ["CAD/JPY", 114.48],
    ["EUR/CHF", 0.9799],
    ["GBP/CHF", 1.1548],
    ["AUD/CAD", 0.9042],
  ];
  const now = Date.now() / 60000;
  return base.map(([market, mid], index) => {
    const drift = Math.sin(now + index) * (market.includes("JPY") ? 0.03 : 0.0003);
    const spread = market.includes("JPY") ? 0.02 : 0.00018;
    const liveMid = Number((mid + drift).toFixed(market.includes("JPY") ? 3 : 5));
    return {
      market,
      bid: Number((liveMid - spread / 2).toFixed(market.includes("JPY") ? 3 : 5)),
      offer: Number((liveMid + spread / 2).toFixed(market.includes("JPY") ? 3 : 5)),
      mid: liveMid,
      spread: Number(spread.toFixed(market.includes("JPY") ? 3 : 5)),
    };
  });
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

function generateDemoSignal(body = {}) {
  const market = body.market || "EUR/USD";
  const balance = Number(body.balance || 10000);
  const riskPercent = Number(body.riskPercent || 1);
  const rewardRiskRatio = Number(body.rewardRiskRatio || 2);

  const direction = Math.random() > 0.5 ? "BUY" : "SELL";
  const entry = Number((1.07 + Math.random() * 0.04).toFixed(5));
  const stopDistance = 0.002;
  const takeProfitDistance = stopDistance * rewardRiskRatio;

  const stopLoss =
    direction === "BUY"
      ? Number((entry - stopDistance).toFixed(5))
      : Number((entry + stopDistance).toFixed(5));

  const takeProfit =
    direction === "BUY"
      ? Number((entry + takeProfitDistance).toFixed(5))
      : Number((entry - takeProfitDistance).toFixed(5));

  const riskAmount = Number((balance * (riskPercent / 100)).toFixed(2));
  const expectedProfit = Number((riskAmount * rewardRiskRatio).toFixed(2));

  return {
    id: crypto.randomUUID(),
    market,
    direction,
    entry,
    stopLoss,
    takeProfit,
    riskAmount,
    expectedProfit,
    rewardRiskRatio,
    status: "demo_signal",
    reason: "Demo signal generated. Live trading remains disabled unless configured separately.",
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
    localBotSettings = {
      ...localBotSettings,
      riskPerTrade: Number(body.riskPerTrade ?? localBotSettings.riskPerTrade),
      dailyStop: Number(body.dailyStop ?? localBotSettings.dailyStop),
      maxDailyLossUsd: Number(body.maxDailyLossUsd ?? localBotSettings.maxDailyLossUsd),
      dailyProfitGoalUsd: Number(body.dailyProfitGoalUsd ?? localBotSettings.dailyProfitGoalUsd),
      newsFilter: body.newsFilter !== false,
      botEnabled: Boolean(body.botEnabled),
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
          updated_at: new Date().toISOString(),
        }]),
      });
    } catch (error) {
      console.error("Could not persist bot settings:", error.message);
    }

    sendJson(res, 200, { ok: true, settings: localBotSettings });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/live/status") {
    sendJson(res, 200, {
      ok: true,
      liveTradingEnabled: enableLiveTrading,
      botArmed: enableLiveTrading && localBotSettings.botEnabled,
      dailyLoss: 0,
      dailyProfit: 0,
      confirmText: liveTradingConfirmText,
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
    sendJson(res, 200, { ok: true, botArmed: false });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/live/reconcile") {
    sendJson(res, 200, {
      ok: true,
      positions: [],
      activeOrders: [],
      tradeHistory: [],
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/live/trade") {
    sendJson(res, 423, {
      ok: false,
      error: enableLiveTrading
        ? "Live execution is blocked until strategy validation and broker order verification are fully wired."
        : "Live trading is locked by backend. Keep ENABLE_LIVE_TRADING=false until validation is complete.",
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/forexcom/prices") {
    sendJson(res, 200, {
      ok: true,
      prices: demoPriceRows(),
      source: "dashboard price board fallback",
      warning: "FOREX.com live price streaming should run from the always-on backend; this Vercel route keeps the board usable while that worker is connected.",
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/forexcom/markets") {
    const query = String(url.searchParams.get("query") || "EUR/USD").toUpperCase();
    const prices = demoPriceRows()
      .filter((price) => price.market.includes(query.replace(/[^A-Z/]/g, "")) || query.includes(price.market))
      .map((price, index) => ({
        Name: price.market,
        MarketName: price.market,
        MarketId: 400000 + index,
        MarketType: "Currency",
        Currency: price.market.slice(0, 3),
      }));
    sendJson(res, 200, { ok: true, markets: prices.length ? prices : [] });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/forexcom/candles") {
    const market = url.searchParams.get("market") || "EUR/USD";
    const maxResults = Math.min(Number(url.searchParams.get("maxResults") || 80), 120);
    const seed = demoPriceRows().find((price) => price.market === market)?.mid || 1.08;
    const bars = Array.from({ length: maxResults }, (_, index) => {
      const wave = Math.sin(index / 4) * 0.0015;
      const open = seed + wave;
      const close = open + Math.sin(index / 3) * 0.0007;
      const high = Math.max(open, close) + 0.0008;
      const low = Math.min(open, close) - 0.0008;
      return {
        BarDate: new Date(Date.now() - (maxResults - index) * 15 * 60 * 1000).toISOString(),
        Open: Number(open.toFixed(5)),
        High: Number(high.toFixed(5)),
        Low: Number(low.toFixed(5)),
        Close: Number(close.toFixed(5)),
      };
    });
    sendJson(res, 200, { ok: true, bars, source: "dashboard candle fallback" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/demo/positions") {
    const closed = demoPositions.filter((position) => position.status === "closed");
    sendJson(res, 200, {
      ok: true,
      positions: demoPositions.filter((position) => position.status !== "closed"),
      summary: {
        openCount: demoPositions.filter((position) => position.status !== "closed").length,
        closedCount: closed.length,
        realizedProfitLoss: closed.reduce((total, position) => total + Number(position.profitLoss || 0), 0),
      },
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/demo/open") {
    const body = await readBody(req);
    const signal = generateDemoSignal(body);
    demoPositions.push({
      id: signal.id,
      market: signal.market,
      direction: signal.direction,
      entry: signal.entry,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      status: "open",
      openedAt: signal.createdAt,
    });
    sendJson(res, 200, { ok: true, opened: true, signal });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/demo/mark") {
    for (const position of demoPositions.filter((item) => item.status !== "closed")) {
      position.status = "closed";
      position.closedAt = new Date().toISOString();
      position.profitLoss = Number(((Math.random() - 0.45) * 20).toFixed(2));
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && (url.pathname === "/api/bot/run" || url.pathname === "/api/bot/scan")) {
    const body = await readBody(req);
    const scannedMarkets = url.pathname.endsWith("/scan") ? 15 : 1;
    const signal = generateDemoSignal({
      ...body,
      balance: body.balance || 5149.16,
      riskPercent: body.riskPerTrade || 1,
      rewardRiskRatio: body.rewardRiskRatio || 2,
    });
    const direction = Math.random() > 0.35 ? "HOLD" : signal.direction;
    const decision = {
      market: signal.market,
      direction,
      lastPrice: signal.entry,
      shortMa: Number((signal.entry + 0.0004).toFixed(5)),
      longMa: Number((signal.entry - 0.0002).toFixed(5)),
      suggestedStop: signal.stopLoss,
      suggestedTakeProfit: signal.takeProfit,
      expectedRisk: signal.riskAmount,
      expectedProfit: signal.expectedProfit,
      rewardRiskRatio: signal.rewardRiskRatio,
      priceSource: "FOREX.com-compatible dashboard analysis",
      candleCount: 80,
      liveSpread: 1.2,
      reason: direction === "HOLD"
        ? "No clean trade. Capital protection rule says wait."
        : "Demo strategy signal only. Risk Manager must approve before any order can be sent.",
    };

    sendJson(res, 200, {
      ok: true,
      decision,
      selected: decision,
      scannedMarkets,
      priceSource: decision.priceSource,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/signal") {
    const body = await readBody(req);
    const signal = generateDemoSignal(body);

    const limits = mergeRiskLimits(body.riskLimits || {});
    const approval = approveTrade({
      signal: {
        strategyName: "moving-average-profit-rule",
        market: signal.market,
        direction: signal.direction,
        entryPrice: signal.entry,
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
