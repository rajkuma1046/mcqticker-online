/**
 * Cloudflare Pages Function: /api/reviews
 *
 * GET  → fetch all approved reviews from D1
 * POST → submit a new review to D1
 *
 * D1 binding name: DB
 * (Set in Cloudflare Pages → Settings → Bindings → D1: DB → mcqticker-reviews)
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...extra },
  });
}

/* ── GET — fetch all approved reviews ── */
export async function onRequestGet({ env }) {
  if (!env?.DB) {
    return json({ reviews: [], note: 'DB not bound — add D1 binding in Cloudflare Pages settings.' });
  }

  try {
    const { results } = await env.DB.prepare(
      `SELECT id, name, rating, review, exam, created_at
       FROM reviews
       WHERE approved = 1
       ORDER BY created_at DESC
       LIMIT 100`
    ).all();

    return json({ reviews: results || [] }, 200, {
      'Cache-Control': 'public, max-age=30',
    });
  } catch (err) {
    console.error('[Reviews GET]', err);
    return json({ error: 'Failed to fetch reviews.' }, 500);
  }
}

/* ── POST — submit a new review ── */
export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const { name, rating, review, exam } = body || {};

  // Validate
  if (!name || String(name).trim().length < 2) {
    return json({ error: 'Name must be at least 2 characters.' }, 400);
  }
  if (!rating || typeof rating !== 'number' || rating < 1 || rating > 5) {
    return json({ error: 'Rating must be 1–5.' }, 400);
  }
  if (!review || String(review).trim().length < 10) {
    return json({ error: 'Review must be at least 10 characters.' }, 400);
  }

  const safeName   = String(name).trim().slice(0, 80);
  const safeReview = String(review).trim().slice(0, 1000);
  const safeExam   = exam ? String(exam).trim().slice(0, 60) : null;
  const createdAt  = new Date().toISOString();

  if (!env?.DB) {
    return json({ success: true, note: 'Preview mode — review not persisted (no DB binding).' }, 201);
  }

  try {
    await env.DB.prepare(
      `INSERT INTO reviews (name, rating, review, exam, created_at, approved)
       VALUES (?, ?, ?, ?, ?, 1)`
    ).bind(safeName, rating, safeReview, safeExam, createdAt).run();

    return json({ success: true }, 201);
  } catch (err) {
    console.error('[Reviews POST]', err);
    return json({ error: 'Failed to save review.' }, 500);
  }
}

/* ── OPTIONS — CORS preflight ── */
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
