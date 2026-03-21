import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, onSnapshot, doc, updateDoc, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// CONFIGURACIÓN FIREBASE (Captura image_e27f26.jpg)
const firebaseConfig = {
    apiKey: "AIzaSyBc5435tsDnJ_yJqO1ppwSjxSpCIhpjgew",
    projectId: "estetica-8d067",
    appId: "1:774341571551:web:863e0e7a2b2923057e4e4a"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// CONFIGURACIÓN META (Basada en tu captura image_e286c2.jpg)
const WHATSAPP_TOKEN = "EAAMzA3ngIUkBQ630dPYUcq6NBWPoybtHpMw8KbMEqTzv49lsAXW9honZCnblqcVdlxltSO35kXQc42D8P6dNwgx2YN4JWxpCwUxoZAziQVyK5jZArVQYaL63CZChQNZCdZBppqIEymvfBbZCsrdBJbXnUnlpdj06DSpYorrgnkmZCJ4wda6M3pQEdIh1PRHOfwZDZD";
// Usamos el ID que aparece en el paso 2 de tu captura (ejemplo cURL)
const PHONE_NUMBER_ID = "995248997818188"; 

let reservas = [];
let diccionarioClientes = {};
let mesActual = new Date().getMonth();
let yearActual = new Date().getFullYear();

// 1. CARGAR CLIENTES PARA MAPEAR DNI -> NOMBRE
async function cargarDiccionario() {
    const snap = await getDocs(collection(db, "clients"));
    diccionarioClientes = {};
    snap.forEach(d => {
        const c = d.data();
        if (c.dni) {
            diccionarioClientes[c.dni] = {
                nombre: c.fullName || "Sin nombre",
                tel: c.phone || ""
            };
        }
    });
}

// 2. ESCUCHAR RESERVAS
async function iniciar() {
    await cargarDiccionario();
    onSnapshot(collection(db, "reservas"), (snapshot) => {
        reservas = snapshot.docs.map(d => {
            const data = d.data();
            // Si el DNI está en clientes, traemos el nombre "Braulio V", si no, usamos el del registro
            const info = diccionarioClientes[data.dni] || { nombre: data.fullName || "Paciente", tel: data.phone || "" };
            return { id: d.id, ...data, nombreFinal: info.nombre, telFinal: info.tel };
        });
        renderCalendario();
    });
}

// 3. RENDER CALENDARIO
function renderCalendario() {
    const container = document.getElementById("agendaContainer");
    container.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px">
            <button onclick="cambiarMes(-1)">◀</button>
            <h2 style="margin:0">${obtenerNombreMes(mesActual)} ${yearActual}</h2>
            <button onclick="cambiarMes(1)">▶</button>
        </div>
        <div class="diasSemana"><div>Lu</div><div>Ma</div><div>Mi</div><div>Ju</div><div>Vi</div><div>Sa</div><div>Do</div></div>
        <div id="gridDias" class="gridDias"></div>
    `;

    const grid = document.getElementById("gridDias");
    const primerDia = new Date(yearActual, mesActual, 1).getDay();
    const totalDias = new Date(yearActual, mesActual + 1, 0).getDate();
    const offset = (primerDia === 0) ? 6 : primerDia - 1;

    for (let i = 0; i < offset; i++) grid.appendChild(document.createElement("div"));

    for (let d = 1; d <= totalDias; d++) {
        const fecha = `${yearActual}-${String(mesActual + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const tieneTurno = reservas.some(r => r.fecha === fecha);
        const el = document.createElement("div");
        el.className = `day ${tieneTurno ? 'ocupado' : ''}`;
        el.innerText = d;
        el.onclick = () => mostrarTurnosDia(fecha);
        grid.appendChild(el);
    }
}

// 4. MOSTRAR DETALLE DEL DÍA
function mostrarTurnosDia(fecha) {
    const container = document.getElementById("agendaContainer");
    const lista = reservas.filter(r => r.fecha === fecha).sort((a,b) => a.hora.localeCompare(b.hora));
    
    container.innerHTML = `<h3>Turnos: ${fecha}</h3>`;
    
    if(lista.length === 0) container.innerHTML += "<p>No hay turnos hoy.</p>";

    lista.forEach(t => {
        const card = document.createElement("div");
        card.className = "card-turno";
        card.innerHTML = `
            <strong>${t.nombreFinal}</strong> <br>
            <small>${t.hora} hs - ${t.servicio || 'Sin tratamiento'}</small>
            <textarea id="nota-${t.id}" placeholder="Escribe aquí el detalle de la sesión...">${t.detalleSesion || ""}</textarea>
            <button class="btn-save" onclick="window.guardarNota('${t.id}')">Guardar Registro ✓</button>
            <button class="btn-ws" onclick="window.enviarWS('${t.telFinal}', '${t.nombreFinal}', '${t.fecha}', '${t.hora}')">Confirmar WhatsApp 📲</button>
        `;
        container.appendChild(card);
    });

    const btnVolver = document.createElement("button");
    btnVolver.innerText = "Volver al Calendario";
    btnVolver.style.cssText = "width:100%; margin-top:15px; padding:10px; cursor:pointer";
    btnVolver.onclick = renderCalendario;
    container.appendChild(btnVolver);
}

// 5. ACCIONES
window.guardarNota = async (id) => {
    const nota = document.getElementById(`nota-${id}`).value;
    try {
        await updateDoc(doc(db, "reservas", id), { detalleSesion: nota });
        alert("¡Registro guardado!");
    } catch (e) { alert("Error al guardar."); }
};

window.enviarWS = async (tel, nombre, fecha, hora) => {
    if (!tel) return alert("No hay teléfono registrado.");
    
    // Limpieza de número para Argentina (549...)
    let num = tel.toString().replace(/\D/g, "");
    if (!num.startsWith("54")) num = "54" + num;

    const url = `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`;
    const data = {
        messaging_product: "whatsapp",
        to: num,
        type: "template",
        template: {
            name: "confirmacion_de_cita", // Asegurate que sea este nombre exacto en Meta
            language: { code: "es" },
            components: [{
                type: "body",
                parameters: [
                    { type: "text", text: fecha }, // {{1}}
                    { type: "text", text: hora }   // {{2}}
                ]
            }]
        }
    };

    try {
        const res = await fetch(url, {
            method: "POST",
            headers: { "Authorization": `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify(data)
        });
        const resJson = await res.json();
        if (res.ok) alert("✅ Mensaje enviado a " + nombre);
        else alert("❌ Error: " + resJson.error.message);
    } catch (e) { alert("Error de red."); }
};

// UTILIDADES
window.cambiarMes = (n) => { mesActual += n; if(mesActual<0){mesActual=11; yearActual--;} if(mesActual>11){mesActual=0; yearActual++;} renderCalendario(); };
function obtenerNombreMes(m) { return ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"][m]; }

iniciar();