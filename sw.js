const APP_CACHE_NAME = 'test-communes-app-cache-v869'; 
const DATA_CACHE_NAME = 'test-communes-data-cache-v869';
const TILE_CACHE_NAME = 'test-communes-tile-cache-v869';

const APP_SHELL_URLS = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './leaflet.min.js',
    './leaflet.css',
    './manifest.json',
    './suncalc.js',
    './jszip.min.js' // <-- LIGNE AJOUTÉE
];

const DATA_URLS = [
    './communes.json'
];

self.addEventListener('install', event => {
    console.log(`[SW] Installation ${APP_CACHE_NAME}`);
    event.waitUntil(
        Promise.all([
            caches.open(APP_CACHE_NAME).then(cache => cache.addAll(APP_SHELL_URLS)),
            caches.open(DATA_CACHE_NAME).then(cache => cache.addAll(DATA_URLS))
        ]).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => Promise.all(
            cacheNames.map(cacheName => {
                if (cacheName !== APP_CACHE_NAME && cacheName !== DATA_CACHE_NAME && cacheName !== TILE_CACHE_NAME) {
                    return caches.delete(cacheName);
                }
            })
        )).then(() => self.clients.claim())
    );
});

self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
        return;
    }

    if (event.data && event.data.type === 'OFFLINE_TILES_ENABLED_CHANGED') {
        offlineTilesEnabledCache = !!event.data.value;
        offlineTilesEnabledLoaded = true;
        return;
    }

    if (event.data && event.data.type === 'OFFLINE_ONLINE_FALLBACK_CHANGED') {
        offlineOnlineFallbackCache = !!event.data.value;
        offlineOnlineFallbackLoaded = true;
        return;
    }

    if (event.data && event.data.type === 'OFFLINE_ACTIVE_PACKS_CHANGED') {
        offlineActivePacksCache = Array.isArray(event.data.value) ? event.data.value.filter(Boolean) : [];
        offlineActivePacksLoaded = true;
        memoryTileCache.clear();
    }
});

let db;
const OFFLINE_TILES_ENABLED_KEY = 'offlineTilesEnabled';
const OFFLINE_SELECTED_PACK_KEY = 'offlineSelectedPack';
const DEFAULT_OFFLINE_TILES_ENABLED = true;
let offlineTilesEnabledCache = DEFAULT_OFFLINE_TILES_ENABLED;
let offlineTilesEnabledLoaded = false;
let offlineOnlineFallbackCache = true;
let offlineOnlineFallbackLoaded = false;
let offlineActivePacksCache = [];
let offlineActivePacksLoaded = false;
let tileCachePromise = null;
const MEMORY_TILE_CACHE_LIMIT = 300;
const memoryTileCache = new Map();

function getDb() {
    return new Promise((resolve, reject) => {
        if (db) return resolve(db);
        const request = indexedDB.open('OfflineTilesDB', 2);
        request.onupgradeneeded = event => {
            const dbInstance = event.target.result;
            const transaction = event.target.transaction;

            if (!dbInstance.objectStoreNames.contains('tiles')) {
                const store = dbInstance.createObjectStore('tiles', { keyPath: 'url' });
                store.createIndex('packName', 'packName', { unique: false });
            }

            if (!dbInstance.objectStoreNames.contains('settings')) {
                dbInstance.createObjectStore('settings', { keyPath: 'key' });
            }

            if (transaction && dbInstance.objectStoreNames.contains('settings')) {
                transaction.objectStore('settings').put({ key: OFFLINE_TILES_ENABLED_KEY, value: DEFAULT_OFFLINE_TILES_ENABLED });
            }
        };
        request.onsuccess = event => {
            db = event.target.result;
            resolve(db);
        };
        request.onerror = event => {
            reject('Erreur ouverture DB dans SW:', event.target.error);
        };
    });
}

function isOfflineTilesEnabled() {
    if (offlineTilesEnabledLoaded) {
        return Promise.resolve(offlineTilesEnabledCache);
    }

    return getDb().then(db => {
        return new Promise(resolve => {
            const transaction = db.transaction('settings', 'readonly');
            const store = transaction.objectStore('settings');
            const request = store.get(OFFLINE_TILES_ENABLED_KEY);
            request.onsuccess = () => {
                const value = (!request.result || typeof request.result.value !== 'boolean')
                    ? DEFAULT_OFFLINE_TILES_ENABLED
                    : request.result.value;
                offlineTilesEnabledCache = value;
                offlineTilesEnabledLoaded = true;
                resolve(value);
            };
            request.onerror = () => {
                offlineTilesEnabledCache = DEFAULT_OFFLINE_TILES_ENABLED;
                offlineTilesEnabledLoaded = true;
                resolve(DEFAULT_OFFLINE_TILES_ENABLED);
            };
        });
    }).catch(() => {
        offlineTilesEnabledCache = DEFAULT_OFFLINE_TILES_ENABLED;
        offlineTilesEnabledLoaded = true;
        return DEFAULT_OFFLINE_TILES_ENABLED;
    });
}

function normalizeTileUrl(url) {
    try {
        const parsed = new URL(url);
        if (parsed.hostname.match(/^[abc]\.tile\.openstreetmap\.org$/i)) {
            parsed.hostname = 'a.tile.openstreetmap.org';
            return parsed.toString();
        }
    } catch (e) {
        // URL invalide, on ignore la normalisation
    }
    return url;
}

function isOfflineOnlineFallbackEnabled() {
    if (offlineOnlineFallbackLoaded) {
        return Promise.resolve(offlineOnlineFallbackCache);
    }
    return Promise.resolve(offlineOnlineFallbackCache);
}

function getOfflineActivePacks() {
    if (offlineActivePacksLoaded) {
        return Promise.resolve(offlineActivePacksCache);
    }
    return Promise.resolve(offlineActivePacksCache);
}

function getTileFromDb(url) {
    const normalizedUrl = normalizeTileUrl(url);
    return Promise.all([getDb(), getOfflineActivePacks()]).then(([db, activePacks]) => {
        const activeSet = new Set(Array.isArray(activePacks) ? activePacks : []);
        const inMemoryTile = memoryTileCache.get(normalizedUrl);
        if (inMemoryTile && (!activeSet.size || activeSet.has(inMemoryTile.packName || ''))) {
            memoryTileCache.delete(normalizedUrl);
            memoryTileCache.set(normalizedUrl, inMemoryTile);
            return new Response(inMemoryTile.tileBlob);
        }

        return new Promise(resolve => {
            const transaction = db.transaction('tiles', 'readonly');
            const store = transaction.objectStore('tiles');

            const candidates = [url];
            const normalizedUrl = normalizeTileUrl(url);
            if (normalizedUrl !== url) candidates.push(normalizedUrl);

            const tryNext = () => {
                if (!candidates.length) {
                    resolve(null);
                    return;
                }

                const candidateUrl = candidates.shift();
                const request = store.get(candidateUrl);
                request.onsuccess = () => {
                    const record = request.result;
                    if (record && (!activeSet.size || activeSet.has(record.packName || ''))) {
                        const tileBlob = record.tile;
                        memoryTileCache.set(normalizedUrl, { tileBlob, packName: record.packName || '' });
                        if (memoryTileCache.size > MEMORY_TILE_CACHE_LIMIT) {
                            const oldestKey = memoryTileCache.keys().next().value;
                            memoryTileCache.delete(oldestKey);
                        }
                        resolve(new Response(tileBlob));
                    } else {
                        tryNext();
                    }
                };
                request.onerror = () => tryNext();
            };

            tryNext();
        });
    });
}

function getTileFromNetworkOrCache(request) {
    if (!tileCachePromise) {
        tileCachePromise = caches.open(TILE_CACHE_NAME);
    }

    return tileCachePromise.then(cache => {
        const normalizedUrl = normalizeTileUrl(request.url);
        return fetchAndCacheTile(cache, request, normalizedUrl).catch(() => {
            return cache.match(request).then(cachedResponse => {
                if (cachedResponse) return cachedResponse;
                if (normalizedUrl !== request.url) {
                    return cache.match(normalizedUrl);
                }
                return null;
            });
        });
    });
}

function fetchAndCacheTile(cache, request, normalizedUrl = request.url) {
    const networkRequest = normalizedUrl === request.url ? request : normalizedUrl;
    return fetch(networkRequest).then(networkResponse => {
        if (networkResponse && networkResponse.ok) {
            cache.put(networkRequest, networkResponse.clone());
        }
        return networkResponse;
    });
}

function getTileFromCacheOnly(request) {
    if (!tileCachePromise) {
        tileCachePromise = caches.open(TILE_CACHE_NAME);
    }

    return tileCachePromise.then(cache => {
        return cache.match(request).then(cachedResponse => {
            if (cachedResponse) return cachedResponse;
            const normalizedUrl = normalizeTileUrl(request.url);
            if (normalizedUrl !== request.url) {
                return cache.match(normalizedUrl);
            }
            return null;
        });
    });
}

self.addEventListener('fetch', event => {
    const requestUrl = new URL(event.request.url);

    // Stratégie pour les tuiles de carte
    if (requestUrl.hostname.includes('tile.openstreetmap.org')) {
        event.respondWith(
            Promise.all([isOfflineTilesEnabled(), isOfflineOnlineFallbackEnabled()]).then(([enabled, onlineFallbackEnabled]) => {
                if (!enabled) {
                    return getTileFromNetworkOrCache(event.request);
                }

                return getTileFromDb(event.request.url).then(dbTile => {
                    if (dbTile) return dbTile;
                    if (!onlineFallbackEnabled) {
                        return getTileFromCacheOnly(event.request);
                    }
                    return getTileFromNetworkOrCache(event.request).catch(() => getTileFromCacheOnly(event.request));
                });
            })
        );
        return;
    }
    
    // Stratégie pour le reste (App Shell, données): réseau d'abord, puis fallback cache
    event.respondWith(
        fetch(event.request)
            .then(networkResponse => {
                if (event.request.method === 'GET' && networkResponse && networkResponse.ok) {
                    const requestUrlString = event.request.url;
                    const appShellUrls = new Set(APP_SHELL_URLS.map(url => new URL(url, self.location.origin).toString()));
                    const dataUrls = new Set(DATA_URLS.map(url => new URL(url, self.location.origin).toString()));
                    let cacheName = null;

                    if (appShellUrls.has(requestUrlString)) cacheName = APP_CACHE_NAME;
                    else if (dataUrls.has(requestUrlString)) cacheName = DATA_CACHE_NAME;

                    if (cacheName) {
                        caches.open(cacheName).then(cache => cache.put(event.request, networkResponse.clone()));
                    }
                }
                return networkResponse;
            })
            .catch(() => {
                return caches.match(event.request).then(cachedResponse => {
                    if (cachedResponse) {
                        return cachedResponse;
                    }
                    if (event.request.mode === 'navigate') {
                        return caches.match('./index.html');
                    }
                });
            })
    );
});
