const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const pendientesLogic = require("./pendientes-logic");
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
        // "01-01" es un valor de relleno heredado de un alta antigua sin
        // fecha real (auditoría: 58 de 58 clientes con formato válido caen
        // exactamente en "01-01" — estadísticamente imposible como
        // distribución real de nacimientos). Tratarlo como fecha real
        // generaría un cumpleaños falso masivo cada 1° de enero. Se trata
        // como "sin fecha registrada", no como un cumpleaños real — nunca
        // se inventa un dato a partir de un placeholder.
        const mesDiaCandidato = match ? `${match[1]}-${match[2]}` : null;
        const mesDiaCorrecto = mesDiaCandidato === "01-01" ? null : mesDiaCandidato;
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

// prestaciones — precio acordado por sesión (punto 2 de facturación) ─────
exports.onPrestacionActividad = onDocumentWritten("prestaciones/{docId}", async (event) => {
    const before = event.data.before;
    const after = event.data.after;
    const tipo = tipoDeCambio(before, after);
    if (tipo === "delete") return; // las prestaciones no se borran (se anulan) — no hay flujo real que las elimine
    const d = after.data();
    const nombre = d.pacienteNombre || "Paciente";
    const precioTxt = d.sinCargo ? "sin cargo" : (typeof d.precioAcordado === "number" ? `$${Math.round(d.precioAcordado).toLocaleString("es-AR")}` : "sin definir");
    let resumen = null;
    let detalle = null;

    if (tipo === "create") {
        resumen = `Precio registrado: ${nombre} — ${precioTxt}`;
    } else {
        const antes = before.data();
        if (antes.anulada !== d.anulada && d.anulada === true) {
            resumen = `Prestación anulada: ${nombre}`;
            detalle = d.motivoAnulacion ? { motivo: d.motivoAnulacion } : null;
        } else if (antes.precioAcordado !== d.precioAcordado || antes.sinCargo !== d.sinCargo) {
            resumen = `Precio actualizado: ${nombre} — ahora ${precioTxt}`;
            detalle = { precioAnterior: antes.precioAcordado ?? null, sinCargoAnterior: antes.sinCargo ?? null };
        } else {
            return; // actualizadoEn/actualizadoPor sin cambio real de precio — no es novedad
        }
    }
    await registrarEvento(event.id, { coleccion: "prestaciones", docId: event.params.docId, tipo, resumen, detalle, responsable: d.actualizadoPor ? { origen: "admin", valor: d.actualizadoPor } : null });
});

// pagos — cobros/devoluciones (punto 2). Inmutables por reglas (sin
// update/delete desde el cliente), así que solo el ALTA es una novedad real.
// Ojo con event.id: es el id de ESTA entrega del evento, no del documento —
// dos escrituras al mismo pago (reintento que en producción rechazan las
// reglas, pero también un guión de administración con el Admin SDK que sí
// puede reescribir) generan dos event.id DISTINTOS. La idempotencia real acá
// no es event.id: es exigir before.exists === false — sólo la primera
// creación de este operationId (el id del propio documento) cuenta como
// "Cobro/Devolución registrada"; cualquier escritura posterior al MISMO id
// se ignora, así nunca aparecen dos ingresos por un mismo pago. Verificado
// con tests/functions-emulator/test-activity-log.js (reescribir el mismo
// documento con contenido idéntico no duplica el evento).
exports.onPagoActividad = onDocumentWritten("pagos/{docId}", async (event) => {
    const before = event.data.before;
    const after = event.data.after;
    if (!after.exists) return; // sin delete real (regla de Firestore lo impide) — nada que registrar
    if (before.exists) return; // no es un alta nueva — mismo operationId ya procesado antes, se ignora
    const d = after.data();
    const nombre = d.pacienteNombre || "Paciente";
    const montoTxt = typeof d.monto === "number" ? `$${Math.round(d.monto).toLocaleString("es-AR")}` : "monto sin registrar";
    const resumen = d.tipo === "devolucion"
        ? `Devolución registrada: ${nombre} — ${montoTxt}`
        : `Cobro registrado: ${nombre} — ${montoTxt}`;
    await registrarEvento(event.id, {
        coleccion: "pagos", docId: event.params.docId, tipo: "create", resumen,
        detalle: { prestacionId: d.prestacionId || null, metodoPago: d.metodoPago || null, fechaEfectiva: d.fechaEfectiva || null, motivo: d.motivo || null },
        responsable: d.creadoPor ? { origen: "admin", valor: d.creadoPor } : null,
    });
});

// gastos — punto 4 de facturación ─────────────────────────────────────────
exports.onGastoActividad = onDocumentWritten("gastos/{docId}", async (event) => {
    const before = event.data.before;
    const after = event.data.after;
    const tipo = tipoDeCambio(before, after);
    if (tipo === "delete") return; // no hay flujo que borre gastos (se anulan)
    const d = after.data();
    const montoTxt = d.modalidad === "porcentaje_estimado" ? `${d.porcentaje}% estimado` : `$${Math.round(d.montoFijo || 0).toLocaleString("es-AR")}`;
    let resumen = null;

    if (tipo === "create") {
        resumen = `Nuevo gasto: ${d.concepto || "sin concepto"} — ${montoTxt}`;
    } else {
        const antes = before.data();
        if (antes.estado !== d.estado && d.estado === "pagado") {
            resumen = `Gasto marcado como pagado: ${d.concepto || "sin concepto"} — ${montoTxt}`;
        } else if (!antes.reemplazadoPorGastoId && d.reemplazadoPorGastoId) {
            resumen = `Estimado reemplazado por gasto real: ${d.concepto || "sin concepto"}`;
        } else if (antes.anulado !== d.anulado && d.anulado === true) {
            resumen = `Gasto anulado: ${d.concepto || "sin concepto"}`;
        } else {
            return;
        }
    }
    await registrarEvento(event.id, { coleccion: "gastos", docId: event.params.docId, tipo, resumen });
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

// ── GlowUp: aviso horario de pendientes (punto 4 del pedido) ────────────
//
// Corre cada hora en punto (mismo mecanismo que el resumen de cumpleaños:
// Cloud Scheduler vía onSchedule Gen2 — la evaluación NO depende de que la
// app/WebView esté abierta). Reglas de "qué es un pendiente" en
// functions/pendientes-logic.js, espejo documentado de
// mimar-inteligente-logic.js (mismo archivo no es posible: ESM vs
// CommonJS — ver comentario en ese módulo).
//
// Fiabilidad: onSchedule puede reintentar o solaparse. Se identifica cada
// ejecución por (uid, franja horaria lógica) usando event.scheduleTime —
// NUNCA Date.now() — para que un reintento de la MISMA franja calcule la
// MISMA clave. Un "reclamo" transaccional en avisosEnviadosInteligente
// decide si esta franja ya se avisó para ese uid; el envío de FCM se hace
// SIEMPRE fuera de la transacción (Firestore y FCM no son una transacción
// conjunta). Ventana de incertidumbre documentada: si el proceso muere
// después de confirmar el reclamo pero antes de que FCM devuelva una
// respuesta, esa franja puede quedar sin aviso visible — se acepta esa
// pérdida acotada a como mucho 1 hora (la próxima franja vuelve a evaluar
// los mismos pendientes si siguen sin resolverse) en vez de arriesgar un
// doble aviso. Mitigación adicional del lado Android: notificationId
// estable por (uid, franja) en FCMService, así un reintento de FCM que sí
// llegue a entregarse dos veces solo actualiza la misma notificación
// visible, nunca la duplica.
const ZONA_HORARIA_INTELIGENTE = pendientesLogic.ZONA_HORARIA;

function franjaHorariaAR(ms) {
    const p = partesFechaEnZona(new Date(ms), ZONA_HORARIA_INTELIGENTE, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false });
    const hora = p.hour === "24" ? "00" : p.hour;
    return `${p.year}-${p.month}-${p.day}T${hora}`;
}

async function construirPendientesGlobales(ahoraMs) {
    const hoyISO = hoyISOEnZonaAR(new Date(ahoraMs));
    const mananaDate = new Date(ahoraMs); mananaDate.setUTCDate(mananaDate.getUTCDate() + 1);
    const mananaISO = hoyISOEnZonaAR(mananaDate);
    // "Los pendientes de días anteriores no deben desaparecer porque la
    // agenda solo consulte hoy y mañana" — se amplía hacia atrás de forma
    // ACOTADA (VENTANA_REVISAR_TURNO_DIAS) e indexada: rango simple sobre
    // un solo campo (fecha >= X y <= mañana), no requiere índice compuesto
    // nuevo y no usa != / not-in (que excluirían documentos sin el campo).
    const desdeDate = new Date(ahoraMs - pendientesLogic.VENTANA_REVISAR_TURNO_DIAS * 24 * 60 * 60 * 1000);
    const desdeISO = hoyISOEnZonaAR(desdeDate);

    const [reservasSnap, consultasSnap, kitsSnap, cumpleSnap, recSnap, clientesSnap] = await Promise.all([
        db.collection("reservas").where("fecha", ">=", desdeISO).where("fecha", "<=", mananaISO).get(),
        db.collection("consultas").where("fecha", ">=", desdeISO).where("fecha", "<=", mananaISO).get(),
        db.collection("pedidosKit").where("estado", "==", "pendiente").get(),
        db.collection("resumenesCumpleanos").doc(hoyISO).get(),
        db.collection("recomendacionesInteligente").where("estado", "==", "pendiente").where("programadoParaMs", "<=", ahoraMs).get(),
        db.collection("clients").get(),
    ]);

    const reservasRaw = reservasSnap.docs.map((d) => ({ id: d.id, data: d.data() }));
    const consultasRaw = consultasSnap.docs.map((d) => ({ id: d.id, data: d.data() }));
    const pedidosKitPendientesRaw = kitsSnap.docs.map((d) => ({ id: d.id, data: d.data() }));
    const recomendacionesRaw = recSnap.docs.map((d) => ({ id: d.id, data: d.data() }));
    const cumpleanosHoy = cumpleSnap.exists ? cumpleSnap.data() : null;
    const clientesPorDni = {};
    clientesSnap.docs.forEach((d) => { clientesPorDni[d.id] = d.data(); });

    // Candidatos a "confirmación pendiente" (dentro de la ventana vigente) y
    // a "cumpleaños hoy" son, como mucho, un puñado por hora — se resuelve
    // su contacto con un multi-get ACOTADO a esos ids puntuales, nunca
    // leyendo toda la colección contactosWhatsApp (que crece sin límite
    // con los años).
    const idsContactoCandidatos = new Set();
    for (const r of reservasRaw) {
        const item = pendientesLogic.normalizarItemAgenda("reservas", r.id, r.data, clientesPorDni);
        if (pendientesLogic.calcularRevision(item, ahoraMs)) idsContactoCandidatos.add(pendientesLogic.idContactoParaItem(item, "confirmacion"));
    }
    for (const c of consultasRaw) {
        const item = pendientesLogic.normalizarItemAgenda("consultas", c.id, c.data, clientesPorDni);
        if (pendientesLogic.calcularRevision(item, ahoraMs)) idsContactoCandidatos.add(pendientesLogic.idContactoParaItem(item, "consulta"));
    }
    if (cumpleanosHoy?.estado === "ok") {
        for (const persona of (cumpleanosHoy.personas || [])) {
            idsContactoCandidatos.add(`clients_${pendientesLogic.docIdVersionadoCumpleanos(persona.clientId, cumpleanosHoy.fecha)}_cumpleanos`);
        }
    }

    const contactosPorId = {};
    if (idsContactoCandidatos.size) {
        const refs = [...idsContactoCandidatos].map((id) => db.collection("contactosWhatsApp").doc(id));
        const docs = await db.getAll(...refs);
        docs.forEach((snap) => { if (snap.exists) contactosPorId[snap.id] = snap.data(); });
    }

    return pendientesLogic.derivarPendientes(
        { reservasRaw, consultasRaw, pedidosKitPendientesRaw, cumpleanosHoy, recomendacionesRaw, contactosPorId, clientesPorDni },
        ahoraMs
    );
}

exports.recordatorioPendientesHoraria = onSchedule(
    { schedule: "0 * * * *", timeZone: ZONA_HORARIA_INTELIGENTE, region: "us-central1" },
    async (event) => {
        const scheduleTimeMs = event?.scheduleTime ? new Date(event.scheduleTime).getTime() : Date.now();
        // Reintentos disparados mucho después de su hora lógica no tienen
        // sentido como "aviso de esta franja" — se descartan en vez de
        // alertar tarde con datos posiblemente ya resueltos.
        if (Date.now() - scheduleTimeMs > 30 * 60 * 1000) {
            logger.warn("recordatorioPendientesHoraria: ejecución demasiado vieja, se descarta", { scheduleTimeMs });
            return;
        }
        const franja = franjaHorariaAR(scheduleTimeMs);

        const tokensSnap = await db.collection("deviceTokens").where("appId", "==", "inteligente").get();
        if (tokensSnap.empty) return; // nadie tiene la app instalada con push activo

        const porUid = new Map();
        tokensSnap.forEach((d) => {
            const t = d.data();
            if (!t.uid || !t.token) return;
            if (!porUid.has(t.uid)) porUid.set(t.uid, []);
            porUid.get(t.uid).push({ ref: d.ref, token: t.token });
        });

        const pendientesGlobales = await construirPendientesGlobales(scheduleTimeMs);
        if (!pendientesGlobales.length) return; // nada habilitado para nadie — nunca se avisa vacío

        // Overrides (postergado/resuelto) SOLO de los pendientes que
        // realmente existen esta hora — multi-get acotado, no toda la
        // colección.
        const overrideRefs = pendientesGlobales.map((p) => db.collection("pendienteEstadoInteligente").doc(p.id));
        const overrideDocs = overrideRefs.length ? await db.getAll(...overrideRefs) : [];
        const overridesPorId = {};
        overrideDocs.forEach((snap) => { if (snap.exists) overridesPorId[snap.id] = snap.data(); });

        for (const [uid, dispositivos] of porUid.entries()) {
            let prefs = pendientesLogic.PREFS_AVISOS_DEFECTO;
            try {
                const prefsSnap = await db.collection("configNotificacionesInteligente").doc(uid).get();
                if (prefsSnap.exists) prefs = { ...pendientesLogic.PREFS_AVISOS_DEFECTO, ...prefsSnap.data() };
            } catch (_) { /* usa el default */ }

            const elegibles = pendientesLogic.pendientesElegiblesParaAviso(pendientesGlobales, prefs, overridesPorId, scheduleTimeMs);
            if (!elegibles.length) continue; // esta persona no tiene nada elegible esta hora (pausada, categorías, descanso, etc.)

            const claveDedup = `${uid}_inteligente_${franja}`;
            const claimRef = db.collection("avisosEnviadosInteligente").doc(claveDedup);
            let yaReclamado = false;
            await db.runTransaction(async (tx) => {
                const snap = await tx.get(claimRef);
                if (snap.exists) { yaReclamado = true; return; }
                tx.set(claimRef, {
                    uid, appId: "inteligente", franja, scheduleTimeMs,
                    estado: "reclamado",
                    cantidadPendientes: elegibles.length,
                    conteoPorTipo: pendientesLogic.contarPendientesPorTipo(elegibles),
                    creadoAt: FieldValue.serverTimestamp(),
                });
            });
            if (yaReclamado) {
                logger.info("recordatorioPendientesHoraria: franja ya reclamada, no se reenvía", { uid, franja });
                continue;
            }

            const texto = pendientesLogic.resumenTextoPendientes(elegibles);
            const tokens = dispositivos.map((d) => d.token);
            try {
                // FCM siempre fuera de la transacción de Firestore.
                const resultado = await admin.messaging().sendEachForMulticast({
                    tokens,
                    data: {
                        tipoAviso: "pendientes_resumen",
                        titulo: "Pendientes de Mimar T Inteligente",
                        texto,
                        franja,
                    },
                    android: {
                        priority: "high",
                        // TTL corto: si el dispositivo estuvo offline más de
                        // ~55 min, mejor que la próxima franja (que va a
                        // recalcular con datos frescos) sea la que avise, no
                        // una ráfaga de resúmenes viejos al reconectar.
                        ttl: 55 * 60 * 1000,
                        collapseKey: `pendientes_${uid}`,
                    },
                });
                // Tokens inválidos se dan de baja según el ERROR REAL de
                // cada respuesta individual — un fallo de payload/red no
                // borra tokens que en realidad siguen sirviendo.
                resultado.responses.forEach((r, i) => {
                    if (r.success) return;
                    const code = r.error?.code || "";
                    if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
                        dispositivos[i].ref.delete().catch(() => {});
                    }
                });
                await claimRef.set({
                    estado: "enviado", exitos: resultado.successCount, fallos: resultado.failureCount,
                    enviadoAt: FieldValue.serverTimestamp(),
                }, { merge: true });
                logger.info("recordatorioPendientesHoraria: enviado", { uid, franja, cantidad: elegibles.length, exitos: resultado.successCount, fallos: resultado.failureCount });
            } catch (err) {
                await claimRef.set({ estado: "error", detalle: err.message || String(err) }, { merge: true }).catch(() => {});
                logger.error("recordatorioPendientesHoraria: fallo al enviar FCM", { uid, franja, error: err.message || String(err) });
            }
        }
    }
);

// ══════════════════════════════════════════════════════════════════════
// TEMPORAL — exportarContactosAdmin (solo lectura)
// ══════════════════════════════════════════════════════════════════════
// Se agrega a pedido puntual para exportar nombres y teléfonos reales a un
// archivo que la administradora pueda importar a su agenda/WhatsApp. Se
// ejecuta del lado del servidor (Admin SDK, sin las restricciones de
// lectura masiva de un cliente) y SOLO puede dispararla la cuenta admin
// (mismo criterio que esAdmin() en firestore.rules). No escribe, actualiza
// ni borra ningún documento — únicamente lee y arma la respuesta.
// Se retira de este archivo (y de Cloud Functions, con
// `firebase functions:delete exportarContactosAdmin`) apenas se usa.
const ADMIN_EMAIL_EXPORT = "espaciomimart36@gmail.com";
const COLECCIONES_EXPORT = [
    "reservas", "consultas", "pedidosKit", "historias", "reservasDepi",
    "control_consultas_iniciales", "cursoMaquillaje", "pacientesDoctora",
    "turnosDoctora", "recomendacionesInteligente",
];
const CAMPOS_TELEFONO_EXPORT = new Set([
    "telefono", "telefonos", "phone", "phones", "phonewa", "whatsapp",
    "celular", "cel", "tel", "telefonocontacto", "telefonoalternativo",
    "telefonofamiliar", "telefonoemergencia",
]);
const CAMPOS_NOMBRE_EXPORT = ["fullname", "fulllname", "nombre", "nombrelimpio", "nombrepaciente", "paciente", "clientenombre", "name"];
const CAMPOS_DNI_EXPORT = ["dni", "clientedni", "documento"];

function normClaveExport(k) { return k.toLowerCase().replace(/[^a-z]/g, ""); }

function extraerTelefonosExport(obj, rutaBase = "") {
    const hallazgos = [];
    function recorrer(nodo, ruta) {
        if (nodo == null) return;
        if (Array.isArray(nodo)) { nodo.forEach((it, i) => recorrer(it, `${ruta}[${i}]`)); return; }
        if (typeof nodo === "object") {
            if (typeof nodo.toDate === "function" || typeof nodo._seconds === "number") return;
            for (const [clave, valor] of Object.entries(nodo)) {
                const rutaHija = ruta ? `${ruta}.${clave}` : clave;
                if (CAMPOS_TELEFONO_EXPORT.has(normClaveExport(clave)) && (typeof valor === "string" || typeof valor === "number")) {
                    const texto = String(valor).trim();
                    if (texto) hallazgos.push({ valor: texto, campoOrigen: rutaHija });
                } else if (typeof valor === "object") {
                    recorrer(valor, rutaHija);
                }
            }
        }
    }
    recorrer(obj, rutaBase);
    return hallazgos;
}

function buscarCampoExport(data, listaCampos) {
    for (const campo of listaCampos) {
        const real = Object.keys(data).find((k) => normClaveExport(k) === campo);
        if (real && data[real] && String(data[real]).trim()) return String(data[real]).trim();
    }
    return null;
}

function normalizarTelefonoARExport(crudo) {
    let d = String(crudo || "").replace(/[^\d]/g, "");
    if (!d) return { normalizado: null, motivo: "sin_digitos" };
    if (d.startsWith("549") && d.length === 13) return { normalizado: "+" + d, motivo: null };
    if (d.startsWith("54") && !d.startsWith("549") && d.length === 12) return { normalizado: "+549" + d.slice(2), motivo: null };
    let limpio = d;
    if (limpio.startsWith("0")) limpio = limpio.slice(1);
    const sin15 = limpio.replace(/15(?=\d{6,7}$)/, "");
    if (sin15.length === 10) limpio = sin15;
    if (limpio.length === 10 && /^\d{10}$/.test(limpio)) return { normalizado: "+549" + limpio, motivo: null };
    if (limpio.length === 11 && limpio.startsWith("9")) return { normalizado: "+54" + limpio, motivo: null };
    return { normalizado: null, motivo: `longitud_ambigua(${d.length}_digitos)` };
}

function esDniOImporteExport(valor) {
    const d = String(valor).replace(/[^\d]/g, "");
    return d.length >= 7 && d.length <= 8 && !/^0|^15|^9/.test(d);
}

async function leerColeccionCompletaExport(nombreColeccion, errores) {
    const docs = [];
    let ultimoCursor = null;
    try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
            let q = db.collection(nombreColeccion).orderBy(admin.firestore.FieldPath.documentId()).limit(500);
            if (ultimoCursor) q = q.startAfter(ultimoCursor);
            const snap = await q.get();
            if (snap.empty) break;
            snap.docs.forEach((d) => docs.push(d));
            ultimoCursor = snap.docs[snap.docs.length - 1].id;
            if (snap.docs.length < 500) break;
        }
    } catch (e) {
        errores.push({ coleccion: nombreColeccion, error: e.message || String(e) });
    }
    return docs;
}

exports.exportarContactosAdmin = onCall({ timeoutSeconds: 300, memory: "512MiB" }, async (request) => {
    const email = request.auth?.token?.email || "";
    if (email !== ADMIN_EMAIL_EXPORT) {
        throw new HttpsError("permission-denied", "Solo la cuenta admin puede exportar contactos.");
    }

    const errores = [];
    const registros = [];
    const porRevisar = [];
    let docsRevisados = 0;
    const coleccionesRecorridas = [];

    const clientDocs = await leerColeccionCompletaExport("clients", errores);
    const clientesPorDni = {};
    clientDocs.forEach((d) => { clientesPorDni[d.id] = d.data(); });
    coleccionesRecorridas.push({ coleccion: "clients", documentos: clientDocs.length });
    docsRevisados += clientDocs.length;

    for (const coleccion of COLECCIONES_EXPORT) {
        const docs = await leerColeccionCompletaExport(coleccion, errores);
        coleccionesRecorridas.push({ coleccion, documentos: docs.length });
        docsRevisados += docs.length;

        for (const docSnap of docs) {
            const data = docSnap.data() || {};
            const ruta = `${coleccion}/${docSnap.id}`;
            const telefonos = extraerTelefonosExport(data);
            if (!telefonos.length) continue;

            let nombre = buscarCampoExport(data, CAMPOS_NOMBRE_EXPORT);
            let nombreOrigen = nombre ? "documento_propio" : null;
            const dni = buscarCampoExport(data, CAMPOS_DNI_EXPORT);
            if (!nombre && dni && clientesPorDni[dni]) {
                const cliente = clientesPorDni[dni];
                nombre = cliente.fullName || cliente.fullLname || cliente.nombre || cliente.name || null;
                if (nombre) nombreOrigen = `resuelto_por_dni(clients/${dni})`;
            }

            for (const { valor, campoOrigen } of telefonos) {
                const ambiguo = esDniOImporteExport(valor);
                const { normalizado, motivo } = normalizarTelefonoARExport(valor);
                const registro = {
                    nombre_registrado: nombre, nombre_origen: nombreOrigen,
                    telefono_original: valor, telefono_normalizado: ambiguo ? null : normalizado,
                    titular_dni: dni || null, documento: ruta, campo_origen: campoOrigen,
                    observaciones: [],
                };
                if (!nombre) registro.observaciones.push("Sin nombre registrado ni resoluble por DNI.");
                if (ambiguo) registro.observaciones.push("Longitud típica de DNI (7-8 dígitos) sin prefijo — ambiguo.");
                else if (motivo) registro.observaciones.push(`No se pudo normalizar con certeza: ${motivo}.`);
                registros.push(registro);
                if (!nombre || !registro.telefono_normalizado) porRevisar.push({ ...registro });
            }
        }
    }

    const telefonosUnicos = new Set(registros.filter((r) => r.telefono_normalizado).map((r) => r.telefono_normalizado));

    const porPersona = new Map();
    for (const r of registros) {
        if (!r.telefono_normalizado) continue;
        const nombre = r.nombre_registrado || `Sin nombre registrado - ${r.telefono_normalizado}`;
        const clave = r.nombre_registrado ? `${r.nombre_registrado}|${r.titular_dni || ""}` : `sinnombre|${r.telefono_normalizado}`;
        if (!porPersona.has(clave)) porPersona.set(clave, { nombre, telefonos: new Set() });
        porPersona.get(clave).telefonos.add(r.telefono_normalizado);
    }
    const escaparVcf = (s) => String(s).replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
    let vcf = "";
    for (const { nombre, telefonos } of porPersona.values()) {
        vcf += "BEGIN:VCARD\r\nVERSION:3.0\r\n";
        vcf += `FN:${escaparVcf(nombre)}\r\n`;
        vcf += `N:${escaparVcf(nombre)};;;;\r\n`;
        for (const tel of telefonos) vcf += `TEL;TYPE=CELL:${tel}\r\n`;
        vcf += "END:VCARD\r\n";
    }

    logger.info("exportarContactosAdmin: ejecutada", { por: email, docsRevisados, telefonos: registros.length, errores: errores.length });

    return {
        fecha_exportacion: new Date().toISOString(),
        proyecto_firebase: "estetica-8d067",
        base: "Cloud Firestore (default)",
        colecciones_recorridas: coleccionesRecorridas,
        total_documentos_revisados: docsRevisados,
        total_telefonos_encontrados: registros.length,
        total_telefonos_unicos_normalizados: telefonosUnicos.size,
        errores,
        exportacion_completa: errores.length === 0,
        registros,
        por_revisar: porRevisar,
        vcf,
        contactos_vcf: porPersona.size,
    };
});
