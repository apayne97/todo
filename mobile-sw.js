// Mobile PWA shell cache. Only the static shell is cached — /todos, /config and
// /login always go to the network (the app has its own localStorage fallback for
// offline reads). Bump CACHE to force a shell refresh after deploying changes.
const CACHE = "todo-mobile-v2";
const SHELL = [
  "/m",
  "/mobile.html",
  "/mobile.css",
  "/mobile.js",
  "/parse.js",
  "/mobile.webmanifest",
  "/icon-m.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // never cache the data / auth endpoints
  if (["/todos", "/config", "/capture", "/login", "/logout"].some((p) => url.pathname.startsWith(p))) {
    return;
  }

  // shell: serve from cache, refresh in the background
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      const net = fetch(req)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => hit);
      return hit || net;
    })
  );
});
