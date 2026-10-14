// Mimar T Inteligente — pantalla única para quien atiende pacientes:
// próximo paciente (alarma inteligente), pedidos de kit facial y nuevos
// turnos de depilación. Comportamiento correcto dentro de la app Android
// (botón Atrás, retorno de segundo plano, sin listeners duplicados).
import {
  db, auth, collection, query, where, onSnapshot, doc, getDoc, getDocs,
  getDocFromServer, setDoc, updateDoc, serverTimestamp,
  onAuthStateChanged, signInWithEmailAndPassword, signOut,
} from "./firebase-web.js";
import {
  ZONA_HORARIA, fechaISOEnZona, sumarDiasISO, normalizarItemAgenda, construirAgenda,
  obtenerProximaReserva, normalizarTelefonoWA, validarYNormalizarTelefonoAR,
  construirTextoKit, estadoContacto,
  normalizarPedidoKit, formatearARS, normalizarReservaDepi,
  TIPO_MENSAJE_AVISO_DUENA, idAvisoDuena, docIdVersionadoParaAviso, construirTextoAvisoDuenaKit,
  agruparTurnosPorSeccion, agruparValoracion, ATENDIDO_POR_OPCIONES,
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
  reservasDepi: { estado: "cargando", error: null, fromCache: true, items: [] },
};

let unsubReservas = null;
let unsubConsultas = null;
let unsubPedidosKit = null;
let unsubReservasDepi = null;
let unsubContactos = null;
let uidActual = null;
let tickInterval = null;
let itemSeleccionado = null;
let ultimaAgenda = [];
// Alarma inteligente (próximo turno en curso): clave del turno ya
// "reconocido" por quien atiende — nunca se escribe a Firestore, es
// puramente una variable en memoria que se resetea sola en cuanto cambia
// el próximo turno (nuevo turno = nueva alarma, aunque el anterior ya se
// haya reconocido).
let alarmaReconocidaKey = null;
let ultimaProxKeyVista = null;
let ultimaSincronizacion = null;
// Fecha de hoy (zona AR) vigente desde el último login/reconexión — usada
// para clasificar los turnos en hoy/próximos/anteriores sin recalcular la
// zona horaria en cada render.
let hoyISOActual = null;
// Cuánto hacia atrás se trae para "Turnos anteriores" — solo visibilidad
// (ver/cargar detalle), nada de recordatorios ni avisos automáticos: no es
// la bandeja de Pendientes que se retiró, es un historial acotado y mudo.
const VENTANA_ANTERIORES_DIAS = 7;

// Qué secciones colapsables arrancan cerradas — el contador sigue visible
// igual; nunca se pierde información, solo se oculta la lista. Estado
// puramente de UI (no se persiste), se resetea sola al recargar la app.
const seccionesColapsadas = {
  "kits-section": false,
  "turnos-hoy-section": false,
  "turnos-proximos-section": true,
  "turnos-valoracion-section": true,
  "turnos-anteriores-section": true,
};

// contactosWhatsApp cargados, indexados por id (coleccion_docId_tipoMensaje)
let contactosPorId = {};
// clients indexados por dni (id del doc) — fallback de teléfono cuando la
// reserva/consulta se guardó con el campo vacío pero la ficha del cliente
// ya lo tiene (causa real encontrada en producción, caso Arenhardt Yamila:
// varias reservas con phone/telefono en "" mientras clients/{dni} sí tenía
// el número correcto). Se recarga en cada iniciarSuscripciones (login,
// reconexión) — no es un listener en vivo porque un cambio de teléfono no
// es algo que necesite reflejarse segundo a segundo.
let clientesPorDni = {};
// configuracion/mimarInteligente.{duenaTelefono,duenaNombre} — responsable
// del negocio (Gimena), compartido entre operadoras (misma colección/reglas
// que ya usa el resto del panel: lectura abierta, escritura solo admin).
// null mientras no cargó o no está configurado. duenaTelefono se guarda ya
// normalizado a dígitos wa.me (549...) — nunca el texto tal cual lo tipeó
// quien configuró, para que todo lector lo use igual sin renormalizar.
let duenaTelefono = null;
let duenaNombre = null;
let unsubConfigInteligente = null;
// Contexto del diálogo "Avisar a la dueña" actualmente abierto:
// { coleccion, docId, ocurrencia, idAviso, nombreEvento }
let avisoDuenaActual = null;
// { coleccion, id, docIdContacto, tipoMensaje, nombre } — recién se abrió
// wa.me y se está esperando la respuesta de "¿Enviaste el mensaje?" al
// volver a la app. docIdContacto es el id YA versionado por ocurrencia —
// se guarda resuelto en el momento de preparar el mensaje para no tener
// que recalcularlo (y quizás obtener otro valor) al confirmar más tarde.
let pendienteConfirmarEnvio = null;

// ── Pantalla única (Inicio) + Ajustes ────────────────────────────────────
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
    const destino = btn.getAttribute("data-tab-btn");
    mostrarTab(destino);
    // Puede haber cambiado desde que se entró (ej. volviendo de los
    // Ajustes nativos de notificaciones) — se refresca al entrar a Más,
    // nunca se asume "activado" de entrada.
    if (destino === "mas") refrescarEstadoNotif();
  });
});

// ── Secciones colapsables (Kits / Turnos de hoy / Próximos / Valoración /
// Anteriores) — solo oculta el list-panel vía CSS (data-colapsado en el
// section-block), nunca deja de renderizar sus datos por detrás.
document.addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-toggle-seccion]");
  if (!btn) return;
  const id = btn.getAttribute("data-toggle-seccion");
  const seccion = $(id);
  if (!seccion) return;
  const colapsado = !(seccionesColapsadas[id] ?? false);
  seccionesColapsadas[id] = colapsado;
  seccion.setAttribute("data-colapsado", String(colapsado));
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

// ── Indicador de permisos de notificación (punto 5) ──────────────────────
// SOLO lee el estado real (getPermissionStatus) — nunca pide permiso por el
// solo hecho de mostrar la pantalla, y nunca muestra "activadas" si el
// permiso real no está otorgado.
async function refrescarEstadoNotif() {
  const texto = $("estado-notif-texto");
  const btn = $("btn-activar-notif");
  if (!texto) return;
  const FcmPlugin = window.Capacitor?.Plugins?.FcmPlugin;
  if (!nativeApp || !FcmPlugin?.getPermissionStatus) {
    texto.textContent = "Ejecutando en el navegador — las notificaciones nativas no aplican acá.";
    if (btn) btn.hidden = true;
    return;
  }
  try {
    const { notifications } = await FcmPlugin.getPermissionStatus();
    if (notifications === "granted") {
      texto.textContent = "Notificaciones activadas.";
      if (btn) btn.hidden = true;
    } else {
      texto.textContent = "Notificaciones desactivadas — no vas a recibir avisos de kits nuevos ni de turnos de depilación.";
      if (btn) btn.hidden = false;
    }
  } catch (e) {
    texto.textContent = "No se pudo verificar el estado de las notificaciones.";
  }
}
$("btn-activar-notif")?.addEventListener("click", async () => {
  const FcmPlugin = window.Capacitor?.Plugins?.FcmPlugin;
  if (!FcmPlugin?.requestNotificationPermission) return;
  await FcmPlugin.requestNotificationPermission(); // único punto que PIDE el permiso, por una acción explícita
  await refrescarEstadoNotif();
  registrarTokenFcm(); // reintenta el registro del token ahora que puede haber permiso nuevo
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
  $("btn-ir-ajustes").hidden = true;
  $("btn-salir").hidden = true;
  $("btn-ajustes-notif").hidden = true;
  $("login-form").hidden = true;
  $("access-message").textContent = mensaje;
  // Limpia el estado al cerrar sesión — nada de esto debe reaparecer para
  // la próxima persona que entre en este mismo dispositivo.
  clientesPorDni = {};
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
  $("btn-ir-ajustes").hidden = false;
  mostrarTab("inicio");
  $("btn-salir").hidden = false;
  if (nativeApp && window.Capacitor?.Plugins?.FcmPlugin) $("btn-ajustes-notif").hidden = false;
  if (nativeApp && window.Capacitor?.Plugins?.UpdatePlugin) {
    $("btn-buscar-update").hidden = false;
    buscarActualizacion(); // chequeo silencioso al abrir — no molesta si no hay nada nuevo
  }
  mostrarInfoVersion();
  renderMas();

  if (uidActual !== user.uid) {
    uidActual = user.uid;
    iniciarSuscripciones();
    registrarTokenFcm();
  }
  consumirDeepLinkPendiente();
});

// Recupera un deep-link que haya llegado ANTES de que la sesión estuviera
// lista (arranque en frío) — ver comentario en MainActivity.kt/FcmPlugin.kt.
// Se llama en cada auth exitosa (no solo en el primer login) porque un
// deep-link puede llegar con la app ya abierta pero todavía sin sesión.
async function consumirDeepLinkPendiente() {
  const FcmPlugin = window.Capacitor?.Plugins?.FcmPlugin;
  if (!nativeApp || !FcmPlugin?.consumePendingDeepLink) return;
  try {
    const { coleccion, docId } = await FcmPlugin.consumePendingDeepLink();
    if (coleccion) despacharDeepLink(coleccion, docId);
  } catch (_) { /* sin deep-link pendiente o el plugin no respondió */ }
}

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

// ── Deep link desde una notificación tocada ──────────────────────────────
// Solo quedan dos avisos con push: "kit_nuevo" (pedidosKit) y
// "depilacion_nueva" (reservasDepi) — los únicos dos que corresponden a las
// 3 funciones de este panel.
function despacharDeepLink(coleccion, docId) {
  if (!coleccion || !docId) return;
  let intentos = 0;
  const intentar = () => {
    const existe = coleccion === "pedidosKit"
      ? fuentes.pedidosKit.items.some((k) => k.id === docId)
      : coleccion === "reservasDepi"
      ? fuentes.reservasDepi.items.some((r) => r.id === docId)
      : false;
    if (existe) { abrirModal(`${coleccion}::${docId}`); return true; }
    return false;
  };
  if (intentar()) return;
  const iv = setInterval(() => {
    intentos++;
    if (intentar() || intentos > 20) clearInterval(iv);
  }, 300);
}
window.addEventListener("mimarDeepLink", (ev) => {
  const { coleccion, docId } = ev.detail || {};
  despacharDeepLink(coleccion, docId);
});

// ── Suscripciones Firestore ──────────────────────────────────────────────
function detenerSuscripciones() {
  if (unsubReservas) { unsubReservas(); unsubReservas = null; }
  if (unsubConsultas) { unsubConsultas(); unsubConsultas = null; }
  if (unsubPedidosKit) { unsubPedidosKit(); unsubPedidosKit = null; }
  if (unsubReservasDepi) { unsubReservasDepi(); unsubReservasDepi = null; }
  if (unsubContactos) { unsubContactos(); unsubContactos = null; }
  if (unsubConfigInteligente) { unsubConfigInteligente(); unsubConfigInteligente = null; }
  if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
}

async function iniciarSuscripciones() {
  detenerSuscripciones(); // nunca dejar listeners duplicados, aunque se reintente

  const hoyISO = fechaISOEnZona();
  hoyISOActual = hoyISO;
  $("date-heading").textContent = fechaLindaHoy(hoyISO);

  // Fallback de teléfono por DNI (caso Arenhardt Yamila) — se recarga acá
  // porque esta función ya se llama en cada login/reconexión ("revalidación
  // al iniciar sesión, reabrir o recuperar conexión"). Colección acotada
  // (una ficha por cliente real, no crece con cada mensaje) — mismo criterio
  // que ya usa admin.html para el mismo cruce.
  try {
    const snapClientes = await getDocs(collection(db, "clients"));
    clientesPorDni = {};
    snapClientes.forEach((d) => { clientesPorDni[d.id] = d.data(); });
  } catch (e) {
    console.warn("clients (fallback de teléfono):", e?.message || e);
  }

  // Sin tope superior de fecha (las secciones "Próximos turnos"/"Turnos de
  // valoración" muestran cualquier turno futuro, no solo hoy/mañana) y con
  // un margen hacia atrás para poder armar "Turnos anteriores" — ver
  // VENTANA_ANTERIORES_DIAS. El próximo turno (obtenerProximaReserva) sigue
  // sin verse afectado: solo mira turnos con finMs futuro, sin importar
  // cuán ancha sea la ventana que se trajo.
  const desdeISO = sumarDiasISO(hoyISO, -VENTANA_ANTERIORES_DIAS);
  const qReservas = query(collection(db, "reservas"), where("fecha", ">=", desdeISO));
  unsubReservas = onSnapshot(qReservas, { includeMetadataChanges: true },
    (snap) => manejarSnapshot("reservas", snap),
    (err) => manejarErrorFuente("reservas", err));

  const qConsultas = query(collection(db, "consultas"), where("fecha", ">=", desdeISO));
  unsubConsultas = onSnapshot(qConsultas, { includeMetadataChanges: true },
    (snap) => manejarSnapshot("consultas", snap),
    (err) => manejarErrorFuente("consultas", err));

  // Pedidos de kit pendientes — los "entregado" ya no son una novedad activa.
  const qKits = query(collection(db, "pedidosKit"), where("estado", "==", "pendiente"));
  unsubPedidosKit = onSnapshot(qKits, { includeMetadataChanges: true },
    (snap) => manejarSnapshotKits(snap),
    (err) => manejarErrorFuente("pedidosKit", err));

  // Turnos de depilación — misma ventana hacia atrás que reservas/consultas,
  // sin tope hacia adelante.
  const qReservasDepi = query(collection(db, "reservasDepi"), where("fecha", ">=", desdeISO));
  unsubReservasDepi = onSnapshot(qReservasDepi, { includeMetadataChanges: true },
    (snap) => manejarSnapshotReservasDepi(snap),
    (err) => manejarErrorFuente("reservasDepi", err));

  // Estado real de contacto por WhatsApp (punto 3) — para no mostrar nunca
  // un turno como "confirmado" solo porque alguien abrió WhatsApp.
  unsubContactos = onSnapshot(collection(db, "contactosWhatsApp"),
    (snap) => { contactosPorId = {}; snap.forEach((d) => { contactosPorId[d.id] = d.data(); }); renderTodo(); },
    (err) => { console.warn("contactosWhatsApp:", err?.message || err); renderTodo(); });

  // Teléfono de la dueña para "Avisar a la dueña" — colección/reglas ya
  // existentes (lectura abierta, escritura solo admin), sin cambios de
  // seguridad. Compartido entre quien sea que use la app con la cuenta admin.
  unsubConfigInteligente = onSnapshot(doc(db, "configuracion", "mimarInteligente"),
    (snap) => {
      const data = snap.exists() ? snap.data() : {};
      duenaTelefono = data.duenaTelefono || null;
      duenaNombre = data.duenaNombre || null;
      renderMas();
    },
    (err) => { console.warn("configuracion/mimarInteligente:", err?.message || err); });

  tickInterval = setInterval(renderTodo, 1000); // el reloj y la cuenta regresiva necesitan tick fino
}

function convertirEventoActividad(d) {
  const data = d.data();
  const cuando = data.timestamp?.toDate ? data.timestamp.toDate() : null;
  return { id: d.id, ...data, timestampMs: cuando ? cuando.getTime() : null };
}


function manejarSnapshot(fuenteId, snap) {
  const items = [];
  snap.forEach((d) => items.push(normalizarItemAgenda(fuenteId, d.id, d.data(), clientesPorDni)));
  fuentes[fuenteId] = { estado: "ok", error: null, fromCache: snap.metadata.fromCache, items };
  if (!snap.metadata.fromCache) ultimaSincronizacion = Date.now();
  renderTodo();
}

function manejarSnapshotKits(snap) {
  const items = [];
  snap.forEach((d) => items.push(normalizarPedidoKit(d.id, d.data())));
  fuentes.pedidosKit = { estado: "ok", error: null, fromCache: snap.metadata.fromCache, items };
  renderTodo();
}

function manejarSnapshotReservasDepi(snap) {
  const items = [];
  snap.forEach((d) => items.push(normalizarReservaDepi(d.id, d.data())));
  items.sort((a, b) => (a.inicioMs ?? Infinity) - (b.inicioMs ?? Infinity));
  fuentes.reservasDepi = { estado: "ok", error: null, fromCache: snap.metadata.fromCache, items };
  renderTodo();
}

function manejarErrorFuente(fuenteId, err) {
  fuentes[fuenteId] = {
    estado: "error", error: err?.code || err?.message || "error desconocido",
    fromCache: true, items: fuentes[fuenteId]?.items || [],
  };
  renderTodo();
}

function renderTodo() {
  const ahoraMs = Date.now();
  ultimaAgenda = construirAgenda(fuentes.reservas.items, fuentes.consultas.items);
  renderReloj(ahoraMs);
  renderConexion();
  renderProximoTurno(ultimaAgenda, ahoraMs);
  renderKitsTab();
  renderTurnos();
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
  const panel = document.querySelector(".status-panel");
  if (fuentes.reservas.estado === "cargando" || fuentes.consultas.estado === "cargando") {
    body.innerHTML = `<p class="proximo-turno-vacio">Cargando…</p>`;
    countdownEl.textContent = "--:--";
    panel?.classList.remove("status-panel-urgente");
    return;
  }
  const prox = obtenerProximaReserva(agenda, ahoraMs);
  if (!prox) {
    body.innerHTML = `<p class="proximo-turno-vacio">No hay más turnos activos para hoy y mañana.</p>`;
    countdownEl.textContent = "—";
    panel?.classList.remove("status-panel-urgente");
    ultimaProxKeyVista = null;
    return;
  }

  // Alarma inteligente: el turno en curso es la "alarma" (sin sonido, solo
  // visual) hasta que se reconozca. Un turno nuevo (clave distinta) siempre
  // empieza sin reconocer, aunque el anterior ya lo estuviera.
  const key = `${prox.coleccion}_${prox.id}`;
  if (key !== ultimaProxKeyVista) {
    ultimaProxKeyVista = key;
    alarmaReconocidaKey = null;
  }

  const box = boxLabel(prox.box);
  const faltaMs = prox.inicioMs - ahoraMs;
  const urgente = faltaMs <= 0 && alarmaReconocidaKey !== key;
  body.innerHTML = `
    <div class="proximo-turno-nombre">${escapeHtml(prox.nombre || "Sin nombre registrado")}</div>
    <div class="proximo-turno-detalle">${escapeHtml(prox.fecha)} · ${escapeHtml(prox.hora || "—")} hs${prox.servicio ? " · " + escapeHtml(prox.servicio) : ""}</div>
    <div class="proximo-turno-pills">
      ${box ? `<span class="pill pill-box">${escapeHtml(box)}</span>` : `<span class="pill pill-on-dark">Box no asignado</span>`}
      ${!prox.telefono ? `<span class="pill pill-on-dark">Sin teléfono</span>` : ""}
    </div>
    ${urgente ? `<button class="button button-light btn-reconocer-alarma" type="button" data-reconocer-alarma="${escapeHtml(key)}">Reconocer aviso</button>` : ""}`;
  panel?.classList.toggle("status-panel-urgente", urgente);

  if (faltaMs <= 0) {
    countdownEl.textContent = "En curso";
  } else {
    const totalMin = Math.floor(faltaMs / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    countdownEl.textContent = h > 0 ? `${h} h ${pad2(m)} min` : `${m} min`;
  }
}

// Reconocer/silenciar la alarma: SOLO cambia esta variable en memoria y
// vuelve a renderizar — nunca escribe en Firestore ni toca el turno. Se
// resetea solo en cuanto cambia el próximo turno (ver renderProximoTurno).
document.getElementById("proximo-turno-body")?.addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-reconocer-alarma]");
  if (!btn) return;
  alarmaReconocidaKey = btn.getAttribute("data-reconocer-alarma");
  renderProximoTurno(ultimaAgenda, Date.now());
});

function formatoMomento(ms) {
  if (ms == null) return null;
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: ZONA_HORARIA }).format(ms);
}

// ── "Avisar a la dueña" (nuevo pedido) — lo sigue usando Kits ────────────
// Independiente de la tarea con la paciente (punto 2): un registro propio
// en contactosWhatsApp, tipoMensaje "aviso_dueña", que nunca toca ni lee el
// estado de contacto con la paciente. avisoDuenaRegistro guarda, por clave
// de render, los datos ya resueltos (coleccion/docId/ocurrencia/texto) para
// que el click solo tenga que leerlos — se repuebla en cada render.
let avisoDuenaRegistro = new Map();

function avisoDuenaPillHtml(coleccion, docId, ocurrencia) {
  const idAviso = idAvisoDuena(coleccion, docId, ocurrencia);
  const contacto = contactosPorId[idAviso];
  if (estadoContacto(contacto) === "enviado") {
    const ms = contacto?.enviadoAt?.toMillis ? contacto.enviadoAt.toMillis() : null;
    return `<span class="pill pill-ok">✓ Avisado a Gimena${ms ? " · " + escapeHtml(formatoMomento(ms)) : ""}</span>`;
  }
  return `<span class="pill pill-muted">Sin avisar a Gimena</span>`;
}

function avisarDuenaBtnHtml(key, coleccion, docId, ocurrencia, texto, nombreEvento) {
  avisoDuenaRegistro.set(key, { coleccion, docId, ocurrencia, texto, nombreEvento });
  return `<button class="button button-light" type="button" data-avisar-duena="${escapeHtml(key)}"><svg class="icon"><use href="#i-whatsapp"/></svg> Avisar a Gimena</button>`;
}

// "Nuevo" se deriva por tiempo desde la creación del registro — nunca se
// escribe nada a Firestore para marcarlo (ver mimar-inteligente-logic.js:
// normalizarPedidoKit/normalizarReservaDepi). Es independiente del estado
// real (pendiente/listo/entregado, o activa/cancelada): "leído" decae solo
// con el tiempo, "atendido" es el campo real del documento.
const VENTANA_NUEVO_MS = 6 * 3600000; // 6 horas
const esReciente = (ms) => ms != null && (Date.now() - ms) < VENTANA_NUEVO_MS;

function kitTarjetaHtml(kit) {
  const key = `kit_${kit.id}`;
  const estado = kit.estadoPedido || "pendiente";
  const claseEstado = estado === "entregado" ? "pill-ok" : estado === "listo" ? "pill-ok" : "pill-muted";
  return `
  <div class="item-row">
    <div class="item-row-top">
      ${esReciente(kit.fechaPedidoMs) ? '<span class="pill pill-nuevo">Nuevo</span>' : ""}
      <span class="pill ${claseEstado}">${escapeHtml(estado)}</span><span class="item-name">${escapeHtml(kit.nombre)}</span>
    </div>
    <div class="item-service">${escapeHtml(kit.items ? kit.items.map((it) => `${it.cantidad}× ${it.nombre}`).join(", ") : (kit.productosResumen || []).join(", ") || "Sin detalle")}</div>
    <div class="item-pills"><span class="pill pill-muted">${escapeHtml(kit.totalTexto)}</span>${kit.fechaPedido ? `<span class="pill pill-muted">${escapeHtml(kit.fechaPedido)}</span>` : ""}${avisoDuenaPillHtml("pedidosKit", kit.id, null)}</div>
    <div class="item-actions" style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="button button-primary" type="button" data-abrir="pedidosKit::${escapeHtml(kit.id)}">Ver pedido</button>
      ${avisarDuenaBtnHtml(key, "pedidosKit", kit.id, null, construirTextoAvisoDuenaKit(kit), kit.nombre)}
    </div>
  </div>`;
}

function renderKitsTab() {
  const cont = $("lista-kits");
  if (!cont) return;
  if (fuentes.pedidosKit.estado === "cargando") { cont.innerHTML = `<div class="loading-state">Cargando…</div>`; return; }
  if (fuentes.pedidosKit.estado === "error") { cont.innerHTML = `<div class="error-state">No se pudo consultar los pedidos de kit (${escapeHtml(fuentes.pedidosKit.error || "error desconocido")}).</div>`; return; }
  const items = fuentes.pedidosKit.items;
  $("count-kits").textContent = String(items.length);
  cont.innerHTML = !items.length
    ? `<div class="empty-state"><svg class="icon"><use href="#i-inbox"/></svg><h3>Sin pedidos de kit por atender</h3></div>`
    : items.map(kitTarjetaHtml).join("");
}

// ── Turnos (hoy / próximos / valoración / anteriores) ────────────────────
// Una sola tarjeta para reservas, consultas y depilación: "Cargar detalle"
// (reservas/consultas) escribe directo en detalleSesion/detalleSesion2,
// mismo campo que ya usa admin.html — se refleja en la agenda general sin
// ninguna colección nueva. Depilación es "Ver turno" (solo lectura +
// Atendida por). Las canceladas se siguen mostrando (pill "Cancelado"),
// nunca desaparecen en silencio.
function turnoCardHtml(it) {
  const esDepi = it.coleccion === "reservasDepi";
  const tieneNota = !esDepi && !!(it.detalleSesion && it.detalleSesion.trim());
  const tieneNota2 = !esDepi && it.duo && !!(it.detalleSesion2 && it.detalleSesion2.trim());
  const pillDetalle = esDepi ? null : it.duo
    ? (tieneNota && tieneNota2 ? "Con detalle (2)" : (tieneNota || tieneNota2) ? "Con detalle parcial" : "Sin detalle")
    : (tieneNota ? "Con detalle" : "Sin detalle");
  return `
  <div class="item-row">
    <div class="item-row-top">
      ${esDepi && esReciente(it.creadoMs) ? '<span class="pill pill-nuevo">Nuevo</span>' : ""}
      ${pillDetalle ? `<span class="pill ${tieneNota || tieneNota2 ? "pill-ok" : "pill-muted"}">${escapeHtml(pillDetalle)}</span>` : ""}
      ${it.duo ? '<span class="pill pill-box">Duo</span>' : ""}
      ${!it.activa ? '<span class="pill pill-warn">Cancelado</span>' : ""}
      ${it.atendidoPor ? `<span class="pill pill-atendido">Atendida por ${escapeHtml(it.atendidoPor)}</span>` : ""}
      <span class="item-name">${escapeHtml(it.nombre || "Sin nombre registrado")}</span>
    </div>
    <div class="item-service">${escapeHtml(it.fecha || "—")} · ${escapeHtml(it.hora || "—")} hs${it.servicio ? " · " + escapeHtml(it.servicio) : ""}</div>
    <div class="item-actions"><button class="button button-light" type="button" data-abrir="${escapeHtml(it.coleccion)}::${escapeHtml(it.id)}">${esDepi ? "Ver turno" : "Cargar detalle"}</button></div>
  </div>`;
}

function listaOVacia(items, iconId, mensajeVacio) {
  return !items.length
    ? `<div class="empty-state"><svg class="icon"><use href="#${iconId}"/></svg><h3>${escapeHtml(mensajeVacio)}</h3></div>`
    : items.map(turnoCardHtml).join("");
}

function renderTurnos() {
  const contHoy = $("lista-turnos-hoy");
  const contProximos = $("lista-turnos-proximos");
  const contValoracion = $("lista-turnos-valoracion");
  const contAnteriores = $("lista-turnos-anteriores");
  if (!contHoy || !contProximos || !contValoracion || !contAnteriores) return;

  const todosLosContenedores = [contHoy, contProximos, contValoracion, contAnteriores];
  const estados = [fuentes.reservas.estado, fuentes.consultas.estado, fuentes.reservasDepi.estado];
  if (estados.includes("cargando")) {
    todosLosContenedores.forEach((c) => { c.innerHTML = `<div class="loading-state">Cargando…</div>`; });
    return;
  }
  if (estados.every((e) => e === "error")) {
    todosLosContenedores.forEach((c) => { c.innerHTML = `<div class="error-state">No se pudo consultar los turnos.</div>`; });
    return;
  }

  const reservasItems = ultimaAgenda.filter((it) => it.coleccion === "reservas");
  const consultasItems = ultimaAgenda.filter((it) => it.coleccion === "consultas");
  const { hoy, proximos, anteriores } = agruparTurnosPorSeccion(reservasItems, fuentes.reservasDepi.items, hoyISOActual);
  const valoracion = agruparValoracion(consultasItems);

  $("count-turnos-hoy").textContent = String(hoy.length);
  $("count-turnos-proximos").textContent = String(proximos.length);
  $("count-turnos-valoracion").textContent = String(valoracion.length);
  $("count-turnos-anteriores").textContent = String(anteriores.length);

  contHoy.innerHTML = listaOVacia(hoy, "i-calendar", "Sin turnos para hoy");
  contProximos.innerHTML = listaOVacia(proximos, "i-calendar", "Sin próximos turnos registrados");
  contValoracion.innerHTML = listaOVacia(valoracion, "i-activity", "Sin turnos de valoración registrados");
  contAnteriores.innerHTML = listaOVacia(anteriores, "i-calendar", `Sin turnos en los últimos ${VENTANA_ANTERIORES_DIAS} días`);
}

// ── Diálogo "Avisar a la dueña" ──────────────────────────────────────────
const avisoDuenaDialog = $("aviso-duena-dialog");

function abrirAvisoDuena(key) {
  const ctx = avisoDuenaRegistro.get(key);
  if (!ctx) { toast("No se pudo preparar el aviso."); return; }
  avisoDuenaActual = ctx;
  $("aviso-duena-titulo").textContent = ctx.nombreEvento || "Aviso a Gimena";
  $("aviso-duena-texto").value = ctx.texto || "";
  $("aviso-duena-status").textContent = "";
  $("aviso-duena-status").className = "dialog-status";
  const idAviso = idAvisoDuena(ctx.coleccion, ctx.docId, ctx.ocurrencia);
  const yaAvisado = estadoContacto(contactosPorId[idAviso]) === "enviado";
  $("aviso-duena-ya-avisado").hidden = !yaAvisado;
  $("btn-aviso-duena-whatsapp").hidden = !duenaTelefono;
  if (typeof avisoDuenaDialog.showModal === "function") avisoDuenaDialog.showModal();
  else avisoDuenaDialog.setAttribute("open", "");
}

function cerrarAvisoDuena() {
  if (typeof avisoDuenaDialog.close === "function" && avisoDuenaDialog.open) avisoDuenaDialog.close();
  else avisoDuenaDialog.removeAttribute("open");
  avisoDuenaActual = null;
}
$("btn-cerrar-aviso-duena")?.addEventListener("click", cerrarAvisoDuena);
$("btn-aviso-duena-cerrar-2")?.addEventListener("click", cerrarAvisoDuena);
avisoDuenaDialog?.addEventListener("click", (ev) => { if (ev.target === avisoDuenaDialog) cerrarAvisoDuena(); });

async function registrarAvisoPreparado() {
  if (!avisoDuenaActual) return;
  const { coleccion, docId, ocurrencia } = avisoDuenaActual;
  const docIdAviso = docIdVersionadoParaAviso(docId, ocurrencia);
  try {
    const operador = await operadorActual();
    await registrarContactoPreparado({ setDoc, doc, serverTimestamp, db, coleccion, docId: docIdAviso, tipoMensaje: TIPO_MENSAJE_AVISO_DUENA, operador });
  } catch (e) { console.warn("No se pudo registrar el aviso a la dueña como preparado:", e); }
}

// Compartir/copiar: preferí Web Share (deja elegir cualquier chat, incluido
// un grupo) cuando está disponible; si no, copiar al portapapeles como
// respaldo universal (punto 3: "no supongas que un grupo permite mandar un
// mensaje precompletado" — nunca se arma un link de grupo).
async function compartirOCopiar(texto) {
  if (navigator.share) {
    try { await navigator.share({ text: texto }); return "compartido"; }
    catch (e) { if (e?.name === "AbortError") return "cancelado"; }
  }
  try { await navigator.clipboard.writeText(texto); return "copiado"; }
  catch (e) { return null; }
}

$("btn-aviso-duena-whatsapp")?.addEventListener("click", async () => {
  if (!avisoDuenaActual || !duenaTelefono) return;
  const texto = $("aviso-duena-texto").value || avisoDuenaActual.texto || "";
  await registrarAvisoPreparado();
  window.open(`https://wa.me/${normalizarTelefonoWA(duenaTelefono)}?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
});

$("btn-aviso-duena-compartir")?.addEventListener("click", async () => {
  if (!avisoDuenaActual) return;
  const texto = $("aviso-duena-texto").value || avisoDuenaActual.texto || "";
  await registrarAvisoPreparado();
  const resultado = await compartirOCopiar(texto);
  const el = $("aviso-duena-status");
  if (resultado === "compartido") { el.textContent = "Se abrió el selector para elegir el chat."; el.className = "dialog-status mostrar info"; }
  else if (resultado === "copiado") { el.textContent = "Mensaje copiado — pegalo en el chat de WhatsApp que corresponda."; el.className = "dialog-status mostrar info"; toast("Mensaje copiado"); }
  else if (resultado === "cancelado") { /* el usuario cerró el selector, no es un error */ }
  else { el.textContent = "No se pudo compartir ni copiar automáticamente — seleccioná el texto a mano."; el.className = "dialog-status mostrar error"; }
});

$("btn-aviso-duena-copiar")?.addEventListener("click", async () => {
  const texto = $("aviso-duena-texto").value || "";
  try {
    await navigator.clipboard.writeText(texto);
    toast("Mensaje copiado");
  } catch (e) {
    $("aviso-duena-texto").select();
    $("aviso-duena-status").textContent = "No se pudo copiar automáticamente — el texto ya quedó seleccionado para copiar a mano.";
    $("aviso-duena-status").className = "dialog-status mostrar error";
  }
});

// "Ya avisé a la dueña" — registro independiente del estado de la tarea
// (punto 5): nunca marca la consulta como confirmada, el kit como
// entregado ni el saludo como hecho — solo dice que la dueña ya lo sabe.
$("btn-aviso-duena-confirmar")?.addEventListener("click", async () => {
  if (!avisoDuenaActual) return;
  const { coleccion, docId, ocurrencia } = avisoDuenaActual;
  const docIdAviso = docIdVersionadoParaAviso(docId, ocurrencia);
  try {
    const operador = await operadorActual();
    await registrarContactoManual({ setDoc, doc, serverTimestamp, db, coleccion, docId: docIdAviso, tipoMensaje: TIPO_MENSAJE_AVISO_DUENA, operador, nota: "Avisado a Gimena desde Mimar T Inteligente" });
    toast("Registrado: ya avisaste a Gimena");
    cerrarAvisoDuena();
  } catch (e) {
    $("aviso-duena-status").textContent = "No se pudo registrar el aviso.";
    $("aviso-duena-status").className = "dialog-status mostrar error";
  }
});

document.addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-avisar-duena]");
  if (!btn) return;
  abrirAvisoDuena(btn.getAttribute("data-avisar-duena"));
});


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
    if (coleccion === "reservasDepi") return { existe: true, item: normalizarReservaDepi(id, data) };
    return { existe: true, item: normalizarItemAgenda(coleccion, id, data, clientesPorDni) };
  } catch (e) {
    return { existe: false, error: e?.message || String(e) };
  }
}

// Tres colecciones pueden abrirse acá: pedidosKit (con "Preparar
// WhatsApp"), reservasDepi (solo lectura — ver nota en la rama esDepi) y
// reservas/consultas (cargar detalle de la sesión — ver rama esSesion).
async function abrirModal(idAttr) {
  const [coleccion, id] = idAttr.split("::");
  const esKit = coleccion === "pedidosKit";
  const esDepi = coleccion === "reservasDepi";
  const esSesion = coleccion === "reservas" || coleccion === "consultas";
  let item = esKit
    ? fuentes.pedidosKit.items.find((it) => it.id === id)
    : esDepi
    ? fuentes.reservasDepi.items.find((it) => it.id === id)
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
    $("detalle-eyebrow").textContent = esKit ? "PEDIDO DE KIT" : esDepi ? "TURNO DE DEPILACIÓN" : "SESIÓN";
    $("detalle-status").className = "dialog-status";
    $("detalle-status").textContent = "";
    $("wa-preview-wrap").hidden = true;
    $("btn-preparar-wa").hidden = true;
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
  const tipoMensaje = esKit ? "kit" : esDepi ? "depilacion" : "sesion";
  itemSeleccionado = { coleccion, id, tipoMensaje, fechaOriginal: item.fecha || null, horaOriginal: item.hora || null };
  $("detalle-titulo").textContent = item.nombre || "Sin nombre registrado";
  $("detalle-eyebrow").textContent = esKit ? "PEDIDO DE KIT" : esDepi ? "TURNO DE DEPILACIÓN" : "SESIÓN";
  const statusEl = $("detalle-status");
  statusEl.className = "dialog-status";
  statusEl.textContent = "";
  $("btn-preparar-wa").disabled = false;
  $("btn-preparar-wa").innerHTML = `<svg class="icon"><use href="#i-whatsapp"/></svg> Preparar WhatsApp`;

  if (esDepi) {
    // Solo visibilidad + reflejo de estado — no se pide "Preparar WhatsApp"
    // para depilación en esta versión (no fue parte del pedido, a
    // diferencia de kits).
    $("detalle-body").innerHTML = `
      <div class="detalle-subtitulo">Datos del turno</div>
      <div class="detail-row"><span>Fecha</span><span>${escapeHtml(item.fecha || "—")}</span></div>
      <div class="detail-row"><span>Hora</span><span>${escapeHtml(item.hora || "—")}</span></div>
      <div class="detail-row"><span>Servicio</span><span>${escapeHtml(item.servicio || "sin registrar")}</span></div>
      <div class="detail-row"><span>Teléfono</span><span>${item.telefono ? escapeHtml(item.telefono) : "sin registrar"}</span></div>
      <div class="detail-row"><span>Estado registrado</span><span>${escapeHtml(item.estadoBruto || "sin estado")}</span></div>
      <div class="detail-row"><span>Activo</span><span>${item.activa ? "Sí" : "No — cancelado"}</span></div>
      ${atendidoPorSelectHtml(coleccion, id, item.atendidoPor)}
      <div class="detalle-subtitulo">Qué ocurrió (historial)</div>
      <div id="historial-detalle-body"><p class="hint-text">Cargando historial…</p></div>
    `;
    prepararWaPreview({ visible: false, texto: "" });
  } else if (esSesion) {
    // Cargar el detalle de la sesión (punto pedido explícitamente): el
    // mismo campo detalleSesion/detalleSesion2 que ya lee/escribe
    // admin.html sobre este mismo documento — guardarlo acá lo refleja de
    // inmediato en la agenda general, sin ninguna colección nueva.
    const duo = item.duo === true;
    $("detalle-body").innerHTML = `
      <div class="detalle-subtitulo">Datos del turno</div>
      <div class="detail-row"><span>Fecha</span><span>${escapeHtml(item.fecha || "—")}</span></div>
      <div class="detail-row"><span>Hora</span><span>${escapeHtml(item.hora || "—")}</span></div>
      <div class="detail-row"><span>Servicio</span><span>${escapeHtml(item.servicio || "sin registrar")}</span></div>
      <div class="detail-row"><span>Estado</span><span>${item.activa ? "Activo" : "Cancelado"}</span></div>
      <div class="detalle-subtitulo">Detalle de la sesión${duo ? " — Paciente 1" : ""}</div>
      <textarea id="detalle-sesion-texto" class="wa-preview-textarea" rows="5" placeholder="Qué se hizo en la sesión…">${escapeHtml(item.detalleSesion || "")}</textarea>
      <button class="button button-primary" type="button" id="btn-guardar-detalle-sesion" data-guardar-sesion="${escapeHtml(coleccion)}::${escapeHtml(id)}">Guardar detalle</button>
      ${duo ? `
      <div class="detalle-subtitulo">Detalle — ${escapeHtml(item.duoNombre2 || "Paciente 2")}</div>
      <textarea id="detalle-sesion2-texto" class="wa-preview-textarea" rows="5" placeholder="Qué se hizo en la sesión…">${escapeHtml(item.detalleSesion2 || "")}</textarea>
      <button class="button button-light" type="button" id="btn-guardar-detalle-sesion2" data-guardar-sesion2="${escapeHtml(coleccion)}::${escapeHtml(id)}">Guardar detalle — Paciente 2</button>
      ` : ""}
      ${atendidoPorSelectHtml(coleccion, id, item.atendidoPor)}
      <div class="detalle-subtitulo">Qué ocurrió (historial)</div>
      <div id="historial-detalle-body"><p class="hint-text">Cargando historial…</p></div>
    `;
    prepararWaPreview({ visible: false, texto: "" });
  } else {
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

// ── Guardar el detalle de la sesión (reservas/consultas) ─────────────────
// Escribe directo sobre detalleSesion/detalleSesion2 del documento real —
// el mismo campo que ya lee/escribe admin.html — así que no hace falta
// ningún paso extra para que la agenda general lo vea: es el mismo
// documento de Firestore.
document.addEventListener("click", async (ev) => {
  const btn = ev.target.closest("[data-guardar-sesion]");
  if (!btn) return;
  const [coleccion, id] = btn.getAttribute("data-guardar-sesion").split("::");
  const texto = ($("detalle-sesion-texto")?.value || "").trim();
  btn.disabled = true;
  try {
    await updateDoc(doc(db, coleccion, id), { detalleSesion: texto });
    mostrarModalStatus("Detalle guardado — ya se refleja en la agenda general.", "info");
    toast("Detalle de la sesión guardado");
  } catch (e) {
    mostrarModalStatus("No se pudo guardar: " + (e?.message || e), "error");
  } finally {
    btn.disabled = false;
  }
});

document.addEventListener("click", async (ev) => {
  const btn = ev.target.closest("[data-guardar-sesion2]");
  if (!btn) return;
  const [coleccion, id] = btn.getAttribute("data-guardar-sesion2").split("::");
  const texto = ($("detalle-sesion2-texto")?.value || "").trim();
  btn.disabled = true;
  try {
    await updateDoc(doc(db, coleccion, id), { detalleSesion2: texto });
    mostrarModalStatus("Detalle (paciente 2) guardado — ya se refleja en la agenda general.", "info");
    toast("Detalle de paciente 2 guardado");
  } catch (e) {
    mostrarModalStatus("No se pudo guardar: " + (e?.message || e), "error");
  } finally {
    btn.disabled = false;
  }
});

// ── "Atendida por" (reservas, consultas y depilación) ────────────────────
// Dato puramente informativo (punto 4 del pedido de mejoras): nunca toca
// fecha/hora/servicio/estado del turno, solo el campo atendidoPor del mismo
// documento. Se guarda apenas se elige (sin botón aparte) para que no haga
// falta un paso extra al cargar el detalle de la atención.
function atendidoPorSelectHtml(coleccion, id, valorActual) {
  const opciones = ATENDIDO_POR_OPCIONES.map((nombre) =>
    `<option value="${escapeHtml(nombre)}" ${valorActual === nombre ? "selected" : ""}>${escapeHtml(nombre)}</option>`
  ).join("");
  return `
  <div class="detalle-subtitulo">Atendida por</div>
  <select class="wa-preview-textarea" data-atendido-sel="${escapeHtml(coleccion)}::${escapeHtml(id)}">
    <option value="" ${!valorActual ? "selected" : ""}>Sin seleccionar</option>
    ${opciones}
  </select>`;
}

document.addEventListener("change", async (ev) => {
  const sel = ev.target.closest("[data-atendido-sel]");
  if (!sel) return;
  const [coleccion, id] = sel.getAttribute("data-atendido-sel").split("::");
  const valor = sel.value || null;
  sel.disabled = true;
  try {
    await updateDoc(doc(db, coleccion, id), { atendidoPor: valor });
    toast(valor ? `Atendida por: ${valor}` : "Se quitó quién atendió");
  } catch (e) {
    toast("No se pudo guardar: " + (e?.message || e));
  } finally {
    sel.disabled = false;
  }
});

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

  // Solo pedidosKit llega acá — depilación nunca muestra este botón
  // (prepararWaPreview visible:false en abrirModal).
  const data = snap.data();
  if (!(data.telefono || data.phone)) {
    mostrarModalStatus("No hay teléfono registrado para este pedido — no se puede abrir WhatsApp.", "error");
    btn.disabled = false; btn.innerHTML = `<svg class="icon"><use href="#i-whatsapp"/></svg> Preparar WhatsApp`;
    return;
  }
  const nombreDestino = data.nombrePaciente || "Paciente";
  const numero = normalizarTelefonoWA(data.telefono || data.phone);
  const texto = ($("wa-preview-texto").value || "").trim() || construirTextoKit(nombreDestino);
  const docIdContacto = id;

  const url = `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;

  try {
    const operador = await operadorActual();
    await registrarContactoPreparado({ setDoc, doc, serverTimestamp, db, coleccion, docId: docIdContacto, tipoMensaje, operador, versionDatos: snap.updateTime?.toMillis?.() || Date.now() });
  } catch (e) { console.warn("No se pudo registrar el contacto como preparado:", e); }

  pendienteConfirmarEnvio = { coleccion, id, docIdContacto, tipoMensaje, nombre: nombreDestino };
  mostrarModalStatus("Datos verificados con el servidor. Se abrió WhatsApp con el mensaje listo — vos decidís si lo enviás.", "info");
  window.open(url, "_blank", "noopener");
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
  const { coleccion, id, docIdContacto, tipoMensaje, nombre, esRecomendacion } = pendienteConfirmarEnvio;
  if (estado === "mas_tarde") { ocultarPromptEnvio(); return; } // sigue "preparado", no se pierde el pendiente
  try {
    const operador = await operadorActual();
    await registrarContactoEstado({ setDoc, doc, serverTimestamp, db, coleccion, docId: docIdContacto || id, tipoMensaje, estado, operador });
    // Una recomendación tiene su PROPIO campo de estado — confirmar el
    // envío real la cierra ahí (nunca por una marca genérica de otro
    // registro, y nunca automáticamente por el solo hecho de abrir
    // WhatsApp: esto solo corre después de la confirmación explícita).
    if (esRecomendacion && estado === "enviado") {
      await updateDoc(doc(db, "recomendacionesInteligente", id), { estado: "enviada", updatedAt: serverTimestamp() });
    }
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

function renderMas() {
  refrescarEstadoNotif();

  const nombreInput = $("duena-nombre-input");
  if (nombreInput && document.activeElement !== nombreInput) nombreInput.value = duenaNombre || "";
  const telInput = $("duena-telefono-input");
  if (telInput && document.activeElement !== telInput) telInput.value = duenaTelefono || "";
  const telEstado = $("duena-telefono-estado");
  if (telEstado) {
    if (duenaTelefono) {
      const v = validarYNormalizarTelefonoAR(duenaTelefono);
      telEstado.textContent = v.ok
        ? `Configurado: ${duenaNombre || "Gimena"} · ${v.mostrable} — "Avisar a Gimena" abre WhatsApp directo con este número.`
        : `Configurado con un valor que ya no es válido (${duenaTelefono}) — volvé a guardarlo.`;
    } else {
      telEstado.textContent = `Sin configurar — "Avisar a Gimena" va a ofrecer compartir/copiar el mensaje para que elijas el chat vos misma.`;
    }
  }
}

// Punto 9: valida y normaliza antes de guardar (nunca guarda tal cual lo
// tipeó quien lo configuró), muestra un error claro sin guardar nada si el
// número no cierra a un celular argentino válido, y deja registrado quién
// hizo el cambio (mismo criterio de trazabilidad que el resto del punto 8).
$("btn-duena-telefono-guardar")?.addEventListener("click", async () => {
  const nombre = ($("duena-nombre-input")?.value || "").trim();
  const valorTel = ($("duena-telefono-input")?.value || "").trim();
  const telEstado = $("duena-telefono-estado");

  if (!valorTel) {
    try {
      await setDoc(doc(db, "configuracion", "mimarInteligente"), { duenaTelefono: null, duenaNombre: nombre || null, actualizadoPor: (await operadorActual()) || "sistema", updatedAt: serverTimestamp() }, { merge: true });
      toast("Teléfono quitado" + (nombre ? ` (nombre "${nombre}" guardado)` : ""));
    } catch (e) { toast("No se pudo guardar: " + (e?.message || e)); }
    return;
  }

  const v = validarYNormalizarTelefonoAR(valorTel);
  if (!v.ok) {
    if (telEstado) telEstado.textContent = `❌ ${v.error}`;
    toast("Número inválido — no se guardó nada.");
    return;
  }
  try {
    const operador = await operadorActual();
    await setDoc(doc(db, "configuracion", "mimarInteligente"), {
      duenaTelefono: v.digitos, duenaNombre: nombre || duenaNombre || "Gimena",
      actualizadoPor: operador || "sistema", updatedAt: serverTimestamp(),
    }, { merge: true });
    toast(`Guardado: ${nombre || duenaNombre || "Gimena"} · ${v.mostrable}`);
  } catch (e) { toast("No se pudo guardar: " + (e?.message || e)); }
});

// ── Botón Atrás (solo dentro de la app Android) ──────────────────────────
// Prioridad: 1) cerrar el modal  2) doble Atrás para salir.
if (nativeApp && AppPlugin?.addListener) {
  let ultimoAtras = 0;
  AppPlugin.addListener("backButton", () => {
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
      if (tabActual === "mas") refrescarEstadoNotif(); // por si volvió de los Ajustes nativos
    }
  });
} else {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") mostrarPromptEnvio();
  });
}
