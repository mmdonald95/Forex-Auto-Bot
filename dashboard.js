const sessionId = localStorage.getItem("forexSessionId") || "";

const dashboardStatus = document.querySelector("[data-dashboard-status]");
const accountValue = document.querySelector("[data-account-value]");
const moneyMade = document.querySelector("[data-money-made]");
const moneySpent = document.querySelector("[data-money-spent]");
const openCount = document.querySelector("[data-open-count]");
const accountUpdated = document.querySelector("[data-account-updated]");
const accountUser = document.querySelector("[data-account-user]");
const accountCurrency = document.querySelector("[data-account-currency]");
const clientAccount = document.querySelector("[data-client-account]");
const tradingAccount = document.querySelector("[data-trading-account]");
const balanceSource = document.querySelector("[data-balance-source]");
const positionsStatus = document.querySelector("[data-dashboard-positions-status]");
const positionsList = document.querySelector("[data-dashboard-positions-list]");
const historyStatus = document.querySelector("[data-dashboard-history-status]");
const historyList = document.querySelector("[data-dashboard-history-list]");
const refreshButton = document.querySelector("[data-refresh-dashboard]");
const marketForm = document.querySelector("[data-dashboard-market-form]");
const marketsStatus = document.querySelector("[data-dashboard-markets-status]");
const marketsList = document.querySelector("[data-dashboard-markets-list]");
const supabaseDbStatus = document.querySelector("[data-supabase-db-status]");
const dbProfile = document.querySelector("[data-db-profile]");
const dbBrokers = document.querySelector("[data-db-brokers]");
const dbSettings = document.querySelector("[data-db-settings]");
const dbTrades = document.querySelector("[data-db-trades]");
const settingsForm = document.querySelector("[data-settings-form]");
const settingsStatus = document.querySelector("[data-settings-status]");
const runBotButton = document.querySelector("[data-run-bot]");
const scanBotButton = document.querySelector("[data-scan-bot]");
const botStatus = document.querySelector("[data-bot-status]");
const botResult = document.querySelector("[data-bot-result]");
const decisionDirection = document.querySelector("[data-decision-direction]");
const decisionPrice = document.querySelector("[data-decision-price]");
const decisionShort = document.querySelector("[data-decision-short]");
const decisionLong = document.querySelector("[data-decision-long]");
const decisionStop = document.querySelector("[data-decision-stop]");
const decisionTarget = document.querySelector("[data-decision-target]");
const decisionRisk = document.querySelector("[data-decision-risk]");
const decisionProfit = document.querySelector("[data-decision-profit]");
const decisionRewardRisk = document.querySelector("[data-decision-rr]");
const decisionSource = document.querySelector("[data-decision-source]");
const decisionCandles = document.querySelector("[data-decision-candles]");
const decisionSpread = document.querySelector("[data-decision-spread]");
const decisionReason = document.querySelector("[data-decision-reason]");
const refreshPricesButton = document.querySelector("[data-refresh-prices]");
const livePricesStatus = document.querySelector("[data-live-prices-status]");
const livePricesList = document.querySelector("[data-live-prices-list]");
const candlesForm = document.querySelector("[data-candles-form]");
const candlesStatus = document.querySelector("[data-candles-status]");
const candlesChart = document.querySelector("[data-candles-chart]");
const demoStatus = document.querySelector("[data-demo-status]");
const demoRefreshButton = document.querySelector("[data-demo-refresh]");
const demoOpenButton = document.querySelector("[data-demo-open]");
const demoMarkButton = document.querySelector("[data-demo-mark]");
const demoOpenCount = document.querySelector("[data-demo-open-count]");
const demoClosedCount = document.querySelector("[data-demo-closed-count]");
const demoRealized = document.querySelector("[data-demo-realized]");
const demoUpdated = document.querySelector("[data-demo-updated]");
const demoTableStatus = document.querySelector("[data-demo-table-status]");
const demoList = document.querySelector("[data-demo-list]");

function firstValue(item, names, fallback = "--") {
  for (const name of names) {
    if (item?.[name] !== undefined && item?.[name] !== null && item?.[name] !== "") {
      return item[name];
    }
  }

  return fallback;
}

function numericValue(item, names) {
  const value = firstValue(item, names, null);
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function money(value, currency = "USD") {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "--";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 2,
  }).format(Number(value));
}

async function readJsonResponse(response) {
  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    const compact = text.replace(/\s+/g, " ").trim().slice(0, 160);
    throw new Error(`Server returned ${response.status} ${response.statusText || ""}: ${compact || "non-JSON response"}`);
  }

  return text ? JSON.parse(text) : {};
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Request timed out. Refresh or sign in again if the FOREX.com session expired.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function on(element, eventName, handler) {
  if (element) {
    element.addEventListener(eventName, handler);
  }
}

function setRows(container, items, columns, emptyText) {
  container.innerHTML = "";

  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = emptyText;
    container.appendChild(empty);
    return;
  }

  for (const item of items.slice(0, 12)) {
    const row = document.createElement("div");
    row.className = "data-row";

    for (const column of columns) {
      const cell = document.createElement("span");
      cell.textContent = firstValue(item, column.names);
      row.appendChild(cell);
    }

    container.appendChild(row);
  }
}

function setPriceRows(prices) {
  livePricesList.innerHTML = "";

  if (!prices.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No live prices returned.";
    livePricesList.appendChild(empty);
    return;
  }

  for (const price of prices) {
    const row = document.createElement("div");
    row.className = "data-row price-row";
    for (const value of [price.market, price.bid, price.offer, price.mid, price.spread]) {
      const cell = document.createElement("span");
      cell.textContent = value ?? "--";
      row.appendChild(cell);
    }
    livePricesList.appendChild(row);
  }
}

function renderDemoPositions(data) {
  const positions = data.positions || [];
  demoOpenCount.textContent = data.summary?.openCount ?? 0;
  demoClosedCount.textContent = data.summary?.closedCount ?? 0;
  demoRealized.textContent = money(data.summary?.realizedProfitLoss ?? 0, accountCurrency.textContent || "USD");
  demoUpdated.textContent = new Date().toLocaleTimeString();
  demoTableStatus.textContent = `${positions.length} position(s)`;
  demoList.innerHTML = "";

  if (!positions.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No demo positions yet.";
    demoList.appendChild(empty);
    return;
  }

  for (const position of positions.slice().reverse().slice(0, 10)) {
    const row = document.createElement("div");
    row.className = "data-row";
    const values = [
      position.market,
      position.direction,
      position.status,
      position.entryPrice,
    ];
    for (const value of values) {
      const cell = document.createElement("span");
      cell.textContent = value ?? "--";
      row.appendChild(cell);
    }
    demoList.appendChild(row);
  }
}

function drawCandles(bars) {
  candlesChart.innerHTML = "";

  if (!bars.length) {
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", "500");
    text.setAttribute("y", "210");
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("fill", "#8ca0a4");
    text.textContent = "No candle data returned.";
    candlesChart.appendChild(text);
    return;
  }

  const width = 1000;
  const height = 420;
  const padding = { top: 24, right: 70, bottom: 34, left: 54 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const highs = bars.map((bar) => bar.high);
  const lows = bars.map((bar) => bar.low);
  const max = Math.max(...highs);
  const min = Math.min(...lows);
  const scaleY = (value) => padding.top + ((max - value) / (max - min || 1)) * plotHeight;
  const step = plotWidth / bars.length;
  const bodyWidth = Math.max(4, Math.min(14, step * 0.62));

  for (let i = 0; i < 5; i += 1) {
    const y = padding.top + (plotHeight / 4) * i;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", padding.left);
    line.setAttribute("x2", width - padding.right);
    line.setAttribute("y1", y);
    line.setAttribute("y2", y);
    line.setAttribute("class", "chart-grid-line");
    candlesChart.appendChild(line);

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", width - padding.right + 12);
    label.setAttribute("y", y + 4);
    label.setAttribute("class", "chart-label");
    label.textContent = (max - ((max - min) / 4) * i).toFixed(5);
    candlesChart.appendChild(label);
  }

  bars.forEach((bar, index) => {
    const x = padding.left + index * step + step / 2;
    const open = scaleY(bar.open);
    const close = scaleY(bar.close);
    const high = scaleY(bar.high);
    const low = scaleY(bar.low);
    const bullish = bar.close >= bar.open;

    const wick = document.createElementNS("http://www.w3.org/2000/svg", "line");
    wick.setAttribute("x1", x);
    wick.setAttribute("x2", x);
    wick.setAttribute("y1", high);
    wick.setAttribute("y2", low);
    wick.setAttribute("class", bullish ? "candle-wick up" : "candle-wick down");
    candlesChart.appendChild(wick);

    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", x - bodyWidth / 2);
    rect.setAttribute("y", Math.min(open, close));
    rect.setAttribute("width", bodyWidth);
    rect.setAttribute("height", Math.max(2, Math.abs(close - open)));
    rect.setAttribute("rx", "1");
    rect.setAttribute("class", bullish ? "candle-body up" : "candle-body down");
    candlesChart.appendChild(rect);
  });
}

function sumPositive(items, names) {
  return items.reduce((total, item) => {
    const value = numericValue(item, names);
    return value && value > 0 ? total + value : total;
  }, 0);
}

function sumNegativeAbs(items, names) {
  return items.reduce((total, item) => {
    const value = numericValue(item, names);
    return value && value < 0 ? total + Math.abs(value) : total;
  }, 0);
}

function estimateOpenCost(positions) {
  return positions.reduce((total, position) => {
    const quantity = numericValue(position, ["Quantity", "OpenQuantity", "OriginalQuantity"]);
    const price = numericValue(position, ["Price", "OpenPrice", "OpeningPrice"]);
    return quantity && price ? total + Math.abs(quantity * price) : total;
  }, 0);
}

async function loadSnapshot() {
  if (!sessionId) {
    dashboardStatus.textContent = "No connected session found. Go back to Connection and log in first.";
    return;
  }

  dashboardStatus.textContent = "Refreshing FOREX.com account data...";
  let response;
  let data;
  try {
    response = await fetchWithTimeout(`/api/forexcom/snapshot?sessionId=${encodeURIComponent(sessionId)}`);
    data = await readJsonResponse(response);
  } catch (error) {
    dashboardStatus.textContent = error.message;
    return;
  }

  if (!response.ok || !data.ok) {
    dashboardStatus.textContent = data.error || "Unable to load account data.";
    return;
  }

  const account = data.account || {};
  const primary = data.primaryTradingAccount || {};
  const positions = data.positions || [];
  const history = data.tradeHistory || [];
  const currency = account.clientAccountCurrency || "USD";
  const marginBalance = data.margin ? numericValue(data.margin, [
    "Cash",
    "cash",
    "NetEquity",
    "netEquity",
    "AccountValue",
    "accountValue",
    "Balance",
    "balance",
    "AvailableToTrade",
    "availableToTrade",
    "TradableFunds",
    "tradableFunds",
    "MarginAvailable",
    "marginAvailable",
  ]) : null;
  const possibleBalance = marginBalance ?? numericValue(account, [
    "cash",
    "balance",
    "accountValue",
    "netEquity",
    "availableToTrade",
    "clientAccountBalance",
  ]);
  const made = sumPositive(history, ["ProfitAndLoss", "RealisedPnl", "RealizedPnl", "PnL", "Profit"]);
  const spent = sumNegativeAbs(history, ["ProfitAndLoss", "RealisedPnl", "RealizedPnl", "PnL", "Profit"]) || estimateOpenCost(positions);

  dashboardStatus.textContent = data.warning || data.warnings?.length
    ? `${data.warning || data.warnings.join(" ")} Loading live FOREX.com margin balance...`
    : "Dashboard synced. Loading live FOREX.com margin balance...";
  accountValue.textContent = possibleBalance === null ? "--" : money(possibleBalance, currency);
  moneyMade.textContent = money(made || null, currency);
  moneySpent.textContent = money(spent || null, currency);
  openCount.textContent = positions.length;
  accountUpdated.textContent = new Date().toLocaleString();
  accountUser.textContent = account.logonUserName || "--";
  accountCurrency.textContent = currency;
  clientAccount.textContent = account.clientAccountId || "--";
  tradingAccount.textContent = primary.tradingAccountId || "Not returned";
  balanceSource.textContent = marginBalance !== null ? "CLIENTACCOUNTMARGIN stream cache" : "Waiting for live margin stream";

  positionsStatus.textContent = `${positions.length} open position(s)`;
  historyStatus.textContent = `${history.length} recent trade(s)`;

  setRows(
    positionsList,
    positions,
    [
      { names: ["MarketName", "Market", "Name"] },
      { names: ["Direction", "TradeDirection"] },
      { names: ["Quantity", "OpenQuantity"] },
      { names: ["Price", "OpenPrice", "OpeningPrice"] },
    ],
    "No open positions returned."
  );

  setRows(
    historyList,
    history,
    [
      { names: ["MarketName", "Market", "Name"] },
      { names: ["Direction", "TradeDirection"] },
      { names: ["Quantity", "OriginalQuantity"] },
      { names: ["ProfitAndLoss", "RealisedPnl", "RealizedPnl", "PnL", "Profit"] },
    ],
    "No trade history returned."
  );

  loadMargin(currency);
}

async function loadMargin(currency = "USD") {
  try {
    const response = await fetchWithTimeout(`/api/forexcom/margin?sessionId=${encodeURIComponent(sessionId)}`, {}, 12000);
    const data = await readJsonResponse(response);

    if (!response.ok || !data.ok) {
      dashboardStatus.textContent = data.hint || data.error || "Unable to load live margin balance.";
      balanceSource.textContent = "CLIENTACCOUNTMARGIN unavailable";
      return;
    }

    if (data.balance?.value !== null && data.balance?.value !== undefined) {
      accountValue.textContent = money(data.balance.value, currency);
    }
    balanceSource.textContent = data.balance?.key
      ? `CLIENTACCOUNTMARGIN.${data.balance.key}`
      : "CLIENTACCOUNTMARGIN returned no known balance field";
    dashboardStatus.textContent = data.warning
      ? `Using fallback balance. Streaming warning: ${data.warning}`
      : data.balance?.key
      ? "Live FOREX.com account value loaded from streaming margin data."
      : "Connected, but FOREX.com did not return a recognized balance field.";
  } catch (error) {
    dashboardStatus.textContent = "Live margin balance failed to load. Use http://localhost:3000 and reconnect.";
    balanceSource.textContent = "Margin request failed";
  }
}

async function searchMarkets(query) {
  marketsStatus.textContent = "Searching...";
  const response = await fetch(`/api/forexcom/markets?sessionId=${encodeURIComponent(sessionId)}&query=${encodeURIComponent(query)}`);
  const data = await readJsonResponse(response);

  if (!response.ok || !data.ok) {
    marketsStatus.textContent = data.error || "Market search failed.";
    return;
  }

  const markets = data.markets || [];
  marketsStatus.textContent = `${markets.length} result(s)`;
  setRows(
    marketsList,
    markets,
    [
      { names: ["Name", "MarketName"] },
      { names: ["MarketId", "Id"] },
      { names: ["MarketType", "MarketTypeId"] },
      { names: ["Currency", "CurrencyCode"] },
    ],
    "No markets returned."
  );
}

async function loadLivePrices() {
  if (!sessionId) {
    livePricesStatus.textContent = "Connect to FOREX.com first.";
    return;
  }

  livePricesStatus.textContent = "Loading from FOREX.com...";
  try {
    const response = await fetch(`/api/forexcom/prices?sessionId=${encodeURIComponent(sessionId)}`);
    const data = await readJsonResponse(response);

    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Live price load failed.");
    }

    livePricesStatus.textContent = `${data.prices.length} live price(s) from FOREX.com`;
    setPriceRows(data.prices);
  } catch (error) {
    livePricesStatus.textContent = error.message;
  }
}

async function loadCandles(formData = new FormData(candlesForm)) {
  if (!sessionId) {
    candlesStatus.textContent = "Connect to FOREX.com first.";
    return;
  }

  const [interval, span] = String(formData.get("timeframe") || "MINUTE:15").split(":");
  const market = formData.get("market") || "EUR/USD";
  candlesStatus.textContent = "Loading FOREX.com candles...";

  try {
    const response = await fetch(`/api/forexcom/candles?sessionId=${encodeURIComponent(sessionId)}&market=${encodeURIComponent(market)}&interval=${encodeURIComponent(interval)}&span=${encodeURIComponent(span)}&maxResults=80`);
    const data = await readJsonResponse(response);

    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Candle load failed.");
    }

    candlesStatus.textContent = `${data.bars.length} ${market} candle(s) from FOREX.com`;
    drawCandles(data.bars);
  } catch (error) {
    candlesStatus.textContent = error.message;
    drawCandles([]);
  }
}

async function loadDemoPositions() {
  try {
    const response = await fetchWithTimeout("/api/demo/positions", {}, 10000);
    const data = await readJsonResponse(response);
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Unable to load demo positions.");
    }
    demoStatus.textContent = "Demo P/L loaded.";
    renderDemoPositions(data);
  } catch (error) {
    demoStatus.textContent = error.message;
  }
}

async function openDemoPosition() {
  demoStatus.textContent = "Opening simulated position...";
  const formData = new FormData(settingsForm);
  const payload = {
    sessionId,
    market: "EUR/USD",
    riskPerTrade: formData.get("riskPerTrade") || 1.5,
    dailyStop: formData.get("dailyStop") || 4,
    rewardRiskRatio: formData.get("rewardRiskRatio") || 2,
  };

  try {
    const response = await fetch("/api/demo/open", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await readJsonResponse(response);
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Unable to open demo position.");
    }
    demoStatus.textContent = data.opened ? "Demo position opened." : "No trade opened; signal was HOLD.";
    await loadDemoPositions();
    await loadSupabaseCheck();
  } catch (error) {
    demoStatus.textContent = error.message;
  }
}

async function markDemoPositions() {
  demoStatus.textContent = "Marking open demo positions...";
  try {
    const response = await fetch("/api/demo/mark", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sessionId }),
    });
    const data = await readJsonResponse(response);
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Unable to mark demo positions.");
    }
    demoStatus.textContent = "Demo positions marked.";
    await loadDemoPositions();
    await loadSupabaseCheck();
  } catch (error) {
    demoStatus.textContent = error.message;
  }
}

async function loadSupabaseCheck() {
  try {
    const response = await fetchWithTimeout("/api/supabase/check", {}, 10000);
    const data = await readJsonResponse(response);

    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Supabase check failed.");
    }

    supabaseDbStatus.textContent = "Connected";
    dbProfile.textContent = data.profile?.full_name || data.profile?.email || "--";
    dbBrokers.textContent = data.counts?.brokerConnections ?? "--";
    dbSettings.textContent = data.counts?.botSettings ?? "--";
    dbTrades.textContent = data.counts?.tradeLogs ?? "--";
  } catch (error) {
    if (supabaseDbStatus) {
      supabaseDbStatus.textContent = error.message;
    }
  }
}

on(settingsForm, "submit", async (event) => {
  event.preventDefault();
  settingsStatus.textContent = "Saving...";
  const formData = new FormData(settingsForm);
  const payload = {
    riskPerTrade: formData.get("riskPerTrade"),
    dailyStop: formData.get("dailyStop"),
    newsFilter: formData.has("newsFilter"),
    botEnabled: formData.has("botEnabled"),
  };

  try {
    const response = await fetch("/api/bot/settings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await readJsonResponse(response);

    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Save failed.");
    }

    settingsStatus.textContent = "Saved to Supabase.";
    await loadSupabaseCheck();
  } catch (error) {
    settingsStatus.textContent = error.message;
  }
});

async function runBotRequest(endpoint, statusText) {
  botStatus.textContent = statusText;
  const formData = new FormData(settingsForm);
  const payload = {
    sessionId,
    market: "EUR/USD",
    riskPerTrade: formData.get("riskPerTrade") || 1.5,
    dailyStop: formData.get("dailyStop") || 4,
    rewardRiskRatio: formData.get("rewardRiskRatio") || 2,
  };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await readJsonResponse(response);

    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Bot run failed.");
    }

    const decision = data.decision || data.selected;
    botResult.hidden = false;
    decisionDirection.textContent = decision.direction;
    decisionPrice.textContent = decision.lastPrice;
    decisionShort.textContent = decision.shortMa;
    decisionLong.textContent = decision.longMa;
    decisionStop.textContent = decision.suggestedStop;
    decisionTarget.textContent = decision.suggestedTakeProfit;
    decisionRisk.textContent = money(decision.expectedRisk, accountCurrency.textContent || "USD");
    decisionProfit.textContent = money(decision.expectedProfit, accountCurrency.textContent || "USD");
    decisionRewardRisk.textContent = `${decision.rewardRiskRatio}:1`;
    decisionSource.textContent = decision.priceSource || data.priceSource || "Unknown";
    decisionCandles.textContent = decision.candleCount ?? "--";
    decisionSpread.textContent = decision.liveSpread ?? decision.spreadPips ?? "--";
    decisionReason.textContent = decision.reason;
    botStatus.textContent = data.scannedMarkets
      ? `Scanned ${data.scannedMarkets} pairs. Decision logged to Supabase.`
      : "Decision logged to Supabase.";
    await loadSupabaseCheck();
  } catch (error) {
    botStatus.textContent = error.message;
  }
}

on(runBotButton, "click", async () => {
  await runBotRequest("/api/bot/run", "Running EUR/USD simulation...");
});

on(scanBotButton, "click", async () => {
  await runBotRequest("/api/bot/scan", "Scanning top 15 pairs...");
});

on(refreshPricesButton, "click", loadLivePrices);
on(candlesForm, "submit", (event) => {
  event.preventDefault();
  loadCandles(new FormData(candlesForm));
});
on(demoRefreshButton, "click", loadDemoPositions);
on(demoOpenButton, "click", openDemoPosition);
on(demoMarkButton, "click", markDemoPositions);

on(refreshButton, "click", loadSnapshot);
on(marketForm, "submit", (event) => {
  event.preventDefault();
  const formData = new FormData(marketForm);
  searchMarkets(formData.get("query") || "EUR/USD");
});

loadSnapshot().catch((error) => {
  dashboardStatus.textContent = error.message;
});
loadSupabaseCheck().catch((error) => {
  if (supabaseDbStatus) {
    supabaseDbStatus.textContent = error.message;
  }
});
loadDemoPositions().catch((error) => {
  if (demoStatus) {
    demoStatus.textContent = error.message;
  }
});
