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

  return {
    id,
    nombre,
    telefono,
    dni: d.dni || null,
    fechaPedido: typeof d.fecha === "string" ? d.fecha : null,
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
