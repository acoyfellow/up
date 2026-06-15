const CACHE = 'up-shell-v2',
  SHELL = ['/', '/tutorial', '/how-to', '/reference', '/explanation', '/offline', '/icon.svg'];
self.addEventListener('install', (e) =>
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))),
);
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (
    e.request.method !== 'GET' ||
    u.origin !== location.origin ||
    u.pathname.startsWith('/api/') ||
    u.pathname === '/app' ||
    u.hostname !== location.hostname
  )
    return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        const x = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, x));
        return r;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('/offline'))),
  );
});
