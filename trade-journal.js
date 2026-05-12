function buildTradeJournalEntry(event = {}) {
  const now = new Date().toISOString();
  return {
    tradeId: event.tradeId || event.brokerOrderId || null,
    strategyName: event.strategyName || "unknown",
    market: event.market,
    direction: event.direction,
    entryTime: event.entryTime || now,
    exitTime: event.exitTime || null,
    entryPrice: event.entryPrice ?? null,
    exitPrice: event.exitPrice ?? null,
    stopLoss: event.stopLoss ?? null,
    takeProfit: event.takeProfit ?? null,
    trailingStop: event.trailingStop ?? null,
    lotSize: event.lotSize ?? event.quantity ?? null,
    riskPercentage: event.riskPercentage ?? null,
    riskAmount: event.riskAmount ?? null,
    spreadAtEntry: event.spreadAtEntry ?? null,
    spreadAtExit: event.spreadAtExit ?? null,
    slippage: event.slippage ?? null,
    commission: event.commission ?? null,
    swap: event.swap ?? null,
    grossProfitLoss: event.grossProfitLoss ?? null,
    netProfitLoss: event.netProfitLoss ?? event.profitLoss ?? null,
    balanceBefore: event.balanceBefore ?? null,
    balanceAfter: event.balanceAfter ?? null,
    equityBefore: event.equityBefore ?? null,
    equityAfter: event.equityAfter ?? null,
    entryReason: event.entryReason || null,
    exitReason: event.exitReason || null,
    followedRules: event.followedRules !== false,
    riskFilterTriggered: event.riskFilterTriggered || null,
    notes: event.notes || "",
    createdAt: now,
  };
}

module.exports = {
  buildTradeJournalEntry,
};
