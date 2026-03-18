const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");

// Inicializamos la base de datos
admin.initializeApp();
const db = admin.firestore();

// Credenciales Permanentes
const TOKEN_PERMANENTE = "EAAMzA3ngIUkBQ630dPYUcq6NBWPoybtHpMw8KbMEqTzv49lsAXW9honZCnblqcVdlxltSO35kXQc42D8P6dNwgx2YN4JWxpCwUxoZAziQVyK5jZArVQYaL63CZChQNZCdZBppqIEymvfBbZCsrdBJbXnUnlpdj06DSpYorrgnkmZCJ4wda6M3pQEdIh1PRHOfwZDZD";
const PHONE_NUMBER_ID = "995248997010108";

exports.enviarConfirmacionTurno = functions.https.onRequest(async (req, res) => {
    
    // CORS abierto para que tu HTML local y tu servidor puedan acceder
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        return res.status(204).send("");
    }

    try {
        // 1. RECIBIMOS LO QUE MANDA TU HTML
        const { nombre, servicio, fecha, hora } = req.body;

        if (!nombre || !servicio || !fecha || !hora) {
            console.error("Faltan datos en el body:", req.body);
            return res.status(400).json({ error: "Faltan datos en el envío desde el HTML." });
        }

        console.log(`Buscando a: ${nombre}`);

        // 2. BÚSQUEDA INTELIGENTE EN FIRESTORE
        // Primero buscamos por el campo 'username'
        let clientSnapshot = await db.collection("clients")
            .where("username", "==", nombre)
            .limit(1)
            .get();

        // Si no lo encuentra por 'username', intenta por 'fullName'
        if (clientSnapshot.empty) {
            clientSnapshot = await db.collection("clients")
                .where("fullName", "==", nombre)
                .limit(1)
                .get();
        }

        // Si definitivamente no está, abortamos
        if (clientSnapshot.empty) {
            console.error(`Cliente "${nombre}" no encontrado en Firestore.`);
            return res.status(404).json({ error: "Cliente no registrado en la base de datos." });
        }

        // 3. EXTRACCIÓN Y FORMATEO DEL TELÉFONO
        const clientData = clientSnapshot.docs[0].data();
        const rawPhone = clientData.phone; // Lee el string de tu database
        const nombreReal = clientData.fullName || nombre;

        if (!rawPhone) {
            return res.status(400).json({ error: "El cliente no tiene teléfono guardado." });
        }

        // Limpiamos el número (por si tiene espacios) y le clavamos el 549 de Argentina
        let cleanPhone = rawPhone.toString().replace(/\D/g, "");
        if (!cleanPhone.startsWith("54")) {
            cleanPhone = "549" + cleanPhone;
        }

        console.log(`Enviando a ${nombreReal} al tel: ${cleanPhone}`);

        // 4. ENVÍO A WHATSAPP
        const response = await axios.post(
            `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
            {
                messaging_product: "whatsapp",
                to: cleanPhone,
                type: "template",
                template: {
                    name: "turno_confirmado", 
                    language: { code: "en" }, 
                    components: [
                        {
                            type: "body",
                            parameters: [
                                { type: "text", text: nombreReal },
                                { type: "text", text: servicio },  
                                { type: "text", text: fecha },     
                                { type: "text", text: hora }       
                            ]
                        }
                    ]
                }
            },
            {
                headers: {
                    Authorization: `Bearer ${TOKEN_PERMANENTE}`,
                    "Content-Type": "application/json"
                }
            }
        );

        return res.status(200).json({ status: "success", data: response.data });

    } catch (error) {
        console.error("Error crítico:", error.message);
        return res.status(500).json({ error: "Error interno", detalles: error.message });
    }
});