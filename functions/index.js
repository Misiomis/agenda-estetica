const functions = require("firebase-functions");
const functionsV1 = require("firebase-functions/v1");
const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

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
        hoursBalance: admin.firestore.FieldValue.increment(-1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
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
            fechaAceptacion: admin.firestore.FieldValue.serverTimestamp(),
            consultaNutricionalRespondida: prev.consultaNutricionalRespondida === true,
            historiaCompletada: prev.historiaCompletada === true,
            campaign: {
                source: String(sourceTag || "jornada_especial"),
                serviceName: String(serviceName || "Jornada Especial"),
                allowedDates: Array.isArray(allowedDates) ? allowedDates : [],
                lastSignupAt: admin.firestore.FieldValue.serverTimestamp()
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        if (!snap.exists) {
            payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
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
            canceladoAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
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
// Envía un data message tipo "sync" a todos los tokens registrados en
// deviceTokens/{userId} cuando se crea o modifica una reserva o sesión.
// El FCMService.kt en Android lo recibe y encola SyncWorker.
//
// Colecciones escuchadas: reservas, sesiones
//
// Esto es Firebase Cloud Messaging hacia la app "Reloj Mimar T" (alarmas
// locales del dispositivo), no tiene nada que ver con WhatsApp — se conserva
// sin cambios.

async function notifyAndroidDevices(collection, docId) {
    try {
        const tokensSnap = await db.collection("deviceTokens").get();
        if (tokensSnap.empty) return;
        const tokens = [];
        tokensSnap.forEach(d => {
            const t = d.data().token;
            if (t) tokens.push(t);
        });
        if (tokens.length === 0) return;
        const payload = {
            data: { type: "sync", collection, docId },
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

exports.onReservaWritten = functionsV1.firestore
    .document("reservas/{docId}")
    .onWrite(async (change, context) => {
        await notifyAndroidDevices("reservas", context.params.docId);
    });

exports.onSesionWritten = functionsV1.firestore
    .document("sesiones/{docId}")
    .onWrite(async (change, context) => {
        await notifyAndroidDevices("sesiones", context.params.docId);
    });
