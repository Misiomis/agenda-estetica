<<<<<<< HEAD
import { db } from "./firebase.js";
import { writeBatch, doc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
=======
import { db, writeBatch, doc } from "./firebase-web.js";
>>>>>>> main

async function uploadClientsBatch() {
  try {
    const response = await fetch("/js/clients.json");

    if (!response.ok) {
      throw new Error("No se pudo cargar /js/clients.json");
    }

    const clients = await response.json();

    const batch = writeBatch(db);

    clients.forEach(client => {

      const dni = String(client.ClaveAcceso || "")
        .replace(".0", "")
        .trim();

      if (!dni) return;

      const phone = String(client.Telefono || "")
        .replace(/\s+/g, "")
        .replace(/-/g, "")
        .trim();

      const hours = Number(client.Horas) || 0;

      const username = String(client.Nombre || "")
        .toLowerCase()
        .trim();

      const clientRef = doc(db, "clients", dni);

      batch.set(clientRef, {
        dni: dni,
        username: username,
        fullName: client.Nombre || "",
        email: client.email || "",
        phone: phone,
        hoursBalance: hours,
        role: "client",
        active: true,
        createdAt: new Date()
      });

    });

    await batch.commit();

    console.log("🔥 Clientes cargados correctamente");

  } catch (error) {
    console.error("❌ Error al cargar clientes:", error);
  }
}

uploadClientsBatch();