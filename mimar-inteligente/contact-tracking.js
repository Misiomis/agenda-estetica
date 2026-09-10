// Copia local de js/contact-tracking.js para builds de Capacitor/Android —
// mismo patrón que mimar-inteligente/firebase-web.js: el webDir de la app
// Android es esta carpeta, así que no puede alcanzar ../js/. La versión web
// servida en /mimar-inteligente/ también usa esta copia.
//
// Seguimiento centralizado de contactos por WhatsApp — punto 3 del pedido de
// evolución de Mimar T Inteligente.
//
// Este módulo NO manda nada por WhatsApp ni sabe nada de la API de Meta —
// eso ya no existe en el proyecto. Solo registra qué pasó cuando alguien
// hizo clic en un enlace wa.me que el propio panel ya armó: si se preparó
// el texto, si la operadora confirmó después que lo mandó, o si no lo
// mandó. "Preparado" nunca significa "enviado", y ninguna de estas
// funciones puede, por sí sola, demostrar entrega ni lectura — eso lo
// decide una persona.
//
// Se usa por inyección de dependencias (setDoc/doc/serverTimestamp/db) en
// vez de importar Firebase acá mismo, para poder llamarse tanto desde
// mimar-inteligente.js (su propio firebase-web.js) como desde admin.html,
// depilacion.html, kit-facial.html (el firebase-web.js de la raíz) sin
// duplicar lógica ni atarse a una única instancia de la app.

export function idContacto(coleccion, docId, tipoMensaje) {
    return `${coleccion}_${docId}_${tipoMensaje}`;
}

// Se llama justo antes de abrir wa.me — dice "se preparó un texto para este
// destinatario", nada más. Es el único estado que se escribe sin que una
// persona haya confirmado nada todavía.
export async function registrarContactoPreparado(ctx) {
    const { setDoc, doc, serverTimestamp, db, coleccion, docId, tipoMensaje, operador, versionDatos } = ctx;
    const id = idContacto(coleccion, docId, tipoMensaje);
    await setDoc(doc(db, "contactosWhatsApp", id), {
        coleccion,
        docId,
        tipoMensaje,
        estado: "preparado",
        operadorUid: operador?.uid || null,
        operadorEmail: operador?.email || null,
        versionDatos: versionDatos || null,
        preparadoAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    }, { merge: true });
    return id;
}

// Se llama cuando la operadora responde la pregunta "¿Enviaste el mensaje?"
// (o registra un envío hecho por fuera del sistema). estado esperado:
// "enviado" | "no_enviado". Nunca se llama a esto de forma automática.
export async function registrarContactoEstado(ctx) {
    const { setDoc, doc, serverTimestamp, db, coleccion, docId, tipoMensaje, estado, operador } = ctx;
    const id = idContacto(coleccion, docId, tipoMensaje);
    const marcaDeTiempo = estado === "enviado" ? "enviadoAt" : estado === "no_enviado" ? "noEnviadoAt" : null;
    const extra = marcaDeTiempo ? { [marcaDeTiempo]: serverTimestamp() } : {};
    await setDoc(doc(db, "contactosWhatsApp", id), {
        coleccion,
        docId,
        tipoMensaje,
        estado,
        operadorUid: operador?.uid || null,
        operadorEmail: operador?.email || null,
        updatedAt: serverTimestamp(),
        ...extra
    }, { merge: true });
    return id;
}

// Registro manual de un envío hecho por fuera del sistema (WhatsApp Web,
// otro teléfono, etc.) — nunca lee WhatsApp ni infiere nada, solo asienta
// lo que la operadora dice que pasó.
export async function registrarContactoManual(ctx) {
    const { setDoc, doc, serverTimestamp, db, coleccion, docId, tipoMensaje, operador, nota } = ctx;
    const id = idContacto(coleccion, docId, tipoMensaje);
    await setDoc(doc(db, "contactosWhatsApp", id), {
        coleccion,
        docId,
        tipoMensaje,
        estado: "enviado",
        origen: "manual",
        nota: nota || null,
        operadorUid: operador?.uid || null,
        operadorEmail: operador?.email || null,
        enviadoAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    }, { merge: true });
    return id;
}
