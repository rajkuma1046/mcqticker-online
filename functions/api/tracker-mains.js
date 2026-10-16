/**
 * Cloudflare Pages Function: /api/tracker-mains
 *
 * Cloud-First Target Tracker Endpoint for authenticated users.
 * Uses existing To-Do user credentials & auth system.
 * Storage: Cloudflare D1 database (binding: DB)
 * Table: tracker_mains
 */

import { json, getAuthUser } from './auth/_utils.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Tracker-User-Id',
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

/* ── GET — fetch authenticated user's tracker data from Cloudflare D1 ── */
export async function onRequestGet({ request, env }) {
  const user = await getAuthUser(request, env);
  if (!user) {
    return json({ authenticated: false, error: 'Authentication required. Please sign in with your To-Do credentials.' }, 401, CORS);
  }

  if (!env?.DB) {
    return json({ error: 'Database not bound.' }, 500, CORS);
  }

  try {
    await ensureTrackerTable(env.DB);

    const row = await env.DB.prepare(
      'SELECT tracker_data, updated_at FROM tracker_mains WHERE user_id = ?'
    ).bind(String(user.id)).first();

    if (!row) {
      return json({ 
        success: true, 
        authenticated: true,
        data: null, 
        user: { id: user.id, email: user.email },
        message: 'No cloud record found yet for this account.' 
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
      authenticated: true,
      data: parsedData, 
      user: { id: user.id, email: user.email }, 
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
  const user = await getAuthUser(request, env);
  if (!user) {
    return json({ authenticated: false, error: 'Authentication required. Please sign in with your To-Do credentials.' }, 401, CORS);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400, CORS);
  }

  const trackerData = body?.data !== undefined ? body.data : body;
  if (!trackerData || typeof trackerData !== 'object') {
    return json({ error: 'Valid tracker data is required.' }, 400, CORS);
  }

  if (!env?.DB) {
    return json({ error: 'Database not bound.' }, 500, CORS);
  }

  try {
    await ensureTrackerTable(env.DB);

    const dataString = JSON.stringify(trackerData);
    const now = new Date().toISOString();

    await env.DB.prepare(`
      INSERT INTO tracker_mains (user_id, tracker_data, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET tracker_data = ?, updated_at = ?
    `).bind(String(user.id), dataString, now, dataString, now).run();

    return json({ 
      success: true, 
      authenticated: true,
      user: { id: user.id, email: user.email }, 
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
