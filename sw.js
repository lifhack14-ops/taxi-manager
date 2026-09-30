```javascript
const CACHE_NAME = "taxi-manager-v2";

const FILES_TO_CACHE = [
    "./",
    "./index.html",
    "./manifest.json"
];


self.addEventListener(
    "install",
    event => {

        event.waitUntil(

            caches.open(CACHE_NAME)
                .then(cache =>
                    cache.addAll(
                        FILES_TO_CACHE
                    )
                )

        );

        /*
           Одразу активуємо нову версію
        */

        self.skipWaiting();
    }
);


self.addEventListener(
    "activate",
    event => {

        event.waitUntil(

            caches.keys()
                .then(keys =>

                    Promise.all(

                        keys
                            .filter(
                                key =>
                                    key !== CACHE_NAME
                            )
                            .map(
                                key =>
                                    caches.delete(key)
                            )

                    )

                )

                .then(() =>
                    self.clients.claim()
                )

        );
    }
);


self.addEventListener(
    "fetch",
    event => {

        /*
           Для index.html спочатку
           намагаємося отримати
           свіжу версію з мережі.
        */

        if (
            event.request.method === "GET" &&
            event.request.mode === "navigate"
        ) {

            event.respondWith(

                fetch(event.request)
                    .then(response => {

                        const responseClone =
                            response.clone();

                        caches.open(CACHE_NAME)
                            .then(cache => {

                                cache.put(
                                    "./index.html",
                                    responseClone
                                );

                            });

                        return response;

                    })
                    .catch(() => {

                        return caches.match(
                            "./index.html"
                        );

                    })

            );

            return;
        }


        /*
           Для інших файлів:
           спочатку кеш,
           потім мережа.
        */

        event.respondWith(

            caches.match(
                event.request
            )
            .then(cachedResponse => {

                if (cachedResponse) {

                    return cachedResponse;

                }


                return fetch(
                    event.request
                )
                .then(response => {

                    if (
                        !response ||
                        response.status !== 200 ||
                        response.type !== "basic"
                    ) {

                        return response;

                    }


                    const responseClone =
                        response.clone();


                    caches.open(
                        CACHE_NAME
                    )
                    .then(cache => {

                        cache.put(
                            event.request,
                            responseClone
                        );

                    });


                    return response;

                })
                .catch(() => {

                    return caches.match(
                        "./index.html"
                    );

                });

            })

        );

    }
);
```
