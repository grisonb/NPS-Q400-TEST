const VAPID_PUBLIC_KEY = 'BAB6UkrM0OzfJPCKYux_BdLfQJbMo7qKoXPhIoTB99J93yCS69c5qk2VWYBz0aftsKwdpVrVm0JMmkdwrNRfBpY';

const logEl = document.getElementById('log');
const button = document.getElementById('test-button');

function log(message) {
    logEl.textContent += `\n${message}`;
}

function resetLog() {
    logEl.textContent = '';
}

function urlBase64ToUint8Array(base64String) {
    const cleaned = String(base64String || '').trim();
    const padding = '='.repeat((4 - cleaned.length % 4) % 4);
    const base64 = (cleaned + padding)
        .replace(/-/g, '+')
        .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; i += 1) {
        outputArray[i] = rawData.charCodeAt(i);
    }

    return outputArray;
}

button.addEventListener('click', async () => {
    resetLog();

    try {
        log(`User agent: ${navigator.userAgent}`);
        log(`serviceWorker supporté: ${'serviceWorker' in navigator ? 'oui' : 'non'}`);
        log(`PushManager supporté: ${'PushManager' in window ? 'oui' : 'non'}`);
        log(`Notification supporté: ${typeof Notification !== 'undefined' ? 'oui' : 'non'}`);

        if (!('serviceWorker' in navigator)) {
            log('STOP: serviceWorker non supporté');
            return;
        }

        if (!('PushManager' in window)) {
            log('STOP: PushManager non supporté');
            return;
        }

        if (typeof Notification === 'undefined') {
            log('STOP: Notification non supporté dans ce contexte.');
            log('Sur iPad, il faut lancer ce test depuis une PWA ajoutée à l’écran d’accueil.');
            return;
        }

        log(`Notification.permission avant: ${Notification.permission}`);

        let permission = Notification.permission;
        if (permission === 'default') {
            permission = await Notification.requestPermission();
        }

        log(`Notification.permission après: ${permission}`);

        if (permission !== 'granted') {
            log('STOP: notifications non autorisées');
            return;
        }

        log('Enregistrement service worker ./sw.js...');
        const registration = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
        log('Service worker enregistré');

        await registration.update();
        log('registration.update() OK');

        const readyRegistration = await navigator.serviceWorker.ready;
        log('navigator.serviceWorker.ready OK');

        const existingSubscription = await readyRegistration.pushManager.getSubscription();
        log(`Abonnement existant: ${existingSubscription ? 'oui' : 'non'}`);

        if (existingSubscription) {
            log('Suppression ancien abonnement...');
            await existingSubscription.unsubscribe();
            log('Ancien abonnement supprimé');
        }

        const keyUint8 = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
        log(`Clé VAPID: length=${VAPID_PUBLIC_KEY.length}, bytes=${keyUint8.byteLength}, firstByte=${keyUint8[0]}`);

        log('Test subscribe mode Uint8Array...');
        try {
            const subUint8 = await readyRegistration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: keyUint8
            });
            log('SUCCÈS Uint8Array');
            log(JSON.stringify(subUint8.toJSON(), null, 2));
            return;
        } catch (errorUint8) {
            log(`ECHEC Uint8Array: ${errorUint8.message || errorUint8}`);
        }

        log('Test subscribe mode ArrayBuffer...');
        try {
            const subArrayBuffer = await readyRegistration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: keyUint8.buffer
            });
            log('SUCCÈS ArrayBuffer');
            log(JSON.stringify(subArrayBuffer.toJSON(), null, 2));
            return;
        } catch (errorArrayBuffer) {
            log(`ECHEC ArrayBuffer: ${errorArrayBuffer.message || errorArrayBuffer}`);
        }

        log('Test subscribe mode String...');
        try {
            const subString = await readyRegistration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: VAPID_PUBLIC_KEY
            });
            log('SUCCÈS String');
            log(JSON.stringify(subString.toJSON(), null, 2));
            return;
        } catch (errorString) {
            log(`ECHEC String: ${errorString.message || errorString}`);
        }

        log('FIN: aucun mode accepté');

    } catch (error) {
        log(`ERREUR GENERALE: ${error.message || error}`);
    }
});
