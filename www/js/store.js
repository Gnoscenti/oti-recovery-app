// @ts-check
/**
 * Small, safe wrapper over localStorage. Everything stays on the device; the
 * app never sends this data anywhere. Every access is guarded because storage
 * can be unavailable (private mode, blocked site data, embedded previews).
 */

const PREFIX = 'oti.';

/**
 * @template T
 * @param {string} key
 * @param {T} fallback
 * @returns {T}
 */
export function get(key, fallback) {
  try {
    const raw = globalThis.localStorage?.getItem(PREFIX + key);
    if (raw == null) return fallback;
    return /** @type {T} */ (JSON.parse(raw));
  } catch {
    return fallback;
  }
}

/**
 * @param {string} key
 * @param {unknown} value
 * @returns {boolean} whether the write succeeded
 */
export function set(key, value) {
  try {
    globalThis.localStorage?.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** @param {string} key */
export function remove(key) {
  try { globalThis.localStorage?.removeItem(PREFIX + key); } catch { /* ignore */ }
}

/** Keys used by the app, in one place. */
export const KEYS = {
  sobrietyDate: 'sobrietyDate',   // "YYYY-MM-DD"
  people: 'people',               // [{id,name,number,note}]
  reminders: 'reminders',         // { [eventId]: true }
  lastTab: 'lastTab',             // "home" | "calendar" | ...
  onboarded: 'onboarded',         // true after first visit
};
