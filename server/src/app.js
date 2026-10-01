import path from "node:path";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { config, resolveClientDir } from "./config.js";
import { createAiEngine } from "./engines/aiEngine.js";
import { createAutomationEngine } from "./engines/automationEngine.js";
import { createSerpEngine } from "./engines/serpEngine.js";
import { logger } from "./lib/logger.js";
import { observeHttp, registry } from "./lib/prometheus.js";
import { apiAuth, errorHandler, requestId } from "./middleware/http.js";
import { createApiRouter } from "./routes/v1.js";
import { createDataEngine } from "./warehouse/dataEngine.js";

export function createEngines() {
  const dataEngine = createDataEngine();
  const serpEngine = createSerpEngine();
  const aiEngine = createAiEngine(dataEngine, serpEngine);
  const automationEngine = createAutomationEngine(dataEngine);
  return { dataEngine, serpEngine, aiEngine, automationEngine };
}

export function createApp(engines) {
  const app = express();
  app.disable("x-powered-by");
  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      autoLogging: { ignore: (req) => req.path === "/metrics" || req.path.endsWith("/health") },
    })
  );
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => observeHttp(req, res, start));
    next();
  });
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );
  app.use(
    cors({
      origin: config.corsOrigins.includes("*") ? true : config.corsOrigins,
      credentials: false,
    })
  );
  app.use(express.json({ limit: "64kb" }));
  app.use(
    rateLimit({
      windowMs: 60_000,
      max: 180,
      standardHeaders: true,
      skip: (req) => req.path.endsWith("/health") || req.path.endsWith("/ready") || req.path === "/metrics",
    })
  );
  app.use(apiAuth);

  const llmLimit = rateLimit({ windowMs: 60_000, max: 12, standardHeaders: true });
  app.use("/api/v1/insights", llmLimit);
  app.use("/api/insights", llmLimit);
  app.use("/api/v1/research", llmLimit);
  app.use("/api/research", llmLimit);

  const api = createApiRouter(engines);
  app.use("/api/v1", api);
  app.use("/api", api);

  app.get("/metrics", async (_req, res) => {
    res.setHeader("Content-Type", registry.contentType);
    res.send(await registry.metrics());
  });

  app.use((req, res, next) => {
    if (req.path.startsWith("/api") || req.path === "/metrics") return next();
    const clientDir = resolveClientDir();
    if (!clientDir) {
      if (req.method !== "GET") return next();
      res.status(200).type("html").send(`<!doctype html>
<html><head><meta charset="utf-8"><title>Fuzzy Factory</title>
<style>body{font-family:Inter,sans-serif;background:#F8FAFC;color:#0F172A;padding:48px;max-width:640px}</style>
</head><body>
<h1>Dashboard is not built on this process</h1>
<p>The API is running. Open the live dashboard at <a href="http://localhost:5173">http://localhost:5173</a>, or run <code>npm run build</code> and refresh this page.</p>
<p>Health: <a href="/api/v1/health">/api/v1/health</a></p>
</body></html>`);
      return;
    }
    express.static(clientDir)(req, res, () => {
      if (req.method !== "GET") return next();
      res.sendFile(path.join(clientDir, "index.html"));
    });
  });

  app.use(errorHandler);
  return app;
}
