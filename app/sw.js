/* Service worker: lets the installed app open instantly and offline.
 * It only ever touches this app's own files. Requests to other sites (weather, Wikipedia...)
 * pass straight through and are never stored. */
const CACHE = 'jarvis-shell-v1';
const SHELL = ['./', 'index.html', 'styles.css', 'reactor.js', 'skills.js', 'jarvis.js', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));

// Network first (you always get the newest code when online), cache as the offline fallback.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
