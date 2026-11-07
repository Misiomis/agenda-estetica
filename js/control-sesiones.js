// Control de sesiones (panel admin): qué pacientes cumplieron el plazo de
// seguimiento desde su ÚLTIMA SESIÓN REALIZADA de cada tratamiento.
//
//   Tratamiento     Plazo cumplido
//   HIFU corporal   45 días o más
//   Crio            30 días o más
//
// Lógica pura — sin DOM ni Firestore — para probarla sola
// (tests/control-sesiones). El estado se CALCULA siempre a partir de las
// fechas de las reservas (no se guarda ningún indicador), así avanza solo con
// el paso de los días y se recalcula si una sesión se registra, se mueve o se
// cancela. admin.html le inyecta su propio criterio de "sesión realizada" e
// identidad del paciente, los mismos del resto del panel.

const MS_DIA = 86400000;

// Reglas administrativas de seguimiento. `coincide` usa el nombre real del
// servicio guardado en la reserva ("Hi-Fu Corporal", "Hi-Fu Facial",
// "Criolipolisis", "Jornada especial de criolipólisis", …).
const sinTildes = (s) => (s ?? '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const ES_HIFU = /hi\s*-?\s*fu/;
// Zonas corporales que pueden venir en el nombre del servicio.
const ZONA_CORPORAL = /corporal|cuerpo|abdom|glute|piern|muslo|braz|flanc|espald|rodill|cintur|cadera/;

export const TRATAMIENTOS_CONTROL = [
  {
    clave: 'hifu_corporal', etiqueta: 'HIFU corporal', plazo: 45, icono: '🔆',
    // HIFU facial NO cuenta. Un servicio que combina facial + corporal sí.
    coincide: (servicio) => { const s = sinTildes(servicio); return ES_HIFU.test(s) && ZONA_CORPORAL.test(s); },
  },
  {
    clave: 'crio', etiqueta: 'Crio', plazo: 30, icono: '❄️',
    coincide: (servicio) => /crio/.test(sinTildes(servicio)),
  },
];

const POR_CLAVE = Object.fromEntries(TRATAMIENTOS_CONTROL.map((t) => [t.clave, t]));
export const tratamientoControl = (clave) => POR_CLAVE[clave] || null;

// Tratamientos de control que corresponden a un servicio ([] si ninguno).
export function tratamientosDeServicio(servicio) {
  return TRATAMIENTOS_CONTROL.filter((t) => t.coincide(servicio)).map((t) => t.clave);
}

// HIFU cuyo nombre no dice si es facial o corporal: no se puede asignar sin
// inventar, se informa aparte para que la administradora lo vea.
export function esHifuSinZona(servicio) {
  const s = sinTildes(servicio);
  return ES_HIFU.test(s) && !ZONA_CORPORAL.test(s) && !/facial|rostro|cara|cuello|papada|ojo|parpad|cutis/.test(s);
}

// Estados que nunca cuentan como sesión realizada (además de lo que diga el panel).
const ESTADOS_NO_REALIZADA = ['cancelado', 'cancelada', 'anulado', 'anulada', 'ausente', 'no asistio', 'no_asistio', 'no-asistio', 'no show', 'no-show', 'noshow', 'no_show'];
export function estadoExcluido(r) {
  return [r?.estado, r?.status, r?.asistencia].some((v) => ESTADOS_NO_REALIZADA.includes(sinTildes(v).trim()));
}

// ── Fechas: días calendario puros sobre 'YYYY-MM-DD' (sin horas ni UTC) ──
export function fechaValida(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [a, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(a, m - 1, d));
  return t.getUTCFullYear() === a && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
const aDia = (iso) => { const [a, m, d] = iso.split('-').map(Number); return Date.UTC(a, m - 1, d) / MS_DIA; };
export function diasEntreISO(desde, hasta) { return aDia(hasta) - aDia(desde); }
export function sumarDiasISO(iso, n) {
  const t = new Date((aDia(iso) + n) * MS_DIA);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

const ordenSesion = (r) => `${r.fecha || ''}T${(r.hora || '').toString().padStart(5, '0')}`;

/**
 * opciones:
 *   reservas        — todas las reservas (cualquier estado; se filtran acá).
 *   hoy             — 'YYYY-MM-DD' en la zona horaria del negocio.
 *   claveDe(r)      — identidad del paciente (la misma del panel).
 *   nombreDe(r)     — nombre a mostrar.
 *   esRealizada(r)  — criterio del panel: activa y con horario ya terminado.
 * Devuelve una fila por (paciente, tratamiento) para cada paciente que tiene
 * algún turno de ese tratamiento:
 *   { clave, nombre, tratamiento, etiqueta, plazo, ultima, fechaUltima, dias,
 *     fechaCumplimiento, diasDesdeCumplimiento, faltan, estado, sesiones, proxima }
 *   estado: 'cumplido' | 'espera' | 'sin_sesion'
 */
export function calcularControl({ reservas, hoy, claveDe, nombreDe, esRealizada }) {
  const grupos = new Map(); // clave|trat → { todas[], realizadas[] }
  for (const r of reservas || []) {
    if (!r) continue;
    const trats = tratamientosDeServicio(r.servicio);
    if (!trats.length) continue;
    const clave = claveDe(r);
    if (!clave) continue;
    const valida = fechaValida(r.fecha);
    const realizada = valida && r.fecha <= hoy && !estadoExcluido(r) && esRealizada(r);
    for (const t of trats) {
      const k = clave + '|' + t;
      if (!grupos.has(k)) grupos.set(k, { clave, tratamiento: t, todas: [], realizadas: [] });
      const g = grupos.get(k);
      g.todas.push(r);
      if (realizada) g.realizadas.push(r);
    }
  }
  const filas = [];
  for (const g of grupos.values()) {
    const def = POR_CLAVE[g.tratamiento];
    g.realizadas.sort((a, b) => ordenSesion(a).localeCompare(ordenSesion(b)));
    g.todas.sort((a, b) => ordenSesion(a).localeCompare(ordenSesion(b)));
    const ultima = g.realizadas[g.realizadas.length - 1] || null;
    const ref = ultima || g.todas[g.todas.length - 1];
    const proxima = g.todas.find((r) => fechaValida(r.fecha) && r.fecha >= hoy && !estadoExcluido(r) && !g.realizadas.includes(r)) || null;
    const fila = {
      clave: g.clave, nombre: nombreDe(ref) || 'Sin nombre', tratamiento: g.tratamiento, etiqueta: def.etiqueta, icono: def.icono, plazo: def.plazo,
      ultima, fechaUltima: null, dias: null, fechaCumplimiento: null, diasDesdeCumplimiento: null, faltan: null,
      estado: 'sin_sesion', sesiones: g.realizadas.length, proxima, servicioUltima: ultima ? ultima.servicio : null,
    };
    if (ultima) {
      fila.fechaUltima = ultima.fecha;
      fila.dias = diasEntreISO(ultima.fecha, hoy);
      fila.fechaCumplimiento = sumarDiasISO(ultima.fecha, def.plazo);
      fila.diasDesdeCumplimiento = fila.dias - def.plazo;
      if (fila.dias >= def.plazo) fila.estado = 'cumplido';
      else { fila.estado = 'espera'; fila.faltan = def.plazo - fila.dias; }
    }
    filas.push(fila);
  }
  return ordenarControl(filas);
}

// Prioridad: plazo cumplido (más días desde el cumplimiento primero) →
// en espera (fecha de cumplimiento más cercana primero) → sin sesión.
const PESO_ESTADO = { cumplido: 0, espera: 1, sin_sesion: 2 };
export function ordenarControl(filas) {
  return [...filas].sort((a, b) => {
    if (PESO_ESTADO[a.estado] !== PESO_ESTADO[b.estado]) return PESO_ESTADO[a.estado] - PESO_ESTADO[b.estado];
    if (a.estado === 'cumplido' && a.diasDesdeCumplimiento !== b.diasDesdeCumplimiento) return b.diasDesdeCumplimiento - a.diasDesdeCumplimiento;
    if (a.estado === 'espera' && a.fechaCumplimiento !== b.fechaCumplimiento) return a.fechaCumplimiento.localeCompare(b.fechaCumplimiento);
    return (a.nombre || '').localeCompare(b.nombre || '', 'es') || a.tratamiento.localeCompare(b.tratamiento);
  });
}

const norm = (s) => sinTildes(s).replace(/\s+/g, ' ').trim();
// Filtros de la vista (los contadores usan esta misma función).
export function filtrarControl(filas, { texto = '', tratamiento = 'todos', estado = 'todos' } = {}) {
  const q = norm(texto);
  return filas.filter((f) => (tratamiento === 'todos' || f.tratamiento === tratamiento)
    && (estado === 'todos' || f.estado === estado)
    && (!q || norm(f.nombre).includes(q) || (f.clave || '').toLowerCase().includes(q)));
}

// Contadores de "plazo cumplido" por tratamiento (misma lógica que el listado).
export function contarCumplidos(filas, filtros = {}) {
  const base = filtrarControl(filas, { ...filtros, tratamiento: 'todos', estado: 'cumplido' });
  const out = { total: base.length };
  TRATAMIENTOS_CONTROL.forEach((t) => { out[t.clave] = base.filter((f) => f.tratamiento === t.clave).length; });
  return out;
}

// Texto del estado (siempre texto, no solo color).
export function textoEstado(f) {
  if (f.estado === 'cumplido') return 'Plazo cumplido';
  if (f.estado === 'espera') return `Faltan ${f.faltan} día${f.faltan !== 1 ? 's' : ''}`;
  return 'Sin sesión registrada';
}
