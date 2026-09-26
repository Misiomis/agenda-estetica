// Duplicar mes — motor puro (sin DOM ni Firestore).
//
// Prepara, a partir de las reservas de un mes de origen, las ocurrencias de un
// mes de destino: conserva el día de la semana, la hora, el tratamiento, la
// duración y el box; las valida contra bloqueos, reservas existentes y
// preferencias del paciente; y explica cada reserva de origen. No escribe nada:
// el guardado real lo hace la capa de la página con la misma validación
// (evaluarOcurrencia) sobre datos recién leídos.
//
// Reglas que este módulo hace cumplir:
//  · Las fechas se calculan con aritmética de fechas (año-mes-día), nunca sumando
//    un número fijo de días a cada reserva ni convirtiendo a UTC una hora local.
//  · Los bloqueos prevalecen: cierre del día, bloqueo de estética, bloqueo de un
//    box y el bloqueo PROTEGIDO de depilación del box 2 no admiten excepción.
//  · Nunca se cambia día, hora o box en silencio: un turno que no entra en su
//    lugar habitual queda como pendiente con sus motivos y alternativas.
//  · Disponibilidad ≠ pauta: tres días disponibles no son tres sesiones.
//  · Una frecuencia ambigua ("cada 15 días") no se convierte sola en otra regla.

export const BOX_DEPILACION = 'b2';
export const PASO_MIN = 15;

// ── Fechas y horas ────────────────────────────────────────────────────────
const FECHA_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export function fechaValida(f) {
  const m = FECHA_RE.exec(String(f || ''));
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}
const aDias = (f) => { const m = FECHA_RE.exec(f); return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000); };
const deDias = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
export const sumarDias = (f, n) => deDias(aDias(f) + n);
export const diaSemana = (f) => new Date(aDias(f) * 86400000).getUTCDay(); // 0 domingo … 6 sábado
export const diferenciaDias = (a, b) => aDias(b) - aDias(a);
export const mesDe = (f) => f.slice(0, 7);
export function diasDelMes(anio, mes) {
  const out = [];
  const total = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  for (let d = 1; d <= total; d++) out.push(`${anio}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  return out;
}
export const inicioSemana = (f) => sumarDias(f, -((diaSemana(f) + 6) % 7)); // lunes
export const ordinalEnMes = (f) => Math.ceil(+f.slice(8, 10) / 7);
export function nesimoDiaSemana(anio, mes, dow, n) {
  const dias = diasDelMes(anio, mes).filter((f) => diaSemana(f) === dow);
  if (n === 'ultimo') return dias[dias.length - 1] || null;
  return dias[n - 1] || null;
}
export const DIAS_NOMBRE = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export function fechaLarga(f) { return `${DIAS_NOMBRE[diaSemana(f)]} ${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`; }
const HORA_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
export const horaAMin = (h) => { const m = HORA_RE.exec(String(h || '').trim()); return m ? +m[1] * 60 + +m[2] : null; };
export const minAHora = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
export const normHora = (h) => { const n = horaAMin(h); return n == null ? '' : minAHora(n); };

// ── Servicios, boxes y horario ────────────────────────────────────────────
export function categoriaServicio(nombre, info) {
  if (info && info.categoria) return info.categoria;
  const s = String(nombre || '').toLowerCase();
  if (/facial|fraxis|dermapen|peeling/.test(s)) return 'facial';
  if (/relax|masaj|relajante|drenaje/.test(s)) return 'relax';
  return 'corporal';
}
// Misma regla que la grilla: comercial 08:00–13:00 y 14:00–20:45.
export function horaBloqueadaPorDefecto(hora) {
  return !((hora >= '08:00' && hora <= '13:00') || (hora >= '14:00' && hora <= '20:45'));
}

// ── Bloqueos ──────────────────────────────────────────────────────────────
// Normaliza documentos crudos de calendarExceptions (con .id) a una lista de
// bloqueos y una lista de desbloqueos. Solo mira lo que bloquea agenda de
// boxes; los documentos generados por las propias reservas (tipo reserva /
// extension) se ignoran: ya son las reservas.
const esProtegido = (d) => d.protegido === true || String(d.tipo || d.type || '').toLowerCase() === 'depilacion'
  || /depil/i.test(String(d.motivo || d.reason || d.nota || ''));
export function normalizarBloqueos(docs) {
  const bloqueos = [];
  const desbloqueos = [];
  (docs || []).forEach((raw) => {
    const d = raw || {};
    if (d.active === false) return;
    const tipoDoc = String(d.tipo || '').toLowerCase();
    if (tipoDoc === 'reserva' || tipoDoc === 'extension' || tipoDoc === 'habilitado_consulta' || tipoDoc === 'bloq_consulta') return;
    const fecha = fechaValida(d.fecha) ? d.fecha : (fechaValida(d.id) ? d.id : '');
    if (!fecha) return;
    const hora = normHora(d.hora || d.hour || d.time || '');
    const motivo = String(d.motivo || d.reason || '').trim();
    if (d.source === 'admin_unblock') { if (hora && d.boxId) desbloqueos.push({ fecha, hora, boxId: d.boxId }); return; }
    const esBloqueo = d.blocked === true || String(d.type || '').toLowerCase() === 'blocked' || d.adminBlocked === true || d.source === 'admin';
    if (!esBloqueo) return;
    const prot = esProtegido(d) && (!d.boxId || d.boxId === BOX_DEPILACION);
    // intervalo explícito (bloqueo parcial o recurrente ya expandido a fechas)
    const desdeI = horaAMin(d.desde), hastaI = horaAMin(d.hasta);
    if (d.boxId && desdeI != null && hastaI != null && hastaI > desdeI) {
      bloqueos.push({ id: d.id, tipo: 'box', fecha, boxId: d.boxId, desde: desdeI, hasta: hastaI, motivo, protegido: prot });
      return;
    }
    if (!hora) { bloqueos.push({ id: d.id, tipo: 'cierre_dia', fecha, desde: 0, hasta: 1440, boxId: null, motivo: motivo || 'Día no disponible', protegido: false }); return; }
    const ini = horaAMin(hora);
    if (d.boxId) bloqueos.push({ id: d.id, tipo: 'box', fecha, boxId: d.boxId, desde: ini, hasta: ini + PASO_MIN, motivo, protegido: prot });
    else bloqueos.push({ id: d.id, tipo: 'estetica', fecha, boxId: null, desde: ini, hasta: ini + (Number(d.duracionMin) > 0 ? Number(d.duracionMin) : 30), motivo, protegido: false });
  });
  return { bloqueos, desbloqueos };
}

// ── Ocupación y validación de una ocurrencia ──────────────────────────────
const solapa = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;
export const CODIGOS_DUROS = ['cierre_dia', 'bloqueo_estetica', 'bloqueo_box', 'bloqueo_depilacion_protegido', 'box_ocupado', 'paciente_ocupado', 'box_incompatible', 'fuera_horario'];
export const CODIGOS_EXCEPCIONABLES = ['indisponible', 'ausente'];

export function ocupacionDesdeReservas(reservas, { esActiva, boxDe, duracionDe }) {
  return (reservas || []).filter((r) => esActiva(r) && fechaValida(r.fecha) && horaAMin(r.hora) != null).map((r) => ({
    id: r.id, fecha: r.fecha, ini: horaAMin(r.hora), dur: duracionDe(r), boxId: boxDe(r), dni: String(r.dni || '').trim(),
    nombre: r.nombreLimpio || r.nombre || r.cliente || '', servicio: r.servicio || '',
  }));
}

// occ: { fecha, hora, dur, boxId, dni, servicio, categoria, ignorarId?, autoriza? }
// ctx: { ocupacion, bloqueos, desbloqueos, servicios, pacientes }
export function evaluarOcurrencia(ctx, occ) {
  const motivos = [];
  const advertencias = [];
  const ini = horaAMin(occ.hora);
  const dur = occ.dur > 0 ? occ.dur : 30;
  if (ini == null || !fechaValida(occ.fecha)) return { motivos: [{ codigo: 'dato_invalido', texto: 'Fecha u hora inválidas.' }], advertencias, duro: true };
  const fin = ini + dur;
  const add = (codigo, texto, extra = {}) => motivos.push({ codigo, texto, ...extra });

  // bloqueos
  (ctx.bloqueos || []).filter((b) => b.fecha === occ.fecha).forEach((b) => {
    if (b.tipo === 'cierre_dia') { add('cierre_dia', `Estética cerrada: ${b.motivo}.`, { bloqueoId: b.id }); return; }
    if (!solapa(ini, fin, b.desde, b.hasta)) return;
    const rango = `${minAHora(b.desde)}–${minAHora(b.hasta)}`;
    if (b.tipo === 'estetica') add('bloqueo_estetica', `Estética bloqueada ${rango}${b.motivo ? ` (${b.motivo})` : ''}.`, { bloqueoId: b.id });
    else if (b.tipo === 'box' && b.boxId === occ.boxId) {
      if (b.protegido) add('bloqueo_depilacion_protegido', `${boxNombre(ctx, b.boxId)} bloqueado por depilación ${rango}${b.motivo ? ` (${b.motivo})` : ''}. Bloqueo protegido: no se puede desbloquear ni ignorar.`, { bloqueoId: b.id, protegido: true });
      else add('bloqueo_box', `${boxNombre(ctx, b.boxId)} bloqueado ${rango}${b.motivo ? ` (${b.motivo})` : ''}.`, { bloqueoId: b.id });
    }
  });
  // horario comercial por defecto (con desbloqueos explícitos del administrador)
  let fuera = false;
  for (let m = ini; m < fin; m += PASO_MIN) {
    const h = minAHora(m);
    if (horaBloqueadaPorDefecto(h) && !(ctx.desbloqueos || []).some((u) => u.fecha === occ.fecha && u.hora === h && u.boxId === occ.boxId)) { fuera = true; break; }
  }
  if (fuera) add('fuera_horario', 'Parte de la sesión cae fuera del horario habitual de la estética.');

  // ocupación
  (ctx.ocupacion || []).forEach((o) => {
    if (o.fecha !== occ.fecha || (occ.ignorarId && o.id === occ.ignorarId)) return;
    if (!solapa(ini, fin, o.ini, o.ini + o.dur)) return;
    if (o.boxId === occ.boxId) add('box_ocupado', `${boxNombre(ctx, occ.boxId)} ocupado ${minAHora(o.ini)}–${minAHora(o.ini + o.dur)}${o.nombre ? ` (${o.nombre})` : ''}.`, { reservaId: o.id });
    if (occ.dni && o.dni === occ.dni) add('paciente_ocupado', `La paciente ya tiene otro turno ${minAHora(o.ini)}–${minAHora(o.ini + o.dur)}.`, { reservaId: o.id });
  });

  // compatibilidad servicio ↔ box
  const info = (ctx.servicios || {})[occ.servicio];
  if (info && Array.isArray(info.boxes) && info.boxes.length && !info.boxes.includes(occ.boxId)) {
    add('box_incompatible', `${occ.servicio} no se realiza en ${boxNombre(ctx, occ.boxId)}.`);
  }

  // preferencias y restricciones del paciente
  const pac = (ctx.pacientes || {})[occ.dni];
  const dow = diaSemana(occ.fecha);
  const NOMBRES = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  if (pac && pac.planificacion) {
    const pl = pac.planificacion;
    const pref = pl.preferencias || {};
    if ((pref.diasNoDisponibles || []).includes(NOMBRES[dow])) {
      if (!(occ.autoriza && occ.autoriza.indisponible)) add('indisponible', `La paciente indicó que no puede los ${DIAS_NOMBRE[dow]}s.`);
    }
    (pref.ausencias || []).forEach((a) => {
      if (fechaValida(a.desde) && fechaValida(a.hasta) && occ.fecha >= a.desde && occ.fecha <= a.hasta && !(occ.autoriza && occ.autoriza.ausente)) {
        add('ausente', `La paciente figura ausente del ${a.desde.split('-').reverse().join('/')} al ${a.hasta.split('-').reverse().join('/')}${a.nota ? ` (${a.nota})` : ''}.`);
      }
    });
    const disp = pl.disponibilidad;
    if (disp && disp.modo === 'estricta' && disp.dias && Object.keys(disp.dias).length) {
      const lista = disp.dias[NOMBRES[dow]];
      const dentro = Array.isArray(lista) && lista.some((i) => horaAMin(i.desde) != null && horaAMin(i.hasta) != null && ini >= horaAMin(i.desde) && fin <= horaAMin(i.hasta));
      if (!dentro && !(occ.autoriza && occ.autoriza.indisponible)) add('indisponible', 'Solo puede en los días y horarios que indicó, y este turno queda fuera.');
    }
    // preferencias flexibles: solo advierten
    const trat = (pref.tratamientos || []).find((t) => t.tratamiento === occ.categoria);
    const franjas = [...((trat && trat.franjas) || []), ...(pref.franjasGenerales || [])].filter((f) => (f.dias || []).length || f.desde || f.hasta);
    if (franjas.length) {
      const encaja = franjas.some((f) => (!(f.dias || []).length || f.dias.includes(NOMBRES[dow])) && (horaAMin(f.desde) == null || ini >= horaAMin(f.desde)) && (horaAMin(f.hasta) == null || fin <= horaAMin(f.hasta)));
      if (!encaja) advertencias.push({ codigo: 'fuera_preferencia', texto: 'Queda fuera de los días u horarios que prefiere (es una preferencia, no una restricción).' });
    }
  }
  const duro = motivos.some((m) => CODIGOS_DUROS.includes(m.codigo) || m.codigo === 'dato_invalido');
  return { motivos, advertencias, duro };
}
function boxNombre(ctx, id) { const b = (ctx.boxes || []).find((x) => x.id === id); return b ? (b.label || b.id) : id; }

// ── Frecuencias ───────────────────────────────────────────────────────────
const ORD = { primer: 1, primero: 1, segundo: 2, tercer: 3, tercero: 3, cuarto: 4, ultimo: 'ultimo', último: 'ultimo' };
const DOW_TXT = { lunes: 1, martes: 2, miercoles: 3, miércoles: 3, jueves: 4, viernes: 5, sabado: 6, sábado: 6, domingo: 0 };
export function parsearNesimo(texto) {
  const m = /(primer[o]?|segund[o]|tercer[o]?|cuart[o]|[uú]ltim[o])\s+(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)/i.exec(String(texto || ''));
  if (!m) return null;
  const k = m[1].toLowerCase().replace('segundo', 'segundo').replace('cuarto', 'cuarto');
  const ord = k.startsWith('primer') ? 1 : k.startsWith('segund') ? 2 : k.startsWith('tercer') ? 3 : k.startsWith('cuart') ? 4 : 'ultimo';
  return { n: ord, dow: DOW_TXT[m[2].toLowerCase()] };
}
const entero = (v) => { const n = parseInt(String(v == null ? '' : v).trim(), 10); return Number.isFinite(n) && n > 0 ? n : null; };

// Devuelve la frecuencia efectiva para (paciente, categoría). No inventa: si no
// hay dato, tipo 'ninguna'.
export function frecuenciaDe(paciente, categoria, { unicaCategoria }) {
  const pl = (paciente && paciente.planificacion) || {};
  const pref = pl.preferencias || {};
  const trat = (pref.tratamientos || []).find((t) => t.tratamiento === categoria);
  const desdeFrec = (f, fuente) => {
    if (!f) return null;
    const texto = String(f.texto || '').trim();
    const nes = parsearNesimo(texto);
    if (nes) return { tipo: 'nesimo', ...nes, texto, fuente };
    if (entero(f.cadaDias)) return { tipo: 'cada_n_dias', n: entero(f.cadaDias), texto: texto || `cada ${f.cadaDias} días`, fuente };
    if (entero(f.cantidad) && f.periodo === 'semana') return { tipo: 'semanal', n: entero(f.cantidad), texto: texto || `${f.cantidad} por semana`, fuente };
    if (entero(f.cantidad) && f.periodo === 'mes') return entero(f.cantidad) === 1 ? { tipo: 'mensual', n: 1, texto: texto || '1 por mes', fuente } : { tipo: 'n_por_mes', n: entero(f.cantidad), texto: texto || `${f.cantidad} por mes`, fuente };
    if (texto) return { tipo: 'ambigua', texto, fuente };
    return null;
  };
  let f = trat ? desdeFrec(trat.frecuencia, 'preferencias') : null;
  let capTotalSemana = null;
  if (pref.frecuenciaTotal) {
    const t = desdeFrec(pref.frecuenciaTotal, 'preferencias (frecuencia total)');
    if (t && t.tipo === 'semanal') capTotalSemana = t.n;
    if (!f && t && unicaCategoria) f = t;
  }
  // modelo anterior: máximo semanal y objetivo mensual
  const leg = pl.frecuencia || {};
  const legMax = entero(leg.maximoSemana);
  if (!capTotalSemana && legMax) capTotalSemana = legMax;
  const legTotalMes = leg.alcance === 'mes' ? entero(leg.totalPrevisto) : null;
  const legHab = entero(leg.habitualSemana);
  if (!f && legHab && unicaCategoria) f = { tipo: 'semanal', n: legHab, texto: `${legHab} por semana`, fuente: 'planificación' };
  return { frecuencia: f, capTotalSemana, capMensualTotal: legTotalMes, tratamientoFinaliza: fechaValida(pl.vigencia && pl.vigencia.hasta) ? pl.vigencia.hasta : null, planPorSaldo: leg.alcance === 'plan' && entero(leg.totalPrevisto) };
}

// ── Motor principal ───────────────────────────────────────────────────────
// ctx: {
//   origen:{anio,mes}, destino:{anio,mes},
//   reservas: [...] (origen y destino, crudas con id),
//   pacientes: { [dni]: { dni, fullName, planificacion } },
//   servicios: { [nombre]: { duracionMin, boxes:[ids], categoria? } },
//   boxes: [{id,label}], bloqueos, desbloqueos,
//   pendientes: [{ id, estado, clave, reservaId? }]   (ya guardados)
//   decisiones: { global:{ cadaNDias: 'semanas_alternas'|'dias_exactos' }, patrones:{[patronKey]:{continuidad}}, items:{[clave]:{ hora,fecha,boxId,autoriza,estadoManual }} },
//   esActiva(r), boxDe(r), duracionDe(r), nombreDe(r)
// }
export function claveOcurrencia(dni, categoria, fecha, hora) { return `${dni}|${categoria}|${fecha}|${normHora(hora)}`; }
export function idReservaDe(clave) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < clave.length; i++) { h1 = Math.imul(h1 ^ clave.charCodeAt(i), 0x01000193) >>> 0; h2 = Math.imul(h2 + clave.charCodeAt(i), 0x85ebca6b) >>> 0; }
  return `dm_${h1.toString(36)}${h2.toString(36)}`;
}

export function prepararDuplicacion(ctx) {
  const dec = ctx.decisiones || { global: {}, patrones: {}, items: {} };
  const { origen, destino } = ctx;
  const mesOrigen = `${origen.anio}-${String(origen.mes).padStart(2, '0')}`;
  const mesDestino = `${destino.anio}-${String(destino.mes).padStart(2, '0')}`;
  const diasDestino = diasDelMes(destino.anio, destino.mes);
  const nombreDe = ctx.nombreDe || ((r) => r.nombreLimpio || r.nombre || r.cliente || '');
  const catDe = (r) => categoriaServicio(r.servicio, (ctx.servicios || {})[r.servicio]);
  const infoServ = (n) => (ctx.servicios || {})[n] || {};

  const resOrigen = (ctx.reservas || []).filter((r) => mesDe(String(r.fecha || '')) === mesOrigen);
  const resDestino = (ctx.reservas || []).filter((r) => mesDe(String(r.fecha || '')) === mesDestino);
  const activasOrigen = resOrigen.filter((r) => ctx.esActiva(r));
  const activasDestino = resDestino.filter((r) => ctx.esActiva(r));
  const ocupacionBase = ocupacionDesdeReservas(ctx.reservas, ctx);
  const ctxEval = { ...ctx, ocupacion: [...ocupacionBase] };

  const items = [];
  const patrones = [];
  const origenExplicado = new Map(); // reservaId → { categoria, texto }
  const explicar = (r, categoria, texto, patronKey) => { if (!origenExplicado.has(r.id)) origenExplicado.set(r.id, { reservaId: r.id, fecha: r.fecha, hora: normHora(r.hora), paciente: nombreDe(r), dni: String(r.dni || '').trim(), servicio: r.servicio || '', categoria, texto, patronKey: patronKey || null }); };

  resOrigen.filter((r) => !ctx.esActiva(r)).forEach((r) => explicar(r, 'cancelada', 'Cancelada: no se regenera. Una cancelación puntual no elimina la pauta de octubre.'));

  // agrupar por paciente (identificador interno) y categoría
  const sinDni = activasOrigen.filter((r) => !String(r.dni || '').trim());
  sinDni.forEach((r) => explicar(r, 'sin_paciente', 'La reserva no tiene identificador de paciente: no se puede continuar automáticamente.'));
  const porPaciente = new Map();
  activasOrigen.filter((r) => String(r.dni || '').trim()).forEach((r) => {
    const dni = String(r.dni).trim();
    if (!porPaciente.has(dni)) porPaciente.set(dni, []);
    porPaciente.get(dni).push(r);
  });

  const candidatos = []; // ocurrencias candidatas antes de validar
  const porDefinir = []; // patrones o cantidades sin resolver
  const deficits = [];

  porPaciente.forEach((lista, dni) => {
    const paciente = (ctx.pacientes || {})[dni] || { dni, fullName: nombreDe(lista[0]) };
    const cats = [...new Set(lista.map(catDe))];
    cats.forEach((cat) => {
      const grupo = lista.filter((r) => catDe(r) === cat).sort((a, b) => (a.fecha + normHora(a.hora)).localeCompare(b.fecha + normHora(b.hora)));
      const patronKey = `${dni}|${cat}`;
      const fx = frecuenciaDe(paciente, cat, { unicaCategoria: cats.length === 1 });
      const f = fx.frecuencia;
      const nombre = paciente.fullName || nombreDe(grupo[0]);
      const ultimo = grupo[grupo.length - 1];
      const plantilla = (r) => ({ dni, paciente: nombre, categoria: cat, servicio: r.servicio || '', dur: ctx.duracionDe(r), boxId: ctx.boxDe(r) });
      const nuevo = (fecha, r, origenTipo, refs) => candidatos.push({ ...plantilla(r), fecha, hora: normHora(r.hora), patronKey, origen: { tipo: origenTipo, refs, espejo: origenTipo === 'reserva' ? r.id : null }, frecuenciaTexto: f ? f.texto : '', fx });
      const pat = { patronKey, dni, paciente: nombre, categoria: cat, frecuencia: f ? f.texto : '', fuente: f ? f.fuente : 'agenda de origen', evidencias: grupo.map((r) => r.id), tipo: null, estado: 'ok', nota: '' };
      const registrarPorDefinir = (tipo, texto, opciones) => { pat.estado = 'por_definir'; pat.nota = texto; porDefinir.push({ patronKey, dni, paciente: nombre, categoria: cat, tipo, texto, opciones, evidencias: grupo.map((r) => r.id), frecuencia: f ? f.texto : '' }); grupo.forEach((r) => explicar(r, 'continuidad_por_definir', texto, patronKey)); };

      // slots (día de la semana + hora + servicio)
      const slots = new Map();
      grupo.forEach((r) => { const k = `${diaSemana(r.fecha)}|${normHora(r.hora)}|${r.servicio || ''}`; if (!slots.has(k)) slots.set(k, []); slots.get(k).push(r); });
      const slotList = [...slots.entries()].map(([k, rs]) => ({ k, rs, dow: diaSemana(rs[0].fecha), hora: normHora(rs[0].hora) })).sort((a, b) => b.rs.length - a.rs.length || (b.rs[b.rs.length - 1].fecha).localeCompare(a.rs[a.rs.length - 1].fecha));

      const expandirSemanal = (slot, evidencia) => {
        const base = slot.rs[slot.rs.length - 1];
        diasDestino.filter((d) => diaSemana(d) === slot.dow).forEach((d) => {
          const espejo = slot.rs.find((r) => ordinalEnMes(r.fecha) === ordinalEnMes(d) && diaSemana(r.fecha) === diaSemana(d));
          nuevo(d, base, espejo ? 'reserva' : 'pauta', slot.rs.map((r) => r.id));
          if (espejo) candidatos[candidatos.length - 1].origen.espejo = espejo.id;
        });
        slot.rs.forEach((r) => explicar(r, 'usada_pauta', `Forma parte de la pauta semanal (${DIAS_NOMBRE[slot.dow]} ${slot.hora})${evidencia ? ` · ${evidencia}` : ''}.`, patronKey));
      };
      const alternativasNoElegidas = (elegidos) => slotList.filter((s) => !elegidos.includes(s)).forEach((s) => s.rs.forEach((r) => explicar(r, 'excepcion_historica', 'Cita en otro día/hora que no forma parte de la pauta elegida; no sustituye el horario habitual.', patronKey)));

      // 1) frecuencia explícita del perfil
      if (f && f.tipo === 'cada_n_dias') {
        pat.tipo = 'cada_n_dias';
        const n = f.n;
        const modo = n % 7 === 0 ? 'exacto' : (dec.global && dec.global.cadaNDias);
        if (!modo) {
          registrarPorDefinir('definir_frecuencia', `Frecuencia "${f.texto}": definir si son ${n} días exactos desde la última fecha o semanas alternas (mismo día de la semana).`, ['dias_exactos', 'semanas_alternas']);
        } else {
          const paso = (modo === 'semanas_alternas') ? 14 : n;
          let fecha = sumarDias(ultimo.fecha, paso);
          while (mesDe(fecha) < mesDestino) fecha = sumarDias(fecha, paso);
          for (; mesDe(fecha) === mesDestino; fecha = sumarDias(fecha, paso)) nuevo(fecha, ultimo, 'pauta', [ultimo.id]);
          explicar(ultimo, 'usada_pauta', `Fecha de referencia de "${f.texto}" (${modo === 'semanas_alternas' ? 'semanas alternas' : `${n} días exactos`}).`, patronKey);
          grupo.filter((r) => r !== ultimo).forEach((r) => explicar(r, 'usada_pauta', 'Antecedente de la misma pauta; la referencia es la última fecha.', patronKey));
        }
      } else if (f && f.tipo === 'nesimo') {
        pat.tipo = 'nesimo';
        const fecha = nesimoDiaSemana(destino.anio, destino.mes, f.dow, f.n);
        if (fecha) nuevo(fecha, ultimo, 'pauta', [ultimo.id]);
        explicar(ultimo, 'cita_puntual_continua', `Cita mensual (${f.texto}); se continúa el ${DIAS_NOMBRE[f.dow]} correspondiente.`, patronKey);
        grupo.filter((r) => r !== ultimo).forEach((r) => explicar(r, 'excepcion_historica', 'Otra cita del mes; la pauta mensual usa la última.', patronKey));
      } else if (f && f.tipo === 'mensual') {
        pat.tipo = 'mensual';
        const ord = Math.min(ordinalEnMes(ultimo.fecha), 4);
        const fecha = nesimoDiaSemana(destino.anio, destino.mes, diaSemana(ultimo.fecha), ordinalEnMes(ultimo.fecha) === 5 ? 'ultimo' : ord);
        if (fecha) nuevo(fecha, ultimo, 'pauta', [ultimo.id]);
        explicar(ultimo, 'cita_puntual_continua', `Cita mensual (${f.texto}) confirmada para continuar el mismo día de la semana.`, patronKey);
        grupo.filter((r) => r !== ultimo).forEach((r) => explicar(r, 'excepcion_historica', 'Otra cita del mes; la pauta mensual usa la última.', patronKey));
      } else if (f && f.tipo === 'n_por_mes') {
        pat.tipo = 'n_por_mes';
        let cont = 0;
        grupo.slice(0, f.n).forEach((r) => {
          const ordinal = ordinalEnMes(r.fecha);
          const fecha = nesimoDiaSemana(destino.anio, destino.mes, diaSemana(r.fecha), ordinal === 5 ? 'ultimo' : ordinal);
          if (fecha) { nuevo(fecha, r, 'reserva', [r.id]); cont++; }
          explicar(r, 'usada_pauta', `Una de las ${f.n} sesiones por mes (${f.texto}).`, patronKey);
        });
        grupo.slice(f.n).forEach((r) => explicar(r, 'excepcion_historica', `Supera las ${f.n} sesiones por mes del perfil.`, patronKey));
        if (cont < f.n) deficits.push({ patronKey, dni, paciente: nombre, categoria: cat, faltan: f.n - cont, texto: `Faltan ${f.n - cont} de ${f.n} sesiones del mes sin fecha definida (${f.texto}).` });
      } else if (f && f.tipo === 'ambigua') {
        pat.tipo = 'ambigua';
        registrarPorDefinir('definir_frecuencia', `Frecuencia "${f.texto}": no se puede interpretar automáticamente; definirla en el perfil.`, []);
      } else {
        // 2) semanal (explícita) o deducida de la agenda
        const nSem = f && f.tipo === 'semanal' ? f.n : null;
        const reg = slotList.filter((s) => s.rs.length >= 2);
        const diffs = (s) => s.rs.slice(1).map((r, i) => diferenciaDias(s.rs[i].fecha, r.fecha));
        if (nSem) {
          pat.tipo = 'semanal';
          const elegidos = slotList.slice(0, nSem);
          elegidos.forEach((s) => expandirSemanal(s, `${f.texto} (${f.fuente})`));
          alternativasNoElegidas(elegidos);
        } else if (reg.length) {
          // semanal: intervalos múltiplos de 7 con al menos uno de 7 (un hueco por cierre no rompe la pauta)
          const semanales = reg.filter((s) => diffs(s).every((d) => d % 7 === 0) && Math.min(...diffs(s)) === 7);
          const quincenales = reg.filter((s) => !semanales.includes(s) && diffs(s).every((d) => d % 14 === 0));
          if (semanales.length) {
            pat.tipo = 'semanal_inferida';
            const elegidos = semanales;
            elegidos.forEach((s) => expandirSemanal(s, 'deducida de la agenda de origen'));
            alternativasNoElegidas(elegidos);
          } else if (quincenales.length) {
            pat.tipo = 'quincenal_inferida';
            const s = quincenales[0];
            const base = s.rs[s.rs.length - 1];
            let fecha = sumarDias(base.fecha, 14);
            while (mesDe(fecha) < mesDestino) fecha = sumarDias(fecha, 14);
            for (; mesDe(fecha) === mesDestino; fecha = sumarDias(fecha, 14)) nuevo(fecha, base, 'pauta', s.rs.map((r) => r.id));
            s.rs.forEach((r) => explicar(r, 'usada_pauta', 'Forma parte de una pauta cada 2 semanas deducida de la agenda.', patronKey));
            alternativasNoElegidas([s]);
          } else {
            registrarPorDefinir('continuidad_por_definir', 'Las citas de origen no siguen una regularidad semanal ni quincenal; indicar si son puntuales o habituales.', ['habitual', 'puntual']);
          }
        } else {
          // una sola aparición por horario
          const decision = (dec.patrones || {})[patronKey] && dec.patrones[patronKey].continuidad;
          if (decision === 'habitual') {
            pat.tipo = 'habitual_indicada';
            slotList.forEach((s) => expandirSemanal(s, 'indicada como habitual por el administrador'));
          } else if (decision === 'puntual') {
            pat.tipo = 'puntual_indicada';
            grupo.forEach((r) => explicar(r, 'excepcion_historica', 'Indicada como cita puntual: no continúa.', patronKey));
          } else {
            registrarPorDefinir('continuidad_por_definir', 'Cita aislada sin frecuencia en el perfil: indicar si es puntual o habitual.', ['habitual', 'puntual']);
          }
        }
      }
      if (fx.tratamientoFinaliza) {
        const antes = candidatos.length;
        for (let i = candidatos.length - 1; i >= 0; i--) if (candidatos[i].patronKey === patronKey && candidatos[i].fecha > fx.tratamientoFinaliza) candidatos.splice(i, 1);
        if (candidatos.length < antes) pat.nota = `El tratamiento finaliza el ${fx.tratamientoFinaliza.split('-').reverse().join('/')}: no se generan turnos posteriores.`;
      }
      if (fx.planPorSaldo) pat.nota = (pat.nota ? pat.nota + ' ' : '') + 'Tiene un cupo total del plan; el sistema no registra su saldo, así que no se pudo descontar.';
      patrones.push(pat);
    });
  });

  // ── caps por semana / mes y reconocimiento de lo ya existente ──
  candidatos.sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
  const contSem = new Map(); // dni|semana|cat|'total' → n
  const inc = (k) => contSem.set(k, (contSem.get(k) || 0) + 1);
  const get = (k) => contSem.get(k) || 0;
  const pendientesPrevios = new Map((ctx.pendientes || []).map((p) => [p.clave, p]));
  const reservasPorClave = new Map();
  activasDestino.forEach((r) => { if (r.duplicacion && r.duplicacion.ocurrenciaKey) reservasPorClave.set(r.duplicacion.ocurrenciaKey, r); });
  // lo que el destino ya tiene cuenta para los cupos
  activasDestino.forEach((r) => { const d = String(r.dni || '').trim(); if (!d) return; const c = catDe(r); inc(`${d}|${inicioSemana(r.fecha)}|${c}`); inc(`${d}|${inicioSemana(r.fecha)}|total`); inc(`${d}|mes|${c}`); inc(`${d}|mes|total`); });

  const aceptadas = [];
  candidatos.forEach((c) => {
    const clave = claveOcurrencia(c.dni, c.categoria, c.fecha, c.hora);
    const item = { clave, idReserva: idReservaDe(clave), dni: c.dni, paciente: c.paciente, categoria: c.categoria, servicio: c.servicio, fecha: c.fecha, hora: c.hora, dur: c.dur, boxId: c.boxId, patronKey: c.patronKey, origen: c.origen, frecuencia: c.frecuenciaTexto, motivos: [], advertencias: [], estado: '' };
    const dItem = (dec.items || {})[clave] || {};
    if (dItem.fecha && fechaValida(dItem.fecha)) item.fecha = dItem.fecha;
    if (dItem.hora && horaAMin(dItem.hora) != null) item.hora = normHora(dItem.hora);
    if (dItem.boxId) item.boxId = dItem.boxId;
    // ¿ya está cubierta?
    const previa = pendientesPrevios.get(clave);
    const propia = reservasPorClave.get(clave);
    const equivalente = propia || activasDestino.find((r) => String(r.dni || '').trim() === c.dni && catDe(r) === c.categoria && r.fecha === c.fecha);
    if (equivalente) { item.estado = 'ya_cubierta'; item.reservaExistente = equivalente.id; if (normHora(equivalente.hora) !== c.hora) item.advertencias.push({ codigo: 'otra_hora', texto: `La reserva existente está a las ${normHora(equivalente.hora)}.` }); items.push(item); return; }
    if (previa && previa.estado === 'resuelto' && previa.reservaId) { item.estado = 'ya_cubierta'; item.reservaExistente = previa.reservaId; item.resueltaPor = 'pendiente'; items.push(item); return; }
    // cupos
    const semK = `${c.dni}|${inicioSemana(item.fecha)}`;
    const fxc = c.fx || {};
    const tope = { sem: null, semCat: null, mes: null };
    if (fxc.capTotalSemana) tope.sem = fxc.capTotalSemana;
    if (fxc.frecuencia && fxc.frecuencia.tipo === 'semanal') tope.semCat = fxc.frecuencia.n;
    if (fxc.frecuencia && (fxc.frecuencia.tipo === 'n_por_mes' || fxc.frecuencia.tipo === 'mensual' || fxc.frecuencia.tipo === 'nesimo')) tope.mes = fxc.frecuencia.n || 1;
    if (fxc.capMensualTotal) tope.mesTotal = fxc.capMensualTotal;
    let excede = '';
    if (tope.semCat && get(`${semK}|${c.categoria}`) >= tope.semCat) excede = `Ya alcanza ${tope.semCat} sesión(es) de ${c.categoria} por semana.`;
    else if (tope.sem && get(`${semK}|total`) >= tope.sem) excede = `Ya alcanza ${tope.sem} visita(s) por semana en total.`;
    else if (tope.mes && get(`${c.dni}|mes|${c.categoria}`) >= tope.mes) excede = `Ya alcanza ${tope.mes} sesión(es) de ${c.categoria} en el mes.`;
    else if (tope.mesTotal && get(`${c.dni}|mes|total`) >= tope.mesTotal) excede = `Ya alcanza el objetivo de ${tope.mesTotal} turno(s) del mes.`;
    if (excede) { item.estado = 'fuera_cupo'; item.motivos.push({ codigo: 'fuera_cupo', texto: excede }); items.push(item); return; }
    // validación real
    const ev = evaluarOcurrencia({ ...ctxEval, ocupacion: [...ocupacionBase, ...aceptadas] }, { fecha: item.fecha, hora: item.hora, dur: item.dur, boxId: item.boxId, dni: item.dni, servicio: item.servicio, categoria: item.categoria, autoriza: dItem.autoriza });
    item.motivos = ev.motivos; item.advertencias = [...item.advertencias, ...ev.advertencias];
    if (dItem.estadoManual === 'pendiente_consultar') { item.estado = 'pendiente'; item.estadoManual = 'pendiente_consultar'; item.motivos.push({ codigo: 'pendiente_consultar', texto: 'Marcado para consultar con la paciente.' }); }
    else if (ev.motivos.length) item.estado = 'pendiente';
    else {
      item.estado = 'crear';
      aceptadas.push({ id: item.idReserva, fecha: item.fecha, ini: horaAMin(item.hora), dur: item.dur, boxId: item.boxId, dni: item.dni, nombre: item.paciente, servicio: item.servicio });
      inc(`${semK}|${c.categoria}`); inc(`${semK}|total`); inc(`${c.dni}|mes|${c.categoria}`); inc(`${c.dni}|mes|total`);
    }
    if (previa && item.estado === 'pendiente') item.yaRegistrado = true;
    items.push(item);
  });

  // reservas de origen usadas: si algún candidato del patrón llegó a crearse/estar cubierto no cambia la explicación
  activasOrigen.forEach((r) => { if (!origenExplicado.has(r.id)) explicar(r, 'usada_pauta', 'Usada para armar la pauta.', `${String(r.dni || '').trim()}|${catDe(r)}`); });

  const cuenta = (e) => items.filter((i) => i.estado === e).length;
  const nuevosPendientes = items.filter((i) => i.estado === 'pendiente' && !i.yaRegistrado).length;
  const resumen = {
    crear: cuenta('crear'), yaCubiertas: cuenta('ya_cubierta'), pendientes: cuenta('pendiente'), pendientesNuevos: nuevosPendientes,
    pendientesYaRegistrados: items.filter((i) => i.estado === 'pendiente' && i.yaRegistrado).length,
    fueraCupo: cuenta('fuera_cupo'), porDefinir: porDefinir.length, deficits: deficits.length,
    reservasOrigen: resOrigen.length, pacientes: porPaciente.size,
  };
  resumen.guardarPendientes = nuevosPendientes + porDefinir.length + deficits.length;
  resumen.etiquetaBoton = `Crear ${resumen.crear} turno${resumen.crear === 1 ? '' : 's'} y guardar ${resumen.guardarPendientes} pendiente${resumen.guardarPendientes === 1 ? '' : 's'}`;
  return { items, patrones, porDefinir, deficits, origenExplicado: [...origenExplicado.values()], resumen, mesOrigen, mesDestino };
}

// ── Alternativas para un pendiente ────────────────────────────────────────
// Devuelve hasta `max` opciones válidas ordenadas por cercanía. Nunca propone un
// horario que rompa un bloqueo (protegido o no), una superposición o la
// compatibilidad de box; las restricciones explícitas del paciente se excluyen
// salvo que se pida incluirlas con `incluirRestricciones` (requieren
// autorización registrada por el administrador).
export function buscarAlternativas(ctx, item, { max = 6, incluirRestricciones = false, diasVecinos = 3 } = {}) {
  const info = (ctx.servicios || {})[item.servicio] || {};
  const compat = (info.boxes && info.boxes.length ? info.boxes : (ctx.boxes || []).map((b) => b.id));
  const boxes = (ctx.boxes || []).map((b) => b.id).filter((id) => compat.includes(id));
  const baseMin = horaAMin(item.hora);
  const candidatos = [];
  const fechas = [];
  const enMes = (f) => mesDe(f) === ctx.mesDestino;
  fechas.push(item.fecha);
  for (let k = 1; k <= diasVecinos; k++) { fechas.push(sumarDias(item.fecha, k), sumarDias(item.fecha, -k)); }
  diasDelMes(+ctx.mesDestino.slice(0, 4), +ctx.mesDestino.slice(5)).filter((f) => diaSemana(f) === diaSemana(item.fecha) && !fechas.includes(f)).forEach((f) => fechas.push(f));
  fechas.filter(enMes).forEach((f) => {
    for (let dm = 0; dm <= 180; dm += PASO_MIN) {
      [dm, -dm].forEach((delta, idx) => {
        if (idx === 1 && dm === 0) return;
        const m = baseMin + delta;
        if (m < 7 * 60 || m > 21 * 60) return;
        boxes.forEach((boxId) => {
          const ev = evaluarOcurrencia(ctx, { fecha: f, hora: minAHora(m), dur: item.dur, boxId, dni: item.dni, servicio: item.servicio, categoria: item.categoria, autoriza: incluirRestricciones ? { indisponible: true, ausente: true } : undefined });
          if (ev.motivos.length) return;
          const cambios = [];
          if (f !== item.fecha) cambios.push('otro día');
          if (m !== baseMin) cambios.push('otra hora');
          if (boxId !== item.boxId) cambios.push('otro box');
          const puntaje = Math.abs(diferenciaDias(item.fecha, f)) * 1000 + Math.abs(delta) * 3 + (boxId !== item.boxId ? 40 : 0) + (ev.advertencias.length ? 200 : 0);
          candidatos.push({ fecha: f, hora: minAHora(m), boxId, cambios, advertencias: ev.advertencias, puntaje });
        });
      });
    }
  });
  candidatos.sort((a, b) => a.puntaje - b.puntaje);
  const vistos = new Set();
  return candidatos.filter((c) => { const k = `${c.fecha}|${c.hora}|${c.boxId}`; if (vistos.has(k)) return false; vistos.add(k); return true; }).slice(0, max);
}

// Motivos que ninguna autorización del paciente puede superar.
export function motivosInsalvables(motivos) { return (motivos || []).filter((m) => CODIGOS_DUROS.includes(m.codigo)); }
export function tieneBloqueoProtegido(motivos) { return (motivos || []).some((m) => m.codigo === 'bloqueo_depilacion_protegido'); }
