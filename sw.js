'use strict';
// Service worker: מאפשר התקנה כאפליקציה ופתיחה מהירה.
// לעולם לא שומר במטמון תשובות API (נתונים אישיים) – רק את קבצי הממשק הציבוריים.
const CACHE = 'handasa-shell-v1';
const SHELL = ['/', '/index.html', '/favicon.svg', '/icon-192.png', '/logo.png', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return; // API: תמיד מהרשת, בלי מטמון
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req.mode === 'navigate' ? '/' : req, copy)); }
      return res;
    } catch {
      const hit = await caches.match(req.mode === 'navigate' ? '/' : req);
      if (hit) return hit;
      return new Response('<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>אין חיבור</title><body style="font-family:system-ui;padding:40px;text-align:center"><h1>אין חיבור לאינטרנט</h1><p>המערכת תחזור לפעול כשהחיבור יחזור.</p></body></html>',
        { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
  })());
});
