// GET /farm/api/orders/:id — Retrieve order details, snapshots, and timeline.
import { json, fail } from '../_lib/http.js';
import { getUser } from '../_lib/auth.js';

export async function onRequestGet({ request, env, params }) {
  if (!env?.DB) {
    return json({ success: false, error: 'Database not bound.' }, 500);
  }

  const orderIdentifier = String(params.id || '').trim();
  if (!orderIdentifier) {
    fail(400, 'Order number or ID is required.');
  }

  const url = new URL(request.url);
  const verifyPhone = url.searchParams.get('phone');
  const user = await getUser(request, env);

  // Fetch the order
  const order = await env.DB.prepare(`
    SELECT 
      o.*,
      a.delivery_day
    FROM farm_orders o
    LEFT JOIN farm_delivery_areas a ON o.delivery_area_id = a.id
    WHERE o.order_number = ?1 OR CAST(o.id AS TEXT) = ?1
    LIMIT 1
  `).bind(orderIdentifier).first();

  if (!order) {
    fail(404, 'Order not found.');
  }

  // Security check: Only allow access if:
  // 1. User is an ADMIN
  // 2. User is logged in and owns the order (user.id === order.user_id)
  // 3. Request provides the matching phone number used when placing the order
  const isAdmin = user && user.role === 'ADMIN';
  const isOwner = user && order.user_id && user.id === order.user_id;
  const isPhoneVerified = verifyPhone && String(order.customer_phone).endsWith(verifyPhone.replace(/\D/g, '').slice(-10));

  if (!isAdmin && !isOwner && !isPhoneVerified) {
    fail(403, 'You do not have access to view this order. Please provide your registered mobile number.');
  }

  // Fetch items
  const { results: items } = await env.DB.prepare(`
    SELECT 
      oi.id,
      oi.product_id,
      oi.product_name_snapshot,
      oi.price_snapshot_paise,
      oi.quantity,
      oi.unit,
      oi.line_total_paise,
      p.image_url,
      p.slug
    FROM farm_order_items oi
    LEFT JOIN farm_products p ON oi.product_id = p.id
    WHERE oi.order_id = ?
    ORDER BY oi.id ASC
  `).bind(order.id).all();

  // Fetch status history timeline
  const { results: history } = await env.DB.prepare(`
    SELECT 
      from_status,
      to_status,
      note,
      created_at
    FROM farm_order_status_history
    WHERE order_id = ?
    ORDER BY created_at ASC
  `).bind(order.id).all();

  return json({
    success: true,
    order: {
      id: order.id,
      orderNumber: order.order_number,
      customerName: order.customer_name,
      customerPhone: order.customer_phone,
      customerEmail: order.customer_email,
      deliveryArea: order.delivery_area_name_snapshot,
      deliveryAddress: order.delivery_address,
      deliveryDay: order.delivery_day || 'Scheduled round',
      customerNote: order.customer_note,
      status: order.status,
      subtotalRupees: order.subtotal_paise / 100,
      deliveryChargeRupees: order.delivery_charge_paise / 100,
      grandTotalRupees: order.grand_total_paise / 100,
      paymentMethod: order.payment_method,
      paymentStatus: order.payment_status,
      createdAt: order.created_at,
      updatedAt: order.updated_at,
      items: (items || []).map(i => ({
        id: i.id,
        productId: i.product_id,
        name: i.product_name_snapshot,
        priceRupees: i.price_snapshot_paise / 100,
        quantity: i.quantity,
        unit: i.unit,
        lineTotalRupees: i.line_total_paise / 100,
        imageUrl: i.image_url,
        slug: i.slug,
      })),
      timeline: history || [],
    }
  });
}
