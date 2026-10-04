// POST /farm/api/auth/register — Customer registration with PBKDF2 hashing & session cookie.
import { json, fail, readJson, clientIp, rateLimit } from '../_lib/http.js';
import { str, phone, email } from '../_lib/validate.js';
import { hashPassword, validatePassword, signSession, sessionCookie, publicUser } from '../_lib/auth.js';

export async function onRequestPost({ request, env }) {
  if (!env?.DB) {
    return json({ success: false, error: 'Database not bound.' }, 500);
  }

  // Rate limit: 10 registrations per hour per IP
  const ip = clientIp(request);
  await rateLimit(env.DB, `reg:${ip}`, 10, 3600);

  const body = await readJson(request);

  const name = str(body.name, { label: 'Full name', min: 2, max: 80, required: true });
  const rawPhone = phone(body.phone, { label: 'Mobile number', required: true });
  const rawEmail = email(body.email, { required: true });
  const password = validatePassword(body.password);

  // Check uniqueness
  const existing = await env.DB.prepare(
    'SELECT id, phone, email FROM farm_users WHERE phone = ? OR email = ?'
  ).bind(rawPhone, rawEmail).first();

  if (existing) {
    if (existing.phone === rawPhone) {
      fail(409, 'An account with this mobile number already exists. Please log in.');
    } else {
      fail(409, 'An account with this email address already exists. Please log in.');
    }
  }

  // Hash password
  const passwordHash = await hashPassword(password);

  // Insert user
  const result = await env.DB.prepare(`
    INSERT INTO farm_users (name, phone, email, password_hash, role, is_active)
    VALUES (?, ?, ?, ?, 'CUSTOMER', 1)
  `).bind(name, rawPhone, rawEmail, passwordHash).run();

  const userId = result.meta.last_row_id;
  const user = { id: userId, name, phone: rawPhone, email: rawEmail, role: 'CUSTOMER' };

  // Sign session token
  const token = await signSession(userId, env);

  return json(
    { success: true, user },
    201,
    { 'Set-Cookie': sessionCookie(token, request) }
  );
}
