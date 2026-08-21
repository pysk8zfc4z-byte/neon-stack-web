/**
 * 手書きの Service Worker（§12 M9）。
 * 外部依存を増やさないため、ビルドツールのプラグインは使わない。
 * 満たすべきは「一度開けば機内モードでも起動する」の1点だけ。
 */
const CACHE = 'yoru-nobori-watercolor-v7';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  './art/ninja-cat-vertical.png',
  './art/platform-building-white-v1.webp',
  './art/platform-building-blue-v1.png',
  './art/platform-building-green-v1.png',
  './art/platform-building-red-v1.png',
  './art/platform-building-gold-v1.png',
  './art/platform-building-rainbow-v1.png',
  './art/world-ascent-v3-00.webp',
  './art/world-ascent-v3-01.webp',
  './art/world-ascent-v3-02.webp',
  './art/world-ascent-v3-03.webp',
  './art/world-ascent-v3-04.webp',
];

/**
 * ビルド出力のファイル名にはハッシュが付くので、リストを固定で書けない。
 * かといってビルド時に生成する仕組みを足すと、依存とビルド手順が増える。
 * install の中で index.html を読んで参照先を拾えば、どちらも要らない。
 *
 * これをやらないと、初回訪問では本体 JS が SW の管理下に入る前に
 * 読み込まれてしまい、そのままオフラインにすると起動しない。
 */
async function assetUrls() {
  const res = await fetch('./index.html', { cache: 'no-store' });
  const html = await res.text();
  const out = new Set();
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const url = m[1];
    if (/^(https?:)?\/\//.test(url) || url.startsWith('data:')) continue;
    out.add(new URL(url, self.registration.scope).href);
  }
  return [...out];
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const c = await caches.open(CACHE);
      await c.addAll(SHELL);
      // 参照先が1つでも欠けていても、起動できる分は入れておく。
      const urls = await assetUrls();
      await Promise.all(urls.map((u) => c.add(u).catch(() => {})));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));

      // 古いビルドのハッシュ付きファイルを掃除する。放っておくと溜まり続ける。
      const c = await caches.open(CACHE);
      const live = new Set([
        ...(await assetUrls()),
        ...SHELL.map((u) => new URL(u, self.registration.scope).href),
      ]);
      for (const req of await c.keys()) {
        if (req.url.includes('/assets/') && !live.has(req.url)) await c.delete(req);
      }

      await self.clients.claim();
    })(),
  );
});

/**
 * Vary を無視して照合する。
 *
 * サーバーが `Vary: Origin` を返すと（vite preview がそう）、
 * SW が保存した実体（no-cors、Origin ヘッダなし）と、ブラウザが投げてくる
 * モジュールスクリプトの要求（Origin あり）が一致せず、キャッシュを外す。
 * 単一オリジンの静的アプリなので Vary を見る意味がない。
 * これを外さないと、オフライン起動が本体 JS のところで静かに失敗する。
 */
const MATCH = { ignoreVary: true };

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  // ナビゲーションはネットワーク優先。更新が反映されないのを避ける。
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req, MATCH).then((r) => r || caches.match('./index.html', MATCH))),
    );
    return;
  }

  // それ以外はキャッシュ優先。ビルド出力はハッシュ付きなので古い版が居座らない。
  e.respondWith(
    caches.match(req, MATCH).then((hit) =>
      hit ||
      fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }),
    ),
  );
});
