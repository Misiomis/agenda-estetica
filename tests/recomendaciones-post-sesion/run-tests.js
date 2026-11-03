// node tests/recomendaciones-post-sesion/run-tests.js   (datos 100% sintéticos)
// Biblioteca de recomendaciones post-sesión (js/recomendaciones-post-sesion.js):
// sincronía exacta con las constantes msg* de admin.html, sin saludos,
// título personalizado, HIFU delegado y sugerencia por servicio.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  PLANTILLAS_POST_SESION, ORIGEN_EN_ADMIN, CATEGORIAS, construirRecomendacion, sugerirPlantillas, tituloRecomendacion,
} from '../../js/recomendaciones-post-sesion.js';
import { construirMensajeHifu } from '../../js/recomendaciones-hifu.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const admin = fs.readFileSync(path.join(__dirname, '..', '..', 'admin.html'), 'utf8');

let fails = 0;
const check = (desc, cond, extra) => { console.log((cond ? '  OK  ' : '  FAIL ') + desc); if (!cond) { fails++; if (extra !== undefined) console.log('       →', JSON.stringify(extra)); } };

// Cuerpo de una constante msg* de admin.html, evaluado como el navegador
// evaluaría el template literal (las secuencias \n pasan a saltos reales).
const BS = String.fromCharCode(92);
function cuerpoEnAdmin(constante) {
  const cab = 'const ' + constante + ' = encodeURIComponent(`${_recTitulo}' + BS + 'n' + BS + 'n';
  const ini = admin.indexOf(cab);
  if (ini < 0) return null;
  const a = ini + cab.length;
  const crudo = admin.slice(a, admin.indexOf('`);', a));
  return Function('return `' + crudo + '`;')();
}

console.log('\n=== Sincronía exacta con las constantes de la Agenda (admin.html) ===');
for (const [clave, constante] of Object.entries(ORIGEN_EN_ADMIN)) {
  const enAdmin = cuerpoEnAdmin(constante);
  const enModulo = construirRecomendacion(clave, '').split('\n\n').slice(1).join('\n\n');
  check(`"${clave}" es idéntico a ${constante} de admin.html`, enAdmin !== null && enAdmin === enModulo,
    enAdmin === null ? 'no se encontró la constante' : undefined);
}

console.log('\n=== Título personalizado, sin saludos ni agradecimientos de apertura ===');
for (const clave of Object.keys(PLANTILLAS_POST_SESION)) {
  const txt = construirRecomendacion(clave, 'Ana Pérez');
  check(`"${clave}" empieza con "Recomendaciones para Ana Pérez"`, txt.startsWith('Recomendaciones para Ana Pérez\n\n'));
  check(`"${clave}" no saluda con "Hola"`, !/^\s*Hola\b/im.test(txt.split('\n\n').slice(1, 2).join('')));
}
check('sin nombre usa el título neutro', construirRecomendacion('radiofrecuencia', '').startsWith('Recomendaciones posteriores a tu sesión\n\n'));
check('tituloRecomendacion recorta espacios', tituloRecomendacion('  Lu  ') === 'Recomendaciones para Lu');

console.log('\n=== HIFU se delega a js/recomendaciones-hifu.js (no se copia) ===');
check('hifu_facial_despues === construirMensajeHifu', construirRecomendacion('hifu_facial_despues', 'Lu') === construirMensajeHifu('facial_despues', 'Lu'));
check('existen las 4 plantillas HIFU', ['facial_antes', 'facial_despues', 'corporal_antes', 'corporal_despues'].every(k => PLANTILLAS_POST_SESION['hifu_' + k]));

console.log('\n=== Cobertura de servicios pedidos ===');
['limpieza_peeling', 'radiofrecuencia', 'drenaje_masajes', 'criolipolisis', 'kit_facial'].forEach(k =>
  check(`plantilla "${k}" disponible`, !!PLANTILLAS_POST_SESION[k] && construirRecomendacion(k, 'X').length > 300));
check('limpieza/peeling menciona FPS y no exfoliar por 72 hs', /FPS 50/.test(construirRecomendacion('limpieza_peeling', '')) && /72 HS/.test(construirRecomendacion('limpieza_peeling', '')));
check('toda plantilla tiene categoría conocida', Object.values(PLANTILLAS_POST_SESION).every(p => CATEGORIAS[p.categoria]));
check('clave desconocida falla explícitamente', (() => { try { construirRecomendacion('no_existe', 'X'); return false; } catch (_) { return true; } })());

console.log('\n=== Sugerencia según el servicio del turno ===');
const caso = (svc, primera) => check(`"${svc}" → primero "${primera}"`, sugerirPlantillas(svc)[0] === primera, sugerirPlantillas(svc));
caso('Hi-Fu Facial', 'hifu_facial_despues');
caso('Limpieza Facial Profunda', 'limpieza_peeling');
caso('Dermaplaning', 'limpieza_peeling');
caso('Criolipolisis', 'criolipolisis');
caso('Radiofrecuencia Corporal', 'radiofrecuencia');
caso('FRAXIS Facial', 'fraxis_facial');
caso('Drenaje Linfático', 'drenaje_masajes');
caso('Masajes Relax', 'drenaje_masajes');
caso('Drenapress', 'drenapress');
caso('Mesoterapia facial', 'mesoterapia');
caso('Servicio raro sin coincidencias', 'agua');
check('todas las sugeridas existen como plantilla', ['Hi-Fu Corporal', 'Tratamiento corporal', 'Plisagge Vela', 'MIO UP', 'Plataforma vibratoria']
  .every(s => sugerirPlantillas(s).every(k => PLANTILLAS_POST_SESION[k])));

console.log('\n' + '='.repeat(60));
console.log(fails ? fails + ' prueba(s) fallaron' : 'TODAS LAS PRUEBAS DE RECOMENDACIONES POST-SESIÓN OK');
process.exit(fails ? 1 : 0);
