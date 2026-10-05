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

    const rawMessage = [
      `From: "Farm Direct Gwalior" <${user}>`,
      `To: <${to}>`,
      `Subject: ${encodedSubject}`,
      `Date: ${dateStr}`,
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
    : 'Welcome to Farm Direct Gwalior! Use the 6-digit code below to complete your customer account registration.';

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
              <h1 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -0.3px;">Farm Direct Gwalior</h1>
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
                Farm Direct &bull; Village Farm near Gwalior, Madhya Pradesh<br/>
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

  const text = `${title}\n\nYour 6-digit verification code is: ${code}\n\nThis code is valid for 10 minutes.\n\nFarm Direct Gwalior\nWhatsApp: +91 8770767272`;

  const result = await sendEmail({ to, subject, html, text, env });
  return result;
}
