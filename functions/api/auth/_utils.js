// _utils.js

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  });
}

// ── Password Hashing (PBKDF2) ──

export function generateSalt() {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function hashPassword(password, saltStr) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits", "deriveKey"]
  );
  
  // Use a small iteration count for fast Edge execution (minimum acceptable 100k)
  const salt = enc.encode(saltStr);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true, ["encrypt", "decrypt"]
  );
  
  const exported = await crypto.subtle.exportKey("raw", key);
  const hashBuffer = new Uint8Array(exported);
  return Array.from(hashBuffer).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── JWT Signing and Verification (HMAC SHA-256) ──

function base64UrlEncode(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function signJWT(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const data = `${encodedHeader}.${encodedPayload}`;
  
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  const signature = base64UrlEncode(String.fromCharCode(...new Uint8Array(signatureBuffer)));
  
  return `${data}.${signature}`;
}

export async function verifyJWT(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const data = `${parts[0]}.${parts[1]}`;
    const signature = parts[2];
    
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    
    let b64 = signature.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const sigBytes = new Uint8Array(atob(b64).split('').map(c => c.charCodeAt(0)));
    
    const isValid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(data));
    if (!isValid) return null;
    
    const payloadStr = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(payloadStr);
  } catch (e) {
    return null;
  }
}

export function parseCookies(request) {
  const cookieHeader = request?.headers?.get('Cookie');
  if (!cookieHeader) return {};
  return Object.fromEntries(
    cookieHeader.split(';').map(c => {
      const parts = c.trim().split('=');
      return [parts[0], parts.slice(1).join('=')];
    })
  );
}

export function getAuthCookieHeader(token, request, maxAge = 60 * 60 * 24 * 30) {
  const isHttps = request ? (
    (typeof request.url === 'string' && request.url.startsWith('https:')) ||
    request.headers?.get('x-forwarded-proto') === 'https'
  ) : false;
  const secureFlag = isHttps ? '; Secure' : '';
  return `auth_token=${token}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax${secureFlag}`;
}

export async function getAuthUser(request, env) {
  try {
    let token = null;

    // 1. Check Authorization header
    const authHeader = request?.headers?.get('Authorization') || request?.headers?.get('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    }

    // 2. Check Cookie header fallback
    if (!token) {
      const cookies = parseCookies(request);
      token = cookies['auth_token'];
    }

    if (!token) return null;

    const secret = env?.JWT_SECRET || 'default_fallback_secret_123';
    const payload = await verifyJWT(token, secret);

    if (!payload || !payload.id || !payload.email) {
      return null;
    }

    return { id: payload.id, email: payload.email };
  } catch (err) {
    console.error('[auth] verify user error:', err);
    return null;
  }
}

