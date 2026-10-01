import { useState } from "react";
import { Page, PageState, Panel } from "../components/ui.jsx";
import { useApi } from "../hooks.js";

export default function Research() {
  const { data, error, loading, reload } = useApi("/api/v1/research");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    try {
      await reload("/api/v1/research?refresh=1");
    } catch {
      /* hook stores the error */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page
      title="Market search"
      lead="SerpAPI queries Google for stuffed-animal market, advertising, and bestseller context. This runs in parallel with Mistral on the insights page."
      actions={
        <>
          <span className="badge">{data?.enabled ? "serpapi" : "disabled"}</span>
          {data?.elapsedMs != null ? <span className="badge">{data.elapsedMs}ms</span> : null}
          <button className="btn" disabled={busy || loading} onClick={refresh}>
            {busy ? "Searching…" : "Refresh search"}
          </button>
        </>
      }
    >
      <PageState error={error} loading={loading && !data} label="Searching the live web…">
        {data ? <ResearchBody data={data} /> : null}
      </PageState>
    </Page>
  );
}

function ResearchBody({ data }) {
  if (!data.enabled) {
    return <Panel title="SerpAPI is not configured">Add SERPAPI_KEY to .env and restart the API.</Panel>;
  }

  return (
    <div className="stack">
      {data.error ? <p className="page-state error">{data.error}</p> : null}
      {data.queries.map((q) => (
        <Panel key={q.query} title={q.query} hint={q.error || `${q.results.length} results`}>
          <div className="list">
            {q.results.map((row) => (
              <article className="list-item" key={row.link}>
                <h3>
                  <a href={row.link} target="_blank" rel="noreferrer">
                    {row.title}
                  </a>
                </h3>
                <p>{row.snippet}</p>
                {row.source ? <div className="tags"><span className="tag">{row.source}</span></div> : null}
              </article>
            ))}
          </div>
        </Panel>
      ))}
    </div>
  );
}
