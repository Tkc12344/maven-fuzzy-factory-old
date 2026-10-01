import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CHANNEL_NAMES,
  CHART,
  axisTick,
  compactMoney,
  formatPeriod,
  money,
  num,
  pct,
  tooltipStyle,
  withoutPartialMonth,
} from "../api.js";
import { Kpi, Page, PageState, Panel, trendNote } from "../components/ui.jsx";
import { useApi } from "../hooks.js";

export default function Overview() {
  const { data, error, loading } = useApi("/api/v1/dashboard");

  return (
    <Page
      title="Factory overview"
      lead="Three years of Maven Fuzzy Factory commerce, traffic, and fulfillment in one operating picture."
    >
      <PageState error={error} loading={loading || !data} label="Loading overview…">
        {data ? <OverviewBody data={data} /> : null}
      </PageState>
    </Page>
  );
}

function OverviewBody({ data }) {
  const { kpis, trend, monthly, products, channels, alerts, funnel = [], devices = [] } = data;
  const revenue = trendNote(trend.revenue);
  const orders = trendNote(trend.orders);
  const conversion = trendNote(trend.conversion, " pts");
  const margin = trendNote(trend.margin, " pts");

  const revenueSeries = useMemo(
    () =>
      withoutPartialMonth(monthly).map((row) => ({
        ...row,
        label: formatPeriod(row.period),
      })),
    [monthly]
  );

  const channelSeries = useMemo(
    () =>
      [...channels]
        .sort((a, b) => b.conversion - a.conversion)
        .map((row) => ({
          ...row,
          name: CHANNEL_NAMES[row.source] || row.source,
        })),
    [channels]
  );

  return (
    <>
      <section className="kpi-grid">
        <Kpi label="Revenue" value={money(kpis.revenue)} note={revenue.text} tone={revenue.tone} />
        <Kpi label="Orders" value={num(kpis.orders)} note={orders.text} tone={orders.tone} />
        <Kpi label="Conversion" value={pct(kpis.conversion)} note={conversion.text} tone={conversion.tone} />
        <Kpi label="Gross margin" value={pct(kpis.margin)} note={margin.text} tone={margin.tone} />
      </section>

      <div className="grid-2">
        <Panel
          title="Monthly revenue"
          hint="Complete months only. Mar 2015 is omitted — partial month through 19 Mar."
        >
          <div className="chart">
            <ResponsiveContainer>
              <AreaChart data={revenueSeries}>
                <XAxis dataKey="label" tick={axisTick} minTickGap={28} axisLine={false} tickLine={false} />
                <YAxis tick={axisTick} tickFormatter={compactMoney} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle()} formatter={(v) => money(v)} labelFormatter={(_, p) => p?.[0]?.payload?.label} />
                <Area type="linear" dataKey="revenue" stroke={CHART.accent} fill={CHART.accentFill} name="Revenue" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Channel conversion" hint="Orders / sessions by traffic source">
          <div className="chart">
            <ResponsiveContainer>
              <BarChart data={channelSeries} layout="vertical" margin={{ left: 16, right: 40 }}>
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={axisTick}
                  width={120}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip contentStyle={tooltipStyle()} formatter={(v) => `${v}%`} />
                <Bar dataKey="conversion" fill={CHART.accent} name="Conversion" barSize={18} radius={[0, 2, 2, 0]}>
                  <LabelList
                    dataKey="conversion"
                    position="right"
                    formatter={(v) => `${Number(v).toFixed(2)}%`}
                    fill={CHART.ink}
                    fontSize={12}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="grid-3">
        {devices.map((d) => (
          <Kpi
            key={d.device}
            label={d.device}
            value={pct(d.conversion)}
            note={`${num(d.sessions)} sessions · ${money(d.revenue)}`}
          />
        ))}
        <Kpi
          label="Funnel to thank-you"
          value={pct(funnel.at(-1)?.rateFromStart || 0)}
          note={`${num(funnel.at(-1)?.sessions || 0)} completed checkouts`}
        />
      </div>

      <div className="grid-2">
        <Panel title="Product mix" hint="Revenue, units, refunds">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">Revenue</th>
                <th className="num">Units</th>
                <th className="num">Refunds</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.productId}>
                  <td>{p.name}</td>
                  <td className="num">{money(p.revenue)}</td>
                  <td className="num">{num(p.units)}</td>
                  <td className="num">{pct(p.refundRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel
          title="Open automation alerts"
          hint={
            <span>
              Raised after warehouse build · <Link to="/alerts">Open full report</Link>
            </span>
          }
        >
          <div className="list">
            {alerts.map((a) => (
              <article className="list-item" key={a.id}>
                <span className={`badge ${a.severity}`}>{a.severity}</span>
                <h3>{a.title}</h3>
                <p>{a.detail}</p>
              </article>
            ))}
          </div>
        </Panel>
      </div>
    </>
  );
}
