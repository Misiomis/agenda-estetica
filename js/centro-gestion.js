// Centro de Gestión y Consultas — lógica pura (sin DOM ni Firestore).
//
// Reúne en un solo lugar: búsqueda global de pacientes en TODOS los meses,
// incorporación por mes, control de "pacientes que faltan agendar" en un mes
// de destino (pensado para después de duplicar un mes), comparación entre
// meses, filtros combinables, posibles duplicados y exportación.
//
// Reglas:
//  · Paciente ≠ turno ≠ sesión: cada persona se cuenta UNA vez por su clave
//    (DNI resuelto; sin DNI, nombre normalizado). Varias sesiones nunca la
//    convierten en "duplicada".
//  · Nada de meses fijos: todo se calcula con meses 'YYYY-MM' y aritmética de
//    meses (cruza años: 2026-12 → 2027-01).
//  · La ausencia de turnos NO es una suspensión: "Suspendido" / "Finalizado"
//    salen solo de un estado registrado explícitamente (o de la vigencia del
//    plan cargado en la ficha). Lo incierto queda "En revisión".
//  · Solo lee: ninguna función de este módulo modifica datos.

export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// ── Utilidades de texto y fechas ──
export const normalizar = (s) => (s ?? '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const esMes = (ym) => YM_RE.test(String(ym || ''));
export function sumarMeses(ym, n) {
  const [a, m] = ym.split('-').map(Number);
  const t = a * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}
export const difMeses = (a, b) => { const [ya, ma] = a.split('-').map(Number); const [yb, mb] = b.split('-').map(Number); return (yb * 12 + mb) - (ya * 12 + ma); };
export function rangoMeses(desde, hasta) { const out = []; if (!esMes(desde) || !esMes(hasta)) return out; for (let m = desde; m <= hasta && out.length < 600; m = sumarMeses(m, 1)) out.push(m); return out; }
export function nombreMes(ym, conAnio = true) { if (!esMes(ym)) return ym || ''; const [a, m] = ym.split('-'); const n = MESES[Number(m) - 1]; return conAnio ? `${n} ${a}` : n; }
export const nombreMesCap = (ym, conAnio = true) => { const t = nombreMes(ym, conAnio); return t.charAt(0).toUpperCase() + t.slice(1); };
export const fechaCorta = (f) => (f ? f.split('-').reverse().join('/') : '');
export const diasEntre = (a, b) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86400000);
const orden = (a, b) => `${a.fecha || ''}T${a.hora || ''}`.localeCompare(`${b.fecha || ''}T${b.hora || ''}`);
const hhmm = (h) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(h || '').trim()); return m ? `${m[1].padStart(2, '0')}:${m[2]}` : ''; };

// Fecha ISO (YYYY-MM-DD) a partir de lo que haya guardado: Timestamp de
// Firestore, Date, número (ms) o texto ISO. Sin dato confiable → null.
export function fechaISO(v) {
  if (!v) return null;
  let d = null;
  if (typeof v === 'string') { if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10); d = new Date(v); }
  else if (typeof v.toDate === 'function') d = v.toDate();
  else if (typeof v.seconds === 'number') d = new Date(v.seconds * 1000);
  else if (v instanceof Date) d = v;
  else if (typeof v === 'number') d = new Date(v);
  if (!d || Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Estados ──
export const ESTADOS = {
  agendado: { txt: 'Agendado', desc: 'Tiene al menos un turno válido en el mes.' },
  parcial: { txt: 'Parcialmente agendado', desc: 'Tiene menos turnos que los previstos en su planificación.' },
  sin_agendar: { txt: 'Sin agendar', desc: 'Sin turnos válidos en el mes y con actividad reciente.' },
  en_revision: { txt: 'En revisión', desc: 'Sin turnos en el mes; su continuidad no se puede determinar con certeza.' },
  suspendido: { txt: 'Suspendido', desc: 'Tiene una suspensión registrada explícitamente.' },
  finalizado: { txt: 'Finalizado', desc: 'Tratamiento finalizado según el estado registrado o la vigencia de su plan.' },
  posterior: { txt: 'Empieza después', desc: 'Su actividad empieza después del mes elegido.' },
};
export const ESTADOS_FORMALES = { activo: 'Activo (registrado)', suspendido: 'Suspendido', finalizado: 'Tratamiento finalizado' };
const ESTADOS_PENDIENTES = new Set(['sin_agendar', 'en_revision', 'parcial']);
export const esPendiente = (estado) => ESTADOS_PENDIENTES.has(estado);

// ── Construcción de pacientes únicos ──
/**
 * op:
 *  reservas      — TODAS las reservas (incluye canceladas; se excluyen bloqueos).
 *  fichas        — [{ dni, fullName, phone, createdAt, active, seguimiento, planificacion }]
 *  claveDe(r)    — identidad del paciente de una reserva ('dni:…' / 'nom:…').
 *  claveFicha(f) — identidad de una ficha (misma forma que claveDe).
 *  esActiva(r)   — no cancelada.
 *  esBloqueo(r)  — reserva-bloqueo del admin (no es un paciente).
 *  boxDe(r)      — etiqueta del box.
 *  hoy, ahora    — 'YYYY-MM-DD', 'HH:MM'.
 */
export function construirPacientes(op) {
  const hoy = op.hoy, ahora = op.ahora || '23:59';
  const realizada = (r) => r.fecha < hoy || (r.fecha === hoy && (hhmm(r.hora) || '23:59') <= ahora);
  const mapa = new Map();
  const nuevo = (clave) => ({
    clave, nombre: '', dni: clave.startsWith('dni:') ? clave.slice(4) : '', phone: '', ficha: false, registro: null,
    estadoFormal: null, plan: null, reservas: [],
  });
  const get = (k) => { if (!mapa.has(k)) mapa.set(k, nuevo(k)); return mapa.get(k); };

  for (const f of op.fichas || []) {
    const k = op.claveFicha(f);
    if (!k) continue;
    const p = get(k);
    p.ficha = true;
    if (f.fullName) p.nombre = f.fullName;
    if (f.phone) p.phone = String(f.phone);
    const reg = fechaISO(f.createdAt);
    if (reg && (!p.registro || reg < p.registro)) p.registro = reg;
    const seg = f.seguimiento && typeof f.seguimiento === 'object' ? f.seguimiento : null;
    if (seg && ESTADOS_FORMALES[seg.estado]) p.estadoFormal = { estado: seg.estado, desde: seg.desde || '', motivo: seg.motivo || '', historial: Array.isArray(seg.historial) ? seg.historial : [] };
    const pl = f.planificacion && typeof f.planificacion === 'object' ? f.planificacion : null;
    if (pl) {
      const fr = pl.frecuencia || {};
      const tot = Number(fr.totalPrevisto);
      p.plan = {
        porMes: fr.alcance === 'mes' && Number.isInteger(tot) && tot > 0 ? tot : null,
        vigenciaHasta: (pl.vigencia && /^\d{4}-\d{2}-\d{2}$/.test(pl.vigencia.hasta || '')) ? pl.vigencia.hasta : null,
      };
    }
  }
  for (const r of op.reservas || []) {
    if (!r || !/^\d{4}-\d{2}-\d{2}$/.test(String(r.fecha || ''))) continue;
    if (op.esBloqueo && op.esBloqueo(r)) continue;
    const k = op.claveDe(r);
    if (!k || k === 'nom:') continue;
    const p = get(k);
    p.reservas.push(r);
  }

  const out = [];
  for (const p of mapa.values()) {
    p.reservas.sort(orden);
    const sesiones = p.reservas.map((r) => {
      const activa = op.esActiva(r);
      return {
        id: r.id, fecha: r.fecha, hora: hhmm(r.hora), servicio: r.servicio || '', box: op.boxDe ? (op.boxDe(r) || '') : (r.box || ''),
        activa, cancelada: !activa, realizada: activa && realizada(r), futura: activa && !realizada(r),
        cuenta: !(op.noCuenta && op.noCuenta(r)), // "Jornada Doc" / Consulta inicial: no es sesión de tratamiento
        nota: (r.notaRapida || r.notas || r.observaciones || '').toString().trim(),
        duplicada: r.creadoPor === 'admin_duplicar_mes' || !!r.duplicacion,
        reprogramada: !!(r.reprogramadaDe || r.reagendadaDe || r.movidoDe || (r.duplicacion && r.duplicacion.reagendado)),
      };
    });
    // Nombre: el de la ficha; si no hay, el de la reserva más reciente.
    if (!p.nombre) { for (let i = p.reservas.length - 1; i >= 0; i--) { const n = (p.reservas[i].nombreLimpio || p.reservas[i].nombre || '').toString().trim(); if (n) { p.nombre = n; break; } } }
    if (!p.nombre) p.nombre = 'Sin nombre';
    if (!p.phone) { const r = [...p.reservas].reverse().find((x) => x.phone); if (r) p.phone = String(r.phone); }
    const act = sesiones.filter((s) => s.activa);
    const hechas = act.filter((s) => s.realizada && s.cuenta !== false);
    const fut = act.filter((s) => s.futura);
    const primera = (act[0] || sesiones[0] || null);
    // Incorporación: el registro de la ficha si es confiable (no posterior a su
    // primera aparición en agenda); si no, la primera aparición. Se informa el criterio.
    let incorporacion;
    if (p.registro && (!primera || p.registro <= primera.fecha)) incorporacion = { fecha: p.registro, mes: p.registro.slice(0, 7), criterio: 'registro' };
    else if (primera) incorporacion = { fecha: primera.fecha, mes: primera.fecha.slice(0, 7), criterio: 'primera_sesion', registroPosterior: !!p.registro };
    else incorporacion = { fecha: null, mes: null, criterio: 'sin_datos' };
    out.push({
      clave: p.clave, nombre: p.nombre, dni: p.dni, phone: p.phone, ficha: p.ficha, registro: p.registro,
      estadoFormal: p.estadoFormal, plan: p.plan, sesiones, incorporacion,
      primeraSesion: primera ? primera.fecha : null,
      ultimaSesion: hechas.length ? hechas[hechas.length - 1].fecha : null,
      proxima: fut.length ? fut[0] : null,
      mesesActivos: [...new Set(act.map((s) => s.fecha.slice(0, 7)))].sort(),
      nTotal: sesiones.length, nActivas: act.length, nRealizadas: hechas.length, nFuturas: fut.length, nCanceladas: sesiones.length - act.length,
      servicios: [...new Set(act.map((s) => s.servicio).filter(Boolean))],
      boxes: [...new Set(act.map((s) => s.box).filter(Boolean))],
      horarios: [...new Set(act.map((s) => s.hora).filter(Boolean))].sort(),
      notas: sesiones.filter((s) => s.nota).map((s) => ({ fecha: s.fecha, nota: s.nota })),
    });
  }
  return out.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

const delMes = (p, mes) => p.sesiones.filter((s) => s.fecha.slice(0, 7) === mes);

// Estado de agenda de un paciente en un mes. umbral = meses sin actividad a
// partir de los cuales ya no se asume "sin agendar" sino "en revisión".
export function estadoEnMes(p, mes, { umbral = 2 } = {}) {
  const enMes = delMes(p, mes);
  const act = enMes.filter((s) => s.activa);
  const canc = enMes.length - act.length;
  const base = { activas: act.length, canceladas: canc, soloCanceladas: !act.length && canc > 0 };
  if (p.estadoFormal && p.estadoFormal.estado === 'suspendido') return { ...base, estado: 'suspendido', motivo: `Suspensión registrada${p.estadoFormal.desde ? ' desde ' + fechaCorta(p.estadoFormal.desde) : ''}${p.estadoFormal.motivo ? ': ' + p.estadoFormal.motivo : ''}` };
  if (p.estadoFormal && p.estadoFormal.estado === 'finalizado') return { ...base, estado: 'finalizado', motivo: `Finalización registrada${p.estadoFormal.desde ? ' el ' + fechaCorta(p.estadoFormal.desde) : ''}` };
  if (act.length) {
    if (p.plan && p.plan.porMes && act.length < p.plan.porMes) return { ...base, estado: 'parcial', motivo: `${act.length} de ${p.plan.porMes} turnos previstos por mes` };
    return { ...base, estado: 'agendado', motivo: `${act.length} turno${act.length === 1 ? '' : 's'} en ${nombreMes(mes, false)}` };
  }
  if (p.plan && p.plan.vigenciaHasta && p.plan.vigenciaHasta < `${mes}-01`) return { ...base, estado: 'finalizado', motivo: `Su plan terminó el ${fechaCorta(p.plan.vigenciaHasta)}` };
  const previos = p.mesesActivos.filter((m) => m < mes);
  const posteriores = p.mesesActivos.filter((m) => m > mes);
  const sc = base.soloCanceladas ? ' Solo tiene turnos cancelados en el mes.' : '';
  if (!previos.length) {
    const inc = p.incorporacion.mes;
    if (inc && inc > mes) return { ...base, estado: 'posterior', motivo: `Se incorporó en ${nombreMes(inc)}` };
    if (!posteriores.length && !p.nActivas) {
      if (inc && difMeses(inc, mes) <= umbral) return { ...base, estado: 'sin_agendar', motivo: (p.ficha ? 'Registrado sin ningún turno.' : 'Sin turnos vigentes.') + sc };
      return { ...base, estado: 'en_revision', motivo: 'Registrado hace tiempo y nunca tuvo un turno vigente.' + sc };
    }
    if (posteriores.length && !base.soloCanceladas) return { ...base, estado: 'posterior', motivo: `Empieza en ${nombreMes(posteriores[0])}` };
    return { ...base, estado: 'sin_agendar', motivo: 'Sin turnos vigentes en el mes.' + sc };
  }
  const ult = previos[previos.length - 1];
  const gap = difMeses(ult, mes);
  if (gap <= umbral) return { ...base, estado: 'sin_agendar', motivo: `Última actividad en ${nombreMes(ult)}.` + sc };
  return { ...base, estado: 'en_revision', motivo: `Sin actividad desde ${nombreMes(ult)} (${gap} meses).` + (posteriores.length ? ` Vuelve en ${nombreMes(posteriores[0])}.` : '') + sc };
}

// Mes por defecto de referencia: los N meses anteriores al destino.
export const referenciaPorDefecto = (mesDestino, n = 2) => Array.from({ length: n }, (_, i) => sumarMeses(mesDestino, -(n - i)));

/**
 * Control de agenda de un mes de destino.
 *  pacientes   — salida de construirPacientes.
 *  mesDestino  — 'YYYY-MM'.
 *  referencia  — meses con los que se compara (por defecto, los 2 anteriores).
 */
export function controlAgenda(pacientes, { mesDestino, referencia, umbral = 2 } = {}) {
  const ref = (referencia && referencia.length ? [...referencia] : referenciaPorDefecto(mesDestino)).filter(esMes).filter((m) => m !== mesDestino).sort();
  const ventana = new Set([...ref, mesDestino]);
  const minRef = ref[0] || mesDestino;
  const filas = [];
  for (const p of pacientes) {
    const enVentana = p.mesesActivos.some((m) => ventana.has(m))
      || (p.incorporacion.mes && ventana.has(p.incorporacion.mes))
      || delMes(p, mesDestino).length > 0;
    if (!enVentana) continue;
    const e = estadoEnMes(p, mesDestino, { umbral });
    if (e.estado === 'posterior') continue;
    filas.push({ p, ...e, presente: Object.fromEntries([...ventana].map((m) => [m, p.mesesActivos.includes(m)])) });
  }
  const de = (fn) => filas.filter(fn);
  const pend = (f) => esPendiente(f.estado);
  const nuevosPorMes = {};
  [...ventana].sort().forEach((m) => { nuevosPorMes[m] = de((f) => f.p.incorporacion.mes === m); });
  const ausentesPorMes = {};
  ref.forEach((m) => { ausentesPorMes[m] = de((f) => f.presente[m] && !f.presente[mesDestino]); });
  const nuevosRefSinAgendar = {};
  ref.forEach((m) => { nuevosRefSinAgendar[m] = de((f) => f.p.incorporacion.mes === m && pend(f)); });
  const canceladasSinReprogramar = de((f) => {
    const canc = delMes(f.p, mesDestino).filter((s) => s.cancelada);
    if (!canc.length) return false;
    const ultimaCanc = canc[canc.length - 1].fecha;
    return !f.p.sesiones.some((s) => s.activa && s.fecha >= ultimaCanc);
  });
  const cats = {
    conTurnos: de((f) => f.estado === 'agendado' || f.estado === 'parcial'),
    agendados: de((f) => f.estado === 'agendado'),
    parciales: de((f) => f.estado === 'parcial'),
    sinAgendar: de((f) => f.estado === 'sin_agendar'),
    enRevision: de((f) => f.estado === 'en_revision'),
    suspendidos: de((f) => f.estado === 'suspendido'),
    finalizados: de((f) => f.estado === 'finalizado'),
    pendientes: de(pend),
    nuevosDestinoSinAgendar: de((f) => f.p.incorporacion.mes === mesDestino && pend(f)),
    anterioresSinTurnos: de((f) => f.p.incorporacion.mes && f.p.incorporacion.mes < minRef && pend(f)),
    registradosSinTurnos: pacientes.filter((p) => p.ficha && !p.nActivas).map((p) => ({ p, ...estadoEnMes(p, mesDestino, { umbral }) })),
    soloCanceladas: de((f) => f.soloCanceladas),
    canceladasSinReprogramar,
  };
  return {
    mesDestino, referencia: ref, umbral, filas, cats, nuevosPorMes, ausentesPorMes, nuevosRefSinAgendar,
    totales: {
      registrados: pacientes.filter((p) => p.ficha).length,
      unicos: filas.length,
      turnosDestino: filas.reduce((n, f) => n + f.activas, 0),
    },
  };
}

// Comparación de presencia entre meses (2 o más, cualquier año).
export function compararMeses(pacientes, meses) {
  const ms = [...new Set((meses || []).filter(esMes))].sort();
  const filas = pacientes.filter((p) => ms.some((m) => p.mesesActivos.includes(m)))
    .map((p) => ({ p, presente: Object.fromEntries(ms.map((m) => [m, p.mesesActivos.includes(m)])), sesiones: Object.fromEntries(ms.map((m) => [m, delMes(p, m).filter((s) => s.activa).length])) }));
  const ultimo = ms[ms.length - 1];
  const anteriores = ms.slice(0, -1);
  return {
    meses: ms, filas,
    enTodos: filas.filter((f) => ms.every((m) => f.presente[m])),
    soloEn: Object.fromEntries(ms.map((m) => [m, filas.filter((f) => f.presente[m] && ms.every((x) => x === m || !f.presente[x]))])),
    perdidos: filas.filter((f) => !f.presente[ultimo] && anteriores.some((m) => f.presente[m])),
    nuevosUltimo: filas.filter((f) => f.presente[ultimo] && !anteriores.some((m) => f.presente[m])),
    totales: Object.fromEntries(ms.map((m) => [m, { pacientes: filas.filter((f) => f.presente[m]).length, sesiones: filas.reduce((n, f) => n + f.sesiones[m], 0) }])),
  };
}

// ── Búsqueda y filtros combinables ──
export function textoBuscable(p) {
  const partes = [p.nombre, p.dni, (p.phone || '').replace(/\D/g, ''), ...p.servicios, ...p.boxes, ...p.horarios,
    ...p.notas.map((n) => n.nota), p.incorporacion.mes ? nombreMes(p.incorporacion.mes) : '', ...p.mesesActivos.map((m) => nombreMes(m)),
    p.estadoFormal ? ESTADOS_FORMALES[p.estadoFormal.estado] : ''];
  p.sesiones.forEach((s) => { partes.push(s.fecha, fechaCorta(s.fecha), fechaCorta(s.fecha).slice(0, 5)); });
  return normalizar(partes.filter(Boolean).join(' | '));
}
export function coincideTexto(p, q, cache) {
  const t = normalizar(q);
  if (!t) return true;
  let h = cache && cache.get(p.clave);
  if (h == null) { h = textoBuscable(p); if (cache) cache.set(p.clave, h); }
  const qDig = t.replace(/\D/g, '');
  return t.split(' ').every((tok) => h.includes(tok)) || (qDig.length >= 5 && h.replace(/\D/g, ' ').includes(qDig));
}

// ¿La sesión cae en el período? periodo: { meses:[] } | { desde, hasta } | {} (todo).
export function enPeriodo(fecha, periodo = {}) {
  if (!fecha) return false;
  if (periodo.meses && periodo.meses.length) return periodo.meses.includes(fecha.slice(0, 7));
  if (periodo.desde && fecha < periodo.desde) return false;
  if (periodo.hasta && fecha > periodo.hasta) return false;
  return true;
}
const periodoVacio = (per) => !per || (!(per.meses && per.meses.length) && !per.desde && !per.hasta);
export function mesesDelPeriodo(per, todosLosMeses) {
  if (!per) return [];
  if (per.meses && per.meses.length) return [...per.meses].sort();
  if (per.desde || per.hasta) return todosLosMeses.filter((m) => (!per.desde || m >= per.desde.slice(0, 7)) && (!per.hasta || m <= per.hasta.slice(0, 7)));
  return [];
}

// Retomó: tuvo un hueco de al menos `dias` entre dos sesiones realizadas/vigentes consecutivas.
export function retomo(p, dias = 45) {
  const f = p.sesiones.filter((s) => s.activa).map((s) => s.fecha);
  for (let i = 1; i < f.length; i++) if (diasEntre(f[i - 1], f[i]) >= dias) return { desde: f[i - 1], hasta: f[i] };
  return null;
}
export function cancelacionSinReprogramar(p, per) {
  const canc = p.sesiones.filter((s) => s.cancelada && (!per || enPeriodo(s.fecha, per)));
  if (!canc.length) return false;
  const ult = canc[canc.length - 1].fecha;
  return !p.sesiones.some((s) => s.activa && s.fecha >= ult);
}

/**
 * f: {
 *  texto, periodo,                     — período: el paciente debe tener sesiones (o turnos) en él
 *  nuevosEn:[YYYY-MM], presentesEn:[], ausentesEn:[],
 *  estadoMes:{ mes, estados:[] }, umbral,
 *  sinSesionesDias, sinFuturos, conFuturos, canceladasSinReprog, retomaron, diasRetomo,
 *  servicio, box, estadoFormal ('suspendido'|'finalizado'|'activo'|'ninguno'),
 *  deDuplicacion, minRealizadas, maxRealizadas, soloFichasSinTurnos, ordenar
 * }
 */
export function filtrarPacientes(pacientes, f = {}, ctx = {}) {
  const hoy = ctx.hoy;
  const per = f.periodo || {};
  const cache = ctx.cache;
  const out = [];
  for (const p of pacientes) {
    if (f.texto && !coincideTexto(p, f.texto, cache)) continue;
    const sesPer = periodoVacio(per) ? p.sesiones : p.sesiones.filter((s) => enPeriodo(s.fecha, per));
    if (!periodoVacio(per) && !sesPer.length && !(p.incorporacion.fecha && enPeriodo(p.incorporacion.fecha, per))) continue;
    if (f.nuevosEn && f.nuevosEn.length && !f.nuevosEn.includes(p.incorporacion.mes)) continue;
    if (f.presentesEn && f.presentesEn.length && !f.presentesEn.every((m) => p.mesesActivos.includes(m))) continue;
    if (f.ausentesEn && f.ausentesEn.length && f.ausentesEn.some((m) => p.mesesActivos.includes(m))) continue;
    let est = null;
    if (f.estadoMes && esMes(f.estadoMes.mes)) {
      est = estadoEnMes(p, f.estadoMes.mes, { umbral: f.umbral || 2 });
      if (f.estadoMes.estados && f.estadoMes.estados.length && !f.estadoMes.estados.includes(est.estado)) continue;
    }
    if (f.sinSesionesDias > 0) {
      const ref = p.ultimaSesion;
      if (p.nFuturas && !f.contarConFuturos) continue;
      if (ref && diasEntre(ref, hoy) < f.sinSesionesDias) continue;
      if (!ref && !p.nActivas && !p.ficha) continue;
    }
    if (f.sinFuturos && p.nFuturas) continue;
    if (f.conFuturos && !p.nFuturas) continue;
    if (f.canceladasSinReprog && !cancelacionSinReprogramar(p, periodoVacio(per) ? null : per)) continue;
    if (f.retomaron && !retomo(p, f.diasRetomo || 45)) continue;
    if (f.servicio && !sesPer.some((s) => s.activa && s.servicio === f.servicio)) continue;
    if (f.box && !sesPer.some((s) => s.activa && s.box === f.box)) continue;
    if (f.estadoFormal) {
      const ef = p.estadoFormal ? p.estadoFormal.estado : 'ninguno';
      if (ef !== f.estadoFormal) continue;
    }
    if (f.deDuplicacion && !sesPer.some((s) => s.duplicada)) continue;
    const realizadasPer = sesPer.filter((s) => s.realizada).length;
    if (f.minRealizadas != null && f.minRealizadas !== '' && realizadasPer < Number(f.minRealizadas)) continue;
    if (f.maxRealizadas != null && f.maxRealizadas !== '' && realizadasPer > Number(f.maxRealizadas)) continue;
    if (f.soloFichasSinTurnos && (!p.ficha || p.nActivas)) continue;
    out.push({
      p, est,
      enPeriodo: {
        programadas: sesPer.filter((s) => s.activa).length,
        realizadas: realizadasPer,
        futuras: sesPer.filter((s) => s.futura).length,
        canceladas: sesPer.filter((s) => s.cancelada).length,
        porBox: sesPer.filter((s) => s.activa).reduce((acc, s) => { const b = s.box || 'Sin box'; acc[b] = (acc[b] || 0) + 1; return acc; }, {}),
      },
    });
  }
  return ordenarFilas(out, f.ordenar || 'nombre');
}

export const ORDENES = { nombre: 'Nombre', incorporacion: 'Fecha de incorporación', ultima: 'Última sesión', sesiones: 'Cantidad de sesiones', estado: 'Estado' };
const ORDEN_ESTADO = ['sin_agendar', 'en_revision', 'parcial', 'agendado', 'suspendido', 'finalizado', 'posterior'];
export function ordenarFilas(filas, criterio = 'nombre') {
  const porNombre = (a, b) => a.p.nombre.localeCompare(b.p.nombre, 'es');
  const cmp = {
    nombre: porNombre,
    incorporacion: (a, b) => (b.p.incorporacion.fecha || '').localeCompare(a.p.incorporacion.fecha || '') || porNombre(a, b),
    ultima: (a, b) => (b.p.ultimaSesion || '').localeCompare(a.p.ultimaSesion || '') || porNombre(a, b),
    sesiones: (a, b) => ((b.enPeriodo ? b.enPeriodo.realizadas : b.p.nRealizadas) - (a.enPeriodo ? a.enPeriodo.realizadas : a.p.nRealizadas)) || porNombre(a, b),
    estado: (a, b) => (ORDEN_ESTADO.indexOf(a.est ? a.est.estado : (a.estado || '')) - ORDEN_ESTADO.indexOf(b.est ? b.est.estado : (b.estado || ''))) || porNombre(a, b),
  }[criterio] || porNombre;
  return [...filas].sort(cmp);
}

// Indicadores de un listado ya filtrado.
export function estadisticas(filas, { mes, hoy, diasSinContinuidad = 30, duplicados = 0 } = {}) {
  const st = { unicos: filas.length, nuevos: 0, conTurnos: 0, sinAgendar: 0, suspendidos: 0, sinContinuidad: 0, programadas: 0, realizadas: 0, canceladas: 0, pendientes: 0, duplicados };
  for (const f of filas) {
    const p = f.p, ep = f.enPeriodo || { programadas: p.nActivas, realizadas: p.nRealizadas, futuras: p.nFuturas, canceladas: p.nCanceladas };
    if (mes && p.incorporacion.mes === mes) st.nuevos++;
    if (p.nFuturas) st.conTurnos++;
    const e = f.est || (mes ? estadoEnMes(p, mes) : null);
    if (e && e.estado === 'sin_agendar') st.sinAgendar++;
    if (p.estadoFormal && p.estadoFormal.estado === 'suspendido') st.suspendidos++;
    if (!p.nFuturas && p.ultimaSesion && hoy && diasEntre(p.ultimaSesion, hoy) >= diasSinContinuidad) st.sinContinuidad++;
    st.programadas += ep.programadas; st.realizadas += ep.realizadas; st.canceladas += ep.canceladas; st.pendientes += ep.futuras;
  }
  return st;
}

// ── Posibles duplicados ──
const tokensNombre = (n) => normalizar(n).replace(/[^a-z0-9ñ ]/g, ' ').split(' ').filter((t) => t.length > 1);
export const claveNombreOrden = (n) => { const t = tokensNombre(n); return t.length >= 2 ? [...t].sort().join(' ') : ''; };
/**
 * Detecta fichas o identidades que podrían ser la misma persona. Nunca fusiona.
 *  fichas    — [{ dni, fullName, phone }]
 *  pacientes — salida de construirPacientes (identidades vistas en reservas).
 * Devuelve [{ tipo, motivos:[], miembros:[{ clave, nombre, dni, phone, ficha, sesiones }] }]
 */
export function posiblesDuplicados(fichas, pacientes) {
  const porClave = new Map(pacientes.map((p) => [p.clave, p]));
  const items = [];
  const vistos = new Set();
  const add = (clave, nombre, dni, phone, ficha) => {
    if (vistos.has(clave)) return; vistos.add(clave);
    const p = porClave.get(clave);
    items.push({ clave, nombre: nombre || (p && p.nombre) || '', dni: dni || '', phone: phone || (p && p.phone) || '', ficha, sesiones: p ? p.nActivas : 0 });
  };
  // Cada ficha es un registro propio (su id tal cual: "12.345.678" y "12345678"
  // son dos fichas). La identidad de agenda de una ficha no se agrega aparte.
  const cubiertas = new Set();
  (fichas || []).forEach((f) => {
    const claveP = f._clave || ('dni:' + f.dni);
    const p = porClave.get(claveP);
    const k = 'ficha:' + f.dni;
    if (vistos.has(k)) return; vistos.add(k);
    items.push({ clave: k, clavePaciente: claveP, nombre: f.fullName || (p && p.nombre) || '', dni: String(f.dni || ''), phone: f.phone || '', ficha: true, sesiones: p && !cubiertas.has(claveP) ? p.nActivas : 0 });
    cubiertas.add(claveP);
  });
  pacientes.forEach((p) => { if (!cubiertas.has(p.clave)) add(p.clave, p.nombre, p.dni, p.phone, false); });
  const padre = items.map((_, i) => i);
  const raiz = (i) => (padre[i] === i ? i : (padre[i] = raiz(padre[i])));
  const motivos = new Map();
  const unir = (i, j, m) => { const a = raiz(i), b = raiz(j); if (a !== b) padre[b] = a; const k = Math.min(i, j) + '|' + Math.max(i, j); if (!motivos.has(k)) motivos.set(k, new Set()); motivos.get(k).add(m); };
  const indexar = (fn, m) => { const v = new Map(); items.forEach((it, i) => { const k = fn(it); if (!k) return; if (v.has(k)) unir(v.get(k), i, m); else v.set(k, i); }); };
  indexar((it) => { const d = String(it.dni || '').replace(/\D/g, ''); return d.length >= 6 ? d : ''; }, 'mismo DNI');
  indexar((it) => claveNombreOrden(it.nombre), 'mismo nombre y apellido');
  indexar((it) => { const d = String(it.phone || '').replace(/\D/g, ''); return d.length >= 8 ? d.slice(-8) : ''; }, 'mismo teléfono');
  const grupos = new Map();
  items.forEach((it, i) => { const r = raiz(i); if (!grupos.has(r)) grupos.set(r, { miembros: [], motivos: new Set() }); grupos.get(r).miembros.push(it); });
  motivos.forEach((m, k) => { const r = raiz(Number(k.split('|')[0])); m.forEach((x) => grupos.get(r).motivos.add(x)); });
  return [...grupos.values()].filter((g) => g.miembros.length > 1).map((g) => {
    const conFicha = g.miembros.filter((m) => m.ficha).length;
    const sinDni = g.miembros.some((m) => (m.clavePaciente || m.clave).startsWith('nom:'));
    const tipo = conFicha >= 2 ? 'Dos o más fichas que podrían ser la misma persona'
      : sinDni ? 'Turnos cargados sin DNI que podrían ser de esta persona'
        : 'Identidades distintas en la agenda con datos coincidentes';
    return { tipo, motivos: [...g.motivos], miembros: g.miembros.sort((a, b) => b.sesiones - a.sesiones) };
  }).sort((a, b) => a.miembros[0].nombre.localeCompare(b.miembros[0].nombre, 'es'));
}

// ── Resumen de una duplicación de mes (lote guardado en duplicacionesMes) ──
const MOTIVO_BLOQUEO = new Set(['cierre_dia', 'bloqueo_estetica', 'bloqueo_box', 'bloqueo_depilacion_protegido', 'fuera_horario']);
const MOTIVO_CONFLICTO = new Set(['box_ocupado', 'paciente_ocupado', 'box_incompatible']);
export function resumenDuplicacion(lote, pacientes, { pendientes = [], nombreDe = () => '', umbral = 2 } = {}) {
  const ymDe = (x) => (x && x.anio ? `${x.anio}-${String(x.mes).padStart(2, '0')}` : '');
  const origen = ymDe(lote.origen), destino = ymDe(lote.destino);
  const aCrear = lote.aCrear || [], aPend = lote.aPendiente || [], res = lote.resultado || {};
  const creadas = new Set(res.creadas || []), yaEx = new Set(res.yaExistian || []);
  const dnis = (arr) => [...new Set(arr.map((x) => String(x.dni || '')).filter(Boolean))];
  const nombre = (dni) => nombreDe(dni) || dni;
  const porDni = (arr) => { const m = new Map(); arr.forEach((x) => { const d = String(x.dni || ''); if (!m.has(d)) m.set(d, []); m.get(d).push(x); }); return [...m.entries()].map(([dni, l]) => ({ dni, nombre: nombre(dni), items: l })); };
  const ctrl = controlAgenda(pacientes, { mesDestino: destino, referencia: rangoMeses(origen < destino ? origen : sumarMeses(destino, -2), sumarMeses(destino, -1)), umbral });
  const posteriores = ctrl.filas.filter((f) => f.p.incorporacion.mes && f.p.incorporacion.mes > origen && f.p.incorporacion.mes <= destino && !f.presente[destino] && esPendiente(f.estado));
  const pendLote = (pendientes || []).filter((p) => p.mesDestino === destino && (p.estado === 'pendiente' || p.estado === 'pendiente_consultar'));
  return {
    loteId: lote.loteId || lote.id, origen, destino, estado: lote.estado || '', fecha: lote.fecha || '', administrador: lote.administrador || '',
    pacientesCopiados: dnis(aCrear.filter((x) => creadas.has(x.id) || (!res.creadas && true))).map((d) => ({ dni: d, nombre: nombre(d) })),
    turnosCreados: res.creadas ? res.creadas.length : null,
    yaExistian: yaEx.size, pacientesYaEnDestino: dnis(aCrear.filter((x) => yaEx.has(x.id))).map((d) => ({ dni: d, nombre: nombre(d) })),
    noIncorporados: porDni(aPend),
    conflictos: porDni(aPend.filter((x) => (x.motivos || []).some((m) => MOTIVO_CONFLICTO.has(m)))),
    porBloqueos: porDni(aPend.filter((x) => (x.motivos || []).some((m) => MOTIVO_BLOQUEO.has(m)))),
    errores: res.errores || [],
    pendientesRevision: pendLote,
    posterioresSinTurno: posteriores,
    sinAgendar: ctrl.cats.pendientes,
    control: ctrl,
  };
}

// ── Exportación ──
// columnas: [{ id, titulo, valor(fila) }]
export function aCSV(columnas, filas, sep = ';') {
  const esc = (v) => { const s = (v ?? '').toString(); return /["\n\r;,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + [columnas.map((c) => esc(c.titulo)).join(sep), ...filas.map((f) => columnas.map((c) => esc(c.valor(f))).join(sep))].join('\r\n');
}
export const ESTADO_TXT = (e) => (ESTADOS[e] ? ESTADOS[e].txt : e || '');
export function criterioIncorporacion(inc) {
  if (!inc || inc.criterio === 'sin_datos') return 'sin datos';
  return inc.criterio === 'registro' ? 'fecha de registro de la ficha' : 'primera aparición en agenda';
}

// ── Control de cantidades entre meses ──
// La idea: cada paciente tiene que tener la MISMA cantidad de sesiones en todos
// los meses que se comparan. Se toma un mes base (por defecto el primero) y en
// cada otro mes se marca la diferencia: faltan (rojo) o sobran (de más).
// Se cuentan las sesiones vigentes del mes (realizadas + agendadas; las
// canceladas no cuentan).
//  → { meses, base, filas:[{ p, conteos:{mes:n}, difs:{mes:d}, estado }], resumen }
export function compararCantidades(pacientes, meses, { base } = {}) {
  const ms = [...new Set((meses || []).filter(esMes))].sort();
  const b = ms.includes(base) ? base : ms[0];
  const otros = ms.filter((m) => m !== b);
  const filas = [];
  for (const p of pacientes) {
    const conteos = Object.fromEntries(ms.map((m) => [m, p.sesiones.filter((s) => s.activa && s.cuenta !== false && s.fecha.slice(0, 7) === m).length]));
    if (!ms.some((m) => conteos[m] > 0)) continue;
    const difs = Object.fromEntries(otros.map((m) => [m, conteos[m] - conteos[b]]));
    const vals = Object.values(difs);
    const estado = conteos[b] === 0 ? 'nuevo' : vals.some((d) => d < 0) ? (vals.some((d) => d > 0) ? 'mixto' : 'faltan') : vals.some((d) => d > 0) ? 'sobran' : 'igual';
    filas.push({ p, conteos, difs, estado });
  }
  const orden = { faltan: 0, mixto: 1, sobran: 2, nuevo: 3, igual: 4 };
  filas.sort((x, y) => (orden[x.estado] - orden[y.estado]) || x.p.nombre.localeCompare(y.p.nombre, 'es'));
  const resumen = { iguales: 0, conFaltantes: 0, conSobrantes: 0, nuevos: 0, sesionesFaltantes: 0, sesionesSobrantes: 0 };
  filas.forEach((f) => {
    if (f.estado === 'igual') resumen.iguales++;
    if (f.estado === 'nuevo') resumen.nuevos++;
    if (f.estado === 'faltan' || f.estado === 'mixto') resumen.conFaltantes++;
    if (f.estado === 'sobran' || f.estado === 'mixto') resumen.conSobrantes++;
    if (f.estado !== 'nuevo') Object.values(f.difs).forEach((d) => { if (d < 0) resumen.sesionesFaltantes -= d; if (d > 0) resumen.sesionesSobrantes += d; });
  });
  return { meses: ms, base: b, otros, filas, resumen };
}
// Texto corto de una diferencia: "falta 1", "faltan 2", "1 de más".
export const textoDif = (d) => (d === 0 ? 'igual' : d < 0 ? (d === -1 ? 'falta 1' : `faltan ${-d}`) : `${d} de más`);
