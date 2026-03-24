const CACHE = 'taskboard-v1';
const STATIC = [
  './',
  './index.php',
  './app.js',
  './style.css',
  './manifest.json',
  './favicon.svg',
  './icon-192.png',
  './icon-512.png',
  'https://cdn.jsdelivr.net/npm/sortablejs@1.15.2/Sortable.min.js'
];

// インストール: 静的アセットをキャッシュ
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

// アクティベート: 古いキャッシュを削除
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// フェッチ: API は Network-first、静的は Cache-first
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // api.php は常にネットワーク優先
  if (url.pathname.endsWith('api.php')) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({ error: 'オフラインです' }), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // 静的アセット: Cache-first
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});
