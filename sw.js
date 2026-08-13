const APP='ayuda-v8';
const TILES='ayuda-tiles-v3';
const SHELL=[
  './','./index.html','./styles.css?v=8','./app.js?v=8','./manifest.webmanifest',
  './icons/icon-192.png','./icons/icon-512.png',
  './vendor/leaflet/leaflet.js','./vendor/leaflet/leaflet.css',
  './vendor/leaflet/images/marker-icon.png','./vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-shadow.png','./vendor/leaflet/images/layers.png','./vendor/leaflet/images/layers-2x.png'
];
self.addEventListener('install', e=>{
  // Todo el shell es mismo-origen ahora: se cachea con CORS normal (NO opaco),
  // así el navegador SÍ aplica el CSS de Leaflet y el mapa se ve bien offline.
  e.waitUntil(caches.open(APP).then(c=>Promise.allSettled(SHELL.map(u=>c.add(u)))));
  self.skipWaiting();
});
self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==APP&&k!==TILES).map(k=>caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e=>{
  const req=e.request;
  if(req.method!=='GET') return;                       // el API (POST) nunca se cachea
  const url=new URL(req.url);
  // Tiles del mapa: cache-first (guarda la zona ya vista para verla sin señal)
  if(/tile\.openstreetmap\.org|tile\.opentopomap\.org|basemaps\.cartocdn\.com/.test(url.hostname)){
    e.respondWith(caches.open(TILES).then(async c=>{
      const hit=await c.match(req); if(hit) return hit;
      try{ const res=await fetch(req); if(res&&res.ok) c.put(req,res.clone()); return res; }catch(err){ return hit||Response.error(); }
    }));
    return;
  }
  // App shell + estáticos (mismo-origen): cache-first con actualización en segundo plano
  e.respondWith(caches.match(req).then(hit=>{
    const net=fetch(req).then(res=>{ if(res&&res.ok&&url.origin===location.origin){ caches.open(APP).then(c=>c.put(req,res.clone())); } return res; }).catch(()=>hit);
    return hit||net;
  }));
});
