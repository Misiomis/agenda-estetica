// mimar-cristina-logic.js
// Reglas determinísticas de "Mimar T Cristina" — sin DOM, sin Firestore,
// solo funciones puras sobre los datos ya traídos.
//
// No importa mimar-inteligente-logic.js a propósito: el webDir de esta app
// Android es la carpeta mimar-cristina/ sola (ver capacitor.config.json), y
// `npx cap sync` solo empaqueta lo que está DENTRO de esa carpeta — un
// import a "../mimar-inteligente/..." se rompería en el APK aunque funcione
// al servir el sitio completo. Mismo motivo por el que firebase-web.js ya
// vive como copia local acá (ver su propio comentario). Las dos funciones
// que hacían falta de ahí (esActiva/inicioTurnoMs) están copiadas abajo.

const OFFSET_AR = "-03:00";

// Copia de esActiva (mimar-inteligente-logic.js): 'reservas' usa
// 'confirmado'/'cancelado' (o 'cancelada'); 'reservasDepi' cae en el mismo
// fallback por defecto.
const ESTADOS_CANCELADOS = { reservas: ["cancelado", "cancelada"] };
function esActiva(coleccion, estadoBruto) {
  const cancelados = ESTADOS_CANCELADOS[coleccion] || ["cancelado", "cancelada"];
  const v = (estadoBruto || "").toString().trim().toLowerCase();
  return !cancelados.includes(v);
}

// Copia de inicioTurnoMs (mimar-inteligente-logic.js).
function inicioTurnoMs(fecha, hora) {
  const f = (fecha || "").toString().trim();
  const h = (hora || "").toString().trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return null;
  const hh = /^\d{1,2}:\d{2}$/.test(h) ? h.padStart(5, "0") : "00:00";
  const ms = new Date(`${f}T${hh}:00${OFFSET_AR}`).getTime();
  return Number.isNaN(ms) ? null : ms;
}

const ZONA_HORARIA = "America/Argentina/Buenos_Aires";
const DIAS_SEMANA_LEGIBLE = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

// Copia de fechaISOEnZona (mimar-inteligente-logic.js).
export function fechaISOEnZona(ms = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA_HORARIA, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(ms)).reduce((acc, p) => { if (p.type !== "literal") acc[p.type] = p.value; return acc; }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// Copia de formatearFechaLocal (mimar-inteligente-logic.js).
export function formatearFechaLocal(ms = Date.now()) {
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: ZONA_HORARIA }).format(ms);
}

// Copia de diaSemanaLegible (mimar-inteligente-logic.js).
export function diaSemanaLegible(ms = Date.now()) {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA_HORARIA, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms));
  const o = {};
  partes.forEach((p) => { if (p.type !== "literal") o[p.type] = p.value; });
  return DIAS_SEMANA_LEGIBLE[new Date(Date.UTC(+o.year, +o.month - 1, +o.day, 12)).getUTCDay()];
}

// Un bloqueo de agenda (horario cerrado por admin) no es una paciente —
// mismo criterio que ya usa admin.html/los informes de auditoría.
export function esBloqueoAdministrativo(d) {
  const dniCrudo = (d.dni || d.clienteDni || "").toString().trim().toUpperCase();
  const nombre = (d.nombreLimpio || d.nombre || d.cliente || d.clienteNombre || "").toString().toUpperCase();
  const servicio = (d.servicio || "").toString().trim().toUpperCase();
  return dniCrudo === "BLOQUEO" || nombre.includes("BLOQUEADO POR ADMIN") || servicio === "CERRADO POR ADMIN";
}

// Normaliza un documento crudo de "reservas" o "reservasDepi" a la forma
// común que necesita esta app: solo lo que hace falta para la lista del día
// y para poder cargar/editar la nota general de la paciente (requiere DNI).
// No inventa nada: si no hay DNI no se puede notar, y queda null.
export function normalizarPacienteHoy(coleccion, id, data) {
  const d = data || {};
  const esDepi = coleccion === "reservasDepi";
  const dni = (d.dni || d.clienteDni || "").toString().trim() || null;
  const nombre = d.nombreLimpio || d.nombre || d.cliente || d.clienteNombre || "Paciente";
  const fecha = d.fecha || null;
  const hora = d.hora || null;
  const estadoBruto = d.estado || d.status || null;
  const activa = esActiva(esDepi ? "reservasDepi" : "reservas", estadoBruto);
  // inicioTurnoMs completa una hora faltante con "00:00" (pensado para
  // calcular duración/fin de turno) — acá eso haría que "sin hora" ordene
  // PRIMERO en vez de al final. Se pide la hora explícitamente antes de
  // confiar en ese cálculo.
  const horaValida = /^\d{1,2}:\d{2}$/.test((hora || "").toString().trim());
  return {
    coleccion,
    id,
    dni,
    nombre,
    telefono: d.phone || d.telefono || null,
    servicio: esDepi ? (d.combo || d.servicio || "Depilación") : (d.servicio || "Reserva"),
    esDepi,
    fecha,
    hora,
    activa,
    inicioMs: horaValida ? inicioTurnoMs(fecha, hora) : null,
    bloqueo: esBloqueoAdministrativo(d),
  };
}

// Arma la lista final del día: solo activas, sin bloqueos administrativos,
// ordenada por hora (sin hora definida va al final) y luego por nombre.
export function construirListaHoy(itemsReservas, itemsReservasDepi) {
  const todas = [...(itemsReservas || []), ...(itemsReservasDepi || [])]
    .filter((p) => p.activa && !p.bloqueo);
  todas.sort((a, b) => {
    if (a.inicioMs === null && b.inicioMs === null) return a.nombre.localeCompare(b.nombre, "es");
    if (a.inicioMs === null) return 1;
    if (b.inicioMs === null) return -1;
    return a.inicioMs - b.inicioMs;
  });
  return todas;
}
