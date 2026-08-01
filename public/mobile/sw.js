const CACHE = "lista-compras-mobile-v1";
const SHELL = ["/mobile/index.html", "/mobile/style.css", "/mobile/app.js", "/mobile/manifest.json"];

self.addEventListener("install", (evento) => {
  evento.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches.keys().then((chaves) =>
      Promise.all(chaves.filter((c) => c !== CACHE).map((c) => caches.delete(c)))
    )
  );
  self.clients.claim();
});

// Network-first: sempre tenta buscar a versão mais nova primeiro (essencial enquanto o
// app está em desenvolvimento ativo). Só usa o cache como reserva quando offline.
self.addEventListener("fetch", (evento) => {
  if (evento.request.method !== "GET") return;
  const url = new URL(evento.request.url);
  if (!url.pathname.startsWith("/mobile/")) return;

  evento.respondWith(
    fetch(evento.request)
      .then((rede) => {
        const copia = rede.clone();
        caches.open(CACHE).then((cache) => cache.put(evento.request, copia));
        return rede;
      })
      .catch(() => caches.match(evento.request))
  );
});
