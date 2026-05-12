const { approveTrade } = require("./risk-manager");

function createPaperAccount({ balance = 10000, currency = "USD" } = {}) {
  return {
    balance,
    equity: balance,
    currency,
    openPositions: [],
    closedPositions: [],
    rejectedTrades: [],
  };
}

function submitPaperOrder({ account, signal, market, limits, state }) {
  const approval = approveTrade({ signal, account, market, limits, state });
  if (!approval.approved) {
    account.rejectedTrades.push({
      signal,
      reasons: approval.rejections,
      rejectedAt: new Date().toISOString(),
    });
    return { ok: false, approval };
  }

  const position = {
    id: `paper-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    strategyName: signal.strategyName,
    market: signal.market,
    direction: signal.direction,
    entryPrice: signal.entryPrice,
    stopLoss: signal.stopLoss,
    takeProfit: signal.takeProfit || null,
    lotSize: approval.sizing.lotSize,
    riskAmount: approval.sizing.riskAmount,
    openedAt: new Date().toISOString(),
    status: "open",
  };
  account.openPositions.push(position);
  return { ok: true, approval, position };
}

module.exports = {
  createPaperAccount,
  submitPaperOrder,
};
