// Mimar T Administración — pantalla única: quién se atiende hoy (tratamientos
// corporales/faciales y depilación juntos) + nota general de la paciente.
// Comportamiento correcto dentro de la app Android (botón Atrás, retorno de
// segundo plano, sin listeners duplicados) — mismo patrón que Mimar T
// Inteligente.
import {
  db, auth, collection, query, where, onSnapshot, doc, getDoc, setDoc,
  serverTimestamp, onAuthStateChanged, signInWithEmailAndPassword, signOut,
} from "./firebase-web.js";
import {
  fechaISOEnZona, formatearFechaLocal, diaSemanaLegible,
  normalizarPacienteHoy, construirListaHoy,
} from "./mimar-cristina-logic.js";

// Mismos emails ya habilitados como esAdminDepi() en las reglas de
// Firestore — esto solo da un mensaje claro en la app; el permiso real lo
// decide el servidor.
const AUTORIZADOS = ["depi.mimart@gmail.com", "espaciomimart36@gmail.com"];
const esEmailAutorizado = (email) => AUTORIZADOS.includes((email || "").trim().toLowerCase());

const escapeHtml = (v) => (v ?? "").toString()
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const $ = (id) => document.getElementById(id);

const nativeApp = !!(window.Capacitor?.isNativePlatform?.());
const AppPlugin = window.Capacitor?.Plugins?.App;

let toastTimer = null;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

function setConexion(estado, texto) {
  const el = $("connection");
  el.dataset.state = estado;
  $("connection-text").textContent = texto;
}

// ── Suscripciones del día ────────────────────────────────────────────────
let hoyISO = fechaISOEnZona(Date.now());
let unsubReservas = null;
let unsubReservasDepi = null;
let itemsReservas = [];
let itemsReservasDepi = [];
let fuenteReservasOk = false;
let fuenteReservasDepiOk = false;
let fuenteReservasError = false;
let fuenteReservasDepiError = false;

function renderCabeceraFecha() {
  const ms = Date.now();
  const dia = diaSemanaLegible(ms) || "";
  $("date-heading").textContent = `Hoy, ${dia} ${formatearFechaLocal(ms) || ""}`.trim();
}

function actualizarConexion() {
  if (fuenteReservasError || fuenteReservasDepiError) { setConexion("error", "Error de datos"); return; }
  if (fuenteReservasOk && fuenteReservasDepiOk) { setConexion("live", "Al día"); return; }
  setConexion("warning", "Sincronizando…");
}

function render() {
  const lista = construirListaHoy(itemsReservas, itemsReservasDepi);
  $("count-hoy").textContent = String(lista.length);
  const cont = $("lista-hoy");
  if (!fuenteReservasOk || !fuenteReservasDepiOk) {
    cont.innerHTML = `<div class="loading-state">Cargando…</div>`;
    return;
  }
  if (!lista.length) {
    cont.innerHTML = `<div class="empty-state"><h3>Sin pacientes para hoy</h3><p>Todavía no hay turnos ni depilaciones cargadas para la fecha de hoy.</p></div>`;
    return;
  }
  cont.innerHTML = lista.map((p) => {
    const hora = p.hora || "—";
    const pillCls = p.esDepi ? "pill-depi" : "pill-general";
    const pillTxt = p.esDepi ? "Depilación" : escapeHtml(p.servicio || "Reserva");
    return `
      <div class="item-row" data-id="${escapeHtml(p.id)}" data-coleccion="${escapeHtml(p.coleccion)}" data-dni="${escapeHtml(p.dni || "")}" data-nombre="${escapeHtml(p.nombre)}">
        <div class="item-row-top">
          <span class="item-time">${escapeHtml(hora)}</span>
          <span class="item-name">${escapeHtml(p.nombre)}</span>
        </div>
        <div class="item-pills"><span class="pill ${pillCls}">${pillTxt}</span></div>
      </div>`;
  }).join("");
}

function iniciarSuscripciones() {
  detenerSuscripciones();
  fuenteReservasOk = false; fuenteReservasDepiOk = false;
  fuenteReservasError = false; fuenteReservasDepiError = false;
  render();

  unsubReservas = onSnapshot(
    query(collection(db, "reservas"), where("fecha", "==", hoyISO)),
    (snap) => {
      itemsReservas = [];
      snap.forEach((d) => itemsReservas.push(normalizarPacienteHoy("reservas", d.id, d.data())));
      fuenteReservasOk = true; fuenteReservasError = false;
      actualizarConexion(); render();
    },
    (err) => { console.error("reservas:", err); fuenteReservasError = true; actualizarConexion(); render(); }
  );

  unsubReservasDepi = onSnapshot(
    query(collection(db, "reservasDepi"), where("fecha", "==", hoyISO)),
    (snap) => {
      itemsReservasDepi = [];
      snap.forEach((d) => itemsReservasDepi.push(normalizarPacienteHoy("reservasDepi", d.id, d.data())));
      fuenteReservasDepiOk = true; fuenteReservasDepiError = false;
      actualizarConexion(); render();
    },
    (err) => { console.error("reservasDepi:", err); fuenteReservasDepiError = true; actualizarConexion(); render(); }
  );

  $("last-sync").textContent = `Fecha: ${hoyISO}`;
}

function detenerSuscripciones() {
  if (unsubReservas) { unsubReservas(); unsubReservas = null; }
  if (unsubReservasDepi) { unsubReservasDepi(); unsubReservasDepi = null; }
  itemsReservas = []; itemsReservasDepi = [];
}

// Si la app queda abierta y cruza la medianoche (o vuelve de segundo plano
// otro día), la lista de "hoy" tiene que seguir siendo HOY, no el día en que
// se abrió la app.
function reconciliarFecha() {
  const actual = fechaISOEnZona(Date.now());
  renderCabeceraFecha();
  if (actual !== hoyISO) {
    hoyISO = actual;
    iniciarSuscripciones();
  }
}

// ── Nota general de la paciente (clients/{dni}.notas) ────────────────────
const notaDialog = $("nota-dialog");
let notaDniActual = null;
let notaNombreActual = null;
let notaTelefonoActual = null;

function notaEstado(msg, tipo) {
  const el = $("nota-status");
  if (!msg) { el.className = "dialog-status"; el.textContent = ""; return; }
  el.className = `dialog-status mostrar ${tipo || "info"}`;
  el.textContent = msg;
}

async function abrirNota(dni, nombre, telefono, infoTurno) {
  notaDniActual = dni;
  notaNombreActual = nombre;
  notaTelefonoActual = telefono || null;
  $("nota-titulo").textContent = nombre;
  $("nota-turno-info").textContent = infoTurno || "";
  $("nota-texto").value = "";
  notaEstado("Cargando nota guardada…", "info");
  notaDialog.showModal();
  try {
    const snap = await getDoc(doc(db, "clients", dni));
    $("nota-texto").value = snap.exists() ? (snap.data().notas || "") : "";
    notaEstado("", "info");
  } catch (e) {
    notaEstado("No se pudo cargar la nota guardada (podés escribir y guardar igual).", "error");
  }
}

function cerrarNota() { notaDialog.close(); notaDniActual = null; }

$("btn-cerrar-nota").addEventListener("click", cerrarNota);
$("btn-cerrar-nota-2").addEventListener("click", cerrarNota);
notaDialog.addEventListener("cancel", (ev) => { ev.preventDefault(); cerrarNota(); });

$("btn-guardar-nota").addEventListener("click", async () => {
  if (!notaDniActual) return;
  const boton = $("btn-guardar-nota");
  boton.disabled = true;
  notaEstado("Guardando…", "info");
  try {
    const payload = { notas: $("nota-texto").value.trim(), updatedAt: serverTimestamp() };
    // Si la paciente todavía no tiene ficha (frecuente en depilación, que es
    // un circuito separado de "clients"), se crea una mínima con lo que ya
    // se sabe — nunca se pisa un nombre/teléfono ya cargado por otro lado.
    const snap = await getDoc(doc(db, "clients", notaDniActual));
    if (!snap.exists()) {
      payload.fullName = notaNombreActual || "";
      payload.phone = notaTelefonoActual || "";
    }
    await setDoc(doc(db, "clients", notaDniActual), payload, { merge: true });
    toast(`Nota guardada: ${notaNombreActual}`);
    cerrarNota();
  } catch (e) {
    notaEstado("No se pudo guardar: " + (e?.message || e), "error");
  } finally {
    boton.disabled = false;
  }
});

$("lista-hoy").addEventListener("click", (ev) => {
  const fila = ev.target.closest(".item-row");
  if (!fila) return;
  const dni = fila.dataset.dni;
  const nombre = fila.dataset.nombre;
  if (!dni) { toast("Sin DNI identificable — no se puede cargar una nota para esta paciente."); return; }
  abrirNota(dni, nombre, null, null);
});

// ── Login ────────────────────────────────────────────────────────────────
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
    $("access-message").textContent = "Ingresá con tu cuenta.";
    $("login-error").textContent = mensajeErrorAuth(e);
  }
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

$("btn-salir").addEventListener("click", async () => {
  try { await signOut(auth); toast("Sesión cerrada."); } catch (_) {}
});

function mostrarAcceso(mensaje) {
  $("access-panel").hidden = false;
  $("workspace").hidden = true;
  $("btn-salir").hidden = true;
  $("login-form").hidden = true;
  $("access-message").textContent = mensaje;
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    detenerSuscripciones();
    mostrarAcceso("Ingresá con tu cuenta.");
    $("login-form").hidden = false;
    $("login-submit").disabled = false;
    return;
  }
  if (!esEmailAutorizado(user.email)) {
    mostrarAcceso("Esta cuenta no tiene acceso a Mimar T Administración.");
    $("login-form").hidden = false;
    $("login-submit").disabled = false;
    await signOut(auth);
    return;
  }

  $("access-panel").hidden = true;
  $("workspace").hidden = false;
  $("btn-salir").hidden = false;
  hoyISO = fechaISOEnZona(Date.now());
  renderCabeceraFecha();
  iniciarSuscripciones();
});

// ── Botón Atrás (solo dentro de la app Android) ──────────────────────────
if (nativeApp && AppPlugin?.addListener) {
  let ultimoAtras = 0;
  AppPlugin.addListener("backButton", () => {
    if (notaDialog.open) { cerrarNota(); return; }
    const ahora = Date.now();
    if (ahora - ultimoAtras < 2200) { AppPlugin.exitApp(); return; }
    ultimoAtras = ahora;
    toast("Tocá de nuevo Atrás para salir");
  });

  AppPlugin.addListener("appStateChange", ({ isActive }) => {
    if (isActive) reconciliarFecha();
  });
} else {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") reconciliarFecha();
  });
}
