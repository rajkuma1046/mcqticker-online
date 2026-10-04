// Farm Direct — input validation helpers. All user input passes through here.
import { fail } from './http.js';

// Strip control characters (except newlines when allowed) and trim.
function clean(value, allowNewlines = false) {
  if (value === undefined || value === null) return '';
  let s = String(value);
  s = allowNewlines ? s.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '') : s.replace(/[\u0000-\u001F\u007F]/g, ' ');
  return s.replace(/[ \t]+/g, ' ').trim();
}

export function str(value, { label = 'Field', min = 0, max = 200, required = false, multiline = false } = {}) {
  const s = clean(value, multiline);
  if (!s) {
    if (required) fail(400, `${label} is required.`);
    return '';
  }
  if (s.length < min) fail(400, `${label} must be at least ${min} characters.`);
  if (s.length > max) fail(400, `${label} must be at most ${max} characters.`);
  return s;
}

/** Normalise an Indian mobile number to 10 digits; throws when invalid. */
export function phone(value, { required = true, label = 'Mobile number' } = {}) {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) {
    if (required) fail(400, `${label} is required.`);
    return '';
  }
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (!/^[6-9]\d{9}$/.test(digits)) fail(400, `Please enter a valid 10-digit ${label.toLowerCase()}.`);
  return digits;
}

export function email(value, { required = false } = {}) {
  const s = clean(value).toLowerCase();
  if (!s) {
    if (required) fail(400, 'Email is required.');
    return '';
  }
  if (s.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) fail(400, 'Please enter a valid email address.');
  return s;
}

export function int(value, { label = 'Value', min = -Infinity, max = Infinity, required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) fail(400, `${label} is required.`);
    return null;
  }
  const n = Number(value);
  if (!Number.isInteger(n)) fail(400, `${label} must be a whole number.`);
  if (n < min || n > max) fail(400, `${label} must be between ${min} and ${max}.`);
  return n;
}

export function id(value, label = 'ID') {
  return int(value, { label, min: 1, max: 2 ** 31 });
}

export function bool(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

/** Admin money input in rupees (max 2 decimals) → integer paise. */
export function rupeesToPaise(value, { label = 'Amount', required = true, allowZero = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) fail(400, `${label} is required.`);
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) fail(400, `${label} is not a valid amount.`);
  const paise = Math.round(n * 100);
  if (Math.abs(paise - n * 100) > 0.001) fail(400, `${label} can have at most 2 decimal places.`);
  if (!allowZero && paise === 0) fail(400, `${label} must be greater than zero.`);
  return paise;
}

export function oneOf(value, allowed, label = 'Value') {
  if (!allowed.includes(value)) fail(400, `${label} is not valid.`);
  return value;
}

export function pincode(value) {
  const s = clean(value);
  if (!s) return '';
  if (!/^\d{6}$/.test(s)) fail(400, 'PIN code must be 6 digits.');
  return s;
}

export function dateYmd(value, label = 'Date') {
  const s = clean(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s + 'T00:00:00Z'))) fail(400, `${label} must be a valid date.`);
  return s;
}

export function slug(value) {
  const s = clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!s || s.length > 80) fail(400, 'Slug must be 1–80 letters, numbers or dashes.');
  return s;
}

/** Validate a cart/order item list: [{product_id, quantity}] → merged, validated array. */
export function cartItems(value, { maxItems = 20, allowEmpty = false } = {}) {
  if (!Array.isArray(value)) fail(400, 'Your cart is invalid.');
  if (!allowEmpty && value.length === 0) fail(400, 'Your cart is empty.');
  if (value.length > maxItems) fail(400, `A maximum of ${maxItems} different products is allowed per order.`);
  const merged = new Map();
  for (const raw of value) {
    const pid = Number(raw?.product_id);
    const qty = Number(raw?.quantity);
    if (!Number.isInteger(pid) || pid < 1) fail(400, 'Your cart contains an invalid product.');
    if (!Number.isInteger(qty) || qty < 1 || qty > 10000) fail(400, 'Quantities must be whole kilograms.');
    merged.set(pid, (merged.get(pid) || 0) + qty);
  }
  return [...merged.entries()].map(([product_id, quantity]) => ({ product_id, quantity }));
}
