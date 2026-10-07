// POST /farm/api/auth/reset-password — Verify reset OTP and update password.
import { json, fail, readJson, clientIp, rateLimit } from '../_lib/http.js';
import { email } from '../_lib/validate.js';
import { hashPassword, validatePassword, signSession, sessionCookie } from '../_lib/auth.js';
import { verifyCode } from '../_lib/verification.js';
import { sendAdminNotificationEmail } from '../_lib/email.js';

export async function onRequestPost({ request, env }) {
  if (!env?.DB) {
    return json({ success: false, error: 'Database not bound.' }, 500);
  }

  // Rate limit: 10 attempts per hour per IP
  const ip = clientIp(request);
  await rateLimit(env.DB, `reset:${ip}`, 10, 3600);

  const body = await readJson(request);
  const rawEmail = email(body.email, { required: true });
  const rawCode = String(body.code || '').trim();
  const newPassword = validatePassword(body.password || body.newPassword);

  // Verify OTP code
  const payload = await verifyCode(env.DB, {
    email: rawEmail,
    code: rawCode,
    purpose: 'reset_password',
  });

  const userId = payload?.userId;
  let user = null;
  if (userId) {
    user = await env.DB.prepare('SELECT id, name, phone, email, role FROM farm_users WHERE id = ? AND is_active = 1').bind(userId).first();
  } else {
    user = await env.DB.prepare('SELECT id, name, phone, email, role FROM farm_users WHERE email = ? COLLATE NOCASE AND is_active = 1').bind(rawEmail).first();
  }

  if (!user) {
    fail(404, 'Customer account not found.');
  }

  // Hash new password
  const passwordHash = await hashPassword(newPassword);

  // Update password in D1
  await env.DB.prepare(`
    UPDATE farm_users
    SET password_hash = ?, updated_at = datetime('now')
    WHERE id = ?
  `).bind(passwordHash, user.id).run();

  // Send admin notification
  await sendAdminNotificationEmail({
    event: 'Customer Password Reset Completed',
    details: {
      'Customer Name': user.name,
      'Email Address': user.email,
      'Mobile Number': user.phone,
      'Account ID': user.id,
      'Reset Time': new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      'Security Action': 'Password updated and new session issued',
    },
    env,
  }).catch(err => console.error('[Admin Notification Reset Password Error]:', err));

  // Sign session token so user is instantly logged in
  const token = await signSession(user.id, env);

  return json(
    { success: true, user, message: 'Password reset successfully! You are now logged in.' },
    200,
    { 'Set-Cookie': sessionCookie(token, request) }
  );
}
