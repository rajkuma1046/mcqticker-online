// POST /farm/api/auth/logout — Clears the farm session cookie.
import { json } from '../_lib/http.js';
import { clearSessionCookie } from '../_lib/auth.js';

export async function onRequestPost({ request }) {
  return json(
    { success: true, message: 'Logged out successfully.' },
    200,
    { 'Set-Cookie': clearSessionCookie(request) }
  );
}
