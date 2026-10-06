// Farm Direct — Automated Email Delivery (Gmail SMTP, Google Apps Script, Resend, Dev Fallback)

function b64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function chunkBase64(b64, chunkSize = 76) {
  const chunks = [];
  for (let i = 0; i < b64.length; i += chunkSize) {
    chunks.push(b64.slice(i, i + chunkSize));
  }
  return chunks.join('\r\n');
}

/**
 * Retrieves email configuration from D1 farm_settings or environment variables.
 */
export async function getEmailConfig(env) {
  let settings = {};
  if (env?.DB) {
    try {
      const { results } = await env.DB.prepare(`
        SELECT key, value FROM farm_settings 
        WHERE key IN ('gmail_user', 'gmail_app_password', 'gmail_webhook_url')
      `).all();
      for (const r of results || []) {
        settings[r.key] = r.value;
      }
    } catch (_) {}
  }

  const gmailUser = (settings.gmail_user || env?.GMAIL_USER || '').trim();
  const gmailPass = (settings.gmail_app_password || env?.GMAIL_APP_PASSWORD || '').trim().replace(/\s+/g, '');
  const gmailWebhook = (settings.gmail_webhook_url || env?.GMAIL_WEBHOOK_URL || '').trim();
  const resendApiKey = (env?.RESEND_API_KEY || '').trim();

  return {
    gmailUser,
    gmailPass,
    gmailWebhook,
    resendApiKey,
    isConfigured: !!(gmailWebhook || (gmailUser && gmailPass) || resendApiKey)
  };
}

/**
 * Sends email using Gmail SMTPS (port 465) via Cloudflare Sockets.
 */
async function sendViaGmailSmtp({ user, pass, to, subject, html, text }) {
  let connect;
  try {
    const sockets = await import('cloudflare:sockets');
    connect = sockets.connect;
  } catch (err) {
    throw new Error('Cloudflare Sockets not available in current runtime: ' + err.message);
  }

  const socket = connect(
    { hostname: 'smtp.gmail.com', port: 465 },
    { secureTransport: 'on', allowHalfOpen: false }
  );

  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  let buffer = '';

  async function readReply() {
    while (true) {
      const lines = buffer.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\d{3} /.test(line)) {
          const code = parseInt(line.substring(0, 3), 10);
          const replyText = lines.slice(0, i + 1).join('\n');
          const consumedLength = lines.slice(0, i + 1).join('\r\n').length + 2;
          buffer = buffer.slice(consumedLength).replace(/^[\r\n]+/, '');
          return { code, text: replyText };
        }
      }
      const { value, done } = await reader.read();
      if (done) throw new Error('SMTP connection closed unexpectedly by Gmail.');
      buffer += decoder.decode(value, { stream: true });
    }
  }

  async function sendCmd(cmd) {
    await writer.write(encoder.encode(cmd + '\r\n'));
    return await readReply();
  }

  try {
    // 1. Initial banner
    const banner = await readReply();
    if (banner.code !== 220) throw new Error(`Gmail greeting failed: ${banner.text}`);

    // 2. EHLO
    const ehlo = await sendCmd('EHLO mcqticker.online');
    if (ehlo.code !== 250) throw new Error(`EHLO handshake failed: ${ehlo.text}`);

    // 3. AUTH LOGIN
    const auth = await sendCmd('AUTH LOGIN');
    if (auth.code !== 334) throw new Error(`AUTH LOGIN failed: ${auth.text}`);

    const uRes = await sendCmd(btoa(user));
    if (uRes.code !== 334) throw new Error(`AUTH Username failed: ${uRes.text}`);

    const pRes = await sendCmd(btoa(pass));
    if (pRes.code !== 235) throw new Error(`Gmail authentication failed. Please verify your 16-character App Password.`);

    // 4. MAIL FROM & RCPT TO
    const mfRes = await sendCmd(`MAIL FROM:<${user}>`);
    if (mfRes.code !== 250) throw new Error(`MAIL FROM failed: ${mfRes.text}`);

    const rtRes = await sendCmd(`RCPT TO:<${to}>`);
    if (rtRes.code !== 250) throw new Error(`Recipient rejected (${to}): ${rtRes.text}`);

    // 5. DATA
    const dataRes = await sendCmd('DATA');
    if (dataRes.code !== 354) throw new Error(`DATA initiation failed: ${dataRes.text}`);

    // 6. Assemble RFC 2045 message
    const boundary = '----=_Part_' + Math.random().toString(36).substring(2);
    const dateStr = new Date().toUTCString();
    const encodedSubject = `=?UTF-8?B?${b64Utf8(subject)}?=`;
    const messageId = `<${Math.random().toString(36).substring(2)}.${Date.now()}@mcqticker.online>`;

    const rawMessage = [
      `From: "Farm Direct" <${user}>`,
      `To: <${to}>`,
      `Subject: ${encodedSubject}`,
      `Date: ${dateStr}`,
      `Message-ID: ${messageId}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      chunkBase64(b64Utf8(text || '')),
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      chunkBase64(b64Utf8(html || text || '')),
      '',
      `--${boundary}--`,
      '.'
    ].join('\r\n');

    await writer.write(encoder.encode(rawMessage + '\r\n'));
    const sent = await readReply();
    if (sent.code !== 250) throw new Error(`Delivery failed: ${sent.text}`);

    // 7. QUIT
    await sendCmd('QUIT');
    return { success: true };
  } finally {
    try { reader.releaseLock(); } catch (_) {}
    try { writer.releaseLock(); } catch (_) {}
    try { socket.close(); } catch (_) {}
  }
}

/**
 * Sends email via Google Apps Script Webhook.
 */
async function sendViaGoogleAppsScript(webhookUrl, { to, subject, html, text }) {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, subject, html, text }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Apps Script error (${res.status}): ${errText}`);
  }
  return { success: true };
}

/**
 * Sends email via Resend API (if configured).
 */
async function sendViaResend(apiKey, { to, subject, html, text, from }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: from || 'Farm Direct <noreply@mcqticker.online>',
      to: [to],
      subject,
      html,
      text,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Resend API error: ${res.status}`);
  }
  return { success: true };
}

/**
 * High-level unified email dispatch function.
 */
export async function sendEmail({ to, subject, html, text, env }) {
  const cfg = await getEmailConfig(env);

  console.log(`[Farm Direct Email]: Initiating dispatch to ${to} ("${subject}"). Configured: ${cfg.isConfigured}`);

  let lastError = null;

  // 1. Google Apps Script Webhook (if provided)
  if (cfg.gmailWebhook) {
    try {
      await sendViaGoogleAppsScript(cfg.gmailWebhook, { to, subject, html, text });
      return { success: true, provider: 'google_apps_script' };
    } catch (err) {
      console.error('[Farm Direct Email] Google Apps Script failed:', err);
      lastError = err;
    }
  }

  // 2. Direct Gmail SMTP via Cloudflare Sockets (with App Password)
  if (cfg.gmailUser && cfg.gmailPass) {
    try {
      await sendViaGmailSmtp({
        user: cfg.gmailUser,
        pass: cfg.gmailPass,
        to,
        subject,
        html,
        text,
      });
      return { success: true, provider: 'gmail_smtp' };
    } catch (err) {
      console.error('[Farm Direct Email] Gmail SMTP failed:', err);
      lastError = err;
    }
  }

  // 3. Resend API
  if (cfg.resendApiKey) {
    try {
      await sendViaResend(cfg.resendApiKey, {
        to,
        subject,
        html,
        text,
        from: cfg.gmailUser ? `Farm Direct <${cfg.gmailUser}>` : undefined,
      });
      return { success: true, provider: 'resend' };
    } catch (err) {
      console.error('[Farm Direct Email] Resend failed:', err);
      lastError = err;
    }
  }

  if (lastError) {
    console.error(`[Farm Direct Email Dispatch Failed]: ${lastError.message}`);
    return { success: false, error: lastError.message };
  }

  // If no email provider is configured yet, log OTP code for developer/admin
  console.warn(`[Farm Direct Email]: No email provider configured. Set GMAIL_USER and GMAIL_APP_PASSWORD in Admin Settings.`);
  return { success: false, unconfigured: true };
}

/**
 * Creates and sends a formatted Farm Direct verification email.
 */
export async function sendVerificationEmail({ to, code, purpose, env }) {
  const isReset = purpose === 'reset_password';
  const subject = isReset 
    ? `Farm Direct Password Reset Code: ${code}`
    : `Farm Direct Email Verification Code: ${code}`;

  const title = isReset ? 'Reset Your Account Password' : 'Verify Your Email Address';
  const subtitle = isReset
    ? 'Use the 6-digit code below to set a new password for your Farm Direct customer account.'
    : 'Welcome to Farm Direct! Use the 6-digit code below to complete your customer account registration.';

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 24px 0; background-color: #f7faf5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #152518;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 520px; background: #ffffff; border-radius: 24px; border: 1px solid #dce8db; overflow: hidden; box-shadow: 0 10px 30px rgba(18,34,21,0.06);">
          <!-- Header Banner -->
          <tr>
            <td style="background: linear-gradient(135deg, #18421f 0%, #25582f 100%); padding: 36px 30px; text-align: center;">
              <div style="font-size: 38px; line-height: 1; margin-bottom: 10px;">🌾</div>
              <h1 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -0.3px;">Farm Direct</h1>
              <p style="color: #cde6d2; margin: 6px 0 0 0; font-size: 13px; font-weight: 500;">Direct from Village Farm &bull; Zero Middlemen</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 36px 32px 28px 32px; text-align: center;">
              <span style="display: inline-block; padding: 4px 14px; background-color: #edf6ee; color: #1e5628; border: 1px solid #c9e4cb; border-radius: 999px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 16px;">
                ${isReset ? 'Security Verification' : 'Customer Account Verification'}
              </span>

              <h2 style="margin: 0 0 12px 0; font-size: 20px; font-weight: 800; color: #132215;">
                ${title}
              </h2>

              <p style="margin: 0 0 28px 0; font-size: 14px; line-height: 1.6; color: #556857;">
                ${subtitle}
              </p>

              <!-- OTP Code Display Card -->
              <div style="background-color: #f7faf5; border: 2px dashed #9bc8a1; border-radius: 18px; padding: 22px 16px; margin-bottom: 24px;">
                <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: #627b65; margin-bottom: 8px;">
                  Your 6-Digit Verification Code
                </div>
                <div style="font-family: 'Courier New', Courier, monospace; font-size: 38px; font-weight: 900; letter-spacing: 10px; color: #18421f; margin-left: 10px;">
                  ${code}
                </div>
                <div style="font-size: 12px; color: #7a8f7c; margin-top: 8px; font-weight: 600;">
                  ⏱️ Valid for 10 minutes only
                </div>
              </div>

              <p style="margin: 0; font-size: 12px; color: #839785; line-height: 1.5;">
                Never share this verification code with anyone. If you did not request this action, you can safely ignore this email.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f4f8f3; border-top: 1px solid #e5ede3; padding: 22px 30px; text-align: center;">
              <p style="margin: 0; font-size: 11px; color: #718473;">
                Farm Direct &bull; Village Farm serving Gwalior & Shivpuri Districts, Madhya Pradesh<br/>
                WhatsApp Helpline: +91 8770767272 &bull; <a href="https://mcqticker.online/farm" style="color: #1f572a; text-decoration: none; font-weight: 700;">mcqticker.online/farm</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  const text = `${title}\n\nYour 6-digit verification code is: ${code}\n\nThis code is valid for 10 minutes.\n\nFarm Direct\nWhatsApp: +91 8770767272`;

  const result = await sendEmail({ to, subject, html, text, env });
  return result;
}

/**
 * Creates and sends a formatted Farm Direct order confirmation email.
 */
export async function sendOrderConfirmationEmail({ to, order, env }) {
  const subject = `🌾 Farm Direct Order Confirmation — #${order.orderNumber}`;
  const trackUrl = `https://mcqticker.online/farm/track?order_number=${encodeURIComponent(order.orderNumber)}`;

  const itemsRows = (order.items || []).map(it => `
    <tr>
      <td style="padding: 10px 0; border-bottom: 1px solid #edf4ec; font-size: 13px; color: #152518; font-weight: 600;">
        ${it.productName || it.name} (${it.quantity} ${it.unit || 'kg'})
      </td>
      <td style="padding: 10px 0; border-bottom: 1px solid #edf4ec; font-size: 13px; color: #1b4522; font-weight: 800; text-align: right;">
        ₹${it.lineTotalRupees || (it.lineTotalPaise ? it.lineTotalPaise / 100 : 0)}
      </td>
    </tr>
  `).join('');

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 24px 0; background-color: #f7faf5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #152518;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 520px; background: #ffffff; border-radius: 24px; border: 1px solid #dce8db; overflow: hidden; box-shadow: 0 10px 30px rgba(18,34,21,0.06);">
          <tr>
            <td style="background: linear-gradient(135deg, #18421f 0%, #25582f 100%); padding: 32px 30px; text-align: center;">
              <div style="font-size: 34px; margin-bottom: 8px;">🌾</div>
              <h1 style="color: #ffffff; margin: 0; font-size: 20px; font-weight: 800;">Farm Direct</h1>
              <p style="color: #cde6d2; margin: 4px 0 0 0; font-size: 12px;">Pre-Order Receipt & Confirmation</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 30px;">
              <div style="text-align: center; margin-bottom: 20px;">
                <span style="display: inline-block; padding: 4px 12px; background: #edf6ee; color: #1e5628; border-radius: 999px; font-size: 11px; font-weight: 800; text-transform: uppercase;">
                  Pre-Order Received
                </span>
                <h2 style="margin: 10px 0 4px 0; font-size: 18px; font-weight: 800; color: #132215;">
                  Order #${order.orderNumber}
                </h2>
                <p style="margin: 0; font-size: 13px; color: #556857;">
                  Namaste ${order.customerName || 'Customer'}, thank you for supporting direct village farming!
                </p>
              </div>

              <!-- Produce Items Table -->
              <table width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 20px;">
                <thead>
                  <tr>
                    <th align="left" style="font-size: 11px; text-transform: uppercase; color: #728874; padding-bottom: 8px; border-bottom: 2px solid #e0ece0;">Harvest Produce</th>
                    <th align="right" style="font-size: 11px; text-transform: uppercase; color: #728874; padding-bottom: 8px; border-bottom: 2px solid #e0ece0;">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemsRows}
                </tbody>
                <tfoot>
                  <tr>
                    <td style="padding-top: 14px; font-weight: 800; font-size: 15px; color: #132215;">Grand Total:</td>
                    <td style="padding-top: 14px; font-weight: 900; font-size: 20px; color: #194622; text-align: right;">₹${order.grandTotalRupees}</td>
                  </tr>
                </tfoot>
              </table>

              <!-- Delivery Info Card -->
              <div style="background: #f7faf5; border: 1px solid #dce8db; border-radius: 14px; padding: 14px; margin-bottom: 22px; font-size: 12px; color: #4b5e4d; line-height: 1.5;">
                <strong style="color: #152518;">📍 Delivery Cluster:</strong> ${order.areaName || 'Gwalior'}<br/>
                <strong style="color: #152518;">🏠 Address:</strong> ${order.deliveryAddress}<br/>
                <strong style="color: #152518;">💵 Payment:</strong> Pay on doorstep delivery (Cash / UPI)
              </div>

              <!-- Track Button -->
              <div style="text-align: center; margin-bottom: 12px;">
                <a href="${trackUrl}" style="display: inline-block; padding: 12px 28px; background: #194622; color: #ffffff; text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 13px;">
                  Track Order Status &rarr;
                </a>
              </div>
            </td>
          </tr>
          <tr>
            <td style="background-color: #f4f8f3; border-top: 1px solid #e5ede3; padding: 18px 30px; text-align: center; font-size: 11px; color: #718473;">
              Farm Direct &bull; Village Farm serving Gwalior & Shivpuri Districts &bull; WhatsApp Helpline: +91 8770767272
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  const text = `Farm Direct Order Confirmation #${order.orderNumber}\n\nNamaste ${order.customerName},\nYour pre-order has been recorded.\nTotal: ₹${order.grandTotalRupees}\nTrack: ${trackUrl}\n\nPayment: Pay on delivery via Cash / UPI.`;

  return await sendEmail({ to, subject, html, text, env });
}

/**
 * Creates and sends a formatted Farm Direct order status update email.
 */
export async function sendStatusUpdateEmail({ to, order, newStatus, note, env }) {
  const subject = `🌾 Farm Direct Order Update — #${order.orderNumber} is now ${newStatus.replace(/_/g, ' ')}`;
  const trackUrl = `https://mcqticker.online/farm/track?order_number=${encodeURIComponent(order.orderNumber)}`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 24px 0; background-color: #f7faf5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #152518;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 520px; background: #ffffff; border-radius: 24px; border: 1px solid #dce8db; overflow: hidden; box-shadow: 0 10px 30px rgba(18,34,21,0.06);">
          <tr>
            <td style="background: linear-gradient(135deg, #18421f 0%, #25582f 100%); padding: 32px 30px; text-align: center;">
              <div style="font-size: 34px; margin-bottom: 8px;">🚜</div>
              <h1 style="color: #ffffff; margin: 0; font-size: 20px; font-weight: 800;">Farm Direct</h1>
              <p style="color: #cde6d2; margin: 4px 0 0 0; font-size: 12px;">Order Status Update</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 30px;">
              <div style="text-align: center; margin-bottom: 20px;">
                <h2 style="margin: 10px 0 4px 0; font-size: 18px; font-weight: 800; color: #132215;">
                  Order #${order.orderNumber}
                </h2>
                <p style="margin: 0; font-size: 13px; color: #556857;">
                  Namaste ${order.customerName || 'Customer'}, your order status has been updated.
                </p>
              </div>

              <!-- Status Card -->
              <div style="background: #edf6ee; border: 1px solid #c9e4cb; border-radius: 14px; padding: 20px; margin-bottom: 22px; text-align: center;">
                <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #627b65; margin-bottom: 8px;">
                  New Status
                </div>
                <div style="font-size: 20px; font-weight: 900; color: #18421f;">
                  ${newStatus.replace(/_/g, ' ')}
                </div>
                ${note ? `<div style="margin-top: 12px; font-size: 13px; color: #4b5e4d; font-style: italic;">"${note}"</div>` : ''}
              </div>

              <!-- Track Button -->
              <div style="text-align: center; margin-bottom: 12px;">
                <a href="${trackUrl}" style="display: inline-block; padding: 12px 28px; background: #194622; color: #ffffff; text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 13px;">
                  Track Order Status &rarr;
                </a>
              </div>
            </td>
          </tr>
          <tr>
            <td style="background-color: #f4f8f3; border-top: 1px solid #e5ede3; padding: 18px 30px; text-align: center; font-size: 11px; color: #718473;">
              Farm Direct &bull; Village Farm serving Gwalior & Shivpuri Districts &bull; WhatsApp Helpline: +91 8770767272
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  const text = `Farm Direct Order Update\n\nOrder #${order.orderNumber} is now ${newStatus.replace(/_/g, ' ')}.\n\nTrack your order: ${trackUrl}`;

  return await sendEmail({ to, subject, html, text, env });
}

/**
 * Creates and sends an executive-grade, stylish, and data-driven administrative alert.
 * Primary Admin Email: rajkuma1046@gmail.com
 */
export async function sendAdminNotificationEmail({ event, details, env }) {
  const adminEmail = 'rajkuma1046@gmail.com';
  
  // Clean phone number for WhatsApp deep-link if available
  const phoneRaw = details['Mobile Number'] || details['Mobile Phone'] || details['Customer Phone'] || '';
  const phoneClean = String(phoneRaw).replace(/[^0-9]/g, '').slice(-10);
  const waUrl = phoneClean.length === 10 ? `https://wa.me/91${phoneClean}` : null;
  const custName = details['Customer Name'] || 'Valued Customer';

  // Determine icon & theme mood based on event type
  let eventIcon = '🔔';
  let badgeText = 'Admin Alert';
  let badgeBg = '#edf6ee';
  let badgeColor = '#184921';
  let highlightTitle = '';
  let highlightValue = '';

  const evLower = String(event).toLowerCase();
  if (evLower.includes('order received') || evLower.includes('new order')) {
    eventIcon = '🛒';
    badgeText = 'New Pre-Order';
    badgeBg = '#eaf5eb';
    badgeColor = '#134e1e';
    highlightTitle = 'Grand Total';
    highlightValue = details['Grand Total'] || details['Order Total'] || '';
  } else if (evLower.includes('account created') || evLower.includes('new customer')) {
    eventIcon = '👤';
    badgeText = 'New Customer Registration';
    badgeBg = '#e8f4fc';
    badgeColor = '#0c4a6e';
    highlightTitle = 'Account Status';
    highlightValue = '✓ OTP Verified';
  } else if (evLower.includes('sample')) {
    eventIcon = '🎁';
    badgeText = 'Free Sample Request';
    badgeBg = '#fef3c7';
    badgeColor = '#92400e';
    highlightTitle = 'Sample Quantity';
    highlightValue = details['Total Grams'] || 'Sample Packet';
  } else if (evLower.includes('review')) {
    eventIcon = '⭐';
    badgeText = 'Customer Review';
    badgeBg = '#fef9c3';
    badgeColor = '#854d0e';
    highlightTitle = 'Rating';
    highlightValue = details['Rating'] || '5 Stars';
  } else if (evLower.includes('cancel')) {
    eventIcon = '⚠️';
    badgeText = 'Order Cancelled';
    badgeBg = '#fee2e2';
    badgeColor = '#991b1b';
    highlightTitle = 'Status';
    highlightValue = 'Cancelled by Customer';
  } else if (evLower.includes('password') || evLower.includes('security')) {
    eventIcon = '🔑';
    badgeText = 'Security Update';
    badgeBg = '#f3e8ff';
    badgeColor = '#6b21a8';
    highlightTitle = 'Security Event';
    highlightValue = 'Password Reset';
  }

  const subject = `${eventIcon} [Farm Direct] ${event}`;

  // Filter out the highlight value if already featured prominently
  const detailRows = Object.entries(details || {})
    .filter(([_, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => {
      let valFormatted = String(v);
      if (k.toLowerCase().includes('phone') && phoneClean.length === 10) {
        valFormatted = `<a href="tel:+91${phoneClean}" style="color: #194622; font-weight: 700; text-decoration: none;">+91 ${phoneClean}</a> &nbsp;&bull;&nbsp; <a href="${waUrl}" style="color: #15803d; font-weight: 700; text-decoration: none;">Chat on WhatsApp &rarr;</a>`;
      } else if (k.toLowerCase().includes('email') && typeof v === 'string' && v.includes('@')) {
        valFormatted = `<a href="mailto:${v}" style="color: #194622; font-weight: 700; text-decoration: none;">${v}</a>`;
      } else if (typeof v === 'object') {
        valFormatted = `<pre style="margin: 0; font-family: monospace; font-size: 11px; white-space: pre-wrap; background: #f6faf5; padding: 6px; border-radius: 6px;">${JSON.stringify(v, null, 2)}</pre>`;
      }
      return `
        <tr>
          <td style="padding: 10px 14px; font-weight: 700; color: #536955; border-bottom: 1px solid #edf4ec; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; width: 34%; vertical-align: top;">
            ${k}
          </td>
          <td style="padding: 10px 14px; color: #132215; border-bottom: 1px solid #edf4ec; font-size: 13px; font-weight: 600; vertical-align: top;">
            ${valFormatted}
          </td>
        </tr>
      `;
    }).join('');

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 24px 0; background-color: #f5f8f3; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #152518;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 560px; background: #ffffff; border-radius: 24px; border: 1px solid #dce8db; overflow: hidden; box-shadow: 0 12px 36px rgba(18,34,21,0.08);">
          
          <!-- Header Hero -->
          <tr>
            <td style="background: linear-gradient(135deg, #123718 0%, #1c4e25 60%, #286333 100%); padding: 32px 28px; text-align: center;">
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center">
                    <div style="display: inline-block; width: 56px; height: 56px; line-height: 56px; font-size: 28px; background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.2); border-radius: 18px; margin-bottom: 12px;">
                      ${eventIcon}
                    </div>
                    <h1 style="color: #ffffff; margin: 0 0 6px 0; font-size: 21px; font-weight: 800; letter-spacing: -0.3px;">
                      Farm Direct Admin Notification
                    </h1>
                    <p style="color: #cae5cf; margin: 0; font-size: 13px; font-weight: 500;">
                      Authoritative Real-Time System Dispatch
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Notification Event Pill -->
          <tr>
            <td style="padding: 24px 28px 12px 28px; text-align: center;">
              <span style="display: inline-block; padding: 5px 14px; background: ${badgeBg}; color: ${badgeColor}; border: 1px solid rgba(0,0,0,0.06); border-radius: 999px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.6px;">
                ${badgeText}
              </span>
              <h2 style="margin: 10px 0 0 0; font-size: 18px; font-weight: 800; color: #132215;">
                ${event}
              </h2>
            </td>
          </tr>

          ${highlightValue ? `
          <!-- Prominent Highlight Card -->
          <tr>
            <td style="padding: 0 28px 16px 28px;">
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background: #f7faf5; border: 1px solid #dce8db; border-radius: 16px; padding: 16px;">
                <tr>
                  <td style="text-align: center;">
                    <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #627b65; margin-bottom: 4px;">
                      ${highlightTitle}
                    </div>
                    <div style="font-size: 24px; font-weight: 900; color: #194622;">
                      ${highlightValue}
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          ` : ''}

          <!-- Details Table -->
          <tr>
            <td style="padding: 0 28px 24px 28px;">
              <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse; background: #ffffff; border: 1px solid #edf4ec; border-radius: 14px; overflow: hidden;">
                <tbody>
                  ${detailRows}
                </tbody>
              </table>

              <!-- Quick Action Buttons -->
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-top: 24px;">
                <tr>
                  <td align="center">
                    <a href="https://mcqticker.online/farm/admin" style="display: inline-block; padding: 13px 26px; background: #194622; color: #ffffff; text-decoration: none; border-radius: 12px; font-weight: 800; font-size: 13px; box-shadow: 0 4px 12px rgba(25,70,34,0.25); margin: 4px;">
                      Open Admin Operations Dashboard &rarr;
                    </a>
                    ${waUrl ? `
                    <a href="${waUrl}" style="display: inline-block; padding: 13px 22px; background: #25D366; color: #ffffff; text-decoration: none; border-radius: 12px; font-weight: 800; font-size: 13px; box-shadow: 0 4px 12px rgba(37,211,102,0.25); margin: 4px;">
                      💬 WhatsApp ${custName}
                    </a>
                    ` : ''}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f4f8f3; border-top: 1px solid #e3ede1; padding: 20px 28px; text-align: center;">
              <p style="margin: 0 0 6px 0; font-size: 11px; font-weight: 700; color: #435946;">
                Farm Direct &bull; Fresh Harvest Logistical Network (Gwalior & Shivpuri, MP)
              </p>
              <p style="margin: 0; font-size: 11px; color: #728874;">
                Delivered automatically to primary administrator: <strong style="color: #194622;">${adminEmail}</strong>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  const textLines = Object.entries(details || {})
    .filter(([_, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `• ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join('\n');

  const text = `Farm Direct Administrative Alert: ${event}\n\n${textLines}\n\nOpen Admin: https://mcqticker.online/farm/admin${waUrl ? `\nWhatsApp Customer: ${waUrl}` : ''}`;

  return await sendEmail({ to: adminEmail, subject, html, text, env });
}


