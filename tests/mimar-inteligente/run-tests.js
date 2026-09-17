// Pruebas de la lógica pura de Mimar T Inteligente — sin Firestore, sin red,
// sin navegador. Corre con: node tests/mimar-inteligente/run-tests.js
import {
  inicioTurnoMs, finTurnoMs, esActiva, normalizarItemAgenda, construirAgenda,
  obtenerProximaReserva, calcularRevision, obtenerBandejaRevisiones,
  construirTextoConfirmacion, normalizarTelefonoWA, VENTANA_REVISION_MS,
  DURACION_DEFECTO_MIN, construirTextoRecordatorio, construirTextoCumpleanos,
  construirTextoConsulta, construirTextoKit, idContactoParaItem, estadoContacto,
  etiquetaEstadoContacto, contactoVencido, normalizarPedidoKit, formatearARS,
  estadoTemporalTurno, etiquetaEstadoTemporal, agruparPorDia, eventoCoincideFiltro,
  filtroEsNeutro, FILTRO_ACTIVIDAD_VACIO, sumarDiasISO,
  docIdVersionadoContacto, docIdVersionadoCumpleanos, derivarPendientes,
  contarPendientesPorTipo, resumenTextoPendientes, normalizarRecomendacion,
  recomendacionValida, enDescansoNocturno, pendientesElegiblesParaAviso,
  PREFS_AVISOS_DEFECTO, TIPOS_PENDIENTE, calcularRevisarTurnoPasado,
  resolverTelefonoConFallback, VENTANA_REVISAR_TURNO_DIAS,
  validarYNormalizarTelefonoAR, formatearFechaLocal, formatearHoraLocal,
  formatearFechaHoraLocal, diaSemanaLegible, referenciaTemporalConFecha,
  construirTextoAvisoDuenaKit, construirTextoAvisoDuenaConsulta,
  construirTextoAvisoDuenaConsultaAgendada, construirTextoAvisoDuenaSolicitudConsulta,
  franjaDeHora, fechaAvisoConfirmacion, agruparPendientesPorDia, textoTurnoConDia,
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

console.log('\n=== normalizarItemAgenda: duracion (campo legado) vs duracionMinutos (vigente) ===');
{
  // Auditoría de datos reales: 155 reservas solo tienen "duracion" (nombre
  // viejo del campo). Sin fallback, esa duración real registrada se
  // descartaba y el turno se mostraba como "estimado 60 min" pese a tener
  // un valor guardado.
  const itLegado = normalizarItemAgenda('reservas', 'rLegado', { nombre: 'Legado', fecha: HOY, hora: '10:00', duracion: 30 });
  check('con "duracion" (legado) y sin "duracionMinutos" → usa 30, no descarta el dato', itLegado.duracionMinutos === 30);
  check('con "duracion" (legado) → NO es estimada, es un valor real registrado', itLegado.duracionEstimada === false);

  const itVigente = normalizarItemAgenda('reservas', 'rVigente', { nombre: 'Vigente', fecha: HOY, hora: '10:00', duracionMinutos: 45, duracion: 999 });
  check('con ambos campos presentes → prevalece duracionMinutos (el vigente), no el legado', itVigente.duracionMinutos === 45);

  const itNinguno = normalizarItemAgenda('reservas', 'rNinguno', { nombre: 'Ninguno', fecha: HOY, hora: '10:00' });
  check('sin ninguno de los dos campos → sigue siendo estimada, no inventa un valor', itNinguno.duracionEstimada === true && itNinguno.duracionMinutos === null);
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

console.log('\n=== Bandeja de revisiones — ventana de 24 horas ===');
{
  const inicioTurno = new Date(`${HOY}T14:00:00-03:00`).getTime();
  const item = normalizarItemAgenda('reservas', 'rX', { nombre: 'Z', fecha: HOY, hora: '14:00', telefono: '3764111111', duracionMinutos: 60 });

  // Ampliado de 4h a 24h (GlowUp de corrección, 14/9): con datos reales de
  // producción, la ventana de 4h dejaba la bandeja vacía casi todo el día
  // (19 reservas activas hoy/mañana, 0 pendientes de turno a las 00:36).
  check('a 25 horas del turno: todavía NO debe aparecer', calcularRevision(item, inicioTurno - 25 * 3600000) === null);
  check('a 5 horas del turno: SI debe aparecer (antes de la corrección no aparecía)', calcularRevision(item, inicioTurno - 5 * 3600000) !== null);
  check('a exactamente 24 horas del turno: SI debe aparecer', calcularRevision(item, inicioTurno - VENTANA_REVISION_MS) !== null);
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

  // Se reprograma a dentro de 3 días (no "mañana": con la ventana de 24h,
  // un turno de mañana ya estaría en su propia ventana casi todo hoy, lo
  // que no serviría para distinguir "vieja revisión colgada" de "ventana
  // recalculada del nuevo horario") — mismo ID de documento, nuevos fecha/hora.
  const fechaLejana = sumarDiasISO(HOY, 3);
  const reprogramada = normalizarItemAgenda('reservas', 'rP', { nombre: 'R', fecha: fechaLejana, hora: '10:00', telefono: '3764111111' });
  check('con el nuevo horario (en 3 días), a esta misma hora de hoy YA NO corresponde revisión', calcularRevision(reprogramada, ahora) === null);
  const ahoraCercaDelNuevo = new Date(`${fechaLejana}T09:00:00-03:00`).getTime(); // 1h antes del nuevo horario
  check('en la ventana del NUEVO horario, sí aparece la revisión (recalculada, no duplicada)', calcularRevision(reprogramada, ahoraCercaDelNuevo) !== null);
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

console.log('\n=== Plantillas de mensaje (texto plano, sin HTML) ===');
{
  const it = normalizarItemAgenda('reservas', 'rT', { nombre: 'Lucía Paz', fecha: HOY, hora: '11:00', servicio: 'Drenaje', telefono: '3764555555' });
  const recordatorio = construirTextoRecordatorio(it);
  check('recordatorio usa el primer nombre', recordatorio.includes('Hola Lucía'));
  check('recordatorio incluye fecha/hora/servicio reales', recordatorio.includes(HOY) && recordatorio.includes('11:00') && recordatorio.includes('Drenaje'));
  check('recordatorio no contiene HTML (ni "<")', !recordatorio.includes('<'));
  check('recordatorio firma como Espacio Mimar T', recordatorio.includes('Espacio Mimar T'));

  const cumple = construirTextoCumpleanos('Marta Sosa');
  check('cumpleaños usa el primer nombre', cumple.includes('Marta'));
  check('cumpleaños no contiene HTML', !cumple.includes('<'));

  const consulta = construirTextoConsulta(normalizarItemAgenda('consultas', 'c9', { nombre: 'Nico Ruiz', fecha: HOY, hora: '09:30' }));
  check('consulta usa el primer nombre y menciona "consulta inicial"', consulta.includes('Nico') && /consulta inicial/i.test(consulta));

  const kit = construirTextoKit('Vale Díaz');
  check('kit usa el primer nombre y menciona Farmacia Central', kit.includes('Vale') && kit.includes('Farmacia Central'));
}

console.log('\n=== Estado de contacto por WhatsApp (punto 3) ===');
{
  const it = normalizarItemAgenda('reservas', 'rK', { nombre: 'Contacto Test', fecha: HOY, hora: '14:00', telefono: '3764555555' });
  check('id de contacto de un turno incluye fecha+hora (identidad por ocurrencia)', idContactoParaItem(it, 'confirmacion') === `reservas_rK__${HOY}_14:00_confirmacion`);
  const itReprogramado = normalizarItemAgenda('reservas', 'rK', { nombre: 'Contacto Test', fecha: sumarDiasISO(HOY, 3), hora: '16:00', telefono: '3764555555' });
  check('reprogramar el MISMO turno (mismo id) a otra fecha/hora da un id de contacto DISTINTO — no hereda el "enviado" viejo', idContactoParaItem(it, 'confirmacion') !== idContactoParaItem(itReprogramado, 'confirmacion'));
  const itSinFechaHora = { coleccion: 'pedidosKit', id: 'kX' };
  check('un item sin fecha/hora (kit) sigue con el id simple, sin sufijo de ocurrencia', idContactoParaItem(itSinFechaHora, 'kit') === 'pedidosKit_kX_kit');
  check('sin doc de contacto → "pendiente" explícito, no vacío', estadoContacto(null) === 'pendiente' && estadoContacto(undefined) === 'pendiente');
  check('con doc de contacto → toma su estado real', estadoContacto({ estado: 'enviado' }) === 'enviado');
  check('etiqueta legible por cada estado (frase completa, no el código crudo)', etiquetaEstadoContacto('preparado').startsWith('Texto preparado'));
  check('etiqueta de "pendiente" es distinta de "enviado" (no se confunden)', etiquetaEstadoContacto('pendiente') !== etiquetaEstadoContacto('enviado'));

  const turno = new Date(`${HOY}T14:00:00-03:00`).getTime();
  check('sin enviar y a pocos minutos del turno → vencido', contactoVencido(it, null, 30 * 60000, turno - 10 * 60000) === true);
  check('sin enviar pero todavía lejos del turno → no vencido', contactoVencido(it, null, 30 * 60000, turno - 5 * 3600000) === false);
  check('ya "enviado" → nunca vencido, sea cual sea el plazo', contactoVencido(it, { estado: 'enviado' }, 30 * 60000, turno + 3600000) === false);
}

console.log('\n=== Pedidos de kit: transformación centralizada (punto 2) ===');
{
  // Kit con varios productos, cantidades e importe conocido.
  const conVarios = normalizarPedidoKit('k1', {
    nombrePaciente: 'Rosana S', telefono: '3757449439',
    productos: ['Leche de limpieza', 'Tónico calmante', 'Leche de limpieza'],
    productosDetalle: [
      { nombre: 'Leche de limpieza', precio: 15000 },
      { nombre: 'Tónico calmante', precio: 15000 },
      { nombre: 'Leche de limpieza', precio: 15000 },
    ],
    totalPedido: 45000, estado: 'entregado',
  });
  check('agrupa "Leche de limpieza" repetida en una sola línea con cantidad 2', conVarios.items.find((it) => it.nombre === 'Leche de limpieza').cantidad === 2);
  check('subtotal de esa línea es 30000 (2 x 15000)', conVarios.items.find((it) => it.nombre === 'Leche de limpieza').subtotal === 30000);
  check('cantidadTotal suma las 3 unidades, no las 2 líneas', conVarios.cantidadTotal === 3);
  check('total conocido se formatea en pesos argentinos', conVarios.totalTexto === formatearARS(45000) && conVarios.totalTexto.includes('45.000'));
  check('sin discrepancia cuando el total registrado coincide con la suma de sus líneas', conVarios.discrepanciaTotal === null);

  // Pedido viejo sin importe registrado — nunca debe leerse como $0.
  const sinImporte = normalizarPedidoKit('k2', {
    nombrePaciente: 'Camila D', productos: ['Leche de limpieza', 'Crema hidratante'],
  });
  check('sin productosDetalle ni totalPedido → total es null, no 0', sinImporte.total === null);
  check('el texto del total es "No registrado", nunca "$0"', sinImporte.totalTexto === 'No registrado');
  check('sin productosDetalle → items es null (no un arreglo vacío que sugiera "sin productos")', sinImporte.items === null);
  check('productosResumen conserva los nombres aunque no haya precios', sinImporte.productosResumen.length === 2);

  // Importe cero real (pedido bonificado) — distinto de "no registrado".
  const importeCero = normalizarPedidoKit('k3', { nombrePaciente: 'Test', totalPedido: 0 });
  check('total registrado en 0 es un cero real, no "No registrado"', importeCero.total === 0 && importeCero.totalTexto !== 'No registrado');

  // Un cambio de precio en el catálogo después del pedido no debe alterar el
  // importe histórico: normalizarPedidoKit solo mira lo guardado en el
  // propio documento del pedido, nunca una fuente externa de precios.
  const pedidoHistorico = normalizarPedidoKit('k4', {
    nombrePaciente: 'Histórico', productosDetalle: [{ nombre: 'Kit Facial', precio: 20000 }], totalPedido: 20000,
  });
  check('el precio guardado en el pedido se preserva sin importar el precio de catálogo actual', pedidoHistorico.items[0].precioUnitario === 20000);

  // Total registrado que no coincide con lo que suman sus propios
  // componentes: se señala, nunca se corrige solo ni se descarta uno de los
  // dos valores en silencio.
  const inconsistente = normalizarPedidoKit('k5', {
    nombrePaciente: 'Raro', productosDetalle: [{ nombre: 'A', precio: 10000 }, { nombre: 'B', precio: 10000 }], totalPedido: 25000,
  });
  check('discrepancia detectada entre el total guardado (25000) y la suma de líneas (20000)',
    inconsistente.discrepanciaTotal && inconsistente.discrepanciaTotal.registrado === 25000 && inconsistente.discrepanciaTotal.calculado === 20000);
  check('ante discrepancia, se muestra el valor registrado en el documento (no el recalculado) para no pisar el dato original', inconsistente.total === 25000);

  // Estado de pago nunca se infiere del estado de entrega.
  const entregadoSinPago = normalizarPedidoKit('k6', { nombrePaciente: 'X', estado: 'entregado', totalPedido: 10000 });
  check('"entregado" no implica pagado — sin campo de pago, el abonado sigue "No registrado"', entregadoSinPago.montoAbonadoTexto === 'No registrado');
  check('sin monto abonado, el saldo pendiente tampoco se inventa', entregadoSinPago.saldoPendiente === null && entregadoSinPago.saldoPendienteTexto === 'No registrado');

  check('formatearARS con un valor no numérico devuelve null, no "$NaN"', formatearARS(NaN) === null && formatearARS(undefined) === null);
}

console.log('\n=== Estado temporal de un turno: nunca "realizada" solo por la fecha ===');
{
  const turnoFuturo = normalizarItemAgenda('reservas', 'tf', { nombre: 'F', fecha: MAÑANA, hora: '10:00' });
  check('turno de mañana → "proximo"', estadoTemporalTurno(turnoFuturo, new Date(`${HOY}T09:00:00-03:00`).getTime()) === 'proximo');

  const turnoPasado = normalizarItemAgenda('reservas', 'tp', { nombre: 'P', fecha: HOY, hora: '08:00', duracionMinutos: 30 });
  const estadoPasado = estadoTemporalTurno(turnoPasado, new Date(`${HOY}T20:00:00-03:00`).getTime());
  check('turno ya terminado → "pasado" (nunca "realizada": esa palabra no existe en este vocabulario)', estadoPasado === 'pasado');
  check('la etiqueta de "pasado" no afirma que la sesión se haya realizado', etiquetaEstadoTemporal(estadoPasado) === 'Turno pasado');

  const sinFecha = normalizarItemAgenda('reservas', 'sf', { nombre: 'S' });
  check('sin fecha utilizable → "sin_fecha", no se inventa un estado temporal', estadoTemporalTurno(sinFecha) === 'sin_fecha');
}

console.log('\n=== Actividad agrupada por Hoy / Ayer / Anteriores (punto 4) ===');
{
  const ahoraMs = new Date(`${HOY}T15:00:00-03:00`).getTime();
  const ayerISO = sumarDiasISO(HOY, -1);
  const anteayerISO = sumarDiasISO(HOY, -2);
  const eventos = [
    { id: 'e1', timestampMs: new Date(`${HOY}T10:00:00-03:00`).getTime() },
    { id: 'e2', timestampMs: new Date(`${ayerISO}T10:00:00-03:00`).getTime() },
    { id: 'e3', timestampMs: new Date(`${anteayerISO}T10:00:00-03:00`).getTime() },
    { id: 'e4', timestampMs: null },
  ];
  const grupos = agruparPorDia(eventos, ahoraMs);
  check('evento de hoy cae en el grupo "hoy"', grupos.hoy.length === 1 && grupos.hoy[0].id === 'e1');
  check('evento de ayer cae en el grupo "ayer", no en "anteriores"', grupos.ayer.length === 1 && grupos.ayer[0].id === 'e2');
  check('evento de hace 2 días cae en "anteriores"', grupos.anteriores.some((e) => e.id === 'e3'));
  check('evento sin fecha resuelta también cae en "anteriores" (nunca se descarta silenciosamente)', grupos.anteriores.some((e) => e.id === 'e4'));
  check('no se pierde ningún evento en el agrupado', grupos.hoy.length + grupos.ayer.length + grupos.anteriores.length === eventos.length);
}

console.log('\n=== Filtros de actividad: categoría, estado, fecha y "restablecer" (punto 4) ===');
{
  const ev = { coleccion: 'pedidosKit', atendido: false, timestampMs: new Date(`${HOY}T10:00:00-03:00`).getTime() };
  check('filtro vacío no descarta nada', eventoCoincideFiltro(ev, FILTRO_ACTIVIDAD_VACIO) === true);
  check('filtro por categoría distinta descarta el evento', eventoCoincideFiltro(ev, { ...FILTRO_ACTIVIDAD_VACIO, categoria: 'reservas' }) === false);
  check('filtro por la misma categoría lo conserva', eventoCoincideFiltro(ev, { ...FILTRO_ACTIVIDAD_VACIO, categoria: 'pedidosKit' }) === true);
  check('filtro "atendido" descarta un evento pendiente', eventoCoincideFiltro(ev, { ...FILTRO_ACTIVIDAD_VACIO, estado: 'atendido' }) === false);
  check('filtro "pendiente" conserva un evento no atendido', eventoCoincideFiltro(ev, { ...FILTRO_ACTIVIDAD_VACIO, estado: 'pendiente' }) === true);
  check('rango de fecha que no incluye el evento lo descarta', eventoCoincideFiltro(ev, { ...FILTRO_ACTIVIDAD_VACIO, fechaDesde: sumarDiasISO(HOY, 1) }) === false);
  check('evento sin timestamp resuelto nunca matchea un filtro de fecha (no se inventa su fecha)', eventoCoincideFiltro({ ...ev, timestampMs: null }, { ...FILTRO_ACTIVIDAD_VACIO, fechaDesde: HOY }) === false);

  check('FILTRO_ACTIVIDAD_VACIO es neutro', filtroEsNeutro(FILTRO_ACTIVIDAD_VACIO) === true);
  check('un filtro con categoría específica no es neutro', filtroEsNeutro({ ...FILTRO_ACTIVIDAD_VACIO, categoria: 'reservas' }) === false);
  check('"restablecer filtros" es simplemente volver al filtro vacío', filtroEsNeutro({ categoria: 'todas', estado: 'todos', fechaDesde: null, fechaHasta: null }) === true);
}

console.log('\n=== GlowUp — regla canónica de pendientes: deriva de las fuentes, no del feed ===');
{
  const ahoraTurno = new Date(`${HOY}T14:00:00-03:00`).getTime();
  const ahoraDentroVentana = ahoraTurno - 2 * 3600000; // 2 h antes, dentro de la ventana de 4 h

  const turnoSinConfirmar = normalizarItemAgenda('reservas', 't1', { nombre: 'Ana Pendiente', fecha: HOY, hora: '14:00', telefono: '3760000001', estado: 'confirmado' });
  const agenda1 = construirAgenda([turnoSinConfirmar], []);
  const pend1 = derivarPendientes({ agenda: agenda1, pedidosKitPendientes: [], cumpleanosHoy: null, recomendaciones: [], contactosPorId: {} }, ahoraDentroVentana);
  check('un turno sin confirmación dentro de la ventana de 4h SÍ es un pendiente', pend1.some((p) => p.tipo === 'confirmacion_turno' && p.docId === 't1'));

  // El mismo turno, pero con un contacto YA "enviado" para esa ocurrencia
  // exacta (mismo id versionado que produciría la app real) → deja de ser
  // un pendiente, sin necesidad de ninguna marca genérica de "atendido".
  const idContactoTurno = idContactoParaItem(turnoSinConfirmar, 'confirmacion');
  const pend2 = derivarPendientes({ agenda: agenda1, pedidosKitPendientes: [], cumpleanosHoy: null, recomendaciones: [], contactosPorId: { [idContactoTurno]: { estado: 'enviado' } } }, ahoraDentroVentana);
  check('con la confirmación real enviada para ESA ocurrencia, deja de ser pendiente', !pend2.some((p) => p.docId === 't1'));

  // Reprogramado a otra fecha/hora: el "enviado" viejo (otra ocurrencia)
  // NO alcanza para cerrar el pendiente de la ocurrencia nueva.
  const turnoReprogramado = normalizarItemAgenda('reservas', 't1', { nombre: 'Ana Pendiente', fecha: sumarDiasISO(HOY, 2), hora: '15:00', telefono: '3760000001', estado: 'confirmado' });
  const ahoraNuevaVentana = new Date(`${sumarDiasISO(HOY, 2)}T15:00:00-03:00`).getTime() - 3600000;
  const agenda2 = construirAgenda([turnoReprogramado], []);
  const pend3 = derivarPendientes({ agenda: agenda2, pedidosKitPendientes: [], cumpleanosHoy: null, recomendaciones: [], contactosPorId: { [idContactoTurno]: { estado: 'enviado' } } }, ahoraNuevaVentana);
  check('reprogramado: el "enviado" de la fecha vieja NO cierra el pendiente de la fecha nueva (no se pierde la acción real)', pend3.some((p) => p.docId === 't1'));

  // Cancelado: calcularRevision ya lo excluye — el pendiente desaparece
  // solo, sin duplicarse ni dejar rastro falso.
  const turnoCancelado = normalizarItemAgenda('reservas', 't1', { nombre: 'Ana Pendiente', fecha: HOY, hora: '14:00', telefono: '3760000001', estado: 'cancelado' });
  const pend4 = derivarPendientes({ agenda: construirAgenda([turnoCancelado], []), pedidosKitPendientes: [], cumpleanosHoy: null, recomendaciones: [], contactosPorId: {} }, ahoraDentroVentana);
  check('un turno cancelado nunca genera un pendiente de confirmación', !pend4.some((p) => p.docId === 't1'));

  // Kit pendiente: siempre que la fuente ya lo entregue como "pendiente"
  // (la query real ya filtra por estado), es una acción.
  const pend5 = derivarPendientes({ agenda: [], pedidosKitPendientes: [{ id: 'k1', nombre: 'Beto Kit' }], cumpleanosHoy: null, recomendaciones: [], contactosPorId: {} });
  check('un pedido de kit pendiente es un pendiente propio, tipo "kit_pendiente"', pend5.length === 1 && pend5[0].tipo === 'kit_pendiente');

  // Cumpleaños: versionado por año — un saludo ya enviado el año pasado
  // no cierra el de este año.
  const cumple2026 = { estado: 'ok', fecha: '2026-09-10', personas: [{ clientId: 'c1', nombre: 'Cami Cumple', telefonoDisponible: true }] };
  const idContactoCumple2025 = `clients_${docIdVersionadoCumpleanos('c1', '2025-09-10')}_cumpleanos`;
  const pend6 = derivarPendientes({ agenda: [], pedidosKitPendientes: [], cumpleanosHoy: cumple2026, recomendaciones: [], contactosPorId: { [idContactoCumple2025]: { estado: 'enviado' } } });
  check('cumpleaños: un saludo enviado el año pasado NO cierra el de este año', pend6.some((p) => p.tipo === 'cumpleanos' && p.docId === 'c1'));
  const idContactoCumple2026 = `clients_${docIdVersionadoCumpleanos('c1', '2026-09-10')}_cumpleanos`;
  const pend7 = derivarPendientes({ agenda: [], pedidosKitPendientes: [], cumpleanosHoy: cumple2026, recomendaciones: [], contactosPorId: { [idContactoCumple2026]: { estado: 'enviado' } } });
  check('cumpleaños: el saludo de ESTE año sí lo cierra', !pend7.some((p) => p.docId === 'c1'));
  check('sin resumen de cumpleaños todavía generado, no se inventa ninguno', derivarPendientes({ agenda: [], pedidosKitPendientes: [], cumpleanosHoy: { estado: 'no_generado' }, recomendaciones: [], contactosPorId: {} }).length === 0);

  // Recomendación: manual, con programación explícita — nunca se
  // autogenera, y no se habilita antes de su hora programada.
  const recFutura = normalizarRecomendacion('r1', { pacienteNombre: 'Dana Reco', texto: 'Recordale hidratarse', programadoParaMs: Date.now() + 3600000 });
  const recVigente = normalizarRecomendacion('r2', { pacienteNombre: 'Eli Reco', texto: 'Ofrecele el combo nuevo', programadoParaMs: Date.now() - 60000 });
  const recEnviada = normalizarRecomendacion('r3', { pacienteNombre: 'Fer Reco', texto: 'Ya se mandó', programadoParaMs: Date.now() - 60000, estado: 'enviada' });
  const pend8 = derivarPendientes({ agenda: [], pedidosKitPendientes: [], cumpleanosHoy: null, recomendaciones: [recFutura, recVigente, recEnviada], contactosPorId: {} });
  check('una recomendación programada para el futuro todavía NO es un pendiente', !pend8.some((p) => p.docId === 'r1'));
  check('una recomendación cuya hora ya llegó SÍ es un pendiente', pend8.some((p) => p.docId === 'r2'));
  check('una recomendación ya "enviada" no vuelve a aparecer como pendiente', !pend8.some((p) => p.docId === 'r3'));

  check('normalizarRecomendacion nunca inventa texto: si no hay texto cargado, queda vacío, no una indicación inventada', normalizarRecomendacion('r4', {}).texto === '');
  check('validación: sin texto es inválida', recomendacionValida({ pacienteNombre: 'X', texto: '' }).ok === false);
  check('validación: sin paciente es inválida', recomendacionValida({ pacienteNombre: '', texto: 'hola' }).ok === false);
  check('validación: con texto y paciente es válida', recomendacionValida({ pacienteNombre: 'X', texto: 'hola' }).ok === true);
}

console.log('\n=== GlowUp — resumen agrupado para el aviso horario ("2 recomendaciones, 1 consulta y 1 kit") ===');
{
  check('sin pendientes, no hay texto de resumen (nunca se avisa vacío)', resumenTextoPendientes([]) === null);
  const lista = [
    { tipo: 'recomendacion' }, { tipo: 'recomendacion' },
    { tipo: 'confirmacion_turno' }, { tipo: 'kit_pendiente' },
  ];
  const txt = resumenTextoPendientes(lista);
  check('agrupa por tipo con cantidades, un solo resumen (no un aviso por registro)', txt === 'Tenés 4 pendientes: 2 recomendaciones, 1 turno por confirmar y 1 kit.');
  check('un solo pendiente usa singular correctamente', resumenTextoPendientes([{ tipo: 'kit_pendiente' }]) === 'Tenés 1 pendiente: 1 kit.');
  const conteo = contarPendientesPorTipo(lista);
  check('contarPendientesPorTipo desglosa exacto', conteo.recomendacion === 2 && conteo.confirmacion_turno === 1 && conteo.kit_pendiente === 1 && conteo.cumpleanos === 0);
}

console.log('\n=== GlowUp — elegibilidad para el aviso horario: pausa, categorías, postergado, descanso nocturno ===');
{
  const pendientes = [{ id: 'p1', tipo: 'recomendacion' }, { id: 'p2', tipo: 'kit_pendiente' }];
  check('por defecto (sin config) todo es elegible', pendientesElegiblesParaAviso(pendientes, PREFS_AVISOS_DEFECTO, {}).length === 2);
  check('avisos desactivados → nada es elegible', pendientesElegiblesParaAviso(pendientes, { ...PREFS_AVISOS_DEFECTO, activo: false }, {}).length === 0);
  check('pausado hasta un momento futuro → nada es elegible todavía', pendientesElegiblesParaAviso(pendientes, { ...PREFS_AVISOS_DEFECTO, pausadoHastaMs: Date.now() + 3600000 }, {}).length === 0);
  check('pausa ya vencida → vuelve a ser elegible', pendientesElegiblesParaAviso(pendientes, { ...PREFS_AVISOS_DEFECTO, pausadoHastaMs: Date.now() - 1000 }, {}).length === 2);
  check('categoría no habilitada → se excluye solo esa', pendientesElegiblesParaAviso(pendientes, { ...PREFS_AVISOS_DEFECTO, categorias: ['recomendacion'] }, {}).length === 1);
  const ahoraPost = Date.now();
  check('postergado hasta más adelante → no elegible por ahora', pendientesElegiblesParaAviso(pendientes, PREFS_AVISOS_DEFECTO, { p1: { postergadoHastaMs: ahoraPost + 3600000 } }, ahoraPost).length === 1);
  check('la postergación ya venció → vuelve a ser elegible', pendientesElegiblesParaAviso(pendientes, PREFS_AVISOS_DEFECTO, { p1: { postergadoHastaMs: ahoraPost - 1000 } }, ahoraPost).length === 2);
  check('marcado resuelto explícitamente → nunca vuelve a avisar por esa vía', pendientesElegiblesParaAviso(pendientes, PREFS_AVISOS_DEFECTO, { p1: { resuelto: true } }, ahoraPost).length === 1);

  // Descanso nocturno: rango que cruza medianoche (22 a 8).
  const prefsDescanso = { ...PREFS_AVISOS_DEFECTO, descansoInicioHora: 22, descansoFinHora: 8 };
  const unaAM = new Date(`${HOY}T01:00:00-03:00`).getTime();
  const dosPM = new Date(`${HOY}T14:00:00-03:00`).getTime();
  check('01:00 cae dentro del descanso 22→8 (cruza medianoche)', enDescansoNocturno(prefsDescanso, unaAM) === true);
  check('14:00 NO cae dentro del descanso 22→8', enDescansoNocturno(prefsDescanso, dosPM) === false);
  check('sin descanso configurado, nunca se considera "en descanso"', enDescansoNocturno(PREFS_AVISOS_DEFECTO, unaAM) === false);
  check('en descanso nocturno, ningún pendiente es elegible para el aviso', pendientesElegiblesParaAviso(pendientes, prefsDescanso, {}, unaAM).length === 0);
}

console.log('\n=== Corrección "solo aparecen kits": turno pasado sin revisar ===');
{
  const ayerISO = sumarDiasISO(HOY, -1);
  const sinNota = normalizarItemAgenda('reservas', 'pv1', { nombre: 'Paciente Viejo', fecha: ayerISO, hora: '14:00', telefono: '3760000009', estado: 'confirmado' });
  const rt = calcularRevisarTurnoPasado(sinNota, new Date(`${HOY}T00:00:00-03:00`).getTime());
  check('un turno de ayer sin detalleSesion genera "revisar_turno"', rt !== null);

  const conNota = normalizarItemAgenda('reservas', 'pv2', { nombre: 'Paciente Atendido', fecha: ayerISO, hora: '14:00', telefono: '3760000008', estado: 'confirmado', detalleSesion: 'Todo bien.' });
  check('un turno de ayer CON detalleSesion no genera "revisar_turno"', calcularRevisarTurnoPasado(conNota, new Date(`${HOY}T00:00:00-03:00`).getTime()) === null);

  const cancelado = normalizarItemAgenda('reservas', 'pv3', { nombre: 'Cancelado', fecha: ayerISO, hora: '14:00', estado: 'cancelado' });
  check('un turno cancelado nunca requiere "revisar_turno"', calcularRevisarTurnoPasado(cancelado, new Date(`${HOY}T00:00:00-03:00`).getTime()) === null);

  const agenda = construirAgenda([
    normalizarItemAgenda('reservas', 'pv1', { nombre: 'Paciente Viejo', fecha: ayerISO, hora: '14:00', telefono: '3760000009', estado: 'confirmado' }),
  ], []);
  const ahoraHoy = new Date(`${HOY}T00:00:00-03:00`).getTime();
  const pends = derivarPendientes({ agenda, pedidosKitPendientes: [], cumpleanosHoy: null, recomendaciones: [], contactosPorId: {} }, ahoraHoy);
  check('derivarPendientes incluye el turno viejo como tipo "revisar_turno"', pends.some((p) => p.docId === 'pv1' && p.tipo === 'revisar_turno'));
}

console.log('\n=== Corrección de teléfono: fallback por DNI (caso Arenhardt Yamila) ===');
{
  check('con teléfono propio, se usa ese — nunca se consulta el fallback', resolverTelefonoConFallback('3757670046', '32899820', { '32899820': { telefono: '000' } }) === '3757670046');
  check('con teléfono propio vacío ("") y dni con ficha, usa el de la ficha', resolverTelefonoConFallback('', '32899820', { '32899820': { telefono: '3757670046' } }) === '3757670046');
  check('sin teléfono propio, sin dni, no inventa nada: null', resolverTelefonoConFallback('', null, { '32899820': { telefono: '3757670046' } }) === null);
  check('sin teléfono propio, con dni que no está en el mapa: null (nunca el de otra persona)', resolverTelefonoConFallback('', '00000000', { '32899820': { telefono: '3757670046' } }) === null);
  check('el fallback también acepta el campo "phone" de la ficha', resolverTelefonoConFallback('', '1', { '1': { phone: '3760001111' } }) === '3760001111');

  // Reproduce el caso real: reserva con phone/telefono en "" (no ausente),
  // dni "32899820" — igual que en producción.
  const clientesPorDni = { '32899820': { telefono: '3757670046', dni: '32899820' } };
  const itemYamila = normalizarItemAgenda('reservas', 'y1', { nombre: 'Arenhardt Yamila', dni: '32899820', fecha: HOY, hora: '14:00', telefono: '', phone: '', estado: 'confirmado' }, clientesPorDni);
  check('normalizarItemAgenda resuelve el teléfono de Yamila vía clients/{dni}', itemYamila.telefono === '3757670046');
  check('queda marcado que el teléfono vino del fallback, no del propio documento', itemYamila.telefonoDeFallback === true);

  // Sin el mapa de clientes (comportamiento anterior a esta corrección) sigue sin teléfono.
  const itemSinMapa = normalizarItemAgenda('reservas', 'y1', { nombre: 'Arenhardt Yamila', dni: '32899820', fecha: HOY, hora: '14:00', telefono: '', phone: '' });
  check('sin el mapa de clientes, el comportamiento previo se mantiene (sin teléfono)', itemSinMapa.telefono === null);

  // Un homónimo con OTRO dni nunca puede terminar usando el teléfono de Yamila.
  const itemHomonimo = normalizarItemAgenda('consultas', 'y2', { nombre: 'Yamila De Olivera', dni: '45777375', fecha: HOY, hora: '20:00', telefono: '3757585519' }, clientesPorDni);
  check('un homónimo con teléfono propio conserva EL SUYO, nunca el de Yamila', itemHomonimo.telefono === '3757585519');
  const itemHomonimoSinTel = normalizarItemAgenda('consultas', 'y3', { nombre: 'Otra Yamila', dni: '11111111', fecha: HOY, hora: '20:00' }, clientesPorDni);
  check('un homónimo SIN teléfono y sin ficha propia en el mapa queda sin teléfono (nunca hereda el de Yamila)', itemHomonimoSinTel.telefono === null);
}

console.log('\n=== Pendiente bloqueado por dato obligatorio faltante (teléfono) ===');
{
  const agendaBloqueada = construirAgenda([
    normalizarItemAgenda('reservas', 'b1', { nombre: 'Sin Teléfono Real', fecha: HOY, hora: '14:00', estado: 'confirmado' }),
  ], []);
  const ahoraCerca = new Date(`${HOY}T13:00:00-03:00`).getTime();
  const pendsBloq = derivarPendientes({ agenda: agendaBloqueada, pedidosKitPendientes: [], cumpleanosHoy: null, recomendaciones: [], contactosPorId: {} }, ahoraCerca);
  const pb = pendsBloq.find((p) => p.docId === 'b1');
  check('sin teléfono resoluble, el pendiente de confirmación queda bloqueado=true', pb && pb.bloqueado === true && pb.campoFaltante === 'telefono');

  const agendaConFallback = construirAgenda([
    normalizarItemAgenda('reservas', 'b2', { nombre: 'Arenhardt Yamila', dni: '32899820', fecha: HOY, hora: '14:00', telefono: '', estado: 'confirmado' }, { '32899820': { telefono: '3757670046' } }),
  ], []);
  const pendsConFallback = derivarPendientes({ agenda: agendaConFallback, pedidosKitPendientes: [], cumpleanosHoy: null, recomendaciones: [], contactosPorId: {} }, ahoraCerca);
  const pcf = pendsConFallback.find((p) => p.docId === 'b2');
  check('con teléfono resuelto vía DNI, el pendiente NO queda bloqueado', pcf && pcf.bloqueado === false);
}

console.log('\n=== Config de Gimena: validación/normalización de teléfono (punto 9) ===');
{
  const v1 = validarYNormalizarTelefonoAR('376 4291807');
  check('"376 4291807" es válido', v1.ok === true);
  check('dígitos wa.me = 5493764291807 (ejemplo exacto del pedido)', v1.digitos === '5493764291807');
  check('mostrable = "+54 9 376 4291807" (ejemplo exacto del pedido)', v1.mostrable === '+54 9 376 4291807');

  const v2 = validarYNormalizarTelefonoAR('03764291807');
  check('con 0 inicial también normaliza al mismo destino', v2.ok === true && v2.digitos === '5493764291807');

  const v3 = validarYNormalizarTelefonoAR('');
  check('vacío → error claro, no revienta', v3.ok === false && typeof v3.error === 'string');

  const v4 = validarYNormalizarTelefonoAR('12');
  check('número demasiado corto → inválido, nunca se fuerza un destino inventado', v4.ok === false);

  const v5 = validarYNormalizarTelefonoAR('abc');
  check('sin dígitos → inválido', v5.ok === false);
}

console.log('\n=== Fecha/hora local legible (punto 10 — nunca ISO crudo) ===');
{
  const ISO = '2026-09-15T23:24:32.372Z';
  check('formatearFechaHoraLocal: ISO → "15/09/2026, 20:24" (ejemplo exacto del pedido)', formatearFechaHoraLocal(ISO) === '15/09/2026, 20:24');
  check('formatearFechaLocal: solo la fecha', formatearFechaLocal(ISO) === '15/09/2026');
  check('formatearHoraLocal: 24 horas, nunca "p. m."', formatearHoraLocal(ISO) === '20:24');
  check('diaSemanaLegible: 15/09/2026 es martes', diaSemanaLegible(ISO) === 'martes');
  check('acepta también un Timestamp de Firestore (objeto con toMillis())', formatearFechaHoraLocal({ toMillis: () => new Date(ISO).getTime() }) === '15/09/2026, 20:24');
}

console.log('\n=== Referencia temporal relativa + fecha exacta (punto 10) ===');
{
  const ahora = new Date('2026-09-17T15:00:00-03:00').getTime(); // jueves
  const hoy = new Date('2026-09-17T10:00:00-03:00').getTime();
  const ayer = new Date('2026-09-16T10:00:00-03:00').getTime();
  const anteAyer = new Date('2026-09-14T10:00:00-03:00').getTime(); // lunes
  check('mismo día calendario → "hoy, <fecha>"', referenciaTemporalConFecha(hoy, ahora) === 'hoy, 17/09/2026');
  check('un día antes → "ayer, <fecha>"', referenciaTemporalConFecha(ayer, ahora) === 'ayer, 16/09/2026');
  check('más de un día antes → "el <día> <fecha>", nunca "hace 3 días" sin fecha', referenciaTemporalConFecha(anteAyer, ahora) === 'el lunes 14/09/2026');
}

console.log('\n=== Plantilla "Avisar a Gimena" — pedido de kit (caso Aylen S del pedido) ===');
{
  const kitAylen = {
    nombre: 'Aylen S',
    fechaPedidoMs: new Date('2026-09-15T23:24:32.372Z').getTime(),
    items: [
      { nombre: 'Leche de limpieza', cantidad: 1, subtotal: 20000, subtotalCompleto: true },
      { nombre: 'Tónico calmante', cantidad: 1, subtotal: 20000, subtotalCompleto: true },
    ],
    totalTexto: formatearARS(40000),
    montoAbonadoTexto: 'No registrado',
    saldoPendienteTexto: 'No registrado',
    estadoPedido: 'pendiente',
    discrepanciaTotal: null,
    entrega: null,
    observaciones: null,
  };
  const texto = construirTextoAvisoDuenaKit(kitAylen);
  check('empieza con el trato "Gime," (no un saludo tipo "Hola")', texto.startsWith('Gime, tenés un pedido de kit de Aylen S.'));
  check('incluye la fecha/hora local de la solicitud, no el ISO crudo', texto.includes('20:24') && !texto.includes('2026-09-15T23:24:32.372Z'));
  check('lista los productos con su importe', texto.includes('Leche de limpieza') && texto.includes('Tónico calmante'));
  check('total del pedido = $40.000 (viene de datos, no de un valor cargado a mano acá)', texto.includes(kitAylen.totalTexto));
  check('monto abonado y saldo NO se inventan como $0 ni como pagado: "No registrado"', texto.includes('Monto abonado: No registrado.') && texto.includes('Saldo pendiente: No registrado.'));
  check('no queda ninguna llave sin resolver ni "undefined"', !/\{.*\}/.test(texto) && !texto.includes('undefined'));
}

console.log('\n=== Plantilla "Avisar a Gimena" — consulta inicial agendada vs. solicitud sin turno ===');
{
  const consultaAgendada = normalizarItemAgenda('consultas', 'c1', {
    nombre: 'Braulio Verón', fecha: '2026-09-21', hora: '10:30', duracionMinutos: 30,
    estado: 'pendiente', box: 'b2', timestamp: { toMillis: () => new Date('2026-09-17T14:00:00-03:00').getTime() },
  });
  check('con fecha/hora, fechaIncompleta = false (va a la plantilla de "se agendó")', consultaAgendada.fechaIncompleta === false);
  const textoAgendada = construirTextoAvisoDuenaConsulta(consultaAgendada, 'Pendiente de enviar confirmación');
  check('plantilla "agendada": trato "Gime," y menciona la duración real (30 minutos)', textoAgendada.startsWith('Gime, se agendó una consulta inicial para Braulio Verón.') && textoAgendada.includes('30 minutos'));
  check('incluye box y fecha de registro, ambos reales', textoAgendada.includes('Box: b2.') && textoAgendada.includes('Reserva registrada:'));

  const consultaSinTurno = normalizarItemAgenda('consultas', 'c2', {
    nombre: 'Persona Nueva', servicio: 'Fraxis Facial',
    createdAt: { toMillis: () => new Date('2026-09-16T09:00:00-03:00').getTime() },
    telefono: '3764000000',
  });
  check('sin fecha/hora, fechaIncompleta = true (va a la plantilla de "solicitud")', consultaSinTurno.fechaIncompleta === true);
  const textoSolicitud = construirTextoAvisoDuenaConsulta(consultaSinTurno, '—');
  check('plantilla "solicitud": nunca dice "se agendó" si no hay turno', textoSolicitud.startsWith('Gime, recibiste una solicitud de consulta inicial de Persona Nueva.') && !textoSolicitud.includes('se agendó'));
  check('estado explícito "pendiente de coordinación"', textoSolicitud.includes('Estado: pendiente de coordinación.'));
  check('incluye el servicio de interés real', textoSolicitud.includes('Fraxis Facial'));
}

console.log('\n=== Franja mañana/tarde y día para avisar (puntos 16-17) ===');
{
  check('turno 10:30 (antes del corte 12:00) → franja "mañana"', franjaDeHora('10:30') === 'mañana');
  check('turno 16:00 (después del corte) → franja "tarde"', franjaDeHora('16:00') === 'tarde');
  check('turno exactamente a las 12:00 → franja "tarde" (el corte es el límite de la mañana, no incluido en ella)', franjaDeHora('12:00') === 'tarde');

  check('turno de mañana lunes 21/09 → avisar el domingo 20/09 (noche anterior)', fechaAvisoConfirmacion('2026-09-21', '10:30') === '2026-09-20');
  check('turno de tarde lunes 21/09 → avisar el mismo lunes 21/09 (mediodía)', fechaAvisoConfirmacion('2026-09-21', '16:00') === '2026-09-21');
}

console.log('\n=== Texto de tarjeta sin "vence" para la hora del turno (punto 16) ===');
{
  const ahora = new Date('2026-09-20T20:00:00-03:00').getTime(); // domingo a la noche
  const turnoMananaLunes = { ocurrencia: { fecha: '2026-09-21', hora: '10:30' } };
  check('"Consulta: mañana, lunes {fecha}, 10:30 hs." — ejemplo exacto del pedido', textoTurnoConDia(turnoMananaLunes, ahora) === 'Consulta: mañana, lunes 21/09/2026, 10:30 hs.');

  const ahoraLunesMediodia = new Date('2026-09-21T12:30:00-03:00').getTime();
  const turnoTardeLunes = { ocurrencia: { fecha: '2026-09-21', hora: '16:00' } };
  check('"Consulta: hoy, lunes {fecha}, 16:00 hs." — ejemplo exacto del pedido', textoTurnoConDia(turnoTardeLunes, ahoraLunesMediodia) === 'Consulta: hoy, lunes 21/09/2026, 16:00 hs.');

  const turnoYaPasado = { ocurrencia: { fecha: '2026-09-18', hora: '09:00' } };
  const textoP = textoTurnoConDia(turnoYaPasado, ahora);
  check('turno ya pasado → "La consulta fue el..., revisar", nunca lo anuncia como si fuera futuro', textoP.startsWith('La consulta fue el') && textoP.includes('revisar'));
  check('nunca usa la palabra "vence" para la hora de un turno', !textoP.toLowerCase().includes('vence') && !textoTurnoConDia(turnoMananaLunes, ahora).toLowerCase().includes('vence'));
}

console.log('\n=== Agrupación de Pendientes por día (puntos 16-17) — hoy/mañana/anteriores/próximos ===');
{
  const ahora = new Date('2026-09-17T10:00:00-03:00').getTime(); // jueves
  const pendientes = [
    { id: 'p1', fechaActuarISO: '2026-09-17' },               // hoy
    { id: 'p2', fechaActuarISO: '2026-09-18' },               // mañana
    { id: 'p3', fechaActuarISO: '2026-09-10' },               // atrasado (una semana)
    { id: 'p4', fechaActuarISO: '2026-09-15' },               // atrasado (otro día distinto)
    { id: 'p5', fechaActuarISO: '2026-09-25' },               // próximo
    { id: 'p6', fechaActuarISO: null },                       // sin fecha específica → se trata como "hoy" (habilitado ahora)
  ];
  const g = agruparPendientesPorDia(pendientes, ahora);
  check('agrupa "hoy" incluyendo los que no tienen fechaActuarISO (habilitados ahora)', g.hoy.map((p) => p.id).sort().join(',') === 'p1,p6');
  check('agrupa "mañana" (día calendario siguiente)', g.manana.map((p) => p.id).join(',') === 'p2');
  check('"anteriores" queda desglosado por fecha real, no mezclado en un solo bloque', g.anterioresPorFecha.length === 2);
  check('los atrasados están ordenados cronológicamente (el más viejo primero)', g.anterioresPorFecha[0][0] === '2026-09-10' && g.anterioresPorFecha[1][0] === '2026-09-15');
  check('"próximos" desglosa por fecha también', g.proximosPorFecha.length === 1 && g.proximosPorFecha[0][0] === '2026-09-25');
}

console.log('\n=== derivarPendientes: confirmacion_turno trae fechaActuarISO/franja reales ===');
{
  const ahora = new Date('2026-09-20T20:00:00-03:00').getTime(); // domingo a la noche
  const agenda = construirAgenda([
    normalizarItemAgenda('reservas', 'rM', { nombre: 'Turno Mañana', fecha: '2026-09-21', hora: '10:30', telefono: '3764000001', estado: 'confirmado' }),
    normalizarItemAgenda('reservas', 'rT', { nombre: 'Turno Tarde', fecha: '2026-09-21', hora: '16:00', telefono: '3764000002', estado: 'confirmado' }),
  ], []);
  const pend = derivarPendientes({ agenda, pedidosKitPendientes: [], cumpleanosHoy: null, recomendaciones: [], contactosPorId: {} }, ahora);
  const pM = pend.find((p) => p.docId === 'rM');
  const pT = pend.find((p) => p.docId === 'rT');
  check('turno de mañana: franja="mañana" y fechaActuarISO = el día calendario anterior', pM && pM.franja === 'mañana' && pM.fechaActuarISO === '2026-09-20');
  check('turno de tarde: franja="tarde" y fechaActuarISO = el mismo día del turno', pT && pT.franja === 'tarde' && pT.fechaActuarISO === '2026-09-21');
}

console.log('\n' + '='.repeat(60));
console.log(fails ? (fails + ' prueba(s) fallaron') : 'TODAS LAS PRUEBAS OK');
process.exit(fails ? 1 : 0);
