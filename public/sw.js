/* D2P service worker — makes the app installable and usable offline.
   - App shell (navigations) is network-first, falling back to the cached shell.
   - Same-origin static assets are cache-first.
   - Cross-origin (Supabase API, Google Fonts) is left untouched. */
const CACHE = 'd2p-shell-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './logo-192.png', './logo-512.png', './favicon.ico'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase / fonts etc.

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch {
        const cache = await caches.open(CACHE);
        return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    if (hit) return hit;
    try {
      const fresh = await fetch(req);
      if (fresh.ok && /\.(?:js|css|png|jpe?g|svg|webp|ico|woff2?)$/.test(url.pathname)) cache.put(req, fresh.clone());
      return fresh;
    } catch {
      return hit || Response.error();
    }
  })());
});
