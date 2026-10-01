import cron from "node-cron";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";

export function startScheduler(automationEngine) {
  if (!cron.validate(config.cron)) {
    logger.warn({ cron: config.cron }, "invalid ALERT_CRON, scheduler disabled");
    return { stop() {} };
  }

  const task = cron.schedule(config.cron, async () => {
    try {
      if (!automationEngine) return;
      await automationEngine.evaluate({ deliver: true });
    } catch (error) {
      logger.error({ err: error }, "scheduled automation failed");
    }
  });

  logger.info({ cron: config.cron }, "automation scheduler started");
  return task;
}
