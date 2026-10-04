// GET  /farm/api/admin/settings — Read system settings (WhatsApp, thresholds, limits)
// POST /farm/api/admin/settings — Update system settings

import { json, readJson } from '../../_lib/http.js';
import { str, phone, int } from '../../_lib/validate.js';
import { requireAdmin } from '../../_lib/auth.js';

export async function onRequestGet({ request, env }) {
  await requireAdmin(request, env);

  const { results: rows } = await env.DB.prepare('SELECT key, value FROM farm_settings').all();
  const settings = {};
  for (const r of rows || []) {
    settings[r.key] = r.value;
  }

  return json({
    success: true,
    settings: {
      adminWhatsappNumber: settings.admin_whatsapp_number || '8770767272',
      farmName: settings.farm_name || 'Farm Direct',
      farmTagline: settings.farm_tagline || 'Raw Produce, Direct from the Farm',
      farmOrigin: settings.farm_origin || 'Village Farm near Gwalior, Madhya Pradesh',
      defaultCity: settings.default_city || 'Gwalior',
      lowStockThresholdKg: Number(settings.low_stock_threshold_kg || 15),
      maxSamplesPerCustomerPerRound: Number(settings.max_samples_per_customer_per_round || 2),
      maxSamplesPerProductPerCustomer: Number(settings.max_samples_per_product_per_customer || 1),
      sampleCooldownDays: Number(settings.sample_cooldown_days || 14),
    }
  });
}

export async function onRequestPost({ request, env }) {
  await requireAdmin(request, env);
  const body = await readJson(request);

  const updates = [];

  if (body.adminWhatsappNumber !== undefined) {
    const p = phone(body.adminWhatsappNumber, { label: 'Admin WhatsApp' });
    updates.push(['admin_whatsapp_number', p]);
  }
  if (body.lowStockThresholdKg !== undefined) {
    const val = int(body.lowStockThresholdKg, { min: 1, max: 500 });
    updates.push(['low_stock_threshold_kg', String(val)]);
  }
  if (body.maxSamplesPerCustomerPerRound !== undefined) {
    const val = int(body.maxSamplesPerCustomerPerRound, { min: 1, max: 10 });
    updates.push(['max_samples_per_customer_per_round', String(val)]);
  }
  if (body.sampleCooldownDays !== undefined) {
    const val = int(body.sampleCooldownDays, { min: 1, max: 90 });
    updates.push(['sample_cooldown_days', String(val)]);
  }
  if (body.farmOrigin !== undefined) {
    const val = str(body.farmOrigin, { max: 150 });
    updates.push(['farm_origin', val]);
  }

  const batch = updates.map(([k, v]) =>
    env.DB.prepare(`
      INSERT INTO farm_settings (key, value) VALUES (?1, ?2)
      ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = datetime('now')
    `).bind(k, v)
  );

  if (batch.length > 0) {
    await env.DB.batch(batch);
  }

  return json({
    success: true,
    message: 'Settings updated successfully.'
  });
}
