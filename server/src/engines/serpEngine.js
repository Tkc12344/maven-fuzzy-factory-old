import { config } from "../config.js";
import { createCircuitBreaker, fetchWithPolicy } from "../lib/httpClient.js";
import { logger } from "../lib/logger.js";
import { serpFailures } from "../lib/prometheus.js";

const QUERIES = [
  "stuffed animal ecommerce market trends",
  "teddy bear online advertising conversion rates",
  "best selling teddy bears stuffed animals retail",
];

const breaker = createCircuitBreaker({ name: "serpapi", failureThreshold: 3, resetMs: 60_000 });

function compactResults(data) {
  return (data.organic_results || []).slice(0, 5).map((row) => ({
    title: row.title,
    link: row.link,
    snippet: row.snippet || "",
    source: row.source || row.displayed_link || "",
  }));
}

async function searchGoogle(query) {
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google");
  url.searchParams.set("q", query);
  url.searchParams.set("num", "5");
  url.searchParams.set("hl", "en");
  url.searchParams.set("api_key", config.keys.serp);

  const res = await fetchWithPolicy(url, {}, { timeoutMs: 15_000, retries: 2, breaker });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `SerpAPI ${res.status}`);
  return compactResults(data);
}

function marketNotes(queries) {
  return queries
    .flatMap((q) => q.results)
    .slice(0, 4)
    .map((row) => ({
      title: row.title,
      body: row.snippet,
      confidence: "medium",
      tags: ["serpapi", "market"],
      link: row.link,
    }))
    .filter((row) => row.body);
}

export function createSerpEngine() {
  let cache = null;
  let cacheKey = "";

  async function research(force = false, dataVersion = "na") {
    if (!config.keys.serp) {
      return { enabled: false, provider: "serpapi", queries: [], notes: [] };
    }
    const key = `${dataVersion}:serpapi:v1`;
    if (cache && cacheKey === key && !force) return cache;

    const started = Date.now();
    const queries = await Promise.all(
      QUERIES.map(async (query) => {
        try {
          return { query, results: await searchGoogle(query) };
        } catch (error) {
          serpFailures.inc({ reason: error.code || "error" });
          logger.warn({ err: error, query }, "serpapi query failed");
          return { query, results: [], error: error.message };
        }
      })
    );

    cacheKey = key;
    cache = {
      enabled: true,
      provider: "serpapi",
      generatedAt: new Date().toISOString(),
      elapsedMs: Date.now() - started,
      queries,
      notes: marketNotes(queries),
      error: queries.every((q) => q.error) ? queries[0].error : null,
    };
    return cache;
  }

  return {
    get enabled() {
      return Boolean(config.keys.serp);
    },
    research,
  };
}
