// Farm Direct — shared HTTP helpers for Pages Functions.
// Files in _lib export no onRequest* handlers, so they never become routes.

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

/** Error carrying a safe, customer-facing message. Caught by _middleware.js. */
export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function fail(status, message, extra = {}) {
  throw new HttpError(status, message, extra);
}

export async function readJson(request, maxBytes = 32 * 1024) {
  const text = await request.text();
  if (text.length > maxBytes) fail(413, 'Request is too large.');
  if (!text) return {};
  try {
    const data = JSON.parse(text);
    if (data === null || typeof data !== 'object' || Array.isArray(data)) fail(400, 'Invalid request.');
    return data;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    fail(400, 'Invalid request.');
  }
}

export function clientIp(request) {
  return (
    request.headers.get('CF-Connecting-IP') ||
    (request.headers.get('X-Forwarded-For') || '').split(',')[0].trim() ||
    'local'
  );
}

export function isHttps(request) {
  return new URL(request.url).protocol === 'https:';
}

/**
 * Simple fixed-window rate limiter backed by D1.
 * @param {D1Database} db
 * @param {string} key   e.g. `login:1.2.3.4`
 * @param {number} limit max hits per window
 * @param {number} windowSec
 */
export async function rateLimit(db, key, limit, windowSec) {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSec);
  const row = await db
    .prepare(
      `INSERT INTO farm_rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN farm_rate_limits.window_start = ?2 THEN farm_rate_limits.count + 1 ELSE 1 END,
         window_start = ?2
       RETURNING count`
    )
    .bind(key, windowStart)
    .first();
  if (row && row.count > limit) {
    fail(429, 'Too many attempts. Please wait a few minutes and try again.');
  }
  // Opportunistic cleanup of stale windows (cheap, indexed by PK scan is fine at this scale).
  if (Math.random() < 0.02) {
    await db.prepare('DELETE FROM farm_rate_limits WHERE window_start < ?').bind(now - 86400).run();
  }
}

/** Current time helpers in India Standard Time (UTC+5:30). */
const IST_OFFSET_MS = 330 * 60 * 1000;

export function istDateParts(date = new Date()) {
  const d = new Date(date.getTime() + IST_OFFSET_MS);
  return {
    y: d.getUTCFullYear(),
    m: String(d.getUTCMonth() + 1).padStart(2, '0'),
    d: String(d.getUTCDate()).padStart(2, '0'),
  };
}

/** YYYY-MM-DD for "today" in IST. */
export function istToday() {
  const p = istDateParts();
  return `${p.y}-${p.m}-${p.d}`;
}

/** UTC "YYYY-MM-DD HH:MM:SS" bounds of the current IST day, matching SQLite datetime('now'). */
export function istDayUtcBounds() {
  const p = istDateParts();
  const startUtc = new Date(Date.UTC(p.y, Number(p.m) - 1, Number(p.d)) - IST_OFFSET_MS);
  const endUtc = new Date(startUtc.getTime() + 86400000);
  const fmt = (x) => x.toISOString().replace('T', ' ').slice(0, 19);
  return { start: fmt(startUtc), end: fmt(endUtc) };
}

/** Format a SQLite UTC datetime string as a readable IST string. */
export function formatIst(sqliteUtc) {
  if (!sqliteUtc) return '';
  const d = new Date(String(sqliteUtc).replace(' ', 'T') + 'Z');
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

export function formatDateOnly(yyyyMmDd) {
  if (!yyyyMmDd) return '';
  const d = new Date(yyyyMmDd + 'T00:00:00Z');
  return d.toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
}

/** ₹ formatting from integer paise. */
export function rupees(paise) {
  const v = Number(paise || 0) / 100;
  return '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
}
