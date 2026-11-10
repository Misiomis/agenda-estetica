// ¿Un turno es realmente de JORNADA o es un turno NORMAL?
// Lógica pura (sin DOM ni Firestore) — se prueba sola en tests/turno-jornada.
//
// Antes alcanzaba con que el turno tuviera origen "jornada" (lo grababa el
// panel para CUALQUIER servicio si el modo jornada estaba encendido al
// agendar), y así un "Tratamiento Facial" en Box 3 salía como JORNADA.
// Ahora decide el servicio:
//   1. Consulta Inicial → nunca es jornada.
//   2. Override manual (forzarJornadaManual true/false) → se respeta.
//   3. Si no, el servicio tiene que corresponder al equipamiento de la
//      jornada: la del propio turno (jornadaTipo, si se guardó), o la jornada
//      activa del día; para turnos viejos sin tipo guardado, cualquiera de las
//      jornadas del espacio (así una jornada de crio pasada sigue siendo
//      jornada aunque hoy esté activa la de radio).
//   El flag legacy (origen "jornada") ya no alcanza por sí solo.

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Palabras del servicio que corresponden a cada tipo de jornada.
export const EQUIPOS_JORNADA = {
  crio: [/crio/],
  radio: [/radio/],
  detox: [/detox/],
  depi: [/definitiva/, /depi/, /laser/],
};
const ALIAS_TIPO = { definitiva: 'depi', depilacion: 'depi', laser: 'depi', criolipolisis: 'crio', radiofrecuencia: 'radio' };

export function tipoJornadaNormalizado(tipo) {
  const t = norm(tipo).trim();
  if (!t || t === 'normal') return '';
  return EQUIPOS_JORNADA[t] ? t : (ALIAS_TIPO[t] || '');
}

export function esConsultaInicialTurno(turno) {
  if (!turno) return false;
  if (turno.esConsultaInicial === true) return true;
  const s = norm(turno.servicioNombre || turno.servicio).trim();
  return s === 'ci' || /consulta\s+inicial/.test(s);
}

export function servicioCorrespondeAJornada(servicio, tipo) {
  const s = norm(servicio);
  if (!s) return false;
  const t = tipoJornadaNormalizado(tipo);
  const tipos = t ? [t] : Object.keys(EQUIPOS_JORNADA);
  return tipos.some((k) => EQUIPOS_JORNADA[k].some((re) => re.test(s)));
}

// turno: doc de reservas. jornadaActiva: tipo de la jornada activa ('crio',
// 'radio', 'detox', 'depi'…) o '' / 'normal' / null si no hay.
export function esTurnoDeJornadaValido(turno, jornadaActiva) {
  if (!turno) return false;
  if (esConsultaInicialTurno(turno)) return false;
  if (turno.forzarJornadaManual === true) return true;
  if (turno.forzarJornadaManual === false) return false;
  const servicio = turno.servicioNombre || turno.servicio;
  const marcadoJornada = norm(turno.origen) === 'jornada' || turno.esJornada === true;
  // Servicio propio de una jornada ("Jornada de Criolipólisis") → jornada.
  if (/^jornada\b/.test(norm(servicio).trim())) return true;
  if (!marcadoJornada) return false;
  // El tipo guardado en el turno manda. Sin tipo guardado (turnos viejos) se
  // acepta el equipamiento de la jornada activa o de cualquier otra jornada
  // del espacio: un turno viejo de crio sigue siendo jornada aunque hoy esté
  // activa la de radio, y un facial nunca lo es.
  if (turno.jornadaTipo) return servicioCorrespondeAJornada(servicio, turno.jornadaTipo);
  return servicioCorrespondeAJornada(servicio, jornadaActiva) || servicioCorrespondeAJornada(servicio, '');
}

// Para una reserva NUEVA: ¿se graba como jornada? Solo si el modo jornada está
// activo y el servicio corresponde a esa jornada (nunca una CI).
export function origenParaNuevoTurno(turno, modoJornadaActivo, jornadaActiva) {
  if (!modoJornadaActivo) return 'normal';
  if (esConsultaInicialTurno(turno)) return 'normal';
  return servicioCorrespondeAJornada(turno && (turno.servicioNombre || turno.servicio), jornadaActiva) ? 'jornada' : 'normal';
}
