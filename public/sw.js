// MCQ Ticker Custom Service Worker (sw.js)
const CACHE_NAME = 'mcq-ticker-cache-v2';

// Core routes and assets to cache immediately upon installation
const PRECACHE_ASSETS = [
  '/',
  '/new-session',
  '/active-test',
  '/about',
  '/privacy',
  '/contact',
  '/logo-light.webp',
  '/logo-dark.webp',
  '/favicon.ico',
  '/favicon.svg',
  '/favicon-96x96.png',
  '/apple-touch-icon.png',
  '/web-app-manifest-192x192.png',
  '/web-app-manifest-512x512.png',
  '/site.webmanifest'
];

// Install event: cache all core assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Precaching core app shell');
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event: clean up outdated caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] Deleting outdated cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event: intercept requests to enable offline mode
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Skip non-GET requests (e.g. POST, PUT, DELETE)
  if (request.method !== 'GET') return;

  // Strategy 1: Navigation Requests (HTML Pages) -> NetworkFirst
  // Try network first to get latest updates, fallback to cache if offline
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Clone the response and store it in cache
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
          return response;
        })
        .catch(() => {
          // Offline fallback: try to serve from cache
          return caches.match(request).then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // If the specific route is not in cache, fallback to index root
            return caches.match('/');
          });
        })
    );
    return;
  }

  // Strategy 2: Hashed/Static Assets (Astro builds, local images/manifest) -> CacheFirst
  // Check cache first; if not found, fetch from network and save to cache.
  // Astro assets are compiled with content-based hashes (_astro/*), so they never change.
  const isAstroAsset = url.pathname.includes('/_astro/') || url.pathname.startsWith('/_astro');
  const isBrandingAsset = PRECACHE_ASSETS.includes(url.pathname);
  const isGoogleFont = url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com');

  if (isAstroAsset || isBrandingAsset || isGoogleFont) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(request).then((response) => {
          // Verify we received a valid response
          if (!response || response.status !== 200 || response.type !== 'basic' && response.type !== 'cors') {
            return response;
          }

          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
          return response;
        }).catch((err) => {
          console.warn('[Service Worker] Failed to fetch and cache asset:', request.url, err);
          return response; // Fallback to raw response or error if offline
        });
      })
    );
    return;
  }

  // Strategy 3: Default -> StaleWhileRevalidate / NetworkFirst
  // For other requests, try network first, then cache
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return networkResponse;
      }).catch(() => {
        // Suppress errors, let it fallback to cache
      });

      return cachedResponse || fetchPromise;
    })
  );
});
