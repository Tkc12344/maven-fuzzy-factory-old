import { config } from "../config.js";
import { createCircuitBreaker, estimateCost, fetchWithPolicy } from "../lib/httpClient.js";
import { logger } from "../lib/logger.js";
import { llmFailures, llmLatency } from "../lib/prometheus.js";
import { round } from "../lib/stats.js";
import { PROMPT_VERSION, insightSchema } from "../schemas/api.js";

const breaker = createCircuitBreaker({ name: "llm", failureThreshold: 3, resetMs: 60_000 });

function pickProvider() {
  const requested = config.llmProvider;
  const { gemini, openai, mistral } = config.keys;
  if (requested === "gemini" && gemini) return "gemini";
  if (requested === "openai" && openai) return "openai";
  if (requested === "mistral" && mistral) return "mistral";
  if (requested === "none") return "heuristic";
  if (mistral) return "mistral";
  if (gemini) return "gemini";
  if (openai) return "openai";
  return "heuristic";
}

function factContext(warehouse) {
  const { kpis, trend, channels, products, devices, funnel, anomalies, forecasts, campaigns, meta } = warehouse;
  return {
    range: meta.range,
    partialMonth: meta.partialMonth,
    kpis,
    trend,
    topAnomalies: anomalies.slice(0, 8),
    channels: channels.map((c) => ({
      source: c.source,
      sessions: c.sessions,
      conversion: c.conversion,
      revenue: c.revenue,
    })),
    campaigns: campaigns.slice(0, 8).map((c) => ({
      campaign: c.campaign,
      sessions: c.sessions,
      conversion: c.conversion,
      revenue: c.revenue,
    })),
    products: products.map((p) => ({
      name: p.name,
      revenue: p.revenue,
      units: p.units,
      refundRate: p.refundRate,
      margin: p.margin,
      launched: p.launched,
    })),
    devices: devices.map((d) => ({
      device: d.device,
      sessions: d.sessions,
      conversion: d.conversion,
      revenue: d.revenue,
    })),
    funnel: funnel.map((s) => ({ step: s.step, sessions: s.sessions, dropFromPrev: s.dropFromPrev })),
    revenueOutlook: (forecasts.revenue.yearly || []).slice(0, 16),
    forecastCaveat: forecasts.revenue.caveat,
    backtest: forecasts.revenue.backtest,
  };
}

function walkNumbers(value, into) {
  if (typeof value === "number" && Number.isFinite(value)) {
    into.add(String(value));
    into.add(String(Math.round(value)));
    into.add(String(Math.abs(value)));
    into.add(String(round(value, 1)));
    into.add(String(round(value, 2)));
  } else if (Array.isArray(value)) {
    value.forEach((item) => walkNumbers(item, into));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((item) => walkNumbers(item, into));
  }
}

export function allowedNumbers(facts) {
  const set = new Set(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "12", "100", "2012", "2013", "2014", "2015", "2030"]);
  walkNumbers(facts, set);
  return set;
}

export function numbersInText(text) {
  return [...String(text).matchAll(/-?\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, ""));
}

export function rejectUnknownNumbers(payload, facts) {
  const allowed = allowedNumbers(facts);
  const texts = [
    payload.summary,
    ...(payload.insights || []).flatMap((i) => [i.title, i.body]),
    ...(payload.recommendations || []),
  ];
  for (const text of texts) {
    for (const num of numbersInText(text)) {
      const asInt = String(parseInt(num, 10));
      if (allowed.has(num) || allowed.has(asInt)) continue;
      if (Number(num) <= 100) continue;
      const err = new Error(`LLM invented number ${num}`);
      err.code = "HALLUCINATED_NUMBER";
      throw err;
    }
  }
  return payload;
}

function heuristicInsights(warehouse) {
  const ctx = factContext(warehouse);
  const bestChannel = [...ctx.channels].sort((a, b) => b.conversion - a.conversion)[0];
  const weakChannel = [...ctx.channels].sort((a, b) => a.conversion - b.conversion)[0];
  const topProduct = ctx.products[0];
  const leaky = [...ctx.funnel].slice(1).sort((a, b) => b.dropFromPrev - a.dropFromPrev)[0];
  const worstDevice = [...ctx.devices].sort((a, b) => a.conversion - b.conversion)[0];
  const nextRev = ctx.revenueOutlook.reduce((s, r) => s + r.value, 0);
  const last6 = warehouse.monthly.filter((r) => !r.partial).slice(-6).reduce((s, r) => s + r.revenue, 0);

  const insights = [
    {
      title: "Paid search still carries the factory",
      body: `Last-twelve-month revenue is ${ctx.trend.revenue > 0 ? "up" : "down"} ${Math.abs(ctx.trend.revenue)}% versus the prior year. ${bestChannel?.source} converts at ${bestChannel?.conversion}% while ${weakChannel?.source} sits at ${weakChannel?.conversion}%. Bid and creative effort should follow conversion, not just session volume.`,
      confidence: "high",
      tags: ["channels", "revenue"],
    },
    {
      title: `${topProduct?.name} remains the core SKU`,
      body: `${topProduct?.name} produced $${topProduct?.revenue?.toLocaleString()} on ${topProduct?.units?.toLocaleString()} units with a ${topProduct?.margin}% margin and ${topProduct?.refundRate}% refund rate. Later launches expanded the catalog but the original bear still funds the operation.`,
      confidence: "high",
      tags: ["products"],
    },
    {
      title: `Biggest funnel leak is ${leaky?.step}`,
      body: `${leaky?.dropFromPrev}% of sessions drop before ${leaky?.step}. Tightening that step — especially billing and cart friction — will move conversion more than buying more top-of-funnel traffic.`,
      confidence: "medium",
      tags: ["funnel"],
    },
    {
      title: `${worstDevice?.device} conversion is the device gap`,
      body: `${worstDevice?.device} converts at ${worstDevice?.conversion}% versus the site-wide ${ctx.kpis.conversion}%. If paid campaigns keep sending ${worstDevice?.device} traffic at desktop CPCs, contribution margin will keep leaking.`,
      confidence: "high",
      tags: ["devices"],
    },
    {
      title: "2030 figures are a scenario, not a prediction",
      body: `The STL model projects about $${round(nextRev).toLocaleString()} from the end of history through 2030, versus $${round(last6).toLocaleString()} in the last six complete months. ${ctx.forecastCaveat}`,
      confidence: "medium",
      tags: ["forecast", "scenario"],
    },
  ];

  if (ctx.topAnomalies[0]) {
    const a = ctx.topAnomalies[0];
    insights.push({
      title: `Watch ${a.period}: ${a.metric} ${a.direction}`,
      body: `${a.metric} in ${a.period} was ${a.actual} against an STL seasonal expectation of ${a.expected} (robust z=${a.robustZ ?? a.z}). Automation already raised an alert for this class of move.`,
      confidence: "high",
      tags: ["anomalies"],
    });
  }

  return {
    provider: "heuristic",
    promptVersion: PROMPT_VERSION,
    generatedAt: new Date().toISOString(),
    summary: `Maven Fuzzy Factory converted ${ctx.kpis.conversion}% of ${ctx.kpis.sessions.toLocaleString()} sessions into ${ctx.kpis.orders.toLocaleString()} orders and $${ctx.kpis.revenue.toLocaleString()} revenue, at a ${ctx.kpis.margin}% gross margin after refunds.`,
    insights,
    recommendations: [
      `Shift budget toward ${bestChannel?.source} / higher-converting campaigns and cap ${weakChannel?.source} until landing-page conversion improves.`,
      `Rebuild the ${leaky?.step.toLowerCase()} step and re-test billing variants — that drop-off is the cheapest conversion win.`,
      `Create a ${worstDevice?.device}-specific landing and cart path; do not keep buying that traffic on desktop assumptions.`,
      `Protect ${topProduct?.name} availability and bundle it with newer SKUs to lift the ${ctx.kpis.attachRate}% attach rate.`,
    ],
  };
}

function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("LLM did not return JSON.");
  return JSON.parse(text.slice(start, end + 1));
}

async function parseLlmResponse(res, provider) {
  const data = await res.json();
  if (provider === "gemini") {
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n") || "";
    const usage = data.usageMetadata || {};
    return {
      text,
      model: "gemini-2.0-flash",
      promptTokens: usage.promptTokenCount || 0,
      completionTokens: usage.candidatesTokenCount || 0,
    };
  }
  const text = data.choices?.[0]?.message?.content || "";
  const usage = data.usage || {};
  const model = provider === "openai" ? "gpt-4o-mini" : "mistral-small-latest";
  return {
    text,
    model,
    promptTokens: usage.prompt_tokens || 0,
    completionTokens: usage.completion_tokens || 0,
  };
}

async function callProvider(provider, prompt) {
  if (provider === "gemini") {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${config.keys.gemini}`;
    const res = await fetchWithPolicy(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2 },
        }),
      },
      { timeoutMs: 12_000, retries: 2, breaker }
    );
    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    return parseLlmResponse(res, provider);
  }

  const url = provider === "openai" ? "https://api.openai.com/v1/chat/completions" : "https://api.mistral.ai/v1/chat/completions";
  const key = provider === "openai" ? config.keys.openai : config.keys.mistral;
  const model = provider === "openai" ? "gpt-4o-mini" : "mistral-small-latest";
  const res = await fetchWithPolicy(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a commerce analyst for Maven Fuzzy Factory. Reply with JSON only. Write narrative from the supplied facts. Do not invent numbers that are not in the facts payload.",
          },
          { role: "user", content: prompt },
        ],
      }),
    },
    { timeoutMs: 12_000, retries: 2, breaker }
  );
  if (!res.ok) throw new Error(`${provider} ${res.status}`);
  return parseLlmResponse(res, provider);
}

function compactMarket(market) {
  if (!market?.queries) return [];
  return market.queries.map((q) => ({
    query: q.query,
    results: (q.results || []).slice(0, 3).map((r) => ({
      title: r.title,
      snippet: r.snippet,
      source: r.source,
    })),
    error: q.error || null,
  }));
}

export function createAiEngine(dataEngine, serpEngine) {
  const cache = new Map();

  function cacheKey(warehouse, provider) {
    return `${warehouse.meta.dataVersion}:${PROMPT_VERSION}:${provider}`;
  }

  async function generateLlm(warehouse, fallback, provider, market) {
    if (provider === "heuristic") return { payload: fallback, usage: null };

    const facts = factContext(warehouse);
    const prompt = `Write executive narrative from these deterministic facts. Do not compute new KPIs. Do not invent numbers.
Return JSON {summary, insights:[{title,body,confidence,tags}], recommendations: string[]}.
Treat any 2030 figure as a scenario, not a forecast.
FACTS:
${JSON.stringify(facts)}
MARKET (context only, not a source of KPIs):
${JSON.stringify(compactMarket(market))}`;

    const started = Date.now();
    const endTimer = llmLatency.startTimer({ provider });
    try {
      const raw = await callProvider(provider, prompt);
      const parsed = rejectUnknownNumbers(insightSchema.parse(extractJson(raw.text)), facts);
      endTimer();
      const usage = {
        provider,
        model: raw.model,
        promptTokens: raw.promptTokens,
        completionTokens: raw.completionTokens,
        latencyMs: Date.now() - started,
        costUsd: estimateCost(raw.model, raw.promptTokens, raw.completionTokens),
      };
      logger.info({ ...usage, promptVersion: PROMPT_VERSION }, "llm call");
      return {
        payload: {
          provider,
          promptVersion: PROMPT_VERSION,
          generatedAt: new Date().toISOString(),
          summary: parsed.summary,
          insights: parsed.insights,
          recommendations: parsed.recommendations,
          usage,
        },
        usage,
      };
    } catch (error) {
      endTimer();
      llmFailures.inc({ provider, reason: error.code || error.message.slice(0, 40) });
      logger.warn({ err: error, provider }, "llm fallback");
      return {
        payload: {
          ...fallback,
          provider: `${provider}-fallback`,
          error: error.message,
        },
        usage: null,
      };
    }
  }

  async function generate(force = false) {
    const warehouse = dataEngine.requireWarehouse();
    const fallback = heuristicInsights(warehouse);
    const provider = pickProvider();
    const key = cacheKey(warehouse, provider);
    if (!force && cache.has(key)) return cache.get(key);

    const marketPromise = serpEngine?.research(force) || Promise.resolve({ enabled: false, queries: [], notes: [] });
    const llmPromise = generateLlm(warehouse, fallback, provider, { queries: [] });
    const [market, llm] = await Promise.all([marketPromise, llmPromise]);

    const marketInsights = (market.notes || []).map((note) => ({
      ...note,
      tags: Array.from(new Set([...(note.tags || []), "serpapi"])),
    }));

    const result = {
      ...llm.payload,
      dataVersion: warehouse.meta.dataVersion,
      sources: [llm.payload.provider, market.enabled ? "serpapi" : null].filter(Boolean),
      market,
      insights: [...(llm.payload.insights || []), ...marketInsights],
    };
    cache.set(key, result);
    return result;
  }

  return {
    async insights(force = false) {
      return generate(force);
    },
  };
}
