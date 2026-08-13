'use strict';
/* ================= Red de Ayuda · Terremoto Colombia ================= */
const API = 'https://n8n.angelautomatizacionesn8n.xyz/webhook/ayuda-api';
const LS = {
  puntos:'ay_puntos', entregas:'ay_entregas', fuentes:'ay_fuentes',
  aportes:'ay_aportes', queue:'ay_queue', user:'ay_user'
};
const ITEMS = ['Agua','Comida','Colchones','Cobijas','Pañales','Medicina','Ropa','Aseo','Carpas','Rescatistas'];

const state = { puntos:[], entregas:[], fuentes:[], aportes:[], queue:[], online:navigator.onLine, map:null, markers:null };

/* ---------- util ---------- */
const $ = s => document.querySelector(s);
const cache = (k,v)=>{ if(v===undefined){ try{return JSON.parse(localStorage.getItem(k)||'null')}catch(e){return null} } localStorage.setItem(k,JSON.stringify(v)); };
const uid = ()=> 'tmp_'+Date.now()+'_'+Math.random().toString(36).slice(2,7);
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.remove('hidden'); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.add('hidden'),2600); }
function esc(s){ return (s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

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
  if(Array.isArray(rows)){ state[table]=rows; cache(LS[table], rows); }
  return state[table];
}

async function pullAll(){
  setNet();
  try {
    await Promise.all(['puntos','entregas','fuentes','aportes'].map(pull));
    setNet(true);
  } catch(e){
    setNet(false);
    // usa cache
    for(const t of ['puntos','entregas','fuentes','aportes']) state[t]=cache(LS[t])||[];
  }
  renderAll();
}

/* Escritura offline-first: intenta enviar; si falla, encola y aplica local */
async function save(table, data){
  const rec = Object.assign({ id: uid(), created_at:new Date().toISOString(), _pending:true }, data);
  try {
    const res = await api('insert', table, { data });
    if(Array.isArray(res) && res[0]){
      state[table].unshift(res[0]); cache(LS[table], state[table]);
      renderAll(); return true;
    }
    throw new Error('sin respuesta');
  } catch(e){
    state[table].unshift(rec); cache(LS[table], state[table]);
    enqueue({op:'insert', table, data});
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

function enqueue(job){ state.queue.push(job); cache(LS.queue, state.queue); updatePending(); }

async function flush(){
  if(!state.queue.length) return;
  if(!navigator.onLine) return;
  const rest=[];
  for(const job of state.queue){
    try{
      if(job.op==='insert') await api('insert', job.table, {data:job.data});
      else if(job.op==='update') await api('update', job.table, {id:job.id, data:job.data});
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
const LABELS={rojo:'Necesita',ambar:'Parcial',verde:'Cubierto',rescate:'Rescate'};

/* ================= RENDER ================= */
function renderAll(){ renderPuntos(); renderMap(); renderEntregas(); renderFuentes(); renderAportes(); updatePending(); }

let filtroDepto='__all';
function renderPuntos(){
  const cont=$('#lista-puntos');
  const deptos=[...new Set(state.puntos.map(p=>p.departamento).filter(Boolean))].sort();
  const fc=$('#filtros-depto');
  fc.innerHTML = ['__all',...deptos].map(d=>`<button class="chip ${filtroDepto===d?'active':''}" data-depto="${esc(d)}">${d==='__all'?'Todos':esc(d)}</button>`).join('');
  fc.querySelectorAll('.chip').forEach(b=>b.onclick=()=>{filtroDepto=b.dataset.depto;renderPuntos();});

  let list = state.puntos.slice();
  if(filtroDepto!=='__all') list=list.filter(p=>p.departamento===filtroDepto);

  const r=list.filter(p=>color(p)==='rojo'||color(p)==='rescate').length;
  const a=list.filter(p=>color(p)==='ambar').length;
  const g=list.filter(p=>color(p)==='verde').length;
  $('#resumen-balance').innerHTML =
    `<div class="stat r"><b>${r}</b><small>necesitan</small></div>
     <div class="stat a"><b>${a}</b><small>parciales</small></div>
     <div class="stat g"><b>${g}</b><small>cubiertos</small></div>`;

  if(!list.length){ cont.innerHTML='<div class="empty">Aún no hay puntos reportados.<br>Toca “+ Reportar punto”.</div>'; return; }
  // rojos primero
  const ord={rescate:0,rojo:1,ambar:2,verde:3};
  list.sort((x,y)=>ord[color(x)]-ord[color(y)]);
  cont.innerHTML = list.map(p=>{
    const c=color(p);
    const falta=(p.faltan||[]).map(t=>`<span class="tag falta">− ${esc(t)}</span>`).join('');
    const sobra=(p.sobran||[]).map(t=>`<span class="tag sobra">+ ${esc(t)}</span>`).join('');
    return `<div class="card ${c}">
      <span class="badge ${c==='ambar'?'rojo':c}">${LABELS[c]}</span>
      <h3>${esc(p.nombre)}${p._pending?' ⏳':''}</h3>
      <div class="meta">${esc([p.municipio,p.departamento].filter(Boolean).join(', '))} · ${p.personas||0} personas</div>
      ${p.necesita_rescate?'<div class="tag falta" style="display:inline-block">🚨 Faltan rescatistas</div>':''}
      <div class="tags">${falta}${sobra||(!falta?'<span class="tag plain">sin detalle</span>':'')}</div>
      ${p.nota?`<div class="meta" style="margin-top:8px">“${esc(p.nota)}”</div>`:''}
      <div class="card-actions">
        <button class="btn-mini acc" data-vermapa="${p.id}">Ver en mapa</button>
        ${p.estado!=='cubierto'?`<button class="btn-mini ok" data-cubierto="${p.id}">Marcar cubierto</button>`:`<button class="btn-mini" data-reabrir="${p.id}">Reabrir</button>`}
      </div>
    </div>`;
  }).join('');
  cont.querySelectorAll('[data-cubierto]').forEach(b=>b.onclick=()=>update('puntos',b.dataset.cubierto,{estado:'cubierto'}));
  cont.querySelectorAll('[data-reabrir]').forEach(b=>b.onclick=()=>update('puntos',b.dataset.reabrir,{estado:'activo'}));
  cont.querySelectorAll('[data-vermapa]').forEach(b=>b.onclick=()=>{const p=state.puntos.find(x=>x.id==b.dataset.vermapa);if(p&&p.lat){go('mapa');setTimeout(()=>{state.map.setView([p.lat,p.lng],14);},250);}else toast('Ese punto no tiene ubicación');});
}

function renderEntregas(){
  const cont=$('#lista-entregas');
  if(!state.entregas.length){ cont.innerHTML='<div class="empty">Sin entregas registradas.<br>Toca “+ Registrar entrega”.</div>'; return; }
  cont.innerHTML = state.entregas.map(e=>`
    <div class="card ${e.recibido?'verde':'ambar'}">
      <span class="badge ${e.recibido?'verde':'rojo'}">${e.recibido?'Recibido':'En camino'}</span>
      <h3>${esc(e.lugar||'Entrega')}${e._pending?' ⏳':''}</h3>
      <div class="meta">${esc(e.quien_entrego||'—')} · ${new Date(e.created_at).toLocaleDateString('es-CO',{day:'numeric',month:'short'})}</div>
      ${e.foto?`<img class="card-photo" src="${e.foto}" alt="">`:''}
      <div class="tags"><span class="tag plain">${esc(e.items||'ayuda')}</span></div>
      ${e.recibido&&e.recibido_por?`<div class="meta" style="margin-top:8px">Recibido por: ${esc(e.recibido_por)}</div>`:''}
      <div class="card-actions">
        ${!e.recibido?`<button class="btn-mini ok" data-recibido="${e.id}">Marcar recibido</button>`:''}
      </div>
    </div>`).join('');
  cont.querySelectorAll('[data-recibido]').forEach(b=>b.onclick=()=>{
    const quien=prompt('¿Quién recibió la ayuda? (nombre o lugar)'); if(quien===null)return;
    update('entregas',b.dataset.recibido,{recibido:true, recibido_por:quien||'confirmado'});
  });
}

let segDonar='fuentes';
function renderFuentes(){
  const cont=$('#lista-fuentes');
  if(!state.fuentes.length){ cont.innerHTML='<div class="empty">Sin cuentas ni puntos de recolección.<br>Agrega una para empezar.</div>'; return; }
  cont.innerHTML = state.fuentes.map(f=>{
    const aportes=state.aportes.filter(a=>a.fuente_id===f.id);
    const conf=aportes.filter(a=>a.estado==='confirmado').length;
    return `<div class="card ${f.verificada?'verde':''}">
      <span class="badge ${f.verificada?'verde':'rojo'}">${f.verificada?'Verificada':'Sin verificar'}</span>
      <h3>${esc(f.nombre)}${f._pending?' ⏳':''}</h3>
      <div class="meta">${f.tipo==='recoleccion'?'📍 Punto de recolección':'🏦 Cuenta bancaria'}${f.destino?' · va a '+esc(f.destino):''}</div>
      ${f.numero_cuenta?`<div class="acct"><span>${esc(f.banco?f.banco+' ':'')}${esc(f.numero_cuenta)}</span><button class="btn-mini" data-copy="${esc(f.numero_cuenta)}">Copiar</button></div>`:''}
      ${f.titular?`<div class="meta" style="margin-top:6px">Titular: ${esc(f.titular)}</div>`:''}
      ${f.contacto?`<div class="meta">Contacto: ${esc(f.contacto)}</div>`:''}
      <div class="meta" style="margin-top:6px">${aportes.length} aporte(s) · ${conf} confirmado(s)</div>
      <div class="card-actions">
        <button class="btn-mini acc" data-aportar="${f.id}">Registrar aporte</button>
        ${!f.verificada?`<button class="btn-mini ok" data-verificar="${f.id}">Marcar verificada</button>`:''}
      </div>
    </div>`;
  }).join('');
  cont.querySelectorAll('[data-copy]').forEach(b=>b.onclick=()=>{navigator.clipboard&&navigator.clipboard.writeText(b.dataset.copy);toast('Número copiado');});
  cont.querySelectorAll('[data-aportar]').forEach(b=>b.onclick=()=>openForm('aporte',{fuente_id:b.dataset.aportar}));
  cont.querySelectorAll('[data-verificar]').forEach(b=>b.onclick=()=>update('fuentes',b.dataset.verificar,{verificada:true}));
}

function renderAportes(){
  const cont=$('#lista-aportes');
  if(!state.aportes.length){ cont.innerHTML='<div class="empty">Sin aportes registrados todavía.</div>'; return; }
  cont.innerHTML = state.aportes.map(a=>{
    const f=state.fuentes.find(x=>x.id===a.fuente_id);
    return `<div class="card ${a.estado==='confirmado'?'verde':'ambar'}">
      <span class="badge ${a.estado==='confirmado'?'verde':'rojo'}">${a.estado==='confirmado'?'Confirmado ✓':'Reportado'}</span>
      <h3>$ ${esc(a.monto||'—')}${a._pending?' ⏳':''}</h3>
      <div class="meta">${esc(a.quien||'Anónimo')}${f?' → '+esc(f.nombre):''} · ${new Date(a.created_at).toLocaleDateString('es-CO',{day:'numeric',month:'short'})}</div>
      ${a.referencia?`<div class="meta">Ref: ${esc(a.referencia)}</div>`:''}
      ${a.comprobante?`<img class="card-photo" src="${a.comprobante}" alt="">`:''}
      <div class="card-actions">
        ${a.estado!=='confirmado'?`<button class="btn-mini ok" data-confirmar="${a.id}">Confirmar llegada</button>`:''}
      </div>
    </div>`;
  }).join('');
  cont.querySelectorAll('[data-confirmar]').forEach(b=>b.onclick=()=>{
    const por=prompt('¿Quién confirma que el dinero llegó?'); if(por===null)return;
    update('aportes',b.dataset.confirmar,{estado:'confirmado', confirmado_por:por||'confirmado'});
  });
}

/* ================= MAPA ================= */
function initMap(){
  if(state.map) return;
  state.map = L.map('map',{zoomControl:true}).setView([4.1,-74.5], 6); // Colombia
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18, attribution:'© OpenStreetMap'}).addTo(state.map);
  state.markers = L.layerGroup().addTo(state.map);
  // ubicar al usuario
  navigator.geolocation && navigator.geolocation.getCurrentPosition(
    p=>{ if(state.map) state.map.setView([p.coords.latitude,p.coords.longitude],11); }, ()=>{}, {timeout:6000});
  renderMap();
}
function renderMap(){
  if(!state.markers) return;
  state.markers.clearLayers();
  const cols={rojo:'#dc2626',ambar:'#d97706',verde:'#16a34a',rescate:'#7c3aed'};
  state.puntos.forEach(p=>{
    if(p.lat==null||p.lng==null) return;
    const c=color(p);
    const m=L.circleMarker([p.lat,p.lng],{radius:11,color:'#fff',weight:2,fillColor:cols[c],fillOpacity:.95});
    const falta=(p.faltan||[]).join(', ');
    m.bindPopup(`<b>${esc(p.nombre)}</b><br>${esc([p.municipio,p.departamento].filter(Boolean).join(', '))}<br>${p.personas||0} personas · <b>${LABELS[c]}</b>${falta?'<br>Falta: '+esc(falta):''}${p.necesita_rescate?'<br>🚨 Rescatistas':''}`);
    state.markers.addLayer(m);
  });
  state.entregas.forEach(e=>{
    if(e.lat==null||e.lng==null) return;
    const m=L.marker([e.lat,e.lng]);
    m.bindPopup(`<b>📦 ${esc(e.lugar||'Entrega')}</b><br>${esc(e.items||'')}<br>${e.recibido?'Recibido ✓':'En camino'}`);
    state.markers.addLayer(m);
  });
}

/* ================= FORMULARIOS ================= */
let currentPhoto=null, gps={lat:null,lng:null};
function openForm(kind, prefill={}){
  currentPhoto=null; gps={lat:null,lng:null};
  const f=$('#modal-form'); const title=$('#modal-title');
  const multi=(name,arr)=>`<div class="multi" data-multi="${name}">${ITEMS.map(i=>`<span class="opt" data-val="${i}">${i}</span>`).join('')}</div>`;
  if(kind==='punto'){
    title.textContent='Reportar punto de necesidad';
    f.innerHTML=`
      <label>Nombre del lugar *</label><input name="nombre" placeholder="Vereda, barrio, corregimiento" required>
      <div class="row2"><div><label>Municipio</label><input name="municipio" placeholder="Ej: Timbío"></div>
      <div><label>Departamento</label><input name="departamento" placeholder="Ej: Cauca"></div></div>
      <label>¿Cuántas personas?</label><input name="personas" type="number" inputmode="numeric" placeholder="Ej: 40">
      <label>¿Qué FALTA aquí? (toca lo que aplique)</label>${multi('faltan')}
      <label>¿Qué SOBRA / ya llegó?</label>${multi('sobran')}
      <label><input type="checkbox" name="necesita_rescate" style="width:auto;display:inline;margin-right:8px">🚨 Faltan rescatistas / gente atrapada</label>
      <label>Nota (opcional)</label><textarea name="nota" placeholder="Detalles: qué se necesita con urgencia, cómo llegar…"></textarea>
      <button type="button" class="gps-btn" id="gps">📍 Usar mi ubicación (GPS)</button>
      <div class="help" id="gps-info">Sirve sin datos: el GPS funciona sin señal.</div>
      <button class="btn-primary" type="submit">Guardar punto</button>`;
  } else if(kind==='entrega'){
    title.textContent='Registrar entrega';
    f.innerHTML=`
      <label>¿A dónde se entregó? *</label><input name="lugar" placeholder="Lugar / vereda / punto" required>
      <label>¿Quién entrega?</label><input name="quien_entrego" placeholder="Tu nombre u organización">
      <label>¿Qué se entregó?</label><input name="items" placeholder="Ej: 20 colchones, agua, mercados">
      <label>Foto de la entrega (prueba)</label>
      <input type="file" accept="image/*" capture="environment" id="foto"><img class="photo-prev" id="prev">
      <button type="button" class="gps-btn" id="gps">📍 Marcar ubicación</button>
      <div class="help" id="gps-info"></div>
      <button class="btn-primary" type="submit">Guardar entrega</button>`;
  } else if(kind==='fuente'){
    title.textContent='Agregar cuenta / punto de recolección';
    f.innerHTML=`
      <label>Nombre *</label><input name="nombre" placeholder="Ej: Cruz Roja Cauca / Colecta Popayán" required>
      <label>Tipo</label><select name="tipo"><option value="cuenta">Cuenta bancaria</option><option value="recoleccion">Punto de recolección físico</option></select>
      <div class="row2"><div><label>Banco</label><input name="banco" placeholder="Bancolombia, Nequi…"></div>
      <div><label>N° cuenta / celular</label><input name="numero_cuenta" placeholder="000-000000-00"></div></div>
      <label>Titular</label><input name="titular" placeholder="A nombre de">
      <label>¿A dónde va la ayuda?</label><input name="destino" placeholder="Ej: Chocó, Cali…">
      <label>Contacto</label><input name="contacto" placeholder="WhatsApp / teléfono">
      <label>Nota</label><textarea name="nota" placeholder="Qué se recibe, horarios…"></textarea>
      <button class="btn-primary" type="submit">Guardar</button>`;
  } else if(kind==='aporte'){
    title.textContent='Registrar aporte';
    f.innerHTML=`
      <input type="hidden" name="fuente_id" value="${esc(prefill.fuente_id||'')}">
      <label>¿Quién aporta?</label><input name="quien" placeholder="Tu nombre (o anónimo)">
      <label>Monto</label><input name="monto" inputmode="decimal" placeholder="Ej: 50000">
      <label>Referencia / N° de transacción</label><input name="referencia" placeholder="Del comprobante">
      <label>Foto del comprobante</label>
      <input type="file" accept="image/*" id="foto"><img class="photo-prev" id="prev">
      <div class="help">Queda como prueba. Se marca “confirmado” cuando se verifica que llegó.</div>
      <button class="btn-primary" type="submit">Registrar aporte</button>`;
  }
  // multi toggles
  f.querySelectorAll('.multi .opt').forEach(o=>o.onclick=()=>o.classList.toggle('on'));
  // gps
  const gbtn=f.querySelector('#gps');
  if(gbtn) gbtn.onclick=()=>{
    const info=f.querySelector('#gps-info'); info.textContent='Ubicando…';
    navigator.geolocation.getCurrentPosition(p=>{
      gps.lat=+p.coords.latitude.toFixed(6); gps.lng=+p.coords.longitude.toFixed(6);
      info.textContent='📍 Ubicación lista ('+gps.lat+', '+gps.lng+')'; gbtn.style.background='#d5efec';
    }, ()=>{ info.textContent='No se pudo obtener el GPS (permite la ubicación).'; }, {enableHighAccuracy:true,timeout:8000});
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
      personas: parseInt(g('personas'))||0, faltan:readMulti('faltan'), sobran:readMulti('sobran'),
      necesita_rescate: !!fd.get('necesita_rescate'), nota:g('nota'), creado_por: cache(LS.user)||'',
      lat:gps.lat, lng:gps.lng, estado:'activo' };
  } else if(kind==='entrega'){
    if(!g('lugar')) return toast('Falta el lugar');
    table='entregas';
    data={ lugar:g('lugar'), quien_entrego:g('quien_entrego'), items:g('items'), foto:currentPhoto||null, lat:gps.lat, lng:gps.lng, recibido:false };
  } else if(kind==='fuente'){
    if(!g('nombre')) return toast('Falta el nombre');
    table='fuentes';
    data={ nombre:g('nombre'), tipo:g('tipo'), banco:g('banco'), numero_cuenta:g('numero_cuenta'),
      titular:g('titular'), destino:g('destino'), contacto:g('contacto'), nota:g('nota'), verificada:false };
  } else if(kind==='aporte'){
    table='aportes';
    data={ fuente_id:g('fuente_id')||null, quien:g('quien'), monto:g('monto'), referencia:g('referencia'), comprobante:currentPhoto||null, estado:'reportado' };
  }
  closeModal();
  save(table, data).then(()=>{ if(table==='fuentes'||table==='aportes'){ segDonar= table==='aportes'?'aportes':'fuentes'; syncSeg(); } });
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
function closeModal(){ $('#modal').classList.add('hidden'); }
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
  $('#modal-close').onclick=closeModal;
  $('#modal').onclick=e=>{ if(e.target.id==='modal') closeModal(); };
  $('#btn-sync').onclick=()=>{ toast('Sincronizando…'); flush().then(pullAll); };
  $('#btn-share').onclick=()=>{ if(navigator.share) navigator.share({title:'Red de Ayuda', text:'App para coordinar ayudas del terremoto en Colombia', url:location.href}); else { navigator.clipboard&&navigator.clipboard.writeText(location.href); toast('Link copiado'); } };

  window.addEventListener('online', ()=>{ setNet(true); flush(); });
  window.addEventListener('offline', ()=>setNet(false));

  pullAll();          // trae datos del servidor
  flush();            // envía lo pendiente
  setInterval(()=>{ if(navigator.onLine){ flush(); pullAll(); } }, 45000); // refresco periódico

  if('serviceWorker' in navigator){ navigator.serviceWorker.register('sw.js').catch(()=>{}); }
}
document.addEventListener('DOMContentLoaded', boot);
