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
//   confirmacion_turno — reservas/consultas activas · ventana de 4 h antes
//     del turno (calcularRevision) · vence al empezar el turno · se cierra
//     cuando el contacto de ESA ocurrencia (id versionado por fecha/hora)
//     queda en estado "enviado".
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
// Ninguna de estas cuatro reglas cuenta un turno pasado como "atendido":
// eso lo decide solo un contacto realmente registrado o, en el caso del
// kit, el propio cambio de estado del pedido — nunca la fecha.
export const TIPOS_PENDIENTE = ["recomendacion", "confirmacion_turno", "kit_pendiente", "cumpleanos"];

export const ETIQUETA_TIPO_PENDIENTE = {
  recomendacion: "Recomendación", confirmacion_turno: "Confirmación de turno",
  kit_pendiente: "Pedido de kit", cumpleanos: "Cumpleaños",
};

// Orden de prioridad cuando dos pendientes vencen al mismo tiempo (o
// ninguno tiene vencimiento) — las recomendaciones primero porque es el
// pedido explícito de esta vuelta ("especialmente enviar recomendaciones").
const ORDEN_TIPO = { recomendacion: 0, confirmacion_turno: 1, kit_pendiente: 2, cumpleanos: 3 };

function estadoContactoResuelto(contactosPorId, idContacto) {
  return estadoContacto(contactosPorId?.[idContacto]) === "enviado";
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
    pendientes.push({
      id: `pend_${item.coleccion}_${item.id}_confirmacion_${item.fecha}_${item.hora}`,
      tipo: "confirmacion_turno", coleccion: item.coleccion, docId: item.id,
      nombre: item.nombre || "Paciente",
      motivo: revision.motivos.map((m) => m.texto).join(" "),
      habilitadoDesdeMs: item.inicioMs - VENTANA_REVISION_MS, venceMs: revision.venceEnMs,
      ocurrencia: { fecha: item.fecha, hora: item.hora },
    });
  }

  for (const kit of (pedidosKitPendientes || [])) {
    const productos = kit.productosResumen ? kit.productosResumen.join(", ")
      : (kit.items ? kit.items.map((it) => it.nombre).join(", ") : null);
    pendientes.push({
      id: `pend_pedidosKit_${kit.id}_kit`,
      tipo: "kit_pendiente", coleccion: "pedidosKit", docId: kit.id,
      nombre: kit.nombre || "Paciente",
      motivo: productos ? `Pedido sin entregar: ${productos}.` : "Pedido de kit todavía sin entregar.",
      habilitadoDesdeMs: null, venceMs: null, ocurrencia: null,
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
    });
  }

  return pendientes.sort((a, b) => {
    const va = a.venceMs ?? Infinity, vb = b.venceMs ?? Infinity;
    if (va !== vb) return va - vb;
    return (ORDEN_TIPO[a.tipo] ?? 9) - (ORDEN_TIPO[b.tipo] ?? 9);
  });
}

// Agrupa por tipo con las cantidades — texto pedido explícitamente:
// "Tenés 4 pendientes: 2 recomendaciones, 1 consulta y 1 kit". Se arma acá
// (función pura, testeable) para que el job horario y la UI usen
// exactamente el mismo texto.
const PLURAL_TIPO = {
  recomendacion: ["recomendación", "recomendaciones"],
  confirmacion_turno: ["turno por confirmar", "turnos por confirmar"],
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
