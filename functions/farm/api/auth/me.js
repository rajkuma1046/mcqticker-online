// GET /farm/api/auth/me — Current authenticated user profile, saved addresses, and active role.
import { json } from '../_lib/http.js';
import { getUser, publicUser } from '../_lib/auth.js';

export async function onRequestGet({ request, env }) {
  if (!env?.DB) {
    return json({ success: false, user: null });
  }

  const user = await getUser(request, env);
  if (!user) {
    return json({ success: true, user: null, addresses: [] });
  }

  // Fetch saved addresses
  const { results: addresses } = await env.DB.prepare(`
    SELECT 
      ua.id,
      ua.full_name,
      ua.phone,
      ua.house_number,
      ua.street,
      ua.delivery_area_id,
      ua.locality,
      ua.city,
      ua.pincode,
      ua.landmark,
      ua.delivery_instructions,
      ua.is_default,
      da.name as delivery_area_name
    FROM farm_user_addresses ua
    LEFT JOIN farm_delivery_areas da ON ua.delivery_area_id = da.id
    WHERE ua.user_id = ?
    ORDER BY ua.is_default DESC, ua.id DESC
  `).bind(user.id).all();

  return json({
    success: true,
    user: publicUser(user),
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
