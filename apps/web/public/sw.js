/* Company OS service worker — offline app shell.
 * Caches same-origin GET responses (shell + hashed assets) and serves them
 * cache-first, falling back to the cached index.html for navigations when
 * offline. API calls (/api/*) are never cached: they must reach the network,
 * and offline writes are handled by the app's IndexedDB outbox, not the SW.
 */
const CACHE = 'companyos-shell-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res && res.status === 200 && (res.type === 'basic' || res.type === 'default')) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => {
          if (req.mode === 'navigate') return caches.match('/index.html');
          return new Response('', { status: 503, statusText: 'Offline' });
        });
    }),
  );
});
