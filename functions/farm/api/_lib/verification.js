// Farm Direct — Verification code management (OTP generator, storage, validation)
import { fail } from './http.js';

export function generateOtpCode() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  // 6 digits: 100000 to 999999
  const code = (100000 + (buf[0] % 900000)).toString();
  return code;
}

export async function ensureVerificationsTable(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS farm_email_verifications (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      email       TEXT    NOT NULL COLLATE NOCASE,
      code        TEXT    NOT NULL,
      purpose     TEXT    NOT NULL,
      payload     TEXT,
      attempts    INTEGER NOT NULL DEFAULT 0,
      is_used     INTEGER NOT NULL DEFAULT 0,
      expires_at  TEXT    NOT NULL,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `).run();
}

/**
 * Creates an unexpired verification code for an email and purpose.
 * Automatically invalidates previous active codes for this email + purpose.
 */
export async function createVerification(db, { email, purpose, payload = null, expiryMinutes = 10 }) {
  await ensureVerificationsTable(db);
  const cleanEmail = String(email || '').trim().toLowerCase();
  const code = generateOtpCode();

  // Invalidate older unused codes for this email and purpose
  await db.prepare(`
    UPDATE farm_email_verifications
    SET is_used = 1
    WHERE email = ? AND purpose = ? AND is_used = 0
  `).bind(cleanEmail, purpose).run();

  // Calculate expiry in ISO format
  const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000).toISOString();

  await db.prepare(`
    INSERT INTO farm_email_verifications (email, code, purpose, payload, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    cleanEmail,
    code,
    purpose,
    payload ? JSON.stringify(payload) : null,
    expiresAt
  ).run();

  return { code, expiresAt };
}

/**
 * Verifies that the submitted code matches an active, unexpired record.
 * Returns the parsed payload upon success, or throws an HttpError.
 */
export async function verifyCode(db, { email, code, purpose }) {
  await ensureVerificationsTable(db);
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanCode = String(code || '').trim();

  if (!cleanCode || cleanCode.length !== 6) {
    fail(400, 'Please enter a valid 6-digit verification code.');
  }

  const row = await db.prepare(`
    SELECT id, code, payload, attempts, expires_at
    FROM farm_email_verifications
    WHERE email = ? AND purpose = ? AND is_used = 0
    ORDER BY id DESC LIMIT 1
  `).bind(cleanEmail, purpose).first();

  if (!row) {
    fail(400, 'Verification code has expired or is invalid. Please request a new code.');
  }

  // Check expiration
  const isExpired = new Date(row.expires_at).getTime() < Date.now();
  if (isExpired) {
    await db.prepare('UPDATE farm_email_verifications SET is_used = 1 WHERE id = ?').bind(row.id).run();
    fail(400, 'Verification code has expired. Please request a new code.');
  }

  // Check attempts
  if (row.attempts >= 5) {
    await db.prepare('UPDATE farm_email_verifications SET is_used = 1 WHERE id = ?').bind(row.id).run();
    fail(400, 'Too many incorrect attempts. Please request a new verification code.');
  }

  if (row.code !== cleanCode) {
    await db.prepare('UPDATE farm_email_verifications SET attempts = attempts + 1 WHERE id = ?').bind(row.id).run();
    const remaining = 5 - (row.attempts + 1);
    fail(400, `Incorrect verification code. ${remaining > 0 ? `${remaining} attempts remaining.` : 'Please request a new code.'}`);
  }

  // Mark as used
  await db.prepare('UPDATE farm_email_verifications SET is_used = 1 WHERE id = ?').bind(row.id).run();

  let parsedPayload = null;
  if (row.payload) {
    try {
      parsedPayload = JSON.parse(row.payload);
    } catch (_) {}
  }

  return parsedPayload;
}
