/* ========================================
   LEVEL XVIII
   SERVICE WORKER
   ======================================== */

   const CACHE_NAME =
   "level-xviii-v4";
 
 
 const FILES_TO_CACHE =
 [
 
   "./",
 
   "./index.html",
 
   "./styles.css",
 
   "./app.js",
 
   "./manifest.webmanifest",
 
   "./assets/hero.png",
 
   "./assets/icon-192.png",
 
   "./assets/icon-512.png"
 
 ];
 
 
 /* ========================================
    INSTALAÇÃO
    ======================================== */
 
 self
   .addEventListener(
     "install",
     (event) => {
 
       event
         .waitUntil(
 
           caches
             .open(
               CACHE_NAME
             )
 
             .then(
               (cache) => {
 
                 return cache
                   .addAll(
                     FILES_TO_CACHE
                   );
 
               }
             )
 
         );
 
       self
         .skipWaiting();
 
     }
   );
 
 
 /* ========================================
    ATIVAÇÃO
    ======================================== */
 
 self
   .addEventListener(
     "activate",
     (event) => {
 
       event
         .waitUntil(
 
           caches
             .keys()
 
             .then(
               (cacheNames) => {
 
                 return Promise
                   .all(
 
                     cacheNames
                       .filter(
                         (name) =>
                           name !==
                           CACHE_NAME
                       )
 
                       .map(
                         (name) =>
                           caches
                             .delete(
                               name
                             )
                       )
 
                   );
 
               }
             )
 
         );
 
       self
         .clients
         .claim();
 
     }
   );
 
 
 /* ========================================
    FETCH
    ======================================== */
 
 self
   .addEventListener(
     "fetch",
     (event) => {
 
       if (
         event
           .request
           .method !==
         "GET"
       ) {
 
         return;
 
       }
 
 
       event
         .respondWith(
 
           caches
             .match(
               event.request
             )
 
             .then(
               (cachedResponse) => {
 
                 if (
                   cachedResponse
                 ) {
 
                   return cachedResponse;
 
                 }
 
 
                 return fetch(
                   event.request
                 );
 
               }
             )
 
         );
 
     }
   );
