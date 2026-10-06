// POST /farm/api/reviews/upload — Dedicated photo upload for customer reviews
import { json, fail, readJson, clientIp, rateLimit } from '../_lib/http.js';

export async function onRequestPost({ request, env }) {
  if (!env?.DB) {
    return json({ success: false, error: 'Database not bound.' }, 500);
  }

  // Rate limit photo uploads: 15 per hour per IP
  const ip = clientIp(request);
  await rateLimit(env.DB, `rev_upload:${ip}`, 15, 3600);

  const contentType = request.headers.get('content-type') || '';
  let fileName = 'review_photo.jpg';
  let mimeType = 'image/jpeg';
  let base64Data = '';
  let fileSize = 0;

  if (contentType.includes('application/json')) {
    const body = await readJson(request);
    fileName = (body.fileName || body.name || 'review_photo.jpg').replace(/[^a-zA-Z0-9._-]/g, '_');
    mimeType = body.mimeType || body.type || 'image/jpeg';
    base64Data = body.dataBase64 || body.data || '';

    if (base64Data.includes(',')) {
      const parts = base64Data.split(',');
      const header = parts[0];
      base64Data = parts[1];
      const match = header.match(/data:([^;]+);base64/);
      if (match && match[1]) mimeType = match[1];
    }

    fileSize = Math.round((base64Data.length * 3) / 4);
  } else if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const file = formData.get('file') || formData.get('photo');
    if (!file || typeof file === 'string') {
      fail(400, 'No image file provided.');
    }
    fileName = file.name || 'review_photo.jpg';
    mimeType = file.type || 'image/jpeg';
    fileSize = file.size;

    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    base64Data = btoa(binary);
  } else {
    fail(400, 'Unsupported content type. Use multipart/form-data or application/json.');
  }

  if (!base64Data) {
    fail(400, 'Image data is empty.');
  }

  if (fileSize > 5 * 1024 * 1024) {
    fail(400, 'Image is too large. Maximum size is 5MB.');
  }

  const id = 'rev_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7);
  const ext = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : (mimeType.includes('png') ? 'png' : 'jpg');
  const mediaId = `${id}.${ext}`;

  await env.DB.prepare(`
    INSERT INTO farm_media (id, file_name, mime_type, data_base64, file_size, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).bind(mediaId, fileName, mimeType, base64Data, fileSize).run();

  const publicUrl = `/farm/api/media/${mediaId}`;

  return json({
    success: true,
    url: publicUrl,
    id: mediaId,
    fileName,
    mimeType,
    fileSize
  });
}
