const strategies = new Map();

function registerStrategy(strategy) {
  if (!strategy || !strategy.id || typeof strategy.generateSignal !== "function") {
    throw new Error("Strategy must include id and generateSignal(context).");
  }

  strategies.set(strategy.id, {
    name: strategy.name || strategy.id,
    version: strategy.version || "1.0.0",
    enabled: strategy.enabled !== false,
    parameters: strategy.parameters || {},
    generateSignal: strategy.generateSignal,
  });
}

function listStrategies() {
  return Array.from(strategies.entries()).map(([id, strategy]) => ({
    id,
    name: strategy.name,
    version: strategy.version,
    enabled: strategy.enabled,
    parameters: strategy.parameters,
  }));
}

function getStrategy(id) {
  return strategies.get(id);
}

function requireStrategy(id) {
  const strategy = getStrategy(id);
  if (!strategy) {
    throw new Error(`Strategy ${id} is not registered.`);
  }
  if (!strategy.enabled) {
    throw new Error(`Strategy ${id} is disabled.`);
  }
  return strategy;
}

module.exports = {
  registerStrategy,
  listStrategies,
  getStrategy,
  requireStrategy,
};
