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
const accountGreeting = document.querySelector("[data-account-greeting]");
const signinLink = document.querySelector("[data-signin-link]");
const dashboardTabs = document.querySelectorAll("[data-dashboard-tab]");
const dashboardPanels = document.querySelectorAll("[data-dashboard-tab-panel]");
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
const maxDailyLossInput = document.querySelector("[data-max-daily-loss]");
const dailyProfitGoalInput = document.querySelector("[data-daily-profit-goal]");
const startBotButtons = document.querySelectorAll("[data-start-bot], [data-start-bot-live]");
const stopBotButtons = document.querySelectorAll("[data-stop-bot], [data-stop-bot-live]");
const liveTradingToggle = document.querySelector("[data-live-trading-toggle]");
const autoExecutionAuthorization = document.querySelector("[data-auto-execution-authorization]");
const runBotButton = document.querySelector("[data-run-bot]");
const scanBotButton = document.querySelector("[data-scan-bot]");
const botStatus = document.querySelector("[data-bot-status]");
const botMode = document.querySelector("[data-bot-mode]");
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
const liveStatus = document.querySelector("[data-live-status]");
const validationStatus = document.querySelector("[data-validation-status]");
const validationDetail = document.querySelector("[data-validation-detail]");
const liveTradeForm = document.querySelector("[data-live-trade-form]");
const liveTradeButton = document.querySelector("[data-live-trade-button]");
const liveConfirm = document.querySelector("[data-live-confirm]");
const dailyLossLock = document.querySelector("[data-daily-loss-lock]");
const dailyProfitLock = document.querySelector("[data-daily-profit-lock]");
const emergencyStopButton = document.querySelector("[data-emergency-stop]");
const reconcileLiveButton = document.querySelector("[data-reconcile-live]");
const liveReconcileList = document.querySelector("[data-live-reconcile-list]");
const liveResult = document.querySelector("[data-live-result]");
const liveOrderStatus = document.querySelector("[data-live-order-status]");
const liveOrderMarket = document.querySelector("[data-live-order-market]");
const liveOrderDirection = document.querySelector("[data-live-order-direction]");
const liveOrderQuantity = document.querySelector("[data-live-order-quantity]");
const liveOrderEntry = document.querySelector("[data-live-order-entry]");
const liveOrderStop = document.querySelector("[data-live-order-stop]");
const liveOrderTarget = document.querySelector("[data-live-order-target]");
const liveOrderReason = document.querySelector("[data-live-order-reason]");
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

function parseBrokerNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const number = Number(String(value).replace(/[$,\s]/g, ""));
  return Number.isFinite(number) ? number : null;
}

function numericValue(item, names) {
  const value = firstValue(item, names, null);
  return parseBrokerNumber(value);
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

function accountDisplayName(account) {
  const value = firstValue(account, [
    "logonUserName",
    "userName",
    "UserName",
    "accountName",
    "AccountName",
  ], "");

  return /^\d+$/.test(String(value)) ? "" : value;
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

function setDashboardTab(tabName) {
  dashboardTabs.forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.dashboardTab === tabName);
  });

  dashboardPanels.forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.dashboardTabPanel === tabName);
  });
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
  if (!livePricesList) {
    return;
  }

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
    for (const value of [
      price.market,
      price.bid === null || price.bid === undefined ? "--" : Number(price.bid).toFixed(5),
      price.offer === null || price.offer === undefined ? "--" : Number(price.offer).toFixed(5),
      price.mid === null || price.mid === undefined ? "--" : Number(price.mid).toFixed(5),
      price.spread === null || price.spread === undefined ? "--" : Number(price.spread).toFixed(5),
    ]) {
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

  const normalizedBars = (bars || [])
    .map((bar) => ({
      time: firstValue(bar, ["time", "Time", "BarDate", "Date"], ""),
      open: parseBrokerNumber(firstValue(bar, ["open", "Open", "OpenPrice"], null)),
      high: parseBrokerNumber(firstValue(bar, ["high", "High", "HighPrice"], null)),
      low: parseBrokerNumber(firstValue(bar, ["low", "Low", "LowPrice"], null)),
      close: parseBrokerNumber(firstValue(bar, ["close", "Close", "ClosePrice"], null)),
    }))
    .filter((bar) => [bar.open, bar.high, bar.low, bar.close].every((value) => value !== null));

  if (!normalizedBars.length) {
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
  const highs = normalizedBars.map((bar) => bar.high);
  const lows = normalizedBars.map((bar) => bar.low);
  const max = Math.max(...highs);
  const min = Math.min(...lows);
  const scaleY = (value) => padding.top + ((max - value) / (max - min || 1)) * plotHeight;
  const step = plotWidth / normalizedBars.length;
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

  normalizedBars.forEach((bar, index) => {
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
    if (accountGreeting) {
      accountGreeting.textContent = "Not connected";
    }
    if (signinLink) {
      signinLink.textContent = "Sign In";
    }
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
  const displayName = accountDisplayName(account);
  const primary = data.primaryTradingAccount || {};
  const positions = data.positions || [];
  const history = data.tradeHistory || [];
  const currency = account.clientAccountCurrency || "USD";
  const accountValueBalance = data.accountValue?.value !== undefined ? parseBrokerNumber(data.accountValue.value) : null;
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
  const snapshotBalance = data.fallbackBalance?.value !== undefined ? parseBrokerNumber(data.fallbackBalance.value) : null;
  const possibleBalance = accountValueBalance ?? marginBalance ?? snapshotBalance ?? numericValue(account, [
    "netEquity",
    "accountValue",
    "balance",
    "clientAccountBalance",
    "cash",
    "availableToTrade",
  ]);
  const made = sumPositive(history, ["ProfitAndLoss", "RealisedPnl", "RealizedPnl", "PnL", "Profit"]);
  const spent = sumNegativeAbs(history, ["ProfitAndLoss", "RealisedPnl", "RealizedPnl", "PnL", "Profit"]) || estimateOpenCost(positions);

  dashboardStatus.textContent = possibleBalance === null
    ? "Connected, but no account value was returned yet."
    : `FOREX.com account value loaded from ${data.accountValueSource || "account snapshot"}.`;
  accountValue.textContent = possibleBalance === null ? "--" : money(possibleBalance, currency);
  moneyMade.textContent = money(made || null, currency);
  moneySpent.textContent = money(spent || null, currency);
  openCount.textContent = positions.length;
  accountUpdated.textContent = new Date().toLocaleString();
  accountUser.textContent = account.logonUserName || "--";
  if (accountGreeting && displayName) {
    accountGreeting.textContent = `Welcome, ${displayName}`;
  }
  if (signinLink) {
    signinLink.textContent = "Reconnect";
  }
  accountCurrency.textContent = currency;
  clientAccount.textContent = account.clientAccountId || "--";
  tradingAccount.textContent = primary.tradingAccountId || "Not returned";
  balanceSource.textContent = accountValueBalance !== null
    ? (data.accountValueSource || `FOREX.com ${data.accountValue.key}`)
    : marginBalance !== null
      ? "CLIENTACCOUNTMARGIN or saved engine snapshot"
    : snapshotBalance !== null
      ? `FOREX.com account snapshot (${data.fallbackBalance.key})`
      : "Waiting for live margin stream";

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

  if (possibleBalance === null) {
    loadLatestAccountValue(currency);
  } else {
    loadMargin(currency, { quiet: true });
  }
}

async function loadLatestAccountValue(currency = "USD") {
  try {
    const response = await fetchWithTimeout("/api/forexcom/latest-account-value", {}, 10000);
    const data = await readJsonResponse(response);

    if (!response.ok || !data.ok) {
      throw new Error(data.error || "No saved account value is available yet.");
    }

    if (data.balance?.value !== null && data.balance?.value !== undefined) {
      accountValue.textContent = money(data.balance.value, data.currency || currency);
      dashboardStatus.textContent = `FOREX.com account value loaded from ${data.source}.`;
      balanceSource.textContent = `${data.source} (${data.balance.key})`;
      if (data.updatedAt) {
        accountUpdated.textContent = new Date(data.updatedAt).toLocaleString();
      }
      return true;
    }

    throw new Error("Saved account value did not include a recognized balance field.");
  } catch (error) {
    dashboardStatus.textContent = `${error.message} Reconnect to FOREX.com, then refresh.`;
    balanceSource.textContent = "No saved account value";
    return false;
  }
}

async function loadMargin(currency = "USD", options = {}) {
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
    balanceSource.textContent = data.source
      ? `${data.source} (${data.balance?.key || "value"})`
      : data.balance?.key
        ? `CLIENTACCOUNTMARGIN.${data.balance.key}`
        : "FOREX.com returned no known balance field";
    if (!options.quiet || data.source !== "FOREX.com account snapshot") {
      dashboardStatus.textContent = data.warning && data.source !== "FOREX.com account snapshot"
        ? `Using fallback balance. Streaming warning: ${data.warning}`
        : data.balance?.key
          ? `FOREX.com account value loaded from ${data.source || "streaming margin data"}.`
          : "Connected, but FOREX.com did not return a recognized balance field.";
    }
  } catch (error) {
    if (!options.quiet) {
      dashboardStatus.textContent = "Live margin stream did not answer; showing the latest account snapshot when available.";
      balanceSource.textContent = "Margin request failed";
    }
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
    if (livePricesStatus) {
      livePricesStatus.textContent = "Connect to FOREX.com first.";
    }
    return;
  }

  if (livePricesStatus) {
    livePricesStatus.textContent = "Loading from FOREX.com...";
  }
  try {
    const response = await fetch(`/api/forexcom/prices?sessionId=${encodeURIComponent(sessionId)}`);
    const data = await readJsonResponse(response);

    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Live price load failed.");
    }

    if (livePricesStatus) {
      livePricesStatus.textContent = data.warning
        ? `${data.prices.length} price(s) from ${data.source}. Streaming fallback active.`
        : `${data.prices.length} live price(s) from ${data.source || "FOREX.com"}`;
    }
    setPriceRows(data.prices);
  } catch (error) {
    if (livePricesStatus) {
      livePricesStatus.textContent = error.message;
    }
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
  if (!demoStatus) {
    return;
  }

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
  if (!demoStatus) {
    return;
  }

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
  if (!demoStatus) {
    return;
  }

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
    const profileName = data.profile?.full_name || data.profile?.email || "--";
    dbProfile.textContent = profileName;
    if (accountGreeting && profileName !== "--") {
      accountGreeting.textContent = `Welcome, ${profileName}`;
    }
    dbBrokers.textContent = data.counts?.brokerConnections ?? "--";
    dbSettings.textContent = data.counts?.botSettings ?? "--";
    dbTrades.textContent = data.counts?.tradeLogs ?? "--";
  } catch (error) {
    if (supabaseDbStatus) {
      supabaseDbStatus.textContent = error.message;
    }
  }
}

function getBotSettingsPayload(botEnabledOverride = null) {
  const formData = new FormData(settingsForm);
  const riskPerTrade = Number(formData.get("riskPerTrade") || 1);
  const botEnabled = botEnabledOverride === null ? formData.has("botEnabled") : Boolean(botEnabledOverride);
  const liveModeUnlocked = Boolean(liveTradingToggle?.checked);
  const autoExecutionAuthorized = formData.has("autoExecutionAuthorized");

  if (botEnabled && riskPerTrade > 1) {
    throw new Error("Live trading risk is capped at 1%. Set Risk per trade to 1 or lower, then start the bot.");
  }

  if (botEnabled && liveModeUnlocked && !autoExecutionAuthorized) {
    throw new Error("Check the automatic live-trade authorization before starting the bot in live mode.");
  }

  return {
    riskPerTrade,
    dailyStop: formData.get("dailyStop"),
    maxDailyLossUsd: formData.get("maxDailyLossUsd"),
    dailyProfitGoalUsd: formData.get("dailyProfitGoalUsd"),
    newsFilter: formData.has("newsFilter"),
    botEnabled,
    autoExecutionAuthorized,
  };
}

async function saveBotSettings(botEnabledOverride = null, statusText = "Saving...") {
  settingsStatus.textContent = statusText;
  const payload = getBotSettingsPayload(botEnabledOverride);

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

  const botEnabledInput = settingsForm.querySelector("[name='botEnabled']");
  if (botEnabledInput) {
    botEnabledInput.checked = Boolean(payload.botEnabled);
  }

  settingsStatus.textContent = payload.botEnabled
    ? payload.autoExecutionAuthorized
      ? "Bot started. Automatic live trades are authorized within these risk limits."
      : "Bot started. It can analyze, but automatic live execution is not authorized."
    : "Bot stopped and saved.";
  await Promise.all([loadSupabaseCheck(), loadLiveTradingStatus(), loadValidationStatus()]);
  return data;
}

async function setLiveTradingLock(unlocked) {
  if (liveStatus) {
    liveStatus.textContent = unlocked ? "Unlocking live mode..." : "Locking live mode...";
  }

  const response = await fetchWithTimeout("/api/live/lock", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ unlocked }),
  }, 10000);
  const data = await readJsonResponse(response);

  if (!response.ok || !data.ok) {
    throw new Error(data.error || "Unable to update live trading lock.");
  }

  await loadLiveTradingStatus();
  return data;
}

on(settingsForm, "submit", async (event) => {
  event.preventDefault();
  try {
    await saveBotSettings(null, "Saving...");
  } catch (error) {
    settingsStatus.textContent = error.message;
  }
});

on(liveTradingToggle, "change", async () => {
  try {
    await setLiveTradingLock(liveTradingToggle.checked);
    settingsStatus.textContent = liveTradingToggle.checked
      ? "Live mode unlocked in the app."
      : "Live mode locked in the app.";
  } catch (error) {
    liveTradingToggle.checked = !liveTradingToggle.checked;
    settingsStatus.textContent = error.message;
    if (liveStatus) {
      liveStatus.textContent = error.message;
    }
  }
});

async function runBotRequest(endpoint, statusText) {
  botStatus.textContent = statusText;
    const formData = new FormData(settingsForm);
  const payload = {
    sessionId,
    market: "EUR/USD",
    riskPerTrade: formData.get("riskPerTrade") || 1,
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

async function loadLiveTradingStatus() {
  try {
    const response = await fetchWithTimeout("/api/live/status", {}, 10000);
    const data = await readJsonResponse(response);
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Unable to load live trading status.");
    }

    liveStatus.textContent = data.liveTradingEnabled
      ? data.botArmed
        ? `Live mode is unlocked and bot is armed. Max ${data.limits.maxLiveTradeQuantity} units, ${data.limits.maxDailyLiveTrades}/day, ${data.limits.maxLiveSpreadPips} pip spread.`
        : "Live mode is unlocked, but the bot is stopped. Click Start Bot when ready."
      : "Live mode is locked in the app. Turn on Live trading unlocked to allow live review.";
    if (botMode) {
      botMode.textContent = data.liveTradingEnabled
        ? data.botArmed
          ? "Live Armed"
          : "Live Standby"
        : "Live Locked";
    }
    const botEnabledInput = settingsForm?.querySelector("[name='botEnabled']");
    if (botEnabledInput) {
      botEnabledInput.checked = Boolean(data.botArmed);
    }
    if (liveTradingToggle) {
      liveTradingToggle.checked = Boolean(data.liveTradingEnabled);
    }
    if (autoExecutionAuthorization) {
      autoExecutionAuthorization.checked = Boolean(data.autoExecutionAuthorized);
    }
    if (dailyLossLock) {
      dailyLossLock.value = `${money(data.dailyLoss || 0, accountCurrency.textContent || "USD")} / ${money(data.limits.maxDailyLossUsd, accountCurrency.textContent || "USD")}`;
    }
    if (dailyProfitLock) {
      dailyProfitLock.value = data.limits.dailyProfitGoalUsd
        ? `${money(data.dailyProfit || 0, accountCurrency.textContent || "USD")} / ${money(data.limits.dailyProfitGoalUsd, accountCurrency.textContent || "USD")}`
        : `${money(data.dailyProfit || 0, accountCurrency.textContent || "USD")} / No goal set`;
    }
    if (maxDailyLossInput && document.activeElement !== maxDailyLossInput) {
      maxDailyLossInput.max = data.limits.backendMaxDailyLossUsd || data.limits.maxDailyLossUsd;
      maxDailyLossInput.value = data.limits.maxDailyLossUsd;
    }
    if (dailyProfitGoalInput && document.activeElement !== dailyProfitGoalInput && data.limits.dailyProfitGoalUsd) {
      dailyProfitGoalInput.value = data.limits.dailyProfitGoalUsd;
    }
    if (liveTradeButton) {
      liveTradeButton.disabled = !(data.liveExecutionReady && data.botArmed);
    }
    if (liveConfirm) {
      liveConfirm.placeholder = data.confirmText;
    }
  } catch (error) {
    if (liveStatus) {
      liveStatus.textContent = error.message;
    }
    if (botMode) {
      botMode.textContent = "Live Locked";
    }
    if (liveTradeButton) {
      liveTradeButton.disabled = true;
    }
  }
}

async function loadValidationStatus() {
  if (!validationStatus) {
    return;
  }

  try {
    const response = await fetchWithTimeout("/api/validation/status", {}, 10000);
    const data = await readJsonResponse(response);
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Unable to load validation status.");
    }

    const validation = data.validations?.[0];
    if (!validation) {
      validationStatus.textContent = "No strategies";
      validationDetail.textContent = "No strategy is registered for validation.";
      return;
    }

    validationStatus.textContent = validation.approved ? "Ready for live review" : "Live locked";
    validationDetail.textContent = validation.approved
      ? `${validation.strategy.name} passed validation requirements. Manual confirmation is still required before live orders.`
      : `${validation.strategy.name} is not live-ready: ${(validation.failures || []).join(", ")}.`;
  } catch (error) {
    validationStatus.textContent = "Live locked";
    validationDetail.textContent = error.message;
  }
}

async function emergencyStop() {
  liveStatus.textContent = "Stopping live trading...";
  if (liveTradeButton) {
    liveTradeButton.disabled = true;
  }

  try {
    const response = await fetchWithTimeout("/api/live/emergency-stop", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: "{}",
    }, 12000);
    const data = await readJsonResponse(response);
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Emergency stop failed.");
    }

    liveStatus.textContent = "Emergency stop saved. Bot enabled is off.";
    settingsStatus.textContent = "Emergency stop saved.";
    const botEnabled = settingsForm.querySelector("[name='botEnabled']");
    if (botEnabled) {
      botEnabled.checked = false;
    }
    await Promise.all([loadLiveTradingStatus(), loadSupabaseCheck()]);
  } catch (error) {
    liveStatus.textContent = error.message;
  }
}

function renderReconcileRows(data) {
  if (!liveReconcileList) {
    return;
  }

  liveReconcileList.innerHTML = "";
  const summary = [
    `Open positions: ${data.positions?.length || 0}`,
    `Active orders: ${data.activeOrders?.length || 0}`,
    `Recent trades: ${data.tradeHistory?.length || 0}`,
  ];

  for (const value of summary) {
    const row = document.createElement("div");
    row.className = "data-row";
    const cell = document.createElement("span");
    cell.textContent = value;
    row.appendChild(cell);
    liveReconcileList.appendChild(row);
  }
}

async function reconcileLiveOrders() {
  if (!sessionId) {
    liveStatus.textContent = "Connect to FOREX.com first.";
    return;
  }

  liveStatus.textContent = "Reconciling FOREX.com orders...";
  try {
    const response = await fetchWithTimeout(`/api/live/reconcile?sessionId=${encodeURIComponent(sessionId)}`, {}, 15000);
    const data = await readJsonResponse(response);
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Unable to reconcile live orders.");
    }

    renderReconcileRows(data);
    liveStatus.textContent = `Reconciled ${data.positions.length} position(s), ${data.activeOrders.length} active order(s).`;
    openCount.textContent = data.positions.length;
  } catch (error) {
    liveStatus.textContent = error.message;
  }
}

async function executeLiveTrade(event) {
  event.preventDefault();
  if (!sessionId) {
    liveStatus.textContent = "Connect to FOREX.com first.";
    return;
  }

  const settings = new FormData(settingsForm);
  const formData = new FormData(liveTradeForm);
  const payload = {
    sessionId,
    market: formData.get("market"),
    quantity: formData.get("quantity"),
    maxSpreadPips: formData.get("maxSpreadPips"),
    confirmText: formData.get("confirmText"),
    riskPerTrade: settings.get("riskPerTrade") || 1,
    dailyStop: settings.get("dailyStop") || 4,
    rewardRiskRatio: settings.get("rewardRiskRatio") || 2,
  };

  liveStatus.textContent = "Checking strategy and safety limits...";
  liveTradeButton.disabled = true;

  try {
    const response = await fetchWithTimeout("/api/live/trade", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }, 25000);
    const data = await readJsonResponse(response);
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Live trade was not placed.");
    }

    const decision = data.decision || {};
    liveResult.hidden = false;
    liveOrderStatus.textContent = "Sent to FOREX.com";
    liveOrderMarket.textContent = decision.market || payload.market;
    liveOrderDirection.textContent = decision.direction || "--";
    liveOrderQuantity.textContent = payload.quantity;
    liveOrderEntry.textContent = decision.lastPrice ?? "--";
    liveOrderStop.textContent = decision.suggestedStop ?? "--";
    liveOrderTarget.textContent = decision.suggestedTakeProfit ?? "--";
    liveOrderReason.textContent = data.warning || "Live order sent. Confirm the fill, stop, and limit inside FOREX.com.";
    liveStatus.textContent = "Live order sent. Check FOREX.com now.";
    await Promise.all([loadSnapshot(), loadSupabaseCheck()]);
  } catch (error) {
    liveStatus.textContent = error.message;
  } finally {
    await loadLiveTradingStatus();
  }
}

on(runBotButton, "click", async () => {
  await runBotRequest("/api/bot/run", "Running EUR/USD strategy analysis...");
});

startBotButtons.forEach((button) => {
  on(button, "click", async () => {
    try {
      await saveBotSettings(true, "Starting bot...");
      if (liveStatus) {
        liveStatus.textContent = "Bot started. Live orders still require a valid BUY or SELL signal and confirmation phrase.";
      }
    } catch (error) {
      settingsStatus.textContent = error.message;
      if (liveStatus) {
        liveStatus.textContent = error.message;
      }
    }
  });
});

stopBotButtons.forEach((button) => {
  on(button, "click", async () => {
    try {
      await saveBotSettings(false, "Stopping bot...");
      if (liveStatus) {
        liveStatus.textContent = "Bot stopped. No new live orders can be sent.";
      }
    } catch (error) {
      settingsStatus.textContent = error.message;
      if (liveStatus) {
        liveStatus.textContent = error.message;
      }
    }
  });
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
on(liveTradeForm, "submit", executeLiveTrade);
on(emergencyStopButton, "click", emergencyStop);
on(reconcileLiveButton, "click", reconcileLiveOrders);
dashboardTabs.forEach((tab) => {
  on(tab, "click", () => setDashboardTab(tab.dataset.dashboardTab));
});

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
loadLiveTradingStatus().catch((error) => {
  if (liveStatus) {
    liveStatus.textContent = error.message;
  }
});
loadValidationStatus().catch((error) => {
  if (validationStatus) {
    validationStatus.textContent = "Live locked";
  }
  if (validationDetail) {
    validationDetail.textContent = error.message;
  }
});
loadLivePrices().catch((error) => {
  if (livePricesStatus) {
    livePricesStatus.textContent = error.message;
  }
});
