const CACHE_NAME = 'traderslounge-v3-notifications';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
];

// ── Install ──────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

// ── Activate ─────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  event.waitUntil(self.clients.claim());
});

// ── Fetch (offline-first for navigations, cache-first for assets) ───
self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((response) => response || fetch(event.request))
  );
});

// ── Push Notifications ───────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = {
      title: 'ConfluenceX Alert',
      body: event.data.text(),
    };
  }

  const title = payload.title || 'ConfluenceX';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/confluencex-mark.svg',
    badge: payload.badge || '/confluencex-mark.svg',
    image: payload.image || undefined,
    tag: payload.tag || 'confluencex-alert',
    data: {
      url: payload.url || payload.data?.url || '/',
      alertType: payload.alertType || payload.data?.alertType,
      pair: payload.pair || payload.data?.pair,
      timestamp: Date.now(),
    },
    actions: payload.actions || [
      { action: 'view', title: 'View' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
    requireInteraction: payload.requireInteraction || false,
    silent: false,
    vibrate: [200, 100, 200],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification Click ───────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If there's already an open ConfluenceX tab, focus it and navigate
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          client.navigate(targetUrl);
          return;
        }
      }
      // Otherwise open a new tab
      return self.clients.openWindow(targetUrl);
    })
  );
});

// ── Push Subscription Change ─────────────────────────────────────────
self.addEventListener('pushsubscriptionchange', (event) => {
  console.log('[SW] Push subscription changed:', event.oldSubscription?.endpoint, '->', event.newSubscription?.endpoint);
});