/* Genera base-tiles.js: el mapa de Colombia que se PRECARGA en el service worker para que
   NUNCA quede en blanco sin señal. Estrategia por capas (de menos a más detalle):
     - Todo el país a bajo zoom (orientación general).
     - Suroccidente (Nariño-Cauca-Valle-Chocó) a zoom medio.
     - Los 3 departamentos MÁS afectados (Chocó, Valle del Cauca, Cauca) a zoom alto,
       para que ahí se pueda ubicar y MARCAR un punto aunque no haya internet.
     - Cabeceras/municipios clave a nivel calle-barrio (zoom 13).
   Un solo subdominio 'a', sin retina → cada tile tiene UNA sola URL y calza exacto con lo
   que pide Leaflet (ver baseTiles() en app.js).  Uso:  node scripts/gen-base-tiles.mjs        */
import fs from 'fs';

function lon2x(lon, z){ return Math.floor((lon + 180) / 360 * Math.pow(2, z)); }
function lat2y(lat, z){
  const r = lat * Math.PI / 180;
  return Math.floor((1 - Math.log(Math.tan(r) + 1/Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z));
}
const tiles = new Set();
function addBox(name, latMin, latMax, lonMin, lonMax, zMin, zMax){
  let n = 0;
  for(let z = zMin; z <= zMax; z++){
    const x0 = lon2x(lonMin, z), x1 = lon2x(lonMax, z);
    const y0 = lat2y(latMax, z), y1 = lat2y(latMin, z); // y crece hacia el sur
    for(let x = x0; x <= x1; x++) for(let y = y0; y <= y1; y++){
      const u = `https://a.basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}.png`;
      if(!tiles.has(u)){ tiles.add(u); n++; }
    }
  }
  console.error(`  ${name}: +${n} (z${zMin}-${zMax})`);
}
// Cuadro alrededor de una ciudad (±half grados) a nivel barrio
function addCity(name, lat, lon, half, zMin, zMax){
  addBox(name, lat-half, lat+half, lon-half, lon+half, zMin, zMax);
}

// 1) TODO Colombia — orientación de país (coarse)
addBox('Colombia', -4.3, 13.5, -79.1, -66.8, 4, 7);

// 2) Suroccidente (zona del terremoto ampliada) — zoom medio
addBox('Suroccidente', 1.2, 8.9, -78.2, -75.2, 8, 9);

// 3) Los 3 departamentos MÁS afectados — región completa a zoom 10 (ubica municipios/ríos/vías
//    aunque no haya señal). El detalle de barrio (z11-13) va concentrado en las cabeceras (paso 4),
//    que es donde de verdad se marca un punto; el bbox incluye Pacífico/selva y no vale cargarlo fino.
addBox('Choco-Valle-Cauca', 1.4, 8.9, -78.1, -75.4, 10, 10);

// 4) Cabeceras y municipios clave — nivel calle/barrio (z12-13) para poder marcar el punto
const CITIES = [
  ['Quibdo (Choco)',        5.694, -76.658],
  ['Istmina (Choco)',       5.160, -76.685],
  ['Condoto (Choco)',       5.091, -76.651],
  ['Tado (Choco)',          5.264, -76.561],
  ['Nuqui (Choco)',         5.709, -77.271],
  ['Bahia Solano (Choco)',  6.223, -77.401],
  ['Buenaventura (Valle)',  3.884, -77.069],
  ['Cali (Valle)',          3.451, -76.532],
  ['Palmira (Valle)',       3.539, -76.303],
  ['Tulua (Valle)',         4.086, -76.196],
  ['Cartago (Valle)',       4.746, -75.911],
  ['Popayan (Cauca)',       2.444, -76.614],
  ['Santander Q. (Cauca)',  3.007, -76.485],
  ['Puerto Tejada (Cauca)', 3.234, -76.419],
  ['Timbio (Cauca)',        2.354, -76.684],
  ['Guapi (Cauca)',         2.571, -77.887],
  ['El Bordo/Patia (Cauca)',2.120, -76.977],
  ['Lopez de Micay (Cauca)',2.847, -77.251],
  ['Timbiqui (Cauca)',      2.777, -77.680],
];
// Todos los municipios a z11-12 (suficiente para reconocer barrio y marcar el punto)
for(const [n, la, lo] of CITIES) addCity(n, la, lo, 0.13, 11, 12);
// Las 4 ciudades grandes, además a z13 (nivel calle)
const BIG = [
  ['Cali z13',         3.451, -76.532],
  ['Buenaventura z13', 3.884, -77.069],
  ['Popayan z13',      2.444, -76.614],
  ['Quibdo z13',       5.694, -76.658],
];
for(const [n, la, lo] of BIG) addCity(n, la, lo, 0.10, 13, 13);
// Cascos urbanos donde de verdad se marca y se hace mucho zoom → nivel CALLE FINO (z14) para que
// offline se vea NÍTIDO, no solo ampliado por el respaldo. Radio chico para no inflar la descarga.
const CORE = [
  ['Popayan z14',      2.444, -76.614],
  ['Cali z14',         3.451, -76.532],
  ['Buenaventura z14', 3.884, -77.069],
  ['Quibdo z14',       5.694, -76.658],
  ['Timbio z14',       2.354, -76.684],
  ['El Bordo z14',     2.120, -76.977],
];
for(const [n, la, lo] of CORE) addCity(n, la, lo, 0.05, 14, 14);

const arr = Array.from(tiles);
console.error(`TOTAL: ${arr.length} tiles  (~${Math.round(arr.length*14/1024*10)/10} MB aprox @14KB/tile)`);
const header = `/* Mapa base de Colombia para uso SIN señal. Capas: país (z4-7), suroccidente (z8-9),\n   Choco+Valle+Cauca (z10), cabeceras a nivel barrio (z11-12) y cascos urbanos clave a nivel\n   CALLE FINO (z13-14). Combinado con la capa Respaldo (app.js: si falta un tile se amplía el\n   de la región de abajo ya cacheada), el mapa de la zona del terremoto NUNCA queda azul sin\n   señal. Generado por scripts/gen-base-tiles.mjs — NO editar a mano. */\n`;
const out = header + 'self.BASE_TILES=' + JSON.stringify(arr) + ';\n';
fs.writeFileSync(new URL('../base-tiles.js', import.meta.url), out);
console.error('Escrito base-tiles.js');
