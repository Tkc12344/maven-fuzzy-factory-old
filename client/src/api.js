const TOKEN = import.meta.env.VITE_API_TOKEN || "";

function headers(extra = {}) {
  const next = { ...extra };
  if (TOKEN) next["x-api-key"] = TOKEN;
  return next;
}

export async function getJson(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    headers: headers(body ? { "Content-Type": "application/json" } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 304) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export async function postJson(path, body = {}) {
  return getJson(path, { method: "POST", body });
}

export const money = (value, digits = 0) =>
  Number(value || 0).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
  });

export const compactMoney = (value) => {
  const n = Number(value || 0);
  const abs = Math.abs(n);
  if (abs >= 1_000_000) {
    const m = n / 1_000_000;
    return `$${m.toFixed(abs >= 10_000_000 ? 1 : 2)}M`;
  }
  if (abs >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return money(n);
};

export const num = (value) => Number(value || 0).toLocaleString();
export const pct = (value, digits = 2) => `${Number(value || 0).toFixed(digits)}%`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatPeriod(period) {
  if (!period || !String(period).includes("-")) return period;
  const [year, month] = String(period).split("-");
  return `${MONTHS[Number(month) - 1]} ${year}`;
}

export function withoutPartialMonth(rows, valueKey = "sessions") {
  if (!rows?.length || rows.length < 2) return rows || [];
  const last = rows.at(-1);
  const prev = rows.at(-2);
  const lastValue = last[valueKey] ?? last.actual ?? last.revenue ?? 0;
  const prevValue = prev[valueKey] ?? prev.actual ?? prev.revenue ?? 0;
  if (last.period === "2015-03" || lastValue < prevValue * 0.7) {
    return rows.slice(0, -1);
  }
  return rows;
}

export const CHANNEL_NAMES = {
  gsearch: "Google Search",
  bsearch: "Bing Search",
  direct: "Direct",
  socialbook: "Social",
};

export const CHART = {
  accent: "#2563EB",
  accentFill: "#DBEAFE",
  context: "#94A3B8",
  ink: "#0F172A",
  grid: "#E2E8F0",
  muted: "#64748B",
  up: "#16A34A",
  down: "#DC2626",
  warn: "#D97706",
};

export const SERIES = ["#2563EB", "#14B8A6", "#F59E0B", "#8B5CF6"];

export const PRODUCT_COLORS = {
  "The Original Mr. Fuzzy": SERIES[0],
  "The Forever Love Bear": SERIES[1],
  "The Birthday Sugar Panda": SERIES[2],
  "The Hudson River Mini bear": SERIES[3],
};

export const axisTick = { fill: "#64748B", fontSize: 11 };

export function tooltipStyle() {
  return {
    background: "#FFFFFF",
    border: "1px solid #E2E8F0",
    borderRadius: 4,
    color: "#0F172A",
    fontSize: 12,
  };
}
