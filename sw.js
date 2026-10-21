// Offline support. The app shell and the food tables are cached on install; same-origin requests
// are served from cache and refreshed in the background, so a new deploy shows on the next launch.
// Calls to other sites (api.anthropic.com, api.nal.usda.gov) always go to the network.
const CACHE = 'plate-ledger-v19';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest', 'boot-theme.js',
  'app.js', 'analyze.js', 'ai.js', 'platform.js', 'device-settings.js', 'store.js', 'usda.js', 'metabolism.js',
  'calories.js', 'weight.js', 'lifting.js', 'profile.js', 'appearance.js', 'charts.js', 'food-ai.js', 'quick-add.js', 'favorites.js', 'targets.js', 'branded.js', 'accuracy.js', 'meal-view.js', 'split.js', 'lift-calendar.js', 'rest-timer.js', 'drag-sort.js', 'improvements.js', 'photos.js',
  'vendor/anthropic-sdk.js', 'usda-foods.json', 'more-foods.json',
  'icons/icon.svg', 'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('plate-ledger-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: sameOrigin });
    const network = fetch(req).then(res => {
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    if (cached) { e.waitUntil(network); return cached; }
    return (await network) || (req.mode === 'navigate' ? cache.match('index.html') : Response.error());
  })());
});
