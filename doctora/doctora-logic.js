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

export function construirTextoRecordatorioDoctora(turno, ubicacion) {
  const nombre = _primerNombre(turno?.pacienteNombre);
  const fecha = turno?.fecha || "fecha a confirmar";
  const hora = turno?.hora ? `${turno.hora} hs` : "horario a coordinar";
  const lugar = ubicacion ? ` en ${ubicacion}` : "";
  return `Hola ${nombre},\n\nTe recordamos tu turno el ${fecha} a las ${hora}${lugar}.\n\n¡Te esperamos!`;
}

export function construirTextoRecomendacionesDoctora(turno, contenido) {
  const nombre = _primerNombre(turno?.pacienteNombre);
  const cuerpo = (contenido || "").toString().trim()
    || "[Escribí acá las recomendaciones — este texto lo revisa la doctora antes de enviarlo]";
  return `Hola ${nombre},\n\n${cuerpo}\n\nAnte cualquier duda, escribinos.`;
}
