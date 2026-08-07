'use strict';

const CACHE = 'techscope-static-v4.4.1';
const STATIC_ASSETS = [
  '/', '/index.html', '/styles.css', '/home.css', '/ranking-filters.css', '/sidebar-quotes.css',
  '/prelude.js', '/app-core.js', '/app-data.js', '/app-home.js', '/ranking-filters.js', '/sidebar-quotes.js', '/app-charts.js',
  '/manifest.webmanifest', '/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  const networkFirst = event.request.mode === 'navigate' || /\.(?:js|css)$/.test(url.pathname);
  if (networkFirst) {
    event.respondWith(fetch(event.request).then((response) => {
      if (response.ok) caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
      return response;
    }).catch(async () => {
      if (event.request.mode === 'navigate') return (await caches.match('/index.html')) || Response.error();
      return (await caches.match(event.request)) || (await caches.match(url.pathname)) || Response.error();
    }));
    return;
  }

  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    if (response.ok) caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
    return response;
  })));
});
