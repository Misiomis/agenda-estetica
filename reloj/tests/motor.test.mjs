import test from "node:test";
import assert from "node:assert/strict";
import {
  dayKey, nextDay, normalizeTime, parseAppointmentTime, normalizeBooking,
  cleanPreferences, dueEvents, eventsFor, upcomingGroup, bookingState, countdown
} from "../motor.js";
const prefs = cleanPreferences();
const sample = {
  clienteNombre: "Paciente de prueba", fecha: "2026-09-07", hora: "16:00",
  servicio: "Tratamiento corporal", box: "b2", estado: "confirmado"
};
const make = (overrides = {}, id = "r1", source = "reservas") =>
  normalizeBooking(id, source, { ...sample, ...overrides });

test("la hora de Argentina es independiente de la zona del equipo", () => {
  assert.equal(parseAppointmentTime("2026-09-07", "16:00"), Date.parse("2026-09-07T19:00:00Z"));
  assert.equal(dayKey(Date.parse("2026-09-08T02:59:59Z")), "2026-09-07");
  assert.equal(dayKey(Date.parse("2026-09-08T03:00:00Z")), "2026-09-08");
  assert.equal(nextDay("2026-12-31"), "2027-01-01");
});
test("acepta variantes reales de hora y rechaza valores imposibles", () => {
  assert.equal(normalizeTime("9.30 hs"), "09:30");
  assert.equal(normalizeTime("09:30:00"), "09:30");
  assert.equal(normalizeTime("24:00"), "");
  assert.equal(normalizeTime("12:65"), "");
  assert.ok(Number.isNaN(parseAppointmentTime("2026-02-30", "10:00")));
  assert.equal(make({ hora: "" }), null);
  assert.equal(make({ fecha: "07/09/2026" }), null);
});
test("campos reales de la agenda, duración y box explícito", () => {
  const booking = make({ duracionMinutos: 45, boxLabel: "Box 2 · Corporal" });
  assert.equal(booking.name, "Paciente de prueba");
  assert.equal(booking.box, "Box 2 · Corporal");
  assert.equal(booking.end, booking.start + 45 * 60_000);
  assert.equal(make().end, null);
});
test("las reservas dúo conservan los dos nombres en un mismo ingreso", () => {
  const booking = make({ duo: true, duoNombre1: "Ana de prueba", duoNombre2: "Eva de prueba" });
  assert.deepEqual(booking.names, ["Ana de prueba", "Eva de prueba"]);
  assert.equal(booking.name, "Ana de prueba y Eva de prueba");
});
test("cancelada en cualquiera de los dos campos impide el aviso", () => {
  for (const status of ["cancelado", "Cancelada", "cancelled", "ANULADA"]) {
    assert.equal(bookingState({ estado: "confirmado", status }), "cancelled");
    const booking = make({ status });
    assert.equal(dueEvents([booking], prefs, booking.start).length, 0);
  }
});
test("las sesiones cerradas y ausentes no generan alarmas", () => {
  for (const estado of ["realizada", "atendido", "ausente"]) {
    const booking = make({ estado });
    assert.equal(dueEvents([booking], prefs, booking.start).length, 0);
  }
});
test("aviso previo e ingreso son eventos distintos, sin duplicar el aviso de cero minutos", () => {
  const booking = make();
  const before = dueEvents([booking], prefs, booking.start - 5 * 60_000);
  const start = dueEvents([booking], prefs, booking.start);
  assert.equal(before[0].kind, "before");
  assert.equal(start[0].kind, "start");
  assert.notEqual(before[0].key, start[0].key);
  assert.equal(eventsFor(booking, { ...prefs, advanceMinutes: 0 }).length, 1);
});
test("reprogramar elimina el evento anterior y genera una identidad nueva", () => {
  const old = make();
  const changed = make({ hora: "17:00" });
  assert.equal(dueEvents([changed], prefs, old.start).length, 0);
  assert.notEqual(eventsFor(old, prefs)[1].key, eventsFor(changed, prefs)[1].key);
  assert.equal(dueEvents([changed], prefs, changed.start).length, 1);
});
test("cancelar o eliminar entre snapshots deja de producir avisos", () => {
  const old = make();
  assert.equal(dueEvents([], prefs, old.start).length, 0);
  assert.equal(upcomingGroup([make({ estado: "cancelado" })], old.start - 1000).length, 0);
});
test("una reconexión recupera el aviso reciente, nunca los de hace varias horas", () => {
  const booking = make();
  assert.equal(dueEvents([booking], prefs, booking.start + 20_000).length, 1);
  assert.equal(dueEvents([booking], prefs, booking.start + 90_000).length, 1);
  assert.equal(dueEvents([booking], prefs, booking.start + 90_001).length, 0);
  assert.equal(dueEvents([booking], prefs, booking.start + 3_600_000).length, 0);
});
test("los ingresos simultáneos no se pisan, ni siquiera con nombres iguales", () => {
  const a = make({}, "a"), b = make({}, "b");
  assert.equal(upcomingGroup([a, b], a.start - 1000).length, 2);
  const events = dueEvents([a, b], prefs, a.start);
  assert.equal(events.length, 2);
  assert.notEqual(events[0].key, events[1].key);
});
test("el aviso previo de un turno de medianoche pertenece al día anterior", () => {
  const booking = make({ fecha: "2026-09-08", hora: "00:00" });
  const before = eventsFor(booking, prefs)[0];
  assert.equal(dayKey(before.due), "2026-09-07");
  assert.equal(dueEvents([booking], prefs, before.due)[0].kind, "before");
});
test("preferencias manipuladas se acotan a agendas, tonos y valores permitidos", () => {
  const cleaned = cleanPreferences({ volume: 100, advanceMinutes: 999, tone: "desconocido", sources: ["reservas", "historias"] });
  assert.equal(cleaned.volume, 1);
  assert.equal(cleaned.advanceMinutes, 5);
  assert.equal(cleaned.tone, "campana");
  assert.deepEqual(cleaned.sources, ["reservas"]);
  assert.equal(countdown(-100), "00:00");
  assert.equal(countdown(3_661_000), "01:01:01");
});
test("el contenido de pacientes se conserva como texto, sin reinterpretarlo", () => {
  assert.equal(make({ clienteNombre: '<img src=x onerror="alert(1)">' }).name, '<img src=x onerror="alert(1)">');
});
