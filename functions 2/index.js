const functions = require("firebase-functions");
const axios = require("axios");
const cors = require("cors")({ origin: true });

// Token y ID de teléfono proporcionados para la API de Meta
const TOKEN = "EAAU0cYmeClEBQ7I7fM0Kk6tCIoe6FOu7TNPK7i0syT6Vfi0eQvzlmioSXh96ZBOvMgVBgxZBkZACERXMkiexzvE4SE0waWFzqkpaOtApowKwMEcZAe2DkqWrTExriudTaVSNE5bamhiQeLjPyzmhTeFhWZAHuhJGmPro79BiSZCBgXZCda4FKtvwZABhZBSHayvsoClSsVeL4T8lQNYgT8Ejdijf8lrv9f2PuaCEKyDWBwTUNaMgZBtwi3xkZB8n29LXjLYXnY8KpDI5ZAvSPDyw6JMx3lVfCvUjTVc41gZDZD";
const PHONE_NUMBER_ID = "1049101464950359";

exports.enviarConfirmacionTurno = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {

    // Manejo de Preflight para CORS
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    // Extraemos los datos dinámicos enviados desde el frontend
    const { nombre, telefono, servicio, fecha, hora } = req.body;

    // Construcción del mensaje dinámico (Asegúrate de que el frontend envíe estos datos)
    const mensaje = 
`Hola ${nombre || "Braulio V"}! 😊

Tu turno en *Espacio Mimar T* fue confirmado correctamente. 💜

✨ *Servicio:* ${servicio || "Tratamiento seleccionado"}
📅 *Fecha:* ${fecha || "Consultar fecha"}
⏰ *Hora:* ${hora || "Consultar hora"} hs

📍 *Dirección:* Andresito, Misiones.

Si necesitás reprogramar o cancelar tu turno, por favor avisame con anticipación. ¡Te esperamos!`;

    try {
      // Petición POST a la API de WhatsApp de Meta
      await axios.post(
        `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: "whatsapp",
          to: telefono,
          type: "text",
          text: {
            body: mensaje
          }
        },
        {
          headers: {
            Authorization: `Bearer ${TOKEN}`,
            "Content-Type": "application/json"
          }
        }
      );

      res.status(200).send("Mensaje enviado con éxito");

    } catch (error) {
      // Log de errores para depuración
      console.error("Error en WhatsApp API:", error.response?.data || error.message);
      res.status(500).send("Error enviando el mensaje de WhatsApp");
    }
  });
});