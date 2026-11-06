// Buscador avanzado del panel admin (servicio · período · estado) y detector
// de fichas duplicadas. Lógica pura — sin DOM ni Firestore — para probarla sola
// (tests/buscador-avanzado). admin.html le inyecta los criterios propios del
// panel (identidad del paciente, estado activo/inactivo, precio de la sesión),
// así nunca hay dos reglas distintas para lo mismo.

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export const MODOS = {
  realizo: 'Realizó el servicio',
  exclusivo: 'Exclusivo de este servicio',
  ingreso: 'Ingresó con este servicio',
};

export function nombreMes(ym, conAnio = true) {
  const [a, m] = (ym || '').split('-');
  const n = MESES[Number(m) - 1] || ym;
  return conAnio ? `${n} ${a}` : n;
}

const orden = (a, b) => `${a.fecha || ''}T${a.hora || ''}`.localeCompare(`${b.fecha || ''}T${b.hora || ''}`);

// ¿La fecha cae en el período? meses (YYYY-MM) manda sobre el rango.
export function enPeriodo(fecha, { meses, desde, hasta }) {
  if (!fecha) return false;
  if (meses && meses.length) return meses.includes(fecha.slice(0, 7));
  if (desde && fecha < desde) return false;
  if (hasta && fecha > hasta) return false;
  return true;
}

/**
 * opciones:
 *  reservas   — reservas ACTIVAS (no canceladas) del paciente real.
 *  claveDe(r) — identidad del paciente (DNI con "Cambiar ID", o nombre).
 *  hoy        — 'YYYY-MM-DD'.
 *  servicios  — nombres exactos elegidos ([] = todos).
 *  modo       — 'realizo' | 'exclusivo' | 'ingreso'.
 *  periodo    — { meses:[YYYY-MM] } o { desde, hasta } (fechas ISO).
 *  futuros    — incluir turnos con fecha posterior a hoy.
 *  estado     — 'todos' | 'activo' | 'inactivo' | 'cursos'.
 *  estadoDe(clave) — estado actual del paciente.
 *  precioDe(r)     — importe acordado de la sesión o null si no hay dato.
 */
export function calcularBusqueda(op) {
  const svc = new Set(op.servicios || []);
  const conSvc = svc.size > 0;
  const okSvc = (r) => !conSvc || svc.has(r.servicio);
  const okPeriodo = (r) => enPeriodo(r.fecha, op.periodo || {}) && (op.futuros || r.fecha <= op.hoy);

  // Todas las sesiones de cada paciente, en orden (para "exclusivo" e "ingreso").
  const porPaciente = new Map();
  for (const r of op.reservas || []) {
    if (!r || !r.fecha) continue;
    const k = op.claveDe(r);
    if (!k) continue;
    if (!porPaciente.has(k)) porPaciente.set(k, []);
    porPaciente.get(k).push(r);
  }
  porPaciente.forEach((l) => l.sort(orden));

  const pacientes = [];
  for (const [clave, todas] of porPaciente) {
    const primera = todas[0];
    let incluye = false;
    if (op.modo === 'exclusivo') incluye = conSvc && todas.every(okSvc);
    else if (op.modo === 'ingreso') incluye = okPeriodo(primera) && okSvc(primera);
    else incluye = true;
    if (!incluye) continue;
    const sesiones = todas.filter((r) => okPeriodo(r) && okSvc(r));
    if (!sesiones.length) continue;
    const estado = op.estadoDe ? op.estadoDe(clave) : 'inactivo';
    if (op.estado && op.estado !== 'todos' && estado !== op.estado) continue;
    const ref = todas[todas.length - 1];
    pacientes.push({
      clave, estado, sesiones, primera,
      nombre: ref.nombreLimpio || ref.nombre || 'Sin nombre',
      dni: (clave.startsWith('dni:') ? clave.slice(4) : ''),
      // "nuevo": su primera sesión de todas fue en este período y con el/los servicio(s)
      nuevo: okPeriodo(primera) && okSvc(primera),
      serviciosHistoricos: [...new Set(todas.map((r) => r.servicio).filter(Boolean))],
    });
  }
  pacientes.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));

  const sesiones = pacientes.flatMap((p) => p.sesiones.map((r) => ({ r, p }))).sort((a, b) => orden(a.r, b.r));
  const porMes = new Map();
  const porServicio = new Map();
  let importe = 0, conPrecio = 0;
  for (const { r } of sesiones) {
    const ym = r.fecha.slice(0, 7);
    porMes.set(ym, (porMes.get(ym) || 0) + 1);
    const s = r.servicio || 'Sin especificar';
    const e = porServicio.get(s) || { sesiones: 0, importe: 0, conPrecio: 0 };
    e.sesiones++;
    const precio = op.precioDe ? op.precioDe(r) : null;
    if (precio != null) { e.importe += precio; e.conPrecio++; importe += precio; conPrecio++; }
    porServicio.set(s, e);
  }
  const porEstado = { activo: 0, inactivo: 0, cursos: 0 };
  pacientes.forEach((p) => { if (porEstado[p.estado] != null) porEstado[p.estado]++; });

  return {
    pacientes,
    sesiones,
    totalSesiones: sesiones.length,
    porMes: [...porMes.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    porServicio: [...porServicio.entries()].sort((a, b) => b[1].sesiones - a[1].sesiones),
    porEstado,
    nuevos: pacientes.filter((p) => p.nuevo),
    importe: conPrecio ? importe : null,
    sesionesConPrecio: conPrecio,
  };
}

// Título del reporte según lo que se filtró (pantalla y PDF).
export function tituloBusqueda({ servicios = [], modo, periodo = {}, estado = 'todos' }) {
  const svcTxt = servicios.length ? (servicios.length <= 3 ? servicios.join(', ') : `${servicios.length} servicios`) : 'Todos los servicios';
  let per;
  if (periodo.meses && periodo.meses.length) {
    const ms = [...periodo.meses].sort();
    per = ms.length === 1 ? nombreMes(ms[0]) : `${nombreMes(ms[0])} – ${nombreMes(ms[ms.length - 1])}${ms.length > 2 ? ` (${ms.length} meses)` : ''}`;
  } else if (periodo.desde || periodo.hasta) {
    const f = (x) => (x ? x.split('-').reverse().join('/') : '…');
    per = `${f(periodo.desde)} al ${f(periodo.hasta)}`;
  } else per = 'todo el historial';
  const est = { activo: ' · pacientes activos', inactivo: ' · pacientes inactivos', cursos: ' · pacientes de cursos' }[estado] || '';
  let t;
  if (modo === 'exclusivo') t = `Reporte Exclusivo: ${svcTxt}`;
  else if (modo === 'ingreso') t = `Pacientes sumados en ${per} — ${svcTxt}`;
  else t = `Resumen de Sesiones por Servicio: ${svcTxt}`;
  return { titulo: t, periodo: per, subtitulo: `${MODOS[modo] || MODOS.realizo} · ${per}${est}` };
}

// ── Duplicados ──
const sinTildes = (s) => (s ?? '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '');
// Nombre normalizado e independiente del orden ("Pérez Ana" = "ana  PEREZ").
export function claveNombre(nombre) {
  const tokens = sinTildes(nombre).toLowerCase().replace(/[^a-z0-9ñ\s]/g, ' ').split(/\s+/).filter(Boolean);
  return tokens.length >= 2 ? tokens.sort().join(' ') : '';
}
export function claveTelefono(tel) {
  const d = (tel ?? '').toString().replace(/\D/g, '');
  return d.length >= 8 ? d.slice(-8) : '';
}

// pacientes: [{ dni, fullName, phone }] → grupos [{ miembros:[p], motivos:Set }]
export function agruparDuplicados(pacientes) {
  const lista = (pacientes || []).filter((p) => p && p.dni);
  const padre = lista.map((_, i) => i);
  const raiz = (i) => (padre[i] === i ? i : (padre[i] = raiz(padre[i])));
  const motivos = new Map(); // "i|j" → motivos
  const unir = (i, j, motivo) => {
    const a = raiz(i), b = raiz(j);
    if (a !== b) padre[b] = a;
    const k = Math.min(i, j) + '|' + Math.max(i, j);
    if (!motivos.has(k)) motivos.set(k, new Set());
    motivos.get(k).add(motivo);
  };
  const porClave = (fn, motivo) => {
    const visto = new Map();
    lista.forEach((p, i) => {
      const k = fn(p);
      if (!k) return;
      if (visto.has(k)) unir(visto.get(k), i, motivo); else visto.set(k, i);
    });
  };
  porClave((p) => claveNombre(p.fullName), 'nombre');
  porClave((p) => (p.dni || '').toString().replace(/\D/g, ''), 'DNI');
  porClave((p) => claveTelefono(p.phone), 'teléfono');
  const grupos = new Map();
  lista.forEach((p, i) => {
    const r = raiz(i);
    if (!grupos.has(r)) grupos.set(r, { miembros: [], motivos: new Set() });
    grupos.get(r).miembros.push(p);
  });
  motivos.forEach((m, k) => { const r = raiz(Number(k.split('|')[0])); m.forEach((x) => grupos.get(r).motivos.add(x)); });
  return [...grupos.values()].filter((g) => g.miembros.length > 1)
    .sort((a, b) => (a.miembros[0].fullName || '').localeCompare(b.miembros[0].fullName || '', 'es'));
}
