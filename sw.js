// WC Tracker service worker — offline app shell + installability.
//
// Strategy:
//   • Same-origin GETs (HTML, JS, CSS, flags, icons): cache-first, then refresh
//     the cache in the background so a repeat visit works fully offline.
//   • Navigations that fail offline fall back to the cached index.html.
//   • Cross-origin live data (ESPN, jsDelivr, /api/*) is never touched here —
//     those requests pass straight through to the network, so scores are never
//     served stale from this cache.
//
// Note: this enables offline + "Add to Home Screen". True push-when-closed
// (Web Push) would additionally need VAPID keys and a push backend — not wired
// up yet; in-page notifications continue to come from app.js while a tab is open.

const CACHE = 'wc-tracker-v2';
const SHELL = [
    './',
    'index.html',
    'app.js',
    'data.js',
    'styles.css',
    'manifest.webmanifest',
    'icon.svg',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE)
            .then((c) => c.addAll(SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

// ===== Web Push =====
// A push arrives even when no tab is open. The server (api/push-tick) sends a
// JSON payload describing one kick-off / goal / full-time for a favorited team.
// We reuse the same notification `tag` the in-tab path uses, so if a tab is open
// and already alerted, the OS collapses the two instead of double-notifying.
self.addEventListener('push', (event) => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch (e) { /* no/!json payload */ }
    const title = data.title || 'WC Tracker';
    const options = {
        body: data.body || '',
        tag: data.tag || undefined,
        icon: data.icon || 'icon.svg',
        badge: 'icon.svg',
        renotify: !!data.renotify,
        data: { url: data.url || '/' },
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

// Clicking a notification focuses an existing tab (navigating it if needed) or
// opens a new one.
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const target = (event.notification.data && event.notification.data.url) || '/';
    event.waitUntil((async () => {
        const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of all) {
            if ('focus' in client) {
                if ('navigate' in client) { try { await client.navigate(target); } catch (e) { /* cross-origin guard */ } }
                return client.focus();
            }
        }
        if (self.clients.openWindow) return self.clients.openWindow(target);
    })());
});

// Save a fresh same-origin response into the cache (clone first — bodies are
// single-use).
function cachePut(req, res) {
    if (res && res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
}

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    // Only manage our own origin's assets. Live-data calls (different origin) and
    // our /api/* proxy are left to the network untouched.
    if (url.origin !== self.location.origin) return;
    if (url.pathname.startsWith('/api/')) return;

    // The app shell (markup, code, styles, manifest) is NETWORK-FIRST: an online
    // visitor always gets the freshly deployed version, so a code fix is never
    // hidden behind a stale cache. Falls back to cache only when offline.
    const isShell = req.mode === 'navigate' || /\.(?:html|js|css|webmanifest)$/i.test(url.pathname);
    if (isShell) {
        event.respondWith((async () => {
            try {
                // `cache: 'reload'` bypasses the browser HTTP cache so we get the
                // truly-deployed shell, not a heuristically-cached older copy.
                return cachePut(req, await fetch(req, { cache: 'reload' }));
            } catch (e) {
                const cached = await caches.match(req);
                if (cached) return cached;
                if (req.mode === 'navigate') return caches.match('index.html');
                return new Response('', { status: 504, statusText: 'Offline' });
            }
        })());
        return;
    }

    // Everything else (flags, icons) is CACHE-FIRST: rarely changes, so serve it
    // instantly and refresh the copy in the background.
    event.respondWith((async () => {
        const cached = await caches.match(req);
        if (cached) {
            fetch(req).then((res) => cachePut(req, res)).catch(() => {});
            return cached;
        }
        try {
            return cachePut(req, await fetch(req));
        } catch (e) {
            return new Response('', { status: 504, statusText: 'Offline' });
        }
    })());
});
