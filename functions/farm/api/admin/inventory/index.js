// GET  /farm/api/admin/inventory — Live inventory status & recent audit logs
// POST /farm/api/admin/inventory — Adjust stock levels with audit logging

import { json, fail, readJson } from '../../_lib/http.js';
import { int, str, id } from '../../_lib/validate.js';
import { requireAdmin } from '../../_lib/auth.js';

export async function onRequestGet({ request, env }) {
  await requireAdmin(request, env);

  const query = `
    SELECT 
      p.id as product_id,
      p.name,
      p.slug,
      p.price_per_kg_paise,
      p.is_available,
      p.is_seasonal,
      COALESCE(i.quantity_available, 0) as quantity_available,
      COALESCE(i.quantity_reserved, 0) as quantity_reserved,
      COALESCE(i.quantity_sold, 0) as quantity_sold,
      COALESCE(i.sample_stock_grams, 0) as sample_stock_grams,
      i.updated_at
    FROM farm_products p
    LEFT JOIN farm_inventory i ON p.id = i.product_id
    WHERE p.is_archived = 0
    ORDER BY p.sort_order ASC, p.id ASC
  `;

  const { results: inventory } = await env.DB.prepare(query).all();

  // Fetch recent stock movement logs
  const logQuery = `
    SELECT 
      l.*,
      p.name as product_name
    FROM farm_inventory_log l
    JOIN farm_products p ON l.product_id = p.id
    ORDER BY l.created_at DESC
    LIMIT 40
  `;

  const { results: logs } = await env.DB.prepare(logQuery).all();

  return json({
    success: true,
    inventory: (inventory || []).map(i => ({
      productId: i.product_id,
      productName: i.name,
      slug: i.slug,
      priceRupees: i.price_per_kg_paise ? i.price_per_kg_paise / 100 : null,
      isAvailable: Boolean(i.is_available),
      isSeasonal: Boolean(i.is_seasonal),
      quantityAvailable: i.quantity_available,
      quantityReserved: i.quantity_reserved,
      quantitySold: i.quantity_sold,
      sampleStockGrams: i.sample_stock_grams,
      updatedAt: i.updated_at,
    })),
    recentLogs: (logs || []).map(l => ({
      id: l.id,
      productId: l.product_id,
      productName: l.product_name,
      changeType: l.change_type,
      deltaKg: l.delta_kg,
      deltaSampleGrams: l.delta_sample_g,
      reference: l.reference,
      note: l.note,
      createdAt: l.created_at,
    }))
  });
}

export async function onRequestPost({ request, env }) {
  const admin = await requireAdmin(request, env);
  const body = await readJson(request);

  const productId = id(body.product_id, 'Product');
  const deltaKg = int(body.delta_kg || 0, { label: 'Quantity (kg)', min: -10000, max: 10000 });
  const deltaSampleGrams = int(body.delta_sample_grams || 0, { label: 'Sample quantity (g)', min: -100000, max: 100000 });
  const note = str(body.note, { label: 'Adjustment note', max: 200, required: false });

  if (deltaKg === 0 && deltaSampleGrams === 0) {
    fail(400, 'Please specify an adjustment quantity for produce (kg) or samples (g).');
  }

  // Check current stock
  const current = await env.DB.prepare(
    'SELECT quantity_available, sample_stock_grams FROM farm_inventory WHERE product_id = ?'
  ).bind(productId).first();

  if (!current) {
    fail(404, 'Inventory record not found for this product.');
  }

  const newAvailable = current.quantity_available + deltaKg;
  const newSampleGrams = current.sample_stock_grams + deltaSampleGrams;

  if (newAvailable < 0) {
    fail(400, `Cannot reduce stock below 0 kg (current available: ${current.quantity_available} kg).`);
  }
  if (newSampleGrams < 0) {
    fail(400, `Cannot reduce sample stock below 0 grams (current: ${current.sample_stock_grams} g).`);
  }

  // Update inventory and write log in a batch
  const changeType = deltaKg > 0 ? 'ADD_STOCK' : (deltaKg < 0 ? 'ADJUST' : 'SAMPLE_STOCK');

  await env.DB.batch([
    env.DB.prepare(`
      UPDATE farm_inventory
      SET quantity_available = ?,
          sample_stock_grams = ?,
          updated_at = datetime('now')
      WHERE product_id = ?
    `).bind(newAvailable, newSampleGrams, productId),

    env.DB.prepare(`
      INSERT INTO farm_inventory_log (
        product_id, change_type, delta_kg, delta_sample_g, reference, note, admin_user_id
      ) VALUES (?, ?, ?, ?, 'MANUAL_ADJUSTMENT', ?, ?)
    `).bind(productId, changeType, deltaKg, deltaSampleGrams, note || 'Stock updated by admin', admin.id)
  ]);

  return json({
    success: true,
    message: 'Stock updated successfully.',
    quantityAvailable: newAvailable,
    sampleStockGrams: newSampleGrams,
  });
}
