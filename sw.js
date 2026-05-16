const SW_VERSION = 'sw-offline-tiles-push-v1035-fast';

const TILE_CACHE_PREFIX = 'test-communes-tile-cache-';
const DB_NAME = 'OfflineTilesDB';
const DB_VERSION = 3;
const OFFLINE_TILES_ENABLED_KEY = 'offlineTilesEnabled';
const OFFLINE_ONLINE_FALLBACK_KEY = 'offlineOnlineFallback';
const OFFLINE_ACTIVE_PACKS_KEY = 'offlineActivePacks';

let offlineTilesEnabled = false;
let offlineOnlineFallback = false;
let activeOfflinePacks = [];

let offlineSettingsLoadedAt = 0;
let cachedTileCacheNames = [];
let cachedTileCacheNamesLoadedAt = 0;
let dbPromise = null;

const SETTINGS_REFRESH_INTERVAL_MS = 3000;
const TILE_CACHE_NAMES_REFRESH_INTERVAL_MS = 10000;

self.addEventListener('install', event => {
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        /*
         * On conserve les caches de tuiles offline.
         * On supprime seulement les autres caches applicatifs pour éviter
         * les retours vers d'anciennes versions index/script.
         */
        try {
            const cacheNames = await caches.keys();
            await Promise.all(
                cacheNames
                    .filter(cacheName => !cacheName.startsWith(TILE_CACHE_PREFIX))
                    .map(cacheName => caches.delete(cacheName))
            );
        } catch (error) {
            console.warn('[SW] Nettoyage cache non critique impossible:', error);
        }

        await refreshOfflineSettingsFromDB({ force: true });
        await refreshTileCacheNames({ force: true });
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
        return;
    }
});

self.addEventListener('fetch', event => {
    const request = event.request;

    if (request.method !== 'GET') return;

    if (isOpenStreetMapTileRequest(request.url)) {
        event.respondWith(handleTileRequest(request));
        return;
    }

    /*
     * Pour l'application elle-même : réseau direct.
     * Cela évite de recréer le problème de retour à une ancienne version.
     */
    event.respondWith(fetch(request));
});

async function handleTileRequest(request) {
    await refreshOfflineSettingsFromDB();

    if (offlineTilesEnabled) {
        const offlineResponse = await findOfflineTileResponseFast(request.url);
        if (offlineResponse) return offlineResponse;

        /*
         * Mode offline strict : si la tuile n'existe pas dans le pack,
         * on ne bascule pas sur internet.
         */
        return new Response('', {
            status: 404,
            statusText: 'Offline tile not found'
        });
    }

    try {
        return await fetch(request);
    } catch (networkError) {
        if (offlineOnlineFallback) {
            const offlineResponse = await findOfflineTileResponseFast(request.url);
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

async function findOfflineTileResponseFast(tileUrl) {
    /*
     * Chemin rapide : Cache Storage d'abord.
     * C'est beaucoup plus rapide que d'interroger IndexedDB pour chaque tuile
     * pendant un déplacement ou un zoom.
     */
    try {
        await refreshTileCacheNames();
        for (const cacheName of cachedTileCacheNames) {
            const cache = await caches.open(cacheName);
            const cached = await cache.match(tileUrl);
            if (cached) return cached;
        }
    } catch (cacheError) {
        console.warn('[SW] Lecture tuile Cache Storage impossible:', cacheError);
    }

    /*
     * Fallback IndexedDB : utile si la tuile n'a pas encore été recopiée
     * dans Cache Storage.
     */
    try {
        const db = await openOfflineDB();
        const record = await findTileRecordInDB(db, tileUrl);
        if (record && record.tile) {
            const contentType = record.tile.type || guessTileContentType(tileUrl);
            const response = new Response(record.tile, {
                headers: {
                    'Content-Type': contentType,
                    'X-Offline-Tile': 'indexeddb'
                }
            });

            /*
             * Mise en cache opportuniste : la prochaine demande de cette tuile
             * passera par le chemin rapide Cache Storage.
             */
            try {
                const targetCacheName = cachedTileCacheNames[0] || getFallbackTileCacheName();
                const cache = await caches.open(targetCacheName);
                await cache.put(tileUrl, response.clone());
                if (!cachedTileCacheNames.includes(targetCacheName)) {
                    cachedTileCacheNames.unshift(targetCacheName);
                }
            } catch (_) {}

            return response;
        }
    } catch (dbError) {
        console.warn('[SW] Lecture tuile IndexedDB impossible:', dbError);
    }

    return null;
}

async function refreshTileCacheNames({ force = false } = {}) {
    const now = Date.now();

    if (!force && cachedTileCacheNames.length && (now - cachedTileCacheNamesLoadedAt) < TILE_CACHE_NAMES_REFRESH_INTERVAL_MS) {
        return;
    }

    const cacheNames = await caches.keys();
    cachedTileCacheNames = cacheNames
        .filter(name => name.startsWith(TILE_CACHE_PREFIX))
        .sort()
        .reverse();

    cachedTileCacheNamesLoadedAt = now;
}

function getFallbackTileCacheName() {
    return `${TILE_CACHE_PREFIX}${SW_VERSION}`;
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

async function findTileRecordInDB(db, tileUrl) {
    const activeSet = new Set(activeOfflinePacks || []);

    return new Promise((resolve, reject) => {
        const tx = db.transaction('tiles', 'readonly');
        const store = tx.objectStore('tiles');

        let request;

        if (store.indexNames.contains('tileUrl')) {
            request = store.index('tileUrl').getAll(tileUrl);
        } else {
            request = store.openCursor();
        }

        request.onsuccess = () => {
            if (store.indexNames.contains('tileUrl')) {
                const records = Array.isArray(request.result) ? request.result : [];
                const selected = chooseTileRecord(records, activeSet);
                resolve(selected || null);
                return;
            }

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

function chooseTileRecord(records, activeSet) {
    if (!records.length) return null;

    const activeMatch = records.find(record => isTileRecordAllowed(record, activeSet));
    if (activeMatch) return activeMatch;

    if (activeSet.size > 0) return null;

    return records[0] || null;
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
