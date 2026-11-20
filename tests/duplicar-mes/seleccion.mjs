// node tests/duplicar-mes/seleccion.mjs — excluir / incluir pacientes al duplicar (datos sintéticos)
import assert from 'node:assert/strict';
import { prepararCopiaSeleccion, analizarSeleccion, ocupacionDesdeReservas, normalizarBloqueos } from '../../js/duplicar-mes.js';

let n = 0; const t = (d, fn) => { fn(); n++; console.log('✓', d); };
const BOXES = [{ id: 'b1', label: 'Box 4' }, { id: 'b4', label: 'Box 2' }, { id: 'b3', label: 'Box 3' }, { id: 'b2', label: 'Box 5' }];
const SERV = { Corporal: { duracionMin: 60, boxes: [] }, Facial: { duracionMin: 60, boxes: ['b3'] } };
let id = 0;
const R = (dni, fecha, hora, box = 'b1', servicio = 'Corporal', extra = {}) => ({ id: 'r' + (++id), dni, nombre: 'P' + dni, fecha, hora, servicio, box, duracionMinutos: 60, estado: 'confirmado', ...extra });
// Septiembre (origen): 1 y 2 vienen los jueves 10:00. Octubre: 3 nueva (martes 09:00, box b3).
// Noviembre: 4 nueva (jueves 10:00 en b1 → choca con 1); 1 sí viene en noviembre, 2 NO.
const reservas = [
  ...['2026-09-03', '2026-09-10', '2026-09-17', '2026-09-24'].map((f) => R('1', f, '10:00', 'b1')),
  ...['2026-09-03', '2026-09-10', '2026-09-17', '2026-09-24'].map((f) => R('2', f, '11:00', 'b4')),
  ...['2026-10-06', '2026-10-13'].map((f) => R('3', f, '09:00', 'b3', 'Facial')),
  ...['2026-11-05', '2026-11-12'].map((f) => R('4', f, '10:00', 'b1')),
  R('1', '2026-11-05', '10:00', 'b1'), R('3', '2026-11-10', '09:00', 'b3', 'Facial'),
];
const ctxDe = (extra = {}) => {
  const c = { origen: { anio: 2026, mes: 9 }, destino: { anio: 2026, mes: 12 }, reservas, pacientes: {}, servicios: SERV, boxes: BOXES, bloqueos: [], desbloqueos: [], pendientes: [], decisiones: { global: {}, patrones: {}, items: {} },
    esActiva: (r) => !/cancel/i.test(r.estado || ''), boxDe: (r) => r.box, duracionDe: (r) => r.duracionMinutos, nombreDe: (r) => r.nombre, ...extra };
  c.mesDestino = '2026-12'; c.ocupacion = ocupacionDesdeReservas(c.reservas, c); return c;
};
const dnis = (res, estado = 'crear') => [...new Set(res.items.filter((i) => i.estado === estado).map((i) => i.dni))].sort();

t('analiza: sin sesiones en noviembre y nuevos de octubre/noviembre', () => {
  const a = analizarSeleccion({ reservas, mesOrigen: '2026-09', mesRef: '2026-11', mesesNuevos: ['2026-10', '2026-11'], esActiva: (r) => !/cancel/.test(r.estado || ''), nombreDe: (r) => r.nombre });
  assert.deepEqual(a.origenPacientes.map((p) => p.dni), ['1', '2']);
  assert.deepEqual(a.sinSesionesRef.map((p) => p.dni), ['2']);
  assert.deepEqual(a.nuevos.map((p) => `${p.dni}:${p.mesAlta}:${p.mesFuente}`), ['3:2026-10:2026-11', '4:2026-11:2026-11']);
});
t('con historial: alguien que ya venía antes no es "nuevo"', () => {
  const a = analizarSeleccion({ reservas, historial: [...reservas, R('4', '2026-05-01', '10:00')], mesOrigen: '2026-09', mesRef: '2026-11', mesesNuevos: ['2026-10', '2026-11'], esActiva: () => true });
  assert.deepEqual(a.nuevos.map((p) => p.dni), ['3']);
});
t('sin selección = copia de siempre', () => { const r = prepararCopiaSeleccion(ctxDe(), {}); assert.deepEqual(dnis(r), ['1', '2']); });
t('NO INCLUIR: el paciente excluido no se copia', () => {
  const r = prepararCopiaSeleccion(ctxDe(), { excluir: new Set(['2']) });
  assert.deepEqual(dnis(r), ['1']); assert.ok(!r.items.some((i) => i.dni === '2'));
});
t('INCLUIR nuevo: se copia desde su mes, mismo día de la semana, hora y box', () => {
  const r = prepararCopiaSeleccion(ctxDe(), { incluir: [{ dni: '3', mes: '2026-11' }] });
  const it = r.items.filter((i) => i.dni === '3');
  assert.ok(it.length >= 1 && it.every((i) => i.estado === 'crear' && i.boxId === 'b3' && i.hora === '09:00' && new Date(i.fecha + 'T12:00').getDay() === 2), JSON.stringify(it));
  assert.equal(r.resumen.incluidos, 1);
});
t('INCLUIR nuevo que choca con la copia del origen → pendiente (box ocupado), sin pisar a nadie', () => {
  const r = prepararCopiaSeleccion(ctxDe(), { incluir: [{ dni: '4', mes: '2026-11' }] });
  const it = r.items.filter((i) => i.dni === '4');
  assert.ok(it.length && it.every((i) => i.estado === 'pendiente' && i.motivos.some((m) => m.codigo === 'box_ocupado')), JSON.stringify(it.map((i) => i.motivos)));
  assert.deepEqual(dnis(r), ['1', '2']);
});
t('si se excluye al que ocupaba el lugar, el nuevo entra', () => {
  const r = prepararCopiaSeleccion(ctxDe(), { excluir: new Set(['1']), incluir: [{ dni: '4', mes: '2026-11' }] });
  assert.deepEqual(dnis(r), ['2', '4']);
});
t('respeta días bloqueados también para los incluidos', () => {
  const { bloqueos, desbloqueos } = normalizarBloqueos([{ id: 'c', fecha: '2026-12-08', tipo: 'dia', blocked: true, source: 'admin' }, { id: 'c2', fecha: '2026-12-08', cerrado: true }]);
  const r = prepararCopiaSeleccion(ctxDe({ bloqueos, desbloqueos }), { incluir: [{ dni: '3', mes: '2026-11' }] });
  const el8 = r.items.find((i) => i.dni === '3' && i.fecha === '2026-12-08');
  assert.ok(el8 && el8.estado === 'pendiente' && el8.motivos.some((m) => m.codigo === 'cierre_dia'), JSON.stringify(el8));
});
t('días con aviso: advierte; con "evitar" quedan pendientes', () => {
  const avisos = [{ desde: '2026-12-03', hasta: '2026-12-04', texto: 'Cristina no viene' }];
  const a = prepararCopiaSeleccion(ctxDe({ avisos }), {});
  const d3 = a.items.filter((i) => i.fecha === '2026-12-03');
  assert.ok(d3.length && d3.every((i) => i.estado === 'crear' && i.advertencias.some((x) => /Cristina no viene/.test(x.texto))));
  const b = prepararCopiaSeleccion(ctxDe({ avisos, evitarAvisos: true }), {});
  assert.ok(b.items.filter((i) => i.fecha === '2026-12-03').every((i) => i.estado === 'pendiente' && i.motivos.some((m) => m.codigo === 'aviso_grilla')));
  assert.ok(b.items.some((i) => i.fecha === '2026-12-10' && i.estado === 'crear'), 'los demás días no cambian');
});
console.log(`\n${n} pruebas OK — selección al duplicar`);
