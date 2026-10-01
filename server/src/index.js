import { config } from "./config.js";
import { createApp, createEngines } from "./app.js";
import { startScheduler } from "./jobs/scheduler.js";
import { logger } from "./lib/logger.js";

const engines = createEngines();
const app = createApp(engines);

const server = app.listen(config.port, () => {
  logger.info({ port: config.port, dataDir: config.dataDir, warehouseDir: config.warehouseDir }, "api listening");
  if (config.clientDir) logger.info({ clientDir: config.clientDir }, "serving dashboard");
  engines.dataEngine
    .run()
    .then((warehouse) => {
      logger.info(
        {
          ms: warehouse.meta.builtInMs,
          range: warehouse.meta.range,
          dataVersion: warehouse.meta.dataVersion,
          orders: warehouse.kpis.orders,
        },
        "warehouse ready"
      );
      return engines.automationEngine.evaluate({ deliver: false });
    })
    .then(() => {
      startScheduler(engines.automationEngine);
    })
    .catch((error) => {
      logger.error({ err: error }, "warehouse failed");
    });
});

export { app, server, engines };
