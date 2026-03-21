const APP_CACHE_NAME = 'test-communes-app-cache-v821'; 
const DATA_CACHE_NAME = 'test-communes-data-cache-v821';
const TILE_CACHE_NAME = 'test-communes-tile-cache-v821';

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
    }
});

let db;
const OFFLINE_TILES_ENABLED_KEY = 'offlineTilesEnabled';
const DEFAULT_OFFLINE_TILES_ENABLED = true;

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
    return getDb().then(db => {
        return new Promise(resolve => {
            const transaction = db.transaction('settings', 'readonly');
            const store = transaction.objectStore('settings');
            const request = store.get(OFFLINE_TILES_ENABLED_KEY);
            request.onsuccess = () => {
                if (!request.result || typeof request.result.value !== 'boolean') {
                    resolve(DEFAULT_OFFLINE_TILES_ENABLED);
                    return;
                }
                resolve(request.result.value);
            };
            request.onerror = () => resolve(DEFAULT_OFFLINE_TILES_ENABLED);
        });
    }).catch(() => DEFAULT_OFFLINE_TILES_ENABLED);
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

function getTileFromDb(url) {
    return getDb().then(db => {
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
                    if (request.result) {
                        resolve(new Response(request.result.tile));
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

self.addEventListener('fetch', event => {
    const requestUrl = new URL(event.request.url);

    // Stratégie pour les tuiles de carte : DB d'abord, puis réseau, avec mise en cache réseau
    if (requestUrl.hostname.includes('tile.openstreetmap.org')) {
        event.respondWith(
            isOfflineTilesEnabled().then(enabled => {
                if (!enabled) {
                    return null;
                }
                return getTileFromDb(event.request.url);
            }).then(responseFromDb => {
                if (responseFromDb) {
                    // console.log(`[SW] Tuile servie depuis IndexedDB: ${event.request.url}`);
                    return responseFromDb;
                }

                // console.log(`[SW] Tuile non trouvée en local, requête réseau: ${event.request.url}`);
                // Si non trouvée en DB, on va sur le réseau et on met en cache (stratégie Stale-While-Revalidate)
                return caches.open(TILE_CACHE_NAME).then(cache => {
                    return cache.match(event.request).then(cachedResponse => {
                        const fetchPromise = fetch(event.request).then(networkResponse => {
                            if (networkResponse.ok) {
                                cache.put(event.request, networkResponse.clone());
                            }
                            return networkResponse;
                        });
                        return cachedResponse || fetchPromise;
                    });
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
