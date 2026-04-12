const BUILD_ID = 'BUILD_ID';
const STATIC_CACHE_NAME = `katei-static-${BUILD_ID}`;
const OFFLINE_CACHE_NAME = `katei-offline-${BUILD_ID}`;
const OFFLINE_URL = '/offline.html';
const PRECACHE_URLS = Object.freeze(/* PRECACHE_URLS */ []);
const STATIC_PRECACHE_URLS = PRECACHE_URLS.filter((url) => url !== OFFLINE_URL);

const CACHEABLE_PATH_PREFIXES = [
  '/assets/',
  '/js/',
  '/vendor/',
  '/svg/',
  '/icons/'
];

const CACHEABLE_FILE_PATHS = new Set([
  '/favicon.svg',
  '/background.webp',
  '/manifest.webmanifest',
  '/profile.svg',
  '/switch.svg',
  '/traffic.svg'
]);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const offlineCache = await caches.open(OFFLINE_CACHE_NAME);
    const staticCache = await caches.open(STATIC_CACHE_NAME);

    await Promise.all([
      offlineCache.add(OFFLINE_URL),
      cachePrecacheUrls(staticCache)
    ]);

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();

    await Promise.all(
      cacheNames
        .filter((cacheName) => {
          return cacheName.startsWith('katei-')
            && cacheName !== STATIC_CACHE_NAME
            && cacheName !== OFFLINE_CACHE_NAME;
        })
        .map((cacheName) => caches.delete(cacheName))
    );

    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  if (url.origin !== self.location.origin || shouldBypassRequest(url.pathname)) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(request));
    return;
  }

  if (shouldCacheStaticAsset(url.pathname)) {
    event.respondWith(handleStaticAssetRequest(request));
  }
});

async function cachePrecacheUrls(staticCache) {
  if (STATIC_PRECACHE_URLS.length === 0) {
    return;
  }

  await staticCache.addAll(STATIC_PRECACHE_URLS);
}

async function handleNavigationRequest(request) {
  try {
    return await fetch(request);
  } catch {
    const offlineCache = await caches.open(OFFLINE_CACHE_NAME);
    return (await offlineCache.match(OFFLINE_URL)) || Response.error();
  }
}

async function handleStaticAssetRequest(request) {
  const staticCache = await caches.open(STATIC_CACHE_NAME);
  const cachedResponse = await staticCache.match(request);

  if (cachedResponse) {
    void refreshStaticAsset(staticCache, request).catch(() => {});
    return cachedResponse;
  }

  return refreshStaticAsset(staticCache, request);
}

async function refreshStaticAsset(cache, request) {
  const response = await fetch(request);

  if (response.ok) {
    await cache.put(request, response.clone());
  }

  return response;
}

function shouldBypassRequest(pathname) {
  return pathname.startsWith('/api/')
    || pathname.startsWith('/auth/')
    || pathname.startsWith('/__debug/');
}

function shouldCacheStaticAsset(pathname) {
  return CACHEABLE_FILE_PATHS.has(pathname)
    || CACHEABLE_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
