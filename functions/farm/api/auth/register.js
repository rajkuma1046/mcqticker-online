// POST /farm/api/auth/register — Customer registration with Email OTP verification & PBKDF2 hashing.
import { json, fail, readJson, clientIp, rateLimit } from '../_lib/http.js';
import { str, phone, email } from '../_lib/validate.js';
import { hashPassword, validatePassword, signSession, sessionCookie } from '../_lib/auth.js';
import { createVerification, verifyCode } from '../_lib/verification.js';
import { sendVerificationEmail, sendAdminNotificationEmail } from '../_lib/email.js';

export async function onRequestPost({ request, env }) {
  if (!env?.DB) {
    return json({ success: false, error: 'Database not bound.' }, 500);
  }

  // Rate limit: 15 registration requests per hour per IP
  const ip = clientIp(request);
  await rateLimit(env.DB, `reg:${ip}`, 15, 3600);

  const body = await readJson(request);

  // STEP 2: Verify Code & Complete Registration
  if (body.code) {
    const rawEmail = email(body.email, { required: true });
    const payload = await verifyCode(env.DB, {
      email: rawEmail,
      code: body.code,
      purpose: 'register'
    });

    if (!payload || !payload.name || !payload.phone || !payload.passwordHash) {
      fail(400, 'Registration session expired. Please register again.');
    }

    const { name, phone: rawPhone, passwordHash } = payload;

    // Check uniqueness one last time
    const existing = await env.DB.prepare(
      'SELECT id FROM farm_users WHERE phone = ? OR email = ?'
    ).bind(rawPhone, rawEmail).first();

    if (existing) {
      fail(409, 'An account with this mobile or email already exists. Please log in.');
    }

    // Insert verified user
    const result = await env.DB.prepare(`
      INSERT INTO farm_users (name, phone, email, password_hash, role, is_active)
      VALUES (?, ?, ?, ?, 'CUSTOMER', 1)
    `).bind(name, rawPhone, rawEmail, passwordHash).run();

    const userId = result.meta.last_row_id;
    const user = { id: userId, name, phone: rawPhone, email: rawEmail, role: 'CUSTOMER' };

    // Send admin notification
    sendAdminNotificationEmail({
      event: 'New Customer Account Created',
      details: {
        'Customer Name': name,
        'Email Address': rawEmail,
        'Mobile Number': rawPhone,
        'Account ID': userId,
        'Timestamp': new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
      },
      env
    }).catch(err => console.error('[Admin Notification Register Error]:', err));

    // Sign session token
    const token = await signSession(userId, env);

    return json(
      { success: true, verified: true, user, message: 'Account verified and created successfully!' },
      201,
      { 'Set-Cookie': sessionCookie(token, request) }
    );
  }

  // STEP 1: Validate initial registration data and send OTP code
  const name = str(body.name, { label: 'Full name', min: 2, max: 80, required: true });
  const rawPhone = phone(body.phone, { label: 'Mobile number', required: true });
  const rawEmail = email(body.email, { required: true });
  const password = validatePassword(body.password);

  // Check uniqueness before sending code
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

  // Hash password in advance to save inside verification payload
  const passwordHash = await hashPassword(password);

  // Create 6-digit OTP verification code
  const { code } = await createVerification(env.DB, {
    email: rawEmail,
    purpose: 'register',
    payload: { name, phone: rawPhone, passwordHash },
    expiryMinutes: 10,
  });

  // Automatically dispatch email from Gmail
  const emailRes = await sendVerificationEmail({
    to: rawEmail,
    code,
    purpose: 'register',
    env
  });

  return json({
    success: true,
    requireVerification: true,
    email: rawEmail,
    message: `Verification code sent to ${rawEmail}. Please check your inbox.`,
    debugCode: emailRes.unconfigured ? code : undefined,
  }, 200);
}
