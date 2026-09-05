import { json, hashPassword, signJWT, getAuthCookieHeader } from './_utils.js';

export async function onRequestPost({ request, env }) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return json({ error: 'Email and password are required.' }, 400);
    }

    if (!env?.DB) {
      return json({ error: 'Database not bound.' }, 500);
    }

    const user = await env.DB.prepare('SELECT id, email, password_hash, salt FROM users WHERE email = ?').bind(email).first();
    
    if (!user) {
      return json({ error: 'Invalid email or password.' }, 401);
    }

    const passwordHash = await hashPassword(password, user.salt);

    if (passwordHash !== user.password_hash) {
      return json({ error: 'Invalid email or password.' }, 401);
    }

    const secret = env.JWT_SECRET || 'default_fallback_secret_123';
    const token = await signJWT({ id: user.id, email: user.email }, secret);

    return json(
      { user: { id: user.id, email: user.email }, token }, 
      200, 
      { 'Set-Cookie': getAuthCookieHeader(token, request) }
    );
  } catch (err) {
    console.error('Login error:', err);
    return json({ error: 'Internal server error.' }, 500);
  }
}
