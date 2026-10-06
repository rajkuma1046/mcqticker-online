// GET   /farm/api/admin/reviews — List all reviews (with approval status)
// PATCH /farm/api/admin/reviews — Toggle approval status or update review
// DELETE /farm/api/admin/reviews — Delete review

import { json, fail, readJson } from '../../_lib/http.js';
import { requireAdmin } from '../../_lib/auth.js';

export async function onRequestGet({ request, env }) {
  await requireAdmin(request, env);

  if (!env?.DB) {
    fail(500, 'Database not bound.');
  }

  const { results: reviews } = await env.DB.prepare(`
    SELECT 
      id, user_id, order_id, product_id, product_name,
      customer_name, customer_phone, customer_city,
      rating, title, review_text, photo_url,
      is_verified, is_approved, created_at
    FROM farm_reviews
    ORDER BY created_at DESC
  `).all();

  return json({
    success: true,
    reviews: reviews || []
  });
}

export async function onRequestPatch({ request, env }) {
  await requireAdmin(request, env);

  if (!env?.DB) {
    fail(500, 'Database not bound.');
  }

  const body = await readJson(request);
  const id = Number(body.id);
  if (!id) fail(400, 'Review ID required.');

  if (typeof body.is_approved !== 'undefined') {
    const isApproved = body.is_approved ? 1 : 0;
    await env.DB.prepare(`
      UPDATE farm_reviews
      SET is_approved = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(isApproved, id).run();

    return json({ success: true, message: `Review approval status updated to ${isApproved}.` });
  }

  return json({ success: true });
}

export async function onRequestDelete({ request, env }) {
  await requireAdmin(request, env);

  if (!env?.DB) {
    fail(500, 'Database not bound.');
  }

  const url = new URL(request.url);
  const id = Number(url.searchParams.get('id'));
  if (!id) fail(400, 'Review ID required.');

  await env.DB.prepare('DELETE FROM farm_reviews WHERE id = ?').bind(id).run();

  return json({ success: true, message: 'Review deleted successfully.' });
}
