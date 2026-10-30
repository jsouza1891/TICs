// Cache básico para que la app funcione sin conexión
const CACHE = 'asistente-v9';
const ARCHIVOS = ['./', 'index.html', 'styles.css', 'app.js', 'comercio.js', 'firebase-config.js', 'manifest.webmanifest', 'img/logo-192.png', 'img/logo-512.png', 'img/logo-encabezado.png'];

self.addEventListener('install', (e) => {
  // cache: 'reload' evita guardar copias viejas que Chrome tenga en su caché HTTP
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS.map((u) => new Request(u, { cache: 'reload' })))));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
// Red primero, cache como respaldo: así siempre se ve la última versión si hay conexión
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // Solo archivos de la app, el SDK de Firebase y jsPDF; las conexiones de Firestore y del login no se tocan
  const url = new URL(e.request.url);
  if (url.origin !== location.origin && !['www.gstatic.com', 'cdnjs.cloudflare.com'].includes(url.hostname)) return;
  // Los archivos de la app se piden siempre "frescos" al servidor (no-cache = revalidar): si no,
  // Chrome puede servir una copia de su caché HTTP y la app no se actualiza. Las librerías de
  // otros dominios llevan versión fija en la URL y pueden salir de esa caché.
  const pedido = url.origin === location.origin ? new Request(e.request.url, { cache: 'no-cache' }) : e.request;
  e.respondWith(
    fetch(pedido)
      .then((r) => { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); return r; })
      .catch(() => caches.match(e.request))
  );
});
