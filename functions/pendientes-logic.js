// functions/pendientes-logic.js
// Espejo en CommonJS de la regla canónica de "pendientes" de
// mimar-inteligente/mimar-inteligente-logic.js (sección GlowUp). No se
// pudo compartir el mismo archivo: functions/index.js usa CommonJS
// (require) sobre Node 24 con firebase-functions v7, y el cliente usa
// ESM nativo del navegador — migrar todo el proyecto de Functions a ESM
// para compartir un solo archivo es un cambio de build/runtime mucho más
// grande que el problema que resuelve, así que se mantiene un espejo
// deliberado y documentado, con pruebas paralelas
// (tests/functions-emulator/pendientes-logic-run.js) que verifican que
// ambos lados dan el mismo resultado ante los mismos datos.
//
// Cualquier cambio de REGLA (qué es un pendiente, cuándo vence, cuándo se
// cierra) tiene que aplicarse a los DOS archivos.

const ZONA_HORARIA = "America/Argentina/Buenos_Aires";
// Ver mimar-inteligente-logic.js: bumpeado de 4h a 24h el 14/9 tras
// comprobar con datos reales que dejaba la bandeja de turnos vacía casi
// todo el día (construirTextoRecordatorio ya asume aviso "mañana", no 4h
// antes).
const VENTANA_REVISION_MS = 24 * 60 * 60 * 1000;
const VENTANA_REVISAR_TURNO_DIAS = 14;
const DURACION_DEFECTO_MIN = 60;

// Misma precedencia documentada que el lado cliente: teléfono propio del
// documento primero, clients/{dni} después, null si ninguno lo tiene.
function resolverTelefonoConFallback(telefonoPropio, dni, clientesPorDni) {
  const propio = (telefonoPropio || "").toString().trim();
  if (propio) return propio;
  const dniLimpio = (dni || "").toString().trim();
  if (!dniLimpio || !clientesPorDni) return null;
  const cliente = clientesPorDni[dniLimpio];
  if (!cliente) return null;
  const deCliente = (cliente.telefono || cliente.phone || "").toString().trim();
  return deCliente || null;
}

function inicioTurnoMs(fecha, hora) {
  const f = (fecha || "").toString().trim();
  const h = (hora || "").toString().trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return null;
  const hh = /^\d{1,2}:\d{2}$/.test(h) ? h.padStart(5, "0") : "00:00";
  const ms = new Date(`${f}T${hh}:00-03:00`).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function finTurnoMs(fecha, hora, duracionMinutos) {
  const inicio = inicioTurnoMs(fecha, hora);
  if (inicio === null) return null;
  const dur = Number(duracionMinutos) > 0 ? Number(duracionMinutos) : DURACION_DEFECTO_MIN;
  return inicio + dur * 60000;
}

const ESTADOS_CANCELADOS = {
  reservas: ["cancelado", "cancelada"],
  consultas: ["cancelada", "cancelado"],
};
function esActiva(coleccion, estadoBruto) {
  const cancelados = ESTADOS_CANCELADOS[coleccion] || ["cancelado", "cancelada"];
  const v = (estadoBruto || "").toString().trim().toLowerCase();
  return !cancelados.includes(v);
}

function normalizarItemAgenda(coleccion, id, data, clientesPorDni) {
  const d = data || {};
  const nombre = d.nombreLimpio || d.nombre || d.paciente || d.clienteNombre || null;
  const dni = d.dni || d.clienteDni || d.documento || null;
  const telefonoPropio = d.phone || d.telefono || d.whatsapp || null;
  const telefono = resolverTelefonoConFallback(telefonoPropio, dni, clientesPorDni);
  const fecha = d.fecha || null;
  const hora = d.hora || null;
  const estadoBruto = d.estado || d.status || (coleccion === "consultas" ? "pendiente" : null);
  const activa = esActiva(coleccion, estadoBruto);
  const duracionCruda = d.duracionMinutos !== undefined ? d.duracionMinutos : d.duracion;
  const duracionRegistrada = Number(duracionCruda) > 0 ? Number(duracionCruda) : null;
  const inicioMs = inicioTurnoMs(fecha, hora);
  const finMs = fecha && hora ? finTurnoMs(fecha, hora, duracionRegistrada) : null;
  return { coleccion, id, nombre, dni, telefono, fecha, hora, estadoBruto, activa, inicioMs, finMs, detalleSesion: d.detalleSesion || null };
}

function calcularRevision(item, ahoraMs) {
  if (!item.activa) return null;
  if (item.inicioMs === null) return null;
  if (item.finMs !== null && item.finMs <= ahoraMs) return null;
  const ventanaDesde = item.inicioMs - VENTANA_REVISION_MS;
  if (ahoraMs < ventanaDesde) return null;
  return { item, venceEnMs: item.inicioMs, bloqueado: !item.telefono };
}

// Turno pasado sin nota de atención — ver mimar-inteligente-logic.js.
function calcularRevisarTurnoPasado(item, ahoraMs) {
  if (!item.activa) return null;
  if (item.inicioMs === null) return null;
  if (item.finMs === null || item.finMs > ahoraMs) return null;
  if (item.detalleSesion) return null;
  return { item };
}

// Mismo criterio de versionado por ocurrencia que el lado cliente —
// ver mimar-inteligente-logic.js para el porqué.
function docIdVersionadoContacto(id, tipoMensaje, fecha, hora) {
  if ((tipoMensaje === "confirmacion" || tipoMensaje === "consulta") && fecha && hora) {
    return `${id}__${fecha}_${hora}`;
  }
  return id;
}
function docIdVersionadoCumpleanos(clientId, fechaISO) {
  const anio = (fechaISO || "").slice(0, 4);
  return anio ? `${clientId}__${anio}` : clientId;
}
function idContactoParaItem(item, tipoMensaje) {
  const docId = docIdVersionadoContacto(item.id, tipoMensaje, item.fecha, item.hora);
  return `${item.coleccion}_${docId}_${tipoMensaje}`;
}

const TIPOS_PENDIENTE = ["recomendacion", "confirmacion_turno", "revisar_turno", "kit_pendiente", "cumpleanos"];
const ORDEN_TIPO = { recomendacion: 0, confirmacion_turno: 1, revisar_turno: 2, kit_pendiente: 3, cumpleanos: 4 };

function estadoContactoResuelto(contactosPorId, id) {
  return (contactosPorId?.[id]?.estado || "pendiente") === "enviado";
}

// Misma firma y mismo resultado que el lado cliente, pero recibe datos ya
// crudos de Firestore (Admin SDK) en vez de los tipos normalizados del
// cliente — el propio job los arma antes de llamar acá. clientesPorDni:
// mapa dni -> datos de clients, para el fallback de teléfono.
function derivarPendientes({ reservasRaw, consultasRaw, pedidosKitPendientesRaw, cumpleanosHoy, recomendacionesRaw, contactosPorId, clientesPorDni }, ahoraMs) {
  const pendientes = [];
  const agendaItems = [
    ...reservasRaw.map((r) => normalizarItemAgenda("reservas", r.id, r.data, clientesPorDni)),
    ...consultasRaw.map((c) => normalizarItemAgenda("consultas", c.id, c.data, clientesPorDni)),
  ];

  for (const item of agendaItems) {
    const revision = calcularRevision(item, ahoraMs);
    if (!revision) continue;
    const tipoMensaje = item.coleccion === "consultas" ? "consulta" : "confirmacion";
    const idContactoRef = idContactoParaItem(item, tipoMensaje);
    if (estadoContactoResuelto(contactosPorId, idContactoRef)) continue;
    pendientes.push({
      id: `pend_${item.coleccion}_${item.id}_confirmacion_${item.fecha}_${item.hora}`,
      tipo: "confirmacion_turno", coleccion: item.coleccion, docId: item.id,
      nombre: item.nombre || "Paciente", venceMs: revision.venceEnMs,
      bloqueado: revision.bloqueado,
    });
  }

  for (const item of agendaItems) {
    const rt = calcularRevisarTurnoPasado(item, ahoraMs);
    if (!rt) continue;
    pendientes.push({
      id: `pend_${item.coleccion}_${item.id}_revisar_${item.fecha}_${item.hora}`,
      tipo: "revisar_turno", coleccion: item.coleccion, docId: item.id,
      nombre: item.nombre || "Paciente", venceMs: null, bloqueado: false,
    });
  }

  for (const kit of (pedidosKitPendientesRaw || [])) {
    pendientes.push({ id: `pend_pedidosKit_${kit.id}_kit`, tipo: "kit_pendiente", coleccion: "pedidosKit", docId: kit.id, nombre: kit.data?.nombrePaciente || "Paciente", venceMs: null });
  }

  if (cumpleanosHoy?.estado === "ok") {
    for (const persona of (cumpleanosHoy.personas || [])) {
      const idContactoRef = `clients_${docIdVersionadoCumpleanos(persona.clientId, cumpleanosHoy.fecha)}_cumpleanos`;
      if (estadoContactoResuelto(contactosPorId, idContactoRef)) continue;
      pendientes.push({ id: `pend_clients_${persona.clientId}_cumpleanos_${cumpleanosHoy.fecha}`, tipo: "cumpleanos", coleccion: "clients", docId: persona.clientId, nombre: persona.nombre || "Paciente", venceMs: null });
    }
  }

  for (const rec of (recomendacionesRaw || [])) {
    const d = rec.data || {};
    if ((d.estado || "pendiente") !== "pendiente") continue;
    const programadoParaMs = d.programadoPara?.toMillis ? d.programadoPara.toMillis() : (typeof d.programadoParaMs === "number" ? d.programadoParaMs : null);
    if (programadoParaMs != null && programadoParaMs > ahoraMs) continue;
    pendientes.push({ id: `pend_recomendacion_${rec.id}`, tipo: "recomendacion", coleccion: "recomendacionesInteligente", docId: rec.id, nombre: d.pacienteNombre || "Paciente", venceMs: null });
  }

  return pendientes.sort((a, b) => {
    const va = a.venceMs ?? Infinity, vb = b.venceMs ?? Infinity;
    if (va !== vb) return va - vb;
    return (ORDEN_TIPO[a.tipo] ?? 9) - (ORDEN_TIPO[b.tipo] ?? 9);
  });
}

const PLURAL_TIPO = {
  recomendacion: ["recomendación", "recomendaciones"],
  confirmacion_turno: ["turno por confirmar", "turnos por confirmar"],
  revisar_turno: ["turno a revisar", "turnos a revisar"],
  kit_pendiente: ["kit", "kits"],
  cumpleanos: ["cumpleaños", "cumpleaños"],
};

function contarPendientesPorTipo(pendientes) {
  const conteo = {};
  for (const t of TIPOS_PENDIENTE) conteo[t] = 0;
  for (const p of pendientes) conteo[p.tipo] = (conteo[p.tipo] || 0) + 1;
  return conteo;
}

function resumenTextoPendientes(pendientes) {
  const total = pendientes.length;
  if (!total) return null;
  const conteo = contarPendientesPorTipo(pendientes);
  const partes = TIPOS_PENDIENTE.filter((t) => conteo[t] > 0).map((t) => {
    const [singular, plural] = PLURAL_TIPO[t];
    return `${conteo[t]} ${conteo[t] === 1 ? singular : plural}`;
  });
  const listado = partes.length > 1 ? partes.slice(0, -1).join(", ") + " y " + partes[partes.length - 1] : partes[0];
  return `Tenés ${total} pendiente${total === 1 ? "" : "s"}: ${listado}.`;
}

const PREFS_AVISOS_DEFECTO = { activo: true, categorias: [...TIPOS_PENDIENTE], pausadoHastaMs: null, descansoInicioHora: null, descansoFinHora: null };

function horaEnZona(ms, timeZone) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hour12: false }).format(ms).replace(/\D/g, "")) % 24;
}
function enDescansoNocturno(prefs, ahoraMs, timeZone = ZONA_HORARIA) {
  const { descansoInicioHora: ini, descansoFinHora: fin } = prefs || {};
  if (ini == null || fin == null) return false;
  const h = horaEnZona(ahoraMs, timeZone);
  if (ini === fin) return false;
  return ini < fin ? (h >= ini && h < fin) : (h >= ini || h < fin);
}

function pendientesElegiblesParaAviso(pendientes, prefs, estadosPend, ahoraMs) {
  const p = prefs || PREFS_AVISOS_DEFECTO;
  if (!p.activo) return [];
  if (p.pausadoHastaMs != null && p.pausadoHastaMs > ahoraMs) return [];
  if (enDescansoNocturno(p, ahoraMs)) return [];
  const categorias = new Set(p.categorias && p.categorias.length ? p.categorias : TIPOS_PENDIENTE);
  return pendientes.filter((pend) => {
    if (!categorias.has(pend.tipo)) return false;
    const override = estadosPend?.[pend.id];
    if (override?.postergadoHastaMs != null && override.postergadoHastaMs > ahoraMs) return false;
    if (override?.resuelto) return false;
    return true;
  });
}

module.exports = {
  ZONA_HORARIA, VENTANA_REVISION_MS, VENTANA_REVISAR_TURNO_DIAS, TIPOS_PENDIENTE, PREFS_AVISOS_DEFECTO,
  inicioTurnoMs, finTurnoMs, esActiva, normalizarItemAgenda, calcularRevision,
  calcularRevisarTurnoPasado, resolverTelefonoConFallback,
  docIdVersionadoContacto, docIdVersionadoCumpleanos, idContactoParaItem,
  derivarPendientes, contarPendientesPorTipo, resumenTextoPendientes,
  enDescansoNocturno, pendientesElegiblesParaAviso,
};
