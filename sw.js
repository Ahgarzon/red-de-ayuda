const APP='ayuda-v20';
const TILES='ayuda-tiles-v3';
const SHELL=[
  './','./index.html','./styles.css?v=20','./app.js?v=20','./manifest.webmanifest',
  './icons/icon-192.png?v=11','./icons/icon-512.png?v=11',
  './vendor/leaflet/leaflet.js','./vendor/leaflet/leaflet.css',
  './vendor/leaflet/images/marker-icon.png','./vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-shadow.png','./vendor/leaflet/images/layers.png','./vendor/leaflet/images/layers-2x.png'
];
self.addEventListener('install', e=>{
  e.waitUntil(caches.open(APP).then(c=>Promise.allSettled(SHELL.map(u=>c.add(u)))));
  self.skipWaiting();
});
self.addEventListener('activate', e=>{
  e.waitUntil((async()=>{
    // borra los cachés de versiones anteriores
    const ks = await caches.keys();
    await Promise.all(ks.filter(k=>k!==APP&&k!==TILES).map(k=>caches.delete(k)));
    await self.clients.claim();
    /* AUTO-SANACIÓN (lo que evita que un celular se quede para SIEMPRE con la app vieja/vacía):
       cuando se activa una versión NUEVA del service worker, se recarga UNA sola vez cada
       pestaña abierta para que tome el código fresco de la red. Así, un celular que había
       abierto una versión anterior (Service Worker cache-first) NO necesita que el usuario
       cierre y reabra: se arregla solo. Solo pasa al cambiar de versión (una vez por versión),
       así que NO hay bucle de recargas. */
    const clientes = await self.clients.matchAll({type:'window'});
    for(const c of clientes){
      try{ await c.navigate(c.url); }catch(err){ try{ c.postMessage({type:'sw-updated'}); }catch(e2){} }
    }
  })());
});

/* ¿Es el "cascarón" de la app (HTML/JS/CSS/manifest)? Ese SIEMPRE se busca fresco en
   la red cuando hay señal (network-first). Así, apenas se publica una versión nueva,
   TODOS los celulares con internet la reciben al abrir — nunca se quedan con código
   viejo que muestre la app vacía. Sin señal, cae al último guardado. */
function esCascaron(url, req){
  if(req.mode==='navigate') return true;
  if(url.origin!==location.origin) return false;
  return /(\/|\.html|app\.js|styles\.css|manifest\.webmanifest)(\?|$)/.test(url.pathname+url.search);
}

self.addEventListener('fetch', e=>{
  const req=e.request;
  if(req.method!=='GET') return;                       // el API (POST) nunca se cachea
  const url=new URL(req.url);

  // Video tutorial: solo red, nunca se cachea (no inflar el almacenamiento con ~4MB)
  if(/\.mp4($|\?)/.test(url.pathname+url.search)){ return; }

  // Tiles del mapa: cache-first (guarda la zona ya vista para verla sin señal)
  if(/tile\.openstreetmap\.org|tile\.opentopomap\.org|basemaps\.cartocdn\.com/.test(url.hostname)){
    e.respondWith(caches.open(TILES).then(async c=>{
      const hit=await c.match(req); if(hit) return hit;
      try{ const res=await fetch(req); if(res&&res.ok) c.put(req,res.clone()); return res; }catch(err){ return hit||Response.error(); }
    }));
    return;
  }

  // CASCARÓN (HTML/JS/CSS/manifest): NETWORK-FIRST. Siempre la última versión si hay red.
  if(esCascaron(url, req)){
    e.respondWith((async()=>{
      try{
        const res=await fetch(req);
        if(res&&res.ok && url.origin===location.origin){ const c=await caches.open(APP); c.put(req,res.clone()); }
        return res;
      }catch(err){
        const hit=await caches.match(req);
        return hit || caches.match('./index.html') || Response.error();
      }
    })());
    return;
  }

  // Otros estáticos mismo-origen (leaflet, íconos): cache-first con refresco en 2º plano
  e.respondWith(caches.match(req).then(hit=>{
    const net=fetch(req).then(res=>{ if(res&&res.ok&&url.origin===location.origin){ caches.open(APP).then(c=>c.put(req,res.clone())); } return res; }).catch(()=>hit);
    return hit||net;
  }));
});
