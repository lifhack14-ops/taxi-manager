const CACHE_NAME = "taxi-manager-v3";

const APP_SHELL = [
    "./",
    "./index.html",
    "./manifest.json",
    "./icon-180.png",
    "./icon-512.png"
];

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache =>
                cache.addAll(APP_SHELL)
            )
            .catch(() => {})
    );

    self.skipWaiting();
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys()
            .then(keys =>
                Promise.all(
                    keys
                        .filter(key =>
                            key !== CACHE_NAME
                        )
                        .map(key =>
                            caches.delete(key)
                        )
                )
            )
            .then(() =>
                self.clients.claim()
            )
    );
});

self.addEventListener("fetch", event => {
    if (event.request.method !== "GET") {
        return;
    }

    /*
     * For pages: always try the newest version
     * from GitHub first.
     */
    if (event.request.mode === "navigate") {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    const clone =
                        response.clone();

                    caches.open(CACHE_NAME)
                        .then(cache =>
                            cache.put(
                                "./index.html",
                                clone
                            )
                        );

                    return response;
                })
                .catch(() =>
                    caches.match("./index.html")
                )
        );

        return;
    }

    /*
     * Other local files:
     * cache first, then network.
     */
    event.respondWith(
        caches.match(event.request)
            .then(cached => {

                if (cached) {
                    return cached;
                }

                return fetch(event.request)
                    .then(response => {

                        if (
                            response &&
                            response.status === 200 &&
                            response.type === "basic"
                        ) {
                            const clone =
                                response.clone();

                            caches.open(CACHE_NAME)
                                .then(cache =>
                                    cache.put(
                                        event.request,
                                        clone
                                    )
                                );
                        }

                        return response;
                    })
                    .catch(() =>
                        caches.match(
                            "./index.html"
                        )
                    );
            })
    );
});
