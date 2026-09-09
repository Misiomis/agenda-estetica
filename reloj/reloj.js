import { CONFIG } from "./config.js";
import {
  dayKey, nextDay, clockParts, prettyDay, normalizeBooking, compareBookings,
  cleanPreferences, dueEvents, eventsFor, upcomingGroup, countdown, visualStatus
} from "./motor.js";
import { AlarmLedger, Chime } from "./alarmas.js";

const $ = id => document.getElementById(id);
const demo = new URLSearchParams(location.search).get("demo") === "1";
const prefsKey = "mimar-reloj-preferencias-v1" + (demo ? "-demo" : "");
const chime = new Chime();
const AlarmPlugin = window.Capacitor?.Plugins?.AlarmPlugin;
const nativeApp = !!(window.Capacitor?.isNativePlatform?.());
let prefs = loadPreferences();
let sdk = null, ledger = null, user = null;
let enabled = false, busy = false, authEpoch = 0, feedEpoch = 0;
let lastTick = Date.now();
let feedDay = dayKey(), lastSync = null, boxLabels = {};
let dataUnsubscribers = [], labelUnsubscriber = null;
let raw = new Map(), sourceState = new Map(), bookings = [], pendingAlerts = [];
let wake = null, wakeRequest = false, installPrompt = null, toastTimer;
let nextSignature = "", listSignature = "", bannerSignature = "";
let demoInjection = null;
let notificationWindows = [];
let settingsSaveEpoch = 0;
let loadWatchdog = null;
const nodes = new Map();
const observedEvents = new Set();

// Ninguna llamada al puente nativo (Capacitor→Kotlin) tenía límite de tiempo:
// si una promesa nativa quedaba sin resolver (actividad recreada a mitad de
// una llamada, corrutina cancelada, etc.) todo lo que la esperaba con `await`
// quedaba esperando para siempre — un diálogo que nunca llega a abrirse, un
// botón que nunca se re-habilita. withTimeout() convierte ese "nunca" en un
// error visible y recuperable después de `ms`.
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout:" + label)), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); }
    );
  });
}

function loadPreferences() {
  try { return cleanPreferences(JSON.parse(localStorage.getItem(prefsKey) || "{}")); }
  catch { return cleanPreferences(); }
}
function savePreferences() {
  try { localStorage.setItem(prefsKey, JSON.stringify(prefs)); return true; }
  catch { toast("Los ajustes no se pudieron guardar. Se aplican hasta que cierres el reloj."); return false; }
}
function toast(message) {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  $("toast").hidden = false;
  toastTimer = setTimeout(() => { $("toast").hidden = true; }, 6500);
}
function el(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content != null) node.textContent = content;
  return node;
}
function setConnection(state, label) {
  $("connection").dataset.state = state;
  $("connection-text").textContent = label;
}
function setAccess(message, allowLogin = false) {
  $("access-panel").hidden = false;
  $("workspace").hidden = true;
  $("access-message").textContent = message;
  $("login-form").hidden = !allowLogin;
}
function sourceLabel(id) { return CONFIG.sources.find(s => s.id === id)?.label || id; }
function refreshConnection() {
  if (!user) return;
  if (demo) { setConnection("warning", "Demostración"); return; }
  const states = prefs.sources.map(s => [s, sourceState.get(s)]);
  let notice = "";
  const failures = states.filter(([, state]) => state?.kind === "error");
  const waiting = states.filter(([, state]) => !state || state.kind === "loading");
  const cached = states.filter(([, state]) => state?.kind === "cache");
  if (!navigator.onLine) {
    setConnection("offline", "Sin conexión");
    notice = "Sin conexión. Los avisos están pausados hasta poder verificar los cambios de la agenda.";
  } else if (failures.length) {
    setConnection("warning", "Conexión parcial");
    notice = "No se pudo leer: " + failures.map(([s]) => sourceLabel(s)).join(", ") +
      ". Los avisos de esas agendas están pausados. Revisá tu acceso o desactivalas en Ajustes.";
  } else if (waiting.length) {
    setConnection("warning", "Sincronizando");
  } else if (cached.length) {
    setConnection("warning", "Verificando agenda");
    notice = "Verificando las reservas con el servidor. Los avisos de las agendas pendientes de verificar están pausados.";
  } else {
    setConnection("live", "Agenda al día");
  }
  const invalid = [...raw.values()].flat().filter(r => !normalizeBooking(r.id, r.source, r.data)).length;
  if (invalid) notice += (notice ? " " : "") + invalid +
    " reserva(s) tienen fecha u hora inválida y necesitan revisión en la agenda.";
  if (notice !== bannerSignature) {
    bannerSignature = notice;
    $("data-notice").textContent = notice;
    $("data-notice").hidden = !notice;
  }
  if (lastSync) {
    const p = clockParts(lastSync);
    $("last-sync").textContent = "Última actualización recibida · " + p.hour + ":" + p.minute + ":" + p.second;
  }
}
function setAlarmUI() {
  $("alarm-button").setAttribute("aria-pressed", String(enabled));
  $("alarm-button-text").textContent = enabled ? "Pausar alarmas" : "Activar alarmas";
  $("alarm-state").dataset.active = String(enabled);
  $("alarm-state").replaceChildren(el("span", "status-dot"),
    document.createTextNode(enabled
      ? (nativeApp ? "Alarmas activas · funcionan aunque cierres la app"
        : prefs.volume === 0 ? "Avisos activos · volumen en cero"
        : chime.context?.state !== "running" ? "Audio pausado · tocá Probar sonido" : "Alarmas activas")
      : nativeApp ? "Alarmas en pausa" : "Sonido pendiente de activar"));
}
// Cierra un <dialog> y fuerza además un repintado normal por display: en al
// menos un dispositivo probado, cerrar sin gesto real del usuario (p. ej.
// desde el botón Atrás de Android, vía evaluateJavascript, o al volver de una
// actividad nativa como el selector de sonido) actualiza el DOM pero Chromium
// no repinta la "capa superior" del <dialog>: dialog.open pasa a false, pero
// se sigue viendo abierto. Por eso NO hay que cortar acá si dialog.open ya es
// false — si se cortara, un cierre anterior "atascado" (open ya en false pero
// aún visible) sería imposible de destrabar, porque cualquier intento
// posterior (la cruz, Atrás) volvería a leer open=false y no haría nada.
// Alternar display sí fuerza un repintado normal, sin depender de gesto.
function forceCloseDialog(dialog) {
  dialog.close();
  dialog.style.display = "none";
  requestAnimationFrame(() => { dialog.style.display = ""; });
}
function clearPending() {
  pendingAlerts = [];
  chime.stop();
  forceCloseDialog($("alarm-dialog"));
  $("alarm-items").replaceChildren();
  for (const notification of notificationWindows) notification.close();
  notificationWindows = [];
}
function stopData() {
  feedEpoch++;
  dataUnsubscribers.forEach(fn => fn());
  dataUnsubscribers = [];
  labelUnsubscriber?.();
  labelUnsubscriber = null;
  raw.clear(); sourceState.clear(); bookings = [];
  demoInjection = null;
}
function stopSession() {
  stopData();
  user = null; enabled = false;
  clearPending();
  releaseWake();
  forceCloseDialog($("settings-dialog"));
  nodes.clear();
  observedEvents.clear();
  $("schedule-list").replaceChildren();
  $("next-patients").replaceChildren();
  nextSignature = ""; listSignature = "";
  lastSync = null;
  $("last-sync").textContent = "Reloj de recepción";
  setAlarmUI();
}

async function connectFirebase() {
  if (location.protocol === "file:") {
    setAccess("Abrí el reloj desde el mismo sitio de la agenda, en /reloj/. Para probarlo en tu PC, usá un servidor local; no se abre haciendo doble clic en el archivo HTML.");
    setConnection("error", "Abrir desde la agenda");
    return;
  }
  try {
    // Reutiliza la MISMA instancia y versión del SDK que utiliza admin.html.
    // Nunca se incluyen .env, credenciales de servicio ni otra configuración.
    sdk = await import(new URL(CONFIG.firebaseModule, import.meta.url).href);
    const required = ["db", "auth", "collection", "query", "where", "onSnapshot", "onAuthStateChanged"];
    const missing = required.filter(name => !sdk[name]);
    if (missing.length) throw new Error("missing-exports:" + missing.join(", "));
    sdk.onAuthStateChanged(sdk.auth, async account => {
      const epoch = ++authEpoch;
      stopSession();
      if (!account) {
        setConnection("warning", "Ingresá a tu cuenta");
        setAccess("Usá la misma cuenta con la que administrás tu agenda.", !!sdk.signInWithEmailAndPassword);
        return;
      }
      setAccess("Verificando tu acceso…");
      try {
        const result = await account.getIdTokenResult();
        if (epoch !== authEpoch) return;
        if (!CONFIG.adminEmails.includes(result.claims.email)) {
          setConnection("error", "Cuenta sin acceso");
          setAccess("Esta cuenta no tiene acceso al reloj. Ingresá con la cuenta administradora de tu agenda.", !!sdk.signInWithEmailAndPassword);
          return;
        }
        user = account;
        ledger = new AlarmLedger(account.uid);
        $("access-panel").hidden = true;
        $("workspace").hidden = false;
        if (nativeApp && AlarmPlugin) {
          try {
            const native = await AlarmPlugin.getPrefs();
            enabled = !!native.alarmsEnabled;
            setAlarmUI();
          } catch { /* Se puede activar manualmente con el botón. */ }
        }
        subscribe();
      } catch {
        if (epoch !== authEpoch) return;
        setConnection("error", "No se pudo validar");
        setAccess("No pudimos verificar la sesión. Revisá la conexión e ingresá nuevamente.", !!sdk.signInWithEmailAndPassword);
      }
    }, () => {
      authEpoch++;
      stopSession();
      setConnection("error", "Sesión interrumpida");
      setAccess("Se interrumpió la sesión. Volvé a ingresar a la agenda.", !!sdk.signInWithEmailAndPassword);
    });
  } catch (error) {
    const missing = String(error.message).startsWith("missing-exports:")
      ? "\nFaltan estas exportaciones en el módulo compartido: " + error.message.slice(16) : "";
    setConnection("error", "Revisar instalación");
    setAccess("No se pudo cargar la conexión de la agenda. La carpeta reloj debe estar junto a admin.html y debe existir js/firebase-web.js." + missing);
  }
}

function subscribe() {
  stopData();
  clearTimeout(loadWatchdog);
  $("reload-data-button").hidden = true;
  if (!user) return;
  const epoch = feedEpoch;
  feedDay = dayKey();
  if (demo) {
    startDemo(epoch);
    return;
  }
  // Vigía de carga: si ninguna fuente salió nunca de "loading" (el primer
  // callback de onSnapshot no llegó ni con datos ni con error — se vio en la
  // práctica, no solo en teoría), no hay ningún otro aviso en pantalla y la
  // persona queda mirando "Buscando los próximos ingresos…" sin ninguna
  // salida más que cerrar y volver a abrir la app entera. Este botón ofrece
  // "Reintentar" sin necesidad de eso.
  clearTimeout(loadWatchdog);
  loadWatchdog = setTimeout(() => {
    if (epoch !== feedEpoch) return;
    const stillWaiting = prefs.sources.some(s => (sourceState.get(s)?.kind ?? "loading") === "loading");
    $("reload-data-button").hidden = !stillWaiting;
  }, 20000);
  if (sdk.doc) {
    labelUnsubscriber = sdk.onSnapshot(sdk.doc(sdk.db, "configuracion", "boxesLabels"), snapshot => {
      if (epoch !== feedEpoch) return;
      boxLabels = snapshot.exists() ? snapshot.data().boxes || {} : {};
      rebuild();
    }, () => { /* Los nombres explícitos de las reservas siguen disponibles. */ });
  }
  for (const source of prefs.sources) {
    sourceState.set(source, { kind: "loading" });
    // Dos días permiten avisar a las 23:55 por un ingreso a las 00:00.
    // Un único campo de filtro: aprovecha el índice automático de fecha.
    const query = sdk.query(sdk.collection(sdk.db, source),
      sdk.where("fecha", ">=", feedDay), sdk.where("fecha", "<=", nextDay(feedDay)));
    const unsub = sdk.onSnapshot(query, { includeMetadataChanges: true }, snapshot => {
      if (epoch !== feedEpoch || !user) return;
      const entries = [];
      snapshot.forEach(doc => entries.push({ id: doc.id, source, data: doc.data() }));
      raw.set(source, entries);
      sourceState.set(source, { kind: snapshot.metadata.fromCache ? "cache" : "live" });
      if (!snapshot.metadata.fromCache) lastSync = Date.now();
      rebuild();
    }, () => {
      if (epoch !== feedEpoch) return;
      sourceState.set(source, { kind: "error" });
      raw.delete(source);
      rebuild();
    });
    dataUnsubscribers.push(unsub);
  }
  rebuild();
}

async function startDemo(epoch) {
  const { demoBookings } = await import("./demo.js");
  if (epoch !== feedEpoch || !user) return;
  const entries = demoBookings();
  for (const source of prefs.sources) {
    raw.set(source, entries.filter(b => b.source === source));
    sourceState.set(source, { kind: "live" });
  }
  rebuild();
}
function rebuild() {
  bookings = [...raw.values()].flat()
    .map(r => normalizeBooking(r.id, r.source, r.data, boxLabels))
    .filter(Boolean).sort(compareBookings);
  if (demoInjection && prefs.sources.includes(demoInjection.source)) bookings.push(demoInjection);
  bookings.sort(compareBookings);
  nextSignature = ""; listSignature = "";
  pruneAlerts();
  renderNext(Date.now());
  renderList(Date.now());
  refreshConnection();
}
function readyBookings() {
  if (!demo && !navigator.onLine) return [];
  return bookings.filter(b => sourceState.get(b.source)?.kind === "live");
}
function isCurrentEvent(event, now = Date.now()) {
  const current = readyBookings().find(b => b.key === event.booking.key && b.start === event.booking.start);
  return current && current.state === "scheduled" &&
    eventsFor(current, prefs).some(e => e.key === event.key && e.due <= now);
}
function pruneAlerts() {
  const previous = pendingAlerts.length;
  pendingAlerts = pendingAlerts.filter(event => isCurrentEvent(event));
  if (previous && !pendingAlerts.length) clearPending();
  else if (pendingAlerts.length) renderAlerts();
}

function renderNext(now) {
  const group = upcomingGroup(bookings, now);
  const signature = JSON.stringify(group) + "|" + feedDay;
  if (signature !== nextSignature) {
    nextSignature = signature;
    const container = $("next-patients");
    container.replaceChildren();
    $("next-panel").dataset.multiple = String(group.length > 1);
    if (!group.length) {
      const waiting = [...sourceState.values()].some(s => s.kind === "loading");
      container.append(el("p", "empty-copy", waiting ? "Buscando los próximos ingresos…" : "Sin próximos ingresos en las agendas seleccionadas."));
      $("next-time").textContent = "—";
      $("next-label").textContent = "PRÓXIMO INGRESO";
    } else {
      const next = group[0];
      $("next-time").textContent = (next.date !== dayKey(now) ? "Mañana · " : "") + next.time;
      $("next-label").textContent = group.length > 1 ? "INGRESOS SIMULTÁNEOS" : "PRÓXIMO INGRESO";
      for (const booking of group) {
        const person = el("article", "next-person");
        person.append(el("h2", "", booking.name), el("p", "", booking.service), el("span", "box-chip", booking.box));
        container.append(person);
      }
    }
  }
  if (group.length) {
    const difference = group[0].start - now;
    $("countdown").textContent = difference <= 0 ? "Ahora" : countdown(difference);
    const people = group.reduce((sum, b) => sum + b.names.length, 0);
    $("countdown-caption").textContent = people === 1 ? "1 paciente por recibir" : people + " pacientes por recibir";
    $("next-caption").textContent = difference <= 0 ? "Llegó la hora programada" : "La agenda se actualiza automáticamente";
  } else {
    $("countdown").textContent = "—";
    $("countdown-caption").textContent = "Sin ingresos próximos";
    $("next-caption").textContent = "Se mostrarán aquí las nuevas reservas";
  }
}

function renderList(now) {
  const allToday = bookings.filter(b => b.date === dayKey(now));
  const filter = $("source-filter").value;
  const today = allToday.filter(b => filter === "all" || b.source === filter);
  const group = upcomingGroup(bookings, now);
  const nextKeys = new Set(group.map(b => b.key));
  const signature = JSON.stringify(today) + "|" + today.map(b => visualStatus(b, now)).join("|") + "|" + group.map(b => b.key).join("|");
  if (signature === listSignature) return;
  listSignature = signature;
  const list = $("schedule-list");
  const fragment = document.createDocumentFragment();
  const keep = new Set();
  for (const booking of today) {
    keep.add(booking.key);
    let row = nodes.get(booking.key);
    if (!row) {
      row = el("article", "booking-row");
      const info = el("div", "booking-info");
      info.append(el("div", "booking-name"), el("div", "booking-service"));
      row.append(el("time", "booking-time"), info, el("div", "booking-space"), el("span", "booking-status"));
      nodes.set(booking.key, row);
    }
    row.dataset.upcoming = String(nextKeys.has(booking.key));
    row.dataset.state = booking.state;
    row.querySelector(".booking-time").textContent = booking.time;
    row.querySelector(".booking-time").dateTime = booking.date + "T" + booking.time + ":00" + CONFIG.utcOffset;
    row.querySelector(".booking-name").textContent = booking.name;
    row.querySelector(".booking-service").textContent = booking.service;
    row.querySelector(".booking-space").textContent = booking.box;
    const status = visualStatus(booking, now);
    row.querySelector(".booking-status").textContent = status;
    row.querySelector(".booking-status").dataset.label = status;
    fragment.append(row);
  }
  for (const key of nodes.keys()) if (!keep.has(key)) nodes.delete(key);
  list.replaceChildren(fragment);
  $("day-count").textContent = String(today.length);
  $("empty-state").hidden = today.length > 0;
  $("empty-message").textContent = [...sourceState.values()].some(s => s.kind === "loading")
    ? "Estamos cargando la agenda." : "No hay reservas para este día y esta selección.";
  const upcoming = allToday.filter(b => b.state === "scheduled" && b.start > now).length;
  $("schedule-summary").textContent = allToday.length + " reservas hoy · " + upcoming + " por comenzar";
}

async function scanAlarms(now) {
  if (!enabled || !user || !ledger || busy) return;
  busy = true;
  const epoch = authEpoch;
  try {
    // Se revisa siempre la ventana de gracia completa: un snapshot recién
    // recibido o una reconexión puede traer un aviso cuyo instante ya pasó.
    // El registro atómico, no el intervalo del temporizador, evita duplicados.
    const candidates = dueEvents(readyBookings(), prefs, now).filter(e => !observedEvents.has(e.key));
    const claimed = [];
    for (const event of candidates) {
      if (!enabled || epoch !== authEpoch || !isCurrentEvent(event)) continue;
      const won = await ledger.claim(event.key, now);
      observedEvents.add(event.key);
      if (won) {
        if (enabled && epoch === authEpoch && isCurrentEvent(event)) claimed.push(event);
      }
    }
    if (claimed.length && enabled && epoch === authEpoch) showAlerts(claimed);
  } catch {
    enabled = false;
    chime.stop();
    releaseWake();
    setAlarmUI();
    toast("Alarmas pausadas: no se pudo guardar el registro local de avisos. Revisá el almacenamiento del navegador y volvé a activarlas.");
  } finally { busy = false; }
}

function renderAlerts() {
  const items = $("alarm-items");
  items.replaceChildren();
  $("alarm-title").textContent = pendingAlerts.some(e => e.kind === "start")
    ? "Es momento de recibir" : "Se acerca un ingreso";
  for (const event of pendingAlerts) {
    const current = bookings.find(b => b.key === event.booking.key) || event.booking;
    const item = el("div", "alarm-item");
    item.append(el("strong", "", current.name),
      el("p", "", current.service + " · " + current.box),
      el("p", "alarm-moment", (event.kind === "start" ? "Ingreso programado · " : "Próximo ingreso · ") + current.time));
    items.append(item);
  }
}
function showAlerts(events) {
  // Si llega el aviso de ingreso, sustituye el previo que quedó sin cerrar.
  for (const event of events) {
    pendingAlerts = pendingAlerts.filter(e => e.booking.key !== event.booking.key);
    pendingAlerts.push(event);
  }
  renderAlerts();
  // Un aviso de ingreso tiene prioridad: cierra cualquier otro panel abierto
  // para que no quede una capa superpuesta debajo del aviso.
  forceCloseDialog($("settings-dialog"));
  forceCloseDialog($("diagnostics-dialog"));
  if (!$("alarm-dialog").open) $("alarm-dialog").showModal();
  if (!chime.play(prefs, 2)) toast("El aviso está en pantalla. Tocá Probar sonido para volver a habilitar el audio.");
  if (prefs.notifications && "Notification" in window && Notification.permission === "granted") {
    try {
      // Sin nombres ni tratamientos en la pantalla de bloqueo del equipo.
      const notification = new Notification("Mimar T · Aviso de ingreso", {
        body: "Hay " + events.length + (events.length === 1 ? " reserva" : " reservas") +
          " con aviso a las " + events[0].booking.time + ". Abrí el reloj para ver los detalles.",
        icon: new URL("./icon-192.png", import.meta.url).href,
        tag: "mimar-reloj-" + events.map(e => e.key).join("-"),
        silent: true
      });
      notification.onclick = () => { window.focus(); notification.close(); };
      notificationWindows.push(notification);
    } catch { toast("Los avisos de escritorio no están disponibles. El aviso del reloj sigue activo."); }
  }
}

async function activateAlarms() {
  if (!user || !ledger) return;
  if (enabled) {
    enabled = false; clearPending(); releaseWake(); setAlarmUI();
    if (nativeApp && AlarmPlugin) AlarmPlugin.setPrefs({ alarmsEnabled: false }).catch(() => {});
    return;
  }
  const epoch = authEpoch;
  $("alarm-button").disabled = true;
  try {
    if (nativeApp && AlarmPlugin) {
      await activateNativeAlarms();
    } else {
      // Debe ejecutarse desde este clic, antes de cualquier petición a la base.
      await chime.unlock();
    }
    await ledger.open();
    if (epoch !== authEpoch || !user) return;
    ledger.prune();
    enabled = true;
    setAlarmUI();
    if (nativeApp) {
      toast("Alarmas activadas. Vas a recibir avisos aunque cierres la app.");
    } else {
      chime.play(prefs);
      requestWake();
      toast("Alarmas activadas. Dejá abierto el reloj y mantené la PC despierta.");
    }
    await scanAlarms(Date.now());
  } catch {
    toast("No se pudieron activar las alarmas. Permití el sonido y el almacenamiento del sitio, y volvé a intentarlo.");
  } finally { $("alarm-button").disabled = false; }
}

async function activateNativeAlarms() {
  await checkNativePermissions();
  await withTimeout(
    AlarmPlugin.setPrefs({ alarmsEnabled: true, advanceMinutes: prefs.advanceMinutes }),
    8000, "setPrefs-activate"
  );
}

// Revisa y pide, de a uno, los permisos que Android/Samsung necesitan para
// que la alarma suene con la pantalla apagada o la app cerrada.
async function checkNativePermissions() {
  const status = await withTimeout(AlarmPlugin.getPermissionStatus(), 8000, "getPermissionStatus");
  const pending = [];
  if (status.notifications !== "granted") {
    await withTimeout(AlarmPlugin.requestNotificationPermission(), 30000, "requestNotificationPermission").catch(() => {});
  }
  if (status.exactAlarm !== "granted") {
    await AlarmPlugin.requestExactAlarmPermission().catch(() => {});
    pending.push("\"Alarmas y recordatorios\"");
  }
  if (status.fullScreenIntent !== "granted") {
    await AlarmPlugin.requestFullScreenIntentPermission().catch(() => {});
    pending.push("\"Notificaciones emergentes\" (pantalla completa)");
  }
  if (!status.batteryUnrestricted) {
    await AlarmPlugin.requestIgnoreBatteryOptimizations().catch(() => {});
    pending.push("\"Sin restricciones\" de batería");
  }
  if (pending.length) {
    toast("Activá estos permisos para que suene con la pantalla apagada: " + pending.join(", ") + ".");
  }
  return status;
}

async function requestWake() {
  if (!enabled || !prefs.wakeLock || document.visibilityState !== "visible" ||
      !("wakeLock" in navigator) || wake || wakeRequest) return;
  wakeRequest = true;
  try {
    const sentinel = await navigator.wakeLock.request("screen");
    if (!enabled || !prefs.wakeLock || document.visibilityState !== "visible") {
      await sentinel.release(); return;
    }
    wake = sentinel;
    sentinel.addEventListener("release", () => { if (wake === sentinel) wake = null; });
  } catch { /* El ahorro de energía puede rechazar esta solicitud. */ }
  finally { wakeRequest = false; }
}
async function releaseWake() {
  const sentinel = wake; wake = null;
  if (sentinel) { try { await sentinel.release(); } catch { /* Ya liberado. */ } }
}
async function testSound(preferences = prefs) {
  try {
    await chime.unlock();
    chime.play(preferences);
    if (preferences.volume === 0) toast("El volumen está en cero. Subilo desde Ajustes.");
  } catch { toast("No se pudo reproducir el sonido. Revisá el volumen y los permisos de audio del navegador."); }
}
function fillSourceControls() {
  const previous = $("source-filter").value;
  $("source-filter").replaceChildren(new Option("Todas las agendas", "all"));
  for (const id of prefs.sources) $("source-filter").add(new Option(sourceLabel(id), id));
  if (prefs.sources.includes(previous)) $("source-filter").value = previous;
  $("source-options").replaceChildren();
  for (const source of CONFIG.sources) {
    const label = el("label", "check-field");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox"; checkbox.value = source.id;
    checkbox.checked = prefs.sources.includes(source.id);
    label.append(checkbox, el("span", "", source.label));
    $("source-options").append(label);
  }
}
function updateNotificationUI() {
  const permission = "Notification" in window ? Notification.permission : "unsupported";
  const active = prefs.notifications && permission === "granted";
  $("notification-button").textContent = active ? "Desactivar" : "Activar";
  $("notification-button").disabled = permission === "unsupported";
  $("notification-state").textContent = permission === "unsupported"
    ? "Este navegador no ofrece avisos de escritorio."
    : permission === "denied" ? "Bloqueados. Podés habilitarlos desde los permisos del sitio."
      : active ? "Activos. Muestran un aviso sin datos de pacientes." : "Opcionales. El navegador te pedirá permiso.";
}
const diagDateTimeFormatter = new Intl.DateTimeFormat("es-AR", {
  timeZone: CONFIG.timeZone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
});
function setDiagRow(id, ok, okText, badText) {
  const node = $(id);
  node.textContent = ok ? okText : badText;
  node.dataset.state = ok ? "ok" : "bad";
}
async function openDiagnostics() {
  $("diag-engine").textContent = nativeApp ? "Android nativo" : "Web (navegador)";
  // La ventana se abre YA, sin esperar al puente nativo. Antes, si alguna de
  // las llamadas nativas de refreshDiagnostics() no llegaba a resolver (una
  // corrutina cortada, la Activity recreada a mitad de la llamada), este
  // await nunca terminaba y el diálogo de Diagnóstico NUNCA llegaba a
  // mostrarse — no se veía "trabado adentro", directamente no abría.
  $("diagnostics-dialog").showModal();
  if (!nativeApp || !AlarmPlugin) return;
  await refreshDiagnostics();
}
async function refreshDiagnostics() {
  if (!nativeApp || !AlarmPlugin) return;
  $("diag-refresh").disabled = true;
  $("diag-sync-error").hidden = true;
  try {
    const [status, native, scheduled] = await withTimeout(Promise.all([
      AlarmPlugin.getPermissionStatus(),
      AlarmPlugin.getPrefs(),
      AlarmPlugin.getScheduled()
    ]), 8000, "diagnostics");
    setDiagRow("diag-perm-notifications", status.notifications === "granted", "Concedido", "Denegado");
    setDiagRow("diag-perm-exact", status.exactAlarm === "granted", "Concedido", "Denegado");
    setDiagRow("diag-perm-fsi", status.fullScreenIntent === "granted", "Concedido", "Denegado");
    setDiagRow("diag-perm-battery", !!status.batteryUnrestricted, "Sin restricciones", "Restringida (puede matar la alarma)");

    $("diag-last-sync").textContent = native.lastSyncMs
      ? diagDateTimeFormatter.format(native.lastSyncMs) + " · " + native.lastSyncScheduledCount + " alarma(s) programadas" +
        (native.lastSyncCancelledStaleCount ? " · " + native.lastSyncCancelledStaleCount + " canceladas por reserva borrada" : "")
      : "Todavía no sincronizó";
    if (native.lastSyncError) {
      $("diag-sync-error").hidden = false;
      $("diag-sync-error").textContent = "Último error de sincronización: " + native.lastSyncError;
    } else {
      $("diag-sync-error").hidden = true;
    }

    const list = $("diag-alarms-list");
    // getScheduled() nativo ahora trae SCHEDULED + lo tocado en las últimas
    // 24h (CANCELLED/FIRED/DISMISSED/SNOOZED) — así se puede comprobar POR
    // QUÉ una alarma ya no está, no solo cuáles siguen vigentes.
    const STATUS_LABEL = { SCHEDULED: "Programada", CANCELLED: "Cancelada", FIRED: "Sonó", DISMISSED: "Detenida", SNOOZED: "Pospuesta" };
    const alarms = (scheduled.alarms || []).slice().sort((a, b) => (b.updatedAt || b.fireAtMs) - (a.updatedAt || a.fireAtMs));
    const VISIBLE_LIMIT = 20;
    if (!alarms.length) {
      list.replaceChildren(el("p", "empty-copy", native.alarmsEnabled
        ? "No hay alarmas programadas todavía. Si acabás de activar, esperá unos segundos y tocá Actualizar."
        : "Las alarmas están pausadas."));
    } else {
      const rows = alarms.slice(0, VISIBLE_LIMIT).map(a => {
        const row = el("div", "diag-alarm-row");
        row.dataset.status = a.status;
        const label = (a.type === "advance" ? "Aviso previo · " : "Ingreso · ") + a.patientName;
        const statusTxt = STATUS_LABEL[a.status] || a.status;
        row.append(
          el("span", "diag-alarm-time", diagDateTimeFormatter.format(a.fireAtMs)),
          el("span", "diag-alarm-info", label + (a.box ? " · " + a.box : "") + " · " + statusTxt)
        );
        return row;
      });
      if (alarms.length > VISIBLE_LIMIT) {
        rows.push(el("p", "empty-copy", "Y " + (alarms.length - VISIBLE_LIMIT) + " más (" + alarms.length + " en total)."));
      }
      list.replaceChildren(...rows);
    }
  } catch (error) {
    $("diag-sync-error").hidden = false;
    $("diag-sync-error").textContent = String(error?.message || "").startsWith("timeout:")
      ? "El estado nativo tardó demasiado en responder. Tocá Actualizar para reintentar."
      : "No se pudo leer el estado nativo. Tocá Actualizar para reintentar.";
  } finally { $("diag-refresh").disabled = false; }
}

async function openSettings() {
  $("advance-minutes").value = String(prefs.advanceMinutes);
  $("at-start").checked = prefs.atStart;
  $("volume").value = String(Math.round(prefs.volume * 100));
  $("volume-output").textContent = $("volume").value + " %";
  $("tone").value = prefs.tone;
  $("wake-lock").checked = prefs.wakeLock;
  $("settings-error").textContent = "";
  fillSourceControls();
  if (nativeApp && AlarmPlugin) {
    $("notification-setting").hidden = true;
    $("tone-field").hidden = true;
    $("volume-field").hidden = true;
    $("alarm-mode-field").hidden = false;
    $("alarm-sound-field").hidden = false;
    $("permissions-field").hidden = false;
    $("settings-note").textContent = "Las alarmas se guardan en este dispositivo y suenan aunque cierres la app.";
    try {
      const native = await AlarmPlugin.getPrefs();
      $("alarm-mode").value = native.alarmMode || "sound_vibration";
      $("alarm-sound-label").textContent = native.alarmSoundLabel || "Predeterminado del sistema";
    } catch { /* Se guardan los valores por defecto. */ }
  } else {
    updateNotificationUI();
  }
  $("settings-dialog").showModal();
}

function tick() {
  const now = Date.now();
  const time = clockParts(now);
  $("clock-main").textContent = time.hour + ":" + time.minute;
  $("clock-seconds").textContent = time.second;
  $("date-heading").textContent = prettyDay(now);
  if (user) {
    if (dayKey(now) !== feedDay) {
      observedEvents.clear();
      try { ledger?.prune(now); } catch { /* Se reintenta al volver a activar. */ }
      subscribe();
    }
    if (now - lastTick > 120_000 && enabled) {
      toast("El reloj volvió a estar activo. Los avisos de hace más de 90 segundos no se repiten.");
    }
    renderNext(now);
    renderList(now);
    if (!nativeApp) scanAlarms(now);
  }
  lastTick = now;
}

$("login-email").value = CONFIG.adminEmails[0] || "";
$("admin-link").href = CONFIG.adminPage;
$("brand-link").href = CONFIG.adminPage;
$("login-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!sdk?.signInWithEmailAndPassword) return;
  $("login-error").textContent = "";
  $("login-submit").disabled = true;
  try {
    await sdk.signInWithEmailAndPassword(sdk.auth, $("login-email").value.trim(), $("login-password").value);
    $("login-password").value = "";
  } catch (error) {
    $("login-error").textContent = error.code === "auth/too-many-requests"
      ? "Hubo varios intentos. Esperá unos minutos antes de volver a ingresar."
      : error.code === "auth/network-request-failed" ? "Revisá tu conexión a internet."
        : "No se pudo ingresar. Revisá el correo y la contraseña de la agenda.";
  } finally { $("login-submit").disabled = false; }
});
$("alarm-button").addEventListener("click", activateAlarms);
$("settings-button").addEventListener("click", openSettings);
$("diagnostics-button").addEventListener("click", openDiagnostics);
function closeDiagnosticsDialog() { forceCloseDialog($("diagnostics-dialog")); }
function closeSettingsDialog() { forceCloseDialog($("settings-dialog")); }
$("diagnostics-close").addEventListener("click", closeDiagnosticsDialog);
$("diag-refresh").addEventListener("click", refreshDiagnostics);
$("diag-test-1min").addEventListener("click", async () => {
  if (!nativeApp || !AlarmPlugin) return;
  $("diag-test-1min").disabled = true;
  try {
    await AlarmPlugin.testAlarm({ delayMs: 60_000 });
    toast("Alarma de prueba programada para dentro de 1 minuto. Podés bloquear la pantalla.");
  } catch (error) {
    toast("No se pudo programar la prueba: " + (error?.message || "revisá los permisos."));
  } finally {
    $("diag-test-1min").disabled = false;
    refreshDiagnostics();
  }
});
$("settings-close").addEventListener("click", closeSettingsDialog);
$("alarm-dismiss").addEventListener("click", clearPending);
$("alarm-dialog").addEventListener("cancel", event => { event.preventDefault(); clearPending(); });

// Botón/gesto "Atrás" de Android (llamado desde MainActivity.kt vía evaluateJavascript).
// Cierra solamente la capa superior; si no hay ninguna abierta, devuelve false
// y el sistema hace lo de siempre (minimizar la app a la pantalla raíz).
// MainActivity.kt sigue esto con un toque sintético inofensivo: cerrar un
// <dialog> desde código nativo actualiza el DOM pero, en al menos un
// dispositivo probado, Chromium no repinta sin un gesto real de por medio.
window.__mimartHandleBack = function () {
  if ($("alarm-dialog").open) { clearPending(); return true; }
  if ($("diagnostics-dialog").open) { closeDiagnosticsDialog(); return true; }
  if ($("settings-dialog").open) { closeSettingsDialog(); return true; }
  return false;
};
$("test-button").addEventListener("click", () => {
  if (nativeApp && AlarmPlugin) AlarmPlugin.testAlarm({ delayMs: 3000 }).catch(() => {});
  else testSound();
});
$("settings-test").addEventListener("click", () => {
  if (nativeApp && AlarmPlugin) AlarmPlugin.testAlarm({ delayMs: 3000 }).catch(() => {});
  else testSound({ ...prefs, tone: $("tone").value, volume: Number($("volume").value) / 100 });
});
$("permissions-button")?.addEventListener("click", async () => {
  if (!nativeApp || !AlarmPlugin) return;
  $("permissions-button").disabled = true;
  try {
    const status = await checkNativePermissions();
    if (status.notifications === "granted" && status.exactAlarm === "granted" &&
        status.fullScreenIntent === "granted" && status.batteryUnrestricted) {
      toast("Todos los permisos están en orden.");
    }
  } finally { $("permissions-button").disabled = false; }
});
$("alarm-sound-button")?.addEventListener("click", async () => {
  if (!nativeApp || !AlarmPlugin || $("alarm-sound-button").disabled) return;
  $("alarm-sound-button").disabled = true;
  try {
    // Timeout generoso: espera a que la persona elija en el selector nativo,
    // pero no para siempre — si la Activity del selector no llega a devolver
    // resultado (caso raro, p. ej. tras recrearse la Activity), esto se corta
    // solo en vez de dejar el botón inhabilitado sin ninguna salida.
    const result = await withTimeout(AlarmPlugin.pickAlarmSound(), 120000, "pickAlarmSound");
    $("alarm-sound-label").textContent = result.alarmSoundLabel || "Predeterminado del sistema";
  } catch { /* El usuario canceló el selector, o no respondió a tiempo. */ }
  finally { $("alarm-sound-button").disabled = false; }
});
$("volume").addEventListener("input", () => { $("volume-output").textContent = $("volume").value + " %"; });
$("source-filter").addEventListener("change", () => { listSignature = ""; renderList(Date.now()); });
$("settings-form").addEventListener("submit", event => {
  event.preventDefault();
  const sources = [...$("source-options").querySelectorAll("input:checked")].map(input => input.value);
  if (!sources.length) { $("settings-error").textContent = "Seleccioná al menos una agenda."; return; }
  if (!$("at-start").checked && Number($("advance-minutes").value) === 0) {
    $("settings-error").textContent = "Elegí un aviso previo o el aviso al ingreso. Para silenciar todo, usá Pausar alarmas."; return;
  }
  const oldSources = prefs.sources.join("|");
  prefs = cleanPreferences({
    ...prefs, advanceMinutes: Number($("advance-minutes").value),
    atStart: $("at-start").checked, volume: Number($("volume").value) / 100,
    tone: $("tone").value, wakeLock: $("wake-lock").checked, sources
  });
  savePreferences();
  clearPending();
  if (oldSources !== prefs.sources.join("|")) { fillSourceControls(); subscribe(); }
  if (prefs.wakeLock) requestWake(); else releaseWake();
  setAlarmUI();
  // Cerrar y confirmar "ajustes guardados" pasa YA — es local (localStorage),
  // siempre funciona, y no depende de si el puente nativo responde. Cerrar
  // nunca debe esperar a la reprogramación nativa: si esa llamada se
  // demorara, la ventana quedaría atascada esperando en vez de cerrarse.
  forceCloseDialog($("settings-dialog"));
  toast("Ajustes guardados.");
  // "Alarmas reprogramadas" es una confirmación APARTE: se muestra sólo
  // después de comprobar el resultado real de la llamada nativa, nunca antes.
  // settingsSaveEpoch evita que una respuesta demorada de ESTE guardado
  // muestre su resultado después de que ya se hizo un guardado más nuevo.
  if (nativeApp && AlarmPlugin) {
    const epoch = ++settingsSaveEpoch;
    withTimeout(AlarmPlugin.setPrefs({
      advanceMinutes: prefs.advanceMinutes,
      atStart: prefs.atStart,
      alarmMode: $("alarm-mode").value
    }), 8000, "setPrefs").then(() => {
      if (epoch !== settingsSaveEpoch) return;
      toast("Alarmas reprogramadas con los nuevos ajustes.");
    }).catch(() => {
      if (epoch !== settingsSaveEpoch) return;
      toast("Los ajustes se guardaron, pero no se pudo confirmar la reprogramación de alarmas. Revisá Diagnóstico o volvé a intentar.");
    });
  }
});
$("notification-button").addEventListener("click", async () => {
  if (!("Notification" in window)) return;
  if (prefs.notifications && Notification.permission === "granted") prefs.notifications = false;
  else {
    try { prefs.notifications = (await Notification.requestPermission()) === "granted"; }
    catch { prefs.notifications = false; }
  }
  savePreferences(); updateNotificationUI();
});
$("fullscreen-button").addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { toast("Este navegador no permite activar pantalla completa."); }
});
document.addEventListener("fullscreenchange", () => {
  $("fullscreen-button").setAttribute("aria-label", document.fullscreenElement ? "Salir de pantalla completa" : "Activar pantalla completa");
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") { requestWake(); tick(); refreshConnection(); }
});
window.addEventListener("online", () => { if (user && !demo) subscribe(); });
window.addEventListener("storage", event => {
  if (event.key !== prefsKey) return;
  const previousSources = prefs.sources.join("|");
  prefs = loadPreferences();
  clearPending();
  fillSourceControls();
  if (user && previousSources !== prefs.sources.join("|")) subscribe();
  if (prefs.wakeLock) requestWake(); else releaseWake();
  setAlarmUI();
});
window.addEventListener("offline", () => { clearPending(); refreshConnection(); });
window.addEventListener("pageshow", event => { if (event.persisted && user) { subscribe(); tick(); } });
window.addEventListener("pagehide", () => { releaseWake(); chime.stop(); });
window.addEventListener("beforeinstallprompt", event => {
  if (demo) return;
  event.preventDefault(); installPrompt = event; $("install-button").hidden = false;
});
$("install-button").addEventListener("click", async () => {
  if (!installPrompt) return;
  await installPrompt.prompt();
  installPrompt = null;
  $("install-button").hidden = true;
});
$("reload-data-button").addEventListener("click", () => {
  $("reload-data-button").hidden = true;
  if (user) subscribe();
});
$("demo-ingress").addEventListener("click", () => {
  if (!demo || !prefs.sources.includes("reservas")) {
    toast("Activá Agenda estética en Ajustes para probar el ingreso."); return;
  }
  const start = Date.now() + 10_000;
  const parts = clockParts(start);
  demoInjection = normalizeBooking("demo-ingreso-" + start, "reservas", {
    nombre: "Paciente de prueba", servicio: "Prueba del aviso", fecha: dayKey(start),
    hora: parts.hour + ":" + parts.minute, estado: "confirmado", box: "b1"
  });
  demoInjection.start = start; // Solo en demo: permite comprobar el sonido en 10 s.
  rebuild();
  toast(enabled ? "El ingreso de prueba se avisará en 10 segundos." : "Activá las alarmas para escuchar el ingreso de prueba.");
});

if (nativeApp) {
  $("runtime-hint").textContent = "Las alarmas siguen sonando aunque cierres la app.";
  $("test-button-label").textContent = "Probar alarma";
  $("settings-test").textContent = "Probar alarma";
  $("diagnostics-button").hidden = false;
}
fillSourceControls();
chime.onStateChange = setAlarmUI;
setAlarmUI();
tick();
setInterval(tick, 1000);
if (demo) {
  user = { uid: "demo" };
  ledger = new AlarmLedger("demo");
  $("access-panel").hidden = true;
  $("workspace").hidden = false;
  $("demo-notice").hidden = false;
  subscribe();
} else {
  connectFirebase();
  if ("serviceWorker" in navigator && location.protocol !== "file:" && window.isSecureContext) {
    navigator.serviceWorker.register(new URL("./sw.js", import.meta.url), { scope: "./" })
      .catch(() => { /* El reloj también funciona sin instalación. */ });
  }
}
