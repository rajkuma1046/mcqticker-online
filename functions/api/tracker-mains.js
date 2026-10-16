/**
 * Cloudflare Pages Function: /api/tracker-mains
 *
 * GET  → Fetch user's SSC CGL Target Tracker state from Cloudflare D1
 * POST / PUT → Save/upsert user's target tracker state to Cloudflare D1
 *
 * Storage: Cloudflare D1 database (binding: DB)
 * Table: tracker_mains
 */

import { json, getAuthUser } from './auth/_utils.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Tracker-User-Id, Authorization',
};

async function ensureTrackerTable(db) {
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS tracker_mains (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL UNIQUE,
        tracker_data TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();
  } catch (err) {
    console.error('[tracker-mains] Error ensuring table:', err);
  }
}

function resolveUserId(request, user, bodyUserId = null) {
  if (user && user.id) return user.id;

  const url = new URL(request.url);
  const queryUserId = url.searchParams.get('userId');
  if (queryUserId && queryUserId.trim().length > 0) {
    return queryUserId.trim();
  }

  const headerUserId = request.headers.get('X-Tracker-User-Id');
  if (headerUserId && headerUserId.trim().length > 0) {
    return headerUserId.trim();
  }

  if (bodyUserId && String(bodyUserId).trim().length > 0) {
    return String(bodyUserId).trim();
  }

  return null;
}

/* ── GET — fetch user tracker data from Cloudflare D1 ── */
export async function onRequestGet({ request, env }) {
  const user = await getAuthUser(request, env);
  const userId = resolveUserId(request, user);

  if (!userId) {
    return json({ error: 'User ID is required for sync.' }, 400, CORS);
  }

  if (!env?.DB) {
    return json({ 
      data: null, 
      userId,
      isLocalMode: true,
      note: 'Cloudflare D1 DB not bound — operating in offline/local cache mode.' 
    }, 200, CORS);
  }

  try {
    await ensureTrackerTable(env.DB);

    const row = await env.DB.prepare(
      'SELECT tracker_data, updated_at FROM tracker_mains WHERE user_id = ?'
    ).bind(userId).first();

    if (!row) {
      return json({ 
        success: true, 
        data: null, 
        userId,
        message: 'No cloud record found for this user ID.' 
      }, 200, CORS);
    }

    let parsedData = null;
    try {
      parsedData = JSON.parse(row.tracker_data);
    } catch {
      parsedData = null;
    }

    return json({ 
      success: true, 
      data: parsedData, 
      userId, 
      updatedAt: row.updated_at 
    }, 200, CORS);

  } catch (err) {
    console.error('[tracker-mains GET error]', err);
    return json({ error: 'Failed to retrieve tracker data from Cloudflare D1.' }, 500, CORS);
  }
}

/* ── POST & PUT — save or update user tracker data in Cloudflare D1 ── */
export async function onRequestPost({ request, env }) {
  return handleSave({ request, env });
}

export async function onRequestPut({ request, env }) {
  return handleSave({ request, env });
}

async function handleSave({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400, CORS);
  }

  const user = await getAuthUser(request, env);
  const userId = resolveUserId(request, user, body?.userId);

  if (!userId) {
    return json({ error: 'User ID is required for sync.' }, 400, CORS);
  }

  const trackerData = body?.data !== undefined ? body.data : body;
  if (!trackerData || typeof trackerData !== 'object') {
    return json({ error: 'Valid tracker data is required.' }, 400, CORS);
  }

  if (!env?.DB) {
    return json({ 
      success: true, 
      userId,
      isLocalMode: true,
      note: 'Cloudflare D1 DB not bound — local caching active.' 
    }, 200, CORS);
  }

  try {
    await ensureTrackerTable(env.DB);

    const dataString = JSON.stringify(trackerData);
    const now = new Date().toISOString();

    await env.DB.prepare(`
      INSERT INTO tracker_mains (user_id, tracker_data, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET tracker_data = ?, updated_at = ?
    `).bind(userId, dataString, now, dataString, now).run();

    return json({ 
      success: true, 
      userId, 
      updatedAt: now 
    }, 200, CORS);

  } catch (err) {
    console.error('[tracker-mains SAVE error]', err);
    return json({ error: 'Failed to persist tracker state to Cloudflare D1.' }, 500, CORS);
  }
}

/* ── OPTIONS — CORS preflight ── */
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
