// doctora/doctora-dinero.js
// Importes, cobros y cierre de jornada para "Pacientes de la Doctora" —
// misma colección aislada por privacidad que el resto del módulo, y mismo
// patrón de inyección de dependencias que doctora-contactos.js (nunca se
// ata a una única instancia de Firebase, así se puede probar con un fake).
//
// Todo se guarda en centavos enteros (ver doctora-logic.js), nunca floats.
// Los movimientos (cobro/devolución) son un registro contable append-only:
// nunca se editan ni se borran — una corrección es SIEMPRE un movimiento
// nuevo que referencia al que corrige, para conservar la trazabilidad
// completa (punto 6). Cancelar/eliminar un turno nunca toca esta colección.

export const COLECCION_MOVIMIENTOS = "movimientosDineroDoctora";
export const COLECCION_CIERRES = "cierresDoctora";

// Precio acordado de UNA consulta puntual — vive en el propio turno
// (precioConsultaCentavos), nunca en el catálogo de servicios ni afecta
// otras consultas. null = "sin cargar" (distinto de 0).
export async function registrarPrecioConsulta(ctx) {
  const { updateDoc, doc, serverTimestamp, db, turnoId, precioConsultaCentavos, operador } = ctx;
  await updateDoc(doc(db, "turnosDoctora", turnoId), {
    precioConsultaCentavos: precioConsultaCentavos === null || precioConsultaCentavos === undefined ? null : precioConsultaCentavos,
    precioConsultaActualizadoPorUid: operador?.uid || null,
    precioConsultaActualizadoPorEmail: operador?.email || null,
    precioConsultaActualizadoAt: serverTimestamp(),
  });
}

// idempotencyKey: generado UNA vez por intento de registro (al abrir el
// formulario), usado como ID del documento — un reintento (doble click,
// reintento de red, recarga que reenvía el mismo formulario) escribe el
// MISMO documento en vez de crear un movimiento duplicado.
export function generarIdempotencyKey() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `mov_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

// tipo: "cobro" | "devolucion". medios: [{tipo, montoCentavos}] (ya
// validado con validarMediosPago antes de llamar acá). fechaMovimiento:
// "YYYY-MM-DD" en horario Argentina — el día real en que se cobra/devuelve,
// que puede ser distinto de fechaAtencion (turno.fecha) si es un pago
// posterior de una consulta anterior.
export async function registrarMovimientoDinero(ctx) {
  const {
    setDoc, doc, serverTimestamp, db, idempotencyKey,
    turnoId, pacienteNombre, pacienteDni, tipo, montoCentavos, medios,
    fechaMovimiento, fechaAtencion, nota, operador, corrigeMovimientoId,
  } = ctx;
  const id = idempotencyKey || generarIdempotencyKey();
  await setDoc(doc(db, COLECCION_MOVIMIENTOS, id), {
    turnoId, pacienteNombre: pacienteNombre || null, pacienteDni: pacienteDni || null,
    tipo, montoCentavos, medios,
    fechaMovimiento, fechaAtencion: fechaAtencion || null,
    nota: nota || null,
    corrigeMovimientoId: corrigeMovimientoId || null,
    responsableUid: operador?.uid || null,
    responsableEmail: operador?.email || null,
    creadoAt: serverTimestamp(),
  });
  return id;
}

// Snapshot congelado del día — una vez guardado, editar una consulta no
// puede cambiarlo silenciosamente (punto 6): solo una reapertura explícita
// y registrada permite volver a guardar sobre un cierre ya cerrado.
export async function guardarCierreJornada(ctx) {
  const {
    setDoc, doc, serverTimestamp, db, fecha,
    resumen, detalle, operador, reaperturaPrevia,
  } = ctx;
  await setDoc(doc(db, COLECCION_CIERRES, fecha), {
    fecha,
    estado: "cerrado",
    ...resumen, // consultasAtendidas, totalCobradoCentavos, totalDevueltoCentavos, netoCentavos, parteDoctoraCentavos, parteMimarTCentavos
    detalle, // snapshot por consulta: turnoId, pacienteNombre, fechaAtencion, precioConsultaCentavos, cobradoEseDiaCentavos, devueltoEseDiaCentavos, saldoPendienteCentavos, medios
    cerradoPorUid: operador?.uid || null,
    cerradoPorEmail: operador?.email || null,
    cerradoAt: serverTimestamp(),
    reaperturaPrevia: reaperturaPrevia || null, // { motivo, uid, email, at } si esto es un re-cierre tras reabrir
  });
}

// Reapertura autorizada y registrada — no borra el cierre anterior (queda
// como historial dentro del propio documento), solo lo marca reabierto
// para que la UI permita armar y guardar un nuevo snapshot. El llamador
// pasa el historial YA existente (leído del propio cierre) para no
// depender de arrayUnion — es una operación de baja frecuencia, no hace
// falta atomicidad de servidor para esto.
export async function reabrirCierreJornada(ctx) {
  const { updateDoc, doc, serverTimestamp, db, fecha, motivo, operador, historialPrevio } = ctx;
  const nuevoEvento = {
    motivo: motivo || null,
    uid: operador?.uid || null,
    email: operador?.email || null,
    atMs: Date.now(),
  };
  await updateDoc(doc(db, COLECCION_CIERRES, fecha), {
    estado: "reabierto",
    historialReapertura: [...(Array.isArray(historialPrevio) ? historialPrevio : []), nuevoEvento],
    reabiertoAt: serverTimestamp(),
  });
}
