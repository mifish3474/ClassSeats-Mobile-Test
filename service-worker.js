const BUILD_REV = 'def54fb66e4c51815f8b11f2cf073171c77c52a1'
const CACHE_NAME = `classseats-pwa-${BUILD_REV}`
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
]

const isGoogleRequest = (url) => {
  return (
    url.includes('googleapis.com') ||
    url.includes('googleusercontent.com') ||
    url.includes('accounts.google.com') ||
    url.includes('gstatic.com')
  )
}

const isCloudFunction = (url) => {
  return url.includes('classseats-sync.cloudfunctions.net')
}

const isExternal = (url, origin) => {
  return (
    url.origin !== origin ||
    isGoogleRequest(url.href) ||
    isCloudFunction(url.href)
  )
}

self.addEventListener('message', (event) => {
  if (event?.data?.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .catch(() => {})
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
      await self.clients.claim()
    })()
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Connectivity probe must ALWAYS hit the network (never cache),
  // otherwise offline detection becomes unreliable in PWAs.
  if (url.pathname === '/ping.txt') {
    event.respondWith(
      fetch(request).catch(
        () => new Response('Offline', { status: 503, statusText: 'Offline' })
      )
    )
    return
  }

  // Never intercept Google auth/Drive calls, cloud functions, or any external domains.
  if (isExternal(url, self.location.origin)) {
    return
  }

  const isNavRequest = request.mode === 'navigate'
  const isStaticAsset =
    /\.(js|css|png|svg|ico|webmanifest|json)$/.test(url.pathname) ||
    CORE_ASSETS.some((asset) => asset.endsWith(url.pathname))

  if (isNavRequest) {
    // Navigation: network-first, fallback to cached shell if offline.
    event.respondWith(
      (async () => {
        try {
          const network = await fetch(request)
          if (network && network.ok) return network
        } catch {
          /* ignore */
        }
        const cached =
          (await caches.match(request)) ||
          (await caches.match('/index.html')) ||
          (await caches.match('./index.html'))
        return (
          cached || new Response('Offline', { status: 503, statusText: 'Offline' })
        )
      })()
    )
    return
  }

  if (isStaticAsset) {
    // Static assets: cache-first, then network and cache the result.
    event.respondWith(
      (async () => {
        const cached = await caches.match(request)
        if (cached) return cached
        try {
          const response = await fetch(request)
          if (response && response.status === 200) {
            const clone = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
          }
          return response
        } catch {
          return cached || new Response('Offline', { status: 503, statusText: 'Offline' })
        }
      })()
    )
  }
})
