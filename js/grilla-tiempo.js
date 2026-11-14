// Grilla de boxes por tiempo: filas cada 5 minutos, turnos y bloqueos con
// su hora y duración exactas. Lógica pura (sin DOM ni Firestore) — se prueba
// sola en tests/grilla-tiempo.
//
// · Las filas van de la apertura al cierre de cada franja del día (mañana y
//   tarde), cada PASO_GRILLA minutos. Si hay un turno o bloqueo fuera de ese
//   horario, se agregan las filas que lo cubren: nunca queda nada oculto.
// · Un turno ocupa las filas que su intervalo [inicio, fin) toca. Si no está
//   alineado (ej. 8:12 en filas de 5 min) la tarjeta se ubica en proporción:
//   empieza dentro de la fila de las 8:10.
// · Los turnos de un mismo box que comparten alguna fila forman un "grupo":
//   una sola celda con rowspan y las tarjetas adentro en su posición.

export const PASO_GRILLA = 5;

// Horario por defecto de la Grilla (todos los días). Se puede reemplazar por
// día de semana con configuracion/horarioGrilla en Firestore:
//   { dias: { "1": [{ desde: "08:00", hasta: "13:00" }, ...], "0": [] } }
// (0 = domingo … 6 = sábado). "hasta" es el cierre: la última fila empieza
// PASO_GRILLA minutos antes.
export const HORARIO_GRILLA_DEFECTO = [
  // Se arranca a las 08:00: la franja de 07:00 a 08:00 queda oculta (se ve
  // con «+ Horario extra» para un pedido especial).
  { desde: '08:00', hasta: '13:30' },
  { desde: '14:00', hasta: '21:00' },
];

export const aMin = (h) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(h || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
export const aHora = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

// Formato de la Grilla: siempre HH:MM ("08:00", "08:05", "16:30").
export function etiquetaHora(hora) {
  const min = typeof hora === 'number' ? hora : aMin(hora);
  if (!Number.isFinite(min)) return String(hora || '');
  return aHora(min);
}

// Franjas del día (en minutos) según la configuración por día de semana.
export function franjasDelDia(config, diaSemana) {
  const dias = config && config.dias;
  const lista = dias && Array.isArray(dias[String(diaSemana)]) ? dias[String(diaSemana)] : HORARIO_GRILLA_DEFECTO;
  return lista
    .map((f) => ({ desde: aMin(f.desde), hasta: aMin(f.hasta) }))
    .filter((f) => Number.isFinite(f.desde) && Number.isFinite(f.hasta) && f.hasta > f.desde)
    .sort((a, b) => a.desde - b.desde);
}

// Filas de la Grilla: [{ min, hora, etiqueta, dentro }]
//   franjas: [{ desde, hasta }] en minutos · eventos: [{ ini, fin }] en minutos
//   extra: muestra también las filas fuera de horario (de la primera franja,
//   o las 7, hasta las 24) para poder habilitarlas.
export function generarFilas({ franjas, eventos = [], extra = false, paso = PASO_GRILLA }) {
  const set = new Set();
  const dentroDe = (min) => franjas.some((f) => min >= f.desde && min < f.hasta);
  for (const f of franjas) {
    const ini = Math.floor(f.desde / paso) * paso;
    for (let m = ini; m < f.hasta; m += paso) set.add(m);
  }
  if (extra) {
    const desde = Math.min(7 * 60, ...franjas.map((f) => Math.floor(f.desde / paso) * paso));
    for (let m = desde; m < 24 * 60; m += paso) set.add(m);
  }
  for (const e of eventos) {
    if (!Number.isFinite(e.ini)) continue;
    const fin = Number.isFinite(e.fin) && e.fin > e.ini ? e.fin : e.ini + paso;
    for (let m = Math.floor(e.ini / paso) * paso; m < fin; m += paso) set.add(m);
  }
  return [...set].sort((a, b) => a - b).map((min) => ({ min, hora: aHora(min), etiqueta: etiquetaHora(min), dentro: dentroDe(min) }));
}

export const solapan = (aIni, aFin, bIni, bFin) => aIni < bFin && bIni < aFin;

// Índices de filas que toca el intervalo [ini, fin).
export function filasDeIntervalo(filas, ini, fin, paso = PASO_GRILLA) {
  const out = [];
  filas.forEach((f, i) => { if (solapan(f.min, f.min + paso, ini, fin)) out.push(i); });
  return out;
}

// Agrupa los turnos de UN box. items: [{ id, ini, fin, ... }] (minutos).
// → [{ filaIni, filaFin, items: [{ ...item, top, bottom, carril, carriles }] }]
//   top/bottom: fracción del alto del grupo libre arriba/abajo de la tarjeta.
//   carril/carriles: si dos turnos se pisan en el tiempo, van lado a lado.
export function agruparTurnos(items, filas, paso = PASO_GRILLA) {
  const conFilas = items
    .map((it) => {
      const idx = filasDeIntervalo(filas, it.ini, it.fin, paso);
      return idx.length ? { ...it, a: idx[0], b: idx[idx.length - 1] } : null;
    })
    .filter(Boolean)
    .sort((x, y) => x.a - y.a || x.ini - y.ini);
  const grupos = [];
  for (const it of conFilas) {
    const g = grupos[grupos.length - 1];
    if (g && it.a <= g.filaFin) { g.items.push(it); g.filaFin = Math.max(g.filaFin, it.b); }
    else grupos.push({ filaIni: it.a, filaFin: it.b, items: [it] });
  }
  for (const g of grupos) {
    const t0 = filas[g.filaIni].min, t1 = filas[g.filaFin].min + paso, total = t1 - t0;
    // Carriles: reparto codicioso por solapamiento real de tiempo.
    const finCarril = [];
    for (const it of g.items.sort((x, y) => x.ini - y.ini)) {
      let c = finCarril.findIndex((f) => f <= it.ini);
      if (c < 0) { c = finCarril.length; finCarril.push(it.fin); } else finCarril[c] = it.fin;
      it.carril = c;
      it.top = Math.max(0, (it.ini - t0) / total);
      it.bottom = Math.max(0, (t1 - it.fin) / total);
      delete it.a; delete it.b;
    }
    g.items.forEach((it) => { it.carriles = finCarril.length; });
  }
  return grupos;
}

// Bloqueos de admin: { hora, duracionMinutos } — los viejos no guardaban
// duración: eran de una fila de 15 min.
export const DURACION_BLOQUEO_LEGADO = 15;
export function intervaloBloqueo(b) {
  const ini = aMin(b.hora);
  const dur = Number(b.duracionMinutos) > 0 ? Number(b.duracionMinutos) : DURACION_BLOQUEO_LEGADO;
  return { ini, fin: ini + dur };
}
// Bloqueos que tocan la fila [min, min + paso).
export function bloqueosDeFila(bloqueos, min, paso = PASO_GRILLA) {
  return bloqueos.filter((b) => { const { ini, fin } = intervaloBloqueo(b); return solapan(ini, fin, min, min + paso); });
}

// Primer turno del mismo box que se pisa con [ini, fin) (para el alta y el
// arrastre). turnos: [{ id, ini, fin }].
export function turnoQueSePisa(turnos, ini, fin, excluirId) {
  return turnos.find((t) => t.id !== excluirId && solapan(t.ini, t.fin, ini, fin)) || null;
}
