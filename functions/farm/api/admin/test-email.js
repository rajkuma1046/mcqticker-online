// GET /farm/api/admin/test-email — Diagnostic tool to test email dispatch live
import { json } from '../_lib/http.js';
import { sendAdminNotificationEmail, getEmailConfig } from '../_lib/email.js';

export async function onRequestGet({ request, env }) {
  const cfg = await getEmailConfig(env);
  
  let result;
  let error = null;
  try {
    result = await sendAdminNotificationEmail({
      event: 'Direct Diagnostic Test Alert',
      details: {
        'Test Type': 'Live System Verification',
        'Target Admin': 'rajkuma1046@gmail.com',
        'Timestamp': new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
        'Status': 'Diagnostics OK'
      },
      env
    });
  } catch (err) {
    error = {
      message: err.message,
      stack: err.stack
    };
  }

  return json({
    success: !error && (result?.success || false),
    config: {
      gmailUser: cfg.gmailUser,
      gmailAppPasswordSet: !!cfg.gmailPass,
      gmailAppPasswordLength: cfg.gmailPass ? cfg.gmailPass.length : 0,
      isConfigured: cfg.isConfigured
    },
    result,
    error
  });
}
