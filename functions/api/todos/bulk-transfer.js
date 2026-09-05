import { json, getAuthUser } from '../auth/_utils.js';

// POST /api/todos/bulk-transfer
// Body: { target_date: "YYYY-MM-DD" }
// Transfers all overdue incomplete tasks to the specified target date.
export async function onRequestPost({ request, env }) {
  const user = await getAuthUser(request, env);
  if (!user) return json({ error: 'Not authenticated' }, 401);
  if (!env?.DB) return json({ error: 'Database not bound.' }, 500);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body.' }, 400); }

  const { target_date } = body;
  if (!target_date) return json({ error: 'target_date is required.' }, 400);

  try {
    // Get all overdue incomplete tasks
    const { results } = await env.DB.prepare(
      'SELECT id, date FROM todos WHERE user_id = ? AND date < ? AND is_completed = 0'
    ).bind(user.id, target_date).all();

    if (!results || results.length === 0) {
      return json({ transferred: 0, ids: [] });
    }

    // Batch update all overdue tasks to the target date
    const ids = results.map(r => r.id);
    const previousDates = results.map(r => ({ id: r.id, date: r.date }));

    // D1 doesn't support batch bind with IN clause well, so we loop
    for (const id of ids) {
      await env.DB.prepare(
        'UPDATE todos SET date = ? WHERE id = ? AND user_id = ?'
      ).bind(target_date, id, user.id).run();
    }

    return json({ transferred: ids.length, ids, previousDates });
  } catch (err) {
    console.error('Bulk transfer error:', err);
    return json({ error: 'Internal server error.' }, 500);
  }
}
