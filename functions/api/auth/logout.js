import { json } from './_utils.js';

export async function onRequestPost() {
  return json(
    { success: true },
    200,
    { 'Set-Cookie': 'auth_token=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax; Secure' }
  );
}
