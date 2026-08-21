'use strict';
/* ================= Red de Ayuda · Terremoto Colombia ================= */
const API = 'https://n8n.angelautomatizacionesn8n.xyz/webhook/ayuda-api';
const SUG_API = 'https://n8n.angelautomatizacionesn8n.xyz/webhook/ayuda-sugerencia';
const GEO_API = 'https://n8n.angelautomatizacionesn8n.xyz/webhook/ayuda-geo';
const LS = {
  puntos:'ay_puntos', entregas:'ay_entregas', fuentes:'ay_fuentes',
  aportes:'ay_aportes', desaparecidos:'ay_desap', avistamientos:'ay_avist',
  queue:'ay_queue', user:'ay_user', entidad:'ay_entidad'
};
const ITEMS = ['Agua','Comida','Colchones','Cobijas','Pañales','Medicina','Ropa','Aseo','Carpas','Rescatistas'];

const state = { puntos:[], entregas:[], fuentes:[], aportes:[], desaparecidos:[], avistamientos:[], queue:[], online:navigator.onLine, map:null, markers:null, myPos:null, myPlace:null, fotos:{}, _mk:[],
  // FILTROS DEL MAPA: para que no se sature. Cada categoría se puede ocultar; 'item' filtra por lo que se necesita.
  filtros:{ puntos:true, acopios:true, entregas:true, item:'' } };

/* ---------- util ---------- */
const $ = s => document.querySelector(s);
/* Guardado a PRUEBA DE FALLOS. Algunos navegadores (el de Facebook/Instagram, o Safari en
   modo privado) BLOQUEAN localStorage y hacen que setItem/getItem LANCEN error. Antes eso
   reventaba app.js en la primera línea que guardaba (deviceId) y la app quedaba muerta / en
   blanco. Ahora NADA de storage puede tumbar la app: si el navegador lo bloquea, usamos una
   memoria temporal en RAM (la sesión funciona igual; solo no recuerda al cerrar). */
const _mem = {};
const cache = (k,v)=>{
  if(v===undefined){
    try{ const s=localStorage.getItem(k); return s==null ? (k in _mem?_mem[k]:null) : JSON.parse(s); }
    catch(e){ return (k in _mem)?_mem[k]:null; }
  }
  _mem[k]=v;
  try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){ /* storage bloqueado/lleno: queda en RAM, la app no se cae */ }
};
const uid = ()=> 'tmp_'+Date.now()+'_'+Math.random().toString(36).slice(2,7);

/* ---------- identidad anónima del dispositivo (sin registro, sin barreras) ----------
   La 1ª vez se crea un token secreto y queda guardado en el teléfono. Nadie más lo
   conoce. Sirve para que SOLO quien avisó/creó un reporte pueda marcarlo, cambiarlo o
   borrarlo. Un "gracioso" no ve esos botones en lo ajeno, así que no puede dañar nada. */
function deviceId(){
  let d = cache('ay_device');
  if(!d){
    d = (window.crypto&&crypto.randomUUID) ? crypto.randomUUID()
        : 'dev_'+Date.now()+'_'+Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2);
    cache('ay_device', d);
  }
  return d;
}
const ME = deviceId();
/* Modo operador: YA NO hay ninguna clave escrita dentro de la app. La anterior estaba a
   la vista de cualquiera que abriera el codigo y desbloqueaba moderar todo. Ahora modera
   quien entra en "Modo entidades" con un codigo de tipo operador o alcaldia, y es la
   BASE DE DATOS la que comprueba ese permiso en cada accion. */
(function(){
  const h = location.hash||'';
  if(h.indexOf('op')>=0){ try{localStorage.removeItem('ay_admin');}catch(e){} history.replaceState(null,'',location.pathname); }
})();
function isAdmin(){ const e=cache(LS.entidad); return !!(e && e.codigo && (e.tipo==='operador' || e.tipo==='alcaldia')); }
/* ¿Este reporte lo puedo tocar? Sí si es mío, si soy operador, o si es un registro
   viejo que aún no tiene dueño (para no congelar lo creado antes de esta versión). */
function mine(rec){ return isAdmin() || !rec || !rec.owner || rec.owner===ME; }
/* ¿este reporte lo creó ESTE mismo dispositivo? → se muestra de PRIMERO y con distintivo,
   para que quien lo creó lo encuentre al instante y pueda actualizar su estado. */
function esMio(rec){ return !!(rec && rec.owner && rec.owner===ME); }
/* comparador reusable: lo mío arriba (para ordenar cada lista con lo propio de primero) */
function mioFirst(a,b){ return (esMio(b)?1:0)-(esMio(a)?1:0); }
/* registros visibles = los NO archivados (nada se borra de la base; solo se oculta) */
function vivos(table){ return (state[table]||[]).filter(r=>!r.archivado); }
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.remove('hidden'); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.add('hidden'),2600); }

async function enviarSugerencia(){
  const ta=$('#sug-text'), ci=$('#sug-contacto'), btn=$('#sug-enviar');
  const texto=(ta.value||'').trim();
  if(texto.length<4){ toast('Escribe tu idea primero 🙂'); ta.focus(); return; }
  btn.disabled=true; const antes=btn.textContent; btn.textContent='Enviando…';
  try{
    const r=await fetch(SUG_API,{ method:'POST', headers:{'Content-Type':'text/plain'},
      body: JSON.stringify({ texto, contacto:(ci.value||'').trim(), device: ME }) });
    if(!r.ok) throw new Error('http '+r.status);
    ta.value=''; ci.value='';
    const ok=$('#sug-ok'); if(ok) ok.classList.remove('hidden');
    toast('¡Gracias! Tu sugerencia fue enviada 💛');
  }catch(e){
    toast('No se pudo enviar. Revisa tu internet e inténtalo otra vez.');
  }finally{ btn.disabled=false; btn.textContent=antes; }
}
function esc(s){ return (s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

/* distancia en km entre dos coordenadas (haversine) — para ordenar por cercanía */
function distKm(a,b){
  if(!a||!b) return null;
  const R=6371, dLa=(b[0]-a[0])*Math.PI/180, dLo=(b[1]-a[1])*Math.PI/180;
  const la1=a[0]*Math.PI/180, la2=b[0]*Math.PI/180;
  const x=Math.sin(dLa/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLo/2)**2;
  return 2*R*Math.asin(Math.sqrt(x));
}
function fmtKm(d){ if(d==null) return ''; return d<1 ? Math.round(d*1000)+' m' : (d<10?d.toFixed(1):Math.round(d))+' km'; }
/* Link a Google Maps con NAVEGACIÓN (Cómo llegar) hasta un punto exacto. Abre la app de mapas del celular.
   travelmode=driving evita el "no hay ruta a pie" en distancias largas (ej. Popayán→Chocó). */
function mapsDir(lat,lng){ return 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination='+(+lat)+','+(+lng); }
/* Geocodificar OFFLINE: busca en el gazetteer de 1.122 municipios de Colombia (gazetteer.js, va
   precargado en el service worker → funciona SIN señal). Devuelve la cabecera del municipio que
   coincida con lo escrito. Es lo que hace que el buscador SÍ sirva sin internet: alguien en Chocó
   escribe "San José del Palmar" y el mapa vuela ahí aunque no cargue Nominatim. */
function norml(s){ return (s||'').toLowerCase().normalize('NFD').replace(new RegExp('['+String.fromCharCode(0x300)+'-'+String.fromCharCode(0x36f)+']','g'),'').trim(); }
function geoLocal(q){
  const nq=norml(q); if(nq.length<2) return [];
  const M=self.MUNICIPIOS||[]; const ex=[], pre=[], inc=[];
  for(const r of M){ const nn=norml(r[0]);
    if(nn===nq) ex.push(r); else if(nn.startsWith(nq)) pre.push(r); else if(nn.includes(nq)) inc.push(r); }
  return ex.concat(pre,inc).slice(0,6).map(r=>({lat:r[2],lng:r[3],label:r[0]+', '+r[1],local:true}));
}
/* Geocodificar ONLINE (con señal) — complementa al gazetteer offline con direcciones exactas.
   1) PRIMERO Google Geocoding vía webhook n8n `ayuda-geo` (la llave vive escondida en el servidor,
      no en el navegador). Google SÍ tiene la numeración de casas y entiende el formato colombiano
      "Cr 22 # 2A-109" que OSM/Nominatim falla. `near` = centro del mapa (lat,lng) para sesgar la
      búsqueda hacia donde el usuario está mirando (así "carrera 22 #2-109" cae en su ciudad).
   2) RESPALDO: OSM Nominatim (gratis, sin llave) si el webhook no responde o no encuentra. */
async function geocode(q, near){
  q=(q||'').trim(); if(q.length<3) return [];
  try{
    let u=GEO_API+'?q='+encodeURIComponent(q);
    if(near) u+='&near='+encodeURIComponent(near);
    const r=await fetch(u);
    if(r.ok){ const j=await r.json();
      if(j&&Array.isArray(j.hits)&&j.hits.length) return j.hits.map(h=>({lat:+h.lat,lng:+h.lng,label:h.label,aprox:h.aprox})); }
  }catch(e){ /* sin señal o webhook caído → cae al respaldo */ }
  const url='https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&countrycodes=co&accept-language=es&q='+encodeURIComponent(q);
  try{
    const r=await fetch(url,{headers:{'Accept':'application/json'}});
    if(!r.ok) return [];
    const j=await r.json();
    return (j||[]).map(x=>({lat:+x.lat,lng:+x.lon,label:x.display_name}));
  }catch(e){ return []; }
}
/* puntaje de URGENCIA: rescate y vidas primero, luego criticidad, semáforo, faltantes y gente */
function urgScore(p){
  let s=0;
  if(p.necesita_rescate) s+=1000;
  if(p.urgencia==='critica') s+=400; else if(p.urgencia==='alta') s+=200;
  const c=color(p);
  if(c==='rojo') s+=100; else if(c==='ambar') s+=40;
  s+=Math.min((p.faltan||[]).length*12, 72);
  s+=Math.min((p.personas||0),300)/10;
  return s;
}
const URG_LABEL={critica:'🔴 Crítico',alta:'🟠 Urgente',normal:'Normal'};

/* ================= CONFIANZA (idea de Angel) =================
   DOS ejes independientes del semáforo (rojo/verde = qué falta):
   1) ANCLAS: zonas urbanas con instituciones (hospital, alcaldía, Cruz Roja, bomberos,
      policía, universidades). Un punto que NACE dentro del radio de un ancla arranca con
      más confianza ("cerca de zona segura"). Van EN EL CÓDIGO para funcionar SIN internet.
   2) VOTOS de la comunidad: cada dispositivo puede marcar un lugar "confío 👍" o "dudoso 👎"
      (1 voto por lugar). El saldo sube o baja la confianza; los muy dudosos se bajan y se
      atenúan (no se borran: borrar por votos es manipulable). El voto está TOPADO (±4) para
      que nadie infle/hunda un punto votando en masa, y el ancla pesa por encima del ruido. */
const ANCLAS = [
  {n:'Casco urbano de Popayán', t:'ciudad', lat:2.4448, lng:-76.6060, r:3.5},
  {n:'Casco urbano de Cali', t:'ciudad', lat:3.4372, lng:-76.5225, r:6},
  {n:'Casco urbano de Palmira', t:'ciudad', lat:3.5297, lng:-76.3036, r:3},
  {n:'Casco urbano de Jamundí', t:'ciudad', lat:3.2608, lng:-76.5386, r:3},
  {n:'Casco urbano de Buenaventura', t:'ciudad', lat:3.8801, lng:-77.0313, r:4},
  {n:'Casco urbano de Quibdó', t:'ciudad', lat:5.6919, lng:-76.6583, r:4},
  {n:'Casco urbano de Istmina', t:'ciudad', lat:5.1596, lng:-76.6849, r:2.5},
  {n:'Casco urbano de Tumaco', t:'ciudad', lat:1.7930, lng:-78.8140, r:3},
  {n:'Casco urbano de Pasto', t:'ciudad', lat:1.2136, lng:-77.2811, r:4},
  {n:'Casco urbano de Santander de Quilichao', t:'ciudad', lat:3.0097, lng:-76.4848, r:3},
  {n:'Casco urbano de Timbío', t:'ciudad', lat:2.3540, lng:-76.6850, r:2.5},
  {n:'Casco urbano de Piendamó', t:'ciudad', lat:2.6398, lng:-76.5333, r:2.5},
  {n:'Casco urbano de El Tambo (Cauca)', t:'ciudad', lat:2.4520, lng:-76.8110, r:2.5},
  {n:'Casco urbano de Silvia', t:'ciudad', lat:2.6120, lng:-76.3800, r:2.5},
  {n:'Casco urbano de Guapi', t:'ciudad', lat:2.5710, lng:-77.8870, r:2.5}
];
/* ancla más cercana cuyo radio cubre esa ubicación (o null) */
function anclaCerca(lat,lng){
  if(lat==null||lng==null) return null;
  let best=null, bd=1e9;
  for(const a of ANCLAS){ const d=distKm([+lat,+lng],[a.lat,a.lng]); if(d!=null && d<=a.r && d<bd){ bd=d; best=a; } }
  return best;
}
/* ancla de un punto: la guardada al crearlo, o la calculada en vivo (para los puntos viejos
   creados antes de esta versión, que se benefician al instante sin migrar la base). */
function anclaDe(p){
  if(!p) return null;
  if(p._anc!==undefined) return p._anc;
  let a=null;
  if(p.cerca_ancla && p.ancla_nombre) a={n:p.ancla_nombre, t:p.ancla_tipo||'ciudad'};
  else { const x=anclaCerca(p.lat,p.lng); if(x) a={n:x.n, t:x.t}; }
  return (p._anc=a);
}
/* puntaje de confianza = base por ancla + saldo de votos (topado ±4) */
function trustScore(p){
  const c=(+p.votos_confia||0), d=(+p.votos_duda||0);
  const base = anclaDe(p)?2:0;
  return base + Math.max(-4, Math.min(4, c-d));
}
/* nivel visible (independiente del semáforo): alta / media / baja */
function trustLevel(p){
  const c=(+p.votos_confia||0), d=(+p.votos_duda||0), net=c-d, s=trustScore(p);
  if(d>=3 && net<=-3) return {k:'baja', txt:'Dudoso', ico:'⚠️', col:'#dc2626'};
  if(s>=3) return {k:'alta', txt:'Confiable', ico:'🛡️', col:'#16a34a'};
  return {k:'media', txt:'Sin confirmar', ico:'•', col:'#94a3b8'};
}
/* % para la barrita de confianza (5–100) */
function trustPct(p){ return Math.max(5, Math.min(100, Math.round(50 + trustScore(p)*12))); }
/* comparador: los lugares marcados "Dudoso" por la comunidad van al final de la lista
   (bajándolos, como pidió Angel) — nunca se borran, solo se hunden y se atenúan. */
function dudoRank(x,y){ return (trustLevel(x).k==='baja'?1:0)-(trustLevel(y).k==='baja'?1:0); }
/* ¿este dispositivo ya votó este lugar? devuelve 'confia'|'duda'|null */
function yaVote(id){ return cache('ay_voto_'+id)||null; }
/* Votar un lugar: 1 voto por dispositivo. Suma al contador del punto (optimista/offline)
   y deja un registro de auditoría en ayuda_votos (índice único punto+device en la base). */
async function votar(id, valor){
  const prev=yaVote(id);
  if(prev){ toast(prev===valor?'Ya diste tu opinión aquí 🙂':'Ya votaste este lugar; no se puede cambiar.'); return; }
  const p=state.puntos.find(x=>String(x.id)===String(id)); if(!p) return;
  cache('ay_voto_'+id, valor);                                  // dedupe local inmediato
  const campo = valor==='confia' ? 'votos_confia' : 'votos_duda';
  const nuevo = (+p[campo]||0)+1;
  // auditoría en la base (no bloquea; si falla por doble voto o sin señal, no importa)
  // El conteo lo hace la BASE DE DATOS, que recuenta los votos reales. El navegador ya
  // NO manda el numero: asi nadie puede inflar la confianza de un punto desde afuera.
  p[campo]=nuevo; cache(LS.puntos, state.puntos); renderAll();   // +1 optimista, se ve al instante
  try{
    const rv = await api('votar','puntos',{ id:String(id), valor });
    if(Array.isArray(rv) && rv[0]){
      p.votos_confia = +rv[0].votos_confia||0; p.votos_duda = +rv[0].votos_duda||0;
      cache(LS.puntos, state.puntos); renderAll();
    }
  }catch(e){}                        // contador + re-render
  toast(valor==='confia' ? '¡Gracias! Marcaste este lugar como confiable 👍' : 'Gracias, lo marcaste como dudoso 👀');
}
/* bloque de confianza para la tarjeta de un lugar */
function trustBlock(p){
  const lvl=trustLevel(p), anc=anclaDe(p), yo=yaVote(p.id), pct=trustPct(p);
  const votos = esMio(p)
    ? `<span class="trust-count">👍 ${(+p.votos_confia||0)} · 👎 ${(+p.votos_duda||0)}</span>`
    : `<button class="tv confia${yo==='confia'?' on':''}" data-voto="confia:${p.id}">👍 Confío${(+p.votos_confia)?' · '+p.votos_confia:''}</button>
       <button class="tv duda${yo==='duda'?' on':''}" data-voto="duda:${p.id}">👎 Dudoso${(+p.votos_duda)?' · '+p.votos_duda:''}</button>`;
  return `<div class="trust ${lvl.k}">
    <div class="trust-top"><span class="trust-badge" style="color:${lvl.col}">${lvl.ico} ${lvl.txt}</span>
    ${anc?`<span class="trust-ancla">📍 ${esc(anc.n)}</span>`:''}</div>
    <div class="trust-meter"><i style="width:${pct}%;background:${lvl.col}"></i></div>
    <div class="trust-votes">${votos}</div>
  </div>`;
}

/* ---------- backend ---------- */
async function api(action, table, extra={}){
  // owner/device viajan SIEMPRE: el servidor los usa para comprobar que quien edita o
  // borra un registro es su autor. Sin esto, cualquiera podria tocar lo de los demas.
  const body = Object.assign({action, table, owner: ME, device: ME}, extra);
  const r = await fetch(API, { method:'POST', headers:{'Content-Type':'text/plain'}, body: JSON.stringify(body) });
  if(!r.ok) throw new Error('http '+r.status);
  const txt = await r.text();
  try { return JSON.parse(txt); } catch(e){ throw new Error('respuesta inválida'); }
}

async function pull(table){
  const rows = await api('list', table);
  if(Array.isArray(rows)){
    // NO perder lo que aún no llegó al servidor: conservamos los registros locales
    // pendientes (creados/editados sin señal) que el servidor todavía no tiene.
    const prev = state[table]||[];
    const srvIds = new Set(rows.map(r=>String(r.id)));
    const pendientes = prev.filter(r => r && (r._pending || String(r.id).startsWith('tmp_')) && !srvIds.has(String(r.id)));
    state[table] = pendientes.concat(rows);
    cache(LS[table], state[table]);
  }
  return state[table];
}

async function pullAll(){
  try{ setNet(); }catch(e){}
  const tablas = ['puntos','entregas','fuentes','aportes','desaparecidos','avistamientos'];
  // Cada tabla se trae POR SEPARADO. Si una falla, NO se toca a las demás y
  // NUNCA se borra lo que ya estaba: pull() solo reemplaza cuando llega un array
  // válido del servidor; ante error conserva lo que había (cache/pendientes).
  // Esto es lo que evita que la app muestre 0 aunque los datos SÍ estén guardados.
  const res = await Promise.allSettled(tablas.map(pull));
  const ok = res.filter(r=>r.status==='fulfilled').length;
  try{ setNet(ok>0, vivos('puntos').length); }catch(e){}   // hay señal si al menos una tabla respondió
  try{ renderAll(); }catch(e){ console.warn('render', e); } // que un error de pintado nunca frene la carga de datos
}

/* Escritura offline-first: intenta enviar; si falla, encola y aplica local */
async function save(table, data){
  const rec = Object.assign({ id: uid(), created_at:new Date().toISOString(), _pending:true }, data);
  try {
    const res = await api('insert', table, { data });
    if(Array.isArray(res) && res[0]){
      // guarda la foto en memoria (el listado ya no la trae; así el autor la sigue viendo)
      if(data && (data.foto||data.comprobante)) state.fotos[res[0].id]=data.foto||data.comprobante;
      // no dejamos la foto base64 pesando en el cache local
      const light=Object.assign({}, res[0]); delete light.foto; delete light.comprobante;
      state[table].unshift(light); cache(LS[table], state[table]);
      renderAll(); return true;
    }
    throw new Error('sin respuesta');
  } catch(e){
    state[table].unshift(rec); cache(LS[table], state[table]);
    enqueue({op:'insert', table, data, __id:rec.id});
    renderAll(); toast('Guardado sin señal · se enviará solo');
    return true;
  }
}

async function update(table, id, data){
  try {
    const res = await api('update', table, { id, data });
    const row = Array.isArray(res)&&res[0] ? res[0] : null;
    const i = state[table].findIndex(x=>x.id===id);
    if(i>=0){ state[table][i] = row || Object.assign({}, state[table][i], data); cache(LS[table], state[table]); }
    renderAll(); return true;
  } catch(e){
    const i = state[table].findIndex(x=>x.id===id);
    if(i>=0){ state[table][i]=Object.assign({}, state[table][i], data, {_pending:true}); cache(LS[table], state[table]); }
    if(!String(id).startsWith('tmp_')) enqueue({op:'update', table, id, data});
    renderAll(); toast('Guardado sin señal · se enviará solo');
    return true;
  }
}

/* "Borrar" NO destruye nada: archiva el registro (queda SIEMPRE en la base de datos,
   recuperable por el operador) y solo lo oculta de las listas y el mapa. Así ningún
   punto se pierde jamás, aunque alguien toque el botón de borrar. */
async function del(table, id){
  const i = state[table].findIndex(x=>x.id===id);
  if(i>=0){ state[table][i]=Object.assign({}, state[table][i], {archivado:true}); cache(LS[table], state[table]); renderAll(); }
  if(String(id).startsWith('tmp_')){
    // aún no llegó al servidor: marca su inserción pendiente como archivada
    state.queue.forEach(j=>{ if(j.op==='insert'&&j.table===table&&j.__id===id&&j.data){ j.data.archivado=true; } });
    cache(LS.queue,state.queue); return;
  }
  const rec0 = state[table].find(x=>String(x.id)===String(id));
  if(rec0 && rec0.owner && rec0.owner!==ME && isAdmin()){
    // Moderacion: la base exige un codigo de operador aprobado. Archiva, nunca destruye.
    const ent0=cache(LS.entidad);
    try{ await api('moderar', table, {id, codigo:ent0.codigo, modo:'archivar'}); }
    catch(err){ toast('No se pudo ocultar. Revisa tu internet.'); }
    return;
  }
  update(table, id, {archivado:true});   // persiste el archivado (offline-safe, se reintenta)
}

function enqueue(job){ state.queue.push(job); cache(LS.queue, state.queue); updatePending(); }

async function flush(){
  if(!state.queue.length) return true;
  if(!navigator.onLine) return false;
  const rest=[];
  for(const job of state.queue){
    try{
      if(job.op==='insert'){
        const res = await api('insert', job.table, {data:job.data});
        const row = Array.isArray(res)&&res[0] ? res[0] : null;
        // RECONCILIAR: reemplaza el registro TEMPORAL (tmp_, creado sin señal) por el REAL
        // que devuelve el servidor. Sin esto, al volver la conexión quedaban DOS copias
        // (el temporal ⏳ y el real de pullAll) → se veía duplicado.
        if(row){
          const arr = state[job.table]||[];
          if(job.data && (job.data.foto||job.data.comprobante)) state.fotos[row.id]=job.data.foto||job.data.comprobante;
          const light=Object.assign({}, row); delete light.foto; delete light.comprobante;
          const i = arr.findIndex(x=>String(x.id)===String(job.__id));
          if(i>=0) arr[i]=light; else arr.unshift(light);
          state[job.table]=arr; cache(LS[job.table], arr);
        }
      }
      else if(job.op==='update') await api('update', job.table, {id:job.id, data:job.data});
      else if(job.op==='delete') await api('delete', job.table, {id:job.id});
    }catch(e){ rest.push(job); }
  }
  state.queue=rest; cache(LS.queue, state.queue); updatePending(); renderAll();
  if(rest.length===0){ toast('Todo sincronizado ✓'); await pullAll(); return true; }
  return false;
}

function updatePending(){
  const n = state.queue.length;
  const info = $('#pending-info');
  if(info) info.textContent = n ? ('Pendiente por enviar: '+n) : 'Todo sincronizado ✓';
}

/* ---------- contador de visitantes en vivo ----------
   Registra ESTE dispositivo (ME) en el servidor y trae cuántos hay VIENDO la app ahora
   (activos en los últimos 3 min) y cuántos la han ABIERTO en total. Una sola llamada
   (RPC ayuda_ping). Sirve para saber de verdad si la gente ya está usando la app. */
const LIVE = { ahora:null, total:null };
const PUBLIC_AT = 100;   // el contador de visitantes se vuelve PÚBLICO al llegar a 100 dispositivos distintos
function livePublic(){ return LIVE.total!=null && LIVE.total>=PUBLIC_AT; }
async function pingLive(){
  try{
    const r = await api('ping', null, { device: ME });
    if(r && typeof r==='object'){
      if(typeof r.ahora==='number') LIVE.ahora=r.ahora;
      if(typeof r.total==='number') LIVE.total=r.total;
      renderLive();
    }
  }catch(e){ /* sin señal: el contador simplemente no se actualiza, no molesta */ }
}
function renderLive(){
  const card=$('#stats-card');
  const pub=livePublic();
  // El contador se registra siempre en el servidor (para poder medir), pero la VISTA
  // permanece oculta hasta que 100 dispositivos distintos hayan abierto la app.
  if(card) card.style.display = pub ? '' : 'none';
  if(pub){
    const a=$('#stat-ahora'), t=$('#stat-total');
    if(a) a.textContent = LIVE.ahora!=null ? LIVE.ahora : '—';
    if(t) t.textContent = LIVE.total!=null ? LIVE.total : '—';
  }
  // refresca la píldora del mapa para incluir "N viendo ahora"
  if(_lastNet.ok!==undefined) setNet(_lastNet.ok, _lastNet.total);
}

/* ---------- estado de red ---------- */
let _lastNet = { ok:undefined, total:undefined };
function setNet(ok, total){
  const el=$('#netstatus'), lab=$('#netlabel');
  if(ok!==undefined) _lastNet={ok, total};   // recuerda el último estado para re-pintar con el contador
  if(!el || !lab) return;   // NUNCA reventar si el indicador no está en el HTML (esto rompía la lectura del servidor)
  if(ok===undefined){ el.className='net'; lab.textContent='conectando…'; return; }
  el.className = 'net '+(ok?'on':'off');
  let txt = ok ? ('En vivo'+(total!=null?' · '+total+' lugares':'')) : 'Sin señal';
  if(ok && livePublic() && LIVE.ahora!=null) txt += ' · 👀 '+LIVE.ahora+' viendo';
  lab.textContent = txt;
}

/* ---------- semáforo ---------- */
function color(p){
  if(p.necesita_rescate) return 'rescate';
  if(p.estado==='cubierto') return 'verde';
  const faltan=(p.faltan||[]).length, sobran=(p.sobran||[]).length;
  if(faltan===0) return 'verde';
  if(sobran>0) return 'ambar';
  return 'rojo';
}
const LABELS={rojo:'Necesita ayuda',ambar:'Ayuda a medias',verde:'Ya tiene ayuda',rescate:'Faltan rescatistas'};

/* ---------- pregunta simple in-app (reemplaza prompt/confirm del navegador) ---------- */
function askText(title, msg, placeholder, cb){
  const m=$('#ask'), inp=$('#ask-input');
  $('#ask-title').textContent=title;
  $('#ask-msg').textContent=msg||''; $('#ask-msg').style.display=msg?'block':'none';
  inp.style.display='block'; inp.value=''; inp.placeholder=placeholder||'';
  $('#ask-ok').textContent='Aceptar';
  m.classList.remove('hidden'); setTimeout(()=>inp.focus(),120);
  $('#ask-ok').onclick=()=>{ m.classList.add('hidden'); cb(inp.value.trim()); };
  $('#ask-cancel').onclick=()=>{ m.classList.add('hidden'); };
  m.onclick=e=>{ if(e.target.id==='ask') m.classList.add('hidden'); };
}
function askConfirm(title, msg, cb){
  const m=$('#ask'), inp=$('#ask-input');
  $('#ask-title').textContent=title;
  $('#ask-msg').textContent=msg||''; $('#ask-msg').style.display=msg?'block':'none';
  inp.style.display='none';
  $('#ask-ok').textContent='Sí, eliminar';
  m.classList.remove('hidden');
  $('#ask-ok').onclick=()=>{ m.classList.add('hidden'); cb(true); };
  $('#ask-cancel').onclick=()=>{ m.classList.add('hidden'); };
  m.onclick=e=>{ if(e.target.id==='ask') m.classList.add('hidden'); };
}

/* ================= MODO OPERATIVO · ENTIDADES (Fase 1) =================
   Capa ENCIMA del mapa ciudadano para entidades de respuesta (ambulancias, bomberos,
   Cruz Roja, Defensa Civil, policía, alcaldías, hospitales). El ciudadano sigue reportando
   igual y SIN registro; lo que exige REGISTRO Y APROBACIÓN es cambiar el "estado de atención"
   de un punto (sin atender → voy en camino → resuelto). Así dos unidades no van al mismo sitio
   y se ve un tablero de lo crítico. La autorización se valida EN LA BASE (RPC ayuda_atender):
   el navegador solo manda el código; si la entidad no está aprobada, la base lo rechaza. */
const ENT_API = 'https://n8n.angelautomatizacionesn8n.xyz/webhook/ayuda-entidad';
const TIPOS_ENT = [['ambulancia','🚑 Ambulancia'],['bomberos','🚒 Bomberos'],['cruz_roja','➕ Cruz Roja'],['defensa_civil','🛟 Defensa Civil'],['policia','👮 Policía'],['ejercito','🎖️ Ejército'],['hospital','🏥 Hospital / Salud'],['alcaldia','🏛️ Alcaldía / Gobierno'],['otro','🤝 Otra entidad']];
const TIPO_LBL = Object.fromEntries(TIPOS_ENT.map(([k,v])=>[k,v]));
let entOpen=false;
function entidad(){ return cache(LS.entidad)||null; }
function esEntidad(){ const e=entidad(); return !!(e&&e.codigo); }
/* estado de atención legible (para TODOS: badge en la tarjeta y en el mapa) */
const ATN = { en_camino:{txt:'Atendiendo',ico:'🚑',col:'#2563eb'}, resuelto:{txt:'Resuelto',ico:'✅',col:'#16a34a'} };
/* "bomberos · Nombre" (lo que guarda la base) → "🚒 Nombre" (ya escapado para HTML) */
function nomEnt(s){ const i=String(s||'').indexOf(' · '); if(i<0) return esc(s); const t=String(s).slice(0,i), n=String(s).slice(i+3); const emoji=(TIPO_LBL[t]||'').split(' ')[0]||''; return esc((emoji?emoji+' ':'')+n); }
function atnBadge(p){ const a=p.atencion; if(!a||a==='sin_atender') return ''; const s=ATN[a]; if(!s) return ''; return `<span class="atn-badge" style="background:${s.col}">${s.ico} ${s.txt}${p.atendido_nombre?': '+nomEnt(p.atendido_nombre):''}</span>`; }
/* controles de atención en la tarjeta (SOLO para entidades logueadas) */
function atnCtrls(p){
  if(!esEntidad()) return '';
  const a=p.atencion||'sin_atender'; let b='';
  if(a==='sin_atender') b=`<button class="btn-mini atn go" data-atender="en_camino:${p.id}">🚑 Voy en camino</button><button class="btn-mini atn done" data-atender="resuelto:${p.id}">✅ Resuelto</button>`;
  else if(a==='en_camino') b=`<button class="btn-mini atn done" data-atender="resuelto:${p.id}">✅ Marcar resuelto</button><button class="btn-mini atn" data-atender="sin_atender:${p.id}">↩︎ Liberar</button>`;
  else b=`<button class="btn-mini atn" data-atender="sin_atender:${p.id}">↩︎ Reabrir</button>`;
  return `<div class="atn-ctrls">${b}</div>`;
}
/* bloque de atención dentro del popup del mapa (onclick inline → atender() es global) */
function atnPopup(p){
  const a=p.atencion||'sin_atender'; let s='';
  if(a!=='sin_atender' && ATN[a]) s+=`<br><span style="color:${ATN[a].col}"><b>${ATN[a].ico} ${ATN[a].txt}</b>${p.atendido_nombre?': '+nomEnt(p.atendido_nombre):''}</span>`;
  if(esEntidad()){
    if(a==='sin_atender') s+=`<br><button class="popup-atn" onclick="atender('${p.id}','en_camino')">🚑 Voy</button> <button class="popup-atn done" onclick="atender('${p.id}','resuelto')">✅ Resuelto</button>`;
    else if(a==='en_camino') s+=`<br><button class="popup-atn done" onclick="atender('${p.id}','resuelto')">✅ Resuelto</button> <button class="popup-atn" onclick="atender('${p.id}','sin_atender')">↩︎ Liberar</button>`;
    else s+=`<br><button class="popup-atn" onclick="atender('${p.id}','sin_atender')">↩︎ Reabrir</button>`;
  }
  return s;
}
/* Cambiar el estado de atención de un punto. La base exige entidad APROBADA (por su código);
   si no lo está, devuelve error y no cambia nada. No se encola offline: es una acción de
   coordinación que necesita confirmación del servidor. */
async function atender(id, estado, forzar){
  const e=entidad(); if(!e||!e.codigo){ toast('Entra como entidad primero'); openEntidad(); return; }
  const p=state.puntos.find(x=>String(x.id)===String(id)); if(!p) return;
  try{
    const res=await api('atender', null, { codigo:e.codigo, id, estado, forzar: forzar===true });
    // La base avisa si OTRA entidad ya tomo ese punto, en vez de pisarla en silencio.
    if(res && res.message && String(res.message).indexOf('ocupado|')===0){
      const q=String(res.message).split('|');
      const quien=String(q[1]||'otra entidad').replace(' - ',' · ').replace(/_/g,' ');
      askConfirm('Ese punto ya lo tomo otra entidad',
        quien+' lo marco como "voy en camino" el '+(q[2]||'')+'. Si tu tambien vas, quedara a tu nombre y se guardara que lo tomaste despues.',
        ()=>atender(id, estado, true));
      return;
    }
    if(Array.isArray(res) && res[0]){
      Object.assign(p,{atencion:res[0].atencion, atendido_por:res[0].atendido_por, atendido_nombre:res[0].atendido_nombre, atendido_at:res[0].atendido_at});
      cache(LS.puntos, state.puntos); renderAll(); if(entOpen) renderEntidad();
      toast(estado==='resuelto'?'Marcado como resuelto ✅':estado==='en_camino'?'Vas en camino 🚑 · los demás ya lo ven':'Punto liberado');
    } else { toast('Tu entidad no está aprobada aún, o el código no es válido.'); }
  }catch(err){ toast('No se pudo (revisa tu internet). El estado no cambió.'); }
}

function openEntidad(){ entOpen=true; renderEntidad(); const el=$('#entidad'); if(el) el.classList.remove('hidden'); }
function closeEntidad(){ entOpen=false; const el=$('#entidad'); if(el) el.classList.add('hidden'); }
function salirEntidad(){ cache(LS.entidad,null); try{localStorage.removeItem(LS.entidad);}catch(e){} renderEntidad(); renderAll(); toast('Saliste del modo entidad'); }
/* Cambiar el codigo de acceso: la base genera uno nuevo y el anterior deja de servir al
   instante. Sirve cuando el codigo se compartio de mas o alguien salio de la entidad. */
async function rotarCodigoEntidad(){
  const e=entidad(); if(!e||!e.codigo) return;
  askConfirm('¿Cambiar el código de acceso?','El código actual dejará de funcionar de inmediato. Tendrás que darle el nuevo a tu equipo.',async()=>{
    try{
      const r=await api('entidad_rotar', null, {codigo:e.codigo});
      const row=Array.isArray(r)&&r[0]?r[0]:null;
      if(row&&row.codigo){
        cache(LS.entidad, Object.assign({}, e, {codigo:row.codigo}));
        renderEntidad();
        askConfirm('Tu código nuevo es '+row.codigo,'Anótalo ahora. El anterior ya no sirve.',()=>{});
      } else { toast('No se pudo cambiar el código.'); }
    }catch(err){ toast('No se pudo cambiar el código. Revisa tu internet.'); }
  });
}

function entFormsHTML(){
  const guard = cache('ay_ent_cod');
  return `
  <div class="ent-intro">
    <h2>🚑 Modo entidades</h2>
    <p>Para ambulancias, bomberos, Cruz Roja, Defensa Civil, policía, alcaldías y hospitales. Coordinen la respuesta sobre el MISMO mapa: marca qué punto vas a atender (para que dos unidades no vayan al mismo sitio) y mira el tablero de lo crítico.</p>
    <p class="ent-note">🔒 Solo entidades <b>registradas y aprobadas</b> pueden cambiar el estado de atención. El registro lo revisa el equipo antes de activarlo.</p>
  </div>
  <div class="ent-tabs">
    <button class="ent-tab active" data-et="login">Ya tengo código</button>
    <button class="ent-tab" data-et="reg">Registrar mi entidad</button>
  </div>
  <div class="ent-pane" id="ent-pane-login">
    <label>Código de acceso (6 dígitos)</label>
    <input id="ent-cod" inputmode="numeric" maxlength="6" placeholder="Ej: 482913" value="${guard?esc(guard):''}">
    <button class="btn-primary" id="ent-login-go">Entrar</button>
    <p class="ent-hint" id="ent-login-msg">${guard?'Tienes un código guardado en este equipo. Si ya lo aprobaron, toca Entrar.':''}</p>
  </div>
  <div class="ent-pane hidden" id="ent-pane-reg">
    <label>Nombre de la entidad *</label>
    <input id="er-nombre" placeholder="Ej: Bomberos Voluntarios de Popayán">
    <label>Tipo *</label>
    <select id="er-tipo">${TIPOS_ENT.map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select>
    <label>Ciudad</label>
    <input id="er-ciudad" placeholder="Ej: Popayán">
    <label>Responsable / contacto</label>
    <input id="er-resp" placeholder="Nombre de quien coordina">
    <label>Teléfono / WhatsApp</label>
    <input id="er-tel" inputmode="tel" placeholder="Ej: 300 000 0000">
    <label>Correo</label>
    <input id="er-email" type="email" placeholder="correo@entidad.gov.co">
    <button class="btn-primary" id="ent-reg-go">Enviar registro</button>
    <div class="ent-ok hidden" id="ent-reg-ok"></div>
  </div>`;
}
function tabRow(p){
  const c=color(p);
  return `<div class="tab-row ${c}">
    <div class="tr-main"><b>${esc(p.nombre)}</b><span>${esc([p.municipio,p.departamento].filter(Boolean).join(', '))} · ${p.personas||0} pers.</span></div>
    <div class="tr-act"><button class="btn-mini" data-vermapa2="${p.id}">📍 Mapa</button><button class="btn-mini atn go" data-atender="en_camino:${p.id}">🚑 Voy</button></div>
  </div>`;
}
function tableroHTML(e){
  const ps=vivos('puntos');
  const isCrit=p=>p.necesita_rescate||p.urgencia==='critica'||color(p)==='rojo'||color(p)==='rescate';
  const sin=ps.filter(p=>!p.atencion||p.atencion==='sin_atender');
  const cam=ps.filter(p=>p.atencion==='en_camino');
  const res=ps.filter(p=>p.atencion==='resuelto');
  const critSin=sin.filter(isCrit);
  const mios=cam.filter(p=>p.atendido_por && p.atendido_por===e.id);
  const byM={}; sin.forEach(p=>{ const m=[p.municipio,p.departamento].filter(Boolean).join(', ')||'Sin ubicación'; byM[m]=(byM[m]||0)+1; });
  const topM=Object.entries(byM).sort((a,b)=>b[1]-a[1]).slice(0,6);
  return `
  <div class="ent-head">
    <div><h2>${esc(TIPO_LBL[e.tipo]||'Entidad')}</h2><p class="ent-sub">${esc(e.nombre)}${e.ciudad?' · '+esc(e.ciudad):''}</p></div>
    <div class="ent-head-btns"><button class="btn-sec" id="ent-rotar" title="Genera un código nuevo y anula el actual">🔑 Cambiar código</button><button class="btn-sec" id="ent-salir">Salir</button></div>
  </div>
  <div class="tab-grid">
    <div class="tab-cell crit"><b>${critSin.length}</b><small>críticos sin atender</small></div>
    <div class="tab-cell"><b>${sin.length}</b><small>sin atender</small></div>
    <div class="tab-cell cam"><b>${cam.length}</b><small>en atención</small></div>
    <div class="tab-cell done"><b>${res.length}</b><small>resueltos</small></div>
  </div>
  ${mios.length?`<div class="ent-mine">🚑 Tu entidad va en camino a <b>${mios.length}</b> punto${mios.length!==1?'s':''}.</div>`:''}
  <h3 class="ent-h3">🚨 Críticos sin atender</h3>
  <div class="ent-list">${critSin.length?critSin.sort((a,b)=>urgScore(b)-urgScore(a)).slice(0,12).map(tabRow).join(''):'<div class="empty">Nada crítico sin atender ahora mismo. 🙌</div>'}</div>
  <h3 class="ent-h3">📍 Dónde se concentra lo pendiente</h3>
  <div class="ent-munis">${topM.length?topM.map(([m,n])=>`<div class="muni-row"><span>${esc(m)}</span><b>${n}</b></div>`).join(''):'<div class="empty">—</div>'}</div>`;
}
function renderEntidad(){
  const body=$('#ent-body'); if(!body) return;
  const e=entidad();
  body.innerHTML = (e&&e.codigo) ? tableroHTML(e) : entFormsHTML();
  wireEntidad(body);
}
function wireEntidad(body){
  body.querySelectorAll('.ent-tab').forEach(t=>t.onclick=()=>{
    body.querySelectorAll('.ent-tab').forEach(x=>x.classList.toggle('active',x===t));
    const pl=body.querySelector('#ent-pane-login'), pr=body.querySelector('#ent-pane-reg');
    if(pl) pl.classList.toggle('hidden',t.dataset.et!=='login');
    if(pr) pr.classList.toggle('hidden',t.dataset.et!=='reg');
  });
  const lg=body.querySelector('#ent-login-go'); if(lg) lg.onclick=loginEntidad;
  const rg=body.querySelector('#ent-reg-go'); if(rg) rg.onclick=registrarEntidad;
  const sl=body.querySelector('#ent-salir'); if(sl) sl.onclick=salirEntidad;
  const rt=body.querySelector('#ent-rotar'); if(rt) rt.onclick=rotarCodigoEntidad;
  body.querySelectorAll('[data-atender]').forEach(b=>b.onclick=()=>{ const s=b.dataset.atender,i=s.indexOf(':'); atender(s.slice(i+1),s.slice(0,i)); });
  body.querySelectorAll('[data-vermapa2]').forEach(b=>b.onclick=()=>{ const p=state.puntos.find(x=>String(x.id)===String(b.dataset.vermapa2)); closeEntidad(); if(p&&p.lat!=null){ go('mapa'); userMoved=true; setTimeout(()=>state.map&&state.map.setView([p.lat,p.lng],15),300);} });
}
async function loginEntidad(){
  const inp=$('#ent-cod'), msg=$('#ent-login-msg'); if(!inp) return;
  const cod=(inp.value||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);
  if(cod.length<6){ if(msg) msg.textContent='Escribe tu código de acceso completo.'; return; }
  if(msg) msg.textContent='Verificando…';
  try{
    const res=await api('entidad_login', null, {codigo:cod});
    const row=Array.isArray(res)&&res[0]?res[0]:null;
    if(row && row.estado==='bloqueado'){ if(msg) msg.textContent='🔒 Demasiados intentos fallidos desde este dispositivo. Espera 10 minutos y vuelve a intentarlo.'; return; }
    if(!row){ if(msg) msg.textContent='❌ Código no válido. Revisa que esté bien escrito.'; return; }
    if(row.estado==='pendiente'){ if(msg) msg.textContent='⏳ Tu registro está EN REVISIÓN. Te avisamos apenas se apruebe.'; return; }
    if(row.estado!=='aprobada'){ if(msg) msg.textContent='Este acceso no está activo. Escríbenos si crees que es un error.'; return; }
    cache(LS.entidad, {id:row.id, nombre:row.nombre, tipo:row.tipo, ciudad:row.ciudad, responsable:row.responsable, codigo:cod});
    renderEntidad(); renderAll(); toast('¡Entraste como '+row.nombre+'! 🚑');
  }catch(e){ if(msg) msg.textContent='No se pudo verificar. Revisa tu internet.'; }
}
async function registrarEntidad(){
  const g=id=>{ const el=$(id); return el?(el.value||'').trim():''; };
  const nombre=g('#er-nombre'), tipo=($('#er-tipo')?$('#er-tipo').value:'otro'), ciudad=g('#er-ciudad'),
        responsable=g('#er-resp'), telefono=g('#er-tel'), email=g('#er-email');
  const ok=$('#ent-reg-ok'), btn=$('#ent-reg-go');
  if(nombre.length<3){ toast('Escribe el nombre de la entidad'); return; }
  if(!telefono && !email){ toast('Deja un teléfono o un correo de contacto'); return; }
  if(btn){ btn.disabled=true; var antes=btn.textContent; btn.textContent='Enviando…'; }
  try{
    const r=await fetch(ENT_API,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({nombre,tipo,ciudad,responsable,telefono,email})});
    const j=await r.json();
    if(j&&j.ok&&j.codigo){
      cache('ay_ent_cod', j.codigo);
      if(ok){ ok.classList.remove('hidden'); ok.innerHTML=`✅ <b>Registro enviado.</b><br>Tu código de acceso es:<br><span class="ent-code">${esc(j.codigo)}</span><br>Guárdalo bien. Tu entidad quedó <b>en revisión</b>; cuando la aprobemos, entra con ese código en “Ya tengo código”.`; }
      const n=$('#er-nombre'); if(n) n.value='';
    } else { toast('No se pudo registrar. Inténtalo de nuevo.'); }
  }catch(e){ toast('No se pudo enviar. Revisa tu internet.'); }
  finally{ if(btn){ btn.disabled=false; btn.textContent=antes; } }
}
/* banner discreto arriba de "Lugares" cuando estás en modo entidad */
function updateEntBanner(){
  const b=$('#ent-banner'); if(!b) return;
  const e=entidad();
  if(e&&e.codigo){ b.classList.remove('hidden'); b.innerHTML=`<span>🚑 Entidad: <b>${esc(e.nombre)}</b></span><button class="btn-mini" id="eb-open">Ver tablero</button>`; const o=$('#eb-open'); if(o) o.onclick=openEntidad; }
  else b.classList.add('hidden');
}

/* ================= RENDER ================= */
function renderAll(){ renderPuntos(); renderMap(); renderEntregas(); renderFuentes(); renderAportes(); renderDesaparecidos(); updatePending(); updateEntBanner(); }

let filtroDepto='__all';
let ordenPuntos='urgencia';   // 'urgencia' | 'cercania'
function renderPuntos(){
  const cont=$('#lista-puntos');
  const puntos=vivos('puntos');
  const deptos=[...new Set(puntos.map(p=>p.departamento).filter(Boolean))].sort();
  const fc=$('#filtros-depto');
  // el filtro por departamento solo tiene sentido (y solo se muestra) en modo "Por zona"
  const verFiltros = ordenPuntos==='zona';
  fc.style.display = verFiltros ? 'flex' : 'none';
  if(verFiltros){
    fc.innerHTML = ['__all',...deptos].map(d=>`<button class="chip ${filtroDepto===d?'active':''}" data-depto="${esc(d)}">${d==='__all'?'Todos':esc(d)}</button>`).join('');
    fc.querySelectorAll('.chip').forEach(b=>b.onclick=()=>{filtroDepto=b.dataset.depto;renderPuntos();});
  } else {
    filtroDepto='__all';   // sin filtro fuera de "Por zona"
  }

  let list = puntos.slice();
  if(filtroDepto!=='__all') list=list.filter(p=>p.departamento===filtroDepto);

  const r=list.filter(p=>color(p)==='rojo'||color(p)==='rescate').length;
  const a=list.filter(p=>color(p)==='ambar').length;
  const g=list.filter(p=>color(p)==='verde').length;
  $('#resumen-balance').innerHTML =
    `<div class="stat r"><b>${r}</b><small>necesitan</small></div>
     <div class="stat a"><b>${a}</b><small>parciales</small></div>
     <div class="stat g"><b>${g}</b><small>cubiertos</small></div>`;

  // Aviso del modo "Cerca": deja CLARO dónde te ubica la app y que ordena por distancia real a ti
  // (así no parece que "te pone en Valle del Cauca" cuando en realidad solo no hay puntos cerca).
  const nn=$('#near-note');
  if(nn){
    if(ordenPuntos==='cercania'){
      nn.classList.remove('hidden');
      if(!state.myPos){
        nn.innerHTML='📍 Buscando tu ubicación… permite el GPS para ordenar por lo más cercano a ti.';
      } else {
        const dists=list.filter(p=>p.lat!=null).map(p=>distKm(state.myPos,[p.lat,p.lng]));
        const min=dists.length?Math.min(...dists):null;
        const donde=state.myPlace?('Estás en <b>'+esc(state.myPlace)+'</b>'):'Usando tu ubicación actual';
        nn.innerHTML='📍 '+donde+' · ordenado por lo más cercano a ti'+
          (min!=null?(min>60?'. No hay puntos muy cerca; el más cercano está <b>a '+fmtKm(min)+'</b>.':'. El más cercano está <b>a '+fmtKm(min)+'</b>.'):'.');
      }
    } else {
      nn.classList.add('hidden');
    }
  }

  if(!list.length){ cont.innerHTML='<div class="empty">Todavía no hay lugares anotados.<br>Toca el botón verde “＋ Avisar qué falta”.</div>'; return; }

  // dibuja una tarjeta de lugar (se reusa en los 3 modos: urgencia, cercanía y por zona)
  const cardPunto=p=>{
    const c=color(p);
    const dist = (state.myPos && p.lat!=null) ? distKm(state.myPos,[p.lat,p.lng]) : null;
    const falta=(p.faltan||[]).map(t=>`<span class="tag falta">− ${esc(t)}</span>`).join('');
    const sobra=(p.sobran||[]).map(t=>`<span class="tag sobra">+ ${esc(t)}</span>`).join('');
    const dudoso=trustLevel(p).k==='baja';
    return `<div class="card ${c}${dudoso?' dudoso':''}">
      <span class="badge ${c==='ambar'?'rojo':c}">${LABELS[c]}</span>
      ${esMio(p)?'<span class="badge tuyo">✍️ Tú lo creaste</span>':''}
      ${p.urgencia&&p.urgencia!=='normal'?`<span class="badge urg">${URG_LABEL[p.urgencia]}</span>`:''}
      ${atnBadge(p)}
      <h3>${esc(p.nombre)}${p._pending?' ⏳':''}</h3>
      <div class="meta">${esc([p.municipio,p.departamento].filter(Boolean).join(', '))} · ${p.personas||0} personas${dist!=null?' · <b>a '+fmtKm(dist)+'</b>':''}</div>
      ${p.necesita_rescate?'<div class="tag falta" style="display:inline-block">🚨 Faltan rescatistas</div>':''}
      <div class="tags">${falta}${sobra||(!falta?'<span class="tag plain">sin detalle</span>':'')}</div>
      ${p.nota?`<div class="meta" style="margin-top:8px">“${esc(p.nota)}”</div>`:''}
      ${fotoSlot('puntos',p.id,p.foto,p.tiene_foto)}
      ${trustBlock(p)}
      ${atnCtrls(p)}
      <div class="card-actions">
        <button class="btn-mini acc" data-vermapa="${p.id}">📍 Ver en el mapa</button>
        ${mine(p)?`
        ${p.estado!=='cubierto'?`<button class="btn-mini ok" data-cubierto="${p.id}">✔ Ya tiene ayuda</button>`:`<button class="btn-mini" data-reabrir="${p.id}">Todavía necesita</button>`}
        <button class="btn-mini" data-editp="${p.id}">✏️ Cambiar qué necesita</button>
        <button class="btn-mini" data-del="${p.id}">🗑 Borrar</button>`
        :`<span class="only-owner">Solo quien avisó este lugar puede cambiarlo</span>`}
      </div>
    </div>`;
  };

  if(ordenPuntos==='zona'){
    // POR ZONA: agrupa por Departamento → Ciudad/Municipio para deslizar y ver todo por región.
    const SIN_D='Sin departamento', SIN_M='Sin ciudad';
    const groups={};
    list.forEach(p=>{
      const d=((p.departamento||'').trim())||SIN_D;
      const m=((p.municipio||'').trim())||SIN_M;
      (groups[d]=groups[d]||{}); (groups[d][m]=groups[d][m]||[]).push(p);
    });
    const cmp=(a,b)=>{ if(a===SIN_D||a===SIN_M)return 1; if(b===SIN_D||b===SIN_M)return -1; return a.localeCompare(b,'es'); };
    const deptos=Object.keys(groups).sort(cmp);
    cont.innerHTML = deptos.map(d=>{
      const munis=groups[d];
      const todos=Object.keys(munis).reduce((a,m)=>a.concat(munis[m]),[]);
      const need=todos.filter(p=>color(p)==='rojo'||color(p)==='rescate').length;
      const muniNames=Object.keys(munis).sort(cmp);
      return `<div class="zona-depto">
        <div class="zona-h">📍 ${esc(d)}<span class="zona-count">${todos.length} lugar${todos.length!==1?'es':''}${need?' · '+need+' necesita'+(need!==1?'n':''):''}</span></div>
        ${muniNames.map(m=>`<div class="zona-muni">${esc(m)}</div>`+
          munis[m].sort((x,y)=>mioFirst(x,y)||dudoRank(x,y)||urgScore(y)-urgScore(x)).map(cardPunto).join('')).join('')}
      </div>`;
    }).join('');
  } else {
    // ORDEN INTELIGENTE: por urgencia (rescate/vidas primero) o por cercanía a tu ubicación
    if(ordenPuntos==='cercania' && state.myPos){
      list.sort((x,y)=>{
        const m=mioFirst(x,y); if(m) return m;      // lo tuyo de primero
        const dd=dudoRank(x,y); if(dd) return dd;    // los dudosos, al final
        const dx=x.lat!=null?distKm(state.myPos,[x.lat,x.lng]):1e9;
        const dy=y.lat!=null?distKm(state.myPos,[y.lat,y.lng]):1e9;
        return dx-dy;
      });
    } else {
      list.sort((x,y)=>mioFirst(x,y)||dudoRank(x,y)||urgScore(y)-urgScore(x));  // tuyo, luego confiables, luego urgencia
    }
    cont.innerHTML = list.map(cardPunto).join('');
  }
  cont.querySelectorAll('[data-cubierto]').forEach(b=>b.onclick=()=>update('puntos',b.dataset.cubierto,{estado:'cubierto'}));
  cont.querySelectorAll('[data-reabrir]').forEach(b=>b.onclick=()=>update('puntos',b.dataset.reabrir,{estado:'activo'}));
  cont.querySelectorAll('[data-editp]').forEach(b=>b.onclick=()=>{const p=state.puntos.find(x=>x.id==b.dataset.editp);if(p)openForm('punto',p,p.id);});
  cont.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>askConfirm('¿Ocultar este lugar?','Se quita de la lista y del mapa, pero queda guardado (no se pierde). Se puede recuperar.',()=>del('puntos',b.dataset.del)));
  cont.querySelectorAll('[data-vermapa]').forEach(b=>b.onclick=()=>{const p=state.puntos.find(x=>x.id==b.dataset.vermapa);if(p&&p.lat!=null){go('mapa');userMoved=true;setTimeout(()=>{state.map&&state.map.setView([p.lat,p.lng],15);},300);}else toast('Ese punto no tiene ubicación');});
  cont.querySelectorAll('[data-voto]').forEach(b=>b.onclick=()=>{ const i=b.dataset.voto.indexOf(':'); votar(b.dataset.voto.slice(i+1), b.dataset.voto.slice(0,i)); });
  cont.querySelectorAll('[data-atender]').forEach(b=>b.onclick=()=>{ const s=b.dataset.atender,i=s.indexOf(':'); atender(s.slice(i+1), s.slice(0,i)); });
  wireFotos(cont);
}

/* Foto/comprobante: el listado ya NO trae las fotos base64 (eran enormes y tumbaban
   la carga). Se muestran bajo demanda: al tocar "Ver foto" se pide esa sola imagen. */
function fotoSlot(table,id,inline,has){
  const src = inline || state.fotos[id];
  if(src) return `<img class="card-photo" src="${src}" alt="" loading="lazy">`;
  if(!has) return '';                               // sin foto → no mostramos nada (limpio)
  const lbl = table==='aportes' ? '📷 Ver comprobante' : '📷 Ver foto';
  return `<div class="foto-slot"><button class="btn-mini" data-verfoto="${table}:${id}">${lbl}</button></div>`;
}
function wireFotos(cont){
  cont.querySelectorAll('[data-verfoto]').forEach(b=>b.onclick=async()=>{
    const [table,id]=b.dataset.verfoto.split(':');
    const old=b.textContent; b.textContent='Cargando…'; b.disabled=true;
    try{
      const res=await api('foto',table,{id});
      const row=Array.isArray(res)&&res[0]?res[0]:null;
      const src=row&&(row.foto||row.comprobante);
      if(src){ state.fotos[id]=src; renderAll(); }
      else { b.textContent='Sin foto'; }
    }catch(e){ b.textContent=old; b.disabled=false; toast('No se pudo cargar la foto'); }
  });
}

function renderEntregas(){
  const cont=$('#lista-entregas');
  const entregas=vivos('entregas');
  if(!entregas.length){ cont.innerHTML='<div class="empty">Todavía no hay entregas anotadas.<br>Toca el botón verde “＋ Anotar una entrega”.</div>'; return; }
  entregas.sort((a,b)=>mioFirst(a,b)||(new Date(b.created_at)-new Date(a.created_at)));  // lo tuyo arriba, luego lo más nuevo
  cont.innerHTML = entregas.map(e=>`
    <div class="card ${e.recibido?'verde':'ambar'}">
      <span class="badge ${e.recibido?'verde':'rojo'}">${e.recibido?'Recibido':'En camino'}</span>
      ${esMio(e)?'<span class="badge tuyo">✍️ Tú lo creaste</span>':''}
      <h3>${esc(e.lugar||'Entrega')}${e._pending?' ⏳':''}</h3>
      <div class="meta">${esc(e.quien_entrego||'—')} · ${new Date(e.created_at).toLocaleDateString('es-CO',{day:'numeric',month:'short'})}</div>
      ${fotoSlot('entregas',e.id,e.foto,e.tiene_foto)}
      <div class="tags"><span class="tag plain">${esc(e.items||'ayuda')}</span></div>
      ${e.recibido&&e.recibido_por?`<div class="meta" style="margin-top:8px">Recibido por: ${esc(e.recibido_por)}</div>`:''}
      <div class="card-actions">
        ${mine(e)?`
        ${!e.recibido?`<button class="btn-mini ok" data-recibido="${e.id}">✔ Ya llegó</button>`:''}
        <button class="btn-mini" data-dele="${e.id}">🗑 Borrar</button>`
        :`<span class="only-owner">Solo quien la anotó puede cambiarla</span>`}
      </div>
    </div>`).join('');
  cont.querySelectorAll('[data-recibido]').forEach(b=>b.onclick=()=>{
    askText('¿Ya llegó la ayuda?','¿Quién la recibió? (nombre de la persona o el lugar)','Ej: Doña Marta / Escuela La Capilla',v=>{
      update('entregas',b.dataset.recibido,{recibido:true, recibido_por:v||'confirmado'});
    });
  });
  cont.querySelectorAll('[data-dele]').forEach(b=>b.onclick=()=>askConfirm('¿Eliminar esta entrega?','',()=>del('entregas',b.dataset.dele)));
  wireFotos(cont);
}

let segDonar='fuentes';
function hoyISO(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function acopioCerrado(f){ return f && f.tipo==='recoleccion' && f.fecha_limite && String(f.fecha_limite).slice(0,10) < hoyISO(); }
function fmtFechaCorta(s){ try{ const p=String(s).slice(0,10).split('-'); return new Date(+p[0],+p[1]-1,+p[2]).toLocaleDateString('es-CO',{day:'numeric',month:'long'}); }catch(e){ return s; } }
function renderFuentes(){
  const cont=$('#lista-fuentes');
  const fuentes=vivos('fuentes');
  if(!fuentes.length){ cont.innerHTML='<div class="empty">Todavía no hay cuentas ni puntos.<br>Toca “＋ Agregar una cuenta” para empezar.</div>'; return; }
  // lo tuyo de primero; luego acopios (donar cosas) y por último las cuentas
  fuentes.sort((a,b)=>mioFirst(a,b)||((a.tipo==='recoleccion'?0:1)-(b.tipo==='recoleccion'?0:1)));
  cont.innerHTML = fuentes.map(f=>{
    const aportes=vivos('aportes').filter(a=>a.fuente_id===f.id);
    const conf=aportes.filter(a=>a.estado==='confirmado').length;
    const acopio=f.tipo==='recoleccion';
    const nec=(f.necesita||[]);
    const dist=(state.myPos&&f.lat!=null)?distKm(state.myPos,[f.lat,f.lng]):null;
    return `<div class="card ${acopio?'acopio':(f.verificada?'verde':'')}">
      <span class="badge ${acopio?'acopio':(f.verificada?'verde':'rojo')}">${acopio?'🏬 Centro de acopio':(f.verificada?'Verificada':'Sin verificar')}</span>
      ${esMio(f)?'<span class="badge tuyo">✍️ Tú lo creaste</span>':''}
      ${acopio&&acopioCerrado(f)?'<span class="badge rojo">Cerrado</span>':''}
      <h3>${esc(f.nombre)}${f._pending?' ⏳':''}</h3>
      <div class="meta">${acopio?'Donar cosas (ropa, comida, colchones…)':'🏦 Cuenta bancaria'}${f.destino?' · 🚚 va a '+esc(f.destino):''}${dist!=null?' · <b>a '+fmtKm(dist)+'</b>':''}</div>
      ${acopio&&nec.length&&!acopioCerrado(f)?`<div class="tags" style="margin-top:8px"><b style="font-size:.92em;color:#7c3aed;margin-right:4px">Necesitan:</b>${nec.map(t=>`<span class="tag falta">− ${esc(t)}</span>`).join('')}</div>`:''}
      ${acopio&&f.fecha_limite?`<div class="meta" style="margin-top:6px;color:${acopioCerrado(f)?'#b91c1c':'#7c3aed'}"><b>${acopioCerrado(f)?'⏰ Cerrado — venció el ':'⏰ Recibe hasta el '}${fmtFechaCorta(f.fecha_limite)}</b></div>`:''}
      ${acopio&&f.direccion?`<div class="meta" style="margin-top:6px">📍 Llevar a: ${esc(f.direccion)}</div>`:''}
      ${f.numero_cuenta?`<div class="acct"><span>${esc(f.banco?f.banco+' ':'')}${esc(f.numero_cuenta)}</span><button class="btn-mini" data-copy="${esc(f.numero_cuenta)}">Copiar</button></div>`:''}
      ${f.titular?`<div class="meta" style="margin-top:6px">Titular: ${esc(f.titular)}</div>`:''}
      ${f.contacto?`<div class="meta">Contacto: ${esc(f.contacto)}</div>`:''}
      ${!acopio?`<div class="meta" style="margin-top:6px">${aportes.length} donación(es) · ${conf} confirmada(s)</div>`:''}
      <div class="card-actions">
        ${acopio&&f.lat!=null?`<button class="btn-mini acc" data-verfuente="${f.id}">📍 Ver en el mapa</button>`:''}
        ${!acopio?`<button class="btn-mini acc" data-aportar="${f.id}">Anoté una donación</button>`:''}
        ${mine(f)?`${!f.verificada&&!acopio?`<button class="btn-mini ok" data-verificar="${f.id}">Marcar de confianza</button>`:''}
        ${acopio?`<button class="btn-mini" data-editf="${f.id}">✏️ Cambiar</button>`:''}
        <button class="btn-mini" data-delf="${f.id}">🗑 Borrar</button>`:''}
      </div>
    </div>`;
  }).join('');
  cont.querySelectorAll('[data-verfuente]').forEach(b=>b.onclick=()=>{const f=state.fuentes.find(x=>x.id==b.dataset.verfuente);if(f&&f.lat!=null){go('mapa');userMoved=true;setTimeout(()=>{state.map&&state.map.setView([f.lat,f.lng],15);},300);}});
  cont.querySelectorAll('[data-editf]').forEach(b=>b.onclick=()=>{const f=state.fuentes.find(x=>x.id==b.dataset.editf);if(f)openForm('fuente',f,f.id);});
  cont.querySelectorAll('[data-copy]').forEach(b=>b.onclick=()=>{navigator.clipboard&&navigator.clipboard.writeText(b.dataset.copy);toast('Número copiado');});
  cont.querySelectorAll('[data-aportar]').forEach(b=>b.onclick=()=>openForm('aporte',{fuente_id:b.dataset.aportar}));
  cont.querySelectorAll('[data-verificar]').forEach(b=>b.onclick=()=>update('fuentes',b.dataset.verificar,{verificada:true}));
  cont.querySelectorAll('[data-delf]').forEach(b=>b.onclick=()=>askConfirm('¿Eliminar esta cuenta?','',()=>del('fuentes',b.dataset.delf)));
}

function renderAportes(){
  const cont=$('#lista-aportes');
  const aportes=vivos('aportes');
  if(!aportes.length){ cont.innerHTML='<div class="empty">Todavía no hay donaciones anotadas.</div>'; return; }
  aportes.sort((a,b)=>mioFirst(a,b)||(new Date(b.created_at)-new Date(a.created_at)));  // lo tuyo arriba, luego lo más nuevo
  cont.innerHTML = aportes.map(a=>{
    const f=state.fuentes.find(x=>x.id===a.fuente_id);
    return `<div class="card ${a.estado==='confirmado'?'verde':'ambar'}">
      <span class="badge ${a.estado==='confirmado'?'verde':'rojo'}">${a.estado==='confirmado'?'Confirmado ✓':'Reportado'}</span>
      ${esMio(a)?'<span class="badge tuyo">✍️ Tú lo creaste</span>':''}
      <h3>$ ${esc(a.monto||'—')}${a._pending?' ⏳':''}</h3>
      <div class="meta">${esc(a.quien||'Anónimo')}${f?' → '+esc(f.nombre):''} · ${new Date(a.created_at).toLocaleDateString('es-CO',{day:'numeric',month:'short'})}</div>
      ${fotoSlot('aportes',a.id,a.comprobante,a.tiene_foto)}
      <div class="card-actions">
        ${mine(a)&&a.estado!=='confirmado'?`<button class="btn-mini ok" data-confirmar="${a.id}">✔ El dinero llegó</button>`:''}
      </div>
    </div>`;
  }).join('');
  cont.querySelectorAll('[data-confirmar]').forEach(b=>b.onclick=()=>{
    askText('¿El dinero ya llegó?','¿Quién lo confirma? (nombre)','Ej: Tesorero de la colecta',v=>{
      update('aportes',b.dataset.confirmar,{estado:'confirmado', confirmado_por:v||'confirmado'});
    });
  });
  wireFotos(cont);
}

/* ================= PERSONAS DESAPARECIDAS ================= */
let filtroDesap='todos';       // todos | desaparecido | encontrado | fallecido
let qDesap='';                 // texto de búsqueda
const DESAP_BADGE={
  desaparecido:{cls:'rojo',  txt:'🔴 Buscándose'},
  encontrado:  {cls:'verde', txt:'🟢 Apareció con vida'},
  fallecido:   {cls:'gris',  txt:'🕯️ Falleció'}
};
function avistTxt(t){ return t==='visto'?'👁️ La vieron':(t==='encontrado'?'🟢 Reportan que apareció':(t==='fallecido'?'🕯️ Reportan fallecimiento':'ℹ️ Información')); }
function renderDesaparecidos(){
  const cont=$('#lista-desap'); if(!cont) return;
  let pers=vivos('desaparecidos');
  // resumen (siempre sobre el total, no sobre el filtro)
  const nBusc=pers.filter(p=>(p.estado||'desaparecido')==='desaparecido').length;
  const nEnc=pers.filter(p=>p.estado==='encontrado').length;
  const nFall=pers.filter(p=>p.estado==='fallecido').length;
  const res=$('#resumen-desap');
  if(res) res.innerHTML=`<div class="stat"><b>${pers.length}</b><small>personas</small></div><div class="stat r"><b>${nBusc}</b><small>buscándose</small></div><div class="stat g"><b>${nEnc}</b><small>aparecieron</small></div>`+(nFall?`<div class="stat"><b>${nFall}</b><small>fallecidos</small></div>`:'');
  // filtro por estado
  if(filtroDesap!=='todos') pers=pers.filter(p=>(p.estado||'desaparecido')===filtroDesap);
  // búsqueda por texto
  const q=(qDesap||'').trim().toLowerCase();
  if(q) pers=pers.filter(p=>[p.nombre,p.municipio,p.departamento,p.descripcion].filter(Boolean).join(' ').toLowerCase().includes(q));
  // orden: lo mío primero, luego los que ya aparecieron/fallecieron abajo, luego alfabético
  pers.sort((a,b)=>mioFirst(a,b)||((a.estado&&a.estado!=='desaparecido'?1:0)-(b.estado&&b.estado!=='desaparecido'?1:0))||String(a.nombre||'').localeCompare(String(b.nombre||''),'es'));
  if(!pers.length){ cont.innerHTML='<div class="empty">'+(q||filtroDesap!=='todos'?'No hay personas con ese filtro o búsqueda.':'Todavía no hay personas reportadas.')+'</div>'; return; }
  const avistDe=id=>vivos('avistamientos').filter(a=>a.desaparecido_id===id).sort((x,y)=>new Date(y.created_at)-new Date(x.created_at));
  cont.innerHTML=pers.map(p=>{
    const est=p.estado||'desaparecido';
    const bd=DESAP_BADGE[est]||DESAP_BADGE.desaparecido;
    const lugar=[p.municipio,p.departamento].filter(Boolean).join(', ');
    const avs=avistDe(p.id);
    // reportes SIN confirmar de que apareció/falleció (aviso suave, no cambia el estado oficial)
    const claim=avs.find(a=>a.tipo==='encontrado')?'encontrado':(avs.find(a=>a.tipo==='fallecido')?'fallecido':null);
    const avHtml=avs.length?`<div class="avlist">${avs.map(a=>`<div class="av"><span class="avt">${avistTxt(a.tipo)}</span> ${esc(a.descripcion||'')}${a.lugar?` · 📍 ${esc(a.lugar)}`:''}${a.contacto?` · ☎ ${esc(a.contacto)}`:''}<span class="avd">${new Date(a.created_at).toLocaleDateString('es-CO',{day:'numeric',month:'short'})}</span></div>`).join('')}</div>`:'';
    return `<div class="card desap ${est}">
      <span class="badge ${bd.cls}">${bd.txt}</span>
      ${p.verificada?'<span class="badge azul">✔ Lista oficial</span>':''}
      ${esMio(p)?'<span class="badge tuyo">✍️ Tú lo reportaste</span>':''}
      <h3>${esc(p.nombre)}${p._pending?' ⏳':''}</h3>
      ${lugar?`<div class="meta">📍 Desapareció en: ${esc(lugar)}</div>`:''}
      ${p.edad||p.sexo?`<div class="meta">${[p.edad?('Edad: '+esc(p.edad)):'',p.sexo?esc(p.sexo):''].filter(Boolean).join(' · ')}</div>`:''}
      ${p.descripcion?`<div class="meta" style="margin-top:6px">${esc(p.descripcion)}</div>`:''}
      ${p.contacto?`<div class="meta">☎ Contacto familia: ${esc(p.contacto)}</div>`:''}
      ${fotoSlot('desaparecidos',p.id,p.foto,p.tiene_foto)}
      ${est==='desaparecido'&&claim==='encontrado'?'<div class="claim verde">🟢 Alguien reporta que ya apareció (sin confirmar). Ver abajo.</div>':''}
      ${est==='desaparecido'&&claim==='fallecido'?'<div class="claim gris">🕯️ Alguien reporta un fallecimiento (sin confirmar). Ver abajo.</div>':''}
      ${avHtml}
      <div class="card-actions">
        <button class="btn-mini acc" data-avistar="${p.id}">👁️ Lo vi / tengo info</button>
        ${mine(p)?`
        ${est!=='encontrado'?`<button class="btn-mini ok" data-desest="${p.id}:encontrado">✅ Confirmar: apareció</button>`:''}
        ${est!=='desaparecido'?`<button class="btn-mini" data-desest="${p.id}:desaparecido">↩ Sigue buscándose</button>`:''}
        <button class="btn-mini" data-editdesap="${p.id}">✏️ Editar</button>
        <button class="btn-mini" data-deldesap="${p.id}">🗑 Borrar</button>`:''}
      </div>
    </div>`;
  }).join('');
  cont.querySelectorAll('[data-avistar]').forEach(b=>b.onclick=()=>{
    const p=state.desaparecidos.find(x=>x.id==b.dataset.avistar);
    openForm('avistamiento',{desaparecido_id:b.dataset.avistar, _nombre:p?p.nombre:''});
  });
  cont.querySelectorAll('[data-desest]').forEach(b=>b.onclick=()=>{
    const [id,est]=b.dataset.desest.split(':');
    if(est==='encontrado') askConfirm('¿Confirmas que apareció con vida?','Se marcará como “Apareció con vida” para todos.',()=>update('desaparecidos',id,{estado:'encontrado'}));
    else update('desaparecidos',id,{estado:'desaparecido'});
  });
  cont.querySelectorAll('[data-editdesap]').forEach(b=>b.onclick=()=>{const p=state.desaparecidos.find(x=>x.id==b.dataset.editdesap);if(p)openForm('desaparecido',p,p.id);});
  cont.querySelectorAll('[data-deldesap]').forEach(b=>b.onclick=()=>askConfirm('¿Quitar esta persona de la lista?','',()=>del('desaparecidos',b.dataset.deldesap)));
  wireFotos(cont);
}

/* ================= MAPA ================= */
/* Marcador propio dibujado en SVG (NO usa imágenes externas de Leaflet → nunca sale el
   cuadrito con "?", y se ve nítido igual en iPhone y Android, online u offline). */
function pinIcon(fill, glyph){
  const g = glyph ? `<div class="pin-glyph">${glyph}</div>` : '';
  const html = `<div class="pin-wrap">
    <svg width="34" height="46" viewBox="0 0 34 46" xmlns="http://www.w3.org/2000/svg">
      <path d="M17 1C8.7 1 2 7.7 2 16c0 10.5 15 29 15 29s15-18.5 15-29C32 7.7 25.3 1 17 1z"
            fill="${fill}" stroke="#ffffff" stroke-width="2.5"/>
      <circle cx="17" cy="16" r="6" fill="#ffffff"/>
    </svg>${g}</div>`;
  return L.divIcon({ className:'pin-div', html, iconSize:[34,46], iconAnchor:[17,45], popupAnchor:[0,-40] });
}
let mapFitDone=false, userMoved=false, meMarker=null;
// Capa base: CARTO Voyager — se ve limpia y consistente en TODO el país (ciudad y campo),
// no como los tiles crudos de OSM que dejan las zonas rurales casi en blanco.
// updateWhenIdle:false + keepBuffer alto → los tiles se piden mientras se mueve y quedan
// pre-cargados alrededor, así el mapa se ve "ya cargado" y no en blanco/borroso.
function baseTiles(){
  // URLs DETERMINISTAS (un solo subdominio 'a', sin retina) → cada tile tiene UNA sola URL,
  // así el mapa base de Colombia precargado en el service worker (base-tiles.js) calza EXACTO
  // y se ve al instante aunque no haya señal. keepBuffer alto + tiles de bajo zoom precargados
  // → nunca queda en blanco: si falta el detalle de calle, se ve igual el país/región debajo.
  return L.tileLayer('https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',{
    subdomains:'a', maxZoom:20, detectRetina:false, crossOrigin:true,
    updateWhenIdle:false, updateWhenZooming:false, keepBuffer:8,
    attribution:'© OpenStreetMap · © CARTO'
  });
}
function initMap(){
  if(state.map) return;
  state.map = L.map('map',{zoomControl:true, tap:true}).setView([4.6,-74.1], 6); // Colombia
  baseTiles().addTo(state.map);
  state.markers = L.layerGroup().addTo(state.map);
  state.map.on('dragstart zoomstart', ()=>{ userMoved=true; });
  // Botones propios (ubicación / ver todos)
  const bl=$('#btn-locate'), bf=$('#btn-fitall'), ba=$('#btn-anclas');
  if(bl) bl.onclick=()=>locateMe(true);
  if(bf) bf.onclick=()=>{ userMoved=false; mapFitDone=false; fitToPoints(); };
  if(ba) ba.onclick=()=>{ state.showAnclas = (state.showAnclas===false); ba.classList.toggle('off', state.showAnclas===false); renderMap(); };
  wireFiltros();
  initMapSearch();
  // ubicar al usuario suave al abrir (sin forzar si ya movió)
  locateMe(false);
  renderMap();
}
// FILTROS DEL MAPA (para que no se sature): chips que muestran/ocultan cada tipo de punto y un
// selector para ver solo los que necesitan/piden un item (agua, pañales, etc.). Todo activo por defecto.
function wireFiltros(){
  const bar=document.getElementById('map-filtros'); if(!bar) return;
  bar.querySelectorAll('.mf-chip[data-f]').forEach(ch=>{
    const k=ch.dataset.f;
    ch.classList.toggle('active', state.filtros[k]!==false);
    ch.onclick=()=>{ state.filtros[k]=!(state.filtros[k]!==false); ch.classList.toggle('active', state.filtros[k]!==false); renderMap(); };
  });
  const sel=document.getElementById('map-item');
  if(sel && !sel.dataset.built){
    sel.dataset.built='1';
    sel.innerHTML='<option value="">Todo lo que falta</option>'+ITEMS.map(i=>'<option value="'+i+'">Solo: '+i+'</option>').join('');
    sel.onchange=()=>{ state.filtros.item=sel.value; bar.classList.toggle('filtrando', !!sel.value); renderMap(); };
  }
}
// Buscador del mapa: primero busca entre los lugares YA cargados (vuela a él y abre su ficha);
// si no hay ninguno que coincida, geocodifica el texto con Google (webhook n8n) y cae ahí.
let searchMarker=null;
function initMapSearch(){
  const q=document.getElementById('map-q'), res=document.getElementById('map-res');
  if(!q||!res) return;
  const norm=s=>(s||'').toLowerCase().normalize('NFD').replace(new RegExp('['+String.fromCharCode(0x300)+'-'+String.fromCharCode(0x36f)+']','g'),'');
  const run=async()=>{
    const term=q.value.trim(); if(term.length<2){ res.innerHTML=''; res.classList.remove('on'); return; }
    const nt=norm(term);
    const locales=(state._mk||[]).filter(x=>norm(x.nombre).includes(nt)||norm(x.muni).includes(nt)).slice(0,6);
    // MUNICIPIOS OFFLINE (gazetteer): siempre disponibles, no dependen de la señal.
    const munis=geoLocal(term);
    const renderLoc=()=>locales.map((x,i)=>'<button type="button" class="map-hit" data-loc="'+i+'">📍 <b>'+esc(x.nombre)+'</b><span>'+esc(x.muni)+'</span></button>').join('');
    const renderMuni=()=>(munis.length?'<div class="geo-hint">Municipios (funciona sin internet):</div>'+munis.map((h,i)=>'<button type="button" class="map-hit muni" data-muni="'+i+'">🏙️ '+esc(h.label)+'</button>').join(''):'');
    const wireLoc=()=>res.querySelectorAll('.map-hit[data-loc]').forEach(b=>b.onclick=()=>{ const x=locales[+b.dataset.loc]; userMoved=true; state.map.setView([x.lat,x.lng],16); if(x.m&&x.m.openPopup) x.m.openPopup(); closeSearch(); });
    const flyGeo=h=>{ userMoved=true; state.map.setView([h.lat,h.lng],h.local?13:16);
      if(searchMarker) state.map.removeLayer(searchMarker);
      searchMarker=L.marker([h.lat,h.lng],{icon:pinIcon('#111','🔎')}).addTo(state.map);
      searchMarker.bindPopup('<b>'+esc(h.label)+'</b><br><a href="'+mapsDir(h.lat,h.lng)+'" target="_blank" rel="noopener" class="popup-go">🧭 Cómo llegar</a>').openPopup();
      closeSearch(); };
    const wireMuni=()=>res.querySelectorAll('.map-hit.muni').forEach(b=>b.onclick=()=>flyGeo(munis[+b.dataset.muni]));
    let html=renderLoc()+renderMuni();
    res.innerHTML=html+'<div class="geo-hint">Buscando dirección exacta…</div>';
    res.classList.add('on');
    wireLoc(); wireMuni();
    const nearC = state.map ? (state.map.getCenter().lat+','+state.map.getCenter().lng) : (state.myPos?state.myPos.join(','):'');
    const hits=await geocode(term, nearC);
    const geo=hits.map((h,i)=>'<button type="button" class="map-hit geo" data-geo="'+i+'">🗺️ '+esc(h.label)+'</button>').join('');
    res.innerHTML=html+(geo?'<div class="geo-hint">Dirección exacta (con señal):</div>'+geo:(locales.length||munis.length?'':'<div class="geo-hint">No encontré ese lugar. Prueba con el municipio.</div>'));
    wireLoc(); wireMuni();
    res.querySelectorAll('.map-hit.geo').forEach(b=>b.onclick=()=>{ const h=hits[+b.dataset.geo]; userMoved=true; state.map.setView([h.lat,h.lng],16);
      if(searchMarker) state.map.removeLayer(searchMarker);
      searchMarker=L.marker([h.lat,h.lng],{icon:pinIcon('#111','🔎')}).addTo(state.map);
      searchMarker.bindPopup('<b>'+esc(h.label)+'</b><br><a href="'+mapsDir(h.lat,h.lng)+'" target="_blank" rel="noopener" class="popup-go">🧭 Cómo llegar</a>').openPopup();
      closeSearch(); });
  };
  const closeSearch=()=>{ res.classList.remove('on'); };
  let t=null;
  q.addEventListener('input',()=>{ clearTimeout(t); t=setTimeout(run,450); });
  q.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); clearTimeout(t); run(); } });
}
function locateMe(center){
  // IMPORTANTE: pedir el GPS NO depende de que el mapa esté abierto. Antes, si el usuario iba directo a
  // Lugares → "Cerca" sin abrir el Mapa, esto retornaba y nunca tomaba su ubicación → el orden por cercanía
  // no funcionaba. Ahora tomamos la ubicación siempre; el marcador azul se dibuja solo si el mapa existe.
  if(!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(p=>{
    state.myPos=[p.coords.latitude,p.coords.longitude];
    if(ordenPuntos==='cercania') renderPuntos();
    reverseGeo(state.myPos);            // averigua ciudad/departamento para el aviso de "Cerca"
    if(state.map){
      const ll=[p.coords.latitude,p.coords.longitude];
      if(meMarker) state.map.removeLayer(meMarker);
      meMarker=L.circleMarker(ll,{radius:8,color:'#fff',weight:3,fillColor:'#2563eb',fillOpacity:1}).addTo(state.map);
      meMarker.bindPopup('Estás aquí');
      if(center){ userMoved=true; state.map.setView(ll,14); }
    }
  }, ()=>{ if(center) toast('No se pudo obtener tu ubicación (permite el GPS)'); }, {enableHighAccuracy:true,timeout:8000,maximumAge:60000});
}
/* Reverse geocode: nombre legible (ciudad, departamento) de donde está el usuario, para el aviso de "Cerca". */
async function reverseGeo(ll){
  if(!ll) return;
  try{
    const r=await fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=es&zoom=10&lat='+ll[0]+'&lon='+ll[1],{headers:{'Accept':'application/json'}});
    const j=await r.json(); const a=j.address||{};
    const city=a.city||a.town||a.village||a.municipality||a.county||'';
    const dep=a.state||'';
    const label=[city,dep].filter(Boolean).join(', ');
    if(label){ state.myPlace=label; if(ordenPuntos==='cercania') renderPuntos(); }
  }catch(e){}
}
function fitToPoints(){
  if(!state.map) return;
  const pts=[];
  vivos('puntos').forEach(p=>{ if(p.lat!=null&&p.lng!=null) pts.push([p.lat,p.lng]); });
  vivos('entregas').forEach(e=>{ if(e.lat!=null&&e.lng!=null) pts.push([e.lat,e.lng]); });
  vivos('fuentes').forEach(f=>{ if(f.lat!=null&&f.lng!=null) pts.push([f.lat,f.lng]); });
  if(!pts.length) return;
  if(pts.length===1){ state.map.setView(pts[0],13); }
  else state.map.fitBounds(pts,{padding:[40,40],maxZoom:14});
  mapFitDone=true;
}
function renderMap(){
  if(!state.markers) return;
  state.markers.clearLayers();
  state._mk=[];  // índice nombre→marcador para el buscador del mapa
  const cols={rojo:'#e0322f',ambar:'#e08608',verde:'#16a34a',rescate:'#db2777'};
  const F=state.filtros||{}, fItem=F.item||'';
  // ¿un punto de necesidad cae dentro del filtro por item? (lo que le falta, o rescatistas)
  const puntoMatchItem=p=> !fItem || (p.faltan||[]).includes(fItem) || (fItem==='Rescatistas' && p.necesita_rescate);
  if(F.puntos!==false) vivos('puntos').forEach(p=>{
    if(p.lat==null||p.lng==null) return;
    if(!puntoMatchItem(p)) return;
    const c=color(p);
    const lvl=trustLevel(p), anc=anclaDe(p);
    // ARO DE CONFIANZA (eje aparte del semáforo): verde=confiable, rojo punteado=dudoso.
    // El color del PIN sigue siendo "qué falta" (rojo/verde); el aro NO se pisa con eso.
    if(lvl.k!=='media'){
      state.markers.addLayer(L.circleMarker([p.lat,p.lng],{radius:18,color:lvl.col,weight:3,opacity:.9,fill:false,dashArray:lvl.k==='baja'?'4 5':null,interactive:false}));
    }
    const m=L.circleMarker([p.lat,p.lng],{radius:13,color:'#fff',weight:3,fillColor:cols[c],fillOpacity:lvl.k==='baja'?.55:.98});
    const falta=(p.faltan||[]).join(', ');
    m.bindPopup(`<b>${esc(p.nombre)}</b><br>${esc([p.municipio,p.departamento].filter(Boolean).join(', '))}<br>${p.personas||0} personas · <b>${LABELS[c]}</b>${falta?'<br>Falta: '+esc(falta):''}${p.necesita_rescate?'<br>🚨 Rescatistas':''}<br>${lvl.ico} <b>${lvl.txt}</b>${anc?' · 📍 '+esc(anc.n):''}${atnPopup(p)}<br><a href="${mapsDir(p.lat,p.lng)}" target="_blank" rel="noopener" class="popup-go">🧭 Cómo llegar</a>`);
    m.bindTooltip(esc(p.nombre),{permanent:true,direction:'top',offset:[0,-10],className:'mk-label'});
    state.markers.addLayer(m);
    state._mk.push({nombre:p.nombre,muni:[p.municipio,p.departamento].filter(Boolean).join(', '),lat:p.lat,lng:p.lng,m});
  });
  // Entregas: se ocultan si su categoría está apagada, o si hay un filtro por item activo (no son "necesidades").
  if(F.entregas!==false && !fItem) vivos('entregas').forEach(e=>{
    if(e.lat==null||e.lng==null) return;
    const m=L.marker([e.lat,e.lng],{icon:pinIcon('#2563eb','📦')});
    m.bindPopup(`<b>📦 ${esc(e.lugar||'Entrega')}</b><br>${esc(e.items||'')}<br>${e.recibido?'Recibido ✓':'En camino'}<br><a href="${mapsDir(e.lat,e.lng)}" target="_blank" rel="noopener" class="popup-go">🧭 Cómo llegar</a>`);
    state.markers.addLayer(m);
    state._mk.push({nombre:e.lugar||'Entrega',muni:e.items||'',lat:e.lat,lng:e.lng,m});
  });
  // Centros de acopio (donaciones físicas): marca morada con caja; muestra qué necesitan
  if(F.acopios!==false) vivos('fuentes').forEach(f=>{
    if(f.tipo!=='recoleccion' || f.lat==null || f.lng==null) return;
    if(fItem && !(f.necesita||[]).includes(fItem)) return;  // filtro por item: solo acopios que piden eso
    const nec=(f.necesita||[]).join(', ');
    const cerrado=acopioCerrado(f);
    const m=L.marker([f.lat,f.lng],{icon:pinIcon(cerrado?'#9ca3af':'#7c3aed','🏬')});
    m.bindPopup(`<b>🏬 ${esc(f.nombre)}</b>${cerrado?' <span style="color:#b91c1c">(cerrado)</span>':''}<br>Centro de acopio${f.destino?' · va a '+esc(f.destino):''}${f.fecha_limite?'<br>⏰ '+(cerrado?'Cerró el ':'Recibe hasta el ')+esc(fmtFechaCorta(f.fecha_limite)):''}${f.direccion?'<br>📍 '+esc(f.direccion):''}${nec&&!cerrado?'<br><b>Necesitan:</b> '+esc(nec):''}<br><a href="${mapsDir(f.lat,f.lng)}" target="_blank" rel="noopener" class="popup-go">🧭 Cómo llegar</a>`);
    m.bindTooltip(esc(f.nombre),{permanent:true,direction:'top',offset:[0,-30],className:'mk-label mk-label-acopio'});
    state.markers.addLayer(m);
    state._mk.push({nombre:f.nombre,muni:f.direccion||f.destino||'Centro de acopio',lat:f.lat,lng:f.lng,m});
  });
  // ANCLAS DE CONFIANZA: zonas urbanas con instituciones (hospital, alcaldía, Cruz Roja,
  // bomberos, policía, universidades). Se dibuja un halo suave = radio de confianza. Los
  // puntos que nacen dentro arrancan con más confianza. Se pueden ocultar con el botón 🏛️.
  if(state.showAnclas!==false && !fItem){
    ANCLAS.forEach(a=>{
      state.markers.addLayer(L.circle([a.lat,a.lng],{radius:a.r*1000,color:'#0ea5e9',weight:1,opacity:.35,fillColor:'#0ea5e9',fillOpacity:.06,interactive:false}));
      const m=L.marker([a.lat,a.lng],{icon:pinIcon('#0ea5e9','🏛️')});
      m.bindPopup(`<b>🏛️ ${esc(a.n)}</b><br>Zona con instituciones (hospital, alcaldía, Cruz Roja, bomberos, policía, universidades). Los reportes cerca de aquí arrancan con más confianza.`);
      state.markers.addLayer(m);
    });
  }
  // La primera vez que llegan puntos, encuadra el mapa para que se VEAN (si el usuario no movió aún)
  if(!mapFitDone && !userMoved) fitToPoints();
}

/* ====== Mini-mapa para ELEGIR ubicación (toca o arrastra el pin) ====== */
let pickMap=null, pickMarker=null, lastLatLng=null;
function destroyPick(){ if(pickMap){ try{pickMap.remove();}catch(e){} } pickMap=null; pickMarker=null; }
function setPick(lat,lng,zoom){
  gps.lat=+(+lat).toFixed(6); gps.lng=+(+lng).toFixed(6); lastLatLng=[gps.lat,gps.lng];
  const info=document.querySelector('#gps-info');
  if(info) info.innerHTML='📍 Ubicación fijada ('+gps.lat+', '+gps.lng+') · <b>arrastra el pin para ajustar</b>';
  if(pickMap){
    if(!pickMarker){ pickMarker=L.marker([gps.lat,gps.lng],{draggable:true,autoPan:true,icon:pinIcon('#db2777')}).addTo(pickMap);
      pickMarker.on('dragend',()=>{const ll=pickMarker.getLatLng();setPick(ll.lat,ll.lng);}); }
    else pickMarker.setLatLng([gps.lat,gps.lng]);
    if(zoom) pickMap.setView([gps.lat,gps.lng],zoom);
  }
}
// Al tocar una referencia del mini-mapa (una necesidad o un centro de acopio) se fija el pin ahí
// y, si el campo del lugar está vacío, se pone su nombre solo.
function pickRef(lat,lng,nombre){
  setPick(lat,lng,16);
  const lug=document.querySelector('#modal input[name="lugar"]');
  if(lug && !lug.value.trim() && nombre) lug.value=nombre;
}
function initPickMap(){
  const el=document.getElementById('pickmap'); if(!el||!window.L) return;
  // Buscador de dirección/lugar: escribe y cae el pin solo (no hay que arrastrarlo a mano)
  if(!el.parentNode.querySelector('#geo-search')){
    const box=document.createElement('div');
    box.id='geo-search'; box.className='geo-search';
    box.innerHTML='<div class="geo-row"><input id="geo-q" type="search" placeholder="🔎 Escribe la dirección o el municipio (ej: San José del Palmar)"><button type="button" id="geo-go">Buscar</button></div>'
      +'<button type="button" id="geo-gps" class="geo-gps">📍 Usar mi ubicación (GPS) — funciona sin internet</button>'
      +'<div id="geo-res" class="geo-res"></div>';
    el.parentNode.insertBefore(box, el);
    const q=box.querySelector('#geo-q'), go=box.querySelector('#geo-go'), res=box.querySelector('#geo-res'), gps=box.querySelector('#geo-gps');
    // BOTÓN GPS: marca el punto en la ubicación real del celular SIN depender de que el mapa cargue.
    // Es la vía honesta para alguien sin señal en el terreno: el GPS no necesita internet.
    gps.onclick=()=>{ if(!navigator.geolocation){ res.innerHTML='<div class="geo-hint">Este celular no permite ubicación.</div>'; return; }
      res.innerHTML='<div class="geo-hint">Tomando tu ubicación…</div>';
      navigator.geolocation.getCurrentPosition(p=>{ setPick(p.coords.latitude,p.coords.longitude,17); res.innerHTML='<div class="geo-hint">✓ Punto en tu ubicación. Arrástralo si necesitas afinarlo.</div>'; },
        ()=>{ res.innerHTML='<div class="geo-hint">No pude tomar el GPS. Permite la ubicación o marca el pin a mano.</div>'; }, {enableHighAccuracy:true,timeout:10000,maximumAge:30000}); };
    // Si el formulario ya tiene una dirección escrita, la ofrece como búsqueda de un toque
    const dir=document.querySelector('#modal input[name="direccion"]');
    if(dir&&dir.value.trim()) q.value=dir.value.trim();
    const run=async()=>{
      const term=q.value.trim(); if(term.length<2){ res.innerHTML='<div class="geo-hint">Escribe al menos 2 letras.</div>'; return; }
      // MUNICIPIOS OFFLINE primero (no dependen de señal), luego dirección exacta con Google (webhook).
      const munis=geoLocal(term);
      const rM=munis.map((h,i)=>'<button type="button" class="geo-hit muni" data-m="'+i+'">🏙️ '+esc(h.label)+'</button>').join('');
      res.innerHTML=(munis.length?'<div class="geo-hint">Municipios (sin internet):</div>'+rM:'')+'<div class="geo-hint">Buscando dirección exacta…</div>';
      res.querySelectorAll('.geo-hit.muni').forEach(b=>b.onclick=()=>{ const h=munis[+b.dataset.m]; setPick(h.lat,h.lng,14); res.innerHTML='<div class="geo-hint">✓ Pin en '+esc(h.label)+'. Arrástralo para afinar la calle exacta.</div>'; });
      const nearP = pickMap ? (pickMap.getCenter().lat+','+pickMap.getCenter().lng) : (state.myPos?state.myPos.join(','):(lastLatLng?lastLatLng.join(','):''));
      const hits=await geocode(term, nearP);
      if(!hits.length){ if(!munis.length) res.innerHTML='<div class="geo-hint">No encontré ese lugar. Prueba con el municipio o marca el pin a mano.</div>'; return; }
      const rH=hits.map((h,i)=>'<button type="button" class="geo-hit" data-i="'+i+'">📍 '+esc(h.label)+(h.aprox?' <small>(aprox.)</small>':'')+'</button>').join('');
      res.innerHTML=(munis.length?'<div class="geo-hint">Municipios (sin internet):</div>'+rM:'')+'<div class="geo-hint">Dirección (con señal):</div>'+rH;
      res.querySelectorAll('.geo-hit.muni').forEach(b=>b.onclick=()=>{ const h=munis[+b.dataset.m]; setPick(h.lat,h.lng,14); res.innerHTML='<div class="geo-hint">✓ Pin en '+esc(h.label)+'.</div>'; });
      res.querySelectorAll('.geo-hit:not(.muni)').forEach(b=>b.onclick=()=>{ const h=hits[+b.dataset.i]; setPick(h.lat,h.lng,h.aprox?16:18); res.innerHTML='<div class="geo-hint">'+(h.aprox?'✓ Pin cerca de la dirección. <b>Arrástralo</b> hasta el punto exacto.':'✓ Pin en la dirección exacta. Arrástralo si necesitas afinarlo.')+'</div>'; });
    };
    go.onclick=run;
    q.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); run(); } });
  }
  destroyPick();
  const has=gps.lat!=null;
  // Arranca donde MÁS probable estén ya cargados los tiles (los del mapa principal):
  // 1) lo ya elegido, 2) tu ubicación conocida, 3) lo último usado, 4) Colombia entera.
  const start = has?[gps.lat,gps.lng] : (state.myPos || lastLatLng || [4.6,-74.1]);
  const startZoom = has?15 : (state.myPos?14 : (lastLatLng?13:6));
  el.classList.add('loading');                   // muestra "Cargando mapa…" hasta que llegan los tiles
  pickMap=L.map(el,{zoomControl:true,attributionControl:false});
  pickMap.setView(start, startZoom);
  const tiles=baseTiles().addTo(pickMap);
  tiles.on('load',()=>el.classList.remove('loading'));
  setTimeout(()=>el.classList.remove('loading'),3500); // por si el evento no dispara
  pickMarker=L.marker(start,{draggable:true,autoPan:true,icon:pinIcon('#db2777')}).addTo(pickMap);
  pickMarker.on('dragend',()=>{const ll=pickMarker.getLatLng();setPick(ll.lat,ll.lng);});
  if(has) setPick(start[0],start[1]);            // conserva lo elegido si ya había
  else if(state.myPos){ setPick(start[0],start[1]); }  // sugiere tu ubicación como punto de partida
  pickMap.on('click',e=>setPick(e.latlng.lat,e.latlng.lng));  // tocar el mapa fija el punto
  // Referencias: los MISMOS lugares del mapa principal (necesidades y centros de acopio),
  // para ubicar la entrega tocando uno en vez de adivinar dónde queda.
  const cols={rojo:'#e0322f',ambar:'#e08608',verde:'#16a34a',rescate:'#db2777'};
  const refs=[];
  vivos('puntos').forEach(p=>{
    if(p.lat==null||p.lng==null) return;
    const m=L.circleMarker([p.lat,p.lng],{radius:9,color:'#fff',weight:2,fillColor:cols[color(p)],fillOpacity:.9}).addTo(pickMap);
    m.bindTooltip(esc(p.nombre),{direction:'top',offset:[0,-8],className:'mk-label'});
    m.on('click',()=>pickRef(p.lat,p.lng,p.nombre));
    refs.push([p.lat,p.lng]);
  });
  vivos('fuentes').forEach(f=>{
    if(f.tipo!=='recoleccion'||f.lat==null||f.lng==null) return;
    const m=L.marker([f.lat,f.lng],{icon:pinIcon('#7c3aed','🏬')}).addTo(pickMap);
    m.bindTooltip(esc(f.nombre),{direction:'top',offset:[0,-28],className:'mk-label mk-label-acopio'});
    m.on('click',()=>pickRef(f.lat,f.lng,f.nombre));
    refs.push([f.lat,f.lng]);
  });
  // Si aún no hay un pin fijado, encuadra el mini-mapa para que ESAS referencias se vean
  if(!has && !state.myPos && refs.length){
    try{ if(refs.length===1) pickMap.setView(refs[0],13); else pickMap.fitBounds(refs,{padding:[30,30],maxZoom:13}); }catch(e){}
  }
  // invalidateSize varias veces: el modal se abre con animación y el mapa necesita re-medir
  [80,250,600].forEach(t=>setTimeout(()=>{ pickMap&&pickMap.invalidateSize(); },t));
}

/* ================= FORMULARIOS ================= */
let currentPhoto=null, gps={lat:null,lng:null};
let editingId=null, editingKind=null;
function openForm(kind, prefill={}, editId=null){
  const P = prefill||{};
  editingId = editId; editingKind = editId ? kind : null;
  currentPhoto=null;
  gps={lat:(P.lat!=null?P.lat:null), lng:(P.lng!=null?P.lng:null)};
  destroyPick();
  const f=$('#modal-form'); const title=$('#modal-title');
  const multi=(name,sel)=>{
    const s=(sel||[]).map(x=>String(x));
    const base=[...ITEMS];
    s.forEach(v=>{ if(!base.some(b=>b.toLowerCase()===v.toLowerCase())) base.push(v); });
    const on=v=>s.some(x=>x.toLowerCase()===String(v).toLowerCase())?' on':'';
    return `<div class="multi" data-multi="${name}">${base.map(i=>`<span class="opt${on(i)}" data-val="${esc(i)}">${esc(i)}</span>`).join('')}</div>
    <div class="addother"><input class="addother-inp" data-for="${name}" placeholder="Otro… escríbelo (ej: herramientas, agua potable)" maxlength="40"><button type="button" class="addother-btn" data-for="${name}">+ Añadir</button></div>`;
  };
  if(kind==='punto'){
    title.textContent = editId ? 'Cambiar qué necesita este lugar' : 'Avisar qué falta en un lugar';
    f.innerHTML=`
      <label>Nombre del lugar *</label><input name="nombre" placeholder="Vereda, barrio, corregimiento" value="${esc(P.nombre||'')}" required>
      <div class="row2"><div><label>Municipio</label><input name="municipio" placeholder="Ej: Timbío" value="${esc(P.municipio||'')}"></div>
      <div><label>Departamento</label><input name="departamento" placeholder="Ej: Cauca" value="${esc(P.departamento||'')}"></div></div>
      <label>¿Cuántas personas?</label><input name="personas" type="number" inputmode="numeric" placeholder="Ej: 40" value="${P.personas?esc(P.personas):''}">
      <label>¿Qué tan urgente es?</label>
      <select name="urgencia">
        <option value="normal"${(P.urgencia||'normal')==='normal'?' selected':''}>Normal</option>
        <option value="alta"${P.urgencia==='alta'?' selected':''}>🟠 Urgente</option>
        <option value="critica"${P.urgencia==='critica'?' selected':''}>🔴 Crítico (vida en riesgo)</option>
      </select>
      <label>¿Qué FALTA aquí? (toca lo que aplique)</label>${multi('faltan',P.faltan)}
      <label>¿Qué SOBRA / ya llegó?</label>${multi('sobran',P.sobran)}
      <label><input type="checkbox" name="necesita_rescate" style="width:auto;display:inline;margin-right:8px" ${P.necesita_rescate?'checked':''}>🚨 Faltan rescatistas / gente atrapada</label>
      <label>Nota (opcional)</label><textarea name="nota" placeholder="Detalles: qué se necesita con urgencia, cómo llegar…">${esc(P.nota||'')}</textarea>
      <label>Foto del lugar (opcional)</label>
      <input type="file" accept="image/*" id="foto"><img class="photo-prev" id="prev">
      ${editId&&P.tiene_foto?'<div class="help">Ya tiene una foto. Sube otra solo si quieres cambiarla.</div>':''}
      <label>¿Dónde queda? Ubícalo en el mapa</label>
      <div id="pickmap"></div>
      <div class="help" id="gps-info">Toca el mapa o arrastra el pin para marcar el punto en cualquier lugar. O usa tu GPS.</div>
      <button type="button" class="gps-btn" id="gps">📍 Usar mi ubicación (GPS)</button>
      <button class="btn-primary" type="submit">${editId?'Guardar cambios':'Guardar punto'}</button>`;
  } else if(kind==='entrega'){
    title.textContent='Anotar una entrega';
    // Lugares YA reportados (con ubicación) para tocar y marcar rápido, sin escribir ni ubicar a mano
    const cols={rojo:'#e0322f',ambar:'#e08608',verde:'#16a34a',rescate:'#db2777'};
    const destinos=vivos('puntos').filter(p=>p.lat!=null&&p.lng!=null).sort((a,b)=>urgScore(b)-urgScore(a));
    const destHtml=destinos.length?`
      <label>¿A qué lugar entregaste? <span style="font-weight:600;color:var(--text-soft)">(toca uno)</span></label>
      <div class="destinos" id="destinos">
        ${destinos.map(p=>`<button type="button" class="destino" data-lat="${p.lat}" data-lng="${p.lng}" data-nom="${esc(p.nombre)}">
          <span class="dot" style="background:${cols[color(p)]}"></span>
          <span class="dnom">${esc(p.nombre)}</span>
          <span class="dmeta">${esc([p.municipio,p.departamento].filter(Boolean).join(', '))}</span>
        </button>`).join('')}
      </div>
      <div class="help">Al tocar un lugar se pone su nombre y se marca solo en el mapa. Si no está en la lista, escríbelo abajo.</div>`:'';
    f.innerHTML=`
      ${destHtml}
      <label>${destinos.length?'Lugar de la entrega *':'¿A dónde se entregó? *'}</label><input name="lugar" placeholder="Lugar / vereda / punto" required>
      <label>¿Quién entrega?</label><input name="quien_entrego" placeholder="Tu nombre u organización">
      <label>¿Qué se entregó?</label><input name="items" placeholder="Ej: 20 colchones, agua, mercados">
      <label>Foto de la entrega (prueba)</label>
      <input type="file" accept="image/*" id="foto"><img class="photo-prev" id="prev">
      <label>¿Dónde se entregó? Ubícalo en el mapa</label>
      <div id="pickmap"></div>
      <div class="help" id="gps-info">Toca un punto del mapa (una necesidad o un centro de acopio) para marcar ahí, o toca cualquier lugar / arrastra el pin. También puedes usar tu GPS.</div>
      <button type="button" class="gps-btn" id="gps">📍 Usar mi ubicación (GPS)</button>
      <button class="btn-primary" type="submit">Guardar entrega</button>`;
  } else if(kind==='fuente'){
    const esAcopio=(P.tipo==='recoleccion');
    title.textContent='Agregar una cuenta o centro de acopio';
    f.innerHTML=`
      <label>Nombre *</label><input name="nombre" placeholder="Ej: Cruz Roja Cauca / Acopio Popayán" value="${esc(P.nombre||'')}" required>
      <label>¿Qué es?</label>
      <select name="tipo" id="tipo-fuente">
        <option value="cuenta"${!esAcopio?' selected':''}>🏦 Cuenta bancaria (donar dinero)</option>
        <option value="recoleccion"${esAcopio?' selected':''}>🏬 Centro de acopio (donar cosas: ropa, comida, colchones…)</option>
      </select>

      <div id="cuenta-fields" style="${esAcopio?'display:none':''}">
        <div class="row2"><div><label>Banco</label><input name="banco" placeholder="Bancolombia, Nequi…" value="${esc(P.banco||'')}"></div>
        <div><label>N° cuenta / celular</label><input name="numero_cuenta" placeholder="000-000000-00" value="${esc(P.numero_cuenta||'')}"></div></div>
        <label>Titular</label><input name="titular" placeholder="A nombre de" value="${esc(P.titular||'')}">
      </div>

      <div id="acopio-fields" style="${esAcopio?'':'display:none'}">
        <div class="help">Un centro de acopio recibe cosas (no dinero). Di qué te falta para completar el envío y la gente cercana lleva lo que puede.</div>
        <label>¿Qué NECESITAN? (lo que falta para completar el envío)</label>${multi('necesita',P.necesita)}
        <label>Dirección (dónde llevar las cosas)</label><input name="direccion" placeholder="Ej: Colegio Central, Cra 5 #3-20" value="${esc(P.direccion||'')}">
        <label>¿Dónde queda? Ubícalo en el mapa</label>
        <div id="pickmap"></div>
        <div class="help" id="gps-info">Toca el mapa o arrastra el pin para marcar el centro de acopio.</div>
        <button type="button" class="gps-btn" id="gps">📍 Usar mi ubicación (GPS)</button>
        <label>¿Hasta cuándo reciben? (fecha de cierre)</label>
        <input type="date" name="fecha_limite" value="${esc((P.fecha_limite||'').toString().slice(0,10))}">
        <div class="help">Así la gente sabe hasta cuándo llevar cosas y no manda de más cuando el punto ya cerró.</div>
        <label>WhatsApp de quien coordina *</label>
        <input name="whatsapp" inputmode="tel" placeholder="Ej: 300 123 4567" value="${esc(P.whatsapp||'')}">
        <label>Correo (para recordarte actualizar y cerrar el punto)</label>
        <input type="email" name="email" placeholder="tucorreo@ejemplo.com" value="${esc(P.email||'')}">
        <div class="help">Te enviaremos un recordatorio para que actualices qué falta (ej: “ya llegaron pañales, no envíen más”) o cierres el punto cuando termine.</div>
      </div>

      <label>¿A dónde va la ayuda? (destino del envío)</label><input name="destino" placeholder="Ej: Chocó, Cali, Buenaventura…" value="${esc(P.destino||'')}">
      <label>Contacto</label><input name="contacto" placeholder="WhatsApp / teléfono" value="${esc(P.contacto||'')}">
      <label>Nota</label><textarea name="nota" placeholder="Qué se recibe, horarios…">${esc(P.nota||'')}</textarea>
      <button class="btn-primary" type="submit">Guardar</button>`;
  } else if(kind==='aporte'){
    title.textContent='Anotar una donación de dinero';
    // deja elegir a qué cuenta/campaña donó (así se puede anotar desde el botón grande, sin partir de una cuenta)
    const cuentas=vivos('fuentes').filter(x=>x.tipo!=='recoleccion');
    const opts=cuentas.map(c=>`<option value="${esc(c.id)}" ${String(prefill.fuente_id||'')===String(c.id)?'selected':''}>${esc(c.nombre)}${c.titular?' — '+esc(c.titular):''}</option>`).join('');
    f.innerHTML=`
      <label>¿A qué cuenta o campaña donaste?</label>
      <select name="fuente_id">
        <option value="">— Otra / no está en la lista —</option>
        ${opts}
      </select>
      ${cuentas.length?'':'<div class="help">Aún no hay cuentas cargadas. Puedes anotar igual tu donación; si quieres, agrega la cuenta con “＋ Agregar acopio o cuenta”.</div>'}
      <label>¿Quién aporta?</label><input name="quien" placeholder="Tu nombre (o anónimo)">
      <label>Monto</label><input name="monto" inputmode="decimal" placeholder="Ej: 50000">
      <label>Foto del comprobante</label>
      <input type="file" accept="image/*" id="foto"><img class="photo-prev" id="prev">
      <div class="help">Anota una donación que ya hiciste. Queda como prueba; se marca “confirmado” cuando se verifica que llegó.</div>
      <button class="btn-primary" type="submit">Guardar donación</button>`;
  } else if(kind==='desaparecido'){
    title.textContent = editId ? 'Editar persona desaparecida' : 'Reportar una persona desaparecida';
    f.innerHTML=`
      <label>Nombre completo *</label><input name="nombre" placeholder="Nombre y apellidos" value="${esc(P.nombre||'')}" required>
      <div class="row2"><div><label>Municipio donde desapareció</label><input name="municipio" placeholder="Ej: Pereira" value="${esc(P.municipio||'')}"></div>
      <div><label>Departamento</label><input name="departamento" placeholder="Ej: Risaralda" value="${esc(P.departamento||'')}"></div></div>
      <div class="row2"><div><label>Edad (opcional)</label><input name="edad" placeholder="Ej: 24" value="${esc(P.edad||'')}"></div>
      <div><label>Sexo (opcional)</label><input name="sexo" placeholder="Hombre / Mujer" value="${esc(P.sexo||'')}"></div></div>
      <label>Señas / cómo iba vestida / detalles</label><textarea name="descripcion" placeholder="Estatura, ropa, tatuajes, última vez que se le vio…">${esc(P.descripcion||'')}</textarea>
      <label>Contacto de la familia (para avisar si aparece)</label><input name="contacto" placeholder="WhatsApp / teléfono" value="${esc(P.contacto||'')}">
      <label>Foto de la persona (ayuda mucho a identificarla)</label>
      <input type="file" accept="image/*" id="foto"><img class="photo-prev" id="prev">
      ${editId&&P.tiene_foto?'<div class="help">Ya tiene una foto. Sube otra solo si quieres cambiarla.</div>':''}
      <button class="btn-primary" type="submit">${editId?'Guardar cambios':'Publicar reporte'}</button>`;
  } else if(kind==='avistamiento'){
    title.textContent = P._nombre ? ('Reportar sobre: '+P._nombre) : 'Reportar información';
    f.innerHTML=`
      <input type="hidden" name="desaparecido_id" value="${esc(P.desaparecido_id||'')}">
      ${P._nombre?`<div class="help">Estás reportando información sobre <b>${esc(P._nombre)}</b>. Gracias, esto puede ayudar a su familia. 🙏</div>`:''}
      <label>¿Qué quieres reportar?</label>
      <select name="tipo">
        <option value="visto">👁️ La vi / la reconocí</option>
        <option value="info">ℹ️ Tengo información sobre ella</option>
        <option value="encontrado">🟢 Sé que ya apareció (con vida)</option>
        <option value="fallecido">🕯️ Lamentablemente, falleció</option>
      </select>
      <label>Cuéntanos lo que sabes *</label><textarea name="descripcion" placeholder="Dónde la viste, cómo estaba, cualquier dato útil…" required>${esc(P.descripcion||'')}</textarea>
      <label>¿Dónde? (lugar / barrio / ciudad)</label><input name="lugar" placeholder="Ej: Hospital de Pereira, albergue…" value="${esc(P.lugar||'')}">
      <label>Tu contacto (opcional, por si la familia necesita hablarte)</label><input name="contacto" placeholder="WhatsApp / teléfono" value="${esc(P.contacto||'')}">
      <div class="help">Tu reporte queda visible bajo esa persona. Si dices que apareció o falleció, se avisa como “sin confirmar” hasta que la familia o el equipo lo confirme.</div>
      <button class="btn-primary" type="submit">Enviar reporte</button>`;
  }
  // multi toggles
  f.querySelectorAll('.multi .opt').forEach(o=>o.onclick=()=>o.classList.toggle('on'));
  // añadir opción personalizada (por si no está en la lista)
  const addCustom=(name)=>{
    const inp=f.querySelector(`.addother-inp[data-for="${name}"]`); if(!inp) return;
    const val=(inp.value||'').trim(); if(!val) return;
    const multi=f.querySelector(`[data-multi="${name}"]`); if(!multi) return;
    const exists=[...multi.querySelectorAll('.opt')].find(o=>(o.dataset.val||'').toLowerCase()===val.toLowerCase());
    if(exists){ exists.classList.add('on'); }
    else{
      const chip=document.createElement('span');
      chip.className='opt on'; chip.dataset.val=val; chip.textContent=val;
      chip.onclick=()=>chip.classList.toggle('on');
      multi.appendChild(chip);
    }
    inp.value='';
  };
  f.querySelectorAll('.addother-btn').forEach(b=>b.onclick=()=>addCustom(b.dataset.for));
  f.querySelectorAll('.addother-inp').forEach(i=>i.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); addCustom(i.dataset.for); } }));
  // mini-mapa selector (punto, entrega, y centro de acopio)
  const acopioActivo = ()=> f.querySelector('#tipo-fuente') && f.querySelector('#tipo-fuente').value==='recoleccion';
  if(kind==='punto'||kind==='entrega'|| (kind==='fuente'&&acopioActivo())) initPickMap();
  // Entrega: tocar un lugar ya reportado rellena el nombre y marca su punto en el mapa
  f.querySelectorAll('.destino').forEach(b=>b.onclick=()=>{
    f.querySelectorAll('.destino').forEach(x=>x.classList.remove('on'));
    b.classList.add('on');
    const inp=f.querySelector('input[name="lugar"]'); if(inp) inp.value=b.dataset.nom;
    setPick(parseFloat(b.dataset.lat), parseFloat(b.dataset.lng), 15);
  });
  // cambiar entre Cuenta / Centro de acopio muestra los campos correctos y prende el mapa
  const tsel=f.querySelector('#tipo-fuente');
  if(tsel) tsel.onchange=()=>{
    const ac = tsel.value==='recoleccion';
    const cf=f.querySelector('#cuenta-fields'), af=f.querySelector('#acopio-fields');
    if(cf) cf.style.display = ac?'none':'';
    if(af) af.style.display = ac?'':'none';
    if(ac){ setTimeout(initPickMap,60); } else { destroyPick(); }
  };
  // gps
  const gbtn=f.querySelector('#gps');
  if(gbtn) gbtn.onclick=()=>{
    const info=f.querySelector('#gps-info'); if(info) info.textContent='Ubicando…';
    navigator.geolocation.getCurrentPosition(p=>{
      setPick(p.coords.latitude, p.coords.longitude, 16);
      gbtn.style.background='var(--accent-soft)';
    }, ()=>{ if(info) info.textContent='No se pudo obtener el GPS (permite la ubicación). Toca el mapa para marcar a mano.'; }, {enableHighAccuracy:true,timeout:8000});
  };
  // foto
  const fin=f.querySelector('#foto');
  if(fin) fin.onchange=e=>{ const file=e.target.files[0]; if(file) downscale(file,d=>{ currentPhoto=d; const pv=f.querySelector('#prev'); pv.src=d; pv.style.display='block'; }); };

  f.onsubmit=ev=>{ ev.preventDefault(); submitForm(kind); };
  $('#modal').classList.remove('hidden');
}

function readMulti(name){ const el=document.querySelector(`[data-multi="${name}"]`); if(!el)return[]; return [...el.querySelectorAll('.opt.on')].map(o=>o.dataset.val); }

function submitForm(kind){
  const fd=new FormData($('#modal-form'));
  const g=n=>{ const v=fd.get(n); return v==null?'':String(v).trim(); };
  let table, data;
  if(kind==='punto'){
    if(!g('nombre')) return toast('Falta el nombre del lugar');
    table='puntos';
    data={ nombre:g('nombre'), municipio:g('municipio'), departamento:g('departamento'),
      personas: parseInt(g('personas'))||0, urgencia:g('urgencia')||'normal',
      faltan:readMulti('faltan'), sobran:readMulti('sobran'),
      necesita_rescate: !!fd.get('necesita_rescate'), nota:g('nota'), creado_por: cache(LS.user)||'',
      lat:gps.lat, lng:gps.lng, estado:'activo', foto:currentPhoto||null, tiene_foto: !!currentPhoto };
    const anc=anclaCerca(gps.lat,gps.lng);   // ¿nace cerca de instituciones? → arranca con más confianza
    data.cerca_ancla=!!anc; data.ancla_nombre=anc?anc.n:null; data.ancla_tipo=anc?anc.t:null;
  } else if(kind==='entrega'){
    if(!g('lugar')) return toast('Falta el lugar');
    table='entregas';
    data={ lugar:g('lugar'), quien_entrego:g('quien_entrego'), items:g('items'), foto:currentPhoto||null, tiene_foto: !!currentPhoto, lat:gps.lat, lng:gps.lng, recibido:false };
  } else if(kind==='fuente'){
    if(!g('nombre')) return toast('Falta el nombre');
    const esAcopio=g('tipo')==='recoleccion';
    if(esAcopio && !g('whatsapp')) return toast('Deja el WhatsApp de quien coordina el acopio');
    table='fuentes';
    data={ nombre:g('nombre'), tipo:g('tipo'), banco:g('banco'), numero_cuenta:g('numero_cuenta'),
      titular:g('titular'), destino:g('destino'), contacto:g('contacto'), nota:g('nota'), verificada:false,
      necesita: esAcopio?readMulti('necesita'):null, direccion: esAcopio?g('direccion'):null,
      fecha_limite: esAcopio?(g('fecha_limite')||null):null,
      whatsapp: esAcopio?(g('whatsapp')||null):null, email: esAcopio?(g('email')||null):null,
      lat: esAcopio?gps.lat:null, lng: esAcopio?gps.lng:null };
  } else if(kind==='aporte'){
    table='aportes';
    data={ fuente_id:g('fuente_id')||null, quien:g('quien'), monto:g('monto'), comprobante:currentPhoto||null, tiene_foto: !!currentPhoto, estado:'reportado' };
  } else if(kind==='desaparecido'){
    if(!g('nombre')) return toast('Falta el nombre de la persona');
    table='desaparecidos';
    data={ nombre:g('nombre'), municipio:g('municipio'), departamento:g('departamento'),
      edad:g('edad'), sexo:g('sexo'), descripcion:g('descripcion'), contacto:g('contacto'),
      estado:'desaparecido', fuente:'Reporte de la comunidad', verificada:false,
      foto:currentPhoto||null, tiene_foto: !!currentPhoto };
  } else if(kind==='avistamiento'){
    if(!g('descripcion')) return toast('Cuéntanos lo que sabes');
    table='avistamientos';
    data={ desaparecido_id:g('desaparecido_id')||null, tipo:g('tipo')||'info',
      descripcion:g('descripcion'), lugar:g('lugar'), contacto:g('contacto') };
  }
  const afterDonar=()=>{ if(table==='fuentes'||table==='aportes'){ segDonar= table==='aportes'?'aportes':'fuentes'; syncSeg(); } };
  if(editingKind===kind && editingId){
    const eid=editingId; editingId=null; editingKind=null;
    delete data.creado_por; delete data.estado;   // no reescribir dueño/estado al editar
    if(!currentPhoto){ delete data.foto; delete data.tiene_foto; }  // sin foto nueva → conservar la que ya tenía
    closeModal();
    update(table, eid, data).then(()=>{ afterDonar(); toast('Cambios guardados'); });
    return;
  }
  data.owner = ME;                                 // deja marcada la identidad de quien reporta
  closeModal();
  save(table, data).then(afterDonar);
}

/* downscale foto a ~900px jpeg */
function downscale(file, cb){
  const img=new Image();
  img.onload=()=>{
    const max=900, sc=Math.min(1, max/Math.max(img.width,img.height));
    const c=document.createElement('canvas'); c.width=img.width*sc; c.height=img.height*sc;
    c.getContext('2d').drawImage(img,0,0,c.width,c.height);
    cb(c.toDataURL('image/jpeg',0.6));
  };
  img.src=URL.createObjectURL(file);
}

/* ================= NAV ================= */
// Historial simple para el botón "volver": guarda de qué pantalla venías
// para poder regresar al menú anterior. El Mapa es la pantalla base (home).
let navHistory=[];
function curScreen(){ const s=document.querySelector('.screen.active'); return s? s.id.replace('screen-',''):'mapa'; }
function updateBackBtn(){ const b=$('#btn-back'); if(b) b.classList.toggle('hidden', navHistory.length===0); }
function goBack(){ const prev=navHistory.pop(); go(prev||'mapa', true); }
function go(screen, isBack){
  const cur=curScreen();
  if(!isBack && cur!==screen) navHistory.push(cur);
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  $('#screen-'+screen).classList.add('active');
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active', t.dataset.screen===screen));
  if(screen==='mapa'){ initMap(); setTimeout(()=>state.map&&state.map.invalidateSize(),120); }
  updateBackBtn();
}
function closeModal(){ $('#modal').classList.add('hidden'); destroyPick(); editingId=null; editingKind=null; }
function syncSeg(){
  document.querySelectorAll('.seg-btn').forEach(b=>b.classList.toggle('active', b.dataset.seg===segDonar));
  $('#lista-fuentes').classList.toggle('hidden', segDonar!=='fuentes');
  $('#lista-aportes').classList.toggle('hidden', segDonar!=='aportes');
  // el botón grande cambia según la pestaña: en "Donaciones de dinero" sirve para ANOTAR una donación hecha
  const fab=$('#fab-donar');
  if(fab){
    if(segDonar==='aportes'){ fab.dataset.add='aporte'; fab.textContent='＋ Anoté una donación de dinero'; }
    else { fab.dataset.add='fuente'; fab.textContent='＋ Agregar acopio o cuenta'; }
  }
}

/* ================= INIT ================= */
function hideSplash(){
  window.__booted = true;
  const sp = document.getElementById('splash');
  if(sp){ sp.classList.add('off'); setTimeout(()=>{ try{ sp.remove(); }catch(e){} }, 400); }
}
function boot(){
  // Marcamos el arranque y quitamos el "Cargando…" de inmediato: aunque algo más falle,
  // el usuario NUNCA queda en pantalla girando para siempre. Los botones se cablean abajo
  // en bloques guardados, así que la app queda usable pase lo que pase.
  hideSplash();

  // cargar cache primero (instantáneo / offline) — nunca frena el arranque
  try{
    for(const t of ['puntos','entregas','fuentes','aportes','desaparecidos','avistamientos']) state[t]=cache(LS[t])||[];
    state.queue=cache(LS.queue)||[];
  }catch(e){ console.warn('cache', e); }

  // CABLEAR LOS BOTONES PRIMERO (no dependen de datos). Antes iba renderAll() antes que esto:
  // si el pintado fallaba, los botones quedaban muertos ("se queda ahí"). Ahora la navegación
  // y el botón Empezar SIEMPRE quedan vivos, aunque el pintado o el mapa fallen.
  try{
    document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>go(t.dataset.screen));
    { const bk=$('#btn-back'); if(bk) bk.onclick=goBack; }
    document.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>openForm(b.dataset.add));
    document.querySelectorAll('.seg-btn').forEach(b=>b.onclick=()=>{segDonar=b.dataset.seg;syncSeg();});
    document.querySelectorAll('#orden-puntos .seg-btn').forEach(b=>b.onclick=()=>{
      ordenPuntos=b.dataset.orden;
      document.querySelectorAll('#orden-puntos .seg-btn').forEach(x=>x.classList.toggle('active',x.dataset.orden===ordenPuntos));
      if(ordenPuntos==='cercania' && !state.myPos){ toast('Buscando tu ubicación para ordenar por cercanía…'); locateMe(false); }
      renderPuntos();
    });
    // Personas desaparecidas: filtro por estado + búsqueda
    document.querySelectorAll('#filtro-desap .seg-btn').forEach(b=>b.onclick=()=>{
      filtroDesap=b.dataset.desap;
      document.querySelectorAll('#filtro-desap .seg-btn').forEach(x=>x.classList.toggle('active',x.dataset.desap===filtroDesap));
      renderDesaparecidos();
    });
    const dq=$('#desap-q'); if(dq) dq.oninput=()=>{ qDesap=dq.value; renderDesaparecidos(); };
    // Bienvenida / guía (primera vez, y siempre disponible con el botón "Ayuda")
    const showWelcome=()=>$('#welcome').classList.remove('hidden');
    const hideWelcome=()=>{ $('#welcome').classList.add('hidden'); cache('ay_seen', true); };
    $('#welcome-go').onclick=hideWelcome;
    const we=$('#welcome-entidad'); if(we) we.onclick=()=>{ hideWelcome(); openEntidad(); };
    $('#btn-guia').onclick=showWelcome;
    $('#btn-tour').onclick=showWelcome;
    if(!cache('ay_seen')) showWelcome();
    // MODO ENTIDADES: acceso desde la tarjeta de "Ayuda" y desde el banner de "Lugares"
    const be=$('#btn-entidad'); if(be) be.onclick=openEntidad;
    const ec=$('#ent-close'); if(ec) ec.onclick=closeEntidad;
    const eo=$('#entidad'); if(eo) eo.onclick=e=>{ if(e.target.id==='entidad') closeEntidad(); };
  }catch(e){ console.warn('wire-ui', e); }

  try{ renderAll(); }catch(e){ console.warn('renderAll', e); }

  try{
    $('#modal-close').onclick=closeModal;
    $('#modal').onclick=e=>{ if(e.target.id==='modal') closeModal(); };
    $('#btn-sync').onclick=()=>{ toast('Sincronizando…'); flush().then(pullAll); };
    $('#btn-share').onclick=()=>{ if(navigator.share) navigator.share({title:'Ayúdame Colombia', text:'App para coordinar ayudas del terremoto en Colombia', url:location.href}); else { navigator.clipboard&&navigator.clipboard.writeText(location.href); toast('Link copiado'); } };
    const _sugBtn=$('#sug-enviar'); if(_sugBtn) _sugBtn.onclick=enviarSugerencia;
  }catch(e){ console.warn('wire-extra', e); }

  window.addEventListener('online', ()=>{ setNet(true); flush(); });
  window.addEventListener('offline', ()=>setNet(false));

  try{ initMap(); }catch(e){ console.warn('initMap', e); }   // un error del mapa NUNCA debe frenar el resto del arranque (red, SW, botones)
  setTimeout(()=>{ try{ state.map&&state.map.invalidateSize(); }catch(e){} },300);
  pullAll();          // trae datos del servidor
  flush();            // envía lo pendiente
  pingLive();         // registra este dispositivo y trae el contador de visitantes
  // Refresco periódico. Antes eran 12s: con miles de celulares a la vez eso golpea muy
  // fuerte el servidor (n8n). Lo subimos a ~30–40s CON JITTER (cada celular elige un valor
  // distinto) para que 2.000 teléfonos NO consulten todos al mismo instante y se reparta la
  // carga. La app igual se siente en vivo: al reabrirla o recibir señal refresca al instante
  // (visibilitychange/focus/online más abajo), no hay que esperar el intervalo.
  const REFRESH_MS = ()=> 30000 + Math.floor(Math.random()*10000);   // 30–40 s por dispositivo
  (function loopRefresh(){ setTimeout(()=>{ if(navigator.onLine){ flush(); pullAll(); } loopRefresh(); }, REFRESH_MS()); })();
  setInterval(()=>{ if(navigator.onLine) pingLive(); }, 60000);            // latido del contador de visitantes (1 min)
  // refresco inmediato al volver a la app (otro celular ve el cambio al reabrir, no en 12s)
  document.addEventListener('visibilitychange', ()=>{ if(!document.hidden && navigator.onLine){ flush(); pullAll(); pingLive(); } });
  window.addEventListener('focus', ()=>{ if(navigator.onLine){ pullAll(); } });

  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('sw.js').catch(()=>{});
    // Respaldo de auto-sanación: si el service worker nuevo toma el control (o avisa que
    // se actualizó) y esta pestaña sigue con código viejo, se recarga UNA vez a la versión
    // fresca. Guardado con bandera para que NUNCA entre en bucle de recargas.
    let _recargando=false;
    const _recargarUnaVez=()=>{ if(_recargando) return; _recargando=true; location.reload(); };
    navigator.serviceWorker.addEventListener('controllerchange', _recargarUnaVez);
    navigator.serviceWorker.addEventListener('message', e=>{ if(e.data&&e.data.type==='sw-updated') _recargarUnaVez(); });
  }
}
// Arranca al cargar el DOM; si ya estaba listo (algunos navegadores in-app), arranca ya.
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
