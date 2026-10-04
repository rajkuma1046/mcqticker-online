// Cloudflare Pages Function: Auto-creation & dynamic serving of product pages (/farm/products/:slug)
// As soon as a product is created in the admin panel, its product page is instantly live without redeployment!

export async function onRequest({ request, env, params }) {
  try {
    const slug = String(params.slug || '').trim();
    if (!slug) {
      return new Response('Slug required', { status: 400 });
    }

    // 1. Verify product exists in D1 database
    let product = null;
    if (env?.DB) {
      product = await env.DB.prepare(
        'SELECT name, slug, description, image_url, local_name FROM farm_products WHERE slug = ? AND is_archived = 0 LIMIT 1'
      ).bind(slug).first();
    }

    if (!product && env?.DB) {
      return new Response(
        `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Produce Not Found | Farm Direct Gwalior</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #fbfbf9; color: #132215; text-align: center; padding: 80px 20px; }
    .card { max-width: 480px; margin: 0 auto; background: white; padding: 40px; border-radius: 24px; border: 1px solid #dce7db; box-shadow: 0 10px 30px rgba(0,0,0,0.05); }
    h1 { font-size: 22px; font-weight: 800; margin-bottom: 8px; }
    p { font-size: 14px; color: #5b6e5d; line-height: 1.5; margin-bottom: 24px; }
    a { display: inline-block; padding: 12px 24px; background: #194622; color: white; text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <div style="font-size: 40px; margin-bottom: 12px;">🌾</div>
    <h1>Produce Not Found</h1>
    <p>The harvest "${slug}" is currently not available or has finished its seasonal cycle.</p>
    <a href="/farm/products">Browse Produce Catalogue &rarr;</a>
  </div>
</body>
</html>`,
        { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      );
    }

    // 2. Fetch the pre-rendered shell template from Pages assets
    const templateUrl = new URL('/farm/products/farm-wheat/', request.url);
    const templateRes = await env.ASSETS.fetch(new Request(templateUrl, request));

    if (!templateRes.ok) {
      return templateRes;
    }

    let html = await templateRes.text();

    // 3. Inject product metadata for SEO & Social Sharing
    if (product) {
      const cleanDesc = (product.description || 'Fresh raw agricultural produce directly from our farm for neighbourhood delivery in Gwalior.').replace(/"/g, '&quot;');
      const cleanTitle = `${product.name} ${product.local_name ? `(${product.local_name}) ` : ''}| Farm Direct Gwalior`;

      html = html.replace(/<title>.*?<\/title>/, `<title>${cleanTitle}</title>`);
      html = html.replace(/<meta name="description" content=".*?">/, `<meta name="description" content="${cleanDesc}">`);
      html = html.replace(/<meta property="og:title" content=".*?">/, `<meta property="og:title" content="${cleanTitle}">`);
      html = html.replace(/<meta property="og:description" content=".*?">/, `<meta property="og:description" content="${cleanDesc}">`);
      if (product.image_url) {
        html = html.replace(/<meta property="og:image" content=".*?">/, `<meta property="og:image" content="${product.image_url}">`);
      }
    }

    // 4. Inject current slug into the client-side hydration script
    html = html.replace(/(["'])farm-wheat\1/g, `"${slug}"`);
    html = html.replace(/\/farm\/products\/farm-wheat/g, `/farm/products/${slug}`);

    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=60, s-maxage=300'
      }
    });
  } catch (err) {
    return new Response('Internal error loading product template', { status: 500 });
  }
}
