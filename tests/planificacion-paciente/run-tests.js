// node tests/planificacion-paciente/run-tests.js
import {
  DIAS, planVacia, normalizarPlanificacion, esPlanificacionVacia, validarPlanificacion,
  estadoPlanificacion, resumenPlanificacion, serializarPlanificacion, horaAMin, minAHora, TRATAMIENTOS, FACIAL_INTERVALO_MIN_DIAS,
} from '../../js/planificacion-paciente.js';

let fails = 0;
const check = (desc, cond) => { console.log((cond ? '  OK  ' : '  FAIL ') + desc); if (!cond) fails++; };
const clon = (o) => JSON.parse(JSON.stringify(o));

// Plan completo y coherente (datos sintéticos, ningún paciente real).
const base = () => normalizarPlanificacion({
  disponibilidad: { modo: 'estricta', dias: { lunes: [{ desde: '09:00', hasta: '11:00' }], jueves: [{ desde: '09:00', hasta: '11:00' }, { desde: '16:00', hasta: '18:00' }] } },
  turnosHabituales: [{ id: 'a', dia: 'lunes', horaInicio: '09:00', servicio: 'Facial', duracionMin: 60, box: 'b1' }],
  frecuencia: { habitualSemana: 1, maximoSemana: 2, totalPrevisto: 9, alcance: 'mes' },
  vigencia: { desde: '2026-10-01', hasta: null },
  observaciones: 'Prueba',
});

console.log('\n=== Ficha sin datos (paciente antiguo) ===');
{
  check('undefined/null se tratan como sin configurar, sin romper', estadoPlanificacion(undefined) === 'sin_configurar' && estadoPlanificacion(null) === 'sin_configurar');
  check('no se asume disponibilidad total: la ficha vacía no trae días', Object.keys(normalizarPlanificacion(undefined).disponibilidad.dias).length === 0);
  check('resumen vacío para ficha sin datos (la UI muestra "Disponibilidad sin configurar")', resumenPlanificacion(undefined) === '');
  check('basura en el campo no rompe', estadoPlanificacion('texto') === 'sin_configurar' && estadoPlanificacion(42) === 'sin_configurar');
}

console.log('\n=== Estados ===');
{
  check('plan completo → configurada', estadoPlanificacion(base()) === 'configurada');
  const parcial = normalizarPlanificacion({ disponibilidad: { modo: 'preferida', dias: { lunes: [] } } });
  check('plan parcial → incompleta', estadoPlanificacion(parcial) === 'incompleta');
  const soloObs = planVacia(); soloObs.observaciones = 'algo';
  check('solo observaciones → incompleta (hay datos pero falta lo demás)', estadoPlanificacion(soloObs) === 'incompleta');
  const sinTurnos = base(); sinTurnos.turnosHabituales = [];
  check('sin turnos habituales → incompleta', estadoPlanificacion(sinTurnos) === 'incompleta');
  const sinModo = base(); sinModo.disponibilidad.modo = null;
  check('sin modo (estricta/preferida) → incompleta', estadoPlanificacion(sinModo) === 'incompleta');
}

console.log('\n=== Resumen ===');
{
  const p = normalizarPlanificacion({
    disponibilidad: { modo: 'estricta', dias: { lunes: [{ desde: '09:00', hasta: '11:00' }], jueves: [{ desde: '09:00', hasta: '11:00' }] } },
    frecuencia: { maximoSemana: 2, totalPrevisto: 9, alcance: 'mes' },
  });
  const r = resumenPlanificacion(p);
  check('días iguales se agrupan: "Lunes y jueves · 09:00 a 11:00"', r.startsWith('Lunes y jueves · 09:00 a 11:00'));
  check('incluye "Hasta 2 turnos por semana"', r.includes('Hasta 2 turnos por semana'));
  check('incluye "Objetivo: 9 turnos por mes"', r.includes('Objetivo: 9 turnos por mes'));
  const distinto = resumenPlanificacion(base());
  check('días con distintos horarios se detallan por día', distinto.startsWith('Lunes 09:00 a 11:00; jueves 09:00 a 11:00 y 16:00 a 18:00'));
  const plan = normalizarPlanificacion({ frecuencia: { totalPrevisto: 9, alcance: 'plan' } });
  check('"9 no siempre es mensual": alcance total del plan se muestra distinto', resumenPlanificacion(plan).includes('Objetivo: 9 turnos en total del plan'));
  const sinAlc = normalizarPlanificacion({ frecuencia: { totalPrevisto: 9 } });
  check('cantidad sin alcance no se presenta como mensual', !resumenPlanificacion(sinAlc).includes('por mes') && resumenPlanificacion(sinAlc).includes('alcance sin indicar'));
  check('solo muestra lo cargado (no inventa horas ni frecuencias)', !/semana|Objetivo|turnos habituales/.test(resumenPlanificacion(normalizarPlanificacion({ disponibilidad: { dias: { martes: [{ desde: '10:00', hasta: '12:00' }] } } }))));
}

console.log('\n=== Validaciones de disponibilidad ===');
{
  const p = base(); p.disponibilidad.dias.lunes = [{ desde: '11:00', hasta: '09:00' }];
  check('hora final anterior a la inicial → error', validarPlanificacion(p).errores.some((e) => e.campo.startsWith('int:lunes')));
  const p2 = base(); p2.disponibilidad.dias.lunes = [{ desde: '09:00', hasta: '09:00' }];
  check('hora final igual a la inicial → error', validarPlanificacion(p2).errores.length > 0);
  const p3 = base(); p3.disponibilidad.dias.lunes = [{ desde: '09:00', hasta: '11:00' }, { desde: '10:30', hasta: '12:00' }];
  check('intervalos superpuestos el mismo día → error', validarPlanificacion(p3).errores.some((e) => e.campo === 'solap:lunes'));
  const p4 = base(); p4.disponibilidad.dias.lunes = [{ desde: '09:00', hasta: '11:00' }, { desde: '11:00', hasta: '12:00' }];
  check('intervalos contiguos (11:00 termina, 11:00 empieza) no se superponen', !validarPlanificacion(p4).errores.some((e) => e.campo === 'solap:lunes'));
  const p5 = base(); p5.disponibilidad.dias.lunes = [{ desde: '09:00', hasta: '' }];
  const v5 = validarPlanificacion(p5);
  check('intervalo a medio completar es PENDIENTE, no inválido', v5.pendientes.some((x) => x.campo.startsWith('int:lunes')) && !v5.errores.some((x) => x.campo.startsWith('int:lunes')));
  const p6 = base(); p6.disponibilidad.dias.lunes = [{ desde: '25:00', hasta: '26:00' }];
  check('hora inexistente → error', validarPlanificacion(p6).errores.length > 0);
  const p7 = base(); p7.disponibilidad.dias.lunes = [];
  check('día marcado sin intervalos → pendiente', validarPlanificacion(p7).pendientes.some((x) => x.campo === 'dia:lunes'));
}

console.log('\n=== Validaciones de cantidades y fechas ===');
{
  for (const malo of ['0', '-3', '2.5', 'abc', '1e2']) {
    const p = base(); p.frecuencia.totalPrevisto = malo;
    check(`total "${malo}" → error (no es entero positivo)`, validarPlanificacion(p).errores.some((e) => e.campo === 'totalPrevisto'));
  }
  const vacio = base(); vacio.frecuencia.totalPrevisto = ''; vacio.frecuencia.alcance = null;
  const vv = validarPlanificacion(vacio);
  check('cantidad vacía no es error (es opcional)', !vv.errores.some((e) => e.campo === 'totalPrevisto'));
  const hab = base(); hab.frecuencia.habitualSemana = '3'; hab.frecuencia.maximoSemana = '2';
  check('frecuencia habitual mayor al máximo → error', validarPlanificacion(hab).errores.some((e) => e.campo === 'habitualSemana'));
  const habOk = base(); habOk.frecuencia.habitualSemana = '2'; habOk.frecuencia.maximoSemana = '2';
  check('habitual igual al máximo es válido', !validarPlanificacion(habOk).errores.some((e) => e.campo === 'habitualSemana'));
  const fechas = base(); fechas.vigencia = { desde: '2026-10-10', hasta: '2026-10-01' };
  check('fecha final anterior a la inicial → error', validarPlanificacion(fechas).errores.some((e) => e.campo === 'vigenciaHasta'));
  const fInv = base(); fInv.vigencia = { desde: '2026-02-30', hasta: '' };
  check('fecha inexistente (30/02) → error', validarPlanificacion(fInv).errores.some((e) => e.campo === 'vigenciaDesde'));
  const sinAlcance = base(); sinAlcance.frecuencia.totalPrevisto = '9'; sinAlcance.frecuencia.alcance = null;
  check('cantidad total sin alcance → pendiente (no se asume "por mes")', validarPlanificacion(sinAlcance).pendientes.some((x) => x.campo === 'alcance'));
  check('no hay ningún mes/año fijo en el resultado de validar', !JSON.stringify(validarPlanificacion(base())).match(/2026|2025|2027/));
}

console.log('\n=== Turnos habituales ===');
{
  const p = base(); p.turnosHabituales.push({ id: 'b', dia: 'lunes', horaInicio: '09:00', servicio: 'Facial', duracionMin: '60', box: 'b1' });
  check('fila idéntica repetida → error', validarPlanificacion(p).errores.some((e) => e.campo === 't:b:dup'));
  const p2 = base(); p2.turnosHabituales.push({ id: 'c', dia: 'lunes', horaInicio: '10:00', servicio: 'Facial', duracionMin: '60', box: 'b1' });
  check('varios turnos el mismo día con distinta hora son válidos', !validarPlanificacion(p2).errores.length);
  const p3 = base(); p3.turnosHabituales.push({ id: 'd', dia: 'lunes', horaInicio: '09:00', servicio: 'Masaje', duracionMin: '60', box: 'b4' });
  check('dos tratamientos a la misma hora (otro servicio) no son duplicado', !validarPlanificacion(p3).errores.length);
  const p4 = base(); p4.turnosHabituales.push({ id: 'e', dia: 'martes', horaInicio: '', servicio: '', duracionMin: '', box: '' });
  const v4 = validarPlanificacion(p4);
  check('fila a medio completar → pendientes por campo, no errores', v4.pendientes.some((x) => x.campo === 't:e:hora') && v4.pendientes.some((x) => x.campo === 't:e:servicio') && v4.pendientes.some((x) => x.campo === 't:e:duracion') && !v4.errores.length);
  const p5 = base(); p5.turnosHabituales[0].duracionMin = '0';
  check('duración 0 → error', validarPlanificacion(p5).errores.some((e) => e.campo === 't:a:duracion'));
  const p6 = base(); p6.turnosHabituales.push({ id: 'f', dia: '', horaInicio: '', servicio: '', duracionMin: '', box: '' });
  check('fila totalmente vacía se ignora (no genera pendientes ni se guarda)', !validarPlanificacion(p6).pendientes.some((x) => x.campo.startsWith('t:f')) && serializarPlanificacion(p6).turnosHabituales.length === 1);
}

console.log('\n=== Advertencias: turno habitual vs. disponibilidad (sin corregir nada) ===');
{
  const p = base(); p.turnosHabituales = [{ id: 'a', dia: 'lunes', horaInicio: '10:30', servicio: 'Facial', duracionMin: '60', box: '' }];
  const v = validarPlanificacion(p);
  check('turno que termina después del fin de la disponibilidad → advertencia concreta', v.advertencias.some((a) => a.mensaje.includes('termina a las 11:30') && a.mensaje.includes('como máximo a las 10:00')));
  check('la advertencia no bloquea (no es error)', v.errores.length === 0);
  const antes = JSON.stringify(p.disponibilidad);
  validarPlanificacion(p);
  check('validar NO modifica la disponibilidad para hacerla encajar', JSON.stringify(p.disponibilidad) === antes);
  const ok = base(); ok.turnosHabituales[0].horaInicio = '10:00';
  check('el ejemplo del pedido: 1 h dentro de 09-11 empieza a las 10:00 como máximo → sin advertencia', validarPlanificacion(ok).advertencias.length === 0);
  const dia = base(); dia.turnosHabituales[0].dia = 'martes';
  check('turno en un día sin disponibilidad → advertencia', validarPlanificacion(dia).advertencias.some((a) => a.mensaje.includes('Martes no tiene disponibilidad')));
  const fuera = base(); fuera.turnosHabituales[0].horaInicio = '13:00';
  check('turno que empieza fuera de los intervalos → advertencia', validarPlanificacion(fuera).advertencias.some((a) => a.mensaje.includes('empieza fuera')));
  const sinDisp = planVacia(); sinDisp.turnosHabituales = [{ id: 'z', dia: 'lunes', horaInicio: '09:00', servicio: 'Facial', duracionMin: '60', box: '' }];
  check('sin disponibilidad cargada no se inventan advertencias de encaje', validarPlanificacion(sinDisp).advertencias.length === 0);
  const muchos = base(); muchos.frecuencia.maximoSemana = '1';
  muchos.turnosHabituales.push({ id: 'q', dia: 'jueves', horaInicio: '09:00', servicio: 'Facial', duracionMin: '60', box: '' });
  check('más turnos habituales por semana que el máximo → advertencia', validarPlanificacion(muchos).advertencias.some((a) => a.campo === 'maximoSemana'));
}

console.log('\n=== Guardado / recarga (ida y vuelta) ===');
{
  const p = base();
  const guardado = serializarPlanificacion(p);
  const enFirestore = clon(guardado); // simula ida y vuelta por JSON como en la base
  const recargado = normalizarPlanificacion(enFirestore);
  check('ida y vuelta conserva días e intervalos', JSON.stringify(serializarPlanificacion(recargado).disponibilidad) === JSON.stringify(guardado.disponibilidad));
  check('ida y vuelta conserva turnos habituales y su id', recargado.turnosHabituales[0].id === 'a' && recargado.turnosHabituales[0].duracionMin === '60');
  check('los números se guardan como números', typeof guardado.frecuencia.totalPrevisto === 'number' && guardado.frecuencia.totalPrevisto === 9);
  check('los vacíos se guardan como null (nunca undefined: Firestore lo rechaza)', !JSON.stringify(guardado, (k, v) => (v === undefined ? '__undef__' : v)).includes('__undef__') && guardado.vigencia.hasta === null);
  check('estado y resumen idénticos antes y después de recargar', estadoPlanificacion(recargado) === estadoPlanificacion(p) && resumenPlanificacion(recargado) === resumenPlanificacion(p));
  const inc = base(); inc.disponibilidad.dias.lunes = [{ desde: '09:00', hasta: '' }, { desde: '09:00', hasta: '11:00' }];
  check('un intervalo incompleto no se guarda, el día sigue seleccionado', serializarPlanificacion(inc).disponibilidad.dias.lunes.length === 1);
  const dosPacientes = [base(), (() => { const o = base(); o.disponibilidad.dias = { viernes: [{ desde: '14:00', hasta: '16:00' }] }; return o; })()];
  check('dos pacientes no comparten estado (cada plan es un objeto independiente)', resumenPlanificacion(dosPacientes[0]) !== resumenPlanificacion(dosPacientes[1]));
  check('normalizar no comparte referencias con lo recibido', (() => { const raw = clon(guardado); const n = normalizarPlanificacion(raw); n.disponibilidad.dias.lunes.push({ desde: '1', hasta: '2' }); return raw.disponibilidad.dias.lunes.length === 1; })());
}

console.log('\n=== Tratamiento (Facial / Corporal / Facial y corporal) y regla de 15 días ===');
{
  const con = (t, frecuencia) => { const p = base(); p.tratamiento = t; if (frecuencia) Object.assign(p.frecuencia, frecuencia); return p; };
  const tieneFacial15 = (p) => validarPlanificacion(p).advertencias.some((a) => a.campo === 'facial15');
  check('las 3 opciones existen', Object.keys(TRATAMIENTOS).join() === 'facial,corporal,ambos' && TRATAMIENTOS.ambos === 'Facial y corporal');
  check('la regla guardada es 15 días', FACIAL_INTERVALO_MIN_DIAS === 15);
  check('un plan viejo sin tratamiento sigue configurado (no se degrada)', estadoPlanificacion(base()) === 'configurada' && normalizarPlanificacion(base()).tratamiento === null);
  check('valor inválido se descarta', normalizarPlanificacion({ tratamiento: 'otro' }).tratamiento === null);
  check('elegir solo el tratamiento ya no es plan vacío', esPlanificacionVacia({ tratamiento: 'facial' }) === false);
  check('se guarda y se lee igual', serializarPlanificacion(con('ambos')).tratamiento === 'ambos' && serializarPlanificacion(base()).tratamiento === null);
  check('el resumen lo muestra', resumenPlanificacion(con('corporal')).startsWith('Corporal') && resumenPlanificacion(con('ambos')).startsWith('Facial y corporal'));
  check('facial con 1 turno habitual por semana → cartel de 15 días', tieneFacial15(con('facial')));
  check('el cartel no impide guardar (advertencia, no error)', validarPlanificacion(con('facial')).errores.length === 0);
  check('corporal con 1 por semana → sin cartel', !tieneFacial15(con('corporal')));
  check('sin tratamiento → sin cartel', !tieneFacial15(base()));
  const quincenal = con('facial', { habitualSemana: '', maximoSemana: '', totalPrevisto: 2, alcance: 'mes' });
  quincenal.turnosHabituales = [];
  check('facial 2 por mes (cada 15 días) → sin cartel', !tieneFacial15(quincenal));
  const tres = clon(quincenal); tres.frecuencia.totalPrevisto = 3;
  check('facial 3 por mes → cartel', tieneFacial15(tres));
  const mixto = con('ambos', { habitualSemana: 2, maximoSemana: 2 });
  mixto.turnosHabituales = [
    { id: 'x', dia: 'lunes', horaInicio: '09:00', servicio: 'Facial Hidratante', duracionMin: 60, box: '' },
    { id: 'y', dia: 'jueves', horaInicio: '09:00', servicio: 'Masaje', duracionMin: 45, box: '' },
  ];
  check('facial y corporal con 1 facial + 1 masaje por semana → sin cartel', !tieneFacial15(mixto));
  mixto.turnosHabituales[1].servicio = 'Facial Profundo';
  check('facial y corporal con 2 faciales por semana → cartel', tieneFacial15(mixto));
}

console.log('\n=== Utilidades ===');
{
  check('horaAMin/minAHora', horaAMin('09:30') === 570 && minAHora(570) === '09:30' && horaAMin('9:30') === null && horaAMin('24:00') === null);
  check('DIAS tiene los 7 días', DIAS.length === 7);
  check('esPlanificacionVacia detecta un plan real como no vacío', esPlanificacionVacia(base()) === false && esPlanificacionVacia(planVacia()) === true);
}

console.log('\n' + '='.repeat(60));
console.log(fails ? fails + ' prueba(s) fallaron' : 'TODAS LAS PRUEBAS DE PLANIFICACIÓN OK');
process.exit(fails ? 1 : 0);
