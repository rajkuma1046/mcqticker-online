// Farm Direct — authentication & authorisation.
// Passwords: PBKDF2-SHA256 (100k iterations — the Workers maximum) + random salt.
// Sessions: HMAC-SHA256 signed token in an HttpOnly cookie scoped to /farm.
// The user (and role) is re-read from D1 on every authenticated request, so
// disabling a user or revoking admin takes effect immediately.
import { fail, isHttps } from './http.js';

const COOKIE = 'fd_session';
const SESSION_DAYS = 30;
const PBKDF2_ITER = 100000;
const enc = new TextEncoder();

// ── encoding helpers ───────────────────────────────────────────────────────
function b64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ── secrets ───────────────────────────────────────────────────────────────
function getSecret(env) {
  const secret = env.FARM_JWT_SECRET || env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    console.error('[farm auth] FARM_JWT_SECRET (or JWT_SECRET) is missing or too short.');
    fail(503, 'Accounts are temporarily unavailable. Please continue as a guest.');
  }
  return secret;
}

// ── passwords ─────────────────────────────────────────────────────────────
async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITER);
  return `pbkdf2$${PBKDF2_ITER}$${b64url(salt)}$${b64url(hash)}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [algo, iterStr, saltStr, hashStr] = String(stored).split('$');
    if (algo !== 'pbkdf2') return false;
    const hash = await pbkdf2(password, b64urlDecode(saltStr), Number(iterStr));
    return timingSafeEqual(hash, b64urlDecode(hashStr));
  } catch {
    return false;
  }
}

export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) fail(400, 'Password must be at least 8 characters.');
  if (pw.length > 128) fail(400, 'Password is too long.');
  return pw;
}

// ── tokens ────────────────────────────────────────────────────────────────
async function hmacKey(secret, usage) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

export async function signSession(userId, env) {
  const header = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(enc.encode(JSON.stringify({ sub: userId, iat: now, exp: now + SESSION_DAYS * 86400, aud: 'farm' })));
  const data = `${header}.${payload}`;
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(getSecret(env), 'sign'), enc.encode(data));
  return `${data}.${b64url(new Uint8Array(sig))}`;
}

async function verifySession(token, env) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const ok = await crypto.subtle.verify(
    'HMAC', await hmacKey(getSecret(env), 'verify'), b64urlDecode(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`)
  );
  if (!ok) return null;
  const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
  if (payload.aud !== 'farm' || !payload.sub || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

// ── cookies ───────────────────────────────────────────────────────────────
function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

export function sessionCookie(token, request) {
  const secure = isHttps(request) ? '; Secure' : '';
  return `${COOKIE}=${token}; HttpOnly; Path=/farm; Max-Age=${SESSION_DAYS * 86400}; SameSite=Lax${secure}`;
}

export function clearSessionCookie(request) {
  const secure = isHttps(request) ? '; Secure' : '';
  return `${COOKIE}=; HttpOnly; Path=/farm; Max-Age=0; SameSite=Lax${secure}`;
}

// ── request user ──────────────────────────────────────────────────────────
/** Returns the logged-in user or null. Never throws for anonymous visitors. */
export async function getUser(request, env) {
  const token = readCookie(request, COOKIE);
  if (!token) return null;
  let payload = null;
  try {
    payload = await verifySession(token, env);
  } catch (e) {
    if (e?.status === 503) return null; // secret not configured → treat as anonymous
    return null;
  }
  if (!payload) return null;
  const user = await env.DB
    .prepare('SELECT id, name, phone, email, role, created_at FROM farm_users WHERE id = ? AND is_active = 1')
    .bind(payload.sub)
    .first();
  return user || null;
}

export async function requireUser(request, env) {
  const user = await getUser(request, env);
  if (!user) fail(401, 'Please log in to continue.');
  return user;
}

export async function requireAdmin(request, env) {
  const user = await getUser(request, env);
  if (!user) fail(401, 'Please log in to continue.');
  if (user.role !== 'ADMIN') fail(403, 'You do not have permission to access this page.');
  return user;
}

export function publicUser(u) {
  return u ? { id: u.id, name: u.name, phone: u.phone, email: u.email, role: u.role } : null;
}
