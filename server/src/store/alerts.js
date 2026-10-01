import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

function storePath() {
  return path.join(config.warehouseDir, "alerts.json");
}

function readAll() {
  const file = storePath();
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}

function writeAll(rows) {
  fs.mkdirSync(config.warehouseDir, { recursive: true });
  const tmp = `${storePath()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2));
  fs.renameSync(tmp, storePath());
}

export function createAlertStore() {
  return {
    async list() {
      return readAll().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    },
    async get(id) {
      return readAll().find((row) => row.id === id) || null;
    },
    async upsert(alert) {
      const rows = readAll();
      const now = new Date().toISOString();
      const index = rows.findIndex((row) => row.id === alert.id);
      if (index === -1) {
        const created = {
          ...alert,
          fingerprint: alert.id,
          status: "fired",
          createdAt: now,
          updatedAt: now,
          lastFiredAt: now,
          acknowledgedAt: null,
          resolvedAt: null,
          source: "automation",
        };
        rows.push(created);
        writeAll(rows);
        return { ...created, isNew: true };
      }
      const existing = rows[index];
      if (existing.status === "resolved") {
        return { ...existing, isNew: false, skipped: true };
      }
      const next = {
        ...existing,
        ...alert,
        updatedAt: now,
      };
      rows[index] = next;
      writeAll(rows);
      return { ...next, isNew: false };
    },
    async markFired(id) {
      const rows = readAll();
      const now = new Date().toISOString();
      const index = rows.findIndex((row) => row.id === id);
      if (index === -1) return;
      rows[index] = { ...rows[index], lastFiredAt: now, updatedAt: now };
      writeAll(rows);
    },
    async setStatus(id, status) {
      const rows = readAll();
      const index = rows.findIndex((row) => row.id === id);
      if (index === -1) {
        const err = new Error("Alert not found");
        err.status = 404;
        throw err;
      }
      const now = new Date().toISOString();
      const existing = rows[index];
      rows[index] = {
        ...existing,
        status,
        updatedAt: now,
        acknowledgedAt: status === "acknowledged" ? now : existing.acknowledgedAt,
        resolvedAt: status === "resolved" ? now : existing.resolvedAt,
      };
      writeAll(rows);
      return rows[index];
    },
  };
}
