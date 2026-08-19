const APP='ayuda-v37';
const TILES='ayuda-tiles-v3';
const SHELL=[
  './','./index.html','./styles.css?v=37','./app.js?v=37','./manifest.webmanifest',
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
    /* AUTO-SANACIÓN: al activar una versión NUEVA del SW, avisamos a las pestañas abiertas
       para que tomen el código fresco con UNA sola recarga (la hace la página, con bandera
       anti-bucle). Ya no forzamos navigate() desde el SW: eso podía volver a colgar en señal
       débil. clients.claim() dispara controllerchange en la página → recarga una vez. */
    const cs = await self.clients.matchAll({type:'window'});
    for(const c of cs){ try{ c.postMessage({type:'sw-updated'}); }catch(e2){} }
  })());
});

/* ¿Es el "cascarón" de la app (HTML/JS/CSS/manifest)? */
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

  // version.json: SIEMPRE red, nunca caché (es el que detecta si el celular corre código viejo)
  if(/version\.json($|\?)/.test(url.pathname+url.search)){ return; }

  // Tiles del mapa: cache-first (guarda la zona ya vista para verla sin señal)
  if(/tile\.openstreetmap\.org|tile\.opentopomap\.org|basemaps\.cartocdn\.com/.test(url.hostname)){
    e.respondWith(caches.open(TILES).then(async c=>{
      const hit=await c.match(req); if(hit) return hit;
      try{ const res=await fetch(req); if(res&&res.ok) c.put(req,res.clone()); return res; }catch(err){ return hit||Response.error(); }
    }));
    return;
  }

  // CASCARÓN (HTML/JS/CSS/manifest): NETWORK-FIRST **CON TIEMPO LÍMITE**.
  // Antes era network-first SIN límite: en señal débil (lo normal en zona de desastre) el
  // fetch NO fallaba rápido, se QUEDABA COLGADO hasta el timeout del sistema (20-60s) y en
  // ese rato la app quedaba EN BLANCO y los botones muertos (boot() nunca corría). Ahora:
  // si hay copia guardada y la red tarda más de 3.5s, servimos la copia AL INSTANTE (nunca
  // pantalla blanca) y la red sigue en 2º plano para dejar el caché fresco para la próxima.
  // Si la red responde rápido y bien, se usa esa (siempre la última versión con buena señal).
  if(esCascaron(url, req)){
    e.respondWith((async()=>{
      const cached = await caches.match(req);
      // net → resuelve a la respuesta SOLO si llegó y es válida; si falla o no-ok, resuelve null
      const net = fetch(req).then(res=>{
        if(res && res.ok){
          if(url.origin===location.origin){ caches.open(APP).then(c=>c.put(req,res.clone())); }
          return res;
        }
        return null;
      }).catch(()=>null);

      if(cached){
        // carrera: la red vs 3.5s. Gana lo primero; si la red no llegó a tiempo → copia guardada.
        const timeout = new Promise(r=> setTimeout(()=>r(null), 3500));
        const winner = await Promise.race([ net, timeout ]);
        return winner || cached;
      }
      // Primera vez (sin copia guardada): dependemos de la red, con respaldo al index guardado.
      const res = await net;
      return res || (await caches.match('./index.html')) || Response.error();
    })());
    return;
  }

  // Otros estáticos mismo-origen (leaflet, íconos): cache-first con refresco en 2º plano
  e.respondWith(caches.match(req).then(hit=>{
    const net=fetch(req).then(res=>{ if(res&&res.ok&&url.origin===location.origin){ caches.open(APP).then(c=>c.put(req,res.clone())); } return res; }).catch(()=>hit);
    return hit||net;
  }));
});
