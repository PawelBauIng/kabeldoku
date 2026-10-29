// Offline-Speicher für die App-Dateien. Nutzerdaten liegen in IndexedDB, nicht hier.
const CACHE="kabeldoku-d5a5a99622";
const FILES=["./", "index.html", "styles.css", "app.js", "viewer-template.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png", "lib/jszip.min.js", "lib/jspdf.umd.min.js", "lib/pdf.min.js", "lib/pdf.worker.min.js", "demo/projekt/projekt.json", "demo/projekt/plan.jpg", "demo/projekt/fotos/88e165ed-064d-4116-9bf7-16886a22bcbf.jpg", "demo/projekt/fotos/1b32edc4-c76d-4e05-994d-e7fb945171d8.jpg", "demo/projekt/fotos/7d6d756d-a439-42e8-8777-8c233aaae0d1.jpg", "demo/projekt/fotos/f2c302c7-6ffb-4a18-9b22-c686a186042a.jpg", "demo/projekt/fotos/9de65b24-d22c-4bfe-aa0d-0492558a96f2.jpg", "demo/Testplan_Kabeltrasse.pdf"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(n=>n!==CACHE).map(n=>caches.delete(n)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET"||new URL(e.request.url).origin!==location.origin)return;
  e.respondWith(caches.match(e.request,{ignoreSearch:true}).then(r=>r||fetch(e.request)));
});
