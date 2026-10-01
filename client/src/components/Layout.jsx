import { NavLink } from "react-router-dom";
import { formatPeriod, num } from "../api.js";

const groups = [
  {
    label: "Data engine",
    links: [
      ["/", "Overview"],
      ["/charts", "Charts"],
      ["/forecasts", "Forecasts"],
      ["/anomalies", "Anomalies"],
    ],
  },
  {
    label: "Intelligence",
    links: [
      ["/insights", "AI insights"],
      ["/research", "Market search"],
      ["/alerts", "Alerts / reports"],
    ],
  },
];

export default function Layout({ health, children }) {
  const meta = health?.engines?.data?.meta;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">Fuzzy Factory</div>
          <div className="brand-sub">Intelligence</div>
        </div>

        {groups.map((group) => (
          <div className="nav-group" key={group.label}>
            <div className="nav-label">{group.label}</div>
            <nav className="nav">
              {group.links.map(([to, label]) => (
                <NavLink key={to} to={to} end={to === "/"}>
                  {label}
                </NavLink>
              ))}
            </nav>
          </div>
        ))}

        <div className="sidebar-meta">
          {formatPeriod(meta?.range?.start)} → {formatPeriod(meta?.range?.end)}
          <br />
          {num(meta?.tables?.orders)} orders
          <br />
          {num(meta?.tables?.sessions)} sessions
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
