// src/pages/api/reviews.ts
// Server-side API endpoint (Cloudflare D1 backed)
// GET  /api/reviews      — returns all approved reviews (JSON)
// POST /api/reviews      — submit a new review (JSON body)

import type { APIRoute } from 'astro';

export const prerender = false;

/* ────────────────────────────────────────────────────────────── */
/*  Types                                                          */
/* ────────────────────────────────────────────────────────────── */
interface Env {
  DB: D1Database;
}

interface ReviewRow {
  id: number;
  name: string;
  rating: number;
  review: string;
  exam: string | null;
  created_at: string;
}

/* ────────────────────────────────────────────────────────────── */
/*  GET — Fetch all approved reviews                              */
/* ────────────────────────────────────────────────────────────── */
export const GET: APIRoute = async ({ locals }) => {
  const env = locals.runtime?.env as Env | undefined;

  // Fallback for when DB is not yet bound (local dev without wrangler)
  if (!env?.DB) {
    return new Response(
      JSON.stringify({ reviews: [], note: 'DB not bound — deploy to Cloudflare Pages to see reviews.' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const { results } = await env.DB.prepare(
      `SELECT id, name, rating, review, exam, created_at
       FROM reviews
       WHERE approved = 1
       ORDER BY created_at DESC
       LIMIT 100`
    ).all<ReviewRow>();

    return new Response(JSON.stringify({ reviews: results || [] }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=30',
      },
    });
  } catch (err) {
    console.error('[Reviews GET]', err);
    return new Response(JSON.stringify({ error: 'Failed to fetch reviews.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

/* ────────────────────────────────────────────────────────────── */
/*  POST — Submit a new review                                    */
/* ────────────────────────────────────────────────────────────── */
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env as Env | undefined;

  let body: { name?: string; rating?: number; review?: string; exam?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate
  const { name, rating, review, exam } = body;
  if (
    !name || typeof name !== 'string' || name.trim().length < 2 ||
    !rating || typeof rating !== 'number' || rating < 1 || rating > 5 ||
    !review || typeof review !== 'string' || review.trim().length < 10
  ) {
    return new Response(
      JSON.stringify({ error: 'Invalid fields. Name (2+ chars), rating (1-5), review (10+ chars) required.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Sanitise
  const safeName = name.trim().slice(0, 80);
  const safeReview = review.trim().slice(0, 1000);
  const safeExam = exam ? String(exam).trim().slice(0, 60) : null;
  const createdAt = new Date().toISOString();

  // Fallback — DB not bound locally
  if (!env?.DB) {
    return new Response(
      JSON.stringify({ success: true, note: 'Preview mode — review not persisted. Deploy to Cloudflare Pages.' }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    await env.DB.prepare(
      `INSERT INTO reviews (name, rating, review, exam, created_at, approved)
       VALUES (?, ?, ?, ?, ?, 1)`
    )
      .bind(safeName, rating, safeReview, safeExam, createdAt)
      .run();

    return new Response(JSON.stringify({ success: true }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[Reviews POST]', err);
    return new Response(JSON.stringify({ error: 'Failed to save review.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
