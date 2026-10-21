// Field Unit service worker: offline shell + alerts relayed by Command.
const CACHE = 'field-unit-v1.11.0';
const SHELL = ['./', 'index.html', 'styles.css', 'boot.css', 'app.js', 'boot.js', 'manifest.webmanifest', 'lib/core.js', 'lib/sync.js', 'lib/util.js', 'lib/manifest.js', 'lib/roster.js', 'icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Network first (always fresh when online), cache when offline.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const fonts = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if ((!sameOrigin && !fonts) || url.pathname.startsWith('/__/')) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match(/^\/m(anifest\.html)?$/.test(url.pathname) ? 'manifest.html' : /^\/s(\/|$)|^\/schedule\.html$/.test(url.pathname) ? 'schedule.html' : 'index.html')))
  );
});

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { data = { title: 'Field Unit', body: e.data && e.data.text() }; }
  const title = data.title || 'Field Unit';
  e.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    tag: data.tag || undefined,
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    data: { taskId: data.taskId || null }
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) return c.focus(); }
    return self.clients.openWindow('./');
  }));
});
