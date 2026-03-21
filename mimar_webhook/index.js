const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");

exports.webhook = onRequest((req, res) => {
  // 1. VERIFICACIÓN (Lo que te pide la pantalla de Meta en tu foto)
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    // Usaremos 'mimar2026' como clave secreta
    if (mode === "subscribe" && token === "mimar2026") {
      logger.log("WEBHOOK_VERIFICADO");
      return res.status(200).send(challenge);
    } else {
      return res.sendStatus(403);
    }
  }

  // 2. RECEPCIÓN DE MENSAJES (POST)
  if (req.method === "POST") {
    logger.log("Nuevo mensaje recibido:", JSON.stringify(req.body));
    return res.sendStatus(200);
  }

  res.sendStatus(405);
});