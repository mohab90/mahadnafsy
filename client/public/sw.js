/* Service Worker — معهد الدراسات النفسية
   Strategy: cache-first for static assets, network-first for API

   Every branch below answers respondWith(), and a promise that rejects there
   does not fall back to the network — the browser turns it into a failed
   navigation. That is how a momentary fetch failure became a blank page:

     The FetchEvent for "https://mahadnafsy.com/c/positive-parenting"
     resulted in a network error response: the promise was rejected.
     sw.js:55  Uncaught (in promise) TypeError: Failed to fetch

   Reported from a customer's browser on 2026-09-23, minutes after a release —
   which is exactly the window where it is most likely, because the asset files
   are being swapped on the server while people are loading pages. So nothing
   here is allowed to reject. */

const CACHE_NAME = 'mahad-__SW_VERSION__';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/favicon.svg',
  '/manifest.json',
];

/** Cache a response without letting a storage failure reject the request. */
function store(request, response) {
  if (!response || response.status !== 200) return;
  const clone = response.clone();
  caches.open(CACHE_NAME)
    .then(cache => cache.put(request, clone))
    .catch(() => { /* quota or private mode — serving the response still worked */ });
}

self.addEventListener('install', (event) => {
  // One at a time, not addAll: addAll is atomic, so a single missing file — one
  // renamed icon — fails the whole install. The new worker then never
  // activates, and every returning visitor keeps being served the previous
  // release's JS from the old cache, with nothing to say why.
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(STATIC_ASSETS.map(asset => cache.add(asset).catch(() => {})))
    ).catch(() => { /* a worker that cannot pre-cache is still worth activating */ })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).catch(() => {})
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and API/external requests — always network
  if (request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.origin !== self.location.origin) return;

  // For navigation requests (HTML): network-first with offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          store(request, response);
          return response;
        })
        // caches.match resolves undefined on a miss, and respondWith(undefined)
        // is itself a network error — the blank page this fallback exists to
        // prevent. The shell first, then the request's own cached copy, and
        // only then an answer that at least says what happened.
        .catch(() => caches.match('/index.html')
          .then(shell => shell || caches.match(request))
          .then(cached => cached || new Response(
            '<!doctype html><meta charset="utf-8"><title>لا يوجد اتصال</title>'
            + '<body style="font-family:system-ui;text-align:center;padding:3rem">'
            + '<h1>لا يوجد اتصال بالإنترنت</h1><p>حاول تحديث الصفحة.</p>',
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
          )))
    );
    return;
  }

  // For JS/CSS/images: cache-first
  event.respondWith(
    caches.match(request)
      .then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          store(request, response);
          return response;
        });
      })
      // The asset genuinely could not be fetched. Answering with a network
      // error is the same outcome the page would have had without a service
      // worker, and it leaves the app's own retry to do its job — where a
      // rejection here took the whole navigation down with it.
      .catch(() => caches.match(request).then(stale => stale || Response.error()))
  );
});
