// Pruebas de regresión — Consulta Inicial de 30 minutos desde la grilla
// (punto 14 del pedido de Mimar-T Inteligente, 2026-09-17).
//
// Espejo de admin.html: la duración se resuelve por el TIPO estable del
// servicio (_svTipoMap, no el nombre visible) y queda fija en 30 min para
// Consulta Inicial sin importar lo que diga el catálogo de Servicios. El
// choque de horario se detecta con el mismo cálculo que usa
// confirmarRegistroManual (_cubiertoPor): una reserva nueva no puede
// empezar DENTRO del rango [inicio, inicio+duración) de otra reserva activa
// en el mismo box y fecha. Si cambia esa lógica en admin.html, reflejar acá.

let fails = 0;
function check(desc, cond) {
  console.log((cond ? '  OK  ' : '  FAIL ') + desc);
  if (!cond) fails++;
}

const SERVICIO_TIPO_CONSULTA_INICIAL = 'consulta_inicial';
const DURACION_CONSULTA_INICIAL_MIN = 30;

function resolverDuracion(servicioNombre, svTipoMap, svDurMap) {
  const esConsultaInicial = svTipoMap.get(servicioNombre) === SERVICIO_TIPO_CONSULTA_INICIAL;
  return esConsultaInicial ? DURACION_CONSULTA_INICIAL_MIN : (svDurMap.get(servicioNombre) || 30);
}

function toMin(hora) { const [hh, mm] = (hora || '00:00').split(':').map(Number); return hh * 60 + mm; }

// Mismo cálculo que _cubiertoPor en confirmarRegistroManual: ¿el nuevo
// horario cae DENTRO del rango que ya ocupa alguna reserva activa del box?
function horarioCubiertoPorOtraReserva(nuevaHora, boxId, reservasDelBox) {
  const nuevoMin = toMin(nuevaHora);
  return reservasDelBox.some((r) => {
    if (!(r.duracionMinutos > 15)) return false;
    const sm = toMin(r.hora);
    return nuevoMin > sm && nuevoMin < sm + r.duracionMinutos;
  });
}

console.log('\n=== Duración fija de Consulta Inicial (punto 14) ===');
{
  const svTipoMap = new Map([['Consulta Inicial', 'consulta_inicial']]);
  const svDurMap = new Map(); // catálogo sin duración cargada todavía
  check('sin nada configurado en el catálogo, igual da 30 (regla fija, no depende del catálogo)', resolverDuracion('Consulta Inicial', svTipoMap, svDurMap) === 30);

  const svDurMapDrift = new Map([['Consulta Inicial', 60]]); // alguien la editó mal en Servicios
  check('aunque el catálogo diga 60, la regla fija gana: sigue siendo 30', resolverDuracion('Consulta Inicial', svTipoMap, svDurMapDrift) === 30);

  const svTipoMapVacio = new Map(); // el servicio "Consulta Inicial" todavía no tiene tipo cargado (no debería pasar tras el seed, pero por las dudas)
  check('sin tipo resuelto, NO se activa la regla fija (usa el catálogo/60 min por defecto de otros servicios) — no se identifica por el nombre visible', resolverDuracion('Consulta Inicial', svTipoMapVacio, svDurMapDrift) === 60);

  check('otro servicio con 45 min en el catálogo conserva su propia duración (no se toca)', resolverDuracion('Drenapress', svTipoMap, new Map([['Drenapress', 45]])) === 45);

  // Identificación por tipo, nunca por texto/tildes/mayúsculas: dos variantes
  // de escritura del MISMO servicio (mismo id de services detrás) deben
  // resolver igual si comparten tipo — simulando que el nombre visible
  // cambió pero el tipo (campo estable) sigue siendo el mismo.
  const svTipoMapVariante = new Map([['consulta inicial', 'consulta_inicial'], ['CONSULTA INICIAL', 'consulta_inicial']]);
  check('funciona igual con variantes de mayúsculas del nombre (la clave real es el tipo, el Map ya usa el nombre EXACTO del chip elegido)', resolverDuracion('consulta inicial', svTipoMapVariante, new Map()) === 30 && resolverDuracion('CONSULTA INICIAL', svTipoMapVariante, new Map()) === 30);
}

console.log('\n=== Ejemplo exacto del pedido: 10:30 a 11:00 bloquea 10:45, permite 11:00 ===');
{
  const boxId = 'b2';
  const reservasDelBox = [
    { id: 'consulta-1', hora: '10:30', duracionMinutos: 30, box: boxId },
  ];
  check('intento a las 10:45 (dentro del rango 10:30-11:00) queda bloqueado', horarioCubiertoPorOtraReserva('10:45', boxId, reservasDelBox) === true);
  check('intento a las 11:00 (justo cuando termina) SÍ se permite', horarioCubiertoPorOtraReserva('11:00', boxId, reservasDelBox) === false);
  check('intento a las 10:15 (antes de que empiece) se permite', horarioCubiertoPorOtraReserva('10:15', boxId, reservasDelBox) === false);
  check('en OTRO box, a las 10:45 no hay choque (el filtro por box ya lo hace el llamador con reservasDelBox)', horarioCubiertoPorOtraReserva('10:45', 'b3', []) === false);
}

console.log('\n=== Ocupa dos intervalos de 15 minutos, no interfiere con servicios de 15/60 min ===');
{
  const boxId = 'b1';
  // Consulta de 30 min a las 09:00 (09:00–09:30) + un servicio de 60 min a las 09:30 en el mismo box: no deben chocar entre sí
  const reservas = [{ hora: '09:00', duracionMinutos: 30, box: boxId }];
  check('un turno de 60 min que arranca justo cuando termina la consulta (09:30) no queda bloqueado', horarioCubiertoPorOtraReserva('09:30', boxId, reservas) === false);
  const reservas2 = [{ hora: '09:00', duracionMinutos: 60, box: boxId }];
  check('una consulta de 30 min que intenta arrancar a las 09:15 (dentro de un turno de 60 min ya activo) queda bloqueada', horarioCubiertoPorOtraReserva('09:15', boxId, reservas2) === true);
}

console.log('\n' + '='.repeat(60));
if (fails) {
  console.log('RESULTADO: ' + fails + ' prueba(s) fallaron.');
  process.exit(1);
} else {
  console.log('RESULTADO: TODAS LAS PRUEBAS DE CONSULTA INICIAL DE 30 MIN OK');
}
