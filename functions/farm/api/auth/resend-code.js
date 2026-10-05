// POST /farm/api/auth/resend-code — Resend verification OTP code with cooldown check.
import { json, fail, readJson, clientIp, rateLimit } from '../_lib/http.js';
import { email, oneOf } from '../_lib/validate.js';
import { createVerification } from '../_lib/verification.js';
import { sendVerificationEmail } from '../_lib/email.js';

export async function onRequestPost({ request, env }) {
  if (!env?.DB) {
    return json({ success: false, error: 'Database not bound.' }, 500);
  }

  const ip = clientIp(request);
  await rateLimit(env.DB, `resend:${ip}`, 6, 3600);

  const body = await readJson(request);
  const rawEmail = email(body.email, { required: true });
  const purpose = oneOf(body.purpose, ['register', 'reset_password'], 'Purpose');

  // Check if a recent code was created for this email & purpose within the last 45 seconds
  const recent = await env.DB.prepare(`
    SELECT id, payload, created_at FROM farm_email_verifications
    WHERE email = ? AND purpose = ? AND is_used = 0
    ORDER BY id DESC LIMIT 1
  `).bind(rawEmail, purpose).first();

  let preservedPayload = null;
  if (recent) {
    const ageSeconds = (Date.now() - new Date(recent.created_at).getTime()) / 1000;
    if (ageSeconds < 45) {
      fail(429, `Please wait ${Math.ceil(45 - ageSeconds)} seconds before requesting another code.`);
    }
    try {
      preservedPayload = recent.payload ? JSON.parse(recent.payload) : null;
    } catch (_) {}
  }

  // Create new verification code
  const { code } = await createVerification(env.DB, {
    email: rawEmail,
    purpose,
    payload: preservedPayload,
    expiryMinutes: 10,
  });

  const emailRes = await sendVerificationEmail({
    to: rawEmail,
    code,
    purpose,
    env
  });

  return json({
    success: true,
    message: `A new verification code was sent to ${rawEmail}.`,
    debugCode: emailRes.unconfigured ? code : undefined,
  }, 200);
}
