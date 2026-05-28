const SW_VERSION = 'sw-v11-44-fire-history-red-buttons';

const DB_NAME = 'OfflineTilesDB';
const DB_VERSION = 3;

const OFFLINE_TILES_ENABLED_KEY = 'offlineTilesEnabled';
const OFFLINE_ONLINE_FALLBACK_KEY = 'offlineOnlineFallback';
const OFFLINE_ACTIVE_PACKS_KEY = 'offlineActivePacks';

const APP_SHELL_CACHE = `npf-q400-app-shell-${SW_VERSION}`;
const APP_SHELL_URLS = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './manifest.json',
    './leaflet.css',
    './leaflet.min.js',
    './suncalc.js',
    './jszip.min.js',
    './communes.json',
    './icons/icon-192x192.png',
    './icons/icon-512x512.png'
];


/*
 * IMPORTANT :
 * - pas de cache agressif de index.html / script.js ;
 * - pas de suppression des caches de tuiles ;
 * - service worker conservé pour Push + offline tiles ;
 * - lecture tuiles optimisée IndexedDB, sans boucle Cache Storage à chaque tuile.
 */

let offlineTilesEnabled = false;
let offlineOnlineFallback = false;
let activeOfflinePacks = [];

let dbPromise = null;
let offlineSettingsLoadedAt = 0;

const SETTINGS_REFRESH_INTERVAL_MS = 5000;
const MEMORY_TILE_CACHE_MAX = 160;
const memoryTileCache = new Map();

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(APP_SHELL_CACHE);

        await Promise.all(APP_SHELL_URLS.map(async (url) => {
            try {
                const response = await fetch(new Request(url, { cache: 'reload' }));
                if (response && response.ok) {
                    await cache.put(url, response);
                }
            } catch (error) {
                console.warn('[SW] Cache app shell ignoré pour', url, error);
            }
        }));

        await self.skipWaiting();
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const cacheNames = await caches.keys();
        await Promise.all(
            cacheNames
                .filter(name => name.startsWith('npf-q400-app-shell-') && name !== APP_SHELL_CACHE)
                .map(name => caches.delete(name))
        );

        await refreshOfflineSettingsFromDB({ force: true });
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
    }
});

self.addEventListener('fetch', event => {
    const request = event.request;

    if (request.method !== 'GET') return;

    if (isOpenStreetMapTileRequest(request.url)) {
        event.respondWith(handleTileRequest(request));
        return;
    }

    if (isAppShellRequest(request)) {
        event.respondWith(handleAppShellRequest(request));
        return;
    }

    event.respondWith(fetch(request).catch(() => caches.match(request, { ignoreSearch: true })));
});


function isAppShellRequest(request) {
    try {
        const parsed = new URL(request.url);
        if (parsed.origin !== self.location.origin) return false;
        if (request.mode === 'navigate') return true;

        const filename = parsed.pathname.split('/').pop() || '';
        return [
            '',
            'index.html',
            'style.css',
            'script.js',
            'manifest.json',
            'leaflet.css',
            'leaflet.min.js',
            'suncalc.js',
            'jszip.min.js',
            'communes.json'
        ].includes(filename) || parsed.pathname.includes('/icons/');
    } catch (_) {
        return false;
    }
}

async function handleAppShellRequest(request) {
    const cached = await caches.match(request, { ignoreSearch: true });

    /*
     * v11.43 — démarrage/reprise plus rapide.
     * Navigation : cache d'abord, mise à jour réseau en arrière-plan.
     */
    if (request.mode === 'navigate') {
        if (cached) {
            fetch(request).then(async (fresh) => {
                if (fresh && fresh.ok) {
                    const cache = await caches.open(APP_SHELL_CACHE);
                    await cache.put('./index.html', fresh.clone());
                }
            }).catch(() => {});
            return cached;
        }

        try {
            const fresh = await fetch(request);
            const cache = await caches.open(APP_SHELL_CACHE);
            await cache.put('./index.html', fresh.clone());
            return fresh;
        } catch (_) {
            return await caches.match('./index.html', { ignoreSearch: true });
        }
    }

    if (cached) return cached;

    try {
        const fresh = await fetch(request);
        const cache = await caches.open(APP_SHELL_CACHE);
        await cache.put(request, fresh.clone());
        return fresh;
    } catch (_) {
        return cached || new Response('', { status: 504, statusText: 'Offline asset unavailable' });
    }
}

async function handleTileRequest(request) {
    await refreshOfflineSettingsFromDB();

    if (offlineTilesEnabled) {
        const offlineResponse = await findOfflineTileResponse(request.url);
        if (offlineResponse) return offlineResponse;

        /*
         * Offline strict : si la tuile n'est pas présente, on ne va pas online.
         */
        return new Response(
            Uint8Array.from(atob('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='), c => c.charCodeAt(0)),
            {
                status: 200,
                headers: {
                    'Content-Type': 'image/gif',
                    'X-Offline-Tile': 'transparent-missing'
                }
            }
        );
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

    const cached = memoryTileCache.get(cacheKey);
    if (cached) {
        touchMemoryTile(cacheKey, cached);
        return cached.clone();
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
            /*
             * Chemin rapide : index tileUrl + curseur.
             * On s'arrête dès qu'une tuile correspondant au pack actif est trouvée.
             */
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
        icon: './icons/icon-192x192.png',
        badge: './icons/icon-192x192.png',
        tag: data.tag || 'pelic-chat',
        data: data
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil(self.clients.openWindow('./'));
});
