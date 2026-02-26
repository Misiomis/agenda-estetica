import { db } from "./firebase.js";
import {
  collection,
  getDocs,
  getDoc,
  doc,
  query,
  where,
  addDoc,
  serverTimestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/* ===============================
   ELEMENTOS DOM
=================================*/
const servicesContainer = document.getElementById("servicesContainer");
const fechaInput = document.getElementById("fecha");
const horariosContainer = document.getElementById("horariosContainer");
const bienvenida = document.getElementById("bienvenida");
const btnLogout = document.getElementById("btnLogout");

const modalEmail = document.getElementById("modalEmail");
const inputEmail = document.getElementById("inputEmail");
const btnGuardarEmail = document.getElementById("btnGuardarEmail");

let servicioSeleccionado = null;
let clientId = localStorage.getItem("usuario");

/* ===============================
   VERIFICAR SESIÓN
=================================*/
if (!clientId) {
  window.location.href = "index.html";
} else {
  bienvenida.innerText = `Bienvenido, ${clientId}`;
}

/* ===============================
   1️⃣ CARGAR SERVICIOS
=================================*/
async function cargarServicios() {
  const snapshot = await getDocs(collection(db, "services"));
  servicesContainer.innerHTML = "";

  snapshot.forEach((docSnap) => {
    const data = docSnap.data();

    if (data.activo) {
      const btn = document.createElement("button");
      btn.innerText = data.nombre;
      btn.className = "btn-servicio";

      btn.onclick = () => {
        document
          .querySelectorAll(".btn-servicio")
          .forEach((b) => b.classList.remove("selected"));

        btn.classList.add("selected");
        servicioSeleccionado = data.nombre;
      };

      servicesContainer.appendChild(btn);
    }
  });
}

/* ===============================
   2️⃣ GENERAR HORARIOS
=================================*/
async function generarHorarios(fechaSeleccionada) {
  horariosContainer.innerHTML = "<p>Cargando horarios...</p>";

  const dias = [
    "domingo","lunes","martes","miercoles",
    "jueves","viernes","sabado"
  ];

  const fechaObj = new Date(fechaSeleccionada.replace(/-/g, "/"));
  const diaTexto = dias[fechaObj.getDay()];

  const docRef = doc(db, "horarios", diaTexto);
  const docSnap = await getDoc(docRef);

  if (!docSnap.exists() || !docSnap.data().activo) {
    horariosContainer.innerHTML = "<p>No hay atención este día.</p>";
    return;
  }

  const qReservas = query(
    collection(db, "reservas"),
    where("fecha", "==", fechaSeleccionada)
  );

  const snapRes = await getDocs(qReservas);
  const ocupados = snapRes.docs.map((d) => d.data().hora);

  horariosContainer.innerHTML = "";
  const data = docSnap.data();

  data.bloques.forEach((bloque) => {
    let temp = new Date(`2026-01-01T${bloque.inicio}:00`);
    let limite = new Date(`2026-01-01T${bloque.fin}:00`);
    const tipo = bloque.tipo.trim().toLowerCase();

    while (temp < limite) {
      const horaStr = temp.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      });

      const btn = document.createElement("button");
      btn.innerText = horaStr;
      btn.className = "btn-hora";

      if (ocupados.includes(horaStr)) {
        btn.innerText += " 🔴";
        btn.disabled = true;
        btn.classList.add("bloqueado");
      } else {
        btn.onclick = () => reservarTurno(fechaSeleccionada, horaStr);
      }

      horariosContainer.appendChild(btn);
      temp.setMinutes(temp.getMinutes() + (tipo === "fraccionado" ? 30 : 60));
    }
  });
}

/* ===============================
   3️⃣ RESERVAR CON MODAL EMAIL
=================================*/
async function reservarTurno(fecha, hora) {

  if (!servicioSeleccionado) {
    alert("Seleccioná un servicio primero");
    return;
  }

  const clienteRef = doc(db, "clients", clientId);
  const clienteSnap = await getDoc(clienteRef);

  if (!clienteSnap.exists()) {
    alert("Cliente no encontrado.");
    return;
  }

  let clienteData = clienteSnap.data();
  let emailCliente = clienteData.email?.trim();

  // SI NO TIENE EMAIL → MOSTRAR MODAL
  if (!emailCliente) {
    modalEmail.classList.remove("hidden");

    btnGuardarEmail.onclick = async () => {
      const nuevoEmail = inputEmail.value.trim();

      if (!nuevoEmail.includes("@")) {
        alert("Ingresá un email válido.");
        return;
      }

      await updateDoc(clienteRef, { email: nuevoEmail });

      modalEmail.classList.add("hidden");
      inputEmail.value = "";

      reservarTurno(fecha, hora);
    };

    return;
  }

  const mesClave = fecha.substring(0, 7);

  await addDoc(collection(db, "reservas"), {
    clientId,
    nombreCliente: clienteData.nombre,
    emailCliente,
    servicio: servicioSeleccionado,
    fecha,
    hora,
    mesClave,
    timestamp: serverTimestamp()
  });

  await emailjs.send(
    "service_p8k8xah",
    "template_3nk7shm",
    {
      to_name: clienteData.nombre,
      to_email: emailCliente,
      servicio: servicioSeleccionado,
      fecha,
      hora
    }
  );

  alert("Turno reservado correctamente ✅");
  generarHorarios(fecha);
}

/* ===============================
   EVENTOS
=================================*/
fechaInput.addEventListener("change", () => {
  if (!servicioSeleccionado) {
    alert("Primero seleccioná un servicio");
    fechaInput.value = "";
    return;
  }

  generarHorarios(fechaInput.value);
});

btnLogout.addEventListener("click", () => {
  localStorage.removeItem("usuario");
  window.location.href = "index.html";
});

/* ===============================
   INICIO
=================================*/
cargarServicios();