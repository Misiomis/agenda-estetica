import { db } from "./firebase.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

errorMsg.textContent="Cliente no encontrado.";
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

window.location.href="servicios.html";

}else{

window.location.href="consentimiento.html";

}

}catch(error){

console.error(error);

errorMsg.textContent="Error interno. Intente nuevamente.";

}

});