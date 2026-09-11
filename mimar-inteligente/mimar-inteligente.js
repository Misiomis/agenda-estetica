// Mimar T Inteligente — app/página. Misma lógica de negocio que la v1 web
// (mimar-inteligente-logic.js), con una interfaz organizada en pestañas
// (Inicio / Actividad / Pendientes / Más) y comportamiento correcto dentro
// de la app Android (botón Atrás, panel inferior, retorno de segundo plano,
// sin listeners duplicados).
import {
  db, auth, collection, query, where, orderBy, limit, startAfter, onSnapshot, doc, getDoc, getDocs,
  getDocFromServer, setDoc, updateDoc, serverTimestamp,
  onAuthStateChanged, signInWithEmailAndPassword, signOut,
} from "./firebase-web.js";
import {
  ZONA_HORARIA, fechaISOEnZona, sumarDiasISO, normalizarItemAgenda, construirAgenda,
  obtenerProximaReserva, obtenerBandejaRevisiones, construirTextoConfirmacion, normalizarTelefonoWA,
  construirTextoRecordatorio, construirTextoCumpleanos, construirTextoConsulta, construirTextoKit,
  idContactoParaItem, estadoContacto, etiquetaEstadoContacto, contactoVencido,
  normalizarPedidoKit, formatearARS, estadoTemporalTurno, etiquetaEstadoTemporal,
  agruparPorDia, eventoCoincideFiltro, filtroEsNeutro, FILTRO_ACTIVIDAD_VACIO,
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
// activityLog: página reciente (viva, onSnapshot) + páginas más antiguas
// (estáticas, cargadas a pedido con "Cargar más antiguos"). Combinar ambas
// para tener la lista completa cargada — nunca se presenta como "el total"
// sin aclarar el alcance (punto 3).
const PAGINA_ACTIVIDAD = 40;
let actividadRecientes = [];
let actividadAntiguos = [];
let actividadCursor = null; // último doc crudo de Firestore, para paginar
let actividadHayMas = false;
let actividadCargandoMas = false;
let filtroActividad = { ...FILTRO_ACTIVIDAD_VACIO };
// resumenesCumpleanos/{hoyISO} — null mientras no cargó, luego { estado, personas, generadoAt }
let cumpleanosHoy = null;
// { coleccion, id, tipoMensaje, nombre } — recién se abrió wa.me y se está
// esperando la respuesta de "¿Enviaste el mensaje?" al volver a la app.
let pendienteConfirmarEnvio = null;

// ── Pestañas (Inicio / Actividad / Pendientes / Más) ─────────────────────
let tabActual = "inicio";
const scrollGuardadoPorTab = {};

// jsdom (pruebas E2E) no implementa scrollTo — en el navegador/WebView real
// siempre está disponible, pero esto evita que una prueba explote por algo
// que no tiene que ver con lo que está probando.
function scrollSeguro(y) { try { window.scrollTo(0, y || 0); } catch (_) {} }

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

// Tiles de resumen (Inicio) → navegan a la pestaña correspondiente y, si
// corresponde, dejan un filtro de categoría aplicado en Actividad.
document.querySelectorAll("[data-ir-tab]").forEach((btn) => {
  btn.addEventListener("click", () => {
    scrollGuardadoPorTab[tabActual] = window.scrollY;
    const destino = btn.getAttribute("data-ir-tab");
    const categoria = btn.getAttribute("data-ir-categoria");
    if (categoria) { filtroActividad = { ...FILTRO_ACTIVIDAD_VACIO, categoria }; renderActividad(); }
    mostrarTab(destino);
    const foco = btn.getAttribute("data-ir-foco");
    if (foco) {
      const el = $((foco === "revisiones" ? "bandeja-section" : foco === "kits" ? "kits-section" : "cumpleanos-section"));
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
});

// ── Panel inferior genérico (filtros / menús) ─────────────────────────────
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

const CATEGORIAS_FILTRO = [
  ["todas", "Todas"], ["reservas", "Reservas"], ["consultas", "Consultas"],
  ["pedidosKit", "Kits"], ["clients", "Pacientes"], ["cursoMaquillaje", "Curso"], ["reservasDepi", "Depilación"],
];

function abrirSheetFiltros() {
  const f = filtroActividad;
  const opciones = CATEGORIAS_FILTRO.map(([v, l]) => `<option value="${v}" ${f.categoria === v ? "selected" : ""}>${l}</option>`).join("");
  abrirSheet("Filtrar actividad", `
    <div class="sheet-field">
      <label for="filtro-categoria">Categoría</label>
      <select id="filtro-categoria">${opciones}</select>
    </div>
    <div class="sheet-field">
      <label for="filtro-estado">Estado</label>
      <select id="filtro-estado">
        <option value="todos" ${f.estado === "todos" ? "selected" : ""}>Todos</option>
        <option value="pendiente" ${f.estado === "pendiente" ? "selected" : ""}>Pendientes de atender</option>
        <option value="atendido" ${f.estado === "atendido" ? "selected" : ""}>Ya atendidos</option>
      </select>
    </div>
    <div class="sheet-field">
      <label for="filtro-desde">Desde (fecha)</label>
      <input id="filtro-desde" type="date" value="${f.fechaDesde || ""}">
    </div>
    <div class="sheet-field">
      <label for="filtro-hasta">Hasta (fecha)</label>
      <input id="filtro-hasta" type="date" value="${f.fechaHasta || ""}">
    </div>
    <div class="sheet-actions">
      <button class="button button-light" type="button" id="btn-filtro-restablecer">Restablecer</button>
      <button class="button button-primary" type="button" id="btn-filtro-aplicar">Aplicar</button>
    </div>
  `);
  $("btn-filtro-aplicar").addEventListener("click", () => {
    filtroActividad = {
      categoria: $("filtro-categoria").value,
      estado: $("filtro-estado").value,
      fechaDesde: $("filtro-desde").value || null,
      fechaHasta: $("filtro-hasta").value || null,
    };
    cerrarSheet();
    renderActividad();
  });
  $("btn-filtro-restablecer").addEventListener("click", () => {
    filtroActividad = { ...FILTRO_ACTIVIDAD_VACIO };
    cerrarSheet();
    renderActividad();
  });
}
$("btn-abrir-filtros").addEventListener("click", abrirSheetFiltros);

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
  $("bottom-nav").hidden = true;
  document.body.classList.remove("con-nav-inferior");
  $("btn-salir").hidden = true;
  $("btn-ajustes-notif").hidden = true;
  $("login-form").hidden = true;
  $("access-message").textContent = mensaje;
}

async function mostrarInfoVersion() {
  try {
    const info = await AppPlugin?.getInfo?.();
    if (info?.version) {
      $("version-footer").textContent = `Mimar T Inteligente · v${info.version} (build ${info.build}) · lectura de Firestore, contacto manual`;
      $("mas-info").textContent = `Versión instalada: ${info.version} (build ${info.build}). Contacto por WhatsApp siempre manual — abrir el chat no confirma un envío.`;
      return;
    }
  } catch (_) { /* no estamos en la app nativa o el plugin no respondió */ }
  $("version-footer").textContent = "Mimar T Inteligente · lectura de Firestore, contacto manual";
  $("mas-info").textContent = "Ejecutando en navegador (sin información de versión nativa). Contacto por WhatsApp siempre manual.";
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
  $("bottom-nav").hidden = false;
  document.body.classList.add("con-nav-inferior");
  mostrarTab("inicio");
  $("btn-salir").hidden = false;
  if (nativeApp && window.Capacitor?.Plugins?.FcmPlugin) $("btn-ajustes-notif").hidden = false;
  if (nativeApp && window.Capacitor?.Plugins?.UpdatePlugin) {
    $("btn-buscar-update").hidden = false;
    buscarActualizacion(); // chequeo silencioso al abrir — no molesta si no hay nada nuevo
  }
  mostrarInfoVersion();

  if (uidActual !== user.uid) {
    uidActual = user.uid;
    iniciarSuscripciones();
    registrarTokenFcm();
  }
});

// ── Token FCM (punto 6) ──────────────────────────────────────────────────
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

  // Bandeja de actividad (punto 2/4) — página más reciente, viva. El resto
  // de la historia se pagina a pedido con "Cargar más antiguos" (más abajo).
  actividadRecientes = []; actividadAntiguos = []; actividadCursor = null; actividadHayMas = false;
  const qActividad = query(collection(db, "activityLog"), orderBy("timestamp", "desc"), limit(PAGINA_ACTIVIDAD));
  unsubActividad = onSnapshot(qActividad,
    (snap) => {
      const items = [];
      snap.forEach((d) => items.push(convertirEventoActividad(d)));
      actividadRecientes = items;
      if (!actividadCursor && snap.docs.length) actividadCursor = snap.docs[snap.docs.length - 1];
      actividadHayMas = snap.docs.length === PAGINA_ACTIVIDAD; // puede haber más atrás de esta página
      renderActividad();
    },
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

function convertirEventoActividad(d) {
  const data = d.data();
  const cuando = data.timestamp?.toDate ? data.timestamp.toDate() : null;
  return { id: d.id, ...data, timestampMs: cuando ? cuando.getTime() : null };
}

async function cargarMasActividad() {
  if (actividadCargandoMas || !actividadHayMas || !actividadCursor) return;
  actividadCargandoMas = true;
  $("btn-cargar-mas").disabled = true;
  $("btn-cargar-mas").textContent = "Cargando…";
  try {
    const q = query(collection(db, "activityLog"), orderBy("timestamp", "desc"), startAfter(actividadCursor), limit(PAGINA_ACTIVIDAD));
    const snap = await getDocs(q);
    const items = [];
    snap.forEach((d) => items.push(convertirEventoActividad(d)));
    actividadAntiguos = actividadAntiguos.concat(items);
    if (snap.docs.length) actividadCursor = snap.docs[snap.docs.length - 1];
    actividadHayMas = snap.docs.length === PAGINA_ACTIVIDAD;
  } catch (e) {
    toast("No se pudo cargar actividad más antigua: " + (e.message || e));
  } finally {
    actividadCargandoMas = false;
    $("btn-cargar-mas").disabled = false;
    $("btn-cargar-mas").textContent = "Cargar más antiguos";
    renderActividad();
  }
}
$("btn-cargar-mas").addEventListener("click", cargarMasActividad);

function manejarSnapshot(fuenteId, snap) {
  const items = [];
  snap.forEach((d) => items.push(normalizarItemAgenda(fuenteId, d.id, d.data())));
  fuentes[fuenteId] = { estado: "ok", error: null, fromCache: snap.metadata.fromCache, items };
  if (!snap.metadata.fromCache) ultimaSincronizacion = Date.now();
  renderTodo();
}

function manejarSnapshotKits(snap) {
  const items = [];
  snap.forEach((d) => items.push(normalizarPedidoKit(d.id, d.data())));
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

// Plazo por defecto para marcar un contacto como "vencido" en pantalla.
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
  $("resumen-pendientes").textContent = String(bandeja.length);
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

  // "Consultas nuevas" en el resumen de Inicio: consultas activas de hoy/mañana.
  $("resumen-consultas").textContent = String(activos.filter((it) => it.coleccion === "consultas").length);
}

function kitTarjetaHtml(k) {
  // productosResumen (campo "productos") y items (derivado de
  // "productosDetalle") pueden faltar por separado — se usa el que haya,
  // nunca se descarta un dato disponible solo porque el otro campo falta.
  const resumen = k.productosResumen
    ? k.productosResumen.join(", ")
    : k.items ? k.items.map((it) => it.nombre).join(", ") : "Sin detalle de productos";
  return `
    <div class="item-row" data-item="pedidosKit::${k.id}">
      <div class="item-row-top"><span class="item-name">${escapeHtml(k.nombre)}</span><span class="pill pill-box">${escapeHtml(k.totalTexto)}</span></div>
      <div class="item-service">${escapeHtml(resumen)}</div>
      <div class="item-pills">
        ${k.telefono ? `<span class="pill pill-muted">📞 ${escapeHtml(k.telefono)}</span>` : `<span class="pill pill-warn">Sin teléfono</span>`}
        ${k.estadoPedido ? `<span class="pill pill-muted">${escapeHtml(k.estadoPedido)}</span>` : ""}
      </div>
      <div class="item-actions"><button class="button button-light" data-abrir="pedidosKit::${k.id}" type="button">Ver detalle</button></div>
    </div>`;
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
  $("resumen-kits").textContent = String(items.length);
  if (!items.length) {
    cont.innerHTML = `<div class="empty-state"><h3>Sin pedidos pendientes</h3><p>No hay kits esperando entrega.</p></div>`;
    return;
  }
  cont.innerHTML = items.map(kitTarjetaHtml).join("");
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
    $("resumen-cumpleanos").textContent = "?";
    return;
  }
  if (cumpleanosHoy.estado === "no_generado") {
    cont.innerHTML = `<div class="empty-state"><h3>Todavía no se generó el resumen de hoy</h3><p>Se genera automáticamente a la hora configurada.</p></div>`;
    $("count-cumpleanos").textContent = "—";
    $("resumen-cumpleanos").textContent = "—";
    return;
  }
  const personas = cumpleanosHoy.personas || [];
  $("count-cumpleanos").textContent = String(personas.length);
  $("resumen-cumpleanos").textContent = String(personas.length);
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

function eventoTarjetaHtml(ev) {
  const leido = !!(ev.leidoPor && ev.leidoPor[uidActual]);
  const cuandoTxt = ev.timestampMs
    ? new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: ZONA_HORARIA }).format(ev.timestampMs)
    : "fecha no registrada";
  const puedeAbrirDetalle = !!(ev.coleccion && ev.docId && ev.coleccion !== "clients");
  return `
  <div class="item-row ${leido ? "" : "item-no-leido"}" data-evento="${escapeHtml(ev.id)}">
    <div class="item-row-top">
      <span class="pill pill-muted">${escapeHtml(ETIQUETA_TIPO_EVENTO[ev.coleccion] || ev.coleccion)}</span>
      <span class="item-time">${cuandoTxt}</span>
    </div>
    <div class="item-service">${escapeHtml(ev.resumen || "")}</div>
    <div class="item-actions">
      ${puedeAbrirDetalle ? `<button class="button button-light" data-abrir="${escapeHtml(ev.coleccion)}::${escapeHtml(ev.docId)}" type="button">Ver detalle</button>` : ""}
      ${!ev.atendido ? `<button class="button button-light" data-atender="${escapeHtml(ev.id)}" type="button">Marcar atendido</button>` : `<span class="pill pill-ok">✓ Atendido</span>`}
    </div>
  </div>`;
}

function renderActividad() {
  const contHoy = $("lista-actividad-hoy");
  if (!contHoy) return;
  const combinados = actividadRecientes.concat(actividadAntiguos);
  const filtrados = combinados.filter((ev) => eventoCoincideFiltro(ev, filtroActividad));

  $("filtros-activos-badge").hidden = filtroEsNeutro(filtroActividad);

  const alcanceEl = $("actividad-alcance");
  const totalCargado = combinados.length;
  let alcanceTxt = `${totalCargado} evento${totalCargado === 1 ? "" : "s"} cargado${totalCargado === 1 ? "" : "s"} de la actividad más reciente`;
  if (!filtroEsNeutro(filtroActividad)) alcanceTxt += ` · ${filtrados.length} coincide${filtrados.length === 1 ? "" : "n"} con el filtro`;
  if (actividadHayMas) alcanceTxt += " · hay actividad más antigua sin cargar";
  alcanceEl.textContent = alcanceTxt;

  if (!filtrados.length) {
    contHoy.innerHTML = `<div class="empty-state"><h3>${combinados.length ? "Nada coincide con el filtro" : "Sin actividad todavía"}</h3><p>${combinados.length ? "Probá restablecer los filtros." : "Acá van a aparecer las altas, bajas y cambios de Firestore a medida que ocurran."}</p></div>`;
    $("grupo-ayer-wrap").hidden = true;
    $("grupo-anteriores-wrap").hidden = true;
    $("btn-cargar-mas").hidden = !actividadHayMas;
    return;
  }

  const grupos = agruparPorDia(filtrados);
  contHoy.innerHTML = grupos.hoy.length ? grupos.hoy.map(eventoTarjetaHtml).join("") : `<div class="empty-state"><h3>Sin actividad hoy</h3></div>`;

  $("grupo-ayer-wrap").hidden = !grupos.ayer.length;
  if (grupos.ayer.length) $("lista-actividad-ayer").innerHTML = grupos.ayer.map(eventoTarjetaHtml).join("");

  $("grupo-anteriores-wrap").hidden = !grupos.anteriores.length;
  if (grupos.anteriores.length) {
    $("lista-actividad-anteriores").innerHTML = grupos.anteriores.map(eventoTarjetaHtml).join("");
    $("conteo-anteriores").textContent = `(${grupos.anteriores.length})`;
  }
  $("btn-cargar-mas").hidden = !actividadHayMas;
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

  // Badge de la pestaña Pendientes: suma de todo lo que requiere acción.
  const totalPendientes = Number($("resumen-pendientes").textContent || 0)
    + Number($("resumen-kits").textContent || 0)
    + (Number($("resumen-cumpleanos").textContent) || 0);
  const badge = $("nav-badge-pendientes");
  if (totalPendientes > 0) { badge.hidden = false; badge.textContent = String(totalPendientes); }
  else badge.hidden = true;
}

// ── Delegación de clicks para abrir el detalle ───────────────────────────
document.addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-abrir]");
  if (btn) abrirModal(btn.getAttribute("data-abrir"));
});

// ── Modal de detalle + Preparar WhatsApp ────────────────────────────────
const detalleDialog = $("detalle-dialog");

function historialEventoHtml(ev) {
  const cuando = ev.timestampMs
    ? new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: ZONA_HORARIA }).format(ev.timestampMs)
    : "fecha no registrada";
  let cambio = "";
  if (ev.detalle?.fechaAnterior || ev.detalle?.horaAnterior) {
    cambio = `<div class="historial-evento-cambio">Antes: ${escapeHtml(ev.detalle.fechaAnterior || "—")} ${escapeHtml(ev.detalle.horaAnterior || "")}</div>`;
  } else if (ev.detalle?.motivo) {
    cambio = `<div class="historial-evento-cambio">Motivo registrado: ${escapeHtml(ev.detalle.motivo)}</div>`;
  }
  return `<div class="historial-evento"><div class="historial-evento-cuando">${cuando}</div><div>${escapeHtml(ev.resumen || "")}</div>${cambio}</div>`;
}

async function cargarHistorialEnDetalle(coleccion, id) {
  const cont = document.getElementById("historial-detalle-body");
  if (!cont) return;
  try {
    const snap = await getDocs(query(collection(db, "activityLog"), where("coleccion", "==", coleccion), where("docId", "==", id)));
    const eventos = [];
    snap.forEach((d) => eventos.push(convertirEventoActividad(d)));
    eventos.sort((a, b) => (b.timestampMs || 0) - (a.timestampMs || 0));
    const contActual = document.getElementById("historial-detalle-body");
    if (!contActual) return; // el modal se cerró mientras cargaba
    contActual.innerHTML = eventos.length
      ? eventos.map(historialEventoHtml).join("")
      : `<p class="hint-text">Sin eventos registrados todavía para este registro.</p>`;
  } catch (e) {
    const contActual = document.getElementById("historial-detalle-body");
    if (contActual) contActual.innerHTML = `<p class="hint-text">No se pudo cargar el historial (${escapeHtml(e.message || "error")}).</p>`;
  }
}

function prepararWaPreview({ visible, texto }) {
  $("wa-preview-wrap").hidden = !visible;
  $("btn-preparar-wa").hidden = !visible;
  if (visible) $("wa-preview-texto").value = texto || "";
}

// El caché en memoria (fuentes.pedidosKit, ultimaAgenda) solo cubre kits
// pendientes y reservas/consultas de hoy/mañana. Un evento de Actividad
// puede señalar un registro más viejo (o ya entregado/pasado) que no está
// en ese caché — sin este fallback, "Ver detalle" fallaría ahí como si el
// registro no existiera, aunque el documento siga en Firestore.
async function resolverItemFueraDeCache(coleccion, id) {
  try {
    const snap = await getDoc(doc(db, coleccion, id));
    if (!snap.exists()) return { existe: false };
    const data = snap.data();
    if (coleccion === "pedidosKit") return { existe: true, item: normalizarPedidoKit(id, data) };
    return { existe: true, item: normalizarItemAgenda(coleccion, id, data) };
  } catch (e) {
    return { existe: false, error: e?.message || String(e) };
  }
}

async function abrirModal(idAttr) {
  const [coleccion, id] = idAttr.split("::");
  const esKit = coleccion === "pedidosKit";
  let item = esKit
    ? fuentes.pedidosKit.items.find((it) => it.id === id)
    : ultimaAgenda.find((it) => it.coleccion === coleccion && it.id === id);
  let eliminado = false;
  if (!item) {
    const resuelto = await resolverItemFueraDeCache(coleccion, id);
    if (resuelto.existe) item = resuelto.item;
    else eliminado = true;
  }
  if (!item && !eliminado) { toast("No se pudo abrir este registro."); return; }
  if (eliminado) {
    // Se preserva el evento histórico (el historial se carga igual más
    // abajo) — solo se aclara que el registro original ya no existe, en
    // vez de fingir que nunca pasó nada o dejar la pantalla en blanco.
    itemSeleccionado = null;
    $("detalle-titulo").textContent = "Registro eliminado";
    $("detalle-eyebrow").textContent = esKit ? "PEDIDO DE KIT" : coleccion === "consultas" ? "CONSULTA INICIAL" : "RESERVA";
    $("detalle-status").className = "dialog-status";
    $("detalle-status").textContent = "";
    $("wa-preview-wrap").hidden = true;
    $("btn-preparar-wa").hidden = true;
    $("btn-registrar-manual").hidden = true;
    $("detalle-body").innerHTML = `
      <p class="hint-text">Este registro ya no existe en Firestore — puede haber sido eliminado. Se conserva su historial de actividad a continuación.</p>
      <div class="detalle-subtitulo">Qué ocurrió (historial)</div>
      <div id="historial-detalle-body"><p class="hint-text">Cargando historial…</p></div>
    `;
    cargarHistorialEnDetalle(coleccion, id);
    if (typeof detalleDialog.showModal === "function") detalleDialog.showModal();
    else detalleDialog.setAttribute("open", "");
    return;
  }
  scrollGuardadoPorTab[tabActual] = window.scrollY;
  const tipoMensaje = esKit ? "kit" : coleccion === "consultas" ? "consulta" : "confirmacion";
  itemSeleccionado = { coleccion, id, tipoMensaje, fechaOriginal: item.fecha || null, horaOriginal: item.hora || null };
  $("detalle-titulo").textContent = item.nombre || "Sin nombre registrado";
  $("detalle-eyebrow").textContent = esKit ? "PEDIDO DE KIT" : coleccion === "consultas" ? "CONSULTA INICIAL" : "RESERVA";
  const statusEl = $("detalle-status");
  statusEl.className = "dialog-status";
  statusEl.textContent = "";
  $("btn-preparar-wa").disabled = false;
  $("btn-preparar-wa").innerHTML = `<svg class="icon"><use href="#i-whatsapp"/></svg> Preparar WhatsApp`;
  $("btn-registrar-manual").hidden = true;

  if (esKit) {
    const filasItems = item.items
      ? item.items.map((it) => `<div class="detail-row"><span>${escapeHtml(it.nombre)} ${it.cantidad > 1 ? `×${it.cantidad}` : ""}</span><span>${it.subtotalCompleto ? escapeHtml(formatearARS(it.subtotal)) : "No registrado"}</span></div>`).join("")
      : `<div class="detail-row"><span>Productos</span><span>${item.productosResumen ? escapeHtml(item.productosResumen.join(", ")) : "Sin detalle registrado"}</span></div>`;
    const discrepanciaHtml = item.discrepanciaTotal
      ? `<div class="aviso-discrepancia">⚠ El total guardado (${escapeHtml(formatearARS(item.discrepanciaTotal.registrado))}) no coincide con la suma de sus productos (${escapeHtml(formatearARS(item.discrepanciaTotal.calculado))}). Señalado para revisión — no se corrigió solo.</div>`
      : "";
    $("detalle-body").innerHTML = `
      <div class="detalle-subtitulo">Productos pedidos</div>
      ${filasItems}
      ${discrepanciaHtml}
      <div class="detail-row"><span>Total del pedido</span><span>${escapeHtml(item.totalTexto)}</span></div>
      <div class="detail-row"><span>Monto abonado</span><span>${escapeHtml(item.montoAbonadoTexto)}</span></div>
      <div class="detail-row"><span>Saldo pendiente</span><span>${escapeHtml(item.saldoPendienteTexto)}</span></div>
      <div class="detail-row"><span>Fecha del pedido</span><span>${item.fechaPedido ? escapeHtml(item.fechaPedido) : "No registrada"}</span></div>
      <div class="detail-row"><span>Estado del pedido</span><span>${item.estadoPedido ? escapeHtml(item.estadoPedido) : "No registrado"}</span></div>
      ${item.entrega ? `<div class="detail-row"><span>Entrega</span><span>${escapeHtml(item.entrega)}</span></div>` : ""}
      ${item.observaciones ? `<div class="detail-row"><span>Observaciones</span><span>${escapeHtml(item.observaciones)}</span></div>` : ""}
      <div class="detail-row"><span>Teléfono</span><span>${item.telefono ? escapeHtml(item.telefono) : "sin registrar"}</span></div>
      <div class="detalle-subtitulo">Qué ocurrió (historial)</div>
      <div id="historial-detalle-body"><p class="hint-text">Cargando historial…</p></div>
    `;
    prepararWaPreview({ visible: !!item.telefono, texto: item.telefono ? construirTextoKit(item.nombre) : "" });
  } else {
    const box = boxLabel(item.box);
    const estTemporal = estadoTemporalTurno(item);
    $("detalle-body").innerHTML = `
      <div class="detalle-subtitulo">Estado actual</div>
      <div class="detail-row"><span>Fecha</span><span>${escapeHtml(item.fecha || "—")}</span></div>
      <div class="detail-row"><span>Hora</span><span>${escapeHtml(item.hora || "—")}</span></div>
      <div class="detail-row"><span>Servicio</span><span>${escapeHtml(item.servicio || "sin registrar")}</span></div>
      <div class="detail-row"><span>Duración</span><span>${item.duracionMinutos ? item.duracionMinutos + " min" : "estimada (60 min, no registrada)"}</span></div>
      <div class="detail-row"><span>Box</span><span>${box ? escapeHtml(box) : "no asignado"}</span></div>
      <div class="detail-row"><span>Teléfono</span><span>${item.telefono ? escapeHtml(item.telefono) : "sin registrar"}</span></div>
      <div class="detail-row"><span>Estado registrado</span><span>${escapeHtml(item.estadoBruto || "sin estado")}</span></div>
      <div class="detail-row"><span>Momento del turno</span><span>${escapeHtml(etiquetaEstadoTemporal(estTemporal))}</span></div>
      <div class="detail-row"><span>Agenda</span><span>${item.coleccion === "consultas" ? "Consultas iniciales" : "Reservas"}</span></div>
      <div class="detail-row"><span>Contacto WhatsApp</span><span id="detalle-estado-contacto">Pendiente de contacto</span></div>
      ${item.detalleSesion ? `<div class="detalle-subtitulo">Detalle registrado de la sesión</div><p class="hint-text" style="white-space:pre-line;">${escapeHtml(item.detalleSesion)}</p>` : (estTemporal === "pasado" ? `<p class="hint-text" style="margin-top:10px;">Turno pasado — sin detalle de sesión registrado. No se lo marca como realizado solo por la fecha.</p>` : "")}
      <div class="detalle-subtitulo">Qué ocurrió (historial)</div>
      <div id="historial-detalle-body"><p class="hint-text">Cargando historial…</p></div>
    `;
    const contacto = contactoDeItem(item, tipoMensaje);
    $("detalle-estado-contacto").textContent = etiquetaEstadoContacto(estadoContacto(contacto));
    const esPreparable = item.activa && !!item.telefono;
    prepararWaPreview({
      visible: esPreparable,
      texto: esPreparable ? (coleccion === "consultas" ? construirTextoConsulta(item) : construirTextoConfirmacion(item)) : "",
    });
    $("btn-registrar-manual").hidden = false;
  }
  cargarHistorialEnDetalle(coleccion, id);
  if (typeof detalleDialog.showModal === "function") detalleDialog.showModal();
  else detalleDialog.setAttribute("open", "");
}

function cerrarModal() {
  if (typeof detalleDialog.close === "function" && detalleDialog.open) detalleDialog.close();
  else detalleDialog.removeAttribute("open");
  itemSeleccionado = null;
  scrollSeguro(scrollGuardadoPorTab[tabActual]);
}
$("btn-cerrar-detalle").addEventListener("click", cerrarModal);
$("btn-cerrar-detalle-2").addEventListener("click", cerrarModal);
detalleDialog.addEventListener("click", (ev) => { if (ev.target === detalleDialog) cerrarModal(); });
detalleDialog.addEventListener("cancel", () => { itemSeleccionado = null; });

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
    texto = ($("wa-preview-texto").value || "").trim() || construirTextoKit(nombreDestino);
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
    // Solo se refresca (y se pisa la vista previa editada) si el turno de
    // verdad cambió de fecha/hora entre que se abrió el detalle y se tocó
    // este botón — una reprogramación real invalida cualquier texto editado
    // sobre la fecha vieja. Si nada cambió, se respeta lo que la operadora
    // haya editado en la vista previa.
    const reprogramada = fresco.fecha !== itemSeleccionado.fechaOriginal || fresco.hora !== itemSeleccionado.horaOriginal;
    if (reprogramada) abrirModal(`${coleccion}::${id}`);
    nombreDestino = fresco.nombre;
    numero = normalizarTelefonoWA(fresco.telefono);
    texto = ($("wa-preview-texto").value || "").trim() || (coleccion === "consultas" ? construirTextoConsulta(fresco) : construirTextoConfirmacion(fresco));
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
// otro wa.me (mismo criterio, mismo seguimiento de estado). Es un saludo
// genérico y fijo (no lleva montos ni fechas de turno), así que no necesita
// el paso de vista previa editable que sí exigen los mensajes con datos.
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
// Prioridad: 1) cerrar el panel inferior si está abierto  2) cerrar el modal
// si está abierto  3) doble Atrás para salir desde la pantalla principal.
if (nativeApp && AppPlugin?.addListener) {
  let ultimoAtras = 0;
  AppPlugin.addListener("backButton", () => {
    if (sheetAbierto) { cerrarSheet(); return; }
    if (detalleDialog.open) { cerrarModal(); return; }
    const ahora = Date.now();
    if (ahora - ultimoAtras < 2200) { AppPlugin.exitApp(); return; }
    ultimoAtras = ahora;
    toast("Tocá de nuevo Atrás para salir");
  });

  AppPlugin.addListener("appStateChange", ({ isActive }) => {
    if (isActive) {
      reconciliar();
      mostrarPromptEnvio();
    }
  });
} else {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") mostrarPromptEnvio();
  });
}
