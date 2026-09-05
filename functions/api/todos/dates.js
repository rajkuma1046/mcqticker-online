import { json, getAuthUser } from '../auth/_utils.js';

export async function onRequestGet({ request, env }) {
  const user = await getAuthUser(request, env);
  if (!user) return json({ error: 'Not authenticated' }, 401);
  if (!env?.DB) return json({ error: 'Database not bound.' }, 500);

  try {
    const { results } = await env.DB.prepare(
      'SELECT DISTINCT date FROM todos WHERE user_id = ?'
    ).bind(user.id).all();

    return json({ dates: results.map(r => r.date) });
  } catch (err) {
    console.error('Fetch dates error:', err);
    return json({ error: 'Internal server error.' }, 500);
  }
}
