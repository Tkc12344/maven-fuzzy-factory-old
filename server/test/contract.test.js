import assert from "node:assert/strict";
import { test } from "node:test";
import { createDataEngine } from "../src/warehouse/dataEngine.js";

test("warehouse contract: 32,313 orders and $1,938,510 revenue", async (t) => {
  const engine = createDataEngine();
  const warehouse = await engine.run();
  t.after(() => {});

  assert.equal(warehouse.contract.orders, 32313);
  assert.equal(warehouse.kpis.orders, 32313);
  assert.equal(Math.round(warehouse.contract.revenue), 1_938_510);
  assert.equal(Math.round(warehouse.kpis.revenue), 1_938_510);
  assert.equal(warehouse.meta.store, "duckdb");
  assert.ok(warehouse.meta.dataVersion);
  assert.equal(warehouse.meta.partialMonth, "2015-03");
  assert.equal(warehouse.monthly.at(-1).partial, true);
  assert.ok(warehouse.forecasts.revenue.backtest.holdout === 6);
  assert.ok(warehouse.channels.every((c) => "conversion" in c && "aov" in c && "margin" in c));
});
