/* BizmindMakers Chat Pro service worker
 * Cache the application shell, version-pinned CDN assets, and validated public runtime config.
 * Never cache Supabase data, authenticated API responses, or user messages.
 */
const CACHE_PREFIX = "ultra-chat-pro";
const CACHE_VERSION = "v38";
const SHELL_CACHE = `${CACHE_PREFIX}-shell-${CACHE_VERSION}`;
const CDN_CACHE = `${CACHE_PREFIX}-cdn-${CACHE_VERSION}`;
const RUNTIME_CONFIG_CACHE = `${CACHE_PREFIX}-runtime-config-${CACHE_VERSION}`;
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
      new URL("./icon-192.png", base).href,
      new URL("./icon-512.png", base).href,
      new URL("./icon-1024.png", base).href,
      new URL("./apple-touch-icon.png", base).href,
      new URL("./membership.js", base).href,
      new URL("./membership.css", base).href,
      new URL("./app.css", base).href,
      new URL("./app-overrides.css", base).href,
      new URL("./modules/backup-restore.js", base).href,
      new URL("./modules/audio-player.js", base).href,
      new URL("./modules/audio-player.css", base).href,
      new URL("./modules/app-updater.js", base).href,
      new URL("./modules/app-updater.css", base).href,
      new URL("./modules/voice-recorder.js", base).href,
      new URL("./modules/voice-recorder.css", base).href,
      new URL("./modules/message-loader.js", base).href,
      new URL("./modules/message-reactions.js", base).href,
      new URL("./modules/message-reactions.css", base).href,
      new URL("./modules/profile-status-and-conversation-images.js", base).href,
      new URL("./modules/profile-status-and-conversation-images.css", base).href,
      new URL("./modules/status-workspace.js", base).href,
      new URL("./modules/status-workspace.css", base).href
    ]);
  })());
});

function isCacheableRuntimeConfig(source) {
  const prefix = "window.BIZMIND_RUNTIME_CONFIG = ";
  if (typeof source !== "string" || !source.startsWith(prefix)) return false;
  let payload = source.slice(prefix.length).trim();
  if (payload.endsWith(";")) payload = payload.slice(0, -1).trim();
  try {
    const config = JSON.parse(payload);
    if (!config || config.error || !["production", "preview", "development"].includes(config.environment)) return false;
    if (typeof config.supabaseUrl !== "string" || typeof config.supabaseAnonKey !== "string") return false;
    const endpoint = new URL(config.supabaseUrl);
    if (endpoint.protocol !== "https:" || !endpoint.hostname.endsWith(".supabase.co") || endpoint.username || endpoint.password) return false;
    const key = config.supabaseAnonKey;
    if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
    if (/^sb_secret_/i.test(key)) return false;
    const parts = key.split(".");
    if (parts.length !== 3) return false;
    const encoded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "="));
    return JSON.parse(decoded).role === "anon";
  } catch {
    return false;
  }
}

self.addEventListener("message", event => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, CDN_CACHE, RUNTIME_CONFIG_CACHE]);
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

  const runtimeConfigPath = new URL("/api/runtime-config", self.location.origin).pathname;
  if (url.pathname === runtimeConfigPath) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CONFIG_CACHE);
      try {
        const response = await fetch(request);
        if (response && response.ok && isCacheableRuntimeConfig(await response.clone().text())) {
          await cache.put(request, response.clone());
        }
        return response;
      } catch {
        const cached = await cache.match(request);
        if (cached) return cached;
        return new Response('window.BIZMIND_RUNTIME_CONFIG = {"error":"Runtime configuration unavailable while offline."};', {
          status: 503,
          headers: { "Content-Type": "application/javascript; charset=utf-8" }
        });
      }
    })());
    return;
  }

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