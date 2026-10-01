import { config } from "../config.js";
import { detectAnomalies, seasonalForecast } from "../lib/forecast.js";
import { logger } from "../lib/logger.js";
import { warehouseBuild } from "../lib/prometheus.js";
import { pct, round } from "../lib/stats.js";
import { addFacts, emptyFacts, enrich, trendDelta } from "../metrics/kpis.js";
import { closeDatabase, openDatabase } from "./db.js";
import { parquetReady, readManifest, registerViews, runEtl } from "./etl.js";
import { loadWarehouseTables } from "./queries.js";

function isPartialPeriod(period, maxTs) {
  if (period === "2015-03") return true;
  if (!maxTs) return false;
  const iso = String(maxTs).slice(0, 19).replace(" ", "T");
  const day = Number(iso.slice(8, 10));
  const ym = iso.slice(0, 7);
  return ym === period && day > 0 && day < 28;
}

function foldEmptyMonths(rows) {
  const next = [...rows];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const row = next[i];
    if (row.sessions === 0 && row.orders === 0) {
      next[i - 1] = {
        ...next[i - 1],
        refunds: next[i - 1].refunds + row.refunds,
        refundAmount: next[i - 1].refundAmount + row.refundAmount,
      };
      next.splice(i, 1);
    }
  }
  return next;
}

function funnelSteps(counts) {
  const steps = [
    { step: "Landing", sessions: Number(counts.landing || 0) },
    { step: "Products", sessions: Number(counts.catalog || 0) },
    { step: "Product page", sessions: Number(counts.pdp || 0) },
    { step: "Cart", sessions: Number(counts.cart || 0) },
    { step: "Shipping", sessions: Number(counts.shipping || 0) },
    { step: "Billing", sessions: Number(counts.billing || 0) },
    { step: "Thank you", sessions: Number(counts.thanks || 0) },
  ];
  return steps.map((step, i, arr) => ({
    ...step,
    rateFromStart: round(pct(step.sessions, arr[0].sessions || 1), 2),
    dropFromPrev: i === 0 ? 0 : round(pct(arr[i - 1].sessions - step.sessions, arr[i - 1].sessions || 1), 2),
  }));
}

export function createDataEngine() {
  const state = {
    ready: false,
    stage: "idle",
    error: null,
    startedAt: null,
    finishedAt: null,
    warehouse: null,
    handles: null,
  };

  async function build() {
    state.ready = false;
    state.error = null;
    state.startedAt = new Date().toISOString();
    const t0 = Date.now();
    const endTimer = warehouseBuild.startTimer();

    state.stage = "etl";
    const etl = await runEtl({ dataDir: config.dataDir, warehouseDir: config.warehouseDir });

    state.stage = "duckdb";
    if (state.handles) await closeDatabase(state.handles);
    const handles = await openDatabase(":memory:");
    state.handles = handles;
    await registerViews(handles.conn);

    state.stage = "query";
    const raw = await loadWarehouseTables(handles.conn);
    const monthlyRaw = foldEmptyMonths(raw.monthly.map((row) => ({ ...row })));
    const monthlyRows = monthlyRaw.map((row) =>
      enrich(row, {
        period: row.period,
        partial: isPartialPeriod(row.period, raw.maxTs),
      })
    );
    const completeRows = monthlyRows.filter((row) => !row.partial);
    const lastComplete = completeRows.at(-1)?.period || null;
    const forecastOpts = { until: config.forecastUntil, holdout: 6 };

    const series = (field) => completeRows.map((r) => ({ period: r.period, value: r[field] }));
    const revenueModel = seasonalForecast(series("revenue"), forecastOpts);
    const orderModel = seasonalForecast(series("orders"), forecastOpts);
    const sessionModel = seasonalForecast(series("sessions"), forecastOpts);
    const conversionModel = seasonalForecast(series("conversion"), forecastOpts);
    const refundModel = seasonalForecast(series("refundRate"), forecastOpts);

    const totals = monthlyRows.reduce((acc, row) => addFacts(acc, row), emptyFacts());
    totals.users = raw.users;
    const kpis = enrich(totals);

    const last12 = completeRows.slice(-12);
    const prev12 = completeRows.slice(-24, -12);
    const sum = (rows, field) => rows.reduce((s, r) => s + r[field], 0);
    const avg = (rows, field) => (rows.length ? sum(rows, field) / rows.length : 0);
    const trend = {
      revenue: trendDelta(sum(last12, "revenue"), sum(prev12, "revenue"), "revenue"),
      orders: trendDelta(sum(last12, "orders"), sum(prev12, "orders"), "orders"),
      sessions: trendDelta(sum(last12, "sessions"), sum(prev12, "sessions"), "sessions"),
      conversion: trendDelta(avg(last12, "conversion"), avg(prev12, "conversion"), "conversion"),
      margin: trendDelta(
        pct(sum(last12, "profit"), sum(last12, "revenue") || 1),
        pct(sum(prev12, "profit"), sum(prev12, "revenue") || 1),
        "margin"
      ),
    };

    const threshold = config.alerts.anomalyThreshold;
    const anomalies = [
      ...detectAnomalies(revenueModel.history, "revenue", { threshold }),
      ...detectAnomalies(conversionModel.history, "conversion", { threshold }),
      ...detectAnomalies(refundModel.history, "refundRate", { threshold }),
      ...detectAnomalies(sessionModel.history, "sessions", { threshold }),
    ].sort((a, b) => Math.abs(b.robustZ) - Math.abs(a.robustZ));

    const productNames = new Map(raw.products.map((p) => [Number(p.productId), p.name]));
    const products = raw.products.map((p) =>
      enrich(
        { ...p, orders: Number(p.primaryOrders) || Number(p.units) },
        { productId: Number(p.productId), name: p.name, launched: p.launched }
      )
    );
    const productMonthly = raw.productMonthly.map((r) => ({
      period: r.period,
      productId: Number(r.productId),
      name: productNames.get(Number(r.productId)) || `Product ${r.productId}`,
      revenue: round(Number(r.revenue || 0)),
      units: Number(r.units || 0),
      partial: isPartialPeriod(r.period, raw.maxTs),
    }));

    const manifest = readManifest(config.warehouseDir);
    state.warehouse = {
      meta: {
        source: "Maven Fuzzy Factory Parquet / DuckDB",
        store: "duckdb",
        dataVersion: manifest?.hash || etl.hash,
        range: {
          start: monthlyRows[0]?.period || null,
          end: monthlyRows.at(-1)?.period || null,
          completeEnd: lastComplete,
        },
        partialMonth: monthlyRows.find((r) => r.partial)?.period || null,
        builtInMs: Date.now() - t0,
        etlSkipped: Boolean(etl.skipped),
        tables: {
          products: products.length,
          orders: kpis.orders,
          sessions: kpis.sessions,
          refunds: kpis.refunds,
        },
      },
      kpis,
      trend,
      monthly: monthlyRows,
      products,
      productMonthly,
      channels: raw.channels.map((row) => enrich(row, { source: row.source })).sort((a, b) => b.sessions - a.sessions),
      campaigns: raw.campaigns.map((row) => enrich(row, { campaign: row.campaign })).sort((a, b) => b.sessions - a.sessions),
      devices: raw.devices.map((row) => enrich(row, { device: row.device })).sort((a, b) => b.sessions - a.sessions),
      landings: raw.landings.map((row) => enrich(row, { url: row.url })).sort((a, b) => b.sessions - a.sessions),
      funnel: funnelSteps(raw.funnel),
      forecasts: {
        revenue: revenueModel,
        orders: orderModel,
        sessions: sessionModel,
        conversion: conversionModel,
      },
      anomalies,
      contract: {
        orders: Number(raw.contract.orders || 0),
        revenue: round(Number(raw.contract.revenue || 0)),
      },
    };

    state.ready = true;
    state.stage = "ready";
    state.finishedAt = new Date().toISOString();
    endTimer();
    return state.warehouse;
  }

  return {
    get status() {
      return {
        ready: state.ready,
        stage: state.stage,
        error: state.error,
        startedAt: state.startedAt,
        finishedAt: state.finishedAt,
        meta: state.warehouse?.meta || null,
      };
    },
    get warehouse() {
      return state.warehouse;
    },
    get conn() {
      return state.handles?.conn || null;
    },
    parquetReady: () => parquetReady(config.dataDir, config.warehouseDir),
    async run() {
      try {
        return await build();
      } catch (error) {
        state.error = error.message;
        state.stage = "error";
        logger.error({ err: error }, "warehouse build failed");
        throw error;
      }
    },
    requireWarehouse() {
      if (!state.ready || !state.warehouse) {
        const err = new Error("Data engine is still building the warehouse.");
        err.status = 503;
        throw err;
      }
      return state.warehouse;
    },
  };
}
