// node tests/turno-jornada/run-tests.js   (datos 100% sintéticos)
import { esTurnoDeJornadaValido, origenParaNuevoTurno, esConsultaInicialTurno, servicioCorrespondeAJornada, tipoJornadaNormalizado } from '../../js/turno-jornada.js';

let fails = 0;
const check = (d, c, extra) => { console.log((c ? '  OK  ' : '  FAIL ') + d); if (!c) { fails++; if (extra !== undefined) console.log('       →', JSON.stringify(extra)); } };

console.log('\n=== Bug: Tratamiento Facial en Box 3 marcado como JORNADA ===');
const facialLegacy = { servicio: 'Tratamiento Facial', box: 'b3', hora: '17:30', origen: 'jornada' };
check('facial con origen legacy "jornada" y jornada crio activa → NORMAL', esTurnoDeJornadaValido(facialLegacy, 'crio') === false);
check('facial con flag esJornada legacy → NORMAL', esTurnoDeJornadaValido({ servicio: 'Tratamiento Facial', esJornada: true }, 'crio') === false);
check('facial sin jornada activa → NORMAL', esTurnoDeJornadaValido(facialLegacy, null) === false);

console.log('\n=== Turnos de jornada reales ===');
check('servicio de la jornada pública ("Jornada de Criolipólisis") → JORNADA', esTurnoDeJornadaValido({ servicio: 'Jornada de Criolipólisis', origen: 'jornada' }, 'crio'));
check('crio marcado jornada con jornada crio activa → JORNADA', esTurnoDeJornadaValido({ servicio: 'Criolipolisis', origen: 'jornada' }, 'crio'));
check('crio viejo marcado jornada con jornada radio activa hoy → sigue JORNADA', esTurnoDeJornadaValido({ servicio: 'Criolipolisis', origen: 'jornada' }, 'radio'));
check('con jornadaTipo guardado manda ese tipo (crio guardado, servicio radio → NORMAL)', esTurnoDeJornadaValido({ servicio: 'Radiofrecuencia corporal', origen: 'jornada', jornadaTipo: 'crio' }, 'radio') === false);
check('depi/definitiva/láser', esTurnoDeJornadaValido({ servicio: 'Depilación Definitiva Láser', origen: 'jornada' }, 'definitiva') && servicioCorrespondeAJornada('Láser axilas', 'depi'));
check('detox: "Drenaje linfático" común NO es la jornada detox', !servicioCorrespondeAJornada('Drenaje linfático', 'detox') && servicioCorrespondeAJornada('Jornada Detox — Drenaje con manta térmica', 'detox'));
check('crio sin marca de jornada → NORMAL (no alcanza con coincidir el horario)', esTurnoDeJornadaValido({ servicio: 'Criolipolisis' }, 'crio') === false);

console.log('\n=== Consulta Inicial y override manual ===');
check('CI nunca es jornada (aunque tenga origen jornada)', esTurnoDeJornadaValido({ servicio: 'Consulta Inicial', origen: 'jornada' }, 'crio') === false && esTurnoDeJornadaValido({ servicio: 'CI', forzarJornadaManual: true }, 'crio') === false);
check('esConsultaInicial === true', esConsultaInicialTurno({ servicio: 'Algo', esConsultaInicial: true }));
check('override manual true → JORNADA aunque sea facial', esTurnoDeJornadaValido({ servicio: 'Tratamiento Facial', forzarJornadaManual: true }, null));
check('override manual false → NORMAL aunque sea crio de jornada', esTurnoDeJornadaValido({ servicio: 'Jornada de Criolipólisis', origen: 'jornada', forzarJornadaManual: false }, 'crio') === false);

console.log('\n=== Turnos nuevos creados desde el panel ===');
check('modo jornada crio + Tratamiento Facial → se graba "normal"', origenParaNuevoTurno({ servicio: 'Tratamiento Facial' }, true, 'crio') === 'normal');
check('modo jornada crio + Criolipolisis → "jornada"', origenParaNuevoTurno({ servicio: 'Criolipolisis' }, true, 'crio') === 'jornada');
check('modo jornada + CI → "normal"', origenParaNuevoTurno({ servicio: 'Consulta Inicial' }, true, 'crio') === 'normal');
check('modo normal → "normal"', origenParaNuevoTurno({ servicio: 'Criolipolisis' }, false, 'crio') === 'normal');
check('tipos normalizados', tipoJornadaNormalizado('normal') === '' && tipoJornadaNormalizado('definitiva') === 'depi' && tipoJornadaNormalizado('crio') === 'crio');

console.log('\n' + '='.repeat(60));
console.log(fails ? fails + ' prueba(s) fallaron' : 'TODAS LAS PRUEBAS DE TURNO JORNADA OK');
process.exit(fails ? 1 : 0);
