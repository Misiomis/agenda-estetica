// Preferencias por tratamiento de cada paciente — lógica pura (sin DOM ni
// Firestore). Se guardan dentro de clients/{dni}.planificacion.preferencias, así
// siguen cubiertas por la misma regla que protege "planificacion".
//
// Principios:
//  · "Días sugeridos" es una preferencia; no equivale a "solo puede esos días".
//  · Lo desconocido queda vacío (null / ''), nunca 0.
//  · La frecuencia se guarda como fue expresada (texto) y, si se puede, como
//    número; "cada 15 días", "2 por mes" y "semanas alternas" no se igualan.
//  · Una importación completa datos vacíos y agrega compatibles: nunca pisa lo
//    que ya hay ni lo que el administrador edite después.
//
// Forma guardada (version 1):
// {
//   version: 1,
//   tratamientos: [{ id, tratamiento:'facial'|'corporal'|'relax', estado:'activo'|'a_considerar',
//     franjas: [{ id, dias:[…], franja, horaPreferida:'HH:MM'|null, opcionesHora:['HH:MM'…],
//                 desde:'HH:MM'|null, hasta:'HH:MM'|null, minutosConsecutivos:int|null, texto }],
//     frecuencia: { cantidad:int|null, periodo:'semana'|'mes'|null, cadaDias:int|null, texto } }],
//   franjasGenerales: [franja]   (horarios que no son de un tratamiento en particular),
//   frecuenciaTotal: { cantidad, periodo, cadaDias, texto } | null,
//   diasNoDisponibles: ['miercoles'],
//   mesesContinuidad: [{ mes:'YYYY-MM', anioInferido:bool }],
//   ausencias: [{ desde:'YYYY-MM-DD', hasta:'YYYY-MM-DD', nota, anioInferido:bool }],
//   observaciones: string,
//   pendientes: [{ campo, detalle }],
//   origen: { lotes: { ['<lote>:<ficha>']: { fichas:[…], importadoEn } } }
// }

export const PREF_TRATAMIENTOS = { facial: 'Facial', corporal: 'Corporal', relax: 'Relax' };
export const PREF_ESTADOS = { activo: 'Activo', a_considerar: 'A considerar' };
export const PREF_FRANJAS = {
  manana: 'Mañana', tarde: 'Tarde', tardecita: 'Tardecita',
  primera_tarde: 'Primer horario de la tarde', todo_el_dia: 'Todo el día',
};
export const PREF_PERIODOS = { semana: 'por semana', mes: 'por mes' };
export const PREF_DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
const ETQ_DIA = { lunes: 'lunes', martes: 'martes', miercoles: 'miércoles', jueves: 'jueves', viernes: 'viernes', sabado: 'sábado', domingo: 'domingo' };
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const ENTERO_RE = /^[1-9]\d*$/;
const txt = (v) => (v == null ? '' : String(v));
let _seq = 0;
export function nuevoIdPref(prefijo = 'p') {
  _seq += 1;
  return `${prefijo}_${Date.now().toString(36)}${_seq.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}
const horaMin = (h) => (HORA_RE.test(txt(h)) ? parseInt(h.slice(0, 2), 10) * 60 + parseInt(h.slice(3), 10) : null);
const fechaOk = (f) => {
  if (!FECHA_RE.test(txt(f))) return false;
  const [y, m, d] = f.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};
const fmtFecha = (f) => (fechaOk(f) ? f.split('-').reverse().join('/') : '');
const numTxt = (v) => (v == null || v === '' ? '' : String(v));

export function frecuenciaVacia() { return { cantidad: '', periodo: '', cadaDias: '', texto: '' }; }
export function franjaVacia() {
  return { id: nuevoIdPref('f'), dias: [], franja: '', horaPreferida: '', opcionesHora: [], desde: '', hasta: '', minutosConsecutivos: '', texto: '' };
}
export function tratamientoVacio(tratamiento = 'facial') {
  return { id: nuevoIdPref('t'), tratamiento, estado: 'activo', franjas: [], frecuencia: frecuenciaVacia() };
}
export function preferenciasVacias() {
  return {
    version: 1, tratamientos: [], franjasGenerales: [], frecuenciaTotal: null, diasNoDisponibles: [],
    mesesContinuidad: [], ausencias: [], observaciones: '', pendientes: [], origen: { lotes: {} },
  };
}

function normFranja(x) {
  return {
    id: x.id || nuevoIdPref('f'),
    dias: (Array.isArray(x.dias) ? x.dias : []).filter((d) => PREF_DIAS.includes(d)),
    franja: Object.prototype.hasOwnProperty.call(PREF_FRANJAS, x.franja) ? x.franja : '',
    horaPreferida: txt(x.horaPreferida),
    opcionesHora: (Array.isArray(x.opcionesHora) ? x.opcionesHora : []).map(txt),
    desde: txt(x.desde), hasta: txt(x.hasta),
    minutosConsecutivos: numTxt(x.minutosConsecutivos),
    texto: txt(x.texto),
  };
}
const normFranjas = (l) => (Array.isArray(l) ? l : []).filter((x) => x && typeof x === 'object').map(normFranja);

function normFrecuencia(f) {
  const o = frecuenciaVacia();
  if (!f || typeof f !== 'object') return o;
  o.cantidad = numTxt(f.cantidad);
  o.periodo = Object.prototype.hasOwnProperty.call(PREF_PERIODOS, f.periodo) ? f.periodo : '';
  o.cadaDias = numTxt(f.cadaDias);
  o.texto = txt(f.texto);
  return o;
}
const frecVacia = (f) => !f || (!f.cantidad && !f.periodo && !f.cadaDias && !txt(f.texto).trim());

// Acepta lo guardado (o nada) y devuelve un borrador completo, sin inventar datos.
export function normalizarPreferencias(raw) {
  const p = preferenciasVacias();
  if (!raw || typeof raw !== 'object') return p;
  if (Array.isArray(raw.tratamientos)) {
    p.tratamientos = raw.tratamientos.filter((t) => t && typeof t === 'object').map((t) => ({
      id: t.id || nuevoIdPref('t'),
      tratamiento: Object.prototype.hasOwnProperty.call(PREF_TRATAMIENTOS, t.tratamiento) ? t.tratamiento : 'facial',
      estado: t.estado === 'a_considerar' ? 'a_considerar' : 'activo',
      franjas: normFranjas(t.franjas),
      frecuencia: normFrecuencia(t.frecuencia),
    }));
  }
  p.franjasGenerales = normFranjas(raw.franjasGenerales);
  p.frecuenciaTotal = raw.frecuenciaTotal ? normFrecuencia(raw.frecuenciaTotal) : null;
  p.diasNoDisponibles = (Array.isArray(raw.diasNoDisponibles) ? raw.diasNoDisponibles : []).filter((d) => PREF_DIAS.includes(d));
  p.mesesContinuidad = (Array.isArray(raw.mesesContinuidad) ? raw.mesesContinuidad : []).filter((m) => m && typeof m === 'object')
    .map((m) => ({ mes: txt(m.mes), anioInferido: m.anioInferido === true }));
  p.ausencias = (Array.isArray(raw.ausencias) ? raw.ausencias : []).filter((a) => a && typeof a === 'object')
    .map((a) => ({ desde: txt(a.desde), hasta: txt(a.hasta), nota: txt(a.nota), anioInferido: a.anioInferido === true }));
  p.observaciones = txt(raw.observaciones);
  p.pendientes = (Array.isArray(raw.pendientes) ? raw.pendientes : []).filter((x) => x && typeof x === 'object')
    .map((x) => ({ campo: txt(x.campo), detalle: txt(x.detalle) }));
  const lotes = raw.origen && raw.origen.lotes && typeof raw.origen.lotes === 'object' ? raw.origen.lotes : {};
  Object.keys(lotes).forEach((k) => {
    const l = lotes[k] || {};
    p.origen.lotes[k] = { fichas: (Array.isArray(l.fichas) ? l.fichas : []).map(txt), importadoEn: txt(l.importadoEn) };
  });
  return p;
}

const franjaVaciaFila = (x) => !x.dias.length && !x.franja && !x.horaPreferida && !x.opcionesHora.length && !x.desde && !x.hasta && !x.minutosConsecutivos && !txt(x.texto).trim();

export function esPreferenciasVacia(raw) {
  const p = normalizarPreferencias(raw);
  return !p.tratamientos.length && !p.franjasGenerales.length && !p.frecuenciaTotal && !p.diasNoDisponibles.length && !p.mesesContinuidad.length
    && !p.ausencias.length && !p.observaciones.trim() && !p.pendientes.length;
}
export function tienePreferenciasUtiles(raw) {
  return normalizarPreferencias(raw).tratamientos.length > 0;
}

export function validarPreferencias(raw) {
  const p = normalizarPreferencias(raw);
  const errores = [];
  const err = (campo, mensaje) => errores.push({ campo, mensaje });
  const etq = (t) => PREF_TRATAMIENTOS[t.tratamiento];
  const chequeaFrec = (f, nombre) => {
    if (f.cantidad && !ENTERO_RE.test(String(f.cantidad).trim())) err('frec', `${nombre}: la cantidad tiene que ser un número entero positivo.`);
    if (f.cadaDias && !ENTERO_RE.test(String(f.cadaDias).trim())) err('frec', `${nombre}: "cada N días" tiene que ser un número entero positivo.`);
    if (f.cantidad && !f.periodo && !f.cadaDias) err('frec', `${nombre}: indicá si la cantidad es por semana o por mes.`);
  };
  const chequeaFranja = (x, n) => {
    if (x.horaPreferida && horaMin(x.horaPreferida) == null) err('hora', `${n}: la hora preferida no es válida.`);
    x.opcionesHora.forEach((h) => { if (horaMin(h) == null) err('hora', `${n}: la hora "${h}" no es válida.`); });
    if (x.desde && horaMin(x.desde) == null) err('hora', `${n}: la hora "desde" no es válida.`);
    if (x.hasta && horaMin(x.hasta) == null) err('hora', `${n}: la hora "hasta" no es válida.`);
    if (horaMin(x.desde) != null && horaMin(x.hasta) != null && horaMin(x.hasta) <= horaMin(x.desde)) err('hora', `${n}: "hasta" tiene que ser posterior a "desde".`);
    if (x.minutosConsecutivos && !ENTERO_RE.test(String(x.minutosConsecutivos).trim())) err('min', `${n}: los minutos seguidos tienen que ser un número entero positivo.`);
  };
  p.tratamientos.forEach((t, idxT) => {
    if (p.tratamientos.findIndex((x) => x.tratamiento === t.tratamiento) !== idxT) {
      err('trat', `${etq(t)} figura más de una vez; unificá los datos en una sola tarjeta.`);
    }
    chequeaFrec(t.frecuencia, `${etq(t)}, frecuencia`);
    t.franjas.forEach((x, i) => chequeaFranja(x, `${etq(t)}, horario ${i + 1}`));
  });
  p.franjasGenerales.forEach((x, i) => chequeaFranja(x, `Horarios generales, horario ${i + 1}`));
  if (p.frecuenciaTotal) chequeaFrec(p.frecuenciaTotal, 'Frecuencia total');
  p.mesesContinuidad.forEach((m) => { if (!MES_RE.test(m.mes)) err('mes', `El mes "${m.mes}" no es válido (usá año y mes).`); });
  p.ausencias.forEach((a, i) => {
    if (!fechaOk(a.desde) || !fechaOk(a.hasta)) err('aus', `Ausencia ${i + 1}: completá fechas válidas de inicio y fin.`);
    else if (a.hasta < a.desde) err('aus', `Ausencia ${i + 1}: el fin no puede ser anterior al inicio.`);
  });
  return { errores };
}

const _lista = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`);
export function textoFrecuencia(f) {
  const n = normFrecuencia(f);
  if (frecVacia(n)) return '';
  if (n.texto.trim()) return n.texto.trim();
  if (n.cadaDias) return `cada ${n.cadaDias} días`;
  if (n.cantidad && n.periodo) return `${n.cantidad} ${PREF_PERIODOS[n.periodo]}`;
  return n.cantidad ? `${n.cantidad} (período sin indicar)` : '';
}
export function textoFranja(x) {
  const partes = [];
  if (x.dias && x.dias.length) partes.push(_lista(x.dias.map((d) => ETQ_DIA[d])));
  if (x.horaPreferida) partes.push(x.horaPreferida);
  if (x.opcionesHora && x.opcionesHora.length) partes.push(x.opcionesHora.join(' o '));
  if (x.desde && x.hasta) partes.push(`${x.desde} a ${x.hasta}`);
  else if (x.desde) partes.push(`desde ${x.desde}`);
  else if (x.hasta) partes.push(`hasta ${x.hasta}`);
  if (x.franja) partes.push(PREF_FRANJAS[x.franja].toLowerCase());
  if (x.minutosConsecutivos) partes.push(`${x.minutosConsecutivos} min seguidos`);
  if (txt(x.texto).trim()) partes.push(`«${x.texto.trim()}»`);
  return partes.join(' · ');
}
export function textoMes(m) {
  const [a, mm] = String(m.mes).split('-');
  return MES_RE.test(m.mes) ? `${MESES[Number(mm) - 1]} ${a}${m.anioInferido ? ' (año inferido)' : ''}` : m.mes;
}

// Líneas legibles para mostrar en la ficha.
export function lineasPreferencias(raw) {
  const p = normalizarPreferencias(raw);
  const out = [];
  p.tratamientos.forEach((t) => {
    const partes = [];
    const fr = textoFrecuencia(t.frecuencia);
    const fs = t.franjas.filter((x) => !franjaVaciaFila(x)).map(textoFranja);
    if (fs.length) partes.push(fs.join(' / '));
    if (fr) partes.push(fr);
    out.push(`${PREF_TRATAMIENTOS[t.tratamiento]}${t.estado === 'a_considerar' ? ' (a considerar)' : ''}: ${partes.join(' · ') || 'sin detalle'}`);
  });
  const gen = p.franjasGenerales.filter((x) => !franjaVaciaFila(x)).map(textoFranja);
  if (gen.length) out.push(`Horarios: ${gen.join(' / ')}`);
  const ft = p.frecuenciaTotal ? textoFrecuencia(p.frecuenciaTotal) : '';
  if (ft) out.push(`Frecuencia total: ${ft}`);
  if (p.diasNoDisponibles.length) out.push(`No puede: ${_lista(p.diasNoDisponibles.map((d) => ETQ_DIA[d]))}`);
  if (p.mesesContinuidad.length) out.push(`Continuidad: ${p.mesesContinuidad.map(textoMes).join(', ')}`);
  p.ausencias.forEach((a) => out.push(`Ausente del ${fmtFecha(a.desde) || a.desde} al ${fmtFecha(a.hasta) || a.hasta}${a.anioInferido ? ' (año inferido)' : ''}${a.nota ? ` — ${a.nota}` : ''}`));
  if (p.observaciones.trim()) out.push(`Obs.: ${p.observaciones.trim()}`);
  return out;
}

// Convierte el borrador (sin errores) al formato guardado: vacíos → null,
// filas vacías fuera, cantidades como enteros.
export function serializarPreferencias(raw) {
  const p = normalizarPreferencias(raw);
  const ent = (v) => (ENTERO_RE.test(String(v).trim()) ? parseInt(String(v).trim(), 10) : null);
  const frec = (f) => ({ cantidad: ent(f.cantidad), periodo: f.periodo || null, cadaDias: ent(f.cadaDias), texto: f.texto.trim() });
  const serFranja = (x) => ({
    id: x.id, dias: PREF_DIAS.filter((d) => x.dias.includes(d)), franja: x.franja || null,
    horaPreferida: horaMin(x.horaPreferida) != null ? x.horaPreferida : null,
    opcionesHora: x.opcionesHora.filter((h) => horaMin(h) != null),
    desde: horaMin(x.desde) != null ? x.desde : null, hasta: horaMin(x.hasta) != null ? x.hasta : null,
    minutosConsecutivos: ent(x.minutosConsecutivos), texto: x.texto.trim(),
  });
  return {
    version: 1,
    tratamientos: p.tratamientos.map((t) => ({
      id: t.id, tratamiento: t.tratamiento, estado: t.estado,
      franjas: t.franjas.filter((x) => !franjaVaciaFila(x)).map(serFranja),
      frecuencia: frec(t.frecuencia),
    })),
    franjasGenerales: p.franjasGenerales.filter((x) => !franjaVaciaFila(x)).map(serFranja),
    frecuenciaTotal: p.frecuenciaTotal && !frecVacia(p.frecuenciaTotal) ? frec(p.frecuenciaTotal) : null,
    diasNoDisponibles: PREF_DIAS.filter((d) => p.diasNoDisponibles.includes(d)),
    mesesContinuidad: p.mesesContinuidad.filter((m) => MES_RE.test(m.mes)).sort((a, b) => a.mes.localeCompare(b.mes)).map((m) => ({ mes: m.mes, anioInferido: m.anioInferido })),
    ausencias: p.ausencias.filter((a) => fechaOk(a.desde) && fechaOk(a.hasta)).map((a) => ({ desde: a.desde, hasta: a.hasta, nota: a.nota.trim(), anioInferido: a.anioInferido })),
    observaciones: p.observaciones.trim(),
    pendientes: p.pendientes.filter((x) => x.campo || x.detalle),
    origen: { lotes: p.origen.lotes },
  };
}

// ── Importación segura ────────────────────────────────────────────────────
// actual: preferencias guardadas (o nada). entrante: preferencias de la ficha.
// Devuelve { preferencias, cambios[], conflictos[], estado } con estado
// 'ya_importado' | 'sin_cambios' | 'con_cambios'. No pisa datos existentes y,
// una vez importada una ficha, no vuelve a tocar nada (así una segunda corrida
// no restaura valores que el administrador haya editado después).
export function fusionarImportacion(actualRaw, entranteRaw, { loteId, ref, ahora }) {
  if (!loteId || !ref) throw new Error('fusionarImportacion: faltan loteId o ref');
  const marca = `${loteId}:${ref}`;
  const act = normalizarPreferencias(actualRaw);
  const ent = normalizarPreferencias(entranteRaw);
  if (act.origen.lotes[marca]) return { preferencias: serializarPreferencias(act), cambios: [], conflictos: [], estado: 'ya_importado' };

  const cambios = [];
  const conflictos = [];
  const res = normalizarPreferencias(serializarPreferencias(act));
  const idFranjas = (t, lista) => lista.map((x, i) => ({ ...x, id: `imp_${loteId}_${ref}_${t.tratamiento}_${i}` }));

  ent.tratamientos.forEach((t) => {
    const existente = res.tratamientos.find((x) => x.tratamiento === t.tratamiento);
    const nombre = PREF_TRATAMIENTOS[t.tratamiento];
    if (!existente) {
      res.tratamientos.push({ ...t, id: `imp_${loteId}_${ref}_${t.tratamiento}`, franjas: idFranjas(t, t.franjas) });
      cambios.push(`Se agregó ${nombre}`);
      return;
    }
    if (frecVacia(existente.frecuencia) && !frecVacia(t.frecuencia)) {
      existente.frecuencia = { ...t.frecuencia };
      cambios.push(`${nombre}: se completó la frecuencia`);
    } else if (!frecVacia(t.frecuencia) && textoFrecuencia(existente.frecuencia) !== textoFrecuencia(t.frecuencia)) {
      conflictos.push(`${nombre}: la frecuencia actual («${textoFrecuencia(existente.frecuencia)}») difiere de la ficha («${textoFrecuencia(t.frecuencia)}»); se conservó la actual`);
    }
    const ya = existente.franjas.filter((x) => !franjaVaciaFila(x));
    if (!ya.length && t.franjas.length) {
      existente.franjas = idFranjas(t, t.franjas);
      cambios.push(`${nombre}: se completaron los horarios`);
    } else if (t.franjas.length && JSON.stringify(ya.map(textoFranja)) !== JSON.stringify(t.franjas.map(textoFranja))) {
      conflictos.push(`${nombre}: los horarios actuales difieren de los de la ficha; se conservaron los actuales`);
    }
  });

  const genEnt = ent.franjasGenerales.filter((x) => !franjaVaciaFila(x));
  const genAct = res.franjasGenerales.filter((x) => !franjaVaciaFila(x));
  if (genEnt.length) {
    if (!genAct.length) { res.franjasGenerales = genEnt.map((x, i) => ({ ...x, id: `imp_${loteId}_${ref}_gen_${i}` })); cambios.push('Se cargaron los horarios generales'); }
    else if (JSON.stringify(genAct.map(textoFranja)) !== JSON.stringify(genEnt.map(textoFranja))) conflictos.push('Los horarios generales actuales difieren de los de la ficha; se conservaron los actuales');
  }
  if (ent.frecuenciaTotal && !frecVacia(ent.frecuenciaTotal)) {
    if (!res.frecuenciaTotal || frecVacia(res.frecuenciaTotal)) { res.frecuenciaTotal = ent.frecuenciaTotal; cambios.push('Se cargó la frecuencia total'); }
    else if (textoFrecuencia(res.frecuenciaTotal) !== textoFrecuencia(ent.frecuenciaTotal)) conflictos.push('La frecuencia total actual difiere de la ficha; se conservó la actual');
  }
  ent.diasNoDisponibles.forEach((d) => { if (!res.diasNoDisponibles.includes(d)) { res.diasNoDisponibles.push(d); cambios.push(`No disponible: ${ETQ_DIA[d]}`); } });
  ent.mesesContinuidad.forEach((m) => { if (!res.mesesContinuidad.some((x) => x.mes === m.mes)) { res.mesesContinuidad.push(m); cambios.push(`Continuidad: ${textoMes(m)}`); } });
  ent.ausencias.forEach((a) => { if (!res.ausencias.some((x) => x.desde === a.desde && x.hasta === a.hasta)) { res.ausencias.push(a); cambios.push(`Ausencia ${fmtFecha(a.desde)} al ${fmtFecha(a.hasta)}`); } });
  if (ent.observaciones.trim()) {
    if (!res.observaciones.trim()) { res.observaciones = ent.observaciones.trim(); cambios.push('Se cargó la observación'); }
    else if (!res.observaciones.includes(ent.observaciones.trim())) { res.observaciones = `${res.observaciones.trim()}\n${ent.observaciones.trim()}`; cambios.push('Se agregó la observación de la ficha'); }
  }
  ent.pendientes.forEach((x) => {
    if (!res.pendientes.some((y) => y.campo === x.campo && y.detalle === x.detalle)) { res.pendientes.push(x); cambios.push('Se agregó un pendiente por confirmar'); }
  });

  res.origen.lotes[marca] = { fichas: [ref], importadoEn: ahora || '' };
  return { preferencias: serializarPreferencias(res), cambios, conflictos, estado: cambios.length ? 'con_cambios' : 'sin_cambios' };
}
