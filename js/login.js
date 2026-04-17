<<<<<<< HEAD
import { db } from "./firebase.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
=======
import { db, doc, getDoc } from "./firebase-web.js";
>>>>>>> main

const form = document.getElementById("loginForm");
const errorMsg = document.getElementById("errorMsg");

form.addEventListener("submit", async (e) => {

e.preventDefault();

const usernameInput = document
.getElementById("username")
.value
.trim()
.toLowerCase();

const dniInput = document
.getElementById("dni")
.value
.trim();

try{

const clientRef = doc(db,"clients",dniInput);
const clientSnap = await getDoc(clientRef);

if(!clientSnap.exists()){

<<<<<<< HEAD
errorMsg.textContent="Cliente no encontrado.";
=======
errorMsg.textContent="Paciente no encontrado.";
>>>>>>> main
return;

}

const clientData = clientSnap.data();

if(clientData.username !== usernameInput){

errorMsg.textContent="Usuario incorrecto.";
return;

}

if(!clientData.active){

errorMsg.textContent="Cuenta inactiva.";
return;

}

sessionStorage.setItem("userDni",dniInput);
sessionStorage.setItem("userRole","client");

if(clientData.aceptoPolitica){

<<<<<<< HEAD
window.location.href="servicios.html";
=======
window.location.href="servicios-pro.html";
>>>>>>> main

}else{

window.location.href="consentimiento.html";

}

}catch(error){

console.error(error);

errorMsg.textContent="Error interno. Intente nuevamente.";

}

});