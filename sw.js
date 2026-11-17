/* 8천만분의 1 — 서비스 워커
 *
 * 전략: Network-First.
 *   온라인일 때는 언제나 서버의 최신 응답을 받아 캐시를 갱신한 뒤 그 응답을 돌려주고,
 *   네트워크가 실패했을 때만 캐시로 폴백한다. (index.html이 하루에도 여러 번 바뀌므로
 *   Cache-First로 두면 구버전이 남는다.)
 *   HTML/내비게이션 요청은 HTTP 캐시까지 우회(cache: 'no-store')해서 항상 새 판을 받는다.
 *
 * 캐시 이름은 자산 목록이 바뀔 때만 올리면 된다. (HTML 갱신은 자동)
 */
const VERSION = 'v2';   /* v7.5: 화면 판이 바뀌어 캐시를 새로 받는다 */
const CACHE = 'one-in-80m-' + VERSION;

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './og-image.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(PRECACHE.map(async (url) => {
      try {
        await cache.add(new Request(url, { cache: 'reload' }));
      } catch (err) {
        /* 한 파일이 없어도 설치를 막지 않는다 */
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;          // 광고·외부 링크는 그대로 통과
  if (url.pathname.endsWith('/sw.js')) return;              // 서비스 워커 자신은 캐시하지 않는다

  event.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  const isDocument = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  try {
    // 문서는 HTTP 캐시까지 우회해 항상 새 판을 받는다.
    const res = await fetch(req, isDocument ? { cache: 'no-store' } : {});
    if (res && res.ok) {
      cache.put(req, res.clone()).catch(() => {});
      // 오프라인 폴백용 껍데기('./index.html')도 마지막으로 본 문서로 갱신한다.
      if (isDocument) cache.put('./index.html', res.clone()).catch(() => {});
    }
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (isDocument) {
      const shell = (await cache.match('./index.html')) || (await cache.match('./'));
      if (shell) return shell;
    }
    throw err;
  }
}
