// node tests/seguimiento-pacientes/run-tests.js   (datos 100% sintéticos)
import {
  diasEntre, indexarSesiones, ultimaSesionAntes, ultimaRealizada, minutosAgendados, tratamientoDe, enRangoRetorno,
  estadoContacto, avisadoEnUltimosDias, haceTexto, estadoPagoCorto, resumenSaldoHoras,
} from '../../js/seguimiento-pacientes.js';

let fails = 0;
const check = (desc, cond, extra) => { console.log((cond ? '  OK  ' : '  FAIL ') + desc); if (!cond) { fails++; if (extra !== undefined) console.log('       →', JSON.stringify(extra)); } };

const HOY = '2026-11-03';
const opciones = {
  claveDe: (r) => r.dni ? 'dni:' + r.dni : null,
  esActiva: (r) => r.estado !== 'cancelada',
  yaTermino: (r) => r.fecha < HOY || (r.fecha === HOY && r.hora < '10:00'),
  hoyISO: HOY,
};
const R = (id, fecha, hora, extra = {}) => ({ id, dni: '111', fecha, hora, servicio: 'Limpieza Facial', duracionMinutos: 60, ...extra });

console.log('\n=== diasEntre ===');
check('15/10 → 03/11 = 19 días', diasEntre('2026-10-15', '2026-11-03') === 19);
check('cruce de año', diasEntre('2025-12-31', '2026-01-01') === 1);
check('dato faltante → null', diasEntre('', HOY) === null);

console.log('\n=== indexarSesiones: realizadas vs próximas vs canceladas ===');
const reservas = [
  R('a', '2026-09-01', '09:00'),
  R('b', '2026-10-12', '11:00', { servicio: 'Hi-Fu Facial' }),
  R('c', '2026-10-20', '10:00', { estado: 'cancelada' }),
  R('d', HOY, '09:00'),            // hoy, ya terminó → realizada
  R('e', HOY, '15:00'),            // hoy, todavía no → próxima
  R('f', '2026-11-20', '10:00', { duracionMinutos: 90 }),
  { id: 'x', dni: '', fecha: HOY, hora: '12:00' }, // sin clave → se ignora
];
const idx = indexarSesiones(reservas, opciones);
const e = idx.get('dni:111');
check('una sola entrada para el paciente', idx.size === 1);
check('realizadas en orden: a, b, d', e.realizadas.map(r => r.id).join() === 'a,b,d', e.realizadas.map(r => r.id));
check('próximas: e, f', e.proximas.map(r => r.id).join() === 'e,f');
check('cancelada separada y NO cuenta como realizada', e.canceladas.map(r => r.id).join() === 'c');
check('ultimaRealizada = d (hoy temprano)', ultimaRealizada(e).id === 'd');
check('última sesión antes del turno f = d', ultimaSesionAntes(e, reservas[5]).id === 'd');
check('última sesión antes del turno b = a (nunca la propia)', ultimaSesionAntes(e, reservas[1]).id === 'a');
check('primera sesión del paciente → null', ultimaSesionAntes(e, reservas[0]) === null);
check('minutos agendados a futuro = 60 + 90', minutosAgendados(e, r => r.duracionMinutos) === 150);

console.log('\n=== Tratamiento y ventana de retorno ===');
check('HIFU antes que facial', tratamientoDe('Hi-Fu Facial') === 'hifu');
check('Criolipólisis', tratamientoDe('Criolipolisis abdomen') === 'criolipolisis');
check('FRAXIS cuenta como radiofrecuencia', tratamientoDe('FRAXIS Corporal') === 'radiofrecuencia');
check('Drenaje → corporal', tratamientoDe('Drenaje linfático') === 'corporal');
check('Desconocido → otro', tratamientoDe('Consulta inicial') === 'otro');
check('15-25 incluye 15 y 25, excluye 26', enRangoRetorno(15, '15-25') && enRangoRetorno(25, '15-25') && !enRangoRetorno(26, '15-25'));
check('30+ incluye 30', enRangoRetorno(30, '30+') && !enRangoRetorno(29, '30+'));
check('sin días → nunca en rango', !enRangoRetorno(null, 'todos'));

console.log('\n=== Estado de contacto (contactosWhatsApp) ===');
const AHORA = Date.UTC(2026, 10, 3, 15, 0);
const regs = [
  { tipoMensaje: 'recordatorio', estado: 'preparado', preparadoAt: { seconds: (AHORA - 3 * 3600000) / 1000 } },
  { tipoMensaje: 'confirmacion', estado: 'enviado', enviadoAt: { seconds: (AHORA - 2 * 3600000) / 1000 } },
  { tipoMensaje: 'rec_agua', estado: 'enviado', enviadoAt: { seconds: (AHORA - 30 * 60000) / 1000 } },
];
const ec = estadoContacto(regs, ['recordatorio', 'confirmacion']);
check('"enviado" gana sobre "preparado"', ec.estado === 'enviado' && ec.tipoMensaje === 'confirmacion');
check('filtra por tipo (ignora rec_agua)', estadoContacto(regs, ['recordatorio']).estado === 'preparado');
check('regex de tipo', estadoContacto(regs, [/^rec_/]).estado === 'enviado');
check('sin registros → pendiente', estadoContacto([], ['recordatorio']).estado === 'pendiente');
check('haceTexto en horas', haceTexto(AHORA - 2 * 3600000, AHORA) === 'hace 2 h');
check('avisado en últimos 7 días', avisadoEnUltimosDias(regs, ['confirmacion'], 7, AHORA));
check('aviso de hace 10 días NO cuenta para 7', !avisadoEnUltimosDias([{ tipoMensaje: 'retorno', estado: 'enviado', enviadoAt: AHORA - 10 * 86400000 }], ['retorno'], 7, AHORA));
check('"no_enviado" no cuenta como avisada', !avisadoEnUltimosDias([{ tipoMensaje: 'retorno', estado: 'no_enviado', updatedAt: AHORA }], ['retorno'], 7, AHORA));

console.log('\n=== Estado de pago corto y saldo de horas ===');
check('completo → Pagado', estadoPagoCorto('completo').etiqueta === 'Pagado');
check('parcial → Señado', estadoPagoCorto('parcial').etiqueta === 'Señado');
check('sin_pagos → Pendiente', estadoPagoCorto('sin_pagos').etiqueta === 'Pendiente');
check('anulada manda', estadoPagoCorto('completo', true).etiqueta === 'Anulada');
check('sin registro → null (no se inventa estado)', estadoPagoCorto(undefined) === null);
const s = resumenSaldoHoras(2.5, 90);
check('saldo 2.5 h con 1.5 h agendadas → 1 h libre', s.saldo === 2.5 && s.agendadas === 1.5 && s.libres === 1 && s.pctAgendado === 60);
check('saldo ≤ 1 h se marca bajo', resumenSaldoHoras(1, 0).bajo && !resumenSaldoHoras(1.5, 0).bajo);

console.log('\n' + '='.repeat(60));
console.log(fails ? fails + ' prueba(s) fallaron' : 'TODAS LAS PRUEBAS DE SEGUIMIENTO DE PACIENTES OK');
process.exit(fails ? 1 : 0);
