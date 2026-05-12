const DEFAULT_RISK_LIMITS = {
  maxRiskPerTradePct: 1,
  maxDailyLossUsd: 100,
  maxWeeklyLossUsd: 300,
  maxMonthlyLossUsd: 600,
  maxDrawdownPct: 10,
  maxOpenTrades: 1,
  maxOpenTradesPerPair: 1,
  maxLotSize: 1000,
  maxTotalExposure: 1000,
  maxSpreadPips: 2,
  maxSlippagePips: 1,
  maxConsecutiveLosses: 3,
  minEquityUsd: 0,
  requireStopLoss: true,
};

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(String(value).replace(/[$,\s]/g, ""));
  return Number.isFinite(number) ? number : null;
}

function mergeRiskLimits(overrides = {}) {
  return {
    ...DEFAULT_RISK_LIMITS,
    ...Object.fromEntries(
      Object.entries(overrides).filter(([, value]) => value !== undefined && value !== null && value !== "")
    ),
  };
}

function calculatePositionSize({ equity, riskPct, stopLossPips, pipValue = 1, minLotSize = 1, maxLotSize = 1000 }) {
  const numericEquity = numberOrNull(equity);
  const numericRiskPct = numberOrNull(riskPct);
  const numericStopLossPips = numberOrNull(stopLossPips);
  const numericPipValue = numberOrNull(pipValue);

  if (!numericEquity || !numericRiskPct || !numericStopLossPips || !numericPipValue) {
    return {
      approved: false,
      reason: "position_size_unavailable",
      message: "Position size cannot be calculated safely from equity, risk %, stop-loss pips, and pip value.",
    };
  }

  const riskAmount = numericEquity * (numericRiskPct / 100);
  const rawLotSize = riskAmount / (numericStopLossPips * numericPipValue);
  const lotSize = Math.max(Number(minLotSize || 1), Math.min(rawLotSize, Number(maxLotSize || 1000)));

  return {
    approved: Number.isFinite(lotSize) && lotSize > 0,
    riskAmount,
    lotSize,
    rawLotSize,
  };
}

function approveTrade({ signal, account = {}, market = {}, limits = {}, state = {} }) {
  const merged = mergeRiskLimits(limits);
  const rejections = [];
  const equity = numberOrNull(account.equity ?? account.balance);
  const riskPct = numberOrNull(signal?.riskPercentage ?? signal?.riskPerTradePct ?? merged.maxRiskPerTradePct);
  const stopLoss = numberOrNull(signal?.stopLoss);
  const entry = numberOrNull(signal?.entryPrice ?? signal?.lastPrice);
  const spreadPips = numberOrNull(signal?.spreadPips ?? signal?.liveSpreadPips ?? market.spreadPips);
  const slippagePips = numberOrNull(signal?.slippagePips ?? market.slippagePips ?? 0);
  const openTrades = Number(state.openTrades || 0);
  const openTradesForPair = Number(state.openTradesForPair || 0);
  const dailyLoss = numberOrNull(state.dailyLoss) || 0;
  const weeklyLoss = numberOrNull(state.weeklyLoss) || 0;
  const monthlyLoss = numberOrNull(state.monthlyLoss) || 0;
  const drawdownPct = numberOrNull(state.drawdownPct) || 0;
  const consecutiveLosses = Number(state.consecutiveLosses || 0);

  if (!["BUY", "SELL"].includes(signal?.direction)) {
    rejections.push("invalid_signal");
  }
  if (merged.requireStopLoss && stopLoss === null) {
    rejections.push("missing_stop_loss");
  }
  if (riskPct === null || riskPct <= 0 || riskPct > merged.maxRiskPerTradePct) {
    rejections.push("risk_too_high");
  }
  if (spreadPips !== null && spreadPips > merged.maxSpreadPips) {
    rejections.push("spread_too_wide");
  }
  if (slippagePips !== null && slippagePips > merged.maxSlippagePips) {
    rejections.push("slippage_too_high");
  }
  if (dailyLoss >= merged.maxDailyLossUsd) {
    rejections.push("daily_loss_limit_reached");
  }
  if (weeklyLoss >= merged.maxWeeklyLossUsd) {
    rejections.push("weekly_loss_limit_reached");
  }
  if (monthlyLoss >= merged.maxMonthlyLossUsd) {
    rejections.push("monthly_loss_limit_reached");
  }
  if (drawdownPct >= merged.maxDrawdownPct) {
    rejections.push("max_drawdown_reached");
  }
  if (openTrades >= merged.maxOpenTrades) {
    rejections.push("max_open_trades_reached");
  }
  if (openTradesForPair >= merged.maxOpenTradesPerPair) {
    rejections.push("max_open_trades_for_pair_reached");
  }
  if (consecutiveLosses >= merged.maxConsecutiveLosses) {
    rejections.push("losing_streak_limit_reached");
  }
  if (merged.minEquityUsd && equity !== null && equity < merged.minEquityUsd) {
    rejections.push("equity_below_threshold");
  }
  if (state.newsBlackoutActive) {
    rejections.push("news_blackout");
  }
  if (state.dataFeedStale) {
    rejections.push("data_feed_stale");
  }
  if (state.brokerUnstable) {
    rejections.push("broker_connection_unstable");
  }

  const stopLossPips = signal?.stopLossPips
    ? numberOrNull(signal.stopLossPips)
    : entry !== null && stopLoss !== null
      ? Math.abs(entry - stopLoss) * (String(signal.market || "").includes("JPY") ? 100 : 10000)
      : null;
  const sizing = calculatePositionSize({
    equity,
    riskPct,
    stopLossPips,
    pipValue: signal?.pipValue || 1,
    minLotSize: market.minLotSize || 1,
    maxLotSize: Math.min(Number(market.maxLotSize || merged.maxLotSize), Number(merged.maxLotSize)),
  });

  if (!sizing.approved) {
    rejections.push(sizing.reason);
  }
  if (sizing.lotSize && sizing.lotSize > merged.maxLotSize) {
    rejections.push("lot_size_too_large");
  }

  return {
    approved: rejections.length === 0,
    rejections,
    limits: merged,
    sizing,
  };
}

module.exports = {
  DEFAULT_RISK_LIMITS,
  mergeRiskLimits,
  calculatePositionSize,
  approveTrade,
};
