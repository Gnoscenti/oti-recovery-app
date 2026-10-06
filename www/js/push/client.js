// @ts-check
import { CONFIG } from '../config.js';
import { el, clear } from '../dom.js';

/** Convert a public VAPID key to the browser subscription format. @param {string} value */
export function decodePublicKey(value) {
  const raw=atob(value.replace(/-/g,'+').replace(/_/g,'/'));
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
/** A participant explicitly opts in; never request notification permission on launch. */
export async function enablePush(api) {
  if(api.mode==='demo')throw new Error('Review copies do not send notifications.');
  if(!CONFIG.pushPublicKey)throw new Error('Event reminders are not configured yet.');
  if(!('serviceWorker' in navigator)||!('PushManager' in window)||!window.isSecureContext)throw new Error('Push reminders require a supported HTTPS browser or installed web app.');
  // This call must happen directly from a tap, before any network await (Safari requirement).
  if(await Notification.requestPermission()!=='granted')throw new Error('Notification permission was not granted.');
  const worker=await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const subscription=await worker.pushManager.getSubscription()||await worker.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decodePublicKey(CONFIG.pushPublicKey)});
  try {await api.savePushSubscription(subscription.toJSON());}catch(error){await subscription.unsubscribe();throw error;}
}
/** Revoke server access before removing the browser subscription. Called before sign-out. */
export async function disablePush(api) {
  if(api.mode==='demo'||!('serviceWorker' in navigator))return;
  const worker=await navigator.serviceWorker.getRegistration('/');
  const subscription=await worker?.pushManager.getSubscription();
  if(subscription){await api.deletePushSubscription(subscription.endpoint);await subscription.unsubscribe();}
}
/** @param {HTMLElement} root @param {any} api */
export function mountPushSettings(root,api) {
  clear(root);
  const enabled=!!CONFIG.pushPublicKey&&api.mode!=='demo';
  const status=el('p',{role:'status'},enabled?'Opt in to receive a private reminder one hour before calendar events. Declined cohort events are excluded.':'One-hour push reminders are awaiting server configuration.');
  const enable=el('button',{type:'button',class:'btn small',disabled:!enabled},'Enable event alerts');
  const disable=el('button',{type:'button',class:'btn small'},'Turn off event alerts');
  enable.addEventListener('click',async()=>{enable.disabled=true;try{await enablePush(api);status.textContent='Event alerts enabled on this device. Reminders show no participant, cohort or event names.';}catch(e){status.textContent=e instanceof Error?e.message:'Unable to enable reminders.';}finally{enable.disabled=!enabled;}});
  disable.addEventListener('click',async()=>{try{await disablePush(api);status.textContent='Event alerts turned off on this device.';}catch{status.textContent='Could not turn off alerts. Please try again before signing out.';}});
  root.append(el('div',{class:'card stack'},el('h3',{},'Event alerts'),el('p',{},'On iPhone: open this site in Safari, tap Share, choose Add to Home Screen, then open the app icon and sign in. Alerts require iOS 16.4 or later and your permission.'),status,el('div',{class:'row'},enable,disable)));
}
