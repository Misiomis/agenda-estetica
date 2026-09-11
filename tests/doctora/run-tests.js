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

  const recordatorio = construirTextoRecordatorioDoctora(turno, 'Consultorio 3');
  check('recordatorio también usa datos reales', recordatorio.includes(HOY) && recordatorio.includes('15:30'));

  const recomendacionesVacias = construirTextoRecomendacionesDoctora(turno, '');
  check('sin contenido escrito por la doctora, se deja un placeholder explícito (no se inventa contenido clínico)',
    recomendacionesVacias.includes('[Escribí acá las recomendaciones'));
  const recomendacionesConTexto = construirTextoRecomendacionesDoctora(turno, 'Tomar la medicación indicada cada 8 horas.');
  check('con contenido de la doctora, se usa tal cual', recomendacionesConTexto.includes('Tomar la medicación indicada cada 8 horas.'));
  check('el contenido de la doctora no se reemplaza por el placeholder', !recomendacionesConTexto.includes('[Escribí acá'));
}

console.log('\n' + '='.repeat(60));
console.log(fails ? (fails + ' prueba(s) fallaron') : 'TODAS LAS PRUEBAS OK');
process.exit(fails ? 1 : 0);
