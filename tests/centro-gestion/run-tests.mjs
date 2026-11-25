// node tests/centro-gestion/run-tests.mjs
import assert from 'node:assert/strict';
import {
  construirPacientes, estadoEnMes, controlAgenda, compararMeses, filtrarPacientes, posiblesDuplicados,
  resumenDuplicacion, sumarMeses, difMeses, rangoMeses, aCSV, estadisticas, coincideTexto, fechaISO,
} from '../../js/centro-gestion.js';

let n = 0;
const t = (nombre, fn) => { fn(); n++; console.log('✓', nombre); };
const HOY = '2026-11-19';
let id = 0;
const R = (dni, fecha, extra = {}) => ({ id: 'r' + (++id), dni, nombreLimpio: extra.nombre || ('Paciente ' + dni), fecha, hora: '10:00', servicio: 'Facial', box: 'b1', ...extra });
const ctx = (reservas, fichas = []) => construirPacientes({
  reservas, fichas, hoy: HOY, ahora: '12:00',
  claveDe: (r) => (r.dni ? 'dni:' + String(r.dni).replace(/\D/g, '') : 'nom:' + (r.nombreLimpio || '').toLowerCase()),
  claveFicha: (f) => 'dni:' + String(f.dni).replace(/\D/g, ''),
  esActiva: (r) => !/cancel/.test(r.estado || ''), esBloqueo: (r) => r.tipo === 'bloqueo', boxDe: (r) => ({ b1: 'Box 1', b2: 'Box 2' })[r.box] || '',
});
const buscar = (ps, dni) => ps.find((p) => p.dni === dni);
const nombres = (lista) => lista.map((f) => (f.p || f).dni).sort();

const reservas = [
  // A: septiembre, no noviembre
  R('100', '2026-09-03'), R('100', '2026-09-17'),
  // B: empieza en octubre, no está en septiembre ni noviembre
  R('200', '2026-10-08'), R('200', '2026-10-22'),
  // D: tres sesiones en noviembre (+ octubre) → F también (oct y nov)
  R('300', '2026-10-01'), R('300', '2026-11-05'), R('300', '2026-11-12'), R('300', '2026-11-26'),
  // E: suspensión formal (estuvo en octubre)
  R('500', '2026-10-10'),
  // G: solo turnos cancelados en noviembre
  R('600', '2026-10-15'), R('600', '2026-11-10', { estado: 'cancelada' }),
  // bloqueo del admin: no es paciente
  { id: 'blq', fecha: '2026-11-20', hora: '09:00', tipo: 'bloqueo', nombreLimpio: 'BLOQUEO' },
  // H: diciembre 2026 / enero 2027
  R('800', '2026-12-04'), R('800', '2027-01-08'), R('900', '2026-12-11'),
  // muy viejo: solo marzo → en revisión
  R('700', '2026-03-01'),
];
const fichas = [
  { dni: '400', fullName: 'Nueva Noviembre', createdAt: '2026-11-03' }, // C: ficha nueva en noviembre sin turno
  { dni: '500', fullName: 'Suspendida Formal', seguimiento: { estado: 'suspendido', desde: '2026-11-01', motivo: 'viaje' } },
  { dni: '300', fullName: 'Tres Sesiones', createdAt: { seconds: Date.UTC(2026, 9, 1, 12) / 1000 } },
  { dni: '12.345.678', fullName: 'Ana Pérez' }, { dni: '12345678', fullName: 'Pérez Ana' }, // J
];
const P = ctx(reservas, fichas);

t('meses cruzan el año', () => {
  assert.equal(sumarMeses('2026-12', 1), '2027-01');
  assert.equal(sumarMeses('2027-01', -2), '2026-11');
  assert.equal(difMeses('2026-12', '2027-01'), 1);
  assert.deepEqual(rangoMeses('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02']);
  assert.equal(fechaISO({ seconds: Date.UTC(2026, 9, 1, 12) / 1000 }), '2026-10-01');
});

t('bloqueos no son pacientes', () => assert.ok(!P.some((p) => /BLOQUEO/.test(p.nombre))));

t('CASO A: septiembre ausente en noviembre (referencia septiembre)', () => {
  const c = controlAgenda(P, { mesDestino: '2026-11', referencia: ['2026-09'] });
  assert.ok(nombres(c.ausentesPorMes['2026-09']).includes('100'));
  assert.equal(c.filas.find((f) => f.p.dni === '100').estado, 'sin_agendar');
  assert.equal(estadoEnMes(buscar(P, '700'), '2026-11').estado, 'en_revision');
});

t('CASO B: empezó en octubre, duplicar sep→nov lo detecta sin turnos en noviembre', () => {
  const lote = { loteId: 'L1', origen: { anio: 2026, mes: 9 }, destino: { anio: 2026, mes: 11 }, aCrear: [{ id: 'x', dni: '100' }], aPendiente: [], resultado: { creadas: ['x'], yaExistian: [] } };
  const r = resumenDuplicacion(lote, P, { nombreDe: (d) => 'N' + d });
  assert.ok(nombres(r.posterioresSinTurno).includes('200'));
  assert.ok(!nombres(r.posterioresSinTurno).includes('300'), 'el de oct que sí tiene noviembre no va');
  assert.equal(estadoEnMes(buscar(P, '200'), '2026-11').estado, 'sin_agendar');
});

t('CASO C: nuevo de noviembre sin turno → nuevo y sin agendar', () => {
  const c = controlAgenda(P, { mesDestino: '2026-11' });
  assert.ok(nombres(c.cats.nuevosDestinoSinAgendar).includes('400'));
  assert.equal(buscar(P, '400').incorporacion.criterio, 'registro');
  assert.ok(nombres(c.cats.registradosSinTurnos).includes('400'));
});

t('CASO D: tres sesiones = un paciente, tres sesiones', () => {
  const c = controlAgenda(P, { mesDestino: '2026-11' });
  const f = c.filas.filter((x) => x.p.dni === '300');
  assert.equal(f.length, 1);
  assert.equal(f[0].activas, 3);
  assert.equal(f[0].estado, 'agendado');
  const cmp = compararMeses(P, ['2026-11']);
  assert.equal(cmp.totales['2026-11'].sesiones, 3);
  assert.equal(cmp.totales['2026-11'].pacientes, 1);
});

t('CASO E: suspensión formal ≠ ausente', () => {
  const c = controlAgenda(P, { mesDestino: '2026-11' });
  assert.ok(nombres(c.cats.suspendidos).includes('500'));
  assert.ok(!nombres(c.cats.pendientes).includes('500'));
  assert.ok(!nombres(c.cats.suspendidos).includes('200'), 'la ausencia no se vuelve suspensión');
});

t('CASO F: octubre y noviembre no es ausente de noviembre', () => {
  const c = controlAgenda(P, { mesDestino: '2026-11' });
  assert.ok(!nombres(c.ausentesPorMes['2026-10']).includes('300'));
  assert.ok(nombres(c.ausentesPorMes['2026-10']).includes('200'));
});

t('CASO G: solo cancelados en noviembre se distingue', () => {
  const e = estadoEnMes(buscar(P, '600'), '2026-11');
  assert.equal(e.estado, 'sin_agendar');
  assert.equal(e.soloCanceladas, true);
  const c = controlAgenda(P, { mesDestino: '2026-11' });
  assert.ok(nombres(c.cats.canceladasSinReprogramar).includes('600'));
  assert.ok(!nombres(c.cats.conTurnos).includes('600'));
});

t('CASO H: diciembre 2026 frente a enero 2027', () => {
  const cmp = compararMeses(P, ['2027-01', '2026-12']);
  assert.deepEqual(cmp.meses, ['2026-12', '2027-01']);
  assert.deepEqual(nombres(cmp.enTodos), ['800']);
  assert.deepEqual(nombres(cmp.perdidos), ['900']);
  const c = controlAgenda(P, { mesDestino: '2027-01' });
  assert.deepEqual(c.referencia, ['2026-11', '2026-12']);
  assert.ok(nombres(c.ausentesPorMes['2026-12']).includes('900'));
});

t('CASO I: el listado coincide con los filtros (CSV)', () => {
  const filas = filtrarPacientes(P, { nuevosEn: ['2026-10'], ausentesEn: ['2026-11'] }, { hoy: HOY });
  assert.deepEqual(nombres(filas), ['200', '500', '600']);
  const csv = aCSV([{ titulo: 'DNI', valor: (f) => f.p.dni }], filas);
  assert.equal(csv.replace('﻿', '').split('\r\n').length, 1 + filas.length);
});

t('CASO J: mismo DNI con formato distinto → posible duplicado, sin modificar', () => {
  const copia = JSON.stringify(fichas);
  const d = posiblesDuplicados(fichas.map((f) => ({ ...f, _clave: 'dni:' + String(f.dni).replace(/[^0-9]/g, '') })), P);
  const g = d.find((x) => x.miembros.some((m) => m.dni === '12.345.678'));
  assert.ok(g && g.motivos.includes('mismo DNI'));
  assert.equal(JSON.stringify(fichas), copia);
  assert.ok(!d.some((x) => x.miembros.every((m) => m.dni === '300')), 'varias sesiones no son duplicado');
});

t('CASO K: lote con turnos ya existentes en destino no se cuentan como copiados', () => {
  const lote = { origen: { anio: 2026, mes: 10 }, destino: { anio: 2026, mes: 11 }, aCrear: [{ id: 'a', dni: '300' }, { id: 'b', dni: '600' }], aPendiente: [{ dni: '200', motivos: ['box_ocupado'] }, { dni: '500', motivos: ['bloqueo_box'] }], resultado: { creadas: ['b'], yaExistian: ['a'] } };
  const r = resumenDuplicacion(lote, P, {});
  assert.deepEqual(r.pacientesCopiados.map((x) => x.dni), ['600']);
  assert.deepEqual(r.pacientesYaEnDestino.map((x) => x.dni), ['300']);
  assert.deepEqual(r.conflictos.map((x) => x.dni), ['200']);
  assert.deepEqual(r.porBloqueos.map((x) => x.dni), ['500']);
});

t('búsqueda parcial sin tildes ni mayúsculas', () => {
  const ps = ctx([R('1', '2026-11-02', { nombre: 'Romina Benítez' }), R('2', '2026-11-02', { nombre: 'Rosa Paz' })]);
  assert.deepEqual(ps.filter((p) => coincideTexto(p, 'romi')).map((p) => p.dni), ['1']);
  assert.deepEqual(ps.filter((p) => coincideTexto(p, 'BENITEZ')).map((p) => p.dni), ['1']);
  assert.deepEqual(ps.filter((p) => coincideTexto(p, '02/11')).length, 2);
});

t('filtros combinables: sin sesiones hace 30 días, retomaron, sin futuros', () => {
  const ps = ctx([R('1', '2026-06-01'), R('1', '2026-09-20'), R('2', '2026-11-18'), R('3', '2026-10-01'), R('3', '2026-12-01')]);
  assert.deepEqual(nombres(filtrarPacientes(ps, { sinSesionesDias: 30 }, { hoy: HOY })), ['1']);
  assert.deepEqual(nombres(filtrarPacientes(ps, { retomaron: true, diasRetomo: 45 }, { hoy: HOY })), ['1', '3']);
  assert.deepEqual(nombres(filtrarPacientes(ps, { sinFuturos: true, periodo: { meses: ['2026-09', '2026-11'] } }, { hoy: HOY })), ['1', '2']);
  const st = estadisticas(filtrarPacientes(ps, {}, { hoy: HOY }), { hoy: HOY, mes: '2026-11' });
  assert.equal(st.unicos, 3); assert.equal(st.programadas, 5); assert.equal(st.pendientes, 1);
});

t('plan con turnos por mes → parcialmente agendado; vigencia vencida → finalizado', () => {
  const ps = ctx([R('1', '2026-11-03'), R('2', '2026-09-03')], [
    { dni: '1', fullName: 'Plan Cuatro', planificacion: { frecuencia: { totalPrevisto: 4, alcance: 'mes' } } },
    { dni: '2', fullName: 'Plan Vencido', planificacion: { vigencia: { hasta: '2026-09-30' } } },
  ]);
  assert.equal(estadoEnMes(buscar(ps, '1'), '2026-11').estado, 'parcial');
  assert.equal(estadoEnMes(buscar(ps, '2'), '2026-11').estado, 'finalizado');
});

console.log(`\n${n} pruebas OK — centro de gestión`);

// ── Control de cantidades entre meses ──
import('../../js/centro-gestion.js').then(({ compararCantidades, textoDif }) => {
  let k = 0; const tt = (d, fn) => { fn(); k++; console.log('✓', d); };
  const ps = ctx([
    ...['2026-10-01', '2026-10-08', '2026-10-15'].map((f) => R('7001', f, { nombre: 'Adriana Cerri' })),
    ...['2026-11-05', '2026-11-12'].map((f) => R('7001', f, { nombre: 'Adriana Cerri' })),
    ...Array.from({ length: 9 }, (_, i) => R('7002', `2026-10-${String(i + 1).padStart(2, '0')}`, { nombre: 'Agnesse' })),
    ...Array.from({ length: 10 }, (_, i) => R('7002', `2026-11-${String(i + 1).padStart(2, '0')}`, { nombre: 'Agnesse' })),
    R('7003', '2026-10-03', { nombre: 'Igual' }), R('7003', '2026-11-03', { nombre: 'Igual' }),
    R('7004', '2026-10-03', { nombre: 'Cancelo' }), R('7004', '2026-11-03', { nombre: 'Cancelo', estado: 'cancelada' }),
    R('7005', '2026-11-20', { nombre: 'Nueva' }),
  ]);
  const r = compararCantidades(ps, ['2026-11', '2026-10']);
  const de = (dni) => r.filas.find((f) => f.p.dni === dni);
  tt('base = el primer mes (octubre)', () => assert.equal(r.base, '2026-10'));
  tt('Adriana: 3 en octubre, 2 en noviembre → falta 1', () => { assert.equal(de('7001').difs['2026-11'], -1); assert.equal(de('7001').estado, 'faltan'); assert.equal(textoDif(-1), 'falta 1'); });
  tt('Agnesse: 9 → 10 → 1 de más', () => { assert.equal(de('7002').difs['2026-11'], 1); assert.equal(de('7002').estado, 'sobran'); assert.equal(textoDif(1), '1 de más'); });
  tt('cancelada no cuenta → falta 1', () => assert.equal(de('7004').difs['2026-11'], -1));
  tt('igual → sin marca; nueva → aparte', () => { assert.equal(de('7003').estado, 'igual'); assert.equal(de('7005').estado, 'nuevo'); });
  tt('primero los que tienen faltantes', () => assert.equal(r.filas[0].estado, 'faltan'));
  tt('resumen', () => { assert.equal(r.resumen.sesionesFaltantes, 2); assert.equal(r.resumen.sesionesSobrantes, 1); assert.equal(r.resumen.iguales, 1); });
  tt('base elegida (noviembre) invierte el signo', () => assert.equal(compararCantidades(ps, ['2026-10', '2026-11'], { base: '2026-11' }).filas.find((f) => f.p.dni === '7002').difs['2026-10'], -1));
  console.log(`${k} pruebas OK — control de cantidades`);
});
