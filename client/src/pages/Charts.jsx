import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CHART,
  PRODUCT_COLORS,
  axisTick,
  compactMoney,
  formatPeriod,
  money,
  num,
  pct,
  tooltipStyle,
  withoutPartialMonth,
} from "../api.js";
import { Page, PageState, Panel } from "../components/ui.jsx";
import { useApi } from "../hooks.js";

export default function Charts() {
  const { data, error, loading } = useApi("/api/v1/analysis");
  const stacked = useMemo(() => {
    if (!data) return [];
    const complete = new Set(withoutPartialMonth(data.monthly).map((row) => row.period));
    const byPeriod = new Map();
    data.productMonthly
      .filter((row) => complete.has(row.period))
      .forEach((row) => {
        const current = byPeriod.get(row.period) || { period: row.period, label: formatPeriod(row.period) };
        current[row.name] = row.revenue;
        byPeriod.set(row.period, current);
      });
    return [...byPeriod.values()];
  }, [data]);

  return (
    <Page title="Charts" lead="Data engine output: revenue mix, acquisition, devices, landing pages, and the checkout funnel.">
      <PageState error={error} loading={loading || !data} label="Loading analysis…">
        {data ? <ChartsBody data={data} stacked={stacked} /> : null}
      </PageState>
    </Page>
  );
}

function ChartsBody({ data, stacked }) {
  const names = data.products.map((p) => p.name);
  const monthly = withoutPartialMonth(data.monthly).map((row) => ({
    ...row,
    label: formatPeriod(row.period),
  }));

  return (
    <>
      <Panel title="Revenue by product" hint="Stacked monthly revenue after each SKU launch. Mar 2015 omitted as a partial month.">
        <div className="chart tall">
          <ResponsiveContainer>
            <AreaChart data={stacked}>
              <CartesianGrid stroke={CHART.grid} vertical={false} />
              <XAxis dataKey="label" tick={axisTick} minTickGap={28} axisLine={false} tickLine={false} />
              <YAxis tick={axisTick} tickFormatter={compactMoney} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle()} formatter={(v) => money(v)} />
              <Legend />
              {names.map((name) => (
                <Area
                  key={name}
                  type="linear"
                  dataKey={name}
                  stackId="1"
                  stroke={PRODUCT_COLORS[name]}
                  fill={PRODUCT_COLORS[name]}
                  fillOpacity={0.28}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <div className="grid-2">
        <Panel title="Sessions vs conversion" hint="Grey is traffic volume; blue is conversion rate">
          <div className="chart">
            <ResponsiveContainer>
              <LineChart data={monthly}>
                <CartesianGrid stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="label" tick={axisTick} minTickGap={28} axisLine={false} tickLine={false} />
                <YAxis yAxisId="left" tick={axisTick} axisLine={false} tickLine={false} />
                <YAxis yAxisId="right" orientation="right" tick={axisTick} axisLine={false} tickLine={false} unit="%" />
                <Tooltip contentStyle={tooltipStyle()} />
                <Legend />
                <Line yAxisId="left" type="linear" dataKey="sessions" stroke={CHART.context} dot={false} name="Sessions" />
                <Line yAxisId="right" type="linear" dataKey="conversion" stroke={CHART.accent} dot={false} name="Conversion %" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Checkout funnel" hint="Unique sessions that reached each step">
          <div className="chart">
            <ResponsiveContainer>
              <BarChart data={data.funnel}>
                <CartesianGrid stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="step" tick={axisTick} axisLine={false} tickLine={false} />
                <YAxis tick={axisTick} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle()} />
                <Bar dataKey="sessions" fill={CHART.accent} name="Sessions" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="grid-2">
        <Panel title="Acquisition">
          <table>
            <thead>
              <tr>
                <th>Campaign</th>
                <th className="num">Sessions</th>
                <th className="num">CR</th>
                <th className="num">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {data.campaigns.map((c) => (
                <tr key={c.campaign}>
                  <td>{c.campaign}</td>
                  <td className="num">{num(c.sessions)}</td>
                  <td className="num">{pct(c.conversion)}</td>
                  <td className="num">{money(c.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Landing pages">
          <table>
            <thead>
              <tr>
                <th>First page</th>
                <th className="num">Sessions</th>
                <th className="num">CR</th>
                <th className="num">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {data.landings.map((l) => (
                <tr key={l.url}>
                  <td>{l.url}</td>
                  <td className="num">{num(l.sessions)}</td>
                  <td className="num">{pct(l.conversion)}</td>
                  <td className="num">{money(l.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </>
  );
}
