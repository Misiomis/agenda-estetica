// node tests/notas-jornada/run-tests.mjs
import assert from 'node:assert/strict';
import { notasDeTurno, guiasDeTurno, filasNotasDelDia, limpiarNota } from '../../js/notas-jornada.js';

let n = 0; const t = (d, fn) => { fn(); n++; console.log('✓', d); };
const claveDe = (r) => (r.dni ? 'dni:' + r.dni : 'nom:' + (r.nombre || '').toLowerCase());
const esActiva = (r) => !/cancel/.test(r.estado || '');
const R = (id, dni, nombre, fecha, hora, extra = {}) => ({ id, dni, nombre, fecha, hora, servicio: 'Facial', ...extra });

const todas = [
  R('oct', '1', 'Ana Paz', '2026-10-14', '10:00', { detalleSesion: 'GUÍA: usar crema X.\nNo exfoliar zona T.' }),
  R('oct2', '1', 'Ana Paz', '2026-10-21', '10:00', { notaRapida: 'Trae su toalla' }),
  R('dup', '1', 'Ana Paz', '2026-10-28', '10:00', { detalleSesion: 'guía: usar crema x. no exfoliar zona t.' }), // misma nota con otro formato
  R('nov', '1', 'Ana Paz', '2026-11-24', '10:00', { notaRapida: 'Hoy llega 10 min tarde', detalleSesion: '' }),
  R('nov2', '1', 'Ana Paz', '2026-11-24', '16:00'),                                              // 2.º turno mismo día, sin notas
  R('homo', '2', 'Ana Paz', '2026-10-01', '09:00', { detalleSesion: 'Nota de OTRA Ana Paz' }),  // homónima
  R('canc', '1', 'Ana Paz', '2026-09-01', '09:00', { estado: 'cancelada', detalleSesion: 'Nota de turno cancelado' }),
  R('sin', '3', 'Sin Notas', '2026-11-24', '11:00'),
];

t('limpia saltos de línea y espacios sin perder el formato', () => {
  assert.equal(limpiarNota('a  \r\nb\n\n\n\nc  '), 'a\nb\n\nc');
});
t('notas propias del turno: interna y de sesión, rotuladas y sin vacías', () => {
  assert.deepEqual(notasDeTurno(todas[3]), [{ tipo: 'interna', texto: 'Hoy llega 10 min tarde' }]);
  assert.deepEqual(notasDeTurno(todas[4]), []);
});
t('guías: la de octubre aparece completa, con fecha, más reciente primero', () => {
  const g = guiasDeTurno(todas[3], todas, { claveDe, esActiva });
  assert.deepEqual(g.map((x) => x.fecha), ['2026-11-24', '2026-10-28', '2026-10-21'].filter((f) => g.some((x) => x.fecha === f)));
  const oct = g.find((x) => /usar crema/i.test(x.texto));
  assert.equal(oct.texto, 'guía: usar crema x. no exfoliar zona t.'.length ? oct.texto : '');
  assert.ok(g.some((x) => x.texto === 'Trae su toalla' && x.fecha === '2026-10-21' && x.tipo === 'interna'));
});
t('la misma nota recuperada dos veces no se repite', () => {
  const g = guiasDeTurno(todas[3], todas, { claveDe, esActiva });
  assert.equal(g.filter((x) => /usar crema/i.test(x.texto)).length, 1);
});
t('homónimo con otro DNI: no se mezclan sus notas', () => {
  const g = guiasDeTurno(todas[3], todas, { claveDe, esActiva });
  assert.ok(!g.some((x) => /OTRA Ana/.test(x.texto)));
});
t('turnos cancelados no aportan guías', () => {
  assert.ok(!guiasDeTurno(todas[3], todas, { claveDe, esActiva }).some((x) => /cancelado/.test(x.texto)));
});
t('dos turnos de la misma persona el mismo día: cada uno con lo suyo', () => {
  const g2 = guiasDeTurno(todas[4], todas, { claveDe, esActiva });
  assert.ok(g2.some((x) => x.texto === 'Hoy llega 10 min tarde' && x.fecha === '2026-11-24'), 'la nota del turno de la mañana es guía del de la tarde');
  const g1 = guiasDeTurno(todas[3], todas, { claveDe, esActiva });
  assert.ok(!g1.some((x) => x.texto === 'Hoy llega 10 min tarde'), 'pero no se repite como guía en su propio turno');
});
t('filas del PDF: repiten hora y paciente en cada fila, sin filas para turnos sin notas', () => {
  const dia = todas.filter((x) => x.fecha === '2026-11-24');
  const f = filasNotasDelDia(dia, todas, { claveDe, esActiva, nombreDe: (r) => r.nombre, boxDe: () => 'Box 3' });
  assert.ok(f.every((x) => x.hora && x.paciente));
  assert.ok(!f.some((x) => x.paciente === 'Sin Notas'));
  assert.equal(f[0].rotulo, 'Nota interna (este turno)');
  assert.ok(f.some((x) => /^Guía del 28\/10\/2026 — nota de la sesión$/.test(x.rotulo)));
  assert.ok(f.findIndex((x) => x.hora === '16:00') > f.findIndex((x) => x.hora === '10:00'), 'ordenado por hora');
});
console.log(`\n${n} pruebas OK — notas de jornada`);
