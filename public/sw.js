// Smart Splitter service worker — makes the app installable + work offline.
// Bump CACHE when you want to force-clear old cached assets on next visit.
const CACHE = 'smart-splitter-v1'

// Activate immediately on install, don't wait for old tabs to close.
self.addEventListener('install', () => self.skipWaiting())

// On activate, delete any caches from older versions.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  // Only handle GETs we serve ourselves. Never touch Supabase / Gemini / fonts
  // (cross-origin) or writes — those must always hit the network with fresh data.
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Page navigations: network-first so you always get the latest build when
  // online; fall back to the cached app shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(res => {
          const copy = res.clone()
          caches.open(CACHE).then(c => c.put('/', copy))
          return res
        })
        .catch(() => caches.match('/').then(r => r || caches.match(request)))
    )
    return
  }

  // Static assets (Vite hashes their filenames, so cache is always safe):
  // stale-while-revalidate — serve cache instantly, refresh in the background.
  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request).then(res => {
        if (res && res.status === 200) {
          const copy = res.clone()
          caches.open(CACHE).then(c => c.put(request, copy))
        }
        return res
      }).catch(() => cached)
      return cached || network
    })
  )
})
