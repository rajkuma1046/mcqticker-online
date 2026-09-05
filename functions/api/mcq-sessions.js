/**
 * Cloudflare Pages Function: /api/mcq-sessions
 *
 * GET  → Fetch authenticated user's MCQ sessions from D1
 * PUT  → Save/update authenticated user's MCQ sessions to D1 (upsert)
 *
 * Auth: Verifies user via existing /api/auth/me endpoint (cookie-based).
 * D1 binding name: DB (same as reviews)
 *
 * Table schema (run once):
 *   CREATE TABLE IF NOT EXISTS mcq_sessions (
 *     id INTEGER PRIMARY KEY AUTOINCREMENT,
 *     user_id TEXT NOT NULL,
 *     sessions_data TEXT NOT NULL DEFAULT '{}',
 *     updated_at TEXT NOT NULL DEFAULT (datetime('now')),
 *     UNIQUE(user_id)
 *   );
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

import { getAuthUser } from './auth/_utils.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

/* ── GET — fetch user's MCQ sessions ── */
export async function onRequestGet({ request, env }) {
  const user = await getAuthUser(request, env);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  if (!env?.DB) {
    return json({ sessions: {}, note: 'DB not bound — add D1 binding in Cloudflare Pages settings.' });
  }

  try {
    const row = await env.DB.prepare(
      'SELECT sessions_data FROM mcq_sessions WHERE user_id = ?'
    ).bind(user.id).first();

    const sessions = row ? JSON.parse(row.sessions_data) : {};
    return json({ sessions });
  } catch (err) {
    console.error('[mcq-sessions GET]', err);
    return json({ error: 'Failed to fetch sessions.' }, 500);
  }
}

/* ── PUT — save/update user's MCQ sessions ── */
export async function onRequestPut({ request, env }) {
  const user = await getAuthUser(request, env);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const { sessions } = body || {};
  if (!sessions || typeof sessions !== 'object') {
    return json({ error: 'Invalid sessions data.' }, 400);
  }

  if (!env?.DB) {
    return json({ success: true, note: 'Preview mode — data not persisted (no DB binding).' });
  }

  try {
    const sessionsStr = JSON.stringify(sessions);
    const now = new Date().toISOString();

    // Upsert: insert or update on conflict
    await env.DB.prepare(
      `INSERT INTO mcq_sessions (user_id, sessions_data, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET sessions_data = ?, updated_at = ?`
    ).bind(user.id, sessionsStr, now, sessionsStr, now).run();

    return json({ success: true });
  } catch (err) {
    console.error('[mcq-sessions PUT]', err);
    return json({ error: 'Failed to save sessions.' }, 500);
  }
}

/* ── OPTIONS — CORS preflight ── */
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
