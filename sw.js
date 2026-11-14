// Keeps the app and the photo reader on the phone so it opens and reads
// receipts with no signal.
const CACHE = 'receipt-coach-v3';
const SHARED = 'receipt-coach-shared'; // a receipt handed over from another app
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'parser.js', 'insights.js', 'sample.js', 'sync.js', 'config.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
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
    for (const key of await caches.keys()) if (key !== CACHE && key !== SHARED) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  // A receipt shared into the app from another app (Android share sheet):
  // set it aside for the page, then open the app.
  if (request.method === 'POST' && new URL(request.url).pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      const form = await request.formData();
      const cache = await caches.open(SHARED);
      const file = form.get('file');
      const text = ['title', 'text', 'url'].map((k) => form.get(k)).filter((v) => typeof v === 'string' && v).join('\n');
      await cache.put('shared-text', new Response(text));
      if (file && typeof file !== 'string' && file.size) {
        await cache.put('shared-file', new Response(file, { headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Name': encodeURIComponent(file.name || 'shared') } }));
      } else await cache.delete('shared-file');
      return Response.redirect(new URL('./?shared=1', self.registration.scope).href, 303);
    })());
    return;
  }
  if (request.method !== 'GET' || !request.url.startsWith('http')) return;
  const { origin, hostname } = new URL(request.url);
  const own = origin === self.location.origin;
  // Only the app and the reader are kept. Family sharing always goes to the network.
  if (!own && hostname !== 'cdn.jsdelivr.net') return;
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
