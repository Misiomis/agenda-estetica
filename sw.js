const SW_VERSION = "mimar-sw-v13";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== SW_VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});
