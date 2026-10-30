// 하운드 PDF(탭) 서비스 워커: 앱 파일을 모두 저장해 두고 인터넷 없이도 동작(먼저 저장본, 판이 바뀌면 VERSION을 올림).
// 사건 PDF는 여기 저장하지 않음(앱 파일만). 바깥으로 보내는 요청 없음.
const VERSION = "houndpdf-tab-11";  // 2026-10-30 세로 화면 증거는 그 쪽으로 이동, 뒤로가기로 보던 쪽
const FILES = ["./", "index.html", "app.css", "app.js", "evidence.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png",
  "vendor/pdf.min.js", "vendor/pdf.worker.min.js", "vendor/pdf-lib.min.js"];
self.addEventListener("install", e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request)));
});
