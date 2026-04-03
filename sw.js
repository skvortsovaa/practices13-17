const APP_SHELL_CACHE = 'app-shell-v7';
const DYNAMIC_CACHE = 'dynamic-content-v2';

const APP_SHELL_ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/manifest.json',
  '/content/home.html',
  '/content/about.html',
  '/icons/favicon.ico',
  '/icons/icon-152x152.png',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/socket.io/socket.io.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(APP_SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== APP_SHELL_CACHE && key !== DYNAMIC_CACHE)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname.startsWith('/content/')) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          const responseClone = networkResponse.clone();
          caches.open(DYNAMIC_CACHE).then((cache) => {
            cache.put(event.request, responseClone);
          });

          return networkResponse;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match('/content/home.html')))
    );

    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

self.addEventListener('push', (event) => {
  let data = { title: 'Новое уведомление', body: '', reminderId: null };

  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-152x152.png',
    data: { reminderId: data.reminderId ?? null }
  };

  if (data.reminderId) {
    options.actions = [
      { action: 'snooze', title: 'Отложить на 5 минут' }
    ];
  }

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (event) => {
  const reminderId = event.notification.data?.reminderId;

  event.notification.close();

  if (event.action === 'snooze' && reminderId) {
    event.waitUntil(
      fetch(`/snooze?reminderId=${reminderId}`, { method: 'POST' })
        .catch((err) => console.error('Snooze failed:', err))
    );
    return;
  }

  event.waitUntil(clients.openWindow('/'));
});
