import { DuckDBInstance } from "@duckdb/node-api";
import { logger } from "../lib/logger.js";

function toJs(value) {
  if (typeof value === "bigint") return Number(value);
  if (value && typeof value === "object") {
    if (typeof value.toString === "function" && value.constructor?.name?.startsWith("DuckDB")) {
      return value.toString();
    }
  }
  return value;
}

function mapRow(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = toJs(value);
  }
  return out;
}

export async function openDatabase(filePath) {
  const instance = filePath === ":memory:" ? await DuckDBInstance.create() : await DuckDBInstance.create(filePath);
  const conn = await instance.connect();
  return { db: instance, conn };
}

export async function sqlAll(conn, query, params = []) {
  const reader = params.length ? await conn.runAndReadAll(query, params) : await conn.runAndReadAll(query);
  const rows = reader.getRowObjectsJS();
  return rows.map(mapRow);
}

export async function sqlRun(conn, query, params = []) {
  if (params.length) await conn.run(query, params);
  else await conn.run(query);
}

export async function sqlExec(conn, statements) {
  for (const statement of statements) {
    await sqlRun(conn, statement);
  }
}

export async function closeDatabase({ db, conn }) {
  try {
    await conn?.closeSync?.();
  } catch (error) {
    logger.warn({ err: error }, "duckdb connection close");
  }
  try {
    await db?.closeSync?.();
  } catch (error) {
    logger.warn({ err: error }, "duckdb instance close");
  }
}
