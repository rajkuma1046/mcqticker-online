// GET /farm/api/admin/orders — List all orders with filters and search.
import { json } from '../../_lib/http.js';
import { requireAdmin } from '../../_lib/auth.js';

export async function onRequestGet({ request, env }) {
  await requireAdmin(request, env);

  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const areaId = url.searchParams.get('delivery_area_id');
  const time = url.searchParams.get('time');
  const queryText = url.searchParams.get('q');
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const limit = Math.min(50, Number(url.searchParams.get('limit')) || 25);
  const offset = (page - 1) * limit;

  let sql = `
    SELECT 
      o.*,
      da.delivery_day
    FROM farm_orders o
    LEFT JOIN farm_delivery_areas da ON o.delivery_area_id = da.id
    WHERE 1=1
  `;
  const binds = [];

  if (status && status !== 'ALL') {
    sql += ' AND o.status = ?';
    binds.push(status);
  }

  if (areaId && areaId !== 'ALL') {
    sql += ' AND o.delivery_area_id = ?';
    binds.push(Number(areaId));
  }

  if (time && time !== 'ALL') {
    if (time === 'TODAY') {
      sql += " AND date(o.created_at) = date('now')";
    } else if (time === 'YESTERDAY') {
      sql += " AND date(o.created_at) = date('now', '-1 day')";
    } else if (time === 'THIS_WEEK') {
      sql += " AND strftime('%W-%Y', o.created_at) = strftime('%W-%Y', 'now')";
    } else if (time === 'THIS_MONTH') {
      sql += " AND strftime('%m-%Y', o.created_at) = strftime('%m-%Y', 'now')";
    } else if (time === 'THIS_YEAR') {
      sql += " AND strftime('%Y', o.created_at) = strftime('%Y', 'now')";
    } else if (time === 'LAST_YEAR') {
      sql += " AND strftime('%Y', o.created_at) = strftime('%Y', 'now', '-1 year')";
    }
  }

  if (queryText) {
    const qClean = `%${queryText.trim()}%`;
    sql += ' AND (o.order_number LIKE ? OR o.customer_name LIKE ? OR o.customer_phone LIKE ?)';
    binds.push(qClean, qClean, qClean);
  }

  // Count total for pagination
  const countSql = sql.replace('SELECT \n      o.*,\n      da.delivery_day', 'SELECT COUNT(*) as total');
  const countRow = await env.DB.prepare(countSql).bind(...binds).first();
  const total = countRow?.total || 0;

  // Order results
  sql += ' ORDER BY o.created_at DESC LIMIT ? OFFSET ?';
  binds.push(limit, offset);

  const { results: orders } = await env.DB.prepare(sql).bind(...binds).all();

  // For each order, fetch items summary
  const orderIds = (orders || []).map(o => o.id);
  let itemMap = new Map();

  if (orderIds.length > 0) {
    const placeholders = orderIds.map(() => '?').join(',');
    const { results: items } = await env.DB.prepare(`
      SELECT order_id, product_name_snapshot, quantity, unit, price_snapshot_paise, line_total_paise
      FROM farm_order_items
      WHERE order_id IN (${placeholders})
    `).bind(...orderIds).all();

    for (const item of items || []) {
      if (!itemMap.has(item.order_id)) itemMap.set(item.order_id, []);
      itemMap.get(item.order_id).push({
        productName: item.product_name_snapshot,
        quantity: item.quantity,
        unit: item.unit,
        lineTotalRupees: item.line_total_paise / 100,
      });
    }
  }

  return json({
    success: true,
    total,
    page,
    limit,
    orders: (orders || []).map(o => ({
      id: o.id,
      orderNumber: o.order_number,
      customerName: o.customer_name,
      customerPhone: o.customer_phone,
      customerEmail: o.customer_email,
      deliveryArea: o.delivery_area_name_snapshot,
      deliveryAddress: o.delivery_address,
      deliveryDay: o.delivery_day || 'Scheduled Round',
      customerNote: o.customer_note,
      status: o.status,
      inventoryState: o.inventory_state,
      subtotalRupees: o.subtotal_paise / 100,
      deliveryChargeRupees: o.delivery_charge_paise / 100,
      grandTotalRupees: o.grand_total_paise / 100,
      paymentMethod: o.payment_method,
      paymentStatus: o.payment_status,
      adminNote: o.admin_note,
      createdAt: o.created_at,
      items: itemMap.get(o.id) || [],
    }))
  });
}
