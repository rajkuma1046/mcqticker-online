// POST /farm/api/admin/settings/test-email — Dispatch a live test email from configured Gmail
import { json, fail, readJson } from '../../_lib/http.js';
import { requireAdmin } from '../../_lib/auth.js';
import { sendEmail, getEmailConfig } from '../../_lib/email.js';

export async function onRequestPost({ request, env }) {
  await requireAdmin(request, env);
  const body = await readJson(request);

  const cfg = await getEmailConfig(env);
  const targetEmail = (body.targetEmail || cfg.gmailUser || '').trim();

  if (!targetEmail) {
    fail(400, 'Please provide a target email address to receive the test email.');
  }

  const subject = '🌾 Farm Direct Test Email — Verification System Active';
  const html = `
    <div style="font-family: sans-serif; padding: 24px; background: #f7faf5; color: #132215; border-radius: 16px; border: 1px solid #dce8db; max-width: 500px; margin: 0 auto;">
      <h2 style="color: #1b4522; margin-top: 0;">🌾 Test Email Delivered Successfully!</h2>
      <p style="font-size: 14px; line-height: 1.5; color: #495c4b;">
        Your automated email delivery system is functioning properly from your Gmail account.
      </p>
      <div style="background: white; border-radius: 12px; padding: 14px; border: 1px solid #e0ece0; font-size: 13px;">
        <strong>Sender:</strong> ${cfg.gmailUser || 'Google Apps Script / System'}<br/>
        <strong>Recipient:</strong> ${targetEmail}<br/>
        <strong>Timestamp:</strong> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} (IST)
      </div>
      <p style="font-size: 12px; color: #718573; margin-top: 16px;">
        Farm Direct &bull; Zero Middlemen Village Harvest
      </p>
    </div>
  `;
  const text = `Farm Direct Test Email\n\nYour automated email system is functioning properly.\nRecipient: ${targetEmail}`;

  const res = await sendEmail({
    to: targetEmail,
    subject,
    html,
    text,
    env,
  });

  if (!res.success) {
    return json({
      success: false,
      error: res.error || 'Failed to dispatch email. Please check your Gmail App Password or Webhook URL.'
    }, 400);
  }

  return json({
    success: true,
    message: `Test email sent successfully to ${targetEmail} via ${res.provider}!`,
    provider: res.provider,
  });
}
