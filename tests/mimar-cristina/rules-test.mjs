// Pruebas de firestore.rules para el permiso nuevo de Mimar T
// Administracion: Cristina (esAdminDepi, NO esAdmin) puede editar SOLO
// reservas.detalleSesion — nunca el resto de la reserva. Contra el
// EMULADOR de Firestore, nunca contra produccion. Datos 100% ficticios.
//
// Requiere el emulador corriendo (puerto 8090, ver firebase.json) ANTES
// de correr este archivo:
//   firebase emulators:start --only firestore
// Correr con: node tests/mimar-cristina/rules-test.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  initializeTestEnvironment, assertSucceeds, assertFails,
} from "@firebase/rules-unit-testing";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..", "..");

let fails = 0;
const check = async (desc, promesa) => {
  const ok = await promesa.then(() => true).catch(() => false);
  console.log((ok ? "  OK  " : "  FAIL ") + desc);
  if (!ok) fails++;
};

const CRISTINA_EMAIL = "depi.mimart@gmail.com"; // esAdminDepi, NO esAdmin
const ADMIN_EMAIL = "espaciomimart36@gmail.com";
const OTRO_EMAIL = "doctora.mimart@gmail.com"; // autorizada en OTRO modulo, no acá

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
  const cristina = testEnv.authenticatedContext("uid-cristina", { email: CRISTINA_EMAIL }).firestore();
  const otro = testEnv.authenticatedContext("uid-otro", { email: OTRO_EMAIL }).firestore();
  const anonimo = testEnv.unauthenticatedContext().firestore();

  // Sembrar una reserva ficticia saltando las reglas (contexto admin del SDK).
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection("reservas").doc("res-prueba-1").set({
      dni: "99999999", nombreLimpio: "Paciente Prueba", servicio: "Tratamiento Facial",
      fecha: "2099-01-01", hora: "10:00", estado: "confirmado", box: "b3",
    });
  });

  console.log("\n=== reservas.detalleSesion: permiso acotado para Cristina ===");

  await check("Cristina puede cargar detalleSesion (+ campos de trazabilidad)", assertSucceeds(
    cristina.collection("reservas").doc("res-prueba-1").update({
      detalleSesion: "Limpieza facial, piel sensible",
      detalleSesionActualizadoPorEmail: CRISTINA_EMAIL,
      detalleSesionActualizadoAt: new Date(),
    })
  ));

  await check("Cristina NO puede tocar el servicio aprovechando ese permiso", assertFails(
    cristina.collection("reservas").doc("res-prueba-1").update({
      detalleSesion: "intento de cambiar otra cosa",
      servicio: "Hi-Fu Corporal",
    })
  ));

  await check("Cristina NO puede tocar el box aprovechando ese permiso", assertFails(
    cristina.collection("reservas").doc("res-prueba-1").update({ detalleSesion: "x", box: "b1" })
  ));

  await check("Cristina NO puede cancelar la reserva (estado)", assertFails(
    cristina.collection("reservas").doc("res-prueba-1").update({ detalleSesion: "x", estado: "cancelada" })
  ));

  await check("Cristina NO puede borrar la reserva", assertFails(
    cristina.collection("reservas").doc("res-prueba-1").delete()
  ));

  await check("otra profesional autorizada en OTRO modulo no puede tocar detalleSesion", assertFails(
    otro.collection("reservas").doc("res-prueba-1").update({ detalleSesion: "intruso" })
  ));

  await check("un usuario sin autenticar no puede tocar detalleSesion", assertFails(
    anonimo.collection("reservas").doc("res-prueba-1").update({ detalleSesion: "intruso anonimo" })
  ));

  await check("el admin general sigue pudiendo editar todo (servicio, box, estado) como antes", assertSucceeds(
    admin.collection("reservas").doc("res-prueba-1").update({ servicio: "Tratamientos Corporales", box: "b2", estado: "cancelada" })
  ));

  await testEnv.cleanup();
  console.log(`\n${fails === 0 ? "Todo OK" : fails + " fallo(s)"}`);
  process.exit(fails === 0 ? 0 : 1);
}
run().catch((e) => { console.error("FATAL", e); process.exit(1); });
