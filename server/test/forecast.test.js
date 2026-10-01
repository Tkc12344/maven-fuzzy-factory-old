import assert from "node:assert/strict";
import { test } from "node:test";
import { detectAnomalies, seasonalForecast, stlDecompose } from "../src/lib/forecast.js";

function monthlySeries() {
  const points = [];
  let period = "2012-03";
  for (let i = 0; i < 36; i += 1) {
    const month = Number(period.slice(5, 7));
    const seasonal = 1 + 0.2 * Math.sin((2 * Math.PI * (month - 1)) / 12);
    points.push({ period, value: (40000 + i * 800) * seasonal });
    const [y, m] = period.split("-").map(Number);
    const d = new Date(Date.UTC(y, m, 1));
    period = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  return points;
}

test("STL decomposition produces remainder and seasonal pattern", () => {
  const points = monthlySeries();
  const fit = stlDecompose(points);
  assert.equal(fit.remainder.length, 36);
  assert.equal(fit.pattern.length, 12);
  assert.ok(Number.isFinite(fit.slope));
});

test("forecast labels near/outlook/scenario and returns intervals plus backtest", () => {
  const model = seasonalForecast(monthlySeries(), { until: "2030-12", holdout: 6 });
  assert.equal(model.kind, "scenario");
  assert.equal(model.method, "stl-mad");
  assert.ok(model.caveat.includes("scenario"));
  assert.ok(model.forecasts[0].low <= model.forecasts[0].value);
  assert.ok(model.forecasts[0].high >= model.forecasts[0].value);
  assert.equal(model.forecasts[0].kind, "forecast");
  assert.equal(model.forecasts[20].kind, "outlook");
  assert.equal(model.forecasts.at(-1).kind, "scenario");
  assert.equal(model.backtest.holdout, 6);
  assert.ok(model.backtest.mape != null);
  assert.ok(model.yearly.some((y) => y.year === "2030" && y.kind === "scenario"));
});

test("MAD anomalies ignore ordinary noise and catch a spike", () => {
  const points = monthlySeries();
  points[20].value *= 3;
  const model = seasonalForecast(points, { until: "2015-03" });
  const flags = detectAnomalies(model.history, "revenue", { threshold: 3.5 });
  assert.ok(flags.some((row) => row.period === points[20].period));
  assert.equal(flags[0].method, "stl-mad");
});
