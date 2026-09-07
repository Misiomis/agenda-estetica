import { CONFIG } from "./config.js";

const dateFormatter = new Intl.DateTimeFormat("en", {
  timeZone: CONFIG.timeZone, year: "numeric", month: "2-digit", day: "2-digit"
});
const clockFormatter = new Intl.DateTimeFormat("es-AR", {
  timeZone: CONFIG.timeZone, hour: "2-digit", minute: "2-digit",
  second: "2-digit", hourCycle: "h23"
});
export function dayKey(value = Date.now()) {
  const parts = Object.fromEntries(dateFormatter.formatToParts(value).map(p => [p.type, p.value]));
  return parts.year + "-" + parts.month + "-" + parts.day;
}
export function nextDay(day) {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
export function clockParts(value = Date.now()) {
  return Object.fromEntries(clockFormatter.formatToParts(value).map(p => [p.type, p.value]));
}
export function prettyDay(value = Date.now()) {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: CONFIG.timeZone, weekday: "long", day: "numeric", month: "long"
  }).format(value);
}
export function text(value) {
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}
function first(...values) {
  return values.map(text).find(Boolean) || "";
}
function folded(value) {
  return text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
export function normalizeTime(value) {
  const match = text(value).replace(/\s*(?:hs?|hrs?)\.?$/i, "").trim()
    .match(/^(\d{1,2})[:.](\d{2})(?::00)?$/);
  if (!match) return "";
  const hour = Number(match[1]), minute = Number(match[2]);
  if (hour > 23 || minute > 59) return "";
  return String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
}
export function parseAppointmentTime(day, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text(day))) return NaN;
  const normalized = normalizeTime(time);
  if (!normalized) return NaN;
  const result = Date.parse(day + "T" + normalized + ":00" + CONFIG.utcOffset);
  return Number.isFinite(result) && dayKey(result) === day ? result : NaN;
}
const CANCELLED = new Set([
  "cancelado", "cancelada", "cancelled", "canceled", "anulado", "anulada",
  "eliminado", "eliminada", "rechazado", "rechazada"
]);
const COMPLETED = new Set([
  "realizado", "realizada", "completado", "completada", "completed",
  "atendido", "atendida", "finalizado", "finalizada", "consumido", "consumida",
  "ausente", "no asistio", "no_asistio", "no-show"
]);
export function bookingState(data) {
  const values = [data.estado, data.status].map(folded);
  if (data.cancelado === true || data.cancelada === true || data.deleted === true ||
      values.some(v => CANCELLED.has(v))) return "cancelled";
  if (data.realizado === true || data.realizada === true || data.asistio === true ||
      values.some(v => COMPLETED.has(v))) return "completed";
  return "scheduled";
}
function boxId(value) {
  const v = folded(value);
  const m = v.match(/^(?:b|box\s*)?([1-4])$/);
  return m ? "b" + m[1] : "";
}
export function normalizeBooking(id, source, data, boxLabels = {}) {
  const date = first(data.fecha, data.date);
  const time = normalizeTime(first(data.hora, data.hour));
  const start = parseAppointmentTime(date, time);
  if (!Number.isFinite(start)) return null;
  const fallbackName = first(data.clienteNombre, data.nombre, data.cliente,
    data.displayName, data.title, data.nombrePaciente, "Paciente sin nombre");
  const duoNames = [text(data.duoNombre1), text(data.duoNombre2)].filter(Boolean);
  const names = data.duo && duoNames.length ? duoNames : [fallbackName];
  const service = first(data.servicio, data.tratamiento, data.serviceName,
    source === "consultas" ? "Consulta inicial" : source === "reservasDepi" ? "Depilación" : "Tratamiento sin indicar");
  let ids = [boxId(data.box)].filter(Boolean);
  if (!ids.length && Array.isArray(data.boxes)) ids = [...new Set(data.boxes.map(boxId).filter(Boolean))];
  let box = text(data.boxLabel);
  if (!box && ids.length) box = ids.map(id => {
    const name = "Box " + id.slice(1);
    const sub = text(boxLabels[id]?.sub);
    return sub ? name + " · " + sub : name;
  }).join(" / ");
  if (!box) box = source === "reservasDepi" || source === "reservas_depi" ? "Depilación" : "Box por asignar";
  const duration = Number(data.duracionMinutos ?? data.duracion);
  const durationMinutes = Number.isFinite(duration) && duration > 0 && duration <= 1440 ? duration : null;
  return {
    id, source, key: source + "/" + id, date, time, start,
    state: bookingState(data), names, name: names.join(" y "),
    service, box, boxIds: ids, durationMinutes,
    end: durationMinutes ? start + durationMinutes * 60_000 : null
  };
}
export function compareBookings(a, b) {
  return a.start - b.start || a.name.localeCompare(b.name, "es") || a.key.localeCompare(b.key);
}
export function cleanPreferences(raw = {}) {
  const d = CONFIG.defaults;
  const advance = Number(raw.advanceMinutes);
  const volume = Number(raw.volume);
  const known = CONFIG.sources.map(s => s.id);
  return {
    advanceMinutes: [0, 1, 3, 5, 10, 15].includes(advance) ? advance : d.advanceMinutes,
    atStart: typeof raw.atStart === "boolean" ? raw.atStart : d.atStart,
    volume: Number.isFinite(volume) && raw.volume != null ? Math.min(1, Math.max(0, volume)) : d.volume,
    tone: ["campana", "cristal", "doble"].includes(raw.tone) ? raw.tone : d.tone,
    wakeLock: typeof raw.wakeLock === "boolean" ? raw.wakeLock : d.wakeLock,
    notifications: raw.notifications === true,
    sources: Array.isArray(raw.sources) ? known.filter(s => raw.sources.includes(s))
      : CONFIG.sources.filter(s => s.enabled).map(s => s.id)
  };
}
export function eventsFor(booking, prefs) {
  if (booking.state !== "scheduled") return [];
  const events = [];
  // El horario forma parte de la identidad: un turno reprogramado se vuelve a
  // evaluar, y cualquier evento de su horario anterior desaparece de la lista.
  const key = booking.key + "@" + booking.start;
  if (prefs.advanceMinutes > 0) events.push({
    key: key + ":antes:" + prefs.advanceMinutes, kind: "before",
    due: booking.start - prefs.advanceMinutes * 60_000, booking
  });
  if (prefs.atStart) events.push({ key: key + ":ingreso", kind: "start", due: booking.start, booking });
  return events;
}
export function dueEvents(bookings, prefs, now, since = now - CONFIG.graceMs) {
  const lower = Math.max(since, now - CONFIG.graceMs);
  return bookings.flatMap(b => eventsFor(b, prefs))
    .filter(e => e.due <= now && e.due >= lower)
    .sort((a, b) => a.due - b.due || a.key.localeCompare(b.key));
}
export function countdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const seconds = total % 60;
  return (hours ? String(hours).padStart(2, "0") + ":" : "") +
    String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
}
export function upcomingGroup(bookings, now) {
  const candidates = bookings.filter(b => b.state === "scheduled" &&
    b.start >= now - CONFIG.graceMs).sort(compareBookings);
  if (!candidates.length) return [];
  return candidates.filter(b => b.start === candidates[0].start);
}
export function visualStatus(booking, now) {
  if (booking.state === "cancelled") return "Cancelada";
  if (booking.state === "completed") return "Cerrada en agenda";
  if (booking.end && booking.end <= now) return "Horario finalizado";
  if (booking.start <= now) return "Horario iniciado";
  if (booking.start - now <= 5 * 60_000) return "En minutos";
  return "Próxima";
}
