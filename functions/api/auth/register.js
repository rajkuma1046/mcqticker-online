import { json, generateSalt, hashPassword, signJWT, getAuthCookieHeader } from './_utils.js';

export async function onRequestPost({ request, env }) {
  try {
    const { email, password } = await request.json();

    if (!email || !password || password.length < 6) {
      return json({ error: 'Valid email and password (min 6 chars) are required.' }, 400);
    }

    if (!env?.DB) {
      return json({ error: 'Database not bound.' }, 500);
    }

    // Check if user exists
    const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (existing) {
      return json({ error: 'User with this email already exists.' }, 409);
    }

    const userId = crypto.randomUUID();
    const salt = generateSalt();
    const passwordHash = await hashPassword(password, salt);

    await env.DB.prepare(
      'INSERT INTO users (id, email, password_hash, salt) VALUES (?, ?, ?, ?)'
    ).bind(userId, email, passwordHash, salt).run();

    // Create JWT
    const secret = env.JWT_SECRET || 'default_fallback_secret_123';
    const token = await signJWT({ id: userId, email }, secret);

    return json(
      { user: { id: userId, email }, token }, 
      200, 
      { 'Set-Cookie': getAuthCookieHeader(token, request) }
    );
  } catch (err) {
    console.error('Register error:', err);
    return json({ error: 'Internal server error.' }, 500);
  }
}
