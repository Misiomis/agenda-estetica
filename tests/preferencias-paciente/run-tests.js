// node tests/preferencias-paciente/run-tests.js   (datos 100% sintéticos)
import {
  normalizarPreferencias, serializarPreferencias, validarPreferencias, lineasPreferencias, textoFrecuencia,
  esPreferenciasVacia, fusionarImportacion, resolverPaciente, PREF_DIAS,
} from '../../js/preferencias-paciente.js';
import { normalizarPlanificacion, serializarPlanificacion, estadoPlanificacion, esPlanificacionVacia, validarPlanificacion } from '../../js/planificacion-paciente.js';

let fails = 0;
const check = (desc, cond) => { console.log((cond ? '  OK  ' : '  FAIL ') + desc); if (!cond) fails++; };
const clon = (o) => JSON.parse(JSON.stringify(o));
const LOTE = { loteId: 'L1', ref: 'S01', ahora: '2026-09-26T10:00:00Z' };

// Ficha sintética: facial cada 15 días (jueves 08:15), corporal sin frecuencia, frecuencia total aparte.
const ficha = () => ({
  tratamientos: [
    { tratamiento: 'facial', franjas: [{ dias: ['jueves'], horaPreferida: '08:15', franja: 'manana' }], frecuencia: { cadaDias: 15, texto: 'cada 15 días' } },
    { tratamiento: 'corporal', franjas: [{ dias: ['jueves'], horaPreferida: '11:15' }] },
  ],
  frecuenciaTotal: { cantidad: 2, periodo: 'semana', texto: '' },
  diasNoDisponibles: ['miercoles'],
  mesesContinuidad: [{ mes: '2026-09', anioInferido: true }],
  ausencias: [{ desde: '2026-09-11', hasta: '2026-09-23', nota: 'viaje', anioInferido: true }],
  observaciones: 'Prefiere temprano',
  pendientes: [{ campo: 'apellido', detalle: 'confirmar grafía' }],
});

console.log('\n=== Modelo ===');
{
  const n = normalizarPreferencias(undefined);
  check('sin datos → vacío, sin inventar', esPreferenciasVacia(n) && n.tratamientos.length === 0 && n.frecuenciaTotal === null);
  check('basura no rompe', esPreferenciasVacia('x') && esPreferenciasVacia(42) && esPreferenciasVacia({ tratamientos: 'no' }));
  const s = serializarPreferencias(ficha());
  check('desconocido queda null, nunca 0', s.tratamientos[1].frecuencia.cantidad === null && s.tratamientos[1].frecuencia.cadaDias === null && s.tratamientos[0].franjas[0].desde === null && s.tratamientos[0].franjas[0].minutosConsecutivos === null);
  check('una hora preferida NO es un rango (desde/hasta quedan vacíos)', s.tratamientos[0].franjas[0].horaPreferida === '08:15' && s.tratamientos[0].franjas[0].desde === null && s.tratamientos[0].franjas[0].hasta === null);
  check('cada 15 días se conserva como tal (no como 2 por mes)', s.tratamientos[0].frecuencia.cadaDias === 15 && s.tratamientos[0].frecuencia.cantidad === null && s.tratamientos[0].frecuencia.periodo === null);
  check('frecuencia total separada de la de cada tratamiento', s.frecuenciaTotal.cantidad === 2 && s.tratamientos.every((t) => t.frecuencia.cantidad === null));
  check('ida y vuelta estable', JSON.stringify(serializarPreferencias(normalizarPreferencias(s))) === JSON.stringify(s));
  check('días como conjunto: "miércoles NO" es indisponibilidad, no una franja', s.diasNoDisponibles[0] === 'miercoles' && s.tratamientos.every((t) => t.franjas.every((f) => !f.dias.includes('miercoles'))));
  const alt = serializarPreferencias({ tratamientos: [{ tratamiento: 'corporal', franjas: [{ dias: ['martes'], opcionesHora: ['17:00', '19:00'] }] }] });
  check('"17 o 19" son dos opciones, no un rango', alt.tratamientos[0].franjas[0].opcionesHora.join() === '17:00,19:00' && alt.tratamientos[0].franjas[0].desde === null);
  const dos = serializarPreferencias({ tratamientos: [{ tratamiento: 'corporal', franjas: [{ dias: ['sabado'], desde: '10:00', hasta: '12:00', minutosConsecutivos: 120 }] }] });
  check('dos horas seguidas se conservan (120) y el rango es disponibilidad', dos.tratamientos[0].franjas[0].minutosConsecutivos === 120 && dos.tratamientos[0].franjas[0].desde === '10:00');
  check('filas vacías no se guardan', serializarPreferencias({ tratamientos: [{ tratamiento: 'facial', franjas: [{}] }] }).tratamientos[0].franjas.length === 0);
  check('días fuera de la semana se descartan', normalizarPreferencias({ franjasGenerales: [{ dias: ['lunes', 'funes'] }] }).franjasGenerales[0].dias.join() === 'lunes');
  check('PREF_DIAS tiene 7', PREF_DIAS.length === 7);
}

console.log('\n=== Validación ===');
{
  const v = (p) => validarPreferencias(p).errores;
  check('una ficha válida no tiene errores', v(ficha()).length === 0);
  check('hora inválida', v({ tratamientos: [{ tratamiento: 'facial', franjas: [{ horaPreferida: '25:00' }] }] }).length === 1);
  check('hasta antes de desde', v({ franjasGenerales: [{ desde: '12:00', hasta: '10:00' }] }).length === 1);
  check('cantidad inválida', v({ tratamientos: [{ tratamiento: 'facial', frecuencia: { cantidad: 'dos', periodo: 'mes' } }] }).length === 1);
  check('cantidad sin período', v({ frecuenciaTotal: { cantidad: 2 } }).length === 1);
  check('mes inválido', v({ mesesContinuidad: [{ mes: '2026-13' }] }).length === 1);
  check('ausencia con fin anterior al inicio', v({ ausencias: [{ desde: '2026-09-23', hasta: '2026-09-11' }] }).length === 1);
  check('tratamiento repetido', v({ tratamientos: [{ tratamiento: 'facial' }, { tratamiento: 'facial' }] }).length === 1);
  check('texto de frecuencia libre es válido', v({ tratamientos: [{ tratamiento: 'facial', frecuencia: { texto: 'semanas alternas' } }] }).length === 0);
}

console.log('\n=== Presentación ===');
{
  const l = lineasPreferencias(ficha());
  check('una línea por tratamiento con día, hora y frecuencia', l[0] === 'Facial: jueves · 08:15 · mañana · cada 15 días');
  check('muestra "no puede", continuidad y ausencia', l.some((x) => x === 'No puede: miércoles') && l.some((x) => x.includes('septiembre 2026 (año inferido)')) && l.some((x) => x.includes('11/09/2026 al 23/09/2026')));
  check('facial a considerar se distingue', lineasPreferencias({ tratamientos: [{ tratamiento: 'facial', estado: 'a_considerar' }] })[0].startsWith('Facial (a considerar)'));
  check('texto de frecuencia', textoFrecuencia({ cantidad: 2, periodo: 'mes' }) === '2 por mes' && textoFrecuencia({}) === '');
}

console.log('\n=== Importación segura ===');
{
  const r1 = fusionarImportacion(undefined, ficha(), LOTE);
  check('paciente sin preferencias: se cargan tratamientos, frecuencias y meses', r1.estado === 'con_cambios' && r1.preferencias.tratamientos.length === 2 && r1.preferencias.mesesContinuidad.length === 1 && r1.conflictos.length === 0);
  check('queda la referencia del lote y la ficha', !!r1.preferencias.origen.lotes['L1:S01']);
  const r2 = fusionarImportacion(r1.preferencias, ficha(), LOTE);
  check('repetir el lote no cambia nada (idempotente)', r2.estado === 'ya_importado' && JSON.stringify(r2.preferencias) === JSON.stringify(r1.preferencias));
  const editado = clon(r1.preferencias);
  editado.tratamientos = editado.tratamientos.filter((t) => t.tratamiento !== 'corporal');
  editado.tratamientos[0].franjas[0].horaPreferida = '09:00';
  editado.diasNoDisponibles = [];
  const r3 = fusionarImportacion(editado, ficha(), LOTE);
  check('una edición manual posterior NO se revierte al repetir el lote', r3.estado === 'ya_importado' && JSON.stringify(r3.preferencias.tratamientos) === JSON.stringify(editado.tratamientos) && r3.preferencias.diasNoDisponibles.length === 0);
  check('sin duplicar tratamientos ni franjas', new Set(r1.preferencias.tratamientos.map((t) => t.tratamiento)).size === 2 && r1.preferencias.tratamientos[0].franjas.length === 1);

  const previo = { tratamientos: [{ id: 'x', tratamiento: 'facial', franjas: [{ id: 'y', dias: ['martes'], horaPreferida: '10:00' }], frecuencia: { cantidad: 1, periodo: 'mes' } }], observaciones: 'Nota vigente' };
  const r4 = fusionarImportacion(previo, ficha(), LOTE);
  check('un dato actual contradictorio se conserva y se informa como conflicto', r4.preferencias.tratamientos[0].franjas[0].dias.join() === 'martes' && r4.preferencias.tratamientos[0].frecuencia.cantidad === 1 && r4.conflictos.length >= 2);
  check('igual se agrega lo compatible (corporal nuevo, meses, ausencia)', r4.preferencias.tratamientos.some((t) => t.tratamiento === 'corporal') && r4.preferencias.mesesContinuidad.length === 1 && r4.preferencias.ausencias.length === 1);
  check('la observación vigente se conserva y se suma la de la ficha', r4.preferencias.observaciones === 'Nota vigente\nPrefiere temprano');
  check('agregar otro tratamiento no borra el anterior', r4.preferencias.tratamientos.length === 2 && r4.preferencias.tratamientos[0].id === 'x');

  const r5 = fusionarImportacion(r1.preferencias, ficha(), { ...LOTE, ref: 'S99' });
  check('otra ficha del mismo paciente con la misma información: sin cambios de datos', r5.estado === 'sin_cambios' && r5.cambios.length === 0);
  const vacioFrec = fusionarImportacion({ tratamientos: [{ tratamiento: 'facial' }] }, ficha(), LOTE);
  check('completa campos vacíos de un tratamiento existente', vacioFrec.preferencias.tratamientos[0].frecuencia.cadaDias === 15 && vacioFrec.preferencias.tratamientos[0].franjas.length === 1);
  let fallo = false; try { fusionarImportacion(undefined, ficha(), { ref: 'a' }); } catch (e) { fallo = true; }
  check('sin identificador de lote se rechaza', fallo);
}

console.log('=== Identificación del paciente ===');
{
  const pac = [
    { dni: '90000001', fullName: 'Ana P' }, { dni: '90000002', fullName: 'Bea Quiroga Lopez' }, { dni: '90000003', fullName: 'Carla R' },
    { dni: '90000004', fullName: 'Dora S' }, { dni: '90000005', fullName: 'Dora S' }, { dni: '90000006', fullName: 'Eva Toro' },
    { dni: '90000007', fullName: 'Fanny Barbara' }, { dni: '90000008', fullName: 'Gigi T' },
  ];
  const r = (e) => resolverPaciente(e, pac);
  const a = r({ dni: '90.000.001', dniEstado: 'legible', nombres: ['ana p'] });
  check('nombre exacto (sin importar mayúsculas/puntuación) + DNI coincidente → por DNI', a.estado === 'identificado' && a.paciente.dni === '90000001' && a.metodo === 'dni' && a.notas.length === 0);
  const b = r({ dni: '90000002', dniEstado: 'legible', nombres: ['Bea Quiroga'] });
  check('DNI único con nombre diferente → identifica y anota la diferencia', b.estado === 'identificado' && b.paciente.dni === '90000002' && b.notas[0].includes('difiere'));
  const c = r({ dni: '90000099', dniEstado: 'aportado', nombres: ['Carla R'] });
  check('DNI que no existe pero el nombre exacto tiene otro DNI → contradicción (no se elige a ciegas)', c.estado === 'contradiccion' && c.notas[0].includes('90000003'));
  check('DNI inexistente y nombre inexistente → no encontrado, con la búsqueda hecha', r({ dni: '90000098', dniEstado: 'legible', nombres: ['Nadie Aparece'] }).estado === 'no_encontrado' && r({ dni: '90000098', dniEstado: 'legible', nombres: ['Nadie Aparece'] }).busqueda.length === 2);
  check('nombre repetido sin DNI → ambiguo', r({ dniEstado: 'ninguno', nombres: ['Dora S'] }).estado === 'ambiguo');
  check('DNI repetido → ambiguo', resolverPaciente({ dni: '5', dniEstado: 'legible', nombres: [] }, [{ dni: '5', fullName: 'X' }, { dni: '5', fullName: 'Y' }]).estado === 'ambiguo');
  const d = r({ dni: '90000097', dniEstado: 'dudoso', nombres: ['Eva Toro'] });
  check('DNI dudoso + nombre exacto único → se carga por nombre y queda anotada la duda', d.estado === 'identificado' && d.metodo === 'nombre_exacto' && d.paciente.dni === '90000006' && d.notas.some((n) => n.includes('dudosa')) && d.notas.some((n) => n.includes('difiere')));
  const e = r({ dni: '90000008', dniEstado: 'dudoso', nombres: ['Gigi Torres'] });
  check('DNI dudoso que coincide exacto con un paciente de nombre compatible ("Gigi T" ~ Gigi Torres)', e.estado === 'identificado' && e.metodo === 'dni_candidato');
  check('DNI dudoso que coincide con alguien de nombre incompatible NO identifica', r({ dni: '90000008', dniEstado: 'dudoso', nombres: ['Zoe Mar'] }).estado === 'no_encontrado');
  check('mismas palabras en otro orden = nombre exacto (Apellido Nombre)', r({ dniEstado: 'ninguno', nombres: ['Toro Eva'] }).paciente.dni === '90000006');
  check('nombre parecido pero no exacto NO identifica', r({ dniEstado: 'ninguno', nombres: ['Eva Toros'] }).estado === 'no_encontrado');
  check('tildes y espacios se normalizan', resolverPaciente({ dniEstado: 'ninguno', nombres: ['  bárbara   fanny '] }, pac).paciente.dni === '90000007');
}

console.log('\n=== Integración con la planificación ===');
{
  const conPref = { preferencias: serializarPreferencias(ficha()) };
  check('un paciente con solo preferencias no es "Sin configurar"', esPlanificacionVacia(conPref) === false && estadoPlanificacion(conPref) === 'configurada');
  check('sin preferencias y sin días sigue incompleta', estadoPlanificacion({ tratamiento: 'facial' }) === 'incompleta');
  check('los pendientes por confirmar no impiden guardar', validarPlanificacion(conPref).errores.length === 0);
  check('errores de preferencias bloquean el guardado', validarPlanificacion({ preferencias: { tratamientos: [{ tratamiento: 'facial', franjas: [{ horaPreferida: '99:99' }] }] } }).errores.length === 1);
  const ser = serializarPlanificacion(normalizarPlanificacion({ ...conPref, tratamiento: 'facial' }));
  check('guardar la planificación conserva las preferencias', ser.preferencias.tratamientos.length === 2 && !!ser.preferencias.origen.lotes);
  check('sin preferencias no agrega el campo (fichas viejas no cambian)', !('preferencias' in serializarPlanificacion(normalizarPlanificacion({ tratamiento: 'facial' }))));
}

console.log('\n' + '='.repeat(60));
console.log(fails ? fails + ' prueba(s) fallaron' : 'TODAS LAS PRUEBAS DE PREFERENCIAS OK');
process.exit(fails ? 1 : 0);
