// Pruebas de firestore.rules para "Pacientes de la Doctora" contra el
// EMULADOR de Firestore — nunca contra producción. Datos 100% ficticios.
//
// Requiere el emulador de Firestore corriendo (puerto 8090, ver
// firebase.json) ANTES de correr este archivo:
//   firebase emulators:start --only firestore
// Correr con: node tests/doctora/rules-test.js
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

const DOCTORA_EMAIL = "doctora.mimart@gmail.com";
const ADMIN_EMAIL = "espaciomimart36@gmail.com";
const OTRO_PROFESIONAL_EMAIL = "gimenadepi@gmail.com"; // autorizada en OTRO módulo (depilación), no en este

async function run() {
  const testEnv = await initializeTestEnvironment({
    projectId: "estetica-8d067-rules-test",
    firestore: {
      rules: fs.readFileSync(path.join(PROJECT_ROOT, "firestore.rules"), "utf8"),
      host: "127.0.0.1",
      port: 8090,
    },
  });

  const doctora = testEnv.authenticatedContext("uid-doctora", { email: DOCTORA_EMAIL }).firestore();
  const admin = testEnv.authenticatedContext("uid-admin", { email: ADMIN_EMAIL }).firestore();
  const otroProfesional = testEnv.authenticatedContext("uid-otro", { email: OTRO_PROFESIONAL_EMAIL }).firestore();
  const anonimo = testEnv.unauthenticatedContext().firestore();

  console.log("\n=== pacientesDoctora: acceso privado real ===");
  {
    check("la doctora puede crear un paciente ficticio", await assertSucceeds(
      doctora.collection("pacientesDoctora").doc("99999001").set({ nombre: "Paciente Prueba A", telefono: "3760000001" })
    ).then(() => true).catch(() => false));

    check("el admin general también puede leer ese paciente", await assertSucceeds(
      admin.collection("pacientesDoctora").doc("99999001").get()
    ).then(() => true).catch(() => false));

    check("otro profesional autorizado (depilación) NO puede leer estos pacientes", await assertFails(
      otroProfesional.collection("pacientesDoctora").doc("99999001").get()
    ).then(() => true).catch(() => false));

    check("un usuario sin autenticar NO puede leer estos pacientes", await assertFails(
      anonimo.collection("pacientesDoctora").doc("99999001").get()
    ).then(() => true).catch(() => false));

    check("un usuario sin autenticar NO puede escribir un paciente nuevo", await assertFails(
      anonimo.collection("pacientesDoctora").doc("99999002").set({ nombre: "Intruso", telefono: "0" })
    ).then(() => true).catch(() => false));

    check("otro profesional autorizado (depilación) NO puede escribir acá", await assertFails(
      otroProfesional.collection("pacientesDoctora").doc("99999002").set({ nombre: "Intruso", telefono: "0" })
    ).then(() => true).catch(() => false));
  }

  console.log("\n=== fechasHabilitadasDoctora / turnosDoctora: mismo criterio privado ===");
  {
    check("la doctora puede habilitar una fecha", await assertSucceeds(
      doctora.collection("fechasHabilitadasDoctora").doc("2099-01-01").set({ fecha: "2099-01-01", habilitada: true, horaInicio: "15:00", horaFin: "18:00", duracionTurnoMin: 30 })
    ).then(() => true).catch(() => false));

    check("otro profesional NO puede leer las fechas habilitadas", await assertFails(
      otroProfesional.collection("fechasHabilitadasDoctora").doc("2099-01-01").get()
    ).then(() => true).catch(() => false));

    check("la doctora puede crear un turno", await assertSucceeds(
      doctora.collection("turnosDoctora").doc("turno-prueba-1").set({ fecha: "2099-01-01", hora: "15:00", pacienteDni: "99999001", pacienteNombre: "Paciente Prueba A" })
    ).then(() => true).catch(() => false));

    check("un usuario sin autenticar NO puede leer turnos", await assertFails(
      anonimo.collection("turnosDoctora").doc("turno-prueba-1").get()
    ).then(() => true).catch(() => false));
  }

  console.log("\n=== slotsDoctora: el anti-doble-reserva se aplica también a nivel de reglas ===");
  {
    check("la doctora puede crear el slot ocupado por su propio turno", await assertSucceeds(
      doctora.collection("slotsDoctora").doc("2099-01-01_15-00").set({ ocupado: true, turnoId: "turno-prueba-1", fecha: "2099-01-01", hora: "15:00" })
    ).then(() => true).catch(() => false));

    check('actualizar el MISMO turnoId sobre un slot ya ocupado está permitido (reafirmar)', await assertSucceeds(
      doctora.collection("slotsDoctora").doc("2099-01-01_15-00").set({ ocupado: true, turnoId: "turno-prueba-1", fecha: "2099-01-01", hora: "15:00" }, { merge: true })
    ).then(() => true).catch(() => false));

    check("intentar pisar ese slot con OTRO turnoId (robarle el horario) se rechaza a nivel de reglas", await assertFails(
      doctora.collection("slotsDoctora").doc("2099-01-01_15-00").set({ ocupado: true, turnoId: "turno-intruso", fecha: "2099-01-01", hora: "15:00" }, { merge: true })
    ).then(() => true).catch(() => false));

    // Liberar NO cambia turnoId (así lo hace doctora.js — ver
    // asignarOReprogramarHorario): si lo pusiera en null, esta misma regla
    // lo interpretaría como "otro turno distinto" y lo rechazaría.
    check("liberar el slot (ocupado:false, mismo turnoId) sí está permitido", await assertSucceeds(
      doctora.collection("slotsDoctora").doc("2099-01-01_15-00").set({ ocupado: false }, { merge: true })
    ).then(() => true).catch(() => false));

    check("una vez liberado, otro turno SÍ puede ocuparlo", await assertSucceeds(
      doctora.collection("slotsDoctora").doc("2099-01-01_15-00").set({ ocupado: true, turnoId: "turno-nuevo", fecha: "2099-01-01", hora: "15:00" }, { merge: true })
    ).then(() => true).catch(() => false));
  }

  console.log("\n=== contactosWhatsAppDoctora / configDoctora: aislados del resto del sistema ===");
  {
    check("la doctora puede registrar un contacto preparado", await assertSucceeds(
      doctora.collection("contactosWhatsAppDoctora").doc("turno-prueba-1_confirmacion").set({ turnoId: "turno-prueba-1", tipoMensaje: "confirmacion", estado: "preparado" })
    ).then(() => true).catch(() => false));

    check("otro profesional NO puede leer el seguimiento de WhatsApp de la doctora", await assertFails(
      otroProfesional.collection("contactosWhatsAppDoctora").doc("turno-prueba-1_confirmacion").get()
    ).then(() => true).catch(() => false));

    check("la doctora puede configurar la ubicación del consultorio", await assertSucceeds(
      doctora.collection("configDoctora").doc("general").set({ ubicacion: "Consultorio de prueba" })
    ).then(() => true).catch(() => false));
  }

  console.log("\n=== Regresión: las reglas nuevas NO abren de más otras colecciones existentes ===");
  {
    // Nota: "clients" ya tenía de antes una regla separada
    // (noCambiaCamposAdmin(), sin chequeo de identidad) que permite
    // actualizar campos no protegidos sin ser esAdmin() — eso es preexistente
    // y no se toca acá. Lo que sí debe seguir protegido, con o sin las
    // reglas nuevas, son los campos realmente administrativos.
    check('la doctora sigue SIN poder tocar "membershipActive" en "clients" (protegido por esAdmin(), no afectado por las reglas nuevas)', await assertFails(
      doctora.collection("clients").doc("11111111").set({ membershipActive: true }, { merge: true })
    ).then(() => true).catch(() => false));

    check('la doctora sigue SIN poder leer "contactosWhatsApp" (el general, de otro alcance)', await assertFails(
      doctora.collection("contactosWhatsApp").doc("cualquiera").get()
    ).then(() => true).catch(() => false));

    check('el admin general SÍ sigue teniendo su acceso normal a "clients"', await assertSucceeds(
      admin.collection("clients").doc("11111111").set({ fullName: "Admin puede", active: true })
    ).then(() => true).catch(() => false));
  }

  await testEnv.cleanup();

  console.log("\n" + "=".repeat(60));
  console.log(fails ? (fails + " prueba(s) fallaron") : "TODAS LAS PRUEBAS OK");
  process.exit(fails ? 1 : 0);
}

run().catch((e) => { console.error("ERROR FATAL:", e); process.exit(1); });
