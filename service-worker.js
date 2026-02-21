const BUILD_REV = 'ee696af6e74f2fe51eaa1f6d08c110ffadb72cff'
const CACHE_NAME = `classseats-pwa-${BUILD_REV}`
const CORE_ASSETS = [
  '/',
  './',
  '/index.html',
  './index.html',
  '/manifest.webmanifest',
  './manifest.webmanifest',
  '/icons/icon-192.png',
  './icons/icon-192.png',
  '/icons/icon-512.png',
  './icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  './icons/apple-touch-icon.png',
]
const SHELL_ASSETS = ['/', './', '/index.html', './index.html']

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
    (async () => {
      const cache = await caches.open(CACHE_NAME)
      await Promise.all(
        CORE_ASSETS.map((asset) =>
          cache.add(asset).catch(() => null)
        )
      )

      let hasShell = false
      for (const asset of SHELL_ASSETS) {
        const hit = await cache.match(asset)
        if (hit) {
          hasShell = true
          break
        }
      }

      if (!hasShell) {
        throw new Error('service worker install failed: no cached app shell')
      }
    })()
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME)
      const hasShell =
        (await cache.match('/index.html')) ||
        (await cache.match('./index.html')) ||
        (await cache.match('/')) ||
        (await cache.match('./'))

      // Do not evict prior caches unless this revision has a valid app shell.
      if (!hasShell) {
        await self.clients.claim()
        return
      }

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
          // GH Pages SPA fallback may return the app shell with HTTP 404.
          // For navigations, any successful fetch response can still boot the app.
          if (network) return network
        } catch {
          /* ignore */
        }
        const cached =
          (await caches.match(request)) ||
          (await caches.match('/')) ||
          (await caches.match('./')) ||
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
