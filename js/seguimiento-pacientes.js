// Seguimiento de pacientes para el panel admin (Ficha 360°, tarjetas de la
// Grilla, Recordatorios y Control de retorno). Lógica pura — sin DOM ni
// Firestore — para poder probarla sola (tests/seguimiento-pacientes).
//
// Nada de acá inventa datos: todo se deriva de las reservas, las fichas de
// clients y los registros de contactosWhatsApp que ya existen. Las
// funciones que necesitan criterios propios de admin.html (identidad del
// paciente, si una reserva está activa o si su horario ya terminó) los
// reciben inyectados, así se usa exactamente la misma regla que el resto
// del panel (_pacienteMatchKey, esReservaActiva, _esSesionPendiente).

const MS_DIA = 86400000;

// Días enteros entre dos fechas ISO (YYYY-MM-DD), b - a. null si falta alguna.
export function diasEntre(aISO, bISO) {
  if (!aISO || !bISO) return null;
  const a = Date.UTC(+aISO.slice(0, 4), +aISO.slice(5, 7) - 1, +aISO.slice(8, 10));
  const b = Date.UTC(+bISO.slice(0, 4), +bISO.slice(5, 7) - 1, +bISO.slice(8, 10));
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / MS_DIA);
}

const claveOrden = (r) => `${r.fecha || ''}T${(r.hora || '').toString().padStart(5, '0')}`;

// Agrupa las reservas por paciente.
// opciones: { claveDe(r), esActiva(r), yaTermino(r), hoyISO }
// Devuelve Map(clave → { realizadas[], proximas[], canceladas[], todas[] })
// — todas en orden cronológico ascendente. "Realizada" = activa y su horario
// ya terminó (mismo criterio que "Sesiones realizadas" del panel); "próxima"
// = activa, fecha >= hoy y todavía no terminó.
export function indexarSesiones(reservas, { claveDe, esActiva, yaTermino, hoyISO }) {
  const idx = new Map();
  for (const r of reservas || []) {
    if (!r || !r.fecha) continue;
    const k = claveDe(r);
    if (!k) continue;
    if (!idx.has(k)) idx.set(k, { realizadas: [], proximas: [], canceladas: [], todas: [] });
    const e = idx.get(k);
    e.todas.push(r);
    if (!esActiva(r)) e.canceladas.push(r);
    else if (yaTermino(r)) e.realizadas.push(r);
    else if (r.fecha >= hoyISO) e.proximas.push(r);
    else e.realizadas.push(r); // activa, fecha pasada sin hora de fin calculable
  }
  for (const e of idx.values()) {
    ['realizadas', 'proximas', 'canceladas', 'todas'].forEach((c) => e[c].sort((a, b) => claveOrden(a).localeCompare(claveOrden(b))));
  }
  return idx;
}

// Última sesión realizada ANTES de una reserva dada (nunca la propia).
export function ultimaSesionAntes(entrada, reserva) {
  if (!entrada || !reserva) return null;
  const tope = claveOrden(reserva);
  let ultima = null;
  for (const r of entrada.realizadas) {
    if (r.id === reserva.id) continue;
    if (claveOrden(r) < tope) ultima = r; else break;
  }
  return ultima;
}

export function ultimaRealizada(entrada) {
  return entrada && entrada.realizadas.length ? entrada.realizadas[entrada.realizadas.length - 1] : null;
}

// Minutos ya agendados a futuro (para mostrar el saldo de horas que queda
// libre después de los turnos que la paciente ya tiene reservados).
export function minutosAgendados(entrada, duracionDe) {
  if (!entrada) return 0;
  return entrada.proximas.reduce((t, r) => t + (Number(duracionDe(r)) || 0), 0);
}

// ── Tratamiento de referencia para el ciclo de retorno ──
export const TRATAMIENTOS_RETORNO = [
  { clave: 'hifu', etiqueta: 'HIFU', patron: /hi-?fu/i },
  { clave: 'criolipolisis', etiqueta: 'Criolipólisis', patron: /crio/i },
  { clave: 'radiofrecuencia', etiqueta: 'Radiofrecuencia', patron: /radiofrec|fraxis|tensad/i },
  { clave: 'facial', etiqueta: 'Limpieza / Facial', patron: /facial|limpieza|peeling|dermapl|meso|rostro|cutis/i },
  { clave: 'corporal', etiqueta: 'Corporal / Drenaje', patron: /corporal|drenaj|presoter|drenapress|masaj|mio ?up|plisagge|vibrat|detox|relax|modelad/i },
];

export function tratamientoDe(servicio) {
  const s = (servicio || '').toString();
  const t = TRATAMIENTOS_RETORNO.find((x) => x.patron.test(s));
  return t ? t.clave : 'otro';
}

// rango: '15-25' | '30+' | '15+' | 'todos'
export function enRangoRetorno(dias, rango) {
  if (dias == null) return false;
  if (rango === '15-25') return dias >= 15 && dias <= 25;
  if (rango === '30+') return dias >= 30;
  if (rango === '15+') return dias >= 15;
  return true;
}

// ── Estado de contacto por WhatsApp (contactosWhatsApp) ──
// registros: docs de contactosWhatsApp ya filtrados para el destinatario.
// Devuelve el más relevante entre los tipos pedidos:
// 'enviado' (con ms) > 'preparado' > 'no_enviado' > 'pendiente'.
const PESO = { enviado: 3, preparado: 2, no_enviado: 1 };
const msDe = (v) => !v ? 0 : typeof v === 'number' ? v : v.toMillis ? v.toMillis() : v.seconds ? v.seconds * 1000 : (Date.parse(v) || 0);

export function estadoContacto(registros, tipos) {
  let mejor = null;
  for (const c of registros || []) {
    if (tipos && !tipos.some((t) => (typeof t === 'string' ? c.tipoMensaje === t : t.test(c.tipoMensaje || '')))) continue;
    const peso = PESO[c.estado] || 0;
    const ms = c.estado === 'enviado' ? msDe(c.enviadoAt || c.updatedAt) : c.estado === 'preparado' ? msDe(c.preparadoAt || c.updatedAt) : msDe(c.updatedAt);
    if (!mejor || peso > mejor.peso || (peso === mejor.peso && ms > mejor.ms)) mejor = { estado: c.estado, ms, peso, tipoMensaje: c.tipoMensaje };
  }
  return mejor ? { estado: mejor.estado, ms: mejor.ms, tipoMensaje: mejor.tipoMensaje } : { estado: 'pendiente', ms: 0, tipoMensaje: null };
}

export function avisadoEnUltimosDias(registros, tipos, dias, ahoraMs) {
  const e = estadoContacto(registros, tipos);
  if (e.estado !== 'enviado' && e.estado !== 'preparado') return false;
  return e.ms > 0 && (ahoraMs - e.ms) <= dias * MS_DIA;
}

export function haceTexto(ms, ahoraMs) {
  if (!ms) return '';
  const min = Math.max(0, Math.round((ahoraMs - ms) / 60000));
  if (min < 60) return `hace ${min} min`;
  const hs = Math.round(min / 60);
  if (hs < 48) return `hace ${hs} h`;
  return `hace ${Math.round(hs / 24)} días`;
}

// ── Estado de pago corto para la tarjeta de la Grilla ──
// Traduce estadoCuenta() de js/precio-pagos.js a la etiqueta operativa.
export function estadoPagoCorto(estadoCuentaKey, anulada) {
  if (anulada) return { etiqueta: 'Anulada', tono: 'err' };
  switch (estadoCuentaKey) {
    case 'completo': case 'saldo_a_favor': return { etiqueta: 'Pagado', tono: 'ok' };
    case 'parcial': return { etiqueta: 'Señado', tono: 'warn' };
    case 'sin_pagos': return { etiqueta: 'Pendiente', tono: 'err' };
    case 'sin_cargo': return { etiqueta: 'Sin cargo', tono: 'neutro' };
    case 'sin_precio': return { etiqueta: 'Sin precio', tono: 'neutro' };
    default: return null;
  }
}

// Saldo de horas de una membresía: hoursBalance es el saldo vigente; las
// horas ya agendadas a futuro se muestran aparte (no se descuentan del
// campo guardado, que sigue siendo responsabilidad de la administradora).
export function resumenSaldoHoras(hoursBalance, minutosFuturos) {
  const saldo = Number(hoursBalance) || 0;
  const agendadas = Math.round(((Number(minutosFuturos) || 0) / 60) * 100) / 100;
  const libres = Math.round((saldo - agendadas) * 100) / 100;
  return { saldo, agendadas, libres, bajo: saldo <= 1, pctAgendado: saldo > 0 ? Math.min(100, Math.round((agendadas / saldo) * 100)) : 0 };
}
