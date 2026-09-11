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
  check('id de contacto compone coleccion_id_tipo', idContactoParaItem(it, 'confirmacion') === 'reservas_rK_confirmacion');
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

console.log('\n' + '='.repeat(60));
console.log(fails ? (fails + ' prueba(s) fallaron') : 'TODAS LAS PRUEBAS OK');
process.exit(fails ? 1 : 0);
