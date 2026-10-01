import { addMonths, linearRegression, mad, mean, monthsBetween, round } from "./stats.js";

const SEASON = 12;
const NEAR_HORIZON = 12;
const OUTLOOK_HORIZON = 36;

function monthIndex(period) {
  return Number(period.slice(5, 7)) - 1;
}

function linearTrend(values) {
  const points = values.map((y, x) => ({ x, y }));
  const { slope, intercept } = linearRegression(points);
  return {
    slope,
    intercept,
    fitted: values.map((_, x) => slope * x + intercept),
  };
}

function seasonalPattern(periods, detrended) {
  const buckets = Array.from({ length: SEASON }, () => []);
  periods.forEach((period, i) => {
    buckets[monthIndex(period)].push(detrended[i]);
  });
  const raw = buckets.map((arr) => (arr.length ? medianLike(arr) : 0));
  const center = mean(raw);
  return raw.map((v) => v - center);
}

function medianLike(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Robust STL-style monthly decomposition: linear trend, month-of-year medians,
 * MAD of remainder. Three yearly cycles is still thin — treat the seasonal
 * component as fragile and the long horizon as a scenario.
 */
export function stlDecompose(points, { inner = 2 } = {}) {
  if (!points.length) {
    return { trend: [], seasonal: [], remainder: [], slope: 0, intercept: 0, pattern: Array(SEASON).fill(0) };
  }
  const y = points.map((p) => p.value);
  const periods = points.map((p) => p.period);
  let trendFit = linearTrend(y);
  let pattern = Array(SEASON).fill(0);
  let seasonal = y.map(() => 0);

  for (let i = 0; i < inner; i += 1) {
    const detrended = y.map((v, idx) => v - trendFit.fitted[idx]);
    pattern = seasonalPattern(periods, detrended);
    seasonal = periods.map((period) => pattern[monthIndex(period)]);
    const deseason = y.map((v, idx) => v - seasonal[idx]);
    trendFit = linearTrend(deseason);
  }

  const remainder = y.map((v, i) => v - trendFit.fitted[i] - seasonal[i]);
  return {
    trend: trendFit.fitted,
    seasonal,
    remainder,
    slope: trendFit.slope,
    intercept: trendFit.intercept,
    pattern,
  };
}

function horizonKind(h) {
  if (h <= NEAR_HORIZON) return "forecast";
  if (h <= OUTLOOK_HORIZON) return "outlook";
  return "scenario";
}

function rollupYearly(forecasts) {
  const byYear = new Map();
  forecasts.forEach((f) => {
    const year = f.period.slice(0, 4);
    const row = byYear.get(year) || {
      year,
      value: 0,
      low: 0,
      high: 0,
      months: 0,
      kinds: new Set(),
    };
    row.value += f.value;
    row.low += f.low;
    row.high += f.high;
    row.months += 1;
    row.kinds.add(f.kind);
    byYear.set(year, row);
  });
  return [...byYear.values()].map((row) => ({
    year: row.year,
    value: round(row.value, 2),
    low: round(row.low, 2),
    high: round(row.high, 2),
    months: row.months,
    kind: row.kinds.has("scenario") ? "scenario" : row.kinds.has("outlook") ? "outlook" : "forecast",
  }));
}

function predictFromFit(fit, points, startPeriod, lastPeriod, until) {
  const sigma = 1.4826 * (mad(fit.remainder) || 0);
  const n = points.length;
  const last = lastPeriod;
  const horizon = Math.max(0, monthsBetween(last, until));
  const forecasts = [];
  for (let h = 1; h <= horizon; h += 1) {
    const period = addMonths(last, h);
    const x = monthsBetween(startPeriod, period);
    const seas = fit.pattern[monthIndex(period)] || 0;
    const value = Math.max(0, fit.slope * x + fit.intercept + seas);
    const band = 1.96 * sigma * Math.sqrt(1 + h / Math.max(n, 1));
    forecasts.push({
      period,
      value: round(value, 2),
      low: round(Math.max(0, value - band), 2),
      high: round(value + band, 2),
      kind: horizonKind(h),
    });
  }
  return { forecasts, sigma };
}

export function backtest(points, { holdout = 6 } = {}) {
  if (points.length <= holdout + SEASON) {
    return { holdout: 0, mape: null, rmse: null, coverage: null, rows: [] };
  }
  const train = points.slice(0, -holdout);
  const actuals = points.slice(-holdout);
  const fit = stlDecompose(train);
  const until = actuals.at(-1).period;
  const { forecasts } = predictFromFit(fit, train, train[0].period, train.at(-1).period, until);
  const rows = actuals.map((a, i) => {
    const f = forecasts[i] || { value: 0, low: 0, high: 0 };
    return {
      period: a.period,
      actual: round(a.value, 2),
      forecast: f.value,
      low: f.low,
      high: f.high,
      absPctErr: a.value ? round((Math.abs(a.value - f.value) / Math.abs(a.value)) * 100, 2) : 0,
      covered: a.value >= f.low && a.value <= f.high,
    };
  });
  const mape = round(mean(rows.map((r) => r.absPctErr)), 2);
  const rmse = round(Math.sqrt(mean(rows.map((r) => (r.actual - r.forecast) ** 2))), 2);
  const coverage = round(pctCoverage(rows), 2);
  return { holdout, mape, rmse, coverage, rows };
}

function pctCoverage(rows) {
  if (!rows.length) return 0;
  return (rows.filter((r) => r.covered).length / rows.length) * 100;
}

export function seasonalForecast(points, { until = "2030-12", holdout = 6 } = {}) {
  if (!points.length) {
    return {
      history: [],
      forecasts: [],
      yearly: [],
      slope: 0,
      sigma: 0,
      seasonality: [],
      until,
      kind: "scenario",
      method: "stl-mad",
      backtest: { holdout: 0, mape: null, rmse: null, coverage: null, rows: [] },
      caveat: "No complete months available.",
    };
  }

  const start = points[0].period;
  const last = points[points.length - 1].period;
  const fit = stlDecompose(points);
  const { forecasts, sigma } = predictFromFit(fit, points, start, last, until);
  const remainderMad = mad(fit.remainder) || 0;
  const scale = 1.4826 * remainderMad || 1;

  const history = points.map((p, i) => {
    const fitted = fit.trend[i] + fit.seasonal[i];
    const residual = p.value - fitted;
    const robustZ = residual / scale;
    return {
      period: p.period,
      actual: round(p.value, 2),
      fitted: round(Math.max(0, fitted), 2),
      residual: round(residual, 2),
      z: round(robustZ, 2),
      robustZ: round(robustZ, 2),
    };
  });

  return {
    history,
    forecasts,
    yearly: rollupYearly(forecasts),
    until,
    trainedThrough: last,
    method: "stl-mad",
    kind: "scenario",
    slope: round(fit.slope, 4),
    sigma: round(sigma, 2),
    mad: round(remainderMad, 2),
    seasonality: fit.pattern.map((s) => round(s, 3)),
    backtest: backtest(points, { holdout }),
    caveat:
      "Long-horizon figures are a scenario from three seasonal cycles ending in 2015, not a prediction. Near-term months (12) are a forecast; 13–36 months are outlook; beyond that is scenario.",
  };
}

export function detectAnomalies(history, metric, { threshold = 3.5 } = {}) {
  return history
    .filter((row) => Math.abs(row.robustZ ?? row.z) >= threshold)
    .map((row) => {
      const score = row.robustZ ?? row.z;
      return {
        period: row.period,
        metric,
        actual: row.actual,
        expected: row.fitted,
        z: round(score, 2),
        robustZ: round(score, 2),
        method: "stl-mad",
        direction: score > 0 ? "spike" : "drop",
        severity: Math.abs(score) >= 5 ? "critical" : Math.abs(score) >= 4.2 ? "high" : "medium",
      };
    });
}
