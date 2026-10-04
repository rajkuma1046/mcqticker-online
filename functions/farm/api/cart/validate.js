// POST /farm/api/cart/validate — Server-authoritative cart validation and price calculation.
import { json, fail, readJson } from '../_lib/http.js';
import { cartItems } from '../_lib/validate.js';

export async function onRequestPost({ request, env }) {
  if (!env?.DB) {
    return json({ success: false, error: 'Database not bound.' }, 500);
  }

  const body = await readJson(request);
  const items = cartItems(body.items || [], { allowEmpty: true });
  const deliveryAreaId = body.delivery_area_id ? Number(body.delivery_area_id) : null;

  if (items.length === 0) {
    return json({
      success: true,
      items: [],
      subtotalPaise: 0,
      subtotalRupees: 0,
      deliveryChargePaise: 0,
      deliveryChargeRupees: 0,
      grandTotalPaise: 0,
      grandTotalRupees: 0,
      hasStockIssues: false,
    });
  }

  // Fetch products and inventory from DB
  const productIds = items.map(i => i.product_id);
  const placeholders = productIds.map(() => '?').join(',');

  const query = `
    SELECT 
      p.id,
      p.name,
      p.slug,
      p.price_per_kg_paise,
      p.unit,
      p.image_url,
      p.is_available,
      p.is_archived,
      COALESCE(i.quantity_available, 0) as quantity_available
    FROM farm_products p
    LEFT JOIN farm_inventory i ON p.id = i.product_id
    WHERE p.id IN (${placeholders})
  `;

  const { results } = await env.DB.prepare(query).bind(...productIds).all();
  const dbMap = new Map((results || []).map(r => [r.id, r]));

  let subtotalPaise = 0;
  let hasStockIssues = false;
  const validatedItems = [];

  for (const item of items) {
    const p = dbMap.get(item.product_id);
    if (!p || p.is_archived || !p.is_available || p.price_per_kg_paise === null) {
      hasStockIssues = true;
      validatedItems.push({
        productId: item.product_id,
        productName: p?.name || 'Unavailable Item',
        quantity: item.quantity,
        availableQuantity: 0,
        pricePaise: 0,
        priceRupees: 0,
        lineTotalPaise: 0,
        lineTotalRupees: 0,
        isAvailable: false,
        error: 'Product is currently not available for purchase.',
      });
      continue;
    }

    const available = p.quantity_available;
    const isExceeded = item.quantity > available;
    if (isExceeded || available <= 0) {
      hasStockIssues = true;
    }

    const pricePaise = p.price_per_kg_paise;
    const lineTotalPaise = pricePaise * item.quantity;
    subtotalPaise += lineTotalPaise;

    validatedItems.push({
      productId: p.id,
      productName: p.name,
      slug: p.slug,
      imageUrl: p.image_url,
      quantity: item.quantity,
      availableQuantity: available,
      pricePaise,
      priceRupees: pricePaise / 100,
      unit: p.unit,
      lineTotalPaise,
      lineTotalRupees: lineTotalPaise / 100,
      isAvailable: available > 0 && !isExceeded,
      error: available <= 0 ? 'Out of stock' : (isExceeded ? `Only ${available} kg available in stock` : null),
    });
  }

  // Calculate delivery charge if area provided
  let deliveryChargePaise = 0;
  let deliveryArea = null;
  let minOrderMet = true;

  if (deliveryAreaId) {
    const area = await env.DB.prepare(
      'SELECT id, name, city, delivery_charge_paise, minimum_order_paise FROM farm_delivery_areas WHERE id = ? AND is_active = 1'
    ).bind(deliveryAreaId).first();

    if (area) {
      deliveryArea = {
        id: area.id,
        name: area.name,
        city: area.city,
      };
      deliveryChargePaise = area.delivery_charge_paise || 0;
      if (subtotalPaise < (area.minimum_order_paise || 0)) {
        minOrderMet = false;
      }
    }
  }

  const grandTotalPaise = subtotalPaise + deliveryChargePaise;

  return json({
    success: true,
    items: validatedItems,
    subtotalPaise,
    subtotalRupees: subtotalPaise / 100,
    deliveryArea,
    deliveryChargePaise,
    deliveryChargeRupees: deliveryChargePaise / 100,
    grandTotalPaise,
    grandTotalRupees: grandTotalPaise / 100,
    minOrderMet,
    hasStockIssues,
  });
}
