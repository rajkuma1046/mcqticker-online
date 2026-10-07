// POST /farm/api/samples — Request a free 100g / 200g sample.
// GET  /farm/api/samples — Customer's own sample requests.

import { json, fail, readJson, clientIp, rateLimit } from '../_lib/http.js';
import { str, phone, email, id, oneOf } from '../_lib/validate.js';
import { getUser } from '../_lib/auth.js';
import { formatSampleWaMessage, dispatchWhatsAppNotification, DEFAULT_ADMIN_WHATSAPP } from '../_lib/whatsapp.js';
import { sendAdminNotificationEmail } from '../_lib/email.js';

export async function onRequestPost({ request, env }) {
  if (!env?.DB) {
    return json({ success: false, error: 'Database not bound.' }, 500);
  }

  // Rate limit: 20 sample requests per hour per IP
  const ip = clientIp(request);
  await rateLimit(env.DB, `sample:${ip}`, 20, 3600);

  const body = await readJson(request);
  const user = await getUser(request, env);

  const customerName = str(body.customer_name || body.name || user?.name, { label: 'Full name', min: 2, max: 80, required: true });
  const customerPhone = phone(body.customer_phone || body.phone || user?.phone, { label: 'Mobile number', required: true });
  const customerEmail = email(body.customer_email || body.email || user?.email, { required: false });
  const rawAreaId = body.delivery_area_id;
  const customClusterName = str(body.custom_delivery_area || body.custom_cluster, { label: 'Custom Colony', max: 120, required: false });
  const deliveryAddress = str(body.delivery_address || body.address, { label: 'Delivery Address', min: 5, max: 300, required: true });
  const customerNote = str(body.customer_note, { label: 'Note', max: 300, required: false });

  // Parse items: array of { product_id, sample_quantity_grams }
  let requestedItems = [];
  if (Array.isArray(body.items) && body.items.length > 0) {
    requestedItems = body.items.map(it => ({
      productId: id(it.product_id || it.productId, 'Product'),
      sampleQuantityGrams: Number(oneOf(it.sample_quantity_grams || it.sampleQuantityGrams, [100, 200, '100', '200'], 'Sample quantity'))
    }));
  } else if (body.product_id) {
    requestedItems = [{
      productId: id(body.product_id, 'Product'),
      sampleQuantityGrams: Number(oneOf(body.sample_quantity_grams, [100, 200, '100', '200'], 'Sample quantity'))
    }];
  } else {
    fail(400, 'Please select at least one produce sample.');
  }

  // Check unique products in batch
  const productSet = new Set();
  for (const it of requestedItems) {
    if (productSet.has(it.productId)) {
      fail(400, 'Each produce sample can only be selected once per request.');
    }
    productSet.add(it.productId);
  }

  const batchGrams = requestedItems.reduce((acc, it) => acc + it.sampleQuantityGrams, 0);
  if (batchGrams > 500) {
    fail(400, `Total sample quantity cannot exceed 500g per request (Current: ${batchGrams}g).`);
  }

  // 1. Check user total grams limit (Max 500g total per customer in last 30 days)
  const pastGramsRow = await env.DB.prepare(`
    SELECT COALESCE(SUM(sample_quantity_grams), 0) as total_grams
    FROM farm_sample_requests
    WHERE phone = ? AND status NOT IN ('CANCELLED', 'DECLINED')
      AND datetime(requested_at) > datetime('now', '-30 days')
  `).bind(customerPhone).first();

  const userPastGrams = Number(pastGramsRow?.total_grams || 0);
  if (userPastGrams + batchGrams > 500) {
    const remaining = Math.max(0, 500 - userPastGrams);
    fail(400, `To ensure fair distribution, samples are limited to 500g total per customer. You have already requested ${userPastGrams}g (Remaining quota: ${remaining}g).`);
  }

  // 2. Verify Delivery Area (Existing Area or Custom Cluster)
  let area = null;
  if (rawAreaId && rawAreaId !== 'custom' && Number(rawAreaId) > 0) {
    area = await env.DB.prepare(
      'SELECT id, name, city, is_active FROM farm_delivery_areas WHERE id = ?'
    ).bind(Number(rawAreaId)).first();
  }

  if (!area && customClusterName) {
    const cleanName = customClusterName.trim();
    const existing = await env.DB.prepare(
      'SELECT id, name, city, is_active FROM farm_delivery_areas WHERE LOWER(name) = LOWER(?) LIMIT 1'
    ).bind(cleanName).first();

    if (existing) {
      area = existing;
    } else {
      const insArea = await env.DB.prepare(`
        INSERT INTO farm_delivery_areas (name, city, delivery_day, delivery_charge_paise, minimum_order_paise, is_active, sort_order)
        VALUES (?, 'Gwalior / Shivpuri', 'Scheduled Cluster Round', 0, 0, 1, 99)
      `).bind(cleanName).run();

      area = {
        id: insArea.meta.last_row_id,
        name: cleanName,
        city: 'Gwalior / Shivpuri',
        is_active: 1,
      };
    }
  }

  if (!area || !area.is_active) {
    fail(400, 'Please select a delivery cluster or enter your colony / area name.');
  }

  const deliveryAreaId = area.id;

  // 3. Find active sample delivery round for this area (if any planned)
  const round = await env.DB.prepare(`
    SELECT id, round_name, delivery_date, status
    FROM farm_sample_delivery_rounds
    WHERE delivery_area_id = ? AND status IN ('PLANNED', 'OPEN')
    ORDER BY delivery_date ASC
    LIMIT 1
  `).bind(deliveryAreaId).first();

  // 4. Validate all products and check for product-level repeats
  const validatedProducts = [];
  for (const item of requestedItems) {
    const product = await env.DB.prepare(`
      SELECT p.*, COALESCE(i.sample_stock_grams, 0) as sample_stock_grams
      FROM farm_products p
      LEFT JOIN farm_inventory i ON p.id = i.product_id
      WHERE p.id = ? AND p.is_archived = 0
    `).bind(item.productId).first();

    if (!product || !product.sample_available) {
      fail(400, `Free samples are currently not available for ${product ? product.name : 'one of the selected items'}.`);
    }

    if (item.sampleQuantityGrams > product.sample_max_quantity_grams) {
      fail(400, `Maximum sample quantity for ${product.name} is ${product.sample_max_quantity_grams} grams.`);
    }

    // Check repeat of same product
    const existingSame = await env.DB.prepare(`
      SELECT id FROM farm_sample_requests
      WHERE phone = ? AND product_id = ? AND status NOT IN ('CANCELLED', 'DECLINED')
        AND datetime(requested_at) > datetime('now', '-30 days')
      LIMIT 1
    `).bind(customerPhone, item.productId).first();

    if (existingSame) {
      fail(400, `You have already requested a sample of ${product.name} recently. Samples of the same product are limited to 1 per household per season.`);
    }

    validatedProducts.push({
      product,
      sampleQuantityGrams: item.sampleQuantityGrams
    });
  }

  // 5. Reserve inventory and insert sample requests
  const insertedSamples = [];
  for (const vp of validatedProducts) {
    // Reserve stock atomically
    await env.DB.prepare(`
      UPDATE farm_inventory
      SET sample_stock_grams = MAX(0, sample_stock_grams - ?)
      WHERE product_id = ?
    `).bind(vp.sampleQuantityGrams, vp.product.id).run();

    // Insert sample request
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
      vp.product.id,
      vp.product.name,
      vp.sampleQuantityGrams,
      deliveryAreaId,
      deliveryAddress,
      customerNote || null,
      round?.id || null
    ).run();

    insertedSamples.push({
      id: insertResult.meta.last_row_id,
      productId: vp.product.id,
      productName: vp.product.name,
      sampleQuantityGrams: vp.sampleQuantityGrams
    });
  }

  // 6. Unified WhatsApp Notification
  const waItems = insertedSamples.map(s => ({
    productName: s.productName,
    sampleQuantityGrams: s.sampleQuantityGrams
  }));

  const waMessage = formatSampleWaMessage({
    customerName,
    customerPhone,
    items: waItems,
    totalGrams: batchGrams,
    deliveryAreaName: area.name,
    deliveryAddress,
    roundDateOrName: round ? `${round.delivery_date} (${round.round_name})` : 'Next Scheduled Gwalior Round',
    status: 'REQUESTED'
  });

  const waDispatch = await dispatchWhatsAppNotification({
    db: env.DB,
    env,
    kind: 'SAMPLE',
    reference: String(insertedSamples[0].id),
    recipientPhone: DEFAULT_ADMIN_WHATSAPP,
    message: waMessage,
  });

  // Admin Notification Email (rajkuma1046@gmail.com) - Await to ensure SMTP socket finishes
  await sendAdminNotificationEmail({
    event: `New Free Sample Request (Batch #${insertedSamples[0].id})`,
    details: {
      'Customer Name': customerName,
      'Mobile Number': customerPhone,
      'Customer Email': customerEmail || 'Not provided',
      'Delivery Cluster': `${area.name} (${area.city || 'MP'})`,
      'Delivery Address': deliveryAddress,
      'Sample Items': waItems.map(it => `${it.name} (${it.quantityGrams}g)`).join(', '),
      'Total Grams': `${batchGrams}g`,
      'Scheduled Round': round ? `${round.delivery_date} (${round.round_name})` : 'Next scheduled trip',
      'Request Time': new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    },
    env,
  }).catch(err => console.error('[Admin Notification Sample Error]:', err));

  return json({
    success: true,
    samplesCount: insertedSamples.length,
    totalGrams: batchGrams,
    sampleRequests: insertedSamples,
    sampleRequest: {
      id: insertedSamples[0].id,
      productName: insertedSamples.map(s => `${s.productName} (${s.sampleQuantityGrams}g)`).join(', '),
      sampleQuantityGrams: batchGrams,
      deliveryArea: area.name,
      status: 'REQUESTED',
      scheduledRound: round ? {
        id: round.id,
        name: round.round_name,
        deliveryDate: round.delivery_date
      } : null,
      whatsappUrl: waDispatch.clickToChatUrl
    },
    message: `Sample request received for ${insertedSamples.length} items (${batchGrams}g total). Delivery during scheduled rounds in ${area.name}.`,
    whatsapp: {
      clickToChatUrl: waDispatch.clickToChatUrl
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
