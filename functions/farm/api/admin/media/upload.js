// POST /farm/api/admin/media/upload — Upload image to Cloudflare D1 storage
import { json, fail, readJson } from '../../_lib/http.js';
import { requireAdmin } from '../../_lib/auth.js';

export async function onRequestPost({ request, env }) {
  await requireAdmin(request, env);

  if (!env?.DB) {
    fail(500, 'Database not bound.');
  }

  const contentType = request.headers.get('content-type') || '';
  let fileName = 'upload.jpg';
  let mimeType = 'image/jpeg';
  let base64Data = '';
  let fileSize = 0;

  if (contentType.includes('application/json')) {
    const body = await readJson(request);
    fileName = (body.fileName || body.name || 'image.jpg').replace(/[^a-zA-Z0-9._-]/g, '_');
    mimeType = body.mimeType || body.type || 'image/jpeg';
    base64Data = body.dataBase64 || body.data || '';
    
    // Strip data URL header if present (e.g. data:image/png;base64,...)
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
    const file = formData.get('file');
    if (!file || typeof file === 'string') {
      fail(400, 'No file provided in form data.');
    }
    fileName = file.name || 'image.jpg';
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

  // 4MB limit check
  if (fileSize > 4 * 1024 * 1024) {
    fail(400, 'File is too large. Maximum image size is 4MB.');
  }

  // Generate unique ID
  const id = 'img_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
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
    fileSize,
  });
}
