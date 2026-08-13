# Red de Ayuda · Terremoto Colombia

App web (PWA) para coordinar ayudas tras el terremoto. Funciona sin internet, se instala en el celular sin tiendas.

- **Mapa de necesidades** por vereda/barrio con semáforo (rojo = abandonado, verde = cubierto).
- **Balance de ayudas**: qué falta y qué sobra por zona, para distribuir mejor.
- **Entregas** con foto y "marcar recibido" (a dónde llegó de verdad).
- **Ayudas y dinero**: cuentas y puntos de recolección + registro de aportes con comprobante y seguimiento.
- **Offline-first**: captura sin señal, sincroniza sola cuando vuelve la red.

Backend: proxy en n8n → Supabase (ninguna llave vive en el navegador).
