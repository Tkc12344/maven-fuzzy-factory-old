import { pct, round } from "../lib/stats.js";

/**
 * Single source of KPI formulas. Dashboard, AI, and automation all go through
 * `enrich()` so conversion, AOV, margin, and refund rate cannot drift.
 */
export const KPI = {
  profit: {
    id: "profit",
    label: "Gross profit after refunds",
    unit: "usd",
    compute: ({ revenue = 0, cogs = 0, refundAmount = 0 }) => revenue - cogs - refundAmount,
  },
  conversion: {
    id: "conversion",
    label: "Conversion rate",
    unit: "percent",
    compute: ({ orders = 0, sessions = 0 }) => pct(orders, sessions),
  },
  aov: {
    id: "aov",
    label: "Average order value",
    unit: "usd",
    compute: ({ revenue = 0, orders = 0 }) => (orders ? revenue / orders : 0),
  },
  grossMargin: {
    id: "margin",
    label: "Gross margin after refunds",
    unit: "percent",
    compute: ({ profit = 0, revenue = 0 }) => pct(profit, revenue),
  },
  refundRate: {
    id: "refundRate",
    label: "Refund rate",
    unit: "percent",
    compute: ({ refunds = 0, orders = 0 }) => pct(refunds, orders),
  },
  repeatRate: {
    id: "repeatRate",
    label: "Repeat session rate",
    unit: "percent",
    compute: ({ repeatSessions = 0, sessions = 0 }) => pct(repeatSessions, sessions),
  },
  attachRate: {
    id: "attachRate",
    label: "Multi-item order rate",
    unit: "percent",
    compute: ({ multiItemOrders = 0, orders = 0 }) => pct(multiItemOrders, orders),
  },
};

const COUNT_FIELDS = [
  "sessions",
  "orders",
  "items",
  "refunds",
  "repeatSessions",
  "multiItemOrders",
  "users",
  "units",
  "primaryOrders",
];

export function emptyFacts() {
  return {
    revenue: 0,
    cogs: 0,
    refundAmount: 0,
    sessions: 0,
    orders: 0,
    items: 0,
    refunds: 0,
    repeatSessions: 0,
    multiItemOrders: 0,
    users: 0,
    units: 0,
    primaryOrders: 0,
  };
}

export function addFacts(target, row = {}) {
  const next = { ...target };
  next.revenue += Number(row.revenue || 0);
  next.cogs += Number(row.cogs || 0);
  next.refundAmount += Number(row.refundAmount || 0);
  for (const field of COUNT_FIELDS) {
    if (row[field] != null) next[field] += Number(row[field] || 0);
  }
  return next;
}

export function enrich(row, extra = {}) {
  const facts = {
    revenue: Number(row.revenue || 0),
    cogs: Number(row.cogs || 0),
    refundAmount: Number(row.refundAmount || 0),
    sessions: Number(row.sessions || 0),
    orders: Number(row.orders || 0),
    items: Number(row.items || 0),
    refunds: Number(row.refunds || 0),
    repeatSessions: Number(row.repeatSessions || 0),
    multiItemOrders: Number(row.multiItemOrders || 0),
    users: Number(row.users || 0),
    units: Number(row.units || 0),
    primaryOrders: Number(row.primaryOrders || 0),
  };
  const profit = KPI.profit.compute(facts);
  const computed = {
    ...facts,
    profit,
    conversion: KPI.conversion.compute({ ...facts, profit }),
    aov: KPI.aov.compute(facts),
    margin: KPI.grossMargin.compute({ ...facts, profit }),
    refundRate: KPI.refundRate.compute(facts),
    repeatRate: KPI.repeatRate.compute(facts),
    attachRate: KPI.attachRate.compute(facts),
  };

  return {
    ...extra,
    ...computed,
    revenue: round(computed.revenue),
    cogs: round(computed.cogs),
    refundAmount: round(computed.refundAmount),
    profit: round(computed.profit),
    conversion: round(computed.conversion, 2),
    aov: round(computed.aov),
    margin: round(computed.margin, 2),
    refundRate: round(computed.refundRate, 2),
    repeatRate: round(computed.repeatRate, 2),
    attachRate: round(computed.attachRate, 2),
  };
}

export function trendDelta(latest, previous, field) {
  const a = Number(latest || 0);
  const b = Number(previous || 0);
  if (field === "conversion" || field === "margin") return round(a - b, 2);
  return round(pct(a - b, b || 1), 1);
}
