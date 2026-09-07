// Solo conserva la interfaz pública del reloj. No intercepta Firebase, no
// almacena reservas y no ejecuta alarmas con la aplicación cerrada.
const PREFIX = "mimar-reloj-shell:" + self.registration.scope + ":";
const CACHE = PREFIX + "v1";
const FILES = [
  "./", "./index.html", "./reloj.css", "./reloj.js", "./motor.js",
  "./alarmas.js", "./config.js", "./demo.js", "./manifest.webmanifest",
  "./icon.svg", "./icon-192.png", "./icon-512.png"
];
const urls = FILES.map(path => new URL(path, self.registration.scope).href);
const paths = new Set(urls.map(url => new URL(url).pathname));
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(urls)));
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || !paths.has(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = url.origin + url.pathname;
    try {
      const response = await fetch(event.request);
      if (response.ok && response.type === "basic") await cache.put(key, response.clone());
      return response;
    } catch {
      const cached = await cache.match(key);
      return cached || new Response("Conectate a internet y volvé a abrir el reloj.", {
        status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }
  })());
});
