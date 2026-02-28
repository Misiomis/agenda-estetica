import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { 
  getFirestore, 
  collection, 
  getDocs,
  deleteDoc,
  doc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "TU_API_KEY",
  authDomain: "TU_AUTH_DOMAIN",
  projectId: "estetica-8d067",
  storageBucket: "TU_BUCKET",
  messagingSenderId: "TU_SENDER_ID",
  appId: "TU_APP_ID"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let currentDate = new Date();
let reservasPorFecha = {};

function renderCalendar() {
  const grid = document.getElementById("calendarGrid");
  const monthTitle = document.getElementById("monthTitle");

  grid.innerHTML = "";
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  monthTitle.innerText = firstDay
    .toLocaleString("es-ES", { month: "long", year: "numeric" })
    .toUpperCase();

  const dayNames = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];
  dayNames.forEach(d => {
    const div = document.createElement("div");
    div.className = "day-name";
    div.innerText = d;
    grid.appendChild(div);
  });

  let startDay = (firstDay.getDay() + 6) % 7;
  for (let i = 0; i < startDay; i++) {
    grid.appendChild(document.createElement("div"));
  }

  for (let d = 1; d <= lastDay.getDate(); d++) {
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;

    const div = document.createElement("div");
    div.className = "day";
    div.innerText = d;

    if (reservasPorFecha[dateStr]) {
      div.classList.add("has-reservation");
    }

    div.onclick = () => showDay(dateStr);
    grid.appendChild(div);
  }
}

async function loadReservas() {
  const snapshot = await getDocs(collection(db, "reservas"));
  reservasPorFecha = {};

  snapshot.forEach(docSnap => {
    const data = docSnap.data();
    const id = docSnap.id;

    if (data.fecha) {
      if (!reservasPorFecha[data.fecha]) {
        reservasPorFecha[data.fecha] = [];
      }

      reservasPorFecha[data.fecha].push({
        id,
        ...data
      });
    }
  });

  renderCalendar();
}

function showDay(fecha) {
  const container = document.getElementById("selectedDay");
  const reservas = reservasPorFecha[fecha];

  let html = `<h3 style="margin-top:20px;">Día: ${fecha}</h3>`;

  if (!reservas) {
    html += `<p>No hay reservas para este día.</p>`;
  } else {
    reservas.forEach(r => {
      html += `
        <div class="reserva-card">
          <strong>${r.hora} hs</strong> - ${r.nombreCliente}<br>
          <span>Servicio: ${r.servicio}</span><br>
          <button class="btn-cancel" onclick="cancelarReserva('${r.id}', '${fecha}')">
            Cancelar turno
          </button>
        </div>
      `;
    });
  }

  container.innerHTML = html;
}

let reservaPendiente = null;
let fechaPendiente = null;

window.cancelarReserva = function(id, fecha) {
  reservaPendiente = id;
  fechaPendiente = fecha;
  document.getElementById("modalConfirm").classList.remove("hidden");
};

document.getElementById("modalCancel").onclick = function() {
  document.getElementById("modalConfirm").classList.add("hidden");
};

document.getElementById("modalConfirmBtn").onclick = async function() {
  if (!reservaPendiente) return;

  await deleteDoc(doc(db, "reservas", reservaPendiente));

  document.getElementById("modalConfirm").classList.add("hidden");

  await loadReservas();
  showDay(fechaPendiente);

  reservaPendiente = null;
  fechaPendiente = null;
};

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btnPrev").onclick = () => {
    currentDate.setMonth(currentDate.getMonth() - 1);
    renderCalendar();
  };

  document.getElementById("btnNext").onclick = () => {
    currentDate.setMonth(currentDate.getMonth() + 1);
    renderCalendar();
  };

  loadReservas();
});