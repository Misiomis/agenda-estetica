// mimar-cristina-logic.js
// Reglas determinísticas de "Mimar T Administración" — sin DOM, sin Firestore,
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

// Solo para MOSTRAR — nunca se guarda así, el campo "nombre" crudo de
// Firestore no se toca. Muchas reservas vienen cargadas en minúsculas
// ("gabriela k") y se ven poco prolijas en una agenda; esto es puro
// formato visual, capitaliza cada palabra sin inventar ni corregir nada
// del dato real.
export function formatearNombre(nombre) {
  const limpio = (nombre || "").toString().trim().replace(/\s+/g, " ");
  if (!limpio) return "";
  return limpio.toLowerCase().replace(/(^|[\s-])\S/g, (c) => c.toUpperCase());
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
// común que necesita esta app: lo que hace falta para mostrarla en la
// agenda (incluido el detalle de la sesión, si se cargó — si no hay,
// queda null y la reserva se muestra igual, nunca se oculta por eso) y
// para poder cargar/editar la nota general de la paciente (requiere DNI).
// No inventa nada: si no hay DNI no se puede notar, y queda null.
export function normalizarPaciente(coleccion, id, data) {
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
  const detalleCrudo = (d.detalleSesion || "").toString().trim();
  return {
    coleccion,
    id,
    dni,
    nombre,
    telefono: d.phone || d.telefono || null,
    servicio: esDepi ? (d.combo || d.servicio || "Depilación") : (d.servicio || "Reserva"),
    detalleSesion: detalleCrudo || null,
    esDepi,
    fecha,
    hora,
    activa,
    inicioMs: horaValida ? inicioTurnoMs(fecha, hora) : null,
    bloqueo: esBloqueoAdministrativo(d),
  };
}

function ordenarDia(lista) {
  return lista.slice().sort((a, b) => {
    if (a.inicioMs === null && b.inicioMs === null) return a.nombre.localeCompare(b.nombre, "es");
    if (a.inicioMs === null) return 1;
    if (b.inicioMs === null) return -1;
    return a.inicioMs - b.inicioMs;
  });
}

// Agrupa todas las reservas (ya traídas por la consulta — desde el inicio
// del mes actual en adelante, sin límite superior) por fecha ISO, solo
// activas y sin bloqueos administrativos, cada día ordenado por hora. Una
// reserva sin "fecha" no puede ubicarse en ningún día del calendario y
// queda afuera (no es un descarte arbitrario: no hay dónde mostrarla).
export function agruparPorFecha(itemsReservas, itemsReservasDepi) {
  const todas = [...(itemsReservas || []), ...(itemsReservasDepi || [])]
    .filter((p) => p.activa && !p.bloqueo && p.fecha);
  const mapa = new Map();
  todas.forEach((p) => {
    if (!mapa.has(p.fecha)) mapa.set(p.fecha, []);
    mapa.get(p.fecha).push(p);
  });
  mapa.forEach((lista, fecha) => mapa.set(fecha, ordenarDia(lista)));
  return mapa;
}

// ── Calendario (mes actual en adelante — nunca antes) ────────────────────
export function inicioMesISO(ms = Date.now()) {
  return fechaISOEnZona(ms).slice(0, 7) + "-01";
}

export function mesDeFechaISO(fechaISO) {
  return (fechaISO || "").slice(0, 7);
}

// mesISO: "YYYY-MM". delta puede ser negativo.
export function sumarMeses(mesISO, delta) {
  const [y, m] = mesISO.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

export function nombreMes(mesISO) {
  const [y, m] = mesISO.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1, 12));
  const nombre = new Intl.DateTimeFormat("es-AR", { month: "long", timeZone: "UTC" }).format(d);
  return `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} ${y}`;
}

// Grilla semanal (lunes primero) de un mes: array de semanas, cada una un
// array de 7 strings "YYYY-MM-DD" (o null para relleno fuera de mes — no
// se muestran días de otro mes, solo huecos para alinear la grilla).
export function construirGrillaMes(mesISO) {
  const [y, m] = mesISO.split("-").map(Number);
  const primerDia = new Date(Date.UTC(y, m - 1, 1, 12));
  const diaSemanaISO = (primerDia.getUTCDay() + 6) % 7; // 0=lunes … 6=domingo
  const diasEnMes = new Date(Date.UTC(y, m, 0, 12)).getUTCDate();
  const celdas = [];
  for (let i = 0; i < diaSemanaISO; i++) celdas.push(null);
  for (let dia = 1; dia <= diasEnMes; dia++) {
    celdas.push(`${y}-${String(m).padStart(2, "0")}-${String(dia).padStart(2, "0")}`);
  }
  while (celdas.length % 7 !== 0) celdas.push(null);
  const semanas = [];
  for (let i = 0; i < celdas.length; i += 7) semanas.push(celdas.slice(i, i + 7));
  return semanas;
}

// "Hoy, viernes 24/10" para el día actual; "Viernes 24/10" para cualquier
// otro — siempre con el nombre del día, nunca solo la fecha pelada.
export function tituloDia(fechaISO, hoyISO) {
  const ms = inicioTurnoMs(fechaISO, "12:00");
  if (ms === null) return fechaISO || "—";
  const dia = diaSemanaLegible(ms);
  const diaCap = dia.charAt(0).toUpperCase() + dia.slice(1);
  const [, mm, dd] = fechaISO.split("-");
  const fechaCorta = `${dd}/${mm}`;
  return fechaISO === hoyISO ? `Hoy, ${dia} ${fechaCorta}` : `${diaCap} ${fechaCorta}`;
}
