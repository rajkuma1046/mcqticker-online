// GET  /farm/api/admin/sample-rounds — List all sample rounds with request count
// POST /farm/api/admin/sample-rounds — Create or update sample rounds

import { json, fail, readJson } from '../../_lib/http.js';
import { str, id, dateYmd, oneOf } from '../../_lib/validate.js';
import { requireAdmin } from '../../_lib/auth.js';

const ROUND_STATUSES = ['PLANNED', 'OPEN', 'CLOSED', 'OUT_FOR_DELIVERY', 'COMPLETED', 'CANCELLED'];

export async function onRequestGet({ request, env }) {
  await requireAdmin(request, env);

  const query = `
    SELECT 
      r.*,
      da.name as area_name,
      COUNT(sr.id) as sample_count,
      COALESCE(SUM(sr.sample_quantity_grams), 0) as total_grams
    FROM farm_sample_delivery_rounds r
    LEFT JOIN farm_delivery_areas da ON r.delivery_area_id = da.id
    LEFT JOIN farm_sample_requests sr ON r.id = sr.scheduled_round_id AND sr.status NOT IN ('CANCELLED', 'DECLINED')
    GROUP BY r.id
    ORDER BY r.delivery_date DESC
  `;

  const { results: rounds } = await env.DB.prepare(query).all();

  return json({
    success: true,
    rounds: (rounds || []).map(r => ({
      id: r.id,
      name: r.round_name,
      date: r.delivery_date,
      areaId: r.delivery_area_id,
      areaName: r.area_name,
      status: r.status,
      notes: r.notes,
      sampleCount: r.sample_count,
      totalGrams: r.total_grams,
      createdAt: r.created_at,
    }))
  });
}

export async function onRequestPost({ request, env }) {
  await requireAdmin(request, env);
  const body = await readJson(request);

  const roundId = body.id ? id(body.id, 'Round ID') : null;
  const roundName = str(body.round_name, { label: 'Round Name', min: 3, max: 100, required: true });
  const deliveryDate = dateYmd(body.delivery_date, 'Delivery Date');
  const deliveryAreaId = id(body.delivery_area_id, 'Delivery Area');
  const status = oneOf(body.status || 'OPEN', ROUND_STATUSES, 'Round Status');
  const notes = str(body.notes, { label: 'Notes', max: 300, required: false });

  if (roundId) {
    await env.DB.prepare(`
      UPDATE farm_sample_delivery_rounds SET
        round_name = ?,
        delivery_date = ?,
        delivery_area_id = ?,
        status = ?,
        notes = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).bind(roundName, deliveryDate, deliveryAreaId, status, notes || null, roundId).run();

    return json({ success: true, message: 'Sample delivery round updated.' });
  } else {
    const result = await env.DB.prepare(`
      INSERT INTO farm_sample_delivery_rounds (
        round_name, delivery_date, delivery_area_id, status, notes
      ) VALUES (?, ?, ?, ?, ?)
    `).bind(roundName, deliveryDate, deliveryAreaId, status, notes || null).run();

    return json({
      success: true,
      round: {
        id: result.meta.last_row_id,
        name: roundName,
        deliveryDate,
        status,
      }
    }, 201);
  }
}
