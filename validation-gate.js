function evaluateValidationReport(report = {}) {
  const minimumWinRate = Number(report.minimumWinRate || 55);
  const minimumProfitFactor = Number(report.minimumProfitFactor || 1.5);
  const minimumTrades = Number(report.minimumTrades || 30);

  const winRate = Number(report.winRate || 0);
  const profitFactor = Number(report.profitFactor || 0);
  const trades = Number(report.trades || 0);

  const failures = [];

  if (trades < minimumTrades) {
    failures.push(`Only ${trades} trades tested. Minimum required is ${minimumTrades}.`);
  }

  if (winRate < minimumWinRate) {
    failures.push(`Win rate ${winRate}% is below required ${minimumWinRate}%.`);
  }

  if (profitFactor < minimumProfitFactor) {
    failures.push(`Profit factor ${profitFactor} is below required ${minimumProfitFactor}.`);
  }

  return {
    passed: failures.length === 0,
    failures,
    metrics: {
      trades,
      winRate,
      profitFactor,
      minimumTrades,
      minimumWinRate,
      minimumProfitFactor
    },
    evaluatedAt: new Date().toISOString()
  };
}

module.exports = {
  evaluateValidationReport
};