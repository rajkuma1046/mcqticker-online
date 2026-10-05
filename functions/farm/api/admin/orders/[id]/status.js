// PATCH /farm/api/admin/orders/:id/status — Update order status with atomic stock state management
import { json, fail, readJson } from '../../../_lib/http.js';
import { str, oneOf } from '../../../_lib/validate.js';
import { requireAdmin } from '../../../_lib/auth.js';
import { sendStatusUpdateEmail } from '../../../_lib/email.js';

const VALID_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'PREPARING',
  'READY_FOR_DELIVERY',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED'
];

export async function onRequestPatch({ request, env, params }) {
  const admin = await requireAdmin(request, env);
  const orderId = Number(params.id);

  if (!Number.isInteger(orderId) || orderId <= 0) {
    fail(400, 'Invalid order ID.');
  }

  const body = await readJson(request);
  const newStatus = oneOf(body.status, VALID_STATUSES, 'Order status');
  const note = str(body.note, { label: 'Note', max: 200, required: false });

  // Fetch current order
  const order = await env.DB.prepare(
    'SELECT id, order_number, status, inventory_state, payment_status, customer_email, customer_name FROM farm_orders WHERE id = ?'
  ).bind(orderId).first();

  if (!order) {
    fail(404, 'Order not found.');
  }

  if (order.status === newStatus) {
    return json({ success: true, message: 'Status is already set to ' + newStatus });
  }

  // Fetch order items to manage inventory
  const { results: items } = await env.DB.prepare(
    'SELECT product_id, quantity FROM farm_order_items WHERE order_id = ?'
  ).bind(orderId).all();

  const batch = [];

  // Handle stock transitions
  let newInventoryState = order.inventory_state;
  let newPaymentStatus = order.payment_status;

  if (newStatus === 'CANCELLED' && order.inventory_state === 'RESERVED') {
    // Release reserved stock back to available stock
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
          VALUES (?, 'ORDER_CANCEL', ?, ?, 'Order cancelled — stock restored', ?)
        `).bind(it.product_id, it.quantity, order.order_number, admin.id)
      );
    }
    newInventoryState = 'RELEASED';
  } else if (newStatus === 'DELIVERED' && order.inventory_state === 'RESERVED') {
    // Mark stock as sold
    for (const it of items || []) {
      batch.push(
        env.DB.prepare(`
          UPDATE farm_inventory
          SET quantity_sold = quantity_sold + ?,
              quantity_reserved = MAX(0, quantity_reserved - ?),
              updated_at = datetime('now')
          WHERE product_id = ?
        `).bind(it.quantity, it.quantity, it.product_id)
      );

      batch.push(
        env.DB.prepare(`
          INSERT INTO farm_inventory_log (product_id, change_type, delta_kg, reference, note, admin_user_id)
          VALUES (?, 'ORDER_DELIVERED', ?, ?, 'Order delivered — stock converted to sold', ?)
        `).bind(it.product_id, 0, order.order_number, admin.id)
      );
    }
    newInventoryState = 'SOLD';
    newPaymentStatus = 'PAID';
  }

  // Update order record
  batch.push(
    env.DB.prepare(`
      UPDATE farm_orders
      SET status = ?,
          inventory_state = ?,
          payment_status = ?,
          admin_note = COALESCE(?, admin_note),
          updated_at = datetime('now')
      WHERE id = ?
    `).bind(newStatus, newInventoryState, newPaymentStatus, note || null, orderId)
  );

  // Insert status history
  batch.push(
    env.DB.prepare(`
      INSERT INTO farm_order_status_history (order_id, from_status, to_status, changed_by, note)
      VALUES (?, ?, ?, ?, ?)
    `).bind(orderId, order.status, newStatus, admin.id, note || `Status updated to ${newStatus}`)
  );

  await env.DB.batch(batch);

  if (order.customer_email) {
    try {
      await sendStatusUpdateEmail({
        to: order.customer_email,
        order: {
          orderNumber: order.order_number,
          customerName: order.customer_name
        },
        newStatus,
        note,
        env
      });
    } catch (err) {
      console.error('Failed to send status update email:', err);
    }
  }

  return json({
    success: true,
    message: `Order status updated to ${newStatus}`,
    status: newStatus,
    inventoryState: newInventoryState,
  });
}
