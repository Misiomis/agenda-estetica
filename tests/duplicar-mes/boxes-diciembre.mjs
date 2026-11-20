// node tests/duplicar-mes/boxes-diciembre.mjs
// Noviembre → diciembre 2026: cada paciente sigue en el MISMO box (B4, B2, B3,
// B5 conservan id y nombre) y nadie va al Box 1 nuevo (b6), ni siquiera como
// alternativa cuando su lugar habitual está ocupado.
import assert from 'node:assert/strict';
import { prepararDuplicacion, buscarAlternativas, ocupacionDesdeReservas } from '../../js/duplicar-mes.js';
import { normalizarBoxes, boxesParaFecha } from '../../js/boxes-grilla.js';

// Lo que recibe "Duplicar mes" en el panel: los boxes de siempre, sin el Box 1.
const BOXES = normalizarBoxes(null).map((b) => ({ id: b.id, label: b.label }));
assert.deepEqual(BOXES.map((b) => `${b.id}:${b.label}`), ['b1:Box 4', 'b4:Box 2', 'b3:Box 3', 'b2:Box 5']);

const SERV = { 'Corporal': { duracionMin: 60, boxes: [] }, 'Relax': { duracionMin: 60, boxes: [] }, 'Facial': { duracionMin: 60, boxes: ['b3'] }, 'Criolipolisis': { duracionMin: 60, boxes: [] } };
let id = 0;
const R = (dni, nombre, fecha, box, servicio) => ({ id: 'r' + (++id), dni, nombre, fecha, hora: '10:00', servicio, duracionMinutos: 60, box, estado: 'confirmado' });
const lunesNov = ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30'];
const reservas = [
  ...lunesNov.map((f) => R('1', 'Paula Box4', f, 'b1', 'Corporal')),
  ...lunesNov.map((f) => R('2', 'Laura Box2', f, 'b4', 'Relax')),
  ...lunesNov.map((f) => R('3', 'Marta Box3', f, 'b3', 'Facial')),
  ...lunesNov.map((f) => R('4', 'Rosa Box5', f, 'b2', 'Criolipolisis')),
];
const pacientes = { 1: { dni: '1', fullName: 'Paula Box4' }, 2: { dni: '2', fullName: 'Laura Box2' }, 3: { dni: '3', fullName: 'Marta Box3' }, 4: { dni: '4', fullName: 'Rosa Box5' } };
const ctx = {
  origen: { anio: 2026, mes: 11 }, destino: { anio: 2026, mes: 12 }, reservas, pacientes, servicios: SERV, boxes: BOXES,
  bloqueos: [], desbloqueos: [], pendientes: [],
  esActiva: (r) => !/cancel/i.test(r.estado || ''), boxDe: (r) => r.box, duracionDe: (r) => r.duracionMinutos || 60,
};
const res = prepararDuplicacion(ctx);
const crear = res.items.filter((i) => i.estado === 'crear');
assert.ok(crear.length >= 16, 'se generan los lunes de diciembre: ' + crear.length);
const boxDe = { 1: 'b1', 2: 'b4', 3: 'b3', 4: 'b2' };
for (const it of crear) assert.equal(it.boxId, boxDe[it.dni], `${it.paciente} sigue en su box (${it.boxId})`);
assert.ok(!res.items.some((i) => i.boxId === 'b6'), 'nadie va al Box 1');

// En diciembre la Grilla muestra cada box con el mismo nombre de siempre.
const dic = Object.fromEntries(boxesParaFecha(null, '2026-12-07').map((b) => [b.id, b.title]));
assert.deepEqual([dic.b1, dic.b4, dic.b3, dic.b2, dic.b6], ['Box 4', 'Box 2', 'Box 3', 'Box 5', 'Box 1']);

// Lugar habitual ocupado → las alternativas nunca ofrecen el Box 1.
const item = crear.find((i) => i.dni === '1');
const ocupado = { ...ctx, reservas: [...reservas, { id: 'x', dni: '9', nombre: 'Otra', fecha: item.fecha, hora: item.hora, servicio: 'Corporal', duracionMinutos: 60, box: 'b1', estado: 'confirmado' }] };
const alt = buscarAlternativas({ ...ocupado, mesDestino: '2026-12', ocupacion: ocupacionDesdeReservas(ocupado.reservas, ocupado), bloqueos: [] }, item, { max: 20, incluirRestricciones: true });
assert.ok(alt.length > 0 && !alt.some((a) => a.boxId === 'b6'), 'alternativas sin Box 1: ' + [...new Set(alt.map((a) => a.boxId))].join(','));

console.log('DUPLICAR NOV → DIC: MISMOS BOXES, BOX 1 VACÍO — OK');
