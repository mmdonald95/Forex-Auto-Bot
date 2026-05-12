const crypto = require("node:crypto");

function buildTradeJournalEntry(input = {}) {
  return {
    id: input.id || crypto.randomUUID(),
    market: input.market || "EUR/USD",
    direction: input.direction || "HOLD",
    entry: input.entry ?? null,
    stopLoss: input.stopLoss ?? null,
    takeProfit: input.takeProfit ?? null,
    riskAmount: input.riskAmount ?? null,
    expectedProfit: input.expectedProfit ?? null,
    result: input.result || "pending",
    notes: input.notes || "",
    createdAt: input.createdAt || new Date().toISOString()
  };
}

module.exports = {
  buildTradeJournalEntry
};