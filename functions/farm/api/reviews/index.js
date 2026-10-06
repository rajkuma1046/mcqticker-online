// GET  /farm/api/reviews — Retrieve approved customer reviews and summary metrics
// POST /farm/api/reviews — Customer review submission with written review and photo upload

import { json, fail, readJson, clientIp, rateLimit } from '../_lib/http.js';
import { getUser } from '../_lib/auth.js';
import { sendAdminNotificationEmail } from '../_lib/email.js';

export async function onRequestGet({ request, env }) {
  if (!env?.DB) {
    return json({ success: false, error: 'Database not bound.' }, 500);
  }

  const url = new URL(request.url);
  const productId = url.searchParams.get('product_id');
  const slug = url.searchParams.get('slug');
  const withPhotos = url.searchParams.get('with_photos') === '1' || url.searchParams.get('with_photos') === 'true';
  const minRating = Number(url.searchParams.get('min_rating') || 0);
  const limit = Math.min(Number(url.searchParams.get('limit') || 50), 100);

  let targetProductId = productId ? Number(productId) : null;

  if (!targetProductId && slug) {
    const prod = await env.DB.prepare('SELECT id FROM farm_products WHERE slug = ?').bind(slug).first();
    if (prod) {
      targetProductId = prod.id;
    }
  }

  // Build filter conditions
  const conditions = ['is_approved = 1'];
  const params = [];

  if (targetProductId) {
    conditions.push('product_id = ?');
    params.push(targetProductId);
  }

  if (withPhotos) {
    conditions.push("photo_url IS NOT NULL AND photo_url != ''");
  }

  if (minRating > 0 && minRating <= 5) {
    conditions.push('rating >= ?');
    params.push(minRating);
  }

  const whereClause = conditions.join(' AND ');

  const reviewsQuery = `
    SELECT 
      id,
      user_id,
      order_id,
      product_id,
      product_name,
      customer_name,
      customer_city,
      rating,
      title,
      review_text,
      photo_url,
      is_verified,
      created_at
    FROM farm_reviews
    WHERE ${whereClause}
    ORDER BY created_at DESC
    LIMIT ?
  `;

  const { results: reviews } = await env.DB.prepare(reviewsQuery).bind(...params, limit).all();

  // Aggregate summary stats for the target product or entire store
  const summaryConditions = ['is_approved = 1'];
  const summaryParams = [];
  if (targetProductId) {
    summaryConditions.push('product_id = ?');
    summaryParams.push(targetProductId);
  }
  const summaryWhere = summaryConditions.join(' AND ');

  const stats = await env.DB.prepare(`
    SELECT 
      COUNT(*) AS total_count,
      AVG(rating) AS avg_rating,
      SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END) AS stars_5,
      SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END) AS stars_4,
      SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END) AS stars_3,
      SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END) AS stars_2,
      SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) AS stars_1,
      SUM(CASE WHEN photo_url IS NOT NULL AND photo_url != '' THEN 1 ELSE 0 END) AS photos_count
    FROM farm_reviews
    WHERE ${summaryWhere}
  `).bind(...summaryParams).first();

  const totalReviews = Number(stats?.total_count || 0);
  const avgRating = totalReviews > 0 ? Number(Number(stats?.avg_rating || 5).toFixed(1)) : 5.0;

  return json({
    success: true,
    reviews: (reviews || []).map(r => ({
      id: r.id,
      productId: r.product_id,
      productName: r.product_name,
      customerName: r.customer_name,
      customerCity: r.customer_city || '',
      rating: r.rating,
      title: r.title || '',
      reviewText: r.review_text,
      photoUrl: r.photo_url || null,
      isVerified: Boolean(r.is_verified),
      createdAt: r.created_at
    })),
    summary: {
      totalReviews,
      averageRating: avgRating,
      photosCount: Number(stats?.photos_count || 0),
      distribution: {
        5: Number(stats?.stars_5 || 0),
        4: Number(stats?.stars_4 || 0),
        3: Number(stats?.stars_3 || 0),
        2: Number(stats?.stars_2 || 0),
        1: Number(stats?.stars_1 || 0)
      }
    }
  });
}

export async function onRequestPost({ request, env }) {
  if (!env?.DB) {
    return json({ success: false, error: 'Database not bound.' }, 500);
  }

  // Rate limiting: max 10 reviews per hour per IP
  const ip = clientIp(request);
  await rateLimit(env.DB, `review:${ip}`, 10, 3600);

  const user = await getUser(request, env);
  const contentType = request.headers.get('content-type') || '';

  let customerName = '';
  let customerPhone = '';
  let customerCity = '';
  let rating = 5;
  let title = '';
  let reviewText = '';
  let productId = null;
  let productSlug = '';
  let orderId = null;
  let photoUrl = '';
  let photoData = '';
  let photoMime = 'image/jpeg';
  let photoFileName = 'review_photo.jpg';

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    customerName = (formData.get('customer_name') || '').toString().trim();
    customerPhone = (formData.get('customer_phone') || '').toString().trim();
    customerCity = (formData.get('customer_city') || '').toString().trim();
    rating = parseInt((formData.get('rating') || '5').toString(), 10);
    title = (formData.get('title') || '').toString().trim();
    reviewText = (formData.get('review_text') || '').toString().trim();
    productId = formData.get('product_id') ? parseInt(formData.get('product_id').toString(), 10) : null;
    productSlug = (formData.get('product_slug') || '').toString().trim();
    orderId = formData.get('order_id') ? parseInt(formData.get('order_id').toString(), 10) : null;
    photoUrl = (formData.get('photo_url') || '').toString().trim();

    const file = formData.get('photo');
    if (file && typeof file === 'object' && file.size > 0) {
      if (file.size > 5 * 1024 * 1024) {
        fail(400, 'Uploaded photo is too large. Maximum size is 5MB.');
      }
      photoFileName = file.name || 'review.jpg';
      photoMime = file.type || 'image/jpeg';
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
      }
      photoData = btoa(binary);
    }
  } else {
    const body = await readJson(request);
    customerName = (body.customer_name || '').trim();
    customerPhone = (body.customer_phone || '').trim();
    customerCity = (body.customer_city || '').trim();
    rating = parseInt(body.rating || 5, 10);
    title = (body.title || '').trim();
    reviewText = (body.review_text || body.text || '').trim();
    productId = body.product_id ? parseInt(body.product_id, 10) : null;
    productSlug = (body.product_slug || '').trim();
    orderId = body.order_id ? parseInt(body.order_id, 10) : null;
    photoUrl = (body.photo_url || '').trim();

    if (body.photo_base64 || body.photo_data) {
      let b64 = body.photo_base64 || body.photo_data;
      if (b64.includes(',')) {
        const parts = b64.split(',');
        const header = parts[0];
        b64 = parts[1];
        const match = header.match(/data:([^;]+);base64/);
        if (match && match[1]) photoMime = match[1];
      }
      photoData = b64;
      photoFileName = body.photo_name || 'review_photo.jpg';
    }
  }

  // Pre-fill customer details from session if available
  if (user) {
    if (!customerName) customerName = user.name;
    if (!customerPhone) customerPhone = user.phone;
  }

  if (!customerName) {
    customerName = 'Verified Customer';
  }

  if (!reviewText || reviewText.length < 5) {
    fail(400, 'Please write at least a few words (minimum 5 characters) for your review.');
  }

  if (reviewText.length > 2000) {
    fail(400, 'Review is too long (maximum 2000 characters).');
  }

  if (isNaN(rating) || rating < 1 || rating > 5) {
    rating = 5;
  }

  // Determine product name
  let productName = 'Farm Direct Harvest';
  if (productId) {
    const prod = await env.DB.prepare('SELECT id, name FROM farm_products WHERE id = ?').bind(productId).first();
    if (prod) {
      productName = prod.name;
    }
  } else if (productSlug) {
    const prod = await env.DB.prepare('SELECT id, name FROM farm_products WHERE slug = ?').bind(productSlug).first();
    if (prod) {
      productId = prod.id;
      productName = prod.name;
    }
  }

  // If photo binary was supplied, store in farm_media
  if (photoData) {
    const id = 'rev_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7);
    const ext = photoFileName.includes('.') ? photoFileName.split('.').pop().toLowerCase() : (photoMime.includes('png') ? 'png' : 'jpg');
    const mediaId = `${id}.${ext}`;
    const fileSize = Math.round((photoData.length * 3) / 4);

    await env.DB.prepare(`
      INSERT INTO farm_media (id, file_name, mime_type, data_base64, file_size, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).bind(mediaId, photoFileName, photoMime, photoData, fileSize).run();

    photoUrl = `/farm/api/media/${mediaId}`;
  }

  const userId = user?.id || null;
  const isVerified = orderId ? 1 : 1;
  const isApproved = 1; // Instant approval for smooth user experience

  const insertRes = await env.DB.prepare(`
    INSERT INTO farm_reviews (
      user_id, order_id, product_id, product_name, 
      customer_name, customer_phone, customer_city,
      rating, title, review_text, photo_url,
      is_verified, is_approved, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).bind(
    userId,
    orderId,
    productId,
    productName,
    customerName,
    customerPhone || null,
    customerCity || null,
    rating,
    title || null,
    reviewText,
    photoUrl || null,
    isVerified,
    isApproved
  ).run();

  const newReviewId = insertRes?.meta?.last_row_id;

  // Trigger Admin Notification Email to rajkuma1046@gmail.com
  sendAdminNotificationEmail({
    event: `⭐ New Customer Review (${rating} Stars) - ${customerName}`,
    details: {
      'Customer Name': customerName,
      'Rating': '★'.repeat(rating) + ` (${rating}/5)`,
      'Produce Name': productName,
      'Location / City': customerCity || (user?.phone ? `Phone: ${user.phone}` : 'Gwalior / Shivpuri'),
      'Review Headline': title || 'None',
      'Review Content': reviewText,
      'Photo Attached': photoUrl ? `Yes (${photoUrl})` : 'No photo',
      'Verified Purchase': isVerified ? 'Yes' : 'No',
      'Submitted At': new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
    },
    env
  }).catch(err => console.error('[Review Admin Email Error]:', err));

  return json({
    success: true,
    message: 'Thank you! Your review and photo have been published.',
    review: {
      id: newReviewId,
      customerName,
      customerCity,
      productName,
      rating,
      title,
      reviewText,
      photoUrl,
      isVerified: true,
      createdAt: new Date().toISOString()
    }
  }, 201);
}
