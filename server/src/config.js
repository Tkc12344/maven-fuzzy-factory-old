import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

function resolveDataDir() {
  const candidates = [
    process.env.DATA_DIR,
    path.resolve(__dirname, "../.."),
    path.resolve(process.cwd()),
    path.resolve(process.cwd(), ".."),
  ].filter(Boolean);

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "products.csv"))) return dir;
  }
  throw new Error("Could not find Maven Fuzzy Factory CSV files (products.csv).");
}

export function resolveClientDir() {
  const candidates = [
    process.env.CLIENT_DIR,
    path.resolve(__dirname, "../../client/dist"),
    path.resolve(process.cwd(), "../client/dist"),
  ];
  for (const dir of candidates) {
    if (dir && fs.existsSync(path.join(dir, "index.html"))) return dir;
  }
  return null;
}

function csvList(value, fallback) {
  if (!value) return fallback;
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  port: Number(process.env.PORT || 4000),
  nodeEnv: process.env.NODE_ENV || "development",
  logLevel: process.env.LOG_LEVEL || "info",
  dataDir: resolveDataDir(),
  warehouseDir: process.env.WAREHOUSE_DIR || path.resolve(__dirname, "../../warehouse"),
  get clientDir() {
    return resolveClientDir();
  },
  llmProvider: (process.env.LLM_PROVIDER || "auto").toLowerCase(),
  apiToken: process.env.API_TOKEN || "",
  corsOrigins: csvList(process.env.CORS_ORIGIN, ["http://localhost:5173", "http://localhost:4000"]),
  keys: {
    gemini: process.env.GEMINI_API_KEY || "",
    openai: process.env.OPENAI_API_KEY || "",
    mistral: process.env.MISTRAL_API_KEY || "",
    serp: process.env.SERPAPI_KEY || "",
  },
  webhooks: {
    slack: process.env.SLACK_WEBHOOK_URL || "",
    teams: process.env.TEAMS_WEBHOOK_URL || "",
    email: process.env.EMAIL_WEBHOOK_URL || "",
  },
  smtp: {
    url: process.env.SMTP_URL || "",
    to: process.env.ALERT_EMAIL_TO || "",
    from: process.env.ALERT_EMAIL_FROM || "fuzzy-factory@localhost",
  },
  cron: process.env.ALERT_CRON || "0 * * * *",
  alerts: {
    conversionGapRatio: Number(process.env.ALERT_CONVERSION_GAP || 0.7),
    funnelDropPct: Number(process.env.ALERT_FUNNEL_DROP || 40),
    refundRatePct: Number(process.env.ALERT_REFUND_RATE || 4),
    skuRefundRatePct: Number(process.env.ALERT_SKU_REFUND_RATE || 6),
    forecastSoftRatio: Number(process.env.ALERT_FORECAST_SOFT || 0.92),
    cooldownHours: Number(process.env.ALERT_COOLDOWN_HOURS || 24),
    anomalyThreshold: Number(process.env.ANOMALY_MAD_THRESHOLD || 3.5),
  },
  forecastUntil: process.env.FORECAST_UNTIL || "2030-12",
};
