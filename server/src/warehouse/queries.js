import { sqlAll } from "./db.js";

const PERIOD = `strftime(CAST(created_at AS TIMESTAMP), '%Y-%m')`;

export async function loadWarehouseTables(conn) {
  const [
    monthly,
    products,
    productMonthly,
    channels,
    campaigns,
    devices,
    landings,
    funnelRow,
    usersRow,
    maxTsRow,
    primaryOrders,
  ] = await Promise.all([
    sqlAll(
      conn,
      `
      WITH monthly_orders AS (
        SELECT ${PERIOD} AS period,
               COUNT(*) AS orders,
               SUM(items_purchased) AS items,
               SUM(price_usd) AS revenue,
               SUM(cogs_usd) AS cogs,
               SUM(CASE WHEN items_purchased > 1 THEN 1 ELSE 0 END) AS multi_item_orders
        FROM orders
        GROUP BY 1
      ),
      monthly_sessions AS (
        SELECT ${PERIOD} AS period,
               COUNT(*) AS sessions,
               SUM(CASE WHEN CAST(is_repeat_session AS INTEGER) = 1 THEN 1 ELSE 0 END) AS repeat_sessions
        FROM sessions
        GROUP BY 1
      ),
      monthly_refunds AS (
        SELECT ${PERIOD} AS period,
               COUNT(*) AS refunds,
               SUM(refund_amount_usd) AS refund_amount
        FROM refunds
        GROUP BY 1
      ),
      periods AS (
        SELECT period FROM monthly_orders
        UNION
        SELECT period FROM monthly_sessions
        UNION
        SELECT period FROM monthly_refunds
      )
      SELECT p.period AS period,
             COALESCE(o.orders, 0) AS orders,
             COALESCE(o.items, 0) AS items,
             COALESCE(o.revenue, 0) AS revenue,
             COALESCE(o.cogs, 0) AS cogs,
             COALESCE(o.multi_item_orders, 0) AS multiItemOrders,
             COALESCE(s.sessions, 0) AS sessions,
             COALESCE(s.repeat_sessions, 0) AS repeatSessions,
             COALESCE(r.refunds, 0) AS refunds,
             COALESCE(r.refund_amount, 0) AS refundAmount
      FROM periods p
      LEFT JOIN monthly_orders o ON o.period = p.period
      LEFT JOIN monthly_sessions s ON s.period = p.period
      LEFT JOIN monthly_refunds r ON r.period = p.period
      ORDER BY 1
    `
    ),
    sqlAll(
      conn,
      `
      WITH item_stats AS (
        SELECT product_id,
               COUNT(*) AS units,
               SUM(price_usd) AS revenue,
               SUM(cogs_usd) AS cogs
        FROM order_items
        GROUP BY 1
      ),
      refund_stats AS (
        SELECT oi.product_id,
               COUNT(*) AS refunds,
               SUM(r.refund_amount_usd) AS refund_amount
        FROM refunds r
        JOIN order_items oi ON oi.order_item_id = r.order_item_id
        GROUP BY 1
      ),
      primary_stats AS (
        SELECT primary_product_id AS product_id, COUNT(*) AS primary_orders
        FROM orders
        GROUP BY 1
      )
      SELECT p.product_id AS productId,
             p.product_name AS name,
             strftime(CAST(p.created_at AS TIMESTAMP), '%Y-%m-%d') AS launched,
             COALESCE(i.units, 0) AS units,
             COALESCE(i.revenue, 0) AS revenue,
             COALESCE(i.cogs, 0) AS cogs,
             COALESCE(rf.refunds, 0) AS refunds,
             COALESCE(rf.refund_amount, 0) AS refundAmount,
             COALESCE(pr.primary_orders, 0) AS primaryOrders
      FROM products p
      LEFT JOIN item_stats i ON i.product_id = p.product_id
      LEFT JOIN refund_stats rf ON rf.product_id = p.product_id
      LEFT JOIN primary_stats pr ON pr.product_id = p.product_id
      ORDER BY revenue DESC
    `
    ),
    sqlAll(
      conn,
      `
      SELECT ${PERIOD} AS period,
             product_id AS productId,
             SUM(price_usd) AS revenue,
             COUNT(*) AS units
      FROM order_items
      GROUP BY 1, 2
      ORDER BY 1, 2
    `
    ),
    sqlAll(
      conn,
      `
      SELECT COALESCE(NULLIF(s.utm_source, ''), 'direct') AS source,
             COUNT(*) AS sessions,
             SUM(CASE WHEN CAST(s.is_repeat_session AS INTEGER) = 1 THEN 1 ELSE 0 END) AS repeatSessions,
             COUNT(o.order_id) AS orders,
             COALESCE(SUM(o.price_usd), 0) AS revenue,
             COALESCE(SUM(o.cogs_usd), 0) AS cogs,
             COALESCE(SUM(o.items_purchased), 0) AS items
      FROM sessions s
      LEFT JOIN orders o ON o.website_session_id = s.website_session_id
      GROUP BY 1
      ORDER BY sessions DESC
    `
    ),
    sqlAll(
      conn,
      `
      SELECT CONCAT(COALESCE(NULLIF(s.utm_source, ''), 'direct'), ' / ', COALESCE(NULLIF(s.utm_campaign, ''), 'none')) AS campaign,
             COUNT(*) AS sessions,
             COUNT(o.order_id) AS orders,
             COALESCE(SUM(o.price_usd), 0) AS revenue,
             COALESCE(SUM(o.cogs_usd), 0) AS cogs,
             COALESCE(SUM(o.items_purchased), 0) AS items
      FROM sessions s
      LEFT JOIN orders o ON o.website_session_id = s.website_session_id
      GROUP BY 1
      ORDER BY sessions DESC
    `
    ),
    sqlAll(
      conn,
      `
      SELECT COALESCE(NULLIF(s.device_type, ''), 'unknown') AS device,
             COUNT(*) AS sessions,
             SUM(CASE WHEN CAST(s.is_repeat_session AS INTEGER) = 1 THEN 1 ELSE 0 END) AS repeatSessions,
             COUNT(o.order_id) AS orders,
             COALESCE(SUM(o.price_usd), 0) AS revenue,
             COALESCE(SUM(o.cogs_usd), 0) AS cogs,
             COALESCE(SUM(o.items_purchased), 0) AS items
      FROM sessions s
      LEFT JOIN orders o ON o.website_session_id = s.website_session_id
      GROUP BY 1
      ORDER BY sessions DESC
    `
    ),
    sqlAll(
      conn,
      `
      WITH first_hit AS (
        SELECT website_session_id,
               pageview_url AS url,
               ROW_NUMBER() OVER (PARTITION BY website_session_id ORDER BY created_at, website_pageview_id) AS rn
        FROM pageviews
      )
      SELECT f.url,
             COUNT(*) AS sessions,
             COUNT(o.order_id) AS orders,
             COALESCE(SUM(o.price_usd), 0) AS revenue
      FROM first_hit f
      LEFT JOIN orders o ON o.website_session_id = f.website_session_id
      WHERE f.rn = 1
      GROUP BY 1
      ORDER BY sessions DESC
    `
    ),
    sqlAll(
      conn,
      `
      SELECT
        COUNT(DISTINCT CASE WHEN pageview_url IN ('/home','/lander-1','/lander-2','/lander-3','/lander-4','/lander-5') THEN website_session_id END) AS landing,
        COUNT(DISTINCT CASE WHEN pageview_url = '/products' THEN website_session_id END) AS catalog,
        COUNT(DISTINCT CASE WHEN pageview_url IN (
          '/the-original-mr-fuzzy','/the-forever-love-bear','/the-birthday-sugar-panda','/the-hudson-river-mini-bear'
        ) THEN website_session_id END) AS pdp,
        COUNT(DISTINCT CASE WHEN pageview_url = '/cart' THEN website_session_id END) AS cart,
        COUNT(DISTINCT CASE WHEN pageview_url = '/shipping' THEN website_session_id END) AS shipping,
        COUNT(DISTINCT CASE WHEN pageview_url IN ('/billing','/billing-2') THEN website_session_id END) AS billing,
        COUNT(DISTINCT CASE WHEN pageview_url = '/thank-you-for-your-order' THEN website_session_id END) AS thanks
      FROM pageviews
    `
    ),
    sqlAll(conn, `SELECT COUNT(DISTINCT user_id) AS users FROM orders`),
    sqlAll(
      conn,
      `
      SELECT MAX(CAST(created_at AS TIMESTAMP)) AS maxTs
      FROM (
        SELECT created_at FROM orders
        UNION ALL
        SELECT created_at FROM sessions
      )
    `
    ),
    sqlAll(conn, `SELECT COUNT(*) AS orders, COALESCE(SUM(price_usd),0) AS revenue FROM orders`),
  ]);

  return {
    monthly,
    products,
    productMonthly,
    channels,
    campaigns,
    devices,
    landings,
    funnel: funnelRow[0] || {},
    users: Number(usersRow[0]?.users || 0),
    maxTs: maxTsRow[0]?.maxTs || null,
    contract: primaryOrders[0] || { orders: 0, revenue: 0 },
  };
}
