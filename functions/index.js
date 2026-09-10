const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
// admin.firestore.FieldValue (API con namespace) devuelve undefined en
// ciertos runtimes (confirmado con el emulador: TypeError real al llamar
// FieldValue.serverTimestamp()) — se usa la API modular,
// que es además la recomendada por el SDK desde firebase-admin v10+.
const { FieldValue } = require("firebase-admin/firestore");

admin.initializeApp();
const db = admin.firestore();

// ── Mensajería por WhatsApp: eliminada por completo ─────────────────────────
// Este proyecto usó la API de WhatsApp Business (Meta Graph API) para enviar
// confirmaciones, recordatorios, resúmenes de sesión y avisos a Gimena. Esa
// integración quedó retirada a pedido: la estética cambió de número y todos
// los mensajes se mandan ahora a mano desde WhatsApp, sin ninguna llamada a
// una API. No queda en este archivo ningún token, template, endpoint de
// Meta ni lógica de envío — ver el informe de la tarea para el detalle de
// qué se borró y de dónde.

function normalizarDni(rawDni) {
    return String(rawDni || "").replace(/\D/g, "");
}

const DIACRITICOS_COMBINADOS = new RegExp(String.fromCharCode(0x5b, 0x5c, 0x75, 0x30, 0x33, 0x30, 0x30, 0x2d, 0x5c, 0x75, 0x30, 0x33, 0x36, 0x66, 0x5d), "g");

function normalizarNombreUsuario(rawName) {
    return String(rawName || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(DIACRITICOS_COMBINADOS, "")
        .replace(/[^a-z0-9\s]/g, "")
        .trim()
        .replace(/\s+/g, ".");
}

function normalizarTextoComparacion(rawValue) {
    return String(rawValue || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(DIACRITICOS_COMBINADOS, "")
        .replace(/[^a-z0-9\s]/g, " ")
        .trim()
        .replace(/\s+/g, " ");
}

function obtenerEstadoReserva(reserva) {
    const status = String(reserva.status || "").trim().toLowerCase();
    const estado = String(reserva.estado || "").trim().toLowerCase();

    if (status === "cancelado" || estado === "cancelado") {
        return "cancelado";
    }

    if (status === "confirmado" || estado === "confirmado") {
        return "confirmado";
    }

    return "confirmado";
}

function obtenerNombreReserva(reserva) {
    return String(
        reserva.clienteNombre
        || reserva.nombre
        || reserva.cliente
        || reserva.displayName
        || "Paciente"
    ).trim() || "Paciente";
}

async function buscarClientePorDni(dni) {
    const dniNormalizado = normalizarDni(dni);
    if (!dniNormalizado) return null;

    const clientRef = db.collection("clients").doc(dniNormalizado);
    const clientDoc = await clientRef.get();
    if (clientDoc.exists) return clientDoc;

    const legacyByDni = await db.collection("clients")
        .where("dni", "==", dniNormalizado)
        .limit(1)
        .get();

    if (!legacyByDni.empty) return legacyByDni.docs[0];
    return null;
}

async function descontarHoursBalanceCliente(dni) {
    const clientDoc = await buscarClientePorDni(dni);
    if (!clientDoc) {
        return { updated: false, reason: "client_not_found" };
    }

    await clientDoc.ref.update({
        hoursBalance: FieldValue.increment(-1),
        updatedAt: FieldValue.serverTimestamp()
    });

    return { updated: true, clientDocId: clientDoc.ref.id };
}

exports.registrarPacienteJornada = onRequest(async (req, res) => {

    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        return res.status(204).send("");
    }

    if (req.method !== "POST") {
        return res.status(405).json({ error: "Metodo no permitido" });
    }

    try {
        const {
            fullName,
            dni,
            phone,
            email,
            serviceName,
            sourceTag,
            allowedDates,
            politicaAceptada,
            consentimientoAceptado
        } = req.body || {};

        const dniNormalizado = normalizarDni(dni);
        const nombre = String(fullName || "").trim();
        const tel = String(phone || "").trim();
        const mail = String(email || "").trim().toLowerCase();

        if (!dniNormalizado || !nombre || !tel || !mail) {
            return res.status(400).json({ error: "Faltan campos obligatorios" });
        }

        if (politicaAceptada !== true || consentimientoAceptado !== true) {
            return res.status(400).json({ error: "Debe aceptar politica y consentimiento" });
        }

        let ref = db.collection("clients").doc(dniNormalizado);
        let snap = await ref.get();

        if (!snap.exists) {
            const legacyByDni = await db.collection("clients")
                .where("dni", "==", dniNormalizado)
                .limit(1)
                .get();

            if (!legacyByDni.empty) {
                ref = legacyByDni.docs[0].ref;
                snap = legacyByDni.docs[0];
            }
        }

        const prev = snap.exists ? (snap.data() || {}) : {};

        const membershipPrev = prev.membershipActive === true || prev.membresia === true;

        const payload = {
            dni: dniNormalizado,
            fullName: nombre,
            nombre,
            phone: tel,
            telefono: tel,
            email: mail,
            username: normalizarNombreUsuario(nombre),
            active: true,
            membershipActive: membershipPrev,
            membresia: membershipPrev,
            tipoCliente: membershipPrev ? "membresia" : "ocasional",
            politicaAceptada: true,
            consentimientoAceptado: true,
            fechaAceptacion: FieldValue.serverTimestamp(),
            consultaNutricionalRespondida: prev.consultaNutricionalRespondida === true,
            historiaCompletada: prev.historiaCompletada === true,
            campaign: {
                source: String(sourceTag || "jornada_especial"),
                serviceName: String(serviceName || "Jornada Especial"),
                allowedDates: Array.isArray(allowedDates) ? allowedDates : [],
                lastSignupAt: FieldValue.serverTimestamp()
            },
            updatedAt: FieldValue.serverTimestamp()
        };

        if (!snap.exists) {
            payload.createdAt = FieldValue.serverTimestamp();
            payload.hoursBalance = 1;
        }

        await ref.set(payload, { merge: true });

        return res.status(200).json({
            status: "ok",
            dni: dniNormalizado,
            clientDocId: ref.id,
            fullName: nombre,
            serviceName: String(serviceName || "Jornada Especial")
        });

    } catch (error) {
        console.error("registrarPacienteJornada error:", error);
        return res.status(500).json({ error: "Error interno al registrar paciente" });
    }
});

// Antes se llamaba "enviarConfirmacionTurno" y, además de esto, mandaba un
// WhatsApp de confirmación por API. Ese envío se eliminó por completo (ver
// informe); lo único que sobrevive es el descuento de hoursBalance, que es
// una operación de negocio propia de la reserva, no de mensajería — el
// paciente confirmando su propio turno necesita esto aunque no tenga sesión
// de admin, y las reglas de Firestore no dejan tocar hoursBalance sin ella.
exports.descontarHoraSesion = onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Metodo no permitido" });

    let balanceUpdated = false;
    const warnings = [];

    try {
        const { dni, descontarBalance = false } = req.body || {};

        if (descontarBalance && dni) {
            try {
                const balanceResult = await descontarHoursBalanceCliente(dni);
                balanceUpdated = balanceResult.updated === true;
                if (!balanceUpdated) warnings.push("balance_client_not_found");
            } catch (balanceError) {
                console.error("No se pudo descontar hoursBalance:", balanceError);
                warnings.push("balance_update_failed");
            }
        }

        return res.status(200).json({ status: "success", balanceUpdated, warnings });
    } catch (error) {
        console.error("descontarHoraSesion error:", error.message || error);
        return res.status(500).json({
            error: "Error interno",
            detalles: error.message,
            balanceUpdated,
            warnings
        });
    }
});

exports.cancelarReservaPaciente = onRequest(async (req, res) => {

    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        return res.status(204).send("");
    }

    if (req.method !== "POST") {
        return res.status(405).json({ error: "Metodo no permitido" });
    }

    try {
        const {
            reservaId,
            dni,
            nombre,
            motivo
        } = req.body || {};

        const reservaIdNormalizado = String(reservaId || "").trim();
        const dniNormalizado = normalizarDni(dni);
        const nombreNormalizado = normalizarTextoComparacion(nombre);
        const motivoLimpio = String(motivo || "")
            .replace(/[\r\n]+/g, " ")
            .replace(/\s{2,}/g, " ")
            .trim();

        if (!reservaIdNormalizado || !dniNormalizado || !nombreNormalizado) {
            return res.status(400).json({ error: "Faltan datos para validar la cancelacion." });
        }

        if (motivoLimpio.length < 8) {
            return res.status(400).json({ error: "Es necesario indicar un motivo de al menos 8 caracteres." });
        }

        const reservaRef = db.collection("reservas").doc(reservaIdNormalizado);
        const reservaSnap = await reservaRef.get();

        if (!reservaSnap.exists) {
            return res.status(404).json({ error: "No encontramos la reserva indicada." });
        }

        const reserva = reservaSnap.data() || {};
        const dniReserva = normalizarDni(reserva.dni);
        if (!dniReserva || dniReserva !== dniNormalizado) {
            return res.status(403).json({ error: "La reserva no corresponde al paciente indicado." });
        }

        const nombreReserva = normalizarTextoComparacion(obtenerNombreReserva(reserva));
        let nombreValido = nombreReserva === nombreNormalizado;

        if (!nombreValido) {
            const clienteDoc = await buscarClientePorDni(dniNormalizado);
            if (clienteDoc?.exists) {
                const cliente = clienteDoc.data() || {};
                const nombreCliente = normalizarTextoComparacion(cliente.fullName || cliente.nombre || "");
                nombreValido = nombreCliente === nombreNormalizado;
            }
        }

        if (!nombreValido) {
            return res.status(403).json({ error: "No pudimos validar la identidad del paciente para cancelar este turno." });
        }

        if (obtenerEstadoReserva(reserva) === "cancelado") {
            return res.status(200).json({
                status: "already_cancelled",
                slotReleased: true,
                reserva: {
                    id: reservaSnap.id,
                    fecha: reserva.fecha || "",
                    hora: reserva.hora || "",
                    servicio: reserva.servicio || "",
                    estado: "cancelado",
                    motivoCancelacion: reserva.motivoCancelacion || motivoLimpio
                }
            });
        }

        await reservaRef.update({
            status: "cancelado",
            estado: "cancelado",
            canceladoPor: "paciente",
            motivoCancelacion: motivoLimpio,
            canceladoAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        });

        return res.status(200).json({
            status: "cancelled",
            slotReleased: true,
            reserva: {
                id: reservaSnap.id,
                fecha: reserva.fecha || "",
                hora: reserva.hora || "",
                servicio: reserva.servicio || "",
                estado: "cancelado",
                motivoCancelacion: motivoLimpio,
                canceladoPor: "paciente"
            }
        });
    } catch (error) {
        console.error("cancelarReservaPaciente error:", error);
        return res.status(500).json({
            error: "No se pudo cancelar el turno en este momento.",
            detalles: error.message || "Error interno"
        });
    }
});

// ── FCM: notificar dispositivos Android al escribir/modificar reservas ────────
//
// Envía un data message a los tokens registrados en deviceTokens que
// correspondan a una app (appId) puntual. Cada doc de deviceTokens vive en
// deviceTokens/{uid}_{appId}_{installId} y trae un campo appId — así un
// mismo admin puede tener el Reloj y Mimar T Inteligente instalados a la
// vez sin que un token le pise el token del otro. La colección está vacía
// hoy en producción (ningún código llegó a escribirla nunca, ver auditoría),
// así que este esquema no tiene datos viejos que migrar.
//
// Colecciones escuchadas: reservas, sesiones (Reloj Mimar T, appId "reloj").
// Este es Firebase Cloud Messaging hacia la app Reloj (alarmas locales del
// dispositivo), no tiene nada que ver con WhatsApp — se conserva sin cambios
// de comportamiento, solo se migra de Gen1 a v2 (Gen1 no soporta Node 24,
// por eso estas dos funciones nunca llegaban a desplegarse) y se le agrega
// el filtro por appId.

async function notifyAndroidDevices(collection, docId, { appId = "reloj", extraData = {} } = {}) {
    try {
        const tokensSnap = await db.collection("deviceTokens").where("appId", "==", appId).get();
        if (tokensSnap.empty) return;
        const tokens = [];
        tokensSnap.forEach(d => {
            const t = d.data().token;
            if (t) tokens.push(t);
        });
        if (tokens.length === 0) return;
        const payload = {
            data: { type: "sync", collection, docId, ...extraData },
            // Sin esto, FCM puede tratar un data message como prioridad normal
            // y diferirlo bajo Doze/App Standby — justo el escenario en el que
            // más importa que la cancelación de una reserva borrada llegue
            // rápido al teléfono con la app cerrada.
            android: { priority: "high" },
        };
        // Enviar en batches de 500 (límite FCM)
        for (let i = 0; i < tokens.length; i += 500) {
            const batch = tokens.slice(i, i + 500);
            await admin.messaging().sendEachForMulticast({ tokens: batch, ...payload });
        }
    } catch (err) {
        logger.warn("notifyAndroidDevices error:", err.message);
    }
}

exports.onReservaWritten = onDocumentWritten("reservas/{docId}", async (event) => {
    await notifyAndroidDevices("reservas", event.params.docId);
});

exports.onSesionWritten = onDocumentWritten("sesiones/{docId}", async (event) => {
    await notifyAndroidDevices("sesiones", event.params.docId);
});

// ── Bandeja de actividad (Mimar T Inteligente) ──────────────────────────────
//
// activityLog/{eventId} — eventId = event.id del propio CloudEvent: es
// estable ante reintentos (un reintento del mismo trigger vuelve a entregar
// el mismo event.id), así que un `set` acá es naturalmente idempotente sin
// necesidad de deduplicar a mano.
//
// Los triggers solo disparan ante escrituras que ocurren a partir de que se
// despliegan — un documento que ya existía en la colección nunca genera un
// evento retroactivo. Por eso activar esto no produce una avalancha de
// "nueva reserva" para todo lo que ya estaba cargado: no hace falta ninguna
// marca de "activado desde tal fecha", es el comportamiento nativo de los
// triggers de Firestore.
//
// Cada trigger es selectivo: solo registra cambios que un ser humano
// consideraría una novedad (alta, cancelación, reprogramación, baja de
// membresía, etc.), no cualquier escritura de mantenimiento (por ejemplo
// clients.hoursBalance bajando en cada sesión, o campos internos tipo
// updatedAt) — eso sería ruido, no actividad relevante.

async function registrarEvento(eventId, { coleccion, docId, tipo, resumen, responsable = null, detalle = null }) {
    if (!resumen) return;
    try {
        await db.collection("activityLog").doc(eventId).set({
            coleccion,
            docId,
            tipo,
            resumen,
            responsable,
            detalle,
            timestamp: FieldValue.serverTimestamp(),
            leidoPor: {},
            atendido: false,
            atendidoPor: null,
            atendidoAt: null
        }, { merge: true });
    } catch (err) {
        logger.warn("registrarEvento error:", err.stack || err.message);
    }
}

function tipoDeCambio(before, after) {
    if (!before.exists && after.exists) return "create";
    if (before.exists && !after.exists) return "delete";
    return "update";
}

// reservas ───────────────────────────────────────────────────────────────
exports.onReservaActividad = onDocumentWritten("reservas/{docId}", async (event) => {
    const before = event.data.before;
    const after = event.data.after;
    const tipo = tipoDeCambio(before, after);
    const d = after.exists ? after.data() : before.data();
    const nombre = d.nombreLimpio || d.nombre || d.cliente || "Paciente";
    const fecha = d.fecha || "fecha sin registrar";
    const hora = d.hora ? ` ${d.hora}` : "";
    let resumen = null;
    let detalle = null;
    let responsable = null;

    if (tipo === "create") {
        resumen = `Nueva reserva: ${nombre} — ${fecha}${hora}`;
    } else if (tipo === "delete") {
        resumen = `Reserva eliminada: ${nombre} — ${fecha}${hora}`;
    } else {
        const antes = before.data();
        const estadoAntes = String(antes.estado || antes.status || "").toLowerCase();
        const estadoDespues = String(d.estado || d.status || "").toLowerCase();
        if (estadoAntes !== "cancelado" && estadoDespues === "cancelado") {
            resumen = `Reserva cancelada: ${nombre} — ${fecha}${hora}`;
            detalle = d.motivoCancelacion ? { motivo: d.motivoCancelacion } : null;
            responsable = d.canceladoPor === "paciente" ? { origen: "paciente" } : null;
        } else if (antes.fecha !== d.fecha || antes.hora !== d.hora) {
            resumen = `Reserva reprogramada: ${nombre} — ahora ${fecha}${hora}`;
            detalle = { fechaAnterior: antes.fecha || null, horaAnterior: antes.hora || null };
        } else if (antes.detalleSesion !== d.detalleSesion && d.detalleSesion) {
            resumen = `Nota de sesión agregada: ${nombre}`;
        } else {
            return; // cambio de rutina, no es una novedad
        }
    }
    await registrarEvento(event.id, { coleccion: "reservas", docId: event.params.docId, tipo, resumen, responsable, detalle });
});

// consultas — además dispara push nativo en altas (punto 5) ──────────────
exports.onConsultaActividad = onDocumentWritten("consultas/{docId}", async (event) => {
    const before = event.data.before;
    const after = event.data.after;
    const tipo = tipoDeCambio(before, after);
    const d = after.exists ? after.data() : before.data();
    const nombre = d.nombre || "Paciente";
    const fecha = d.fecha || "fecha sin registrar";
    const hora = d.hora ? ` ${d.hora}` : "";
    let resumen = null;
    let esNueva = false;

    if (tipo === "create") {
        resumen = `Nueva consulta inicial: ${nombre} — ${fecha}${hora}`;
        esNueva = true;
    } else if (tipo === "delete") {
        resumen = `Consulta inicial eliminada: ${nombre}`;
    } else {
        const antes = before.data();
        const estadoAntes = String(antes.estado || "").toLowerCase();
        const estadoDespues = String(d.estado || "").toLowerCase();
        if (estadoAntes !== estadoDespues && (estadoDespues === "cancelada" || estadoDespues === "confirmada")) {
            resumen = `Consulta inicial ${estadoDespues === "cancelada" ? "cancelada" : "confirmada"}: ${nombre}`;
        } else if (antes.fecha !== d.fecha || antes.hora !== d.hora) {
            resumen = `Consulta inicial reprogramada: ${nombre} — ahora ${fecha}${hora}`;
        } else {
            return;
        }
    }
    await registrarEvento(event.id, { coleccion: "consultas", docId: event.params.docId, tipo, resumen });
    if (esNueva) {
        await notifyAndroidDevices("consultas", event.params.docId, {
            appId: "inteligente",
            extraData: { tipoAviso: "consulta_nueva", titulo: "Nueva consulta inicial", texto: `${nombre} — ${fecha}${hora}` }
        });
    }
});

// pedidosKit — además dispara push nativo en altas (punto 5) ─────────────
exports.onPedidoKitActividad = onDocumentWritten("pedidosKit/{docId}", async (event) => {
    const before = event.data.before;
    const after = event.data.after;
    const tipo = tipoDeCambio(before, after);
    const d = after.exists ? after.data() : before.data();
    const nombre = d.nombrePaciente || "Paciente";
    let resumen = null;
    let esNuevo = false;

    if (tipo === "create") {
        resumen = `Nuevo pedido de kit: ${nombre}`;
        esNuevo = true;
    } else if (tipo === "delete") {
        resumen = `Pedido de kit eliminado: ${nombre}`;
    } else {
        const antes = before.data();
        if (antes.estado !== d.estado && d.estado === "entregado") {
            resumen = `Kit entregado: ${nombre}`;
        } else {
            return;
        }
    }
    await registrarEvento(event.id, { coleccion: "pedidosKit", docId: event.params.docId, tipo, resumen });
    if (esNuevo) {
        await notifyAndroidDevices("pedidosKit", event.params.docId, {
            appId: "inteligente",
            extraData: { tipoAviso: "kit_nuevo", titulo: "Nuevo pedido de kit", texto: nombre }
        });
    }
});

// clients — selectivo: alta, membresía, baja/reactivación. También mantiene
// cumpleMesDia al día (campo derivado para el resumen diario de cumpleaños,
// ver más abajo) en el mismo trigger para no tener dos triggers separados
// escribiéndose el uno al otro sobre el mismo documento. ───────────────────
exports.onClienteEscrito = onDocumentWritten("clients/{docId}", async (event) => {
    const before = event.data.before;
    const after = event.data.after;
    const tipo = tipoDeCambio(before, after);

    if (after.exists) {
        const d = after.data();
        const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(d.fechaNacimiento || "").trim());
        const mesDiaCorrecto = match ? `${match[1]}-${match[2]}` : null;
        if (d.cumpleMesDia !== mesDiaCorrecto) {
            // Ojo: NO cortar acá con un return — este mismo evento (alta,
            // cambio de membresía, etc.) todavía tiene que loguearse más
            // abajo. Esta escritura va a volver a disparar el trigger una
            // segunda vez; esa segunda pasada entra con cumpleMesDia ya
            // correcto y el resto de la lógica de abajo la descarta sola
            // por no haber cambios relevantes — así se corta el looping
            // sin necesidad de un corte explícito acá.
            await after.ref.update({ cumpleMesDia: mesDiaCorrecto });
        }
    }

    if (tipo === "delete") return; // baja de un doc de cliente no es un flujo normal del negocio

    const d = after.data();
    const nombre = d.fullName || d.nombre || "Paciente";
    let resumen = null;

    if (tipo === "create") {
        resumen = `Nuevo paciente registrado: ${nombre}`;
    } else {
        const antes = before.data();
        const membresiaAntes = antes.membershipActive === true;
        const membresiaDespues = d.membershipActive === true;
        if (membresiaAntes !== membresiaDespues) {
            resumen = membresiaDespues ? `Membresía activada: ${nombre}` : `Membresía desactivada: ${nombre}`;
        } else if (antes.active !== d.active) {
            resumen = d.active === false ? `Paciente dado de baja: ${nombre}` : `Paciente reactivado: ${nombre}`;
        } else {
            return; // hoursBalance, updatedAt, etc. — cambios de rutina, no novedad
        }
    }
    await registrarEvento(event.id, { coleccion: "clients", docId: event.params.docId, tipo, resumen });
});

// cursoMaquillaje ────────────────────────────────────────────────────────
exports.onCursoMaquillajeActividad = onDocumentWritten("cursoMaquillaje/{docId}", async (event) => {
    const before = event.data.before;
    const after = event.data.after;
    const tipo = tipoDeCambio(before, after);
    const d = after.exists ? after.data() : before.data();
    const nombre = d.nombre || d.nombreCompleto || "Paciente";
    let resumen = null;

    if (tipo === "create") {
        resumen = `Nueva inscripción al curso de automaquillaje: ${nombre}`;
    } else if (tipo === "delete") {
        resumen = `Inscripción al curso de automaquillaje eliminada: ${nombre}`;
    } else {
        return; // ediciones menores de una inscripción no son una novedad
    }
    await registrarEvento(event.id, { coleccion: "cursoMaquillaje", docId: event.params.docId, tipo, resumen });
});

// reservasDepi ───────────────────────────────────────────────────────────
exports.onReservaDepiActividad = onDocumentWritten("reservasDepi/{docId}", async (event) => {
    const before = event.data.before;
    const after = event.data.after;
    const tipo = tipoDeCambio(before, after);
    const d = after.exists ? after.data() : before.data();
    const nombre = d.nombre || "Paciente";
    const fecha = d.fecha || "fecha sin registrar";
    const hora = d.hora ? ` ${d.hora}` : "";
    let resumen = null;
    let detalle = null;

    if (tipo === "create") {
        resumen = `Nueva reserva de depilación: ${nombre} — ${fecha}${hora}`;
    } else if (tipo === "delete") {
        resumen = `Reserva de depilación eliminada: ${nombre}`;
    } else {
        const antes = before.data();
        const estadoAntes = String(antes.estado || "").toLowerCase();
        const estadoDespues = String(d.estado || "").toLowerCase();
        if (estadoAntes !== "cancelado" && estadoDespues === "cancelado") {
            resumen = `Reserva de depilación cancelada: ${nombre}`;
        } else if (antes.fecha !== d.fecha || antes.hora !== d.hora) {
            resumen = `Reserva de depilación reprogramada: ${nombre} — ahora ${fecha}${hora}`;
            detalle = { fechaAnterior: antes.fecha || null, horaAnterior: antes.hora || null };
        } else {
            return;
        }
    }
    await registrarEvento(event.id, { coleccion: "reservasDepi", docId: event.params.docId, tipo, resumen, detalle });
});

// ── Resumen diario de cumpleaños (punto 4) ──────────────────────────────────
//
// clients.fechaNacimiento se guarda como string "YYYY-MM-DD" (ver
// auditoría) — nunca Timestamp. cumpleMesDia ("MM-DD", mantenido por
// onClienteEscrito más arriba) permite una query indexada en vez de
// escanear toda la colección cada mañana. Alguien nacido el 29 de febrero
// solo matchea en un año bisiesto real: es una decisión explícita, no se
// inventa una regla para "observarlo" el 28 en años no bisiestos.
//
// "Horario configurable" sin necesitar un redeploy: la función corre cada
// hora en punto y solo genera el resumen cuando la hora actual (zona
// Argentina) coincide con configuracion/notificaciones.horaCumpleanos
// (default 8) — así cambiar el horario es escribir un número en Firestore,
// no tocar código.
const ZONA_HORARIA_AR = "America/Argentina/Buenos_Aires";

function partesFechaEnZona(date, timeZone, opciones) {
    return new Intl.DateTimeFormat("en-CA", { timeZone, ...opciones })
        .formatToParts(date)
        .reduce((acc, p) => { if (p.type !== "literal") acc[p.type] = p.value; return acc; }, {});
}

function hoyISOEnZonaAR(date = new Date()) {
    const p = partesFechaEnZona(date, ZONA_HORARIA_AR, { year: "numeric", month: "2-digit", day: "2-digit" });
    return `${p.year}-${p.month}-${p.day}`;
}

function hoyMesDiaEnZonaAR(date = new Date()) {
    const p = partesFechaEnZona(date, ZONA_HORARIA_AR, { month: "2-digit", day: "2-digit" });
    return `${p.month}-${p.day}`;
}

function horaActualEnZonaAR(date = new Date()) {
    const p = partesFechaEnZona(date, ZONA_HORARIA_AR, { hour: "2-digit", hour12: false });
    const h = Number(p.hour);
    return h === 24 ? 0 : h; // algunas implementaciones de Intl devuelven "24" para medianoche
}

exports.resumenCumpleanosDiario = onSchedule(
    { schedule: "0 * * * *", timeZone: ZONA_HORARIA_AR, region: "us-central1" },
    async () => {
        let horaConfigurada = 8;
        try {
            const cfgSnap = await db.collection("configuracion").doc("notificaciones").get();
            const cfg = cfgSnap.exists ? (cfgSnap.data() || {}) : {};
            if (Number.isInteger(cfg.horaCumpleanos) && cfg.horaCumpleanos >= 0 && cfg.horaCumpleanos <= 23) {
                horaConfigurada = cfg.horaCumpleanos;
            }
        } catch (_) { /* usa el default de las 8 */ }

        if (horaActualEnZonaAR() !== horaConfigurada) return; // no es la hora configurada — no hace nada esta pasada

        const fechaISO = hoyISOEnZonaAR();
        const mesDia = hoyMesDiaEnZonaAR();
        const docRef = db.collection("resumenesCumpleanos").doc(fechaISO); // set() por fecha → idempotente ante reintentos

        try {
            const snap = await db.collection("clients").where("cumpleMesDia", "==", mesDia).get();
            const personas = [];
            snap.forEach((d) => {
                const c = d.data();
                personas.push({
                    clientId: d.id,
                    nombre: c.fullName || c.nombre || "Paciente",
                    telefonoDisponible: !!(c.phone || c.telefono)
                });
            });

            await docRef.set({
                fecha: fechaISO,
                estado: "ok",
                generadoAt: FieldValue.serverTimestamp(),
                personas
            });

            if (personas.length) {
                await notifyAndroidDevices("clients", fechaISO, {
                    appId: "inteligente",
                    extraData: {
                        tipoAviso: "cumpleanos",
                        titulo: personas.length === 1 ? "Hoy cumple años" : `Hoy cumplen años ${personas.length} pacientes`,
                        texto: personas.map((p) => p.nombre).join(", ")
                    }
                });
            }
        } catch (error) {
            logger.error("resumenCumpleanosDiario error:", error.message || error);
            await docRef.set({
                fecha: fechaISO,
                estado: "error",
                generadoAt: FieldValue.serverTimestamp(),
                detalle: error.message || String(error)
            }, { merge: true });
        }
    }
);
