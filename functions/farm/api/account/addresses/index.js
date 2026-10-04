// POST /farm/api/account/addresses — Save customer delivery address
// GET  /farm/api/account/addresses — List customer addresses

import { json, fail, readJson } from '../../_lib/http.js';
import { str, phone, pincode, id, bool } from '../../_lib/validate.js';
import { requireUser } from '../../_lib/auth.js';

export async function onRequestGet({ request, env }) {
  const user = await requireUser(request, env);

  const { results: addresses } = await env.DB.prepare(`
    SELECT 
      ua.*,
      da.name as delivery_area_name
    FROM farm_user_addresses ua
    LEFT JOIN farm_delivery_areas da ON ua.delivery_area_id = da.id
    WHERE ua.user_id = ?
    ORDER BY ua.is_default DESC, ua.id DESC
  `).bind(user.id).all();

  return json({
    success: true,
    addresses: (addresses || []).map(a => ({
      id: a.id,
      fullName: a.full_name,
      phone: a.phone,
      houseNumber: a.house_number,
      street: a.street,
      deliveryAreaId: a.delivery_area_id,
      deliveryAreaName: a.delivery_area_name || a.locality,
      city: a.city,
      pincode: a.pincode,
      landmark: a.landmark,
      deliveryInstructions: a.delivery_instructions,
      isDefault: Boolean(a.is_default),
    }))
  });
}

export async function onRequestPost({ request, env }) {
  const user = await requireUser(request, env);
  const body = await readJson(request);

  const fullName = str(body.full_name || user.name, { label: 'Full name', min: 2, max: 80, required: true });
  const rawPhone = phone(body.phone || user.phone, { label: 'Phone number', required: true });
  const houseNumber = str(body.house_number, { label: 'House / Flat number', min: 1, max: 80, required: true });
  const street = str(body.street, { label: 'Street / Road', max: 120, required: false });
  const deliveryAreaId = id(body.delivery_area_id, 'Delivery Area');
  const rawPincode = pincode(body.pincode);
  const landmark = str(body.landmark, { label: 'Landmark', max: 100, required: false });
  const deliveryInstructions = str(body.delivery_instructions, { label: 'Instructions', max: 200, required: false });
  const isDefault = bool(body.is_default);

  // Validate delivery area
  const area = await env.DB.prepare(
    'SELECT id, name, city, is_active FROM farm_delivery_areas WHERE id = ?'
  ).bind(deliveryAreaId).first();

  if (!area || !area.is_active) {
    fail(400, 'Selected delivery area is currently not serviceable.');
  }

  // If this address is set to default, clear previous default
  if (isDefault) {
    await env.DB.prepare(
      'UPDATE farm_user_addresses SET is_default = 0 WHERE user_id = ?'
    ).bind(user.id).run();
  }

  const result = await env.DB.prepare(`
    INSERT INTO farm_user_addresses (
      user_id,
      full_name,
      phone,
      house_number,
      street,
      delivery_area_id,
      locality,
      city,
      pincode,
      landmark,
      delivery_instructions,
      is_default
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    user.id,
    fullName,
    rawPhone,
    houseNumber,
    street,
    deliveryAreaId,
    area.name,
    area.city || 'Gwalior',
    rawPincode,
    landmark,
    deliveryInstructions,
    isDefault ? 1 : 0
  ).run();

  return json({
    success: true,
    address: {
      id: result.meta.last_row_id,
      fullName,
      phone: rawPhone,
      houseNumber,
      street,
      deliveryAreaId,
      deliveryAreaName: area.name,
      city: area.city || 'Gwalior',
      pincode: rawPincode,
      landmark,
      deliveryInstructions,
      isDefault,
    }
  }, 201);
}
