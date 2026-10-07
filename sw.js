// Spend It offline cache. Only ever fetches files from this same site.
const VERSION='spend-it-v8';
const ASSETS=["./", "index.html", "styles.css", "app.js", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png", "lib/pdf.min.js", "lib/pdf.worker.min.js", "lib/xlsx.full.min.js", "fonts/figtree-latin-600-normal.woff2", "fonts/figtree-latin-700-normal.woff2", "fonts/figtree-latin-400-normal.woff2", "fonts/bricolage-grotesque-latin-600-normal.woff2", "fonts/figtree-latin-500-normal.woff2", "fonts/bricolage-grotesque-latin-700-normal.woff2"];
self.addEventListener('install',e=>{e.waitUntil(caches.open(VERSION).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==location.origin)return;
  e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(VERSION).then(c=>c.put(e.request,cp));return r}).catch(()=>caches.match(e.request,{ignoreSearch:true}).then(r=>r||caches.match('index.html'))));
});
