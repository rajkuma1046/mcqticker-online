// POST /farm/api/orders/:id/cancel — Customer self-service order cancellation
import { json, fail, readJson } from '../../_lib/http.js';
import { getUser } from '../../_lib/auth.js';
import { sendAdminNotificationEmail } from '../../_lib/email.js';

export async function onRequestPost({ request, env, params }) {
  if (!env?.DB) {
    return json({ success: false, error: 'Database not bound.' }, 500);
  }

  const user = await getUser(request, env);
  if (!user) {
    fail(401, 'Please log in to manage your orders.');
  }

  const orderId = Number(params.id);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    fail(400, 'Invalid order ID.');
  }

  const body = await readJson(request).catch(() => ({}));
  const reason = (body?.reason || 'Cancelled by customer').trim().slice(0, 250);

  // Fetch target order
  const order = await env.DB.prepare(`
    SELECT 
      id,
      order_number,
      user_id,
      customer_name,
      customer_phone,
      customer_email,
      delivery_area_name_snapshot,
      delivery_address,
      status,
      inventory_state,
      grand_total_paise,
      created_at
    FROM farm_orders
    WHERE id = ?
  `).bind(orderId).first();

  if (!order) {
    fail(404, 'Order not found.');
  }

  // Verify ownership
  if (order.user_id !== user.id) {
    fail(403, 'You are not authorized to cancel this order.');
  }

  // Verify cancellable status
  if (order.status === 'CANCELLED') {
    return json({ success: true, message: 'This order is already cancelled.' });
  }

  if (!['PENDING', 'CONFIRMED'].includes(order.status)) {
    fail(400, `This order is currently "${order.status}" and cannot be cancelled online. Please contact our farm team directly on WhatsApp (+91 8770767272).`);
  }

  // Fetch items to restore reserved stock
  const { results: items } = await env.DB.prepare(`
    SELECT product_id, quantity 
    FROM farm_order_items 
    WHERE order_id = ?
  `).bind(orderId).all();

  const batch = [];
  let newInventoryState = order.inventory_state;

  if (order.inventory_state === 'RESERVED') {
    for (const it of items || []) {
      batch.push(
        env.DB.prepare(`
          UPDATE farm_inventory
          SET quantity_available = quantity_available + ?,
              quantity_reserved = MAX(0, quantity_reserved - ?),
              updated_at = datetime('now')
          WHERE product_id = ?
        `).bind(it.quantity, it.quantity, it.product_id)
      );

      batch.push(
        env.DB.prepare(`
          INSERT INTO farm_inventory_log (product_id, change_type, delta_kg, reference, note, admin_user_id)
          VALUES (?, 'ORDER_CANCEL', ?, ?, 'Customer self-cancellation — inventory released', NULL)
        `).bind(it.product_id, it.quantity, order.order_number)
      );
    }
    newInventoryState = 'RELEASED';
  }

  // Update order status
  batch.push(
    env.DB.prepare(`
      UPDATE farm_orders
      SET status = 'CANCELLED',
          inventory_state = ?,
          admin_note = CASE 
            WHEN admin_note IS NULL OR admin_note = '' THEN ?
            ELSE admin_note || ' | ' || ?
          END,
          updated_at = datetime('now')
      WHERE id = ?
    `).bind(newInventoryState, `Cancelled by customer: ${reason}`, `Cancelled by customer: ${reason}`, orderId)
  );

  // Record history event
  batch.push(
    env.DB.prepare(`
      INSERT INTO farm_order_status_history (order_id, from_status, to_status, changed_by, note)
      VALUES (?, ?, 'CANCELLED', ?, ?)
    `).bind(orderId, order.status, user.id, `Customer cancelled: ${reason}`)
  );

  await env.DB.batch(batch);

  // Send Admin Notification Email (rajkuma1046@gmail.com)
  sendAdminNotificationEmail({
    event: `⚠️ Order Cancelled by Customer #${order.order_number}`,
    details: {
      'Order Number': order.order_number,
      'Customer Name': user.name || order.customer_name,
      'Mobile Phone': user.phone || order.customer_phone,
      'Customer Email': user.email || order.customer_email || 'None',
      'Cancellation Reason': reason,
      'Order Total': `₹${order.grand_total_paise / 100}`,
      'Delivery Cluster': order.delivery_area_name_snapshot,
      'Cancelled At': new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    },
    env,
  }).catch(err => console.error('[Order Cancellation Admin Alert Error]:', err));

  return json({
    success: true,
    message: `Order #${order.order_number} has been cancelled successfully.`,
    orderNumber: order.order_number,
    status: 'CANCELLED'
  });
}
