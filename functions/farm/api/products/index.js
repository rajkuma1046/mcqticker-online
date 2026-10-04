// GET /farm/api/products — Fetch active product catalog with live inventory & pricing.
import { json } from '../_lib/http.js';

export async function onRequestGet({ env }) {
  if (!env?.DB) {
    return json({ success: false, error: 'Database not bound.' }, 500);
  }

  const query = `
    SELECT 
      p.id,
      p.name,
      p.slug,
      p.local_name,
      p.description,
      p.label,
      p.price_per_kg_paise,
      p.unit,
      p.quantity_options,
      p.max_order_qty,
      p.image_url,
      p.images,
      p.image_alt,
      p.category,
      p.is_available,
      p.is_seasonal,
      p.sample_available,
      p.sample_max_quantity_grams,
      p.sort_order,
      COALESCE(i.quantity_available, 0) as quantity_available,
      COALESCE(i.quantity_reserved, 0) as quantity_reserved,
      COALESCE(i.quantity_sold, 0) as quantity_sold,
      COALESCE(i.sample_stock_grams, 0) as sample_stock_grams
    FROM farm_products p
    LEFT JOIN farm_inventory i ON p.id = i.product_id
    WHERE p.is_archived = 0
    ORDER BY p.sort_order ASC, p.id ASC
  `;

  const { results } = await env.DB.prepare(query).all();

  const products = (results || []).map(p => {
    let presets = [1, 5, 10];
    try {
      presets = JSON.parse(p.quantity_options);
    } catch (_) {}

    let images = [];
    try {
      images = JSON.parse(p.images || '[]');
    } catch (_) {}
    if (!Array.isArray(images) || images.length === 0) {
      if (p.image_url) images = [p.image_url];
    }

    const isOutOfStock = p.quantity_available <= 0 || !p.is_available;

    return {
      id: p.id,
      name: p.name,
      slug: p.slug,
      localName: p.local_name,
      description: p.description,
      label: p.label,
      pricePerKgPaise: p.price_per_kg_paise,
      pricePerKgRupees: p.price_per_kg_paise ? (p.price_per_kg_paise / 100) : null,
      unit: p.unit,
      quantityOptions: presets,
      maxOrderQty: p.max_order_qty,
      imageUrl: p.image_url,
      images,
      imageAlt: p.image_alt,
      category: p.category,
      isAvailable: Boolean(p.is_available),
      isSeasonal: Boolean(p.is_seasonal),
      sampleAvailable: Boolean(p.sample_available) && p.sample_stock_grams > 0,
      sampleMaxQuantityGrams: p.sample_max_quantity_grams,
      quantityAvailable: p.quantity_available,
      isOutOfStock,
    };
  });

  return json({
    success: true,
    products
  });
}
