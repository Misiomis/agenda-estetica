// Pruebas de la lógica pura de Mimar T Inteligente — sin Firestore, sin red,
// sin navegador. Corre con: node tests/mimar-inteligente/run-tests.js
import {
  inicioTurnoMs, finTurnoMs, esActiva, normalizarItemAgenda, construirAgenda,
  obtenerProximaReserva, calcularRevision, obtenerBandejaRevisiones,
  construirTextoConfirmacion, normalizarTelefonoWA, VENTANA_REVISION_MS,
  DURACION_DEFECTO_MIN,
} from '../../mimar-inteligente/mimar-inteligente-logic.js';

let fails = 0;
const check = (desc, cond) => { console.log((cond ? '  OK  ' : '  FAIL ') + desc); if (!cond) fails++; };

// Fecha base fija para que las pruebas no dependan del reloj real de quien las corre.
const HOY = '2026-09-10'; // jueves
const MAÑANA = '2026-09-11';

console.log('\n=== Fecha/hora con offset -03:00 explícito ===');
{
  const ms = inicioTurnoMs(HOY, '14:00');
  const esperado = new Date('2026-09-10T14:00:00-03:00').getTime();
  check('inicioTurnoMs usa -03:00, no el huso local de la máquina', ms === esperado);
  check('finTurnoMs sin duracionMinutos cae en el fallback de 60 min', finTurnoMs(HOY, '14:00', null) === esperado + 60 * 60000);
  check('finTurnoMs respeta una duración real distinta de 60', finTurnoMs(HOY, '14:00', 90) === esperado + 90 * 60000);
  check('fecha/hora inválida → null, no una excepción', inicioTurnoMs('', '') === null);
}

console.log('\n=== Vocabulario de estado por colección (no se mezcla) ===');
{
  check('reservas: "cancelado" es inactiva', esActiva('reservas', 'cancelado') === false);
  check('reservas: "confirmado" es activa', esActiva('reservas', 'confirmado') === true);
  check('reservas: sin estado (undefined) se trata como activa', esActiva('reservas', undefined) === true);
  check('consultas: "cancelada" es inactiva', esActiva('consultas', 'cancelada') === false);
  check('consultas: "pendiente" es activa', esActiva('consultas', 'pendiente') === true);
}

console.log('\n=== normalizarItemAgenda: no inventa campos ===');
{
  const it = normalizarItemAgenda('reservas', 'r1', { nombre: 'Ana Gómez', fecha: HOY, hora: '10:00', servicio: 'Facial' });
  check('sin telefono en el doc → telefono null, no ""', it.telefono === null);
  check('sin duracionMinutos en el doc → duracionEstimada=true', it.duracionEstimada === true);
  check('sin box en el doc → box null (no se infiere por palabras clave)', it.box === null);
  check('nombre toma nombre cuando no hay nombreLimpio', it.nombre === 'Ana Gómez');

  const itC = normalizarItemAgenda('consultas', 'c1', { nombre: 'Beto Ruiz', fecha: HOY, hora: '09:00' });
  check('consultas sin servicio explícito → "Consulta Inicial", no un texto inventado distinto', itC.servicio === 'Consulta Inicial');
  check('consultas sin estado → "pendiente" (default documentado de ese vocabulario)', itC.estadoBruto === 'pendiente');
}

console.log('\n=== Próxima reserva ===');
{
  const ahora = new Date(`${HOY}T09:00:00-03:00`).getTime();
  const agenda = construirAgenda([
    normalizarItemAgenda('reservas', 'r1', { nombre: 'A', fecha: HOY, hora: '08:00', duracionMinutos: 30 }), // ya terminó
    normalizarItemAgenda('reservas', 'r2', { nombre: 'B', fecha: HOY, hora: '11:00' }),
    normalizarItemAgenda('reservas', 'r3', { nombre: 'C', fecha: HOY, hora: '10:00', estado: 'cancelado' }), // cancelada, no cuenta
  ], []);
  const prox = obtenerProximaReserva(agenda, ahora);
  check('ignora turnos ya terminados y cancelados; toma el próximo activo real', prox && prox.id === 'r2');
}

console.log('\n=== Bandeja de revisiones — ventana de 4 horas ===');
{
  const inicioTurno = new Date(`${HOY}T14:00:00-03:00`).getTime();
  const item = normalizarItemAgenda('reservas', 'rX', { nombre: 'Z', fecha: HOY, hora: '14:00', telefono: '3764111111', duracionMinutos: 60 });

  check('a 5 horas del turno: todavía NO debe aparecer', calcularRevision(item, inicioTurno - 5 * 3600000) === null);
  check('a exactamente 4 horas del turno: SI debe aparecer', calcularRevision(item, inicioTurno - VENTANA_REVISION_MS) !== null);
  check('a 1 hora del turno: sigue vigente', calcularRevision(item, inicioTurno - 3600000) !== null);
  check('justo cuando termina el turno: ya no debe aparecer', calcularRevision(item, inicioTurno + 60 * 60000) === null);

  console.log('\n=== Reserva creada DENTRO de las 4 horas previas: se incorpora igual ===');
  const creadaTarde = normalizarItemAgenda('reservas', 'rY', { nombre: 'W', fecha: HOY, hora: '14:00', telefono: '3764111111' });
  check('una reserva nueva a 1 hora de su propio turno entra a la bandeja de inmediato', calcularRevision(creadaTarde, inicioTurno - 3600000) !== null);

  console.log('\n=== Motivos: sin teléfono / duración estimada quedan señalados, no ocultos ===');
  const sinTel = normalizarItemAgenda('reservas', 'rZ', { nombre: 'Q', fecha: HOY, hora: '14:00' });
  const rev = calcularRevision(sinTel, inicioTurno - 3600000);
  check('revisión incluye el motivo "sin_confirmacion" siempre', rev.motivos.some(m => m.tipo === 'sin_confirmacion'));
  check('revisión incluye "sin_telefono" cuando falta', rev.motivos.some(m => m.tipo === 'sin_telefono'));
  check('revisión incluye "duracion_estimada" cuando la duración no está registrada', rev.motivos.some(m => m.tipo === 'duracion_estimada'));
}

console.log('\n=== Cancelación / eliminación dejan de producir revisión ===');
{
  const inicioTurno = new Date(`${HOY}T14:00:00-03:00`).getTime();
  const ahora = inicioTurno - 3600000;
  const cancelada = normalizarItemAgenda('reservas', 'rC', { nombre: 'N', fecha: HOY, hora: '14:00', estado: 'cancelado' });
  check('una reserva cancelada nunca genera revisión, aunque esté en la ventana de 4h', calcularRevision(cancelada, ahora) === null);
  // "Eliminada" en Firestore = el doc ya no aparece en el snapshot → construirAgenda()
  // simplemente no la recibe, así que no puede aparecer en la bandeja (se prueba
  // a nivel de la agenda combinada, no de un doc individual "borrado").
  const agendaSinElla = construirAgenda([
    normalizarItemAgenda('reservas', 'rOtra', { nombre: 'M', fecha: HOY, hora: '15:00', telefono: '3764111111' }),
  ], []);
  const bandeja = obtenerBandejaRevisiones(agendaSinElla, ahora);
  check('una reserva borrada (ausente del snapshot) no puede aparecer en la bandeja', !bandeja.some(r => r.item.id === 'rC'));
}

console.log('\n=== Reprogramación: recalcula sola, sin "revisión vieja" colgada ===');
{
  // Antes de reprogramar: turno a las 14:00, estamos a 1h → debería estar en revisión.
  const original = normalizarItemAgenda('reservas', 'rP', { nombre: 'R', fecha: HOY, hora: '14:00', telefono: '3764111111' });
  const ahora = new Date(`${HOY}T13:00:00-03:00`).getTime();
  check('antes de reprogramar, el horario viejo genera revisión', calcularRevision(original, ahora) !== null);

  // Se reprograma a mañana a las 10:00 — mismo ID de documento, nuevos fecha/hora.
  const reprogramada = normalizarItemAgenda('reservas', 'rP', { nombre: 'R', fecha: MAÑANA, hora: '10:00', telefono: '3764111111' });
  check('con el nuevo horario (mañana), a esta misma hora de hoy YA NO corresponde revisión', calcularRevision(reprogramada, ahora) === null);
  const ahoraMañana = new Date(`${MAÑANA}T09:00:00-03:00`).getTime(); // 1h antes del nuevo horario
  check('en la ventana del NUEVO horario, sí aparece la revisión (recalculada, no duplicada)', calcularRevision(reprogramada, ahoraMañana) !== null);
}

console.log('\n=== Turnos simultáneos en distintos boxes se conservan por separado ===');
{
  const ahora = new Date(`${HOY}T13:30:00-03:00`).getTime();
  const agenda = construirAgenda([
    normalizarItemAgenda('reservas', 'box1', { nombre: 'Persona Box 1', fecha: HOY, hora: '14:00', box: 'b1', telefono: '3764111111' }),
    normalizarItemAgenda('reservas', 'box2', { nombre: 'Persona Box 2', fecha: HOY, hora: '14:00', box: 'b2', telefono: '3764222222' }),
  ], []);
  const bandeja = obtenerBandejaRevisiones(agenda, ahora);
  check('dos turnos a la misma hora en boxes distintos generan DOS revisiones, no se pisan', bandeja.length === 2);
  check('cada una conserva su propio box', bandeja.find(r => r.item.id === 'box1').item.box === 'b1' && bandeja.find(r => r.item.id === 'box2').item.box === 'b2');
  check('no se agrupan por nombre — identidad es coleccion+id', bandeja[0].item.id !== bandeja[1].item.id);
}

console.log('\n=== Nombres largos / datos incompletos no rompen nada ===');
{
  const nombreLargo = 'María de los Ángeles Fernández Rodríguez de la Torre y Gonzalez';
  const it = normalizarItemAgenda('reservas', 'rL', { nombre: nombreLargo, fecha: HOY, hora: '14:00' });
  check('nombre largo se preserva completo, sin truncar en la lógica', it.nombre === nombreLargo);
  const vacio = normalizarItemAgenda('reservas', 'rVacio', {});
  check('documento casi vacío no explota: fechaIncompleta=true', vacio.fechaIncompleta === true);
  check('documento sin fecha/hora no genera revisión (no se puede ubicar en el tiempo)', calcularRevision(vacio, Date.now()) === null);
}

console.log('\n=== Mensaje de WhatsApp manual ===');
{
  const it = normalizarItemAgenda('reservas', 'rW', { nombre: 'Carla Núñez', fecha: HOY, hora: '16:00', servicio: 'Presoterapia', telefono: '3764555555' });
  const texto = construirTextoConfirmacion(it);
  check('el texto usa el primer nombre', texto.includes('Hola Carla!'));
  check('el texto incluye fecha, hora y servicio reales — no un texto genérico', texto.includes(HOY) && texto.includes('16:00') && texto.includes('Presoterapia'));
  check('normalizarTelefonoWA arma el prefijo 549 igual que el resto del proyecto', normalizarTelefonoWA('3764555555') === '5493764555555');
}

console.log('\n' + '='.repeat(60));
console.log(fails ? (fails + ' prueba(s) fallaron') : 'TODAS LAS PRUEBAS OK');
process.exit(fails ? 1 : 0);
