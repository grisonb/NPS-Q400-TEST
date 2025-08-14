const APP_CACHE_NAME = 'communes-app-cache-v540'; // Version 54.0
const DATA_CACHE_NAME = 'communes-data-cache-v540';
const TILE_CACHE_NAME = 'communes-tile-cache-v540';

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

let db;

function getDb() {
    return new Promise((resolve, reject) => {
        if (db) return resolve(db);
        const request = indexedDB.open('OfflineTilesDB', 1);
        request.onsuccess = event => {
            db = event.target.result;
            resolve(db);
        };
        request.onerror = event => {
            reject('Erreur ouverture DB dans SW:', event.target.error);
        };
    });
}

function getTileFromDb(url) {
    return getDb().then(db => {
        return new Promise(resolve => {
            const transaction = db.transaction('tiles', 'readonly');
            const store = transaction.objectStore('tiles');
            const request = store.get(url);
            request.onsuccess = () => {
                resolve(request.result ? new Response(request.result.tile) : null);
            };
            request.onerror = () => resolve(null); // Si erreur, on considère que la tuile n'existe pas
        });
    });
}

self.addEventListener('fetch', event => {
    const requestUrl = new URL(event.request.url);

    // Stratégie pour les tuiles de carte : DB d'abord, puis réseau, avec mise en cache réseau
    if (requestUrl.hostname.includes('tile.openstreetmap.org')) {
        event.respondWith(
            getTileFromDb(event.request.url).then(responseFromDb => {
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
    
    // Stratégie pour le reste (App Shell, données): Cache d'abord, puis réseau
    event.respondWith(
        caches.match(event.request)
            .then(cachedResponse => {
                return cachedResponse || fetch(event.request).catch(() => {
                    if (event.request.mode === 'navigate') {
                        return caches.match('./index.html');
                    }
                });
            })
    );
});
