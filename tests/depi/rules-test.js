// Pruebas de firestore.rules para reservasDepi / calendarExceptionsDepi /
// cobrosSesionDepi / cierresJornadaDepi contra el EMULADOR de Firestore —
// nunca contra producción. Datos 100% ficticios.
//
// Requiere el emulador de Firestore corriendo (puerto 8090, ver
// firebase.json) ANTES de correr este archivo:
//   firebase emulators:start --only firestore
// Correr con: node tests/depi/rules-test.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  initializeTestEnvironment, assertSucceeds, assertFails,
} from "@firebase/rules-unit-testing";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..", "..");

let fails = 0;
const check = (desc, cond) => { console.log((cond ? "  OK  " : "  FAIL ") + desc); if (!cond) fails++; };

const ADMIN_EMAIL = "espaciomimart36@gmail.com";
const GIMENA_EMAIL = "gimenadepi@gmail.com";
const OTRO_PROFESIONAL_EMAIL = "doctora.mimart@gmail.com"; // autorizada en OTRO módulo (doctora), no en depilación

async function run() {
  const testEnv = await initializeTestEnvironment({
    projectId: "estetica-8d067-rules-test",
    firestore: {
      rules: fs.readFileSync(path.join(PROJECT_ROOT, "firestore.rules"), "utf8"),
      host: "127.0.0.1",
      port: 8090,
    },
  });

  const admin = testEnv.authenticatedContext("uid-admin", { email: ADMIN_EMAIL }).firestore();
  const gimena = testEnv.authenticatedContext("uid-gimena", { email: GIMENA_EMAIL }).firestore();
  const otroProfesional = testEnv.authenticatedContext("uid-otro", { email: OTRO_PROFESIONAL_EMAIL }).firestore();
  const anonimo = testEnv.unauthenticatedContext().firestore();
  const anonimoFirebase = testEnv.authenticatedContext("uid-anonimo-firebase", {}).firestore();

  console.log("\n=== reservasDepi: la paciente reserva sin login, pero solo esAdminDepi() modifica/borra ===");
  {
    check("una visitante sin login PUEDE crear su propia reserva (booking público)", await assertSucceeds(
      anonimo.collection("reservasDepi").doc("res-web-1").set({ nombre: "Paciente Prueba Web", fecha: "2099-01-01", hora: "10:00", estado: "confirmado", creadoPor: "paciente_web" })
    ).then(() => true).catch(() => false));

    check("cualquiera puede LEER reservasDepi (necesario para ver horarios ocupados antes de reservar)", await assertSucceeds(
      anonimo.collection("reservasDepi").doc("res-web-1").get()
    ).then(() => true).catch(() => false));

    check("una visitante sin login NO puede modificar una reserva ya creada (antes sí podía: la regla era \"if true\")", await assertFails(
      anonimo.collection("reservasDepi").doc("res-web-1").update({ estado: "cancelada" })
    ).then(() => true).catch(() => false));

    check("una visitante sin login NO puede borrar una reserva (soft-delete vía updateDoc tampoco)", await assertFails(
      anonimo.collection("reservasDepi").doc("res-web-1").update({ eliminado: true })
    ).then(() => true).catch(() => false));

    check("una sesión anónima de Firebase (auth != null, sin email autorizado) tampoco puede modificar", await assertFails(
      anonimoFirebase.collection("reservasDepi").doc("res-web-1").update({ estado: "cancelada" })
    ).then(() => true).catch(() => false));

    check("una cuenta autenticada pero de OTRO módulo (doctora) NO puede tocar reservasDepi", await assertFails(
      otroProfesional.collection("reservasDepi").doc("res-web-1").update({ estado: "cancelada" })
    ).then(() => true).catch(() => false));

    check("la administradora general (esAdminDepi) SÍ puede modificar la reserva creada desde la web — el bug reportado", await assertSucceeds(
      admin.collection("reservasDepi").doc("res-web-1").update({ estado: "confirmada", updatedAt: new Date() })
    ).then(() => true).catch(() => false));

    check("la administradora general SÍ puede borrarla (soft-delete: estado+eliminado) — el bug reportado", await assertSucceeds(
      admin.collection("reservasDepi").doc("res-web-1").update({ estado: "cancelada", eliminado: true })
    ).then(() => true).catch(() => false));

    check("Gimena (esAdminDepi, otro operador) también puede gestionar una reserva sin operador o de otro operador", await assertSucceeds(
      gimena.collection("reservasDepi").doc("res-web-1").update({ notasSesion: "nota de prueba" })
    ).then(() => true).catch(() => false));
  }

  console.log("\n=== calendarExceptionsDepi: mismo criterio — crear público, tocar solo esAdminDepi() ===");
  {
    check("la visitante puede crear el bloqueo de slot al reservar", await assertSucceeds(
      anonimo.collection("calendarExceptionsDepi").doc("depi_2099-01-01_1000").set({ fecha: "2099-01-01", hora: "10:00", blocked: true, tipo: "reserva", reservaId: "res-web-1" })
    ).then(() => true).catch(() => false));

    check("una visitante sin login NO puede borrar un bloqueo (desbloquear un slot ajeno)", await assertFails(
      anonimo.collection("calendarExceptionsDepi").doc("depi_2099-01-01_1000").delete()
    ).then(() => true).catch(() => false));

    check("la administradora SÍ puede borrar el bloqueo (liberar el slot al cancelar/eliminar el turno)", await assertSucceeds(
      admin.collection("calendarExceptionsDepi").doc("depi_2099-01-01_1000").delete()
    ).then(() => true).catch(() => false));
  }

  console.log("\n=== cobrosSesionDepi / cierresJornadaDepi: registros financieros, antes públicos, ahora solo esAdminDepi() ===");
  {
    check("una visitante sin login NO puede leer cobros (antes sí: la regla era \"if true\")", await assertFails(
      anonimo.collection("cobrosSesionDepi").doc("cobro-1").get()
    ).then(() => true).catch(() => false));

    check("una visitante sin login NO puede crear un cobro falso", await assertFails(
      anonimo.collection("cobrosSesionDepi").doc("cobro-1").set({ operador: "becker", monto: 999999 })
    ).then(() => true).catch(() => false));

    check("la administradora SÍ puede registrar un cobro", await assertSucceeds(
      admin.collection("cobrosSesionDepi").doc("cobro-1").set({ operador: "becker", monto: 15000, fecha: "2099-01-01" })
    ).then(() => true).catch(() => false));

    check("Gimena SÍ puede cerrar su jornada", await assertSucceeds(
      gimena.collection("cierresJornadaDepi").doc("gimena_2099-01-01").set({ operador: "gimena", fecha: "2099-01-01", total: 15000 })
    ).then(() => true).catch(() => false));

    check("una cuenta de otro módulo (doctora) NO puede leer los cierres de caja de depilación", await assertFails(
      otroProfesional.collection("cierresJornadaDepi").doc("gimena_2099-01-01").get()
    ).then(() => true).catch(() => false));
  }

  console.log("\n=== Regresión: reservas_depi (alias viejo) sigue igual, sin tocar ===");
  {
    check('el alias viejo "reservas_depi" sigue exigiendo esAdminDepi() como antes (no se tocó)', await assertFails(
      anonimo.collection("reservas_depi").doc("x").get()
    ).then(() => true).catch(() => false));
  }

  await testEnv.cleanup();

  console.log("\n" + "=".repeat(60));
  console.log(fails ? (fails + " prueba(s) fallaron") : "TODAS LAS PRUEBAS OK");
  process.exit(fails ? 1 : 0);
}

run().catch((e) => { console.error("ERROR FATAL:", e); process.exit(1); });
