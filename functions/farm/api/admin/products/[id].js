// PUT /farm/api/admin/products/:id — Edit product, price, sample availability, or archive.
import { json, fail, readJson } from '../../_lib/http.js';
import { str, slug as toSlug, int, bool, rupeesToPaise } from '../../_lib/validate.js';
import { requireAdmin } from '../../_lib/auth.js';

export async function onRequestPut({ request, env, params }) {
  await requireAdmin(request, env);

  const productId = Number(params.id);
  if (!Number.isInteger(productId) || productId <= 0) {
    fail(400, 'Invalid product ID.');
  }

  const existing = await env.DB.prepare('SELECT * FROM farm_products WHERE id = ?').bind(productId).first();
  if (!existing) {
    fail(404, 'Product not found.');
  }

  const body = await readJson(request);

  const name = body.name !== undefined ? str(body.name, { label: 'Product name', min: 2, max: 100, required: true }) : existing.name;
  const slug = body.slug !== undefined ? toSlug(body.slug) : existing.slug;
  const localName = body.local_name !== undefined ? str(body.local_name, { max: 80 }) : existing.local_name;
  const description = body.description !== undefined ? str(body.description, { max: 1000, multiline: true }) : existing.description;
  const label = body.label !== undefined ? str(body.label, { max: 60 }) : existing.label;
  
  let pricePaise = existing.price_per_kg_paise;
  if (body.price_per_kg_rupees !== undefined) {
    pricePaise = body.price_per_kg_rupees === null || body.price_per_kg_rupees === ''
      ? null
      : rupeesToPaise(body.price_per_kg_rupees, { label: 'Price per kg', allowZero: false });
  }

  const isAvailable = body.is_available !== undefined ? (bool(body.is_available) ? 1 : 0) : existing.is_available;
  const isSeasonal = body.is_seasonal !== undefined ? (bool(body.is_seasonal) ? 1 : 0) : existing.is_seasonal;
  const isArchived = body.is_archived !== undefined ? (bool(body.is_archived) ? 1 : 0) : existing.is_archived;
  const sampleAvailable = body.sample_available !== undefined ? (bool(body.sample_available) ? 1 : 0) : existing.sample_available;
  const sampleMaxQuantityGrams = body.sample_max_quantity_grams !== undefined
    ? int(body.sample_max_quantity_grams, { min: 100, max: 200 })
    : existing.sample_max_quantity_grams;
  const imageUrl = body.image_url !== undefined ? str(body.image_url, { max: 300 }) : existing.image_url;
  const imageAlt = body.image_alt !== undefined ? str(body.image_alt, { max: 200 }) : existing.image_alt;

  // Check unique slug if changed
  if (slug !== existing.slug) {
    const slugCheck = await env.DB.prepare('SELECT id FROM farm_products WHERE slug = ? AND id != ?').bind(slug, productId).first();
    if (slugCheck) {
      fail(409, 'Another product with this slug already exists.');
    }
  }

  await env.DB.prepare(`
    UPDATE farm_products SET
      name = ?,
      slug = ?,
      local_name = ?,
      description = ?,
      label = ?,
      price_per_kg_paise = ?,
      is_available = ?,
      is_seasonal = ?,
      is_archived = ?,
      sample_available = ?,
      sample_max_quantity_grams = ?,
      image_url = ?,
      image_alt = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).bind(
    name, slug, localName, description, label, pricePaise,
    isAvailable, isSeasonal, isArchived, sampleAvailable,
    sampleMaxQuantityGrams, imageUrl, imageAlt, productId
  ).run();

  return json({
    success: true,
    message: 'Product updated successfully.'
  });
}
