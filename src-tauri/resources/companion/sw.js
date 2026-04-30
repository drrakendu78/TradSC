var CACHE_NAME = "startrad-companion-v5";

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== CACHE_NAME) return caches.delete(key);
      }));
    }).then(function () {
      return caches.open(CACHE_NAME).then(function (cache) {
        return cache.addAll([
          "/",
          "/traduction",
          "/infos",
          "/outils",
          "/app.css?v=5",
          "/companion.js?v=5",
          "/manifest.json?v=5",
          "/logo.png?v=5"
        ]);
      });
    }).catch(function () {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== CACHE_NAME) return caches.delete(key);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;
  var url = new URL(event.request.url);
  var isLocalAppAsset = url.origin === self.location.origin;

  event.respondWith(
    (isLocalAppAsset
      ? fetch(event.request).then(function (response) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, copy);
          }).catch(function () {});
          return response;
        }).catch(function () {
          return caches.match(event.request);
        })
      : caches.match(event.request).then(function (cached) {
          if (cached) return cached;
          return fetch(event.request).then(function (response) {
            var copy = response.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(event.request, copy);
            }).catch(function () {});
            return response;
          });
        }))
  );
});
