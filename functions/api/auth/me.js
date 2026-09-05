import { json, getAuthUser } from './_utils.js';

export async function onRequestGet({ request, env }) {
  try {
    const user = await getAuthUser(request, env);
    if (!user) {
      return json({ authenticated: false, user: null });
    }
    return json({ authenticated: true, user });
  } catch (err) {
    console.error('Me error:', err);
    return json({ authenticated: false, user: null });
  }
}

