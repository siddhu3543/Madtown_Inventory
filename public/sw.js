/* Madtown Inventory service worker. NFR-013: item lookup and scanning work from a cached copy when signal is poor.
   Mutations are never cached or replayed here; the app's IndexedDB queue (NFR-014) handles offline check-out/in. */
const V = "mt-v1";
const SHELL = ["/offline", "/manifest.webmanifest", "/icons/icon-192.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });

const cacheable = (url) => url.pathname === "/api/items/index" || url.pathname === "/scan" || url.pathname === "/items" || /^\/items\/[A-Z0-9_-]+(\/checkout)?$/i.test(url.pathname) || /^\/kits\/KIT_\d+$/i.test(url.pathname);

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { const cp = res.clone(); caches.open(V).then((c) => c.put(req, cp)); return res; })));
    return;
  }
  if (cacheable(url) || req.mode === "navigate") {
    e.respondWith(fetch(req).then((res) => {
      if (res.ok && cacheable(url)) { const cp = res.clone(); caches.open(V).then((c) => c.put(req, cp)); }
      return res;
    }).catch(async () => (await caches.match(req, { ignoreSearch: url.pathname === "/scan" })) || (req.mode === "navigate" ? caches.match("/offline") : new Response(JSON.stringify({ items: [], offline: true }), { headers: { "Content-Type": "application/json" } }))));
  }
});
