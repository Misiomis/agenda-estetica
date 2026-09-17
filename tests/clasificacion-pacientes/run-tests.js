// Pruebas de regresión — clasificación de pacientes activos/inactivos/de
// cursos (punto 15 del pedido de Mimar-T Inteligente, 2026-09-17).
//
// Espejo de admin.html (mismo criterio que tests/identidad-paciente): estas
// funciones son pura lógica sobre datos ya cargados, sin Firestore. Si la
// lógica real cambia en admin.html, reflejar el cambio acá.

let fails = 0;
function check(desc, cond) {
  console.log((cond ? '  OK  ' : '  FAIL ') + desc);
  if (!cond) fails++;
}

const MESES_ACTIVIDAD_PACIENTE = 2;

// esReservaActiva/esEstadoCancelado (ya cubiertas en tests/identidad-paciente) — mini-mirror acá
const ESTADOS_CANCELADO_VARIANTES = ['cancelado', 'cancelada'];
const esEstadoCancelado = (v) => ESTADOS_CANCELADO_VARIANTES.includes((v || '').toString().trim().toLowerCase());
const esReservaActiva = (r) => {
  const estados = [r.estado, r.status].map(v => (v || '').toString().trim().toLowerCase()).filter(Boolean);
  return !estados.some(e => ESTADOS_CANCELADO_VARIANTES.includes(e));
};
const normalizarDNI = (v) => (v || '').toString().replace(/\D/g, '');

function restarMesesCalendarioISO(hoyISO, meses) {
  const [y, m, d] = hoyISO.split('-').map(Number);
  let mDestino = m - meses, yDestino = y;
  while (mDestino <= 0) { mDestino += 12; yDestino -= 1; }
  const ultimoDiaDestino = new Date(yDestino, mDestino, 0).getDate();
  const diaAjustado = Math.min(d, ultimoDiaDestino);
  return `${yDestino}-${String(mDestino).padStart(2, '0')}-${String(diaAjustado).padStart(2, '0')}`;
}

function construirIndices(reservas, consultas, cursos) {
  const porDni = new Map();
  const agregar = (dni, fecha) => { if (!dni || !fecha) return; if (!porDni.has(dni)) porDni.set(dni, []); porDni.get(dni).push(fecha); };
  (reservas || []).forEach(r => {
    const dni = normalizarDNI(r.dni || r.clienteDni || r.documento || '');
    if (dni && esReservaActiva(r)) agregar(dni, r.fecha);
  });
  (consultas || []).forEach(c => {
    const dni = normalizarDNI(c.dni || c.clienteDni || c.documento || '');
    if (dni && !esEstadoCancelado(c.estado || c.status)) agregar(dni, c.fecha);
  });
  const cursosPorDni = new Map();
  (cursos || []).forEach(k => {
    const dni = normalizarDNI(k.dni || '');
    if (!dni) return;
    if (!cursosPorDni.has(dni)) cursosPorDni.set(dni, []);
    cursosPorDni.get(dni).push(k);
  });
  return { atencionesPorDni: porDni, cursosPorDni };
}

function clasificarPaciente(dni, indices, hoyISO) {
  const fechaLimite = restarMesesCalendarioISO(hoyISO, MESES_ACTIVIDAD_PACIENTE);
  const atenciones = indices.atencionesPorDni.get(dni) || [];
  const tieneAtencionReciente = atenciones.some(f => f >= fechaLimite && f <= hoyISO);
  const tieneProximoTurno = atenciones.some(f => f > hoyISO);
  const tieneCurso = (indices.cursosPorDni.get(dni) || []).length > 0;

  if (tieneAtencionReciente || tieneProximoTurno) {
    return { estado: 'activo', motivo: tieneAtencionReciente ? 'atencion_reciente' : 'proximo_turno', tambienCursos: tieneCurso };
  }
  const tuvoAlgunaAtencionAlgunaVez = atenciones.length > 0;
  if (tieneCurso && !tuvoAlgunaAtencionAlgunaVez) return { estado: 'cursos', motivo: 'solo_cursos', tambienCursos: true };
  if (!tuvoAlgunaAtencionAlgunaVez) return { estado: 'inactivo', motivo: 'sin_turnos_registrados', tambienCursos: tieneCurso };
  return { estado: 'inactivo', motivo: 'sin_actividad_reciente', tambienCursos: tieneCurso };
}

console.log('\n=== Resta de meses calendario (nunca 60 días fijos) ===');
{
  check('30/03/2026 menos 2 meses = 30/01/2026', restarMesesCalendarioISO('2026-03-30', 2) === '2026-01-30');
  // 31/03 no existe en enero con 31... enero SÍ tiene 31, probemos un caso real de ajuste: 31 de marzo -> 31 de enero (ok, existe)
  // Caso de ajuste real: 31/05 menos 2 meses = 31/03 (existe). Probamos 30/04 menos 2 = 28/02 en año no bisiesto.
  check('30/04/2026 menos 2 meses = 28/02/2026 (2026 no es bisiesto, se ajusta el 30 inexistente)', restarMesesCalendarioISO('2026-04-30', 2) === '2026-02-28');
  check('31/01/2026 menos 2 meses cruza a diciembre del año anterior: 30/11/2025 (nov tiene 30 días)', restarMesesCalendarioISO('2026-01-31', 2) === '2025-11-30');
  check('15/09/2026 menos 2 meses = 15/07/2026 (caso sin ajuste)', restarMesesCalendarioISO('2026-09-15', 2) === '2026-07-15');
}

console.log('\n=== Activo por atención reciente vs. por próximo turno ===');
{
  const hoyISO = '2026-09-17';
  const reservas = [
    { dni: '11111111', fecha: '2026-08-20', estado: 'confirmado' }, // dentro de los últimos 2 meses
    { dni: '22222222', fecha: '2026-10-01', estado: 'confirmado' }, // futuro
    { dni: '33333333', fecha: '2026-05-01', estado: 'confirmado' }, // hace más de 2 meses, sin próximo turno
  ];
  const indices = construirIndices(reservas, [], []);
  check('paciente con turno hace 28 días → activo por atención reciente', clasificarPaciente('11111111', indices, hoyISO).estado === 'activo');
  check('el motivo es "atencion_reciente", no "proximo_turno"', clasificarPaciente('11111111', indices, hoyISO).motivo === 'atencion_reciente');
  check('paciente con turno reservado a futuro (aunque la última atención sea vieja o no exista) → activo', clasificarPaciente('22222222', indices, hoyISO).estado === 'activo');
  check('el motivo es "proximo_turno"', clasificarPaciente('22222222', indices, hoyISO).motivo === 'proximo_turno');
  check('paciente con última atención de hace más de 2 meses y sin próximo turno → inactivo', clasificarPaciente('33333333', indices, hoyISO).estado === 'inactivo');
}

console.log('\n=== Excluye cancelados y "hoy" cuenta como dentro del rango ===');
{
  const hoyISO = '2026-09-17';
  const reservas = [
    { dni: '44444444', fecha: '2026-09-17', estado: 'confirmado' }, // exactamente hoy
    { dni: '55555555', fecha: '2026-08-25', estado: 'cancelado' },  // cancelada: no debe contar como atención real
  ];
  const indices = construirIndices(reservas, [], []);
  check('turno de HOY cuenta como atención reciente (el rango es inclusive)', clasificarPaciente('44444444', indices, hoyISO).estado === 'activo');
  check('una reserva cancelada NO cuenta como atención — paciente sin otra actividad queda inactivo/sin registro', clasificarPaciente('55555555', indices, hoyISO).motivo === 'sin_turnos_registrados');
}

console.log('\n=== Consulta inicial cuenta como turno de atención ===');
{
  const hoyISO = '2026-09-17';
  const consultas = [{ dni: '66666666', fecha: '2026-09-05', estado: 'pendiente' }];
  const indices = construirIndices([], consultas, []);
  check('una consulta inicial activa (no cancelada) dentro de los 2 meses vuelve activo al paciente', clasificarPaciente('66666666', indices, hoyISO).estado === 'activo');
}

console.log('\n=== "De cursos" exige que NUNCA haya tenido una atención estética ===');
{
  const hoyISO = '2026-09-17';
  const cursos = [{ dni: '77777777', nombre: 'Solo Curso' }, { dni: '88888888', nombre: 'Con Historial Viejo' }];
  const reservasViejas = [{ dni: '88888888', fecha: '2025-01-10', estado: 'confirmado' }]; // atención vieja, fuera de los 2 meses
  const indices = construirIndices(reservasViejas, [], cursos);
  check('paciente que SOLO se inscribió a un curso (nunca tuvo reserva/consulta) → "cursos"', clasificarPaciente('77777777', indices, hoyISO).estado === 'cursos');
  check('paciente con un curso reciente PERO con historial de atenciones viejo → inactivo, NO "cursos" (no es automáticamente "solo de cursos")', clasificarPaciente('88888888', indices, hoyISO).estado === 'inactivo');
  check('a ese paciente inactivo con historial + curso se le marca tambienCursos=true para la etiqueta secundaria', clasificarPaciente('88888888', indices, hoyISO).tambienCursos === true);
}

console.log('\n=== Sin ningún dato (nunca reservó) → "Sin turnos registrados", sin inventar fecha ===');
{
  const hoyISO = '2026-09-17';
  const indices = construirIndices([], [], []);
  const c = clasificarPaciente('99999999', indices, hoyISO);
  check('paciente sin ninguna reserva/consulta/curso → inactivo', c.estado === 'inactivo');
  check('motivo específico "sin_turnos_registrados" (no un genérico "sin actividad reciente")', c.motivo === 'sin_turnos_registrados');
}

console.log('\n=== No duplica personas al contar categorías (una clasificación por dni) ===');
{
  const hoyISO = '2026-09-17';
  const reservas = [
    { dni: '10101010', fecha: '2026-09-01', estado: 'confirmado' },
    { dni: '10101010', fecha: '2026-09-10', estado: 'confirmado' }, // misma persona, dos turnos
  ];
  const indices = construirIndices(reservas, [], []);
  const dnis = [...indices.atencionesPorDni.keys()];
  check('un paciente con varios turnos aparece UNA sola vez en el índice (una clasificación, no una por turno)', dnis.length === 1 && dnis[0] === '10101010');
}

console.log('\n' + '='.repeat(60));
if (fails) {
  console.log('RESULTADO: ' + fails + ' prueba(s) fallaron.');
  process.exit(1);
} else {
  console.log('RESULTADO: TODAS LAS PRUEBAS DE CLASIFICACIÓN DE PACIENTES OK');
}
