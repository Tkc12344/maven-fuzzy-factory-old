import { useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { getJson } from "./api.js";
import Layout from "./components/Layout.jsx";
import Overview from "./pages/Overview.jsx";
import Charts from "./pages/Charts.jsx";
import Forecasts from "./pages/Forecasts.jsx";
import Anomalies from "./pages/Anomalies.jsx";
import Insights from "./pages/Insights.jsx";
import Research from "./pages/Research.jsx";
import Alerts from "./pages/Alerts.jsx";

export default function App() {
  const [health, setHealth] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let timer;
    const poll = async () => {
      try {
        const data = await getJson("/api/v1/health");
        setHealth(data);
        setError("");
        if (!data.engines?.data?.ready && !data.engines?.data?.error) {
          timer = setTimeout(poll, 800);
        }
      } catch (err) {
        setError(err.message);
        timer = setTimeout(poll, 1200);
      }
    };
    poll();
    return () => clearTimeout(timer);
  }, []);

  if (error && !health) {
    return (
      <div className="center-state">
        <div>
          <h1>API is not reachable</h1>
          <p>Start the Node server on port 4000, then refresh. {error}</p>
        </div>
      </div>
    );
  }

  if (!health?.engines?.data?.ready) {
    const stage = health?.engines?.data?.stage || "starting";
    return (
      <div className="center-state">
        <div>
          <h1>Building the warehouse</h1>
          <p>
            DuckDB is converting CSVs to Parquet and running KPI queries
            {stage !== "starting" ? ` · ${stage}` : ""}.
          </p>
        </div>
      </div>
    );
  }

  return (
    <Layout health={health}>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/charts" element={<Charts />} />
        <Route path="/forecasts" element={<Forecasts />} />
        <Route path="/anomalies" element={<Anomalies />} />
        <Route path="/insights" element={<Insights />} />
        <Route path="/research" element={<Research />} />
        <Route path="/alerts" element={<Alerts />} />
      </Routes>
    </Layout>
  );
}
