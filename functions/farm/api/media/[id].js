// GET /farm/api/media/:id — Public media server for uploaded images from Cloudflare D1 storage
export async function onRequestGet({ env, params }) {
  if (!env?.DB) {
    return new Response('Database not configured', { status: 500 });
  }

  const id = params.id;
  if (!id) {
    return new Response('Media ID missing', { status: 400 });
  }

  const media = await env.DB.prepare(`
    SELECT mime_type, data_base64, file_size
    FROM farm_media
    WHERE id = ?
  `).bind(id).first();

  if (!media || !media.data_base64) {
    return new Response('Media not found', { status: 404 });
  }

  try {
    // Decode base64 to binary Uint8Array
    const binaryString = atob(media.data_base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    return new Response(bytes.buffer, {
      status: 200,
      headers: {
        'Content-Type': media.mime_type || 'image/jpeg',
        'Content-Length': String(bytes.length),
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (err) {
    return new Response('Failed to decode image data', { status: 500 });
  }
}
