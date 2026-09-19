// mimar-inteligente-logic.js
// Reglas determinísticas de "Mimar T Inteligente" — sin DOM, sin Firestore,
// solo funciones puras sobre los datos ya traídos. Se puede probar con Node
// (`node tests/mimar-inteligente/run-tests.js`) sin levantar el módulo.
//
// Fuentes de datos soportadas en esta v1: 'reservas' y 'consultas' (las dos
// colecciones que reloj/config.js ya trata como agenda activa, junto con
// 'reservasDepi' — que queda fuera de esta primera versión porque tiene un
// panel, un login y campos propios que todavía no se auditaron a fondo; ver
// notas de entrega). Cada colección tiene su propio vocabulario de estado:
// 'reservas' usa 'confirmado'/'cancelado'; 'consultas' usa
// 'pendiente'/'confirmada'/'cancelada'. No se mezclan.

export const ZONA_HORARIA = "America/Argentina/Buenos_Aires";
export const OFFSET_AR = "-03:00";
// GlowUp de corrección (14/9): esta ventana empezó en 4h ("v1"), pero con
// datos reales de producción se comprobó que dejaba SIN NINGÚN pendiente de
// confirmación/recordatorio durante casi todo el día (ej.: 00:36 hs con 19
// reservas activas hoy/mañana → 0 pendientes de turno, solo kits) — y la
// propia plantilla de recordatorio (construirTextoRecordatorio) ya asume que
// el mensaje se manda "mañana", no 4 horas antes. 24h alinea la ventana con
// cómo realmente se usa el recordatorio.
export const VENTANA_REVISION_MS = 24 * 60 * 60 * 1000; // 24 horas
// Cuánto atrás se buscan turnos ya pasados sin revisar (punto 3: "los
// pendientes de días anteriores no deben desaparecer"). Acotado para no
// escanear el historial completo — 14 días cubre con margen cualquier
// descuido real de revisión sin convertirse en una consulta sin límite.
export const VENTANA_REVISAR_TURNO_DIAS = 14;
export const DURACION_DEFECTO_MIN = 60; // mismo fallback que _finSesionMs en admin.html

// ── Fecha/hora ───────────────────────────────────────────────────────────
// fecha: "YYYY-MM-DD", hora: "HH:MM". Siempre con offset explícito -03:00,
// igual criterio que _finSesionMs (admin.html) y construirFechaTurno
// (functions/index.js) — nunca se usa turnoAt porque no todas las reservas
// lo tienen (solo lo escribe confirmarjornada.html).
export function inicioTurnoMs(fecha, hora) {
  const f = (fecha || "").toString().trim();
  const h = (hora || "").toString().trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return null;
  const hh = /^\d{1,2}:\d{2}$/.test(h) ? h.padStart(5, "0") : "00:00";
  const ms = new Date(`${f}T${hh}:00${OFFSET_AR}`).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export function finTurnoMs(fecha, hora, duracionMinutos) {
  const inicio = inicioTurnoMs(fecha, hora);
  if (inicio === null) return null;
  const dur = Number(duracionMinutos) > 0 ? Number(duracionMinutos) : DURACION_DEFECTO_MIN;
  return inicio + dur * 60000;
}

export function fechaISOEnZona(ms = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA_HORARIA, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date(ms)).reduce((acc, p) => { if (p.type !== "literal") acc[p.type] = p.value; return acc; }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function sumarDiasISO(fechaISO, dias) {
  const [y, m, d] = fechaISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + dias);
  return dt.toISOString().slice(0, 10);
}

// ── Fecha/hora local legible (punto 10 — "reemplazá las fechas ISO por
// fecha y hora locales legibles") ────────────────────────────────────────
// Acepta ms epoch o un string ISO (los campos "fecha"/"createdAt" de
// pedidosKit se guardan como new Date().toISOString()). La presentación
// nunca modifica el instante guardado, solo cómo se muestra.
function _msDesde(valor) {
  if (valor == null) return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  // Timestamp de Firestore (serverTimestamp() leído de vuelta): objeto con
  // toMillis(), nunca un string ni un number — no se puede tratar igual.
  if (typeof valor === "object" && typeof valor.toMillis === "function") return valor.toMillis();
  if (typeof valor === "object" && typeof valor.seconds === "number") return valor.seconds * 1000 + Math.round((valor.nanoseconds || 0) / 1e6);
  if (valor instanceof Date) return valor.getTime();
  const ms = Date.parse(valor);
  return Number.isNaN(ms) ? null : ms;
}
export function formatearFechaLocal(msOIso, tz = ZONA_HORARIA) {
  const ms = _msDesde(msOIso);
  if (ms === null) return null;
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: tz }).format(ms);
}
export function formatearHoraLocal(msOIso, tz = ZONA_HORARIA) {
  const ms = _msDesde(msOIso);
  if (ms === null) return null;
  return new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(ms);
}
export function formatearFechaHoraLocal(msOIso, tz = ZONA_HORARIA) {
  const ms = _msDesde(msOIso);
  if (ms === null) return null;
  return `${formatearFechaLocal(ms, tz)}, ${formatearHoraLocal(ms, tz)}`;
}

const DIAS_SEMANA_LEGIBLE = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
function _ymdEnZona(ms, tz) {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms));
  const o = {};
  partes.forEach((p) => { if (p.type !== "literal") o[p.type] = p.value; });
  return { y: +o.year, m: +o.month, d: +o.day };
}
function _diaSemanaEnZona(ms, tz) {
  const f = _ymdEnZona(ms, tz);
  return new Date(Date.UTC(f.y, f.m - 1, f.d, 12)).getUTCDay(); // mediodía UTC: evita corrimiento de día por huso
}
function _diffDiasCalendario(msDesde, msHasta, tz) {
  const a = _ymdEnZona(msDesde, tz), b = _ymdEnZona(msHasta, tz);
  const ua = Date.UTC(a.y, a.m - 1, a.d), ub = Date.UTC(b.y, b.m - 1, b.d);
  return Math.round((ub - ua) / 86400000);
}
export function diaSemanaLegible(msOIso, tz = ZONA_HORARIA) {
  const ms = _msDesde(msOIso);
  if (ms === null) return null;
  return DIAS_SEMANA_LEGIBLE[_diaSemanaEnZona(ms, tz)];
}

// "hoy, 17/09/2026" / "ayer, 16/09/2026" / "el lunes 14/09/2026" — siempre
// con la fecha absoluta al lado, nunca solo la palabra relativa (punto 10:
// "acompañalo siempre con una fecha exacta"). msEvento es el instante
// ORIGINAL del hecho (ej. fecha de solicitud), nunca el de la última edición.
export function referenciaTemporalConFecha(msEventoOIso, ahoraMs = Date.now(), tz = ZONA_HORARIA) {
  const msEvento = _msDesde(msEventoOIso);
  if (msEvento === null) return null;
  const fechaExacta = formatearFechaLocal(msEvento, tz);
  const dias = _diffDiasCalendario(msEvento, ahoraMs, tz);
  if (dias === 0) return `hoy, ${fechaExacta}`;
  if (dias === 1) return `ayer, ${fechaExacta}`;
  if (dias < 0) return fechaExacta; // evento "futuro" respecto de ahora (reloj desfasado entre dispositivos): solo la fecha, sin relativo engañoso
  return `el ${diaSemanaLegible(msEvento, tz)} ${fechaExacta}`;
}

// ── Vocabulario de estado por colección ─────────────────────────────────
const ESTADOS_CANCELADOS = {
  reservas: ["cancelado", "cancelada"],
  consultas: ["cancelada", "cancelado"],
};

export function esActiva(coleccion, estadoBruto) {
  const cancelados = ESTADOS_CANCELADOS[coleccion] || ["cancelado", "cancelada"];
  const v = (estadoBruto || "").toString().trim().toLowerCase();
  return !cancelados.includes(v);
}

// ── Resolución de teléfono con reubicación por DNI ───────────────────────
// Causa real encontrada en producción (auditoría 14/9, Arenhardt Yamila):
// varias reservas/consultas se crearon con phone/telefono en blanco ("",
// no ausente), mientras que la ficha canónica en `clients/{dni}` sí tiene
// el número correcto. normalizarItemAgenda nunca cruzaba con `clients`, así
// que esas reservas quedaban "sin teléfono" aunque la persona ya lo tenía
// cargado. Precedencia explícita y única (usada por app Y panel admin):
//   1) el teléfono propio del documento (reserva/consulta), si no está vacío
//   2) el teléfono de clients/{dni} (telefono, y si no, phone), si hay dni
//   3) null — nunca se inventa un número ni se agrega prefijo por suposición
export function resolverTelefonoConFallback(telefonoPropio, dni, clientesPorDni) {
  const propio = (telefonoPropio || "").toString().trim();
  if (propio) return propio;
  const dniLimpio = (dni || "").toString().trim();
  if (!dniLimpio || !clientesPorDni) return null;
  const cliente = clientesPorDni[dniLimpio];
  if (!cliente) return null;
  const deCliente = (cliente.telefono || cliente.phone || "").toString().trim();
  return deCliente || null;
}

// ── Normalización de un documento crudo a una forma común de agenda ─────
// No inventa campos: si algo no está, queda null y la interfaz debe
// mostrarlo como faltante, no completarlo con un valor inventado.
// clientesPorDni (opcional): mapa dni -> datos de clients, para el fallback
// de teléfono documentado arriba. Sin ese mapa, se comporta como antes.
export function normalizarItemAgenda(coleccion, id, data, clientesPorDni) {
  const d = data || {};
  const nombre = d.nombreLimpio || d.nombre || d.paciente || d.clienteNombre || null;
  const dni = d.dni || d.clienteDni || d.documento || null;
  const telefonoPropio = d.phone || d.telefono || d.whatsapp || null;
  const telefono = resolverTelefonoConFallback(telefonoPropio, dni, clientesPorDni);
  const telefonoDeFallback = !((telefonoPropio || "").toString().trim()) && !!telefono;
  const fecha = d.fecha || null;
  const hora = d.hora || null;
  const estadoBruto = d.estado || d.status || (coleccion === "consultas" ? "pendiente" : null);
  const activa = esActiva(coleccion, estadoBruto);
  // duracionMinutos es el campo vigente; duracion es el nombre que usaban
  // reservas más viejas (auditoría: 155 documentos reales solo tienen
  // "duracion") — sin este fallback esos turnos pierden su duración real
  // registrada y caen al estimado de 60 min como si nunca se hubiera
  // guardado nada.
  const duracionCruda = d.duracionMinutos !== undefined ? d.duracionMinutos : d.duracion;
  const duracionRegistrada = Number(duracionCruda) > 0 ? Number(duracionCruda) : null;
  const duracionEstimada = duracionRegistrada === null;
  const inicioMs = inicioTurnoMs(fecha, hora);
  const finMs = fecha && hora ? finTurnoMs(fecha, hora, duracionRegistrada) : null;
  // "timestamp" (admin.html, Nueva Consulta Inicial) y "createdAt"
  // (fecha.html, autoreserva de paciente) son los dos nombres reales de
  // campo de registro que usa esta colección — ninguno existe en el otro
  // origen. Puede ser un Timestamp de Firestore, no siempre un string.
  const registradoMs = _msDesde(d.timestamp) ?? _msDesde(d.createdAt) ?? null;

  return {
    coleccion,               // 'reservas' | 'consultas'
    id,                      // doc id real — la identidad de la tarjeta
    nombre,
    dni,
    telefono,
    telefonoDeFallback, // true si el número vino de clients/{dni}, no del propio documento
    servicio: d.servicio || (coleccion === "consultas" ? "Consulta Inicial" : null),
    box: d.box || null,      // solo si el documento lo trae explícito — sin inferencia por palabras clave
    fecha,
    hora,
    estadoBruto,
    activa,
    duracionMinutos: duracionRegistrada,
    duracionEstimada,
    inicioMs,
    finMs,
    registradoMs, // instante en que se creó el registro — distinto de inicioMs (el turno)
    detalleSesion: d.detalleSesion || null,
    fechaIncompleta: !fecha || !hora || inicioMs === null,
  };
}

// ── Agenda combinada, ordenada cronológicamente ─────────────────────────
export function construirAgenda(itemsReservas, itemsConsultas) {
  const todos = [...itemsReservas, ...itemsConsultas];
  return todos.slice().sort((a, b) => {
    const ka = a.inicioMs ?? Infinity;
    const kb = b.inicioMs ?? Infinity;
    if (ka !== kb) return ka - kb;
    return (a.id || "").localeCompare(b.id || "");
  });
}

// ── Próxima reserva ──────────────────────────────────────────────────────
export function obtenerProximaReserva(agenda, ahoraMs = Date.now()) {
  const candidatas = agenda.filter((it) => it.activa && it.finMs !== null && it.finMs > ahoraMs);
  if (!candidatas.length) return null;
  return candidatas.reduce((min, it) => (it.inicioMs < min.inicioMs ? it : min));
}

// ── Bandeja de revisiones ────────────────────────────────────────────────
// Toda reserva/consulta ACTIVA cuyo inicio cae dentro de la ventana previa
// (VENTANA_REVISION_MS) entra a la bandeja como "revisar confirmación",
// porque ninguna colección de este proyecto tiene hoy un campo que registre
// que la paciente confirmó que va a venir (ver auditoría: 'estado:
// confirmado' solo significa "no cancelada"). No hay estado persistido de
// la revisión en Firestore: se recalcula siempre desde los datos vivos, así
// que una reprogramación, cancelación o borrado se reflejan solos en la
// próxima pasada — no hace falta "descartar" nada a mano.
export function calcularRevision(item, ahoraMs = Date.now()) {
  if (!item.activa) return null;
  if (item.inicioMs === null) return null; // sin fecha/hora utilizable — no se puede ubicar en el tiempo
  if (item.finMs !== null && item.finMs <= ahoraMs) return null; // ya pasó
  const ventanaDesde = item.inicioMs - VENTANA_REVISION_MS;
  if (ahoraMs < ventanaDesde) return null; // todavía no entra a la ventana de revisión

  const motivos = [];
  motivos.push({
    tipo: "sin_confirmacion",
    texto: "Sin registro de confirmación de la paciente — revisar antes del turno.",
  });
  // "Sin teléfono" es real solo si NI el documento NI clients/{dni} lo
  // tienen — normalizarItemAgenda ya aplicó ese fallback antes de llegar
  // acá, así que este motivo ahora sí bloquea de verdad la acción (punto 3:
  // "un dato faltante debe bloquear la acción que lo necesita").
  if (!item.telefono) {
    motivos.push({ tipo: "sin_telefono", texto: "Sin teléfono registrado (ni en el turno ni en la ficha) — no se puede preparar WhatsApp." });
  }
  if (item.duracionEstimada) {
    motivos.push({ tipo: "duracion_estimada", texto: `Duración no registrada — se estima ${DURACION_DEFECTO_MIN} min.` });
  }

  return {
    item,
    motivos,
    bloqueado: !item.telefono,
    venceEnMs: item.inicioMs, // referencia: al llegar la hora del turno, deja de tener sentido "revisar antes"
  };
}

// ── Turno pasado sin revisar ──────────────────────────────────────────────
// Distinto de calcularRevision: acá el turno YA terminó y sigue sin ninguna
// nota de atención (detalleSesion) — punto 3: "turno cuyo estado operativo
// requiere revisión" → "Revisar/actualizar estado", nunca "asumir asistencia
// ni realización por haber pasado la hora". Se cierra únicamente cuando
// alguien carga detalleSesion por la vía admin ya existente — esta función
// nunca lo asume ni lo completa sola.
export function calcularRevisarTurnoPasado(item, ahoraMs = Date.now()) {
  if (!item.activa) return null; // una cancelación no "requiere revisión de asistencia"
  if (item.inicioMs === null) return null;
  if (item.finMs === null || item.finMs > ahoraMs) return null; // todavía no pasó
  if (item.detalleSesion) return null; // ya tiene nota registrada — ya se revisó
  return {
    item,
    texto: "El turno ya pasó y no tiene nota de atención registrada — revisar/actualizar su estado.",
  };
}

export function obtenerBandejaRevisiones(agenda, ahoraMs = Date.now()) {
  return agenda
    .map((it) => calcularRevision(it, ahoraMs))
    .filter(Boolean)
    .sort((a, b) => a.item.inicioMs - b.item.inicioMs);
}

// ── Texto para WhatsApp manual ───────────────────────────────────────────
// Solo arma el texto; abrir wa.me y decidir enviar es responsabilidad de
// quien usa el módulo. No hay ninguna llamada a la API de Meta acá.
export function construirTextoConfirmacion(item) {
  const nombre = item.nombre || "Paciente";
  const primerNombre = nombre.split(" ")[0] || nombre;
  const fechaLegible = item.fecha || "fecha a confirmar";
  const horaLegible = item.hora ? `${item.hora} hs` : "horario a confirmar";
  const servicio = item.servicio ? ` para ${item.servicio}` : "";
  return `Hola ${primerNombre}! Te escribimos de Espacio Mimar T para confirmar tu turno${servicio} el ${fechaLegible} a las ${horaLegible}. ¿Podés confirmarnos si venís? ¡Gracias!`;
}

export function normalizarTelefonoWA(telefono) {
  let d = (telefono || "").toString().replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("549") && d.length >= 12) return d;
  if (d.startsWith("54") && d.length >= 11) return "549" + d.slice(2);
  if (d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) return "549" + d;
  if (d.length === 11 && d.startsWith("9")) return "54" + d;
  return "549" + d;
}

// ── Config central del responsable del negocio (Gimena) — punto 9 ────────
// Valida y normaliza un celular argentino al formato de wa.me (13 dígitos:
// 549 + código de área + línea, sin 0/15) y arma una versión legible para
// mostrar en la vista previa. Rechaza explícitamente lo que no cierre en
// 13 dígitos — nunca guarda ni abre un chat con un destino a medio normalizar.
// El corte "3 dígitos de área + resto" es una simplificación deliberada para
// el área real del negocio (376, Corrientes/Misiones); no es un formateador
// general de todos los códigos de área argentinos.
export function validarYNormalizarTelefonoAR(raw) {
  const original = (raw || "").toString().trim();
  if (!original) return { ok: false, error: "Ingresá un número de celular." };
  const digitos = normalizarTelefonoWA(original);
  if (digitos.length !== 13 || !digitos.startsWith("549")) {
    return { ok: false, error: `"${original}" no se pudo normalizar a un celular argentino válido (esperado: código de área + línea, 10 dígitos en total).` };
  }
  const resto = digitos.slice(3);
  const area = resto.slice(0, 3);
  const linea = resto.slice(3);
  const mostrable = `+54 9 ${area} ${linea}`;
  return { ok: true, digitos, mostrable, original };
}

// ── Plantillas de mensaje (punto 7) ──────────────────────────────────────
// Texto plano con *negritas* estilo WhatsApp y saltos de línea reales — sin
// HTML, sin colores, sin nada que WhatsApp no pueda mostrar. Firma fija
// "Espacio Mimar T" en todas. Se arman acá (no en el HTML) para poder
// probarlas sin DOM y para que admin.html/depilacion.html/kit-facial.html
// las reusen si hace falta.

export function construirTextoRecordatorio(item) {
  const nombre = item.nombre || "Paciente";
  const primerNombre = nombre.split(" ")[0] || nombre;
  const fechaLegible = item.fecha || "fecha a confirmar";
  const horaLegible = item.hora ? `${item.hora} hs` : "horario a confirmar";
  const servicio = item.servicio ? ` para ${item.servicio}` : "";
  return `Hola ${primerNombre} 🤍\n\nTe recordamos tu turno${servicio} *mañana ${fechaLegible} a las ${horaLegible}* en Espacio Mimar T.\n\n¡Te esperamos!\n\n*Espacio Mimar T*`;
}

export function construirTextoCumpleanos(nombre) {
  const primerNombre = (nombre || "Paciente").split(" ")[0] || nombre;
  return `¡Feliz cumpleaños, ${primerNombre}! 🎂🤍\n\nDesde Espacio Mimar T te deseamos un día hermoso. Gracias por ser parte de nuestra comunidad.\n\n*Espacio Mimar T*`;
}

export function construirTextoConsulta(item) {
  const nombre = item.nombre || "Paciente";
  const primerNombre = nombre.split(" ")[0] || nombre;
  const fechaLegible = item.fecha || "fecha a confirmar";
  const horaLegible = item.hora ? `${item.hora} hs` : "horario a confirmar";
  return `Hola ${primerNombre} 🤍\n\nTe confirmamos tu *consulta inicial* en Espacio Mimar T para el ${fechaLegible} a las ${horaLegible}.\n\nCualquier duda, escribinos por acá.\n\n*Espacio Mimar T*`;
}

export function construirTextoKit(nombre) {
  const primerNombre = (nombre || "Paciente").split(" ")[0] || nombre;
  return `Hola ${primerNombre} 🤍\n\nTu kit ya está listo para retirar en Farmacia Central, de 08:00 a 12:00 y de 16:00 a 20:00.\n\nSi tenés envases vacíos de productos anteriores, te agradecemos que los traigas para reciclarlos. 💚\n\n*Espacio Mimar T*`;
}

// ── Estado de contacto por WhatsApp (punto 3) ────────────────────────────
// Combina un item de agenda con su doc de contactosWhatsApp (si existe) en
// un estado para mostrar en pantalla. Nunca inventa "enviado" — si no hay
// doc de contacto, el estado es "pendiente" explícito, no vacío ni null.
//
// Identidad versionada por ocurrencia (GlowUp): un turno reprogramado
// (misma reserva, nueva fecha/hora) NO hereda el "enviado" de la fecha
// vieja — la confirmación que se mandó fue para OTRA cita. Se agrega un
// sufijo de ocurrencia solo para "confirmacion"/"consulta" (los únicos
// tipos ligados a una fecha/hora puntual de un turno); "kit" no tiene
// fecha propia y sigue igual que siempre. Los contactos YA registrados
// con el id viejo (sin sufijo) NUNCA se borran ni se migran — quedan como
// historial de esa ocurrencia anterior; un pendiente de la ocurrencia
// NUEVA simplemente usa un id nuevo, por diseño (mismo principio que
// activityLog: nunca se pierde una novedad, solo se deja de consultar).
export function docIdVersionadoContacto(id, tipoMensaje, fecha, hora) {
  if ((tipoMensaje === "confirmacion" || tipoMensaje === "consulta") && fecha && hora) {
    return `${id}__${fecha}_${hora}`;
  }
  return id;
}

// Cumpleaños: mismo principio pero por AÑO, no por fecha/hora — un saludo
// ya enviado el año pasado no cuenta como "ya contactado" este año.
export function docIdVersionadoCumpleanos(clientId, fechaISO) {
  const anio = (fechaISO || "").slice(0, 4);
  return anio ? `${clientId}__${anio}` : clientId;
}

export function idContactoParaItem(item, tipoMensaje) {
  const docId = docIdVersionadoContacto(item.id, tipoMensaje, item.fecha, item.hora);
  return `${item.coleccion}_${docId}_${tipoMensaje}`;
}

export function estadoContacto(contactoDoc) {
  return contactoDoc?.estado || "pendiente";
}

export function etiquetaEstadoContacto(estado) {
  switch (estado) {
    case "preparado": return "Texto preparado / WhatsApp abierto";
    case "enviado": return "Enviado según registro del operador";
    case "no_enviado": return "No enviado según registro del operador";
    default: return "Pendiente de contacto";
  }
}

// "Vencido" = sigue sin estado "enviado" y ya estamos a menos de plazoMs del
// turno (o el turno ya pasó). plazoMs configurable — no hay un valor
// hardcodeado "correcto" para todas las estéticas.
export function contactoVencido(item, contactoDoc, plazoMs, ahoraMs = Date.now()) {
  const estado = estadoContacto(contactoDoc);
  if (estado === "enviado") return false;
  if (item.inicioMs === null) return false; // sin fecha/hora utilizable, no se puede evaluar plazo
  return (item.inicioMs - ahoraMs) <= plazoMs;
}

// ── Pedidos de kit — transformación centralizada (punto 2) ───────────────
// Este negocio solo opera en pesos argentinos — no hay ni un solo pedido con
// otra moneda en la auditoría de datos reales, así que formatear en ARS no
// es "inventar" un dato, es la única moneda que este comercio usa. Si algún
// día aparece un campo `moneda` explícito, se respeta por sobre el default.
export function formatearARS(valor) {
  if (typeof valor !== "number" || !Number.isFinite(valor)) return null;
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(valor);
}

// Convierte productosDetalle (una entrada por unidad, sin campo de cantidad
// propio — confirmado en la auditoría: sumar sus "precio" da exactamente
// totalPedido) en líneas agrupadas por producto con cantidad y subtotal.
function agruparItems(productosDetalle) {
  if (!Array.isArray(productosDetalle) || !productosDetalle.length) return null;
  const porNombre = new Map();
  for (const p of productosDetalle) {
    const nombre = (p?.nombre || "Producto sin nombre").trim();
    const precio = Number(p?.precio);
    const precioValido = Number.isFinite(precio);
    const clave = `${nombre}::${precioValido ? precio : "?"}`;
    if (!porNombre.has(clave)) porNombre.set(clave, { nombre, precioUnitario: precioValido ? precio : null, cantidad: 0, subtotal: 0, subtotalCompleto: precioValido });
    const linea = porNombre.get(clave);
    linea.cantidad += 1;
    if (precioValido) linea.subtotal += precio;
  }
  return Array.from(porNombre.values());
}

// No inventa ningún dato: cada campo ausente en Firestore llega como null y
// la interfaz decide cómo mostrarlo ("No registrado"), nunca un 0 ni un ""
// que se puedan confundir con un valor real. El total y los precios son los
// que se guardaron en el momento del pedido — nunca se recalculan contra el
// catálogo actual, así que un cambio de precio después no altera un pedido
// histórico.
export function normalizarPedidoKit(id, data) {
  const d = data || {};
  const nombre = d.nombrePaciente || d.nombre || "Paciente";
  const telefono = d.phone || d.telefono || null;
  const items = agruparItems(d.productosDetalle);
  const cantidadTotal = items ? items.reduce((acc, it) => acc + it.cantidad, 0) : null;

  const totalRegistrado = typeof d.totalPedido === "number" && Number.isFinite(d.totalPedido) ? d.totalPedido : null;
  const totalCalculado = items && items.every((it) => it.subtotalCompleto) ? items.reduce((acc, it) => acc + it.subtotal, 0) : null;
  // Discrepancia real entre lo guardado y lo que suman sus propios
  // componentes: se señala para revisión, nunca se corrige sola ni se
  // esconde eligiendo un valor por sobre el otro.
  const discrepanciaTotal = totalRegistrado !== null && totalCalculado !== null && totalRegistrado !== totalCalculado
    ? { registrado: totalRegistrado, calculado: totalCalculado }
    : null;
  const total = totalRegistrado !== null ? totalRegistrado : totalCalculado;

  // Ningún campo de pago existe hoy en pedidosKit (auditoría: 0 documentos
  // con montoAbonado/saldoPendiente/estadoPago) — se lee igual por si algún
  // día se agrega, pero nunca se lo infiere del estado de entrega. "Kit
  // entregado" no equivale a "kit pagado".
  const montoAbonado = typeof d.montoAbonado === "number" && Number.isFinite(d.montoAbonado) ? d.montoAbonado : null;
  const saldoPendiente = montoAbonado !== null && total !== null ? total - montoAbonado : null;

  // "fecha" (kit-facial.html) y "createdAt" (admin.html) son ISO strings de
  // dos puntos de escritura distintos del mismo pedido — ninguno de los dos
  // existe siempre en ambos orígenes, así que se toma el primero disponible
  // en vez de asumir un único nombre de campo.
  const fechaPedidoISO = (typeof d.fecha === "string" && d.fecha) ? d.fecha : (typeof d.createdAt === "string" && d.createdAt) ? d.createdAt : null;
  const fechaPedidoMs = fechaPedidoISO ? _msDesde(fechaPedidoISO) : null;

  return {
    id,
    nombre,
    telefono,
    dni: d.dni || null,
    fechaPedidoISO,
    fechaPedidoMs,
    fechaPedido: fechaPedidoMs !== null ? formatearFechaHoraLocal(fechaPedidoMs) : null,
    productosResumen: Array.isArray(d.productos) && d.productos.length ? d.productos : null,
    items,
    cantidadTotal,
    moneda: d.moneda || "ARS",
    total,
    totalTexto: total !== null ? formatearARS(total) : "No registrado",
    discrepanciaTotal,
    descuento: typeof d.descuento === "number" ? d.descuento : null,
    entrega: d.entrega || d.lugarEntrega || null,
    observaciones: d.observaciones || d.notas || null,
    estadoPedido: d.estado || null,
    montoAbonado,
    montoAbonadoTexto: montoAbonado !== null ? formatearARS(montoAbonado) : "No registrado",
    saldoPendiente,
    saldoPendienteTexto: saldoPendiente !== null ? formatearARS(saldoPendiente) : "No registrado",
  };
}

// ── Estado temporal de un turno — nunca "realizada" solo por la fecha ────
// admin.html clasifica reservas pasadas como "realizada" con solo comparar
// fechas (ver su propio comentario "Clasificación única de estado"), pero
// eso es justamente lo que este módulo no debe hacer: la única evidencia
// real de que algo pasó en la consulta/sesión es que exista detalleSesion
// (una nota escrita a mano por la profesional). Sin esa nota, un turno
// pasado queda descrito como "pasado", nunca como "realizado".
export function estadoTemporalTurno(item, ahoraMs = Date.now()) {
  if (item.inicioMs === null) return "sin_fecha";
  if (item.finMs !== null && item.finMs <= ahoraMs) return "pasado";
  if (item.inicioMs <= ahoraMs) return "en_curso";
  return "proximo";
}

export function etiquetaEstadoTemporal(estadoTemporal) {
  switch (estadoTemporal) {
    case "pasado": return "Turno pasado";
    case "en_curso": return "En curso";
    case "proximo": return "Próximo";
    default: return "Sin fecha registrada";
  }
}

// ── Agrupar eventos de actividad por Hoy / Ayer / Anteriores (punto 4) ───
// Recibe eventos ya con timestampMs resuelto (la conversión de Timestamp de
// Firestore a milisegundos es responsabilidad de quien llama, no de esta
// función pura). El orden interno de cada grupo se conserva tal cual llega
// — se asume ya vienen ordenados desc por el propio query.
export function agruparPorDia(eventos, ahoraMs = Date.now()) {
  const hoyISO = fechaISOEnZona(ahoraMs);
  const ayerISO = sumarDiasISO(hoyISO, -1);
  const grupos = { hoy: [], ayer: [], anteriores: [] };
  for (const ev of eventos) {
    if (ev.timestampMs == null) { grupos.anteriores.push(ev); continue; }
    const fechaEv = fechaISOEnZona(ev.timestampMs);
    if (fechaEv === hoyISO) grupos.hoy.push(ev);
    else if (fechaEv === ayerISO) grupos.ayer.push(ev);
    else grupos.anteriores.push(ev);
  }
  return grupos;
}

// ── Filtro de actividad (categoría / estado / fecha) ─────────────────────
// filtro = { categoria: 'todas'|coleccion, estado: 'todos'|'pendiente'|'atendido', fechaDesde, fechaHasta }
// Un filtro vacío/"todas" no descarta nada — nunca hace falta "resetear" en
// el sentido de recargar, alcanza con volver a este mismo estado neutro.
export const FILTRO_ACTIVIDAD_VACIO = { categoria: "todas", estado: "todos", fechaDesde: null, fechaHasta: null };

export function eventoCoincideFiltro(evento, filtro) {
  const f = filtro || FILTRO_ACTIVIDAD_VACIO;
  if (f.categoria && f.categoria !== "todas" && evento.coleccion !== f.categoria) return false;
  if (f.estado && f.estado !== "todos") {
    const atendido = !!evento.atendido;
    if (f.estado === "atendido" && !atendido) return false;
    if (f.estado === "pendiente" && atendido) return false;
  }
  if (f.fechaDesde || f.fechaHasta) {
    if (evento.timestampMs == null) return false; // sin fecha no se puede ubicar en un rango de fechas
    const fechaEv = fechaISOEnZona(evento.timestampMs);
    if (f.fechaDesde && fechaEv < f.fechaDesde) return false;
    if (f.fechaHasta && fechaEv > f.fechaHasta) return false;
  }
  return true;
}

export function filtroEsNeutro(filtro) {
  const f = filtro || FILTRO_ACTIVIDAD_VACIO;
  return (!f.categoria || f.categoria === "todas") && (!f.estado || f.estado === "todos") && !f.fechaDesde && !f.fechaHasta;
}

// ══════════════════════════════════════════════════════════════════════
// GlowUp — regla canónica de "pendientes" (punto 3 del pedido)
// ══════════════════════════════════════════════════════════════════════
// Un "pendiente" es una ACCIÓN real que alguien tiene que hacer, no un
// evento del feed de Actividad. Esta es la ÚNICA función que decide qué
// es un pendiente, desde cuándo y por qué — Inicio, Pendientes y el job
// horario de avisos la usan igual (ver espejo en
// functions/pendientes-logic.js, en CommonJS porque functions/index.js no
// puede importar ESM sin migrar todo el proyecto de Functions — mismo
// conjunto de reglas, verificado con pruebas paralelas en ambos lados).
//
// Tabla de reglas por tipo (fuente · activación · vencimiento · cierre):
//   confirmacion_turno — reservas/consultas activas · ventana de 24 h antes
//     del turno (calcularRevision) · vence al empezar el turno · se cierra
//     cuando el contacto de ESA ocurrencia (id versionado por fecha/hora)
//     queda en estado "enviado". Si no hay teléfono resoluble (ni propio ni
//     por clients/{dni}), queda bloqueado=true y NUNCA se cierra solo.
//   revisar_turno — reservas/consultas activas cuyo horario YA PASÓ y no
//     tienen detalleSesion · habilitado al terminar el turno · sin
//     vencimiento propio · se cierra cuando alguien carga detalleSesion por
//     la vía admin existente (no es una escritura nueva de esta app).
//   kit_pendiente — pedidosKit con estado "pendiente" · habilitado apenas
//     se crea · sin vencimiento propio (antigüedad = prioridad) · se
//     cierra cuando estado pasa a "entregado" (ya lo maneja el negocio,
//     fuera de esta app).
//   cumpleanos — resumenesCumpleanos/{hoy}.personas · habilitado desde que
//     se genera el resumen del día · vence al terminar el día · se cierra
//     cuando el contacto de ESE año (id versionado por año) queda
//     "enviado".
//   recomendacion — recomendacionesInteligente, creada a mano por la
//     administradora · habilitada desde programadoParaMs · sin
//     vencimiento propio (la prioridad la fija la antigüedad) · se cierra
//     cuando su propio estado pasa a "enviada" o "descartada" (campo
//     propio del documento, no depende de contactosWhatsApp).
//
// Ninguna de estas reglas cuenta un turno pasado como "atendido": eso lo
// decide solo un contacto realmente registrado, una nota de sesión cargada
// por la vía admin o, en el caso del kit, el propio cambio de estado del
// pedido — nunca la fecha.
export const TIPOS_PENDIENTE = ["recomendacion", "confirmacion_turno", "revisar_turno", "kit_pendiente", "cumpleanos"];

export const ETIQUETA_TIPO_PENDIENTE = {
  recomendacion: "Recomendación", confirmacion_turno: "Confirmación de turno",
  revisar_turno: "Revisar turno", kit_pendiente: "Pedido de kit", cumpleanos: "Cumpleaños",
};

// Orden de prioridad cuando dos pendientes vencen al mismo tiempo (o
// ninguno tiene vencimiento) — las recomendaciones primero porque es el
// pedido explícito de esta vuelta ("especialmente enviar recomendaciones").
const ORDEN_TIPO = { recomendacion: 0, confirmacion_turno: 1, revisar_turno: 2, kit_pendiente: 3, cumpleanos: 4 };

function estadoContactoResuelto(contactosPorId, idContacto) {
  return estadoContacto(contactosPorId?.[idContacto]) === "enviado";
}

// ── Día/franja para agrupar Pendientes (puntos 16-17) ───────────────────
// Corte configurable mañana/tarde — si no hay uno configurado en el
// negocio, se documenta 12:00 como valor inicial (mismo criterio que el
// resto del proyecto: un default explícito y documentado, no un número
// mágico sin explicar).
export const CORTE_MANANA_TARDE_DEFECTO = "12:00";

export function franjaDeHora(hora, corte = CORTE_MANANA_TARDE_DEFECTO) {
  if (!hora) return null;
  return hora < corte ? "mañana" : "tarde";
}

// Fecha (ISO) en la que corresponde AVISAR un turno, según su franja:
// turno de mañana → la noche del día calendario anterior; turno de tarde
// → el mismo día, al mediodía (antes de la hora del turno). No confunde
// "mañana" franja con "mañana" día siguiente — acá siempre se devuelve
// una fecha ISO concreta, nunca la palabra.
export function fechaAvisoConfirmacion(fechaTurnoISO, horaTurno, corte = CORTE_MANANA_TARDE_DEFECTO) {
  if (!fechaTurnoISO) return null;
  return franjaDeHora(horaTurno, corte) === "mañana" ? sumarDiasISO(fechaTurnoISO, -1) : fechaTurnoISO;
}

// agenda: salida de construirAgenda(). pedidosKitPendientes: fuentes.pedidosKit.items
// (ya filtrados por estado "pendiente" en la propia query). cumpleanosHoy:
// el doc resumenesCumpleanos/{hoy} tal cual llega (o null si no cargó
// todavía). recomendaciones: lista de recomendacionesInteligente ya
// normalizadas (ver normalizarRecomendacion). contactosPorId: mismo mapa
// que ya arma mimar-inteligente.js desde contactosWhatsApp.
export function derivarPendientes({ agenda, pedidosKitPendientes, cumpleanosHoy, recomendaciones, contactosPorId }, ahoraMs = Date.now()) {
  const pendientes = [];

  for (const revision of obtenerBandejaRevisiones(agenda, ahoraMs)) {
    const item = revision.item;
    const tipoMensaje = item.coleccion === "consultas" ? "consulta" : "confirmacion";
    const idContactoRef = idContactoParaItem(item, tipoMensaje);
    if (estadoContactoResuelto(contactosPorId, idContactoRef)) continue;
    // fechaActuarISO/franja (puntos 16-17): día y franja en que corresponde
    // AVISAR este turno, separado de item.fecha (el turno en sí) y de
    // item.registradoMs (cuándo se originó la reserva/consulta).
    const franjaConf = franjaDeHora(item.hora);
    pendientes.push({
      id: `pend_${item.coleccion}_${item.id}_confirmacion_${item.fecha}_${item.hora}`,
      tipo: "confirmacion_turno", coleccion: item.coleccion, docId: item.id,
      nombre: item.nombre || "Paciente",
      motivo: revision.motivos.map((m) => m.texto).join(" "),
      habilitadoDesdeMs: item.inicioMs - VENTANA_REVISION_MS, venceMs: revision.venceEnMs,
      ocurrencia: { fecha: item.fecha, hora: item.hora },
      fechaActuarISO: fechaAvisoConfirmacion(item.fecha, item.hora), franja: franjaConf,
      fechaOrigenISO: item.registradoMs != null ? fechaISOEnZona(item.registradoMs) : null,
      bloqueado: revision.bloqueado, campoFaltante: revision.bloqueado ? "telefono" : null,
    });
  }

  for (const rt of agenda.map((it) => calcularRevisarTurnoPasado(it, ahoraMs)).filter(Boolean)) {
    const item = rt.item;
    pendientes.push({
      id: `pend_${item.coleccion}_${item.id}_revisar_${item.fecha}_${item.hora}`,
      tipo: "revisar_turno", coleccion: item.coleccion, docId: item.id,
      nombre: item.nombre || "Paciente",
      motivo: rt.texto,
      habilitadoDesdeMs: item.finMs, venceMs: null, ocurrencia: { fecha: item.fecha, hora: item.hora },
      // Se agrupa por el día en que terminó el turno (ya pasado) — no tiene
      // franja mañana/tarde propia, es "a revisar" desde que se habilita.
      fechaActuarISO: item.finMs != null ? fechaISOEnZona(item.finMs) : item.fecha, franja: null,
      fechaOrigenISO: item.fecha || null,
      bloqueado: false, campoFaltante: null,
    });
  }

  for (const kit of (pedidosKitPendientes || [])) {
    const productos = kit.productosResumen ? kit.productosResumen.join(", ")
      : (kit.items ? kit.items.map((it) => it.nombre).join(", ") : null);
    // La referencia inicial para actuar es la fecha de SOLICITUD (punto 16):
    // si pasan días sin atenderlo, conserva su origen real en vez de
    // reaparecer como si se hubiera pedido hoy.
    const fechaSolicitudISO = kit.fechaPedidoMs != null ? fechaISOEnZona(kit.fechaPedidoMs) : null;
    pendientes.push({
      id: `pend_pedidosKit_${kit.id}_kit`,
      tipo: "kit_pendiente", coleccion: "pedidosKit", docId: kit.id,
      nombre: kit.nombre || "Paciente",
      motivo: productos ? `Pedido sin entregar: ${productos}.` : "Pedido de kit todavía sin entregar.",
      habilitadoDesdeMs: null, venceMs: null, ocurrencia: null,
      fechaActuarISO: fechaSolicitudISO, franja: null, fechaOrigenISO: fechaSolicitudISO,
      bloqueado: false, campoFaltante: null,
    });
  }

  if (cumpleanosHoy?.estado === "ok") {
    for (const persona of (cumpleanosHoy.personas || [])) {
      const idContactoRef = `clients_${docIdVersionadoCumpleanos(persona.clientId, cumpleanosHoy.fecha)}_cumpleanos`;
      if (estadoContactoResuelto(contactosPorId, idContactoRef)) continue;
      pendientes.push({
        id: `pend_clients_${persona.clientId}_cumpleanos_${cumpleanosHoy.fecha}`,
        tipo: "cumpleanos", coleccion: "clients", docId: persona.clientId,
        nombre: persona.nombre || "Paciente",
        motivo: "Hoy cumple años — falta preparar el saludo.",
        habilitadoDesdeMs: null, venceMs: null, ocurrencia: { fecha: cumpleanosHoy.fecha },
        fechaActuarISO: cumpleanosHoy.fecha, franja: null, fechaOrigenISO: cumpleanosHoy.fecha,
        bloqueado: false, campoFaltante: null,
      });
    }
  }

  for (const rec of (recomendaciones || [])) {
    if (rec.estado !== "pendiente") continue; // "enviada"/"descartada" ya está resuelta por su propio estado
    if (rec.programadoParaMs != null && rec.programadoParaMs > ahoraMs) continue; // todavía no habilitada
    pendientes.push({
      id: `pend_recomendacion_${rec.id}`,
      tipo: "recomendacion", coleccion: "recomendacionesInteligente", docId: rec.id,
      nombre: rec.pacienteNombre || "Paciente",
      motivo: rec.motivo || "Recomendación programada por la administradora.",
      habilitadoDesdeMs: rec.programadoParaMs, venceMs: null, ocurrencia: null,
      // Sin programación explícita, ya está habilitada "ahora" — se agrupa en Hoy.
      fechaActuarISO: rec.programadoParaMs != null ? fechaISOEnZona(rec.programadoParaMs) : fechaISOEnZona(ahoraMs), franja: null,
      fechaOrigenISO: null,
      bloqueado: false, campoFaltante: null,
    });
  }

  return pendientes.sort((a, b) => {
    const va = a.venceMs ?? Infinity, vb = b.venceMs ?? Infinity;
    if (va !== vb) return va - vb;
    return (ORDEN_TIPO[a.tipo] ?? 9) - (ORDEN_TIPO[b.tipo] ?? 9);
  });
}

// Agrupa por tipo con las cantidades — texto pedido explícitamente:
// ── Agrupar Pendientes por día de actuar (puntos 16-17) ──────────────────
// A diferencia de agruparPorDia (Actividad — mira hacia atrás: hoy/ayer/
// anteriores), esta agrupación mira hacia ADELANTE: hoy / mañana (día
// siguiente) / anteriores pendientes (atrasados, se muestran igual) /
// próximos días. Nunca usa una sola "fecha" ambigua: agrupa siempre por
// fechaActuarISO, que cada pendiente ya trae resuelto según su tipo.
export function agruparPendientesPorDia(pendientes, ahoraMs = Date.now()) {
  const hoyISO = fechaISOEnZona(ahoraMs);
  const mananaISO = sumarDiasISO(hoyISO, 1);
  const grupos = { hoy: [], manana: [], anteriores: [], proximos: [] };
  for (const p of pendientes) {
    const f = p.fechaActuarISO;
    if (f == null || f === hoyISO) grupos.hoy.push(p);
    else if (f === mananaISO) grupos.manana.push(p);
    else if (f < hoyISO) grupos.anteriores.push(p);
    else grupos.proximos.push(p);
  }
  // "Anteriores pendientes" y "Próximos días" van desglosados por fecha real
  // (nunca mezclados en un bloque ambiguo) — se ordenan cronológicamente.
  const porFecha = (lista) => {
    const mapa = new Map();
    for (const p of lista) {
      const clave = p.fechaActuarISO || "sin_fecha";
      if (!mapa.has(clave)) mapa.set(clave, []);
      mapa.get(clave).push(p);
    }
    return [...mapa.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  };
  return {
    hoyISO, mananaISO,
    hoy: grupos.hoy,
    manana: grupos.manana,
    anterioresPorFecha: porFecha(grupos.anteriores),
    proximosPorFecha: porFecha(grupos.proximos),
  };
}

// Texto de tarjeta sin la ambigüedad "vence mañana a las X" (punto 16):
// separa siempre la palabra relativa del día calendario y la fecha exacta,
// y NUNCA usa "vence" para la hora de un turno (sólo para un vencimiento
// real de negocio, que este tipo de pendiente no tiene).
export function textoTurnoConDia(item, ahoraMs = Date.now()) {
  const hoyISO = fechaISOEnZona(ahoraMs);
  const fecha = item.ocurrencia?.fecha;
  const hora = item.ocurrencia?.hora;
  if (!fecha) return "Turno sin fecha registrada.";
  const inicioMs = inicioTurnoMs(fecha, hora || "00:00");
  const diaSemana = DIAS_SEMANA_LARGO[new Date(`${fecha}T12:00:00${OFFSET_AR}`).getDay()];
  const fechaLegible = inicioMs != null ? formatearFechaLocal(inicioMs) : fecha;
  const horaTxt = hora ? `, ${hora}` : "";
  if (fecha < hoyISO) return `La consulta fue el ${diaSemana} ${fechaLegible}${horaTxt} hs; revisar.`;
  const relativo = fecha === hoyISO ? "hoy" : fecha === sumarDiasISO(hoyISO, 1) ? "mañana" : `el ${diaSemana}`;
  return `Consulta: ${relativo}, ${diaSemana} ${fechaLegible}${horaTxt} hs.`;
}
const DIAS_SEMANA_LARGO = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

// "Tenés 4 pendientes: 2 recomendaciones, 1 consulta y 1 kit". Se arma acá
// (función pura, testeable) para que el job horario y la UI usen
// exactamente el mismo texto.
const PLURAL_TIPO = {
  recomendacion: ["recomendación", "recomendaciones"],
  confirmacion_turno: ["turno por confirmar", "turnos por confirmar"],
  revisar_turno: ["turno a revisar", "turnos a revisar"],
  kit_pendiente: ["kit", "kits"],
  cumpleanos: ["cumpleaños", "cumpleaños"],
};

export function contarPendientesPorTipo(pendientes) {
  const conteo = {};
  for (const t of TIPOS_PENDIENTE) conteo[t] = 0;
  for (const p of pendientes) conteo[p.tipo] = (conteo[p.tipo] || 0) + 1;
  return conteo;
}

export function resumenTextoPendientes(pendientes) {
  const total = pendientes.length;
  if (!total) return null;
  const conteo = contarPendientesPorTipo(pendientes);
  const partes = TIPOS_PENDIENTE
    .filter((t) => conteo[t] > 0)
    .map((t) => {
      const [singular, plural] = PLURAL_TIPO[t];
      return `${conteo[t]} ${conteo[t] === 1 ? singular : plural}`;
    });
  const listado = partes.length > 1
    ? partes.slice(0, -1).join(", ") + " y " + partes[partes.length - 1]
    : partes[0];
  return `Tenés ${total} pendiente${total === 1 ? "" : "s"}: ${listado}.`;
}

// ── Informe general de actividad para Gimena (punto 11) ──────────────────
// Combina el historial estructurado de activityLog (conteo por colección —
// nunca reinterpreta el texto libre de "resumen") con los totales
// económicos REALES del período: cobros/devoluciones/gastos pagados vienen
// de pagos/gastos (mismas fórmulas que el resumen mensual de admin.html:
// cobros netos = cobros − devoluciones, neto de caja = cobros netos −
// gastos pagados) — nunca se suman eventos de auditoría como si fueran
// ingresos. Es una función pura: quien llama ya resolvió las consultas a
// Firestore y arma los números reales antes de pasarlos acá.
const ETIQUETA_COLECCION_INFORME = {
  reservas: "turnos/sesiones", consultas: "consultas iniciales", pedidosKit: "pedidos de kit",
  clients: "pacientes", cursoMaquillaje: "curso de automaquillaje", reservasDepi: "depilación",
  prestaciones: "precios registrados", pagos: "cobros/devoluciones", gastos: "gastos",
};
const ORDEN_COLECCION_INFORME = ["reservas", "consultas", "pedidosKit", "prestaciones", "pagos", "gastos", "clients", "cursoMaquillaje", "reservasDepi"];

export function construirInformeGimena({ periodoLabel, fechaDesdeISO, fechaHastaISO, fechaCorteISO, eventos, cobros, devoluciones, gastosPagados }) {
  const listaEventos = eventos || [];
  const porColeccion = new Map();
  for (const e of listaEventos) {
    const k = e.coleccion || "otros";
    if (!porColeccion.has(k)) porColeccion.set(k, []);
    porColeccion.get(k).push(e);
  }
  const cobrosNum = cobros || 0, devolucionesNum = devoluciones || 0, gastosNum = gastosPagados || 0;
  const cobrosNetos = cobrosNum - devolucionesNum;
  const netoCaja = cobrosNetos - gastosNum;

  const lineas = [];
  lineas.push(`Gime, informe de actividad — ${periodoLabel}.`);
  lineas.push(`Período: ${fechaDesdeISO} al ${fechaHastaISO}. Corte: ${fechaCorteISO}.`);
  lineas.push(`Eventos registrados: ${listaEventos.length}.`);

  const partesModulos = [];
  const yaListadas = new Set();
  for (const col of ORDEN_COLECCION_INFORME) {
    const lista = porColeccion.get(col);
    if (lista && lista.length) { partesModulos.push(`${lista.length} ${ETIQUETA_COLECCION_INFORME[col] || col}`); yaListadas.add(col); }
  }
  // Cualquier colección fuera del orden fijo también se informa — nunca se pierde una novedad por no estar en la lista prevista.
  for (const [col, lista] of porColeccion) {
    if (!yaListadas.has(col) && lista.length) partesModulos.push(`${lista.length} ${ETIQUETA_COLECCION_INFORME[col] || col}`);
  }
  if (partesModulos.length) lineas.push(partesModulos.join(", ") + ".");
  else lineas.push("Sin eventos registrados en este período.");

  lineas.push(`Cobros: ${formatearARS(cobrosNum)}. Devoluciones: ${formatearARS(devolucionesNum)}. Cobros netos: ${formatearARS(cobrosNetos)}.`);
  lineas.push(`Gastos pagados: ${formatearARS(gastosNum)}. Neto de caja: ${formatearARS(netoCaja)}.`);

  return {
    resumenWhatsApp: lineas.join("\n"),
    totales: { cobros: cobrosNum, devoluciones: devolucionesNum, cobrosNetos, gastosPagados: gastosNum, netoCaja },
    porColeccionConteo: Object.fromEntries([...porColeccion.entries()].map(([k, v]) => [k, v.length])),
    eventoIds: listaEventos.map((e) => e.id),
  };
}

// ── Recomendaciones (punto 3 — no existía ninguna regla previa en el
// repo, así que esta es una tarea manual explícita: texto editable y
// programación explícita por la administradora, nunca generada sola por
// turno. No inventa indicaciones de tratamiento. ──────────────────────
export function normalizarRecomendacion(id, data) {
  const d = data || {};
  const programadoParaMs = d.programadoPara?.toMillis ? d.programadoPara.toMillis()
    : (typeof d.programadoParaMs === "number" ? d.programadoParaMs : null);
  return {
    id,
    pacienteNombre: d.pacienteNombre || "Paciente",
    telefono: d.telefono || null,
    texto: d.texto || "",
    turnoRef: d.turnoColeccion && d.turnoDocId ? { coleccion: d.turnoColeccion, docId: d.turnoDocId } : null,
    estado: d.estado || "pendiente", // 'pendiente' | 'enviada' | 'descartada'
    programadoParaMs,
    motivo: d.motivo || null,
    creadoPorEmail: d.creadoPorEmail || null,
  };
}

export function recomendacionValida({ pacienteNombre, texto, programadoParaMs }) {
  if (!texto || !texto.trim()) return { ok: false, motivo: "texto_vacio" };
  if (!pacienteNombre || !pacienteNombre.trim()) return { ok: false, motivo: "sin_paciente" };
  if (programadoParaMs != null && !Number.isFinite(programadoParaMs)) return { ok: false, motivo: "fecha_invalida" };
  return { ok: true };
}

// ── Preferencias de avisos horarios (punto 4) ────────────────────────────
// prefs = { activo, categorias:[tipos habilitados], pausadoHastaMs,
//           descansoInicioHora, descansoFinHora } — todo con default
// explícito (activo=true, categorías=todas, sin pausa, sin descanso
// nocturno) para no inventar un horario comercial que nadie configuró.
export const PREFS_AVISOS_DEFECTO = {
  activo: true, categorias: [...TIPOS_PENDIENTE], pausadoHastaMs: null,
  descansoInicioHora: null, descansoFinHora: null,
};

function horaEnZona(ms, timeZone) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hour12: false }).format(ms).replace(/\D/g, "")) % 24;
}

// true si, a esta hora, el aviso debería estar mudo por descanso nocturno
// configurado (ej. 22 a 8 hs). Rango que "cruza medianoche" (inicio > fin)
// se interpreta correctamente (22→8 significa 22,23,0..7).
export function enDescansoNocturno(prefs, ahoraMs = Date.now(), timeZone = ZONA_HORARIA) {
  const { descansoInicioHora: ini, descansoFinHora: fin } = prefs || {};
  if (ini == null || fin == null) return false;
  const h = horaEnZona(ahoraMs, timeZone);
  if (ini === fin) return false; // rango vacío, no es un descanso real
  return ini < fin ? (h >= ini && h < fin) : (h >= ini || h < fin);
}

// Filtra qué pendientes cuentan para EL AVISO (no para la pantalla, que
// siempre muestra todo lo pendiente): categoría habilitada, sin postergar
// más allá de ahora. estadosPend = Map/objeto pendienteId -> { postergadoHastaMs }.
// Filtro de PANTALLA (Inicio/Pendientes): solo postergado/resuelto — nunca
// las preferencias de aviso (categorías desactivadas, pausa, descanso
// nocturno), que son exclusivamente para el PUSH. Ocultar del ojo de la
// administradora un pendiente real solo porque desactivó esa categoría de
// AVISOS sería confundir "no me avises" con "no existe" — dos cosas
// distintas a propósito.
export function pendientesVigentes(pendientes, estadosPend, ahoraMs = Date.now()) {
  return pendientes.filter((p) => {
    const override = estadosPend?.[p.id];
    if (override?.postergadoHastaMs != null && override.postergadoHastaMs > ahoraMs) return false;
    if (override?.resuelto) return false;
    return true;
  });
}

export function pendientesElegiblesParaAviso(pendientes, prefs, estadosPend, ahoraMs = Date.now()) {
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

// ══════════════════════════════════════════════════════════════════════
// Reorganización por secciones + "Avisar a la dueña" (pedido nuevo)
// ══════════════════════════════════════════════════════════════════════
// Estas plantillas son un DESTINATARIO distinto de las de arriba: las de
// arriba (construirTextoConfirmacion/Recordatorio/Cumpleanos/Consulta/Kit)
// se le mandan a LA PACIENTE. Estas se le mandan A LA DUEÑA, para avisarle
// que pasó algo — son mensajes de aviso interno, no de atención al público.
// Es un aviso independiente de la tarea con la paciente (punto 2 del
// pedido): preparar/enviar la confirmación de una consulta y avisarle a la
// dueña que hay una consulta nueva son dos acciones separadas, con su
// propio registro de "ya avisé" (ver idAvisoDueña).

// tipoMensaje fijo, distinto de "confirmacion"/"consulta"/"cumpleanos"/
// "kit" — así el registro de "avisé a la dueña" en contactosWhatsApp NUNCA
// se confunde ni se pisa con el de la tarea con la paciente, aunque sea el
// mismo documento de origen (misma coleccion/docId, tipoMensaje distinto).
export const TIPO_MENSAJE_AVISO_DUENA = "aviso_dueña";

// Igual que idContactoParaItem pero para el aviso a la dueña: usa la misma
// versión por ocurrencia (fecha/hora de turno, año de cumpleaños) que ya
// usa el contacto con la paciente, para que una reprogramación o un cambio
// de año tampoco arrastren un "ya avisé" viejo.
export function docIdVersionadoParaAviso(docId, ocurrencia) {
  if (ocurrencia?.fecha && ocurrencia?.hora) return docIdVersionadoContacto(docId, "confirmacion", ocurrencia.fecha, ocurrencia.hora);
  if (ocurrencia?.fecha && !ocurrencia?.hora) return docIdVersionadoCumpleanos(docId, ocurrencia.fecha);
  return docId;
}

export function idAvisoDuena(coleccion, docId, ocurrencia) {
  return `${coleccion}_${docIdVersionadoParaAviso(docId, ocurrencia)}_${TIPO_MENSAJE_AVISO_DUENA}`;
}

function listaConY(partes) {
  if (!partes.length) return "";
  if (partes.length === 1) return partes[0];
  return partes.slice(0, -1).join(", ") + " y " + partes[partes.length - 1];
}

// kit: salida de normalizarPedidoKit(). Omite campos vacíos (total,
// entrega) en vez de mostrar "No registrado" — un aviso a la dueña no
// necesita remarcar huecos de datos, solo contar lo que sí se sabe.
// Plantilla exacta pedida (punto 10). Usa siempre datos reales de
// normalizarPedidoKit — montoAbonado/saldoPendiente ya vienen en
// "No registrado" cuando Firestore no tiene el campo (nunca se infiere
// deuda ni pago desde el estado de entrega). Ningún campo opcional ausente
// deja una llave, "undefined" ni una línea vacía: si no hay dato, la línea
// directamente no se agrega.
export function construirTextoAvisoDuenaKit(kit) {
  const nombre = kit.nombre || "Paciente";
  const lineas = [`Gime, tenés un pedido de kit de ${nombre}.`];

  const refTemporal = kit.fechaPedidoMs != null ? referenciaTemporalConFecha(kit.fechaPedidoMs) : null;
  const hora = kit.fechaPedidoMs != null ? formatearHoraLocal(kit.fechaPedidoMs) : null;
  if (refTemporal && hora) lineas.push(`Solicitado: ${refTemporal}, a las ${hora}.`);
  else if (refTemporal) lineas.push(`Solicitado: ${refTemporal}.`);
  else lineas.push("Solicitado: fecha no registrada.");

  lineas.push("Productos:");
  lineas.push(kit.items && kit.items.length
    ? kit.items.map((it) => {
        const importe = it.subtotalCompleto ? formatearARS(it.subtotal) : "importe no registrado";
        const cant = it.cantidad > 1 ? `${it.cantidad} × ` : "";
        return `• ${cant}${it.nombre} — ${importe}`;
      }).join("\n")
    : (kit.productosResumen && kit.productosResumen.length ? kit.productosResumen.map((p) => `• ${p}`).join("\n") : "• (sin detalle de productos)"));

  lineas.push(`Total del pedido: ${kit.totalTexto}.`);
  if (kit.discrepanciaTotal) lineas.push(`⚠️ El total registrado (${formatearARS(kit.discrepanciaTotal.registrado)}) no coincide con la suma de los productos (${formatearARS(kit.discrepanciaTotal.calculado)}) — revisar.`);
  lineas.push(`Monto abonado: ${kit.montoAbonadoTexto}.`);
  lineas.push(`Saldo pendiente: ${kit.saldoPendienteTexto}.`);
  lineas.push(`Estado: ${kit.estadoPedido || "pendiente"}.`);
  if (kit.entrega) lineas.push(kit.entrega);
  if (kit.observaciones) lineas.push(`Nota: ${kit.observaciones}`);

  return lineas.join("\n");
}

export function construirTextoAvisoDuenaCumpleanosIndividual(nombre, saludoRealizado) {
  return `🎂 Hoy es el cumpleaños de ${nombre || "una paciente"}.\nSaludo: ${saludoRealizado ? "realizado" : "pendiente"}.`;
}

// personas: cumpleanosHoy.personas (cada una con nombre, clientId).
// pendientesDeSaludar: subconjunto de nombres sin saludo registrado —
// se calcula afuera (con contactosPorId) porque esta función es pura.
export function construirTextoAvisoDuenaCumpleanosDia(personas, nombresPendientes) {
  if (!personas || !personas.length) return "🎂 Hoy no hay cumpleaños.";
  const lista = personas.map((p) => `• ${p.nombre || "Paciente"}`).join("\n");
  const pend = nombresPendientes && nombresPendientes.length ? nombresPendientes.join(", ") : "ninguno";
  return `🎂 Hoy cumplen años:\n${lista}\nPendientes de saludar: ${pend}.`;
}

// item: normalizarItemAgenda() de una consulta. estadoConsulta: salida de
// estadoConsultaInicial() de más abajo, en español, tal cual va al mensaje.
// Dos plantillas distintas (punto 10) según si ya tiene turno asignado
// (fechaIncompleta === false) o es una solicitud todavía sin coordinar
// (fechaIncompleta === true, hoy sin ningún origen real que la produzca en
// el proyecto auditado, pero normalizarItemAgenda ya la contempla si algún
// alta futura crea un documento de consulta sin fecha/hora).
export function construirTextoAvisoDuenaConsulta(item, estadoConsultaTexto) {
  if (item.fechaIncompleta) return construirTextoAvisoDuenaSolicitudConsulta(item);
  return construirTextoAvisoDuenaConsultaAgendada(item, estadoConsultaTexto);
}

export function construirTextoAvisoDuenaConsultaAgendada(item, estadoConsultaTexto) {
  const nombre = item.nombre || "Paciente";
  const lineas = [`Gime, se agendó una consulta inicial para ${nombre}.`];

  const dia = diaSemanaLegible(item.inicioMs);
  const fechaTxt = formatearFechaLocal(item.inicioMs);
  const horaInicio = item.hora ? `${item.hora} hs` : null;
  const horaFin = item.finMs != null ? formatearHoraLocal(item.finMs) : null;
  const dur = item.duracionMinutos || 30;
  if (dia && fechaTxt && horaInicio && horaFin) lineas.push(`Consulta: ${dia} ${fechaTxt}, de ${horaInicio} a ${horaFin} hs — ${dur} minutos.`);
  else if (item.fecha) lineas.push(`Consulta: ${item.fecha}${item.hora ? ` ${item.hora} hs` : ""}.`);

  if (item.registradoMs != null) lineas.push(`Reserva registrada: ${formatearFechaHoraLocal(item.registradoMs)}.`);
  if (item.box) lineas.push(`Box: ${item.box}.`);
  lineas.push(`Estado: ${estadoConsultaTexto || "pendiente"}.`);
  if (item.detalleSesion) lineas.push(item.detalleSesion);

  return lineas.join("\n");
}

// Solicitud de consulta SIN turno todavía coordinado. No inventa un
// patientId: la persona todavía no tiene ficha, se referencia por su
// registro de consulta (item.id).
export function construirTextoAvisoDuenaSolicitudConsulta(item) {
  const nombre = item.nombre || "Paciente";
  const lineas = [`Gime, recibiste una solicitud de consulta inicial de ${nombre}.`];

  lineas.push(item.registradoMs != null
    ? `Solicitud registrada: ${referenciaTemporalConFecha(item.registradoMs)}.`
    : "Solicitud registrada: fecha no registrada.");

  if (item.servicio && item.servicio !== "Consulta Inicial") lineas.push(`Servicio de interés: ${item.servicio}.`);
  lineas.push("Estado: pendiente de coordinación.");
  if (item.telefono) lineas.push(`Teléfono de contacto: ${item.telefono}.`);
  if (item.detalleSesion) lineas.push(item.detalleSesion);

  return lineas.join("\n");
}

// Los otros tipos de movimiento (confirmación de turno común, turno a
// revisar, recomendación) no tienen plantilla propia en el pedido — se
// arma un aviso genérico breve con los mismos datos que ya muestra la
// tarjeta, para no dejar esas categorías sin la acción "Avisar a la dueña".
export function construirTextoAvisoDuenaGenerico(p) {
  const etiqueta = ETIQUETA_TIPO_PENDIENTE[p.tipo] || "Movimiento";
  return `🔔 ${etiqueta}: ${p.nombre || "Paciente"}.\n${p.motivo || ""}`.trim();
}

// Estados de Consultas iniciales (punto 1 del pedido): tres pasos propios,
// distintos del estado de contacto genérico — nunca infiere "confirmada"
// por el paso del tiempo, solo por el campo estadoBruto real del documento
// (mismo criterio que estadoTemporalTurno: no inventar realización).
export const ESTADO_CONSULTA_CANCELADA = "cancelada";
export const ESTADO_CONSULTA_CONFIRMADA = "confirmada";
export const ESTADO_CONSULTA_ESPERANDO = "esperando_respuesta";
export const ESTADO_CONSULTA_PENDIENTE_ENVIO = "pendiente_enviar_confirmacion";

export function estadoConsultaInicial(item, contactoDoc) {
  const bruto = (item.estadoBruto || "").toLowerCase();
  if (bruto === "cancelada" || bruto === "cancelado") return ESTADO_CONSULTA_CANCELADA;
  if (bruto === "confirmada") return ESTADO_CONSULTA_CONFIRMADA;
  const estContacto = estadoContacto(contactoDoc);
  if (estContacto === "preparado" || estContacto === "enviado") return ESTADO_CONSULTA_ESPERANDO;
  return ESTADO_CONSULTA_PENDIENTE_ENVIO;
}

export function etiquetaEstadoConsultaInicial(estado) {
  switch (estado) {
    case ESTADO_CONSULTA_CANCELADA: return "Cancelada";
    case ESTADO_CONSULTA_CONFIRMADA: return "Consulta confirmada";
    case ESTADO_CONSULTA_ESPERANDO: return "Confirmación enviada, esperando respuesta";
    default: return "Pendiente de enviar confirmación";
  }
}

// Cumpleaños de los próximos N días (sección Cumpleaños, "Próximos 7
// días") — se calcula del lado del cliente sobre clientesPorDni, que ya se
// carga completo al iniciar sesión (mismo mapa que usa el fallback de
// teléfono), sin ninguna consulta nueva a Firestore. Compara solo mes/día
// de fechaNacimiento ("YYYY-MM-DD", siempre string en este proyecto — ver
// nota en admin.html) contra cada uno de los próximos `dias` días — nunca
// incluye HOY (eso ya lo cubre resumenesCumpleanos/{hoy}, que además sabe
// distinguir "no se pudo calcular" de "no hay"). 29/02 en año no bisiesto
// simplemente no matchea ningún MM-DD real de ese año — comportamiento
// esperado, no un bug a corregir acá.
export function cumpleanosProximos(clientesPorDni, hoyISO, dias = 7) {
  const objetivo = new Map(); // "MM-DD" -> fechaISO del próximo match
  for (let i = 1; i <= dias; i++) {
    const iso = sumarDiasISO(hoyISO, i);
    objetivo.set(iso.slice(5), iso);
  }
  const resultado = [];
  for (const [clientId, data] of Object.entries(clientesPorDni || {})) {
    const fn = (data?.fechaNacimiento || "").toString().trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fn)) continue;
    const mmdd = fn.slice(5);
    if (!objetivo.has(mmdd)) continue;
    const nombre = data.fullName || data.fullLname || data.nombre || data.name || "Paciente";
    resultado.push({ clientId, nombre, fecha: objetivo.get(mmdd) });
  }
  return resultado.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.nombre.localeCompare(b.nombre));
}

// "Compartir resumen del día" (punto 4): separa categorías, cuenta solo lo
// vigente (ya filtrado afuera por pendientesVigentes). No repite el listado
// completo de cumpleaños/kits/consultas — para eso están sus propias
// secciones; el resumen es un conteo accionable, como pide el punto 1.
export function construirTextoResumenDia(conteo, fechaLegible) {
  const partes = [];
  if (conteo.cumpleanos) partes.push(`🎂 ${conteo.cumpleanos} cumpleaños por saludar`);
  if (conteo.confirmacion_turno) partes.push(`📅 ${conteo.confirmacion_turno} turnos/consultas por confirmar`);
  if (conteo.kit_pendiente) partes.push(`🛍️ ${conteo.kit_pendiente} pedidos de kit por atender`);
  if (conteo.revisar_turno) partes.push(`🔎 ${conteo.revisar_turno} turnos a revisar`);
  if (conteo.recomendacion) partes.push(`💡 ${conteo.recomendacion} recomendaciones pendientes`);
  const cuerpo = partes.length ? partes.map((p) => `• ${p}`).join("\n") : "Sin pendientes accionables en este momento.";
  return `📋 Resumen del día — ${fechaLegible}\n\n${cuerpo}\n\n*Espacio Mimar T*`;
}

// ══════════════════════════════════════════════════════════════════════
// Resumen de jornada — pacientes únicos, cambios de box e historial
// ══════════════════════════════════════════════════════════════════════
// Fuente única: reservas (mismo criterio que window.renderGrilla en
// admin.html — la Grilla tampoco mezcla consultas iniciales, que tienen su
// propio flujo de 30 min separado del circuito de boxes). Cada tramo de
// box es su propio documento de reserva; no existe una colección de
// "sesión clínica" separada (confirmado en el código real, no hay
// `sesiones`/`historiaClinica` — ver auditoría de la tarea). Por eso una
// "sesión" acá se INFIERE encadenando tramos contiguos de la misma
// identidad, nunca se lee de un campo que no existe.

// Identidad estable: DNI si está cargado, si no el nombre normalizado
// (sin tildes, sin mayúsculas) — mismo criterio que _pacienteMatchKey en
// admin.html ("usar SIEMPRE esta clave, nunca comparar nombres tal cual").
// Dos homónimos sin DNI cargado siguen siendo indistinguibles con este
// modelo de datos — limitación heredada, documentada, no algo que esta
// función pueda resolver sin un id de paciente propio en reservas.
function _normalizarNombreParaClave(nombre) {
  return (nombre || "").toString().trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
}
export function pacienteMatchKey(item) {
  const dni = (item?.dni || "").toString().replace(/\D/g, "");
  if (dni) return "dni:" + dni;
  return "nom:" + _normalizarNombreParaClave(item?.nombre);
}

// Margen máximo entre el fin de un tramo y el inicio del siguiente (misma
// identidad, mismo día) para considerarlos la MISMA sesión (ej.: pasa de
// Box 2 a Box 3 para continuar el tratamiento). Un hueco mayor es una
// visita aparte — "el paso de la hora, por sí solo, no acredita que
// llegó" (punto 2 del pedido): sin este margen, dos visitas del mismo día
// separadas por horas (retiro y regreso) se fusionarían solo por
// coincidir en la fecha, exactamente lo que el pedido pide evitar. No hay
// un valor configurado en el negocio para esto — 30 min es un default
// explícito y documentado (tiempo razonable de cambio entre boxes), no un
// número mágico sin explicar.
export const TOLERANCIA_CONTINUIDAD_BOX_MS = 30 * 60000;

// Encadena tramos (reservas ya normalizadas, con inicioMs/finMs/fecha) de
// UNA identidad en sesiones: cada sesión es una cadena de tramos donde
// cada uno empieza a lo sumo `tolerancia` después de que terminó el
// anterior, sin cruzar de un día calendario a otro (nunca se encadena a
// través de la medianoche, aunque el hueco horario "cerrara" por algún
// dato inconsistente). Devuelve un array de sesiones (cada una, un array
// de >=1 tramos), en orden cronológico ascendente.
export function encadenarSesiones(tramos, tolerancia = TOLERANCIA_CONTINUIDAD_BOX_MS) {
  const ordenados = (tramos || []).slice().sort((a, b) => (a.inicioMs ?? Infinity) - (b.inicioMs ?? Infinity));
  const sesiones = [];
  for (const t of ordenados) {
    const sesionActual = sesiones[sesiones.length - 1];
    const anterior = sesionActual ? sesionActual[sesionActual.length - 1] : null;
    const continua = !!(anterior && anterior.finMs != null && t.inicioMs != null
      && t.fecha === anterior.fecha
      && (t.inicioMs - anterior.finMs) <= tolerancia);
    if (continua) sesionActual.push(t);
    else sesiones.push([t]);
  }
  return sesiones;
}

// Agrupa los tramos ACTIVOS de un día en bloques por paciente (punto 2).
// Cada bloque conserva todas sus sesiones encadenadas del día (si hay un
// retiro y regreso, quedan como sesiones separadas DENTRO del mismo
// bloque, sin "Continúa en sede" entre ellas — tal como pide el punto 2).
// franja/cruzaFranja usan el PRIMER ingreso del día (primer tramo con
// inicioMs resuelto), así mañana+tarde suman siempre el total de bloques.
export function agruparBloquesDelDia(reservasActivasDelDia, corte = CORTE_MANANA_TARDE_DEFECTO) {
  const porPaciente = new Map();
  for (const r of (reservasActivasDelDia || [])) {
    const key = pacienteMatchKey(r);
    if (!porPaciente.has(key)) porPaciente.set(key, []);
    porPaciente.get(key).push(r);
  }
  const bloques = [];
  for (const [key, tramosDelPaciente] of porPaciente) {
    const sesiones = encadenarSesiones(tramosDelPaciente);
    const tramosPlanos = [];
    for (const sesion of sesiones) {
      sesion.forEach((t, i) => tramosPlanos.push({ ...t, continuaEnSede: i > 0 }));
    }
    tramosPlanos.sort((a, b) => (a.inicioMs ?? Infinity) - (b.inicioMs ?? Infinity));
    const nombre = tramosDelPaciente.find((t) => t.nombre)?.nombre || "Paciente";
    const primerTramo = tramosPlanos.reduce((min, t) => (t.inicioMs != null && (min == null || t.inicioMs < min.inicioMs) ? t : min), null);
    const franja = primerTramo ? franjaDeHora(primerTramo.hora, corte) : null;
    const franjasPresentes = new Set(tramosPlanos.map((t) => franjaDeHora(t.hora, corte)).filter(Boolean));
    bloques.push({
      pacienteKey: key,
      nombre,
      tramos: tramosPlanos,
      cantidadSesiones: sesiones.length,
      primerIngresoMs: primerTramo ? primerTramo.inicioMs : null,
      franja,
      cruzaFranja: franjasPresentes.size > 1,
    });
  }
  // Orden pedido: por primera llegada. Sin hora resoluble, al final.
  return bloques.sort((a, b) => (a.primerIngresoMs ?? Infinity) - (b.primerIngresoMs ?? Infinity));
}

// Historial obligatorio por paciente (punto 3): recibe TODAS las reservas
// ACTIVAS de esa identidad con fecha ANTERIOR al día seleccionado (ya
// filtradas por quien llama — esta función no sabe nada de Firestore) y
// devuelve las últimas dos sesiones (encadenadas con el mismo criterio de
// arriba, así una sesión que usó varios boxes aparece completa y dos
// visitas independientes que coincidieron en fecha NO se fusionan) más el
// último detalle de sesión no vacío, buscando hacia atrás si las dos
// últimas no tienen texto cargado.
export function historialAnteriorPaciente(reservasPacienteAnteriores) {
  const sesiones = encadenarSesiones(reservasPacienteAnteriores)
    .map((tramos) => ({
      fecha: tramos[0].fecha,
      inicioMs: tramos.reduce((min, t) => (t.inicioMs != null && (min == null || t.inicioMs < min.inicioMs) ? t.inicioMs : min), null),
      tramos: tramos.slice().sort((a, b) => (a.inicioMs ?? Infinity) - (b.inicioMs ?? Infinity)),
    }))
    .sort((a, b) => (b.inicioMs ?? -Infinity) - (a.inicioMs ?? -Infinity)); // más reciente primero

  const ultimasDos = sesiones.slice(0, 2);

  let detalle = null;
  for (const sesion of sesiones) {
    const conDetalle = sesion.tramos.slice().reverse().find((t) => (t.detalleSesion || "").toString().trim());
    if (conDetalle) { detalle = { fecha: sesion.fecha, inicioMs: conDetalle.inicioMs ?? sesion.inicioMs, texto: conDetalle.detalleSesion.toString().trim() }; break; }
  }

  return { sesiones: ultimasDos, detalle };
}

// ── Mensaje de WhatsApp (punto 4) ────────────────────────────────────────
// boxLabelDe: función (id de box) → etiqueta legible, inyectada por quien
// llama (BOX_LABELS vive en la capa de UI, no en esta lógica pura).
function _formatearTramoLinea(t, boxLabelDe) {
  const horaFin = t.finMs != null ? formatearHoraLocal(t.finMs) : "??:??";
  const box = boxLabelDe ? (boxLabelDe(t.box) || t.box || "Box sin asignar") : (t.box || "Box sin asignar");
  const tratamiento = t.servicio || "Tratamiento sin registrar";
  const continua = t.continuaEnSede ? " · Continúa en sede." : "";
  return `*${t.hora}–${horaFin}* · ${tratamiento} · ${box}${continua}`;
}

function _formatearSesionHistorial(sesion, boxLabelDe) {
  const fechaLegible = sesion.inicioMs != null ? formatearFechaLocal(sesion.inicioMs) : sesion.fecha;
  const tramosTxt = sesion.tramos.map((t) => {
    const box = boxLabelDe ? (boxLabelDe(t.box) || t.box || "Box sin asignar") : (t.box || "Box sin asignar");
    return `${t.servicio || "Tratamiento sin registrar"} (${box})`;
  }).join(", ");
  return `• ${fechaLegible} — ${tramosTxt}`;
}

// bloques: salida de agruparBloquesDelDia(). historialPorPaciente: Map
// pacienteKey -> { estado:'ok', ...historialAnteriorPaciente() } |
// { estado:'error', error }. fechaLegible: "jueves 10/09/2026" (día de
// semana + fecha exacta, ya resuelto por quien llama). No inventa ningún
// dato ausente: un historial que falló se marca explícitamente, nunca se
// muestra como "Sin sesiones previas registradas" (eso significa algo
// distinto: se consultó bien y no había nada).
export function construirTextoResumenJornada({ fechaLegible, bloques, historialPorPaciente, boxLabelDe }) {
  const total = bloques.length;
  const manana = bloques.filter((b) => b.franja === "mañana").length;
  const tarde = bloques.filter((b) => b.franja === "tarde").length;

  const lineas = [];
  lineas.push(`Gime, hoy ${fechaLegible} tenés ${total} paciente${total === 1 ? "" : "s"} único${total === 1 ? "" : "s"}: ${manana} ingresa${manana === 1 ? "" : "n"} por la mañana y ${tarde} ingresa${tarde === 1 ? "" : "n"} por la tarde.`);

  const cruzan = bloques.filter((b) => b.cruzaFranja).map((b) => b.nombre);
  if (cruzan.length) lineas.push(`Continúan entre franjas: ${cruzan.join(", ")}.`);

  if (!total) {
    lineas.push("", "No hay pacientes agendados para este día.");
    return lineas.join("\n");
  }

  for (const b of bloques) {
    const bloqueLineas = [`*${b.nombre}*`];
    bloqueLineas.push(...b.tramos.map((t) => _formatearTramoLinea(t, boxLabelDe)));

    const hist = historialPorPaciente?.get(b.pacienteKey);
    bloqueLineas.push("");
    if (!hist || hist.estado === "error") {
      bloqueLineas.push(`⚠️ No se pudo consultar el historial de ${b.nombre}${hist?.error ? ` (${hist.error})` : ""} — no se puede confirmar si tiene sesiones previas.`);
    } else {
      bloqueLineas.push("Últimas sesiones:");
      if (hist.sesiones.length) {
        bloqueLineas.push(...hist.sesiones.map((s) => _formatearSesionHistorial(s, boxLabelDe)));
      } else {
        bloqueLineas.push("Sin sesiones previas registradas.");
      }
      bloqueLineas.push("");
      if (hist.detalle) {
        const fechaDetalle = hist.detalle.inicioMs != null ? formatearFechaLocal(hist.detalle.inicioMs) : hist.detalle.fecha;
        bloqueLineas.push(`*Último detalle registrado — ${fechaDetalle}:*`);
        bloqueLineas.push(hist.detalle.texto);
      } else {
        bloqueLineas.push("Sin detalle previo registrado.");
      }
    }

    lineas.push("", bloqueLineas.join("\n"));
  }

  return lineas.join("\n");
}
