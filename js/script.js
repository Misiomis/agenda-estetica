import { db, collection, getDocs, doc, getDoc, updateDoc } from "./firebase-web.js";

/* ===============================
ELEMENTOS
=================================*/

const sectionLogin = document.getElementById("section-login");
const sectionAgenda = document.getElementById("section-agenda");

const btnIngresar = document.getElementById("btn-ingresar");
const usuarioInput = document.getElementById("usuario");
const emailInput = document.getElementById("email");
const whatsappInput = document.getElementById("whatsapp");
const loginError = document.getElementById("loginError");

const servicesContainer = document.getElementById("servicesContainer");
const btnLogout = document.getElementById("btnLogout");

let clientId = localStorage.getItem("usuario");

/* ===============================
INICIO
=================================*/

init();

async function init() {

  if (clientId) {
    mostrarAgenda();
  } else {
    mostrarLogin();
  }

}

/* ===============================
MOSTRAR SECCIONES
=================================*/

function mostrarLogin() {

  sectionLogin.classList.remove("hidden");
  sectionAgenda.classList.add("hidden");

}

function mostrarAgenda() {

  sectionLogin.classList.add("hidden");
  sectionAgenda.classList.remove("hidden");

  cargarServicios();

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

      loginError.textContent = "Usuario incorrecto.";
      return;

    }

    await updateDoc(clienteRef, {
      email,
      telefono: whatsapp
    });

    localStorage.setItem("usuario", keyword);
    clientId = keyword;

    mostrarAgenda();

  } catch (error) {

    loginError.textContent = "Error de conexión con Firebase.";

  }

});

/* ===============================
CARGAR SERVICIOS
=================================*/

async function cargarServicios() {

  servicesContainer.innerHTML = "Cargando servicios...";

  try {

    const snapshot = await getDocs(collection(db, "services"));

    servicesContainer.innerHTML = "";

    if (snapshot.empty) {

      servicesContainer.innerHTML = "No hay servicios disponibles.";
      return;

    }

    snapshot.forEach((docSnap) => {

      const data = docSnap.data();

      if (data.activo) {

        const btn = document.createElement("button");

        btn.innerText = data.nombre;
        btn.className = "btn-servicio";

        btn.onclick = () => {

          const servicioId = docSnap.id;
          const servicioNombre = encodeURIComponent(data.nombre);

          window.location.href =
            `fecha.html?sid=${servicioId}&servicio=${servicioNombre}`;

        };

        servicesContainer.appendChild(btn);

      }

    });

  } catch (error) {

    servicesContainer.innerHTML = "Error cargando servicios.";

  }

}

/* ===============================
LOGOUT
=================================*/

btnLogout?.addEventListener("click", () => {

  localStorage.removeItem("usuario");
  location.reload();

});