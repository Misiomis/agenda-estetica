// doctora/doctora.js — "Pacientes de la Doctora": sección privada con dos
// pestañas (Pacientes / Agenda). Página web normal (no es la app Capacitor),
// así que importa el firebase-web.js canónico de la raíz del proyecto.
import {
  db, auth, collection, query, where, orderBy, limit, onSnapshot, doc, getDoc, getDocs, getDocFromServer,
  setDoc, updateDoc, serverTimestamp, runTransaction,
  onAuthStateChanged, signInWithEmailAndPassword, signOut,
} from "../js/firebase-web.js";
import {
  ZONA_HORARIA, fechaISOEnZona, sumarDiasISO, normalizarTelefonoWA,
  normalizarDni, dniValido, telefonoValido, calcularActualizacionPaciente,
  generarHorariosDelDia, fechaAceptaTurnosNuevos, puedeReservarHorario,
  estadoTemporalTurnoDoctora, etiquetaEstadoTemporalDoctora, esPendienteDeHorario,
  etiquetaConfirmacionPaciente, estadoContacto, etiquetaEstadoContacto,
  construirTextoConfirmacionDoctora, construirTextoRecordatorioDoctora,
  construirTextoRecomendacionesDoctora, puedeEnviarRecordatorio,
  pesosAcentavos, formatoPesosAR, medioPagoValido, validarMediosPago,
  etiquetaMediosPago, calcularRepartoDoctora, resumenDineroTurno, calcularCierreJornada, armarDetalleCierre,
  MEDIOS_PAGO_DOCTORA, ETIQUETA_MEDIO_PAGO,
} from "./doctora-logic.js";
import {
  registrarContactoDoctoraPreparado, registrarContactoDoctoraEstado,
  registrarContactoDoctoraManual, registrarConfirmacionPaciente, idContactoDoctora,
} from "./doctora-contactos.js";
import {
  registrarPrecioConsulta, registrarMovimientoDinero, guardarCierreJornada,
  reabrirCierreJornada, generarIdempotencyKey, COLECCION_MOVIMIENTOS, COLECCION_CIERRES,
} from "./doctora-dinero.js";

// ── Acceso: exclusivo de la doctora + admin general (punto 1) ───────────
const EMAILS_AUTORIZADOS = ["espaciomimart36@gmail.com", "doctora.mimart@gmail.com"];
const esEmailAutorizado = (email) => EMAILS_AUTORIZADOS.includes((email || "").trim().toLowerCase());
const esUsuarioAutorizado = (tokenResult) => {
  const email = tokenResult?.claims?.email || tokenResult?.token?.email || "";
  return esEmailAutorizado(email);
};

const escapeHtml = (v) => (v ?? "").toString()
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const $ = (id) => document.getElementById(id);

// ── Toast ─────────────────────────────────────────────────────────────
let toastTimer = null;
function toast(msg, ms = 3200) {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function scrollSeguro(y) { try { window.scrollTo(0, y || 0); } catch (_) {} }

// ── Pestañas ──────────────────────────────────────────────────────────
let tabActual = "pacientes";
const scrollGuardadoPorTab = {};
function mostrarTab(nombre) {
  if (!$("tab-" + nombre)) return;
  tabActual = nombre;
  document.querySelectorAll(".tab-view").forEach((el) => { el.hidden = el.dataset.tab !== nombre; });
  document.querySelectorAll("[data-tab-btn]").forEach((btn) => {
    const activo = btn.getAttribute("data-tab-btn") === nombre;
    if (activo) btn.setAttribute("aria-current", "page"); else btn.removeAttribute("aria-current");
  });
  scrollSeguro(scrollGuardadoPorTab[nombre]);
}
document.querySelectorAll("[data-tab-btn]").forEach((btn) => {
  btn.addEventListener("click", () => {
    scrollGuardadoPorTab[tabActual] = window.scrollY;
    mostrarTab(btn.getAttribute("data-tab-btn"));
  });
});

// ── Panel inferior genérico ───────────────────────────────────────────
let sheetAbierto = false;
function abrirSheet(titulo, bodyHtml) {
  $("sheet-titulo").textContent = titulo;
  $("sheet-body").innerHTML = bodyHtml;
  $("sheet-backdrop").hidden = false;
  $("bottom-sheet").hidden = false;
  sheetAbierto = true;
}
function cerrarSheet() {
  $("sheet-backdrop").hidden = true;
  $("bottom-sheet").hidden = true;
  sheetAbierto = false;
}
$("btn-cerrar-sheet").addEventListener("click", cerrarSheet);
$("sheet-backdrop").addEventListener("click", cerrarSheet);

// ── Login ─────────────────────────────────────────────────────────────
$("login-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const email = $("login-email").value.trim();
  const pass = $("login-password").value;
  if (!email || !pass) { $("login-error").textContent = "Ingresá email y contraseña"; return; }
  $("login-error").textContent = "";
  $("login-submit").disabled = true;
  $("access-message").textContent = "Verificando…";
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (e) {
    $("login-submit").disabled = false;
    $("access-message").textContent = "Buscando tu sesión…";
    $("login-error").textContent = mensajeErrorAuth(e);
  }
});

$("btn-mostrar-password").addEventListener("click", () => {
  const input = $("login-password");
  const btn = $("btn-mostrar-password");
  const mostrando = input.type === "text";
  input.type = mostrando ? "password" : "text";
  btn.setAttribute("aria-pressed", String(!mostrando));
  btn.setAttribute("aria-label", mostrando ? "Mostrar contraseña" : "Ocultar contraseña");
  btn.innerHTML = mostrando ? `<svg class="icon"><use href="#i-eye"/></svg>` : `<svg class="icon"><use href="#i-eye-off"/></svg>`;
});

function mensajeErrorAuth(e) {
  switch (e?.code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found": return "Email o contraseña incorrectos.";
    case "auth/too-many-requests": return "Demasiados intentos. Probá de nuevo en unos minutos.";
    case "auth/network-request-failed": return "Sin conexión. Revisá tu internet.";
    default: return "No se pudo iniciar sesión. Intentá de nuevo.";
  }
}

// Se llama en todo camino que deja a la persona SIN acceso (sin sesión,
// cuenta no autorizada, o error de verificación) — no alcanza con ocultar
// el workspace: también hay que soltar las suscripciones (ya lo hace
// detenerSuscripciones) y borrar lo que quedó en memoria/DOM, para que un
// "Atrás" del navegador, un recargado offline, o que otra persona use el
// mismo dispositivo después, nunca puedan volver a mostrar datos de
// pacientes sin haber vuelto a autenticarse de verdad.
function limpiarEstadoModulo() {
  pacientes = []; pacientesEstado = "cargando";
  fechaDocActual = null; turnosDelDia = [];
  historialFechas = [];
  remindersHoy = []; contactosPorTurno = {};
  ubicacionConfigurada = "";
  ["lista-pacientes", "grilla-horarios", "lista-pendientes", "lista-historial", "lista-recordatorios-hoy"]
    .forEach((id) => { const el = $(id); if (el) el.innerHTML = ""; });
  $("count-turnos-dia").textContent = "0";
  $("count-pendientes").textContent = "0";
  $("count-recordatorios-hoy").textContent = "0";
  $("nav-badge-pendientes").hidden = true;
}

function mostrarAcceso(mensaje) {
  $("access-panel").hidden = false;
  $("workspace").hidden = true;
  $("bottom-nav").hidden = true;
  $("btn-cerrar-sesion").hidden = true;
  document.body.classList.remove("con-nav-inferior");
  $("login-form").hidden = true;
  $("login-password").value = "";
  $("access-message").textContent = mensaje;
  limpiarEstadoModulo();
}

$("btn-cerrar-sesion").addEventListener("click", async () => {
  try { await signOut(auth); toast("Sesión cerrada."); } catch (_) {}
});

let uidActual = null;
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    detenerSuscripciones();
    mostrarAcceso("Usá tu cuenta autorizada para entrar.");
    $("login-form").hidden = false;
    $("login-submit").disabled = false;
    uidActual = null;
    return;
  }
  $("access-message").textContent = "Verificando tu acceso…";
  try {
    const token = await user.getIdTokenResult(false);
    if (!esUsuarioAutorizado(token)) {
      detenerSuscripciones();
      mostrarAcceso("Esta cuenta no tiene acceso a la sección de la doctora.");
      $("login-form").hidden = false;
      $("login-submit").disabled = false;
      await signOut(auth);
      return;
    }
  } catch (_) {
    detenerSuscripciones();
    mostrarAcceso("No pudimos verificar la sesión. Revisá la conexión e ingresá nuevamente.");
    $("login-form").hidden = false;
    $("login-submit").disabled = false;
    await signOut(auth);
    return;
  }

  $("access-panel").hidden = true;
  $("workspace").hidden = false;
  $("bottom-nav").hidden = false;
  $("btn-cerrar-sesion").hidden = false;
  document.body.classList.add("con-nav-inferior");
  mostrarTab("pacientes");

  if (uidActual !== user.uid) {
    uidActual = user.uid;
    iniciarSuscripciones();
  }
});

async function operadorActual() {
  const u = auth.currentUser;
  return u ? { uid: u.uid, email: u.email } : null;
}

// ── Estado de datos ───────────────────────────────────────────────────
const hoyISOInicial = fechaISOEnZona();
let fechaSeleccionada = hoyISOInicial;

let pacientes = []; // [{id (dni), nombre, telefono, ...}]
let pacientesEstado = "cargando";
let fechaDocActual = null; // doc de fechasHabilitadasDoctora/{fechaSeleccionada}
let turnosDelDia = [];
let ubicacionConfigurada = "";
let remindersHoy = []; // turnos de HOY (fijo, no sigue al selector de fecha)
let contactosPorTurno = {}; // contactosWhatsAppDoctora indexados por "{turnoId}_{tipoMensaje}"

let unsubPacientes = null;
let unsubFecha = null;
let unsubTurnosDelDia = null;
let unsubHistorial = null;
let unsubUbicacion = null;
let unsubRemindersHoy = null;
let unsubContactos = null;
let historialFechas = [];

function detenerSuscripciones() {
  if (unsubPacientes) { unsubPacientes(); unsubPacientes = null; }
  if (unsubFecha) { unsubFecha(); unsubFecha = null; }
  if (unsubTurnosDelDia) { unsubTurnosDelDia(); unsubTurnosDelDia = null; }
  if (unsubHistorial) { unsubHistorial(); unsubHistorial = null; }
  if (unsubUbicacion) { unsubUbicacion(); unsubUbicacion = null; }
  if (unsubRemindersHoy) { unsubRemindersHoy(); unsubRemindersHoy = null; }
  if (unsubContactos) { unsubContactos(); unsubContactos = null; }
}

function iniciarSuscripciones() {
  detenerSuscripciones();

  unsubPacientes = onSnapshot(collection(db, "pacientesDoctora"),
    (snap) => {
      const items = [];
      snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
      items.sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "", "es"));
      pacientes = items;
      pacientesEstado = "ok";
      renderPacientes();
    },
    (err) => { pacientesEstado = "error:" + (err?.message || "desconocido"); renderPacientes(); });

  unsubUbicacion = onSnapshot(doc(db, "configDoctora", "general"),
    (snap) => { ubicacionConfigurada = snap.exists() ? (snap.data().ubicacion || "") : ""; },
    () => {});

  // "Recordatorios de hoy" queda SIEMPRE fijo en el día real de hoy — no
  // sigue al selector de fecha de la grilla, que es para explorar otros días.
  const qHoy = query(collection(db, "turnosDoctora"), where("fecha", "==", hoyISOInicial));
  unsubRemindersHoy = onSnapshot(qHoy,
    (snap) => { const items = []; snap.forEach((d) => items.push({ id: d.id, ...d.data() })); remindersHoy = items; renderRecordatoriosHoy(); },
    (err) => { console.warn("turnosDoctora (hoy):", err?.message || err); });

  unsubContactos = onSnapshot(collection(db, "contactosWhatsAppDoctora"),
    (snap) => { contactosPorTurno = {}; snap.forEach((d) => { contactosPorTurno[d.id] = d.data(); }); renderRecordatoriosHoy(); },
    (err) => { console.warn("contactosWhatsAppDoctora:", err?.message || err); });

  suscribirseAFecha(fechaSeleccionada);
  suscribirseAHistorial();
}

function suscribirseAFecha(fecha) {
  if (unsubFecha) unsubFecha();
  if (unsubTurnosDelDia) unsubTurnosDelDia();

  fechaDocActual = null;
  unsubFecha = onSnapshot(doc(db, "fechasHabilitadasDoctora", fecha),
    (snap) => { fechaDocActual = snap.exists() ? snap.data() : null; renderAgenda(); },
    (err) => { console.warn("fechasHabilitadasDoctora:", err?.message || err); renderAgenda(); });

  const qTurnos = query(collection(db, "turnosDoctora"), where("fecha", "==", fecha));
  unsubTurnosDelDia = onSnapshot(qTurnos,
    (snap) => {
      const items = [];
      snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
      turnosDelDia = items;
      renderAgenda();
    },
    (err) => { console.warn("turnosDoctora:", err?.message || err); });
}

function suscribirseAHistorial() {
  const qHist = query(collection(db, "fechasHabilitadasDoctora"), where("fecha", "<", hoyISOInicial), orderBy("fecha", "desc"), limit(30));
  unsubHistorial = onSnapshot(qHist,
    (snap) => { const items = []; snap.forEach((d) => items.push({ id: d.id, ...d.data() })); historialFechas = items; renderHistorial(); },
    (err) => { console.warn("historial fechasHabilitadasDoctora:", err?.message || err); });
}

// ── Render: conexión ──────────────────────────────────────────────────
function renderConexion() {
  const conn = $("connection");
  const txt = $("connection-text");
  let estado = "live", texto = "Al día";
  if (typeof navigator !== "undefined" && navigator.onLine === false) { estado = "offline"; texto = "Sin conexión"; }
  else if (pacientesEstado === "cargando") { estado = "warning"; texto = "Sincronizando…"; }
  else if (pacientesEstado.startsWith("error")) { estado = "error"; texto = "Error de datos"; }
  conn.setAttribute("data-state", estado);
  txt.textContent = texto;
}

// ── Render: Pacientes ─────────────────────────────────────────────────
function pacientesFiltrados() {
  const q = ($("buscador-pacientes").value || "").trim().toLowerCase();
  if (!q) return pacientes;
  return pacientes.filter((p) => (p.nombre || "").toLowerCase().includes(q) || (p.id || "").includes(q.replace(/\D/g, "") || q));
}

function pacienteTarjetaHtml(p) {
  return `
  <div class="item-row" data-paciente="${escapeHtml(p.id)}">
    <div class="item-row-top"><span class="item-name">${escapeHtml(p.nombre || "Sin nombre registrado")}</span></div>
    <div class="item-service">DNI ${escapeHtml(p.id)}${p.telefono ? " · " + escapeHtml(p.telefono) : ""}</div>
    <div class="item-actions">
      <button class="button button-light" data-editar-paciente="${escapeHtml(p.id)}" type="button">Editar</button>
      <button class="button button-light" data-ver-turnos-paciente="${escapeHtml(p.id)}" type="button">Ver en agenda</button>
    </div>
  </div>`;
}

function renderPacientes() {
  renderConexion();
  const cont = $("lista-pacientes");
  if (pacientesEstado === "cargando") { cont.innerHTML = `<div class="loading-state">Cargando…</div>`; return; }
  if (pacientesEstado.startsWith("error")) {
    cont.innerHTML = `<div class="empty-state"><h3>No se pudo consultar</h3><p>${escapeHtml(pacientesEstado.slice(6))}</p></div>`;
    return;
  }
  const items = pacientesFiltrados();
  if (!items.length) {
    cont.innerHTML = pacientes.length
      ? `<div class="empty-state"><h3>Nada coincide con la búsqueda</h3></div>`
      : `<div class="empty-state"><svg class="icon"><use href="#i-users"/></svg><h3>Sin pacientes todavía</h3><p>Usá "Nuevo" para registrar el primero.</p></div>`;
    return;
  }
  cont.innerHTML = items.map(pacienteTarjetaHtml).join("");
}
$("buscador-pacientes").addEventListener("input", renderPacientes);

// ── Alta / edición de paciente ────────────────────────────────────────
const pacienteDialog = $("paciente-dialog");
let modoPacienteDialog = "crear"; // "crear" | "editar"
let dniEnEdicion = null;

function abrirPacienteDialogCrear() {
  modoPacienteDialog = "crear";
  dniEnEdicion = null;
  $("paciente-dialog-titulo").textContent = "Nuevo paciente";
  $("form-paciente").reset();
  $("pf-dni").disabled = false;
  $("paciente-conflictos").hidden = true;
  $("paciente-dialog-status").className = "dialog-status";
  $("paciente-dialog-status").textContent = "";
  if (typeof pacienteDialog.showModal === "function") pacienteDialog.showModal();
  else pacienteDialog.setAttribute("open", "");
}

function abrirPacienteDialogEditar(dni) {
  const p = pacientes.find((x) => x.id === dni);
  if (!p) { toast("No se encontró ese paciente."); return; }
  modoPacienteDialog = "editar";
  dniEnEdicion = dni;
  $("paciente-dialog-titulo").textContent = "Editar paciente";
  $("pf-nombre").value = p.nombre || "";
  $("pf-dni").value = p.id || "";
  $("pf-dni").disabled = true; // el DNI es el id del documento — no se cambia desde acá
  $("pf-telefono").value = p.telefono || "";
  $("paciente-conflictos").hidden = true;
  $("paciente-dialog-status").className = "dialog-status";
  $("paciente-dialog-status").textContent = "";
  if (typeof pacienteDialog.showModal === "function") pacienteDialog.showModal();
  else pacienteDialog.setAttribute("open", "");
}

function cerrarPacienteDialog() {
  if (typeof pacienteDialog.close === "function" && pacienteDialog.open) pacienteDialog.close();
  else pacienteDialog.removeAttribute("open");
}
$("btn-nuevo-paciente").addEventListener("click", abrirPacienteDialogCrear);
$("btn-cerrar-paciente-dialog").addEventListener("click", cerrarPacienteDialog);
$("btn-cancelar-paciente").addEventListener("click", cerrarPacienteDialog);
pacienteDialog.addEventListener("click", (ev) => { if (ev.target === pacienteDialog) cerrarPacienteDialog(); });

document.addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-editar-paciente]");
  if (btn) abrirPacienteDialogEditar(btn.getAttribute("data-editar-paciente"));
});
document.addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-ver-turnos-paciente]");
  if (!btn) return;
  scrollGuardadoPorTab[tabActual] = window.scrollY;
  mostrarTab("agenda");
  toast("Mostrando la agenda — buscá el turno de esta paciente por fecha.");
});

function mostrarPacienteDialogStatus(texto, tipo) {
  const el = $("paciente-dialog-status");
  el.textContent = texto;
  el.className = `dialog-status mostrar ${tipo}`;
}

$("form-paciente").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const btn = $("btn-guardar-paciente");
  if (btn.disabled) return; // evita doble click / doble guardado
  btn.disabled = true;
  const nombre = $("pf-nombre").value.trim();
  const telefono = $("pf-telefono").value.trim();
  const dniRaw = $("pf-dni").value;

  try {
    if (!nombre) { mostrarPacienteDialogStatus("Ingresá el nombre.", "error"); return; }
    if (!dniValido(dniRaw)) { mostrarPacienteDialogStatus("El DNI no parece válido — revisalo.", "error"); return; }
    if (!telefonoValido(telefono)) { mostrarPacienteDialogStatus("El teléfono no parece válido — revisalo.", "error"); return; }
    const dni = normalizarDni(dniRaw);
    const operador = await operadorActual();

    if (modoPacienteDialog === "editar") {
      if (dni !== dniEnEdicion) { mostrarPacienteDialogStatus("El DNI no se puede cambiar desde acá.", "error"); return; }
      await setDoc(doc(db, "pacientesDoctora", dni), {
        nombre, telefono,
        actualizadoPorUid: operador?.uid || null, actualizadoPorEmail: operador?.email || null,
        actualizadoAt: serverTimestamp(),
      }, { merge: true });
      mostrarPacienteDialogStatus("Guardado.", "info");
      toast("Paciente actualizado.");
      setTimeout(cerrarPacienteDialog, 700);
      return;
    }

    // Flujo "crear": nunca pisa un registro existente ni crea uno duplicado
    // si el DNI ya está cargado — completa lo que falte y avisa si hay
    // datos que difieren, en vez de decidir sola cuál vale.
    const existenteSnap = await getDoc(doc(db, "pacientesDoctora", dni));
    const existente = existenteSnap.exists() ? existenteSnap.data() : null;
    const resultado = calcularActualizacionPaciente(existente, { nombre, telefono });

    if (resultado.conflictos.length) {
      const lista = resultado.conflictos.map((c) =>
        `<div class="detail-row"><span>${escapeHtml(c.campo)}</span><span>ya registrado: ${escapeHtml(c.actual)} — no se cambia</span></div>`
      ).join("");
      $("paciente-conflictos").innerHTML = `<strong>Ya existe una paciente con este DNI y algunos datos difieren:</strong>${lista}<p class="hint-text" style="margin-top:8px;">No se pisan esos datos automáticamente. Si hay que corregirlos, abrí "Editar" desde su ficha.</p>`;
      $("paciente-conflictos").hidden = false;
    }

    if (resultado.accion === "crear") {
      await setDoc(doc(db, "pacientesDoctora", dni), {
        nombre, telefono,
        creadoPorUid: operador?.uid || null, creadoPorEmail: operador?.email || null,
        creadoAt: serverTimestamp(), actualizadoAt: serverTimestamp(),
      });
      mostrarPacienteDialogStatus("Paciente registrada.", "info");
      toast("Paciente registrada.");
      if (!resultado.conflictos.length) setTimeout(cerrarPacienteDialog, 700);
    } else if (resultado.accion === "completar") {
      await setDoc(doc(db, "pacientesDoctora", dni), {
        ...resultado.datos,
        actualizadoPorUid: operador?.uid || null, actualizadoPorEmail: operador?.email || null,
        actualizadoAt: serverTimestamp(),
      }, { merge: true });
      mostrarPacienteDialogStatus("Ya existía esta paciente — se completaron los datos que faltaban.", "info");
      toast("Datos completados sobre el registro existente.");
      if (!resultado.conflictos.length) setTimeout(cerrarPacienteDialog, 700);
    } else {
      mostrarPacienteDialogStatus("Ya existía esta paciente con estos mismos datos — no se creó otro registro.", "info");
    }
  } catch (e) {
    mostrarPacienteDialogStatus("No se pudo guardar: " + (e?.message || e), "error");
  } finally {
    btn.disabled = false;
  }
});

// ── Render: Agenda ────────────────────────────────────────────────────
function fechaLinda(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone: ZONA_HORARIA }).format(dt);
}

function irAFecha(fecha) {
  fechaSeleccionada = fecha;
  $("fecha-picker").value = fecha;
  suscribirseAFecha(fecha);
  renderAgenda();
}
$("btn-fecha-anterior").addEventListener("click", () => irAFecha(sumarDiasISO(fechaSeleccionada, -1)));
$("btn-fecha-siguiente").addEventListener("click", () => irAFecha(sumarDiasISO(fechaSeleccionada, 1)));
$("btn-ir-hoy").addEventListener("click", () => irAFecha(fechaISOEnZona()));
$("fecha-picker").addEventListener("change", (ev) => { if (ev.target.value) irAFecha(ev.target.value); });

function turnosPorHora() {
  const mapa = new Map();
  turnosDelDia.forEach((t) => {
    if (t.hora && t.estado !== "cancelado") mapa.set(t.hora, t);
  });
  return mapa;
}

function slotRowHtml(hora, turno) {
  if (!turno) {
    return `
    <div class="slot-row">
      <span class="slot-hora">${escapeHtml(hora)}</span>
      <div class="slot-contenido"><span class="slot-libre">Libre</span></div>
      <button class="button button-light" data-reservar-horario="${escapeHtml(hora)}" type="button">Reservar</button>
    </div>`;
  }
  const estTemp = estadoTemporalTurnoDoctora(turno);
  return `
  <div class="slot-row">
    <span class="slot-hora">${escapeHtml(hora)}</span>
    <div class="slot-contenido">
      <div class="slot-paciente-nombre">${escapeHtml(turno.pacienteNombre || "Sin nombre")}</div>
      <div class="slot-paciente-sub">${escapeHtml(etiquetaEstadoTemporalDoctora(estTemp))}</div>
    </div>
    <button class="button button-light" data-abrir-turno="${escapeHtml(turno.id)}" type="button">Ver</button>
  </div>`;
}

function renderAgenda() {
  $("fecha-actual-linda").textContent = fechaLinda(fechaSeleccionada);
  const pill = $("fecha-estado-pill");
  const habilitada = fechaAceptaTurnosNuevos(fechaDocActual);
  pill.textContent = habilitada ? "Habilitada" : "No habilitada";
  pill.className = "pill " + (habilitada ? "pill-ok" : "pill-warn");

  $("fecha-no-habilitada-aviso").hidden = habilitada;
  $("fecha-habilitada-info").hidden = !habilitada;
  $("btn-deshabilitar-fecha").hidden = !habilitada;
  if (habilitada) {
    $("fecha-habilitada-info").textContent = `Horario: ${fechaDocActual.horaInicio}–${fechaDocActual.horaFin} hs · turnos de ${fechaDocActual.duracionTurnoMin} min.`;
  }

  const mapa = turnosPorHora();
  const horarios = habilitada ? generarHorariosDelDia(fechaDocActual.horaInicio, fechaDocActual.horaFin, fechaDocActual.duracionTurnoMin) : [];
  const contGrilla = $("grilla-horarios");
  if (!habilitada) {
    contGrilla.innerHTML = `<div class="empty-state"><h3>Sin horarios configurados</h3><p>Habilitá esta fecha para armar la grilla.</p></div>`;
  } else if (!horarios.length) {
    contGrilla.innerHTML = `<div class="empty-state"><h3>No hay horarios generados</h3></div>`;
  } else {
    contGrilla.innerHTML = horarios.map((h) => slotRowHtml(h, mapa.get(h))).join("");
  }
  $("count-turnos-dia").textContent = String(mapa.size);

  const pendientes = turnosDelDia.filter((t) => esPendienteDeHorario(t) && t.estado !== "cancelado");
  $("count-pendientes").textContent = String(pendientes.length);
  const contPend = $("lista-pendientes");
  contPend.innerHTML = pendientes.length
    ? pendientes.map((t) => `
      <div class="item-row" data-item="turno::${escapeHtml(t.id)}">
        <div class="item-row-top"><span class="item-name">${escapeHtml(t.pacienteNombre || "Sin nombre")}</span></div>
        <div class="item-service">${t.pacienteTelefono ? "📞 " + escapeHtml(t.pacienteTelefono) : "Sin teléfono"}</div>
        <div class="item-actions">
          <button class="button button-primary" data-asignar-horario="${escapeHtml(t.id)}" type="button">Asignar horario</button>
          <button class="button button-light" data-abrir-turno="${escapeHtml(t.id)}" type="button">Ver</button>
        </div>
      </div>`).join("")
    : `<div class="empty-state"><h3>Sin pendientes</h3><p>Nadie está esperando horario en esta fecha.</p></div>`;

  const badge = $("nav-badge-pendientes");
  if (pendientes.length > 0) { badge.hidden = false; badge.textContent = String(pendientes.length); }
  else badge.hidden = true;
}

function renderHistorial() {
  const cont = $("lista-historial");
  if (!historialFechas.length) {
    cont.innerHTML = `<div class="empty-state"><h3>Todavía no hay fechas anteriores</h3></div>`;
    return;
  }
  cont.innerHTML = historialFechas.map((f) => `
    <div class="item-row">
      <div class="item-row-top"><span class="item-name">${escapeHtml(fechaLinda(f.id))}</span></div>
      <div class="item-service">${f.habilitada ? `Habilitada · ${escapeHtml(f.horaInicio || "")}–${escapeHtml(f.horaFin || "")} hs` : "Deshabilitada"}</div>
      <div class="item-actions"><button class="button button-light" data-ver-fecha-historial="${escapeHtml(f.id)}" type="button">Ver</button></div>
    </div>`).join("");
}
document.addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-ver-fecha-historial]");
  if (btn) irAFecha(btn.getAttribute("data-ver-fecha-historial"));
});

// ── Recordatorios de hoy (punto 5) ───────────────────────────────────
// Siempre HOY de verdad (hoyISOInicial), nunca la fecha que esté mirando el
// selector de la grilla — es una lista de trabajo del día, no de navegación.
function estadoRecordatorioPillHtml(turno) {
  const contacto = contactosPorTurno[idContactoDoctora(turno.id, "recordatorio")] || null;
  const estado = estadoContacto(contacto);
  const clase = estado === "enviado" ? "pill-ok" : estado === "preparado" ? "pill-warn" : "pill-muted";
  return `<span class="pill ${clase}">${escapeHtml(etiquetaEstadoContacto(estado))}</span>`;
}

function confirmacionPillHtml(turno) {
  const c = turno?.confirmacionPaciente;
  const clase = c?.confirmado === true ? "pill-ok" : c?.confirmado === false ? "pill-warn" : "pill-muted";
  return `<span class="pill ${clase}">${escapeHtml(etiquetaConfirmacionPaciente(turno))}</span>`;
}

function recordatorioRowHtml(turno) {
  const puede = puedeEnviarRecordatorio(turno);
  const estTemp = estadoTemporalTurnoDoctora(turno);
  let motivoBloqueo = "";
  if (!puede) {
    motivoBloqueo = turno.estado === "cancelado" ? "Turno cancelado — no se prepara recordatorio."
      : estTemp === "pasado" ? "El horario ya pasó — no se prepara recordatorio."
      : "";
  }
  return `
  <div class="recordatorio-row" data-item="turno::${escapeHtml(turno.id)}">
    <div class="recordatorio-row-top">
      <span class="recordatorio-hora">${escapeHtml(turno.hora)}</span>
      <span class="recordatorio-nombre">${escapeHtml(turno.pacienteNombre || "Sin nombre registrado")}</span>
    </div>
    <div class="recordatorio-pills">
      ${estadoRecordatorioPillHtml(turno)}
      ${confirmacionPillHtml(turno)}
      ${!puede ? `<span class="pill pill-muted">${escapeHtml(etiquetaEstadoTemporalDoctora(estTemp))}</span>` : ""}
    </div>
    ${motivoBloqueo ? `<p class="hint-text" style="margin-top:8px;">${escapeHtml(motivoBloqueo)}</p>` : ""}
    <div class="item-actions">
      ${puede ? `<button class="button button-primary" data-preparar-recordatorio="${escapeHtml(turno.id)}" type="button"><svg class="icon"><use href="#i-whatsapp"/></svg> Preparar recordatorio</button>` : ""}
      <button class="button button-light" data-abrir-turno="${escapeHtml(turno.id)}" type="button">Ver</button>
    </div>
  </div>`;
}

function renderRecordatoriosHoy() {
  const cont = $("lista-recordatorios-hoy");
  // Nunca se inventa un horario: los pendientes de asignar simplemente no
  // entran acá todavía (aparecen en "Pendientes de asignar horario").
  const items = remindersHoy.filter((t) => !!t.hora).slice().sort((a, b) => (a.hora || "").localeCompare(b.hora || ""));
  $("count-recordatorios-hoy").textContent = String(items.length);
  if (!items.length) {
    cont.innerHTML = `<div class="empty-state"><h3>Sin turnos con horario hoy</h3></div>`;
    return;
  }
  cont.innerHTML = items.map(recordatorioRowHtml).join("");
}

document.addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-preparar-recordatorio]");
  if (!btn) return;
  const turnoId = btn.getAttribute("data-preparar-recordatorio");
  const turno = buscarTurnoPorId(turnoId);
  if (!turno) { toast("No se encuentra ese turno."); return; }
  if (!puedeEnviarRecordatorio(turno)) { toast("Este turno ya no admite el recordatorio estándar."); return; }
  abrirTurnoDialog(turnoId);
  turnoSeleccionado.tipoMensajeActivo = "recordatorio";
  prepararWaDoctoraPreview(construirTextoRecordatorioDoctora(turno));
});

// ── Habilitar / deshabilitar fecha ────────────────────────────────────
$("btn-habilitar-fecha").addEventListener("click", () => {
  abrirSheet(`Habilitar ${fechaLinda(fechaSeleccionada)}`, `
    <div class="sheet-field">
      <label for="hf-inicio">Hora de inicio</label>
      <input id="hf-inicio" type="time" value="09:00">
    </div>
    <div class="sheet-field">
      <label for="hf-fin">Hora de cierre</label>
      <input id="hf-fin" type="time" value="18:00">
    </div>
    <div class="sheet-field">
      <label for="hf-duracion">Duración de cada turno (minutos)</label>
      <input id="hf-duracion" type="number" min="5" step="5" value="30">
    </div>
    <div class="sheet-actions">
      <button class="button button-primary button-full" type="button" id="btn-confirmar-habilitar">Habilitar</button>
    </div>
  `);
  $("btn-confirmar-habilitar").addEventListener("click", async () => {
    const horaInicio = $("hf-inicio").value;
    const horaFin = $("hf-fin").value;
    const duracionTurnoMin = Number($("hf-duracion").value);
    if (!horaInicio || !horaFin || !(duracionTurnoMin > 0)) { toast("Completá horario y duración."); return; }
    if (horaFin <= horaInicio) { toast("La hora de cierre debe ser posterior a la de inicio."); return; }
    try {
      const operador = await operadorActual();
      await setDoc(doc(db, "fechasHabilitadasDoctora", fechaSeleccionada), {
        fecha: fechaSeleccionada, habilitada: true, horaInicio, horaFin, duracionTurnoMin,
        habilitadaPorUid: operador?.uid || null, habilitadaPorEmail: operador?.email || null,
        habilitadaAt: serverTimestamp(), actualizadoAt: serverTimestamp(),
      }, { merge: true });
      toast("Fecha habilitada.");
      cerrarSheet();
    } catch (e) { toast("No se pudo habilitar: " + (e?.message || e)); }
  });
});

$("btn-deshabilitar-fecha").addEventListener("click", async () => {
  try {
    const operador = await operadorActual();
    await updateDoc(doc(db, "fechasHabilitadasDoctora", fechaSeleccionada), {
      habilitada: false,
      deshabilitadaPorUid: operador?.uid || null, deshabilitadaPorEmail: operador?.email || null,
      deshabilitadaAt: serverTimestamp(),
    });
    toast("Fecha deshabilitada — los turnos ya creados se conservan.");
  } catch (e) { toast("No se pudo deshabilitar: " + (e?.message || e)); }
});

// ── Ubicación del consultorio ──────────────────────────────────────────
$("btn-config-ubicacion").addEventListener("click", () => {
  abrirSheet("Ubicación del consultorio", `
    <div class="sheet-field">
      <label for="ub-texto">Se incluye en los mensajes cuando esté configurada</label>
      <input id="ub-texto" type="text" value="${escapeHtml(ubicacionConfigurada)}" placeholder="Ej: Consultorio 3, Espacio Mimar T">
    </div>
    <div class="sheet-actions">
      <button class="button button-primary button-full" type="button" id="btn-guardar-ubicacion">Guardar</button>
    </div>
  `);
  $("btn-guardar-ubicacion").addEventListener("click", async () => {
    try {
      await setDoc(doc(db, "configDoctora", "general"), { ubicacion: $("ub-texto").value.trim(), actualizadoAt: serverTimestamp() }, { merge: true });
      toast("Ubicación guardada.");
      cerrarSheet();
    } catch (e) { toast("No se pudo guardar: " + (e?.message || e)); }
  });
});

// ── Reservar / reprogramar / asignar horario (transacción) ───────────
async function asignarOReprogramarHorario({ turnoId, fecha, hora, fechaAnterior, horaAnterior, datosTurno }) {
  const fechaRef = doc(db, "fechasHabilitadasDoctora", fecha);
  const slotNuevoRef = doc(db, "slotsDoctora", `${fecha}_${hora.replace(":", "-")}`);
  const slotViejoRef = (fechaAnterior && horaAnterior)
    ? doc(db, "slotsDoctora", `${fechaAnterior}_${horaAnterior.replace(":", "-")}`)
    : null;
  const turnoRef = turnoId ? doc(db, "turnosDoctora", turnoId) : doc(collection(db, "turnosDoctora"));

  await runTransaction(db, async (tx) => {
    const [fechaSnap, slotNuevoSnap] = await Promise.all([tx.get(fechaRef), tx.get(slotNuevoRef)]);
    const fechaDoc = fechaSnap.exists() ? fechaSnap.data() : null;
    const slotNuevoDoc = slotNuevoSnap.exists() ? slotNuevoSnap.data() : null;
    const resultado = puedeReservarHorario({ fechaDoc, hora, slotDoc: slotNuevoDoc, turnoIdPropio: turnoRef.id });
    if (!resultado.ok) throw new Error(resultado.motivo);

    // Al liberar, NO se toca turnoId (queda como quedó — es inofensivo una
    // vez que ocupado:false, cualquiera puede tomar el horario de nuevo) —
    // ponerlo en null haría que la regla de slotsDoctora, que compara
    // "mismo turnoId" para permitir reafirmar/liberar el propio horario, lo
    // interprete como "otro turno distinto" y lo rechace.
    if (slotViejoRef) tx.set(slotViejoRef, { ocupado: false, updatedAt: serverTimestamp() }, { merge: true });
    tx.set(slotNuevoRef, { ocupado: true, turnoId: turnoRef.id, fecha, hora, updatedAt: serverTimestamp() });
    tx.set(turnoRef, {
      ...datosTurno, fecha, hora,
      fechaAnteriorTurno: fechaAnterior || null, horaAnteriorTurno: horaAnterior || null,
      actualizadoAt: serverTimestamp(),
    }, { merge: true });
  });
  return turnoRef.id;
}

const MOTIVOS_RESERVA = {
  fecha_no_habilitada: "Esta fecha no está habilitada para turnos nuevos.",
  fuera_de_horario: "Ese horario está fuera del rango configurado para el día.",
  horario_ocupado: "Ese horario ya fue tomado por otro turno — elegí otro.",
};

document.addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-reservar-horario]");
  if (!btn) return;
  abrirSheetReservarHorario(btn.getAttribute("data-reservar-horario"), null);
});
document.addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-asignar-horario]");
  if (!btn) return;
  abrirSheetAsignarHorarioPendiente(btn.getAttribute("data-asignar-horario"));
});

function abrirSheetReservarHorario(hora, turnoExistenteId) {
  const opcionesPacientes = pacientes.map((p) =>
    `<button class="sheet-option" type="button" data-elegir-paciente="${escapeHtml(p.id)}">${escapeHtml(p.nombre)} <span class="hint-text">DNI ${escapeHtml(p.id)}</span></button>`
  ).join("") || `<p class="hint-text">Todavía no hay pacientes registradas — usá "Nuevo" en la pestaña Pacientes primero.</p>`;
  abrirSheet(`Reservar ${hora}`, `<div class="sheet-option-list">${opcionesPacientes}</div>`);
  $("sheet-body").querySelectorAll("[data-elegir-paciente]").forEach((el) => {
    el.addEventListener("click", async () => {
      const dni = el.getAttribute("data-elegir-paciente");
      const p = pacientes.find((x) => x.id === dni);
      cerrarSheet();
      try {
        await asignarOReprogramarHorario({
          turnoId: turnoExistenteId, fecha: fechaSeleccionada, hora,
          fechaAnterior: null, horaAnterior: null,
          datosTurno: { pacienteDni: p.id, pacienteNombre: p.nombre, pacienteTelefono: p.telefono || "", estado: "confirmado", duracionMin: fechaDocActual?.duracionTurnoMin || null, creadoAt: serverTimestamp() },
        });
        toast(`Turno reservado para ${p.nombre} a las ${hora}.`);
      } catch (e) {
        toast(MOTIVOS_RESERVA[e?.message] || ("No se pudo reservar: " + (e?.message || e)));
      }
    });
  });
}

function abrirSheetAsignarHorarioPendiente(turnoId) {
  const turno = turnosDelDia.find((t) => t.id === turnoId);
  if (!turno) { toast("No se encuentra ese turno."); return; }
  if (!fechaAceptaTurnosNuevos(fechaDocActual)) { toast("Esta fecha no está habilitada."); return; }
  const ocupados = new Set(turnosDelDia.filter((t) => t.hora && t.estado !== "cancelado").map((t) => t.hora));
  const libres = generarHorariosDelDia(fechaDocActual.horaInicio, fechaDocActual.horaFin, fechaDocActual.duracionTurnoMin).filter((h) => !ocupados.has(h));
  if (!libres.length) { toast("No quedan horarios libres en esta fecha."); return; }
  abrirSheet(`Asignar horario a ${turno.pacienteNombre}`, `
    <div class="sheet-option-list">
      ${libres.map((h) => `<button class="sheet-option" type="button" data-elegir-horario="${escapeHtml(h)}">${escapeHtml(h)}</button>`).join("")}
    </div>
  `);
  $("sheet-body").querySelectorAll("[data-elegir-horario]").forEach((el) => {
    el.addEventListener("click", async () => {
      const hora = el.getAttribute("data-elegir-horario");
      cerrarSheet();
      try {
        await asignarOReprogramarHorario({
          turnoId: turno.id, fecha: fechaSeleccionada, hora,
          fechaAnterior: null, horaAnterior: null,
          datosTurno: { pacienteDni: turno.pacienteDni, pacienteNombre: turno.pacienteNombre, pacienteTelefono: turno.pacienteTelefono || "", estado: "confirmado", duracionMin: fechaDocActual?.duracionTurnoMin || null },
        });
        toast(`Horario ${hora} asignado a ${turno.pacienteNombre}.`);
      } catch (e) {
        toast(MOTIVOS_RESERVA[e?.message] || ("No se pudo asignar: " + (e?.message || e)));
      }
    });
  });
}

// ── Detalle de turno + acciones (WhatsApp, cancelar, reprogramar) ────
const turnoDialog = $("turno-dialog");
let turnoSeleccionado = null; // { id, tipoMensajeActivo }
// UNA sola superficie de diálogo activa (punto 1): "acciones" y
// "reprogramar" reemplazan el contenido de #turno-dialog-body con un
// botón "Volver" en vez de abrir un segundo panel superpuesto encima del
// <dialog> — un <dialog> abierto con showModal() vive en el "top layer"
// del navegador, así que ningún elemento normal (por más z-index que
// tenga) puede quedar visualmente por delante; el bottom-sheet genérico
// (#bottom-sheet) sigue existiendo para los demás usos (habilitar fecha,
// ubicación, etc.) que nunca se abren con el turno-dialog ya abierto.
let turnoDialogVista = "ficha"; // "ficha" | "acciones" | "reprogramar" | "cobro"
let turnoDialogFocoPrevio = null;
let turnoDialogScrollPrevio = 0;
let turnoDialogPopstateInterno = false;
let cobroFormState = null; // { tipo, medios: [{tipo,monto}], fecha, nota, idempotencyKey }

document.addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-abrir-turno]");
  if (btn) abrirTurnoDialog(btn.getAttribute("data-abrir-turno"));
});

// Un turno abierto puede venir de la grilla de la fecha seleccionada
// (turnosDelDia) o de "Recordatorios de hoy" (remindersHoy, que es siempre
// HOY y puede ser una fecha distinta a la que esté mirando el selector) —
// se busca en los dos para no perderlo según desde dónde se haya abierto.
function buscarTurnoPorId(turnoId) {
  return turnosDelDia.find((t) => t.id === turnoId) || remindersHoy.find((t) => t.id === turnoId);
}

function historialReprogramacionHtml(turno) {
  if (!turno.fechaAnteriorTurno && !turno.horaAnteriorTurno) return "";
  return `<div class="historial-evento-cambio">Antes: ${escapeHtml(turno.fechaAnteriorTurno || "—")} ${escapeHtml(turno.horaAnteriorTurno || "")}</div>`;
}

// Alterna qué "superficie" se ve dentro del <dialog> ya abierto: en
// "ficha" se ve el botón Volver oculto y la fila de acciones normal
// (Más acciones / Cerrar); en cualquier otra vista se ve "‹ Volver" en el
// encabezado y la fila de acciones de la ficha queda oculta (esa vista
// trae sus propios botones dentro de #turno-dialog-body).
function mostrarVistaTurno(vista) {
  turnoDialogVista = vista;
  const esFicha = vista === "ficha";
  $("btn-volver-turno-dialog").hidden = esFicha;
  $("turno-dialog-actions-ficha").hidden = !esFicha;
  $("turno-dialog-body").scrollTop = 0;
}

async function abrirTurnoDialog(turnoId) {
  const turno = buscarTurnoPorId(turnoId);
  if (!turno) { toast("No se encuentra ese turno."); return; }
  const yaAbierto = turnoDialog.open;
  turnoSeleccionado = { id: turnoId, tipoMensajeActivo: null };
  // Abre YA (síncrono) y recién después completa el contenido — el resumen
  // de dinero necesita una consulta a Firestore, y no tiene sentido hacer
  // esperar a que se abra el diálogo por eso: la ficha se ve al toque, con
  // "Cargando…" en la sección de Importe y cobro mientras resuelve.
  if (!yaAbierto) {
    turnoDialogFocoPrevio = document.activeElement;
    turnoDialogScrollPrevio = window.scrollY;
    try { history.pushState({ turnoDoctoraAbierto: true }, ""); } catch (_) {}
    if (typeof turnoDialog.showModal === "function") turnoDialog.showModal();
    else turnoDialog.setAttribute("open", "");
  }
  await renderVistaFicha(turno);
}

function cerrarTurnoDialog() {
  if (typeof turnoDialog.close === "function" && turnoDialog.open) turnoDialog.close();
  else turnoDialog.removeAttribute("open");
}
// Un solo lugar de limpieza para TODAS las formas de cerrar (cruz, botón
// "Cerrar", Escape nativo del <dialog>, click en el backdrop, o "Atrás"):
// el evento "close" nativo se dispara siempre, así que no hace falta
// duplicar la limpieza en cada botón.
turnoDialog.addEventListener("close", () => {
  turnoSeleccionado = null;
  cobroFormState = null;
  mostrarVistaTurno("ficha");
  if (turnoDialogFocoPrevio && typeof turnoDialogFocoPrevio.focus === "function") {
    try { turnoDialogFocoPrevio.focus(); } catch (_) {}
  }
  turnoDialogFocoPrevio = null;
  scrollSeguro(turnoDialogScrollPrevio);
  // Si el cierre lo disparó el propio botón "Atrás" (popstate), la entrada
  // de historial ya se consumió sola — no volver a popearla o el usuario
  // terminaría navegando dos páginas atrás con un solo gesto.
  if (!turnoDialogPopstateInterno) { try { history.back(); } catch (_) {} }
});
window.addEventListener("popstate", () => {
  if (turnoDialog.open) {
    turnoDialogPopstateInterno = true;
    cerrarTurnoDialog();
    turnoDialogPopstateInterno = false;
  }
});
$("btn-cerrar-turno-dialog").addEventListener("click", cerrarTurnoDialog);
$("btn-cerrar-turno-dialog-2").addEventListener("click", cerrarTurnoDialog);
turnoDialog.addEventListener("click", (ev) => { if (ev.target === turnoDialog) cerrarTurnoDialog(); });
$("btn-volver-turno-dialog").addEventListener("click", () => {
  if (!turnoSeleccionado) { cerrarTurnoDialog(); return; }
  const turno = buscarTurnoPorId(turnoSeleccionado.id);
  if (!turno) { cerrarTurnoDialog(); return; }
  cobroFormState = null;
  renderVistaFicha(turno);
});

function mostrarTurnoDialogStatus(texto, tipo) {
  const el = $("turno-dialog-status");
  el.textContent = texto;
  el.className = `dialog-status mostrar ${tipo}`;
}

// ── Vista "ficha": detalle del turno + Importe y cobro (punto 3) ────────
async function renderVistaFicha(turno) {
  mostrarVistaTurno("ficha");
  $("turno-dialog-titulo").textContent = turno.pacienteNombre || "Sin nombre registrado";
  $("turno-dialog-eyebrow").textContent = esPendienteDeHorario(turno) ? "PENDIENTE DE HORARIO" : "TURNO";
  $("turno-dialog-status").className = "dialog-status";
  $("turno-dialog-status").textContent = "";
  const estTemp = estadoTemporalTurnoDoctora(turno);
  $("turno-dialog-body").innerHTML = `
    <div class="detail-row"><span>Fecha</span><span>${escapeHtml(turno.fecha || "—")}</span></div>
    <div class="detail-row"><span>Hora</span><span>${turno.hora ? escapeHtml(turno.hora) : "Sin asignar"}</span></div>
    <div class="detail-row"><span>DNI</span><span>${escapeHtml(turno.pacienteDni || "—")}</span></div>
    <div class="detail-row"><span>Teléfono</span><span>${turno.pacienteTelefono ? escapeHtml(turno.pacienteTelefono) : "sin registrar"}</span></div>
    <div class="detail-row"><span>Estado del turno</span><span>${escapeHtml(turno.estado || "sin estado")}</span></div>
    <div class="detail-row"><span>Momento</span><span>${escapeHtml(etiquetaEstadoTemporalDoctora(estTemp))}</span></div>
    <div class="detail-row"><span>Confirmación de la paciente</span><span>${escapeHtml(etiquetaConfirmacionPaciente(turno))}</span></div>
    ${historialReprogramacionHtml(turno)}
    ${turno.motivoCancelacion ? `<div class="detail-row"><span>Motivo de cancelación</span><span>${escapeHtml(turno.motivoCancelacion)}</span></div>` : ""}
    <div class="detalle-subtitulo">Importe y cobro</div>
    <div id="dinero-seccion"><div class="loading-state">Cargando…</div></div>
  `;
  $("wa-doctora-preview-wrap").hidden = true;
  $("btn-abrir-whatsapp-doctora").hidden = true;
  await cargarYRenderizarDinero(turno);
}

async function cargarYRenderizarDinero(turno) {
  const cont = $("dinero-seccion");
  if (!cont) return; // la persona ya navegó a otra vista antes de que esto resolviera
  let movimientos = [];
  try {
    const snap = await getDocs(query(collection(db, COLECCION_MOVIMIENTOS), where("turnoId", "==", turno.id)));
    snap.forEach((d) => movimientos.push({ id: d.id, ...d.data() }));
    movimientos.sort((a, b) => (a.fechaMovimiento || "").localeCompare(b.fechaMovimiento || "") || (a.id || "").localeCompare(b.id || ""));
  } catch (e) {
    if ($("dinero-seccion")) $("dinero-seccion").innerHTML = `<div class="error-state">No se pudo cargar el historial de cobros: ${escapeHtml(e?.message || e)}</div>`;
    return;
  }
  if (!$("dinero-seccion")) return; // se pudo haber cerrado el dialog mientras esperaba
  const resumen = resumenDineroTurno(turno.precioConsultaCentavos ?? null, movimientos);
  $("dinero-seccion").innerHTML = renderDineroSeccionHtml(resumen, movimientos);
  $("btn-editar-precio")?.addEventListener("click", () => mostrarFormPrecio(turno, resumen));
  $("btn-registrar-cobro")?.addEventListener("click", () => renderVistaCobro(turno, resumen));
}

function renderDineroSeccionHtml(resumen, movimientos) {
  const precioTexto = resumen.precioConsultaCentavos === null ? "Sin cargar" : formatoPesosAR(resumen.precioConsultaCentavos);
  const pendienteTexto = resumen.saldoPendienteCentavos === null ? "Sin cargar precio" : formatoPesosAR(resumen.saldoPendienteCentavos);
  const movimientosHtml = movimientos.length
    ? `<div class="dinero-movimientos-lista">${movimientos.map((m) => `
        <div class="dinero-movimiento-row">
          <span class="dinero-movimiento-fecha">${escapeHtml(m.fechaMovimiento || "—")}</span>
          <span class="dinero-movimiento-tipo ${m.tipo === "devolucion" ? "es-devolucion" : ""}">${m.tipo === "devolucion" ? "Devolución" : "Cobro"}</span>
          <span class="dinero-movimiento-monto">${formatoPesosAR(m.montoCentavos)}</span>
          <span class="dinero-movimiento-medio">${escapeHtml(etiquetaMediosPago(m.medios))}</span>
          ${m.nota ? `<span class="dinero-movimiento-nota">${escapeHtml(m.nota)}</span>` : ""}
        </div>`).join("")}</div>`
    : `<p class="hint-text">Todavía no se registraron cobros para esta consulta.</p>`;
  return `
    <div class="detail-row"><span>Precio de la consulta</span><span>${escapeHtml(precioTexto)} <button class="text-button" type="button" id="btn-editar-precio">Editar</button></span></div>
    <div class="detail-row"><span>Cobrado</span><span>${formatoPesosAR(resumen.netoCobradoCentavos)}</span></div>
    <div class="detail-row"><span>Saldo pendiente</span><span>${escapeHtml(pendienteTexto)}</span></div>
    ${movimientosHtml}
    <button class="button button-light button-full" type="button" id="btn-registrar-cobro" style="margin-top:12px;">Registrar cobro / devolución</button>
  `;
}

function mostrarFormPrecio(turno, resumen) {
  const cont = $("dinero-seccion");
  if (!cont) return;
  const valorActual = resumen.precioConsultaCentavos === null ? "" : (resumen.precioConsultaCentavos / 100).toString().replace(".", ",");
  cont.insertAdjacentHTML("beforeend", `
    <div class="dinero-precio-form" id="dinero-precio-form">
      <label for="input-precio-consulta">Precio acordado (ARS) — no afecta otras consultas ni el catálogo</label>
      <input type="text" inputmode="decimal" id="input-precio-consulta" placeholder="Ej: 15000 o 15000,50" value="${escapeHtml(valorActual)}">
      <p class="error-text" id="precio-consulta-error"></p>
      <div class="dinero-form-actions">
        <button class="button button-primary" type="button" id="btn-guardar-precio">Guardar precio</button>
        <button class="button button-light" type="button" id="btn-cancelar-precio">Cancelar</button>
      </div>
    </div>
  `);
  $("input-precio-consulta").focus();
  $("btn-cancelar-precio").addEventListener("click", () => $("dinero-precio-form")?.remove());
  $("btn-guardar-precio").addEventListener("click", async () => {
    const raw = $("input-precio-consulta").value.trim();
    const errEl = $("precio-consulta-error");
    errEl.textContent = "";
    const centavos = raw === "" ? null : pesosAcentavos(raw);
    if (raw !== "" && centavos === null) { errEl.textContent = "Importe inválido. Usá números, con hasta 2 decimales."; return; }
    const btn = $("btn-guardar-precio");
    btn.disabled = true;
    try {
      const operador = await operadorActual();
      await registrarPrecioConsulta({ updateDoc, doc, serverTimestamp, db, turnoId: turno.id, precioConsultaCentavos: centavos, operador });
      toast("Precio guardado.");
      const turnoFresco = buscarTurnoPorId(turno.id) || turno;
      turnoFresco.precioConsultaCentavos = centavos; // refleja el cambio ya mismo, sin esperar la próxima sincronización
      await renderVistaFicha(turnoFresco);
    } catch (e) {
      errEl.textContent = "No se pudo guardar: " + (e?.message || e);
      btn.disabled = false;
    }
  });
}

$("btn-turno-acciones").addEventListener("click", () => {
  if (!turnoSeleccionado) return;
  const turno = buscarTurnoPorId(turnoSeleccionado.id);
  if (!turno) return;
  renderVistaAcciones(turno);
});

// ── Vista "acciones": mismo contenido que antes tenía el bottom-sheet
// "Más acciones", ahora dentro del propio <dialog> (punto 1). ───────────
function renderVistaAcciones(turno) {
  mostrarVistaTurno("acciones");
  $("turno-dialog-eyebrow").textContent = "MÁS ACCIONES";
  $("turno-dialog-titulo").textContent = turno.pacienteNombre || "Sin nombre registrado";
  const opciones = [];
  opciones.push(`<button class="mas-item" type="button" data-accion-turno="confirmacion">Preparar confirmación</button>`);
  opciones.push(`<button class="mas-item" type="button" data-accion-turno="recordatorio">Preparar recordatorio</button>`);
  opciones.push(`<button class="mas-item" type="button" data-accion-turno="recomendaciones">Preparar recomendaciones</button>`);
  opciones.push(`<button class="mas-item" type="button" data-accion-turno="registrar-manual">Registrar envío manual</button>`);
  opciones.push(`<button class="mas-item" type="button" data-accion-turno="confirmo-si">La paciente confirmó asistencia</button>`);
  opciones.push(`<button class="mas-item" type="button" data-accion-turno="confirmo-no">La paciente avisó que no viene</button>`);
  if (turno.hora) opciones.push(`<button class="mas-item" type="button" data-accion-turno="reprogramar">Reprogramar horario</button>`);
  if (turno.estado !== "cancelado") opciones.push(`<button class="mas-item" type="button" data-accion-turno="cancelar">Cancelar turno</button>`);
  $("turno-dialog-body").innerHTML = `<div class="mas-lista">${opciones.join("")}</div>`;
  $("turno-dialog-body").querySelectorAll("[data-accion-turno]").forEach((el) => {
    el.addEventListener("click", () => ejecutarAccionTurno(el.getAttribute("data-accion-turno")));
  });
}

function prepararWaDoctoraPreview(texto) {
  $("wa-doctora-preview-wrap").hidden = false;
  $("btn-abrir-whatsapp-doctora").hidden = false;
  $("wa-doctora-preview-texto").value = texto || "";
}

async function ejecutarAccionTurno(accion) {
  if (!turnoSeleccionado) return;
  const turno = buscarTurnoPorId(turnoSeleccionado.id);
  if (!turno) return;

  if (accion === "confirmacion" || accion === "recordatorio" || accion === "recomendaciones") {
    turnoSeleccionado.tipoMensajeActivo = accion;
    const texto = accion === "confirmacion" ? construirTextoConfirmacionDoctora(turno, ubicacionConfigurada)
      : accion === "recordatorio" ? construirTextoRecordatorioDoctora(turno)
      : construirTextoRecomendacionesDoctora(turno, "");
    await renderVistaFicha(turno);
    prepararWaDoctoraPreview(texto);
    return;
  }

  if (accion === "registrar-manual") {
    const tipo = turnoSeleccionado.tipoMensajeActivo || "confirmacion";
    try {
      const operador = await operadorActual();
      await registrarContactoDoctoraManual({ setDoc, doc, serverTimestamp, db, turnoId: turno.id, tipoMensaje: tipo, operador, nota: "Registrado manualmente desde Pacientes de la Doctora" });
      await renderVistaFicha(turno);
      mostrarTurnoDialogStatus("Envío registrado manualmente.", "info");
      toast("Envío registrado.");
    } catch (e) { mostrarTurnoDialogStatus("No se pudo registrar: " + (e?.message || e), "error"); }
    return;
  }

  if (accion === "confirmo-si" || accion === "confirmo-no") {
    try {
      const operador = await operadorActual();
      await registrarConfirmacionPaciente({ updateDoc, doc, serverTimestamp, db, turnoId: turno.id, confirmado: accion === "confirmo-si", operador });
      toast(accion === "confirmo-si" ? "Registrado: confirmó asistencia." : "Registrado: avisó que no viene.");
      await renderVistaFicha(buscarTurnoPorId(turno.id) || turno); // refresca el detalle con el nuevo estado
    } catch (e) { toast("No se pudo registrar: " + (e?.message || e)); }
    return;
  }

  if (accion === "cancelar") {
    try {
      const operador = await operadorActual();
      if (turno.hora) {
        // Mismo motivo que en asignarOReprogramarHorario: no null-ear
        // turnoId acá, o la regla de slotsDoctora rechaza la liberación.
        const slotRef = doc(db, "slotsDoctora", `${turno.fecha}_${turno.hora.replace(":", "-")}`);
        await setDoc(slotRef, { ocupado: false, updatedAt: serverTimestamp() }, { merge: true });
      }
      // Cancelar NUNCA toca movimientosDineroDoctora (punto 6): los cobros
      // ya registrados sobreviven intactos, con su trazabilidad completa,
      // pase lo que pase con el turno.
      await updateDoc(doc(db, "turnosDoctora", turno.id), {
        estado: "cancelado",
        canceladoPorUid: operador?.uid || null, canceladoPorEmail: operador?.email || null,
        canceladoAt: serverTimestamp(),
      });
      toast("Turno cancelado.");
      cerrarTurnoDialog();
    } catch (e) { toast("No se pudo cancelar: " + (e?.message || e)); }
    return;
  }

  if (accion === "reprogramar") {
    // Siempre se reprograma dentro de la propia fecha del turno (turno.fecha),
    // NUNCA la fecha que esté mirando el selector de la grilla — pueden ser
    // distintas si el turno se abrió desde "Recordatorios de hoy". Por eso
    // se trae fresca la config de esa fecha en vez de asumir fechaDocActual.
    let fechaDocDelTurno = fechaDocActual;
    if (turno.fecha !== fechaSeleccionada) {
      try {
        const snap = await getDoc(doc(db, "fechasHabilitadasDoctora", turno.fecha));
        fechaDocDelTurno = snap.exists() ? snap.data() : null;
      } catch (e) { toast("No se pudo consultar la fecha del turno: " + (e?.message || e)); return; }
    }
    if (!fechaAceptaTurnosNuevos(fechaDocDelTurno)) { toast("La fecha de este turno no está habilitada para reprogramar."); return; }
    const turnosMismaFecha = turno.fecha === fechaSeleccionada ? turnosDelDia : (turno.fecha === hoyISOInicial ? remindersHoy : [turno]);
    const ocupados = new Set(turnosMismaFecha.filter((t) => t.hora && t.estado !== "cancelado" && t.id !== turno.id).map((t) => t.hora));
    const libres = generarHorariosDelDia(fechaDocDelTurno.horaInicio, fechaDocDelTurno.horaFin, fechaDocDelTurno.duracionTurnoMin).filter((h) => !ocupados.has(h));
    if (!libres.length) { toast("No quedan horarios libres ese día."); return; }
    renderVistaReprogramar(turno, libres, fechaDocDelTurno);
  }
}

// ── Vista "reprogramar": antes era un sheet abierto ENCIMA del sheet
// "Más acciones" (dos superposiciones sobre el turno-dialog a la vez) —
// ahora reemplaza el contenido del mismo <dialog>. ──────────────────────
function renderVistaReprogramar(turno, libres, fechaDocDelTurno) {
  mostrarVistaTurno("reprogramar");
  $("turno-dialog-eyebrow").textContent = "REPROGRAMAR";
  $("turno-dialog-titulo").textContent = "Elegí un horario";
  $("turno-dialog-body").innerHTML = `<div class="mas-lista">${libres.map((h) => `<button class="mas-item" type="button" data-nuevo-horario="${escapeHtml(h)}">${escapeHtml(h)}</button>`).join("")}</div>`;
  $("turno-dialog-body").querySelectorAll("[data-nuevo-horario]").forEach((el) => {
    el.addEventListener("click", async () => {
      const horaNueva = el.getAttribute("data-nuevo-horario");
      try {
        await asignarOReprogramarHorario({
          turnoId: turno.id, fecha: turno.fecha, hora: horaNueva,
          fechaAnterior: turno.fecha, horaAnterior: turno.hora,
          datosTurno: { pacienteDni: turno.pacienteDni, pacienteNombre: turno.pacienteNombre, pacienteTelefono: turno.pacienteTelefono || "", estado: "confirmado", duracionMin: fechaDocDelTurno?.duracionTurnoMin || null },
        });
        toast(`Turno reprogramado a las ${horaNueva}.`);
        await renderVistaFicha(buscarTurnoPorId(turno.id) || { ...turno, hora: horaNueva });
      } catch (e) { toast(MOTIVOS_RESERVA[e?.message] || ("No se pudo reprogramar: " + (e?.message || e))); }
    });
  });
}

// ── Vista "cobro": registrar un cobro o una devolución, con medios de
// pago combinables y fecha del movimiento (para pagos de una consulta
// anterior) — punto 3, 4 y 6. ───────────────────────────────────────────
function renderVistaCobro(turno, resumenActual) {
  mostrarVistaTurno("cobro");
  $("turno-dialog-eyebrow").textContent = "IMPORTE Y COBRO";
  $("turno-dialog-titulo").textContent = "Registrar movimiento";
  cobroFormState = {
    tipo: "cobro",
    medios: [{ tipo: "efectivo", monto: "" }],
    fecha: fechaISOEnZona(),
    nota: "",
    idempotencyKey: generarIdempotencyKey(),
  };
  $("turno-dialog-body").innerHTML = `
    <div class="cobro-form">
      <label for="cobro-tipo">Tipo de movimiento</label>
      <select id="cobro-tipo">
        <option value="cobro">Cobro</option>
        <option value="devolucion">Devolución</option>
      </select>
      <label for="cobro-monto">Importe total (ARS)</label>
      <input type="text" inputmode="decimal" id="cobro-monto" placeholder="Ej: 15000 o 15000,50">
      <label for="cobro-fecha">Fecha del movimiento</label>
      <input type="date" id="cobro-fecha" value="${escapeHtml(cobroFormState.fecha)}">
      <p class="hint-text">Si es un pago de una consulta anterior, poné la fecha real en que se cobra — no queda contado en el cierre del día del turno, sino en el de esta fecha.</p>
      <div class="detalle-subtitulo">Medio de pago</div>
      <div id="cobro-medios-lista"></div>
      <button class="text-button" type="button" id="btn-agregar-medio">+ Agregar otro medio (pago combinado)</button>
      <label for="cobro-nota">Nota (opcional)</label>
      <textarea id="cobro-nota" rows="2" placeholder="Contexto de la corrección o el movimiento…"></textarea>
      <p class="error-text" id="cobro-form-error"></p>
      <div class="dinero-form-actions">
        <button class="button button-primary button-full" type="button" id="btn-guardar-cobro">Guardar movimiento</button>
      </div>
    </div>
  `;
  $("cobro-tipo").addEventListener("change", (ev) => { cobroFormState.tipo = ev.target.value; });
  $("cobro-fecha").addEventListener("change", (ev) => { cobroFormState.fecha = ev.target.value; });
  renderMediosPagoRows();
  $("btn-agregar-medio").addEventListener("click", () => {
    cobroFormState.medios.push({ tipo: "efectivo", monto: "" });
    renderMediosPagoRows();
  });
  $("btn-guardar-cobro").addEventListener("click", () => guardarMovimientoDineroDesdeForm(turno));
}

function renderMediosPagoRows() {
  const cont = $("cobro-medios-lista");
  if (!cont || !cobroFormState) return;
  cont.innerHTML = cobroFormState.medios.map((m, i) => `
    <div class="cobro-medio-row" data-medio-idx="${i}">
      <select class="cobro-medio-tipo" data-medio-idx="${i}">
        ${MEDIOS_PAGO_DOCTORA.map((t) => `<option value="${t}" ${m.tipo === t ? "selected" : ""}>${ETIQUETA_MEDIO_PAGO[t]}</option>`).join("")}
      </select>
      <input type="text" inputmode="decimal" class="cobro-medio-monto" data-medio-idx="${i}" placeholder="Monto" value="${escapeHtml(m.monto)}">
      ${cobroFormState.medios.length > 1 ? `<button type="button" class="icon-button cobro-medio-quitar" data-medio-idx="${i}" aria-label="Quitar medio">✕</button>` : ""}
    </div>
  `).join("");
  cont.querySelectorAll(".cobro-medio-tipo").forEach((sel) => {
    sel.addEventListener("change", (ev) => { cobroFormState.medios[Number(ev.target.dataset.medioIdx)].tipo = ev.target.value; });
  });
  cont.querySelectorAll(".cobro-medio-monto").forEach((inp) => {
    inp.addEventListener("input", (ev) => { cobroFormState.medios[Number(ev.target.dataset.medioIdx)].monto = ev.target.value; });
  });
  cont.querySelectorAll(".cobro-medio-quitar").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      cobroFormState.medios.splice(Number(ev.currentTarget.dataset.medioIdx), 1);
      renderMediosPagoRows();
    });
  });
}

async function guardarMovimientoDineroDesdeForm(turno) {
  const errEl = $("cobro-form-error");
  errEl.textContent = "";
  const btn = $("btn-guardar-cobro");
  if (btn.disabled) return; // guarda contra doble click mientras ya está guardando
  const montoTotalCentavos = pesosAcentavos($("cobro-monto").value);
  if (montoTotalCentavos === null || montoTotalCentavos <= 0) { errEl.textContent = "Ingresá un importe total válido, mayor a $0."; return; }
  if (!cobroFormState.fecha) { errEl.textContent = "Elegí la fecha del movimiento."; return; }
  const medios = cobroFormState.medios.map((m) => ({ tipo: m.tipo, montoCentavos: pesosAcentavos(m.monto) }));
  if (medios.some((m) => m.montoCentavos === null)) { errEl.textContent = "Hay un importe de medio de pago inválido."; return; }
  const validacion = validarMediosPago(medios, montoTotalCentavos);
  if (!validacion.ok) {
    errEl.textContent = validacion.motivo === "no_coincide_total"
      ? "La suma de los medios de pago no coincide con el importe total."
      : "Revisá los medios de pago cargados.";
    return;
  }
  btn.disabled = true;
  btn.textContent = "Guardando…";
  try {
    const operador = await operadorActual();
    await registrarMovimientoDinero({
      setDoc, doc, serverTimestamp, db,
      idempotencyKey: cobroFormState.idempotencyKey,
      turnoId: turno.id, pacienteNombre: turno.pacienteNombre || null, pacienteDni: turno.pacienteDni || null,
      tipo: cobroFormState.tipo, montoCentavos: montoTotalCentavos, medios,
      fechaMovimiento: cobroFormState.fecha, fechaAtencion: turno.fecha || null,
      nota: $("cobro-nota").value.trim() || null,
      operador,
    });
    toast(cobroFormState.tipo === "devolucion" ? "Devolución registrada." : "Cobro registrado.");
    cobroFormState = null;
    await renderVistaFicha(buscarTurnoPorId(turno.id) || turno);
  } catch (e) {
    errEl.textContent = "No se pudo guardar: " + (e?.message || e);
    btn.disabled = false;
    btn.textContent = "Guardar movimiento";
  }
}

let pendienteConfirmarEnvioDoctora = null; // { turnoId, tipoMensaje, nombre }

$("btn-abrir-whatsapp-doctora").addEventListener("click", async () => {
  if (!turnoSeleccionado) return;
  const btn = $("btn-abrir-whatsapp-doctora");
  btn.disabled = true;
  btn.textContent = "Verificando con el servidor…";
  mostrarTurnoDialogStatus("Verificando con el servidor antes de abrir WhatsApp…", "info");
  try {
    const snap = await getDocFromServer(doc(db, "turnosDoctora", turnoSeleccionado.id));
    if (!snap.exists()) {
      mostrarTurnoDialogStatus("Este turno ya no existe. No se abrió WhatsApp.", "error");
      return;
    }
    const fresco = snap.data();
    if (fresco.estado === "cancelado") {
      mostrarTurnoDialogStatus("Este turno fue cancelado. No se abrió WhatsApp.", "error");
      return;
    }
    if (!fresco.pacienteTelefono) {
      mostrarTurnoDialogStatus("No hay teléfono registrado para esta paciente.", "error");
      return;
    }
    const texto = ($("wa-doctora-preview-texto").value || "").trim();
    if (!texto) { mostrarTurnoDialogStatus("El mensaje está vacío.", "error"); return; }
    const numero = normalizarTelefonoWA(fresco.pacienteTelefono);
    const operador = await operadorActual();
    const tipoMensaje = turnoSeleccionado.tipoMensajeActivo || "confirmacion";
    await registrarContactoDoctoraPreparado({ setDoc, doc, serverTimestamp, db, turnoId: turnoSeleccionado.id, tipoMensaje, operador, versionDatos: snap.updateTime?.toMillis?.() || Date.now() });
    pendienteConfirmarEnvioDoctora = { turnoId: turnoSeleccionado.id, tipoMensaje, nombre: fresco.pacienteNombre || "esta paciente" };
    mostrarTurnoDialogStatus("Datos verificados. Se abrió WhatsApp con el mensaje listo — vos decidís si lo enviás.", "info");
    window.open(`https://wa.me/${numero}?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
  } catch (e) {
    mostrarTurnoDialogStatus("No se pudo verificar (" + (e?.code || e?.message || "error") + "). Podés reintentar.", "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg class="icon"><use href="#i-whatsapp"/></svg> Abrir WhatsApp`;
  }
});

function ocultarPromptEnvio() { $("confirm-envio-banner").hidden = true; }
function mostrarPromptEnvio() {
  if (!pendienteConfirmarEnvioDoctora) return;
  $("confirm-envio-texto").textContent = `¿Enviaste el mensaje a ${pendienteConfirmarEnvioDoctora.nombre}?`;
  $("confirm-envio-banner").hidden = false;
}
async function responderPromptEnvio(estado) {
  if (!pendienteConfirmarEnvioDoctora) return;
  const { turnoId, tipoMensaje, nombre } = pendienteConfirmarEnvioDoctora;
  if (estado === "mas_tarde") { ocultarPromptEnvio(); return; }
  try {
    const operador = await operadorActual();
    await registrarContactoDoctoraEstado({ setDoc, doc, serverTimestamp, db, turnoId, tipoMensaje, estado, operador });
    toast(estado === "enviado" ? `Confirmación marcada como enviada (${nombre})` : `Registrado: no se envió (${nombre})`);
  } catch (_) { toast("No se pudo registrar el estado del envío."); }
  pendienteConfirmarEnvioDoctora = null;
  ocultarPromptEnvio();
}
$("btn-confirmo-enviado").addEventListener("click", () => responderPromptEnvio("enviado"));
$("btn-confirmo-no-enviado").addEventListener("click", () => responderPromptEnvio("no_enviado"));
$("btn-confirmo-mas-tarde").addEventListener("click", () => responderPromptEnvio("mas_tarde"));
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") mostrarPromptEnvio(); });

// ── Cierre de jornada (puntos 5 y 6) ─────────────────────────────────────
// Reparto 90% doctora / 10% Mimar T sobre el dinero EFECTIVAMENTE cobrado
// ese día (fechaMovimiento, no fecha del turno), descontando devoluciones.
// Un cierre ya guardado ("cerrado") muestra el snapshot congelado, nunca un
// recálculo en vivo — así editar una consulta después no lo cambia en
// silencio. Reabrir es una acción explícita y registrada.
let cierreFechaActual = null;
let cierreCargando = false;
let cierreTabInicializada = false;

function fechaHoyInputValue() { return fechaISOEnZona(); }

$("cierre-fecha-picker").addEventListener("change", (ev) => { if (ev.target.value) cargarCierre(ev.target.value); });
$("btn-cierre-hoy").addEventListener("click", () => {
  const hoy = fechaHoyInputValue();
  $("cierre-fecha-picker").value = hoy;
  cargarCierre(hoy);
});

function inicializarTabCierreSiHaceFalta() {
  if (cierreTabInicializada) return;
  cierreTabInicializada = true;
  const hoy = fechaHoyInputValue();
  $("cierre-fecha-picker").value = hoy;
  cargarCierre(hoy);
}
document.querySelectorAll('[data-tab-btn="cierre"]').forEach((btn) => {
  btn.addEventListener("click", inicializarTabCierreSiHaceFalta);
});

async function cargarCierre(fecha) {
  cierreFechaActual = fecha;
  cierreCargando = true;
  const cont = $("cierre-contenido");
  cont.innerHTML = '<div class="loading-state">Cargando…</div>';
  $("cierre-estado-pill").hidden = true;
  try {
    const [snapMov, snapCierre] = await Promise.all([
      getDocs(query(collection(db, COLECCION_MOVIMIENTOS), where("fechaMovimiento", "==", fecha))),
      getDoc(doc(db, COLECCION_CIERRES, fecha)),
    ]);
    if (cierreFechaActual !== fecha) return; // la persona ya cambió de fecha mientras esto cargaba
    const movimientosDelDia = [];
    snapMov.forEach((d) => movimientosDelDia.push({ id: d.id, ...d.data() }));

    const cierreGuardado = snapCierre.exists() ? snapCierre.data() : null;
    if (cierreGuardado && cierreGuardado.estado === "cerrado") {
      renderCierreEstadoPill("cerrado");
      renderCierreContenido(fecha, {
        resumen: cierreGuardado, detalle: cierreGuardado.detalle || [],
        estado: "cerrado", cierreGuardado,
      });
      return;
    }

    // Vista previa en vivo: hace falta la info de cada turno tocado ese día
    // (nombre, fecha de atención, precio, y su saldo pendiente ACTUAL —
    // que necesita TODOS sus movimientos, no solo los de este día).
    const turnoIds = [...new Set(movimientosDelDia.map((m) => m.turnoId))];
    const turnosInfo = new Map();
    await Promise.all(turnoIds.map(async (turnoId) => {
      try {
        const [snapTurno, snapMovTurno] = await Promise.all([
          getDoc(doc(db, "turnosDoctora", turnoId)),
          getDocs(query(collection(db, COLECCION_MOVIMIENTOS), where("turnoId", "==", turnoId))),
        ]);
        const datosTurno = snapTurno.exists() ? snapTurno.data() : null;
        const movsTurno = [];
        snapMovTurno.forEach((d) => movsTurno.push(d.data()));
        const resumenTurno = resumenDineroTurno(datosTurno?.precioConsultaCentavos ?? null, movsTurno);
        turnosInfo.set(turnoId, {
          pacienteNombre: datosTurno?.pacienteNombre || movimientosDelDia.find((m) => m.turnoId === turnoId)?.pacienteNombre || "Paciente",
          fechaAtencion: datosTurno?.fecha || movimientosDelDia.find((m) => m.turnoId === turnoId)?.fechaAtencion || null,
          precioConsultaCentavos: datosTurno?.precioConsultaCentavos ?? null,
          saldoPendienteActualCentavos: resumenTurno.saldoPendienteCentavos,
        });
      } catch (_) { /* si un turno puntual falla, el resto del cierre igual se arma */ }
    }));
    if (cierreFechaActual !== fecha) return;

    const resumen = calcularCierreJornada(movimientosDelDia);
    const detalle = armarDetalleCierre(movimientosDelDia, turnosInfo);
    const estado = cierreGuardado?.estado === "reabierto" ? "reabierto" : "sin_cerrar";
    renderCierreEstadoPill(estado);
    renderCierreContenido(fecha, { resumen, detalle, estado, cierreGuardado });
  } catch (e) {
    if (cierreFechaActual === fecha) cont.innerHTML = `<div class="error-state">No se pudo cargar el cierre: ${escapeHtml(e?.message || e)}</div>`;
  } finally {
    cierreCargando = false;
  }
}

function renderCierreEstadoPill(estado) {
  const el = $("cierre-estado-pill");
  el.hidden = false;
  if (estado === "cerrado") { el.className = "pill pill-ok"; el.textContent = "Cerrado"; }
  else if (estado === "reabierto") { el.className = "pill pill-warn"; el.textContent = "Reabierto — pendiente de volver a cerrar"; }
  else { el.className = "pill pill-muted"; el.textContent = "Sin cerrar"; }
}

function medioPagoCierreTexto(medios) {
  return medios && medios.length ? escapeHtml(etiquetaMediosPago(medios)) : "—";
}

function renderCierreContenido(fecha, { resumen, detalle, estado, cierreGuardado }) {
  if (cierreFechaActual !== fecha) return;
  const detalleHtml = detalle.length
    ? detalle.map((f) => `
        <details class="cierre-detalle-item">
          <summary>${escapeHtml(f.pacienteNombre)} — ${formatoPesosAR(f.cobradoEseDiaCentavos)}</summary>
          <div class="detail-row"><span>Fecha de atención</span><span>${escapeHtml(f.fechaAtencion || "—")}</span></div>
          <div class="detail-row"><span>Precio de la consulta</span><span>${f.precioConsultaCentavos === null ? "Sin cargar" : formatoPesosAR(f.precioConsultaCentavos)}</span></div>
          <div class="detail-row"><span>Cobrado este día</span><span>${formatoPesosAR(f.cobradoEseDiaCentavos)}</span></div>
          ${f.devueltoEseDiaCentavos ? `<div class="detail-row"><span>Devuelto este día</span><span>${formatoPesosAR(f.devueltoEseDiaCentavos)}</span></div>` : ""}
          <div class="detail-row"><span>Saldo pendiente (a la fecha)</span><span>${f.saldoPendienteActualCentavos === null ? "Sin cargar precio" : formatoPesosAR(f.saldoPendienteActualCentavos)}</span></div>
          <div class="detail-row"><span>Medio de pago</span><span>${medioPagoCierreTexto(f.medios)}</span></div>
        </details>`).join("")
    : `<p class="hint-text">Sin movimientos registrados este día.</p>`;

  const accionesHtml = estado === "cerrado"
    ? `<button class="button button-light button-full" type="button" id="btn-reabrir-cierre">Reabrir cierre</button>
       <div id="reabrir-cierre-form" hidden>
         <label for="reabrir-motivo">Motivo de la reapertura</label>
         <textarea id="reabrir-motivo" rows="2" placeholder="Por qué hace falta corregir este cierre…"></textarea>
         <div class="dinero-form-actions">
           <button class="button button-primary" type="button" id="btn-confirmar-reapertura">Confirmar reapertura</button>
           <button class="button button-light" type="button" id="btn-cancelar-reapertura">Cancelar</button>
         </div>
       </div>`
    : `<button class="button button-primary button-full" type="button" id="btn-guardar-cierre">Guardar cierre de esta fecha</button>`;

  $("cierre-contenido").innerHTML = `
    <div class="resumen-grid">
      <div class="resumen-tile"><span class="resumen-num">${resumen.consultasAtendidas}</span><span class="resumen-label">Consultas atendidas</span></div>
      <div class="resumen-tile"><span class="resumen-num">${formatoPesosAR(resumen.totalCobradoCentavos)}</span><span class="resumen-label">Cobros del día</span></div>
      <div class="resumen-tile"><span class="resumen-num">${formatoPesosAR(resumen.totalDevueltoCentavos)}</span><span class="resumen-label">Devoluciones</span></div>
      <div class="resumen-tile"><span class="resumen-num">${formatoPesosAR(resumen.netoCentavos)}</span><span class="resumen-label">Neto a distribuir</span></div>
      <div class="resumen-tile resumen-tile-doctora"><span class="resumen-num">${formatoPesosAR(resumen.parteDoctoraCentavos)}</span><span class="resumen-label">Parte de la doctora (90%)</span></div>
      <div class="resumen-tile"><span class="resumen-num">${formatoPesosAR(resumen.parteMimarTCentavos)}</span><span class="resumen-label">Parte de Mimar T (10%)</span></div>
    </div>
    ${estado === "cerrado" ? `<p class="hint-text">Cerrado ${cierreGuardado?.cerradoPorEmail ? "por " + escapeHtml(cierreGuardado.cerradoPorEmail) : ""}. Calcular el reparto no significa que ya se haya entregado el dinero correspondiente a cada parte.</p>` : ""}
    <div class="detalle-subtitulo">Detalle por consulta</div>
    ${detalleHtml}
    <div class="cierre-acciones">${accionesHtml}</div>
  `;

  if (estado === "cerrado") {
    $("btn-reabrir-cierre").addEventListener("click", () => { $("reabrir-cierre-form").hidden = false; });
    $("btn-cancelar-reapertura").addEventListener("click", () => { $("reabrir-cierre-form").hidden = true; });
    $("btn-confirmar-reapertura").addEventListener("click", async () => {
      const btn = $("btn-confirmar-reapertura");
      btn.disabled = true;
      try {
        const operador = await operadorActual();
        await reabrirCierreJornada({
          updateDoc, doc, serverTimestamp, db, fecha,
          motivo: $("reabrir-motivo").value.trim(), operador,
          historialPrevio: cierreGuardado?.historialReapertura || [],
        });
        toast("Cierre reabierto.");
        await cargarCierre(fecha);
      } catch (e) { toast("No se pudo reabrir: " + (e?.message || e)); btn.disabled = false; }
    });
  } else {
    $("btn-guardar-cierre").addEventListener("click", async () => {
      const btn = $("btn-guardar-cierre");
      btn.disabled = true;
      btn.textContent = "Guardando…";
      try {
        const operador = await operadorActual();
        const reaperturaPrevia = estado === "reabierto" && cierreGuardado?.historialReapertura?.length
          ? cierreGuardado.historialReapertura[cierreGuardado.historialReapertura.length - 1]
          : null;
        await guardarCierreJornada({ setDoc, doc, serverTimestamp, db, fecha, resumen, detalle, operador, reaperturaPrevia });
        toast("Cierre guardado.");
        await cargarCierre(fecha);
      } catch (e) {
        toast("No se pudo guardar el cierre: " + (e?.message || e));
        btn.disabled = false; btn.textContent = "Guardar cierre de esta fecha";
      }
    });
  }
}

// ── Reconciliación / reconexión ───────────────────────────────────────
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { renderPacientes(); renderAgenda(); } });
window.addEventListener("online", () => { renderPacientes(); renderAgenda(); });
