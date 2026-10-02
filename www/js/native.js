// @ts-check
/**
 * Bridge to native capabilities through Capacitor. On the plain web build
 * every function degrades gracefully: reminders report "unavailable", the
 * back button is left to the browser.
 */
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { App } from '@capacitor/app';

export function isNative() {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
}

export function platform() {
  try { return Capacitor.getPlatform(); } catch { return 'web'; }
}

/**
 * Stable 31-bit integer id from a string (local notification ids must be ints).
 * @param {string} s
 */
export function intId(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 2147483647;
}

const WEEKDAY_NUM = { SU: 1, MO: 2, TU: 3, WE: 4, TH: 5, FR: 6, SA: 7 };

/**
 * @returns {Promise<'granted'|'denied'|'unavailable'>}
 */
export async function ensureNotificationPermission() {
  if (!isNative()) return 'unavailable';
  try {
    let status = await LocalNotifications.checkPermissions();
    if (status.display !== 'granted') status = await LocalNotifications.requestPermissions();
    return status.display === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'unavailable';
  }
}

/**
 * Schedule a repeating weekly reminder on the device (local time).
 * @param {{id:string, weekday:string, hour:number, minute:number, title:string, body:string}} r
 * @returns {Promise<'scheduled'|'denied'|'unavailable'|'error'>}
 */
export async function scheduleWeeklyReminder(r) {
  const perm = await ensureNotificationPermission();
  if (perm !== 'granted') return perm;
  const weekday = WEEKDAY_NUM[/** @type {keyof typeof WEEKDAY_NUM} */ (r.weekday.toUpperCase())];
  if (!weekday) return 'error';
  try {
    await LocalNotifications.schedule({
      notifications: [{
        id: intId(r.id),
        title: r.title,
        body: r.body,
        schedule: { on: { weekday, hour: r.hour, minute: r.minute }, allowWhileIdle: true },
        smallIcon: 'ic_stat_notify',
      }],
    });
    return 'scheduled';
  } catch {
    return 'error';
  }
}

/** @param {string} id */
export async function cancelReminder(id) {
  if (!isNative()) return;
  try { await LocalNotifications.cancel({ notifications: [{ id: intId(id) }] }); } catch { /* ignore */ }
}

/**
 * Android hardware back: go to Home first, then leave the app.
 * @param {() => boolean} handledByApp returns true when the app consumed the press
 */
export function onBackButton(handledByApp) {
  if (!isNative()) return;
  try {
    App.addListener('backButton', () => {
      if (!handledByApp()) App.exitApp();
    });
  } catch { /* ignore */ }
}
