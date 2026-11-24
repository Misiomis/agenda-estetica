// node tests/duplicar-mes/reprogramar.mjs — sugerencias para reprogramar un turno suspendido
import assert from 'node:assert/strict';
import { sugerirReprogramaciones, ocupacionDesdeReservas, normalizarBloqueos } from '../../js/duplicar-mes.js';

let n = 0; const t = (d, fn) => { fn(); n++; console.log('✓', d); };
const BOXES = [{ id: 'b1', label: 'Box 4' }, { id: 'b4', label: 'Box 2' }, { id: 'b3', label: 'Box 3' }, { id: 'b2', label: 'Box 5' }];
const SERV = { Corporal: { duracionMin: 60, boxes: ['b1', 'b4'] }, Facial: { duracionMin: 60, boxes: ['b3'] } };
const R = (id, dni, fecha, hora, box, servicio = 'Corporal') => ({ id, dni, nombre: 'P' + dni, fecha, hora, box, servicio, duracionMinutos: 60, estado: 'confirmado' });
const ctxDe = (reservas, extra = {}) => {
  const c = { boxes: BOXES, servicios: SERV, pacientes: {}, bloqueos: [], desbloqueos: [], esActiva: (r) => !/cancel/.test(r.estado || ''), boxDe: (r) => r.box, duracionDe: (r) => r.duracionMinutos, ...extra };
  c.ocupacion = ocupacionDesdeReservas(reservas, c); return c;
};
// Luis C: miércoles 25/11/2026 10:00 en b1 — suspende hoy.
const luis = { id: 'L', fecha: '2026-11-25', hora: '10:00', dur: 60, boxId: 'b1', dni: '1', servicio: 'Corporal', categoria: 'corporal' };

t('suspende hoy → sugiere mañana, mismo horario y mismo box', () => {
  const r = sugerirReprogramaciones(ctxDe([R('L', '1', '2026-11-25', '10:00', 'b1')]), luis, { desde: '2026-11-26' });
  assert.deepEqual({ f: r.sugerida.fecha, h: r.sugerida.hora, b: r.sugerida.boxId }, { f: '2026-11-26', h: '10:00', b: 'b1' });
});
t('el turno que se mueve no se bloquea a sí mismo', () => {
  const r = sugerirReprogramaciones(ctxDe([R('L', '1', '2026-11-26', '10:00', 'b1')]), { ...luis, fecha: '2026-11-26' }, { desde: '2026-11-26' });
  assert.equal(r.sugerida.fecha, '2026-11-26');
});
t('mañana su box está ocupado → otro box compatible ese mismo día', () => {
  const r = sugerirReprogramaciones(ctxDe([R('X', '9', '2026-11-26', '10:00', 'b1')]), luis, { desde: '2026-11-26' });
  assert.deepEqual([r.sugerida.fecha, r.sugerida.boxId, r.sugerida.mismoBox], ['2026-11-26', 'b4', false]);
});
t('ningún box compatible libre mañana → pasa al día siguiente', () => {
  const r = sugerirReprogramaciones(ctxDe([R('X', '9', '2026-11-26', '10:00', 'b1'), R('Y', '8', '2026-11-26', '10:30', 'b4')]), luis, { desde: '2026-11-26' });
  assert.equal(r.sugerida.fecha, '2026-11-27');
});
t('la paciente ya tiene otro turno a esa hora → no lo sugiere', () => {
  const r = sugerirReprogramaciones(ctxDe([R('Z', '1', '2026-11-26', '10:00', 'b3', 'Facial')]), luis, { desde: '2026-11-26' });
  assert.notEqual(r.sugerida.fecha, '2026-11-26');
});
t('día cerrado → lo saltea', () => {
  const { bloqueos } = normalizarBloqueos([{ id: 'c', fecha: '2026-11-26', blocked: true, source: 'admin' }]);
  const r = sugerirReprogramaciones(ctxDe([], { bloqueos }), luis, { desde: '2026-11-26' });
  assert.equal(r.sugerida.fecha, '2026-11-27');
});
t('domingo no se sugiere', () => {
  const r = sugerirReprogramaciones(ctxDe([]), { ...luis, fecha: '2026-11-28' }, { desde: '2026-11-29' });
  assert.equal(r.sugerida.fecha, '2026-11-30');
  assert.ok(!r.opciones.some((o) => o.fecha === '2026-11-29'));
});
t('día con aviso: se ofrece marcado, pero la sugerencia es el próximo sin aviso', () => {
  const r = sugerirReprogramaciones(ctxDe([], { avisos: [{ desde: '2026-11-26', hasta: '2026-11-26', texto: 'Cristina no viene' }] }), luis, { desde: '2026-11-26' });
  assert.equal(r.opciones[0].fecha, '2026-11-26'); assert.equal(r.opciones[0].aviso, 'Cristina no viene');
  assert.equal(r.sugerida.fecha, '2026-11-27');
});
t('servicio facial solo en su box (b3)', () => {
  const r = sugerirReprogramaciones(ctxDe([R('X', '9', '2026-11-26', '10:00', 'b3', 'Facial')]), { ...luis, servicio: 'Facial', boxId: 'b3' }, { desde: '2026-11-26' });
  assert.deepEqual([r.sugerida.fecha, r.sugerida.boxId], ['2026-11-27', 'b3']);
});
t('fuera de horario (22:30) → sin opciones', () => {
  const r = sugerirReprogramaciones(ctxDe([]), { ...luis, hora: '22:30' }, { desde: '2026-11-26', dias: 5 });
  assert.equal(r.sugerida, null); assert.equal(r.opciones.length, 0);
});
console.log(`\n${n} pruebas OK — reprogramar`);
