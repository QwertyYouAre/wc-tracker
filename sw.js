// Service worker for WC Tracker.
//
// Its job is push notifications: the backend (api/notify-cron) sends a Web Push
// when a followed team kicks off, scores, or finishes, and this worker turns
// that push into an OS notification — even when the app/tab is closed. On iOS
// this only runs once the site is installed to the Home Screen (iOS 16.4+).

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
    let d = {};
    try { d = event.data ? event.data.json() : {}; } catch (_) { /* non-JSON push */ }
    const title = d.title || 'WC Tracker';
    const options = {
        body: d.body || '',
        tag: d.tag,                 // same tag collapses duplicates (e.g. a goal seen twice)
        renotify: !!d.tag,
        icon: d.icon || '/icon-192.png',
        badge: '/icon-192.png',
        data: { url: d.url || '/' },
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = (event.notification.data && event.notification.data.url) || '/';
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
            for (const w of wins) {
                if ('focus' in w) { w.focus(); if ('navigate' in w) w.navigate(url); return; }
            }
            return self.clients.openWindow(url);
        })
    );
});
