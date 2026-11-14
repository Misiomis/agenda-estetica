// node tests/desbloqueo-selectivo/run-tests.js   (datos 100% sintéticos)
import { armarDiasBloqueados, planDesbloqueo, aplicarPlan, idBloqueoHorario, idBloqueoBox } from '../../js/desbloqueo-selectivo.js';

let fails = 0;
const check = (d, c, extra) => { console.log((c ? '  OK  ' : '  FAIL ') + d); if (!c) { fails++; if (extra !== undefined) console.log('       →', JSON.stringify(extra)); } };

const BOXES = ['b1', 'b4', 'b3', 'b2']; // orden visible: Box 4, 2, 3, 5
const HORAS = ['09:00', '09:30', '10:00', '10:30'];
const base = () => ({
  cierres: [{ fecha: '2026-11-23', id: '2026-11-23', reason: 'Capacitación' }],
  horarios: [
    { fecha: '2026-11-24', hora: '09:00', id: 'block_2026-11-24_09-00' },
    { fecha: '2026-11-24', hora: '09:30', id: 'block_2026-11-24_09-30' },
  ],
  porBox: [
    { fecha: '2026-11-25', hora: '10:00', boxId: 'b3', id: 'adm_2026-11-25_10-00_b3', duracionMinutos: 30 },
    { fecha: '2026-11-25', hora: '10:00', boxId: 'b2', id: 'adm_2026-11-25_10-00_b2', duracionMinutos: 30 },
    { fecha: '2026-10-01', hora: '10:00', boxId: 'b2', id: 'viejo' },
  ],
});
const armar = (d, extra = {}) => armarDiasBloqueados({ ...d, boxes: BOXES, horasBase: () => HORAS, desde: '2026-11-14', ...extra });
// ¿Qué celdas siguen bloqueadas? → Set 'fecha hora box'
const bloqueadas = (dias) => new Set(dias.flatMap((d) => d.filas.flatMap((f) => BOXES.filter((b) => f.celdas[b].fuentes.length).map((b) => `${d.fecha} ${f.hora} ${b}`))));

console.log('\n=== Vista de todos los bloqueos (fecha · hora · box) ===');
let dias = armar(base());
check('lista los días con bloqueos desde hoy (sin días pasados)', dias.map((d) => d.fecha).join(',') === '2026-11-23,2026-11-24,2026-11-25');
check('un cierre de día completo muestra todos los horarios × todos los boxes', dias[0].filas.length === 4 && dias[0].bloqueadas === 16);
check('un bloqueo de horario cubre los 4 boxes; uno por box, solo su box', dias[1].bloqueadas === 8 && dias[2].bloqueadas === 2 && dias[2].filas[0].celdas.b1.fuentes.length === 0);
check('incluye un día pasado si se lo pide (desde esa fecha)', armar(base(), { incluir: '2026-10-01' }).some((d) => d.fecha === '2026-10-01'));
check('boxes que ya no están activos no aparecen en la grilla de bloqueos', armarDiasBloqueados({ porBox: [{ fecha: '2026-11-30', hora: '10:00', boxId: 'b5', id: 'x5' }], boxes: BOXES, horasBase: () => HORAS, desde: '2026-11-14' })[0].bloqueadas === 0);

console.log('\n=== Desbloqueo parcial de un día completo (cierre) ===');
let d0 = base();
let dia = armar(d0)[0];
let plan = planDesbloqueo(dia, new Set(['10:00|b3']), { boxes: BOXES });
check('se borra el cierre del día', plan.borrar.includes('2026-11-23'));
check('las horas no elegidas quedan bloqueadas para todos (bloqueo de horario)', ['09:00', '09:30', '10:30'].every((h) => plan.crear.some((c) => c.id === idBloqueoHorario('2026-11-23', h) && c.data.blocked && c.data.reason === 'Capacitación')));
check('en la hora elegida solo se libera ese box: los otros 3 quedan bloqueados por box', ['b1', 'b4', 'b2'].every((b) => plan.crear.some((c) => c.id === idBloqueoBox('2026-11-23', '10:00', b) && c.data.source === 'admin')) && !plan.crear.some((c) => c.id === idBloqueoBox('2026-11-23', '10:00', 'b3')));
let despues = aplicarPlan(d0, plan);
let quedan = bloqueadas(armar(despues));
check('resultado: queda libre SOLO 23/11 10:00 en Box 3 (15 de 16 celdas siguen bloqueadas)', !quedan.has('2026-11-23 10:00 b3') && [...quedan].filter((k) => k.startsWith('2026-11-23')).length === 15);
check('los otros días no se tocan', [...bloqueadas(armar(base()))].filter((k) => !k.startsWith('2026-11-23')).every((k) => quedan.has(k)));

console.log('\n=== Varias celdas y horas completas ===');
d0 = base(); dia = armar(d0)[0];
plan = planDesbloqueo(dia, new Set(BOXES.map((b) => '09:30|' + b).concat(['10:30|b1', '10:30|b4'])), { boxes: BOXES });
quedan = bloqueadas(armar(aplicarPlan(d0, plan)));
check('una hora entera elegida queda libre para todos', BOXES.every((b) => !quedan.has('2026-11-23 09:30 ' + b)) && !plan.crear.some((c) => c.data.hora === '09:30'));
check('dos boxes de 10:30 liberados, los otros dos siguen bloqueados', !quedan.has('2026-11-23 10:30 b1') && !quedan.has('2026-11-23 10:30 b4') && quedan.has('2026-11-23 10:30 b3') && quedan.has('2026-11-23 10:30 b2'));
check('09:00 y 10:00 siguen bloqueados en todos los boxes', BOXES.every((b) => quedan.has('2026-11-23 09:00 ' + b) && quedan.has('2026-11-23 10:00 ' + b)));

console.log('\n=== Bloqueos de horario y por box ===');
d0 = base(); dia = armar(d0)[1];
plan = planDesbloqueo(dia, new Set(['09:00|b2']), { boxes: BOXES });
quedan = bloqueadas(armar(aplicarPlan(d0, plan)));
check('bloqueo de horario: liberar un box lo reemplaza por bloqueos de los otros 3', plan.borrar.includes('block_2026-11-24_09-00') && !quedan.has('2026-11-24 09:00 b2') && ['b1', 'b4', 'b3'].every((b) => quedan.has('2026-11-24 09:00 ' + b)));
check('… sin tocar el bloqueo de 09:30', !plan.borrar.includes('block_2026-11-24_09-30') && BOXES.every((b) => quedan.has('2026-11-24 09:30 ' + b)));
d0 = base(); dia = armar(d0)[2];
plan = planDesbloqueo(dia, new Set(['10:00|b3']), { boxes: BOXES });
check('bloqueo por box: se borra solo ese documento', plan.borrar.join() === 'adm_2026-11-25_10-00_b3' && plan.crear.length === 0);
check('sin selección no se escribe nada', (() => { const p = planDesbloqueo(armar(base())[0], new Set(), { boxes: BOXES }); return !p.borrar.length && !p.crear.length; })());
check('elegir una celda libre no hace nada', (() => { const p = planDesbloqueo(armar(base())[2], new Set(['10:00|b1']), { boxes: BOXES }); return !p.borrar.length && !p.crear.length; })());
check('el bloqueo por box de un box inactivo (b5) nunca se borra', (() => { const d = { cierres: [], horarios: [], porBox: [{ fecha: '2026-11-30', hora: '10:00', boxId: 'b5', id: 'x5' }, { fecha: '2026-11-30', hora: '10:00', boxId: 'b1', id: 'x1' }] }; const dd = armar(d)[0]; const p = planDesbloqueo(dd, new Set(BOXES.map((b) => '10:00|' + b)), { boxes: BOXES }); return p.borrar.join() === 'x1'; })());

console.log('\n' + '='.repeat(60));
console.log(fails ? fails + ' prueba(s) fallaron' : 'TODAS LAS PRUEBAS DE DESBLOQUEO SELECTIVO OK');
process.exit(fails ? 1 : 0);
