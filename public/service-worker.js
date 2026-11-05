/* The build replaces these two constants from actual copied file bytes.
 * This source template deliberately cannot install without a complete build.
 * No runtime/user data is cached, synchronized, or changed by this worker.
 */
const BUILD_VERSION = "__YANGATLAS_BUILD_VERSION__";
const PRECACHE = /* YANGATLAS_PRECACHE */ [];
const BASE = new URL(self.registration.scope);
const CACHE_PREFIX = `yangatlas-offline:${encodeURIComponent(BASE.pathname)}:`;
const CACHE_NAME = CACHE_PREFIX + BUILD_VERSION;
const INDEX_URL = new URL("./index.html", BASE).href;
const ASSET_URLS = new Set(
  PRECACHE.map((entry) => new URL(entry.url, BASE).href),
);

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      if (BUILD_VERSION.startsWith("__") || !ASSET_URLS.has(INDEX_URL)) {
        throw new Error(
          "YangAtlas offline support requires the generated build.",
        );
      }
      try {
        const cache = await caches.open(CACHE_NAME);
        // Integrity checks prevent a partially deployed/mismatched release from
        // becoming an offline app. The previous active cache stays untouched.
        await cache.addAll(
          PRECACHE.map(
            (entry) =>
              new Request(new URL(entry.url, BASE), {
                credentials: "same-origin",
                cache: "reload",
                redirect: "error",
                integrity: entry.integrity,
              }),
          ),
        );
      } catch (error) {
        await caches.delete(CACHE_NAME);
        throw error;
      }
      // Updates wait for all previous tabs to close or explicit user acceptance.
      // In particular, installation never calls skipWaiting or reloads a tab.
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "YANGATLAS_ACTIVATE_UPDATE" || !event.source?.url)
    return;
  const source = new URL(event.source.url);
  if (
    source.origin !== BASE.origin ||
    !source.pathname.startsWith(BASE.pathname)
  )
    return;
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== BASE.origin || !url.pathname.startsWith(BASE.pathname))
    return;
  // This app uses its root document, not server-side path routing. Restrict the
  // navigation fallback so missing files/docs never masquerade as app HTML.
  const isEntry =
    url.pathname === BASE.pathname ||
    url.pathname === new URL(INDEX_URL).pathname;
  const key =
    request.mode === "navigate" && isEntry
      ? INDEX_URL
      : (() => {
          url.search = "";
          url.hash = "";
          return url.href;
        })();
  if (!ASSET_URLS.has(key)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match(key)) || fetch(request);
    })(),
  );
});
