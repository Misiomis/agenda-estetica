// Fake de js/firebase-web.js para las pruebas E2E de admin-depi.html en
// jsdom, sin tocar Firestore real. admin-depi.html no usa onSnapshot (todo
// es getDocs/getDoc/getDocFromServer puntuales), así que este fake es más
// simple que el de doctora: un store en memoria + una cola de errores
// forzados para poder probar "sin conexión" / "permission-denied" sin un
// emulador real.
export const db = {};
export const auth = { currentUser: null };

export const calls = {
  authCallback: null,
  signInCalls: [],
  signInShouldFail: null,
  signOutCalls: 0,
  updateDocCalls: [],
  deleteDocCalls: [],
  setDocCalls: [],
  store: new Map(), // "coleccion/id" -> data
  // Colas de error de un solo uso: { fn: 'getDocFromServer'|'updateDoc'|..., error } — la
  // próxima llamada a esa función tira ese error y se saca de la cola.
  errorQueue: [],
  // Cola de respuestas "stale" de un solo uso para getDocFromServer: en vez
  // de leer el store real, devuelve estos datos — sirve para simular que el
  // servidor todavía no reflejó una escritura reciente (ej. quedó encolada
  // offline) sin necesidad de un emulador real.
  staleReadQueue: [],
};

let autoIdSeq = 0;
const clave = (ref) => `${ref.path}/${ref.id}`;

function tomarError(fnName) {
  const idx = calls.errorQueue.findIndex((e) => e.fn === fnName);
  if (idx === -1) return null;
  const [entry] = calls.errorQueue.splice(idx, 1);
  return entry.error;
}

export function collection(_db, path) { return { __type: "collection", path }; }
export function query(colRef, ...clauses) { return { __type: "query", path: colRef.path, clauses }; }
export function where(field, op, value) { return { __type: "where", field, op, value }; }
export function doc(a, b, c) {
  if (c !== undefined) return { __type: "doc", path: b, id: c };
  if (b === undefined && a && typeof a === "object" && a.__type === "collection") {
    return { __type: "doc", path: a.path, id: `auto_${++autoIdSeq}` };
  }
  return { __type: "doc", path: b, id: `auto_${++autoIdSeq}` };
}
export function serverTimestamp() { return { __type: "serverTimestamp", toMillis: () => Date.now() }; }

function fakeDocSnap(exists, id, data) {
  return { exists: () => exists, id, data: () => data };
}

export async function setDoc(ref, data, options) {
  calls.setDocCalls.push({ path: ref.path, id: ref.id, data, options });
  const k = clave(ref);
  const previo = calls.store.get(k) || {};
  calls.store.set(k, options?.merge ? { ...previo, ...data } : data);
}

export async function addDoc(colRef, data) {
  const ref = { __type: "doc", path: colRef.path, id: `auto_${++autoIdSeq}` };
  calls.store.set(clave(ref), data);
  return ref;
}

export async function updateDoc(ref, data) {
  const err = tomarError("updateDoc");
  if (err) throw err;
  const k = clave(ref);
  if (!calls.store.has(k)) { const e = new Error("No document to update: " + k); e.code = "not-found"; throw e; }
  calls.updateDocCalls.push({ path: ref.path, id: ref.id, data });
  const previo = calls.store.get(k) || {};
  calls.store.set(k, { ...previo, ...data });
}

export async function deleteDoc(ref) {
  const err = tomarError("deleteDoc");
  if (err) throw err;
  calls.deleteDocCalls.push({ path: ref.path, id: ref.id });
  calls.store.delete(clave(ref));
}

export async function getDoc(ref) {
  const err = tomarError("getDoc");
  if (err) throw err;
  const data = calls.store.get(clave(ref));
  return fakeDocSnap(!!data, ref.id, data || null);
}

export async function getDocFromServer(ref) {
  const err = tomarError("getDocFromServer");
  if (err) throw err;
  if (calls.staleReadQueue.length) {
    const data = calls.staleReadQueue.shift();
    return fakeDocSnap(!!data, ref.id, data);
  }
  const data = calls.store.get(clave(ref));
  return fakeDocSnap(!!data, ref.id, data || null);
}

export async function getDocs(q) {
  const err = tomarError("getDocs");
  if (err) throw err;
  const path = q.path;
  const clauses = q.clauses || [];
  const docs = [];
  for (const [k, data] of calls.store.entries()) {
    const [docPath, id] = [k.slice(0, k.lastIndexOf("/")), k.slice(k.lastIndexOf("/") + 1)];
    if (docPath !== path) continue;
    const pasaFiltros = clauses.every((c) => {
      if (c.__type !== "where") return true;
      return data?.[c.field] === c.value;
    });
    if (pasaFiltros) docs.push({ id, data: () => data, ref: { __type: "doc", path, id } });
  }
  return {
    forEach(fn) { docs.forEach(fn); },
    docs,
    size: docs.length,
  };
}

export function onAuthStateChanged(_auth, cb) {
  calls.authCallback = cb;
  return () => {};
}

export async function signInWithEmailAndPassword(_auth, email, password) {
  calls.signInCalls.push({ email, password });
  if (calls.signInShouldFail) { const e = calls.signInShouldFail; calls.signInShouldFail = null; throw e; }
}

export async function signOut(_auth) {
  calls.signOutCalls++;
}
