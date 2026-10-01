import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { round } from "../lib/stats.js";
import { deliverAlert } from "./delivery.js";
import { createAlertStore } from "../store/alerts.js";

function draftAlert({ id, severity, title, detail, metric, period }) {
  return { id, severity, title, detail, metric, period: period || null };
}

export function buildAlertDrafts(warehouse, thresholds = config.alerts) {
  const next = [];
  const { kpis, channels, devices, funnel, anomalies, forecasts, products } = warehouse;

  anomalies.slice(0, 12).forEach((row) => {
    next.push(
      draftAlert({
        id: `anom-${row.metric}-${row.period}`,
        severity: row.severity,
        title: `${row.metric} ${row.direction} in ${row.period}`,
        detail: `Observed ${row.actual} vs STL baseline ${row.expected} (robust z=${row.robustZ ?? row.z}).`,
        metric: row.metric,
        period: row.period,
      })
    );
  });

  channels
    .filter((c) => c.sessions > 1000 && c.conversion < kpis.conversion * thresholds.conversionGapRatio)
    .forEach((c) => {
      next.push(
        draftAlert({
          id: `channel-${c.source}`,
          severity: "high",
          title: `${c.source} converts well below site average`,
          detail: `${c.source} conversion is ${c.conversion}% versus the ${kpis.conversion}% site average across ${c.sessions.toLocaleString()} sessions.`,
          metric: "conversion",
        })
      );
    });

  const mobile = devices.find((d) => d.device === "mobile");
  const desktop = devices.find((d) => d.device === "desktop");
  if (mobile && desktop && mobile.conversion < desktop.conversion * thresholds.conversionGapRatio) {
    next.push(
      draftAlert({
        id: "device-mobile-gap",
        severity: "high",
        title: "Mobile conversion gap",
        detail: `Mobile converts at ${mobile.conversion}% vs desktop ${desktop.conversion}%. Paid mobile traffic is under-earning.`,
        metric: "conversion",
      })
    );
  }

  const leaky = funnel.slice(1).sort((a, b) => b.dropFromPrev - a.dropFromPrev)[0];
  if (leaky && leaky.dropFromPrev >= thresholds.funnelDropPct) {
    next.push(
      draftAlert({
        id: `funnel-${leaky.step.replace(/\s+/g, "-").toLowerCase()}`,
        severity: "medium",
        title: `Large drop before ${leaky.step}`,
        detail: `${leaky.dropFromPrev}% of the previous step never reaches ${leaky.step}.`,
        metric: "funnel",
      })
    );
  }

  if (kpis.refundRate >= thresholds.refundRatePct) {
    next.push(
      draftAlert({
        id: "refund-rate",
        severity: "medium",
        title: `Refund rate above ${thresholds.refundRatePct}%`,
        detail: `${kpis.refunds.toLocaleString()} refunds (${kpis.refundRate}%) totaling $${kpis.refundAmount.toLocaleString()}.`,
        metric: "refundRate",
      })
    );
  }

  const near = (forecasts.revenue.forecasts || []).filter((f) => f.kind === "forecast").slice(0, 6);
  const next6 = near.reduce((s, r) => s + r.value, 0);
  const last6 = warehouse.monthly.filter((r) => !r.partial).slice(-6).reduce((s, r) => s + r.revenue, 0);
  if (near.length && next6 < last6 * thresholds.forecastSoftRatio) {
    next.push(
      draftAlert({
        id: "forecast-soft",
        severity: "medium",
        title: "Six-month forecast is softer than the last half-year",
        detail: `Projected $${round(next6).toLocaleString()} vs trailing $${round(last6).toLocaleString()}. This is a near-term forecast, not the 2030 scenario.`,
        metric: "forecast",
      })
    );
  }

  const riskySku = products.find((p) => p.refundRate >= thresholds.skuRefundRatePct);
  if (riskySku) {
    next.push(
      draftAlert({
        id: `sku-refund-${riskySku.productId}`,
        severity: "medium",
        title: `${riskySku.name} refund rate is elevated`,
        detail: `${riskySku.refundRate}% of units were refunded ($${riskySku.refundAmount.toLocaleString()}).`,
        metric: "refundRate",
      })
    );
  }

  const rank = { critical: 0, high: 1, medium: 2, low: 3 };
  return next.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9));
}

function hoursSince(iso) {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 36e5;
}

export function createAutomationEngine(dataEngine) {
  const store = createAlertStore();
  let report = null;

  async function evaluate({ deliver = false } = {}) {
    const warehouse = dataEngine.requireWarehouse();
    const drafts = buildAlertDrafts(warehouse);
    const persisted = [];

    for (const draft of drafts) {
      const row = await store.upsert(draft);
      persisted.push(row);
      const cooling = hoursSince(row.lastFiredAt) < config.alerts.cooldownHours;
      if (deliver && row.status === "fired" && (row.isNew || !cooling)) {
        await deliverAlert(row);
        await store.markFired(row.id);
      }
    }

    const alerts = await store.list();
    const open = alerts.filter((a) => a.status === "fired" || a.status === "acknowledged");
    const { kpis, trend, channels, products, forecasts } = warehouse;
    const best = [...channels].sort((a, b) => b.conversion - a.conversion)[0];
    report = {
      generatedAt: new Date().toISOString(),
      headline: `Maven Fuzzy Factory · ${warehouse.meta.range.start} to ${warehouse.meta.range.completeEnd || warehouse.meta.range.end}`,
      kpis,
      trend,
      alertCount: open.length,
      criticalCount: open.filter((a) => a.severity === "critical" || a.severity === "high").length,
      narrative: [
        `Revenue reached $${kpis.revenue.toLocaleString()} from ${kpis.orders.toLocaleString()} orders and ${kpis.sessions.toLocaleString()} sessions (${kpis.conversion}% conversion, $${kpis.aov} AOV).`,
        `Gross margin after refunds is ${kpis.margin}%. Trailing-year revenue is ${trend.revenue > 0 ? "up" : "down"} ${Math.abs(trend.revenue)}% versus the prior year.`,
        `${best?.source} is the strongest converting source at ${best?.conversion}%. ${products[0]?.name} still leads the catalog at $${products[0]?.revenue.toLocaleString()}.`,
        `${open.length} automation alerts are open, ${open.filter((a) => a.severity === "critical" || a.severity === "high").length} of them high or critical.`,
      ],
      outlook: forecasts.revenue.yearly || [],
      caveat: forecasts.revenue.caveat,
    };

    logger.info({ open: open.length, drafts: drafts.length }, "automation evaluate");
    return { alerts, report };
  }

  return {
    store,
    evaluate,
    async getAlerts() {
      if (!dataEngine.status.ready) return [];
      const alerts = await store.list();
      if (!alerts.length) {
        const result = await evaluate({ deliver: false });
        return result.alerts;
      }
      return alerts;
    },
    async getReport() {
      if (!report && dataEngine.status.ready) await evaluate({ deliver: false });
      return report;
    },
    async ack(id) {
      return store.setStatus(id, "acknowledged");
    },
    async resolve(id) {
      return store.setStatus(id, "resolved");
    },
  };
}
