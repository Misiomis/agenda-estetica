<<<<<<< HEAD
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// NOTA DE SEGURIDAD: Esta apiKey está restringida por dominio en Google Cloud Console.
// Solo funciona desde dominios autorizados (como localhost).
const firebaseConfig = {
  apiKey: "AIzaSyBc5435tsDnJ_yJqO1ppwSjxSpCIhpjgew",
  authDomain: "estetica-8d067.firebaseapp.com",
  projectId: "estetica-8d067",
  storageBucket: "estetica-8d067.firebasestorage.app",
  messagingSenderId: "501220214938",
  appId: "1:501220214938:web:af6e262c23d9a7ea853723",
  measurementId: "G-J4NH9ENVYL"
};

// Inicializar Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export { db };
=======
export { app, auth, db, firebaseConfig } from "./firebase-web.js";
>>>>>>> main
