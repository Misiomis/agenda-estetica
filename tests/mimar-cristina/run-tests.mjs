// Pruebas de la lógica pura de "Mimar T Administración" (app aparte,
// agenda del mes actual en adelante + nota general del paciente).
// ESM (.mjs) porque mimar-cristina-logic.js e mimar-inteligente-logic.js ya
// son módulos ES (los usa el navegador vía <script type="module">).
import assert from "assert";
import {
  esBloqueoAdministrativo, normalizarPaciente, agruparPorFecha,
  inicioMesISO, mesDeFechaISO, sumarMeses, nombreMes, construirGrillaMes, tituloDia,
  formatearNombre,
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

console.log("── normalizarPaciente ──");
check("reserva corporal activa, con detalle", () => {
  const p = normalizarPaciente("reservas", "r1", { dni: "111", nombre: "Ana", servicio: "Tratamientos Corporales", fecha: "2026-10-23", hora: "10:00", estado: "confirmado", detalleSesion: "Masaje reductor" });
  assert.strictEqual(p.esDepi, false);
  assert.strictEqual(p.activa, true);
  assert.strictEqual(p.dni, "111");
  assert.strictEqual(p.servicio, "Tratamientos Corporales");
  assert.strictEqual(p.detalleSesion, "Masaje reductor");
});
check("sin detalle de sesion queda null, pero la reserva existe igual", () => {
  const p = normalizarPaciente("reservas", "r1b", { dni: "111", nombre: "Ana", fecha: "2026-10-23", hora: "10:00", estado: "confirmado" });
  assert.strictEqual(p.detalleSesion, null);
  assert.strictEqual(p.activa, true);
});
check("reserva cancelada queda inactiva", () => {
  const p = normalizarPaciente("reservas", "r2", { dni: "112", nombre: "Bea", fecha: "2026-10-23", hora: "11:00", estado: "cancelada" });
  assert.strictEqual(p.activa, false);
});
check("depilación activa con servicio por defecto", () => {
  const p = normalizarPaciente("reservasDepi", "d1", { dni: "113", nombre: "Caro", fecha: "2026-10-23", hora: "09:00", estado: "confirmado" });
  assert.strictEqual(p.esDepi, true);
  assert.strictEqual(p.servicio, "Depilación");
});
check("depilación lee el detalle de notasSesion, no de detalleSesion", () => {
  const p = normalizarPaciente("reservasDepi", "d2", { dni: "114", nombre: "Noe", fecha: "2026-10-23", hora: "09:30", estado: "confirmado", notasSesion: "Axilas, 3er sesión", detalleSesion: "esto no debería leerse" });
  assert.strictEqual(p.detalleSesion, "Axilas, 3er sesión");
});
check("sin DNI queda null, nunca inventado", () => {
  const p = normalizarPaciente("reservas", "r3", { nombre: "Dana", fecha: "2026-10-23", hora: "12:00", estado: "confirmado" });
  assert.strictEqual(p.dni, null);
});

console.log("── agruparPorFecha ──");
check("agrupa por dia, ordena por hora, excluye canceladas y bloqueos", () => {
  const reservas = [
    normalizarPaciente("reservas", "r1", { dni: "1", nombre: "Tarde", fecha: "2026-10-23", hora: "15:00", estado: "confirmado" }),
    normalizarPaciente("reservas", "r2", { dni: "2", nombre: "Cancelada", fecha: "2026-10-23", hora: "08:00", estado: "cancelado" }),
    normalizarPaciente("reservas", "r3", { dni: "BLOQUEO", nombre: "Bloqueo admin", fecha: "2026-10-23", hora: "09:00", estado: "confirmado" }),
    normalizarPaciente("reservas", "r4", { dni: "4", nombre: "Mañana", fecha: "2026-10-23", hora: "09:30", estado: "confirmado" }),
    normalizarPaciente("reservas", "r5", { dni: "5", nombre: "Otro día", fecha: "2026-10-24", hora: "10:00", estado: "confirmado" }),
  ];
  const depi = [
    normalizarPaciente("reservasDepi", "d1", { dni: "6", nombre: "Depi temprano", fecha: "2026-10-23", hora: "08:30", estado: "confirmado" }),
  ];
  const mapa = agruparPorFecha(reservas, depi);
  assert.deepStrictEqual([...mapa.keys()].sort(), ["2026-10-23", "2026-10-24"]);
  const dia23 = mapa.get("2026-10-23").map((p) => p.nombre);
  assert.deepStrictEqual(dia23, ["Depi temprano", "Mañana", "Tarde"]);
  assert.strictEqual(mapa.get("2026-10-24").length, 1);
});
check("sin hora va al final del dia, ordenado por nombre", () => {
  const reservas = [
    normalizarPaciente("reservas", "r1", { dni: "1", nombre: "Zoe", fecha: "2026-10-23", hora: null, estado: "confirmado" }),
    normalizarPaciente("reservas", "r2", { dni: "2", nombre: "Ana", fecha: "2026-10-23", hora: "10:00", estado: "confirmado" }),
    normalizarPaciente("reservas", "r3", { dni: "3", nombre: "Bea", fecha: "2026-10-23", hora: null, estado: "confirmado" }),
  ];
  const mapa = agruparPorFecha(reservas, []);
  assert.deepStrictEqual(mapa.get("2026-10-23").map((p) => p.nombre), ["Ana", "Bea", "Zoe"]);
});
check("sin fecha no se puede ubicar en el calendario, no entra al mapa", () => {
  const reservas = [normalizarPaciente("reservas", "r1", { dni: "1", nombre: "Sin fecha", hora: "10:00", estado: "confirmado" })];
  const mapa = agruparPorFecha(reservas, []);
  assert.strictEqual(mapa.size, 0);
});

console.log("── calendario ──");
check("inicioMesISO toma el primer dia del mes actual", () => {
  const ms = Date.parse("2026-10-23T12:00:00-03:00");
  assert.strictEqual(inicioMesISO(ms), "2026-10-01");
});
check("mesDeFechaISO", () => {
  assert.strictEqual(mesDeFechaISO("2026-10-23"), "2026-10");
});
check("sumarMeses cruza el fin de año en ambos sentidos", () => {
  assert.strictEqual(sumarMeses("2026-10", 1), "2026-11");
  assert.strictEqual(sumarMeses("2026-12", 1), "2027-01");
  assert.strictEqual(sumarMeses("2027-01", -1), "2026-12");
});
check("nombreMes capitaliza y muestra el año", () => {
  assert.strictEqual(nombreMes("2026-10"), "Octubre 2026");
});
check("construirGrillaMes: octubre 2026 arranca en jueves, 5 semanas", () => {
  const semanas = construirGrillaMes("2026-10");
  assert.strictEqual(semanas[0][0], null); // lunes
  assert.strictEqual(semanas[0][1], null); // martes
  assert.strictEqual(semanas[0][2], null); // miercoles
  assert.strictEqual(semanas[0][3], "2026-10-01"); // jueves
  assert.strictEqual(semanas[0][6], "2026-10-04"); // domingo
  const todasLasFechas = semanas.flat().filter(Boolean);
  assert.strictEqual(todasLasFechas.length, 31);
  assert.strictEqual(todasLasFechas[todasLasFechas.length - 1], "2026-10-31");
});
check("tituloDia distingue hoy de otro dia", () => {
  assert.strictEqual(tituloDia("2026-10-23", "2026-10-23"), "Hoy, viernes 23/10");
  assert.strictEqual(tituloDia("2026-10-24", "2026-10-23"), "Sábado 24/10");
});

console.log("── formatearNombre (solo display, no toca el dato) ──");
check("capitaliza nombre en minusculas", () => {
  assert.strictEqual(formatearNombre("gabriela k"), "Gabriela K");
});
check("colapsa espacios de mas", () => {
  assert.strictEqual(formatearNombre("ana   maría"), "Ana María");
});
check("capitaliza despues de guion", () => {
  assert.strictEqual(formatearNombre("maria-jose perez"), "Maria-Jose Perez");
});
check("vacio no rompe", () => {
  assert.strictEqual(formatearNombre(""), "");
  assert.strictEqual(formatearNombre(null), "");
});

console.log(`\n${fails === 0 ? "Todo OK" : fails + " fallo(s)"}`);
process.exit(fails === 0 ? 0 : 1);
