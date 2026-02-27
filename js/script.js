import { db } from "./firebase.js";
import { 
    collection, getDocs, getDoc, doc, query, where, addDoc, setDoc, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/* =========================
   INICIALIZAR EMAILJS
========================= */
emailjs.init("AU6Z1JJBvWY9zpSnn");

/* =========================
   ELEMENTOS DOM
========================= */
const sectionLogin = document.getElementById("section-login");
const sectionAgenda = document.getElementById("section-agenda");
const btnIngresar = document.getElementById("btn-ingresar");
const servicesContainer = document.getElementById("servicesContainer");
const horariosContainer = document.getElementById("horariosContainer");
const fechaInput = document.getElementById("fecha");
const bienvenida = document.getElementById("bienvenida");
const btnLogout = document.getElementById("btnLogout");

let servicioSeleccionado = null;
let clientId = localStorage.getItem("usuario");

/* =========================
   VERIFICAR SESIÓN
========================= */
async function verificarSesion() {
    clientId = localStorage.getItem("usuario");
    if (clientId) {
        sectionLogin.classList.add("hidden");
        sectionAgenda.classList.remove("hidden");
        bienvenida.innerText = `Hola, ${clientId} ✨`;
        cargarServicios();
    }
}

/* =========================
   LOGIN
========================= */
if (btnIngresar) {
    btnIngresar.onclick = async () => {
        const keyword = document.getElementById("usuario").value.toUpperCase().trim();
        const email = document.getElementById("email").value.trim();
        const whatsapp = document.getElementById("whatsapp").value.trim();

        if (!keyword || !email || !whatsapp) {
            return alert("Completa todos los campos");
        }

        try {
            await setDoc(doc(db, "clients", keyword), {
                nombre: keyword,
                email,
                telefono: whatsapp
            }, { merge: true });

            localStorage.setItem("usuario", keyword);
            localStorage.setItem("userEmail", email);

            location.reload();
        } catch (e) {
            console.error(e);
            alert("Error de base de datos");
        }
    };
}

/* =========================
   CARGAR SERVICIOS
========================= */
async function cargarServicios() {
    const snap = await getDocs(collection(db, "services"));
    servicesContainer.innerHTML = "";

    snap.forEach(d => {
        const btn = document.createElement("button");
        btn.innerText = d.data().nombre;
        btn.className = "btn-servicio";

        btn.onclick = () => {
            document.querySelectorAll(".btn-servicio")
                .forEach(b => b.classList.remove("selected"));

            btn.classList.add("selected");
            servicioSeleccionado = d.data().nombre;

            if (fechaInput.value) generarHorarios(fechaInput.value);
        };

        servicesContainer.appendChild(btn);
    });
}

/* =========================
   GENERAR HORARIOS
========================= */
async function generarHorarios(f) {
    horariosContainer.innerHTML = "Cargando...";

    const dias = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
    const dia = dias[new Date(f + "T00:00:00").getDay()];

    const snap = await getDoc(doc(db, "horarios", dia));
    if (!snap.exists()) {
        horariosContainer.innerHTML = "Cerrado";
        return;
    }

    const resSnap = await getDocs(
        query(collection(db, "reservas"), where("fecha", "==", f))
    );

    const ocupados = resSnap.docs.map(d => d.data().hora);

    horariosContainer.innerHTML = "";

    snap.data().bloques.forEach(b => {
        let ini = new Date(`2026-01-01T${b.inicio}:00`);
        let fin = new Date(`2026-01-01T${b.fin}:00`);

        while (ini < fin) {
            const h = ini.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            });

            const btn = document.createElement("button");
            btn.innerText = h;
            btn.className = "btn-hora";

            if (ocupados.includes(h)) {
                btn.disabled = true;
                btn.classList.add("bloqueado");
            } else {
                btn.onclick = () => reservar(f, h);
            }

            horariosContainer.appendChild(btn);

            ini.setMinutes(ini.getMinutes() + (b.tipo === "fraccionado" ? 30 : 60));
        }
    });
}

/* =========================
   RESERVAR TURNO
========================= */
async function reservar(f, h) {

    if (!servicioSeleccionado) {
        return alert("Elegí un servicio primero");
    }

    if (!confirm(`¿Reservar ${servicioSeleccionado} para el ${f} a las ${h}?`)) {
        return;
    }

    const email = localStorage.getItem("userEmail");

    try {

        // Guardar en Firebase
        await addDoc(collection(db, "reservas"), {
            clienteId: clientId,
            servicio: servicioSeleccionado,
            fecha: f,
            hora: h,
            email: email,
            timestamp: serverTimestamp()
        });

        alert("✅ ¡Turno guardado con éxito!");
        generarHorarios(f);

        // Enviar mail
        await emailjs.send(
            "service_p8k8xah",
            "template_3nk7shm",
            {
                to_name: clientId,
                to_email: email,
                servicio: servicioSeleccionado,
                fecha: f,
                hora: h
            }
        );

        console.log("📩 Mail enviado correctamente");

    } catch (e) {
        console.error("Error completo:", e);
        alert("Error al guardar o enviar el mail");
    }
}

/* =========================
   EVENTOS
========================= */
if (fechaInput) {
    fechaInput.onchange = () => {
        if (servicioSeleccionado) {
            generarHorarios(fechaInput.value);
        } else {
            alert("Elegí servicio primero");
        }
    };
}

if (btnLogout) {
    btnLogout.onclick = () => {
        localStorage.clear();
        location.reload();
    };
}

verificarSesion();