import { Router } from "express";
import { registry } from "../lib/prometheus.js";
import { alertIdParam, refreshQuery } from "../schemas/api.js";
import { sendJson, wrap } from "../middleware/http.js";

export function createApiRouter({ dataEngine, aiEngine, serpEngine, automationEngine }) {
  const r = Router();

  r.get("/health", (_req, res) => {
    res.json({
      ok: !dataEngine.status.error,
      ready: Boolean(dataEngine.status.ready),
      engines: {
        data: dataEngine.status,
        ai: "ready",
        serp: serpEngine.enabled ? "ready" : "disabled",
        automation: dataEngine.status.ready ? "ready" : "waiting-on-data",
      },
    });
  });

  r.get("/ready", (_req, res) => {
    if (!dataEngine.status.ready) {
      res.status(503).json({ ok: false, ready: false, stage: dataEngine.status.stage });
      return;
    }
    res.json({ ok: true, ready: true });
  });

  r.get("/metrics", wrap(async (_req, res) => {
    res.setHeader("Content-Type", registry.contentType);
    res.send(await registry.metrics());
  }));

  r.get(
    "/meta",
    wrap(async (req, res) => {
      sendJson(req, res, dataEngine.requireWarehouse().meta, { maxAge: 120 });
    })
  );

  r.get(
    "/kpis",
    wrap(async (req, res) => {
      const { kpis, trend, meta } = dataEngine.requireWarehouse();
      sendJson(req, res, { meta, kpis, trend }, { maxAge: 120 });
    })
  );

  r.get(
    "/analysis",
    wrap(async (req, res) => {
      const w = dataEngine.requireWarehouse();
      sendJson(
        req,
        res,
        {
          meta: w.meta,
          kpis: w.kpis,
          trend: w.trend,
          monthly: w.monthly,
          products: w.products,
          productMonthly: w.productMonthly,
          channels: w.channels,
          campaigns: w.campaigns,
          devices: w.devices,
          landings: w.landings,
          funnel: w.funnel,
        },
        { maxAge: 120 }
      );
    })
  );

  r.get(
    "/forecasts",
    wrap(async (req, res) => {
      sendJson(req, res, dataEngine.requireWarehouse().forecasts, { maxAge: 120 });
    })
  );

  r.get(
    "/anomalies",
    wrap(async (req, res) => {
      sendJson(req, res, dataEngine.requireWarehouse().anomalies, { maxAge: 120 });
    })
  );

  r.get(
    "/insights",
    wrap(async (req, res) => {
      const { refresh } = refreshQuery.parse(req.query);
      res.setHeader("Cache-Control", "no-store");
      res.json(await aiEngine.insights(refresh === "1"));
    })
  );

  r.get(
    "/research",
    wrap(async (req, res) => {
      const { refresh } = refreshQuery.parse(req.query);
      const version = dataEngine.warehouse?.meta?.dataVersion || "na";
      res.setHeader("Cache-Control", "no-store");
      res.json(await serpEngine.research(refresh === "1", version));
    })
  );

  r.get(
    "/alerts",
    wrap(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await automationEngine.getAlerts());
    })
  );

  r.post(
    "/alerts/:id/ack",
    wrap(async (req, res) => {
      const { id } = alertIdParam.parse(req.params);
      res.json(await automationEngine.ack(id));
    })
  );

  r.post(
    "/alerts/:id/resolve",
    wrap(async (req, res) => {
      const { id } = alertIdParam.parse(req.params);
      res.json(await automationEngine.resolve(id));
    })
  );

  r.get(
    "/report",
    wrap(async (req, res) => {
      sendJson(req, res, await automationEngine.getReport(), { maxAge: 30 });
    })
  );

  r.get(
    "/dashboard",
    wrap(async (req, res) => {
      const w = dataEngine.requireWarehouse();
      const alerts = (await automationEngine.getAlerts()).filter((a) => a.status !== "resolved").slice(0, 6);
      sendJson(
        req,
        res,
        {
          meta: w.meta,
          kpis: w.kpis,
          trend: w.trend,
          monthly: w.monthly,
          products: w.products,
          channels: w.channels,
          devices: w.devices,
          funnel: w.funnel,
          forecasts: w.forecasts.revenue,
          anomalies: w.anomalies.slice(0, 6),
          alerts,
        },
        { maxAge: 60 }
      );
    })
  );

  return r;
}
