const APP='ayuda-v1';
const TILES='ayuda-tiles-v1';
const SHELL=[
  './','./index.html','./styles.css','./app.js','./manifest.webmanifest',
  './icons/icon-192.png','./icons/icon-512.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];
self.addEventListener('install', e=>{
  e.waitUntil(caches.open(APP).then(c=>c.addAll(SHELL.map(u=>new Request(u,{mode:'no-cors'})))).catch(()=>{}));
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
  if(/tile\.openstreetmap\.org/.test(url.hostname)){
    e.respondWith(caches.open(TILES).then(async c=>{
      const hit=await c.match(req); if(hit) return hit;
      try{ const res=await fetch(req); c.put(req,res.clone()); return res; }catch(err){ return hit||Response.error(); }
    }));
    return;
  }
  // App shell + estáticos: cache-first con actualización en segundo plano
  e.respondWith(caches.match(req).then(hit=>{
    const net=fetch(req).then(res=>{ if(res&&res.ok){ caches.open(APP).then(c=>c.put(req,res.clone())); } return res; }).catch(()=>hit);
    return hit||net;
  }));
});
