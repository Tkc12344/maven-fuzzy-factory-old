import {
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART, axisTick, formatPeriod, tooltipStyle } from "../api.js";
import { Page, PageState, Panel } from "../components/ui.jsx";
import { useApi } from "../hooks.js";

export default function Anomalies() {
  const { data, error, loading } = useApi("/api/v1/anomalies");
  const rows = data || [];
  const scatter = rows.map((r, i) => ({ ...r, x: i, y: r.robustZ ?? r.z }));

  return (
    <Page
      title="Anomalies"
      lead="Complete months only. Remainder from an STL decomposition, scored with a MAD robust z. March 2015 is excluded as a partial month."
    >
      <PageState error={error} loading={loading} label="Loading anomalies…">
        <Panel title="Robust z-scores" hint="Threshold |z| ≥ 3.5 on STL remainder / 1.4826 MAD">
          <div className="chart">
            <ResponsiveContainer>
              <ScatterChart>
                <CartesianGrid stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="x" tick={false} name="Event" axisLine={false} tickLine={false} />
                <YAxis dataKey="y" tick={axisTick} name="robust z" axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={tooltipStyle()}
                  formatter={(value, name, props) => {
                    if (name === "y") return [props.payload.robustZ ?? props.payload.z, `${props.payload.metric} robust z`];
                    return [value, name];
                  }}
                  labelFormatter={(_, payload) => formatPeriod(payload?.[0]?.payload?.period)}
                />
                <Scatter data={scatter} name="Anomaly">
                  {scatter.map((r) => (
                    <Cell key={`${r.metric}-${r.period}`} fill={r.direction === "spike" ? CHART.up : CHART.down} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Flagged periods">
          <table>
            <thead>
              <tr>
                <th>Period</th>
                <th>Metric</th>
                <th>Direction</th>
                <th className="num">Actual</th>
                <th className="num">Expected</th>
                <th className="num">Robust z</th>
                <th>Severity</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.metric}-${r.period}`}>
                  <td>{formatPeriod(r.period)}</td>
                  <td>{r.metric}</td>
                  <td>
                    <span className={`badge ${r.direction}`}>{r.direction}</span>
                  </td>
                  <td className="num">{r.actual}</td>
                  <td className="num">{r.expected}</td>
                  <td className="num">{r.robustZ ?? r.z}</td>
                  <td>
                    <span className={`badge ${r.severity}`}>{r.severity}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </PageState>
    </Page>
  );
}
