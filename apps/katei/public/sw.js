const CACHE_VERSION = 'v1';
const STATIC_CACHE_NAME = `katei-static-${CACHE_VERSION}`;
const OFFLINE_CACHE_NAME = `katei-offline-${CACHE_VERSION}`;
const OFFLINE_URL = '/offline.html';

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
    await offlineCache.add(OFFLINE_URL);
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

  if (url.origin !== self.location.origin) {
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

function shouldCacheStaticAsset(pathname) {
  return CACHEABLE_FILE_PATHS.has(pathname)
    || CACHEABLE_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
