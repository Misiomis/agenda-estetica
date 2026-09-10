// Mimar T Inteligente — app/página. Misma lógica de negocio que la v1 web
// (mimar-inteligente-logic.js, sin cambios), con una interfaz alineada a la
// identidad del Reloj Mimar T y comportamiento correcto dentro de la app
// Android (botón Atrás, retorno de segundo plano, sin listeners duplicados).
import {
  db, auth, collection, query, where, onSnapshot, doc, getDoc, getDocFromServer,
  onAuthStateChanged, signInWithEmailAndPassword, signOut,
} from "./firebase-web.js";
import {
  ZONA_HORARIA, fechaISOEnZona, sumarDiasISO, normalizarItemAgenda, construirAgenda,
  obtenerProximaReserva, obtenerBandejaRevisiones, construirTextoConfirmacion, normalizarTelefonoWA,
} from "./mimar-inteligente-logic.js";

const ADMIN_EMAILS = ["espaciomimart36@gmail.com"];
const esEmailAdmin = (email) => ADMIN_EMAILS.includes((email || "").trim().toLowerCase());
const esUsuarioAdmin = (tokenResult) => {
  const email = tokenResult?.claims?.email || tokenResult?.token?.email || "";
  return tokenResult?.claims?.admin === true || esEmailAdmin(email);
};

const escapeHtml = (v) => (v ?? "").toString()
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const BOX_LABELS = { b1: "Box 1", b2: "Box 2", b3: "Box 3", b4: "Box 4" };
const boxLabel = (box) => (box ? (BOX_LABELS[box] || box) : null);

const $ = (id) => document.getElementById(id);

const nativeApp = !!(window.Capacitor?.isNativePlatform?.());
const AppPlugin = window.Capacitor?.Plugins?.App;

// ── Toast (mismo patrón que reloj.js) ────────────────────────────────────
let toastTimer = null;
function toast(msg, ms = 3200) {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

// ── Estado de las fuentes ─────────────────────────────────────────────────
const fuentes = {
  reservas: { estado: "cargando", error: null, fromCache: true, items: [] },
  consultas: { estado: "cargando", error: null, fromCache: true, items: [] },
};

let unsubReservas = null;
let unsubConsultas = null;
let uidActual = null;
let tickInterval = null;
let itemSeleccionado = null;
let ultimaAgenda = [];
let ultimaSincronizacion = null;

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
    $("access-message").textContent = "Buscando tu sesión de la agenda…";
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
    mostrarAcceso("Usá la misma cuenta con la que administrás tu agenda.");
    $("login-form").hidden = false;
    $("login-submit").disabled = false;
    uidActual = null;
    return;
  }
  $("access-message").textContent = "Verificando tu acceso…";
  try {
    const token = await user.getIdTokenResult(false);
    if (!esUsuarioAdmin(token)) {
      mostrarAcceso("Esta cuenta no tiene acceso a Mimar T Inteligente. Ingresá con la cuenta administradora de tu agenda.");
      $("login-form").hidden = false;
      $("login-submit").disabled = false;
      await signOut(auth);
      return;
    }
  } catch (_) {
    mostrarAcceso("No pudimos verificar la sesión. Revisá la conexión e ingresá nuevamente.");
    $("login-form").hidden = false;
    $("login-submit").disabled = false;
    await signOut(auth);
    return;
  }

  $("access-panel").hidden = true;
  $("workspace").hidden = false;
  $("btn-salir").hidden = false;

  if (uidActual !== user.uid) {
    uidActual = user.uid;
    iniciarSuscripciones();
  }
});

// ── Suscripciones Firestore ──────────────────────────────────────────────
function detenerSuscripciones() {
  if (unsubReservas) { unsubReservas(); unsubReservas = null; }
  if (unsubConsultas) { unsubConsultas(); unsubConsultas = null; }
  if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
}

function iniciarSuscripciones() {
  detenerSuscripciones(); // nunca dejar listeners duplicados, aunque se reintente

  const hoyISO = fechaISOEnZona();
  const mananaISO = sumarDiasISO(hoyISO, 1);
  $("date-heading").textContent = fechaLindaHoy(hoyISO);

  const qReservas = query(collection(db, "reservas"), where("fecha", "in", [hoyISO, mananaISO]));
  unsubReservas = onSnapshot(qReservas, { includeMetadataChanges: true },
    (snap) => manejarSnapshot("reservas", snap),
    (err) => manejarErrorFuente("reservas", err));

  const qConsultas = query(collection(db, "consultas"), where("fecha", "in", [hoyISO, mananaISO]));
  unsubConsultas = onSnapshot(qConsultas, { includeMetadataChanges: true },
    (snap) => manejarSnapshot("consultas", snap),
    (err) => manejarErrorFuente("consultas", err));

  tickInterval = setInterval(renderTodo, 1000); // el reloj y la cuenta regresiva necesitan tick fino
}

function manejarSnapshot(fuenteId, snap) {
  const items = [];
  snap.forEach((d) => items.push(normalizarItemAgenda(fuenteId, d.id, d.data())));
  fuentes[fuenteId] = { estado: "ok", error: null, fromCache: snap.metadata.fromCache, items };
  if (!snap.metadata.fromCache) ultimaSincronizacion = Date.now();
  renderTodo();
}

function manejarErrorFuente(fuenteId, err) {
  fuentes[fuenteId] = {
    estado: "error", error: err?.code || err?.message || "error desconocido",
    fromCache: true, items: fuentes[fuenteId]?.items || [],
  };
  renderTodo();
}

function reconciliar() { renderTodo(); }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reconciliar(); });
window.addEventListener("online", reconciliar);
window.addEventListener("pageshow", (ev) => { if (ev.persisted) reconciliar(); });

// ── Render ────────────────────────────────────────────────────────────────
function fechaLindaHoy(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone: ZONA_HORARIA }).format(dt);
}

function pad2(n) { return String(n).padStart(2, "0"); }

function renderReloj(ahoraMs) {
  const partes = new Intl.DateTimeFormat("es-AR", {
    timeZone: ZONA_HORARIA, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(new Date(ahoraMs)).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  $("clock-main").textContent = `${partes.hour}:${partes.minute}`;
  $("clock-seconds").textContent = partes.second;
}

function renderConexion() {
  const estados = Object.values(fuentes).map((f) => f.estado);
  const conn = $("connection");
  const txt = $("connection-text");
  let estado = "live", texto = "Al día";
  if (typeof navigator !== "undefined" && navigator.onLine === false) { estado = "offline"; texto = "Sin conexión"; }
  else if (estados.includes("error")) { estado = "error"; texto = "Error de datos"; }
  else if (estados.includes("cargando")) { estado = "warning"; texto = "Sincronizando…"; }
  else if (Object.values(fuentes).some((f) => f.fromCache)) { estado = "warning"; texto = "Verificando…"; }
  conn.setAttribute("data-state", estado);
  txt.textContent = texto;

  const errores = Object.entries(fuentes).filter(([, f]) => f.estado === "error");
  const aviso = $("fuentes-aviso");
  if (errores.length) {
    const nombres = { reservas: "Reservas", consultas: "Consultas" };
    aviso.hidden = false;
    aviso.textContent = errores.map(([id, f]) => `${nombres[id] || id}: no se pudo cargar (${f.error})`).join(" · ");
  } else {
    aviso.hidden = true;
  }

  $("last-sync").textContent = ultimaSincronizacion
    ? "Última verificación con el servidor: " + new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: ZONA_HORARIA }).format(ultimaSincronizacion)
    : "Todavía sin verificar con el servidor";
}

function renderProximoTurno(agenda, ahoraMs) {
  const body = $("proximo-turno-body");
  const countdownEl = $("countdown");
  if (fuentes.reservas.estado === "cargando" || fuentes.consultas.estado === "cargando") {
    body.innerHTML = `<p class="proximo-turno-vacio">Cargando…</p>`;
    countdownEl.textContent = "--:--";
    return;
  }
  const prox = obtenerProximaReserva(agenda, ahoraMs);
  if (!prox) {
    body.innerHTML = `<p class="proximo-turno-vacio">No hay más turnos activos para hoy y mañana.</p>`;
    countdownEl.textContent = "—";
    return;
  }
  const box = boxLabel(prox.box);
  body.innerHTML = `
    <div class="proximo-turno-nombre">${escapeHtml(prox.nombre || "Sin nombre registrado")}</div>
    <div class="proximo-turno-detalle">${escapeHtml(prox.fecha)} · ${escapeHtml(prox.hora || "—")} hs${prox.servicio ? " · " + escapeHtml(prox.servicio) : ""}</div>
    <div class="proximo-turno-pills">
      ${box ? `<span class="pill pill-box">${escapeHtml(box)}</span>` : `<span class="pill pill-on-dark">Box no asignado</span>`}
      ${!prox.telefono ? `<span class="pill pill-on-dark">Sin teléfono</span>` : ""}
    </div>`;

  const faltaMs = prox.inicioMs - ahoraMs;
  if (faltaMs <= 0) {
    countdownEl.textContent = "En curso";
  } else {
    const totalMin = Math.floor(faltaMs / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    countdownEl.textContent = h > 0 ? `${h} h ${pad2(m)} min` : `${m} min`;
  }
}

function tarjetaHtml(item, { conMotivos } = {}) {
  const box = boxLabel(item.box);
  const idAttr = `${item.coleccion}::${item.id}`;
  const motivosHtml = conMotivos && item._revision
    ? `<div class="item-motivos">${item._revision.motivos.map((m) => `<div class="item-motivo">${escapeHtml(m.texto)}</div>`).join("")}</div>`
    : "";
  return `
  <div class="item-row" data-item="${idAttr}" data-revision="${conMotivos ? "true" : "false"}">
    <div class="item-row-top">
      <span class="item-time">${escapeHtml(item.hora || "—")}</span>
      <span class="item-name">${escapeHtml(item.nombre || "Sin nombre registrado")}</span>
    </div>
    <div class="item-service">${escapeHtml(item.servicio || (item.coleccion === "consultas" ? "Consulta Inicial" : "Servicio sin registrar"))}</div>
    <div class="item-pills">
      ${box ? `<span class="pill pill-box">${escapeHtml(box)}</span>` : `<span class="pill pill-muted">Box no asignado</span>`}
      ${item.telefono ? `<span class="pill pill-muted">📞 ${escapeHtml(item.telefono)}</span>` : `<span class="pill pill-warn">Sin teléfono</span>`}
      <span class="pill pill-muted">${escapeHtml(item.estadoBruto || "sin estado")}</span>
    </div>
    ${motivosHtml}
    <div class="item-actions"><button class="button button-light" data-abrir="${idAttr}" type="button">Ver detalle</button></div>
  </div>`;
}

function renderRevisiones(agenda, ahoraMs) {
  const cont = $("lista-revisiones");
  if (fuentes.reservas.estado === "cargando" || fuentes.consultas.estado === "cargando") {
    cont.innerHTML = `<div class="loading-state">Cargando…</div>`;
    return;
  }
  const bandeja = obtenerBandejaRevisiones(agenda, ahoraMs);
  $("count-revisiones").textContent = String(bandeja.length);
  $("quick-count-revisiones").textContent = String(bandeja.length);
  if (!bandeja.length) {
    cont.innerHTML = `<div class="empty-state"><svg class="icon"><use href="#i-inbox"/></svg><h3>Sin revisiones pendientes</h3><p>Nada requiere atención en este momento.</p></div>`;
    return;
  }
  cont.innerHTML = bandeja.map((r) => { r.item._revision = r; return tarjetaHtml(r.item, { conMotivos: true }); }).join("");
}

function renderAgenda(agenda, hoyISO, mananaISO) {
  const cont = $("lista-agenda");
  if (fuentes.reservas.estado === "cargando" || fuentes.consultas.estado === "cargando") {
    cont.innerHTML = `<div class="loading-state">Cargando…</div>`;
    return;
  }
  const activos = agenda.filter((it) => it.activa);
  $("count-agenda").textContent = String(activos.length);
  if (!activos.length) {
    cont.innerHTML = `<div class="empty-state"><svg class="icon"><use href="#i-calendar"/></svg><h3>Una pausa en la agenda</h3><p>No hay reservas activas para hoy ni mañana.</p></div>`;
    return;
  }
  const grupos = {};
  activos.forEach((it) => { (grupos[it.fecha] = grupos[it.fecha] || []).push(it); });
  const etiquetaDia = (iso) => iso === hoyISO ? `Hoy · ${iso}` : iso === mananaISO ? `Mañana · ${iso}` : iso;
  let html = "";
  Object.keys(grupos).sort().forEach((fecha) => {
    html += `<div class="day-header">${escapeHtml(etiquetaDia(fecha))}</div>`;
    html += grupos[fecha].map((it) => tarjetaHtml(it, { conMotivos: false })).join("");
  });
  cont.innerHTML = html;
}

function renderTodo() {
  const ahoraMs = Date.now();
  const hoyISO = fechaISOEnZona(ahoraMs);
  const mananaISO = sumarDiasISO(hoyISO, 1);
  ultimaAgenda = construirAgenda(fuentes.reservas.items, fuentes.consultas.items);
  renderReloj(ahoraMs);
  renderConexion();
  renderProximoTurno(ultimaAgenda, ahoraMs);
  renderRevisiones(ultimaAgenda, ahoraMs);
  renderAgenda(ultimaAgenda, hoyISO, mananaISO);
}

// ── Accesos rápidos (scroll dentro de la misma pantalla) ────────────────
document.querySelectorAll("[data-scroll-to]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.getElementById(btn.getAttribute("data-scroll-to"))?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});

// ── Delegación de clicks para abrir el detalle ───────────────────────────
document.addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-abrir]");
  if (btn) abrirModal(btn.getAttribute("data-abrir"));
});

// ── Modal de detalle + Preparar WhatsApp ────────────────────────────────
const detalleDialog = $("detalle-dialog");

function abrirModal(idAttr) {
  const [coleccion, id] = idAttr.split("::");
  const item = ultimaAgenda.find((it) => it.coleccion === coleccion && it.id === id);
  if (!item) { toast("Ya no se encuentra esta reserva."); return; }
  itemSeleccionado = { coleccion, id };
  $("detalle-titulo").textContent = item.nombre || "Sin nombre registrado";
  const statusEl = $("detalle-status");
  statusEl.className = "dialog-status";
  statusEl.textContent = "";
  $("btn-preparar-wa").disabled = false;
  $("btn-preparar-wa").innerHTML = `<svg class="icon"><use href="#i-whatsapp"/></svg> Preparar WhatsApp`;
  const box = boxLabel(item.box);
  $("detalle-body").innerHTML = `
    <div class="detail-row"><span>Fecha</span><span>${escapeHtml(item.fecha || "—")}</span></div>
    <div class="detail-row"><span>Hora</span><span>${escapeHtml(item.hora || "—")}</span></div>
    <div class="detail-row"><span>Servicio</span><span>${escapeHtml(item.servicio || "sin registrar")}</span></div>
    <div class="detail-row"><span>Duración</span><span>${item.duracionMinutos ? item.duracionMinutos + " min" : "estimada (60 min, no registrada)"}</span></div>
    <div class="detail-row"><span>Box</span><span>${box ? escapeHtml(box) : "no asignado"}</span></div>
    <div class="detail-row"><span>Teléfono</span><span>${item.telefono ? escapeHtml(item.telefono) : "sin registrar"}</span></div>
    <div class="detail-row"><span>Estado registrado</span><span>${escapeHtml(item.estadoBruto || "sin estado")}</span></div>
    <div class="detail-row"><span>Agenda</span><span>${item.coleccion === "consultas" ? "Consultas iniciales" : "Reservas"}</span></div>
  `;
  if (typeof detalleDialog.showModal === "function") detalleDialog.showModal();
  else detalleDialog.setAttribute("open", "");
}

function cerrarModal() {
  if (typeof detalleDialog.close === "function" && detalleDialog.open) detalleDialog.close();
  else detalleDialog.removeAttribute("open");
  itemSeleccionado = null;
}
$("btn-cerrar-detalle").addEventListener("click", cerrarModal);
$("btn-cerrar-detalle-2").addEventListener("click", cerrarModal);
detalleDialog.addEventListener("click", (ev) => { if (ev.target === detalleDialog) cerrarModal(); });
detalleDialog.addEventListener("cancel", (ev) => { /* tecla Esc en desktop: dejar que <dialog> lo cierre solo */ itemSeleccionado = null; });

function mostrarModalStatus(texto, tipo) {
  const el = $("detalle-status");
  el.textContent = texto;
  el.className = `dialog-status mostrar ${tipo}`;
}

$("btn-preparar-wa").addEventListener("click", async () => {
  if (!itemSeleccionado) return;
  const { coleccion, id } = itemSeleccionado;
  const btn = $("btn-preparar-wa");
  btn.disabled = true;
  btn.textContent = "Verificando con el servidor…";
  mostrarModalStatus("Verificando la reserva con el servidor antes de preparar el mensaje…", "info");

  let snap;
  try {
    snap = await getDocFromServer(doc(db, coleccion, id));
  } catch (e) {
    btn.disabled = false;
    btn.innerHTML = `<svg class="icon"><use href="#i-whatsapp"/></svg> Preparar WhatsApp`;
    mostrarModalStatus("No se pudo verificar con el servidor (" + (e?.code || e?.message || "error") + "). Podés reintentar.", "error");
    return;
  }

  if (!snap.exists()) {
    mostrarModalStatus("Esta reserva ya no existe (fue eliminada). No se preparó ningún mensaje.", "error");
    btn.disabled = true; btn.textContent = "Reserva eliminada";
    return;
  }
  const fresco = normalizarItemAgenda(coleccion, id, snap.data());
  if (!fresco.activa) {
    mostrarModalStatus("Esta reserva fue cancelada. No se preparó ningún mensaje.", "error");
    btn.disabled = true; btn.textContent = "Reserva cancelada";
    return;
  }
  if (!fresco.telefono) {
    mostrarModalStatus("No hay teléfono registrado para esta reserva — no se puede abrir WhatsApp.", "error");
    btn.disabled = false; btn.innerHTML = `<svg class="icon"><use href="#i-whatsapp"/></svg> Preparar WhatsApp`;
    return;
  }

  abrirModal(`${coleccion}::${id}`); // refleja cualquier cambio (reprogramación) antes de armar el texto
  const numero = normalizarTelefonoWA(fresco.telefono);
  const texto = construirTextoConfirmacion(fresco);
  const url = `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
  mostrarModalStatus("Datos verificados con el servidor. Se abrió WhatsApp con el mensaje listo — vos decidís si lo enviás.", "info");
  window.open(url, "_blank", "noopener");
});

// ── Botón Atrás (solo dentro de la app Android) ──────────────────────────
// Prioridad: 1) cerrar el modal si está abierto  2) doble Atrás para salir
// desde la pantalla principal. En el navegador de escritorio no se toca el
// comportamiento nativo del botón Atrás.
if (nativeApp && AppPlugin?.addListener) {
  let ultimoAtras = 0;
  AppPlugin.addListener("backButton", () => {
    if (detalleDialog.open) { cerrarModal(); return; }
    const ahora = Date.now();
    if (ahora - ultimoAtras < 2200) { AppPlugin.exitApp(); return; }
    ultimoAtras = ahora;
    toast("Tocá de nuevo Atrás para salir");
  });

  // Al volver a primer plano, verificar de nuevo con el servidor antes de
  // que cualquier acción (p.ej. Preparar WhatsApp) asuma datos vigentes.
  AppPlugin.addListener("appStateChange", ({ isActive }) => {
    if (isActive) reconciliar();
  });
}
