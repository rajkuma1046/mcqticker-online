// GET  /farm/api/admin/products — List all products with detailed stock & configuration
// POST /farm/api/admin/products — Create a new product

import { json, fail, readJson } from '../../_lib/http.js';
import { str, slug as toSlug, int, bool, rupeesToPaise } from '../../_lib/validate.js';
import { requireAdmin } from '../../_lib/auth.js';

export async function onRequestGet({ request, env }) {
  await requireAdmin(request, env);

  const query = `
    SELECT 
      p.*,
      COALESCE(i.quantity_available, 0) as quantity_available,
      COALESCE(i.quantity_reserved, 0) as quantity_reserved,
      COALESCE(i.quantity_sold, 0) as quantity_sold,
      COALESCE(i.sample_stock_grams, 0) as sample_stock_grams
    FROM farm_products p
    LEFT JOIN farm_inventory i ON p.id = i.product_id
    ORDER BY p.is_archived ASC, p.sort_order ASC, p.id ASC
  `;

  const { results: products } = await env.DB.prepare(query).all();

  return json({
    success: true,
    products: (products || []).map(p => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      localName: p.local_name,
      description: p.description,
      label: p.label,
      pricePerKgPaise: p.price_per_kg_paise,
      pricePerKgRupees: p.price_per_kg_paise ? (p.price_per_kg_paise / 100) : null,
      unit: p.unit,
      quantityOptions: JSON.parse(p.quantity_options || '[1, 5, 10]'),
      maxOrderQty: p.max_order_qty,
      imageUrl: p.image_url,
      imageAlt: p.image_alt,
      category: p.category,
      isAvailable: Boolean(p.is_available),
      isSeasonal: Boolean(p.is_seasonal),
      isArchived: Boolean(p.is_archived),
      sampleAvailable: Boolean(p.sample_available),
      sampleMaxQuantityGrams: p.sample_max_quantity_grams,
      sortOrder: p.sort_order,
      quantityAvailable: p.quantity_available,
      quantityReserved: p.quantity_reserved,
      quantitySold: p.quantity_sold,
      sampleStockGrams: p.sample_stock_grams,
      createdAt: p.created_at,
    }))
  });
}

export async function onRequestPost({ request, env }) {
  await requireAdmin(request, env);
  const body = await readJson(request);

  const name = str(body.name, { label: 'Product name', min: 2, max: 100, required: true });
  const rawSlug = toSlug(body.slug || name);
  const localName = str(body.local_name, { label: 'Local name', max: 80, required: false });
  const description = str(body.description, { label: 'Description', max: 1000, required: false, multiline: true });
  const label = str(body.label || 'Raw / Unprocessed', { label: 'Label', max: 60, required: false });
  const pricePaise = body.price_per_kg_rupees !== undefined
    ? rupeesToPaise(body.price_per_kg_rupees, { label: 'Price per kg', required: false, allowZero: false })
    : null;
  const unit = str(body.unit || 'kg', { label: 'Unit', max: 10, required: false });
  const quantityOptions = JSON.stringify(body.quantity_options || [1, 5, 10]);
  const maxOrderQty = int(body.max_order_qty || 50, { label: 'Max order quantity', min: 1, max: 1000, required: false });
  const imageUrl = str(body.image_url, { label: 'Image URL', max: 300, required: false });
  const imageAlt = str(body.image_alt, { label: 'Image Alt', max: 200, required: false });
  const category = str(body.category || 'grain', { label: 'Category', max: 40, required: false });
  const isAvailable = bool(body.is_available !== undefined ? body.is_available : true);
  const isSeasonal = bool(body.is_seasonal);
  const sampleAvailable = bool(body.sample_available !== undefined ? body.sample_available : true);
  const sampleMaxQuantityGrams = int(body.sample_max_quantity_grams || 200, { min: 100, max: 200 });
  const initialStock = int(body.initial_stock_kg || 0, { label: 'Initial stock (kg)', min: 0, max: 50000 });
  const initialSampleStock = int(body.initial_sample_stock_grams || 2000, { label: 'Sample stock (g)', min: 0, max: 100000 });

  // Slug check
  const existing = await env.DB.prepare('SELECT id FROM farm_products WHERE slug = ?').bind(rawSlug).first();
  if (existing) {
    fail(409, 'A product with this slug already exists.');
  }

  // Insert product and inventory atomically
  const result = await env.DB.prepare(`
    INSERT INTO farm_products (
      name, slug, local_name, description, label, price_per_kg_paise,
      unit, quantity_options, max_order_qty, image_url, image_alt,
      category, is_available, is_seasonal, is_archived,
      sample_available, sample_max_quantity_grams
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).bind(
    name, rawSlug, localName, description, label, pricePaise,
    unit, quantityOptions, maxOrderQty, imageUrl, imageAlt,
    category, isAvailable ? 1 : 0, isSeasonal ? 1 : 0,
    sampleAvailable ? 1 : 0, sampleMaxQuantityGrams
  ).run();

  const productId = result.meta.last_row_id;

  // Insert inventory record
  await env.DB.prepare(`
    INSERT INTO farm_inventory (product_id, quantity_available, quantity_reserved, quantity_sold, sample_stock_grams)
    VALUES (?, ?, 0, 0, ?)
  `).bind(productId, initialStock, initialSampleStock).run();

  return json({
    success: true,
    product: {
      id: productId,
      name,
      slug: rawSlug,
      priceRupees: pricePaise ? pricePaise / 100 : null,
      quantityAvailable: initialStock,
    }
  }, 201);
}
