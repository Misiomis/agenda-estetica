const functions = require("firebase-functions");
const functionsV1 = require("firebase-functions/v1");
const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const axios = require("axios");

admin.initializeApp();
const db = admin.firestore();

const ARGENTINA_TIME_ZONE = "America/Argentina/Buenos_Aires";
const DEFAULT_REMINDER_TEMPLATE_NAME = "recordatorio_turno";
const DEFAULT_REMINDER_TEMPLATE_LANG = "es_AR";
const DEFAULT_GOOGLE_MAPS_LINK = "https://maps.google.com/?q=Espacio+Mimar+T";
const META_API_VERSION = "v21.0";
const WHATSAPP_FALLBACK_CONFIG = {
    token: "EAAMzA3ngIUkBRMpXw5ZBCCzVCFZAum3yF3dcHlgOPZAigiAIXERNfxpGfq21VCEgiByPN5xhm9mZBUyJ0WWqTl0xoB8ZBEs8EEh2FVC82aDHizTv0bKvMrcH7mkO99svZCMymZAi07nnmnBZCeHlI8XdnMBfJI1pnjVFWQZCdCIOBZA8fDa71OuvkVZCJu5bTR91wZDZD",
    phoneNumberId: "995248997010108",
    wabaId: "995248997010108",
    reminderTemplateName: DEFAULT_REMINDER_TEMPLATE_NAME,
    reminderTemplateLang: DEFAULT_REMINDER_TEMPLATE_LANG,
    googleMapsLink: DEFAULT_GOOGLE_MAPS_LINK
};

function normalizarDni(rawDni) {
    return String(rawDni || "").replace(/\D/g, "");
}

function normalizarNombreUsuario(rawName) {
    return String(rawName || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s]/g, "")
        .trim()
        .replace(/\s+/g, ".");
}

function normalizarTextoComparacion(rawValue) {
    return String(rawValue || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s]/g, " ")
        .trim()
        .replace(/\s+/g, " ");
}

function normalizarTelefonoAR(rawPhone) {
    let cleanPhone = (rawPhone || "").toString().replace(/\D/g, "");
    if (!cleanPhone) return "";
    if (!cleanPhone.startsWith("54")) cleanPhone = "549" + cleanPhone;
    return cleanPhone;
}

function limpiarHora(hora) {
    const match = String(hora || "").match(/(\d{1,2}:\d{2})/);
    return match ? match[1] : "";
}

function construirFechaTurno(fecha, hora) {
    if (!fecha) return null;
    const horaBase = limpiarHora(hora) || "00:00";
    const iso = `${fecha}T${horaBase}:00-03:00`;
    const dt = new Date(iso);
    return Number.isNaN(dt.getTime()) ? null : dt;
}

function getWhatsAppConfig() {
    let runtimeConfig = {};

    try {
        runtimeConfig = typeof functionsV1.config === "function" ? functionsV1.config() : {};
    } catch (error) {
        runtimeConfig = {};
    }

    const whatsappConfig = runtimeConfig.whatsapp || {};
    const token = String(whatsappConfig.token || process.env.WHATSAPP_TOKEN || WHATSAPP_FALLBACK_CONFIG.token || "").trim();
    const phoneNumberId = String(whatsappConfig.phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID || WHATSAPP_FALLBACK_CONFIG.phoneNumberId || "").trim();
    const wabaId = String(whatsappConfig.waba_id || process.env.WHATSAPP_WABA_ID || WHATSAPP_FALLBACK_CONFIG.wabaId || "").trim();

    if (!token || !phoneNumberId || !wabaId) {
        throw new Error("Faltan credenciales en functions.config(). Se requieren whatsapp.token, whatsapp.phone_number_id y whatsapp.waba_id.");
    }

    return {
        token,
        phoneNumberId,
        wabaId,
        reminderTemplateName: String(whatsappConfig.reminder_template_name || process.env.WHATSAPP_REMINDER_TEMPLATE_NAME || WHATSAPP_FALLBACK_CONFIG.reminderTemplateName || DEFAULT_REMINDER_TEMPLATE_NAME).trim() || DEFAULT_REMINDER_TEMPLATE_NAME,
        reminderTemplateLang: String(whatsappConfig.reminder_template_lang || process.env.WHATSAPP_REMINDER_TEMPLATE_LANG || WHATSAPP_FALLBACK_CONFIG.reminderTemplateLang || DEFAULT_REMINDER_TEMPLATE_LANG).trim() || DEFAULT_REMINDER_TEMPLATE_LANG,
        googleMapsLink: String(whatsappConfig.google_maps_link || process.env.WHATSAPP_GOOGLE_MAPS_LINK || WHATSAPP_FALLBACK_CONFIG.googleMapsLink || DEFAULT_GOOGLE_MAPS_LINK).trim() || DEFAULT_GOOGLE_MAPS_LINK
    };
}

function buildWhatsAppMessagesUrl(phoneNumberId) {
    return `https://graph.facebook.com/${META_API_VERSION}/${phoneNumberId}/messages`;
}

function validarParametroTemplateTexto(value, placeholderName) {
    const normalizedValue = String(value || "").trim();
    if (!normalizedValue) {
        throw new Error(`Falta el parametro requerido ${placeholderName}`);
    }
    return normalizedValue;
}

function validarGoogleMapsLink(link) {
    const normalizedLink = validarParametroTemplateTexto(link, "{{3}} Google Maps link");

    let parsedUrl;
    try {
        parsedUrl = new URL(normalizedLink);
    } catch (error) {
        throw new Error("El link de Google Maps del local es invalido");
    }

    const hostname = parsedUrl.hostname.toLowerCase();
    const isGoogleMapsHost = hostname === "maps.app.goo.gl"
        || hostname === "goo.gl"
        || /^(.+\.)?google\.[a-z.]+$/i.test(hostname);

    if (!isGoogleMapsHost) {
        throw new Error("El parametro {{3}} debe ser un link valido de Google Maps");
    }

    return normalizedLink;
}

function formatearFechaISOEnZona(date, timeZone = ARGENTINA_TIME_ZONE) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(date).reduce((acc, part) => {
        if (part.type !== "literal") {
            acc[part.type] = part.value;
        }
        return acc;
    }, {});

    return `${parts.year}-${parts.month}-${parts.day}`;
}

function sumarDiasAFechaISO(fechaISO, daysToAdd) {
    const [year, month, day] = fechaISO.split("-").map(Number);
    const utcDate = new Date(Date.UTC(year, month - 1, day));
    utcDate.setUTCDate(utcDate.getUTCDate() + daysToAdd);
    return utcDate.toISOString().slice(0, 10);
}

function obtenerFechaMananaArgentina(baseDate = new Date()) {
    return sumarDiasAFechaISO(formatearFechaISOEnZona(baseDate), 1);
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

function obtenerTurnoDate(reserva) {
    if (reserva.turnoAt && typeof reserva.turnoAt.toDate === "function") {
        return reserva.turnoAt.toDate();
    }

    if (reserva.turnoAt instanceof Date) {
        return reserva.turnoAt;
    }

    return construirFechaTurno(reserva.fecha, reserva.hora);
}

function formatearFechaHoraTurno(turnoAt, fecha, hora) {
    const turnoDate = turnoAt || construirFechaTurno(fecha, hora);

    if (turnoDate) {
        const fechaTexto = new Intl.DateTimeFormat("es-AR", {
            timeZone: ARGENTINA_TIME_ZONE,
            day: "2-digit",
            month: "2-digit",
            year: "numeric"
        }).format(turnoDate);

        const horaTexto = new Intl.DateTimeFormat("es-AR", {
            timeZone: ARGENTINA_TIME_ZONE,
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
        }).format(turnoDate);

        return `${fechaTexto} ${horaTexto} hs`;
    }

    const fechaTexto = String(fecha || "").trim();
    const horaTexto = limpiarHora(hora);
    return validarParametroTemplateTexto(`${fechaTexto}${horaTexto ? ` ${horaTexto} hs` : ""}`.trim(), "{{2}} fecha/hora");
}

async function registrarErrorMeta({ reservaId, reserva, error, requestPayload, meta }) {
    const statusCode = Number(error.response?.status || 0);
    if (statusCode !== 400 && (statusCode < 500 || statusCode > 599)) {
        return;
    }

    const responseData = error.response?.data || null;

    await db.collection("error_logs").add({
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        source: "enviarRecordatoriosTurnos",
        provider: "meta_whatsapp",
        reservaId,
        reservaPath: `reservas/${reservaId}`,
        paciente: obtenerNombreReserva(reserva),
        telefono: reserva.telefono || reserva.phone || null,
        fechaTurno: reserva.fecha || null,
        horaTurno: reserva.hora || null,
        httpStatus: statusCode,
        errorMessage: String(responseData?.error?.message || error.message || "Error desconocido"),
        errorType: responseData?.error?.type || null,
        errorCode: responseData?.error?.code || null,
        errorSubcode: responseData?.error?.error_subcode || null,
        responseData,
        requestPayload: requestPayload || null,
        wabaId: meta?.wabaId || null,
        phoneNumberId: meta?.phoneNumberId || null,
        templateName: meta?.templateName || null,
        templateLang: meta?.templateLang || null
    });
}

async function enviarTemplateWhatsApp({ telefono, templateName, templateLang, bodyParameters, whatsappConfig = null }) {
    const tel = normalizarTelefonoAR(telefono);
    if (!tel) throw new Error("Telefono invalido para WhatsApp");

    const config = whatsappConfig || getWhatsAppConfig();
    const validatedTemplateName = validarParametroTemplateTexto(templateName, "template.name");
    const validatedTemplateLang = validarParametroTemplateTexto(templateLang, "template.language.code");

    const payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: tel,
        type: "template",
        template: {
            name: validatedTemplateName,
            language: { code: validatedTemplateLang },
            components: [
                {
                    type: "body",
                    parameters: bodyParameters.map((parameter) => ({
                        type: "text",
                        text: validarParametroTemplateTexto(parameter.value, parameter.placeholder)
                    }))
                }
            ]
        }
    };

    const meta = {
        phoneNumberId: config.phoneNumberId,
        wabaId: config.wabaId,
        templateName: validatedTemplateName,
        templateLang: validatedTemplateLang
    };

    try {
        const response = await axios.post(
            buildWhatsAppMessagesUrl(config.phoneNumberId),
            payload,
            {
                headers: {
                    Authorization: `Bearer ${config.token}`,
                    "Content-Type": "application/json"
                }
            }
        );

        return { response, payload, meta };
    } catch (error) {
        error.requestPayload = payload;
        error.whatsappMeta = meta;
        throw error;
    }
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

async function resolverDestinoConfirmacion({ telefono, dni, nombre }) {
    let telefonoDestino = String(telefono || "").trim();
    let nombreReal = String(nombre || "").trim() || "Cliente";

    if (telefonoDestino) {
        return { telefonoDestino, nombreReal, source: "payload" };
    }

    const clientePorDni = await buscarClientePorDni(dni);
    if (clientePorDni) {
        const c = clientePorDni.data() || {};
        telefonoDestino = c.phone || c.telefono || c.whatsapp || "";
        nombreReal = c.fullName || c.nombre || nombreReal;
        if (telefonoDestino) {
            return { telefonoDestino, nombreReal, source: "dni" };
        }
    }

    const username = normalizarNombreUsuario(nombreReal);
    if (!username) {
        return { telefonoDestino: "", nombreReal, source: "none" };
    }

    const clientSnapshot = await db.collection("clients")
        .where("username", "==", username)
        .limit(1)
        .get();

    if (clientSnapshot.empty) {
        return { telefonoDestino: "", nombreReal, source: "none" };
    }

    const c = clientSnapshot.docs[0].data() || {};
    return {
        telefonoDestino: c.phone || c.telefono || c.whatsapp || "",
        nombreReal: c.fullName || c.nombre || nombreReal,
        source: "username"
    };
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

async function enviarTemplateTurno({ telefono, nombre, servicio, fecha, hora, templateName = "turno_confirmado", templateLang = "en" }) {
    const envio = await enviarTemplateWhatsApp({
        telefono,
        templateName,
        templateLang,
        bodyParameters: [
            { placeholder: "{{1}} nombre", value: nombre || "Cliente" },
            { placeholder: "{{2}} servicio", value: servicio || "Tratamiento" },
            { placeholder: "{{3}} fecha", value: fecha || "-" },
            { placeholder: "{{4}} hora", value: hora || "-" }
        ]
    });

    return envio.response;
}

async function enviarTemplateRecordatorioTurno({ telefono, nombrePaciente, fechaHora, googleMapsLink, whatsappConfig = null }) {
    const config = whatsappConfig || getWhatsAppConfig();

    return enviarTemplateWhatsApp({
        telefono,
        templateName: config.reminderTemplateName,
        templateLang: config.reminderTemplateLang,
        bodyParameters: [
            { placeholder: "{{1}} nombrePaciente", value: nombrePaciente },
            { placeholder: "{{2}} fechaHora", value: fechaHora },
            { placeholder: "{{3}} googleMapsLink", value: validarGoogleMapsLink(googleMapsLink) }
        ],
        whatsappConfig: config
    });
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

exports.enviarConfirmacionTurno = onRequest(async (req, res) => {
    
    // Configuración de CORS para que tu local no rebote
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        return res.status(204).send("");
    }

    if (req.method !== "POST") {
        return res.status(405).json({ error: "Metodo no permitido" });
    }

    let balanceUpdated = false;
    const warnings = [];

    try {
        const {
            nombre,
            servicio,
            fecha,
            hora,
            telefono,
            dni,
            descontarBalance = false,
            omitirWhatsapp = false
        } = req.body || {};

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

        if (omitirWhatsapp === true) {
            return res.status(200).json({
                status: "success",
                whatsappSent: false,
                balanceUpdated,
                warnings
            });
        }

        if (!nombre || !servicio || !fecha || !hora) {
            return res.status(400).json({
                error: "Faltan datos en el body.",
                balanceUpdated,
                warnings
            });
        }

        const destino = await resolverDestinoConfirmacion({ telefono, dni, nombre });
        const telefonoDestino = destino.telefonoDestino;
        const nombreReal = destino.nombreReal;

        if (!telefonoDestino) {
            return res.status(400).json({
                error: "No se encontró teléfono para enviar WhatsApp.",
                balanceUpdated,
                warnings
            });
        }

        const horaTexto = limpiarHora(hora) ? `${limpiarHora(hora)} hs` : String(hora || "-");

        const response = await enviarTemplateTurno({
            telefono: telefonoDestino,
            nombre: nombreReal,
            servicio,
            fecha,
            hora: horaTexto,
            templateName: "turno_confirmado",
            templateLang: "en"
        });

        return res.status(200).json({
            status: "success",
            whatsappSent: true,
            balanceUpdated,
            warnings,
            lookupSource: destino.source,
            data: response.data
        });

    } catch (error) {
        console.error("Error en la Cloud Function:", error.response ? error.response.data : error.message);
        return res.status(500).json({ 
            error: "Error interno en el envío", 
            detalles: error.response ? error.response.data : error.message,
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

// ── NUEVO ────────────────────────────────────────────────────────────────────
// enviarRecordatoriosTurnos: scheduler diario a las 09:00 ART para turnos de mañana.
// Solo procesa reservas confirmadas y evita duplicados con reminderSent.
// ─────────────────────────────────────────────────────────────────────────────
exports.enviarRecordatoriosTurnos = onSchedule(
    {
        schedule: "0 9 * * *",
        timeZone: ARGENTINA_TIME_ZONE,
        region: "us-central1"
    },
    async () => {
        try {
            const whatsappConfig = getWhatsAppConfig();
            const fechaObjetivo = obtenerFechaMananaArgentina();
            const snapshot = await db.collection("reservas")
                .where("fecha", "==", fechaObjetivo)
                .get();

            const resumen = {
                revisados: 0,
                enviados: 0,
                omitidosNoExiste: 0,
                omitidosEstado: 0,
                omitidosDuplicado: 0,
                omitidosTelefono: 0,
                errores: 0
            };

            for (const docSnap of snapshot.docs) {
                resumen.revisados++;

                const latestDoc = await docSnap.ref.get();
                if (!latestDoc.exists) {
                    resumen.omitidosNoExiste++;
                    continue;
                }

                const reserva = latestDoc.data() || {};
                if (reserva.fecha !== fechaObjetivo) {
                    resumen.omitidosEstado++;
                    continue;
                }

                const estado = obtenerEstadoReserva(reserva);
                if (estado !== "confirmado") {
                    resumen.omitidosEstado++;
                    continue;
                }

                if (reserva.reminderSent === true) {
                    resumen.omitidosDuplicado++;
                    continue;
                }

                const nombrePaciente = obtenerNombreReserva(reserva);
                const destino = await resolverDestinoConfirmacion({
                    telefono: reserva.telefono || reserva.phone || "",
                    dni: reserva.dni,
                    nombre: nombrePaciente
                });

                if (!destino.telefonoDestino) {
                    resumen.omitidosTelefono++;
                    logger.warn("Reserva omitida por falta de telefono", {
                        reservaId: latestDoc.id,
                        fechaObjetivo,
                        dni: reserva.dni || null
                    });
                    continue;
                }

                const turnoAt = obtenerTurnoDate(reserva);
                const fechaHora = formatearFechaHoraTurno(turnoAt, reserva.fecha, reserva.hora);

                try {
                    const envio = await enviarTemplateRecordatorioTurno({
                        telefono: destino.telefonoDestino,
                        nombrePaciente: destino.nombreReal || nombrePaciente,
                        fechaHora,
                        googleMapsLink: whatsappConfig.googleMapsLink,
                        whatsappConfig
                    });

                    await latestDoc.ref.update({
                        reminderSent: true,
                        reminderSentAt: admin.firestore.FieldValue.serverTimestamp(),
                        reminderStatus: "sent",
                        reminderMessageId: envio.response.data?.messages?.[0]?.id || null,
                        reminderLookupSource: destino.source || "unknown",
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    });

                    resumen.enviados++;
                    logger.info("Recordatorio enviado", {
                        reservaId: latestDoc.id,
                        fechaObjetivo,
                        messageId: envio.response.data?.messages?.[0]?.id || null
                    });
                } catch (error) {
                    resumen.errores++;

                    logger.error("Error enviando recordatorio de turno", {
                        reservaId: latestDoc.id,
                        fechaObjetivo,
                        error: error.response?.data || error.message
                    });

                    await latestDoc.ref.update({
                        reminderStatus: "error",
                        reminderLastError: String(error.response?.data?.error?.message || error.message || "Error desconocido"),
                        reminderLastErrorAt: admin.firestore.FieldValue.serverTimestamp(),
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    });

                    await registrarErrorMeta({
                        reservaId: latestDoc.id,
                        reserva,
                        error,
                        requestPayload: error.requestPayload || null,
                        meta: error.whatsappMeta || {
                            wabaId: whatsappConfig.wabaId,
                            phoneNumberId: whatsappConfig.phoneNumberId,
                            templateName: whatsappConfig.reminderTemplateName,
                            templateLang: whatsappConfig.reminderTemplateLang
                        }
                    });
                }
            }

            logger.info("Scheduler de recordatorios finalizado", {
                fechaObjetivo,
                ...resumen,
                wabaId: whatsappConfig.wabaId,
                phoneNumberId: whatsappConfig.phoneNumberId
            });
            return null;
        } catch (error) {
            logger.error("Fallo global en enviarRecordatoriosTurnos", {
                error: error.message,
                stack: error.stack
            });
            return null;
        }
    }
);

// ── NUEVO ────────────────────────────────────────────────────────────────────
// enviarResumenSesion: envía por WhatsApp el detalle de lo realizado ese día
// Body esperado: { tel, nombre, fecha, sesiones: [{ hora, servicio, detalle }] }
// ─────────────────────────────────────────────────────────────────────────────
exports.enviarResumenSesion = onRequest(async (req, res) => {

    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(204).send("");

    try {
        const { tel, nombre, fecha, sesiones } = req.body;

        if (!tel || !nombre || !fecha || !sesiones || !sesiones.length) {
            return res.status(400).json({ error: "Faltan campos obligatorios." });
        }

        // Formatear número argentino
        let cleanPhone = tel.toString().replace(/\D/g, "");
        if (!cleanPhone.startsWith("54")) cleanPhone = "549" + cleanPhone;

        // Armar cuerpo del mensaje
        const dias = ["Dom.", "Lun.", "Mar.", "Mié.", "Jue.", "Vie.", "Sáb."];
        const [y, m, d] = fecha.split("-");
        const fObj = new Date(Number(y), Number(m) - 1, Number(d));
        const fechaLinda = `${dias[fObj.getDay()]} ${d}/${m}/${y}`;

        let lineasSesiones = sesiones.map(s =>
            `🕒 *${s.hora} hs* — _${s.servicio || "Tratamiento"}_\n${s.detalle ? `   📝 ${s.detalle}` : ""}`
        ).join("\n\n");

        const mensaje = `Hola *${nombre}* 😊\n\nAquí va el resumen de tu sesión del *${fechaLinda}* en *Espacio Mimar T*:\n\n${lineasSesiones}\n\n¡Muchas gracias por tu visita! 💚\nNos vemos pronto ✨`;

        const whatsappConfig = getWhatsAppConfig();

        await axios.post(
            buildWhatsAppMessagesUrl(whatsappConfig.phoneNumberId),
            {
                messaging_product: "whatsapp",
                to: cleanPhone,
                type: "text",
                text: { body: mensaje }
            },
            {
                headers: {
                    Authorization: `Bearer ${whatsappConfig.token}`,
                    "Content-Type": "application/json"
                }
            }
        );

        return res.status(200).json({ status: "enviado" });

    } catch (error) {
        console.error("enviarResumenSesion error:", error.response?.data || error.message);
        return res.status(500).json({
            error: "Error al enviar resumen",
            detalles: error.response?.data || error.message
        });
    }
});