// node tests/duplicar-mes/run-tests.js   (datos 100% sintéticos)
import {
  prepararDuplicacion, evaluarOcurrencia, buscarAlternativas, normalizarBloqueos, ocupacionDesdeReservas,
  diaSemana, sumarDias, diasDelMes, nesimoDiaSemana, parsearNesimo, idReservaDe, claveOcurrencia, tieneBloqueoProtegido, motivosInsalvables,
} from '../../js/duplicar-mes.js';

let fails = 0;
const check = (desc, cond, extra) => { console.log((cond ? '  OK  ' : '  FAIL ') + desc); if (!cond) { fails++; if (extra !== undefined) console.log('       →', JSON.stringify(extra)); } };

const BOXES = [{ id: 'b1', label: 'Box 1' }, { id: 'b2', label: 'Box 2' }, { id: 'b3', label: 'Box 3' }, { id: 'b4', label: 'Box 4' }];
const SERV = { 'Corporal X': { duracionMin: 60, boxes: ['b1', 'b2'] }, 'Facial X': { duracionMin: 60, boxes: ['b3'] }, 'Relax X': { duracionMin: 45, boxes: ['b4'] } };
let _id = 0;
const R = (dni, fecha, hora, servicio = 'Corporal X', box = 'b1', extra = {}) => ({ id: `r${++_id}`, dni, nombre: `Paciente ${dni}`, fecha, hora, servicio, duracionMinutos: (SERV[servicio] || {}).duracionMin || 60, box, estado: 'confirmado', ...extra });
const pacientes = (extra = {}) => ({ '1': { dni: '1', fullName: 'Ana Uno' }, '2': { dni: '2', fullName: 'Bea Dos' }, '3': { dni: '3', fullName: 'Cira Tres' }, ...extra });
const armar = (reservas, o = {}) => ({
  origen: { anio: 2026, mes: 9 }, destino: { anio: 2026, mes: 10 }, reservas, pacientes: pacientes(o.pacientes), servicios: SERV, boxes: BOXES,
  bloqueos: o.bloqueos || [], desbloqueos: o.desbloqueos || [], pendientes: o.pendientes || [], decisiones: o.decisiones,
  esActiva: (r) => !/cancel/i.test(r.estado || ''), boxDe: (r) => r.box, duracionDe: (r) => r.duracionMinutos || 30,
});
const semanal = (dni, dow, hora, fechas, servicio, box) => fechas.map((f) => R(dni, f, hora, servicio, box));
const LUN_SEP = ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28'];
const VIE_SEP = ['2026-09-04', '2026-09-11', '2026-09-18', '2026-09-25'];
const MIE_SEP = ['2026-09-02', '2026-09-09', '2026-09-16', '2026-09-23', '2026-09-30'];
const MAR_SEP = ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29'];
const fechasDe = (res, estado = 'crear') => res.items.filter((i) => i.estado === estado).map((i) => i.fecha);
const bloqueoBox = (id, fecha, hora, boxId, extra = {}) => ({ id, fecha, hora, boxId, source: 'admin', adminBlocked: true, ...extra });

console.log('\n=== Fechas ===');
{
  check('5 de octubre de 2026 es lunes; 1 de septiembre es martes', diaSemana('2026-10-05') === 1 && diaSemana('2026-09-01') === 2);
  check('sumar días cruza el mes y el año sin desfasarse', sumarDias('2026-09-28', 7) === '2026-10-05' && sumarDias('2026-12-30', 3) === '2027-01-02');
  check('octubre 2026 tiene 31 días', diasDelMes(2026, 10).length === 31);
  check('segundo lunes de octubre 2026 = 12', nesimoDiaSemana(2026, 10, 1, 2) === '2026-10-12');
  check('parsea "segundo lunes del mes"', JSON.stringify(parsearNesimo('segundo lunes del mes')) === JSON.stringify({ n: 2, dow: 1 }));
}

console.log('\n=== Pauta semanal ===');
{
  const res = prepararDuplicacion(armar(semanal('1', 1, '09:30', LUN_SEP)));
  check('todos los lunes de septiembre → los 4 lunes de octubre, misma hora', JSON.stringify(fechasDe(res)) === JSON.stringify(['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']) && res.items.every((i) => i.hora === '09:30' && i.dur === 60 && i.boxId === 'b1'));
  check('el número del día del mes NO se copia (los días caen en lunes)', res.items.every((i) => diaSemana(i.fecha) === 1));
  const vie = prepararDuplicacion(armar(semanal('1', 5, '10:00', VIE_SEP)));
  check('4 viernes en septiembre y 5 en octubre → se considera el quinto', fechasDe(vie).length === 5 && fechasDe(vie).includes('2026-10-30'));
  const mar = prepararDuplicacion(armar(semanal('1', 2, '10:00', MAR_SEP)));
  check('5 martes en septiembre y 4 en octubre → no se arrastra el sobrante', fechasDe(mar).length === 4 && fechasDe(mar).every((f) => f.startsWith('2026-10')));
  const cerrada = prepararDuplicacion(armar(semanal('1', 5, '10:00', ['2026-09-04', '2026-09-11', '2026-09-25'])));
  check('septiembre sin el viernes 18 (cierre) → octubre igual genera todos los viernes desde la pauta', fechasDe(cerrada).length === 5);
  check('la ocurrencia sin espejo dice "pauta" (no inventa origen)', cerrada.items.find((i) => i.fecha === '2026-10-16').origen.tipo === 'pauta' && cerrada.items.find((i) => i.fecha === '2026-10-09').origen.tipo === 'reserva');
  const alt = prepararDuplicacion(armar([...semanal('1', 1, '09:00', LUN_SEP), R('1', '2026-09-16', '17:00', 'Corporal X', 'b1')]));
  check('una reubicación excepcional (miércoles 17:00) no reemplaza la pauta ni se copia', fechasDe(alt).every((f) => diaSemana(f) === 1) && alt.origenExplicado.find((o) => o.hora === '17:00').categoria === 'excepcion_historica');
}

console.log('\n=== Frecuencia y cupos ===');
{
  const tres = [...semanal('1', 1, '09:00', LUN_SEP), ...semanal('1', 3, '09:00', ['2026-09-02', '2026-09-09', '2026-09-16', '2026-09-23']), ...semanal('1', 5, '09:00', VIE_SEP)];
  const conPref = { '1': { dni: '1', fullName: 'Ana Uno', planificacion: { preferencias: { tratamientos: [{ tratamiento: 'corporal', frecuencia: { cantidad: 2, periodo: 'semana', texto: '2 veces por semana' } }] } } } };
  const res = prepararDuplicacion(armar(tres, { pacientes: conPref }));
  const porSemana = {}; res.items.filter((i) => i.estado === 'crear').forEach((i) => { const s = i.fecha; const w = Math.floor((Date.parse(s) / 86400000 + 3) / 7); porSemana[w] = (porSemana[w] || 0) + 1; });
  check('tres días con sesiones pero frecuencia de dos por semana → nunca más de dos por semana', Math.max(...Object.values(porSemana)) <= 2, porSemana);
  check('la tercera pauta queda explicada como alternativa (no se pierde)', res.origenExplicado.filter((o) => o.categoria === 'excepcion_historica').length >= 4);
  const objetivo = { '1': { dni: '1', fullName: 'Ana Uno', planificacion: { frecuencia: { totalPrevisto: 4, alcance: 'mes' } } } };
  const cupo = prepararDuplicacion(armar(semanal('1', 5, '10:00', VIE_SEP), { pacientes: objetivo }));
  check('objetivo de 4 al mes con 5 viernes → crea 4 y el quinto queda "fuera del cupo"', fechasDe(cupo).length === 4 && fechasDe(cupo, 'fuera_cupo').length === 1 && cupo.items.find((i) => i.estado === 'fuera_cupo').motivos[0].codigo === 'fuera_cupo');
  const conExistente = prepararDuplicacion(armar([...semanal('1', 5, '10:00', VIE_SEP), R('1', '2026-10-02', '10:00', 'Corporal X', 'b1')], { pacientes: objetivo }));
  check('las citas ya existentes del destino cuentan para el objetivo (no se excede)', fechasDe(conExistente).length === 3 && conExistente.resumen.yaCubiertas === 1);
  const sinPref = prepararDuplicacion(armar(semanal('2', 1, '11:00', LUN_SEP)));
  check('sin preferencias cargadas se usa la agenda habitual (no se excluye)', fechasDe(sinPref).length === 4);
  const nes = { '1': { dni: '1', fullName: 'Ana Uno', planificacion: { preferencias: { tratamientos: [{ tratamiento: 'corporal', frecuencia: { cantidad: 1, periodo: 'mes', texto: 'segundo lunes del mes' } }] } } } };
  const segundo = prepararDuplicacion(armar([R('1', '2026-09-14', '18:00')], { pacientes: nes }));
  check('"segundo lunes del mes" → solo el 12/10, no todos los lunes', JSON.stringify(fechasDe(segundo)) === JSON.stringify(['2026-10-12']));
  const cada15 = { '1': { dni: '1', fullName: 'Ana Uno', planificacion: { preferencias: { tratamientos: [{ tratamiento: 'facial', frecuencia: { cadaDias: 15, texto: 'cada 15 días' } }] } } } };
  const base = [R('1', '2026-09-24', '19:00', 'Facial X', 'b3')];
  const ambigua = prepararDuplicacion(armar(base, { pacientes: cada15 }));
  check('"cada 15 días" sin criterio → "Definir frecuencia" (no crea, no convierte en otra regla)', ambigua.items.length === 0 && ambigua.porDefinir.length === 1 && ambigua.porDefinir[0].tipo === 'definir_frecuencia');
  const exactos = prepararDuplicacion(armar(base, { pacientes: cada15, decisiones: { global: { cadaNDias: 'dias_exactos' }, patrones: {}, items: {} } }));
  check('15 días exactos desde la última fecha, cruzando el límite del mes', JSON.stringify(fechasDe(exactos)) === JSON.stringify(['2026-10-09', '2026-10-24']), fechasDe(exactos));
  const alternas = prepararDuplicacion(armar(base, { pacientes: cada15, decisiones: { global: { cadaNDias: 'semanas_alternas' }, patrones: {}, items: {} } }));
  check('semanas alternas: conserva el día de la semana y la fase', JSON.stringify(fechasDe(alternas)) === JSON.stringify(['2026-10-08', '2026-10-22']) && alternas.items.every((i) => diaSemana(i.fecha) === 4), fechasDe(alternas));
  const aislada = prepararDuplicacion(armar([R('3', '2026-09-10', '15:00')]));
  check('una reserva aislada NO se vuelve semanal sin evidencia: "Continuidad por definir" contabilizada', aislada.items.length === 0 && aislada.porDefinir.length === 1 && aislada.porDefinir[0].tipo === 'continuidad_por_definir' && aislada.origenExplicado.length === 1);
  const habitual = prepararDuplicacion(armar([R('3', '2026-09-10', '15:00')], { decisiones: { global: {}, patrones: { '3|corporal': { continuidad: 'habitual' } }, items: {} } }));
  const puntual = prepararDuplicacion(armar([R('3', '2026-09-10', '15:00')], { decisiones: { global: {}, patrones: { '3|corporal': { continuidad: 'puntual' } }, items: {} } }));
  check('indicada como habitual → semanal; como puntual → excepción histórica', fechasDe(habitual).length === 5 && fechasDe(puntual).length === 0 && puntual.origenExplicado[0].categoria === 'excepcion_historica');
  const finaliza = prepararDuplicacion(armar(semanal('1', 1, '09:00', LUN_SEP), { pacientes: { '1': { dni: '1', fullName: 'Ana Uno', planificacion: { vigencia: { hasta: '2026-10-12' } } } } }));
  check('una finalización explícita del tratamiento se respeta', JSON.stringify(fechasDe(finaliza)) === JSON.stringify(['2026-10-05', '2026-10-12']));
}

console.log('\n=== Bloqueos ===');
{
  const reservas = [...semanal('1', 1, '09:30', LUN_SEP, 'Corporal X', 'b2'), ...semanal('2', 1, '09:30', LUN_SEP, 'Corporal X', 'b1')];
  const prot = normalizarBloqueos([{ id: 'p1', fecha: '2026-10-12', hora: '09:30', boxId: 'b2', source: 'admin', adminBlocked: true, tipo: 'depilacion', motivo: 'Depilación' }, { id: 'p2', fecha: '2026-10-12', hora: '09:45', boxId: 'b2', source: 'admin', adminBlocked: true, tipo: 'depilacion' }, { id: 'p3', fecha: '2026-10-12', hora: '10:00', boxId: 'b2', source: 'admin', adminBlocked: true, tipo: 'depilacion' }, { id: 'p4', fecha: '2026-10-12', hora: '10:15', boxId: 'b2', source: 'admin', adminBlocked: true, tipo: 'depilacion' }]);
  const res = prepararDuplicacion(armar(reservas, { bloqueos: prot.bloqueos }));
  const b2 = res.items.filter((i) => i.boxId === 'b2');
  const pend = b2.find((i) => i.fecha === '2026-10-12');
  check('box 2 bloqueado por depilación: esa ocurrencia NO se crea y figura como pendiente', pend.estado === 'pendiente' && pend.motivos.some((m) => m.codigo === 'bloqueo_depilacion_protegido'));
  check('el resto de las ocurrencias del box 2 sí se crean', b2.filter((i) => i.estado === 'crear').length === 3);
  check('solo box 2 bloqueado: el box 1 mantiene su disponibilidad', res.items.filter((i) => i.boxId === 'b1').every((i) => i.estado === 'crear'));
  check('el bloqueo protegido no ofrece excepción', tieneBloqueoProtegido(pend.motivos) && motivosInsalvables(pend.motivos).length >= 1);
  const ctxAlt = { ...armar(reservas, { bloqueos: prot.bloqueos }), mesDestino: '2026-10', ocupacion: ocupacionDesdeReservas(reservas, armar(reservas)) };
  const alts = buscarAlternativas(ctxAlt, pend, { max: 12 });
  check('las alternativas nunca caen dentro del bloqueo protegido de box 2', alts.length > 0 && alts.every((a) => !(a.fecha === '2026-10-12' && a.boxId === 'b2' && a.hora >= '09:15' && a.hora < '10:30')));
  check('las alternativas indican qué cambia', alts.every((a) => a.cambios.length >= 1));
  const conAut = buscarAlternativas(ctxAlt, pend, { max: 12, incluirRestricciones: true });
  check('ni con la autorización de la paciente se supera el bloqueo protegido', conAut.every((a) => !(a.fecha === '2026-10-12' && a.boxId === 'b2' && a.hora >= '09:15' && a.hora < '10:30')));
  const indispuesta = evaluarOcurrencia({ ...ctxAlt, pacientes: pacientes({ '2': { dni: '2', fullName: 'Bea Dos', planificacion: { preferencias: { diasNoDisponibles: ['lunes'] } } } }) }, { fecha: '2026-10-12', hora: '09:30', dur: 60, boxId: 'b2', dni: '2', servicio: 'Corporal X', categoria: 'corporal', autoriza: { indisponible: true } });
  check('la autorización de la paciente quita solo su indisponibilidad, no el bloqueo', !indispuesta.motivos.some((m) => m.codigo === 'indisponible') && indispuesta.motivos.some((m) => m.codigo === 'bloqueo_depilacion_protegido'));

  const cierre = normalizarBloqueos([{ id: '2026-10-19', fecha: '2026-10-19', type: 'blocked', reason: 'Feriado' }]);
  const rc = prepararDuplicacion(armar(semanal('1', 1, '09:00', LUN_SEP), { bloqueos: cierre.bloqueos }));
  check('cierre total de la estética: ningún turno nuevo ese día', rc.items.find((i) => i.fecha === '2026-10-19').estado === 'pendiente' && rc.items.find((i) => i.fecha === '2026-10-19').motivos[0].codigo === 'cierre_dia' && !fechasDe(rc).includes('2026-10-19'));
  const parcial = normalizarBloqueos([bloqueoBox('x1', '2026-10-05', '10:00', 'b1')]);
  const rp = prepararDuplicacion(armar([R('1', '2026-09-28', '09:30', 'Corporal X', 'b1')], { bloqueos: parcial.bloqueos, decisiones: { global: {}, patrones: { '1|corporal': { continuidad: 'habitual' } }, items: {} } }));
  check('bloqueo parcial: la sesión 09:30–10:30 empieza antes pero se solapa → se rechaza', rp.items.find((i) => i.fecha === '2026-10-05').estado === 'pendiente');
  const justo = normalizarBloqueos([bloqueoBox('x2', '2026-10-05', '09:15', 'b1')]);
  const rj = prepararDuplicacion(armar([R('1', '2026-09-28', '09:30', 'Corporal X', 'b1')], { bloqueos: justo.bloqueos, decisiones: { global: {}, patrones: { '1|corporal': { continuidad: 'habitual' } }, items: {} } }));
  check('una cita que empieza justo cuando termina el bloqueo es válida', rj.items.find((i) => i.fecha === '2026-10-05').estado === 'crear');
  const tardio = evaluarOcurrencia({ ...ctxAlt, bloqueos: normalizarBloqueos([bloqueoBox('n1', '2026-10-05', '10:00', 'b1')]).bloqueos }, { fecha: '2026-10-05', hora: '09:30', dur: 60, boxId: 'b1', dni: '1', servicio: 'Corporal X', categoria: 'corporal' });
  check('un bloqueo agregado después de la vista previa se detecta al validar de nuevo (al guardar)', tardio.motivos.some((m) => m.codigo === 'bloqueo_box'));
  const fueraH = evaluarOcurrencia(ctxAlt, { fecha: '2026-10-05', hora: '20:30', dur: 60, boxId: 'b1', dni: '1', servicio: 'Corporal X', categoria: 'corporal' });
  check('una sesión que termina fuera del horario habitual se rechaza', fueraH.motivos.some((m) => m.codigo === 'fuera_horario'));
  const bloqEst = normalizarBloqueos([{ id: 'e1', fecha: '2026-10-05', hora: '09:30', blocked: true }]);
  check('bloqueo de estética (todos los boxes)', evaluarOcurrencia({ ...ctxAlt, bloqueos: bloqEst.bloqueos }, { fecha: '2026-10-05', hora: '09:30', dur: 60, boxId: 'b3', dni: '9', servicio: 'Facial X', categoria: 'facial' }).motivos.some((m) => m.codigo === 'bloqueo_estetica'));
  check('los documentos generados por las propias reservas no cuentan como bloqueos', normalizarBloqueos([{ id: 'a', fecha: '2026-10-05', hora: '09:30', blocked: true, tipo: 'reserva', reservaId: 'r1' }, { id: 'b', fecha: '2026-10-05', hora: '10:00', blocked: true, tipo: 'extension' }]).bloqueos.length === 0);
  const sinReglas = prepararDuplicacion(armar(semanal('1', 1, '09:30', LUN_SEP, 'Corporal X', 'b2')));
  check('sin bloqueos configurados no se inventan fechas de depilación', sinReglas.items.every((i) => i.estado === 'crear'));
}

console.log('\n=== Superposiciones, compatibilidad y validaciones ===');
{
  const otra = [...semanal('1', 1, '09:30', LUN_SEP, 'Corporal X', 'b1'), R('2', '2026-10-12', '10:00', 'Corporal X', 'b1')];
  const res = prepararDuplicacion(armar(otra));
  const it = res.items.find((i) => i.fecha === '2026-10-12');
  check('superposición con una reserva existente en el destino → pendiente (no se pisa)', it.estado === 'pendiente' && it.motivos.some((m) => m.codigo === 'box_ocupado'));
  const dos = prepararDuplicacion(armar([...semanal('1', 1, '09:30', LUN_SEP, 'Corporal X', 'b1'), ...semanal('2', 1, '10:00', LUN_SEP, 'Corporal X', 'b1')]));
  check('dos propuestas del mismo lote que se superponen: solo una se crea, la otra queda pendiente', dos.items.filter((i) => i.estado === 'crear').length + dos.items.filter((i) => i.estado === 'pendiente').length === 8 && dos.items.filter((i) => i.estado === 'pendiente').length >= 4);
  const mismoPaciente = prepararDuplicacion(armar([...semanal('1', 1, '09:30', LUN_SEP, 'Corporal X', 'b1'), R('1', '2026-10-05', '09:45', 'Facial X', 'b3')]));
  check('otra cita incompatible del mismo paciente a la misma hora → pendiente', mismoPaciente.items.find((i) => i.fecha === '2026-10-05' && i.categoria === 'corporal').motivos.some((m) => m.codigo === 'paciente_ocupado'));
  const incompat = evaluarOcurrencia({ ...armar([]), mesDestino: '2026-10', ocupacion: [], bloqueos: [], desbloqueos: [] }, { fecha: '2026-10-05', hora: '09:30', dur: 60, boxId: 'b4', dni: '1', servicio: 'Facial X', categoria: 'facial' });
  check('servicio incompatible con el box', incompat.motivos.some((m) => m.codigo === 'box_incompatible'));
  check('no se cambia de box en silencio: si el box habitual falla, queda pendiente', (() => { const r = prepararDuplicacion(armar([...semanal('1', 1, '09:30', LUN_SEP, 'Corporal X', 'b1'), R('2', '2026-10-05', '09:30', 'Corporal X', 'b1')])); const x = r.items.find((i) => i.dni === '1' && i.fecha === '2026-10-05'); return x.estado === 'pendiente' && x.boxId === 'b1'; })());
  const pref = prepararDuplicacion(armar(semanal('1', 1, '09:30', LUN_SEP), { pacientes: { '1': { dni: '1', fullName: 'Ana', planificacion: { preferencias: { diasNoDisponibles: ['lunes'] } } } } }));
  check('indisponibilidad explícita ("lunes NO") → todas las ocurrencias quedan pendientes con su motivo', pref.items.every((i) => i.estado === 'pendiente' && i.motivos[0].codigo === 'indisponible'));
  const flex = prepararDuplicacion(armar(semanal('1', 1, '09:30', LUN_SEP), { pacientes: { '1': { dni: '1', fullName: 'Ana', planificacion: { preferencias: { franjasGenerales: [{ dias: ['martes'] }] } } } } }));
  check('una preferencia flexible solo advierte, no bloquea', flex.items.every((i) => i.estado === 'crear' && i.advertencias.some((a) => a.codigo === 'fuera_preferencia')));
  const ausente = prepararDuplicacion(armar(semanal('1', 1, '09:30', LUN_SEP), { pacientes: { '1': { dni: '1', fullName: 'Ana', planificacion: { preferencias: { ausencias: [{ desde: '2026-10-10', hasta: '2026-10-20' }] } } } } }));
  check('una ausencia puntual deja pendientes solo esas fechas (no bloquea la estética)', ausente.items.filter((i) => i.estado === 'pendiente').map((i) => i.fecha).join() === '2026-10-12,2026-10-19');
  const dosHoras = [R('1', '2026-09-05', '10:00', 'Corporal X', 'b1', { duracionMinutos: 120 }), R('1', '2026-09-12', '10:00', 'Corporal X', 'b1', { duracionMinutos: 120 })];
  const rd = prepararDuplicacion(armar(dosHoras));
  check('la duración real (120 min) se conserva como bloque continuo', rd.items.every((i) => i.dur === 120));
  check('un turno de 2 horas que se superpone con otro cercano se rechaza', prepararDuplicacion(armar([...dosHoras, R('2', '2026-10-03', '11:30', 'Corporal X', 'b1')])).items.find((i) => i.fecha === '2026-10-03').estado === 'pendiente');
}

console.log('\n=== Integridad: existentes, repetición, identidad ===');
{
  const base = semanal('1', 1, '09:30', LUN_SEP);
  const res = prepararDuplicacion(armar(base));
  const creadas = res.items.filter((i) => i.estado === 'crear').map((i) => ({ id: i.idReserva, dni: i.dni, nombre: i.paciente, fecha: i.fecha, hora: i.hora, servicio: i.servicio, box: i.boxId, duracionMinutos: i.dur, estado: 'confirmado', duplicacion: { ocurrenciaKey: i.clave } }));
  const otra = prepararDuplicacion(armar([...base, ...creadas]));
  check('repetir la duplicación después de crear: 0 nuevas, todas reconocidas', otra.resumen.crear === 0 && otra.resumen.yaCubiertas === 4);
  const existente = prepararDuplicacion(armar([...base, R('1', '2026-10-12', '09:30', 'Corporal X', 'b1', { estado: 'confirmado', extra: 'no tocar' })]));
  check('una reserva ya existente en octubre se reconoce sin duplicar', existente.resumen.yaCubiertas === 1 && existente.resumen.crear === 3);
  const previosResueltos = [{ id: 'pp', clave: claveOcurrencia('1', 'corporal', '2026-10-12', '09:30'), estado: 'resuelto', reservaId: 'rX' }];
  const rr = prepararDuplicacion(armar([...base, R('1', '2026-10-13', '17:00', 'Corporal X', 'b1')].filter((r) => r.fecha !== '2026-10-13'), { pendientes: previosResueltos }));
  check('una ocurrencia ya resuelta (reagendada) no se regenera en el horario antiguo', rr.items.find((i) => i.fecha === '2026-10-12').estado === 'ya_cubierta' && rr.items.find((i) => i.fecha === '2026-10-12').reservaExistente === 'rX');
  const abiertos = [{ id: 'pq', clave: claveOcurrencia('1', 'corporal', '2026-10-12', '09:30'), estado: 'pendiente' }];
  const bloq = normalizarBloqueos([bloqueoBox('z', '2026-10-12', '09:30', 'b1'), bloqueoBox('z2', '2026-10-12', '09:45', 'b1'), bloqueoBox('z3', '2026-10-12', '10:00', 'b1'), bloqueoBox('z4', '2026-10-12', '10:15', 'b1')]);
  const dup = prepararDuplicacion(armar(base, { bloqueos: bloq.bloqueos, pendientes: abiertos }));
  check('un pendiente ya registrado no se cuenta como nuevo (no se duplica al repetir)', dup.resumen.pendientes === 1 && dup.resumen.pendientesNuevos === 0 && dup.items.find((i) => i.fecha === '2026-10-12').yaRegistrado === true);
  const renom = prepararDuplicacion(armar(base.map((r) => ({ ...r, nombre: 'Nombre viejo' })), { pacientes: { '1': { dni: '1', fullName: 'Ana Renombrada' } } }));
  check('paciente renombrado: la asociación sigue por identificador interno y se muestra el nombre actual', renom.items.every((i) => i.dni === '1' && i.paciente === 'Ana Renombrada'));
  check('el id de reserva es determinista (misma ocurrencia → mismo id)', idReservaDe('1|corporal|2026-10-05|09:30') === idReservaDe('1|corporal|2026-10-05|09:30') && idReservaDe('1|corporal|2026-10-05|09:30') !== idReservaDe('1|corporal|2026-10-12|09:30'));
  const conCancel = prepararDuplicacion(armar([...base, R('1', '2026-09-14', '09:30', 'Corporal X', 'b1', { estado: 'cancelado', id: 'rc' })].filter((r, i, a) => !(r.fecha === '2026-09-14' && r.estado !== 'cancelado' && a.some((x) => x.id === 'rc')))));
  check('una cancelación puntual de septiembre no elimina la pauta de octubre', conCancel.resumen.crear === 4 && conCancel.origenExplicado.find((o) => o.reservaId === 'rc').categoria === 'cancelada');
  const todas = prepararDuplicacion(armar([...base, R('9', '2026-09-03', '12:00', 'Corporal X', 'b1', { dni: '' }), R('2', '2026-09-20', '16:00', 'Facial X', 'b3')]));
  check('TODAS las reservas de origen quedan explicadas', todas.origenExplicado.length === 6 && todas.origenExplicado.every((o) => o.categoria && o.texto));
  check('la reserva sin paciente se informa, no se descarta en silencio', todas.origenExplicado.some((o) => o.categoria === 'sin_paciente'));
  const etiqueta = prepararDuplicacion(armar(base)).resumen.etiquetaBoton;
  check('la etiqueta del botón sale de las cantidades calculadas', etiqueta === 'Crear 4 turnos y guardar 0 pendientes');
  const dm = prepararDuplicacion(armar(base, { decisiones: { global: {}, patrones: {}, items: { [claveOcurrencia('1', 'corporal', '2026-10-05', '09:30')]: { estadoManual: 'pendiente_consultar' } } } }));
  check('"Pendiente de consultar" manual se respeta y no reserva el box', dm.items.find((i) => i.fecha === '2026-10-05').estado === 'pendiente' && dm.items.find((i) => i.fecha === '2026-10-05').estadoManual === 'pendiente_consultar');
}

console.log('\n=== Solo se propone lo válido ===');
{
  const bloq = normalizarBloqueos([bloqueoBox('a', '2026-10-12', '09:30', 'b1'), bloqueoBox('b', '2026-10-12', '09:45', 'b1'), bloqueoBox('c', '2026-10-12', '10:00', 'b1'), bloqueoBox('d', '2026-10-12', '10:15', 'b1')]);
  const c = armar(semanal('1', 1, '09:30', LUN_SEP), { bloqueos: bloq.bloqueos });
  const res = prepararDuplicacion(c);
  const it = res.items.find((i) => i.fecha === '2026-10-12');
  const alts = buscarAlternativas({ ...c, mesDestino: '2026-10', ocupacion: ocupacionDesdeReservas(c.reservas, c), bloqueos: c.bloqueos }, it, { max: 8 });
  check('la primera alternativa es la más cercana (mismo día, mismo box, otra hora, o mismo día en otro box)', alts[0].fecha === '2026-10-12');
  check('cada alternativa es válida al volver a evaluarla', alts.every((a) => !evaluarOcurrencia({ ...c, mesDestino: '2026-10', ocupacion: ocupacionDesdeReservas(c.reservas, c) }, { fecha: a.fecha, hora: a.hora, dur: it.dur, boxId: a.boxId, dni: '1', servicio: 'Corporal X', categoria: 'corporal' }).motivos.length));
}

console.log('\n' + '='.repeat(60));
console.log(fails ? fails + ' prueba(s) fallaron' : 'TODAS LAS PRUEBAS DE DUPLICAR MES OK');
process.exit(fails ? 1 : 0);
