const DEFAULT_REQUIREMENTS = {
  minTrades: 100,
  minPaperTradingDays: 30,
  minProfitFactor: 1.2,
  maxDrawdownPct: 10,
  requirePositiveExpectancy: true,
  requireBacktest: true,
  requireOutOfSample: true,
  requireWalkForward: true,
  requireStressTest: true,
  requirePaperTrading: true,
  requireRiskDisclosure: true,
};

function evaluateValidationReport(report = {}, requirements = {}) {
  const required = { ...DEFAULT_REQUIREMENTS, ...requirements };
  const failures = [];

  if (required.requireBacktest && report.backtestPassed !== true) failures.push("backtest_not_passed");
  if (required.requireOutOfSample && report.outOfSamplePassed !== true) failures.push("out_of_sample_not_passed");
  if (required.requireWalkForward && report.walkForwardPassed !== true) failures.push("walk_forward_not_passed");
  if (required.requireStressTest && report.stressTestPassed !== true) failures.push("stress_test_not_passed");
  if (required.requirePaperTrading && report.paperTradingPassed !== true) failures.push("paper_trading_not_passed");
  if (required.requireRiskDisclosure && report.riskDisclosureAccepted !== true) failures.push("risk_disclosure_not_accepted");
  if (required.requirePositiveExpectancy && Number(report.expectancy || 0) <= 0) failures.push("expectancy_not_positive");
  if (Number(report.totalTrades || 0) < required.minTrades) failures.push("not_enough_test_trades");
  if (Number(report.paperTradingDays || 0) < required.minPaperTradingDays) failures.push("paper_trading_period_too_short");
  if (Number(report.profitFactor || 0) < required.minProfitFactor) failures.push("profit_factor_too_low");
  if (Number(report.maxDrawdownPct || 0) > required.maxDrawdownPct) failures.push("drawdown_too_high");

  return {
    approved: failures.length === 0,
    failures,
    requirements: required,
  };
}

module.exports = {
  DEFAULT_REQUIREMENTS,
  evaluateValidationReport,
};
