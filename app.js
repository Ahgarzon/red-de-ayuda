'use strict';
/* ================= Red de Ayuda · Terremoto Colombia ================= */
const API = 'https://n8n.angelautomatizacionesn8n.xyz/webhook/ayuda-api';
const SUG_API = 'https://n8n.angelautomatizacionesn8n.xyz/webhook/ayuda-sugerencia';
const LS = {
  puntos:'ay_puntos', entregas:'ay_entregas', fuentes:'ay_fuentes',
  aportes:'ay_aportes', queue:'ay_queue', user:'ay_user'
};
const ITEMS = ['Agua','Comida','Colchones','Cobijas','Pañales','Medicina','Ropa','Aseo','Carpas','Rescatistas'];

const state = { puntos:[], entregas:[], fuentes:[], aportes:[], queue:[], online:navigator.onLine, map:null, markers:null, myPos:null, fotos:{} };

/* ---------- util ---------- */
const $ = s => document.querySelector(s);
const cache = (k,v)=>{ if(v===undefined){ try{return JSON.parse(localStorage.getItem(k)||'null')}catch(e){return null} } localStorage.setItem(k,JSON.stringify(v)); };
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
/* Modo operador (ZOSA): abrir la app con  #op-zosa2026  desbloquea moderar TODO
   (marcar/cambiar/borrar cualquier reporte). Con  #op-off  se sale de ese modo. */
const OP_KEY = 'zosa2026';
(function(){
  const h = location.hash||'';
  if(h==='#op-off'){ try{localStorage.removeItem('ay_admin');}catch(e){} history.replaceState(null,'',location.pathname); }
  else if(h.indexOf('op-')>=0 && h.indexOf(OP_KEY)>=0){ cache('ay_admin', true); history.replaceState(null,'',location.pathname); }
})();
const isAdmin = ()=> !!cache('ay_admin');
/* ¿Este reporte lo puedo tocar? Sí si es mío, si soy operador, o si es un registro
   viejo que aún no tiene dueño (para no congelar lo creado antes de esta versión). */
function mine(rec){ return isAdmin() || !rec || !rec.owner || rec.owner===ME; }
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

/* ---------- backend ---------- */
async function api(action, table, extra={}){
  const body = Object.assign({action, table}, extra);
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
  setNet();
  const tablas = ['puntos','entregas','fuentes','aportes'];
  // Cada tabla se trae POR SEPARADO. Si una falla, NO se toca a las demás y
  // NUNCA se borra lo que ya estaba: pull() solo reemplaza cuando llega un array
  // válido del servidor; ante error conserva lo que había (cache/pendientes).
  // Esto es lo que evita que la app muestre 0 aunque los datos SÍ estén guardados.
  const res = await Promise.allSettled(tablas.map(pull));
  const ok = res.filter(r=>r.status==='fulfilled').length;
  setNet(ok>0);           // hay señal si al menos una tabla respondió
  renderAll();
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
  update(table, id, {archivado:true});   // persiste el archivado (offline-safe, se reintenta)
}

function enqueue(job){ state.queue.push(job); cache(LS.queue, state.queue); updatePending(); }

async function flush(){
  if(!state.queue.length) return;
  if(!navigator.onLine) return;
  const rest=[];
  for(const job of state.queue){
    try{
      if(job.op==='insert') await api('insert', job.table, {data:job.data});
      else if(job.op==='update') await api('update', job.table, {id:job.id, data:job.data});
      else if(job.op==='delete') await api('delete', job.table, {id:job.id});
    }catch(e){ rest.push(job); }
  }
  state.queue=rest; cache(LS.queue, state.queue); updatePending();
  if(rest.length===0){ toast('Todo sincronizado ✓'); await pullAll(); }
}

function updatePending(){
  const n = state.queue.length;
  const info = $('#pending-info');
  if(info) info.textContent = n ? ('Pendiente por enviar: '+n) : 'Todo sincronizado ✓';
}

/* ---------- estado de red ---------- */
function setNet(ok){
  const el=$('#netstatus'), lab=$('#netlabel');
  if(ok===undefined){ el.className='net'; lab.textContent='…'; return; }
  el.className = 'net '+(ok?'on':'off');
  lab.textContent = ok?'En línea':'Sin señal';
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

/* ================= RENDER ================= */
function renderAll(){ renderPuntos(); renderMap(); renderEntregas(); renderFuentes(); renderAportes(); updatePending(); }

let filtroDepto='__all';
let ordenPuntos='urgencia';   // 'urgencia' | 'cercania'
function renderPuntos(){
  const cont=$('#lista-puntos');
  const puntos=vivos('puntos');
  const deptos=[...new Set(puntos.map(p=>p.departamento).filter(Boolean))].sort();
  const fc=$('#filtros-depto');
  fc.innerHTML = ['__all',...deptos].map(d=>`<button class="chip ${filtroDepto===d?'active':''}" data-depto="${esc(d)}">${d==='__all'?'Todos':esc(d)}</button>`).join('');
  fc.querySelectorAll('.chip').forEach(b=>b.onclick=()=>{filtroDepto=b.dataset.depto;renderPuntos();});

  let list = puntos.slice();
  if(filtroDepto!=='__all') list=list.filter(p=>p.departamento===filtroDepto);

  const r=list.filter(p=>color(p)==='rojo'||color(p)==='rescate').length;
  const a=list.filter(p=>color(p)==='ambar').length;
  const g=list.filter(p=>color(p)==='verde').length;
  $('#resumen-balance').innerHTML =
    `<div class="stat r"><b>${r}</b><small>necesitan</small></div>
     <div class="stat a"><b>${a}</b><small>parciales</small></div>
     <div class="stat g"><b>${g}</b><small>cubiertos</small></div>`;

  if(!list.length){ cont.innerHTML='<div class="empty">Todavía no hay lugares anotados.<br>Toca el botón verde “＋ Avisar qué falta”.</div>'; return; }

  // dibuja una tarjeta de lugar (se reusa en los 3 modos: urgencia, cercanía y por zona)
  const cardPunto=p=>{
    const c=color(p);
    const dist = (state.myPos && p.lat!=null) ? distKm(state.myPos,[p.lat,p.lng]) : null;
    const falta=(p.faltan||[]).map(t=>`<span class="tag falta">− ${esc(t)}</span>`).join('');
    const sobra=(p.sobran||[]).map(t=>`<span class="tag sobra">+ ${esc(t)}</span>`).join('');
    return `<div class="card ${c}">
      <span class="badge ${c==='ambar'?'rojo':c}">${LABELS[c]}</span>
      ${p.urgencia&&p.urgencia!=='normal'?`<span class="badge urg">${URG_LABEL[p.urgencia]}</span>`:''}
      <h3>${esc(p.nombre)}${p._pending?' ⏳':''}</h3>
      <div class="meta">${esc([p.municipio,p.departamento].filter(Boolean).join(', '))} · ${p.personas||0} personas${dist!=null?' · <b>a '+fmtKm(dist)+'</b>':''}</div>
      ${p.necesita_rescate?'<div class="tag falta" style="display:inline-block">🚨 Faltan rescatistas</div>':''}
      <div class="tags">${falta}${sobra||(!falta?'<span class="tag plain">sin detalle</span>':'')}</div>
      ${p.nota?`<div class="meta" style="margin-top:8px">“${esc(p.nota)}”</div>`:''}
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
          munis[m].sort((x,y)=>urgScore(y)-urgScore(x)).map(cardPunto).join('')).join('')}
      </div>`;
    }).join('');
  } else {
    // ORDEN INTELIGENTE: por urgencia (rescate/vidas primero) o por cercanía a tu ubicación
    if(ordenPuntos==='cercania' && state.myPos){
      list.sort((x,y)=>{
        const dx=x.lat!=null?distKm(state.myPos,[x.lat,x.lng]):1e9;
        const dy=y.lat!=null?distKm(state.myPos,[y.lat,y.lng]):1e9;
        return dx-dy;
      });
    } else {
      list.sort((x,y)=>urgScore(y)-urgScore(x));  // mayor urgencia arriba
    }
    cont.innerHTML = list.map(cardPunto).join('');
  }
  cont.querySelectorAll('[data-cubierto]').forEach(b=>b.onclick=()=>update('puntos',b.dataset.cubierto,{estado:'cubierto'}));
  cont.querySelectorAll('[data-reabrir]').forEach(b=>b.onclick=()=>update('puntos',b.dataset.reabrir,{estado:'activo'}));
  cont.querySelectorAll('[data-editp]').forEach(b=>b.onclick=()=>{const p=state.puntos.find(x=>x.id==b.dataset.editp);if(p)openForm('punto',p,p.id);});
  cont.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>askConfirm('¿Ocultar este lugar?','Se quita de la lista y del mapa, pero queda guardado (no se pierde). Se puede recuperar.',()=>del('puntos',b.dataset.del)));
  cont.querySelectorAll('[data-vermapa]').forEach(b=>b.onclick=()=>{const p=state.puntos.find(x=>x.id==b.dataset.vermapa);if(p&&p.lat!=null){go('mapa');userMoved=true;setTimeout(()=>{state.map&&state.map.setView([p.lat,p.lng],15);},300);}else toast('Ese punto no tiene ubicación');});
}

/* Foto/comprobante: el listado ya NO trae las fotos base64 (eran enormes y tumbaban
   la carga). Se muestran bajo demanda: al tocar "Ver foto" se pide esa sola imagen. */
function fotoSlot(table,id,inline){
  const src = inline || state.fotos[id];
  if(src) return `<img class="card-photo" src="${src}" alt="">`;
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
  cont.innerHTML = entregas.map(e=>`
    <div class="card ${e.recibido?'verde':'ambar'}">
      <span class="badge ${e.recibido?'verde':'rojo'}">${e.recibido?'Recibido':'En camino'}</span>
      <h3>${esc(e.lugar||'Entrega')}${e._pending?' ⏳':''}</h3>
      <div class="meta">${esc(e.quien_entrego||'—')} · ${new Date(e.created_at).toLocaleDateString('es-CO',{day:'numeric',month:'short'})}</div>
      ${fotoSlot('entregas',e.id,e.foto)}
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
function renderFuentes(){
  const cont=$('#lista-fuentes');
  const fuentes=vivos('fuentes');
  if(!fuentes.length){ cont.innerHTML='<div class="empty">Todavía no hay cuentas ni puntos.<br>Toca “＋ Agregar una cuenta” para empezar.</div>'; return; }
  // acopios (donar cosas) primero, luego cuentas
  fuentes.sort((a,b)=>(a.tipo==='recoleccion'?0:1)-(b.tipo==='recoleccion'?0:1));
  cont.innerHTML = fuentes.map(f=>{
    const aportes=vivos('aportes').filter(a=>a.fuente_id===f.id);
    const conf=aportes.filter(a=>a.estado==='confirmado').length;
    const acopio=f.tipo==='recoleccion';
    const nec=(f.necesita||[]);
    const dist=(state.myPos&&f.lat!=null)?distKm(state.myPos,[f.lat,f.lng]):null;
    return `<div class="card ${acopio?'acopio':(f.verificada?'verde':'')}">
      <span class="badge ${acopio?'acopio':(f.verificada?'verde':'rojo')}">${acopio?'🏬 Centro de acopio':(f.verificada?'Verificada':'Sin verificar')}</span>
      <h3>${esc(f.nombre)}${f._pending?' ⏳':''}</h3>
      <div class="meta">${acopio?'Donar cosas (ropa, comida, colchones…)':'🏦 Cuenta bancaria'}${f.destino?' · 🚚 va a '+esc(f.destino):''}${dist!=null?' · <b>a '+fmtKm(dist)+'</b>':''}</div>
      ${acopio&&nec.length?`<div class="tags" style="margin-top:8px"><b style="font-size:.92em;color:#7c3aed;margin-right:4px">Necesitan:</b>${nec.map(t=>`<span class="tag falta">− ${esc(t)}</span>`).join('')}</div>`:''}
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
  cont.innerHTML = aportes.map(a=>{
    const f=state.fuentes.find(x=>x.id===a.fuente_id);
    return `<div class="card ${a.estado==='confirmado'?'verde':'ambar'}">
      <span class="badge ${a.estado==='confirmado'?'verde':'rojo'}">${a.estado==='confirmado'?'Confirmado ✓':'Reportado'}</span>
      <h3>$ ${esc(a.monto||'—')}${a._pending?' ⏳':''}</h3>
      <div class="meta">${esc(a.quien||'Anónimo')}${f?' → '+esc(f.nombre):''} · ${new Date(a.created_at).toLocaleDateString('es-CO',{day:'numeric',month:'short'})}</div>
      ${fotoSlot('aportes',a.id,a.comprobante)}
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
  return L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',{
    subdomains:'abcd', maxZoom:20, detectRetina:true, crossOrigin:true,
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
  const bl=$('#btn-locate'), bf=$('#btn-fitall');
  if(bl) bl.onclick=()=>locateMe(true);
  if(bf) bf.onclick=()=>{ userMoved=false; mapFitDone=false; fitToPoints(); };
  // ubicar al usuario suave al abrir (sin forzar si ya movió)
  locateMe(false);
  renderMap();
}
function locateMe(center){
  if(!navigator.geolocation || !state.map) return;
  navigator.geolocation.getCurrentPosition(p=>{
    state.myPos=[p.coords.latitude,p.coords.longitude];
    if(ordenPuntos==='cercania') renderPuntos();
    if(!state.map) return;
    const ll=[p.coords.latitude,p.coords.longitude];
    if(meMarker) state.map.removeLayer(meMarker);
    meMarker=L.circleMarker(ll,{radius:8,color:'#fff',weight:3,fillColor:'#2563eb',fillOpacity:1}).addTo(state.map);
    meMarker.bindPopup('Estás aquí');
    if(center){ userMoved=true; state.map.setView(ll,14); }
  }, ()=>{ if(center) toast('No se pudo obtener tu ubicación (permite el GPS)'); }, {enableHighAccuracy:true,timeout:8000});
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
  const cols={rojo:'#e0322f',ambar:'#e08608',verde:'#16a34a',rescate:'#db2777'};
  vivos('puntos').forEach(p=>{
    if(p.lat==null||p.lng==null) return;
    const c=color(p);
    const m=L.circleMarker([p.lat,p.lng],{radius:12,color:'#fff',weight:2,fillColor:cols[c],fillOpacity:.95});
    const falta=(p.faltan||[]).join(', ');
    m.bindPopup(`<b>${esc(p.nombre)}</b><br>${esc([p.municipio,p.departamento].filter(Boolean).join(', '))}<br>${p.personas||0} personas · <b>${LABELS[c]}</b>${falta?'<br>Falta: '+esc(falta):''}${p.necesita_rescate?'<br>🚨 Rescatistas':''}`);
    state.markers.addLayer(m);
  });
  vivos('entregas').forEach(e=>{
    if(e.lat==null||e.lng==null) return;
    const m=L.marker([e.lat,e.lng],{icon:pinIcon('#2563eb','📦')});
    m.bindPopup(`<b>📦 ${esc(e.lugar||'Entrega')}</b><br>${esc(e.items||'')}<br>${e.recibido?'Recibido ✓':'En camino'}`);
    state.markers.addLayer(m);
  });
  // Centros de acopio (donaciones físicas): marca morada con caja; muestra qué necesitan
  vivos('fuentes').forEach(f=>{
    if(f.tipo!=='recoleccion' || f.lat==null || f.lng==null) return;
    const nec=(f.necesita||[]).join(', ');
    const m=L.marker([f.lat,f.lng],{icon:pinIcon('#7c3aed','🏬')});
    m.bindPopup(`<b>🏬 ${esc(f.nombre)}</b><br>Centro de acopio${f.destino?' · va a '+esc(f.destino):''}${f.direccion?'<br>📍 '+esc(f.direccion):''}${nec?'<br><b>Necesitan:</b> '+esc(nec):''}`);
    state.markers.addLayer(m);
  });
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
function initPickMap(){
  const el=document.getElementById('pickmap'); if(!el||!window.L) return;
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
      <input type="file" accept="image/*" capture="environment" id="foto"><img class="photo-prev" id="prev">
      <label>¿Dónde se entregó? Ubícalo en el mapa</label>
      <div id="pickmap"></div>
      <div class="help" id="gps-info">Toca el mapa o arrastra el pin para marcar el lugar. O usa tu GPS.</div>
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
      </div>

      <label>¿A dónde va la ayuda? (destino del envío)</label><input name="destino" placeholder="Ej: Chocó, Cali, Buenaventura…" value="${esc(P.destino||'')}">
      <label>Contacto</label><input name="contacto" placeholder="WhatsApp / teléfono" value="${esc(P.contacto||'')}">
      <label>Nota</label><textarea name="nota" placeholder="Qué se recibe, horarios…">${esc(P.nota||'')}</textarea>
      <button class="btn-primary" type="submit">Guardar</button>`;
  } else if(kind==='aporte'){
    title.textContent='Anotar una donación';
    f.innerHTML=`
      <input type="hidden" name="fuente_id" value="${esc(prefill.fuente_id||'')}">
      <label>¿Quién aporta?</label><input name="quien" placeholder="Tu nombre (o anónimo)">
      <label>Monto</label><input name="monto" inputmode="decimal" placeholder="Ej: 50000">
      <label>Foto del comprobante</label>
      <input type="file" accept="image/*" id="foto"><img class="photo-prev" id="prev">
      <div class="help">Queda como prueba. Se marca “confirmado” cuando se verifica que llegó.</div>
      <button class="btn-primary" type="submit">Guardar donación</button>`;
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
      lat:gps.lat, lng:gps.lng, estado:'activo' };
  } else if(kind==='entrega'){
    if(!g('lugar')) return toast('Falta el lugar');
    table='entregas';
    data={ lugar:g('lugar'), quien_entrego:g('quien_entrego'), items:g('items'), foto:currentPhoto||null, lat:gps.lat, lng:gps.lng, recibido:false };
  } else if(kind==='fuente'){
    if(!g('nombre')) return toast('Falta el nombre');
    table='fuentes';
    const esAcopio=g('tipo')==='recoleccion';
    data={ nombre:g('nombre'), tipo:g('tipo'), banco:g('banco'), numero_cuenta:g('numero_cuenta'),
      titular:g('titular'), destino:g('destino'), contacto:g('contacto'), nota:g('nota'), verificada:false,
      necesita: esAcopio?readMulti('necesita'):null, direccion: esAcopio?g('direccion'):null,
      lat: esAcopio?gps.lat:null, lng: esAcopio?gps.lng:null };
  } else if(kind==='aporte'){
    table='aportes';
    data={ fuente_id:g('fuente_id')||null, quien:g('quien'), monto:g('monto'), comprobante:currentPhoto||null, estado:'reportado' };
  }
  const afterDonar=()=>{ if(table==='fuentes'||table==='aportes'){ segDonar= table==='aportes'?'aportes':'fuentes'; syncSeg(); } };
  if(editingKind===kind && editingId){
    const eid=editingId; editingId=null; editingKind=null;
    delete data.creado_por; delete data.estado;   // no reescribir dueño/estado al editar
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
function go(screen){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  $('#screen-'+screen).classList.add('active');
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active', t.dataset.screen===screen));
  if(screen==='mapa'){ initMap(); setTimeout(()=>state.map&&state.map.invalidateSize(),120); }
}
function closeModal(){ $('#modal').classList.add('hidden'); destroyPick(); editingId=null; editingKind=null; }
function syncSeg(){
  document.querySelectorAll('.seg-btn').forEach(b=>b.classList.toggle('active', b.dataset.seg===segDonar));
  $('#lista-fuentes').classList.toggle('hidden', segDonar!=='fuentes');
  $('#lista-aportes').classList.toggle('hidden', segDonar!=='aportes');
}

/* ================= INIT ================= */
function boot(){
  // cargar cache primero (instantáneo / offline)
  for(const t of ['puntos','entregas','fuentes','aportes']) state[t]=cache(LS[t])||[];
  state.queue=cache(LS.queue)||[];
  if(!cache(LS.user)){ /* nombre opcional, no obligamos */ }
  renderAll();

  document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>go(t.dataset.screen));
  document.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>openForm(b.dataset.add));
  document.querySelectorAll('.seg-btn').forEach(b=>b.onclick=()=>{segDonar=b.dataset.seg;syncSeg();});
  // toggle de orden en Lugares: por urgencia / por cercanía (sobrescribe el handler genérico de arriba)
  document.querySelectorAll('#orden-puntos .seg-btn').forEach(b=>b.onclick=()=>{
    ordenPuntos=b.dataset.orden;
    document.querySelectorAll('#orden-puntos .seg-btn').forEach(x=>x.classList.toggle('active',x.dataset.orden===ordenPuntos));
    if(ordenPuntos==='cercania' && !state.myPos){ toast('Buscando tu ubicación para ordenar por cercanía…'); locateMe(false); }
    renderPuntos();
  });
  // Bienvenida / guía (primera vez, y siempre disponible con el botón "Ayuda")
  const showWelcome=()=>$('#welcome').classList.remove('hidden');
  const hideWelcome=()=>{ $('#welcome').classList.add('hidden'); cache('ay_seen', true); };
  $('#welcome-go').onclick=hideWelcome;
  $('#btn-guia').onclick=showWelcome;
  $('#btn-tour').onclick=showWelcome;
  if(!cache('ay_seen')) showWelcome();

  $('#modal-close').onclick=closeModal;
  $('#modal').onclick=e=>{ if(e.target.id==='modal') closeModal(); };
  $('#btn-sync').onclick=()=>{ toast('Sincronizando…'); flush().then(pullAll); };
  $('#btn-share').onclick=()=>{ if(navigator.share) navigator.share({title:'Ayúdame Colombia', text:'App para coordinar ayudas del terremoto en Colombia', url:location.href}); else { navigator.clipboard&&navigator.clipboard.writeText(location.href); toast('Link copiado'); } };
  const _sugBtn=$('#sug-enviar'); if(_sugBtn) _sugBtn.onclick=enviarSugerencia;

  window.addEventListener('online', ()=>{ setNet(true); flush(); });
  window.addEventListener('offline', ()=>setNet(false));

  initMap();          // el mapa es la pantalla inicial
  setTimeout(()=>state.map&&state.map.invalidateSize(),300);
  pullAll();          // trae datos del servidor
  flush();            // envía lo pendiente
  setInterval(()=>{ if(navigator.onLine){ flush(); pullAll(); } }, 12000); // refresco periódico (payload liviano → seguro)
  // refresco inmediato al volver a la app (otro celular ve el cambio al reabrir, no en 12s)
  document.addEventListener('visibilitychange', ()=>{ if(!document.hidden && navigator.onLine){ flush(); pullAll(); } });
  window.addEventListener('focus', ()=>{ if(navigator.onLine){ pullAll(); } });

  if('serviceWorker' in navigator){ navigator.serviceWorker.register('sw.js').catch(()=>{}); }
}
document.addEventListener('DOMContentLoaded', boot);
