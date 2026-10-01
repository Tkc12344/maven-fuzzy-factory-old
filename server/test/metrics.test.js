import assert from "node:assert/strict";
import { test } from "node:test";
import { addFacts, emptyFacts, enrich, KPI } from "../src/metrics/kpis.js";

test("KPI formulas stay internally consistent", () => {
  const row = enrich({
    revenue: 1_938_510,
    cogs: 1_000_000,
    refundAmount: 38_510,
    orders: 32_313,
    sessions: 472_871,
    refunds: 1_000,
    repeatSessions: 10_000,
    multiItemOrders: 2_000,
  });
  assert.equal(row.profit, KPI.profit.compute(row));
  assert.equal(row.conversion, 6.83);
  assert.equal(row.aov, 59.99);
  assert.ok(row.margin > 40);
  assert.equal(row.refundRate, 3.09);
});

test("addFacts aggregates before enrich", () => {
  const total = [emptyFacts(), { revenue: 100, orders: 2, sessions: 10 }, { revenue: 50, orders: 1, sessions: 5 }].reduce(
    addFacts
  );
  const kpis = enrich(total);
  assert.equal(kpis.revenue, 150);
  assert.equal(kpis.orders, 3);
  assert.equal(kpis.conversion, 20);
  assert.equal(kpis.aov, 50);
});
