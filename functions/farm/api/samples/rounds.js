// GET /farm/api/samples/rounds — Fetch planned or open sample delivery rounds
import { json } from '../_lib/http.js';

export async function onRequestGet({ env }) {
  if (!env?.DB) {
    return json({ success: false, error: 'Database not bound.' }, 500);
  }

  const query = `
    SELECT 
      r.id,
      r.round_name,
      r.delivery_date,
      r.delivery_area_id,
      r.status,
      r.notes,
      a.name as area_name,
      a.city
    FROM farm_sample_delivery_rounds r
    LEFT JOIN farm_delivery_areas a ON r.delivery_area_id = a.id
    WHERE r.status IN ('PLANNED', 'OPEN', 'OUT_FOR_DELIVERY')
    ORDER BY r.delivery_date ASC
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
      city: r.city,
      status: r.status,
      notes: r.notes,
    }))
  });
}
