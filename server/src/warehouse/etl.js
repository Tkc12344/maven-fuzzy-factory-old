import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { closeDatabase, openDatabase, sqlExec, sqlRun } from "./db.js";

export const TABLES = [
  { csv: "products.csv", parquet: "products.parquet", view: "products" },
  { csv: "orders.csv", parquet: "orders.parquet", view: "orders" },
  { csv: "order_items.csv", parquet: "order_items.parquet", view: "order_items" },
  { csv: "order_item_refunds.csv", parquet: "refunds.parquet", view: "refunds" },
  { csv: "website_sessions.csv", parquet: "sessions.parquet", view: "sessions" },
  { csv: "website_pageviews.csv", parquet: "pageviews.parquet", view: "pageviews" },
];

function csvFingerprint(dataDir) {
  const files = {};
  for (const table of TABLES) {
    const filePath = path.join(dataDir, table.csv);
    const stat = fs.statSync(filePath);
    files[table.csv] = { size: stat.size, mtimeMs: stat.mtimeMs };
  }
  const hash = crypto.createHash("sha1").update(JSON.stringify(files)).digest("hex").slice(0, 16);
  return { files, hash };
}

function manifestPath(warehouseDir) {
  return path.join(warehouseDir, "manifest.json");
}

export function readManifest(warehouseDir = config.warehouseDir) {
  const file = manifestPath(warehouseDir);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function parquetReady(dataDir = config.dataDir, warehouseDir = config.warehouseDir) {
  const current = csvFingerprint(dataDir);
  const manifest = readManifest(warehouseDir);
  if (!manifest || manifest.hash !== current.hash) return false;
  return TABLES.every((table) => fs.existsSync(path.join(warehouseDir, table.parquet)));
}

function quotePath(filePath) {
  return filePath.replaceAll("'", "''");
}

export async function runEtl({ dataDir = config.dataDir, warehouseDir = config.warehouseDir, force = false } = {}) {
  fs.mkdirSync(warehouseDir, { recursive: true });
  const fingerprint = csvFingerprint(dataDir);
  if (!force && parquetReady(dataDir, warehouseDir)) {
    logger.info({ hash: fingerprint.hash }, "warehouse parquet is current");
    return { skipped: true, hash: fingerprint.hash, warehouseDir };
  }

  const started = Date.now();
  const { db, conn } = await openDatabase(":memory:");
  try {
    for (const table of TABLES) {
      const csvPath = quotePath(path.join(dataDir, table.csv));
      const parquetPath = quotePath(path.join(warehouseDir, table.parquet));
      logger.info({ table: table.view }, "converting csv to parquet");
      await sqlRun(
        conn,
        `COPY (
           SELECT * FROM read_csv_auto('${csvPath}', HEADER=true, SAMPLE_SIZE=-1)
         ) TO '${parquetPath}' (FORMAT PARQUET, COMPRESSION ZSTD)`
      );
    }
  } finally {
    closeDatabase({ db, conn });
  }

  const manifest = {
    version: 1,
    hash: fingerprint.hash,
    files: fingerprint.files,
    builtAt: new Date().toISOString(),
    builtInMs: Date.now() - started,
  };
  fs.writeFileSync(manifestPath(warehouseDir), JSON.stringify(manifest, null, 2));
  logger.info({ hash: fingerprint.hash, ms: manifest.builtInMs }, "etl complete");
  return { skipped: false, ...manifest, warehouseDir };
}

export async function registerViews(conn, warehouseDir = config.warehouseDir) {
  const statements = TABLES.map((table) => {
    const parquetPath = quotePath(path.join(warehouseDir, table.parquet));
    return `CREATE OR REPLACE VIEW ${table.view} AS SELECT * FROM read_parquet('${parquetPath}')`;
  });
  await sqlExec(conn, statements);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runEtl()
    .then((result) => {
      logger.info(result, "etl cli done");
    })
    .catch((error) => {
      logger.error({ err: error }, "etl failed");
      process.exit(1);
    });
}
