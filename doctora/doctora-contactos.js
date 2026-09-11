// doctora/doctora-contactos.js
// Seguimiento honesto de contactos por WhatsApp para "Pacientes de la
// Doctora" — mismo espíritu que js/contact-tracking.js (mimar-inteligente),
// pero en su propia colección aislada (contactosWhatsAppDoctora), separada
// del resto del sistema por privacidad (punto 1).
//
// No manda nada por WhatsApp. Solo registra qué pasó cuando alguien preparó
// un mensaje o abrió un enlace wa.me que la propia página ya armó.
// "Preparado" nunca significa "enviado", y ninguna de estas funciones puede
// demostrar por sí sola que un mensaje se entregó o se leyó — eso lo
// decide una persona, a mano.
//
// Se usa por inyección de dependencias (setDoc/doc/updateDoc/serverTimestamp
// /db), igual que contact-tracking.js, para no atarse a una única instancia
// de Firebase.

export function idContactoDoctora(turnoId, tipoMensaje) {
  return `${turnoId}_${tipoMensaje}`;
}

// Se llama justo antes de abrir wa.me — "se preparó un texto", nada más.
export async function registrarContactoDoctoraPreparado(ctx) {
  const { setDoc, doc, serverTimestamp, db, turnoId, tipoMensaje, operador, versionDatos } = ctx;
  const id = idContactoDoctora(turnoId, tipoMensaje);
  await setDoc(doc(db, "contactosWhatsAppDoctora", id), {
    turnoId,
    tipoMensaje,
    estado: "preparado",
    operadorUid: operador?.uid || null,
    operadorEmail: operador?.email || null,
    versionDatos: versionDatos || null,
    preparadoAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  return id;
}

// estado esperado: "enviado" | "no_enviado". Nunca se llama automáticamente.
export async function registrarContactoDoctoraEstado(ctx) {
  const { setDoc, doc, serverTimestamp, db, turnoId, tipoMensaje, estado, operador } = ctx;
  const id = idContactoDoctora(turnoId, tipoMensaje);
  const marca = estado === "enviado" ? "enviadoAt" : estado === "no_enviado" ? "noEnviadoAt" : null;
  const extra = marca ? { [marca]: serverTimestamp() } : {};
  await setDoc(doc(db, "contactosWhatsAppDoctora", id), {
    turnoId,
    tipoMensaje,
    estado,
    operadorUid: operador?.uid || null,
    operadorEmail: operador?.email || null,
    updatedAt: serverTimestamp(),
    ...extra,
  }, { merge: true });
  return id;
}

// Registro manual de un envío hecho por fuera del sistema.
export async function registrarContactoDoctoraManual(ctx) {
  const { setDoc, doc, serverTimestamp, db, turnoId, tipoMensaje, operador, nota } = ctx;
  const id = idContactoDoctora(turnoId, tipoMensaje);
  await setDoc(doc(db, "contactosWhatsAppDoctora", id), {
    turnoId,
    tipoMensaje,
    estado: "enviado",
    origen: "manual",
    nota: nota || null,
    operadorUid: operador?.uid || null,
    operadorEmail: operador?.email || null,
    enviadoAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  return id;
}

// Confirmación de asistencia de la PACIENTE — un hecho sobre el turno, no
// sobre si se mandó o no un mensaje. Vive en el propio documento de
// turnosDoctora (campo confirmacionPaciente), nunca en
// contactosWhatsAppDoctora, para no mezclar "envío" con "atención".
export async function registrarConfirmacionPaciente(ctx) {
  const { updateDoc, doc, serverTimestamp, db, turnoId, confirmado, operador, nota } = ctx;
  await updateDoc(doc(db, "turnosDoctora", turnoId), {
    confirmacionPaciente: {
      confirmado: !!confirmado,
      registradoPorUid: operador?.uid || null,
      registradoPorEmail: operador?.email || null,
      registradoAt: serverTimestamp(),
      nota: nota || null,
    },
  });
}
