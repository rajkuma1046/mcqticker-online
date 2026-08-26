import { json, parseCookies, verifyJWT } from './_utils.js';

export async function onRequestGet({ request, env }) {
  try {
    const cookies = parseCookies(request);
    const token = cookies['auth_token'];

    if (!token) {
      return json({ authenticated: false, user: null });
    }

    const secret = env.JWT_SECRET || 'default_fallback_secret_123';
    const payload = await verifyJWT(token, secret);

    if (!payload || !payload.id || !payload.email) {
      return json({ authenticated: false, user: null });
    }

    return json({ authenticated: true, user: { id: payload.id, email: payload.email } });
  } catch (err) {
    console.error('Me error:', err);
    return json({ authenticated: false, user: null });
  }
}
