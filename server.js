const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = __dirname;

loadEnv(path.join(root, ".env"));

const port = Number(process.env.PORT || 3000);
const apiBase = (process.env.FOREXCOM_API_BASE || "https://ciapi.cityindex.com/TradingAPI").replace(/\/$/, "");
const streamingBase = (process.env.FOREXCOM_STREAMING_BASE || "https://push.cityindex.com").replace(/\/$/, "");
const appVersion = process.env.FOREXCOM_APP_VERSION || "1";
const appComments = process.env.FOREXCOM_APP_COMMENTS || "Forex Auto Bot local prototype";
const forexComAppKey = process.env.FOREXCOM_APP_KEY || "";
const base44AppId = process.env.BASE44_APP_ID || "";
const base44ApiKey = process.env.BASE44_API_KEY || "";
const base44UserName = process.env.BASE44_USER_NAME || "Marcello Gambino";
const supabaseRestUrl = process.env.SUPABASE_REST_URL || "";
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const defaultProfileName = process.env.DEFAULT_PROFILE_NAME || "Marcello Gambino";
const defaultProfileEmail = process.env.DEFAULT_PROFILE_EMAIL || "marcello@example.com";
const forexFetchTimeoutMs = Number(process.env.FOREXCOM_FETCH_TIMEOUT_MS || 8000);
const liveTradingEnabled = String(process.env.ENABLE_LIVE_TRADING || "false").toLowerCase() === "true";
const liveTradingConfirmText = process.env.LIVE_TRADING_CONFIRM_TEXT || "I UNDERSTAND LIVE TRADING CAN LOSE MONEY";
const maxLiveTradeQuantity = Number(process.env.MAX_LIVE_TRADE_QUANTITY || 1000);
const maxDailyLiveTrades = Number(process.env.MAX_DAILY_LIVE_TRADES || 1);
const maxOpenPositions = Number(process.env.MAX_OPEN_POSITIONS || 1);

const sessions = new Map();
const marginCache = new Map();
const priceCache = new Map();
const demoPositions = new Map();
let supabaseAdminClient;
const logDir = path.join(root, "logs");
const forexDebugLog = path.join(logDir, "forex-debug.jsonl");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

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

function writeDebug(event, payload) {
  if (process.env.VERCEL) {
    console.log(JSON.stringify({ event, payload }));
    return;
  }

  fs.mkdirSync(logDir, { recursive: true });
  const entry = {
    time: new Date().toISOString(),
    event,
    payload,
  };
  fs.appendFileSync(forexDebugLog, `${JSON.stringify(entry)}\n`);
}

function summarizeValue(value, depth = 0) {
  if (depth > 2) {
    return Array.isArray(value) ? "[Array]" : "[Object]";
  }

  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      first: value.length ? summarizeValue(value[0], depth + 1) : null,
    };
  }

  if (value && typeof value === "object") {
    const output = {};
    for (const [key, child] of Object.entries(value)) {
      output[key] = summarizeValue(child, depth + 1);
    }
    return output;
  }

  if (typeof value === "string" && value.length > 80) {
    return `${value.slice(0, 20)}...${value.slice(-8)}`;
  }

  return value;
}

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function postJson(url, body, headers = {}) {
  const signal = AbortSignal.timeout(forexFetchTimeoutMs);
  const response = await fetch(url, {
    method: "POST",
    signal,
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
  const signal = AbortSignal.timeout(forexFetchTimeoutMs);
  const response = await fetch(url, {
    method: "GET",
    signal,
    headers: {
      Accept: "application/json",
      ...headers,
    },
  });

  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error(`Expected JSON from ${url}, got ${response.status} ${response.statusText}: ${text.replace(/\s+/g, " ").trim().slice(0, 180)}`);
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
    throw new Error("Supabase URL and service role key are required.");
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

async function getOrCreateDefaultProfile() {
  const supabase = await getSupabaseAdmin();
  const { data: existing, error: selectError } = await supabase
    .from("profiles")
    .select("*")
    .eq("email", defaultProfileEmail)
    .maybeSingle();

  if (selectError) {
    throw selectError;
  }

  if (existing) {
    return existing;
  }

  const { data, error } = await supabase
    .from("profiles")
    .insert({
      full_name: defaultProfileName,
      email: defaultProfileEmail,
    })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data;
}

async function saveBrokerConnection({ forexUsername, isDemo = false }) {
  const supabase = await getSupabaseAdmin();
  const profile = await getOrCreateDefaultProfile();
  const { data, error } = await supabase
    .from("broker_connections")
    .insert({
      profile_id: profile.id,
      broker: "FOREX.com",
      forex_username: forexUsername,
      app_key_label: maskSecret(forexComAppKey),
      is_demo: isDemo,
    })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return { profile, brokerConnection: data };
}

async function saveForexSession({ localSessionId, username, sessionToken, account }) {
  const supabase = await getSupabaseAdmin();
  const profile = await getOrCreateDefaultProfile();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 6).toISOString();
  const { data, error } = await supabase
    .from("broker_connections")
    .insert({
      profile_id: profile.id,
      broker: "FOREX.com_SESSION",
      forex_username: username,
      app_key_label: JSON.stringify({
        localSessionId,
        sessionToken,
        account,
        expiresAt,
      }),
      is_demo: false,
    })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data;
}

async function loadForexSession(localSessionId) {
  if (!localSessionId) {
    return null;
  }

  if (sessions.has(localSessionId)) {
    return sessions.get(localSessionId);
  }

  try {
    const supabase = await getSupabaseAdmin();
    const { data, error } = await supabase
      .from("broker_connections")
      .select("*")
      .eq("broker", "FOREX.com_SESSION")
      .order("created_at", { ascending: false })
      .limit(25);

    if (error) {
      throw error;
    }

    for (const row of data || []) {
      try {
        const payload = JSON.parse(row.app_key_label || "{}");
        if (payload.localSessionId === localSessionId && payload.sessionToken && payload.account) {
          const session = {
            username: row.forex_username,
            sessionToken: payload.sessionToken,
            connectedAt: row.created_at,
            account: payload.account,
          };
          sessions.set(localSessionId, session);
          return session;
        }
      } catch (error) {
        writeDebug("supabase-session-parse-error", { error: error.message });
      }
    }
  } catch (error) {
    writeDebug("supabase-session-load-error", { error: error.message });
  }

  return null;
}

async function loadLatestAccountSnapshot(clientAccountId) {
  if (!clientAccountId) {
    return null;
  }

  try {
    const supabase = await getSupabaseAdmin();
    const { data, error } = await supabase
      .from("account_snapshots")
      .select("*")
      .eq("broker", "FOREX.com")
      .eq("client_account_id", String(clientAccountId))
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data || null;
  } catch (error) {
    writeDebug("supabase-account-snapshot-load-error", { error: error.message });
    return null;
  }
}

function snapshotMargin(snapshot) {
  if (!snapshot) {
    return null;
  }

  if (snapshot.raw_margin && typeof snapshot.raw_margin === "object") {
    return {
      ...snapshot.raw_margin,
      source: snapshot.source || "account_snapshots",
      updatedAt: snapshot.updated_at,
    };
  }

  if (snapshot.balance_value !== null && snapshot.balance_value !== undefined) {
    return {
      [snapshot.balance_key || "AccountValue"]: parseBrokerNumber(snapshot.balance_value),
      source: snapshot.source || "account_snapshots",
      updatedAt: snapshot.updated_at,
    };
  }

  return null;
}

function forexHeaders(session) {
  return {
    UserName: session.username,
    Session: session.sessionToken,
  };
}

async function getStoredSession(sessionId) {
  if (!sessionId || !sessions.has(sessionId)) {
    return loadForexSession(sessionId);
  }

  return sessions.get(sessionId);
}

function getPrimaryTradingAccount(account) {
  const tradingAccounts = Array.isArray(account?.tradingAccounts) ? account.tradingAccounts : [];
  return tradingAccounts[0] || null;
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

  for (const value of Object.values(account)) {
    if (value && typeof value === "object") {
      const nested = findTradingAccounts(value);
      if (nested.length) {
        return nested;
      }
    }
  }

  return [];
}

function normaliseMarginUpdate(update) {
  const output = {};
  update.forEachField((fieldName, fieldPosition, value) => {
    output[fieldName] = value;
  });
  return output;
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
      return {
        key,
        value,
      };
    }
  }

  return null;
}

function accountFallbackBalance(account) {
  return pickMarginBalance(account) || pickMarginBalance(getPrimaryTradingAccount(account));
}

async function saveAccountValueSnapshot({ account, source = "FOREX.com account snapshot" }) {
  const balance = accountFallbackBalance(account);
  const clientAccountId = account?.clientAccountId;
  if (!clientAccountId || !balance) {
    return null;
  }

  try {
    const supabase = await getSupabaseAdmin();
    const profile = await getOrCreateDefaultProfile();
    const primary = getPrimaryTradingAccount(account);
    const { data, error } = await supabase
      .from("account_snapshots")
      .upsert({
        profile_id: profile.id,
        broker: "FOREX.com",
        client_account_id: String(clientAccountId),
        trading_account_id: primary?.tradingAccountId ? String(primary.tradingAccountId) : null,
        currency: account.clientAccountCurrency || "USD",
        balance_value: balance.value,
        balance_key: balance.key,
        source,
        raw_margin: {
          [balance.key]: balance.value,
          receivedAt: new Date().toISOString(),
        },
        raw_account: account,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: "broker,client_account_id",
      })
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    return data;
  } catch (error) {
    writeDebug("supabase-account-snapshot-save-error", { error: error.message });
    return null;
  }
}

function seededPriceSeries(seedText, length = 80) {
  let seed = 0;
  for (const char of seedText) {
    seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
  }

  const prices = [];
  let price = 1.085 + (seed % 200) / 100000;
  for (let index = 0; index < length; index += 1) {
    seed = (1664525 * seed + 1013904223) >>> 0;
    const wave = Math.sin(index / 5) * 0.00035;
    const drift = ((seed % 1000) - 500) / 10_000_000;
    price = Math.max(0.8, price + wave / 8 + drift);
    prices.push(Number(price.toFixed(5)));
  }

  return prices;
}

function average(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function buildStrategyFromPrices({ prices, market = "EUR/USD", riskPerTrade = 1.5, dailyStop = 4, balance = 0, rewardRiskRatio = 2, priceSource = "simulated" }) {
  const shortWindow = 8;
  const longWindow = 21;

  if (!Array.isArray(prices) || prices.length < longWindow + 1) {
    throw new Error(`Need at least ${longWindow + 1} prices to run the moving-average strategy.`);
  }

  const previousShort = average(prices.slice(-shortWindow - 1, -1));
  const currentShort = average(prices.slice(-shortWindow));
  const previousLong = average(prices.slice(-longWindow - 1, -1));
  const currentLong = average(prices.slice(-longWindow));
  const lastPrice = prices.at(-1);
  const spreadPips = 1.2;
  const maxSpreadPips = 2.0;
  const riskAmount = balance ? balance * (Number(riskPerTrade) / 100) : null;
  const expectedRisk = riskAmount || 100;
  const expectedProfit = expectedRisk * Number(rewardRiskRatio);

  let direction = "HOLD";
  let reason = "No moving-average crossover detected.";

  if (previousShort <= previousLong && currentShort > currentLong) {
    direction = "BUY";
    reason = "Short moving average crossed above long moving average.";
  } else if (previousShort >= previousLong && currentShort < currentLong) {
    direction = "SELL";
    reason = "Short moving average crossed below long moving average.";
  }

  const riskPassed = spreadPips <= maxSpreadPips && Number(riskPerTrade) <= 3 && Number(dailyStop) <= 8;
  const profitRulePassed = expectedProfit > expectedRisk && Number(rewardRiskRatio) >= 2;
  const status = direction === "HOLD" ? "simulated_hold" : riskPassed && profitRulePassed ? "simulated_signal" : "risk_blocked";
  const stopDistance = 0.002;
  const takeProfitDistance = 0.004;

  return {
    market,
    direction: riskPassed && profitRulePassed ? direction : "HOLD",
    rawDirection: direction,
    status,
    reason: direction === "HOLD"
      ? reason
      : riskPassed && profitRulePassed
        ? `${reason} Profit rule passed: expected reward ${rewardRiskRatio}:1 is greater than expected risk.`
        : `Risk/profit check blocked signal. Spread ${spreadPips} pips, risk ${riskPerTrade}%, daily stop ${dailyStop}%, reward:risk ${rewardRiskRatio}:1.`,
    lastPrice,
    shortMa: Number(currentShort.toFixed(5)),
    longMa: Number(currentLong.toFixed(5)),
    spreadPips,
    riskAmount,
    expectedRisk,
    expectedProfit,
    rewardRiskRatio,
    priceSource,
    suggestedStop: direction === "BUY" ? Number((lastPrice - stopDistance).toFixed(5)) : Number((lastPrice + stopDistance).toFixed(5)),
    suggestedTakeProfit: direction === "BUY" ? Number((lastPrice + takeProfitDistance).toFixed(5)) : Number((lastPrice - takeProfitDistance).toFixed(5)),
  };
}

const topForexMarkets = [
  "EUR/USD",
  "USD/JPY",
  "GBP/USD",
  "USD/CHF",
  "AUD/USD",
  "USD/CAD",
  "NZD/USD",
  "EUR/GBP",
  "EUR/JPY",
  "GBP/JPY",
  "AUD/JPY",
  "EUR/AUD",
  "EUR/CHF",
  "GBP/CHF",
  "AUD/CAD",
];

function runMovingAverageStrategy({ market = "EUR/USD", riskPerTrade = 1.5, dailyStop = 4, balance = 0, rewardRiskRatio = 2 }) {
  const prices = seededPriceSeries(`${market}-${new Date().toISOString().slice(0, 13)}`);
  return buildStrategyFromPrices({
    prices,
    market,
    riskPerTrade,
    dailyStop,
    balance,
    rewardRiskRatio,
    priceSource: "simulated fallback",
  });
}

function marketNameMatches(market, targetName) {
  const target = String(targetName).replace("/", "").replace(/\s/g, "").toUpperCase();
  const values = [
    market.Name,
    market.name,
    market.MarketName,
    market.marketName,
    market.DisplayName,
    market.displayName,
    market.MarketCode,
    market.marketCode,
  ].filter(Boolean).map((value) => String(value).replace("/", "").replace(/\s/g, "").toUpperCase());

  return values.some((value) => value.includes(target) || target.includes(value));
}

async function findMarket(session, marketName) {
  const query = buildQuery({
    SearchByMarketName: true,
    Query: marketName,
    MaxResults: 15,
    IncludeOptions: false,
    CfdProductType: true,
    SpreadProductType: false,
    BinaryProductType: false,
    ClientAccountId: session.account.clientAccountId,
  });
  const data = await getJson(`${apiBase}/market/search?${query}`, forexHeaders(session));
  const markets = normalizeList(data, ["Markets", "MarketInformation", "SearchResults", "Results"]);
  const market = markets.find((item) => marketNameMatches(item, marketName)) || markets[0];

  if (!market) {
    throw new Error(`No FOREX.com market found for ${marketName}.`);
  }

  return {
    marketId: firstPresent(market.MarketId, market.marketId, market.Id, market.id),
    name: firstPresent(market.Name, market.name, market.MarketName, market.marketName, marketName),
    raw: market,
  };
}

function normalisePriceUpdate(update, market) {
  const output = {
    market: market.name,
    marketId: market.marketId,
    receivedAt: new Date().toISOString(),
  };

  update.forEachField((fieldName, fieldPosition, value) => {
    output[fieldName] = value;
  });

  const bid = Number(firstPresent(output.Bid, output.bid));
  const offer = Number(firstPresent(output.Offer, output.offer));
  const price = Number(firstPresent(output.Price, output.price));
  output.bid = Number.isFinite(bid) ? bid : null;
  output.offer = Number.isFinite(offer) ? offer : null;
  output.mid = output.bid !== null && output.offer !== null
    ? Number(((output.bid + output.offer) / 2).toFixed(5))
    : Number.isFinite(price)
      ? price
      : null;
  output.spread = output.bid !== null && output.offer !== null
    ? Number((output.offer - output.bid).toFixed(5))
    : null;

  return output;
}

function subscribePricesOnce({ session, markets }) {
  return new Promise((resolve, reject) => {
    const ls = require("lightstreamer-client");
    const client = new ls.LightstreamerClient(streamingBase, "STREAMINGALL");
    client.connectionDetails.setUser(session.username);
    client.connectionDetails.setPassword(session.sessionToken);

    const fields = ["Price", "Bid", "Offer", "High", "Low"];
    const items = markets.map((market) => `ID.${market.marketId}`);
    const byItem = new Map(items.map((item, index) => [item, markets[index]]));
    const results = new Map();
    const subscription = new ls.Subscription("MERGE", items, fields);
    subscription.setDataAdapter("PRICES");
    subscription.setRequestedSnapshot("yes");

    const timeout = setTimeout(() => {
      client.disconnect();
      if (results.size) {
        resolve(Array.from(results.values()));
        return;
      }
      reject(new Error("Timed out waiting for FOREX.com live prices."));
    }, 15000);

    subscription.addListener({
      onItemUpdate(update) {
        const itemName = update.getItemName();
        const market = byItem.get(itemName);
        if (!market) {
          return;
        }

        const livePrice = normalisePriceUpdate(update, market);
        priceCache.set(market.name, livePrice);
        results.set(market.name, livePrice);

        if (results.size === markets.length) {
          clearTimeout(timeout);
          client.unsubscribe(subscription);
          client.disconnect();
          resolve(Array.from(results.values()));
        }
      },
      onSubscriptionError(code, message) {
        clearTimeout(timeout);
        client.disconnect();
        reject(new Error(`PRICES subscription error ${code}: ${message}`));
      },
    });

    client.connect();
    client.subscribe(subscription);
  });
}

function normalizeBars(data) {
  const bars = normalizeList(data, ["PriceBars", "priceBars", "Bars", "bars"]);
  return bars.map((bar) => ({
    timestamp: firstPresent(bar.BarDate, bar.barDate, bar.Date, bar.date, bar.Timestamp, bar.timestamp),
    open: Number(firstPresent(bar.Open, bar.open, bar.OpenPrice, bar.openPrice)),
    high: Number(firstPresent(bar.High, bar.high, bar.HighPrice, bar.highPrice)),
    low: Number(firstPresent(bar.Low, bar.low, bar.LowPrice, bar.lowPrice)),
    close: Number(firstPresent(bar.Close, bar.close, bar.ClosePrice, bar.closePrice)),
  })).filter((bar) => [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite));
}

async function getPriceBars({ session, marketName = "EUR/USD", interval = "MINUTE", span = 15, maxResults = 80 }) {
  const market = await findMarket(session, marketName);
  const fromTimestampUTC = Math.floor(Date.now() / 1000) - (60 * Number(span) * Math.max(Number(maxResults), 20));
  const query = buildQuery({
    interval,
    span,
    fromTimestampUTC,
    maxResults,
    priceType: "MID",
    ClientAccountId: session.account.clientAccountId,
  });
  const data = await getJson(`${apiBase}/market/${market.marketId}/barhistoryafter?${query}`, forexHeaders(session));

  return {
    market,
    bars: normalizeBars(data),
    raw: data,
  };
}

function runLivePriceDecision({ price, riskPerTrade = 1.5, dailyStop = 4, balance = 0, rewardRiskRatio = 2 }) {
  const decision = runMovingAverageStrategy({
    market: price.market,
    riskPerTrade,
    dailyStop,
    balance,
    rewardRiskRatio,
  });

  if (price.mid) {
    decision.lastPrice = price.mid;
    decision.suggestedStop = decision.direction === "BUY"
      ? Number((price.mid - 0.002).toFixed(5))
      : Number((price.mid + 0.002).toFixed(5));
    decision.suggestedTakeProfit = decision.direction === "BUY"
      ? Number((price.mid + 0.004).toFixed(5))
      : Number((price.mid - 0.004).toFixed(5));
    decision.liveBid = price.bid;
    decision.liveOffer = price.offer;
    decision.liveSpread = price.spread;
    decision.priceSource = "FOREX.com PRICES stream";
  }

  return decision;
}

function oppositeDirection(direction) {
  return String(direction).toUpperCase() === "BUY" ? "sell" : "buy";
}

function normaliseTradeDirection(direction) {
  return String(direction).toUpperCase() === "BUY" ? "buy" : "sell";
}

function todaysIsoStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

function getDemoPositions(profileId) {
  if (!demoPositions.has(profileId)) {
    demoPositions.set(profileId, []);
  }

  return demoPositions.get(profileId);
}

function evaluateDemoPosition(position, currentPrice) {
  const isBuy = position.direction === "BUY";
  const hitTarget = isBuy ? currentPrice >= position.takeProfit : currentPrice <= position.takeProfit;
  const hitStop = isBuy ? currentPrice <= position.stopLoss : currentPrice >= position.stopLoss;
  const priceDifference = isBuy ? currentPrice - position.entryPrice : position.entryPrice - currentPrice;
  const targetDifference = Math.abs(position.takeProfit - position.entryPrice) || 1;
  const estimatedProfitLoss = (priceDifference / targetDifference) * position.expectedProfit;

  return {
    hitTarget,
    hitStop,
    estimatedProfitLoss,
  };
}

async function logDemoTrade({ profile, position, status, currentPrice, profitLoss, reason }) {
  const supabase = await getSupabaseAdmin();
  const { data, error } = await supabase
    .from("trade_logs")
    .insert({
      profile_id: profile.id,
      broker_order_id: position.id,
      market: position.market,
      direction: position.direction,
      quantity: position.riskAmount,
      entry_price: position.entryPrice,
      exit_price: currentPrice ?? null,
      profit_loss: profitLoss ?? null,
      status,
      reason,
    })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data;
}

async function runCandleStrategy({ session, market, riskPerTrade, dailyStop, balance, rewardRiskRatio }) {
  const result = await getPriceBars({
    session,
    marketName: market,
    interval: "MINUTE",
    span: 15,
    maxResults: 80,
  });
  const closes = result.bars.map((bar) => bar.close);
  const decision = buildStrategyFromPrices({
    prices: closes,
    market,
    riskPerTrade,
    dailyStop,
    balance,
    rewardRiskRatio,
    priceSource: "FOREX.com candle history",
  });
  decision.candleCount = result.bars.length;
  decision.marketId = result.market.marketId;
  return decision;
}

function subscribeMarginOnce({ session, clientAccountId, itemName }) {
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

    const timeout = setTimeout(() => {
      client.disconnect();
      reject(new Error(`Timed out waiting for FOREX.com CLIENTACCOUNTMARGIN stream using item ${itemName}.`));
    }, 15000);

    subscription.addListener({
      onItemUpdate(update) {
        clearTimeout(timeout);
        const data = normaliseMarginUpdate(update);
        const enriched = {
          ...data,
          itemName,
          receivedAt: new Date().toISOString(),
        };
        marginCache.set(clientAccountId, enriched);
        client.unsubscribe(subscription);
        client.disconnect();
        resolve(enriched);
      },
      onSubscriptionError(code, message) {
        clearTimeout(timeout);
        client.disconnect();
        reject(new Error(`CLIENTACCOUNTMARGIN subscription error ${code}: ${message} using item ${itemName}`));
      },
    });

    client.connect();
    client.subscribe(subscription);
  });
}

function buildQuery(params) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, value);
    }
  }
  return query.toString();
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
    accountCount: tradingAccounts.length,
    rawAccountKeys: Object.keys(account),
    clientAccounts: clientAccounts.map((item) => ({
      clientAccountId: firstPresent(item.clientAccountId, item.ClientAccountId),
      clientAccountCurrency: firstPresent(item.clientAccountCurrency, item.ClientAccountCurrency),
      accountGroupName: firstPresent(item.accountGroupName, item.AccountGroupName),
      isMetaTrader: firstPresent(item.isMetaTrader, item.IsMetaTrader),
    })),
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

function normalizeList(data, keys) {
  if (Array.isArray(data)) {
    return data;
  }

  for (const key of keys) {
    if (Array.isArray(data?.[key])) {
      return data[key];
    }
  }

  return [];
}

async function handleForexConnect(req, res) {
  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw || "{}");
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const appKey = String(body.appKey || forexComAppKey).trim();

    if (!username || !password || !appKey) {
      sendJson(res, 400, {
        ok: false,
        error: "Username, password, and FOREX.com AppKey are required.",
      });
      return;
    }

    const session = await postJson(`${apiBase}/session`, {
      UserName: username,
      Password: password,
      AppVersion: appVersion,
      AppComments: appComments,
      AppKey: appKey,
    });

    const sessionToken = session.Session || session.SessionId || session.SessionToken;
    if (!sessionToken) {
      throw new Error("FOREX.com did not return a session token.");
    }

    const accountBase = apiBase.replace(/\/TradingAPI$/i, "");
    const account = await getJson(`${accountBase}/v2/userAccount/ClientAndTradingAccount`, {
      UserName: username,
      Session: sessionToken,
    });
    writeDebug("forex-account-response-shape", summarizeValue(account));

    const localSessionId = crypto.randomUUID();
    sessions.set(localSessionId, {
      username,
      sessionToken,
      connectedAt: new Date().toISOString(),
      account: safeAccountSummary(account),
    });

    let savedConnection = null;
    try {
      savedConnection = await saveBrokerConnection({ forexUsername: username });
    } catch (error) {
      writeDebug("supabase-broker-save-error", { error: error.message });
    }

    let savedSession = null;
    try {
      savedSession = await saveForexSession({
        localSessionId,
        username,
        sessionToken,
        account: sessions.get(localSessionId).account,
      });
    } catch (error) {
      writeDebug("supabase-session-save-error", { error: error.message });
    }

    const savedAccountSnapshot = await saveAccountValueSnapshot({
      account: sessions.get(localSessionId).account,
      source: "FOREX.com login account snapshot",
    });

    sendJson(res, 200, {
      ok: true,
      localSessionId,
      connectedAt: sessions.get(localSessionId).connectedAt,
      account: sessions.get(localSessionId).account,
      savedConnection,
      savedSession: savedSession ? { id: savedSession.id, created_at: savedSession.created_at } : null,
      savedAccountSnapshot: savedAccountSnapshot ? { id: savedAccountSnapshot.id, updated_at: savedAccountSnapshot.updated_at } : null,
    });
  } catch (error) {
    sendJson(res, 502, {
      ok: false,
      error: error.message,
      hint: "Confirm your FOREX.com API access is enabled, credentials match the selected environment, and the AppKey is active.",
    });
  }
}

async function handleForexConfig(req, res) {
  sendJson(res, 200, {
    ok: true,
    apiBase,
    streamingBase,
    hasAppKey: Boolean(forexComAppKey),
    appKey: maskSecret(forexComAppKey),
    runtime: process.env.VERCEL ? "vercel" : "local",
  });
}

async function handleHealth(req, res) {
  sendJson(res, 200, {
    ok: true,
    runtime: process.env.VERCEL ? "vercel" : "local",
    node: process.version,
    env: {
      hasForexApiBase: Boolean(apiBase),
      hasForexStreamingBase: Boolean(streamingBase),
      hasForexAppKey: Boolean(forexComAppKey),
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasSupabaseServiceRoleKey: Boolean(supabaseServiceRoleKey),
    },
    files: {
      index: fs.existsSync(path.join(root, "index.html")),
      signin: fs.existsSync(path.join(root, "signin.html")),
      dashboard: fs.existsSync(path.join(root, "dashboard.html")),
      styles: fs.existsSync(path.join(root, "styles.css")),
    },
  });
}

async function handleForexSnapshot(req, res, url) {
  try {
    const session = await getStoredSession(url.searchParams.get("sessionId"));
    if (!session) {
      sendJson(res, 401, {
        ok: false,
        error: "Connect to FOREX.com first.",
      });
      return;
    }

    const tradingAccount = getPrimaryTradingAccount(session.account);
    if (!tradingAccount) {
      const savedSnapshot = await loadLatestAccountSnapshot(session.account.clientAccountId);
      const cachedMargin = marginCache.get(session.account.clientAccountId) || snapshotMargin(savedSnapshot);
      const fallbackBalance = accountFallbackBalance(session.account);
      const accountValue = pickMarginBalance(cachedMargin) || fallbackBalance;
      sendJson(res, 200, {
        ok: true,
        warning: "No trading account list was returned, so positions and trade history are unavailable until FOREX.com returns a TradingAccountId.",
        connectedAt: session.connectedAt,
        account: session.account,
        margin: cachedMargin || (accountValue ? { [accountValue.key]: accountValue.value, source: "FOREX.com account snapshot" } : null),
        fallbackBalance,
        accountValue,
        accountValueSource: accountValue ? cachedMargin ? "saved/streamed margin data" : "FOREX.com account snapshot" : null,
        accountSnapshot: savedSnapshot,
        primaryTradingAccount: null,
        positions: [],
        activeOrders: [],
        tradeHistory: [],
      });
      return;
    }

    const tradingAccountId = tradingAccount.tradingAccountId;
    const auth = forexHeaders(session);
    const savedSnapshot = await loadLatestAccountSnapshot(session.account.clientAccountId);
    const cachedMargin = marginCache.get(session.account.clientAccountId) || snapshotMargin(savedSnapshot);
    const fallbackBalance = accountFallbackBalance(session.account);
    const accountValue = pickMarginBalance(cachedMargin) || fallbackBalance;
    const [positionsResult, activeOrdersResult, tradeHistoryResult] = await Promise.allSettled([
      getJson(`${apiBase}/order/openpositions?${buildQuery({ TradingAccountId: tradingAccountId })}`, auth),
      getJson(`${apiBase}/order/activestoplimitorders?${buildQuery({ TradingAccountId: tradingAccountId })}`, auth),
      getJson(`${apiBase}/order/tradehistory?${buildQuery({ TradingAccountId: tradingAccountId, MaxResults: 25 })}`, auth),
    ]);
    const positions = positionsResult.status === "fulfilled" ? positionsResult.value : {};
    const activeOrders = activeOrdersResult.status === "fulfilled" ? activeOrdersResult.value : {};
    const tradeHistory = tradeHistoryResult.status === "fulfilled" ? tradeHistoryResult.value : {};
    const warnings = [positionsResult, activeOrdersResult, tradeHistoryResult]
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason.message);

    sendJson(res, 200, {
      ok: true,
      connectedAt: session.connectedAt,
      account: session.account,
      margin: cachedMargin || (accountValue ? { [accountValue.key]: accountValue.value, source: "FOREX.com account snapshot" } : null),
      fallbackBalance,
      accountValue,
      accountValueSource: accountValue ? cachedMargin ? "saved/streamed margin data" : "FOREX.com account snapshot" : null,
      accountSnapshot: savedSnapshot,
      primaryTradingAccount: tradingAccount,
      positions: normalizeList(positions, ["OpenPositions", "Positions", "ListOpenPositions"]),
      activeOrders: normalizeList(activeOrders, ["ActiveStopLimitOrders", "Orders", "StopLimitOrders"]),
      tradeHistory: normalizeList(tradeHistory, ["TradeHistory", "Trades", "Orders"]),
      warnings,
    });
  } catch (error) {
    sendJson(res, 502, {
      ok: false,
      error: error.message,
      hint: "The session may be expired, the trading account may not have API permission, or the endpoint may differ for this account type.",
    });
  }
}

async function handleForexMargin(req, res, url) {
  try {
    const session = await getStoredSession(url.searchParams.get("sessionId"));
    if (!session) {
      sendJson(res, 401, {
        ok: false,
        error: "Connect to FOREX.com first.",
      });
      return;
    }

    const clientAccountId = session.account.clientAccountId;
    const cached = marginCache.get(clientAccountId) || session.account.margin || session.account.cachedMargin;
    const cachedBalance = pickMarginBalance(cached);
    if (cached && cachedBalance) {
      sendJson(res, 200, {
        ok: true,
        source: "cache",
        clientAccountId,
        margin: cached,
        balance: cachedBalance,
      });
      return;
    }

    const savedSnapshot = await loadLatestAccountSnapshot(clientAccountId);
    const savedMargin = snapshotMargin(savedSnapshot);
    const savedBalance = pickMarginBalance(savedMargin);
    if (savedMargin && savedBalance) {
      sendJson(res, 200, {
        ok: true,
        source: "supabase account_snapshots",
        clientAccountId,
        margin: savedMargin,
        balance: savedBalance,
        updatedAt: savedSnapshot.updated_at,
        note: "This value was written by the always-on trading engine.",
      });
      return;
    }

    const fallbackAccountBalance = accountFallbackBalance(session.account);
    if (fallbackAccountBalance) {
      sendJson(res, 200, {
        ok: true,
        source: "FOREX.com account snapshot",
        clientAccountId,
        margin: {
          [fallbackAccountBalance.key]: fallbackAccountBalance.value,
          receivedAt: session.connectedAt,
        },
        balance: fallbackAccountBalance,
        warning: process.env.VERCEL
          ? "Using the FOREX.com account snapshot because Vercel cannot reliably hold the Lightstreamer margin stream."
          : "Using the FOREX.com account snapshot. Start the always-on engine for continuous Lightstreamer updates.",
      });
      return;
    }

    const itemNames = [`ID.${clientAccountId}`, "CLIENTACCOUNTMARGIN"];
    const errors = [];
    let margin = null;

    for (const itemName of itemNames) {
      try {
        writeDebug("forex-margin-subscribe-attempt", { clientAccountId, itemName });
        margin = await subscribeMarginOnce({ session, clientAccountId, itemName });
        break;
      } catch (error) {
        errors.push(error.message);
        writeDebug("forex-margin-subscription-error", { clientAccountId, itemName, error: error.message });
      }
    }

    if (!margin) {
      throw new Error(errors.join(" | "));
    }

    sendJson(res, 200, {
      ok: true,
      source: "stream",
      clientAccountId,
      margin,
      balance: pickMarginBalance(margin),
    });
  } catch (error) {
    writeDebug("forex-margin-error", { error: error.message });
    const session = await getStoredSession(new URL(req.url, `http://${req.headers.host}`).searchParams.get("sessionId"));
    const fallbackBalance = firstPresent(
      session?.account?.cash,
      session?.account?.balance,
      session?.account?.accountValue,
      session?.account?.netEquity,
      session?.account?.availableToTrade,
      session?.account?.clientAccountBalance
    );
    if (fallbackBalance !== undefined && fallbackBalance !== null) {
      const parsedFallbackBalance = parseBrokerNumber(fallbackBalance);
      sendJson(res, 200, {
        ok: true,
        source: "account snapshot fallback",
        margin: {
          AccountValue: parsedFallbackBalance,
          receivedAt: new Date().toISOString(),
        },
        balance: {
          key: "AccountValue",
          value: parsedFallbackBalance,
        },
        warning: error.message,
      });
      return;
    }

    sendJson(res, 502, {
      ok: false,
      error: error.message,
      hint: process.env.VERCEL
        ? "FOREX.com account value comes from a Lightstreamer margin stream, which may not work reliably in Vercel serverless. The website is online, but the trading engine should move to an always-on backend for live streaming."
        : "FOREX.com account value comes from the CLIENTACCOUNTMARGIN Lightstreamer stream. Confirm streaming access is enabled for this account and use http://localhost:3000, not file://.",
    });
  }
}

async function handleForexDebug(req, res) {
  if (!fs.existsSync(forexDebugLog)) {
    sendJson(res, 200, {
      ok: true,
      events: [],
    });
    return;
  }

  const lines = fs.readFileSync(forexDebugLog, "utf8").trim().split(/\r?\n/).filter(Boolean);
  sendJson(res, 200, {
    ok: true,
    events: lines.slice(-20).map((line) => JSON.parse(line)),
  });
}

async function handleForexMarkets(req, res, url) {
  try {
    const session = await getStoredSession(url.searchParams.get("sessionId"));
    if (!session) {
      sendJson(res, 401, {
        ok: false,
        error: "Connect to FOREX.com first.",
      });
      return;
    }

    const query = url.searchParams.get("query") || "EUR/USD";
    const marketQuery = buildQuery({
      SearchByMarketName: true,
      Query: query,
      MaxResults: 10,
      IncludeOptions: false,
      CfdProductType: true,
      SpreadProductType: false,
      BinaryProductType: false,
      ClientAccountId: session.account.clientAccountId,
    });
    const data = await getJson(`${apiBase}/market/search?${marketQuery}`, forexHeaders(session));

    sendJson(res, 200, {
      ok: true,
      query,
      markets: normalizeList(data, ["Markets", "MarketInformation", "SearchResults", "Results"]),
      raw: data,
    });
  } catch (error) {
    sendJson(res, 502, {
      ok: false,
      error: error.message,
      hint: "Market search requires a valid session and a ClientAccountId from FOREX.com.",
    });
  }
}

async function handleForexPrices(req, res, url) {
  try {
    const session = await getStoredSession(url.searchParams.get("sessionId"));
    if (!session) {
      sendJson(res, 401, {
        ok: false,
        error: "Connect to FOREX.com first.",
      });
      return;
    }

    const requested = url.searchParams.get("markets");
    const names = requested ? requested.split(",").map((item) => item.trim()).filter(Boolean) : topForexMarkets;
    const resolvedMarkets = [];
    for (const name of names.slice(0, 15)) {
      resolvedMarkets.push(await findMarket(session, name));
    }

    writeDebug("forex-live-price-subscribe-attempt", {
      markets: resolvedMarkets.map((market) => ({ name: market.name, marketId: market.marketId })),
    });

    const prices = await subscribePricesOnce({ session, markets: resolvedMarkets });
    sendJson(res, 200, {
      ok: true,
      source: "FOREX.com PRICES stream",
      prices,
    });
  } catch (error) {
    writeDebug("forex-live-price-error", { error: error.message });
    sendJson(res, 502, {
      ok: false,
      error: error.message,
      hint: "Live prices require a valid FOREX.com session and market IDs. Reconnect, then try again.",
    });
  }
}

async function handleForexCandles(req, res, url) {
  try {
    const session = await getStoredSession(url.searchParams.get("sessionId"));
    if (!session) {
      sendJson(res, 401, {
        ok: false,
        error: "Connect to FOREX.com first.",
      });
      return;
    }

    const marketName = url.searchParams.get("market") || "EUR/USD";
    const interval = url.searchParams.get("interval") || "MINUTE";
    const span = Number(url.searchParams.get("span") || 15);
    const maxResults = Number(url.searchParams.get("maxResults") || 80);
    const result = await getPriceBars({ session, marketName, interval, span, maxResults });

    writeDebug("forex-candles-response", {
      market: result.market,
      bars: result.bars.length,
    });

    sendJson(res, 200, {
      ok: true,
      source: "FOREX.com barhistoryafter",
      market: result.market,
      interval,
      span,
      bars: result.bars,
    });
  } catch (error) {
    writeDebug("forex-candles-error", { error: error.message });
    sendJson(res, 502, {
      ok: false,
      error: error.message,
      hint: "Candles require FOREX.com market history access. Reconnect and try EUR/USD first.",
    });
  }
}

async function handleBase44Status(req, res) {
  sendJson(res, 200, {
    ok: true,
    configured: Boolean(base44AppId && base44ApiKey),
    userName: base44UserName,
    appId: base44AppId,
    apiKey: maskSecret(base44ApiKey),
    note: "Base44 credentials are loaded on the local server only. Send the Base44 entity/function names next so the migration can pull the right records.",
  });
}

async function handleBase44SdkTest(req, res) {
  try {
    if (!base44AppId || !base44ApiKey) {
      sendJson(res, 400, {
        ok: false,
        error: "BASE44_APP_ID and BASE44_API_KEY are required.",
      });
      return;
    }

    const { createClient } = await import("@base44/sdk");
    const base44 = createClient({
      appId: base44AppId,
      headers: {
        api_key: base44ApiKey,
      },
    });

    const modules = [
      "agents",
      "analytics",
      "appLogs",
      "auth",
      "entities",
      "functions",
      "integrations",
    ].filter((key) => Boolean(base44[key]));
    base44.cleanup?.();

    sendJson(res, 200, {
      ok: true,
      userName: base44UserName,
      appId: base44AppId,
      modules,
      note: "SDK client was created successfully. The next step is naming the Base44 entity or function that stores Marcello's FOREX.com settings.",
    });
  } catch (error) {
    sendJson(res, 502, {
      ok: false,
      error: error.message,
    });
  }
}

async function handleSupabaseStatus(req, res) {
  sendJson(res, 200, {
    ok: true,
    configured: Boolean(supabaseRestUrl && supabaseAnonKey && supabaseServiceRoleKey),
    url: supabaseUrl,
    restUrl: supabaseRestUrl,
    publishableKey: maskSecret(supabaseAnonKey),
    hasPrivateKey: Boolean(supabaseServiceRoleKey),
  });
}

async function handleSupabaseCheck(req, res) {
  try {
    const supabase = await getSupabaseAdmin();
    const profile = await getOrCreateDefaultProfile();
    const [brokerConnections, botSettings, tradeLogs] = await Promise.all([
      supabase.from("broker_connections").select("id", { count: "exact", head: true }),
      supabase.from("bot_settings").select("id", { count: "exact", head: true }),
      supabase.from("trade_logs").select("id", { count: "exact", head: true }),
    ]);

    for (const result of [brokerConnections, botSettings, tradeLogs]) {
      if (result.error) {
        throw result.error;
      }
    }

    sendJson(res, 200, {
      ok: true,
      profile,
      counts: {
        brokerConnections: brokerConnections.count,
        botSettings: botSettings.count,
        tradeLogs: tradeLogs.count,
      },
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: error.message,
      hint: "Confirm the Supabase tables exist and the service role/private key is correct.",
    });
  }
}

async function handleBotSettings(req, res) {
  try {
    const body = JSON.parse((await readBody(req)) || "{}");
    const supabase = await getSupabaseAdmin();
    const profile = await getOrCreateDefaultProfile();
    const settings = {
      profile_id: profile.id,
      risk_per_trade: Number(body.riskPerTrade ?? 1.5),
      daily_stop: Number(body.dailyStop ?? 4),
      news_filter: Boolean(body.newsFilter ?? true),
      auto_compound: Boolean(body.autoCompound ?? false),
      bot_enabled: Boolean(body.botEnabled ?? false),
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from("bot_settings")
      .insert(settings)
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    sendJson(res, 200, {
      ok: true,
      profile,
      settings: data,
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: error.message,
    });
  }
}

async function handleTradeLog(req, res) {
  try {
    const body = JSON.parse((await readBody(req)) || "{}");
    const supabase = await getSupabaseAdmin();
    const profile = await getOrCreateDefaultProfile();
    const { data, error } = await supabase
      .from("trade_logs")
      .insert({
        profile_id: profile.id,
        broker_order_id: body.brokerOrderId || null,
        market: body.market || "EUR/USD",
        direction: body.direction || "WATCH",
        quantity: body.quantity === undefined ? null : Number(body.quantity),
        entry_price: body.entryPrice === undefined ? null : Number(body.entryPrice),
        exit_price: body.exitPrice === undefined ? null : Number(body.exitPrice),
        profit_loss: body.profitLoss === undefined ? null : Number(body.profitLoss),
        status: body.status || "logged",
        reason: body.reason || "Manual test log",
      })
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    sendJson(res, 200, {
      ok: true,
      profile,
      tradeLog: data,
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: error.message,
    });
  }
}

async function handleLiveTradingStatus(req, res) {
  sendJson(res, 200, {
    ok: true,
    liveTradingEnabled,
    confirmText: liveTradingConfirmText,
    limits: {
      maxLiveTradeQuantity,
      maxDailyLiveTrades,
      maxOpenPositions,
    },
    message: liveTradingEnabled
      ? "Live trading is enabled on this backend. Use small size and verify each fill in FOREX.com."
      : "Live trading is locked. Set ENABLE_LIVE_TRADING=true on the always-on backend only when you are ready.",
  });
}

async function handleOpsStatus(req, res) {
  const checks = {
    forexApiBase: Boolean(apiBase),
    forexStreamingBase: Boolean(streamingBase),
    forexAppKey: Boolean(forexComAppKey),
    supabaseUrl: Boolean(supabaseUrl),
    supabaseServiceRoleKey: Boolean(supabaseServiceRoleKey),
    liveTradingEnabled,
    accountSnapshotsTable: false,
  };

  let supabaseError = null;
  try {
    const supabase = await getSupabaseAdmin();
    const result = await supabase
      .from("account_snapshots")
      .select("id", { count: "exact", head: true });

    if (result.error) {
      throw result.error;
    }
    checks.accountSnapshotsTable = true;
  } catch (error) {
    supabaseError = error.message;
  }

  sendJson(res, 200, {
    ok: Object.entries(checks)
      .filter(([key]) => key !== "liveTradingEnabled")
      .every(([, value]) => Boolean(value)),
    runtime: process.env.VERCEL ? "vercel" : "local",
    checks,
    supabaseError,
    nextSteps: [
      checks.accountSnapshotsTable ? "account_snapshots table is ready." : "Run supabase-account-snapshots.sql in Supabase SQL Editor.",
      liveTradingEnabled ? "Live trading is enabled; keep quantity and daily limits small." : "Live trading is locked until ENABLE_LIVE_TRADING=true is set on the always-on backend.",
      "Run npm run engine on an always-on host for reliable live account value streaming.",
    ],
  });
}

async function countTodayLiveTrades(profileId) {
  const supabase = await getSupabaseAdmin();
  const { count, error } = await supabase
    .from("trade_logs")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", profileId)
    .eq("status", "live_order_placed")
    .gte("created_at", todaysIsoStart());

  if (error) {
    throw error;
  }

  return count || 0;
}

async function handleLiveTradeExecute(req, res) {
  try {
    const body = JSON.parse((await readBody(req)) || "{}");
    if (!liveTradingEnabled) {
      sendJson(res, 403, {
        ok: false,
        error: "Live trading is disabled on this backend.",
        nextStep: "Run the trading engine on an always-on backend and set ENABLE_LIVE_TRADING=true only after validating the strategy and risk controls.",
      });
      return;
    }

    if (String(body.confirmText || "").trim() !== liveTradingConfirmText) {
      sendJson(res, 400, {
        ok: false,
        error: `Type exactly: ${liveTradingConfirmText}`,
      });
      return;
    }

    const session = await getStoredSession(body.sessionId);
    if (!session) {
      sendJson(res, 401, {
        ok: false,
        error: "Connect to FOREX.com first.",
      });
      return;
    }

    const tradingAccount = getPrimaryTradingAccount(session.account);
    if (!tradingAccount?.tradingAccountId) {
      throw new Error("FOREX.com did not return a TradingAccountId for live execution.");
    }

    const quantity = Number(body.quantity || 0);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error("Enter a valid live trade quantity.");
    }

    if (quantity > maxLiveTradeQuantity) {
      throw new Error(`Quantity is above the backend max of ${maxLiveTradeQuantity}.`);
    }

    const marketName = String(body.market || "EUR/USD").trim();
    const riskPerTrade = Number(body.riskPerTrade ?? 1.5);
    const dailyStop = Number(body.dailyStop ?? 4);
    const rewardRiskRatio = Number(body.rewardRiskRatio ?? 2);
    if (riskPerTrade > 1) {
      throw new Error("Live risk per trade is capped at 1% for this prototype.");
    }

    const profile = await getOrCreateDefaultProfile();
    const todaysLiveTrades = await countTodayLiveTrades(profile.id);
    if (todaysLiveTrades >= maxDailyLiveTrades) {
      throw new Error(`Daily live trade limit reached (${maxDailyLiveTrades}).`);
    }

    const positions = await getJson(`${apiBase}/order/openpositions?${buildQuery({ TradingAccountId: tradingAccount.tradingAccountId })}`, forexHeaders(session));
    const openPositions = normalizeList(positions, ["OpenPositions", "Positions", "ListOpenPositions"]);
    if (openPositions.length >= maxOpenPositions) {
      throw new Error(`Open position limit reached (${maxOpenPositions}). Close or review positions before placing another live trade.`);
    }

    const market = await findMarket(session, marketName);
    const [livePrice] = await subscribePricesOnce({ session, markets: [market] });
    let decision = await runCandleStrategy({
      session,
      market: marketName,
      riskPerTrade,
      dailyStop,
      rewardRiskRatio,
      balance: 0,
    });

    if (livePrice?.mid) {
      decision.lastPrice = livePrice.mid;
      decision.liveBid = livePrice.bid;
      decision.liveOffer = livePrice.offer;
      decision.liveSpread = livePrice.spread;
    }

    if (!["BUY", "SELL"].includes(decision.direction) || decision.status !== "simulated_signal") {
      throw new Error(`No live order placed. Strategy decision was ${decision.direction}: ${decision.reason}`);
    }

    if (!(decision.expectedProfit > decision.expectedRisk) || Number(decision.rewardRiskRatio) < 2) {
      throw new Error("No live order placed. Reward/risk rule did not pass.");
    }

    const bidPrice = Number(livePrice?.bid || decision.lastPrice);
    const offerPrice = Number(livePrice?.offer || decision.lastPrice);
    if (!Number.isFinite(bidPrice) || !Number.isFinite(offerPrice)) {
      throw new Error("No live order placed. FOREX.com did not return a tradable bid/offer.");
    }

    const closingDirection = oppositeDirection(decision.direction);
    const orderRequest = {
      IfDone: [{
        Stop: {
          ExpiryDateTimeUTC: null,
          Guaranteed: false,
          Direction: closingDirection,
          Quantity: quantity,
          Applicability: "GTC",
          TriggerPrice: decision.suggestedStop,
          OrderId: 0,
        },
        Limit: {
          ExpiryDateTimeUTC: null,
          Direction: closingDirection,
          Quantity: quantity,
          Applicability: "GTC",
          TriggerPrice: decision.suggestedTakeProfit,
          OrderId: 0,
        },
      }],
      Direction: normaliseTradeDirection(decision.direction),
      ExpiryDateTimeUTCDate: null,
      LastChangedDateTimeUTCDate: null,
      OcoOrder: null,
      Type: null,
      ExpiryDateTimeUTC: null,
      Applicability: null,
      TriggerPrice: null,
      BidPrice: bidPrice,
      AuditId: `forex-auto-bot-${crypto.randomUUID()}`,
      AutoRollover: false,
      MarketId: market.marketId,
      OfferPrice: offerPrice,
      OrderId: 0,
      Currency: null,
      Quantity: quantity,
      QuoteId: null,
      LastChangedDateTimeUTC: null,
      PositionMethodId: 1,
      TradingAccountId: tradingAccount.tradingAccountId,
      MarketName: market.name,
      Status: null,
      isTrade: true,
    };

    const orderResponse = await postJson(`${apiBase}/order/newtradeorder`, orderRequest, forexHeaders(session));
    const brokerOrderId = firstPresent(orderResponse.OrderId, orderResponse.orderId, orderResponse.DealId, orderResponse.dealId, orderResponse.Reference);
    const supabase = await getSupabaseAdmin();
    const { data: tradeLog, error } = await supabase
      .from("trade_logs")
      .insert({
        profile_id: profile.id,
        broker_order_id: brokerOrderId ? String(brokerOrderId) : null,
        market: market.name,
        direction: decision.direction,
        quantity,
        entry_price: decision.lastPrice,
        exit_price: null,
        profit_loss: null,
        status: "live_order_placed",
        reason: `LIVE ORDER SENT. ${decision.reason} Stop ${decision.suggestedStop}, take profit ${decision.suggestedTakeProfit}.`,
      })
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    sendJson(res, 200, {
      ok: true,
      mode: "live",
      warning: "Live order was sent to FOREX.com. Check FOREX.com immediately to confirm fill, stop, and limit.",
      decision,
      orderRequest: {
        ...orderRequest,
        AuditId: "hidden",
      },
      orderResponse,
      tradeLog,
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: error.message,
    });
  }
}

async function handleBotRun(req, res) {
  try {
    const body = JSON.parse((await readBody(req)) || "{}");
    const session = await getStoredSession(body.sessionId);
    const cachedMargin = session?.account?.clientAccountId ? marginCache.get(session.account.clientAccountId) : null;
    const balanceInfo = pickMarginBalance(cachedMargin);
    const riskPerTrade = Number(body.riskPerTrade ?? 1.5);
    const dailyStop = Number(body.dailyStop ?? 4);
    const rewardRiskRatio = Number(body.rewardRiskRatio ?? 2);
    const market = body.market || "EUR/USD";
    let result;
    try {
      if (!session) {
        throw new Error("No FOREX.com session available for candle data.");
      }
      result = await runCandleStrategy({
        session,
        market,
        riskPerTrade,
        dailyStop,
        rewardRiskRatio,
        balance: balanceInfo?.value || 0,
      });
    } catch (error) {
      writeDebug("bot-candle-fallback", { market, error: error.message });
      result = runMovingAverageStrategy({
        market,
        riskPerTrade,
        dailyStop,
        rewardRiskRatio,
        balance: balanceInfo?.value || 0,
      });
      result.fallbackReason = error.message;
    }

    const supabase = await getSupabaseAdmin();
    const profile = await getOrCreateDefaultProfile();
    const { data, error } = await supabase
      .from("trade_logs")
      .insert({
        profile_id: profile.id,
        broker_order_id: null,
        market: result.market,
        direction: result.direction,
        quantity: result.riskAmount,
        entry_price: result.lastPrice,
        exit_price: null,
        profit_loss: null,
        status: result.status,
        reason: `${result.reason} Short MA ${result.shortMa}, long MA ${result.longMa}. Analysis logged; no live order sent from this panel.`,
      })
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    sendJson(res, 200, {
      ok: true,
      mode: "analysis",
      balanceSource: balanceInfo?.key || null,
      priceSource: result.priceSource,
      decision: result,
      tradeLog: data,
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: error.message,
    });
  }
}

async function handleBotScan(req, res) {
  try {
    const body = JSON.parse((await readBody(req)) || "{}");
    const session = await getStoredSession(body.sessionId);
    const cachedMargin = session?.account?.clientAccountId ? marginCache.get(session.account.clientAccountId) : null;
    const balanceInfo = pickMarginBalance(cachedMargin);
    const riskPerTrade = Number(body.riskPerTrade ?? 1.5);
    const dailyStop = Number(body.dailyStop ?? 4);
    const rewardRiskRatio = Number(body.rewardRiskRatio ?? 2);
    const markets = Array.isArray(body.markets) && body.markets.length ? body.markets : topForexMarkets;
    let livePrices = [];
    const candleDecisions = [];
    if (session) {
      try {
        const resolvedMarkets = [];
        for (const market of markets) {
          resolvedMarkets.push(await findMarket(session, market));
        }
        livePrices = await subscribePricesOnce({ session, markets: resolvedMarkets });
      } catch (error) {
        writeDebug("forex-live-price-scan-error", { error: error.message });
      }

      for (const market of markets) {
        try {
          candleDecisions.push(await runCandleStrategy({
            session,
            market,
            riskPerTrade,
            dailyStop,
            rewardRiskRatio,
            balance: balanceInfo?.value || 0,
          }));
        } catch (error) {
          writeDebug("bot-candle-scan-fallback", { market, error: error.message });
        }
      }
    }

    const liveByName = new Map(livePrices.map((price) => [String(price.market).replace("/", "").replace(/\s/g, "").toUpperCase(), price]));
    const candleByName = new Map(candleDecisions.map((decision) => [decision.market.replace("/", "").replace(/\s/g, "").toUpperCase(), decision]));
    const decisions = markets.map((market) => {
      const key = market.replace("/", "").replace(/\s/g, "").toUpperCase();
      const livePrice = liveByName.get(key) || Array.from(liveByName.values()).find((price) => marketNameMatches(price, market));
      const candleDecision = candleByName.get(key);
      if (candleDecision && livePrice?.mid) {
        candleDecision.lastPrice = livePrice.mid;
        candleDecision.liveBid = livePrice.bid;
        candleDecision.liveOffer = livePrice.offer;
        candleDecision.liveSpread = livePrice.spread;
      }
      return candleDecision || (livePrice
        ? runLivePriceDecision({ price: livePrice, riskPerTrade, dailyStop, rewardRiskRatio, balance: balanceInfo?.value || 0 })
        : runMovingAverageStrategy({ market, riskPerTrade, dailyStop, rewardRiskRatio, balance: balanceInfo?.value || 0 }));
    });
    const signal = decisions.find((decision) => decision.status === "simulated_signal");
    const selected = signal || decisions[0];

    const supabase = await getSupabaseAdmin();
    const profile = await getOrCreateDefaultProfile();
    const { data, error } = await supabase
      .from("trade_logs")
      .insert({
        profile_id: profile.id,
        broker_order_id: null,
        market: selected.market,
        direction: selected.direction,
        quantity: selected.riskAmount,
        entry_price: selected.lastPrice,
        exit_price: null,
        profit_loss: null,
        status: signal ? "simulated_scan_signal" : "simulated_scan_hold",
        reason: `Top-15 scan selected ${selected.market}: ${selected.reason} Expected risk ${selected.expectedRisk.toFixed(2)}, expected profit ${selected.expectedProfit.toFixed(2)}. Analysis logged; no live order sent from this panel.`,
      })
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    sendJson(res, 200, {
      ok: true,
      mode: "analysis",
      scannedMarkets: markets.length,
      balanceSource: balanceInfo?.key || null,
      priceSource: candleDecisions.length ? "FOREX.com candle history" : livePrices.length ? "FOREX.com PRICES stream" : "simulated fallback",
      livePrices,
      selected,
      decisions,
      tradeLog: data,
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: error.message,
    });
  }
}

async function handleDemoPositions(req, res) {
  try {
    const profile = await getOrCreateDefaultProfile();
    const positions = getDemoPositions(profile.id);
    const openPositions = positions.filter((position) => position.status === "open");
    const closedPositions = positions.filter((position) => position.status === "closed");
    const realizedProfitLoss = closedPositions.reduce((total, position) => total + Number(position.profitLoss || 0), 0);

    sendJson(res, 200, {
      ok: true,
      summary: {
        openCount: openPositions.length,
        closedCount: closedPositions.length,
        realizedProfitLoss,
      },
      positions,
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: error.message,
    });
  }
}

async function handleDemoOpen(req, res) {
  try {
    const body = JSON.parse((await readBody(req)) || "{}");
    const profile = await getOrCreateDefaultProfile();
    const positions = getDemoPositions(profile.id);
    const session = await getStoredSession(body.sessionId);
    const cachedMargin = session?.account?.clientAccountId ? marginCache.get(session.account.clientAccountId) : null;
    const balanceInfo = pickMarginBalance(cachedMargin);
    const riskPerTrade = Number(body.riskPerTrade ?? 1.5);
    const dailyStop = Number(body.dailyStop ?? 4);
    const rewardRiskRatio = Number(body.rewardRiskRatio ?? 2);
    const market = body.market || "EUR/USD";
    let decision;

    if (session) {
      try {
        decision = await runCandleStrategy({
          session,
          market,
          riskPerTrade,
          dailyStop,
          rewardRiskRatio,
          balance: balanceInfo?.value || 0,
        });
      } catch (error) {
        writeDebug("demo-open-candle-fallback", { market, error: error.message });
      }
    }

    decision ||= runMovingAverageStrategy({
      market,
      riskPerTrade,
      dailyStop,
      rewardRiskRatio,
      balance: balanceInfo?.value || 0,
    });

    if (!["BUY", "SELL"].includes(decision.direction)) {
      const tradeLog = await logDemoTrade({
        profile,
        position: {
          id: `demo-${crypto.randomUUID()}`,
          market,
          direction: decision.direction,
          riskAmount: decision.riskAmount,
          entryPrice: decision.lastPrice,
        },
        status: "demo_no_trade",
        currentPrice: decision.lastPrice,
        profitLoss: 0,
        reason: `No demo position opened: ${decision.reason}`,
      });

      sendJson(res, 200, {
        ok: true,
        opened: false,
        decision,
        tradeLog,
      });
      return;
    }

    const position = {
      id: `demo-${crypto.randomUUID()}`,
      status: "open",
      market: decision.market,
      direction: decision.direction,
      entryPrice: decision.lastPrice,
      stopLoss: decision.suggestedStop,
      takeProfit: decision.suggestedTakeProfit,
      riskAmount: decision.expectedRisk,
      expectedProfit: decision.expectedProfit,
      openedAt: new Date().toISOString(),
      priceSource: decision.priceSource,
      reason: decision.reason,
    };
    positions.push(position);

    const tradeLog = await logDemoTrade({
      profile,
      position,
      status: "demo_open",
      currentPrice: position.entryPrice,
      profitLoss: null,
      reason: `Demo position opened. ${decision.reason}`,
    });

    sendJson(res, 200, {
      ok: true,
      opened: true,
      position,
      decision,
      tradeLog,
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: error.message,
    });
  }
}

async function handleDemoMark(req, res) {
  try {
    const body = JSON.parse((await readBody(req)) || "{}");
    const profile = await getOrCreateDefaultProfile();
    const positions = getDemoPositions(profile.id);
    const session = await getStoredSession(body.sessionId);
    const openPositions = positions.filter((position) => position.status === "open");
    const updates = [];

    for (const position of openPositions) {
      let currentPrice = Number(body.currentPrice);
      if (!Number.isFinite(currentPrice) && session) {
        try {
          const result = await getPriceBars({
            session,
            marketName: position.market,
            interval: "MINUTE",
            span: 5,
            maxResults: 5,
          });
          currentPrice = result.bars.at(-1)?.close;
        } catch (error) {
          writeDebug("demo-mark-price-error", { market: position.market, error: error.message });
        }
      }

      if (!Number.isFinite(currentPrice)) {
        continue;
      }

      const evaluation = evaluateDemoPosition(position, currentPrice);
      position.currentPrice = currentPrice;
      position.unrealizedProfitLoss = Number(evaluation.estimatedProfitLoss.toFixed(2));
      position.updatedAt = new Date().toISOString();

      if (evaluation.hitTarget || evaluation.hitStop) {
        position.status = "closed";
        position.closedAt = new Date().toISOString();
        position.exitPrice = currentPrice;
        position.profitLoss = Number((evaluation.hitTarget ? position.expectedProfit : -position.riskAmount).toFixed(2));
        const tradeLog = await logDemoTrade({
          profile,
          position,
          status: evaluation.hitTarget ? "demo_take_profit" : "demo_stop_loss",
          currentPrice,
          profitLoss: position.profitLoss,
          reason: evaluation.hitTarget ? "Demo take profit reached." : "Demo stop loss reached.",
        });
        updates.push({ position, tradeLog });
      } else {
        updates.push({ position });
      }
    }

    const closedPositions = positions.filter((position) => position.status === "closed");
    const realizedProfitLoss = closedPositions.reduce((total, position) => total + Number(position.profitLoss || 0), 0);

    sendJson(res, 200, {
      ok: true,
      updates,
      summary: {
        openCount: positions.filter((position) => position.status === "open").length,
        closedCount: closedPositions.length,
        realizedProfitLoss,
      },
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: error.message,
    });
  }
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestedPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.resolve(root, `.${requestedPath}`);

  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, contents) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
    });
    res.end(contents);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "POST" && req.url === "/api/forexcom/connect") {
    handleForexConnect(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/forexcom/config") {
    handleForexConfig(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    handleHealth(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/forexcom/snapshot") {
    handleForexSnapshot(req, res, url);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/forexcom/margin") {
    handleForexMargin(req, res, url);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/forexcom/debug") {
    handleForexDebug(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/forexcom/markets") {
    handleForexMarkets(req, res, url);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/forexcom/prices") {
    handleForexPrices(req, res, url);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/forexcom/candles") {
    handleForexCandles(req, res, url);
    return;
  }

  if (req.method === "GET" && req.url === "/api/base44/status") {
    handleBase44Status(req, res);
    return;
  }

  if (req.method === "GET" && req.url === "/api/base44/sdk-test") {
    handleBase44SdkTest(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/supabase/status") {
    handleSupabaseStatus(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/supabase/check") {
    handleSupabaseCheck(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/bot/settings") {
    handleBotSettings(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/trades/log") {
    handleTradeLog(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/live/status") {
    handleLiveTradingStatus(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/ops/status") {
    handleOpsStatus(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/live/trade") {
    handleLiveTradeExecute(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/bot/run") {
    handleBotRun(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/bot/scan") {
    handleBotScan(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/demo/positions") {
    handleDemoPositions(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/demo/open") {
    handleDemoOpen(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/demo/mark") {
    handleDemoMark(req, res);
    return;
  }

  if (req.method === "GET") {
    serveStatic(req, res);
    return;
  }

  sendJson(res, 405, { ok: false, error: "Method not allowed." });
});

server.listen(port, () => {
  console.log(`Forex Auto Bot running at http://localhost:${port}`);
});
