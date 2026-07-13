// SantaVe Service Worker
// Strategy: Cache assets, never cache HTML, update on new version
const CACHE_VERSION = 'santave-v5-20260705';
const ASSET_CACHE = CACHE_VERSION + '-assets';
const API_CACHE = CACHE_VERSION + '-api';

// Cache these file types aggressively (they have hashes)
const ASSET_PATTERNS = [
  /\.js$/,
  /\.css$/,
  /\.png$/,
  /\.jpg$/,
  /\.jpeg$/,
  /\.gif$/,
  /\.svg$/,
  /\.woff2?$/,
  /\.ttf$/
];

// Never cache these (always fetch fresh)
const NO_CACHE_PATTERNS = [
  /index\.html$/,
  /\/$/,
  /\.html$/
];

// Domains that should never be cached (external APIs)
const API_DOMAINS = ['api.anthropic.com', 'supabase.co', 'googleapis.com'];

self.addEventListener('install', event => {
  console.log('[SW] Installing', CACHE_VERSION);
  self.skipWaiting(); // Activate immediately
});

self.addEventListener('activate', event => {
  console.log('[SW] Activating', CACHE_VERSION);
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => !name.includes(CACHE_VERSION))
          .map(name => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    })
  );
  self.clients.matchAll().then(clients => {
    clients.forEach(client => {
      client.postMessage({ type: 'CACHE_UPDATED' });
    });
  });
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // IMPORTANT: Always let external API calls through (POST, GET, etc.) - NO CACHING
  const isExternalAPI = API_DOMAINS.some(domain => url.hostname.includes(domain));
  if (isExternalAPI) {
    // Pass through API calls without any caching or interception
    event.respondWith(fetch(event.request));
    return;
  }
  
  // Skip non-GET requests for other domains
  if (event.request.method !== 'GET') {
    event.respondWith(fetch(event.request));
    return;
  }
  
  // Never cache HTML — always fetch fresh
  const shouldNeverCache = NO_CACHE_PATTERNS.some(pattern => pattern.test(url.pathname));
  if (shouldNeverCache) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response('Offline', { status: 503 });
      })
    );
    return;
  }
  
  // Cache assets
  const isAsset = ASSET_PATTERNS.some(pattern => pattern.test(url.pathname));
  if (isAsset) {
    event.respondWith(
      caches.match(event.request).then(response => {
        if (response) return response;
        return fetch(event.request).then(response => {
          if (!response || response.status !== 200) return response;
          const responseToCache = response.clone();
          caches.open(ASSET_CACHE).then(cache => {
            cache.put(event.request, responseToCache);
          });
          return response;
        });
      })
    );
    return;
  }
  
  // Default: network first, cache fallback
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (!response || response.status !== 200) return response;
        const responseToCache = response.clone();
        caches.open(API_CACHE).then(cache => {
          cache.put(event.request, responseToCache);
        });
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// Listen for messages from client to update
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
