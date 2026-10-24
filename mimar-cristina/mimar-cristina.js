// Mimar T Administración — agenda del mes actual en adelante (tratamientos
// corporales/faciales y depilación juntos, con el detalle de la sesión si
// se cargó) + nota general de la paciente. Comportamiento correcto dentro
// de la app Android (botón Atrás, retorno de segundo plano, sin listeners
// duplicados) — mismo patrón que Mimar T Inteligente.
import {
  db, auth, collection, query, where, onSnapshot, doc, getDoc, setDoc,
  serverTimestamp, onAuthStateChanged, signInWithEmailAndPassword, signOut,
} from "./firebase-web.js";
import {
  fechaISOEnZona, formatearFechaLocal, diaSemanaLegible,
  normalizarPaciente, agruparPorFecha,
  inicioMesISO, mesDeFechaISO, sumarMeses, nombreMes, construirGrillaMes, tituloDia,
  formatearNombre,
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

// ── Estado y suscripciones (mes actual en adelante, sin límite superior) ──
let hoyISO = fechaISOEnZona(Date.now());
let mesSuscripcionISO = mesDeFechaISO(inicioMesISO());   // mes desde el que se consulta Firestore
let mesVisibleISO = mesSuscripcionISO;                    // mes que se ve en el calendario
let fechaSeleccionada = hoyISO;                           // día cuya agenda se ve abajo
let unsubReservas = null;
let unsubReservasDepi = null;
let itemsReservas = [];
let itemsReservasDepi = [];
let agrupado = new Map();
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

// ── Calendario ─────────────────────────────────────────────────────────
function renderCalendario() {
  $("cal-mes-titulo").textContent = nombreMes(mesVisibleISO);
  $("btn-mes-prev").disabled = mesVisibleISO === mesSuscripcionISO;

  const semanas = construirGrillaMes(mesVisibleISO);
  $("cal-grid").innerHTML = semanas.flat().map((fecha) => {
    if (!fecha) return `<button type="button" class="cal-dia cal-dia-vacia" tabindex="-1" aria-hidden="true"></button>`;
    const diaNum = Number(fecha.slice(8, 10));
    const esHoy = fecha === hoyISO;
    const esSel = fecha === fechaSeleccionada;
    const tieneTurnos = agrupado.has(fecha);
    const clases = ["cal-dia"];
    if (esHoy) clases.push("cal-dia-hoy");
    if (esSel) clases.push("cal-dia-sel");
    return `<button type="button" class="${clases.join(" ")}" data-fecha="${fecha}">${diaNum}${tieneTurnos ? '<span class="cal-dia-punto"></span>' : ""}</button>`;
  }).join("");
}

$("btn-mes-prev").addEventListener("click", () => {
  if (mesVisibleISO === mesSuscripcionISO) return;
  mesVisibleISO = sumarMeses(mesVisibleISO, -1);
  renderCalendario();
});
$("btn-mes-next").addEventListener("click", () => {
  mesVisibleISO = sumarMeses(mesVisibleISO, 1);
  renderCalendario();
});
$("btn-ir-hoy").addEventListener("click", () => {
  mesVisibleISO = mesDeFechaISO(hoyISO);
  fechaSeleccionada = hoyISO;
  renderCalendario();
  renderDia();
});
$("cal-grid").addEventListener("click", (ev) => {
  const btn = ev.target.closest(".cal-dia[data-fecha]");
  if (!btn) return;
  fechaSeleccionada = btn.dataset.fecha;
  renderCalendario();
  renderDia();
});

// ── Agenda del día seleccionado ───────────────────────────────────────────
function renderDia() {
  $("dia-titulo").textContent = tituloDia(fechaSeleccionada, hoyISO);
  const lista = agrupado.get(fechaSeleccionada) || [];
  $("count-dia").textContent = String(lista.length);
  const cont = $("lista-dia");
  if (!fuenteReservasOk || !fuenteReservasDepiOk) {
    cont.innerHTML = `<div class="loading-state">Cargando…</div>`;
    return;
  }
  if (!lista.length) {
    cont.innerHTML = `<div class="empty-state"><h3>Sin pacientes</h3><p>No hay turnos ni depilaciones cargadas para este día.</p></div>`;
    return;
  }
  cont.innerHTML = lista.map((p) => {
    const hora = p.hora || "—";
    const nombreLindo = formatearNombre(p.nombre);
    const pillCls = p.esDepi ? "pill-depi" : "pill-general";
    const pillTxt = p.esDepi ? "Depilación" : escapeHtml(p.servicio || "Reserva");
    // Sin detalle cargado, la reserva se muestra igual — solo se omite esa línea.
    const detalleHtml = p.detalleSesion ? `<div class="item-detalle">${escapeHtml(p.detalleSesion)}</div>` : "";
    return `
      <div class="item-row" data-id="${escapeHtml(p.id)}" data-coleccion="${escapeHtml(p.coleccion)}" data-dni="${escapeHtml(p.dni || "")}" data-nombre="${escapeHtml(nombreLindo)}">
        <div class="item-row-top">
          <span class="item-time">${escapeHtml(hora)}</span>
          <span class="item-name">${escapeHtml(nombreLindo)}</span>
        </div>
        <div class="item-pills"><span class="pill ${pillCls}">${pillTxt}</span></div>
        ${detalleHtml}
      </div>`;
  }).join("");
}

function iniciarSuscripciones() {
  detenerSuscripciones();
  fuenteReservasOk = false; fuenteReservasDepiOk = false;
  fuenteReservasError = false; fuenteReservasDepiError = false;
  renderDia();

  const desdeISO = `${mesSuscripcionISO}-01`;

  unsubReservas = onSnapshot(
    query(collection(db, "reservas"), where("fecha", ">=", desdeISO)),
    (snap) => {
      itemsReservas = [];
      snap.forEach((d) => itemsReservas.push(normalizarPaciente("reservas", d.id, d.data())));
      agrupado = agruparPorFecha(itemsReservas, itemsReservasDepi);
      fuenteReservasOk = true; fuenteReservasError = false;
      actualizarConexion(); renderCalendario(); renderDia();
    },
    (err) => { console.error("reservas:", err); fuenteReservasError = true; actualizarConexion(); renderDia(); }
  );

  unsubReservasDepi = onSnapshot(
    query(collection(db, "reservasDepi"), where("fecha", ">=", desdeISO)),
    (snap) => {
      itemsReservasDepi = [];
      snap.forEach((d) => itemsReservasDepi.push(normalizarPaciente("reservasDepi", d.id, d.data())));
      agrupado = agruparPorFecha(itemsReservas, itemsReservasDepi);
      fuenteReservasDepiOk = true; fuenteReservasDepiError = false;
      actualizarConexion(); renderCalendario(); renderDia();
    },
    (err) => { console.error("reservasDepi:", err); fuenteReservasDepiError = true; actualizarConexion(); renderDia(); }
  );

  $("last-sync").textContent = `Desde: ${desdeISO}`;
}

function detenerSuscripciones() {
  if (unsubReservas) { unsubReservas(); unsubReservas = null; }
  if (unsubReservasDepi) { unsubReservasDepi(); unsubReservasDepi = null; }
  itemsReservas = []; itemsReservasDepi = []; agrupado = new Map();
}

// Si la app queda abierta y cruza la medianoche (o vuelve de segundo plano
// otro día), "hoy" en el calendario tiene que seguir siendo el día real. Si
// encima cambió el mes, hay que volver a suscribirse (la consulta arranca
// desde el inicio del mes actual, nunca antes) — en ese caso se lleva la
// vista a hoy, igual que al entrar.
function reconciliarFecha() {
  const actual = fechaISOEnZona(Date.now());
  renderCabeceraFecha();
  if (actual === hoyISO) return;
  const cruzoDeMes = mesDeFechaISO(actual) !== mesDeFechaISO(hoyISO);
  hoyISO = actual;
  if (cruzoDeMes) {
    mesSuscripcionISO = mesDeFechaISO(inicioMesISO());
    mesVisibleISO = mesSuscripcionISO;
    fechaSeleccionada = hoyISO;
    iniciarSuscripciones();
  } else {
    renderCalendario();
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

$("lista-dia").addEventListener("click", (ev) => {
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
  mesSuscripcionISO = mesDeFechaISO(inicioMesISO());
  mesVisibleISO = mesSuscripcionISO;
  fechaSeleccionada = hoyISO;
  renderCabeceraFecha();
  renderCalendario();
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
