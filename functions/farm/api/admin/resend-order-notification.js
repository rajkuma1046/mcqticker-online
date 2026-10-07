// GET /farm/api/admin/resend-order-notification — Dispatches admin email for a specific or latest order
import { json } from '../_lib/http.js';
import { sendAdminNotificationEmail } from '../_lib/email.js';

export async function onRequestGet({ request, env }) {
  if (!env?.DB) return json({ error: 'DB not bound' }, 500);

  const url = new URL(request.url);
  const targetId = url.searchParams.get('id') || '12';

  const order = await env.DB.prepare(`
    SELECT * FROM farm_orders WHERE id = ?
  `).bind(targetId).first();

  if (!order) return json({ error: 'Order not found' }, 404);

  const { results: items } = await env.DB.prepare(`
    SELECT * FROM farm_order_items WHERE order_id = ?
  `).bind(order.id).all();

  const produceItemsFormatted = (items || []).map(it => 
    `${it.product_name_snapshot}: ${it.quantity} ${it.unit} (₹${it.line_total_paise / 100})`
  ).join(' | ');

  const res = await sendAdminNotificationEmail({
    event: `New Order Received #${order.order_number}`,
    details: {
      'Order Number': order.order_number,
      'Customer Name': order.customer_name,
      'Mobile Number': order.customer_phone,
      'Customer Email': order.customer_email || 'Not provided',
      'Delivery Area': order.delivery_area_name_snapshot,
      'Delivery Address': order.delivery_address,
      'Produce Items': produceItemsFormatted,
      'Produce Subtotal': `₹${order.subtotal_paise / 100}`,
      'Delivery Fee': `₹${order.delivery_charge_paise / 100}`,
      'Grand Total': `₹${order.grand_total_paise / 100}`,
      'Payment Mode': 'Cash on Doorstep / UPI',
      'Placed At': order.created_at + ' (Recorded)',
    },
    env,
  });

  return json({
    success: res.success,
    provider: res.provider,
    orderNumber: order.order_number,
    customerName: order.customer_name,
    deliveredTo: 'rajkuma1046@gmail.com'
  });
}
