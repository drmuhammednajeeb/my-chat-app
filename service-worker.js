/* BizmindMakers Chat Pro service worker
 * Cache only the application shell and version-pinned static CDN assets.
 * Never cache Supabase/API requests, authenticated data, or user messages.
 */
const CACHE_PREFIX = "ultra-chat-pro";
const CACHE_VERSION = "v3";
const SHELL_CACHE = `${CACHE_PREFIX}-shell-${CACHE_VERSION}`;
const CDN_CACHE = `${CACHE_PREFIX}-cdn-${CACHE_VERSION}`;
const CDN_ORIGINS = new Set([
  "https://cdn.jsdelivr.net",
  "https://unpkg.com",
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com"
]);

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const base = self.registration.scope;
    await cache.addAll([
      new URL("./", base).href,
      new URL("./manifest.json", base).href,
      new URL("./icons/ultra-chat.svg", base).href
    ]);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, CDN_CACHE]);
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key => key.startsWith(CACHE_PREFIX + "-") && !keep.has(key))
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (CDN_ORIGINS.has(url.origin)) {
    event.respondWith((async () => {
      const cache = await caches.open(CDN_CACHE);
      const cached = await cache.match(request);
      const network = fetch(request).then(response => {
        if (response && (response.ok || response.type === "opaque")) {
          cache.put(request, response.clone()).catch(() => {});
        }
        return response;
      });
      if (cached) {
        network.catch(() => {});
        return cached;
      }
      try {
        return await network;
      } catch {
        return new Response("", {
          status: 503,
          statusText: "Offline static asset unavailable"
        });
      }
    })());
    return;
  }

  if (url.origin !== self.location.origin) return;

  const scopeUrl = new URL(self.registration.scope);
  if (!url.pathname.startsWith(scopeUrl.pathname)) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      try {
        const response = await fetch(request);
        if (response && response.ok) {
          cache.put(new URL("./index.html", scopeUrl).href, response.clone()).catch(() => {});
        }
        return response;
      } catch {
        return (await cache.match(new URL("./index.html", scopeUrl).href))
          || (await cache.match(new URL("./", scopeUrl).href))
          || new Response("أنت غير متصل بالإنترنت. أعد الاتصال لفتح BizmindMakers Chat Pro.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" }
          });
      }
    })());
    return;
  }

  const isShellAsset = url.pathname.endsWith("/manifest.json")
    || url.pathname.endsWith("/icons/ultra-chat.svg");
  if (!isShellAsset) return;

  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone()).catch(() => {});
    return response;
  })());
});