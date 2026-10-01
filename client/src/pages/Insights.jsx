import { useState } from "react";
import { Link } from "react-router-dom";
import { Page, PageState, Panel } from "../components/ui.jsx";
import { useApi } from "../hooks.js";

export default function Insights() {
  const { data, error, loading, reload } = useApi("/api/v1/insights");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    try {
      await reload("/api/v1/insights?refresh=1");
    } catch {
      /* error state handled by hook */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page
      title="AI insights"
      lead="Mistral reads the warehouse. SerpAPI runs beside it so market context arrives without waiting on the model."
      actions={
        <>
          {(data?.sources || (data?.provider ? [data.provider] : [])).map((source) => (
            <span className="badge" key={source}>
              {source}
            </span>
          ))}
          <button className="btn" disabled={busy || loading} onClick={refresh}>
            {busy ? "Refreshing…" : "Refresh insights"}
          </button>
        </>
      }
    >
      <PageState error={error} loading={(loading || !data) && !error} label="Generating insights…">
        {data ? <InsightsBody data={data} /> : null}
      </PageState>
    </Page>
  );
}

function InsightsBody({ data }) {
  const warehouseInsights = (data.insights || []).filter((item) => !(item.tags || []).includes("serpapi"));
  const marketInsights = (data.insights || []).filter((item) => (item.tags || []).includes("serpapi"));

  return (
    <>
      <Panel title="Executive summary" hint={data.generatedAt}>
        <p>{data.summary}</p>
        {data.error ? <p className="hint">LLM fallback: {data.error}</p> : null}
        {data.usage ? (
          <p className="hint">
            {data.usage.provider} · {data.usage.latencyMs}ms · {data.usage.promptTokens + data.usage.completionTokens} tokens ·
            ${data.usage.costUsd}
          </p>
        ) : null}
      </Panel>
      <div className="grid-2" style={{ marginTop: 12 }}>
        <Panel title="Warehouse insights">
          <div className="list">
            {warehouseInsights.map((item) => (
              <article className="list-item" key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
                <div className="tags">
                  <span className="tag">{item.confidence}</span>
                  {(item.tags || []).map((tag) => (
                    <span className="tag" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </Panel>
        <Panel title="Recommendations">
          <ol className="recs">
            {data.recommendations.map((rec) => (
              <li key={rec}>{rec}</li>
            ))}
          </ol>
        </Panel>
      </div>
      {marketInsights.length ? (
        <Panel
          title="Market notes from SerpAPI"
          hint={
            <span>
              Live Google results · <Link to="/research">Open full search</Link>
            </span>
          }
          className="spaced"
        >
          <div className="list">
            {marketInsights.map((item) => (
              <article className="list-item" key={item.title}>
                <h3>
                  {item.link ? (
                    <a href={item.link} target="_blank" rel="noreferrer">
                      {item.title}
                    </a>
                  ) : (
                    item.title
                  )}
                </h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </Panel>
      ) : null}
    </>
  );
}
