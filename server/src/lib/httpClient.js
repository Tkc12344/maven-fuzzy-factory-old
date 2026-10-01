export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createCircuitBreaker({ name, failureThreshold = 3, resetMs = 60_000 } = {}) {
  let failures = 0;
  let state = "closed";
  let openedAt = 0;

  return {
    get name() {
      return name;
    },
    get state() {
      return state;
    },
    get failures() {
      return failures;
    },
    async exec(fn) {
      if (state === "open") {
        if (Date.now() - openedAt >= resetMs) state = "half-open";
        else {
          const err = new Error(`${name} circuit open`);
          err.code = "CIRCUIT_OPEN";
          throw err;
        }
      }
      try {
        const result = await fn();
        failures = 0;
        state = "closed";
        return result;
      } catch (error) {
        failures += 1;
        if (failures >= failureThreshold || state === "half-open") {
          state = "open";
          openedAt = Date.now();
        }
        throw error;
      }
    },
  };
}

export async function fetchWithPolicy(url, options = {}, policy = {}) {
  const {
    timeoutMs = 12_000,
    retries = 2,
    retryDelayMs = 400,
    breaker = null,
  } = policy;

  const run = async () => {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(url, { ...options, signal: ctrl.signal });
        clearTimeout(timer);
        if (res.status === 429 || res.status >= 500) {
          lastError = new Error(`HTTP ${res.status}`);
          lastError.status = res.status;
          if (attempt < retries) await sleep(retryDelayMs * 2 ** attempt);
          continue;
        }
        return res;
      } catch (error) {
        clearTimeout(timer);
        lastError = error.name === "AbortError" ? new Error(`Timeout after ${timeoutMs}ms`) : error;
        if (attempt < retries) await sleep(retryDelayMs * 2 ** attempt);
      }
    }
    throw lastError;
  };

  return breaker ? breaker.exec(run) : run();
}

export const LLM_COSTS = {
  "mistral-small-latest": { input: 0.2 / 1e6, output: 0.6 / 1e6 },
  "gpt-4o-mini": { input: 0.15 / 1e6, output: 0.6 / 1e6 },
  "gemini-2.0-flash": { input: 0.1 / 1e6, output: 0.4 / 1e6 },
};

export function estimateCost(model, promptTokens = 0, completionTokens = 0) {
  const rates = LLM_COSTS[model] || { input: 0, output: 0 };
  return Number((promptTokens * rates.input + completionTokens * rates.output).toFixed(6));
}
