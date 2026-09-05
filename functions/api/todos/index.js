import { json, getAuthUser } from '../auth/_utils.js';

function parseTodo(t) {
  return {
    ...t,
    is_completed: !!t.is_completed,
    sub_tasks: t.sub_tasks ? (typeof t.sub_tasks === 'string' ? JSON.parse(t.sub_tasks) : t.sub_tasks) : [],
    priority: t.priority || 'normal',
    due_time: t.due_time || null,
  };
}

export async function onRequestGet({ request, env }) {
  const user = await getAuthUser(request, env);
  if (!user) return json({ error: 'Not authenticated' }, 401);
  if (!env?.DB) return json({ error: 'Database not bound.' }, 500);

  const url = new URL(request.url);
  const dateStr = url.searchParams.get('date');
  const overdue = url.searchParams.get('overdue');

  try {
    // Overdue mode: return all incomplete tasks before today
    if (overdue === 'true') {
      const today = new Date().toISOString().split('T')[0];
      const { results } = await env.DB.prepare(
        'SELECT id, user_id, date, task_text, is_completed, created_at, due_time, priority, sub_tasks FROM todos WHERE user_id = ? AND date < ? AND is_completed = 0 ORDER BY date ASC, created_at ASC'
      ).bind(user.id, today).all();

      return json({ todos: (results || []).map(parseTodo) });
    }

    // Normal mode: return tasks for a specific date
    if (!dateStr) return json({ error: 'Date is required.' }, 400);

    const { results } = await env.DB.prepare(
      'SELECT id, user_id, date, task_text, is_completed, created_at, due_time, priority, sub_tasks FROM todos WHERE user_id = ? AND date = ? ORDER BY created_at ASC'
    ).bind(user.id, dateStr).all();

    return json({ todos: (results || []).map(parseTodo) });
  } catch (err) {
    console.error('Fetch todos error:', err);
    return json({ error: 'Internal server error.' }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  const user = await getAuthUser(request, env);
  if (!user) return json({ error: 'Not authenticated' }, 401);
  if (!env?.DB) return json({ error: 'Database not bound.' }, 500);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body.' }, 400); }
  const { date, task_text, due_time, priority, sub_tasks } = body;
  if (!date || !task_text) return json({ error: 'Date and task_text are required.' }, 400);

  const todoId = crypto.randomUUID();
  const now = new Date().toISOString();
  const safePriority = priority || 'normal';
  const safeSubTasks = sub_tasks ? JSON.stringify(sub_tasks) : '[]';
  const safeDueTime = due_time || null;

  try {
    await env.DB.prepare(
      'INSERT INTO todos (id, user_id, date, task_text, is_completed, created_at, due_time, priority, sub_tasks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(todoId, user.id, date, task_text, 0, now, safeDueTime, safePriority, safeSubTasks).run();

    const todo = {
      id: todoId, user_id: user.id, date, task_text, is_completed: false, created_at: now,
      due_time: safeDueTime, priority: safePriority, sub_tasks: sub_tasks || [],
    };
    return json({ todo }, 201);
  } catch (err) {
    console.error('Add todo error:', err);
    return json({ error: 'Internal server error.' }, 500);
  }
}
