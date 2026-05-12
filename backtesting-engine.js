function calculateExpectancy({ winRate, lossRate, averageWin, averageLoss }) {
  return (Number(winRate) * Number(averageWin)) - (Number(lossRate) * Number(averageLoss));
}

function calculateBacktestMetrics(trades = []) {
  const closed = trades.filter((trade) => Number.isFinite(Number(trade.netProfitLoss)));
  const wins = closed.filter((trade) => Number(trade.netProfitLoss) > 0);
  const losses = closed.filter((trade) => Number(trade.netProfitLoss) < 0);
  const grossWin = wins.reduce((total, trade) => total + Number(trade.netProfitLoss), 0);
  const grossLoss = Math.abs(losses.reduce((total, trade) => total + Number(trade.netProfitLoss), 0));
  const averageWin = wins.length ? grossWin / wins.length : 0;
  const averageLoss = losses.length ? grossLoss / losses.length : 0;
  const winRate = closed.length ? wins.length / closed.length : 0;
  const lossRate = closed.length ? losses.length / closed.length : 0;

  return {
    totalTrades: closed.length,
    winRate,
    lossRate,
    averageWin,
    averageLoss,
    largestWin: wins.reduce((max, trade) => Math.max(max, Number(trade.netProfitLoss)), 0),
    largestLoss: losses.reduce((max, trade) => Math.max(max, Math.abs(Number(trade.netProfitLoss))), 0),
    netProfitLoss: grossWin - grossLoss,
    profitFactor: grossLoss ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    expectancy: calculateExpectancy({ winRate, lossRate, averageWin, averageLoss }),
    spreadCostImpact: closed.reduce((total, trade) => total + Number(trade.spreadCost || 0), 0),
    slippageImpact: closed.reduce((total, trade) => total + Number(trade.slippageCost || 0), 0),
    commissionImpact: closed.reduce((total, trade) => total + Number(trade.commission || 0), 0),
    swapImpact: closed.reduce((total, trade) => total + Number(trade.swap || 0), 0),
  };
}

function applyExecutionCosts({ grossProfitLoss, spreadCost = 0, slippageCost = 0, commission = 0, swap = 0 }) {
  return Number(grossProfitLoss || 0)
    - Number(spreadCost || 0)
    - Number(slippageCost || 0)
    - Number(commission || 0)
    - Number(swap || 0);
}

module.exports = {
  calculateExpectancy,
  calculateBacktestMetrics,
  applyExecutionCosts,
};
