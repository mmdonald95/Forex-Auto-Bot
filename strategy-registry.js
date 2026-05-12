const strategies = new Map();

function registerStrategy(strategy) {
  if (!strategy || !strategy.id) {
    throw new Error("Strategy must include an id.");
  }

  strategies.set(strategy.id, {
    id: strategy.id,
    name: strategy.name || strategy.id,
    version: strategy.version || "1.0.0",
    parameters: strategy.parameters || {},
    generateSignal: strategy.generateSignal || null
  });

  return strategies.get(strategy.id);
}

function listStrategies() {
  return Array.from(strategies.values()).map(strategy => ({
    id: strategy.id,
    name: strategy.name,
    version: strategy.version,
    parameters: strategy.parameters
  }));
}

function getStrategy(id) {
  return strategies.get(id) || null;
}

module.exports = {
  registerStrategy,
  listStrategies,
  getStrategy
};