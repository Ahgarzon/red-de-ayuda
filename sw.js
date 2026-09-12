const APP='ayuda-v71';
const TILES='ayuda-tiles-v3';
const BASE='ayuda-base-v3';   // mapa de Colombia a bajo zoom, precargado (nunca en blanco sin señal). v3: tiles OSM (CARTO exigía API key y estampaba marca de agua)
importScripts('./base-tiles.js');   // define self.BASE_TILES = [ ...URLs de tiles... ]
const SHELL=[
  './','./index.html','./styles.css?v=63','./app.js?v=63','./manifest.webmanifest','./base-tiles.js','./gazetteer.js',
  './icons/icon-192.png?v=11','./icons/icon-512.png?v=11',
  './vendor/leaflet/leaflet.js','./vendor/leaflet/leaflet.css',
  './vendor/leaflet/images/marker-icon.png','./vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-shadow.png','./vendor/leaflet/images/layers.png','./vendor/leaflet/images/layers-2x.png'
];
self.addEventListener('install', e=>{
  e.waitUntil((async()=>{
    // 1) cascarón de la app (crítico) — debe quedar guardado sí o sí
    const c=await caches.open(APP);
    await Promise.allSettled(SHELL.map(u=>c.add(u)));
    // 2) mapa base de Colombia (bajo zoom) — se guarda en 2º plano; si algún tile falla, no
    //    rompe la instalación (allSettled). Así el país siempre se dibuja aunque no haya señal.
    try{
      const b=await caches.open(BASE);
      const faltan=[];
      for(const u of (self.BASE_TILES||[])){ if(!(await b.match(u))) faltan.push(u); }
      // En señal débil (el caso real en zona de desastre) disparar ~830 tiles de golpe ahoga la
      // conexión y ninguna termina. Se bajan de a lotes chicos: es más lento pero SÍ completa.
      const LOTE=12;
      for(let i=0;i<faltan.length;i+=LOTE){
        await Promise.allSettled(faltan.slice(i,i+LOTE).map(u=>b.add(new Request(u,{mode:'cors'}))));
      }
    }catch(_){}
  })());
  self.skipWaiting();
});
self.addEventListener('activate', e=>{
  e.waitUntil((async()=>{
    // borra los cachés de versiones anteriores
    const ks = await caches.keys();
    await Promise.all(ks.filter(k=>k!==APP&&k!==TILES&&k!==BASE).map(k=>caches.delete(k)));
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

  // Tiles del mapa: cache-first. Busca en el mapa base PRECARGADO (BASE) y en lo ya visto
  // (TILES). Si no está y hay red, lo trae y lo guarda; si no hay señal, ya está el país/región
  // del mapa base, así que el mapa NUNCA queda en blanco.
  if(/tile\.openstreetmap\.org|tile\.opentopomap\.org|basemaps\.cartocdn\.com/.test(url.hostname)){
    e.respondWith((async()=>{
      const base=await caches.open(BASE);
      const pre=await base.match(req); if(pre) return pre;      // mapa base de Colombia (offline)
      const c=await caches.open(TILES);
      const hit=await c.match(req); if(hit) return hit;          // zona ya vista
      try{ const res=await fetch(req); if(res&&res.ok) c.put(req,res.clone()); return res; }
      catch(err){ return hit||Response.error(); }
    })());
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
      // ignoreSearch: app.js?v=51 encuentra el app.js?v=45 ya guardado (es EL MISMO archivo).
      // Sin esto, al subir el número de versión y luego abrir SIN señal, el ?v nuevo no estaba
      // en caché → se caía al respaldo y servía el index.html COMO SI FUERA app.js → el script
      // reventaba, boot() no corría y la app se quedaba girando ("Está tardando"). Este es el fix.
      const cached = await caches.match(req, {ignoreSearch:true});
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
      // Sin copia guardada: dependemos de la red. Si tampoco hay señal, SOLO una navegación
      // (abrir la página) puede caer al index guardado; para un JS/CSS JAMÁS devolvemos el HTML,
      // porque servir index.html como si fuera app.js rompe el script y cuelga toda la app.
      const res = await net;
      if(res) return res;
      if(req.mode==='navigate') return (await caches.match('./index.html')) || Response.error();
      return Response.error();
    })());
    return;
  }

  // Otros estáticos mismo-origen (leaflet, íconos): cache-first con refresco en 2º plano.
  // ignoreSearch por lo mismo: un ?v nuevo reutiliza el archivo ya guardado (funciona sin señal).
  e.respondWith(caches.match(req,{ignoreSearch:true}).then(hit=>{
    const net=fetch(req).then(res=>{ if(res&&res.ok&&url.origin===location.origin){ caches.open(APP).then(c=>c.put(req,res.clone())); } return res; }).catch(()=>hit);
    return hit||net;
  }));
});
