// Fake de /js/firebase-web.js para las pruebas E2E de mimar-inteligente.html
// en jsdom, sin tocar Firestore real. Expone hooks para que el test dispare
// snapshots/errores/eventos de auth a mano.
export const db = {};
export const auth = { currentUser: null };

export const calls = {
  onSnapshotCalls: [], // { path, onNext, onError, unsubscribed }
  authCallback: null,
  signInCalls: [],
  signOutCalls: 0,
  getDocFromServerQueue: [],
  getDocQueue: [], // { snap } | { throwError } — FIFO, un ítem por llamada a getDoc()
  getDocsQueue: [], // { docs: [[id,data],...] } | { throwError } — FIFO, un ítem por llamada a getDocs()
  setDocCalls: [], // { path, id, data, options }
  updateDocCalls: [], // { path, id, data }
};

export function collection(_db, path) { return { __type: 'collection', path }; }
export function query(colRefOrDoc, ...clauses) { return { __type: 'query', path: colRefOrDoc.path, clauses }; }
export function where(field, op, value) { return { __type: 'where', field, op, value }; }
export function orderBy(field, direction) { return { __type: 'orderBy', field, direction }; }
export function limit(n) { return { __type: 'limit', n }; }
export function startAfter(cursorDoc) { return { __type: 'startAfter', cursorDoc }; }
export function doc(_db, path, id) { return { __type: 'doc', path, id }; }
export function serverTimestamp() { return { __type: 'serverTimestamp' }; }

export async function setDoc(ref, data, options) {
  calls.setDocCalls.push({ path: ref.path, id: ref.id, data, options });
}

export async function updateDoc(ref, data) {
  calls.updateDocCalls.push({ path: ref.path, id: ref.id, data });
}

export function onSnapshot(queryOrDoc, optionsOrNext, maybeNext, maybeError) {
  let onNext, onError;
  if (typeof optionsOrNext === 'function') { onNext = optionsOrNext; onError = maybeNext; }
  else { onNext = maybeNext; onError = maybeError; }
  const entry = { path: queryOrDoc.path, onNext, onError };
  calls.onSnapshotCalls.push(entry);
  return () => { entry.unsubscribed = true; };
}

// getDoc SÍ se usa ahora para resolver, desde el detalle, un registro que
// ya no está en el caché en memoria (ver abrirModal → resolverItemFueraDeCache).
// getDocFromServer sigue siendo lo único válido para "Preparar WhatsApp"
// (necesita forzar ida al servidor, no cualquier caché).
export async function getDoc(_ref) {
  const next = calls.getDocQueue.shift();
  if (!next) throw new Error('getDoc llamado sin respuesta encolada en el test');
  if (next.throwError) throw next.throwError;
  return next.snap;
}

export async function getDocFromServer(_ref) {
  const next = calls.getDocFromServerQueue.shift();
  if (!next) throw new Error('getDocFromServer llamado sin respuesta encolada en el test');
  if (next.throwError) throw next.throwError;
  return next.snap;
}

export async function getDocs(_query) {
  const next = calls.getDocsQueue.shift();
  if (!next) return fakeSnap([]); // default seguro: vacío, no rompe llamadas no anticipadas por el test
  if (next.throwError) throw next.throwError;
  return fakeSnap(next.docs || []);
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

export function fakeDocSnap(exists, id, data) {
  return { exists: () => exists, id, data: () => data };
}
