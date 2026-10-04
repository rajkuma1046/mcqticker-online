// POST /farm/api/samples — Request a free 100g / 200g sample.
// GET  /farm/api/samples — Customer's own sample requests.

import { json, fail, readJson, clientIp, rateLimit } from '../_lib/http.js';
import { str, phone, email, id, oneOf } from '../_lib/validate.js';
import { getUser } from '../_lib/auth.js';
import { formatSampleWaMessage, dispatchWhatsAppNotification, DEFAULT_ADMIN_WHATSAPP } from '../_lib/whatsapp.js';

export async function onRequestPost({ request, env }) {
  if (!env?.DB) {
    return json({ success: false, error: 'Database not bound.' }, 500);
  }

  // Rate limit: 5 sample requests per hour per IP
  const ip = clientIp(request);
  await rateLimit(env.DB, `sample:${ip}`, 5, 3600);

  const body = await readJson(request);
  const user = await getUser(request, env);

  const customerName = str(body.customer_name || body.name || user?.name, { label: 'Full name', min: 2, max: 80, required: true });
  const customerPhone = phone(body.customer_phone || body.phone || user?.phone, { label: 'Mobile number', required: true });
  const customerEmail = email(body.customer_email || body.email || user?.email, { required: false });
  const productId = id(body.product_id, 'Product');
  const sampleQuantityGrams = Number(oneOf(body.sample_quantity_grams, [100, 200, '100', '200'], 'Sample quantity'));
  const deliveryAreaId = id(body.delivery_area_id, 'Delivery Area');
  const deliveryAddress = str(body.delivery_address || body.address, { label: 'Delivery Address', min: 5, max: 300, required: true });
  const customerNote = str(body.customer_note, { label: 'Note', max: 300, required: false });

  // 1. Verify Product Eligibility
  const product = await env.DB.prepare(`
    SELECT p.*, COALESCE(i.sample_stock_grams, 0) as sample_stock_grams
    FROM farm_products p
    LEFT JOIN farm_inventory i ON p.id = i.product_id
    WHERE p.id = ? AND p.is_archived = 0
  `).bind(productId).first();

  if (!product || !product.sample_available) {
    fail(400, 'Free samples are currently not available for this product.');
  }

  if (sampleQuantityGrams > product.sample_max_quantity_grams) {
    fail(400, `Maximum sample quantity for ${product.name} is ${product.sample_max_quantity_grams} grams.`);
  }

  // 2. Verify Delivery Area
  const area = await env.DB.prepare(
    'SELECT id, name, city, is_active FROM farm_delivery_areas WHERE id = ?'
  ).bind(deliveryAreaId).first();

  if (!area || !area.is_active) {
    fail(400, 'Sample delivery is currently unavailable in the selected area.');
  }

  // 3. Find active sample delivery round for this area (if any planned)
  const round = await env.DB.prepare(`
    SELECT id, round_name, delivery_date, status
    FROM farm_sample_delivery_rounds
    WHERE delivery_area_id = ? AND status IN ('PLANNED', 'OPEN')
    ORDER BY delivery_date ASC
    LIMIT 1
  `).bind(deliveryAreaId).first();

  // 4. Abuse Prevention Checks
  // Check cooldown & limits:
  // Rule: Max 1 sample of the same product per customer per round
  const existingSameProduct = await env.DB.prepare(`
    SELECT id FROM farm_sample_requests
    WHERE phone = ? AND product_id = ? AND status NOT IN ('CANCELLED', 'DECLINED')
    ORDER BY requested_at DESC
    LIMIT 1
  `).bind(customerPhone, productId).first();

  if (existingSameProduct) {
    fail(400, `You have already requested a sample of ${product.name}. Samples are limited to 1 per household per season.`);
  }

  // Rule: Max 2 sample requests total per customer across all products within 14 days
  const recentSamplesCount = await env.DB.prepare(`
    SELECT COUNT(*) as cnt FROM farm_sample_requests
    WHERE phone = ? AND status NOT IN ('CANCELLED', 'DECLINED')
      AND datetime(requested_at) > datetime('now', '-14 days')
  `).bind(customerPhone).first();

  if (recentSamplesCount && recentSamplesCount.cnt >= 2) {
    fail(400, 'To ensure fair distribution, samples are limited to 2 items per household every 14 days.');
  }

  // 5. Reserve sample stock atomically if available
  await env.DB.prepare(`
    UPDATE farm_inventory
    SET sample_stock_grams = MAX(0, sample_stock_grams - ?)
    WHERE product_id = ?
  `).bind(sampleQuantityGrams, productId).run();

  // 6. Insert sample request
  const insertResult = await env.DB.prepare(`
    INSERT INTO farm_sample_requests (
      user_id,
      customer_name,
      phone,
      email,
      product_id,
      product_name_snapshot,
      sample_quantity_grams,
      delivery_area_id,
      delivery_address,
      customer_note,
      status,
      stock_state,
      scheduled_round_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'REQUESTED', 'RESERVED', ?)
  `).bind(
    user?.id || null,
    customerName,
    customerPhone,
    customerEmail || null,
    productId,
    product.name,
    sampleQuantityGrams,
    deliveryAreaId,
    deliveryAddress,
    customerNote || null,
    round?.id || null
  ).run();

  const sampleId = insertResult.meta.last_row_id;

  // 7. Dispatch WhatsApp notification
  const waMessage = formatSampleWaMessage({
    customerName,
    customerPhone,
    productName: product.name,
    sampleQuantityGrams,
    deliveryAreaName: area.name,
    deliveryAddress,
    roundDateOrName: round ? `${round.delivery_date} (${round.round_name})` : 'Next Scheduled Gwalior Round',
    status: 'REQUESTED'
  });

  const waDispatch = await dispatchWhatsAppNotification({
    db: env.DB,
    env,
    kind: 'SAMPLE',
    reference: String(sampleId),
    recipientPhone: DEFAULT_ADMIN_WHATSAPP,
    message: waMessage,
  });

  return json({
    success: true,
    sample: {
      id: sampleId,
      productName: product.name,
      sampleQuantityGrams,
      deliveryArea: area.name,
      status: 'REQUESTED',
      scheduledRound: round ? {
        id: round.id,
        name: round.round_name,
        deliveryDate: round.delivery_date
      } : null,
      message: 'Sample request received. Sample distribution is conducted during scheduled sample-delivery rounds in selected areas.',
      whatsapp: {
        clickToChatUrl: waDispatch.clickToChatUrl,
      }
    }
  }, 201);
}

export async function onRequestGet({ request, env }) {
  if (!env?.DB) {
    return json({ success: false, error: 'Database not bound.' }, 500);
  }

  const user = await getUser(request, env);
  if (!user) {
    fail(401, 'Please log in to view your sample requests.');
  }

  const query = `
    SELECT 
      sr.id,
      sr.product_name_snapshot,
      sr.sample_quantity_grams,
      sr.delivery_address,
      sr.status,
      sr.requested_at,
      sr.fulfilled_at,
      a.name as delivery_area_name,
      r.round_name,
      r.delivery_date as round_date
    FROM farm_sample_requests sr
    LEFT JOIN farm_delivery_areas a ON sr.delivery_area_id = a.id
    LEFT JOIN farm_sample_delivery_rounds r ON sr.scheduled_round_id = r.id
    WHERE sr.user_id = ? OR sr.phone = ?
    ORDER BY sr.requested_at DESC
  `;

  const { results: samples } = await env.DB.prepare(query).bind(user.id, user.phone).all();

  return json({
    success: true,
    sampleRequests: (samples || []).map(s => ({
      id: s.id,
      productName: s.product_name_snapshot,
      quantityGrams: s.sample_quantity_grams,
      deliveryArea: s.delivery_area_name,
      deliveryAddress: s.delivery_address,
      status: s.status,
      requestedAt: s.requested_at,
      fulfilledAt: s.fulfilled_at,
      roundName: s.round_name,
      roundDate: s.round_date,
    }))
  });
}
