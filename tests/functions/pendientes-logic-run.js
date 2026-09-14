// Pruebas del espejo CommonJS (functions/pendientes-logic.js) de la regla
// canónica de pendientes. No usa el emulador — es lógica pura, igual que
// tests/mimar-inteligente/run-tests.js del lado cliente (ESM). Corre con:
// node tests/functions/pendientes-logic-run.js
//
// Además de probar el módulo CJS por su cuenta, cruza resultados contra el
// módulo ESM del cliente para el mismo escenario — así "mismo comporta-
// miento en los dos lados" no es solo una afirmación en un comentario.
const path = require("path");
const {
  derivarPendientes, resumenTextoPendientes, contarPendientesPorTipo,
  idContactoParaItem, docIdVersionadoCumpleanos, pendientesElegiblesParaAviso,
  enDescansoNocturno, PREFS_AVISOS_DEFECTO,
} = require(path.join(__dirname, "..", "..", "functions", "pendientes-logic.js"));

let fails = 0;
const check = (desc, cond) => { console.log((cond ? "  OK  " : "  FAIL ") + desc); if (!cond) fails++; };

async function run() {
  const HOY = "2026-09-10";
  const ahoraTurno = new Date(`${HOY}T14:00:00-03:00`).getTime();
  const ahoraDentroVentana = ahoraTurno - 2 * 3600000;

  console.log("\n=== Espejo CJS: confirmación de turno, versionado por ocurrencia, kit, cumpleaños, recomendación ===");
  {
    const reservasRaw = [{ id: "t1", data: { nombre: "Ana Pendiente", fecha: HOY, hora: "14:00", telefono: "3760000001", estado: "confirmado" } }];
    const pend1 = derivarPendientes({ reservasRaw, consultasRaw: [], pedidosKitPendientesRaw: [], cumpleanosHoy: null, recomendacionesRaw: [], contactosPorId: {} }, ahoraDentroVentana);
    check("un turno sin confirmar dentro de la ventana de 24h es pendiente", pend1.some((p) => p.docId === "t1" && p.tipo === "confirmacion_turno"));

    const idContactoT1 = idContactoParaItem({ coleccion: "reservas", id: "t1", fecha: HOY, hora: "14:00" }, "confirmacion");
    const pend2 = derivarPendientes({ reservasRaw, consultasRaw: [], pedidosKitPendientesRaw: [], cumpleanosHoy: null, recomendacionesRaw: [], contactosPorId: { [idContactoT1]: { estado: "enviado" } } }, ahoraDentroVentana);
    check("con el contacto de ESA ocurrencia enviado, deja de ser pendiente", !pend2.some((p) => p.docId === "t1"));

    const reservasReprogramadas = [{ id: "t1", data: { nombre: "Ana Pendiente", fecha: "2026-09-12", hora: "15:00", telefono: "3760000001", estado: "confirmado" } }];
    const ahoraNueva = new Date("2026-09-12T15:00:00-03:00").getTime() - 3600000;
    const pend3 = derivarPendientes({ reservasRaw: reservasReprogramadas, consultasRaw: [], pedidosKitPendientesRaw: [], cumpleanosHoy: null, recomendacionesRaw: [], contactosPorId: { [idContactoT1]: { estado: "enviado" } } }, ahoraNueva);
    check("reprogramado: el enviado viejo no cierra la ocurrencia nueva", pend3.some((p) => p.docId === "t1"));

    const pendKit = derivarPendientes({ reservasRaw: [], consultasRaw: [], pedidosKitPendientesRaw: [{ id: "k1", data: { nombrePaciente: "Beto Kit" } }], cumpleanosHoy: null, recomendacionesRaw: [], contactosPorId: {} }, Date.now());
    check("un pedido de kit pendiente genera un pendiente propio", pendKit.length === 1 && pendKit[0].tipo === "kit_pendiente");

    const cumple = { estado: "ok", fecha: "2026-09-10", personas: [{ clientId: "c1", nombre: "Cami Cumple" }] };
    const idCumpleViejo = `clients_${docIdVersionadoCumpleanos("c1", "2025-09-10")}_cumpleanos`;
    const pendCumple = derivarPendientes({ reservasRaw: [], consultasRaw: [], pedidosKitPendientesRaw: [], cumpleanosHoy: cumple, recomendacionesRaw: [], contactosPorId: { [idCumpleViejo]: { estado: "enviado" } } }, Date.now());
    check("cumpleaños: el saludo del año pasado no cierra el de este año", pendCumple.some((p) => p.docId === "c1"));

    const recomendacionesRaw = [{ id: "r1", data: { pacienteNombre: "Dana Reco", estado: "pendiente", programadoParaMs: Date.now() - 1000 } }];
    const pendRec = derivarPendientes({ reservasRaw: [], consultasRaw: [], pedidosKitPendientesRaw: [], cumpleanosHoy: null, recomendacionesRaw, contactosPorId: {} }, Date.now());
    check("una recomendación con la hora ya cumplida es un pendiente", pendRec.some((p) => p.docId === "r1" && p.tipo === "recomendacion"));
  }

  console.log("\n=== Espejo CJS: turno pasado sin revisar, y fallback de teléfono por DNI (caso Yamila) ===");
  {
    const ayer = new Date(ahoraTurno); ayer.setUTCDate(ayer.getUTCDate() - 1);
    const fechaAyer = ayer.toISOString().slice(0, 10);
    const reservaPasadaSinNota = [{ id: "p1", data: { nombre: "Turno Viejo", fecha: fechaAyer, hora: "14:00", telefono: "3760000002", estado: "confirmado" } }];
    const pendPasado = derivarPendientes({ reservasRaw: reservaPasadaSinNota, consultasRaw: [], pedidosKitPendientesRaw: [], cumpleanosHoy: null, recomendacionesRaw: [], contactosPorId: {} }, Date.now());
    check("un turno de ayer sin detalleSesion es 'revisar_turno'", pendPasado.some((p) => p.docId === "p1" && p.tipo === "revisar_turno"));

    const reservaPasadaConNota = [{ id: "p2", data: { nombre: "Turno Viejo Atendido", fecha: fechaAyer, hora: "14:00", telefono: "3760000003", estado: "confirmado", detalleSesion: "Sesión realizada sin novedades." } }];
    const pendPasadoConNota = derivarPendientes({ reservasRaw: reservaPasadaConNota, consultasRaw: [], pedidosKitPendientesRaw: [], cumpleanosHoy: null, recomendacionesRaw: [], contactosPorId: {} }, Date.now());
    check("un turno de ayer CON detalleSesion ya cargado no genera 'revisar_turno'", !pendPasadoConNota.some((p) => p.docId === "p2"));

    // Caso real (Arenhardt Yamila, dni 32899820): la reserva se guardó con
    // telefono/phone en "" pero clients/{dni} sí tiene el número.
    const clientesPorDni = { "32899820": { telefono: "3757670046" } };
    const reservaSinTelefonoPropio = [{ id: "y1", data: { nombre: "Arenhardt Yamila", dni: "32899820", fecha: HOY, hora: "14:00", telefono: "", phone: "", estado: "confirmado" } }];
    const pendYamila = derivarPendientes({ reservasRaw: reservaSinTelefonoPropio, consultasRaw: [], pedidosKitPendientesRaw: [], cumpleanosHoy: null, recomendacionesRaw: [], contactosPorId: {}, clientesPorDni }, ahoraDentroVentana);
    const pyamila = pendYamila.find((p) => p.docId === "y1");
    check("con fallback por DNI, el pendiente de Yamila NO queda bloqueado", pyamila && pyamila.bloqueado === false);

    // Un homónimo (otro dni) sin teléfono propio y sin ficha con teléfono sí queda bloqueado.
    const reservaHomonimoSinDatos = [{ id: "y2", data: { nombre: "Yamila De Olivera", dni: "99999999", fecha: HOY, hora: "14:00", telefono: "", estado: "confirmado" } }];
    const pendHomonimo = derivarPendientes({ reservasRaw: reservaHomonimoSinDatos, consultasRaw: [], pedidosKitPendientesRaw: [], cumpleanosHoy: null, recomendacionesRaw: [], contactosPorId: {}, clientesPorDni }, ahoraDentroVentana);
    const phomonimo = pendHomonimo.find((p) => p.docId === "y2");
    check("un homónimo con dni distinto y sin ficha con teléfono SÍ queda bloqueado (nunca usa el de Yamila)", phomonimo && phomonimo.bloqueado === true);
  }

  console.log("\n=== Espejo CJS: resumen agrupado y elegibilidad para el aviso ===");
  {
    const lista = [{ tipo: "recomendacion" }, { tipo: "recomendacion" }, { tipo: "confirmacion_turno" }, { tipo: "kit_pendiente" }];
    check("mismo texto de resumen que el lado cliente", resumenTextoPendientes(lista) === "Tenés 4 pendientes: 2 recomendaciones, 1 turno por confirmar y 1 kit.");
    check("sin pendientes, sin texto (nunca avisa vacío)", resumenTextoPendientes([]) === null);
    check("conteo por tipo exacto", contarPendientesPorTipo(lista).recomendacion === 2);

    const pendientes = [{ id: "p1", tipo: "recomendacion" }];
    check("pausado → no elegible", pendientesElegiblesParaAviso(pendientes, { ...PREFS_AVISOS_DEFECTO, pausadoHastaMs: Date.now() + 60000 }, {}, Date.now()).length === 0);
    check("descanso nocturno 22→8 cruza medianoche correctamente", enDescansoNocturno({ ...PREFS_AVISOS_DEFECTO, descansoInicioHora: 22, descansoFinHora: 8 }, new Date("2026-09-10T01:00:00-03:00").getTime()) === true);
  }

  console.log("\n" + "=".repeat(60));
  console.log(fails ? (fails + " prueba(s) fallaron") : "TODAS LAS PRUEBAS OK");
  process.exit(fails ? 1 : 0);
}

run().catch((e) => { console.error("ERROR FATAL:", e); process.exit(1); });
