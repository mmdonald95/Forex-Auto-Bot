const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const { approveTrade, mergeRiskLimits } = require("./risk-manager");
const { evaluateValidationReport } = require("./validation-gate");
const { buildTradeJournalEntry } = require("./trade-journal");
const { registerStrategy, listStrategies } = require("./strategy-registry");

const root = __dirname;
const port = Number(process.env.PORT || 3000);

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
  }
});

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

  if (req.method === "POST" && url.pathname === "/api/signal") {
    const body = await readBody(req);
    const signal = generateDemoSignal(body);

    const limits = mergeRiskLimits(body.riskLimits || {});
    const approval = approveTrade(signal, limits);

    sendJson(res, 200, {
      signal,
      approval
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/risk/approve") {
    const body = await readBody(req);
    const limits = mergeRiskLimits(body.limits || {});
    const approval = approveTrade(body.trade || {}, limits);

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