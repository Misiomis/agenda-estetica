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
const DEFAULT_SUMMARY_TEMPLATE_NAME = "resumen_sesion";
const DEFAULT_SUMMARY_TEMPLATE_LANG = "es_AR";
const DEFAULT_GOOGLE_MAPS_LINK = "https://maps.google.com/?q=Espacio+Mimar+T";
const META_API_VERSION = "v21.0";
const WHATSAPP_FALLBACK_CONFIG = {
    token: "EAAMzA3ngIUkBRMpXw5ZBCCzVCFZAum3yF3dcHlgOPZAigiAIXERNfxpGfq21VCEgiByPN5xhm9mZBUyJ0WWqTl0xoB8ZBEs8EEh2FVC82aDHizTv0bKvMrcH7mkO99svZCMymZAi07nnmnBZCeHlI8XdnMBfJI1pnjVFWQZCdCIOBZA8fDa71OuvkVZCJu5bTR91wZDZD",
    phoneNumberId: "995248997010108",
    wabaId: "995248997010108",
    reminderTemplateName: DEFAULT_REMINDER_TEMPLATE_NAME,
    reminderTemplateLang: DEFAULT_REMINDER_TEMPLATE_LANG,
    summaryTemplateName: DEFAULT_SUMMARY_TEMPLATE_NAME,
    summaryTemplateLang: DEFAULT_SUMMARY_TEMPLATE_LANG,
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
        summaryTemplateName: String(whatsappConfig.summary_template_name || process.env.WHATSAPP_SUMMARY_TEMPLATE_NAME || WHATSAPP_FALLBACK_CONFIG.summaryTemplateName || DEFAULT_SUMMARY_TEMPLATE_NAME).trim() || DEFAULT_SUMMARY_TEMPLATE_NAME,
        summaryTemplateLang: String(whatsappConfig.summary_template_lang || process.env.WHATSAPP_SUMMARY_TEMPLATE_LANG || WHATSAPP_FALLBACK_CONFIG.summaryTemplateLang || DEFAULT_SUMMARY_TEMPLATE_LANG).trim() || DEFAULT_SUMMARY_TEMPLATE_LANG,
        googleMapsLink: String(whatsappConfig.google_maps_link || process.env.WHATSAPP_GOOGLE_MAPS_LINK || WHATSAPP_FALLBACK_CONFIG.googleMapsLink || DEFAULT_GOOGLE_MAPS_LINK).trim() || DEFAULT_GOOGLE_MAPS_LINK
    };
}

function buildWhatsAppMessagesUrl(phoneNumberId) {
    return `https://graph.facebook.com/${META_API_VERSION}/${phoneNumberId}/messages`;
}

// ── Envío manual de WhatsApp: único automatismo permitido a Gimena ───────────
//
// Regla de negocio (no de seguridad de datos): ningún proceso automático puede
// escribirle a pacientes u otros destinatarios por WhatsApp. La única excepción
// es el aviso de "llegó una reserva/pedido nuevo" a Gimena, a su numero
// verificado. Todo lo demas requiere que una persona autenticada como admin
// dispare el envio de forma explicita (ver verificarOperadorAdmin).
const ADMIN_EMAILS = ["espaciomimart36@gmail.com"]; // igual que esAdmin() en firestore.rules
const GIMENA_WHATSAPP_NUMBER = normalizarTelefonoAR("3764291807"); // "5493764291807"

function esDestinoGimena(telefono) {
    return normalizarTelefonoAR(telefono) === GIMENA_WHATSAPP_NUMBER;
}

// Defensa en profundidad: los 3 avisos automáticos a Gimena ya usan el numero
// hardcodeado en el propio backend (nunca lo toman de req.body), pero esta
// comprobacion asegura que un cambio futuro no pueda desviar sin querer un
// automatismo hacia otro destinatario.
function asegurarDestinoGimena(telefono, origen) {
    if (!esDestinoGimena(telefono)) {
        throw new Error(`Automatismo "${origen}" bloqueado: el destino no es el numero verificado de Gimena.`);
    }
}

// Verifica que la request venga de una sesion real de Firebase Auth con el
// admin del panel (mismo criterio que esAdmin() en firestore.rules). Se usa
// para exigir una accion explicita de la operadora antes de mandar un
// WhatsApp que NO sea el aviso a Gimena — no alcanza con que el frontend
// "no muestre el boton": esto se valida en el servidor.
async function obtenerOperadorAdminDesdeRequest(req) {
    const authHeader = String(req.headers.authorization || req.headers.Authorization || "");
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) return null;

    try {
        const decoded = await admin.auth().verifyIdToken(match[1]);
        const email = String(decoded.email || "").trim().toLowerCase();
        const esAdmin = decoded.admin === true || ADMIN_EMAILS.includes(email);
        return esAdmin ? decoded : null;
    } catch (error) {
        logger.warn("Token de operador invalido al intentar enviar WhatsApp manual", { error: error.message });
        return null;
    }
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

function sanitizarTextoResumen(value, maxLength, fallback = "") {
    const text = String(value || "")
        .replace(/[\r\n]+/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();

    if (!text) return fallback;
    return text.slice(0, maxLength);
}

function formatearFechaResumen(fecha) {
    const [year, month, day] = String(fecha || "").split("-");
    if (year && month && day) {
        return `${day}/${month}/${year}`;
    }
    return sanitizarTextoResumen(fecha, 40, "Fecha a confirmar");
}

function construirParametrosResumenSesion({ nombre, fecha, sesiones }) {
    const sesionesNormalizadas = (Array.isArray(sesiones) ? sesiones : [])
        .map((sesion = {}) => ({
            hora: sanitizarTextoResumen(limpiarHora(sesion.hora) || sesion.hora, 40, "Horario a confirmar"),
            servicio: sanitizarTextoResumen(sesion.servicio, 80, "Tratamiento"),
            detalle: sanitizarTextoResumen(sesion.detalle, 900, "Sin detalles")
        }))
        .filter((sesion) => sesion.hora || sesion.servicio || sesion.detalle);

    if (!sesionesNormalizadas.length) {
        throw new Error("No hay sesiones válidas para enviar");
    }

    const [primeraSesion, ...sesionesRestantes] = sesionesNormalizadas;
    const detalleCompuesto = sesionesRestantes.length
        ? sanitizarTextoResumen(
            sesionesNormalizadas.map((sesion) => `${sesion.hora} - ${sesion.servicio}: ${sesion.detalle}`).join(" | "),
            900,
            primeraSesion.detalle
        )
        : primeraSesion.detalle;

    return [
        { placeholder: "{{1}} nombre", value: sanitizarTextoResumen(nombre, 60, "Paciente") },
        { placeholder: "{{2}} fecha", value: formatearFechaResumen(fecha) },
        { placeholder: "{{3}} hora", value: sesionesRestantes.length ? "Varios horarios" : primeraSesion.hora },
        { placeholder: "{{4}} servicio", value: sesionesRestantes.length ? sanitizarTextoResumen(`${primeraSesion.servicio} y ${sesionesRestantes.length} más`, 80, primeraSesion.servicio) : primeraSesion.servicio },
        { placeholder: "{{5}} detalle", value: detalleCompuesto }
    ];
}

async function enviarTemplateResumenSesion({ telefono, nombre, fecha, sesiones, whatsappConfig = null }) {
    const config = whatsappConfig || getWhatsAppConfig();
    const bodyParameters = construirParametrosResumenSesion({ nombre, fecha, sesiones });
    const summaryTemplateLang = config.summaryTemplateLang || DEFAULT_SUMMARY_TEMPLATE_LANG;

    try {
        return await enviarTemplateWhatsApp({
            telefono,
            templateName: config.summaryTemplateName,
            templateLang: summaryTemplateLang,
            bodyParameters,
            whatsappConfig: config
        });
    } catch (error) {
        const codigoError = Number(error?.response?.data?.error?.code || 0);
        const mensajeError = String(error?.response?.data?.error?.message || error?.message || "");
        const reintentarIdioma = summaryTemplateLang.toLowerCase() !== "es" && (codigoError === 132018 || /parameter|language/i.test(mensajeError));

        if (!reintentarIdioma) {
            throw error;
        }

        return enviarTemplateWhatsApp({
            telefono,
            templateName: config.summaryTemplateName,
            templateLang: "es",
            bodyParameters,
            whatsappConfig: config
        });
    }
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
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

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

        // El descuento de hoursBalance es una operacion de negocio propia de la
        // reserva (no de mensajeria): se preserva para cualquier caller, sea
        // paciente o admin.
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

        // El envio de WhatsApp SI requiere una operadora admin autenticada que
        // disparo esto a proposito (ver obtenerOperadorAdminDesdeRequest). Un
        // paciente confirmando su propio turno ya no dispara un WhatsApp solo:
        // omitirWhatsapp=true (explicito) o la ausencia de sesion admin llevan
        // al mismo resultado — la reserva/el descuento de balance sigue
        // funcionando igual, solo se omite el mensaje automático.
        const operadorAdmin = await obtenerOperadorAdminDesdeRequest(req);
        if (omitirWhatsapp === true || !operadorAdmin) {
            if (!operadorAdmin && omitirWhatsapp !== true) {
                warnings.push("whatsapp_omitido_sin_operador_autenticado");
            }
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
        const isMetaError = !!(error.response && error.response.data);
        if (isMetaError) {
            const metaData  = error.response.data;
            const metaCode  = metaData?.error?.code;
            const metaMsg   = metaData?.error?.message || "Error del servicio WhatsApp";
            const isAuth    = metaCode === 190 || /token/i.test(metaMsg);
            const userMsg   = isAuth
                ? "Token de WhatsApp inválido o expirado. Contactar al administrador."
                : `Error de WhatsApp (${metaCode || error.response.status}): ${metaMsg}`;
            console.error("Meta API error:", { code: metaCode, status: error.response.status });
            return res.status(502).json({ error: userMsg, errorType: "whatsapp_api", metaCode, balanceUpdated, warnings });
        }
        console.error("Error en la Cloud Function:", error.message || error);
        return res.status(500).json({
            error: "Error interno en el envío",
            detalles: error.message,
            balanceUpdated,
            warnings
        });
    }
});

exports.enviarBienvenida = onRequest(async (req, res) => {

    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
        return res.status(204).send("");
    }

    if (req.method !== "POST") {
        return res.status(405).json({ error: "Metodo no permitido" });
    }

    try {
        // Mensaje de bienvenida al paciente: no es el aviso a Gimena, asi que
        // requiere una operadora admin autenticada que lo dispare a proposito.
        const operadorAdmin = await obtenerOperadorAdminDesdeRequest(req);
        if (!operadorAdmin) {
            return res.status(401).json({
                error: "Este envío requiere una sesión de administración autenticada."
            });
        }

        const { nombre, telefono, dni } = req.body || {};

        if (!nombre) {
            return res.status(400).json({ error: "Faltan datos en el body." });
        }

        const destino = await resolverDestinoConfirmacion({ telefono, dni, nombre });
        const telefonoDestino = destino.telefonoDestino;
        const nombreReal = destino.nombreReal;

        if (!telefonoDestino) {
            return res.status(400).json({ error: "No se encontró teléfono para enviar WhatsApp." });
        }

        const envio = await enviarTemplateWhatsApp({
            telefono: telefonoDestino,
            templateName: "bienvenida",
            templateLang: "en",
            bodyParameters: [
                { placeholder: "{{1}} nombre", value: nombreReal }
            ]
        });

        return res.status(200).json({
            status: "success",
            whatsappSent: true,
            lookupSource: destino.source,
            data: envio.response.data
        });

    } catch (error) {
        console.error("Error en enviarBienvenida:", error.response ? error.response.data : error.message);
        return res.status(500).json({
            error: "Error interno en el envío",
            detalles: error.response ? error.response.data : error.message
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

// ── DESHABILITADO ──────────────────────────────────────────────────────────
// enviarRecordatoriosTurnos: ANTES mandaba, sin intervencion humana, un
// recordatorio de WhatsApp a TODOS los pacientes con turno confirmado para
// el dia siguiente (cron diario 09:00 ART). Eso viola la regla de negocio
// vigente: el UNICO automatismo de WhatsApp permitido es el aviso a Gimena
// (ver asegurarDestinoGimena). Se conserva el shell exportado — con el mismo
// horario, ya inofensivo — para no tener que borrar la Cloud Function del
// proyecto de Firebase; el cuerpo ya no lee "reservas" ni llama a la API de
// WhatsApp bajo ningun caso. Recordar turnos a pacientes ahora es 100%
// manual (botones "Confirmar"/"Recordar" en Admin, que abren WhatsApp o
// llaman a la API solo cuando la operadora hace click).
exports.enviarRecordatoriosTurnos = onSchedule(
    {
        schedule: "0 9 * * *",
        timeZone: ARGENTINA_TIME_ZONE,
        region: "us-central1"
    },
    async () => {
        logger.info("enviarRecordatoriosTurnos: deshabilitado por politica de mensajeria manual — no se leyeron reservas ni se envio ningun WhatsApp.");
        return null;
    }
);

// ── NUEVO ────────────────────────────────────────────────────────────────────
// enviarResumenSesion: envía por WhatsApp el detalle de lo realizado ese día
// Body esperado: { tel, nombre, fecha, sesiones: [{ hora, servicio, detalle }] }
// ─────────────────────────────────────────────────────────────────────────────
exports.enviarNotificacionKitFacial = onRequest({ invoker: "public" }, async (req, res) => {

    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(204).send("");

    if (req.method !== "POST") {
        return res.status(405).json({ error: "Metodo no permitido" });
    }

    try {
        const { nombre, dni, productos, total, descripcionPiel } = req.body || {};

        if (!nombre || !dni || !productos || !total) {
            return res.status(400).json({ error: "Faltan campos obligatorios." });
        }

        const productosTexto = Array.isArray(productos)
            ? productos.join(", ")
            : String(productos);

        const whatsappConfig = getWhatsAppConfig();

        asegurarDestinoGimena("3764291807", "enviarNotificacionKitFacial");
        const envio = await enviarTemplateWhatsApp({
            telefono: "3764291807",
            templateName: "pedidos_de_kit",
            templateLang: "es_AR",
            bodyParameters: [
                { placeholder: "{{1}} nombre", value: String(nombre).trim() || "Cliente" },
                { placeholder: "{{2}} dni", value: String(dni).trim() },
                { placeholder: "{{3}} productos", value: sanitizarTextoResumen(productosTexto, 900, "Sin productos") },
                { placeholder: "{{4}} total", value: String(total).trim() },
                { placeholder: "{{5}} descripcionPiel", value: sanitizarTextoResumen(String(descripcionPiel || "Sin descripción"), 900, "Sin descripción") }
            ],
            whatsappConfig
        });

        return res.status(200).json({
            status: "enviado",
            whatsappSent: true,
            data: envio?.response?.data || null
        });

    } catch (error) {
        console.error("enviarNotificacionKitFacial error:", error.response?.data || error.message);
        return res.status(500).json({
            error: "Error al enviar notificación",
            detalles: error.response?.data || error.message
        });
    }
});

exports.enviarNotificacionConsulta = onRequest({ invoker: "public" }, async (req, res) => {

    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Metodo no permitido" });

    try {
        const { nombre, fecha, hora, metodoPago, servicio, dni, fechaNacimiento, edad, domicilio, telefono, email } = req.body || {};

        if (!nombre || !fecha || !hora) {
            return res.status(400).json({ error: "Faltan campos obligatorios." });
        }

        const MESES_ES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

        const formatFechaES = (iso) => {
            const [yy, mm, dd] = String(iso || '').split('-').map(Number);
            if (!dd || !mm || !yy) return iso || '';
            return `${dd} de ${MESES_ES[mm - 1]} de ${yy}`;
        };

        const fechaFormateada = formatFechaES(fecha);
        const fechaNacFormateada = fechaNacimiento ? formatFechaES(fechaNacimiento) : '';
        const horaTexto = limpiarHora(hora) || String(hora);
        const servicioTexto = String(servicio || 'Consulta Inicial').trim();

        const whatsappConfig = getWhatsAppConfig();

        asegurarDestinoGimena("3764291807", "enviarNotificacionConsulta");
        const envio = await enviarTemplateWhatsApp({
            telefono: "3764291807",
            templateName: "nueva_reserva",
            templateLang: "es_AR",
            bodyParameters: [
                { placeholder: "{{1}} servicio",         value: servicioTexto },
                { placeholder: "{{2}} fecha",            value: fechaFormateada },
                { placeholder: "{{3}} hora",             value: horaTexto },
                { placeholder: "{{4}} nombre",           value: String(nombre).trim() || "Paciente" },
                { placeholder: "{{5}} dni",              value: String(dni || '').trim() || '-' },
                { placeholder: "{{6}} fechaNacimiento",  value: fechaNacFormateada || '-' },
                { placeholder: "{{7}} edad",             value: String(edad || '').trim() || '-' },
                { placeholder: "{{8}} domicilio",        value: String(domicilio || '').trim() || '-' },
                { placeholder: "{{9}} telefono",         value: String(telefono || '').trim() || '-' },
                { placeholder: "{{10}} email",           value: String(email || '').trim() || '-' }
            ],
            whatsappConfig
        });

        return res.status(200).json({
            status: "enviado",
            whatsappSent: true,
            data: envio?.response?.data || null
        });

    } catch (error) {
        console.error("enviarNotificacionConsulta error:", error.response?.data || error.message);
        return res.status(500).json({
            error: "Error al enviar notificación",
            detalles: error.response?.data || error.message
        });
    }
});

exports.notificarNuevaReservaDepi = onRequest({ invoker: "public" }, async (req, res) => {

    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Metodo no permitido" });

    try {
        const { nombre, fecha, hora, combo, precio, metodoPago, telefono, dni, edad } = req.body || {};

        if (!nombre || !fecha || !hora || !combo) {
            return res.status(400).json({ error: "Faltan campos obligatorios." });
        }

        const MESES_ES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
        const formatFechaES = (iso) => {
            const [yy, mm, dd] = String(iso || '').split('-').map(Number);
            if (!dd || !mm || !yy) return iso || '';
            return `${dd} de ${MESES_ES[mm - 1]} de ${yy}`;
        };

        const whatsappConfig = getWhatsAppConfig();

        asegurarDestinoGimena("3764291807", "notificarNuevaReservaDepi");
        const envio = await enviarTemplateWhatsApp({
            telefono: "3764291807",
            templateName: "nueva_reserva",
            templateLang: "es_AR",
            bodyParameters: [
                { placeholder: "{{1}} servicio",        value: `Depilación Láser · ${combo}` },
                { placeholder: "{{2}} fecha",           value: formatFechaES(fecha) },
                { placeholder: "{{3}} hora",            value: limpiarHora(hora) || String(hora) },
                { placeholder: "{{4}} nombre",          value: String(nombre).trim() || "Paciente" },
                { placeholder: "{{5}} dni",             value: String(dni || '').trim() || '-' },
                { placeholder: "{{6}} fechaNacimiento", value: '-' },
                { placeholder: "{{7}} edad",            value: String(edad || '').trim() || '-' },
                { placeholder: "{{8}} domicilio",       value: String(precio || '').trim() || '-' },
                { placeholder: "{{9}} telefono",        value: String(telefono || '').trim() || '-' },
                { placeholder: "{{10}} email",          value: metodoPago === 'transferencia' ? 'Transferencia' : 'Efectivo' }
            ],
            whatsappConfig
        });

        return res.status(200).json({
            status: "enviado",
            whatsappSent: true,
            data: envio?.response?.data || null
        });

    } catch (error) {
        console.error("notificarNuevaReservaDepi error:", error.response?.data || error.message);
        return res.status(500).json({
            error: "Error al enviar notificación",
            detalles: error.response?.data || error.message
        });
    }
});

exports.enviarResumenSesion = onRequest({ invoker: "public" }, async (req, res) => {

    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(204).send("");

    try {
        const { tel, nombre, fecha, sesiones } = req.body || {};

        if (!tel || !nombre || !fecha || !sesiones || !sesiones.length) {
            return res.status(400).json({ error: "Faltan campos obligatorios." });
        }
        const whatsappConfig = getWhatsAppConfig();
        const envio = await enviarTemplateResumenSesion({
            telefono: tel,
            nombre,
            fecha,
            sesiones,
            whatsappConfig
        });

        return res.status(200).json({
            status: "enviado",
            whatsappSent: true,
            templateName: whatsappConfig.summaryTemplateName,
            templateLang: envio?.meta?.templateLang || whatsappConfig.summaryTemplateLang,
            data: envio?.response?.data || null
        });

    } catch (error) {
        console.error("enviarResumenSesion error:", error.response?.data || error.message);
        return res.status(500).json({
            error: "Error al enviar resumen",
            detalles: error.response?.data || error.message
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