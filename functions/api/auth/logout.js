import { json, getAuthCookieHeader } from './_utils.js';

export async function onRequestPost({ request }) {
  return json(
    { success: true },
    200,
    { 'Set-Cookie': getAuthCookieHeader('', request, 0) }
  );
}

