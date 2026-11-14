// Keeps the app and the photo reader on the phone so it opens and reads
// receipts with no signal.
const CACHE = 'receipt-coach-v1';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'parser.js', 'insights.js', 'sample.js', 'manifest.webmanifest', 'icon.svg'];
const READER = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    await cache.add(new Request(READER, { mode: 'no-cors' })).catch(() => {});
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET' || !request.url.startsWith('http')) return;
  const own = new URL(request.url).origin === self.location.origin;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const keep = (res) => { if (res.ok || res.type === 'opaque') cache.put(request, res.clone()); return res; };
    if (own) {
      // The app's own files: newest when online, saved copy when not.
      try { return keep(await fetch(request)); } catch (err) {
        const saved = await cache.match(request, { ignoreSearch: true });
        if (saved) return saved;
        throw err;
      }
    }
    // The reader's files never change for a given version: saved copy first.
    return (await cache.match(request)) || keep(await fetch(request));
  })());
});
