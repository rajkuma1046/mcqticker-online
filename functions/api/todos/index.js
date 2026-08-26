import { json } from '../auth/_utils.js';

async function getAuthUser(request) {
  try {
    const origin = new URL(request.url).origin;
    const res = await fetch(`${origin}/api/auth/me`, {
      headers: { 'Cookie': request.headers.get('Cookie') || '' },
    });
    const data = await res.json();
    if (data.authenticated && data.user) return data.user;
  } catch (err) {
    console.error('[todos] Auth check failed:', err);
  }
  return null;
}

export async function onRequestGet({ request, env }) {
  const user = await getAuthUser(request);
  if (!user) return json({ error: 'Not authenticated' }, 401);
  if (!env?.DB) return json({ error: 'Database not bound.' }, 500);

  const url = new URL(request.url);
  const dateStr = url.searchParams.get('date');
  if (!dateStr) return json({ error: 'Date is required.' }, 400);

  try {
    const { results } = await env.DB.prepare(
      'SELECT id, user_id, date, task_text, is_completed, created_at FROM todos WHERE user_id = ? AND date = ? ORDER BY created_at ASC'
    ).bind(user.id, dateStr).all();

    return json({ todos: results.map(t => ({...t, is_completed: !!t.is_completed})) });
  } catch (err) {
    console.error('Fetch todos error:', err);
    return json({ error: 'Internal server error.' }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  const user = await getAuthUser(request);
  if (!user) return json({ error: 'Not authenticated' }, 401);
  if (!env?.DB) return json({ error: 'Database not bound.' }, 500);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body.' }, 400); }
  const { date, task_text } = body;
  if (!date || !task_text) return json({ error: 'Date and task_text are required.' }, 400);

  const todoId = crypto.randomUUID();
  const now = new Date().toISOString();

  try {
    await env.DB.prepare(
      'INSERT INTO todos (id, user_id, date, task_text, is_completed, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(todoId, user.id, date, task_text, 0, now).run();

    const todo = {
      id: todoId, user_id: user.id, date, task_text, is_completed: false, created_at: now
    };
    return json({ todo }, 201);
  } catch (err) {
    console.error('Add todo error:', err);
    return json({ error: 'Internal server error.' }, 500);
  }
}
