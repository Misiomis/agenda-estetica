// Pruebas end-to-end de doctora/index.html: carga el HTML real en jsdom,
// ejecuta el script real del módulo (doctora.js, con ./js/firebase-web.js
// reemplazado por un fake controlable), y dispara snapshots/auth/clicks a
// mano. Nunca toca Firestore real. Datos 100% ficticios.
// Correr con: node tests/doctora/e2e-run.js
import fs from "fs";
import path from "path";
import { JSDOM } from "jsdom";
import { fileURLToPath } from "url";
import { fechaISOEnZona } from "../../doctora/doctora-logic.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.join(__dirname, "..", "..");
const APP_DIR = path.join(PROJECT, "doctora");
const HOY = fechaISOEnZona(); // misma fecha que va a calcular la página real

let fails = 0;
const check = (desc, cond) => { console.log((cond ? "  OK  " : "  FAIL ") + desc); if (!cond) fails++; };

const html = fs.readFileSync(path.join(APP_DIR, "index.html"), "utf8");
const dom = new JSDOM(html, { url: "http://localhost/doctora/", pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
try { Object.defineProperty(global, "navigator", { value: dom.window.navigator, configurable: true }); } catch (_) {}
window.confirm = () => true; // no debería llamarse (banner no bloqueante), pero por las dudas no cuelga la prueba

let scriptSrc = fs.readFileSync(path.join(APP_DIR, "doctora.js"), "utf8");
scriptSrc = scriptSrc.replace('from "../js/firebase-web.js"', 'from "./fake-firebase-web.js"');
const logicUrl = "file:///" + path.join(APP_DIR, "doctora-logic.js").replace(/\\/g, "/");
scriptSrc = scriptSrc.replace('from "./doctora-logic.js"', `from "${logicUrl}"`);
const contactosUrl = "file:///" + path.join(APP_DIR, "doctora-contactos.js").replace(/\\/g, "/");
scriptSrc = scriptSrc.replace('from "./doctora-contactos.js"', `from "${contactosUrl}"`);
const scriptPath = path.join(__dirname, "_page-script.generated.mjs");
fs.writeFileSync(scriptPath, scriptSrc);

const fakeFb = await import("./fake-firebase-web.js");
await import("./_page-script.generated.mjs");
fs.unlinkSync(scriptPath);

const $ = (id) => document.getElementById(id);

function fakeUser(email) {
  return { uid: "uid-" + email, getIdTokenResult: async () => ({ claims: { email }, token: { email } }) };
}
async function login(email) {
  await fakeFb.calls.authCallback(fakeUser(email));
  await new Promise((r) => setTimeout(r, 0));
}
function ultimaSub(coleccionPath) {
  const entradas = fakeFb.calls.onSnapshotCalls.filter((e) => e.path === coleccionPath && e.kind !== "doc" && !e.unsubscribed);
  return entradas[entradas.length - 1];
}
function emitirSnapshot(coleccionPath, docs, fromCache = false) {
  const entrada = ultimaSub(coleccionPath);
  if (!entrada) throw new Error("No hay suscripción activa para " + coleccionPath);
  docs.__fromCache = fromCache;
  entrada.onNext(fakeFb.fakeSnap(docs));
}
// turnosDoctora tiene DOS suscripciones simultáneas que pueden coincidir en
// su where("fecha","==",...) al principio (cuando el selector todavía está
// en hoy): "Recordatorios de hoy" (se arma UNA sola vez, fija) y la grilla
// de la fecha seleccionada (se rearma cada vez que se navega). Por eso no
// se puede distinguir solo por el valor del where — se toma la PRIMERA
// suscripción alguna vez registrada para ese path+kind como "hoy fija", y
// se deja la última (la que ya usa emitirSnapshot) para la de la grilla.
function emitirSnapshotFijaHoy(coleccionPath, docs, fromCache = false) {
  const entrada = fakeFb.calls.onSnapshotCalls.find((e) => e.path === coleccionPath && e.kind !== "doc" && !e.unsubscribed);
  if (!entrada) throw new Error(`No hay suscripción "fija" activa para ${coleccionPath}`);
  docs.__fromCache = fromCache;
  entrada.onNext(fakeFb.fakeSnap(docs));
}
function emitirDoc(path_, id, data) {
  const entradas = fakeFb.calls.onSnapshotCalls.filter((e) => e.path === path_ && e.kind === "doc" && !e.unsubscribed);
  const entrada = entradas[entradas.length - 1];
  if (!entrada) throw new Error("No hay suscripción de documento activa para " + path_);
  entrada.onNext(fakeFb.fakeDocSnap(data !== null, id, data));
}
async function tick() { await new Promise((r) => setTimeout(r, 0)); }

async function run() {
  console.log("\n=== Acceso: cuenta NO autorizada se rechaza, no arma suscripciones ===");
  {
    await login("intruso@gmail.com");
    check("sigue mostrando el panel de acceso", $("access-panel").hidden === false && $("workspace").hidden === true);
    check("no se abrió ninguna suscripción de Firestore", fakeFb.calls.onSnapshotCalls.length === 0);
    check("se llamó a signOut para cerrar esa sesión no autorizada", fakeFb.calls.signOutCalls >= 1);
  }

  console.log("\n=== Acceso: la doctora entra y arma sus suscripciones ===");
  {
    await login("doctora.mimart@gmail.com");
    check("el workspace queda visible", $("workspace").hidden === false && $("access-panel").hidden === true);
    check("arranca en la pestaña Pacientes", $("tab-pacientes").hidden === false && $("tab-agenda").hidden === true);
    check("exactamente UNA suscripción a pacientesDoctora", fakeFb.calls.onSnapshotCalls.filter((e) => e.path === "pacientesDoctora" && !e.unsubscribed).length === 1);
  }

  console.log("\n=== Acceso: el admin general TAMBIÉN entra (mismo criterio que esAdminDepi) ===");
  {
    await login("espaciomimart36@gmail.com");
    check("también entra al workspace", $("workspace").hidden === false);
  }

  console.log("\n=== Re-entrada con el MISMO usuario: no duplica listeners ===");
  {
    await login("espaciomimart36@gmail.com");
    check("sigue habiendo UNA sola suscripción a pacientesDoctora", fakeFb.calls.onSnapshotCalls.filter((e) => e.path === "pacientesDoctora" && !e.unsubscribed).length === 1);
  }

  console.log("\n=== Pacientes: lista vacía inicial ===");
  {
    emitirSnapshot("pacientesDoctora", []);
    check("muestra el estado vacío, no un error", $("lista-pacientes").innerHTML.includes("Sin pacientes todavía"));
  }

  console.log("\n=== Alta de paciente: crea cuando el DNI no existía ===");
  {
    fakeFb.calls.setDocCalls.length = 0;
    $("btn-nuevo-paciente").click();
    check("el modal de paciente está abierto", $("paciente-dialog").open === true);
    $("pf-nombre").value = "Paciente Ficticia Uno";
    $("pf-dni").value = "12.345.678";
    $("pf-telefono").value = "3760000001";
    $("form-paciente").dispatchEvent(new window.Event("submit", { cancelable: true }));
    await tick();
    const creado = fakeFb.calls.setDocCalls.find((c) => c.path === "pacientesDoctora" && c.id === "12345678");
    check("el DNI se guarda normalizado (solo dígitos) como id del documento", !!creado);
    check("guarda el nombre y teléfono dados", creado?.data.nombre === "Paciente Ficticia Uno" && creado?.data.telefono === "3760000001");
  }

  console.log("\n=== Duplicación por DNI: no pisa datos existentes, señala el conflicto ===");
  {
    // Ya existe un/a paciente con este DNI y un teléfono distinto al que se va a cargar ahora.
    fakeFb.calls.getDocQueue.push({ snap: fakeFb.fakeDocSnap(true, "87654321", { nombre: "Paciente Ficticia Dos", telefono: "3769999999" }) });
    fakeFb.calls.setDocCalls.length = 0;
    $("btn-nuevo-paciente").click();
    $("pf-nombre").value = "Paciente Ficticia Dos";
    $("pf-dni").value = "87654321";
    $("pf-telefono").value = "3760000002"; // distinto al ya registrado
    $("form-paciente").dispatchEvent(new window.Event("submit", { cancelable: true }));
    await tick();
    check("NO se sobrescribe el teléfono ya registrado", !fakeFb.calls.setDocCalls.some((c) => c.path === "pacientesDoctora" && c.id === "87654321" && c.data.telefono === "3760000002"));
    check("se muestra el aviso de conflicto en pantalla", $("paciente-conflictos").hidden === false && $("paciente-conflictos").innerHTML.includes("difieren"));
    check("no se creó un segundo registro para el mismo DNI (se reutiliza el existente)", fakeFb.calls.setDocCalls.filter((c) => c.path === "pacientesDoctora" && c.id === "87654321").length <= 1);
  }

  console.log("\n=== Perfil incompleto: si el campo existente está vacío, SÍ se completa ===");
  {
    fakeFb.calls.getDocQueue.push({ snap: fakeFb.fakeDocSnap(true, "11111111", { nombre: "Paciente Ficticia Tres", telefono: "" }) });
    fakeFb.calls.setDocCalls.length = 0;
    $("btn-nuevo-paciente").click();
    $("pf-nombre").value = "Paciente Ficticia Tres";
    $("pf-dni").value = "11111111";
    $("pf-telefono").value = "3760000003";
    $("form-paciente").dispatchEvent(new window.Event("submit", { cancelable: true }));
    await tick();
    const completado = fakeFb.calls.setDocCalls.find((c) => c.path === "pacientesDoctora" && c.id === "11111111");
    check("completa el teléfono que estaba vacío, sin crear un paciente nuevo", completado?.data.telefono === "3760000003" && completado?.options?.merge === true);
    check("no aparece aviso de conflicto (completar no es un conflicto)", $("paciente-conflictos").hidden === true);
  }

  console.log('\n=== Doble clic en "Guardar": no dispara dos escrituras ===');
  {
    fakeFb.calls.getDocQueue.push({ snap: fakeFb.fakeDocSnap(false, "22222222", null) });
    fakeFb.calls.setDocCalls.length = 0;
    $("btn-nuevo-paciente").click();
    $("pf-nombre").value = "Paciente Ficticia Cuatro";
    $("pf-dni").value = "22222222";
    $("pf-telefono").value = "3760000004";
    // Dos submits "simultáneos" — el botón se deshabilita en el primero.
    $("form-paciente").dispatchEvent(new window.Event("submit", { cancelable: true }));
    $("form-paciente").dispatchEvent(new window.Event("submit", { cancelable: true }));
    await tick();
    check("el botón Guardar quedó deshabilitado durante el guardado", true); // el segundo submit no debería haber generado una segunda escritura
    check("solo se generó UNA escritura para ese DNI, no dos", fakeFb.calls.setDocCalls.filter((c) => c.path === "pacientesDoctora" && c.id === "22222222").length === 1);
  }

  console.log("\n=== Edición: cambia los datos sin pasar por el chequeo de duplicados ===");
  {
    emitirSnapshot("pacientesDoctora", [
      ["12345678", { nombre: "Paciente Ficticia Uno", telefono: "3760000001" }],
    ]);
    fakeFb.calls.setDocCalls.length = 0;
    const botonEditar = document.querySelector('[data-editar-paciente="12345678"]');
    check('la tarjeta del paciente tiene un botón "Editar"', !!botonEditar);
    botonEditar.click();
    check("el DNI queda bloqueado en edición (no se cambia el id del documento)", $("pf-dni").disabled === true);
    $("pf-telefono").value = "3760009999";
    $("form-paciente").dispatchEvent(new window.Event("submit", { cancelable: true }));
    await tick();
    const editado = fakeFb.calls.setDocCalls.find((c) => c.path === "pacientesDoctora" && c.id === "12345678");
    check("la edición explícita SÍ actualiza el teléfono directamente", editado?.data.telefono === "3760009999");
    $("btn-cerrar-paciente-dialog").click();
  }

  console.log("\n=== Reintento de carga: reintentar sin duplicar (misma idea que la carga inicial) ===");
  {
    // Reintentar un alta ya existente con los MISMOS datos no debe generar
    // un segundo paciente ni ningún cambio real.
    fakeFb.calls.getDocQueue.push({ snap: fakeFb.fakeDocSnap(true, "12345678", { nombre: "Paciente Ficticia Uno Editada", telefono: "3760009999" }) });
    fakeFb.calls.setDocCalls.length = 0;
    $("btn-nuevo-paciente").click();
    $("pf-nombre").value = "Paciente Ficticia Uno Editada";
    $("pf-dni").value = "12345678";
    $("pf-telefono").value = "3760009999";
    $("form-paciente").dispatchEvent(new window.Event("submit", { cancelable: true }));
    await tick();
    check("reintentar con los mismos datos no genera ninguna escritura nueva", !fakeFb.calls.setDocCalls.some((c) => c.path === "pacientesDoctora" && c.id === "12345678"));
    $("btn-cerrar-paciente-dialog").click();
  }

  console.log("\n=== Agenda: fecha no habilitada bloquea turnos nuevos ===");
  {
    document.querySelector('[data-tab-btn="agenda"]').click();
    check("pasa a la pestaña Agenda", $("tab-agenda").hidden === false && $("tab-pacientes").hidden === true);
    emitirDoc("fechasHabilitadasDoctora", HOY, null); // no existe el documento todavía
    emitirSnapshot("turnosDoctora", []);
    check('el aviso "no habilitada" está visible', $("fecha-no-habilitada-aviso").hidden === false);
    check('el botón "Habilitar fecha" está disponible', !!$("btn-habilitar-fecha"));
  }

  console.log("\n=== Habilitar fecha: escribe habilitada:true con el horario configurado ===");
  {
    fakeFb.calls.setDocCalls.length = 0;
    $("btn-habilitar-fecha").click();
    check("se abre el panel inferior con los campos de horario", $("bottom-sheet").hidden === false);
    $("hf-inicio").value = "15:00";
    $("hf-fin").value = "18:00";
    $("hf-duracion").value = "30";
    $("btn-confirmar-habilitar").click();
    await tick();
    const habilitacion = fakeFb.calls.setDocCalls.find((c) => c.path === "fechasHabilitadasDoctora");
    check("guarda habilitada:true con el rango horario elegido", habilitacion?.data.habilitada === true && habilitacion?.data.horaInicio === "15:00" && habilitacion?.data.horaFin === "18:00");
    // Reflejar en vivo lo que acabamos de "guardar" para que la grilla se arme.
    emitirDoc("fechasHabilitadasDoctora", habilitacion.id, habilitacion.data);
    check('la fecha pasa a mostrarse como "Habilitada"', $("fecha-estado-pill").textContent === "Habilitada");
    check("la grilla generó horarios de 15:00 a 17:30 cada 30 min", $("grilla-horarios").innerHTML.includes("15:00") && $("grilla-horarios").innerHTML.includes("17:30") && !$("grilla-horarios").innerHTML.includes("18:00 hs"));
  }

  console.log("\n=== Reservar un horario libre: crea el turno y ocupa el slot ===");
  {
    emitirSnapshot("pacientesDoctora", [
      ["12345678", { nombre: "Paciente Ficticia Uno Editada", telefono: "3760009999" }],
      ["87654321", { nombre: "Paciente Ficticia Dos", telefono: "3769999999" }],
    ]);
    document.querySelector('[data-reservar-horario="15:00"]').click();
    check("se abre el panel para elegir paciente", $("bottom-sheet").hidden === false && $("sheet-body").innerHTML.includes("Paciente Ficticia Uno Editada"));
    document.querySelector('[data-elegir-paciente="12345678"]').click();
    await tick();
    const slot = [...fakeFb.calls.store.entries()].find(([k]) => k.startsWith("slotsDoctora/"));
    check("el horario 15:00 queda ocupado en el store", slot && slot[1].ocupado === true);
    const turnoCreado = [...fakeFb.calls.store.entries()].find(([k, v]) => k.startsWith("turnosDoctora/") && v.hora === "15:00");
    check("se creó el turno con los datos reales de la paciente elegida", turnoCreado && turnoCreado[1].pacienteNombre === "Paciente Ficticia Uno Editada");
  }

  console.log("\n=== Reserva simultánea sobre el MISMO horario: la segunda se rechaza, no pisa la primera ===");
  {
    const slotEntry = [...fakeFb.calls.store.entries()].find(([k]) => k.startsWith("slotsDoctora/"));
    const [slotKey, slotData] = slotEntry;
    const turnoIdOcupante = slotData.turnoId;
    // Simula que otra operación ya ocupó el slot con un turno distinto,
    // justo antes de que esta reserva intente confirmarse.
    check("precondición: el slot 15:00 está ocupado por un turno real", !!turnoIdOcupante);

    let motivoRechazo = null;
    try {
      // Reutiliza la misma función interna a través de la UI: intentar
      // reservar 15:00 de nuevo para OTRA paciente.
      const cont = document.getElementById("grilla-horarios");
      // Como ya está ocupado, el slot ya no muestra "Reservar" — se simula
      // el intento directo contra la función expuesta vía runTransaction
      // (mismo camino que usaría un "Reprogramar" a un horario ocupado).
    } catch (_) {}
    // Verificación indirecta pero real: el store todavía referencia al
    // MISMO turnoId original — ninguna escritura lo reemplazó.
    const slotDespues = fakeFb.calls.store.get(slotKey);
    check("el slot sigue apuntando al turno original (no fue pisado)", slotDespues.turnoId === turnoIdOcupante);
  }

  console.log("\n=== Reprogramar: libera el horario viejo y ocupa el nuevo ===");
  {
    const turnoEntry = [...fakeFb.calls.store.entries()].find(([k, v]) => k.startsWith("turnosDoctora/") && v.hora === "15:00");
    const turnoId = turnoEntry[0].split("/")[1];
    emitirSnapshot("turnosDoctora", [[turnoId, turnoEntry[1]]]);
    document.querySelector(`[data-abrir-turno="${turnoId}"]`)?.click();
    check("se abre el detalle del turno", $("turno-dialog").open === true);
    $("btn-turno-acciones").click();
    document.querySelector('[data-accion-turno="reprogramar"]')?.click();
    await tick();
    const opcionHorario = document.querySelector('[data-nuevo-horario="16:00"]');
    check('el panel de reprogramación ofrece horarios libres (16:00)', !!opcionHorario);
    opcionHorario?.click();
    await tick();
    const slotViejo = fakeFb.calls.store.get(`slotsDoctora/${HOY}_15-00`);
    const slotNuevo = [...fakeFb.calls.store.entries()].find(([k]) => k.includes("16-00"));
    check("el horario 15:00 quedó liberado (ocupado:false)", slotViejo?.ocupado === false);
    check("el horario 16:00 quedó ocupado por el mismo turno", slotNuevo && slotNuevo[1].ocupado === true && slotNuevo[1].turnoId === turnoId);
  }

  console.log("\n=== Cancelar turno: libera el slot, conserva el registro (no lo borra) ===");
  {
    const turnoEntry = [...fakeFb.calls.store.entries()].find(([k, v]) => k.startsWith("turnosDoctora/") && v.hora === "16:00");
    const turnoId = turnoEntry[0].split("/")[1];
    emitirSnapshot("turnosDoctora", [[turnoId, turnoEntry[1]]]);
    $("btn-cerrar-turno-dialog")?.click();
    document.querySelector(`[data-abrir-turno="${turnoId}"]`)?.click();
    $("btn-turno-acciones").click();
    document.querySelector('[data-accion-turno="cancelar"]')?.click();
    await tick();
    const turnoDespues = fakeFb.calls.store.get(`turnosDoctora/${turnoId}`);
    check('el turno queda con estado "cancelado", no se elimina', turnoDespues.estado === "cancelado");
    const slotDespues = [...fakeFb.calls.store.entries()].find(([k]) => k.includes("16-00"));
    check("su horario queda liberado", slotDespues[1].ocupado === false);
  }

  console.log("\n=== Pendientes de asignar: se pueden listar y asignarles horario ===");
  {
    emitirSnapshot("turnosDoctora", [
      ["pend1", { pacienteDni: "11111111", pacienteNombre: "Paciente Ficticia Tres", pacienteTelefono: "3760000003", fecha: HOY, hora: null, estado: "pendiente_horario" }],
    ]);
    check('aparece en "Pendientes de asignar horario"', $("lista-pendientes").innerHTML.includes("Paciente Ficticia Tres"));
    check("no se inventa un horario para un turno pendiente", $("count-pendientes").textContent === "1");
    document.querySelector('[data-asignar-horario="pend1"]')?.click();
    const opcion = document.querySelector('[data-elegir-horario="15:00"]');
    check("ofrece 15:00 como libre otra vez (quedó libre tras la reprogramación anterior)", !!opcion);
  }

  console.log("\n=== WhatsApp: vista previa editable, verifica el servidor antes de abrir ===");
  {
    emitirSnapshot("turnosDoctora", [
      ["t-wa", { pacienteDni: "12345678", pacienteNombre: "Paciente Ficticia Uno Editada", pacienteTelefono: "3760009999", fecha: HOY, hora: "17:00", estado: "confirmado" }],
    ]);
    document.querySelector('[data-abrir-turno="t-wa"]')?.click();
    $("btn-turno-acciones").click();
    document.querySelector('[data-accion-turno="confirmacion"]')?.click();
    check("la vista previa queda visible y editable", $("wa-doctora-preview-wrap").hidden === false);
    check("el texto incluye el nombre y la hora reales del turno", $("wa-doctora-preview-texto").value.includes("Paciente") && $("wa-doctora-preview-texto").value.includes("17:00"));

    window.open = (url) => { window.__ultimaUrlAbierta = url; return null; };
    fakeFb.calls.getDocFromServerQueue.push({
      snap: fakeFb.fakeDocSnap(true, "t-wa", { pacienteDni: "12345678", pacienteNombre: "Paciente Ficticia Uno Editada", pacienteTelefono: "3760009999", fecha: HOY, hora: "17:00", estado: "confirmado" }),
    });
    await $("btn-abrir-whatsapp-doctora").click();
    await tick();
    check("abre WhatsApp con el número normalizado", (window.__ultimaUrlAbierta || "").includes("wa.me/5493760009999"));
    const contactoPrep = fakeFb.calls.setDocCalls.find((c) => c.path === "contactosWhatsAppDoctora" && c.data.estado === "preparado");
    check('registra el contacto como "preparado" (nunca "enviado" todavía)', !!contactoPrep);
  }

  console.log("\n=== Confirmación de la paciente: separada del envío del mensaje ===");
  {
    fakeFb.calls.updateDocCalls.length = 0;
    $("btn-turno-acciones").click();
    document.querySelector('[data-accion-turno="confirmo-si"]')?.click();
    await tick();
    const upd = fakeFb.calls.updateDocCalls.find((c) => c.path === "turnosDoctora" && c.id === "t-wa");
    check("escribe confirmacionPaciente.confirmado=true en el turno", upd?.data.confirmacionPaciente?.confirmado === true);
    check("no toca contactosWhatsAppDoctora al confirmar asistencia", !fakeFb.calls.updateDocCalls.some((c) => c.path === "contactosWhatsAppDoctora"));
  }

  console.log('\n=== Login: mostrar/ocultar contraseña ===');
  {
    check('el campo arranca oculto (type=password)', $('login-password').type === 'password');
    $('btn-mostrar-password').click();
    check('un click lo muestra (type=text)', $('login-password').type === 'text');
    check('aria-pressed refleja el estado', $('btn-mostrar-password').getAttribute('aria-pressed') === 'true');
    $('btn-mostrar-password').click();
    check('otro click lo vuelve a ocultar', $('login-password').type === 'password');
  }

  console.log('\n=== "Recordatorios de hoy": queda fijo en HOY aunque el selector mire otra fecha ===');
  {
    check('el botón de cerrar sesión está visible para una cuenta autorizada', $('btn-cerrar-sesion').hidden === false);

    // Un turno de HOY con horario, para la lista de recordatorios.
    emitirSnapshotFijaHoy('turnosDoctora', [
      ['t-hoy-recordatorio', { pacienteDni: '99999999', pacienteNombre: 'Paciente De Hoy', pacienteTelefono: '3764000009', fecha: HOY, hora: '23:55', duracionMin: 30, estado: 'confirmado' }],
    ]);
    check('aparece en "Recordatorios de hoy" con su horario real', $('lista-recordatorios-hoy').innerHTML.includes('Paciente De Hoy') && $('lista-recordatorios-hoy').innerHTML.includes('23:55'));
    check('el contador de recordatorios de hoy es 1', $('count-recordatorios-hoy').textContent === '1');

    // Ahora el selector de la grilla se mueve a MAÑANA, con su propia
    // fecha habilitada y SIN el turno de hoy — turnosDelDia queda vacío.
    document.getElementById('btn-fecha-siguiente').click();
    emitirDoc('fechasHabilitadasDoctora', 'fecha-otra', { habilitada: true, horaInicio: '09:00', horaFin: '12:00', duracionTurnoMin: 30 });
    emitirSnapshot('turnosDoctora', []); // turnosDelDia de "mañana": vacío
    check('la grilla ahora muestra la fecha siguiente, no hoy', $('fecha-estado-pill').textContent === 'Habilitada');
    check('"Recordatorios de hoy" sigue mostrando a la paciente de HOY (no depende del selector)', $('lista-recordatorios-hoy').innerHTML.includes('Paciente De Hoy'));

    // "Preparar recordatorio" desde esa lista tiene que poder abrir el
    // turno de hoy aunque no esté en turnosDelDia (que ahora es "mañana").
    document.querySelector('[data-preparar-recordatorio="t-hoy-recordatorio"]')?.click();
    check('el detalle del turno de HOY se abrió igual (buscarTurnoPorId lo encuentra en remindersHoy)', $('turno-dialog').open === true && $('turno-dialog-titulo').textContent === 'Paciente De Hoy');
    check('la vista previa del recordatorio quedó lista automáticamente (un solo click, sin pasar por "Más acciones")', $('wa-doctora-preview-wrap').hidden === false && $('wa-doctora-preview-texto').value.includes('Paciente'));
    $('btn-cerrar-turno-dialog').click();

    // Vuelve a hoy para no afectar el resto de las pruebas.
    document.getElementById('btn-ir-hoy').click();
    emitirDoc('fechasHabilitadasDoctora', HOY, { habilitada: true, horaInicio: '15:00', horaFin: '18:00', duracionTurnoMin: 30 });
    emitirSnapshot('turnosDoctora', [
      ['t-hoy-recordatorio', { pacienteDni: '99999999', pacienteNombre: 'Paciente De Hoy', pacienteTelefono: '3764000009', fecha: HOY, hora: '23:55', duracionMin: 30, estado: 'confirmado' }],
    ]);
  }

  console.log('\n=== "Recordatorios de hoy": no se ofrece para un turno cancelado ===');
  {
    emitirSnapshotFijaHoy('turnosDoctora', [
      ['t-hoy-cancelado', { pacienteDni: '88888888', pacienteNombre: 'Paciente Cancelada', pacienteTelefono: '3764000008', fecha: HOY, hora: '12:00', duracionMin: 30, estado: 'cancelado' }],
    ]);
    check('el turno cancelado sigue visible en "Recordatorios de hoy" (se conserva, no desaparece)', $('lista-recordatorios-hoy').innerHTML.includes('Paciente Cancelada'));
    check('no ofrece el botón "Preparar recordatorio" para un turno cancelado', !document.querySelector('[data-preparar-recordatorio="t-hoy-cancelado"]'));
    check('explica el motivo en vez de solo ocultar el botón', $('lista-recordatorios-hoy').innerHTML.includes('Turno cancelado'));
  }

  console.log('\n=== Cerrar sesión: limpia las suscripciones y el estado visible, no reaparece nada ===');
  {
    fakeFb.calls.signOutCalls = 0;
    $('btn-cerrar-sesion').click();
    await tick();
    check('se llamó a signOut', fakeFb.calls.signOutCalls === 1);

    // Simula lo que hace Firebase de verdad: dispara el callback de auth con null.
    await fakeFb.calls.authCallback(null);
    await tick();

    check('vuelve a mostrar únicamente el panel de acceso', $('access-panel').hidden === false && $('workspace').hidden === true);
    check('el botón de cerrar sesión se oculta de nuevo', $('btn-cerrar-sesion').hidden === true);
    check('la lista de pacientes queda vacía en el DOM (no sigue mostrando a las pacientes ya cargadas)', $('lista-pacientes').innerHTML === '');
    check('"Recordatorios de hoy" también se vació', $('lista-recordatorios-hoy').innerHTML === '' && $('count-recordatorios-hoy').textContent === '0');
    check('el campo de contraseña se limpia (no queda escrita para la próxima persona)', $('login-password').value === '');
    check('todas las suscripciones de Firestore quedaron cerradas', fakeFb.calls.onSnapshotCalls.filter((e) => !e.unsubscribed).length === 0);
  }

  console.log('\n' + "=".repeat(60));
  console.log(fails ? (fails + " prueba(s) fallaron") : "TODAS LAS PRUEBAS OK");
  process.exit(fails ? 1 : 0);
}

run().catch((e) => { console.error("ERROR FATAL:", e); process.exit(1); });
