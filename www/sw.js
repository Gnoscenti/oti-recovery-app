/* Service worker for the web (PWA) build only. The native app ships all files
   inside the binary and does not register this. Strategy: app shell is
   cached on install (offline-capable); content.json is network-first so
   updates show as soon as they are published. */
const VERSION = '__APP_VERSION__';
const SHELL = `oti-shell-${VERSION}`;
const SHELL_FILES = [
  './', './index.html', './app.js', './styles.css', './manifest.webmanifest',
  './fonts/fonts.css', './fonts/Fraunces-normal.woff2', './fonts/Fraunces-italic.woff2',
  './fonts/NunitoSans-normal.woff2', './fonts/NunitoSans-italic.woff2',
  './assets/logo.png', './assets/community.jpg', './assets/here-to-thrive.jpg',
  './data/content.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.url.includes('/data/content.json')) {
    event.respondWith(
      fetch(req).then((res) => { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); return res; })
        .catch(() => caches.match(req))
    );
    return;
  }
  event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});


// Lock-screen notifications never contain cohort names, participant names or event details.
self.addEventListener('push', (event) => {
  let expires;
  try { expires=Date.parse(event.data?.json()?.expires_at); } catch { /* use generic fallback */ }
  const upcoming=Number.isFinite(expires)&&expires>Date.now();
  event.waitUntil(self.registration.showNotification('Event reminder', {
    body: upcoming?'An event on your calendar starts in one hour. Open the app for details.':'Open the app to check your calendar.',
    icon:'/assets/icon-192.png',badge:'/assets/icon-192.png',
    tag:`calendar-reminder-${Number.isFinite(expires)?expires:'event'}`,
    data:{url:'/#calendar'},
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async()=>{
    const target=new URL('/#calendar',self.location.origin).href;
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const app=windows.find(w=>new URL(w.url).origin===self.location.origin&&!new URL(w.url).pathname.startsWith('/admin'));
    if(app){await app.navigate(target);await app.focus();}else await self.clients.openWindow(target);
  })());
});
