import { json, getAuthUser } from '../auth/_utils.js';

export async function onRequestPut({ request, env, params }) {
  const user = await getAuthUser(request, env);
  if (!user) return json({ error: 'Not authenticated' }, 401);
  if (!env?.DB) return json({ error: 'Database not bound.' }, 500);

  const { id } = params;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body.' }, 400); }

  try {
    const existing = await env.DB.prepare('SELECT id FROM todos WHERE id = ? AND user_id = ?').bind(id, user.id).first();
    if (!existing) return json({ error: 'Todo not found.' }, 404);

    const updates = [];
    const values = [];
    if (body.task_text !== undefined) {
      updates.push('task_text = ?');
      values.push(body.task_text);
    }
    if (body.is_completed !== undefined) {
      updates.push('is_completed = ?');
      values.push(body.is_completed ? 1 : 0);
    }
    if (body.date !== undefined) {
      updates.push('date = ?');
      values.push(body.date);
    }
    if (body.due_time !== undefined) {
      updates.push('due_time = ?');
      values.push(body.due_time);
    }
    if (body.priority !== undefined) {
      updates.push('priority = ?');
      values.push(body.priority);
    }
    if (body.sub_tasks !== undefined) {
      updates.push('sub_tasks = ?');
      values.push(JSON.stringify(body.sub_tasks));
    }

    if (updates.length > 0) {
      values.push(id, user.id);
      await env.DB.prepare(`UPDATE todos SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).bind(...values).run();
    }

    return json({ success: true });
  } catch (err) {
    console.error('Update todo error:', err);
    return json({ error: 'Internal server error.' }, 500);
  }
}

export async function onRequestDelete({ request, env, params }) {
  const user = await getAuthUser(request, env);
  if (!user) return json({ error: 'Not authenticated' }, 401);
  if (!env?.DB) return json({ error: 'Database not bound.' }, 500);

  const { id } = params;
  
  try {
    const existing = await env.DB.prepare('SELECT id FROM todos WHERE id = ? AND user_id = ?').bind(id, user.id).first();
    if (!existing) return json({ error: 'Todo not found.' }, 404);

    await env.DB.prepare('DELETE FROM todos WHERE id = ? AND user_id = ?').bind(id, user.id).run();

    return json({ success: true });
  } catch (err) {
    console.error('Delete todo error:', err);
    return json({ error: 'Internal server error.' }, 500);
  }
}
