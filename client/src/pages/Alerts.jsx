import { compactMoney, formatPeriod, money, num, pct, postJson } from "../api.js";
import { Kpi, Page, PageState, Panel } from "../components/ui.jsx";
import { useApi } from "../hooks.js";

export default function Alerts() {
  const alerts = useApi("/api/v1/alerts");
  const report = useApi("/api/v1/report");
  const error = alerts.error || report.error;
  const loading = (alerts.loading || report.loading) && !(alerts.data && report.data);

  const act = async (id, action) => {
    await postJson(`/api/v1/alerts/${id}/${action}`);
    await Promise.all([alerts.reload(), report.reload()]);
  };

  return (
    <Page
      title="Alerts and reports"
      lead="Hourly scheduler writes alert state to warehouse/alerts.json and can push Slack, Teams, or email. Thresholds are configurable. Acknowledge or resolve so the same alert is not re-sent."
    >
      <PageState error={error} loading={loading} label="Loading automation output…">
        {alerts.data && report.data ? (
          <AlertsBody alerts={alerts.data} report={report.data} onAct={act} />
        ) : null}
      </PageState>
    </Page>
  );
}

function AlertsBody({ alerts, report, onAct }) {
  const open = alerts.filter((a) => a.status !== "resolved");
  return (
    <>
      <section className="kpi-grid">
        <Kpi label="Open alerts" value={open.length} />
        <Kpi label="High / critical" value={report.criticalCount} />
        <Kpi label="Revenue" value={compactMoney(report.kpis.revenue)} />
        <Kpi label="Conversion" value={pct(report.kpis.conversion)} />
      </section>
      <div className="grid-2">
        <Panel title="Alert feed">
          <div className="list">
            {alerts.map((a) => (
              <article className="list-item" key={a.id}>
                <div className="alert-head">
                  <span className={`badge ${a.severity}`}>{a.severity}</span>
                  <span className={`badge ${a.status || "fired"}`}>{a.status || "fired"}</span>
                </div>
                <h3>{a.title}</h3>
                <p>{a.detail}</p>
                {a.status !== "resolved" ? (
                  <div className="alert-actions">
                    {a.status !== "acknowledged" ? (
                      <button className="btn ghost small" onClick={() => onAct(a.id, "ack")}>
                        Acknowledge
                      </button>
                    ) : null}
                    <button className="btn ghost small" onClick={() => onAct(a.id, "resolve")}>
                      Resolve
                    </button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </Panel>
        <Panel title={report.headline} hint={`Generated ${report.generatedAt}`}>
          {report.narrative.map((para) => (
            <p key={para}>{para}</p>
          ))}
          {report.caveat ? <p className="hint">{report.caveat}</p> : null}
          <h3>Outlook</h3>
          <table>
            <thead>
              <tr>
                <th>Year</th>
                <th>Kind</th>
                <th className="num">Scenario</th>
              </tr>
            </thead>
            <tbody>
              {report.outlook.map((row) => (
                <tr key={row.year || row.period}>
                  <td>{row.year || formatPeriod(row.period)}</td>
                  <td>
                    <span className={`badge ${row.kind || "forecast"}`}>{row.kind || "forecast"}</span>
                  </td>
                  <td className="num">{money(row.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">
            {num(report.kpis.orders)} orders · {num(report.kpis.sessions)} sessions · {pct(report.kpis.margin)} margin
          </p>
        </Panel>
      </div>
    </>
  );
}
