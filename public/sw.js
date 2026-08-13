// ConfluenceX Service Worker
//
// Strategy summary:
//   • Precache: app shell (HTML, manifest, icons, offline page, mark SVG).
//   • Navigations: network-first, fall back to cached "/", then "/offline.html".
//     (We deliberately do NOT cache index.html blindly at install so updates
//     take effect on next navigation; only one cached "/index.html" copy is
//     refreshed whenever a fresh navigation succeeds.)
//   • Same-origin static assets (JS / CSS / fonts / images): stale-while-
//     revalidate. Offline reads use the cache, online reads update it.
//   • API + cross-origin requests (Binance, Twelve Data, FMP, Render API):
//     network-only. We never serve stale market data — better an honest error
//     than a misleading price.
//   • Push + notificationclick: handled as before (unchanged contract).
//
// Bump CACHE_VERSION whenever any cached file changes to invalidate stale
// shells in one step (clients claim + cache swap).

const CACHE_VERSION = 'cx-v4-pwa-2026-08-12';
const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const APP_SHELL = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.json',
  '/confluencex-mark.svg',
  '/confluencex-logo.svg',
  '/favicon.svg',
  '/apple-touch-icon.png',
  '/favicon-192.png',
  '/icons/favicon-32.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/shortcut-chart.png',
  '/icons/shortcut-scanner.png',
  '/icons/shortcut-signals.png',
];

// ── Install ─────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then(async (cache) => {
      // addAll is all-or-nothing; failures abort install. Use individual
      // put() so a single missing asset doesn't block everything.
      await Promise.all(
        APP_SHELL.map(async (url) => {
          try {
            const response = await fetch(url, { cache: 'reload' });
            if (response && response.ok) {
              await cache.put(url, response.clone());
            }
          } catch {
            /* offline / 4xx — skip silently, next install will retry */
          }
        }),
      );
      return self.skipWaiting();
    }),
  );
});

// ── Activate ────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((name) => name !== APP_SHELL_CACHE && name !== RUNTIME_CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

// ── Fetch routing ───────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 1) Navigations: network-first, offline fallback last.
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  // 2) Cross-origin (Binance, Twelve Data, FMP, Render API, fonts CDN):
  //    network-only. Do NOT cache market data.
  if (url.origin !== self.location.origin) {
    return; // default network behavior
  }

  // 3) Same-origin static assets: stale-while-revalidate.
  event.respondWith(staleWhileRevalidate(request));
});

async function handleNavigation(request) {
  try {
    const fresh = await fetch(request);
    // Refresh the "/" + "/index.html" shell copy opportunistically so the
    // next cold launch has the latest HTML.
    if (fresh && fresh.ok && request.url.startsWith(self.location.origin)) {
      const cache = await caches.open(APP_SHELL_CACHE);
      cache.put('/', fresh.clone()).catch(() => undefined);
      cache.put('/index.html', fresh.clone()).catch(() => undefined);
    }
    return fresh;
  } catch {
    const cache = await caches.open(APP_SHELL_CACHE);
    const cachedIndex =
      (await cache.match('/index.html')) ||
      (await cache.match('/')) ||
      (await cache.match('/offline.html'));
    if (cachedIndex) return cachedIndex;
    return new Response('<h1>Offline</h1>', {
      status: 503,
      headers: { 'Content-Type': 'text/html' },
    });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone()).catch(() => undefined);
      }
      return response;
    })
    .catch(() => undefined);
  return cached || (await networkPromise) || new Response('Offline', { status: 503 });
}

// ── Push Notifications (unchanged contract) ─────────────────────────
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

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          client.navigate(targetUrl);
          return;
        }
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});

self.addEventListener('pushsubscriptionchange', (event) => {
  // eslint-disable-next-line no-console
  console.log('[SW] Push subscription changed:', event.oldSubscription?.endpoint, '->', event.newSubscription?.endpoint);
});