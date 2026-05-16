const SW_VERSION = 'sw-offline-tiles-push-v1035-cache-direct';

const TILE_CACHE_PREFIX = 'test-communes-tile-cache-';
const DB_NAME = 'OfflineTilesDB';
const DB_VERSION = 3;

const OFFLINE_TILES_ENABLED_KEY = 'offlineTilesEnabled';
const OFFLINE_ONLINE_FALLBACK_KEY = 'offlineOnlineFallback';
const OFFLINE_ACTIVE_PACKS_KEY = 'offlineActivePacks';

let offlineTilesEnabled = false;
let offlineOnlineFallback = false;
let activeOfflinePacks = [];

let dbPromise = null;
let offlineSettingsLoadedAt = 0;
let fastTileCacheName = null;
let fastTileCache = null;

const SETTINGS_REFRESH_INTERVAL_MS = 5000;
const MEMORY_TILE_CACHE_MAX = 400;
const memoryTileCache = new Map();

self.addEventListener('install', event => {
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        await refreshOfflineSettingsFromDB({ force: true });
        await prepareFastTileCache();
        await self.clients.claim();
    })());
});

self.addEventListener('message', event => {
    const data = event.data || {};

    if (data.type === 'SKIP_WAITING') {
        self.skipWaiting();
        return;
    }

    if (data.type === 'OFFLINE_TILES_ENABLED_CHANGED') {
        offlineTilesEnabled = !!data.value;
        offlineSettingsLoadedAt = Date.now();
        return;
    }

    if (data.type === 'OFFLINE_ONLINE_FALLBACK_CHANGED') {
        offlineOnlineFallback = !!data.value;
        offlineSettingsLoadedAt = Date.now();
        return;
    }

    if (data.type === 'OFFLINE_ACTIVE_PACKS_CHANGED') {
        activeOfflinePacks = Array.isArray(data.value) ? data.value.filter(Boolean) : [];
        offlineSettingsLoadedAt = Date.now();
        memoryTileCache.clear();
        prepareFastTileCache().catch(() => {});
        return;
    }

    if (data.type === 'OFFLINE_TILE_CACHE_READY') {
        fastTileCacheName = data.cacheName || null;
        fastTileCache = null;
        prepareFastTileCache({ force: true }).catch(() => {});
    }
});

self.addEventListener('fetch', event => {
    const request = event.request;

    if (request.method !== 'GET') return;

    if (isOpenStreetMapTileRequest(request.url)) {
        event.respondWith(handleTileRequest(request));
        return;
    }

    event.respondWith(fetch(request));
});

async function handleTileRequest(request) {
    await refreshOfflineSettingsFromDB();

    if (offlineTilesEnabled) {
        const offlineResponse = await findOfflineTileResponse(request.url);
        if (offlineResponse) return offlineResponse;

        return new Response('', {
            status: 404,
            statusText: 'Offline tile not found'
        });
    }

    try {
        return await fetch(request);
    } catch (networkError) {
        if (offlineOnlineFallback) {
            const offlineResponse = await findOfflineTileResponse(request.url);
            if (offlineResponse) return offlineResponse;
        }

        throw networkError;
    }
}

function isOpenStreetMapTileRequest(url) {
    try {
        const parsed = new URL(url);
        if (!/\.tile\.openstreetmap\.org$/i.test(parsed.hostname)) return false;
        return /\/\d+\/\d+\/\d+\.(png|jpg|jpeg)$/i.test(parsed.pathname);
    } catch (_) {
        return false;
    }
}

async function findOfflineTileResponse(tileUrl) {
    const cacheKey = `${tileUrl}::${(activeOfflinePacks || []).join('|')}`;

    const cachedMemory = memoryTileCache.get(cacheKey);
    if (cachedMemory) {
        touchMemoryTile(cacheKey, cachedMemory);
        return cachedMemory.clone();
    }

    try {
        const cache = await prepareFastTileCache();
        if (cache) {
            const cached = await cache.match(tileUrl);
            if (cached) {
                rememberMemoryTile(cacheKey, cached.clone());
                return cached;
            }
        }
    } catch (cacheError) {
        console.warn('[SW] Cache rapide indisponible:', cacheError);
    }

    try {
        const db = await openOfflineDB();
        const record = await findTileRecordInDB(db, tileUrl);

        if (!record || !record.tile) return null;

        const contentType = record.tile.type || guessTileContentType(tileUrl);
        const response = new Response(record.tile, {
            headers: {
                'Content-Type': contentType,
                'X-Offline-Tile': 'indexeddb'
            }
        });

        rememberMemoryTile(cacheKey, response.clone());
        return response;
    } catch (error) {
        console.warn('[SW] Lecture tuile offline impossible:', error);
        return null;
    }
}

async function prepareFastTileCache({ force = false } = {}) {
    if (fastTileCache && !force) return fastTileCache;

    if (!fastTileCacheName || force) {
        try {
            const cacheNames = await caches.keys();
            const tileCacheNames = cacheNames.filter(name => name.startsWith(TILE_CACHE_PREFIX)).sort();
            fastTileCacheName = tileCacheNames.length ? tileCacheNames[tileCacheNames.length - 1] : `${TILE_CACHE_PREFIX}v1035`;
        } catch (_) {
            fastTileCacheName = `${TILE_CACHE_PREFIX}v1035`;
        }
    }

    fastTileCache = await caches.open(fastTileCacheName);
    return fastTileCache;
}

function rememberMemoryTile(key, response) {
    memoryTileCache.set(key, response);

    while (memoryTileCache.size > MEMORY_TILE_CACHE_MAX) {
        const oldestKey = memoryTileCache.keys().next().value;
        memoryTileCache.delete(oldestKey);
    }
}

function touchMemoryTile(key, response) {
    memoryTileCache.delete(key);
    memoryTileCache.set(key, response);
}

function openOfflineDB() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('IndexedDB indisponible dans le service worker'));
            return;
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onsuccess = event => resolve(event.target.result);
        request.onerror = event => reject(event.target.error || new Error('Erreur ouverture IndexedDB'));
        request.onblocked = () => reject(new Error('IndexedDB bloquée'));
    }).catch(error => {
        dbPromise = null;
        throw error;
    });

    return dbPromise;
}

function findTileRecordInDB(db, tileUrl) {
    const activeSet = new Set(activeOfflinePacks || []);

    return new Promise((resolve, reject) => {
        const tx = db.transaction('tiles', 'readonly');
        const store = tx.objectStore('tiles');

        let request;

        if (store.indexNames.contains('tileUrl')) {
            request = store.index('tileUrl').openCursor(IDBKeyRange.only(tileUrl));
        } else {
            request = store.openCursor();
        }

        request.onsuccess = () => {
            const cursor = request.result;

            if (!cursor) {
                resolve(null);
                return;
            }

            const value = cursor.value || {};
            const storedTileUrl = value.tileUrl || getTileUrlFromStoredKey(value.url);

            if (storedTileUrl === tileUrl && isTileRecordAllowed(value, activeSet)) {
                resolve(value);
                return;
            }

            cursor.continue();
        };

        request.onerror = () => reject(request.error || new Error('Erreur lecture tuile IndexedDB'));
        tx.onerror = () => reject(tx.error || new Error('Erreur transaction IndexedDB'));
        tx.onabort = () => reject(tx.error || new Error('Transaction IndexedDB annulée'));
    });
}

function isTileRecordAllowed(record, activeSet) {
    if (!activeSet || activeSet.size === 0) return true;
    return activeSet.has(record && record.packName);
}

function getTileUrlFromStoredKey(storedUrl) {
    return String(storedUrl || '').split('::')[0];
}

function guessTileContentType(tileUrl) {
    return /\.(jpg|jpeg)(?:\?.*)?$/i.test(tileUrl) ? 'image/jpeg' : 'image/png';
}

async function refreshOfflineSettingsFromDB({ force = false } = {}) {
    const now = Date.now();

    if (!force && (now - offlineSettingsLoadedAt) < SETTINGS_REFRESH_INTERVAL_MS) {
        return;
    }

    try {
        const db = await openOfflineDB();
        const settings = await readOfflineSettings(db);

        if (typeof settings[OFFLINE_TILES_ENABLED_KEY] === 'boolean') {
            offlineTilesEnabled = settings[OFFLINE_TILES_ENABLED_KEY];
        }

        if (typeof settings[OFFLINE_ONLINE_FALLBACK_KEY] === 'boolean') {
            offlineOnlineFallback = settings[OFFLINE_ONLINE_FALLBACK_KEY];
        }

        if (Array.isArray(settings[OFFLINE_ACTIVE_PACKS_KEY])) {
            activeOfflinePacks = settings[OFFLINE_ACTIVE_PACKS_KEY].filter(Boolean);
        }

        offlineSettingsLoadedAt = now;
    } catch (error) {
        /*
         * Non bloquant : script.js envoie aussi les changements par postMessage.
         */
    }
}

function readOfflineSettings(db) {
    return new Promise((resolve) => {
        const result = {};
        const keys = [
            OFFLINE_TILES_ENABLED_KEY,
            OFFLINE_ONLINE_FALLBACK_KEY,
            OFFLINE_ACTIVE_PACKS_KEY
        ];

        const tx = db.transaction('settings', 'readonly');
        const store = tx.objectStore('settings');
        let pending = keys.length;

        keys.forEach(key => {
            const request = store.get(key);
            request.onsuccess = () => {
                if (request.result) {
                    result[key] = request.result.value;
                }
                pending -= 1;
                if (pending === 0) resolve(result);
            };
            request.onerror = () => {
                pending -= 1;
                if (pending === 0) resolve(result);
            };
        });

        tx.onerror = () => resolve(result);
        tx.onabort = () => resolve(result);
    });
}

self.addEventListener('push', event => {
    let data = {};

    try {
        data = event.data ? event.data.json() : {};
    } catch (error) {
        data = {
            title: 'Pelic Chat',
            body: event.data ? event.data.text() : 'Nouveau message'
        };
    }

    const title = data.title || 'Pelic Chat';
    const options = {
        body: data.body || data.text || 'Nouveau message',
        tag: data.tag || `pelic-chat-${data.room || 'default'}`,
        data: {
            url: data.url || './index.html',
            room: data.room || '',
            messageId: data.messageId || '',
            time: data.time || ''
        },
        icon: './icons/icon-192x192.png',
        badge: './icons/icon-192x192.png'
    };

    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

self.addEventListener('notificationclick', event => {
    event.notification.close();

    const targetUrl = event.notification?.data?.url || './index.html';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then(clientList => {
                for (const client of clientList) {
                    if ('focus' in client) {
                        client.focus();
                        return;
                    }
                }

                if (clients.openWindow) {
                    return clients.openWindow(targetUrl);
                }
            })
    );
});
