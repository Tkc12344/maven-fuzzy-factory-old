import client from "prom-client";

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry, prefix: "mff_" });

export const httpDuration = new client.Histogram({
  name: "mff_http_request_duration_seconds",
  help: "API request duration",
  labelNames: ["method", "route", "status"],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 15],
  registers: [registry],
});

export const warehouseBuild = new client.Histogram({
  name: "mff_warehouse_build_seconds",
  help: "DuckDB warehouse build / ETL duration",
  buckets: [0.5, 1, 2, 5, 10, 30, 60],
  registers: [registry],
});

export const llmFailures = new client.Counter({
  name: "mff_llm_failures_total",
  help: "LLM provider failures that fell back to heuristic",
  labelNames: ["provider", "reason"],
  registers: [registry],
});

export const serpFailures = new client.Counter({
  name: "mff_serp_failures_total",
  help: "SerpAPI failures",
  labelNames: ["reason"],
  registers: [registry],
});

export const llmLatency = new client.Histogram({
  name: "mff_llm_call_duration_seconds",
  help: "LLM round-trip latency",
  labelNames: ["provider"],
  buckets: [0.5, 1, 2, 5, 10, 20],
  registers: [registry],
});

export function observeHttp(req, res, start) {
  const route = req.route?.path || req.path || "unknown";
  httpDuration.observe(
    { method: req.method, route, status: String(res.statusCode) },
    (Date.now() - start) / 1000
  );
}
