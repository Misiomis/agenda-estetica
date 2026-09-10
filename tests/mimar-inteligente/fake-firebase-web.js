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
};

export function collection(_db, path) { return { __type: 'collection', path }; }
export function query(colRef, ...clauses) { return { __type: 'query', path: colRef.path, clauses }; }
export function where(field, op, value) { return { __type: 'where', field, op, value }; }
export function doc(_db, path, id) { return { __type: 'doc', path, id }; }

export function onSnapshot(queryOrDoc, optionsOrNext, maybeNext, maybeError) {
  let onNext, onError;
  if (typeof optionsOrNext === 'function') { onNext = optionsOrNext; onError = maybeNext; }
  else { onNext = maybeNext; onError = maybeError; }
  const entry = { path: queryOrDoc.path, onNext, onError };
  calls.onSnapshotCalls.push(entry);
  return () => { entry.unsubscribed = true; };
}

export async function getDoc(_ref) {
  throw new Error('getDoc no debería usarse en este módulo — usa getDocFromServer');
}

export async function getDocFromServer(_ref) {
  const next = calls.getDocFromServerQueue.shift();
  if (!next) throw new Error('getDocFromServer llamado sin respuesta encolada en el test');
  if (next.throwError) throw next.throwError;
  return next.snap;
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
  return {
    metadata: { fromCache: !!docs.__fromCache },
    forEach(fn) { (docs || []).forEach(([id, data]) => fn({ id, data: () => data })); },
  };
}

export function fakeDocSnap(exists, id, data) {
  return { exists: () => exists, id, data: () => data };
}
