// Prueba aislada del botón Atrás de Android: necesita window.Capacitor
// presente ANTES de que el script del módulo se cargue (nativeApp se decide
// una sola vez al importar). Por eso vive en un proceso Node separado del
// resto del E2E. Corre con: node tests/mimar-inteligente/back-button-run.js
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

// Mock mínimo de la superficie de Capacitor que usa el script: isNativePlatform
// y el plugin App (addListener/exitApp).
const backButtonHandlers = [];
const appStateHandlers = [];
let exitAppLlamado = 0;
window.Capacitor = {
  isNativePlatform: () => true,
  Plugins: {
    App: {
      addListener: (evento, cb) => {
        if (evento === 'backButton') backButtonHandlers.push(cb);
        if (evento === 'appStateChange') appStateHandlers.push(cb);
        return { remove: () => {} };
      },
      exitApp: () => { exitAppLlamado++; },
    },
  },
};

let scriptSrc = fs.readFileSync(path.join(APP_DIR, 'mimar-inteligente.js'), 'utf8');
scriptSrc = scriptSrc.replace('from "./firebase-web.js"', 'from "./fake-firebase-web.js"');
const logicUrl = 'file:///' + path.join(APP_DIR, 'mimar-inteligente-logic.js').replace(/\\/g, '/');
scriptSrc = scriptSrc.replace('from "./mimar-inteligente-logic.js"', `from "${logicUrl}"`);
const contactTrackingUrl = 'file:///' + path.join(APP_DIR, 'contact-tracking.js').replace(/\\/g, '/');
scriptSrc = scriptSrc.replace('from "./contact-tracking.js"', `from "${contactTrackingUrl}"`);
const updateCheckUrl = 'file:///' + path.join(APP_DIR, 'update-check.js').replace(/\\/g, '/');
scriptSrc = scriptSrc.replace('from "./update-check.js"', `from "${updateCheckUrl}"`);
const scriptPath = path.join(__dirname, '_back-page-script.generated.mjs');
fs.writeFileSync(scriptPath, scriptSrc);

const fakeFb = await import('./fake-firebase-web.js');
await import('./_back-page-script.generated.mjs');
fs.unlinkSync(scriptPath);

const $ = (id) => document.getElementById(id);
function fakeUser(email) { return { uid: 'uid-' + email, getIdTokenResult: async () => ({ claims: { email }, token: { email } }) }; }
async function login(email) { await fakeFb.calls.authCallback(fakeUser(email)); await new Promise((r) => setTimeout(r, 0)); }
function reservaDoc(id, data) { return [id, data]; }
function emitirSnapshot(coleccionPath, docs) {
  const entrada = fakeFb.calls.onSnapshotCalls.filter((e) => e.path === coleccionPath && !e.unsubscribed).pop();
  entrada.onNext(fakeFb.fakeSnap(docs));
}

async function run() {
  console.log('\n=== Botón Atrás nativo: se registra el listener de Capacitor ===');
  check('se registró backButton', backButtonHandlers.length === 1);
  check('se registró appStateChange (reconciliar al volver a primer plano)', appStateHandlers.length === 1);

  await login('espaciomimart36@gmail.com');
  const HOY = new Date().toISOString().slice(0, 10);
  emitirSnapshot('reservas', [reservaDoc('r1', { nombre: 'Ana', fecha: HOY, hora: '23:59', box: 'b1', telefono: '3764111111', estado: 'confirmado' })]);
  emitirSnapshot('consultas', []);

  console.log('\n=== Atrás con el modal abierto: cierra el modal, NO sale de la app ===');
  {
    document.querySelector('[data-abrir="reservas::r1"]').click();
    check('el modal está abierto', $('detalle-dialog').open === true);
    backButtonHandlers[0]();
    check('Atrás cerró el modal', $('detalle-dialog').open !== true);
    check('Atrás con el modal abierto NO salió de la app', exitAppLlamado === 0);
  }

  console.log('\n=== Atrás con el panel inferior (filtros) abierto: lo cierra, NO cierra nada más ===');
  {
    document.querySelector('[data-tab-btn="actividad"]').click();
    $('btn-abrir-filtros').click();
    check('el panel inferior está abierto', $('bottom-sheet').hidden === false);
    backButtonHandlers[0]();
    check('Atrás cerró el panel inferior', $('bottom-sheet').hidden === true);
    check('Atrás con el panel abierto NO salió de la app', exitAppLlamado === 0);
    document.querySelector('[data-tab-btn="inicio"]').click();
  }

  console.log('\n=== Atrás en la pantalla principal: primero avisa, segundo Atrás (rápido) sale ===');
  {
    backButtonHandlers[0](); // primer Atrás
    check('el primer Atrás en Home todavía no sale de la app', exitAppLlamado === 0);
    check('el primer Atrás muestra el aviso "tocá de nuevo"', $('toast').hidden === false && $('toast').textContent.toLowerCase().includes('atrás'));
    backButtonHandlers[0](); // segundo Atrás, inmediato
    check('el segundo Atrás inmediato SÍ sale de la app', exitAppLlamado === 1);
  }

  console.log('\n=== appStateChange(isActive=true) reconcilia sin duplicar listeners ===');
  {
    const antes = fakeFb.calls.onSnapshotCalls.filter(e => e.path === 'reservas' && !e.unsubscribed).length;
    appStateHandlers[0]({ isActive: true });
    const despues = fakeFb.calls.onSnapshotCalls.filter(e => e.path === 'reservas' && !e.unsubscribed).length;
    check('volver a primer plano no crea una suscripción nueva', antes === despues && despues === 1);
  }

  console.log('\n' + '='.repeat(60));
  console.log(fails ? (fails + ' prueba(s) fallaron') : 'TODAS LAS PRUEBAS OK');
  process.exit(fails ? 1 : 0);
}

run().catch((e) => { console.error('ERROR FATAL:', e); process.exit(1); });
