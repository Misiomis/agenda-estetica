import { db } from "./firebase.js";
import {
  collection,
  getDocs,
  getDoc,
  doc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const sectionLogin = document.getElementById("section-login");
const sectionAgenda = document.getElementById("section-agenda");

const btnIngresar = document.getElementById("btn-ingresar");
const usuarioInput = document.getElementById("usuario");
const emailInput = document.getElementById("email");
const whatsappInput = document.getElementById("whatsapp");
const loginError = document.getElementById("loginError");

const servicesContainer = document.getElementById("servicesContainer");
const bienvenida = document.getElementById("bienvenida");
const btnLogout = document.getElementById("btnLogout");

let clientId = localStorage.getItem("usuario");

/* ===============================
   SESIÓN
=================================*/
function verificarSesion() {
  if (clientId) {
    sectionLogin.classList.add("hidden");
    sectionAgenda.classList.remove("hidden");
    bienvenida.innerText = `Hola, ${clientId} ✨`;
    cargarServicios();
  } else {
    sectionLogin.classList.remove("hidden");
    sectionAgenda.classList.add("hidden");
  }
}

/* ===============================
   LOGIN
=================================*/
btnIngresar?.addEventListener("click", async () => {

  loginError.textContent = "";

  const keyword = usuarioInput.value.toUpperCase().trim();
  const email = emailInput.value.trim();
  const whatsapp = whatsappInput.value.trim();

  if (!keyword || !email || !whatsapp) {
    loginError.textContent = "Completá todos los campos.";
    return;
  }

  try {
    const clienteRef = doc(db, "clients", keyword);
    const clienteSnap = await getDoc(clienteRef);

    if (!clienteSnap.exists()) {
      loginError.textContent = "Usuario incorrecto o no autorizado.";
      return;
    }

    await updateDoc(clienteRef, {
      email,
      telefono: whatsapp
    });

    localStorage.setItem("usuario", keyword);
    clientId = keyword;

    verificarSesion();

  } catch (error) {
    loginError.textContent = "Error de conexión.";
  }
});

/* ===============================
   SERVICIOS → REDIRECCIÓN
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

      // 🔥 AHORA REDIRIGE A fecha.html
      btn.onclick = () => {
        const servicio = encodeURIComponent(data.nombre);
        window.location.href = `fecha.html?servicio=${servicio}`;
      };

      servicesContainer.appendChild(btn);
    }
  });
}

/* ===============================
   LOGOUT
=================================*/
btnLogout?.addEventListener("click", () => {
  localStorage.removeItem("usuario");
  location.reload();
});

verificarSesion();