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
    console.error('[todos/dates] Auth check failed:', err);
  }
  return null;
}

export async function onRequestGet({ request, env }) {
  const user = await getAuthUser(request);
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
