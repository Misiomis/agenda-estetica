// Fake de js/firebase-web.js para las pruebas E2E de doctora/index.html en
// jsdom, sin tocar Firestore real. A diferencia del fake de
// mimar-inteligente, este incluye un runTransaction real (en memoria) para
// poder probar de verdad el anti-doble-reserva de horario, no solo simularlo.
export const db = {};
export const auth = { currentUser: null };

export const calls = {
  onSnapshotCalls: [], // { path, onNext, onError, unsubscribed }
  authCallback: null,
  signInCalls: [],
  signOutCalls: 0,
  getDocFromServerQueue: [], // { snap } | { throwError } — para "Abrir WhatsApp" (verificación forzada al servidor)
  getDocQueue: [], // { snap } | { throwError } — si está vacío, getDoc cae al store en memoria
  setDocCalls: [],
  updateDocCalls: [],
  store: new Map(), // "coleccion/id" -> data — simula el servidor para runTransaction/getDoc
};

let autoIdSeq = 0;

export function collection(_db, path) { return { __type: "collection", path }; }
export function query(colRefOrDoc, ...clauses) { return { __type: "query", path: colRefOrDoc.path, clauses }; }
export function where(field, op, value) { return { __type: "where", field, op, value }; }
export function orderBy(field, direction) { return { __type: "orderBy", field, direction }; }
export function limit(n) { return { __type: "limit", n }; }
export function doc(a, b, c) {
  // doc(db, "coleccion", "id")       → 3 args
  if (c !== undefined) return { __type: "doc", path: b, id: c };
  // doc(collection(db,"coleccion"))  → 1 arg (la colección), autogenera id
  if (b === undefined && a && typeof a === "object" && a.__type === "collection") {
    return { __type: "doc", path: a.path, id: `auto_${++autoIdSeq}` };
  }
  // doc(db, "coleccion")             → sin id explícito, autogenera
  return { __type: "doc", path: b, id: `auto_${++autoIdSeq}` };
}
export function serverTimestamp() { return { __type: "serverTimestamp", toMillis: () => Date.now() }; }

function clave(ref) { return `${ref.path}/${ref.id}`; }

export function fakeDocSnap(exists, id, data) {
  return { exists: () => exists, id, data: () => data, updateTime: { toMillis: () => Date.now() } };
}

export async function setDoc(ref, data, options) {
  calls.setDocCalls.push({ path: ref.path, id: ref.id, data, options });
  const k = clave(ref);
  const previo = calls.store.get(k) || {};
  calls.store.set(k, options?.merge ? { ...previo, ...data } : data);
}

export async function updateDoc(ref, data) {
  calls.updateDocCalls.push({ path: ref.path, id: ref.id, data });
  const k = clave(ref);
  const previo = calls.store.get(k) || {};
  calls.store.set(k, { ...previo, ...data });
}

export async function getDoc(ref) {
  const next = calls.getDocQueue.shift();
  if (next) {
    if (next.throwError) throw next.throwError;
    return next.snap;
  }
  const data = calls.store.get(clave(ref));
  return fakeDocSnap(!!data, ref.id, data || null);
}

export async function getDocFromServer(ref) {
  const next = calls.getDocFromServerQueue.shift();
  if (!next) throw new Error("getDocFromServer llamado sin respuesta encolada en el test");
  if (next.throwError) throw next.throwError;
  return next.snap;
}

// Antes era un stub que siempre devolvía vacío (nada en doctora.js usaba
// getDocs todavía). Ahora sí filtra de verdad el store en memoria por
// colección + cláusulas where("campo","==",valor) — lo mínimo que necesitan
// los movimientos de dinero (turnoId / fechaMovimiento) y el cierre.
export async function getDocs(q) {
  const path = q.path;
  const clauses = (q.clauses || []).filter((c) => c.__type === "where");
  const docs = [];
  for (const [k, data] of calls.store.entries()) {
    const idx = k.lastIndexOf("/");
    const docPath = k.slice(0, idx);
    const id = k.slice(idx + 1);
    if (docPath !== path) continue;
    const pasa = clauses.every((c) => {
      if (c.op && c.op !== "==") return true; // solo se soporta "==" por ahora, suficiente para estas pruebas
      return data?.[c.field] === c.value;
    });
    if (pasa) docs.push({ id, data: () => data, ref: { __type: "doc", path, id } });
  }
  return { forEach(fn) { docs.forEach(fn); }, docs, size: docs.length };
}

export async function runTransaction(_db, updateFunction) {
  // Transacción real en memoria: los tx.get() leen del store, los
  // tx.set()/tx.update() se aplican recién si el callback no tira error —
  // así una prueba puede confirmar que una reserva rechazada NO deja
  // escrituras parciales, igual que una transacción real de Firestore.
  const pendientes = [];
  const tx = {
    async get(ref) {
      const data = calls.store.get(clave(ref));
      return fakeDocSnap(!!data, ref.id, data || null);
    },
    set(ref, data, options) { pendientes.push({ ref, data, options, tipo: "set" }); },
    update(ref, data) { pendientes.push({ ref, data, tipo: "update" }); },
  };
  const resultado = await updateFunction(tx);
  for (const p of pendientes) {
    const k = clave(p.ref);
    const previo = calls.store.get(k) || {};
    if (p.tipo === "set") calls.store.set(k, p.options?.merge ? { ...previo, ...p.data } : p.data);
    else calls.store.set(k, { ...previo, ...p.data });
  }
  return resultado;
}

export function onSnapshot(queryOrDoc, optionsOrNext, maybeNext, maybeError) {
  let onNext, onError;
  if (typeof optionsOrNext === "function") { onNext = optionsOrNext; onError = maybeNext; }
  else { onNext = maybeNext; onError = maybeError; }
  // "doc" vs "query"/"collection" comparten a veces el mismo path (p.ej.
  // fechasHabilitadasDoctora se escucha por documento puntual Y por query de
  // historial) — se distinguen por __type para que emitirDoc/emitirSnapshot
  // no se crucen entre sí en las pruebas.
  const entry = { path: queryOrDoc.path, kind: queryOrDoc.__type, docId: queryOrDoc.id, clauses: queryOrDoc.clauses || [], onNext, onError };
  calls.onSnapshotCalls.push(entry);
  return () => { entry.unsubscribed = true; };
}

export function onAuthStateChanged(_auth, cb) {
  calls.authCallback = cb;
  return () => {};
}

export async function signInWithEmailAndPassword(_auth, email, password) {
  calls.signInCalls.push({ email, password });
  if (calls.signInShouldFail) throw calls.signInShouldFail;
}

export async function signOut(_auth) {
  calls.signOutCalls++;
  auth.currentUser = null;
}

export function fakeSnap(docs) {
  const wrapped = (docs || []).map(([id, data]) => ({ id, data: () => data }));
  return {
    metadata: { fromCache: !!docs.__fromCache },
    forEach(fn) { wrapped.forEach(fn); },
    docs: wrapped,
    size: wrapped.length,
  };
}
