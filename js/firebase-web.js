import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
  query,
  where,
  doc,
  updateDoc,
  setDoc,
  getDoc,
  addDoc,
  deleteDoc,
  serverTimestamp,
  onSnapshot,
  limit,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

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
const storage = getStorage(app);

export {
  addDoc,
  app,
  auth,
  collection,
  db,
  deleteDoc,
  doc,
  firebaseConfig,
  getApp,
  getAuth,
  getDoc,
  getDocs,
  getDownloadURL,
  getFirestore,
  getStorage,
  initializeApp,
  limit,
  onAuthStateChanged,
  onSnapshot,
  query,
  ref,
  serverTimestamp,
  setDoc,
  signInWithEmailAndPassword,
  signOut,
  storage,
  updateDoc,
  uploadBytes,
  where,
  writeBatch,
};