import { db, collection, getDocs, getDoc, doc, query, where, addDoc, setDoc, serverTimestamp, updateDoc } from "./firebase-web.js";

/* ===============================
ELEMENTOS DOM
=================================*/

const sectionLogin = document.getElementById("section-login");
const sectionAgenda = document.getElementById("section-agenda");

const btnIngresar = document.getElementById("btn-ingresar");
const usuarioInput = document.getElementById("usuario");
const emailInput = document.getElementById("email");
const whatsappInput = document.getElementById("whatsapp");

const servicesContainer = document.getElementById("servicesContainer");
const fechaInput = document.getElementById("fecha");
const horariosContainer = document.getElementById("horariosContainer");
const bienvenida = document.getElementById("bienvenida");
const btnLogout = document.getElementById("btnLogout");

const modalNutricion = document.getElementById("consultaNutricionalModal");
const btnAceptarNutricion = document.getElementById("aceptarNutricion");
const btnRechazarNutricion = document.getElementById("rechazarNutricion");

let servicioSeleccionado = null;
let clientId = localStorage.getItem("clienteDNI") || localStorage.getItem("usuario");

/* ===============================
GESTIÓN DE VISTAS
=================================*/

async function verificarSesion() {

    if (clientId) {

        sectionLogin?.classList.add("hidden");
        sectionAgenda?.classList.remove("hidden");

        bienvenida.innerText = `Hola, ${clientId} ✨`;

        await cargarServicios();

        await verificarConsultaNutricional();

    } else {

        sectionLogin?.classList.remove("hidden");
        sectionAgenda?.classList.add("hidden");

    }

}

/* ===============================
CONSULTA NUTRICIONAL
=================================*/

async function verificarConsultaNutricional(){

    try{

        const clienteRef = doc(db,"clients",clientId);
        const clienteSnap = await getDoc(clienteRef);

        if(!clienteSnap.exists()) return;

        const data = clienteSnap.data();

        if(!data.consultaNutricionalRespondida){

            modalNutricion.style.display = "flex";

        }

    }catch(e){

        console.error("Error nutricion:",e);

    }

}

async function guardarRespuestaNutricion(respuesta){

    try{

        const clienteRef = doc(db,"clients",clientId);

        await updateDoc(clienteRef,{
            consultaNutricional: respuesta,
            consultaNutricionalRespondida: true
        });

        modalNutricion.style.display = "none";

    }catch(e){

        console.error("Error guardando respuesta:",e);

    }

}

btnAceptarNutricion?.addEventListener("click",()=>guardarRespuestaNutricion(true));
btnRechazarNutricion?.addEventListener("click",()=>guardarRespuestaNutricion(false));

/* ===============================
LOGIN
=================================*/

if (btnIngresar) {

    btnIngresar.onclick = async () => {

        const keyword = usuarioInput.value.toUpperCase().trim();
        const email = emailInput.value.trim();
        const whatsapp = whatsappInput.value.trim();

        if (!keyword || !email || !whatsapp) {

            alert("Por favor, completa todos los campos.");
            return;

        }

        try {

            const clienteRef = doc(db, "clients", keyword);
            const clienteSnap = await getDoc(clienteRef);

            if (clienteSnap.exists()) {

                await updateDoc(clienteRef,{
                    email,
                    telefono: whatsapp
                });

            } else {

                await setDoc(clienteRef,{
                    nombre: keyword,
                    email,
                    telefono: whatsapp,
                    monthlyLimit: 4,
                    role: "client",
                    consultaNutricionalRespondida: false
                });

            }

            localStorage.setItem("clienteDNI", keyword);
            localStorage.setItem("usuario", keyword); // Mantener por compatibilidad legacy

            location.reload();

        } catch (e) {

            console.error("Error en login:", e);
            alert("Error de conexión con la base de datos.");

        }

    };

}

/* ===============================
SERVICIOS
=================================*/

async function cargarServicios(){

    if (!servicesContainer) return;

    const snapshot = await getDocs(collection(db,"services"));

    servicesContainer.innerHTML="";

    snapshot.forEach((docSnap)=>{

        const data = docSnap.data();

        if(data.activo){

            const btn=document.createElement("button");

            btn.innerText=data.nombre;
            btn.className="btn-servicio";

            btn.onclick=()=>{

                document.querySelectorAll(".btn-servicio")
                .forEach(b=>b.classList.remove("selected"));

                btn.classList.add("selected");

                servicioSeleccionado=data.nombre;

            };

            servicesContainer.appendChild(btn);

        }

    });

}

/* ===============================
HORARIOS
=================================*/

async function generarHorarios(fechaSeleccionada){

    horariosContainer.innerHTML="<p>Buscando horarios...</p>";

    const blockedDates = ["2026-05-01", "2026-05-04"];

    // Excepciones cargadas por el admin para este dia (coleccion calendarExceptions,
    // la misma que escribe admin.html al "bloquear horario" / "cerrar dia"). Antes
    // esta vista solo miraba el array hardcodeado de arriba, asi que un bloqueo nuevo
    // del admin (de dia completo o de un horario puntual) seguia apareciendo disponible.
    const qExcepciones=query(collection(db,"calendarExceptions"),where("fecha","==",fechaSeleccionada));
    const snapExcepciones=await getDocs(qExcepciones);
    const excepcionesActivas=snapExcepciones.docs
        .map(d=>d.data())
        .filter(b => b.active !== false && (b.blocked === true || String(b.type || "").trim().toLowerCase() === "blocked"));

    const cierreDia=excepcionesActivas.find(b => !String(b.hora || "").trim());
    if (blockedDates.includes(fechaSeleccionada) || cierreDia) {
        const motivo=cierreDia?.reason ? `: ${cierreDia.reason}` : "";
        horariosContainer.innerHTML = `<p style='color:#e74c3c; font-weight:bold; margin-top:10px; padding:10px; border:1px solid #e74c3c; border-radius:10px; background:#fdf2f2; text-align:center;'>Bloqueado por Admin${motivo}</p>`;
        return;
    }

    const horasBloqueadas=excepcionesActivas
        .map(b => String(b.hora || "").trim())
        .filter(Boolean);

    const dias=["domingo","lunes","martes","miercoles","jueves","viernes","sabado"];

    const fechaObj=new Date(fechaSeleccionada.replace(/-/g,"/"));

    const diaTexto=dias[fechaObj.getDay()];

    const docRef=doc(db,"horarios",diaTexto);
    const docSnap=await getDoc(docRef);

    if(!docSnap.exists() || !docSnap.data().activo){

        horariosContainer.innerHTML="<p>No hay atención este día.</p>";
        return;

    }

    const qReservas=query(collection(db,"reservas"),where("fecha","==",fechaSeleccionada));
    const snapRes=await getDocs(qReservas);

    const ocupados=snapRes.docs
        .filter(d => {
            const r = d.data();
            const estado = (r.estado || r.status || "").toLowerCase();
            return estado !== "cancelado";
        })
        .map(d=>d.data().hora);

    horariosContainer.innerHTML="";

    const data=docSnap.data();

    data.bloques.forEach((bloque)=>{

        let temp=new Date(`2026-01-01T${bloque.inicio}:00`);
        let limite=new Date(`2026-01-01T${bloque.fin}:00`);

        const tipo=bloque.tipo.trim().toLowerCase();

        while(temp<limite){

            const horaStr=temp.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",hour12:false});

            const btn=document.createElement("button");
            btn.innerText=horaStr;
            btn.className="btn-hora";

            if(ocupados.includes(horaStr)){

                btn.innerText+=" 🔴";
                btn.disabled=true;
                btn.classList.add("bloqueado");

            }else if(horasBloqueadas.includes(horaStr)){

                btn.innerText+=" 🚫";
                btn.disabled=true;
                btn.classList.add("bloqueado");
                btn.title="Bloqueado por Admin";

            }else{

                btn.onclick=()=>reservarTurno(fechaSeleccionada,horaStr);

            }

            horariosContainer.appendChild(btn);

            temp.setMinutes(temp.getMinutes()+(tipo==="fraccionado"?30:60));

        }

    });

}

/* ===============================
RESERVA
=================================*/

async function reservarTurno(fecha,hora){

    if(!servicioSeleccionado){

        alert("Primero seleccioná un servicio");
        return;

    }

    try{

        const clienteRef=doc(db,"clients",clientId);
        const clienteSnap=await getDoc(clienteRef);
        const clienteData=clienteSnap.data();
        const turnoAt = new Date(`${fecha}T${hora}:00-03:00`);

        await addDoc(collection(db,"reservas"),{

            clientId,
            nombreCliente:clienteData.nombre,
            emailCliente:clienteData.email,
            telefono: clienteData.telefono || clienteData.phone || "",
            servicio:servicioSeleccionado,
            fecha,
            hora,
            turnoAt: Number.isNaN(turnoAt.getTime()) ? null : turnoAt,
            status:"confirmado",
            estado:"confirmado",
            reminderSent:false,
            recordatorios: {
                h48: { enviado: false },
                h24: { enviado: false },
                h12: { enviado: false },
                h6: { enviado: false }
            },
            timestamp:serverTimestamp()

        });

        await emailjs.send("service_p8k8xah","template_3nk7shm",{

            to_name:clienteData.nombre,
            to_email:clienteData.email,
            servicio:servicioSeleccionado,
            fecha:fecha,
            hora:hora

        });

        alert("✅ Turno reservado. Revisa tu email.");

        generarHorarios(fecha);

    }catch(e){

        console.error("Error en reserva:",e);
        alert("No se pudo completar la reserva.");

    }

}

/* ===============================
EVENTOS
=================================*/

fechaInput?.addEventListener("change",()=>{

    if(!servicioSeleccionado){

        alert("Seleccioná un servicio primero");
        fechaInput.value="";
        return;

    }

    generarHorarios(fechaInput.value);

});

btnLogout?.addEventListener("click",()=>{

    localStorage.removeItem("usuario");
    location.reload();

});

/* ===============================
INICIAR
=================================*/

verificarSesion();
