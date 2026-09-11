// Pruebas end-to-end de admin-depi.html: carga el HTML real en jsdom,
// ejecuta el script real del módulo (con ./js/firebase-web.js reemplazado
// por un fake controlable con store en memoria + cola de errores
// forzados), y dispara clicks a mano sobre window.eliminarTurno /
// mostrarConfirmDepi reales. Nunca toca Firestore real. Datos 100%
// ficticios. Reproduce el reporte real: un turno creado desde la web
// (sin "operador") que había que poder borrar desde el panel.
// Correr con: node tests/depi/e2e-run.js
import fs from "fs";
import path from "path";
import { JSDOM } from "jsdom";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.join(__dirname, "..", "..");

let fails = 0;
const check = (desc, cond) => { console.log((cond ? "  OK  " : "  FAIL ") + desc); if (!cond) fails++; };

const html = fs.readFileSync(path.join(PROJECT, "admin-depi.html"), "utf8");
const dom = new JSDOM(html, { url: "http://localhost/admin-depi.html", pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
try { Object.defineProperty(global, "navigator", { value: dom.window.navigator, configurable: true }); } catch (_) {}
try { Object.defineProperty(dom.window.navigator, "onLine", { value: true, configurable: true }); } catch (_) {}
window.confirm = () => true;

const scriptMatch = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!scriptMatch) throw new Error("No se encontró el <script type=\"module\"> en admin-depi.html");
let scriptSrc = scriptMatch[1].replace('from "/js/firebase-web.js"', 'from "./fake-firebase-web.js"');
const scriptPath = path.join(__dirname, "_admin-depi-page.generated.mjs");
fs.writeFileSync(scriptPath, scriptSrc);

const fakeFb = await import("./fake-firebase-web.js");
await import("./_admin-depi-page.generated.mjs");
fs.unlinkSync(scriptPath);

// admin-depi.html llama a algunas funciones como identificador suelto
// (ej. "verDia(fecha)" dentro de eliminarTurno) confiando en que, en un
// navegador real, window ES el objeto global y esas llamadas caen sobre
// window.verDia aunque nunca se haya declarado un "const verDia" local —
// comportamiento normal y correcto de un browser real. Node, al importar
// dinámicamente el módulo generado, resuelve esos identificadores sueltos
// contra su PROPIO globalThis, no contra dom.window, así que hay que
// replicar ese puente a mano para que el módulo se comporte como en un
// navegador real.
globalThis.verDia = dom.window.verDia;

const $ = (id) => document.getElementById(id);
async function tick(n = 1) { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); }

function seedTurno(id, data) {
  fakeFb.calls.store.set(`reservasDepi/${id}`, data);
}
function turnoActual(id) {
  return fakeFb.calls.store.get(`reservasDepi/${id}`);
}

async function abrirYConfirmarBorrado() {
  window.eliminarTurno("turno-web-1", "2099-05-10");
  await tick();
  $("confirmSi").click();
  await tick(3);
}

async function run() {
  console.log("\n=== Reporte real: borrar un turno creado desde la web (sin \"operador\") ===");
  {
    seedTurno("turno-web-1", {
      nombre: "Paciente De Prueba Web", fecha: "2099-05-10", hora: "10:00",
      estado: "confirmado", eliminado: false, creadoPor: "paciente_web", dni: "11222333",
    });
    await abrirYConfirmarBorrado();
    const doc_ = turnoActual("turno-web-1");
    check("el turno queda marcado eliminado:true en el servidor", doc_?.eliminado === true);
    check("el turno queda marcado estado:cancelada", doc_?.estado === "cancelada");
    check('el aviso confirma "Turno eliminado"', $("avisoDepi").textContent === "Turno eliminado");
  }

  console.log("\n=== Doble click en \"Sí, eliminar\": no dispara la acción dos veces ===");
  {
    fakeFb.calls.updateDocCalls.length = 0;
    seedTurno("turno-doble-click", { nombre: "Paciente Doble Click", fecha: "2099-05-11", hora: "11:00", estado: "confirmado", eliminado: false });
    window.eliminarTurno("turno-doble-click", "2099-05-11");
    await tick();
    // dos clicks sincrónicos, como un doble click real antes de que el modal
    // termine de cerrarse
    $("confirmSi").click();
    $("confirmSi").click();
    await tick(3);
    check("updateDoc se llamó una sola vez, no dos", fakeFb.calls.updateDocCalls.length === 1);
  }

  console.log("\n=== Turno ya eliminado por otra persona/pestaña: no reintenta la escritura ===");
  {
    fakeFb.calls.updateDocCalls.length = 0;
    seedTurno("turno-ya-eliminado", { nombre: "Paciente Ya Eliminada", fecha: "2099-05-12", hora: "12:00", estado: "cancelada", eliminado: true });
    window.eliminarTurno("turno-ya-eliminado", "2099-05-12");
    await tick();
    $("confirmSi").click();
    await tick(3);
    check("no se llamó a updateDoc (ya estaba eliminado, no hay nada que sobrescribir)", fakeFb.calls.updateDocCalls.length === 0);
    check('el aviso explica que ya estaba eliminado', $("avisoDepi").textContent.toLowerCase().includes("ya estaba eliminado"));
  }

  console.log("\n=== Sin permiso (sesión vieja / no autorizada): mensaje claro y accionable, no genérico ===");
  {
    seedTurno("turno-sin-permiso", { nombre: "Paciente Sin Permiso", fecha: "2099-05-13", hora: "13:00", estado: "confirmado", eliminado: false });
    fakeFb.calls.errorQueue.push({ fn: "updateDoc", error: Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" }) });
    window.eliminarTurno("turno-sin-permiso", "2099-05-13");
    await tick();
    $("confirmSi").click();
    await tick(3);
    const msg = $("avisoDepi").textContent;
    check('el mensaje menciona el permiso, no un "Error al eliminar" genérico', msg.toLowerCase().includes("permiso"));
    check('el mensaje sugiere la acción correcta (cerrar sesión y volver a entrar)', msg.toLowerCase().includes("cerrá sesión") || msg.toLowerCase().includes("cerrar sesión"));
    check("el turno NO quedó marcado eliminado (la escritura fue rechazada)", turnoActual("turno-sin-permiso")?.eliminado === false);
  }

  console.log("\n=== Pérdida de conexión: mensaje específico, no genérico ===");
  {
    seedTurno("turno-sin-conexion", { nombre: "Paciente Sin Conexión", fecha: "2099-05-14", hora: "14:00", estado: "confirmado", eliminado: false });
    fakeFb.calls.errorQueue.push({ fn: "getDocFromServer", error: Object.assign(new Error("network error"), { code: "unavailable" }) });
    window.eliminarTurno("turno-sin-conexion", "2099-05-14");
    await tick();
    $("confirmSi").click();
    await tick(3);
    const msg = $("avisoDepi").textContent;
    check('el mensaje menciona la conexión', msg.toLowerCase().includes("conexión") || msg.toLowerCase().includes("conexion"));
    check("el turno NO quedó marcado eliminado", turnoActual("turno-sin-conexion")?.eliminado === false);
  }

  console.log("\n=== Reintento: tras un fallo, un segundo intento sí puede tener éxito ===");
  {
    fakeFb.calls.updateDocCalls.length = 0;
    seedTurno("turno-reintento", { nombre: "Paciente Reintento", fecha: "2099-05-15", hora: "15:00", estado: "confirmado", eliminado: false });
    fakeFb.calls.errorQueue.push({ fn: "updateDoc", error: Object.assign(new Error("network error"), { code: "unavailable" }) });
    window.eliminarTurno("turno-reintento", "2099-05-15");
    await tick();
    $("confirmSi").click();
    await tick(3);
    check("primer intento falló, turno sigue sin eliminar", turnoActual("turno-reintento")?.eliminado === false);
    // Segundo intento — sin error en la cola esta vez, y el botón de
    // confirmar tiene que haberse vuelto a habilitar para un nuevo intento.
    window.eliminarTurno("turno-reintento", "2099-05-15");
    await tick();
    check('el botón "Sí, eliminar" se reactivó para un nuevo intento', $("confirmSi").disabled === false);
    $("confirmSi").click();
    await tick(3);
    check("el reintento sí eliminó el turno", turnoActual("turno-reintento")?.eliminado === true);
  }

  console.log("\n=== Verificación contra el servidor, no solo \"no tiró excepción\" ===");
  {
    // El updateDoc "tiene éxito" (no tira excepción), pero la relectura
    // contra el servidor devuelve el estado ANTERIOR — simula una
    // escritura que quedó encolada offline y todavía no llegó al servidor.
    // El panel no debe avisar "Turno eliminado" en ese caso.
    seedTurno("turno-verificacion", { nombre: "Paciente Verificación", fecha: "2099-05-16", hora: "16:00", estado: "confirmado", eliminado: false });
    // eliminarTurno llama a getDocFromServer DOS veces: antes de escribir
    // (chequeo de "¿ya está eliminado?") y después (verificación). La cola
    // es FIFO, así que la primera respuesta tiene que ser el estado normal
    // (para que decida seguir y escribir) y la segunda la "stale".
    fakeFb.calls.staleReadQueue.push({ nombre: "Paciente Verificación", fecha: "2099-05-16", hora: "16:00", estado: "confirmado", eliminado: false });
    fakeFb.calls.staleReadQueue.push({ nombre: "Paciente Verificación", fecha: "2099-05-16", hora: "16:00", estado: "confirmado", eliminado: false });
    window.eliminarTurno("turno-verificacion", "2099-05-16");
    await tick();
    $("confirmSi").click();
    await tick(3);
    const msg = $("avisoDepi").textContent;
    check('NO avisa "Turno eliminado" si el servidor todavía no lo refleja', msg !== "Turno eliminado");
    check("avisa que no se pudo confirmar contra el servidor", msg.toLowerCase().includes("confirmar"));
  }

  console.log("\n" + "=".repeat(60));
  console.log(fails ? (fails + " prueba(s) fallaron") : "TODAS LAS PRUEBAS OK");
  process.exit(fails ? 1 : 0);
}

run().catch((e) => { console.error("ERROR FATAL:", e); process.exit(1); });
