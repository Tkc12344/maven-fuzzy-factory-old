export function Page({ title, lead, actions, children }) {
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{title}</h1>
          {lead ? <p>{lead}</p> : null}
        </div>
        {actions ? <div className="toolbar">{actions}</div> : null}
      </header>
      {children}
    </div>
  );
}

export function Panel({ title, hint, children, className = "" }) {
  return (
    <section className={`panel ${className}`}>
      {title ? <h2>{title}</h2> : null}
      {hint ? <p className="hint">{hint}</p> : null}
      {children}
    </section>
  );
}

export function Kpi({ label, value, note, tone }) {
  return (
    <article className="kpi">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {note ? <div className={`delta ${tone || ""}`}>{note}</div> : null}
    </article>
  );
}

export function PageState({ error, loading, label, children }) {
  if (error) return <div className="page-state error">{error}</div>;
  if (loading || !children) return <div className="page-state">{label || "Loading…"}</div>;
  return children;
}

export function Badge({ children, tone = "" }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function trendNote(value, suffix = "%") {
  if (value == null) return { text: "", tone: "" };
  const sign = value >= 0 ? "+" : "";
  return {
    text: `${sign}${value}${suffix} vs prior year`,
    tone: value >= 0 ? "up" : "down",
  };
}
