const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const axios = require("axios");

admin.initializeApp();
const db = admin.firestore();

// TODO seguridad: mover a secretos/variables de entorno de Firebase.
const TOKEN_PERMANENTE = process.env.WHATSAPP_TOKEN || "EAAMzA3ngIUkBQ630dPYUcq6NBWPoybtHpMw8KbMEqTzv49lsAXW9honZCnblqcVdlxltSO35kXQc42D8P6dNwgx2YN4JWxpCwUxoZAziQVyK5jZArVQYaL63CZChQNZCdZBppqIEymvfBbZCsrdBJbXnUnlpdj06DSpYorrgnkmZCJ4wda6M3pQEdIh1PRHOfwZDZD";
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "995248997010108";

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

async function enviarTemplateTurno({ telefono, nombre, servicio, fecha, hora, templateName = "turno_confirmado", templateLang = "en" }) {
    const tel = normalizarTelefonoAR(telefono);
    if (!tel) throw new Error("Telefono inválido para WhatsApp");

    const payload = {
        messaging_product: "whatsapp",
        to: tel,
        type: "template",
        template: {
            name: templateName,
            language: { code: templateLang },
            components: [
                {
                    type: "body",
                    parameters: [
                        { type: "text", text: nombre || "Cliente" },
                        { type: "text", text: servicio || "Tratamiento" },
                        { type: "text", text: fecha || "-" },
                        { type: "text", text: hora || "-" }
                    ]
                }
            ]
        }
    };

    return axios.post(
        `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`,
        payload,
        {
            headers: {
                Authorization: `Bearer ${TOKEN_PERMANENTE}`,
                "Content-Type": "application/json"
            }
        }
    );
}

exports.registrarPacienteJornada = functions.https.onRequest(async (req, res) => {

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

        const dniNormalizado = String(dni || "").replace(/\D/g, "");
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
            username: nombre.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, "").trim().replace(/\s+/g, "."),
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

exports.enviarConfirmacionTurno = functions.https.onRequest(async (req, res) => {
    
    // Configuración de CORS para que tu local no rebote
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        return res.status(204).send("");
    }

    try {
        const { nombre, servicio, fecha, hora, telefono, dni } = req.body;

        if (!nombre || !servicio || !fecha || !hora) {
            return res.status(400).json({ error: "Faltan datos en el body." });
        }

        let telefonoDestino = telefono || "";
        let nombreReal = nombre;

        if (!telefonoDestino && dni) {
            const clienteRef = db.collection("clients").doc(String(dni));
            const clienteDoc = await clienteRef.get();
            if (clienteDoc.exists) {
                const c = clienteDoc.data() || {};
                telefonoDestino = c.phone || c.telefono || c.whatsapp || "";
                nombreReal = c.fullName || c.nombre || nombre;
            }
        }

        if (!telefonoDestino) {
            const clientSnapshot = await db.collection("clients")
                .where("username", "==", String(nombre || "").toLowerCase())
                .limit(1)
                .get();

            if (!clientSnapshot.empty) {
                const c = clientSnapshot.docs[0].data() || {};
                telefonoDestino = c.phone || c.telefono || c.whatsapp || "";
                nombreReal = c.fullName || c.nombre || nombre;
            }
        }

        if (!telefonoDestino) {
            return res.status(400).json({ error: "No se encontró teléfono para enviar WhatsApp." });
        }

        const response = await enviarTemplateTurno({
            telefono: telefonoDestino,
            nombre: nombreReal,
            servicio,
            fecha,
            hora,
            templateName: "turno_confirmado",
            templateLang: "en"
        });

        return res.status(200).json({ status: "success", data: response.data });

    } catch (error) {
        console.error("Error en la Cloud Function:", error.response ? error.response.data : error.message);
        return res.status(500).json({ 
            error: "Error interno en el envío", 
            detalles: error.response ? error.response.data : error.message 
        });
    }
});

// ── NUEVO ────────────────────────────────────────────────────────────────────
// enviarRecordatoriosTurnos: scheduler automático (48h, 24h, 12h y 6h)
// Recomendado: ejecutar cada 15 minutos en zona horaria de Argentina.
// ─────────────────────────────────────────────────────────────────────────────
exports.enviarRecordatoriosTurnos = functions.pubsub
    .schedule("every 15 minutes")
    .timeZone("America/Argentina/Buenos_Aires")
    .onRun(async () => {
        const ahora = new Date();
        const snapshot = await db.collection("reservas").get();

        let enviados = 0;
        let revisados = 0;

        const ventanas = [
            { key: "h48", max: 48, min: 24 },
            { key: "h24", max: 24, min: 12 },
            { key: "h12", max: 12, min: 6 },
            { key: "h6", max: 6, min: 0 }
        ];

        for (const docSnap of snapshot.docs) {
            revisados++;
            const reserva = docSnap.data() || {};

            let turnoAt = null;
            if (reserva.turnoAt && typeof reserva.turnoAt.toDate === "function") {
                turnoAt = reserva.turnoAt.toDate();
            } else {
                turnoAt = construirFechaTurno(reserva.fecha, reserva.hora);
            }

            if (!turnoAt) continue;
            if (turnoAt <= ahora) continue;

            const telefono = reserva.telefono || reserva.phone || "";
            if (!telefono) continue;

            const horasRestantes = (turnoAt.getTime() - ahora.getTime()) / (1000 * 60 * 60);
            const recordatorios = reserva.recordatorios || {};

            const ventana = ventanas.find(v => horasRestantes <= v.max && horasRestantes > v.min);
            if (!ventana) continue;

            const estado = recordatorios[ventana.key] || {};
            if (estado.enviado) continue;

            const horaTexto = limpiarHora(reserva.hora) ? `${limpiarHora(reserva.hora)} hs` : (reserva.hora || "-");

            try {
                await enviarTemplateTurno({
                    telefono,
                    nombre: reserva.clienteNombre || reserva.nombre || reserva.cliente || "Cliente",
                    servicio: reserva.servicio || "Tratamiento",
                    fecha: reserva.fecha || "-",
                    hora: horaTexto,
                    templateName: "turno_confirmado",
                    templateLang: "en"
                });

                const updates = {
                    [`recordatorios.${ventana.key}.enviado`]: true,
                    [`recordatorios.${ventana.key}.enviadoAt`]: admin.firestore.FieldValue.serverTimestamp(),
                    [`recordatorios.${ventana.key}.horasPrevias`]: ventana.max,
                    recordatoriosSchedulerAt: admin.firestore.FieldValue.serverTimestamp()
                };

                if (!reserva.turnoAt) {
                    updates.turnoAt = admin.firestore.Timestamp.fromDate(turnoAt);
                }

                await docSnap.ref.update(updates);
                enviados++;
            } catch (error) {
                console.error(`Error recordatorio ${ventana.key} en reserva ${docSnap.id}:`, error.response?.data || error.message);
                await docSnap.ref.update({
                    [`recordatorios.${ventana.key}.error`]: String(error.response?.data?.error?.message || error.message || "Error desconocido"),
                    [`recordatorios.${ventana.key}.errorAt`]: admin.firestore.FieldValue.serverTimestamp()
                });
            }
        }

        console.log(`Scheduler recordatorios OK. Revisados: ${revisados}. Enviados: ${enviados}.`);
        return null;
    });

// ── NUEVO ────────────────────────────────────────────────────────────────────
// enviarResumenSesion: envía por WhatsApp el detalle de lo realizado ese día
// Body esperado: { tel, nombre, fecha, sesiones: [{ hora, servicio, detalle }] }
// ─────────────────────────────────────────────────────────────────────────────
exports.enviarResumenSesion = functions.https.onRequest(async (req, res) => {

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

        await axios.post(
            `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`,
            {
                messaging_product: "whatsapp",
                to: cleanPhone,
                type: "text",
                text: { body: mensaje }
            },
            {
                headers: {
                    Authorization: `Bearer ${TOKEN_PERMANENTE}`,
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