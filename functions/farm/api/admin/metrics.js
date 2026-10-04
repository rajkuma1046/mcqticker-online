// GET /farm/api/admin/metrics — Real-time business metrics for Farm Direct admin dashboard
import { json } from '../_lib/http.js';
import { requireAdmin } from '../_lib/auth.js';
import { istDayUtcBounds } from '../_lib/http.js';

export async function onRequestGet({ request, env }) {
  await requireAdmin(request, env);

  const { start: todayStart, end: todayEnd } = istDayUtcBounds();

  // 1. Today's orders and sales
  const todayStats = await env.DB.prepare(`
    SELECT 
      COUNT(*) as count,
      COALESCE(SUM(grand_total_paise), 0) as sales_paise
    FROM farm_orders
    WHERE created_at >= ? AND created_at < ? AND status != 'CANCELLED'
  `).bind(todayStart, todayEnd).first();

  // 2. Pending orders count
  const pendingStats = await env.DB.prepare(
    "SELECT COUNT(*) as count FROM farm_orders WHERE status = 'PENDING'"
  ).first();

  // 3. Confirmed & In-progress orders count
  const activeStats = await env.DB.prepare(
    "SELECT COUNT(*) as count FROM farm_orders WHERE status IN ('CONFIRMED', 'PREPARING', 'READY_FOR_DELIVERY', 'OUT_FOR_DELIVERY')"
  ).first();

  // 4. Low stock products count
  const thresholdSetting = await env.DB.prepare(
    "SELECT value FROM farm_settings WHERE key = 'low_stock_threshold_kg'"
  ).first();
  const lowStockThreshold = Number(thresholdSetting?.value || 15);

  const lowStockStats = await env.DB.prepare(`
    SELECT COUNT(*) as count
    FROM farm_products p
    JOIN farm_inventory i ON p.id = i.product_id
    WHERE p.is_archived = 0 AND p.is_available = 1 AND i.quantity_available <= ?
  `).bind(lowStockThreshold).first();

  // 5. Active sample requests
  const sampleStats = await env.DB.prepare(
    "SELECT COUNT(*) as count FROM farm_sample_requests WHERE status IN ('REQUESTED', 'APPROVED', 'SCHEDULED')"
  ).first();

  // 6. Total lifetime orders & sales
  const lifetimeStats = await env.DB.prepare(`
    SELECT 
      COUNT(*) as count,
      COALESCE(SUM(grand_total_paise), 0) as sales_paise
    FROM farm_orders
    WHERE status != 'CANCELLED'
  `).first();

  return json({
    success: true,
    metrics: {
      todaysOrders: todayStats?.count || 0,
      todaysSalesPaise: todayStats?.sales_paise || 0,
      todaysSalesRupees: (todayStats?.sales_paise || 0) / 100,
      pendingOrders: pendingStats?.count || 0,
      activeOrders: activeStats?.count || 0,
      lowStockProducts: lowStockStats?.count || 0,
      activeSampleRequests: sampleStats?.count || 0,
      totalOrders: lifetimeStats?.count || 0,
      totalSalesRupees: (lifetimeStats?.sales_paise || 0) / 100,
      lowStockThresholdKg: lowStockThreshold,
    }
  });
}
