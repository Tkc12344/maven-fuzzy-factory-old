import { useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART, axisTick, compactMoney, formatPeriod, money, pct, tooltipStyle } from "../api.js";
import { Kpi, Page, PageState, Panel } from "../components/ui.jsx";
import { useApi } from "../hooks.js";

const METRICS = ["revenue", "orders", "sessions", "conversion"];

export default function Forecasts() {
  const { data, error, loading } = useApi("/api/v1/forecasts");
  const [metric, setMetric] = useState("revenue");
  const series = data?.[metric];
  const chartData = useMemo(() => {
    if (!series) return [];
    const rows = series.history
      .filter((h) => h.period !== "2015-03")
      .map((h) => ({
        period: h.period,
        label: formatPeriod(h.period),
        actual: h.actual,
        fitted: h.fitted,
      }));
    series.forecasts.forEach((f) => {
      rows.push({
        period: f.period,
        label: formatPeriod(f.period),
        forecast: f.value,
        low: f.low,
        high: f.high,
        kind: f.kind,
      });
    });
    return rows;
  }, [series]);

  const yearly = series?.yearly || [];
  const near = (series?.forecasts || []).filter((f) => f.kind === "forecast");
  const nearTotal = near.reduce((sum, row) => sum + row.value, 0);
  const backtest = series?.backtest || {};

  return (
    <Page
      title="Forecasts"
      lead="STL trend plus month-of-year medians, trained on complete months through Feb 2015. Anything past 12 months is labeled outlook or scenario — not a prediction."
      actions={METRICS.map((key) => (
        <button key={key} className={`btn ${metric === key ? "" : "ghost"}`} onClick={() => setMetric(key)}>
          {key}
        </button>
      ))}
    >
      <PageState error={error} loading={loading || !series} label="Loading forecasts…">
        {series ? (
          <>
            <p className="callout">{series.caveat}</p>
            <section className="kpi-grid">
              <Kpi
                label="Next 12 months"
                value={
                  metric === "conversion"
                    ? `${(nearTotal / (near.length || 1)).toFixed(2)}% avg`
                    : metric === "revenue"
                      ? money(nearTotal)
                      : Math.round(nearTotal).toLocaleString()
                }
                note="Forecast horizon"
              />
              <Kpi
                label="Backtest MAPE"
                value={backtest.mape != null ? pct(backtest.mape) : "—"}
                note={`Holdout last ${backtest.holdout || 6} months`}
              />
              <Kpi
                label="Interval coverage"
                value={backtest.coverage != null ? pct(backtest.coverage, 0) : "—"}
                note="Share of holdout inside 95% band"
              />
              <Kpi label="Residual MAD" value={series.mad} note="Robust scale for intervals" />
            </section>
            <Panel
              title={`${metric} · history and widening interval`}
              hint="Mar 2015 is excluded as a partial month. Blue band is the 95% prediction interval; it widens with the horizon."
            >
              <div className="chart tall">
                <ResponsiveContainer>
                  <ComposedChart data={chartData}>
                    <CartesianGrid stroke={CHART.grid} vertical={false} />
                    <XAxis dataKey="label" tick={axisTick} minTickGap={36} axisLine={false} tickLine={false} />
                    <YAxis
                      tick={axisTick}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={metric === "revenue" ? compactMoney : (v) => v}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle()}
                      labelFormatter={(_, payload) => payload?.[0]?.payload?.label}
                    />
                    <Legend />
                    <Area type="linear" dataKey="high" stroke="none" fill={CHART.accentFill} name="High" />
                    <Area type="linear" dataKey="low" stroke="none" fill="#F8FAFC" name="Low" />
                    <Line type="linear" dataKey="actual" stroke={CHART.ink} dot={false} name="Actual" />
                    <Line type="linear" dataKey="fitted" stroke={CHART.context} dot={false} strokeDasharray="4 4" name="Fitted" />
                    <Line type="linear" dataKey="forecast" stroke={CHART.accent} dot={false} name="Forecast" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Panel>
            <div className="grid-2">
              <Panel title="Held-out last 6 months" hint="Fit on earlier complete months, score on the last six">
                <table>
                  <thead>
                    <tr>
                      <th>Period</th>
                      <th className="num">Actual</th>
                      <th className="num">Forecast</th>
                      <th className="num">APE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(backtest.rows || []).map((row) => (
                      <tr key={row.period}>
                        <td>{formatPeriod(row.period)}</td>
                        <td className="num">{formatValue(metric, row.actual)}</td>
                        <td className="num">{formatValue(metric, row.forecast)}</td>
                        <td className="num">{pct(row.absPctErr)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
              <Panel title="Annual rollup through 2030" hint="Years after 2016 are scenario">
                <table>
                  <thead>
                    <tr>
                      <th>Year</th>
                      <th>Kind</th>
                      <th className="num">Mid</th>
                      <th className="num">Low</th>
                      <th className="num">High</th>
                    </tr>
                  </thead>
                  <tbody>
                    {yearly.map((row) => (
                      <tr key={row.year}>
                        <td>
                          {row.year}
                          {row.months < 12 ? ` (${row.months} mo)` : ""}
                        </td>
                        <td>
                          <span className={`badge ${row.kind}`}>{row.kind}</span>
                        </td>
                        <td className="num">{formatYearValue(metric, row.value, row.months)}</td>
                        <td className="num">{formatYearValue(metric, row.low, row.months)}</td>
                        <td className="num">{formatYearValue(metric, row.high, row.months)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            </div>
          </>
        ) : null}
      </PageState>
    </Page>
  );
}

function formatValue(metric, value) {
  if (metric === "revenue") return money(value);
  if (metric === "conversion") return pct(value);
  return Math.round(value).toLocaleString();
}

function formatYearValue(metric, value, months) {
  if (metric === "revenue") return money(value);
  if (metric === "conversion") return `${(value / (months || 1)).toFixed(2)}% avg`;
  return Math.round(value).toLocaleString();
}
