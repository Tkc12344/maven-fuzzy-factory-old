import { config } from "../config.js";
import { fetchWithPolicy } from "../lib/httpClient.js";
import { logger } from "../lib/logger.js";

async function postJson(url, body) {
  const res = await fetchWithPolicy(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    { timeoutMs: 8_000, retries: 1 }
  );
  if (!res.ok) throw new Error(`webhook ${res.status}`);
}

export async function deliverAlert(alert) {
  const channels = [];
  const text = `[${alert.severity}] ${alert.title}\n${alert.detail}`;
  const { slack, teams, email } = config.webhooks;

  if (slack) {
    try {
      await postJson(slack, { text });
      channels.push("slack");
    } catch (error) {
      logger.warn({ err: error, channel: "slack" }, "alert delivery failed");
    }
  }

  if (teams) {
    try {
      await postJson(teams, {
        "@type": "MessageCard",
        "@context": "http://schema.org/extensions",
        summary: alert.title,
        themeColor: alert.severity === "critical" || alert.severity === "high" ? "DC2626" : "D97706",
        title: alert.title,
        text: alert.detail,
      });
      channels.push("teams");
    } catch (error) {
      logger.warn({ err: error, channel: "teams" }, "alert delivery failed");
    }
  }

  if (email) {
    try {
      await postJson(email, {
        to: config.smtp.to,
        from: config.smtp.from,
        subject: `Fuzzy Factory · ${alert.severity} · ${alert.title}`,
        text,
      });
      channels.push("email");
    } catch (error) {
      logger.warn({ err: error, channel: "email" }, "alert delivery failed");
    }
  }

  if (config.smtp.url && config.smtp.to) {
    try {
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.default.createTransport(config.smtp.url);
      await transport.sendMail({
        to: config.smtp.to,
        from: config.smtp.from,
        subject: `Fuzzy Factory · ${alert.severity} · ${alert.title}`,
        text,
      });
      channels.push("smtp");
    } catch (error) {
      logger.warn({ err: error, channel: "smtp" }, "alert delivery failed");
    }
  }

  if (!channels.length) {
    logger.info({ id: alert.id, title: alert.title }, "alert evaluated with no delivery channels");
  }
  return channels;
}
