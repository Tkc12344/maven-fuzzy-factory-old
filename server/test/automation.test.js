import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAlertDrafts } from "../src/engines/automationEngine.js";
import { enrich } from "../src/metrics/kpis.js";

test("automation drafts use shared KPI fields and skip resolved-style duplicates by stable ids", () => {
  const kpis = enrich({
    revenue: 100000,
    cogs: 40000,
    refundAmount: 5000,
    orders: 1000,
    sessions: 20000,
    refunds: 80,
  });
  const warehouse = {
    kpis,
    channels: [
      enrich({ revenue: 10000, sessions: 5000, orders: 50 }, { source: "socialbook" }),
      enrich({ revenue: 80000, sessions: 8000, orders: 800 }, { source: "gsearch" }),
    ],
    devices: [
      enrich({ revenue: 20000, sessions: 10000, orders: 100 }, { device: "mobile" }),
      enrich({ revenue: 70000, sessions: 8000, orders: 700 }, { device: "desktop" }),
    ],
    funnel: [
      { step: "Landing", sessions: 1000, dropFromPrev: 0 },
      { step: "Cart", sessions: 200, dropFromPrev: 80 },
    ],
    anomalies: [
      {
        period: "2014-11",
        metric: "revenue",
        actual: 1,
        expected: 2,
        z: 4,
        robustZ: 4,
        direction: "spike",
        severity: "high",
      },
    ],
    forecasts: { revenue: { forecasts: [{ kind: "forecast", value: 100 }] } },
    monthly: [{ partial: false, revenue: 500 }],
    products: [enrich({ revenue: 90000, units: 100, refunds: 10, refundAmount: 100 }, { productId: 1, name: "Mr Fuzzy" })],
  };

  const drafts = buildAlertDrafts(warehouse, {
    conversionGapRatio: 0.7,
    funnelDropPct: 40,
    refundRatePct: 4,
    skuRefundRatePct: 6,
    forecastSoftRatio: 0.92,
  });
  const ids = drafts.map((d) => d.id);
  assert.ok(ids.includes("anom-revenue-2014-11"));
  assert.ok(ids.includes("channel-socialbook"));
  assert.ok(ids.includes("device-mobile-gap"));
  assert.ok(ids.includes("funnel-cart"));
  assert.equal(new Set(ids).size, ids.length);
});
