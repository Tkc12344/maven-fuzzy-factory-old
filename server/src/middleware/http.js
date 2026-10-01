import crypto from "node:crypto";
import { config } from "../config.js";

const PUBLIC = new Set(["/api/health", "/api/ready", "/api/v1/health", "/api/v1/ready"]);

export function requestId(req, res, next) {
  req.id = req.headers["x-request-id"] || crypto.randomUUID();
  res.setHeader("x-request-id", req.id);
  next();
}

export function apiAuth(req, res, next) {
  if (!config.apiToken) return next();
  if (PUBLIC.has(req.path)) return next();
  if (!req.path.startsWith("/api")) return next();
  const header = req.headers.authorization || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const token = bearer || req.headers["x-api-key"] || "";
  if (token !== config.apiToken) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

export function sendJson(req, res, body, { maxAge = 60 } = {}) {
  const json = JSON.stringify(body);
  const etag = `"${crypto.createHash("sha1").update(json).digest("hex")}"`;
  res.setHeader("ETag", etag);
  res.setHeader("Cache-Control", `private, max-age=${maxAge}`);
  if (req.headers["if-none-match"] === etag) {
    res.status(304).end();
    return;
  }
  res.type("json").send(json);
}

export function wrap(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

export function errorHandler(err, req, res, _next) {
  const status = err.status || (err.name === "ZodError" ? 400 : 500);
  if (status >= 500) req.log?.error({ err }, "request failed");
  res.status(status).json({
    error: err.name === "ZodError" ? "Invalid request" : err.message,
    requestId: req.id,
    issues: err.name === "ZodError" ? err.issues : undefined,
  });
}
