// doctora/doctora.js — "Pacientes de la Doctora": sección privada con dos
// pestañas (Pacientes / Agenda). Página web normal (no es la app Capacitor),
// así que importa el firebase-web.js canónico de la raíz del proyecto.
import {
  db, auth, collection, query, where, orderBy, limit, onSnapshot, doc, getDoc, getDocFromServer,
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
} from "./doctora-logic.js";
import {
  registrarContactoDoctoraPreparado, registrarContactoDoctoraEstado,
  registrarContactoDoctoraManual, registrarConfirmacionPaciente, idContactoDoctora,
} from "./doctora-contactos.js";

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

function abrirTurnoDialog(turnoId) {
  const turno = buscarTurnoPorId(turnoId);
  if (!turno) { toast("No se encuentra ese turno."); return; }
  turnoSeleccionado = { id: turnoId, tipoMensajeActivo: null };
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
  `;
  $("wa-doctora-preview-wrap").hidden = true;
  $("btn-abrir-whatsapp-doctora").hidden = true;
  if (typeof turnoDialog.showModal === "function") turnoDialog.showModal();
  else turnoDialog.setAttribute("open", "");
}

function cerrarTurnoDialog() {
  if (typeof turnoDialog.close === "function" && turnoDialog.open) turnoDialog.close();
  else turnoDialog.removeAttribute("open");
  turnoSeleccionado = null;
}
$("btn-cerrar-turno-dialog").addEventListener("click", cerrarTurnoDialog);
$("btn-cerrar-turno-dialog-2").addEventListener("click", cerrarTurnoDialog);
turnoDialog.addEventListener("click", (ev) => { if (ev.target === turnoDialog) cerrarTurnoDialog(); });

function mostrarTurnoDialogStatus(texto, tipo) {
  const el = $("turno-dialog-status");
  el.textContent = texto;
  el.className = `dialog-status mostrar ${tipo}`;
}

$("btn-turno-acciones").addEventListener("click", () => {
  if (!turnoSeleccionado) return;
  const turno = buscarTurnoPorId(turnoSeleccionado.id);
  if (!turno) return;
  const opciones = [];
  opciones.push(`<button class="sheet-option" type="button" data-accion-turno="confirmacion">Preparar confirmación</button>`);
  opciones.push(`<button class="sheet-option" type="button" data-accion-turno="recordatorio">Preparar recordatorio</button>`);
  opciones.push(`<button class="sheet-option" type="button" data-accion-turno="recomendaciones">Preparar recomendaciones</button>`);
  opciones.push(`<button class="sheet-option" type="button" data-accion-turno="registrar-manual">Registrar envío manual</button>`);
  opciones.push(`<button class="sheet-option" type="button" data-accion-turno="confirmo-si">La paciente confirmó asistencia</button>`);
  opciones.push(`<button class="sheet-option" type="button" data-accion-turno="confirmo-no">La paciente avisó que no viene</button>`);
  if (turno.hora) opciones.push(`<button class="sheet-option" type="button" data-accion-turno="reprogramar">Reprogramar horario</button>`);
  if (turno.estado !== "cancelado") opciones.push(`<button class="sheet-option" type="button" data-accion-turno="cancelar">Cancelar turno</button>`);
  abrirSheet("Más acciones", `<div class="sheet-option-list">${opciones.join("")}</div>`);
  $("sheet-body").querySelectorAll("[data-accion-turno]").forEach((el) => {
    el.addEventListener("click", () => ejecutarAccionTurno(el.getAttribute("data-accion-turno")));
  });
});

function prepararWaDoctoraPreview(texto) {
  $("wa-doctora-preview-wrap").hidden = false;
  $("btn-abrir-whatsapp-doctora").hidden = false;
  $("wa-doctora-preview-texto").value = texto || "";
}

async function ejecutarAccionTurno(accion) {
  cerrarSheet();
  if (!turnoSeleccionado) return;
  const turno = buscarTurnoPorId(turnoSeleccionado.id);
  if (!turno) return;

  if (accion === "confirmacion" || accion === "recordatorio" || accion === "recomendaciones") {
    turnoSeleccionado.tipoMensajeActivo = accion;
    const texto = accion === "confirmacion" ? construirTextoConfirmacionDoctora(turno, ubicacionConfigurada)
      : accion === "recordatorio" ? construirTextoRecordatorioDoctora(turno)
      : construirTextoRecomendacionesDoctora(turno, "");
    prepararWaDoctoraPreview(texto);
    return;
  }

  if (accion === "registrar-manual") {
    const tipo = turnoSeleccionado.tipoMensajeActivo || "confirmacion";
    try {
      const operador = await operadorActual();
      await registrarContactoDoctoraManual({ setDoc, doc, serverTimestamp, db, turnoId: turno.id, tipoMensaje: tipo, operador, nota: "Registrado manualmente desde Pacientes de la Doctora" });
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
      abrirTurnoDialog(turno.id); // refresca el detalle con el nuevo estado
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
    abrirSheet("Reprogramar a", `<div class="sheet-option-list">${libres.map((h) => `<button class="sheet-option" type="button" data-nuevo-horario="${escapeHtml(h)}">${escapeHtml(h)}</button>`).join("")}</div>`);
    $("sheet-body").querySelectorAll("[data-nuevo-horario]").forEach((el) => {
      el.addEventListener("click", async () => {
        const horaNueva = el.getAttribute("data-nuevo-horario");
        cerrarSheet();
        try {
          await asignarOReprogramarHorario({
            turnoId: turno.id, fecha: turno.fecha, hora: horaNueva,
            fechaAnterior: turno.fecha, horaAnterior: turno.hora,
            datosTurno: { pacienteDni: turno.pacienteDni, pacienteNombre: turno.pacienteNombre, pacienteTelefono: turno.pacienteTelefono || "", estado: "confirmado", duracionMin: fechaDocDelTurno?.duracionTurnoMin || null },
          });
          toast(`Turno reprogramado a las ${horaNueva}.`);
          abrirTurnoDialog(turno.id);
        } catch (e) { toast(MOTIVOS_RESERVA[e?.message] || ("No se pudo reprogramar: " + (e?.message || e))); }
      });
    });
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

// ── Reconciliación / reconexión ───────────────────────────────────────
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { renderPacientes(); renderAgenda(); } });
window.addEventListener("online", () => { renderPacientes(); renderAgenda(); });
