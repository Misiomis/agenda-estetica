// Pruebas end-to-end de mimar-inteligente/index.html: carga el HTML real en
// jsdom, ejecuta el script real del módulo (mimar-inteligente.js, con
// ./firebase-web.js reemplazado por un fake controlable), y dispara
// snapshots/errores/eventos de auth/back-button a mano. No toca Firestore
// real. Requiere jsdom (`npm install jsdom` — ya es devDependency).
// Correr con: node tests/mimar-inteligente/e2e-run.js
import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.join(__dirname, '..', '..');
const APP_DIR = path.join(PROJECT, 'mimar-inteligente');

let fails = 0;
const check = (desc, cond) => { console.log((cond ? '  OK  ' : '  FAIL ') + desc); if (!cond) fails++; };

const html = fs.readFileSync(path.join(APP_DIR, 'index.html'), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/mimar-inteligente/', pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
try { Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true }); } catch (_) {}

let scriptSrc = fs.readFileSync(path.join(APP_DIR, 'mimar-inteligente.js'), 'utf8');
scriptSrc = scriptSrc.replace('from "./firebase-web.js"', 'from "./fake-firebase-web.js"');
const logicUrl = 'file:///' + path.join(APP_DIR, 'mimar-inteligente-logic.js').replace(/\\/g, '/');
scriptSrc = scriptSrc.replace('from "./mimar-inteligente-logic.js"', `from "${logicUrl}"`);
const scriptPath = path.join(__dirname, '_page-script.generated.mjs');
fs.writeFileSync(scriptPath, scriptSrc);

const fakeFb = await import('./fake-firebase-web.js');
await import('./_page-script.generated.mjs');
fs.unlinkSync(scriptPath);

const $ = (id) => document.getElementById(id);

function fakeUser(email) {
  return { uid: 'uid-' + email, getIdTokenResult: async () => ({ claims: { email }, token: { email } }) };
}
async function login(email) {
  await fakeFb.calls.authCallback(fakeUser(email));
  await new Promise((r) => setTimeout(r, 0));
}
function reservaDoc(id, data) { return [id, data]; }
function ultimaSub(coleccionPath) {
  const entradas = fakeFb.calls.onSnapshotCalls.filter((e) => e.path === coleccionPath && !e.unsubscribed);
  return entradas[entradas.length - 1];
}
function emitirSnapshot(coleccionPath, docs, fromCache = false) {
  const entrada = ultimaSub(coleccionPath);
  if (!entrada) throw new Error('No hay suscripción activa para ' + coleccionPath);
  docs.__fromCache = fromCache;
  entrada.onNext(fakeFb.fakeSnap(docs));
}
function emitirError(coleccionPath, err) { ultimaSub(coleccionPath).onError(err); }

async function run() {
  console.log('\n=== Login con cuenta NO admin: se rechaza, no arma suscripciones ===');
  {
    await login('paciente@gmail.com');
    check('sigue mostrando el panel de acceso (no entra a workspace)', $('access-panel').hidden === false && $('workspace').hidden === true);
    check('no se abrió ninguna suscripción de Firestore', fakeFb.calls.onSnapshotCalls.length === 0);
    check('se llamó a signOut para cerrar esa sesión no autorizada', fakeFb.calls.signOutCalls >= 1);
  }

  console.log('\n=== Login con la cuenta admin: entra y arma UNA suscripción por fuente ===');
  {
    await login('espaciomimart36@gmail.com');
    check('el workspace queda visible', $('workspace').hidden === false && $('access-panel').hidden === true);
    check('el botón de salir aparece', $('btn-salir').hidden === false);
    check('exactamente UNA suscripción activa a reservas', fakeFb.calls.onSnapshotCalls.filter(e => e.path === 'reservas' && !e.unsubscribed).length === 1);
    check('exactamente UNA suscripción activa a consultas', fakeFb.calls.onSnapshotCalls.filter(e => e.path === 'consultas' && !e.unsubscribed).length === 1);
  }

  console.log('\n=== Re-entrada con el MISMO usuario (refresh de token): no duplica listeners ===');
  {
    await login('espaciomimart36@gmail.com');
    check('sigue habiendo UNA sola suscripción activa a reservas', fakeFb.calls.onSnapshotCalls.filter(e => e.path === 'reservas' && !e.unsubscribed).length === 1);
  }

  console.log('\n=== Agenda vacía inicial: no debe leerse como "reservas recién creadas" ===');
  {
    emitirSnapshot('reservas', []);
    emitirSnapshot('consultas', []);
    check('agenda vacía muestra el mensaje de vacío', $('lista-agenda').innerHTML.includes('Una pausa en la agenda'));
    check('próximo turno muestra "no hay más turnos"', $('proximo-turno-body').textContent.includes('No hay más turnos'));
  }

  const HOY = new Date().toISOString().slice(0, 10);

  console.log('\n=== Alta, nombre largo, box explícito, teléfono, duración real ===');
  {
    const nombreLargo = 'María de los Ángeles Fernández Rodríguez de la Torre y Gonzalez';
    emitirSnapshot('reservas', [
      reservaDoc('rLargo', { nombre: nombreLargo, fecha: HOY, hora: '23:59', servicio: 'Presoterapia', box: 'b2', telefono: '3764111111', duracionMinutos: 45, estado: 'confirmado' }),
    ]);
    emitirSnapshot('consultas', []);
    check('el nombre largo aparece completo, sin cortar', $('lista-agenda').innerHTML.includes(nombreLargo));
    check('muestra el box explícito (Box 2)', $('lista-agenda').innerHTML.includes('Box 2'));
  }

  console.log('\n=== Datos incompletos: sin teléfono, sin duración, sin box → se señala, no se inventa ===');
  {
    emitirSnapshot('reservas', [
      reservaDoc('rIncompleta', { nombre: 'Sin Datos', fecha: HOY, hora: '23:58', servicio: 'Facial', estado: 'confirmado' }),
    ]);
    check('marca "Sin teléfono" en vez de omitirlo', $('lista-agenda').innerHTML.includes('Sin teléfono'));
    check('marca "Box no asignado" en vez de inventar un box', $('lista-agenda').innerHTML.includes('Box no asignado'));
  }

  console.log('\n=== Permisos insuficientes en UNA fuente: no debe parecer agenda vacía ===');
  {
    emitirError('consultas', { code: 'permission-denied', message: 'Missing or insufficient permissions.' });
    check('el aviso de fuentes muestra el error de Consultas', $('fuentes-aviso').hidden === false && $('fuentes-aviso').textContent.toLowerCase().includes('consultas'));
    check('la conexión general pasa a estado de error', $('connection').getAttribute('data-state') === 'error');
    check('la sección de agenda sigue mostrando lo que sí pudo leer de Reservas', $('lista-agenda').innerHTML.includes('Sin Datos'));
  }

  console.log('\n=== Reconexión: fromCache → el estado deja de ser "error" ===');
  {
    emitirSnapshot('consultas', [], true);
    check('con fromCache=true ya no hay error (aviso oculto)', $('fuentes-aviso').hidden === true);
    check('el estado de conexión indica verificación (warning), no "live" todavía', $('connection').getAttribute('data-state') === 'warning');
    emitirSnapshot('consultas', [], false);
    check('al verificarse con el servidor, pasa a "live"', $('connection').getAttribute('data-state') === 'live');
  }

  console.log('\n=== Turnos simultáneos en distintos boxes se conservan por separado ===');
  {
    emitirSnapshot('reservas', [
      reservaDoc('boxA', { nombre: 'Persona A', fecha: HOY, hora: '23:57', box: 'b1', telefono: '3764111111', servicio: 'Facial', estado: 'confirmado' }),
      reservaDoc('boxB', { nombre: 'Persona B', fecha: HOY, hora: '23:57', box: 'b3', telefono: '3764222222', servicio: 'Peeling', estado: 'confirmado' }),
    ]);
    check('cuenta 2 en la agenda (no se fusionan)', $('count-agenda').textContent === '2');
    check('aparece Box 1 y Box 3 simultáneamente', $('lista-agenda').innerHTML.includes('Box 1') && $('lista-agenda').innerHTML.includes('Box 3'));
  }

  console.log('\n=== Modal de detalle: abre, muestra datos, cierra con la X y con el backdrop ===');
  {
    document.querySelector('[data-abrir="reservas::boxA"]').click();
    check('el modal queda abierto', $('detalle-dialog').hasAttribute('open') || $('detalle-dialog').open === true);
    check('el título muestra el nombre correcto', $('detalle-titulo').textContent === 'Persona A');
    check('el detalle incluye el box', $('detalle-body').innerHTML.includes('Box 1'));
    $('btn-cerrar-detalle').click();
    check('el botón de cerrar (X) cierra el modal', !($('detalle-dialog').open === true));
  }

  console.log('\n=== Preparar WhatsApp: re-verifica con el servidor antes de armar el texto ===');
  {
    window.open = (url) => { window.__ultimaUrlAbierta = url; return null; };
    document.querySelector('[data-abrir="reservas::boxA"]').click();
    fakeFb.calls.getDocFromServerQueue.push({
      snap: fakeFb.fakeDocSnap(true, 'boxA', { nombre: 'Persona A', fecha: HOY, hora: '23:57', box: 'b1', telefono: '3764111111', servicio: 'Facial', estado: 'confirmado' }),
    });
    await $('btn-preparar-wa').click();
    await new Promise((r) => setTimeout(r, 0));
    check('abrió wa.me con el número normalizado', (window.__ultimaUrlAbierta || '').includes('wa.me/5493764111111'));
    check('el texto incluye el servicio real', decodeURIComponent(window.__ultimaUrlAbierta).includes('Facial'));
    check('el status confirma verificación con el servidor, no un envío', $('detalle-status').textContent.toLowerCase().includes('verificad'));
  }

  console.log('\n=== Preparar WhatsApp — la reserva fue CANCELADA entre que se abrió la tarjeta y se preparó el mensaje ===');
  {
    document.querySelector('[data-abrir="reservas::boxB"]').click();
    window.__ultimaUrlAbierta = null;
    fakeFb.calls.getDocFromServerQueue.push({
      snap: fakeFb.fakeDocSnap(true, 'boxB', { nombre: 'Persona B', fecha: HOY, hora: '23:57', box: 'b3', telefono: '3764222222', estado: 'cancelado' }),
    });
    await $('btn-preparar-wa').click();
    await new Promise((r) => setTimeout(r, 0));
    check('NO abre WhatsApp si ya está cancelada', window.__ultimaUrlAbierta === null);
    check('el modal explica que fue cancelada', $('detalle-status').textContent.toLowerCase().includes('cancel'));
  }

  console.log('\n=== Preparar WhatsApp — la reserva fue ELIMINADA ===');
  {
    emitirSnapshot('reservas', [
      reservaDoc('borrame', { nombre: 'Por Borrar', fecha: HOY, hora: '23:56', box: 'b2', telefono: '3764333333', estado: 'confirmado' }),
    ]);
    document.querySelector('[data-abrir="reservas::borrame"]').click();
    window.__ultimaUrlAbierta = null;
    fakeFb.calls.getDocFromServerQueue.push({ snap: fakeFb.fakeDocSnap(false, 'borrame', null) });
    await $('btn-preparar-wa').click();
    await new Promise((r) => setTimeout(r, 0));
    check('NO abre WhatsApp si el documento ya no existe', window.__ultimaUrlAbierta === null);
    check('el modal explica que fue eliminada', $('detalle-status').textContent.toLowerCase().includes('elimin'));
  }

  console.log('\n=== Preparar WhatsApp — falla la verificación (sin conexión): explica y permite reintentar ===');
  {
    emitirSnapshot('reservas', [
      reservaDoc('reintento', { nombre: 'Con Error De Red', fecha: HOY, hora: '23:55', box: 'b1', telefono: '3764444444', estado: 'confirmado' }),
    ]);
    document.querySelector('[data-abrir="reservas::reintento"]').click();
    window.__ultimaUrlAbierta = null;
    fakeFb.calls.getDocFromServerQueue.push({ throwError: { code: 'unavailable', message: 'network error' } });
    await $('btn-preparar-wa').click();
    await new Promise((r) => setTimeout(r, 0));
    check('NO abre WhatsApp si no se pudo verificar', window.__ultimaUrlAbierta === null);
    check('explica el error y deja el botón habilitado para reintentar', !$('btn-preparar-wa').disabled && $('detalle-status').textContent.toLowerCase().includes('no se pudo verificar'));
  }

  console.log('\n=== Regreso a la pantalla (visibilitychange → visible): reconcilia sin duplicar listeners ===');
  {
    const reservasSubsAntes = fakeFb.calls.onSnapshotCalls.filter(e => e.path === 'reservas' && !e.unsubscribed).length;
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new window.Event('visibilitychange'));
    const reservasSubsDespues = fakeFb.calls.onSnapshotCalls.filter(e => e.path === 'reservas' && !e.unsubscribed).length;
    check('volver a la pantalla no crea una suscripción nueva', reservasSubsAntes === reservasSubsDespues && reservasSubsDespues === 1);
  }

  console.log('\n' + '='.repeat(60));
  console.log(fails ? (fails + ' prueba(s) fallaron') : 'TODAS LAS PRUEBAS OK');
  process.exit(fails ? 1 : 0);
}

run().catch((e) => { console.error('ERROR FATAL:', e); process.exit(1); });
