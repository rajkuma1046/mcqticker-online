// POST /farm/api/auth/forgot-password — Request password reset OTP code sent to user email.
import { json, fail, readJson, clientIp, rateLimit } from '../_lib/http.js';
import { str } from '../_lib/validate.js';
import { createVerification } from '../_lib/verification.js';
import { sendVerificationEmail } from '../_lib/email.js';

function maskEmail(email) {
  const [user, domain] = email.split('@');
  if (!domain) return email;
  if (user.length <= 2) return `${user[0]}*@${domain}`;
  return `${user[0]}${'*'.repeat(user.length - 2)}${user[user.length - 1]}@${domain}`;
}

export async function onRequestPost({ request, env }) {
  if (!env?.DB) {
    return json({ success: false, error: 'Database not bound.' }, 500);
  }

  // Rate limit: 8 requests per hour per IP
  const ip = clientIp(request);
  await rateLimit(env.DB, `forgot:${ip}`, 8, 3600);

  const body = await readJson(request);
  const identifier = str(body.identifier || body.email || body.phone, {
    label: 'Email or Mobile Number',
    min: 3,
    max: 120,
    required: true
  });

  const cleanPhone = identifier.replace(/\D/g, '').replace(/^91/, '').replace(/^0/, '');
  const isPhone = /^[6-9]\d{9}$/.test(cleanPhone);

  let user = null;
  if (isPhone) {
    user = await env.DB.prepare(
      'SELECT id, name, phone, email, is_active FROM farm_users WHERE phone = ?'
    ).bind(cleanPhone).first();
  } else {
    user = await env.DB.prepare(
      'SELECT id, name, phone, email, is_active FROM farm_users WHERE email = ? COLLATE NOCASE'
    ).bind(identifier.trim().toLowerCase()).first();
  }

  if (!user || !user.is_active) {
    fail(404, 'No active customer account found with this mobile number or email.');
  }

  // Create 6-digit OTP code for password reset
  const { code } = await createVerification(env.DB, {
    email: user.email,
    purpose: 'reset_password',
    payload: { userId: user.id },
    expiryMinutes: 10,
  });

  // Automatically dispatch email from Gmail
  const emailRes = await sendVerificationEmail({
    to: user.email,
    code,
    purpose: 'reset_password',
    env
  });

  const masked = maskEmail(user.email);

  return json({
    success: true,
    email: user.email,
    maskedEmail: masked,
    message: `Password reset code sent to ${masked}. Please check your inbox.`,
    debugCode: emailRes.unconfigured ? code : undefined,
  }, 200);
}
