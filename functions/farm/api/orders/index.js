// POST /farm/api/orders — Final order placement with atomic inventory reservation and WhatsApp notification.
// GET  /farm/api/orders — Customer order history or admin order lookup.

import { json, fail, readJson, clientIp, rateLimit, istToday } from '../_lib/http.js';
import { str, phone, email, id, cartItems } from '../_lib/validate.js';
import { getUser } from '../_lib/auth.js';
import { formatOrderWaMessage, dispatchWhatsAppNotification, DEFAULT_ADMIN_WHATSAPP } from '../_lib/whatsapp.js';

export async function onRequestPost({ request, env }) {
  if (!env?.DB) {
    return json({ success: false, error: 'Database not bound.' }, 500);
  }

  // Rate limit orders from the same IP: 10 per hour
  const ip = clientIp(request);
  await rateLimit(env.DB, `order:${ip}`, 10, 3600);

  const body = await readJson(request);
  const user = await getUser(request, env);

  // 1. Validate customer information
  const customerName = str(body.customer_name || user?.name, { label: 'Full name', min: 2, max: 80, required: true });
  const customerPhone = phone(body.customer_phone || user?.phone, { label: 'Phone number', required: true });
  const customerEmail = email(body.customer_email || user?.email, { required: false });
  const deliveryAreaId = id(body.delivery_area_id, 'Delivery Area');
  const deliveryAddress = str(body.delivery_address, { label: 'Delivery Address', min: 5, max: 300, required: true });
  const customerNote = str(body.customer_note, { label: 'Notes', max: 300, required: false });
  const items = cartItems(body.items || [], { maxItems: 15, allowEmpty: false });

  // 2. Validate Delivery Area
  const area = await env.DB.prepare(
    'SELECT id, name, city, is_active, delivery_charge_paise, minimum_order_paise FROM farm_delivery_areas WHERE id = ?'
  ).bind(deliveryAreaId).first();

  if (!area || !area.is_active) {
    fail(400, 'Delivery is currently unavailable in the selected area.');
  }

  // 3 & 4 & 5. Retrieve products, prices, and stock from DB
  const productIds = items.map(i => i.product_id);
  const placeholders = productIds.map(() => '?').join(',');

  const query = `
    SELECT 
      p.id,
      p.name,
      p.slug,
      p.price_per_kg_paise,
      p.unit,
      p.is_available,
      p.is_archived,
      COALESCE(i.quantity_available, 0) as quantity_available
    FROM farm_products p
    LEFT JOIN farm_inventory i ON p.id = i.product_id
    WHERE p.id IN (${placeholders})
  `;

  const { results: dbProducts } = await env.DB.prepare(query).bind(...productIds).all();
  const dbMap = new Map((dbProducts || []).map(p => [p.id, p]));

  // Check stock and calculate authoritative prices
  let subtotalPaise = 0;
  const itemSnapshots = [];

  for (const item of items) {
    const p = dbMap.get(item.product_id);
    if (!p || p.is_archived || !p.is_available || p.price_per_kg_paise === null) {
      fail(400, `"${p?.name || 'A selected product'}" is currently not available for purchase.`);
    }

    if (item.quantity > p.quantity_available) {
      fail(409, `Only ${p.quantity_available} kg of ${p.name} is currently available in stock. Please adjust your quantity.`);
    }

    const priceSnapshotPaise = p.price_per_kg_paise;
    const lineTotalPaise = priceSnapshotPaise * item.quantity;
    subtotalPaise += lineTotalPaise;

    itemSnapshots.push({
      productId: p.id,
      productName: p.name,
      priceSnapshotPaise,
      quantity: item.quantity,
      unit: p.unit || 'kg',
      lineTotalPaise,
    });
  }

  // Minimum order check
  if (subtotalPaise < (area.minimum_order_paise || 0)) {
    const minRs = (area.minimum_order_paise / 100);
    fail(400, `Minimum order for ${area.name} is ₹${minRs}. Please add more produce.`);
  }

  const deliveryChargePaise = area.delivery_charge_paise || 0;
  const grandTotalPaise = subtotalPaise + deliveryChargePaise;

  // 9. Generate unique daily order number: FD-GWL-YYYYMMDD-XXXX
  const today = istToday();
  const dayClean = today.replace(/-/g, '');

  await env.DB.prepare(
    `INSERT INTO farm_order_counters (day, seq) VALUES (?, 1)
     ON CONFLICT(day) DO UPDATE SET seq = seq + 1`
  ).bind(today).run();

  const counter = await env.DB.prepare(
    'SELECT seq FROM farm_order_counters WHERE day = ?'
  ).bind(today).first();

  const seqNumber = String(counter?.seq || 1).padStart(4, '0');
  const orderNumber = `FD-GWL-${dayClean}-${seqNumber}`;

  // 10 & 11. Atomic transaction using D1 batch:
  // - Deduct available stock & increment reserved stock with atomic check
  // - Insert order record
  // - Insert order items with price snapshots
  // - Insert inventory log
  const batchStatements = [];

  // Stock deduction statements
  for (const item of itemSnapshots) {
    batchStatements.push(
      env.DB.prepare(`
        UPDATE farm_inventory 
        SET quantity_available = quantity_available - ?1,
            quantity_reserved = quantity_reserved + ?1,
            updated_at = datetime('now')
        WHERE product_id = ?2 AND quantity_available >= ?1
      `).bind(item.quantity, item.productId)
    );

    batchStatements.push(
      env.DB.prepare(`
        INSERT INTO farm_inventory_log (product_id, change_type, delta_kg, reference, note)
        VALUES (?, 'ORDER_RESERVE', ?, ?, 'Customer pre-order placed')
      `).bind(item.productId, -item.quantity, orderNumber)
    );
  }

  // Order insert statement
  batchStatements.push(
    env.DB.prepare(`
      INSERT INTO farm_orders (
        order_number,
        user_id,
        customer_name,
        customer_phone,
        customer_email,
        delivery_area_id,
        delivery_area_name_snapshot,
        delivery_address,
        customer_note,
        status,
        inventory_state,
        subtotal_paise,
        delivery_charge_paise,
        discount_paise,
        grand_total_paise,
        payment_method,
        payment_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 'RESERVED', ?, ?, 0, ?, 'PAY_ON_DELIVERY', 'UNPAID')
    `).bind(
      orderNumber,
      user?.id || null,
      customerName,
      customerPhone,
      customerEmail || null,
      area.id,
      area.name,
      deliveryAddress,
      customerNote || null,
      subtotalPaise,
      deliveryChargePaise,
      grandTotalPaise
    )
  );

  // Execute the atomic batch
  const batchResults = await env.DB.batch(batchStatements);

  // Verify that all stock updates affected rows
  // If an update affected 0 rows, it means another customer reserved the stock concurrently!
  let stockFailure = false;
  for (let i = 0; i < itemSnapshots.length; i++) {
    const updateResult = batchResults[i * 2]; // first of the pair is the update
    if (updateResult.meta.changes === 0) {
      stockFailure = true;
      break;
    }
  }

  if (stockFailure) {
    // Roll back the order if stock update did not succeed
    await env.DB.prepare('DELETE FROM farm_orders WHERE order_number = ?').bind(orderNumber).run();
    fail(409, 'Some requested quantities are no longer available. Please review your order and try again.');
  }

  // Get the newly created order ID
  const createdOrder = await env.DB.prepare(
    'SELECT id, created_at FROM farm_orders WHERE order_number = ?'
  ).bind(orderNumber).first();

  const orderId = createdOrder.id;

  // Insert order items
  const itemInserts = itemSnapshots.map(item =>
    env.DB.prepare(`
      INSERT INTO farm_order_items (
        order_id, product_id, product_name_snapshot, price_snapshot_paise, quantity, unit, line_total_paise
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      orderId,
      item.productId,
      item.productName,
      item.priceSnapshotPaise,
      item.quantity,
      item.unit,
      item.lineTotalPaise
    )
  );

  // Add initial status history record
  itemInserts.push(
    env.DB.prepare(`
      INSERT INTO farm_order_status_history (order_id, from_status, to_status, note)
      VALUES (?, NULL, 'PENDING', 'Pre-order created by customer')
    `).bind(orderId)
  );

  await env.DB.batch(itemInserts);

  // 12. WhatsApp Notification
  const waMessage = formatOrderWaMessage({
    orderNumber,
    customerName,
    customerPhone,
    customerEmail,
    deliveryAreaName: area.name,
    deliveryAddress,
    items: itemSnapshots.map(it => ({
      productName: it.productName,
      quantity: it.quantity,
      pricePaise: it.priceSnapshotPaise,
      lineTotalPaise: it.lineTotalPaise,
    })),
    subtotalPaise,
    deliveryChargePaise,
    grandTotalPaise,
    status: 'PENDING',
    createdAt: createdOrder.created_at,
  });

  const waDispatch = await dispatchWhatsAppNotification({
    db: env.DB,
    env,
    kind: 'ORDER',
    reference: orderNumber,
    recipientPhone: DEFAULT_ADMIN_WHATSAPP,
    message: waMessage,
  });

  return json({
    success: true,
    order: {
      id: orderId,
      orderNumber,
      customerName,
      customerPhone,
      deliveryAreaName: area.name,
      deliveryAddress,
      subtotalRupees: subtotalPaise / 100,
      deliveryChargeRupees: deliveryChargePaise / 100,
      grandTotalRupees: grandTotalPaise / 100,
      status: 'PENDING',
      paymentMethod: 'PAY_ON_DELIVERY',
      createdAt: createdOrder.created_at,
      items: itemSnapshots.map(it => ({
        productName: it.productName,
        quantity: it.quantity,
        unit: it.unit,
        priceRupees: it.priceSnapshotPaise / 100,
        lineTotalRupees: it.lineTotalPaise / 100,
      })),
      whatsapp: {
        clickToChatUrl: waDispatch.clickToChatUrl,
        status: waDispatch.status,
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
    fail(401, 'Please log in to view your orders.');
  }

  const query = `
    SELECT 
      id,
      order_number,
      delivery_area_name_snapshot,
      delivery_address,
      status,
      subtotal_paise,
      delivery_charge_paise,
      grand_total_paise,
      payment_method,
      payment_status,
      created_at
    FROM farm_orders
    WHERE user_id = ?
    ORDER BY created_at DESC
  `;

  const { results: orders } = await env.DB.prepare(query).bind(user.id).all();

  return json({
    success: true,
    orders: (orders || []).map(o => ({
      id: o.id,
      orderNumber: o.order_number,
      deliveryArea: o.delivery_area_name_snapshot,
      deliveryAddress: o.delivery_address,
      status: o.status,
      subtotalRupees: o.subtotal_paise / 100,
      deliveryChargeRupees: o.delivery_charge_paise / 100,
      grandTotalRupees: o.grand_total_paise / 100,
      paymentMethod: o.payment_method,
      paymentStatus: o.payment_status,
      createdAt: o.created_at,
    }))
  });
}
