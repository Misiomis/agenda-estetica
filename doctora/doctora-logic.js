// doctora/doctora-logic.js
// Reglas determinísticas de "Pacientes de la Doctora" — sin DOM, sin
// Firestore, solo funciones puras sobre datos ya traídos. Se puede probar
// con Node (`node tests/doctora/run-tests.js`) sin levantar la página.
//
// Reusa las funciones ya probadas de Mimar T Inteligente (misma zona
// horaria, mismo cálculo de inicio/fin de turno, mismo normalizador de
// teléfono para WhatsApp) en vez de duplicarlas — este módulo no es una app
// Capacitor separada, es una página más del mismo sitio, así que sí puede
// alcanzar ../mimar-inteligente/ por ruta relativa.
import {
  ZONA_HORARIA, fechaISOEnZona, sumarDiasISO, normalizarTelefonoWA,
  inicioTurnoMs, finTurnoMs, DURACION_DEFECTO_MIN,
  estadoContacto, etiquetaEstadoContacto,
} from "../mimar-inteligente/mimar-inteligente-logic.js";

export {
  ZONA_HORARIA, fechaISOEnZona, sumarDiasISO, normalizarTelefonoWA,
  estadoContacto, etiquetaEstadoContacto,
};

// ── DNI ───────────────────────────────────────────────────────────────────
// Mismo criterio que functions/index.js normalizarDni() y admin.html
// normalizarDNI(): se guarda como texto, se despoja de todo lo que no sea
// dígito. Es también el id del documento en pacientesDoctora, igual que
// "clients" usa el DNI normalizado como id.
export function normalizarDni(rawDni) {
  return String(rawDni || "").replace(/\D/g, "");
}

export function dniValido(rawDni) {
  const d = normalizarDni(rawDni);
  return d.length >= 6 && d.length <= 9;
}

export function telefonoValido(rawTelefono) {
  const d = String(rawTelefono || "").replace(/\D/g, "");
  return d.length >= 8;
}

// ── Alta/edición de paciente sin pisar datos ni duplicar personas ────────
// Nunca sobrescribe un valor ya cargado — si el campo existente y el nuevo
// difieren, lo señala como conflicto para que una persona decida, en vez de
// elegir un valor por sobre el otro en silencio. Si el campo existente está
// vacío, sí lo completa (eso no es "pisar", es completar lo faltante).
export function calcularActualizacionPaciente(existente, nuevo) {
  const nombreNuevo = (nuevo?.nombre || "").toString().trim();
  const telefonoNuevo = (nuevo?.telefono || "").toString().trim();
  if (!existente) {
    return { accion: "crear", datos: { nombre: nombreNuevo, telefono: telefonoNuevo }, conflictos: [] };
  }
  const datos = {};
  const conflictos = [];
  const campos = { nombre: nombreNuevo, telefono: telefonoNuevo };
  for (const campo of Object.keys(campos)) {
    const valorActual = (existente[campo] || "").toString().trim();
    const valorNuevo = campos[campo];
    if (!valorActual && valorNuevo) {
      datos[campo] = valorNuevo;
    } else if (valorActual && valorNuevo && valorActual !== valorNuevo) {
      conflictos.push({ campo, actual: valorActual, nuevo: valorNuevo });
    }
  }
  return { accion: Object.keys(datos).length ? "completar" : "reutilizar", datos, conflictos };
}

// ── Horarios habilitados por día ─────────────────────────────────────────
// Genera la grilla de horarios de una fecha habilitada. horaFin es el
// límite de cierre (exclusivo): el último turno empieza antes de horaFin,
// nunca justo en horaFin.
export function generarHorariosDelDia(horaInicio, horaFin, duracionMin) {
  const mIni = _minutosDesdeHHMM(horaInicio);
  const mFin = _minutosDesdeHHMM(horaFin);
  const paso = Number(duracionMin);
  if (mIni === null || mFin === null || !(paso > 0)) return [];
  const horarios = [];
  for (let cursor = mIni; cursor < mFin; cursor += paso) {
    horarios.push(_hhmmDesdeMinutos(cursor));
  }
  return horarios;
}

function _minutosDesdeHHMM(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || "").toString().trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function _hhmmDesdeMinutos(totalMin) {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Una fecha "acepta turnos nuevos" solo si su documento existe y quedó
// habilitada explícitamente. Deshabilitar (habilitada:false) nunca borra el
// documento — por eso se chequea el valor, no solo la existencia.
export function fechaAceptaTurnosNuevos(fechaDoc) {
  return !!(fechaDoc && fechaDoc.habilitada === true);
}

export function horarioDentroDeRango(hora, fechaDoc) {
  if (!fechaDoc || !fechaDoc.horaInicio || !fechaDoc.horaFin) return false;
  return hora >= fechaDoc.horaInicio && hora < fechaDoc.horaFin;
}

// Decide si una reserva de horario puede seguir adelante, combinando el
// estado de la fecha y el del horario puntual. No hace ninguna escritura —
// es la misma verificación que hace tanto la transacción real (que además
// se protege con reglas de Firestore ante una carrera real) como las
// pruebas, para no tener dos criterios distintos de "se puede reservar".
export function puedeReservarHorario({ fechaDoc, hora, slotDoc, turnoIdPropio = null }) {
  if (!fechaAceptaTurnosNuevos(fechaDoc)) return { ok: false, motivo: "fecha_no_habilitada" };
  if (hora && !horarioDentroDeRango(hora, fechaDoc)) return { ok: false, motivo: "fuera_de_horario" };
  if (slotDoc && slotDoc.ocupado === true && slotDoc.turnoId && slotDoc.turnoId !== turnoIdPropio) {
    return { ok: false, motivo: "horario_ocupado" };
  }
  return { ok: true };
}

// ── Estado temporal de un turno — nunca "realizado" solo por la fecha ────
// Mismo principio ya aplicado en Mimar T Inteligente: la única evidencia de
// que algo pasó de verdad es información registrada a mano (notas), nunca
// el solo hecho de que la hora ya pasó.
export function estadoTemporalTurnoDoctora(turno, ahoraMs = Date.now()) {
  if (!turno?.hora) return "sin_horario";
  const inicio = inicioTurnoMs(turno.fecha, turno.hora);
  if (inicio === null) return "sin_horario";
  const duracion = Number(turno.duracionMin) > 0 ? Number(turno.duracionMin) : DURACION_DEFECTO_MIN;
  const fin = finTurnoMs(turno.fecha, turno.hora, duracion);
  if (fin !== null && fin <= ahoraMs) return "pasado";
  if (inicio <= ahoraMs) return "en_curso";
  return "proximo";
}

export function etiquetaEstadoTemporalDoctora(estado) {
  switch (estado) {
    case "pasado": return "Turno pasado";
    case "en_curso": return "En curso";
    case "proximo": return "Próximo";
    default: return "Sin horario asignado";
  }
}

export function esPendienteDeHorario(turno) {
  return !turno?.hora;
}

// ── Confirmación de asistencia de la paciente — nunca se confunde con si
// se preparó o envió un mensaje. Vive en el propio turno, no en el
// seguimiento de contacto. ────────────────────────────────────────────────
export function etiquetaConfirmacionPaciente(turno) {
  const c = turno?.confirmacionPaciente;
  if (c?.confirmado === true) return "Confirmó asistencia";
  if (c?.confirmado === false) return "Avisó que no viene";
  return "Sin confirmación de la paciente";
}

// ── Plantillas de mensaje (punto 5) ──────────────────────────────────────
// Texto plano, párrafos breves, datos explícitos del turno. La de
// recomendaciones deja el cuerpo vacío a propósito — ese texto lo tiene que
// escribir o revisar la doctora, nunca se inventa contenido clínico.
function _primerNombre(nombreCompleto) {
  const n = (nombreCompleto || "Paciente").toString().trim();
  return n.split(/\s+/)[0] || "Paciente";
}

export function construirTextoConfirmacionDoctora(turno, ubicacion) {
  const nombre = _primerNombre(turno?.pacienteNombre);
  const fecha = turno?.fecha || "fecha a confirmar";
  const hora = turno?.hora ? `${turno.hora} hs` : "horario a coordinar";
  const lugar = ubicacion ? `\n\nTe esperamos en ${ubicacion}.` : "";
  return `Hola ${nombre},\n\nLe escribimos del consultorio para confirmar tu turno el ${fecha} a las ${hora}.${lugar}\n\n¿Podés confirmarnos tu asistencia? ¡Gracias!`;
}

// Fecha corta y cálida ("11 de septiembre") para el recordatorio — mismo
// criterio de zona horaria que el resto del módulo.
export function fechaLindaCorta(fechaISO) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((fechaISO || "").toString());
  if (!m) return null;
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", timeZone: ZONA_HORARIA }).format(dt);
}

// Plantilla fija pedida explícitamente para el recordatorio del día — no es
// configurable por ubicación como las otras (siempre "Espacio Mimar T").
export function construirTextoRecordatorioDoctora(turno) {
  const nombre = _primerNombre(turno?.pacienteNombre);
  const fecha = (turno?.fecha && fechaLindaCorta(turno.fecha)) || turno?.fecha || "fecha a confirmar";
  const hora = turno?.hora ? `${turno.hora} hs` : "horario a coordinar";
  return `Hola, ${nombre} 💚 Te recordamos que hoy, ${fecha}, tenés tu turno con la doctora a las ${hora} en Espacio Mimar T. ¿Nos confirmás tu asistencia? Si necesitás reprogramar, escribinos. ¡Te esperamos!`;
}

// No se ofrece el recordatorio estándar para un turno eliminado (ya no
// llega acá si no existe), cancelado, sin horario todavía, o cuyo horario
// ya pasó — mismo criterio en toda la app: nunca se asume "realizado" solo
// por la fecha, pero tampoco tiene sentido "recordar" algo que ya pasó.
export function puedeEnviarRecordatorio(turno, ahoraMs = Date.now()) {
  if (!turno) return false;
  if (turno.estado === "cancelado") return false;
  if (!turno.hora) return false;
  return estadoTemporalTurnoDoctora(turno, ahoraMs) !== "pasado";
}

export function construirTextoRecomendacionesDoctora(turno, contenido) {
  const nombre = _primerNombre(turno?.pacienteNombre);
  const cuerpo = (contenido || "").toString().trim()
    || "[Escribí acá las recomendaciones — este texto lo revisa la doctora antes de enviarlo]";
  return `Hola ${nombre},\n\n${cuerpo}\n\nAnte cualquier duda, escribinos.`;
}

// ── Dinero: importes, cobros y cierre de jornada (90% doctora / 10% Mimar T)
// Todo se representa internamente en centavos ENTEROS (nunca floats en
// pesos) para no arrastrar errores de redondeo — el ejemplo de aceptación
// pedido ($100.000 → $90.000 + $10.000) y cualquier importe con centavos
// tienen que sumar siempre exacto.

export const MEDIOS_PAGO_DOCTORA = ["efectivo", "transferencia", "tarjeta", "otro"];
export const ETIQUETA_MEDIO_PAGO = {
  efectivo: "Efectivo", transferencia: "Transferencia", tarjeta: "Tarjeta", otro: "Otro",
};

// Acepta "1500", "1500.50", "1500,50", con o sin separador de miles ("."),
// espacios sobrantes. Rechaza negativos, texto no numérico, o más de 2
// decimales. Vacío/null → null (distinto de "$0", que es un importe real).
export function pesosAcentavos(valor) {
  if (valor === null || valor === undefined) return null;
  let txt = valor.toString().trim();
  if (!txt) return null;
  // "1.500,50" (miles con punto, decimales con coma) → normalizar a "1500.50"
  if (/^\d{1,3}(\.\d{3})*(,\d{1,2})?$/.test(txt)) {
    txt = txt.replace(/\./g, "").replace(",", ".");
  } else {
    txt = txt.replace(/,/g, "."); // "1500,50" suelto → "1500.50"
  }
  if (!/^\d+(\.\d{1,2})?$/.test(txt)) return null;
  const [enteroStr, decStr = ""] = txt.split(".");
  const entero = Number(enteroStr);
  if (!Number.isFinite(entero)) return null;
  const decimales = (decStr + "00").slice(0, 2);
  return entero * 100 + Number(decimales);
}

export function centavosApesos(centavos) {
  if (centavos === null || centavos === undefined || !Number.isFinite(centavos)) return null;
  return centavos / 100;
}

// Formato "$ 90.000,00" (es-AR). centavos null/undefined → null (el llamador
// decide el texto — "Sin cargar" no es responsabilidad de esta función).
export function formatoPesosAR(centavos) {
  if (centavos === null || centavos === undefined || !Number.isFinite(centavos)) return null;
  const pesos = centavos / 100;
  return "$ " + new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(pesos);
}

export function medioPagoValido(tipo) {
  return MEDIOS_PAGO_DOCTORA.includes(tipo);
}

// Un movimiento (cobro o devolución) puede pagarse con un solo medio o con
// varios combinados — siempre se guarda como array [{tipo, montoCentavos}],
// nunca un string suelto, para no tener dos formas distintas de lo mismo.
// La suma de los medios tiene que calzar exacto con el monto total del
// movimiento (ni un centavo de más ni de menos).
export function validarMediosPago(medios, montoTotalCentavos) {
  if (!Array.isArray(medios) || !medios.length) return { ok: false, motivo: "sin_medios" };
  let suma = 0;
  for (const m of medios) {
    if (!medioPagoValido(m?.tipo)) return { ok: false, motivo: "medio_invalido" };
    if (!Number.isInteger(m?.montoCentavos) || m.montoCentavos <= 0) return { ok: false, motivo: "monto_invalido" };
    suma += m.montoCentavos;
  }
  if (suma !== montoTotalCentavos) return { ok: false, motivo: "no_coincide_total" };
  return { ok: true };
}

export function etiquetaMediosPago(medios) {
  if (!Array.isArray(medios) || !medios.length) return "—";
  if (medios.length === 1) return ETIQUETA_MEDIO_PAGO[medios[0].tipo] || medios[0].tipo;
  return "Combinado: " + medios.map((m) => `${ETIQUETA_MEDIO_PAGO[m.tipo] || m.tipo} ${formatoPesosAR(m.montoCentavos)}`).join(" + ");
}

// ── Reparto 90% doctora / 10% Mimar T ────────────────────────────────────
// La parte de Mimar T se calcula SIEMPRE como el resto (neto - parteDoctora),
// nunca redondeando las dos partes por separado — así la suma da exacto el
// neto pase lo que pase con el redondeo del 90%. Redondeo: al entero de
// centavo más cercano (Math.round, mitad hacia arriba), un único criterio,
// documentado y probado.
export function calcularRepartoDoctora(netoCentavos) {
  const neto = Number.isInteger(netoCentavos) ? netoCentavos : 0;
  if (neto <= 0) return { parteDoctoraCentavos: 0, parteMimarTCentavos: Math.max(neto, 0) };
  const parteDoctoraCentavos = Math.round(neto * 0.9);
  const parteMimarTCentavos = neto - parteDoctoraCentavos;
  return { parteDoctoraCentavos, parteMimarTCentavos };
}

// ── Resumen de dinero de UN turno (precio acordado + su historial de
// movimientos) — usado en la ficha del turno, no en el cierre. El precio
// null (nunca 0) significa "todavía no se cargó", así que el saldo
// pendiente tampoco se puede calcular sin inventar un precio.
export function resumenDineroTurno(precioConsultaCentavos, movimientos) {
  const lista = Array.isArray(movimientos) ? movimientos : [];
  let totalCobradoCentavos = 0;
  let totalDevueltoCentavos = 0;
  for (const m of lista) {
    if (m.tipo === "cobro") totalCobradoCentavos += m.montoCentavos || 0;
    else if (m.tipo === "devolucion") totalDevueltoCentavos += m.montoCentavos || 0;
  }
  const netoCobradoCentavos = totalCobradoCentavos - totalDevueltoCentavos;
  const saldoPendienteCentavos = (precioConsultaCentavos === null || precioConsultaCentavos === undefined)
    ? null
    : Math.max(precioConsultaCentavos - netoCobradoCentavos, 0);
  return { precioConsultaCentavos: precioConsultaCentavos ?? null, totalCobradoCentavos, totalDevueltoCentavos, netoCobradoCentavos, saldoPendienteCentavos };
}

// ── Cierre de jornada: arma el resumen a partir de los movimientos de un
// día puntual (ya filtrados por fechaMovimiento por el llamador — esta
// función no sabe nada de Firestore). "Consultas atendidas" = turnos
// distintos con al menos un movimiento ese día — el mismo criterio ya
// usado en todo el módulo de no inventar "atendido" por otra vía.
// Agrupa los movimientos del día por turno y arma cada fila del detalle
// desplegable del cierre (paciente, fecha de atención, precio, cobrado ESE
// día, devuelto ese día, medios de pago usados ese día, y el saldo
// pendiente ACTUAL de la consulta — que puede incluir cobros/pendientes de
// otros días, no solo el de hoy). turnosInfo es un Map turnoId → { pacienteNombre,
// fechaAtencion, precioConsultaCentavos, saldoPendienteActualCentavos },
// ya resuelto por el llamador (esta función no toca Firestore).
export function armarDetalleCierre(movimientosDelDia, turnosInfo) {
  const porTurno = new Map();
  for (const m of (Array.isArray(movimientosDelDia) ? movimientosDelDia : [])) {
    if (!porTurno.has(m.turnoId)) porTurno.set(m.turnoId, { cobradoEseDiaCentavos: 0, devueltoEseDiaCentavos: 0, medios: [] });
    const acc = porTurno.get(m.turnoId);
    if (m.tipo === "cobro") acc.cobradoEseDiaCentavos += m.montoCentavos || 0;
    else if (m.tipo === "devolucion") acc.devueltoEseDiaCentavos += m.montoCentavos || 0;
    if (Array.isArray(m.medios)) acc.medios.push(...m.medios);
  }
  const filas = [];
  for (const [turnoId, acc] of porTurno.entries()) {
    const info = (turnosInfo && turnosInfo.get) ? (turnosInfo.get(turnoId) || {}) : {};
    filas.push({
      turnoId,
      pacienteNombre: info.pacienteNombre || "Paciente",
      fechaAtencion: info.fechaAtencion || null,
      precioConsultaCentavos: info.precioConsultaCentavos ?? null,
      cobradoEseDiaCentavos: acc.cobradoEseDiaCentavos,
      devueltoEseDiaCentavos: acc.devueltoEseDiaCentavos,
      medios: acc.medios,
      saldoPendienteActualCentavos: info.saldoPendienteActualCentavos ?? null,
    });
  }
  filas.sort((a, b) => (a.pacienteNombre || "").localeCompare(b.pacienteNombre || ""));
  return filas;
}

export function calcularCierreJornada(movimientosDelDia) {
  const lista = Array.isArray(movimientosDelDia) ? movimientosDelDia : [];
  let totalCobradoCentavos = 0;
  let totalDevueltoCentavos = 0;
  const turnosDistintos = new Set();
  for (const m of lista) {
    turnosDistintos.add(m.turnoId);
    if (m.tipo === "cobro") totalCobradoCentavos += m.montoCentavos || 0;
    else if (m.tipo === "devolucion") totalDevueltoCentavos += m.montoCentavos || 0;
  }
  const netoCentavos = totalCobradoCentavos - totalDevueltoCentavos;
  const { parteDoctoraCentavos, parteMimarTCentavos } = calcularRepartoDoctora(netoCentavos);
  return {
    consultasAtendidas: turnosDistintos.size,
    totalCobradoCentavos, totalDevueltoCentavos, netoCentavos,
    parteDoctoraCentavos, parteMimarTCentavos,
  };
}
