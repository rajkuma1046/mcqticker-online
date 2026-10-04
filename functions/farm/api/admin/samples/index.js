// GET  /farm/api/admin/samples — List sample requests with route aggregation & filters
// PATCH /farm/api/admin/samples — Update sample status (APPROVE, DECLINE, SCHEDULE, DELIVER, CANCEL)

import { json, fail, readJson } from '../../_lib/http.js';
import { oneOf, str, id } from '../../_lib/validate.js';
import { requireAdmin } from '../../_lib/auth.js';

const VALID_SAMPLE_STATUSES = [
  'REQUESTED',
  'APPROVED',
  'SCHEDULED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
  'DECLINED'
];

export async function onRequestGet({ request, env }) {
  await requireAdmin(request, env);

  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const areaId = url.searchParams.get('delivery_area_id');
  const roundId = url.searchParams.get('round_id');

  let sql = `
    SELECT 
      sr.*,
      da.name as delivery_area_name,
      r.round_name,
      r.delivery_date as round_date
    FROM farm_sample_requests sr
    LEFT JOIN farm_delivery_areas da ON sr.delivery_area_id = da.id
    LEFT JOIN farm_sample_delivery_rounds r ON sr.scheduled_round_id = r.id
    WHERE 1=1
  `;
  const binds = [];

  if (status && status !== 'ALL') {
    sql += ' AND sr.status = ?';
    binds.push(status);
  }
  if (areaId && areaId !== 'ALL') {
    sql += ' AND sr.delivery_area_id = ?';
    binds.push(Number(areaId));
  }
  if (roundId && roundId !== 'ALL') {
    sql += ' AND sr.scheduled_round_id = ?';
    binds.push(Number(roundId));
  }

  sql += ' ORDER BY sr.requested_at DESC';

  const { results: samples } = await env.DB.prepare(sql).bind(...binds).all();

  // Route aggregation summary (for scheduling delivery rounds in Gwalior)
  const routeSummary = {
    totalRequests: (samples || []).length,
    totalGrams: (samples || []).reduce((acc, s) => acc + (s.sample_quantity_grams || 0), 0),
    byArea: {},
    byProduct: {},
  };

  for (const s of samples || []) {
    const area = s.delivery_area_name || 'Other';
    routeSummary.byArea[area] = (routeSummary.byArea[area] || 0) + 1;
    const prod = s.product_name_snapshot;
    routeSummary.byProduct[prod] = (routeSummary.byProduct[prod] || 0) + 1;
  }

  return json({
    success: true,
    routeSummary,
    samples: (samples || []).map(s => ({
      id: s.id,
      customerName: s.customer_name,
      phone: s.phone,
      email: s.email,
      productId: s.product_id,
      productName: s.product_name_snapshot,
      sampleQuantityGrams: s.sample_quantity_grams,
      deliveryAreaId: s.delivery_area_id,
      deliveryAreaName: s.delivery_area_name,
      deliveryAddress: s.delivery_address,
      customerNote: s.customer_note,
      status: s.status,
      stockState: s.stock_state,
      scheduledRoundId: s.scheduled_round_id,
      roundName: s.round_name,
      roundDate: s.round_date,
      adminNote: s.admin_note,
      requestedAt: s.requested_at,
      fulfilledAt: s.fulfilled_at,
    }))
  });
}

export async function onRequestPatch({ request, env }) {
  await requireAdmin(request, env);
  const body = await readJson(request);

  const sampleId = id(body.id, 'Sample Request ID');
  const newStatus = oneOf(body.status, VALID_SAMPLE_STATUSES, 'Status');
  const roundId = body.scheduled_round_id ? id(body.scheduled_round_id, 'Round ID') : null;
  const adminNote = str(body.admin_note, { label: 'Admin Note', max: 200, required: false });

  const existing = await env.DB.prepare(
    'SELECT * FROM farm_sample_requests WHERE id = ?'
  ).bind(sampleId).first();

  if (!existing) {
    fail(404, 'Sample request not found.');
  }

  // Stock management for samples:
  // If moving to CANCELLED or DECLINED and stock was RESERVED, return grams to farm_inventory.sample_stock_grams
  let stockState = existing.stock_state;
  let fulfilledAt = existing.fulfilled_at;

  const batch = [];

  if ((newStatus === 'CANCELLED' || newStatus === 'DECLINED') && existing.stock_state === 'RESERVED') {
    batch.push(
      env.DB.prepare(`
        UPDATE farm_inventory
        SET sample_stock_grams = sample_stock_grams + ?
        WHERE product_id = ?
      `).bind(existing.sample_quantity_grams, existing.product_id)
    );
    stockState = 'RELEASED';
  } else if (newStatus === 'DELIVERED') {
    stockState = 'USED';
    fulfilledAt = new Date().toISOString();
  }

  batch.push(
    env.DB.prepare(`
      UPDATE farm_sample_requests SET
        status = ?,
        stock_state = ?,
        scheduled_round_id = COALESCE(?, scheduled_round_id),
        admin_note = COALESCE(?, admin_note),
        fulfilled_at = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).bind(newStatus, stockState, roundId, adminNote || null, fulfilledAt, sampleId)
  );

  await env.DB.batch(batch);

  return json({
    success: true,
    message: `Sample request status updated to ${newStatus}.`,
    status: newStatus,
    stockState
  });
}
