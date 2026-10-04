// Farm Direct — WhatsApp notification engine & Click-to-Chat builder.
// Farm Owner WhatsApp: 8770767272 (+91 8770767272)
// Safe: Never exposes secrets, provides click-to-chat URL, logs all notification events.

import { formatIst, rupees } from './http.js';

export const DEFAULT_ADMIN_WHATSAPP = '8770767272';

/**
 * Format phone to international format without plus or spaces for wa.me links
 * e.g. "8770767272" -> "918770767272"
 */
export function formatWaPhone(phone) {
  let clean = String(phone || '').replace(/\D/g, '');
  if (clean.length === 10) clean = '91' + clean;
  return clean;
}

/**
 * Generates an official WhatsApp Click-to-Chat link
 */
export function buildClickToChatUrl(phone, message) {
  const targetPhone = formatWaPhone(phone || DEFAULT_ADMIN_WHATSAPP);
  return `https://wa.me/${targetPhone}?text=${encodeURIComponent(message)}`;
}

/**
 * Build the exact WhatsApp message format specified in the prompt for Orders
 */
export function formatOrderWaMessage({
  orderNumber,
  customerName,
  customerPhone,
  customerEmail,
  deliveryAreaName,
  deliveryAddress,
  items, // array of { productName, quantity, pricePaise, lineTotalPaise }
  subtotalPaise,
  deliveryChargePaise,
  grandTotalPaise,
  status = 'PENDING',
  createdAt = new Date().toISOString()
}) {
  const itemsText = items.map((item, idx) => {
    const qty = `${item.quantity} kg`;
    const price = rupees(item.pricePaise);
    const lineTotal = rupees(item.lineTotalPaise);
    return `${idx + 1}. ${item.productName}\n${qty} × ${price} = ${lineTotal}`;
  }).join('\n\n');

  return `*NEW FARM DIRECT ORDER*

*Order:* ${orderNumber}

*Customer:*
Name: ${customerName}
Phone: ${customerPhone}
${customerEmail ? `Email: ${customerEmail}\n` : ''}
*Delivery Area:*
${deliveryAreaName}, Gwalior

*Address:*
${deliveryAddress}

*ITEMS:*

${itemsText}

Subtotal: ${rupees(subtotalPaise)}
Delivery: ${rupees(deliveryChargePaise)}
*TOTAL: ${rupees(grandTotalPaise)}*

*Status:* ${status}
*Placed:* ${formatIst(createdAt)}`;
}

/**
 * Build WhatsApp message format for Free Sample requests
 */
export function formatSampleWaMessage({
  customerName,
  customerPhone,
  productName,
  sampleQuantityGrams,
  deliveryAreaName,
  deliveryAddress,
  roundDateOrName,
  status = 'REQUESTED'
}) {
  return `*FREE SAMPLE REQUEST*

*Customer:*
Name: ${customerName}
Phone: ${customerPhone}

*Product:*
${productName}

*Sample:*
${sampleQuantityGrams} g

*Area:*
${deliveryAreaName}, Gwalior

*Address:*
${deliveryAddress}

*Sample Round:*
${roundDateOrName || 'Next Scheduled Gwalior Round'}

*Status:*
${status}`;
}

/**
 * Attempt to send via official WhatsApp Cloud API if configured in Cloudflare env.
 * Otherwise returns click-to-chat fallback URL.
 */
export async function dispatchWhatsAppNotification({
  db,
  env,
  kind, // 'ORDER' | 'SAMPLE'
  reference, // order_number or sample_id
  recipientPhone, // admin phone or customer phone
  message
}) {
  const adminNumber = env.ADMIN_WHATSAPP_NUMBER || DEFAULT_ADMIN_WHATSAPP;
  const targetPhone = recipientPhone || adminNumber;
  const clickToChatUrl = buildClickToChatUrl(targetPhone, message);

  // Check if WhatsApp Business Cloud API is configured in Cloudflare environment
  const apiToken = env.WHATSAPP_API_TOKEN;
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID;

  let channel = 'CLICK_TO_CHAT';
  let status = 'LINK_GENERATED';
  let errorMsg = null;

  if (apiToken && phoneNumberId) {
    try {
      const waRes = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: formatWaPhone(targetPhone),
          type: 'text',
          text: { body: message }
        })
      });

      if (waRes.ok) {
        channel = 'WHATSAPP_API';
        status = 'SENT';
      } else {
        const errJson = await waRes.text();
        channel = 'WHATSAPP_API';
        status = 'FAILED';
        errorMsg = `API Error ${waRes.status}: ${errJson.slice(0, 200)}`;
      }
    } catch (e) {
      channel = 'WHATSAPP_API';
      status = 'FAILED';
      errorMsg = e.message;
    }
  }

  // Log to database
  if (db) {
    try {
      await db.prepare(
        `INSERT INTO farm_notifications (kind, reference, channel, status, message, error)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(kind, String(reference), channel, status, message, errorMsg).run();
    } catch (dbErr) {
      console.error('[WhatsApp Notification Log Error]:', dbErr);
    }
  }

  return {
    channel,
    status,
    clickToChatUrl,
    message
  };
}
