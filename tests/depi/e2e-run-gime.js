// Misma batería que e2e-run.js pero contra admin-depi-gime.html — los
// mismos cambios se aplicaron a mano en los dos archivos (no hay un
// módulo compartido entre ambos paneles), así que se prueban los dos por
// separado para no confiar en que la copia haya sido fiel.
// Correr con: node tests/depi/e2e-run-gime.js
import fs from "fs";
import path from "path";
import { JSDOM } from "jsdom";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.join(__dirname, "..", "..");

let fails = 0;
const check = (desc, cond) => { console.log((cond ? "  OK  " : "  FAIL ") + desc); if (!cond) fails++; };

const html = fs.readFileSync(path.join(PROJECT, "admin-depi-gime.html"), "utf8");
const dom = new JSDOM(html, { url: "http://localhost/admin-depi-gime.html", pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
try { Object.defineProperty(global, "navigator", { value: dom.window.navigator, configurable: true }); } catch (_) {}
try { Object.defineProperty(dom.window.navigator, "onLine", { value: true, configurable: true }); } catch (_) {}
window.confirm = () => true;

const scriptMatch = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!scriptMatch) throw new Error("No se encontró el <script type=\"module\"> en admin-depi-gime.html");
let scriptSrc = scriptMatch[1].replace('from "/js/firebase-web.js"', 'from "./fake-firebase-web.js"');
const scriptPath = path.join(__dirname, "_admin-depi-gime-page.generated.mjs");
fs.writeFileSync(scriptPath, scriptSrc);

const fakeFb = await import("./fake-firebase-web.js");
await import("./_admin-depi-gime-page.generated.mjs");
fs.unlinkSync(scriptPath);
globalThis.verDia = dom.window.verDia;

const $ = (id) => document.getElementById(id);
async function tick(n = 1) { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); }
function seedTurno(id, data) { fakeFb.calls.store.set(`reservasDepi/${id}`, data); }
function turnoActual(id) { return fakeFb.calls.store.get(`reservasDepi/${id}`); }

async function run() {
  console.log("\n=== admin-depi-gime.html: borrar un turno creado desde la web (sin \"operador\") ===");
  {
    seedTurno("turno-web-gime-1", {
      nombre: "Paciente De Prueba Web Gime", fecha: "2099-05-20", hora: "09:00",
      estado: "confirmado", eliminado: false, creadoPor: "paciente_web",
    });
    window.eliminarTurno("turno-web-gime-1", "2099-05-20");
    await tick();
    $("confirmSi").click();
    await tick(3);
    const doc_ = turnoActual("turno-web-gime-1");
    check("el turno queda marcado eliminado:true en el servidor", doc_?.eliminado === true);
    check('el aviso confirma "Turno eliminado"', $("avisoDepi").textContent === "Turno eliminado");
  }

  console.log("\n=== admin-depi-gime.html: doble click no duplica la acción ===");
  {
    fakeFb.calls.updateDocCalls.length = 0;
    seedTurno("turno-doble-gime", { nombre: "Paciente Doble Gime", fecha: "2099-05-21", hora: "10:00", estado: "confirmado", eliminado: false });
    window.eliminarTurno("turno-doble-gime", "2099-05-21");
    await tick();
    $("confirmSi").click();
    $("confirmSi").click();
    await tick(3);
    check("updateDoc se llamó una sola vez", fakeFb.calls.updateDocCalls.length === 1);
  }

  console.log("\n=== admin-depi-gime.html: sin permiso, mensaje claro ===");
  {
    seedTurno("turno-sin-permiso-gime", { nombre: "Paciente Sin Permiso Gime", fecha: "2099-05-22", hora: "11:00", estado: "confirmado", eliminado: false });
    fakeFb.calls.errorQueue.push({ fn: "updateDoc", error: Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" }) });
    window.eliminarTurno("turno-sin-permiso-gime", "2099-05-22");
    await tick();
    $("confirmSi").click();
    await tick(3);
    const msg = $("avisoDepi").textContent;
    check("el mensaje menciona el permiso", msg.toLowerCase().includes("permiso"));
    check("el turno NO quedó eliminado", turnoActual("turno-sin-permiso-gime")?.eliminado === false);
  }

  console.log("\n" + "=".repeat(60));
  console.log(fails ? (fails + " prueba(s) fallaron") : "TODAS LAS PRUEBAS OK");
  process.exit(fails ? 1 : 0);
}

run().catch((e) => { console.error("ERROR FATAL:", e); process.exit(1); });
