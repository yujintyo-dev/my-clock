const CACHE_NAME = "my-clock-v13";

const APP_FILES = [
  "/",
  "/index.html",
  "/style.css",
  "/script.js",
  "/manifest.json"
];


self.addEventListener(
  "install",
  (event) => {

    event.waitUntil(
      caches.open(CACHE_NAME)
        .then(async (cache) => {
          await Promise.all(
            APP_FILES.map(async (file) => {
              const response = await fetch(
                `${file}?cache-version=${CACHE_NAME}`
              );

              if (!response.ok) {
                throw new Error(
                  `アプリファイルを取得できません: ${file}`
                );
              }

              await cache.put(file, response);
            })
          );
        })
    );

    self.skipWaiting();
  }
);


self.addEventListener(
  "activate",
  (event) => {

    event.waitUntil(

      caches.keys()
        .then((keys) => {

          return Promise.all(

            keys
              .filter(
                (key) =>
                  key !== CACHE_NAME
              )

              .map(
                (key) =>
                  caches.delete(key)
              )

          );

        })

    );

    self.clients.claim();
  }
);


self.addEventListener(
  "fetch",
  (event) => {

    /*
     * Google APIやNode.js APIは
     * キャッシュしない。
     */
    if (
      event.request.url.includes(
        "/api/"
      )
    ) {
      return;
    }


    event.respondWith(

      caches.match(
        event.request
      )
      .then(
        (cached) => {

          if (cached) {
            return cached;
          }


          return fetch(
            event.request
          )
          .then(
            (response) => {

              /*
               * GETだけキャッシュ
               */
              if (
                event.request.method ===
                  "GET" &&
                response.ok
              ) {

                const clone =
                  response.clone();

                caches.open(
                  CACHE_NAME
                )
                .then(
                  (cache) => {

                    cache.put(
                      event.request,
                      clone
                    );

                  }
                );
              }


              return response;

            }
          );

        }
      )

    );
  }
);