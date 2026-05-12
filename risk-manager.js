const DEFAULT_LIMITS = {
  maxRiskAmount: 100,
  maxRewardRiskRatioMinimum: 2,
  maxDailyLoss: 100,
  maxOpenPositions: 1,
  maxSpreadPips: 2,
  allowLiveTrading: false
};

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function mergeRiskLimits(overrides = {}) {
  return {
    ...DEFAULT_LIMITS,
    ...overrides
  };
}

function approveTrade(trade = {}, limits = DEFAULT_LIMITS) {
  const merged = mergeRiskLimits(limits);

  const riskAmount = numberOrNull(trade.riskAmount);
  const rewardRiskRatio = numberOrNull(trade.rewardRiskRatio);
  const spreadPips = numberOrNull(trade.spreadPips || 1);

  const violations = [];

  if (riskAmount !== null && riskAmount > merged.maxRiskAmount) {
    violations.push(`Risk amount ${riskAmount} exceeds max ${merged.maxRiskAmount}.`);
  }

  if (rewardRiskRatio !== null && rewardRiskRatio < merged.maxRewardRiskRatioMinimum) {
    violations.push(
      `Reward/risk ratio ${rewardRiskRatio} is below required ${merged.maxRewardRiskRatioMinimum}.`
    );
  }

  if (spreadPips !== null && spreadPips > merged.maxSpreadPips) {
    violations.push(`Spread ${spreadPips} pips exceeds max ${merged.maxSpreadPips}.`);
  }

  if (!trade.direction || trade.direction === "HOLD") {
    violations.push("No active BUY or SELL signal.");
  }

  return {
    approved: violations.length === 0,
    violations,
    limits: merged,
    checkedAt: new Date().toISOString()
  };
}

module.exports = {
  approveTrade,
  mergeRiskLimits
};