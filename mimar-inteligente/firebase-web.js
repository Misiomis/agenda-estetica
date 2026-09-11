// Copia local de js/firebase-web.js para builds de Capacitor/Android — mismo
// patrón que reloj/firebase-web.js. El webDir de la app Android es esta
// carpeta, así que no puede alcanzar ../js/. La versión web servida en
// /mimar-inteligente/ también usa esta copia (misma carpeta para ambas),
// exactamente como ya hace reloj/.
import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  doc,
  updateDoc,
  setDoc,
  getDoc,
  getDocFromServer,
  addDoc,
  deleteDoc,
  serverTimestamp,
  onSnapshot,
  limit,
  startAfter,
  writeBatch,
  runTransaction,
  increment,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBc5435tsDnJ_yJqO1ppwSjxSpCIhpjgew",
  authDomain: "estetica-8d067.firebaseapp.com",
  projectId: "estetica-8d067",
  storageBucket: "estetica-8d067.firebasestorage.app",
  messagingSenderId: "501220214938",
  appId: "1:501220214938:web:af6e262c23d9a7ea853723",
  measurementId: "G-J4NH9ENVYL",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

export {
  addDoc, app, auth, collection, db, deleteDoc, doc, firebaseConfig,
  getApp, getAuth, getDoc, getDocFromServer, getDocs, getFirestore,
  increment, initializeApp, limit, onAuthStateChanged, orderBy,
  onSnapshot, query, serverTimestamp, setDoc, signInWithEmailAndPassword,
  signOut, startAfter, updateDoc, where, writeBatch, runTransaction,
};
