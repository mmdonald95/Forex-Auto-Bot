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
const sessions = new Map();

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
      account = {
        ...account,
        ...data,
        logonUserName: data.UserName || data.userName || username,
        clientAccountId: data.ClientAccountId || data.clientAccountId || data.AccountId || data.accountId || null,
        clientAccountCurrency: data.ClientAccountCurrency || data.clientAccountCurrency || "USD"
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

    sendJson(res, 200, {
      ok: true,
      localSessionId,
      account,
      appKey: maskSecret(appKey)
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/forexcom/snapshot") {
    const session = sessions.get(url.searchParams.get("sessionId"));
    if (!session) {
      sendJson(res, 401, {
        ok: false,
        error: "Connect to FOREX.com first."
      });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      account: session.account,
      accountValue: null,
      positions: [],
      tradeHistory: [],
      primaryTradingAccount: null,
      accountValueSource: "connected session fallback"
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
