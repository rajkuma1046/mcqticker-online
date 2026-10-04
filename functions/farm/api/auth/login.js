// POST /farm/api/auth/login — Customer & Admin login with PBKDF2 verification.
import { json, fail, readJson, clientIp, rateLimit } from '../_lib/http.js';
import { str } from '../_lib/validate.js';
import { verifyPassword, signSession, sessionCookie, publicUser } from '../_lib/auth.js';

export async function onRequestPost({ request, env }) {
  if (!env?.DB) {
    return json({ success: false, error: 'Database not bound.' }, 500);
  }

  // Rate limit: 15 login attempts per 15 mins per IP
  const ip = clientIp(request);
  await rateLimit(env.DB, `login:${ip}`, 15, 900);

  const body = await readJson(request);
  const identifier = str(body.identifier || body.email || body.phone, { label: 'Mobile or Email', min: 3, max: 120, required: true });
  const password = str(body.password, { label: 'Password', min: 1, max: 128, required: true });

  // Clean identifier for phone match or email match
  const digits = identifier.replace(/\D/g, '');
  let user = null;

  if (digits.length === 10) {
    user = await env.DB.prepare(
      'SELECT id, name, phone, email, password_hash, role, is_active FROM farm_users WHERE phone = ?'
    ).bind(digits).first();
  } else {
    user = await env.DB.prepare(
      'SELECT id, name, phone, email, password_hash, role, is_active FROM farm_users WHERE email = ? COLLATE NOCASE'
    ).bind(identifier.trim().toLowerCase()).first();
  }

  if (!user || !user.is_active) {
    fail(401, 'Invalid mobile/email or password.');
  }

  const isValid = await verifyPassword(password, user.password_hash);
  if (!isValid) {
    fail(401, 'Invalid mobile/email or password.');
  }

  // Sign session
  const token = await signSession(user.id, env);

  return json(
    {
      success: true,
      user: publicUser(user)
    },
    200,
    { 'Set-Cookie': sessionCookie(token, request) }
  );
}
