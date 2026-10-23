// Pruebas de la lógica pura de "Mimar T Cristina" (app aparte para
// depilación: lista de pacientes del día + nota general del paciente).
// ESM (.mjs) porque mimar-cristina-logic.js e mimar-inteligente-logic.js ya
// son módulos ES (los usa el navegador vía <script type="module">).
import assert from "assert";
import {
  esBloqueoAdministrativo, normalizarPacienteHoy, construirListaHoy,
} from "../../mimar-cristina/mimar-cristina-logic.js";

let fails = 0;
function check(desc, fn) {
  try { fn(); console.log("  OK  " + desc); }
  catch (e) { fails++; console.log("  FAIL " + desc + "\n       " + e.message); }
}

console.log("── esBloqueoAdministrativo ──");
check("bloqueo por DNI literal", () => {
  assert.strictEqual(esBloqueoAdministrativo({ dni: "BLOQUEO" }), true);
});
check("bloqueo por nombre", () => {
  assert.strictEqual(esBloqueoAdministrativo({ nombre: "Horario bloqueado por admin" }), true);
});
check("paciente real no es bloqueo", () => {
  assert.strictEqual(esBloqueoAdministrativo({ dni: "30123456", nombre: "Ana Pérez", servicio: "Tratamiento Facial" }), false);
});

console.log("── normalizarPacienteHoy ──");
check("reserva corporal activa", () => {
  const p = normalizarPacienteHoy("reservas", "r1", { dni: "111", nombre: "Ana", servicio: "Tratamientos Corporales", fecha: "2026-10-23", hora: "10:00", estado: "confirmado" });
  assert.strictEqual(p.esDepi, false);
  assert.strictEqual(p.activa, true);
  assert.strictEqual(p.dni, "111");
  assert.strictEqual(p.servicio, "Tratamientos Corporales");
});
check("reserva cancelada queda inactiva", () => {
  const p = normalizarPacienteHoy("reservas", "r2", { dni: "112", nombre: "Bea", fecha: "2026-10-23", hora: "11:00", estado: "cancelada" });
  assert.strictEqual(p.activa, false);
});
check("depilación activa con servicio por defecto", () => {
  const p = normalizarPacienteHoy("reservasDepi", "d1", { dni: "113", nombre: "Caro", fecha: "2026-10-23", hora: "09:00", estado: "confirmado" });
  assert.strictEqual(p.esDepi, true);
  assert.strictEqual(p.servicio, "Depilación");
});
check("sin DNI queda null, nunca inventado", () => {
  const p = normalizarPacienteHoy("reservas", "r3", { nombre: "Dana", fecha: "2026-10-23", hora: "12:00", estado: "confirmado" });
  assert.strictEqual(p.dni, null);
});

console.log("── construirListaHoy ──");
check("ordena por hora, excluye canceladas y bloqueos", () => {
  const reservas = [
    normalizarPacienteHoy("reservas", "r1", { dni: "1", nombre: "Tarde", fecha: "2026-10-23", hora: "15:00", estado: "confirmado" }),
    normalizarPacienteHoy("reservas", "r2", { dni: "2", nombre: "Cancelada", fecha: "2026-10-23", hora: "08:00", estado: "cancelado" }),
    normalizarPacienteHoy("reservas", "r3", { dni: "BLOQUEO", nombre: "Bloqueo admin", fecha: "2026-10-23", hora: "09:00", estado: "confirmado" }),
    normalizarPacienteHoy("reservas", "r4", { dni: "4", nombre: "Mañana", fecha: "2026-10-23", hora: "09:30", estado: "confirmado" }),
  ];
  const depi = [
    normalizarPacienteHoy("reservasDepi", "d1", { dni: "5", nombre: "Depi temprano", fecha: "2026-10-23", hora: "08:30", estado: "confirmado" }),
  ];
  const lista = construirListaHoy(reservas, depi);
  assert.strictEqual(lista.length, 3);
  assert.deepStrictEqual(lista.map((p) => p.nombre), ["Depi temprano", "Mañana", "Tarde"]);
});
check("sin hora va al final, ordenado por nombre", () => {
  const reservas = [
    normalizarPacienteHoy("reservas", "r1", { dni: "1", nombre: "Zoe", fecha: "2026-10-23", hora: null, estado: "confirmado" }),
    normalizarPacienteHoy("reservas", "r2", { dni: "2", nombre: "Ana", fecha: "2026-10-23", hora: "10:00", estado: "confirmado" }),
    normalizarPacienteHoy("reservas", "r3", { dni: "3", nombre: "Bea", fecha: "2026-10-23", hora: null, estado: "confirmado" }),
  ];
  const lista = construirListaHoy(reservas, []);
  assert.deepStrictEqual(lista.map((p) => p.nombre), ["Ana", "Bea", "Zoe"]);
});

console.log(`\n${fails === 0 ? "Todo OK" : fails + " fallo(s)"}`);
process.exit(fails === 0 ? 0 : 1);
