/* LEVEL XVIII — cache dos arquivos públicos do convite e da galeria. */

const CACHE_NAME = "level-xviii-v7";
const INVITATION_CACHE_PATTERN = /^level-xviii-v\d+$/;

const FILES_TO_CACHE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./assets/reinaldo-oficial.jpeg",
  "./assets/icon-level-xviii.svg",
  "./assets/icon-level-xviii-192.png",
  "./assets/icon-level-xviii-512.png",
  "./live-experience/",
  "./live-experience/index.html",
  "./live-experience/styles.css",
  "./live-experience/app.js",
  "./live-experience/navigation.js",
  "./live-experience/data-source.js",
  "./live-experience/gallery.js"
];

const STATIC_PATHS = new Set(
  FILES_TO_CACHE.map((path) => new URL(path, self.location.href).pathname)
);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(FILES_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => INVITATION_CACHE_PATTERN.test(name) && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

async function fetchPage(request, url) {
  try {
    // Prioriza o HTML atual, inclusive quando há token na navegação.
    return await fetch(request);
  } catch (error) {
    const cache = await caches.open(CACHE_NAME);
    // O fallback é somente HTML público; não armazena respostas por token.
    const cachedPage = await cache.match(`${url.origin}${url.pathname}`);
    if (cachedPage) return cachedPage;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // APIs, fotos futuras e outros domínios seguem diretamente para a rede.
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    !STATIC_PATHS.has(url.pathname)
  ) {
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(fetchPage(event.request, url));
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME)
      .then((cache) => cache.match(event.request))
      .then((cachedResponse) => cachedResponse || fetch(event.request))
  );
});
