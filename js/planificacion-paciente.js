// Disponibilidad y planificación por paciente — lógica pura (sin DOM, sin
// Firestore). Se guarda en clients/{dni}.planificacion (un solo campo, así
// se actualiza sin tocar el resto de la ficha). Etapa 1: solo carga, edición,
// validación y resumen; la generación de agenda es una etapa posterior que va
// a leer este mismo formato.
//
// Forma guardada (version 1):
// {
//   version: 1,
//   disponibilidad: { modo: 'estricta'|'preferida'|null,
//                     dias: { lunes: [{desde:'09:00', hasta:'11:00'}], ... } },
//   tratamiento: 'facial'|'corporal'|'ambos'|null,
//   turnosHabituales: [{ id, dia, horaInicio, servicio, duracionMin, box }],
//   frecuencia: { habitualSemana, maximoSemana, totalPrevisto, alcance:'mes'|'plan'|null },
//   vigencia: { desde:'YYYY-MM-DD'|null, hasta:'YYYY-MM-DD'|null },
//   observaciones: string
// }
// En el borrador de edición los números viajan como texto ('' = vacío) para
// poder distinguir "pendiente" (vacío) de "inválido" (texto que no es un
// entero positivo).

export const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
export const ETIQUETA_DIA = {
  lunes: 'Lunes', martes: 'Martes', miercoles: 'Miércoles', jueves: 'Jueves',
  viernes: 'Viernes', sabado: 'Sábado', domingo: 'Domingo',
};
export const MODOS = {
  estricta: 'Solo puede en estos días y horarios',
  preferida: 'Prefiere estos días y horarios; otras opciones requieren consulta',
};
export const ALCANCES = { mes: 'Por mes', plan: 'Total del plan' };
export const TRATAMIENTOS = { facial: 'Facial', corporal: 'Corporal', ambos: 'Facial y corporal' };
// Regla del centro: el tratamiento facial se realiza como mínimo cada 15 días;
// antes de ese plazo no se recomienda.
export const FACIAL_INTERVALO_MIN_DIAS = 15;
export const MENSAJE_FACIAL_15_DIAS = 'El tratamiento facial se realiza como mínimo cada 15 días; antes de ese plazo no se recomienda.';

const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const ENTERO_POSITIVO_RE = /^[1-9]\d*$/;

export function horaAMin(h) {
  const t = (h ?? '').toString().trim();
  if (!HORA_RE.test(t)) return null;
  return parseInt(t.slice(0, 2), 10) * 60 + parseInt(t.slice(3), 10);
}
export function minAHora(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
function fechaValida(f) {
  if (!FECHA_RE.test(f || '')) return false;
  const [y, m, d] = f.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
export function formatearFechaCorta(f) {
  return FECHA_RE.test(f || '') ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : '';
}

let _seq = 0;
export function nuevoIdFila() {
  _seq += 1;
  return `h_${Date.now().toString(36)}${_seq.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

export function planVacia() {
  return {
    version: 1,
    tratamiento: null,
    disponibilidad: { modo: null, dias: {} },
    turnosHabituales: [],
    frecuencia: { habitualSemana: '', maximoSemana: '', totalPrevisto: '', alcance: null },
    vigencia: { desde: '', hasta: '' },
    observaciones: '',
  };
}

const _txt = (v) => (v == null ? '' : String(v));
const _num = (v) => (v == null || v === '' ? '' : String(v));

// Acepta lo guardado en Firestore (o nada) y devuelve un borrador completo.
// Nunca inventa datos: lo que no está queda vacío.
export function normalizarPlanificacion(raw) {
  const p = planVacia();
  if (!raw || typeof raw !== 'object') return p;
  p.tratamiento = Object.prototype.hasOwnProperty.call(TRATAMIENTOS, raw.tratamiento) ? raw.tratamiento : null;
  const disp = raw.disponibilidad || {};
  p.disponibilidad.modo = Object.prototype.hasOwnProperty.call(MODOS, disp.modo) ? disp.modo : null;
  DIAS.forEach((d) => {
    const lista = disp.dias && disp.dias[d];
    if (Array.isArray(lista)) {
      p.disponibilidad.dias[d] = lista.map((i) => ({ desde: _txt(i && i.desde), hasta: _txt(i && i.hasta) }));
    }
  });
  if (Array.isArray(raw.turnosHabituales)) {
    p.turnosHabituales = raw.turnosHabituales.map((r) => ({
      id: (r && r.id) || nuevoIdFila(),
      dia: DIAS.includes(r && r.dia) ? r.dia : '',
      horaInicio: _txt(r && r.horaInicio),
      servicio: _txt(r && r.servicio),
      duracionMin: _num(r && r.duracionMin),
      box: _txt(r && r.box),
    }));
  }
  const f = raw.frecuencia || {};
  p.frecuencia.habitualSemana = _num(f.habitualSemana);
  p.frecuencia.maximoSemana = _num(f.maximoSemana);
  p.frecuencia.totalPrevisto = _num(f.totalPrevisto);
  p.frecuencia.alcance = Object.prototype.hasOwnProperty.call(ALCANCES, f.alcance) ? f.alcance : null;
  const v = raw.vigencia || {};
  p.vigencia.desde = _txt(v.desde);
  p.vigencia.hasta = _txt(v.hasta);
  p.observaciones = _txt(raw.observaciones);
  return p;
}

export function esPlanificacionVacia(plan) {
  const p = normalizarPlanificacion(plan);
  return !p.tratamiento && !p.disponibilidad.modo
    && Object.keys(p.disponibilidad.dias).length === 0
    && p.turnosHabituales.length === 0
    && !p.frecuencia.habitualSemana && !p.frecuencia.maximoSemana && !p.frecuencia.totalPrevisto
    && !p.frecuencia.alcance && !p.vigencia.desde && !p.vigencia.hasta
    && !p.observaciones.trim();
}

const _filaVacia = (r) => !r.dia && !r.horaInicio && !r.servicio && !r.duracionMin && !r.box;
const _etq = (d) => ETIQUETA_DIA[d] || d;

function _intervalosValidos(lista) {
  return (lista || [])
    .map((i) => ({ desde: horaAMin(i.desde), hasta: horaAMin(i.hasta), rawDesde: i.desde, rawHasta: i.hasta }))
    .filter((i) => i.desde != null && i.hasta != null && i.hasta > i.desde);
}

// errores = valores inválidos (bloquean el guardado).
// pendientes = información que falta (permite guardar parcial).
// advertencias = inconsistencias entre datos válidos (no bloquean, no se
// corrigen solas).
// Modo simple (por defecto): solo cuentan el tratamiento y la disponibilidad
// semanal, que es lo que la interfaz pide. Con { completo: true } se validan
// además turnos habituales, frecuencia y vigencia (datos que pueden existir en
// fichas guardadas, pero que ya no se piden).
const _CAMPOS_COMPLETO = /^(habitualSemana|maximoSemana|totalPrevisto|alcance|vigencia|turnos|t:|facial15)/;
export function validarPlanificacion(planRaw, opciones) {
  const completo = !!(opciones && opciones.completo);
  const v = _validarTodo(planRaw);
  if (completo) return v;
  const solo = (lista) => lista.filter((x) => !_CAMPOS_COMPLETO.test(x.campo) && x.campo !== 'modo');
  return { errores: solo(v.errores), pendientes: solo(v.pendientes), advertencias: solo(v.advertencias) };
}
function _validarTodo(planRaw) {
  const p = normalizarPlanificacion(planRaw);
  const errores = [];
  const pendientes = [];
  const advertencias = [];
  const err = (campo, mensaje) => errores.push({ campo, mensaje });
  const pen = (campo, mensaje) => pendientes.push({ campo, mensaje });
  const adv = (campo, mensaje) => advertencias.push({ campo, mensaje });

  // ── Disponibilidad ──
  const diasSel = DIAS.filter((d) => Object.prototype.hasOwnProperty.call(p.disponibilidad.dias, d));
  if (!diasSel.length) pen('disponibilidad', 'Faltan los días y horarios en los que puede asistir.');
  if (!p.disponibilidad.modo) pen('modo', 'Falta indicar si solo puede en esos horarios o si son preferencias.');
  diasSel.forEach((d) => {
    const lista = p.disponibilidad.dias[d];
    if (!lista.length) { pen(`dia:${d}`, `${_etq(d)}: falta al menos un intervalo horario.`); return; }
    const buenos = [];
    lista.forEach((i, idx) => {
      const tieneD = !!i.desde, tieneH = !!i.hasta;
      if (!tieneD && !tieneH) { pen(`int:${d}:${idx}`, `${_etq(d)}: hay un intervalo vacío (no se guardará hasta completarlo).`); return; }
      if (!tieneD || !tieneH) { pen(`int:${d}:${idx}`, `${_etq(d)}: intervalo incompleto (no se guardará hasta completarlo).`); return; }
      const a = horaAMin(i.desde), b = horaAMin(i.hasta);
      if (a == null || b == null) { err(`int:${d}:${idx}`, `${_etq(d)}: hora no válida en el intervalo ${i.desde}–${i.hasta}.`); return; }
      if (b <= a) { err(`int:${d}:${idx}`, `${_etq(d)}: la hora final (${i.hasta}) debe ser posterior a la inicial (${i.desde}).`); return; }
      buenos.push({ a, b, desde: i.desde, hasta: i.hasta });
    });
    buenos.sort((x, y) => x.a - y.a);
    for (let k = 1; k < buenos.length; k++) {
      if (buenos[k].a < buenos[k - 1].b) {
        err(`solap:${d}`, `${_etq(d)}: los intervalos ${buenos[k - 1].desde}–${buenos[k - 1].hasta} y ${buenos[k].desde}–${buenos[k].hasta} se superponen.`);
      }
    }
  });

  // ── Frecuencia y objetivo ──
  const f = p.frecuencia;
  const chequeaEntero = (valor, campo, nombre) => {
    if (valor === '') return null;
    if (!ENTERO_POSITIVO_RE.test(String(valor).trim())) { err(campo, `${nombre}: tiene que ser un número entero positivo.`); return null; }
    return parseInt(String(valor).trim(), 10);
  };
  const hab = chequeaEntero(f.habitualSemana, 'habitualSemana', 'Turnos habituales por semana');
  const max = chequeaEntero(f.maximoSemana, 'maximoSemana', 'Máximo de turnos por semana');
  const tot = chequeaEntero(f.totalPrevisto, 'totalPrevisto', 'Cantidad total de turnos');
  if (hab != null && max != null && hab > max) {
    err('habitualSemana', `La frecuencia habitual (${hab}) no puede superar el máximo semanal (${max}).`);
  }
  if (tot != null && !f.alcance) pen('alcance', 'Indicá si la cantidad total corresponde a "Por mes" o al "Total del plan".');
  if (tot == null && f.alcance && f.totalPrevisto === '') pen('totalPrevisto', 'Elegiste un alcance pero falta la cantidad total de turnos.');

  // ── Tratamiento y regla de los 15 días del facial ──
  if (p.tratamiento === 'facial' || p.tratamiento === 'ambos') {
    const esFacial = (r) => /facial/i.test(r.servicio || '');
    const facialesSemana = p.turnosHabituales.filter((r) => !_filaVacia(r) && r.dia && r.horaInicio && (p.tratamiento === 'facial' || esFacial(r))).length;
    const motivos = [];
    if (p.tratamiento === 'facial' && hab != null && hab >= 1) motivos.push(`${hab} turno${hab === 1 ? '' : 's'} habitual${hab === 1 ? '' : 'es'} por semana`);
    if (p.tratamiento === 'facial' && max != null && max >= 1 && !(hab != null && hab >= 1)) motivos.push(`hasta ${max} turno${max === 1 ? '' : 's'} por semana`);
    if (facialesSemana >= 2) motivos.push(`${facialesSemana} turnos habituales faciales en la misma semana`);
    if (p.tratamiento === 'facial' && tot != null && f.alcance === 'mes' && tot > 2) motivos.push(`${tot} turnos por mes`);
    if (motivos.length) adv('facial15', `${MENSAJE_FACIAL_15_DIAS} Lo cargado (${motivos.join(', ')}) supera esa frecuencia.`);
  }

  // ── Vigencia ──
  const { desde, hasta } = p.vigencia;
  if (desde && !fechaValida(desde)) err('vigenciaDesde', 'La fecha de inicio no es válida.');
  if (hasta && !fechaValida(hasta)) err('vigenciaHasta', 'La fecha de finalización no es válida.');
  if (fechaValida(desde) && fechaValida(hasta) && hasta < desde) {
    err('vigenciaHasta', 'La fecha de finalización no puede ser anterior a la de inicio.');
  }

  // ── Turnos habituales ──
  const filas = p.turnosHabituales;
  const llenas = filas.filter((r) => !_filaVacia(r));
  if (!llenas.length) pen('turnos', 'Faltan los turnos habituales.');
  const vistos = new Map();
  filas.forEach((r, idx) => {
    if (_filaVacia(r)) return;
    const n = idx + 1;
    if (!r.dia) pen(`t:${r.id}:dia`, `Turno habitual ${n}: falta el día.`);
    if (!r.horaInicio) pen(`t:${r.id}:hora`, `Turno habitual ${n}: falta la hora de inicio.`);
    else if (horaAMin(r.horaInicio) == null) err(`t:${r.id}:hora`, `Turno habitual ${n}: la hora de inicio no es válida.`);
    if (!r.servicio) pen(`t:${r.id}:servicio`, `Turno habitual ${n}: falta el servicio o tratamiento.`);
    if (r.duracionMin === '') pen(`t:${r.id}:duracion`, `Turno habitual ${n}: falta la duración.`);
    else if (!ENTERO_POSITIVO_RE.test(String(r.duracionMin).trim())) err(`t:${r.id}:duracion`, `Turno habitual ${n}: la duración tiene que ser un número entero positivo de minutos.`);
    const clave = [r.dia, r.horaInicio, r.servicio, String(r.duracionMin).trim(), r.box].join('|');
    if (vistos.has(clave)) {
      err(`t:${r.id}:dup`, `Los turnos habituales ${vistos.get(clave)} y ${n} son idénticos (${_etq(r.dia) || 'sin día'} ${r.horaInicio || '--:--'}${r.servicio ? ' · ' + r.servicio : ''}).`);
    } else vistos.set(clave, n);
  });

  // ── Advertencias: turnos habituales vs. disponibilidad ──
  const hayDisponibilidadUtil = diasSel.some((d) => _intervalosValidos(p.disponibilidad.dias[d]).length);
  if (hayDisponibilidadUtil) {
    filas.forEach((r, idx) => {
      if (_filaVacia(r) || !r.dia || horaAMin(r.horaInicio) == null) return;
      const n = idx + 1;
      const ini = horaAMin(r.horaInicio);
      const dur = ENTERO_POSITIVO_RE.test(String(r.duracionMin).trim()) ? parseInt(r.duracionMin, 10) : null;
      const intervalos = _intervalosValidos(p.disponibilidad.dias[r.dia]);
      const etq = `Turno habitual ${n} (${_etq(r.dia)} ${r.horaInicio}${dur ? `, ${dur} min` : ''})`;
      if (!Object.prototype.hasOwnProperty.call(p.disponibilidad.dias, r.dia) || !intervalos.length) {
        adv(`t:${r.id}:fuera`, `${etq}: ${_etq(r.dia)} no tiene disponibilidad cargada.`);
        return;
      }
      const contenedor = intervalos.find((i) => ini >= i.desde && ini < i.hasta);
      if (!contenedor) {
        adv(`t:${r.id}:fuera`, `${etq} empieza fuera de la disponibilidad de ese día (${intervalos.map((i) => `${minAHora(i.desde)}–${minAHora(i.hasta)}`).join(' y ')}).`);
      } else if (dur != null && ini + dur > contenedor.hasta) {
        adv(`t:${r.id}:fuera`, `${etq} termina a las ${minAHora(ini + dur)}, después del fin de la disponibilidad (${minAHora(contenedor.hasta)}); tendría que empezar como máximo a las ${minAHora(contenedor.hasta - dur)}.`);
      }
    });
  }
  if (max != null) {
    const semanales = llenas.filter((r) => r.dia && r.horaInicio).length;
    if (semanales > max) adv('maximoSemana', `Hay ${semanales} turnos habituales por semana y el máximo semanal indicado es ${max}.`);
  }

  return { errores, pendientes, advertencias };
}

// 'sin_configurar' | 'incompleta' | 'configurada'
export function estadoPlanificacion(planRaw, opciones) {
  if (esPlanificacionVacia(planRaw)) return 'sin_configurar';
  const v = validarPlanificacion(planRaw, opciones);
  return v.errores.length === 0 && v.pendientes.length === 0 ? 'configurada' : 'incompleta';
}
export const ETIQUETA_ESTADO_PLAN = { sin_configurar: 'Sin configurar', incompleta: 'Incompleta', configurada: 'Configurada' };

function _lista(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}
const _cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function _textoIntervalos(lista) {
  const buenos = _intervalosValidos(lista).sort((x, y) => x.desde - y.desde);
  return _lista(buenos.map((i) => `${minAHora(i.desde)} a ${minAHora(i.hasta)}`));
}

// Resumen breve para la ficha cerrada. Solo muestra lo efectivamente cargado.
export function resumenPlanificacion(planRaw, opciones) {
  if (esPlanificacionVacia(planRaw)) return '';
  const completo = !!(opciones && opciones.completo);
  const p = normalizarPlanificacion(planRaw);
  const partes = [];
  if (p.tratamiento) partes.push(TRATAMIENTOS[p.tratamiento]);
  const diasSel = DIAS.filter((d) => Object.prototype.hasOwnProperty.call(p.disponibilidad.dias, d));
  if (diasSel.length) {
    const firma = (d) => _textoIntervalos(p.disponibilidad.dias[d]);
    const firmas = diasSel.map(firma);
    if (firmas.every((s) => s === firmas[0])) {
      partes.push(_cap(_lista(diasSel.map((d) => ETIQUETA_DIA[d].toLowerCase()))));
      if (firmas[0]) partes.push(firmas[0]);
    } else {
      partes.push(_cap(diasSel.map((d, i) => `${ETIQUETA_DIA[d].toLowerCase()}${firmas[i] ? ' ' + firmas[i] : ''}`).join('; ')));
    }
  }
  if (p.disponibilidad.modo === 'estricta') partes.push('Solo esos horarios');
  if (p.disponibilidad.modo === 'preferida') partes.push('Horarios preferidos');
  const f = p.frecuencia;
  if (!completo) return partes.join(' · ');
  if (ENTERO_POSITIVO_RE.test(f.habitualSemana)) partes.push(`Habitual: ${f.habitualSemana} por semana`);
  if (ENTERO_POSITIVO_RE.test(f.maximoSemana)) partes.push(`Hasta ${f.maximoSemana} turno${f.maximoSemana === '1' ? '' : 's'} por semana`);
  if (ENTERO_POSITIVO_RE.test(f.totalPrevisto)) {
    const n = f.totalPrevisto;
    const cant = `${n} turno${n === '1' ? '' : 's'}`;
    partes.push(f.alcance === 'mes' ? `Objetivo: ${cant} por mes` : f.alcance === 'plan' ? `Objetivo: ${cant} en total del plan` : `Objetivo: ${cant} (alcance sin indicar)`);
  }
  const nTurnos = p.turnosHabituales.filter((r) => !_filaVacia(r)).length;
  if (nTurnos) partes.push(`${nTurnos} turno${nTurnos === 1 ? '' : 's'} habitual${nTurnos === 1 ? '' : 'es'}`);
  const d = formatearFechaCorta(p.vigencia.desde), h = formatearFechaCorta(p.vigencia.hasta);
  if (d && h) partes.push(`Del ${d} al ${h}`);
  else if (d) partes.push(`Desde ${d}`);
  else if (h) partes.push(`Hasta ${h}`);
  return partes.join(' · ');
}

// Convierte el borrador (ya validado sin errores) al formato guardado.
// Los campos vacíos pasan a null, los intervalos incompletos no se guardan.
export function serializarPlanificacion(planRaw) {
  const p = normalizarPlanificacion(planRaw);
  const dias = {};
  DIAS.forEach((d) => {
    if (!Object.prototype.hasOwnProperty.call(p.disponibilidad.dias, d)) return;
    dias[d] = p.disponibilidad.dias[d]
      .filter((i) => horaAMin(i.desde) != null && horaAMin(i.hasta) != null)
      .map((i) => ({ desde: i.desde, hasta: i.hasta }))
      .sort((x, y) => horaAMin(x.desde) - horaAMin(y.desde));
  });
  const entero = (v) => (ENTERO_POSITIVO_RE.test(String(v).trim()) ? parseInt(String(v).trim(), 10) : null);
  return {
    version: 1,
    tratamiento: p.tratamiento,
    disponibilidad: { modo: p.disponibilidad.modo, dias },
    turnosHabituales: p.turnosHabituales
      .filter((r) => !_filaVacia(r))
      .map((r) => ({
        id: r.id,
        dia: r.dia || null,
        horaInicio: horaAMin(r.horaInicio) != null ? r.horaInicio : null,
        servicio: r.servicio || null,
        duracionMin: entero(r.duracionMin),
        box: r.box || null,
      })),
    frecuencia: {
      habitualSemana: entero(p.frecuencia.habitualSemana),
      maximoSemana: entero(p.frecuencia.maximoSemana),
      totalPrevisto: entero(p.frecuencia.totalPrevisto),
      alcance: p.frecuencia.alcance,
    },
    vigencia: { desde: fechaValida(p.vigencia.desde) ? p.vigencia.desde : null, hasta: fechaValida(p.vigencia.hasta) ? p.vigencia.hasta : null },
    observaciones: p.observaciones.trim(),
  };
}

// ── Regla de los 15 días del facial contra turnos reales ──────────────────
// Un servicio cuenta como facial si su nombre lo dice; las consultas iniciales
// no son tratamientos (el llamador las excluye por su tipo estable).
export function esServicioFacial(nombre) {
  return /facial/i.test(String(nombre == null ? '' : nombre));
}

const _dia = (f) => {
  if (!FECHA_RE.test(String(f || ''))) return null;
  const [y, m, d] = f.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d);
  const dt = new Date(t);
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? Math.round(t / 86400000) : null;
};
const _fechaDeDia = (n) => new Date(n * 86400000).toISOString().slice(0, 10);

// previas: [{ fecha:'YYYY-MM-DD', servicio, id? }] — solo turnos activos y faciales
// (el llamador ya filtra). Devuelve { conflicto:false } o el facial más cercano
// que queda a menos de 15 días, con los días de diferencia y, si hay un facial
// anterior, la primera fecha recomendada (esa fecha + 15 días).
export function evaluarIntervaloFacial(fechaNueva, previas, idIgnorar) {
  const nueva = _dia(fechaNueva);
  if (nueva == null || !Array.isArray(previas)) return { conflicto: false };
  let cercano = null;
  previas.forEach((p) => {
    if (!p || (idIgnorar && p.id === idIgnorar)) return;
    const d = _dia(p.fecha);
    if (d == null) return;
    const dist = Math.abs(d - nueva);
    if (dist < FACIAL_INTERVALO_MIN_DIAS && (!cercano || dist < cercano.dias)) cercano = { fecha: p.fecha, dias: dist, despues: d > nueva, servicio: p.servicio || '' };
  });
  if (!cercano) return { conflicto: false };
  const base = cercano.despues ? null : _dia(cercano.fecha);
  return {
    conflicto: true,
    ...cercano,
    fechaRecomendada: base != null ? _fechaDeDia(base + FACIAL_INTERVALO_MIN_DIAS) : null,
  };
}

export function textoConflictoFacial(res) {
  if (!res || !res.conflicto) return '';
  const cuando = res.dias === 0 ? 'ese mismo día'
    : res.despues ? `dentro de ${res.dias} día${res.dias === 1 ? '' : 's'} (${formatearFechaCorta(res.fecha)})`
      : `hace ${res.dias} día${res.dias === 1 ? '' : 's'} (${formatearFechaCorta(res.fecha)})`;
  return `Esta paciente tiene otro facial ${cuando}.`;
}
