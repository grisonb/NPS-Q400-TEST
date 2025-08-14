// =========================================================================
// INITIALISATION DE L'APPLICATION
// =========================================================================
document.addEventListener('DOMContentLoaded', () => {
    if (typeof L === 'undefined') { document.getElementById('status-message').textContent = "❌ ERREUR : leaflet.min.js non chargé."; return; }
    initializeApp();
});

// =========================================================================
// VARIABLES GLOBALES
// =========================================================================
let allCommunes = [], map, permanentAirportLayer, routesLayer, currentCommune = null, selectedPelicanOACI = null;
let disabledAirports = new Set(), waterAirports = new Set();
const MAGNETIC_DECLINATION = 1.0;
let userMarker = null, watchId = null;
let userToTargetLayer = null, lftwRouteLayer = null;
let showLftwRoute = true;
let gaarCircuits = [];
let isGaarMode = false;
let isDrawingMode = false;
const manualCircuitColors = ['#ff00ff', '#00ffff', '#ff8c00', '#00ff00', '#ff1493'];
let gaarLayer = null;
let db; // Variable pour la connexion à la base de données IndexedDB
const airports = [
    { oaci: "LFLU", name: "Valence-Chabeuil", lat: 44.920, lon: 4.968 }, { oaci: "LFMU", name: "Béziers-Vias", lat: 43.323, lon: 3.354 }, { oaci: "LFJR", name: "Angers-Marcé", lat: 47.560, lon: -0.312 }, { oaci: "LFHO", name: "Aubenas-Ardèche Méridionale", lat: 44.545, lon: 4.385 }, { oaci: "LFLX", name: "Châteauroux-Déols", lat: 46.861, lon: 1.720 }, { oaci: "LFBM", name: "Mont-de-Marsan", lat: 43.894, lon: -0.509 }, { oaci: "LFBL", name: "Limoges-Bellegarde", lat: 45.862, lon: 1.180 }, { oaci: "LFAQ", name: "Albert-Bray", lat: 49.972, lon: 2.698 }, { oaci: "LFBP", name: "Pau-Pyrénées", lat: 43.380, lon: -0.418 }, { oaci: "LFTH", name: "Toulon-Hyères", lat: 43.097, lon: 6.146 }, { oaci: "LFSG", name: "Épinal-Mirecourt", lat: 48.325, lon: 6.068 }, { oaci: "LFKC", name: "Calvi-Sainte-Catherine", lat: 42.530, lon: 8.793 }, { oaci: "LFMD", name: "Cannes-Mandelieu", lat: 43.542, lon: 6.956 }, { oaci: "LFKB", name: "Bastia-Poretta", lat: 42.552, lon: 9.483 }, { oaci: "LFMH", name: "Saint-Étienne-Bouthéon", lat: 45.541, lon: 4.296 }, { oaci: "LFKF", name: "Figari-Sud-Corse", lat: 41.500, lon: 9.097 }, { oaci: "LFCC", name: "Cahors-Lalbenque", lat: 44.351, lon: 1.475 }, { oaci: "LFML", name: "Marseille-Provence", lat: 43.436, lon: 5.215 }, { oaci: "LFKJ", name: "Ajaccio-Napoléon-Bonaparte", lat: 41.923, lon: 8.802 }, { oaci: "LFMK", name: "Carcassonne-Salvaza", lat: 43.215, lon: 2.306 }, { oaci: "LFRV", name: "Vannes-Meucon", lat: 47.720, lon: -2.721 }, { oaci: "LFTW", name: "Nîmes-Garons", lat: 43.757, lon: 4.416 }, { oaci: "LFMP", name: "Perpignan-Rivesaltes", lat: 42.740, lon: 2.870 }, { oaci: "LFBD", name: "Bordeaux-Mérignac", lat: 44.828, lon: -0.691 }
];

// =========================================================================
// FONCTIONS UTILITAIRES
// =========================================================================
const toRad = deg => deg * Math.PI / 180, toDeg = rad => rad * 180 / Math.PI;
const simplifyString = str => typeof str !== 'string' ? '' : str.toLowerCase().replace(/\bst\b/g, 'saint').normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, ' ').trim().replace(/\s+/g, ' ');
const calculateDistanceInNm = (lat1, lon1, lat2, lon2) => { const R = 6371, dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1), a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2), c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); return (R * c) / 1.852; };
const calculateBearing = (lat1, lon1, lat2, lon2) => { const lat1Rad = toRad(lat1), lon1Rad = toRad(lon1), lat2Rad = toRad(lat2), lon2Rad = toRad(lon2), dLon = lon2Rad - lon1Rad, y = Math.sin(dLon) * Math.cos(lat2Rad), x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon); let bearingRad = Math.atan2(y, x), bearingDeg = toDeg(bearingRad); return (bearingDeg + 360) % 360; };
const convertToDMM = (deg, type) => { if (deg === null || isNaN(deg)) return 'N/A'; const absDeg = Math.abs(deg), degrees = Math.floor(absDeg), minutesTotal = (absDeg - degrees) * 60, minutesFormatted = minutesTotal.toFixed(2).padStart(5, '0'); let direction = type === 'lat' ? (deg >= 0 ? 'N' : 'S') : (deg >= 0 ? 'E' : 'W'); return `${degrees}° ${minutesFormatted}' ${direction}`; };
const levenshteinDistance = (a, b) => { const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null)); for (let i = 0; i <= a.length; i += 1) matrix[0][i] = i; for (let j = 0; j <= b.length; j += 1) matrix[j][0] = j; for (let j = 1; j <= b.length; j += 1) for (let i = 1; i <= a.length; i += 1) { const indicator = a[i - 1] === b[j - 1] ? 0 : 1; matrix[j][i] = Math.min(matrix[j][i - 1] + 1, matrix[j - 1][i] + 1, matrix[j - 1][i - 1] + indicator); } return matrix[b.length][a.length]; };

// =========================================================================
// LOGIQUE PRINCIPALE DE L'APPLICATION
// =========================================================================
async function initializeApp() {
    const statusMessage = document.getElementById('status-message');
    const searchSection = document.getElementById('search-section');
    loadState();
    const savedLftwState = localStorage.getItem('showLftwRoute');
    showLftwRoute = savedLftwState === null ? true : (savedLftwState === 'true');
    const savedGaarJSON = localStorage.getItem('gaarCircuits');
    if (savedGaarJSON) {
        gaarCircuits = JSON.parse(savedGaarJSON);
    }
    await initDB();
displayInstalledMaps();
    try {
        const response = await fetch('./communes.json');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (!data || !data.data) throw new Error("Format JSON invalide.");
        allCommunes = data.data.map(c => ({ ...c, normalized_name: simplifyString(c.nom_standard), search_parts: simplifyString(c.nom_standard).split(' ').filter(Boolean), soundex_parts: simplifyString(c.nom_standard).split(' ').filter(Boolean).map(part => soundex(part)) }));
        statusMessage.style.display = 'none';
        searchSection.style.display = 'block';
        initMap();
        setupEventListeners();
        if (localStorage.getItem('liveGpsActive') === 'true') {
            toggleLiveGps();
        } else {
            navigator.geolocation.getCurrentPosition(updateUserPosition, () => {}, { enableHighAccuracy: true });
        }
        const savedCommuneJSON = localStorage.getItem('currentCommune');
        if (savedCommuneJSON) {
            currentCommune = JSON.parse(savedCommuneJSON);
            displayCommuneDetails(currentCommune, true);
        }
    } catch (error) {
        statusMessage.textContent = `❌ Erreur: ${error.message}`;
    }
}

function initMap() {
    if (map) return;
    map = L.map('map', { attributionControl: false, zoomControl: false }).setView([46.6, 2.2], 5.5);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(map);
    permanentAirportLayer = L.layerGroup().addTo(map);
    routesLayer = L.layerGroup().addTo(map);
    userToTargetLayer = L.layerGroup().addTo(map);
    lftwRouteLayer = L.layerGroup().addTo(map);
    gaarLayer = L.layerGroup().addTo(map);
    drawPermanentAirportMarkers();
    redrawGaarCircuits();
    
    map.on('click', handleGaarMapClick);

    map.on('contextmenu', (e) => {
        if (isDrawingMode) return;
        selectedPelicanOACI = null;
        L.DomEvent.preventDefault(e.originalEvent);
        const pointName = findClosestCommuneName(e.latlng.lat, e.latlng.lng) || 'Feu manuel';
        const manualCommune = { nom_standard: pointName, latitude_mairie: e.latlng.lat, longitude_mairie: e.latlng.lng, isManual: true };
        currentCommune = manualCommune;
        localStorage.setItem('currentCommune', JSON.stringify(manualCommune));
        displayCommuneDetails(manualCommune, false);
    });
}

function setupEventListeners() {
    const searchInput = document.getElementById('search-input');
    const clearSearchBtn = document.getElementById('clear-search');
    const airportCountInput = document.getElementById('airport-count');
    const gpsFeuButton = document.getElementById('gps-feu-button');
    const liveGpsButton = document.getElementById('live-gps-button');
    const lftwRouteButton = document.getElementById('lftw-route-button');
    const gaarModeButton = document.getElementById('gaar-mode-button');
    const editCircuitsButton = document.getElementById('edit-circuits-button');
    const deleteCircuitsButton = document.getElementById('delete-circuits-btn');
    const toggleSearchButton = document.getElementById('toggle-search-button');
    const mainActionButtons = document.getElementById('main-action-buttons');
    const calculatorButton = document.getElementById('calculator-button');
    const calculatorModal = document.getElementById('calculator-modal');
    const closeCalculatorButton = document.getElementById('close-calculator-btn');
    const offlineMapsButton = document.getElementById('offline-maps-button');
    const offlineMapModal = document.getElementById('offline-map-modal');
    const closeOfflineMapButton = document.getElementById('close-offline-map-btn');
    const zipImporterInput = document.getElementById('zip-importer-input');

    if (mainActionButtons) {
        const versionDisplay = document.createElement('div');
        versionDisplay.className = 'version-display';
        versionDisplay.innerText = 'v54.0';
        mainActionButtons.appendChild(versionDisplay);
    }

    searchInput.addEventListener('input', () => {
        selectedPelicanOACI = null;
        const rawSearch = searchInput.value;
        clearSearchBtn.style.display = rawSearch.length > 0 ? 'block' : 'none';
        let departmentFilter = null;
        let searchTerm = rawSearch;
        const depRegex = /\s(\d{1,3}|2A|2B)$/i;
        const match = rawSearch.match(depRegex);
        if (match) {
            departmentFilter = match[1].length === 1 ? '0' + match[1] : match[1].toUpperCase();
            searchTerm = rawSearch.substring(0, match.index).trim();
        }
        const simplifiedSearch = simplifyString(searchTerm);
        if (simplifiedSearch.length < 2) {
            document.getElementById('results-list').style.display = 'none';
            return;
        }
        const searchWords = simplifiedSearch.split(' ').filter(Boolean);
        const communesToSearch = departmentFilter ? allCommunes.filter(c => c.dep_code === departmentFilter) : allCommunes;
        const scoredResults = communesToSearch.map(c => {
            let totalScore = 0; let wordsFound = 0;
            for (const word of searchWords) {
                let bestWordScore = 999;
                const wordSoundex = soundex(word);
                for (let i = 0; i < c.search_parts.length; i++) {
                    const communePart = c.search_parts[i];
                    const communeSoundex = c.soundex_parts[i];
                    let currentScore = 999;
                    if (communePart.startsWith(word)) { currentScore = 0; }
                    else if (communeSoundex === wordSoundex) { currentScore = 1; }
                    else {
                        const dist = levenshteinDistance(word, communePart);
                        if (dist <= Math.floor(word.length / 3) + 1) { currentScore = 2 + dist; }
                    }
                    if (currentScore < bestWordScore) { bestWordScore = currentScore; }
                }
                if (bestWordScore < 999) { wordsFound++; totalScore += bestWordScore; }
            }
            const finalScore = (wordsFound === searchWords.length) ? totalScore : 999;
            return { ...c, score: finalScore };
        }).filter(c => c.score < 999);
        scoredResults.sort((a, b) => a.score - b.score || a.nom_standard.length - b.nom_standard.length);
        displayResults(scoredResults.slice(0, 10));
    });

    clearSearchBtn.addEventListener('click', () => {
        selectedPelicanOACI = null;
        searchInput.value = '';
        document.getElementById('results-list').style.display = 'none';
        clearSearchBtn.style.display = 'none';
        routesLayer.clearLayers();
        userToTargetLayer.clearLayers();
        lftwRouteLayer.clearLayers();
        drawPermanentAirportMarkers();
        currentCommune = null;
        localStorage.removeItem('currentCommune');
        updateCalculatorData();
        masterRecalculate();
        updateCommuneDisplay(null);
        document.getElementById('bingo-map-display').style.display = 'none';
        navigator.geolocation.getCurrentPosition(updateUserPosition);
        map.setView([46.6, 2.2], 5.5);
    });

    airportCountInput.addEventListener('change', () => {
        if (currentCommune) {
            displayCommuneDetails(currentCommune, false);
        }
    });

    gpsFeuButton.addEventListener('click', () => {
        if (!navigator.geolocation) { alert("La géolocalisation n'est pas supportée par votre navigateur."); return; }
        selectedPelicanOACI = null;
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const { latitude, longitude } = pos.coords;
                const pointName = findClosestCommuneName(latitude, longitude) || 'Feu GPS';
                const gpsCommune = { nom_standard: pointName, latitude_mairie: latitude, longitude_mairie: longitude, isManual: true };
                currentCommune = gpsCommune;
                localStorage.setItem('currentCommune', JSON.stringify(gpsCommune));
                displayCommuneDetails(gpsCommune, false);
            },
            () => { alert("Impossible d'obtenir la position GPS. Veuillez vérifier vos autorisations."); },
            { enableHighAccuracy: true }
        );
    });

    liveGpsButton.addEventListener('click', toggleLiveGps);
    lftwRouteButton.addEventListener('click', toggleLftwRoute);
    gaarModeButton.addEventListener('click', toggleGaarVisibility);
    editCircuitsButton.addEventListener('click', toggleGaarDrawingMode);
    deleteCircuitsButton.addEventListener('click', () => { if (confirm("Voulez-vous vraiment supprimer tous les circuits GAAR ?")) { clearAllGaarCircuits(); } });

    toggleSearchButton.addEventListener('click', () => {
        const uiOverlay = document.getElementById('ui-overlay');
        const communeDisplay = document.getElementById('commune-info-display');
        if (uiOverlay.style.display === 'none') {
            uiOverlay.style.display = 'block';
            communeDisplay.style.display = 'none';
            toggleSearchButton.classList.add('active');
        } else {
            uiOverlay.style.display = 'none';
            toggleSearchButton.classList.remove('active');
            if (communeDisplay.innerHTML.trim() !== '' && currentCommune) {
                communeDisplay.style.display = 'flex';
            }
        }
    });

    document.addEventListener('communeSelected', () => {
        document.getElementById('ui-overlay').style.display = 'none';
        document.getElementById('toggle-search-button').classList.remove('active');
        if (currentCommune) {
            document.getElementById('commune-info-display').style.display = 'flex';
        }
    });

    calculatorButton.addEventListener('click', () => { calculatorModal.style.display = 'flex'; });
    closeCalculatorButton.addEventListener('click', () => { calculatorModal.style.display = 'none'; });
    calculatorModal.addEventListener('click', (e) => { if (e.target === calculatorModal) { calculatorModal.style.display = 'none'; } });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && calculatorModal.style.display === 'flex') { calculatorModal.style.display = 'none'; } });
    offlineMapsButton.addEventListener('click', () => { offlineMapModal.style.display = 'flex'; });
    closeOfflineMapButton.addEventListener('click', () => { offlineMapModal.style.display = 'none'; });
    offlineMapModal.addEventListener('click', (e) => { if (e.target === offlineMapModal) { offlineMapModal.style.display = 'none'; } });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && offlineMapModal.style.display === 'flex') { offlineMapModal.style.display = 'none'; } });
    zipImporterInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    handleZipImport(file);
    event.target.value = ''; // Permet de ré-importer le même fichier
});

    updateLftwButtonState();
    updateGaarButtonState();
}

function displayResults(results) {
    const resultsList = document.getElementById('results-list');
    resultsList.innerHTML = '';
    if (results.length > 0) {
        resultsList.style.display = 'block';
        results.forEach(c => {
            const li = document.createElement('li');
            li.textContent = `${c.nom_standard} (${c.dep_nom} - ${c.dep_code})`;
            li.addEventListener('click', () => {
                currentCommune = c;
                localStorage.setItem('currentCommune', JSON.stringify(c));
                displayCommuneDetails(c);
            });
            resultsList.appendChild(li);
        });
    } else {
        resultsList.style.display = 'none';
    }
}

function updateCommuneDisplay(commune) {
    const communeDisplay = document.getElementById('commune-info-display');
    if (!commune) {
        communeDisplay.innerHTML = '';
        communeDisplay.style.display = 'none';
        return;
    }
    const communeNameHTML = `<span class="commune-name">${commune.nom_standard}</span>`;
    let sunsetHTML = '';
    if (typeof SunCalc !== 'undefined') {
        try {
            const now = new Date();
            const times = SunCalc.getTimes(now, commune.latitude_mairie, commune.longitude_mairie);
            const sunsetString = times.sunset.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
            sunsetHTML = `<div class="sunset-info">🌅&nbsp;CS&nbsp;<b>${sunsetString}</b></div>`;
        } catch (e) {
            sunsetHTML = '<div class="sunset-info"></div>';
        }
    }
    communeDisplay.innerHTML = communeNameHTML + sunsetHTML;
}

function updateMapBingoDisplay() {
    const bingoDisplay = document.getElementById('bingo-map-display');
    if (!currentCommune) {
        bingoDisplay.style.display = 'none';
        return;
    }

    const bingoBase = calculateBingo(CALCULATOR_DATA.distBaseFeu);
    const bingoPelic = calculateBingo(CALCULATOR_DATA.distPelicFeu);
    
    const lftwEl = document.getElementById('map-bingo-lftw');
    const pelicEl = document.getElementById('map-bingo-pelic');

    lftwEl.innerHTML = `BINGO LFTW: <b>${bingoBase} kg</b>`;

    if (bingoPelic !== 700 && selectedPelicanOACI) {
        pelicEl.innerHTML = `BINGO ${selectedPelicanOACI}: <b>${bingoPelic} kg</b>`;
        pelicEl.style.display = 'inline-block';
    } else {
        pelicEl.style.display = 'none';
    }
    
    bingoDisplay.style.display = 'flex';
}

function displayCommuneDetails(commune, shouldFitBounds = true) {
    routesLayer.clearLayers();
    userToTargetLayer.clearLayers();
    lftwRouteLayer.clearLayers();
    drawPermanentAirportMarkers();
    
    updateCommuneDisplay(commune);
    
    const { latitude_mairie: lat, longitude_mairie: lon, nom_standard: name } = commune;
    document.getElementById('search-input').value = name;
    document.getElementById('results-list').style.display = 'none';
    document.getElementById('clear-search').style.display = 'block';
    
    const allPoints = [[lat, lon]];
    const fireIcon = L.divIcon({ className: 'custom-marker-icon fire-marker', html: '🔥' });
    L.marker([lat, lon], { icon: fireIcon }).bindPopup(`<b>${name}</b><br>${convertToDMM(lat, 'lat')}<br>${convertToDMM(lon, 'lon')}`).addTo(routesLayer);
    
    const numAirports = parseInt(document.getElementById('airport-count').value, 10);
    const closestAirports = getClosestAirports(lat, lon, numAirports);
    
    const closestOACIs = new Set(closestAirports.map(ap => ap.oaci));
    if (!selectedPelicanOACI || !closestOACIs.has(selectedPelicanOACI)) {
        selectedPelicanOACI = closestAirports.length > 0 ? closestAirports[0].oaci : null;
    }
    
    closestAirports.forEach(ap => {
        allPoints.push([ap.lat, ap.lon]);
        drawRoute([lat, lon], [ap.lat, ap.lon], { oaci: ap.oaci });
    });
    
    const isLftwInClosest = closestAirports.some(ap => ap.oaci === 'LFTW');
    if (showLftwRoute && !isLftwInClosest) {
        drawLftwRoute();
    }
    
    updateCalculatorData();
    updateMapBingoDisplay();
    navigator.geolocation.getCurrentPosition(updateUserPosition, () => {}, { enableHighAccuracy: true });

    if (shouldFitBounds) {
        setTimeout(() => {
            if (userMarker && userMarker.getLatLng()) {
                allPoints.push(userMarker.getLatLng());
            }
            if (allPoints.length > 1) {
                map.fitBounds(L.latLngBounds(allPoints).pad(0.3));
            } else {
                map.setView([lat, lon], 10);
            }
        }, 300);
    }
    
    document.dispatchEvent(new Event('communeSelected'));
}

function drawRoute(startLatLng, endLatLng, options = {}) {
    const { oaci, isUser, isLftwRoute, magneticBearing } = options;
    const distance = calculateDistanceInNm(startLatLng[0], startLatLng[1], endLatLng[0], endLatLng[1]);
    let labelText, color = 'var(--primary-color)', dashArray = '', layer = routesLayer;

    if (isUser) {
        labelText = `${Math.round(magneticBearing)}° / ${Math.round(distance)} Nm`;
        color = 'var(--secondary-color)';
        dashArray = '5, 10';
        layer = userToTargetLayer;
    } else if (isLftwRoute) {
        labelText = `LFTW: ${Math.round(magneticBearing)}° / ${Math.round(distance)} Nm`;
        color = 'var(--success-color)';
        dashArray = '5, 10';
        layer = lftwRouteLayer;
    } else if (oaci) {
        const isSelected = selectedPelicanOACI === oaci;
        color = isSelected ? 'var(--success-color)' : 'var(--primary-color)';
        let tooltipClass = isSelected ? 'route-tooltip route-tooltip-selected' : 'route-tooltip';
        labelText = `<b>${oaci}</b><br>${Math.round(distance)} Nm`;
        L.polyline([startLatLng, endLatLng], { color, weight: 3, opacity: 0.8 }).addTo(layer);
        const hitbox = L.polyline([startLatLng, endLatLng], { color: 'transparent', weight: 20, opacity: 0 }).addTo(layer);
        hitbox.on('click', () => {
            selectedPelicanOACI = oaci;
            displayCommuneDetails(currentCommune, false);
        });
        L.tooltip({ permanent: true, direction: 'right', offset: [10, 0], className: tooltipClass }).setLatLng(endLatLng).setContent(labelText).addTo(layer);
        return;
    } else {
        labelText = `${Math.round(distance)} Nm`;
    }
    
    const polyline = L.polyline([startLatLng, endLatLng], { color, weight: 3, opacity: 0.8, dashArray }).addTo(layer);

    if (isUser) {
        polyline.bindTooltip(labelText, { permanent: true, direction: 'center', className: 'route-tooltip route-tooltip-user', sticky: true });
    } else if (oaci || isLftwRoute) {
        L.tooltip({ permanent: true, direction: 'right', offset: [10, 0], className: 'route-tooltip' }).setLatLng(endLatLng).setContent(labelText).addTo(layer);
    }
}

function getClosestAirports(lat, lon, count) { return airports.filter(ap => !disabledAirports.has(ap.oaci)).map(ap => ({ ...ap, distance: calculateDistanceInNm(lat, lon, ap.lat, ap.lon) })).sort((a, b) => a.distance - b.distance).slice(0, count); }
function refreshUI() { drawPermanentAirportMarkers(); if (currentCommune) displayCommuneDetails(currentCommune, false); }
function drawPermanentAirportMarkers() { permanentAirportLayer.clearLayers(); airports.forEach(airport => { const isDisabled = disabledAirports.has(airport.oaci); const isWater = waterAirports.has(airport.oaci); let iconClass = "custom-marker-icon airport-marker-base ", iconHTML = "✈️"; isDisabled ? (iconClass += "airport-marker-disabled", iconHTML = "<b>+</b>") : isWater ? (iconClass += "airport-marker-water", iconHTML = "💧") : iconClass += "airport-marker-active"; const icon = L.divIcon({ className: iconClass, html: iconHTML }); const marker = L.marker([airport.lat, airport.lon], { icon: icon }); const disableButtonText = isDisabled ? "Activer" : "Désactiver"; const disableButtonClass = isDisabled ? "enable-btn" : "disable-btn"; marker.bindPopup(`<div class="airport-popup"><b>${airport.oaci}</b><br>${airport.name}<div class="popup-buttons"><button class="water-btn" onclick="window.toggleWater('${airport.oaci}')">Eau</button><button class="${disableButtonClass}" onclick="window.toggleAirport('${airport.oaci}')">${disableButtonText}</button></div></div>`).addTo(permanentAirportLayer); }); }
const loadState = () => { const savedDisabled = localStorage.getItem('disabled_airports'); if (savedDisabled) disabledAirports = new Set(JSON.parse(savedDisabled)); const savedWater = localStorage.getItem('water_airports'); if (savedWater) waterAirports = new Set(JSON.parse(savedWater)); };
const saveState = () => { localStorage.setItem('disabled_airports', JSON.stringify([...disabledAirports])); localStorage.setItem('water_airports', JSON.stringify([...waterAirports])); };
window.toggleAirport = oaci => { disabledAirports.has(oaci) ? disabledAirports.delete(oaci) : (disabledAirports.add(oaci), waterAirports.delete(oaci)), saveState(), refreshUI() };
window.toggleWater = oaci => { waterAirports.has(oaci) ? waterAirports.delete(oaci) : (waterAirports.add(oaci), disabledAirports.delete(oaci)), saveState(), refreshUI() };

function toggleLiveGps() {
    const liveGpsButton = document.getElementById('live-gps-button');
    if (watchId) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
        liveGpsButton.classList.remove('active');
        localStorage.setItem('liveGpsActive', 'false');
    } else {
        if (!navigator.geolocation) { alert("La géolocalisation n'est pas supportée."); return; }
        watchId = navigator.geolocation.watchPosition(
            updateUserPosition, 
            (error) => { console.error("Erreur de suivi GPS:", error); alert("Impossible d'activer le suivi GPS. Vérifiez les autorisations."); if (watchId) toggleLiveGps(); }, 
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
        liveGpsButton.classList.add('active');
        localStorage.setItem('liveGpsActive', 'true');
    }
}

function updateUserPosition(pos) {
    const { latitude: userLat, longitude: userLon } = pos.coords;
    if (!userMarker) {
        const userIcon = L.divIcon({ className: 'custom-marker-icon user-marker', html: '👤' });
        userMarker = L.marker([userLat, userLon], { icon: userIcon }).bindPopup('Votre position').addTo(map);
    } else {
        userMarker.setLatLng([userLat, userLon]);
    }
    userToTargetLayer.clearLayers();
    if (currentCommune) {
        const { latitude_mairie: lat, longitude_mairie: lon } = currentCommune;
        if (lat.toFixed(6) !== userLat.toFixed(6) || lon.toFixed(6) !== userLon.toFixed(6)) {
            const trueBearing = calculateBearing(userLat, userLon, lat, lon);
            const magneticBearing = (trueBearing - MAGNETIC_DECLINATION + 360) % 360;
            drawRoute([userLat, userLon], [lat, lon], { isUser: true, magneticBearing: magneticBearing });
        }
    }
}

function findClosestCommuneName(lat, lon) {
    if (!allCommunes || allCommunes.length === 0) return null;
    let closestCommune = null; let minDistance = Infinity;
    for (const commune of allCommunes) {
        const distance = calculateDistanceInNm(lat, lon, commune.latitude_mairie, commune.longitude_mairie);
        if (distance < minDistance) { minDistance = distance; closestCommune = commune; }
    }
    if (closestCommune && minDistance < 27) { return closestCommune.nom_standard; }
    return null;
}

function toggleLftwRoute() {
    showLftwRoute = !showLftwRoute;
    localStorage.setItem('showLftwRoute', showLftwRoute);
    updateLftwButtonState();
    if(currentCommune) { displayCommuneDetails(currentCommune, false); }
}

function updateLftwButtonState() {
    const lftwRouteButton = document.getElementById('lftw-route-button');
    lftwRouteButton.classList.toggle('active', showLftwRoute);
}

function drawLftwRoute() {
    lftwRouteLayer.clearLayers();
    if (!showLftwRoute || !currentCommune) return;
    const lftwAirport = airports.find(ap => ap.oaci === 'LFTW');
    if (!lftwAirport) return;
    const { latitude_mairie: lat, longitude_mairie: lon } = currentCommune;
    const { lat: lftwLat, lon: lftwLon } = lftwAirport;
    const trueBearing = calculateBearing(lat, lon, lftwLat, lftwLon);
    const magneticBearing = (trueBearing - MAGNETIC_DECLINATION + 360) % 360;
    drawRoute([lat, lon], [lftwLat, lftwLon], { isLftwRoute: true, magneticBearing: magneticBearing });
}

function toggleGaarVisibility() { isGaarMode = !isGaarMode; updateGaarButtonState(); if (isGaarMode) { redrawGaarCircuits(); } else { gaarLayer.clearLayers(); if (isDrawingMode) { toggleGaarDrawingMode(); } } }
function updateGaarButtonState() { const gaarButton = document.getElementById('gaar-mode-button'); const gaarControls = document.getElementById('gaar-controls'); gaarButton.classList.toggle('active', isGaarMode); gaarControls.style.display = isGaarMode ? 'flex' : 'none'; }
function toggleGaarDrawingMode() { const editButton = document.getElementById('edit-circuits-button'); const mapContainer = document.getElementById('map'); const status = document.getElementById('gaar-status'); isDrawingMode = !isDrawingMode; editButton.classList.toggle('active', isDrawingMode); mapContainer.classList.toggle('crosshair-cursor', isDrawingMode); status.textContent = isDrawingMode ? 'Mode modification activé. Cliquez pour ajouter des points.' : ''; }
async function handleGaarMapClick(e) { if (!isDrawingMode) return; let targetCircuit = gaarCircuits.find(c => c && c.isManual && c.points.length < 3); if (!targetCircuit) { const manualCircuitsCount = gaarCircuits.filter(c => c && c.isManual).length; targetCircuit = { points: [], color: manualCircuitColors[manualCircuitsCount % manualCircuitColors.length], isManual: true, }; gaarCircuits.push(targetCircuit); } const pointName = await reverseGeocode(e.latlng) || `Point Manuel`; targetCircuit.points.push({ lat: e.latlng.lat, lng: e.latlng.lng, name: pointName }); redrawGaarCircuits(); saveGaarCircuits(); }
async function reverseGeocode(latlng) { document.getElementById('gaar-status').textContent = 'Recherche du nom...'; try { if (!navigator.onLine) { throw new Error("Application hors ligne."); } const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latlng.lat}&lon=${latlng.lng}&zoom=10`); if (!response.ok) throw new Error('La réponse du réseau n\'était pas OK.'); const data = await response.json(); const name = data.address.city || data.address.town || data.address.village || data.display_name.split(',')[0]; document.getElementById('gaar-status').textContent = `Point ajouté près de ${name}.`; return name; } catch (error) { const closestCommuneName = findClosestCommuneName(latlng.lat, latlng.lng); if (closestCommuneName) { document.getElementById('gaar-status').textContent = `Point ajouté près de ${closestCommuneName} (hors-ligne).`; return closestCommuneName; } else { document.getElementById('gaar-status').textContent = 'Nom non trouvé (hors-ligne).'; return null; } } }
function redrawGaarCircuits() { gaarLayer.clearLayers(); gaarCircuits.forEach((circuit, circuitIndex) => { if (!circuit || circuit.points.length === 0) return; const latlngs = circuit.points.map(p => [p.lat, p.lng]); const styleOptions = { color: circuit.color, weight: 3, opacity: 0.6, fillColor: circuit.color, fillOpacity: 0.2 }; if (latlngs.length >= 3) { L.polygon(latlngs, styleOptions).addTo(gaarLayer); } else if (latlngs.length > 1) { L.polyline(latlngs, styleOptions).addTo(gaarLayer); } circuit.points.forEach((point, pointIndex) => { const marker = L.circleMarker([point.lat, point.lng], { radius: 8, fillColor: circuit.color, color: '#000', weight: 1, opacity: 1, fillOpacity: 0.8 }).addTo(gaarLayer); marker.bindTooltip(`${pointIndex + 1}. ${point.name}`, { permanent: true, direction: 'top', className: 'gaar-point-label' }); const popupContent = `<div class="gaar-popup-form"><input type="text" id="gaar-input-${circuitIndex}-${pointIndex}" value="${point.name}"><button onclick="updateGaarPoint(${circuitIndex}, ${pointIndex})">OK</button><button class="delete-point-btn" onclick="deleteGaarPoint(${circuitIndex}, ${pointIndex})">Supprimer</button></div>`; marker.bindPopup(popupContent); }); }); }
window.updateGaarPoint = function(circuitIndex, pointIndex) { const input = document.getElementById(`gaar-input-${circuitIndex}-${pointIndex}`); const newName = input.value.trim(); if (newName) { gaarCircuits[circuitIndex].points[pointIndex].name = newName; redrawGaarCircuits(); saveGaarCircuits(); map.closePopup(); } };
window.deleteGaarPoint = function(circuitIndex, pointIndex) { gaarCircuits[circuitIndex].points.splice(pointIndex, 1); if (gaarCircuits[circuitIndex].points.length === 0) { gaarCircuits.splice(circuitIndex, 1); } redrawGaarCircuits(); saveGaarCircuits(); };
function clearAllGaarCircuits() { gaarCircuits = []; gaarLayer.clearLayers(); saveGaarCircuits(); }
function saveGaarCircuits() { localStorage.setItem('gaarCircuits', JSON.stringify(gaarCircuits)); }

function updateCalculatorData() {
    if (!currentCommune) {
        CALCULATOR_DATA = { distBaseFeu: 0, distPelicFeu: 0, csFeu: '--:--', distGpsFeu: 0 };
    } else {
        const lftw = airports.find(ap => ap.oaci === 'LFTW');
        const selectedPelican = airports.find(ap => ap.oaci === selectedPelicanOACI);
        const { latitude_mairie: feuLat, longitude_mairie: feuLon } = currentCommune;
        let distBaseFeu = 0; if (lftw) { distBaseFeu = calculateDistanceInNm(lftw.lat, lftw.lon, feuLat, feuLon); }
        let distPelicFeu = 0; if (selectedPelican) { distPelicFeu = calculateDistanceInNm(selectedPelican.lat, selectedPelican.lon, feuLat, feuLon); }
        let csFeu = '--:--'; if (typeof SunCalc !== 'undefined') { try { const now = new Date(); const times = SunCalc.getTimes(now, feuLat, feuLon); csFeu = times.sunset.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }); } catch (e) { /* ignore */ } }
        let distGpsFeu = 0; if (userMarker && userMarker.getLatLng()) { const userLatLng = userMarker.getLatLng(); distGpsFeu = calculateDistanceInNm(userLatLng.lat, userLatLng.lng, feuLat, feuLon); }
        CALCULATOR_DATA.distBaseFeu = Math.round(distBaseFeu);
        CALCULATOR_DATA.distPelicFeu = Math.round(distPelicFeu);
        CALCULATOR_DATA.csFeu = csFeu;
        CALCULATOR_DATA.distGpsFeu = Math.round(distGpsFeu);
    }
    if (typeof masterRecalculate === 'function') { masterRecalculate(); }
}

function soundex(s) { if (!s) return ""; const a = s.toLowerCase().split(""), f = a.shift(); if (!f) return ""; let r = ""; const codes = { a: "", e: "", i: "", o: "", u: "", b: 1, f: 1, p: 1, v: 1, c: 2, g: 2, j: 2, k: 2, q: 2, s: 2, x: 2, z: 2, d: 3, t: 3, l: 4, m: 5, n: 5, r: 6 }; return r = f + a.map(v => codes[v]).filter((v, i, a) => 0 === i ? v !== codes[f] : v !== a[i - 1]).join(""), (r + "000").slice(0, 4).toUpperCase() }
// =========================================================================
// GESTION DES CARTES HORS-LIGNE
// =========================================================================
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('OfflineTilesDB', 1);

        request.onupgradeneeded = event => {
            const dbInstance = event.target.result;
            if (!dbInstance.objectStoreNames.contains('tiles')) {
                const store = dbInstance.createObjectStore('tiles', { keyPath: 'url' });
                store.createIndex('packName', 'packName', { unique: false });
            }
        };

        request.onsuccess = event => {
            db = event.target.result;
            console.log("[DB] Connexion réussie.");
            resolve(db);
        };

        request.onerror = event => {
            console.error("[DB] Erreur de connexion:", event.target.error);
            reject(event.target.error);
        };
    });
}

async function handleZipImport(file) {
    if (!file) return;
    if (typeof JSZip === 'undefined') {
        alert("ERREUR : La librairie d'importation (JSZip) n'est pas chargée.");
        return;
    }

    const packName = file.name.replace('.zip', '');
    const progressSection = document.getElementById('import-progress-section');
    const statusMessage = document.getElementById('import-status-message');
    const progressBar = document.getElementById('import-progress-bar');

    progressSection.style.display = 'block';
    progressBar.style.width = '0%';
    statusMessage.textContent = `Analyse du fichier ${packName}...`;

    try {
        const zip = await JSZip.loadAsync(file);
        const tileFiles = Object.values(zip.files).filter(f => !f.dir && f.name.match(/\d+\/\d+\/\d+\.(png|jpg|jpeg)$/i));
        const totalFiles = tileFiles.length;

        if (totalFiles === 0) {
            throw new Error("Aucune tuile valide trouvée dans le ZIP. La structure doit être /zoom/colonne/ligne.png");
        }

        statusMessage.textContent = `Préparation de ${totalFiles} tuiles pour l'importation...`;

        // Étape 1: Décompresser toutes les tuiles en mémoire d'abord.
        const allTilesData = [];
        for (const tileFile of tileFiles) {
            const blob = await tileFile.async('blob');
            const url = `https://a.tile.openstreetmap.org/${tileFile.name}`;
            allTilesData.push({ url: url, tile: blob, packName: packName });
        }

        // Étape 2: Insérer les données par lots dans la base de données.
        const batchSize = 100; // Traiter 100 tuiles à la fois
        let processedFiles = 0;

        for (let i = 0; i < allTilesData.length; i += batchSize) {
            const batch = allTilesData.slice(i, i + batchSize);
            const transaction = db.transaction('tiles', 'readwrite');
            const store = transaction.objectStore('tiles');
            
            // Lancer toutes les écritures du lot
            batch.forEach(tileData => {
                store.put(tileData);
            });
            
            // Attendre que la transaction du lot se termine
            await new Promise((resolve, reject) => {
                transaction.oncomplete = () => {
                    processedFiles += batch.length;
                    statusMessage.textContent = `Importation... ${processedFiles} / ${totalFiles} tuiles`;
                    progressBar.style.width = `${(processedFiles / totalFiles) * 100}%`;
                    resolve();
                };
                transaction.onerror = () => reject(transaction.error);
            });
        }
        
        statusMessage.textContent = `Importation de ${packName} terminée !`;
        
        const installedPacks = JSON.parse(localStorage.getItem('installedMapPacks') || '[]');
        if (!installedPacks.find(p => p.name === packName)) {
            installedPacks.push({ name: packName, date: new Date().toLocaleDateString() });
            localStorage.setItem('installedMapPacks', JSON.stringify(installedPacks));
        }
        displayInstalledMaps();

    } catch (error) {
        statusMessage.textContent = `Erreur: ${error.message}`;
        console.error("Erreur d'importation ZIP:", error);
    } finally {
        setTimeout(() => { progressSection.style.display = 'none'; }, 5000);
    }
}

function displayInstalledMaps() {
    const list = document.getElementById('installed-maps-list');
    const installedPacks = JSON.parse(localStorage.getItem('installedMapPacks') || '[]');
    list.innerHTML = '';

    if (installedPacks.length === 0) {
        list.innerHTML = '<li class="no-maps-placeholder">Aucun pack de cartes installé.</li>';
        return;
    }

    installedPacks.forEach(pack => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span><strong>${pack.name}</strong> (Installé le ${pack.date})</span>
            <button class="delete-map-btn" onclick="window.deleteMapPack('${pack.name}')">Supprimer</button>
        `;
        list.appendChild(li);
    });
}

window.deleteMapPack = async function(packName) {
    if (!confirm(`Voulez-vous vraiment supprimer le pack de cartes "${packName}" ?\nCette opération peut prendre du temps.`)) {
        return;
    }

    try {
        const transaction = db.transaction('tiles', 'readwrite');
        const store = transaction.objectStore('tiles');
        const index = store.index('packName');
        const request = index.openKeyCursor(IDBKeyRange.only(packName));
        
        let deletedCount = 0;
        request.onsuccess = event => {
            const cursor = event.target.result;
            if (cursor) {
                store.delete(cursor.primaryKey);
                deletedCount++;
                cursor.continue();
            }
        };

        await new Promise(resolve => transaction.oncomplete = resolve);
        
        alert(`${deletedCount} tuiles du pack "${packName}" ont été supprimées.`);

        let installedPacks = JSON.parse(localStorage.getItem('installedMapPacks') || '[]');
        installedPacks = installedPacks.filter(p => p.name !== packName);
        localStorage.setItem('installedMapPacks', JSON.stringify(installedPacks));
        
        displayInstalledMaps();

    } catch (error) {
        alert(`Erreur lors de la suppression du pack : ${error.message}`);
        console.error("Erreur de suppression:", error);
    }
}
// =========================================================================
// LOGIQUE DU CALCULATEUR DE MISSION
// =========================================================================
let CALCULATOR_DATA = { distBaseFeu: 0, distPelicFeu: 0, csFeu: '--:--', distGpsFeu: 0 };
const calculateBingo = (dist) => (dist <= 70) ? (dist * 5) + 700 : (dist * 4) + 700;
const calculateFuelToGo = (dist) => (dist <= 70) ? (dist * 5) : (dist * 4);
const calculateConsoRotation = (dist) => { const effectiveDist = Math.max(dist, 10); return (effectiveDist <= 70) ? (effectiveDist * 10) + 250 : (effectiveDist * 8) + 250; };
const calculateTransitTime = (dist) => (dist <= 70) ? (dist * (60 / 210)) : (dist * (60 / 240));
const calculateRotationTime = (dist) => { const effectiveDist = Math.max(dist, 10); return (effectiveDist <= 50) ? (20 + (effectiveDist / 3.5)) : (20 + (effectiveDist / 4)); };
let masterRecalculate = () => {};
let isFuelSurFeuManual = false, isSuiviConsoManual = false, isSuiviDureeManual = false;
const parseTime = (timeString) => { if (!timeString || !timeString.includes(':')) return null; const parts = timeString.split(':'); return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10); };
const formatTime = (totalMinutes) => { if (totalMinutes === null || isNaN(totalMinutes) || totalMinutes < 0) return ''; const roundedMinutes = Math.round(totalMinutes); const hours = Math.floor(roundedMinutes / 60); const minutes = roundedMinutes % 60; return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`; };
const parseNumeric = (numericString) => { if (!numericString) return null; const value = parseInt(numericString.replace(/[^0-9]/g, ''), 10); return isNaN(value) ? null : value; };

function updateAndSortRotations(container, current, params) {
    const lines = container.querySelectorAll('.result-line');
    const sortable = [];

    lines.forEach(line => {
        const type = line.dataset.rotationType;
        let value = null;
        let formulaString = "Données insuffisantes pour le calcul.";
        const valueCell = line.querySelector('.value');
        const helpIcon = line.querySelector('.formula-help-icon');

        const canCalculateFuel = current.fuel !== null && params.consoRotation !== null && params.consoRotation > 0;
        const canCalculateTime = current.time !== null && params.rotationTime !== null && params.rotationTime > 0;

        // **Logique du +1 conditionnel**
        // Le carburant de départ pour cette vérification est le 'fuel actuel' (avant transit vers le feu), pas le 'fuel sur feu'
        const initialFuelForCheck = current.fuel + (params.transitTime ? (params.consoTransitFromGps || 0) : 0);
        const fuelForFirstDropBase = (params.transitTime ? (params.consoTransitFromGps || 0) : 0) + 250 + params.bingoBase;
        const fuelForFirstDropPelic = (params.transitTime ? (params.consoTransitFromGps || 0) : 0) + 250 + params.bingoPelic;
        
        const hasFuelForFirstDropBase = initialFuelForCheck >= fuelForFirstDropBase;
        const hasFuelForFirstDropPelic = initialFuelForCheck >= fuelForFirstDropPelic;

        if (type === 'base') {
            const plusOne = hasFuelForFirstDropBase ? 1 : 0;
            formulaString = `Fuel sur Feu = ${current.fuel || 'N/A'} kg\n\nFormule : ((Fuel sur Feu - BINGO Base) / Conso. Rotation) [+1 si possible]\n\nCalcul : ((${current.fuel || 'N/A'} - ${params.bingoBase}) / ${params.consoRotation || 'N/A'}) + ${plusOne}`;
            if (canCalculateFuel) value = ((current.fuel - params.bingoBase) / params.consoRotation) + plusOne;
        }
        if (type === 'pelic') {
            const plusOne = hasFuelForFirstDropPelic ? 1 : 0;
            formulaString = `Fuel sur Feu = ${current.fuel || 'N/A'} kg\n\nFormule : ((Fuel sur Feu - BINGO Pélic.) / Conso. Rotation) [+1 si possible]\n\nCalcul : ((${current.fuel || 'N/A'} - ${params.bingoPelic}) / ${params.consoRotation || 'N/A'}) + ${plusOne}`;
            if (canCalculateFuel) value = ((current.fuel - params.bingoPelic) / params.consoRotation) + plusOne;
        }
        if (type === 'cs') {
            formulaString = `Heure sur Feu = ${formatTime(current.time) || 'N/A'}\n\nFormule : (Heure CS - Heure sur Feu) / Durée Rotation\n\nCalcul : (${formatTime(params.csFeuTime) || 'N/A'} - ${formatTime(current.time) || 'N/A'}) / ${params.rotationTime || 'N/A'} min`;
            if (canCalculateTime && params.csFeuTime !== null) value = (params.csFeuTime - current.time) / params.rotationTime;
        }
        if (type === 'tmd') {
            formulaString = `Heure sur Feu = ${formatTime(current.time) || 'N/A'}\n\nFormule : (Heure TMD - Heure sur Feu) / Durée Rotation\n\nCalcul : (${formatTime(params.tmdTime) || 'N/A'} - ${formatTime(current.time) || 'N/A'}) / ${params.rotationTime || 'N/A'} min`;
            if (canCalculateTime && params.tmdTime !== null) value = (params.tmdTime - current.time) / params.rotationTime;
        }
        if (type === 'hdv') {
            const hdvOnSite = (params.limiteHDV !== null) ? params.limiteHDV - (params.transitTime || 0) : null;
            formulaString = `HDV sur Feu = ${formatTime(hdvOnSite) || 'N/A'}\n\nFormule : (HDV sur Feu) / Durée Rotation\n\nHDV sur Feu = ${formatTime(params.limiteHDV) || 'N/A'} - ${formatTime(params.transitTime || 0)} (transit)\n\nCalcul : ${formatTime(hdvOnSite) || 'N/A'} / ${params.rotationTime || 'N/A'} min`;
            if (canCalculateTime && hdvOnSite !== null) value = hdvOnSite / params.rotationTime;
        }
        
        if (value === null) {
            valueCell.textContent = '--';
        } else {
            valueCell.textContent = value.toFixed(1); 
        }
        
        valueCell.classList.remove('rotation-value-default', 'rotation-value-green', 'rotation-value-yellow', 'rotation-value-red');
        if (value === null) {
             valueCell.classList.add('rotation-value-default');
             valueCell.textContent = '--';
        } else if (value > 1.5) {
            valueCell.classList.add('rotation-value-green');
        } else if (value >= 1.1) {
            valueCell.classList.add('rotation-value-yellow');
        } else {
            valueCell.classList.add('rotation-value-red');
        }
        
        if (helpIcon) { helpIcon.onclick = () => alert(formulaString); }
        
        sortable.push({ value: (value !== null) ? value : Infinity, element: line });
    });

    sortable.sort((a, b) => a.value - b.a);
    sortable.forEach(item => container.appendChild(item.element));
}

function recalculateBlocFuel() {
    const blocDepart = parseTime(document.getElementById('bloc-depart').querySelector('.display-input').value);
    const fuelDepart = parseNumeric(document.getElementById('fuel-depart').querySelector('.display-input').value);
    const limiteHDV = parseTime(document.getElementById('limite-hdv').querySelector('.display-input').value);

    let previousBlocArrivee = blocDepart;
    let previousFuelPelic = fuelDepart;
    let cumulativeTpsVol = 0;
    
    const tableRows = document.querySelectorAll('#bloc-fuel tbody tr');
    tableRows.forEach((row) => {
        const blocArrivee = parseTime(row.querySelector('.time-input-wrapper .display-input').value);
        const fuelPelic = parseNumeric(row.querySelector('.numeric-input-wrapper .display-input').value);

        let dureeRotation = null;
        if (blocArrivee !== null && previousBlocArrivee !== null) {
            dureeRotation = blocArrivee - previousBlocArrivee;
        }
        let fuelRotation = null;
        if (fuelPelic !== null && previousFuelPelic !== null) {
            fuelRotation = previousFuelPelic - fuelPelic;
        }

        row.querySelector('.duree-rotation-cell').textContent = formatTime(dureeRotation) || '--';
        row.querySelector('.fuel-rotation-cell').textContent = (fuelRotation === null) ? '--' : fuelRotation;

        if (blocArrivee !== null) {
            if (dureeRotation !== null && dureeRotation > 0) {
                cumulativeTpsVol += dureeRotation;
            }
            let tpsVolRestant = null;
            if (limiteHDV !== null) {
                tpsVolRestant = limiteHDV - cumulativeTpsVol;
            }
            row.querySelector('.tps-vol-cell').textContent = formatTime(cumulativeTpsVol) || '00:00';
            row.querySelector('.tps-vol-restant-cell').textContent = formatTime(tpsVolRestant) || '--';
        } else {
            row.querySelector('.tps-vol-cell').textContent = '--';
            row.querySelector('.tps-vol-restant-cell').textContent = '--';
        }

        if (blocArrivee !== null) previousBlocArrivee = blocArrivee;
        if (fuelPelic !== null) previousFuelPelic = fuelPelic;
    });
}

function updatePreviTab() {
    const defaultFormula = "Données insuffisantes pour le calcul.";
    const setHelp = (id, formula) => {
        const icon = document.getElementById(id);
        if (icon) { icon.onclick = () => alert(formula || defaultFormula); }
    };

    if (!currentCommune) {
        document.getElementById('previ-bingo-base').innerHTML = '-- kg';
        document.getElementById('previ-bingo-pelic').innerHTML = '-- kg';
        document.querySelectorAll('#previ-rotation-results-container .value').forEach(el => { el.textContent = '--'; el.className = 'value rotation-value-default'; });
        document.getElementById('heure-sur-feu').textContent = '--:--';
        document.getElementById('duree-transit').textContent = '--:--';
        document.getElementById('conso-aller-feu').textContent = '-- kg';
        document.getElementById('fuel-sur-feu-wrapper').querySelector('.display-input').value = '';
        document.getElementById('duree-rotation').textContent = '--:--';
        document.getElementById('conso-par-rotation').textContent = '-- kg';
        document.getElementById('cs-sur-feu').textContent = '--:--';
        setHelp('heure-sur-feu-help'); setHelp('duree-transit-help'); setHelp('conso-aller-feu-help');
        setHelp('fuel-sur-feu-help'); setHelp('duree-rotation-help'); setHelp('conso-par-rotation-help');
        return;
    }

    const bingoBase = calculateBingo(CALCULATOR_DATA.distBaseFeu);
    const bingoPelic = calculateBingo(CALCULATOR_DATA.distPelicFeu);
    const bingoBaseDisplay = document.getElementById('previ-bingo-base');
    if (bingoBase === 700) { bingoBaseDisplay.innerHTML = '-- kg'; } else { bingoBaseDisplay.innerHTML = `${CALCULATOR_DATA.distBaseFeu} Nm /&nbsp;<b>${bingoBase} kg</b>`; }
    const bingoPelicDisplay = document.getElementById('previ-bingo-pelic');
    if (bingoPelic === 700 || !selectedPelicanOACI) { bingoPelicDisplay.innerHTML = '-- kg'; } else { bingoPelicDisplay.innerHTML = `${selectedPelicanOACI} / ${CALCULATOR_DATA.distPelicFeu} Nm /&nbsp;<b>${bingoPelic} kg</b>`; }
    
    const blocDepart = parseTime(document.getElementById('bloc-depart').querySelector('.display-input').value);
    const fuelDepart = parseNumeric(document.getElementById('fuel-depart').querySelector('.display-input').value);
    const limiteHDV = parseTime(document.getElementById('limite-hdv').querySelector('.display-input').value);
    const tmdTime = parseTime(document.getElementById('tmd').querySelector('.display-input').value);
    const csFeuTime = parseTime(CALCULATOR_DATA.csFeu);
    
    const transitTime = Math.round(calculateTransitTime(CALCULATOR_DATA.distBaseFeu));
    const rotationTime = Math.round(calculateRotationTime(CALCULATOR_DATA.distPelicFeu));
    const consoRotation = calculateConsoRotation(CALCULATOR_DATA.distPelicFeu);
    const consoAller = calculateFuelToGo(CALCULATOR_DATA.distBaseFeu);
    const heureSurFeu = blocDepart !== null ? blocDepart + transitTime : null;
    
    document.getElementById('duree-transit').textContent = formatTime(transitTime) || '--:--';
    setHelp('duree-transit-help', `Formule : Distance * (60 / Vitesse)\n\nCalcul : ${CALCULATOR_DATA.distBaseFeu} Nm * (60 / ${CALCULATOR_DATA.distBaseFeu <= 70 ? 210 : 240})`);
    
    document.getElementById('heure-sur-feu').textContent = formatTime(heureSurFeu) || '--:--';
    setHelp('heure-sur-feu-help', `Formule : BLOC Départ + Durée transit\n\nCalcul : ${formatTime(blocDepart) || 'N/A'} + ${formatTime(transitTime)}`);

    document.getElementById('conso-aller-feu').textContent = `${consoAller} kg`;
    setHelp('conso-aller-feu-help', `Formule : Distance * Conso. au Nm\n\nCalcul : ${CALCULATOR_DATA.distBaseFeu} Nm * ${CALCULATOR_DATA.distBaseFeu <= 70 ? 5 : 4} kg/Nm`);

    document.getElementById('duree-rotation').textContent = rotationTime === 20 ? '--:--' : formatTime(rotationTime);
    setHelp('duree-rotation-help', `Formule : 20min + (Distance / Vitesse Sol)\n\nCalcul : 20 + (${Math.max(CALCULATOR_DATA.distPelicFeu, 10)} Nm / ${Math.max(CALCULATOR_DATA.distPelicFeu, 10) <= 50 ? 3.5 : 4})`);

    document.getElementById('conso-par-rotation').textContent = consoRotation === 250 ? '-- kg' : `${consoRotation} kg`;
    setHelp('conso-par-rotation-help', `Formule : (Distance * Conso. au Nm) + Forfait\n\nCalcul : (${Math.max(CALCULATOR_DATA.distPelicFeu, 10)} Nm * ${Math.max(CALCULATOR_DATA.distPelicFeu, 10) <= 70 ? 10 : 8}) + 250`);

    const fuelSurFeuInput = document.getElementById('fuel-sur-feu-wrapper').querySelector('.display-input');
    const fuelEstime = fuelDepart ? fuelDepart - consoAller : null;
    if (!isFuelSurFeuManual) { fuelSurFeuInput.value = fuelEstime ? `${fuelEstime} kg` : ''; }
    setHelp('fuel-sur-feu-help', `Formule (AUTO) : FUEL Départ - Conso. transit\n\nCalcul : ${fuelDepart || 'N/A'} - ${consoAller}`);
    
    const fuelSurFeu = parseNumeric(fuelSurFeuInput.value);

    document.getElementById('cs-sur-feu').textContent = CALCULATOR_DATA.csFeu;
    document.getElementById('tmd-display').textContent = formatTime(tmdTime);
    document.getElementById('hdv-restant-display').textContent = formatTime(limiteHDV);

    updateAndSortRotations(document.getElementById('previ-rotation-results-container'), { fuel: fuelSurFeu, time: heureSurFeu }, { bingoBase, bingoPelic, consoRotation, rotationTime, csFeuTime, tmdTime, limiteHDV, transitTime, consoTransitFromGps: consoAller });
}

function updateSuiviTab() {
    const suiviConsoInput = document.getElementById('suivi-conso-rotation-wrapper').querySelector('.display-input');
    const suiviDureeInput = document.getElementById('suivi-duree-rotation-wrapper').querySelector('.display-input');

    if (!currentCommune) {
        document.getElementById('suivi-bingo-base').innerHTML = '-- kg';
        document.getElementById('suivi-bingo-pelic').innerHTML = '-- kg';
        document.querySelectorAll('#suivi-rotation-results-container .value').forEach(el => { el.textContent = '--'; el.className = 'value rotation-value-default'; });
        suiviConsoInput.value = '';
        suiviDureeInput.value = '';
        return;
    }
    const bingoBase = calculateBingo(CALCULATOR_DATA.distBaseFeu);
    const bingoPelic = calculateBingo(CALCULATOR_DATA.distPelicFeu);
    const bingoBaseDisplay = document.getElementById('suivi-bingo-base');
    if (bingoBase === 700) { bingoBaseDisplay.innerHTML = '-- kg'; } else { bingoBaseDisplay.innerHTML = `${CALCULATOR_DATA.distBaseFeu} Nm /&nbsp;<b>${bingoBase} kg</b>`; }
    const bingoPelicDisplay = document.getElementById('suivi-bingo-pelic');
    if (bingoPelic === 700 || !selectedPelicanOACI) { bingoPelicDisplay.innerHTML = '-- kg'; } else { bingoPelicDisplay.innerHTML = `${selectedPelicanOACI} / ${CALCULATOR_DATA.distPelicFeu} Nm /&nbsp;<b>${bingoPelic} kg</b>`; }

    if (!isSuiviConsoManual) {
        const previConso = document.getElementById('conso-par-rotation').textContent;
        suiviConsoInput.value = previConso.includes('--') ? '' : previConso;
    }
    if (!isSuiviDureeManual) {
        const previDuree = document.getElementById('duree-rotation').textContent;
        suiviDureeInput.value = previDuree.includes('--') ? '' : previDuree;
    }

    const allRows = document.querySelectorAll('#bloc-fuel tbody tr');
    let lastFilledRow = null;
    allRows.forEach(row => { if (parseTime(row.querySelector('.time-input-wrapper .display-input').value) !== null || parseNumeric(row.querySelector('.numeric-input-wrapper .display-input').value) !== null) { lastFilledRow = row; } });
    
    if (!lastFilledRow) {
        document.getElementById('suivi-fuel-actuel').textContent = '-- kg';
        document.querySelectorAll('#suivi-rotation-results-container .value').forEach(el => { el.textContent = '--'; el.className = 'value rotation-value-default'; });
    } else {
        const currentFuel = parseNumeric(lastFilledRow.querySelector('.numeric-input-wrapper .display-input').value);
        const currentTime = parseTime(lastFilledRow.querySelector('.time-input-wrapper .display-input').value);
        const currentHdv = parseTime(lastFilledRow.querySelector('.tps-vol-restant-cell').textContent);
        document.getElementById('suivi-fuel-actuel').textContent = currentFuel ? `${currentFuel} kg` : '--';
        
        const consoRotation = parseNumeric(suiviConsoInput.value);
        const rotationTime = parseTime(suiviDureeInput.value);
        
        const csFeuTime = parseTime(CALCULATOR_DATA.csFeu);
        const tmdTime = parseTime(document.getElementById('tmd').querySelector('.display-input').value);
        updateAndSortRotations(document.getElementById('suivi-rotation-results-container'), { fuel: currentFuel, time: currentTime }, { bingoBase, bingoPelic, consoRotation, rotationTime, csFeuTime, tmdTime, limiteHDV: currentHdv, transitTime: 0 });
    }
}

function updateDeroutementTab() {
    const resultsContainer = document.getElementById('derout-rotation-results-container');
    const setHelp = (id, formula) => {
        const icon = document.getElementById(id);
        if (icon) { icon.onclick = () => alert(formula || "Données insuffisantes pour le calcul."); }
    };
    
    if (!currentCommune) {
        document.getElementById('derout-bingo-base').innerHTML = '-- kg';
        document.getElementById('derout-bingo-pelic').innerHTML = '-- kg';
        resultsContainer.querySelectorAll('.value').forEach(el => { el.textContent = '--'; el.className = 'value rotation-value-default'; });
        document.getElementById('derout-fuel-mini-base').textContent = '-- kg';
        document.getElementById('derout-fuel-mini-pelic').textContent = '-- kg';
        setHelp('derout-fuel-mini-base-help'); setHelp('derout-fuel-mini-pelic-help');
        return;
    }

    const fuelActuel = parseNumeric(document.getElementById('deroutement-fuel-wrapper').querySelector('.display-input').value);
    const heureActuelle = parseTime(document.getElementById('deroutement-heure-wrapper').querySelector('.display-input').value);

    const bingoBase = calculateBingo(CALCULATOR_DATA.distBaseFeu);
    const bingoPelic = calculateBingo(CALCULATOR_DATA.distPelicFeu);
    const rotationTime = Math.round(calculateRotationTime(CALCULATOR_DATA.distPelicFeu));
    const consoRotation = calculateConsoRotation(CALCULATOR_DATA.distPelicFeu);
    const csFeuTime = parseTime(CALCULATOR_DATA.csFeu);
    const tmdTime = parseTime(document.getElementById('tmd').querySelector('.display-input').value);
    const limiteHDV = parseTime(document.getElementById('limite-hdv').querySelector('.display-input').value);
    const transitTimeFromGps = Math.round(calculateTransitTime(CALCULATOR_DATA.distGpsFeu));
    const consoTransitFromGps = calculateFuelToGo(CALCULATOR_DATA.distGpsFeu);

    const bingoBaseDisplay = document.getElementById('derout-bingo-base');
    if (bingoBase === 700) { bingoBaseDisplay.innerHTML = '-- kg'; } else { bingoBaseDisplay.innerHTML = `${CALCULATOR_DATA.distBaseFeu} Nm /&nbsp;<b>${bingoBase} kg</b>`; }
    const bingoPelicDisplay = document.getElementById('derout-bingo-pelic');
    if (bingoPelic === 700 || !selectedPelicanOACI) { bingoPelicDisplay.innerHTML = '-- kg'; } else { bingoPelicDisplay.innerHTML = `${selectedPelicanOACI} / ${CALCULATOR_DATA.distPelicFeu} Nm /&nbsp;<b>${bingoPelic} kg</b>`; }
    
    const fuelMiniBase = consoTransitFromGps + 250 + bingoBase;
    const fuelMiniPelic = consoTransitFromGps + 250 + bingoPelic;
    document.getElementById('derout-fuel-mini-base').textContent = (fuelMiniBase === (950 + consoTransitFromGps)) ? '-- kg' : `${fuelMiniBase} kg`;
    document.getElementById('derout-fuel-mini-pelic').textContent = (fuelMiniPelic === (950 + consoTransitFromGps)) ? '-- kg' : `${fuelMiniPelic} kg`;
    setHelp('derout-fuel-mini-base-help', `Formule: Conso(GPS->Feu) + Forfait Largage + BINGO Base\n\nCalcul: ${consoTransitFromGps} + 250 + ${bingoBase}`);
    setHelp('derout-fuel-mini-pelic-help', `Formule: Conso(GPS->Feu) + Forfait Largage + BINGO Pélic.\n\nCalcul: ${consoTransitFromGps} + 250 + ${bingoPelic}`);

    if (fuelActuel === null || heureActuelle === null) {
        resultsContainer.querySelectorAll('.value').forEach(el => { el.textContent = '--'; el.className = 'value rotation-value-default'; });
        resultsContainer.querySelectorAll('.formula-help-icon').forEach(icon => icon.onclick = () => alert("Données insuffisantes pour le calcul."));
        return;
    }

    const heureSurFeu = heureActuelle + transitTimeFromGps;
    const fuelSurFeu = fuelActuel - consoTransitFromGps;

    updateAndSortRotations(
        resultsContainer,
        { fuel: fuelSurFeu, time: heureSurFeu },
        { bingoBase, bingoPelic, consoRotation, rotationTime, csFeuTime, tmdTime, limiteHDV, transitTime: transitTimeFromGps }
    );
}
    
function initializeCalculator() {
    const resetButton = document.getElementById('reset-all-btn');
    const onglets = document.querySelectorAll('.onglet-bouton');
    const csLftwDisplay = document.getElementById('cs-lftw-display');
    const lftwAirport = airports.find(ap => ap.oaci === 'LFTW');
    const refreshGpsBtn = document.getElementById('refresh-gps-btn');
    refreshGpsBtn.addEventListener('click', () => {
        if (navigator.geolocation) {
            refreshGpsBtn.textContent = '🛰️ ...';
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    updateUserPosition(pos);
                    updateCalculatorData();
                    masterRecalculate();
                    refreshGpsBtn.textContent = '🛰️ Rafraîchir GPS';
                },
                () => {
                    alert("Impossible d'obtenir la position GPS.");
                    refreshGpsBtn.textContent = '🛰️ Rafraîchir GPS';
                },
                { enableHighAccuracy: true }
            );
        }
    });

    function updateLftwSunset() { if (lftwAirport && typeof SunCalc !== 'undefined') { try { const now = new Date(); const times = SunCalc.getTimes(now, lftwAirport.lat, lftwAirport.lon); const sunsetString = times.sunset.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }); csLftwDisplay.value = sunsetString; } catch (e) { csLftwDisplay.value = '--:--'; } } }
    updateLftwSunset(); setInterval(updateLftwSunset, 60000);

    onglets.forEach(onglet => { onglet.addEventListener('click', () => { document.querySelectorAll('.onglet-bouton').forEach(btn => btn.classList.remove('active')); document.querySelectorAll('.onglet-panneau').forEach(p => p.classList.remove('active')); onglet.classList.add('active'); document.getElementById(onglet.dataset.onglet).classList.add('active'); resetButton.style.display = (onglet.dataset.onglet === 'bloc-fuel') ? 'flex' : 'none'; }); });
    
    function saveCalculatorState() {
        const state = {};
        document.querySelectorAll('#calculator-modal .input-wrapper').forEach(wrapper => {
            if (wrapper.id) {
                state[wrapper.id] = wrapper.querySelector('.display-input').value;
            }
        });
        const tableData = [];
        document.querySelectorAll('#bloc-fuel tbody tr').forEach(row => {
            tableData.push({
                time: row.querySelector('.time-input-wrapper .display-input').value,
                fuel: row.querySelector('.numeric-input-wrapper .display-input').value
            });
        });
        state.calculator_table_data = tableData;
        localStorage.setItem('calculator_state', JSON.stringify(state));
    }

    function initializeTimeInput(wrapper, initialValue = '') {
        const displayInput = wrapper.querySelector('.display-input');
        const engineInput = wrapper.querySelector('.engine-input');
        const clearBtn = wrapper.querySelector('.clear-btn');

        const setTimeValue = (time) => {
            displayInput.value = time;
            if (engineInput) {
                if (String(time).match(/^\d{2}:\d{2}$/)) {
                    engineInput.value = time;
                } else {
                    engineInput.value = '';
                }
            }
        };

        setTimeValue(initialValue);
        
        displayInput.addEventListener('dblclick', (e) => {
            e.preventDefault();
            let timeString;
            if (wrapper.id === 'tmd') {
                timeString = '21:30';
            } else if (wrapper.id === 'limite-hdv') {
                timeString = '08:00';
            } else {
                const now = new Date();
                timeString = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
            }
            setTimeValue(timeString);
            masterRecalculate();
            saveCalculatorState();
        });

        if (engineInput) {
            engineInput.addEventListener('change', () => {
                if (engineInput.value) {
                    displayInput.value = engineInput.value;
                    masterRecalculate();
                    saveCalculatorState();
                }
            });
        }
        
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                const defaultValue = wrapper.id === 'tmd' ? '21:30' : wrapper.id === 'limite-hdv' ? '08:00' : '';
                setTimeValue(defaultValue);
                masterRecalculate();
                saveCalculatorState();
            });
        }
    }

    function initializeNumericInput(wrapper, initialValue = '') {
        const displayInput = wrapper.querySelector('.display-input');
        const clearBtn = wrapper.querySelector('.clear-btn');
        const unit = wrapper.dataset.unit || '';
        let shouldClearOnNextInput = false;
        displayInput.value = initialValue;
        displayInput.addEventListener('focus', () => { if (displayInput.readOnly) return; if (displayInput.value) { shouldClearOnNextInput = true; } displayInput.value = displayInput.value.replace(/[^0-9]/g, ''); });
        displayInput.addEventListener('blur', () => { if (displayInput.readOnly) return; shouldClearOnNextInput = false; let v = displayInput.value.replace(/[^0-9]/g, ''); if (v) { displayInput.value = `${v} ${unit}`; } else { displayInput.value = ''; } masterRecalculate(); saveCalculatorState(); });
        displayInput.addEventListener('input', (e) => { if (displayInput.readOnly) return; if (shouldClearOnNextInput && e.data) { displayInput.value = e.data.replace(/[^0-9]/g, ''); shouldClearOnNextInput = false; } else { displayInput.value = displayInput.value.replace(/[^0-9]/g, ''); } masterRecalculate(); });
        displayInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); displayInput.blur(); } });
        if (clearBtn) { clearBtn.addEventListener('click', () => { displayInput.value = ''; masterRecalculate(); saveCalculatorState(); }); }
    }
    
    const addNewRow = (tableBody, data, isLastRow = false) => {
        const row = document.createElement('tr');
        row.innerHTML = `<td><div class="input-wrapper time-input-wrapper"><input type="text" class="display-input" readonly placeholder="--:--"><span class="clear-btn">&times;</span><span class="clock-icon">🕒</span><input type="time" class="engine-input"></div></td><td><div class="input-wrapper numeric-input-wrapper" data-unit="kg"><input type="text" class="display-input" inputmode="numeric" placeholder="[valeur]"><span class="clear-btn">&times;</span></div></td><td class="duree-rotation-cell"></td><td class="fuel-rotation-cell"></td><td class="tps-vol-cell"></td><td class="tps-vol-restant-cell"></td>`;
        tableBody.appendChild(row);

        const timeWrapper = row.querySelector('.time-input-wrapper');
        const numericWrapper = row.querySelector('.numeric-input-wrapper');
        
        initializeTimeInput(timeWrapper, data ? data.time : '');
        initializeNumericInput(numericWrapper, data ? data.fuel : '');

        const checkAndAddRow = () => {
            if (row.nextSibling) {
                timeWrapper.querySelector('.engine-input').removeEventListener('change', checkAndAddRow);
                numericWrapper.querySelector('.display-input').removeEventListener('blur', checkAndAddRow);
                return;
            }
            if (timeWrapper.querySelector('.display-input').value || numericWrapper.querySelector('.display-input').value) {
                addNewRow(tableBody, null, true);
            }
        };

        if (isLastRow) {
            timeWrapper.querySelector('.engine-input').addEventListener('change', checkAndAddRow);
            numericWrapper.querySelector('.display-input').addEventListener('blur', checkAndAddRow);
        }
    };

    function loadCalculatorState() {
        const tableBody = document.querySelector('#bloc-fuel tbody');
        tableBody.innerHTML = '';
        const savedStateJSON = localStorage.getItem('calculator_state');
        let state = {};
        if (savedStateJSON) { state = JSON.parse(savedStateJSON); }
        initializeTimeInput(document.getElementById('bloc-depart'), state['bloc-depart']);
        initializeNumericInput(document.getElementById('fuel-depart'), state['fuel-depart'] || '3400 kg');
        initializeTimeInput(document.getElementById('tmd'), state['tmd'] || '21:30');
        initializeTimeInput(document.getElementById('limite-hdv'), state['limite-hdv'] || '08:00');
        initializeTimeInput(document.getElementById('deroutement-heure-wrapper'), state['deroutement-heure-wrapper']);
        initializeNumericInput(document.getElementById('deroutement-fuel-wrapper'), state['deroutement-fuel-wrapper']);
        initializeNumericInput(document.getElementById('fuel-sur-feu-wrapper'), state['fuel-sur-feu-wrapper']);
        initializeNumericInput(document.getElementById('suivi-conso-rotation-wrapper'), state['suivi-conso-rotation-wrapper']);
        initializeTimeInput(document.getElementById('suivi-duree-rotation-wrapper'), state['suivi-duree-rotation-wrapper']);
        
        const tableData = state.calculator_table_data || [];
        tableData.forEach(rowData => {
            addNewRow(tableBody, rowData, false);
        });

        const rowsToAdd = Math.max(6, tableBody.rows.length + 1) - tableBody.rows.length;
        for (let i = 0; i < rowsToAdd; i++) {
             const isLastRow = (i === rowsToAdd - 1);
             addNewRow(tableBody, null, isLastRow);
        }
    }

    loadCalculatorState();
    
    function setupManualButton(btnId, wrapperId, flagSetter) {
        const btn = document.getElementById(btnId); const input = document.getElementById(wrapperId).querySelector('.display-input');
        btn.addEventListener('click', () => { const isManual = flagSetter(); if (isManual) { btn.textContent = 'MANUEL'; btn.classList.add('active'); input.readOnly = false; } else { btn.textContent = 'AUTO'; btn.classList.remove('active'); input.readOnly = true; } masterRecalculate(); });
    }
    setupManualButton('fuel-sur-feu-manual-btn', 'fuel-sur-feu-wrapper', () => isFuelSurFeuManual = !isFuelSurFeuManual);
    setupManualButton('suivi-conso-rotation-manual-btn', 'suivi-conso-rotation-wrapper', () => isSuiviConsoManual = !isSuiviConsoManual);
    setupManualButton('suivi-duree-rotation-manual-btn', 'suivi-duree-rotation-wrapper', () => isSuiviDureeManual = !isSuiviDureeManual);

    resetButton.addEventListener('click', () => {
        if (confirm("Voulez-vous vraiment remettre tout le tableau à zéro ?")) {
            localStorage.removeItem('calculator_state');
            loadCalculatorState();
            masterRecalculate();
        }
    });
    
    masterRecalculate = () => { recalculateBlocFuel(); updatePreviTab(); updateSuiviTab(); updateDeroutementTab(); };
    
    masterRecalculate();
}

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('calculator-modal')) {
        initializeCalculator();
    }
});
