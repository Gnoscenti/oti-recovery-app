// @ts-check
/**
 * Phone-list helpers: dial/text links, number formatting, search.
 * Everything here is pure so it can be unit-tested in Node.
 */

/**
 * @typedef {Object} PhoneEntry
 * @property {string} id
 * @property {string} name
 * @property {string|null} number     Digits only (may include leading country code) or a short code like "988"; null when the line is text-only
 * @property {string} display         Human-readable number
 * @property {{number:string, body?:string}} [sms]
 * @property {string} hours
 * @property {string} [languages]
 * @property {string} category
 * @property {string} description
 * @property {string} [url]
 */

/**
 * Keep only digits (and a leading +).
 * @param {string} input
 */
export function normalizeNumber(input) {
  const trimmed = String(input || '').trim();
  const plus = trimmed.startsWith('+') ? '+' : '';
  return plus + trimmed.replace(/\D/g, '');
}

/**
 * Format a digit string for display: 10-digit US → (619) 555-0100,
 * 11-digit leading 1 → 1-619-555-0100, anything else unchanged.
 * @param {string} digits
 */
export function formatDisplay(digits) {
  const d = normalizeNumber(digits).replace(/^\+/, '');
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === '1') return `1-${d.slice(1, 4)}-${d.slice(4, 7)}-${d.slice(7)}`;
  return digits;
}

/**
 * A user-entered number is usable if it is a short code (3–6 digits) or a
 * 10/11-digit North American number, or an international number with +.
 * @param {string} input
 */
export function isValidNumber(input) {
  const n = normalizeNumber(input);
  if (n.startsWith('+')) return n.length >= 8 && n.length <= 16;
  return /^\d{3,6}$/.test(n) || /^\d{10}$/.test(n) || /^1\d{10}$/.test(n);
}

/** @param {string} number */
export function telHref(number) {
  const n = normalizeNumber(number);
  if (!n) return '';
  if (n.startsWith('+') || /^\d{3,6}$/.test(n)) return `tel:${n}`;
  if (/^\d{10}$/.test(n)) return `tel:+1${n}`;
  if (/^1\d{10}$/.test(n)) return `tel:+${n}`;
  return `tel:${n}`;
}

/**
 * sms: link with an optional prefilled body. Uses the `?body=` form, which
 * both iOS and Android understand.
 * @param {{number:string, body?:string}} sms
 */
export function smsHref(sms) {
  const n = normalizeNumber(sms.number);
  const target = /^\d{10}$/.test(n) ? `+1${n}` : /^1\d{10}$/.test(n) ? `+${n}` : n;
  return sms.body ? `sms:${target}?body=${encodeURIComponent(sms.body)}` : `sms:${target}`;
}

/**
 * Case-insensitive search over name, description, category, display number.
 * @template {PhoneEntry} T
 * @param {T[]} entries
 * @param {string} query
 * @returns {T[]}
 */
export function searchPhones(entries, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return entries;
  const qDigits = q.replace(/\D/g, '');
  return entries.filter((e) => {
    const hay = `${e.name} ${e.description} ${e.category} ${e.hours} ${e.languages || ''}`.toLowerCase();
    if (hay.includes(q)) return true;
    if (qDigits.length >= 3 && (e.number || '').includes(qDigits)) return true;
    return false;
  });
}

/**
 * Group entries by category, preserving the category order given.
 * @template {PhoneEntry} T
 * @param {T[]} entries
 * @param {{id:string,label:string,blurb?:string}[]} categories
 */
export function groupByCategory(entries, categories) {
  return categories
    .map((c) => ({ ...c, items: entries.filter((e) => e.category === c.id) }))
    .filter((g) => g.items.length > 0);
}
