import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, onSnapshot, doc, updateDoc, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyBc5435tsDnJ_yJqO1ppwSjxSpCIhpjgew",
    projectId: "estetica-8d067",
    appId: "1:774341571551:web:863e0e7a2b2923057e4e4a"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let reservas = [];
let diccionarioClientes = {};
let mesActual = new Date().getMonth();
let yearActual = new Date().getFullYear();

// 1. CARGAR CLIENTES (DNI -> Nombre/Tel)
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

// 2. ESCUCHAR RESERVAS EN TIEMPO REAL
async function iniciar() {
    await cargarDiccionario();
    onSnapshot(collection(db, "reservas"), (snapshot) => {
        reservas = snapshot.docs.map(d => {
            const data = d.data();
            const info = diccionarioClientes[data.dni] || { nombre: data.fullName || "Paciente", tel: data.phone || "" };
            return { id: d.id, ...data, nombreFinal: info.nombre, telFinal: info.tel };
        });
        renderCalendario();
    });
}

// 3. RENDERIZAR CALENDARIO
function renderCalendario() {
    const container = document.getElementById("agendaContainer");
    container.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px">
            <button onclick="window.cambiarMes(-1)" style="border:none; background:none; font-size:20px; cursor:pointer">◀</button>
            <h2 style="margin:0; font-family:'Playfair Display'">${obtenerNombreMes(mesActual)} ${yearActual}</h2>
            <button onclick="window.cambiarMes(1)" style="border:none; background:none; font-size:20px; cursor:pointer">▶</button>
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

// 4. MOSTRAR DETALLE DEL DÍA Y ENVÍO MANUAL
function mostrarTurnosDia(fecha) {
    const container = document.getElementById("agendaContainer");
    const lista = reservas.filter(r => r.fecha === fecha).sort((a,b) => a.hora.localeCompare(b.hora));
    
    container.innerHTML = `<h3 style="font-family:'Playfair Display'">Turnos: ${fecha.split('-').reverse().join('/')}</h3>`;
    
    if(lista.length === 0) container.innerHTML += "<p>No hay turnos hoy.</p>";

    lista.forEach(t => {
        const card = document.createElement("div");
        card.className = "card-turno";
        card.style.cssText = "background:white; padding:15px; border-radius:15px; margin-bottom:10px; box-shadow:0 4px 10px rgba(0,0,0,0.05); text-align:left";
        card.innerHTML = `
            <strong style="font-size:16px">${t.nombreFinal}</strong> <br>
            <small style="color:#666">${t.hora} hs — ${t.servicio || 'Tratamiento'}</small>
            <textarea id="nota-${t.id}" style="width:100%; margin-top:10px; border-radius:10px; border:1px solid #ddd; padding:8px" placeholder="Detalle de la sesión...">${t.detalleSesion || ""}</textarea>
            <div style="display:flex; gap:10px; margin-top:10px">
                <button onclick="window.guardarNota('${t.id}')" style="flex:1; background:#72bd99; color:white; border:none; padding:10px; border-radius:10px; cursor:pointer">Guardar Registro</button>
                <button onclick="window.enviarWS('${t.telFinal}', '${t.nombreFinal}', '${t.fecha}', '${t.hora}', '${t.servicio}')" style="flex:1; background:#25d366; color:white; border:none; padding:10px; border-radius:10px; cursor:pointer">Avisar WA 📲</button>
            </div>
        `;
        container.appendChild(card);
    });

    const btnVolver = document.createElement("button");
    btnVolver.innerText = "Volver al Calendario";
    btnVolver.style.cssText = "width:100%; margin-top:15px; padding:12px; border-radius:12px; border:1px solid #ddd; background:#f9f9f9; cursor:pointer";
    btnVolver.onclick = renderCalendario;
    container.appendChild(btnVolver);
}

// 5. ACCIÓN: ENVÍO MANUAL (CHAU API DE META)
window.enviarWS = (tel, nombre, fecha, hora, servicio) => {
    if (!tel) return alert("Esta clienta no tiene teléfono registrado.");

    // Formatear fecha para el mensaje (Ej: Lun. 23/03)
    const dias = ["Dom.", "Lun.", "Mar.", "Mié.", "Jue.", "Vie.", "Sáb."];
    const [y, m, d] = fecha.split('-');
    const fObj = new Date(y, m - 1, d);
    const fechaLinda = `${dias[fObj.getDay()]} ${d}/${m}`;

    const msg = `Hola *${nombre}* 😊%0A%0A` +
                `Te confirmo tu turno en *Espacio Mimar T*:%0A%0A` +
                `📅 *Día:* ${fechaLinda}%0A` +
                `🕒 *Hora:* ${hora} hs%0A` +
                `✨ *Servicio:* ${servicio || "Tratamiento"}%0A%0A` +
                `¡Te esperamos! 💜`;

    let num = tel.toString().replace(/\D/g, "");
    // Si es de Argentina y no tiene el 54, se lo agregamos
    if (!num.startsWith("54")) num = "549" + num;

    window.open(`https://wa.me/${num}?text=${msg}`, '_blank');
};

window.guardarNota = async (id) => {
    const nota = document.getElementById(`nota-${id}`).value;
    try {
        await updateDoc(doc(db, "reservas", id), { detalleSesion: nota });
        alert("¡Registro guardado!");
    } catch (e) { alert("Error al guardar."); }
};

window.cambiarMes = (n) => { 
    mesActual += n; 
    if(mesActual < 0){ mesActual = 11; yearActual--; } 
    if(mesActual > 11){ mesActual = 0; yearActual++; } 
    renderCalendario(); 
};

function obtenerNombreMes(m) { 
    return ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"][m]; 
}

iniciar();