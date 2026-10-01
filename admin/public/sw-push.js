/* Staff notifications on the phone (api/lib/staffPush.js): shows what the bell
   would, and opens the panel on a tap. Push only — no caching, so the panel
   always loads fresh. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(data.title || 'معهد الدراسات النفسية', {
    body: data.body || '',
    tag: data.tag || undefined,
    dir: 'rtl',
    lang: 'ar',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    data: { url: data.url || '/dashboard' },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/dashboard', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(client => client.url.startsWith(self.location.origin));
    if (open) return open.focus().then(client => (client.navigate ? client.navigate(url) : client));
    return self.clients.openWindow(url);
  }));
});
