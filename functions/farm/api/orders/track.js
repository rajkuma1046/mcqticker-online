// GET /farm/api/orders/track — Public tracking for orders and samples with phone / order number verification
import { json, fail } from '../_lib/http.js';

export async function onRequestGet({ request, env }) {
  if (!env?.DB) {
    return json({ success: false, error: 'Database not bound.' }, 500);
  }

  const url = new URL(request.url);
  const orderNumber = (url.searchParams.get('order_number') || '').trim().toUpperCase();
  const phone = (url.searchParams.get('phone') || '').replace(/\D/g, '').slice(-10);

  if (!orderNumber && !phone) {
    fail(400, 'Please enter an Order Number or Mobile Number to track.');
  }

  let order = null;
  let sampleRequests = [];

  if (orderNumber) {
    order = await env.DB.prepare(`
      SELECT 
        o.id,
        o.order_number,
        o.customer_name,
        o.customer_phone,
        o.delivery_area_name_snapshot,
        o.delivery_address,
        o.status,
        o.subtotal_paise,
        o.delivery_charge_paise,
        o.grand_total_paise,
        o.payment_method,
        o.payment_status,
        o.created_at,
        o.updated_at,
        da.delivery_day
      FROM farm_orders o
      LEFT JOIN farm_delivery_areas da ON o.delivery_area_id = da.id
      WHERE o.order_number = ?
    `).bind(orderNumber).first();

    // If phone was also provided, verify match
    if (order && phone && !order.customer_phone.endsWith(phone)) {
      fail(403, 'Mobile number does not match this order.');
    }
  }

  // Fetch items if order found
  let items = [];
  let timeline = [];
  if (order) {
    const { results: rawItems } = await env.DB.prepare(`
      SELECT product_name_snapshot, quantity, unit, price_snapshot_paise, line_total_paise
      FROM farm_order_items WHERE order_id = ?
    `).bind(order.id).all();

    items = (rawItems || []).map(i => ({
      name: i.product_name_snapshot,
      quantity: i.quantity,
      unit: i.unit,
      priceRupees: i.price_snapshot_paise / 100,
      lineTotalRupees: i.line_total_paise / 100,
    }));

    const { results: rawHist } = await env.DB.prepare(`
      SELECT from_status, to_status, note, created_at
      FROM farm_order_status_history WHERE order_id = ? ORDER BY created_at ASC
    `).bind(order.id).all();

    timeline = rawHist || [];
  }

  // If phone was provided, also fetch customer's sample requests
  if (phone) {
    const { results: rawSamples } = await env.DB.prepare(`
      SELECT 
        sr.id,
        sr.product_name_snapshot,
        sr.sample_quantity_grams,
        sr.status,
        sr.requested_at,
        sr.fulfilled_at,
        da.name as delivery_area_name,
        r.round_name,
        r.delivery_date as round_date
      FROM farm_sample_requests sr
      LEFT JOIN farm_delivery_areas da ON sr.delivery_area_id = da.id
      LEFT JOIN farm_sample_delivery_rounds r ON sr.scheduled_round_id = r.id
      WHERE sr.phone LIKE ?
      ORDER BY sr.requested_at DESC
      LIMIT 10
    `).bind(`%${phone}`).all();

    sampleRequests = (rawSamples || []).map(s => ({
      id: s.id,
      productName: s.product_name_snapshot,
      quantityGrams: s.sample_quantity_grams,
      areaName: s.delivery_area_name,
      status: s.status,
      requestedAt: s.requested_at,
      roundName: s.round_name,
      roundDate: s.round_date,
    }));
  }

  if (!order && sampleRequests.length === 0) {
    fail(404, 'No orders or sample requests found with these details.');
  }

  return json({
    success: true,
    order: order ? {
      orderNumber: order.order_number,
      customerName: order.customer_name,
      maskedPhone: order.customer_phone.replace(/(\d{2})\d{6}(\d{2})/, '$1******$2'),
      deliveryArea: order.delivery_area_name_snapshot,
      deliveryAddress: order.delivery_address,
      deliveryDay: order.delivery_day || 'Scheduled round',
      status: order.status,
      grandTotalRupees: order.grand_total_paise / 100,
      paymentMethod: order.payment_method,
      paymentStatus: order.payment_status,
      createdAt: order.created_at,
      items,
      timeline,
    } : null,
    sampleRequests,
  });
}
