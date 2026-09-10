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
export const VENTANA_REVISION_MS = 4 * 60 * 60 * 1000; // 4 horas
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

// ── Normalización de un documento crudo a una forma común de agenda ─────
// No inventa campos: si algo no está, queda null y la interfaz debe
// mostrarlo como faltante, no completarlo con un valor inventado.
export function normalizarItemAgenda(coleccion, id, data) {
  const d = data || {};
  const nombre = d.nombreLimpio || d.nombre || d.paciente || d.clienteNombre || null;
  const telefono = d.phone || d.telefono || d.whatsapp || null;
  const fecha = d.fecha || null;
  const hora = d.hora || null;
  const estadoBruto = d.estado || d.status || (coleccion === "consultas" ? "pendiente" : null);
  const activa = esActiva(coleccion, estadoBruto);
  const duracionRegistrada = Number(d.duracionMinutos) > 0 ? Number(d.duracionMinutos) : null;
  const duracionEstimada = duracionRegistrada === null;
  const inicioMs = inicioTurnoMs(fecha, hora);
  const finMs = fecha && hora ? finTurnoMs(fecha, hora, duracionRegistrada) : null;

  return {
    coleccion,               // 'reservas' | 'consultas'
    id,                      // doc id real — la identidad de la tarjeta
    nombre,
    dni: d.dni || null,
    telefono,
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
// Regla única y determinística para esta v1: toda reserva/consulta ACTIVA
// cuyo inicio cae dentro de las 4 horas previas (ventana [inicio-4h, fin))
// entra a la bandeja como "revisar confirmación", porque ninguna colección
// de este proyecto tiene hoy un campo que registre que la paciente
// confirmó que va a venir (ver auditoría: 'estado: confirmado' solo
// significa "no cancelada"). No hay estado persistido de la revisión en
// Firestore: se recalcula siempre desde los datos vivos, así que una
// reprogramación, cancelación o borrado se reflejan solos en la próxima
// pasada — no hace falta "descartar" nada a mano.
export function calcularRevision(item, ahoraMs = Date.now()) {
  if (!item.activa) return null;
  if (item.inicioMs === null) return null; // sin fecha/hora utilizable — no se puede ubicar en el tiempo
  if (item.finMs !== null && item.finMs <= ahoraMs) return null; // ya pasó
  const ventanaDesde = item.inicioMs - VENTANA_REVISION_MS;
  if (ahoraMs < ventanaDesde) return null; // todavía no entra a la ventana de 4 horas

  const motivos = [];
  motivos.push({
    tipo: "sin_confirmacion",
    texto: "Sin registro de confirmación de la paciente — revisar antes del turno.",
  });
  if (!item.telefono) {
    motivos.push({ tipo: "sin_telefono", texto: "Sin teléfono registrado — no se puede preparar WhatsApp." });
  }
  if (item.duracionEstimada) {
    motivos.push({ tipo: "duracion_estimada", texto: `Duración no registrada — se estima ${DURACION_DEFECTO_MIN} min.` });
  }

  return {
    item,
    motivos,
    venceEnMs: item.inicioMs, // referencia: al llegar la hora del turno, deja de tener sentido "revisar antes"
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
export function idContactoParaItem(item, tipoMensaje) {
  return `${item.coleccion}_${item.id}_${tipoMensaje}`;
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
