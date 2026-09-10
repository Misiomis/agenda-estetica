// Mimar T Inteligente — app/página. Misma lógica de negocio que la v1 web
// (mimar-inteligente-logic.js, sin cambios), con una interfaz alineada a la
// identidad del Reloj Mimar T y comportamiento correcto dentro de la app
// Android (botón Atrás, retorno de segundo plano, sin listeners duplicados).
import {
  db, auth, collection, query, where, orderBy, limit, onSnapshot, doc, getDoc, getDocFromServer,
  setDoc, updateDoc, serverTimestamp,
  onAuthStateChanged, signInWithEmailAndPassword, signOut,
} from "./firebase-web.js";
import {
  ZONA_HORARIA, fechaISOEnZona, sumarDiasISO, normalizarItemAgenda, construirAgenda,
  obtenerProximaReserva, obtenerBandejaRevisiones, construirTextoConfirmacion, normalizarTelefonoWA,
  construirTextoRecordatorio, construirTextoCumpleanos, construirTextoConsulta, construirTextoKit,
  idContactoParaItem, estadoContacto, etiquetaEstadoContacto, contactoVencido,
} from "./mimar-inteligente-logic.js";
import {
  registrarContactoPreparado, registrarContactoEstado, registrarContactoManual,
} from "./contact-tracking.js";
import { verificarActualizacion } from "./update-check.js";

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
  pedidosKit: { estado: "cargando", error: null, fromCache: true, items: [] },
};

let unsubReservas = null;
let unsubConsultas = null;
let unsubPedidosKit = null;
let unsubActividad = null;
let unsubContactos = null;
let unsubCumpleanos = null;
let uidActual = null;
let tickInterval = null;
let itemSeleccionado = null;
let ultimaAgenda = [];
let ultimaSincronizacion = null;

// contactosWhatsApp cargados, indexados por id (coleccion_docId_tipoMensaje)
let contactosPorId = {};
// activityLog cargado (ya ordenado desc por el propio query)
let actividadItems = [];
// resumenesCumpleanos/{hoyISO} — null mientras no cargó, luego { estado, personas, generadoAt }
let cumpleanosHoy = null;
// { coleccion, id, tipoMensaje, nombre } — recién se abrió wa.me y se está
// esperando la respuesta de "¿Enviaste el mensaje?" al volver a la app.
let pendienteConfirmarEnvio = null;

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

$("btn-ajustes-notif").addEventListener("click", () => {
  window.Capacitor?.Plugins?.FcmPlugin?.openNotificationSettings?.();
});

// ── Actualización remota de la APK (punto 8) ─────────────────────────────
let manifestPendiente = null;

async function buscarActualizacion({ manual = false } = {}) {
  try {
    const resultado = await verificarActualizacion();
    if (!resultado) return; // no estamos en la app nativa
    if (resultado.hayActualizacion) {
      manifestPendiente = resultado.manifest;
      $("update-texto").textContent = `Nueva versión disponible (v${resultado.manifest.versionName || resultado.versionRemota})`;
      $("update-notas").textContent = resultado.manifest.notas || "";
      $("update-banner").hidden = false;
    } else if (manual) {
      toast("Ya tenés la última versión instalada.");
    }
  } catch (e) {
    if (manual) toast("No se pudo buscar actualizaciones: " + (e.message || "error de red"));
    else console.warn("buscarActualizacion:", e);
  }
}

$("btn-buscar-update").addEventListener("click", () => buscarActualizacion({ manual: true }));

$("btn-update-mas-tarde").addEventListener("click", () => { $("update-banner").hidden = true; });

$("btn-update-instalar").addEventListener("click", async () => {
  const UpdatePlugin = window.Capacitor?.Plugins?.UpdatePlugin;
  if (!UpdatePlugin || !manifestPendiente) return;
  const boton = $("btn-update-instalar");
  boton.disabled = true;
  boton.textContent = "Descargando…";
  try {
    await UpdatePlugin.downloadAndInstall({
      apkUrl: manifestPendiente.apkUrl,
      sha256: manifestPendiente.sha256 || ""
    });
    // A partir de acá Android muestra su propio instalador — la app puede
    // quedar en segundo plano mientras la persona confirma. Si la firma no
    // coincide con la instalada, el instalador del sistema lo va a explicar
    // (INSTALL_FAILED_UPDATE_INCOMPATIBLE), no esta pantalla.
    $("update-banner").hidden = true;
  } catch (e) {
    toast("No se pudo descargar la actualización: " + (e.message || e));
  } finally {
    boton.disabled = false;
    boton.textContent = "Actualizar";
  }
});

function mostrarAcceso(mensaje) {
  $("access-panel").hidden = false;
  $("workspace").hidden = true;
  $("btn-salir").hidden = true;
  $("btn-ajustes-notif").hidden = true;
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
  if (nativeApp && window.Capacitor?.Plugins?.FcmPlugin) $("btn-ajustes-notif").hidden = false;
  if (nativeApp && window.Capacitor?.Plugins?.UpdatePlugin) {
    $("btn-buscar-update").hidden = false;
    buscarActualizacion(); // chequeo silencioso al abrir — no molesta si no hay nada nuevo
  }

  if (uidActual !== user.uid) {
    uidActual = user.uid;
    iniciarSuscripciones();
    registrarTokenFcm();
  }
});

// ── Token FCM (punto 6) ──────────────────────────────────────────────────
// El token se pide y se sube a Firestore desde acá (WebView, ya autenticado
// con Firebase Auth) — el proceso nativo (FCMService.kt) no tiene su propia
// sesión de Firestore. Un id estable por instalación evita que un mismo
// admin con dos dispositivos se pise el token del otro.
function obtenerInstallId() {
  let id;
  try { id = localStorage.getItem("mimarInstallId"); } catch (_) {}
  if (!id) {
    id = "inst_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { localStorage.setItem("mimarInstallId", id); } catch (_) {}
  }
  return id;
}

async function registrarTokenFcm() {
  if (!nativeApp) return; // en navegador de escritorio no hay FCM nativo
  const FcmPlugin = window.Capacitor?.Plugins?.FcmPlugin;
  if (!FcmPlugin?.getToken) return;
  try {
    const permStatus = await FcmPlugin.requestNotificationPermission();
    if (permStatus?.notifications !== "granted") return;
    const { token } = await FcmPlugin.getToken();
    if (!token || !uidActual) return;
    const tokenDocId = `${uidActual}_inteligente_${obtenerInstallId()}`;
    await setDoc(doc(db, "deviceTokens", tokenDocId), {
      uid: uidActual, appId: "inteligente", token, platform: "android",
      updatedAt: serverTimestamp()
    }, { merge: true });
  } catch (e) { console.warn("No se pudo registrar el token FCM:", e); }
}

// ── Deep link desde una notificación tocada (punto 5) ────────────────────
// Si el item todavía no llegó por onSnapshot (recién se abrió la app),
// reintenta unas pocas veces en vez de fallar directo.
window.addEventListener("mimarDeepLink", (ev) => {
  const { coleccion, docId } = ev.detail || {};
  if (!coleccion || !docId || coleccion === "clients") return; // cumpleaños no tiene modal de detalle propio en v1
  let intentos = 0;
  const intentar = () => {
    const existe = coleccion === "pedidosKit"
      ? fuentes.pedidosKit.items.some((k) => k.id === docId)
      : ultimaAgenda.some((it) => it.coleccion === coleccion && it.id === docId);
    if (existe) { abrirModal(`${coleccion}::${docId}`); return true; }
    return false;
  };
  if (intentar()) return;
  const iv = setInterval(() => {
    intentos++;
    if (intentar() || intentos > 20) clearInterval(iv);
  }, 300);
});

// ── Suscripciones Firestore ──────────────────────────────────────────────
function detenerSuscripciones() {
  if (unsubReservas) { unsubReservas(); unsubReservas = null; }
  if (unsubConsultas) { unsubConsultas(); unsubConsultas = null; }
  if (unsubPedidosKit) { unsubPedidosKit(); unsubPedidosKit = null; }
  if (unsubActividad) { unsubActividad(); unsubActividad = null; }
  if (unsubContactos) { unsubContactos(); unsubContactos = null; }
  if (unsubCumpleanos) { unsubCumpleanos(); unsubCumpleanos = null; }
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

  // Pedidos de kit pendientes — los "entregado" ya no son una novedad activa.
  const qKits = query(collection(db, "pedidosKit"), where("estado", "==", "pendiente"));
  unsubPedidosKit = onSnapshot(qKits, { includeMetadataChanges: true },
    (snap) => manejarSnapshotKits(snap),
    (err) => manejarErrorFuente("pedidosKit", err));

  // Bandeja de actividad (punto 2) — últimos eventos, más nuevo primero.
  const qActividad = query(collection(db, "activityLog"), orderBy("timestamp", "desc"), limit(60));
  unsubActividad = onSnapshot(qActividad,
    (snap) => { const items = []; snap.forEach((d) => items.push({ id: d.id, ...d.data() })); actividadItems = items; renderActividad(); },
    (err) => { console.warn("activityLog:", err?.message || err); });

  // Estado real de contacto por WhatsApp (punto 3) — para no mostrar nunca
  // un turno como "confirmado" solo porque alguien abrió WhatsApp.
  unsubContactos = onSnapshot(collection(db, "contactosWhatsApp"),
    (snap) => { contactosPorId = {}; snap.forEach((d) => { contactosPorId[d.id] = d.data(); }); renderTodo(); },
    (err) => { console.warn("contactosWhatsApp:", err?.message || err); });

  // Cumpleaños de hoy (punto 4) — documento generado por la función programada.
  unsubCumpleanos = onSnapshot(doc(db, "resumenesCumpleanos", hoyISO),
    (snap) => { cumpleanosHoy = snap.exists() ? snap.data() : { estado: "no_generado" }; renderCumpleanos(); },
    (err) => { cumpleanosHoy = { estado: "error", detalle: err?.message || String(err) }; renderCumpleanos(); });

  tickInterval = setInterval(renderTodo, 1000); // el reloj y la cuenta regresiva necesitan tick fino
}

function manejarSnapshot(fuenteId, snap) {
  const items = [];
  snap.forEach((d) => items.push(normalizarItemAgenda(fuenteId, d.id, d.data())));
  fuentes[fuenteId] = { estado: "ok", error: null, fromCache: snap.metadata.fromCache, items };
  if (!snap.metadata.fromCache) ultimaSincronizacion = Date.now();
  renderTodo();
}

function manejarSnapshotKits(snap) {
  const items = [];
  snap.forEach((d) => {
    const data = d.data() || {};
    items.push({
      id: d.id,
      nombre: data.nombrePaciente || "Paciente",
      productos: Array.isArray(data.productos) ? data.productos : [],
      telefono: data.telefono || data.phone || null,
      dni: data.dni || null,
      fecha: data.fecha || null,
    });
  });
  fuentes.pedidosKit = { estado: "ok", error: null, fromCache: snap.metadata.fromCache, items };
  renderKits();
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

// El badge de conexión refleja específicamente la agenda núcleo (reservas +
// consultas, que alimentan el próximo turno y la bandeja de revisiones).
// pedidosKit/activityLog/cumpleaños tienen su propio indicador de carga en
// cada sección — no hace falta que una demora ahí tiña de "error" a toda la
// pantalla.
const FUENTES_CONEXION = ["reservas", "consultas"];

function renderConexion() {
  const fuentesNucleo = FUENTES_CONEXION.map((id) => fuentes[id]);
  const estados = fuentesNucleo.map((f) => f.estado);
  const conn = $("connection");
  const txt = $("connection-text");
  let estado = "live", texto = "Al día";
  if (typeof navigator !== "undefined" && navigator.onLine === false) { estado = "offline"; texto = "Sin conexión"; }
  else if (estados.includes("error")) { estado = "error"; texto = "Error de datos"; }
  else if (estados.includes("cargando")) { estado = "warning"; texto = "Sincronizando…"; }
  else if (fuentesNucleo.some((f) => f.fromCache)) { estado = "warning"; texto = "Verificando…"; }
  conn.setAttribute("data-state", estado);
  txt.textContent = texto;

  const errores = FUENTES_CONEXION.filter((id) => fuentes[id].estado === "error").map((id) => [id, fuentes[id]]);
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

// Plazo por defecto para marcar un contacto como "vencido" en pantalla —
// configurable a futuro desde configuracion/notificaciones; mientras tanto
// un valor fijo razonable (1h) documentado acá, no oculto en el HTML.
const PLAZO_CONTACTO_VENCIDO_MS = 60 * 60000;

function contactoDeItem(item, tipoMensaje = "confirmacion") {
  return contactosPorId[idContactoParaItem(item, tipoMensaje)] || null;
}

function pillEstadoContacto(item, ahoraMs) {
  const contacto = contactoDeItem(item);
  const estado = estadoContacto(contacto);
  const vencido = contactoVencido(item, contacto, PLAZO_CONTACTO_VENCIDO_MS, ahoraMs);
  const clase = estado === "enviado" ? "pill-ok" : vencido ? "pill-warn" : "pill-muted";
  const texto = estado === "enviado" ? "✓ Enviado" : estado === "preparado" ? "WhatsApp abierto" : estado === "no_enviado" ? "No enviado" : (vencido ? "⚠ Sin envío registrado" : "Pendiente de contacto");
  return `<span class="pill ${clase}" title="${escapeHtml(etiquetaEstadoContacto(estado))}">${escapeHtml(texto)}</span>`;
}

function tarjetaHtml(item, { conMotivos, ahoraMs = Date.now() } = {}) {
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
      ${pillEstadoContacto(item, ahoraMs)}
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

function renderKits() {
  const cont = $("lista-kits");
  if (!cont) return;
  if (fuentes.pedidosKit.estado === "cargando") {
    cont.innerHTML = `<div class="loading-state">Cargando…</div>`;
    return;
  }
  const items = fuentes.pedidosKit.items;
  $("count-kits").textContent = String(items.length);
  if (!items.length) {
    cont.innerHTML = `<div class="empty-state"><h3>Sin pedidos pendientes</h3><p>No hay kits esperando entrega.</p></div>`;
    return;
  }
  cont.innerHTML = items.map((k) => `
    <div class="item-row" data-item="pedidosKit::${k.id}">
      <div class="item-row-top"><span class="item-name">${escapeHtml(k.nombre)}</span></div>
      <div class="item-service">${escapeHtml(k.productos.join(", ") || "Sin detalle de productos")}</div>
      <div class="item-pills">
        ${k.telefono ? `<span class="pill pill-muted">📞 ${escapeHtml(k.telefono)}</span>` : `<span class="pill pill-warn">Sin teléfono</span>`}
      </div>
      <div class="item-actions"><button class="button button-light" data-abrir="pedidosKit::${k.id}" type="button">Ver detalle</button></div>
    </div>`).join("");
}

function renderCumpleanos() {
  const cont = $("lista-cumpleanos");
  if (!cont) return;
  if (!cumpleanosHoy) {
    cont.innerHTML = `<div class="loading-state">Cargando…</div>`;
    return;
  }
  if (cumpleanosHoy.estado === "error") {
    cont.innerHTML = `<div class="empty-state"><h3>No se pudo consultar</h3><p>${escapeHtml(cumpleanosHoy.detalle || "Error desconocido")}</p></div>`;
    $("count-cumpleanos").textContent = "?";
    return;
  }
  if (cumpleanosHoy.estado === "no_generado") {
    cont.innerHTML = `<div class="empty-state"><h3>Todavía no se generó el resumen de hoy</h3><p>Se genera automáticamente a la hora configurada.</p></div>`;
    $("count-cumpleanos").textContent = "—";
    return;
  }
  const personas = cumpleanosHoy.personas || [];
  $("count-cumpleanos").textContent = String(personas.length);
  if (!personas.length) {
    cont.innerHTML = `<div class="empty-state"><h3>No hay cumpleaños hoy</h3></div>`;
    return;
  }
  cont.innerHTML = personas.map((p) => {
    const num = normalizarTelefonoWA(p.telefonoDisponible ? p.telefono : "");
    const texto = construirTextoCumpleanos(p.nombre);
    const href = p.telefonoDisponible ? `https://wa.me/${escapeHtml(num)}?text=${encodeURIComponent(texto)}` : null;
    return `
    <div class="item-row">
      <div class="item-row-top"><span class="item-name">🎂 ${escapeHtml(p.nombre)}</span></div>
      <div class="item-pills">${p.telefonoDisponible ? "" : `<span class="pill pill-warn">Sin teléfono</span>`}</div>
      <div class="item-actions">
        ${href ? `<a class="button button-light" href="${href}" target="_blank" rel="noopener" data-preparar-cumple="${escapeHtml(p.clientId)}"><svg class="icon"><use href="#i-whatsapp"/></svg> Preparar saludo</a>` : ""}
      </div>
    </div>`;
  }).join("");
}

const ETIQUETA_TIPO_EVENTO = {
  reservas: "Reserva", consultas: "Consulta", pedidosKit: "Kit", clients: "Paciente",
  cursoMaquillaje: "Curso", reservasDepi: "Depilación",
};

function renderActividad() {
  const cont = $("lista-actividad");
  if (!cont) return;
  if (!actividadItems.length) {
    cont.innerHTML = `<div class="empty-state"><h3>Sin actividad todavía</h3><p>Acá van a aparecer las altas, bajas y cambios de Firestore a medida que ocurran.</p></div>`;
    return;
  }
  cont.innerHTML = actividadItems.map((ev) => {
    const leido = !!(ev.leidoPor && ev.leidoPor[uidActual]);
    const cuando = ev.timestamp?.toDate ? ev.timestamp.toDate() : null;
    const cuandoTxt = cuando ? new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: ZONA_HORARIA }).format(cuando) : "recién";
    return `
    <div class="item-row ${leido ? "" : "item-no-leido"}" data-evento="${escapeHtml(ev.id)}">
      <div class="item-row-top">
        <span class="pill pill-muted">${escapeHtml(ETIQUETA_TIPO_EVENTO[ev.coleccion] || ev.coleccion)}</span>
        <span class="item-time">${cuandoTxt}</span>
      </div>
      <div class="item-service">${escapeHtml(ev.resumen || "")}</div>
      <div class="item-actions">
        ${!ev.atendido ? `<button class="button button-light" data-atender="${escapeHtml(ev.id)}" type="button">Marcar atendido</button>` : `<span class="pill pill-ok">✓ Atendido</span>`}
      </div>
    </div>`;
  }).join("");
}

function renderConsultas(agenda) {
  const cont = $("lista-consultas");
  if (!cont) return;
  if (fuentes.consultas.estado === "cargando") {
    cont.innerHTML = `<div class="loading-state">Cargando…</div>`;
    return;
  }
  const items = agenda.filter((it) => it.coleccion === "consultas" && it.activa);
  $("count-consultas").textContent = String(items.length);
  if (!items.length) {
    cont.innerHTML = `<div class="empty-state"><h3>Sin consultas iniciales</h3><p>No hay consultas activas para hoy ni mañana.</p></div>`;
    return;
  }
  cont.innerHTML = items.map((it) => tarjetaHtml(it, { conMotivos: false })).join("");
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
  renderConsultas(ultimaAgenda);
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
  const esKit = coleccion === "pedidosKit";
  const item = esKit
    ? fuentes.pedidosKit.items.find((it) => it.id === id)
    : ultimaAgenda.find((it) => it.coleccion === coleccion && it.id === id);
  if (!item) { toast("Ya no se encuentra este registro."); return; }
  const tipoMensaje = esKit ? "kit" : coleccion === "consultas" ? "consulta" : "confirmacion";
  itemSeleccionado = { coleccion, id, tipoMensaje };
  $("detalle-titulo").textContent = item.nombre || "Sin nombre registrado";
  const statusEl = $("detalle-status");
  statusEl.className = "dialog-status";
  statusEl.textContent = "";
  $("btn-preparar-wa").disabled = false;
  $("btn-preparar-wa").innerHTML = `<svg class="icon"><use href="#i-whatsapp"/></svg> Preparar WhatsApp`;

  if (esKit) {
    $("detalle-body").innerHTML = `
      <div class="detail-row"><span>Productos</span><span>${escapeHtml(item.productos.join(", ") || "sin detalle")}</span></div>
      <div class="detail-row"><span>Teléfono</span><span>${item.telefono ? escapeHtml(item.telefono) : "sin registrar"}</span></div>
      <div class="detail-row"><span>Agenda</span><span>Pedido de kit</span></div>
    `;
  } else {
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
  }
  const contacto = esKit ? null : contactoDeItem(item, tipoMensaje);
  $("detalle-estado-contacto").textContent = etiquetaEstadoContacto(estadoContacto(contacto));
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

async function operadorActual() {
  const u = auth.currentUser;
  return u ? { uid: u.uid, email: u.email } : null;
}

$("btn-preparar-wa").addEventListener("click", async () => {
  if (!itemSeleccionado) return;
  const { coleccion, id, tipoMensaje } = itemSeleccionado;
  const btn = $("btn-preparar-wa");
  btn.disabled = true;
  btn.textContent = "Verificando con el servidor…";
  mostrarModalStatus("Verificando con el servidor antes de preparar el mensaje…", "info");

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
    mostrarModalStatus("Este registro ya no existe (fue eliminado). No se preparó ningún mensaje.", "error");
    btn.disabled = true; btn.textContent = "Eliminado";
    return;
  }

  let numero, texto, nombreDestino;
  if (coleccion === "pedidosKit") {
    const data = snap.data();
    if (!(data.telefono || data.phone)) {
      mostrarModalStatus("No hay teléfono registrado para este pedido — no se puede abrir WhatsApp.", "error");
      btn.disabled = false; btn.innerHTML = `<svg class="icon"><use href="#i-whatsapp"/></svg> Preparar WhatsApp`;
      return;
    }
    nombreDestino = data.nombrePaciente || "Paciente";
    numero = normalizarTelefonoWA(data.telefono || data.phone);
    texto = construirTextoKit(nombreDestino);
  } else {
    const fresco = normalizarItemAgenda(coleccion, id, snap.data());
    if (!fresco.activa) {
      mostrarModalStatus("Este registro fue cancelado. No se preparó ningún mensaje.", "error");
      btn.disabled = true; btn.textContent = "Cancelado";
      return;
    }
    if (!fresco.telefono) {
      mostrarModalStatus("No hay teléfono registrado — no se puede abrir WhatsApp.", "error");
      btn.disabled = false; btn.innerHTML = `<svg class="icon"><use href="#i-whatsapp"/></svg> Preparar WhatsApp`;
      return;
    }
    abrirModal(`${coleccion}::${id}`); // refleja cualquier cambio (reprogramación) antes de armar el texto
    nombreDestino = fresco.nombre;
    numero = normalizarTelefonoWA(fresco.telefono);
    texto = coleccion === "consultas" ? construirTextoConsulta(fresco) : construirTextoConfirmacion(fresco);
  }

  const url = `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;

  try {
    const operador = await operadorActual();
    await registrarContactoPreparado({ setDoc, doc, serverTimestamp, db, coleccion, docId: id, tipoMensaje, operador, versionDatos: snap.updateTime?.toMillis?.() || Date.now() });
  } catch (e) { console.warn("No se pudo registrar el contacto como preparado:", e); }

  pendienteConfirmarEnvio = { coleccion, id, tipoMensaje, nombre: nombreDestino };
  mostrarModalStatus("Datos verificados con el servidor. Se abrió WhatsApp con el mensaje listo — vos decidís si lo enviás.", "info");
  window.open(url, "_blank", "noopener");
});

// Registro manual de un envío hecho por fuera de este flujo (WhatsApp Web,
// otro teléfono, etc.). No lee WhatsApp ni infiere nada.
$("btn-registrar-manual")?.addEventListener("click", async () => {
  if (!itemSeleccionado) return;
  const { coleccion, id, tipoMensaje } = itemSeleccionado;
  try {
    const operador = await operadorActual();
    await registrarContactoManual({ setDoc, doc, serverTimestamp, db, coleccion, docId: id, tipoMensaje, operador, nota: "Registrado manualmente desde Mimar T Inteligente" });
    mostrarModalStatus("Envío registrado manualmente.", "info");
    toast("Confirmación marcada como enviada");
  } catch (e) {
    mostrarModalStatus("No se pudo registrar el envío manual.", "error");
  }
});

// ── Prompt "¿Enviaste el mensaje?" — no bloqueante ───────────────────────
function ocultarPromptEnvio() {
  const el = $("confirm-envio-banner");
  if (el) el.hidden = true;
}

function mostrarPromptEnvio() {
  if (!pendienteConfirmarEnvio) return;
  const el = $("confirm-envio-banner");
  if (!el) return;
  $("confirm-envio-texto").textContent = `¿Enviaste el mensaje a ${pendienteConfirmarEnvio.nombre}?`;
  el.hidden = false;
}

async function responderPromptEnvio(estado) {
  if (!pendienteConfirmarEnvio) return;
  const { coleccion, id, tipoMensaje, nombre } = pendienteConfirmarEnvio;
  if (estado === "mas_tarde") { ocultarPromptEnvio(); return; } // sigue "preparado", no se pierde el pendiente
  try {
    const operador = await operadorActual();
    await registrarContactoEstado({ setDoc, doc, serverTimestamp, db, coleccion, docId: id, tipoMensaje, estado, operador });
    toast(estado === "enviado" ? `Confirmación marcada como enviada (${nombre})` : `Registrado: no se envió (${nombre})`);
  } catch (e) {
    toast("No se pudo registrar el estado del envío");
  }
  pendienteConfirmarEnvio = null;
  ocultarPromptEnvio();
}
$("btn-confirmo-enviado")?.addEventListener("click", () => responderPromptEnvio("enviado"));
$("btn-confirmo-no-enviado")?.addEventListener("click", () => responderPromptEnvio("no_enviado"));
$("btn-confirmo-mas-tarde")?.addEventListener("click", () => responderPromptEnvio("mas_tarde"));

// ── Marcar novedad como atendida (bandeja de actividad) ──────────────────
// Nunca toca la reserva/consulta original — solo el propio evento.
document.addEventListener("click", async (ev) => {
  const btn = ev.target.closest("[data-atender]");
  if (!btn) return;
  const eventId = btn.getAttribute("data-atender");
  try {
    const operador = await operadorActual();
    await updateDoc(doc(db, "activityLog", eventId), {
      atendido: true,
      atendidoPor: operador?.email || operador?.uid || null,
      atendidoAt: serverTimestamp(),
    });
  } catch (e) { toast("No se pudo marcar como atendido"); }
});

// Preparar saludo de cumpleaños: registra el contacto igual que cualquier
// otro wa.me (mismo criterio, mismo seguimiento de estado).
document.addEventListener("click", async (ev) => {
  const link = ev.target.closest("[data-preparar-cumple]");
  if (!link) return;
  const clientId = link.getAttribute("data-preparar-cumple");
  try {
    const operador = await operadorActual();
    await registrarContactoPreparado({ setDoc, doc, serverTimestamp, db, coleccion: "clients", docId: clientId, tipoMensaje: "cumpleanos", operador });
    pendienteConfirmarEnvio = { coleccion: "clients", id: clientId, tipoMensaje: "cumpleanos", nombre: "esta persona" };
  } catch (e) { console.warn("No se pudo registrar el saludo de cumpleaños:", e); }
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
  // que cualquier acción (p.ej. Preparar WhatsApp) asuma datos vigentes, y
  // preguntar si quedó un mensaje por confirmar (punto 3).
  AppPlugin.addListener("appStateChange", ({ isActive }) => {
    if (isActive) {
      reconciliar();
      mostrarPromptEnvio();
    }
  });
} else {
  // En navegador de escritorio no hay appStateChange nativo — se usa
  // visibilitychange, que ya dispara reconciliar() más arriba.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") mostrarPromptEnvio();
  });
}

