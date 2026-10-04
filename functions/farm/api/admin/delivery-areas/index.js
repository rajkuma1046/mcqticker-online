// GET  /farm/api/admin/delivery-areas — List all delivery areas
// POST /farm/api/admin/delivery-areas — Add or update delivery area

import { json, fail, readJson } from '../../_lib/http.js';
import { str, bool, rupeesToPaise, id } from '../../_lib/validate.js';
import { requireAdmin } from '../../_lib/auth.js';

export async function onRequestGet({ request, env }) {
  await requireAdmin(request, env);

  const { results: areas } = await env.DB.prepare(`
    SELECT * FROM farm_delivery_areas ORDER BY is_active DESC, sort_order ASC, name ASC
  `).all();

  return json({
    success: true,
    deliveryAreas: (areas || []).map(a => ({
      id: a.id,
      name: a.name,
      city: a.city,
      isActive: Boolean(a.is_active),
      deliveryDay: a.delivery_day || 'Sunday',
      deliveryChargePaise: a.delivery_charge_paise,
      deliveryChargeRupees: a.delivery_charge_paise / 100,
      minimumOrderPaise: a.minimum_order_paise,
      minimumOrderRupees: a.minimum_order_paise / 100,
      sortOrder: a.sort_order,
    }))
  });
}

export async function onRequestPost({ request, env }) {
  await requireAdmin(request, env);
  const body = await readJson(request);

  const existingId = body.id ? id(body.id, 'Delivery Area ID') : null;
  const name = str(body.name, { label: 'Area Name', min: 3, max: 100, required: true });
  const city = str(body.city || 'Gwalior', { label: 'City', max: 50 });
  const deliveryDay = str(body.delivery_day || 'Sunday', { label: 'Delivery Day', max: 30 });
  const isActive = bool(body.is_active !== undefined ? body.is_active : true);
  const deliveryChargePaise = rupeesToPaise(body.delivery_charge_rupees || 0, { label: 'Delivery charge' });
  const minimumOrderPaise = rupeesToPaise(body.minimum_order_rupees || 0, { label: 'Minimum order' });

  if (existingId) {
    await env.DB.prepare(`
      UPDATE farm_delivery_areas SET
        name = ?,
        city = ?,
        delivery_day = ?,
        is_active = ?,
        delivery_charge_paise = ?,
        minimum_order_paise = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).bind(name, city, deliveryDay, isActive ? 1 : 0, deliveryChargePaise, minimumOrderPaise, existingId).run();

    return json({ success: true, message: 'Delivery area updated.' });
  } else {
    const result = await env.DB.prepare(`
      INSERT INTO farm_delivery_areas (
        name, city, delivery_day, is_active, delivery_charge_paise, minimum_order_paise
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).bind(name, city, deliveryDay, isActive ? 1 : 0, deliveryChargePaise, minimumOrderPaise).run();

    return json({
      success: true,
      deliveryArea: {
        id: result.meta.last_row_id,
        name,
        city,
        isActive,
      }
    }, 201);
  }
}
