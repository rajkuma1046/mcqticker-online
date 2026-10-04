// GET /farm/api/delivery-areas — Fetch active neighbourhood delivery areas in Gwalior
import { json } from '../_lib/http.js';

export async function onRequestGet({ env }) {
  if (!env?.DB) {
    return json({ success: false, error: 'Database not bound.' }, 500);
  }

  const query = `
    SELECT 
      id,
      name,
      city,
      is_active,
      delivery_day,
      delivery_charge_paise,
      minimum_order_paise,
      sort_order
    FROM farm_delivery_areas
    WHERE is_active = 1
    ORDER BY sort_order ASC, name ASC
  `;

  const { results } = await env.DB.prepare(query).all();

  const areas = (results || []).map(a => ({
    id: a.id,
    name: a.name,
    city: a.city,
    deliveryDay: a.delivery_day || 'Scheduled Round',
    deliveryChargePaise: a.delivery_charge_paise,
    deliveryChargeRupees: a.delivery_charge_paise / 100,
    minimumOrderPaise: a.minimum_order_paise,
    minimumOrderRupees: a.minimum_order_paise / 100,
  }));

  return json({
    success: true,
    deliveryAreas: areas
  });
}
