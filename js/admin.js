import { db } from "./firebase.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const contenedor = document.getElementById("agendaAdmin");

async function cargarReservas() {
    try {
        const snap = await getDocs(collection(db, "reservas"));

        const reservas = [];

        snap.forEach(doc => {
            reservas.push(doc.data());
        });

        // Ordenar por fecha y hora
        reservas.sort((a, b) => {
            const fechaA = new Date(`${a.fecha}T${a.hora}`);
            const fechaB = new Date(`${b.fecha}T${b.hora}`);
            return fechaA - fechaB;
        });

        contenedor.innerHTML = "<h2>Reservas registradas:</h2>";

        reservas.forEach(data => {

            const nombre =
                data.clienteId ||
                data.nombre ||
                data.usuario ||
                "Sin nombre";

            const fecha = data.fecha || "Sin fecha";
            const hora = data.hora || "Sin hora";
            const servicio = data.servicio || "Sin servicio";

            const item = document.createElement("div");
            item.style.marginBottom = "12px";
            item.style.padding = "12px";
            item.style.border = "1px solid #ddd";
            item.style.borderRadius = "10px";
            item.style.background = "#f9f9f9";

            item.innerHTML = `
                <strong>${nombre}</strong><br>
                ${fecha} - ${hora}<br>
                ${servicio}
            `;

            contenedor.appendChild(item);
        });

    } catch (error) {
        console.error("Error cargando reservas:", error);
    }
}

cargarReservas();