// Pruebas de la lógica pura de "Pacientes de la Doctora" — sin Firestore,
// sin red, sin navegador. Datos 100% ficticios (nunca los pacientes reales
// de la carga inicial). Corre con: node tests/doctora/run-tests.js
import {
  normalizarDni, dniValido, telefonoValido, calcularActualizacionPaciente,
  generarHorariosDelDia, fechaAceptaTurnosNuevos, horarioDentroDeRango,
  puedeReservarHorario, estadoTemporalTurnoDoctora, etiquetaEstadoTemporalDoctora,
  esPendienteDeHorario, etiquetaConfirmacionPaciente,
  construirTextoConfirmacionDoctora, construirTextoRecordatorioDoctora,
  construirTextoRecomendacionesDoctora, normalizarTelefonoWA, sumarDiasISO,
  fechaLindaCorta, puedeEnviarRecordatorio,
  pesosAcentavos, centavosApesos, formatoPesosAR, medioPagoValido, validarMediosPago,
  etiquetaMediosPago, calcularRepartoDoctora, resumenDineroTurno, calcularCierreJornada,
  armarDetalleCierre,
} from '../../doctora/doctora-logic.js';

let fails = 0;
const check = (desc, cond) => { console.log((cond ? '  OK  ' : '  FAIL ') + desc); if (!cond) fails++; };

const HOY = '2026-09-15';
const MAÑANA = sumarDiasISO(HOY, 1);

console.log('\n=== DNI: normalización y validación ===');
{
  check('quita puntos y espacios', normalizarDni('11.222.333') === '11222333');
  check('quita guiones', normalizarDni('22-333-444') === '22333444');
  check('ya limpio queda igual', normalizarDni('99887766') === '99887766');
  check('vacío/undefined no explota', normalizarDni(undefined) === '' && normalizarDni(null) === '');
  check('8 dígitos es válido', dniValido('11222333') === true);
  check('muy corto no es válido', dniValido('123') === false);
  check('con letras sigue evaluando solo los dígitos', dniValido('DNI 11222333') === true);
}

console.log('\n=== Teléfono: validación básica ===');
{
  check('teléfono de 10 dígitos es válido', telefonoValido('3764000000') === true);
  check('teléfono muy corto no es válido', telefonoValido('123') === false);
  check('normalizarTelefonoWA arma el prefijo 549 (reusa mimar-inteligente-logic)', normalizarTelefonoWA('3764000000') === '5493764000000');
}

console.log('\n=== Alta/edición de paciente: nunca pisa, nunca duplica ===');
{
  const nuevoPaciente = calcularActualizacionPaciente(null, { nombre: 'Paciente De Prueba', telefono: '3760000001' });
  check('sin registro existente → accion "crear"', nuevoPaciente.accion === 'crear');
  check('crea con los datos dados', nuevoPaciente.datos.nombre === 'Paciente De Prueba' && nuevoPaciente.datos.telefono === '3760000001');

  const existenteCompleto = { nombre: 'Paciente De Prueba', telefono: '3760000001' };
  const mismosDatos = calcularActualizacionPaciente(existenteCompleto, { nombre: 'Paciente De Prueba', telefono: '3760000001' });
  check('mismos datos otra vez → accion "reutilizar", no hay nada que escribir', mismosDatos.accion === 'reutilizar' && Object.keys(mismosDatos.datos).length === 0);
  check('reutilizar no genera conflictos', mismosDatos.conflictos.length === 0);

  const existenteIncompleto = { nombre: 'Paciente De Prueba', telefono: '' };
  const completando = calcularActualizacionPaciente(existenteIncompleto, { nombre: 'Paciente De Prueba', telefono: '3760000002' });
  check('teléfono vacío se completa con el nuevo dato', completando.accion === 'completar' && completando.datos.telefono === '3760000002');
  check('completar un campo vacío no genera conflicto', completando.conflictos.length === 0);
  check('el nombre no cambia porque ya estaba cargado y coincide', completando.datos.nombre === undefined);

  const conConflicto = calcularActualizacionPaciente(existenteCompleto, { nombre: 'Paciente De Prueba', telefono: '3769999999' });
  check('teléfono distinto al ya cargado → conflicto, no se pisa solo', conConflicto.conflictos.some((c) => c.campo === 'telefono'));
  check('un conflicto no se resuelve escribiendo el nuevo valor automáticamente', conConflicto.datos.telefono === undefined);
}

console.log('\n=== Horarios: generación de la grilla del día ===');
{
  const horarios = generarHorariosDelDia('15:00', '18:00', 30);
  check('genera 6 horarios de 30 min entre 15:00 y 18:00', horarios.length === 6);
  check('empieza en 15:00', horarios[0] === '15:00');
  check('el último es 17:30, no 18:00 (horaFin es exclusivo)', horarios[horarios.length - 1] === '17:30' && !horarios.includes('18:00'));
  check('horaInicio inválida devuelve vacío, no explota', generarHorariosDelDia('', '18:00', 30).length === 0);
  check('duración 0 devuelve vacío (evita loop infinito)', generarHorariosDelDia('15:00', '18:00', 0).length === 0);
}

console.log('\n=== Fecha habilitada: acepta turnos solo si está explícitamente habilitada ===');
{
  check('sin documento → no acepta turnos', fechaAceptaTurnosNuevos(null) === false);
  check('documento con habilitada:false → no acepta', fechaAceptaTurnosNuevos({ habilitada: false }) === false);
  check('documento con habilitada:true → sí acepta', fechaAceptaTurnosNuevos({ habilitada: true }) === true);
  check('deshabilitar (habilitada:false) sigue siendo un documento existente, no lo "borra" conceptualmente', fechaAceptaTurnosNuevos({ habilitada: false, horaInicio: '15:00' }) === false);

  const fechaDoc = { habilitada: true, horaInicio: '15:00', horaFin: '18:00' };
  check('15:00 está dentro del rango', horarioDentroDeRango('15:00', fechaDoc) === true);
  check('18:00 NO está dentro (exclusivo)', horarioDentroDeRango('18:00', fechaDoc) === false);
  check('14:30 no está dentro', horarioDentroDeRango('14:30', fechaDoc) === false);
}

console.log('\n=== Reserva de horario: disponibilidad y permisos, incluso ante carreras ===');
{
  const fechaHabilitada = { habilitada: true, horaInicio: '15:00', horaFin: '18:00' };
  const fechaBloqueada = { habilitada: false, horaInicio: '15:00', horaFin: '18:00' };

  check('fecha no habilitada → rechazado con motivo explícito', puedeReservarHorario({ fechaDoc: fechaBloqueada, hora: '15:00', slotDoc: null }).motivo === 'fecha_no_habilitada');
  check('fecha habilitada, horario libre → aceptado', puedeReservarHorario({ fechaDoc: fechaHabilitada, hora: '15:00', slotDoc: null }).ok === true);
  check('horario fuera del rango configurado → rechazado', puedeReservarHorario({ fechaDoc: fechaHabilitada, hora: '20:00', slotDoc: null }).motivo === 'fuera_de_horario');

  const slotOcupadoPorOtro = { ocupado: true, turnoId: 'turno-A' };
  check('slot ocupado por otro turno → rechazado (esto es lo que evita el doble booking simultáneo)',
    puedeReservarHorario({ fechaDoc: fechaHabilitada, hora: '15:00', slotDoc: slotOcupadoPorOtro, turnoIdPropio: 'turno-B' }).motivo === 'horario_ocupado');
  check('slot ocupado por el MISMO turno (reafirmar/editar) → sigue permitido',
    puedeReservarHorario({ fechaDoc: fechaHabilitada, hora: '15:00', slotDoc: slotOcupadoPorOtro, turnoIdPropio: 'turno-A' }).ok === true);
  check('slot liberado (ocupado:false) aunque tenga turnoId viejo → disponible de nuevo',
    puedeReservarHorario({ fechaDoc: fechaHabilitada, hora: '15:00', slotDoc: { ocupado: false, turnoId: 'turno-viejo' }, turnoIdPropio: 'turno-C' }).ok === true);
}

console.log('\n=== Estado temporal del turno: nunca "realizado" solo por la fecha ===');
{
  const turnoFuturo = { fecha: MAÑANA, hora: '10:00', duracionMin: 30 };
  check('turno de mañana → "proximo"', estadoTemporalTurnoDoctora(turnoFuturo, new Date(`${HOY}T09:00:00-03:00`).getTime()) === 'proximo');

  const turnoPasado = { fecha: HOY, hora: '08:00', duracionMin: 30 };
  const estadoPasado = estadoTemporalTurnoDoctora(turnoPasado, new Date(`${HOY}T20:00:00-03:00`).getTime());
  check('turno ya terminado → "pasado" (nunca "realizado": esa palabra no existe acá)', estadoPasado === 'pasado');
  check('la etiqueta de "pasado" no afirma que la atención se haya realizado', etiquetaEstadoTemporalDoctora(estadoPasado) === 'Turno pasado');

  const pendienteDeHorario = { fecha: HOY, hora: null };
  check('sin hora asignada → "sin_horario", no se inventa un estado temporal', estadoTemporalTurnoDoctora(pendienteDeHorario) === 'sin_horario');
  check('esPendienteDeHorario detecta correctamente los turnos sin horario', esPendienteDeHorario(pendienteDeHorario) === true);
  check('un turno con hora asignada no es "pendiente de horario"', esPendienteDeHorario(turnoFuturo) === false);
}

console.log('\n=== Confirmación de asistencia de la paciente: nunca se confunde con el envío ===');
{
  check('sin campo confirmacionPaciente → estado explícito de "sin confirmación"', etiquetaConfirmacionPaciente({}) === 'Sin confirmación de la paciente');
  check('confirmacionPaciente.confirmado=true → "Confirmó asistencia"', etiquetaConfirmacionPaciente({ confirmacionPaciente: { confirmado: true } }) === 'Confirmó asistencia');
  check('confirmacionPaciente.confirmado=false → "Avisó que no viene", distinto de "sin confirmación"', etiquetaConfirmacionPaciente({ confirmacionPaciente: { confirmado: false } }) === 'Avisó que no viene');
}

console.log('\n=== Plantillas de mensaje: datos reales del turno, sin inventar contenido clínico ===');
{
  const turno = { pacienteNombre: 'Paciente De Prueba Apellido', fecha: HOY, hora: '15:30' };
  const confirmacion = construirTextoConfirmacionDoctora(turno, 'Consultorio 3');
  check('confirmación usa el primer nombre', confirmacion.startsWith('Hola Paciente,'));
  check('confirmación incluye fecha, hora y ubicación reales', confirmacion.includes(HOY) && confirmacion.includes('15:30') && confirmacion.includes('Consultorio 3'));
  check('sin ubicación configurada, no se inventa una', !construirTextoConfirmacionDoctora(turno, '').includes('Te esperamos en'));

  const recordatorio = construirTextoRecordatorioDoctora(turno);
  check('recordatorio usa el nombre, la hora real y el saludo con emoji pedidos', recordatorio.includes('Hola, Paciente 💚') && recordatorio.includes('15:30'));
  check('recordatorio menciona la fecha en formato legible, no el ISO crudo', recordatorio.includes(fechaLindaCorta(HOY)) && !recordatorio.includes(HOY));
  check('recordatorio siempre menciona el lugar fijo pedido', recordatorio.includes('en Espacio Mimar T'));
  check('recordatorio pide confirmar asistencia y ofrece reprogramar, como en el ejemplo dado', recordatorio.includes('¿Nos confirmás tu asistencia?') && recordatorio.includes('reprogramar'));

  const recomendacionesVacias = construirTextoRecomendacionesDoctora(turno, '');
  check('sin contenido escrito por la doctora, se deja un placeholder explícito (no se inventa contenido clínico)',
    recomendacionesVacias.includes('[Escribí acá las recomendaciones'));
  const recomendacionesConTexto = construirTextoRecomendacionesDoctora(turno, 'Tomar la medicación indicada cada 8 horas.');
  check('con contenido de la doctora, se usa tal cual', recomendacionesConTexto.includes('Tomar la medicación indicada cada 8 horas.'));
  check('el contenido de la doctora no se reemplaza por el placeholder', !recomendacionesConTexto.includes('[Escribí acá'));
}

console.log('\n=== "Recordatorios de hoy": nunca para turnos eliminados, cancelados, pasados o sin horario ===');
{
  const turnoProximo = { fecha: sumarDiasISO(HOY, 1), hora: '10:00', duracionMin: 30, estado: 'confirmado' };
  check('turno próximo con horario → sí admite recordatorio', puedeEnviarRecordatorio(turnoProximo, new Date(`${HOY}T09:00:00-03:00`).getTime()) === true);

  const turnoCancelado = { fecha: HOY, hora: '15:00', duracionMin: 30, estado: 'cancelado' };
  check('turno cancelado → NO admite el recordatorio estándar', puedeEnviarRecordatorio(turnoCancelado) === false);

  const turnoPasado = { fecha: HOY, hora: '08:00', duracionMin: 30, estado: 'confirmado' };
  check('turno cuyo horario ya pasó → NO admite el recordatorio estándar', puedeEnviarRecordatorio(turnoPasado, new Date(`${HOY}T20:00:00-03:00`).getTime()) === false);

  const turnoSinHorario = { fecha: HOY, hora: null, estado: 'pendiente_horario' };
  check('turno todavía sin horario asignado → NO admite recordatorio (no se inventa un horario)', puedeEnviarRecordatorio(turnoSinHorario) === false);

  check('turno inexistente (null) → nunca admite recordatorio', puedeEnviarRecordatorio(null) === false);
}

console.log('\n=== Dinero: pesos ↔ centavos, sin floats, "Sin cargar" ≠ 0 ===');
{
  check('"1500" → 150000 centavos', pesosAcentavos('1500') === 150000);
  check('"1500.50" → 150050 centavos', pesosAcentavos('1500.50') === 150050);
  check('"1500,50" (coma decimal) → 150050 centavos', pesosAcentavos('1500,50') === 150050);
  check('"1.500,50" (miles con punto) → 150050 centavos', pesosAcentavos('1.500,50') === 150050);
  check('"100000" (ejemplo de aceptación) → 10000000 centavos', pesosAcentavos('100000') === 10000000);
  check('vacío → null (no 0, "sin cargar" no es lo mismo que "cargado en $0")', pesosAcentavos('') === null);
  check('null → null', pesosAcentavos(null) === null);
  check('undefined → null', pesosAcentavos(undefined) === null);
  check('negativo → inválido (null)', pesosAcentavos('-100') === null);
  check('texto no numérico → inválido (null)', pesosAcentavos('abc') === null);
  // "100.999" con punto es ambiguo con el separador de miles argentino
  // (100.999 = cien mil novecientos noventa y nueve) y se interpreta así a
  // propósito; con coma decimal no hay ambigüedad posible.
  check('3 decimales con coma → inválido (null)', pesosAcentavos('100,999') === null);
  check('"100.999" con punto se interpreta como miles (100999 pesos), no como 3 decimales', pesosAcentavos('100.999') === 10099900);
  check('centavosApesos hace el camino inverso', centavosApesos(150050) === 1500.5);
  check('formatoPesosAR de 10000000 centavos da "$ 100.000,00"', formatoPesosAR(10000000) === '$ 100.000,00');
  check('formatoPesosAR de null → null (el "Sin cargar" lo decide quien llama)', formatoPesosAR(null) === null);
}

console.log('\n=== Dinero: medios de pago, incluidos combinados ===');
{
  check('efectivo es un medio válido', medioPagoValido('efectivo') === true);
  check('"bitcoin" no es un medio válido', medioPagoValido('bitcoin') === false);

  const unSoloMedio = [{ tipo: 'efectivo', montoCentavos: 150000 }];
  check('un solo medio que suma exacto → válido', validarMediosPago(unSoloMedio, 150000).ok === true);
  check('un solo medio que NO suma exacto → inválido', validarMediosPago(unSoloMedio, 150001).ok === false);

  const combinado = [{ tipo: 'efectivo', montoCentavos: 100000 }, { tipo: 'tarjeta', montoCentavos: 50000 }];
  check('pago combinado que suma exacto el total → válido', validarMediosPago(combinado, 150000).ok === true);
  check('pago combinado que NO suma el total → inválido (no se inventa el resto)', validarMediosPago(combinado, 150001).ok === false);
  check('sin medios → inválido', validarMediosPago([], 150000).ok === false);
  check('medio inválido en la lista → inválido', validarMediosPago([{ tipo: 'bitcoin', montoCentavos: 150000 }], 150000).ok === false);
  check('monto negativo en un medio → inválido', validarMediosPago([{ tipo: 'efectivo', montoCentavos: -100 }], -100).ok === false);

  check('etiqueta de un solo medio', etiquetaMediosPago(unSoloMedio) === 'Efectivo');
  check('etiqueta de pago combinado menciona ambos medios y sus montos', etiquetaMediosPago(combinado).includes('Efectivo') && etiquetaMediosPago(combinado).includes('Tarjeta'));
}

console.log('\n=== Reparto 90% doctora / 10% Mimar T: ejemplo de aceptación y redondeo ===');
{
  const r1 = calcularRepartoDoctora(10000000); // $100.000
  check('neto $100.000 → doctora $90.000', r1.parteDoctoraCentavos === 9000000);
  check('neto $100.000 → Mimar T $10.000', r1.parteMimarTCentavos === 1000000);
  check('las dos partes suman exacto el neto', r1.parteDoctoraCentavos + r1.parteMimarTCentavos === 10000000);

  // Centavos impares: la suma tiene que seguir dando exacto pase lo que
  // pase con el redondeo del 90% — la parte de Mimar T es siempre el resto.
  for (const neto of [1, 3, 7, 99, 101, 12345, 10001, 999999]) {
    const r = calcularRepartoDoctora(neto);
    check(`neto ${neto} centavos: doctora + Mimar T suman exacto el neto`, r.parteDoctoraCentavos + r.parteMimarTCentavos === neto);
    check(`neto ${neto} centavos: ninguna parte es negativa`, r.parteDoctoraCentavos >= 0 && r.parteMimarTCentavos >= 0);
  }

  const rCero = calcularRepartoDoctora(0);
  check('neto $0 → ambas partes en $0, no negativas', rCero.parteDoctoraCentavos === 0 && rCero.parteMimarTCentavos === 0);

  const rNegativo = calcularRepartoDoctora(-5000);
  check('neto negativo (no debería pasar, pero no reparte de más) → doctora $0', rNegativo.parteDoctoraCentavos === 0);
}

console.log('\n=== Resumen de dinero de un turno: precio, cobrado, devuelto, pendiente ===');
{
  const sinNada = resumenDineroTurno(null, []);
  check('sin precio cargado → precioConsultaCentavos es null (no 0)', sinNada.precioConsultaCentavos === null);
  check('sin precio cargado → saldoPendienteCentavos es null (no se puede calcular sin precio)', sinNada.saldoPendienteCentavos === null);
  check('sin movimientos → cobrado y devuelto en 0', sinNada.totalCobradoCentavos === 0 && sinNada.totalDevueltoCentavos === 0);

  const precio = pesosAcentavos('15000'); // $15.000
  const pagoParcial = resumenDineroTurno(precio, [{ tipo: 'cobro', montoCentavos: pesosAcentavos('10000') }]);
  check('precio $15.000, cobrado $10.000 → pendiente $5.000', pagoParcial.saldoPendienteCentavos === pesosAcentavos('5000'));

  const pagoCompleto = resumenDineroTurno(precio, [{ tipo: 'cobro', montoCentavos: precio }]);
  check('precio y cobrado iguales → pendiente $0', pagoCompleto.saldoPendienteCentavos === 0);

  const conDevolucion = resumenDineroTurno(precio, [
    { tipo: 'cobro', montoCentavos: precio },
    { tipo: 'devolucion', montoCentavos: pesosAcentavos('3000') },
  ]);
  check('cobro completo con devolución parcial → neto cobrado descuenta la devolución', conDevolucion.netoCobradoCentavos === pesosAcentavos('12000'));
  check('la devolución deja saldo pendiente otra vez (no queda "pagado" fantasma)', conDevolucion.saldoPendienteCentavos === pesosAcentavos('3000'));

  const sobrepago = resumenDineroTurno(precio, [{ tipo: 'cobro', montoCentavos: pesosAcentavos('20000') }]);
  check('cobrado de más → pendiente nunca da negativo', sobrepago.saldoPendienteCentavos === 0);
}

console.log('\n=== Cierre de jornada: neto, reparto y "consultas atendidas" a partir de los movimientos del día ===');
{
  const movimientosDelDia = [
    { turnoId: 'turno-a', tipo: 'cobro', montoCentavos: pesosAcentavos('30000') },
    { turnoId: 'turno-b', tipo: 'cobro', montoCentavos: pesosAcentavos('50000') },
    { turnoId: 'turno-b', tipo: 'devolucion', montoCentavos: pesosAcentavos('5000') }, // corrección el mismo día
    { turnoId: 'turno-c', tipo: 'cobro', montoCentavos: pesosAcentavos('25000') },
  ];
  const cierre = calcularCierreJornada(movimientosDelDia);
  check('3 turnos distintos con movimiento → 3 consultas atendidas', cierre.consultasAtendidas === 3);
  check('total cobrado suma los 3 cobros', cierre.totalCobradoCentavos === pesosAcentavos('105000'));
  check('total devuelto refleja la devolución', cierre.totalDevueltoCentavos === pesosAcentavos('5000'));
  check('neto descuenta la devolución', cierre.netoCentavos === pesosAcentavos('100000'));
  check('neto de $100.000 reparte $90.000 para la doctora', cierre.parteDoctoraCentavos === pesosAcentavos('90000'));
  check('neto de $100.000 reparte $10.000 para Mimar T', cierre.parteMimarTCentavos === pesosAcentavos('10000'));
  check('doctora + Mimar T suman exacto el neto', cierre.parteDoctoraCentavos + cierre.parteMimarTCentavos === cierre.netoCentavos);

  const sinMovimientos = calcularCierreJornada([]);
  check('día sin movimientos → 0 consultas atendidas, neto $0', sinMovimientos.consultasAtendidas === 0 && sinMovimientos.netoCentavos === 0);
}

console.log('\n=== Detalle del cierre: agrupa por turno, muestra el pendiente ACTUAL (no solo el del día) ===');
{
  const movimientosDelDia = [
    { turnoId: 'turno-a', tipo: 'cobro', montoCentavos: pesosAcentavos('30000'), medios: [{ tipo: 'efectivo', montoCentavos: pesosAcentavos('30000') }] },
    { turnoId: 'turno-b', tipo: 'cobro', montoCentavos: pesosAcentavos('20000'), medios: [{ tipo: 'transferencia', montoCentavos: pesosAcentavos('20000') }] },
  ];
  const turnosInfo = new Map([
    ['turno-a', { pacienteNombre: 'Zulema Prueba', fechaAtencion: '2026-09-10', precioConsultaCentavos: pesosAcentavos('30000'), saldoPendienteActualCentavos: 0 }],
    // turno-b: pago PARCIAL de una consulta anterior — el precio es mayor
    // al cobrado hoy, y todavía queda saldo pendiente a la fecha.
    ['turno-b', { pacienteNombre: 'Araceli Prueba', fechaAtencion: '2026-09-08', precioConsultaCentavos: pesosAcentavos('50000'), saldoPendienteActualCentavos: pesosAcentavos('30000') }],
  ]);
  const detalle = armarDetalleCierre(movimientosDelDia, turnosInfo);
  check('arma una fila por turno distinto', detalle.length === 2);
  check('ordena por nombre de paciente', detalle[0].pacienteNombre === 'Araceli Prueba' && detalle[1].pacienteNombre === 'Zulema Prueba');
  const filaB = detalle.find((f) => f.turnoId === 'turno-b');
  check('la fila de un pago parcial de otro día muestra la fecha de ATENCIÓN real (no la del cobro)', filaB.fechaAtencion === '2026-09-08');
  check('muestra el saldo pendiente ACTUAL de la consulta, no solo lo cobrado hoy', filaB.saldoPendienteActualCentavos === pesosAcentavos('30000'));
  check('el medio de pago usado ese día queda en la fila', filaB.medios[0].tipo === 'transferencia');

  const sinInfo = armarDetalleCierre([{ turnoId: 'turno-x', tipo: 'cobro', montoCentavos: 100 }], new Map());
  check('un turno sin info resuelta no rompe: usa "Paciente" como respaldo', sinInfo[0].pacienteNombre === 'Paciente');
  check('sin info, precio y pendiente quedan null (no se inventa un valor)', sinInfo[0].precioConsultaCentavos === null && sinInfo[0].saldoPendienteActualCentavos === null);
}

console.log('\n' + '='.repeat(60));
console.log(fails ? (fails + ' prueba(s) fallaron') : 'TODAS LAS PRUEBAS OK');
process.exit(fails ? 1 : 0);
