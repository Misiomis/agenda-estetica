// Fake de /js/firebase-web.js para probar admin.html en jsdom (store en memoria).
export const db = {};
export const storage = {};
export const auth = { currentUser: null };
export const calls = { authCallback: null, store: new Map(), setDocCalls: [], updateDocCalls: [] };
let seq = 0;
const k = (ref) => `${ref.path}/${ref.id}`;
export function collection(_db, path) { return { __type: 'collection', path }; }
export function query(c, ...clauses) { return { __type: 'query', path: c.path, clauses }; }
export function where(field, op, value) { return { __type: 'where', field, op, value }; }
export function orderBy() { return { __type: 'orderBy' }; }
export function limit() { return { __type: 'limit' }; }
export function doc(a, b, c) {
  if (c !== undefined) return { __type: 'doc', path: b, id: c };
  if (a && a.__type === 'collection') return { __type: 'doc', path: a.path, id: 'auto_' + (++seq) };
  return { __type: 'doc', path: b, id: 'auto_' + (++seq) };
}
export function serverTimestamp() { return { __type: 'ts', seconds: Math.floor(Date.now() / 1000), toMillis: () => Date.now() }; }
const snapDoc = (id, data, path) => ({ id, exists: () => !!data, data: () => data, ref: { __type: 'doc', path, id } });
export async function getDoc(ref) { return snapDoc(ref.id, calls.store.get(k(ref)) || null, ref.path); }
export const getDocFromServer = getDoc;
const pasa = (data, c) => {
  if (c.__type !== 'where') return true;
  const v = data?.[c.field];
  switch (c.op) {
    case '==': return v === c.value;
    case '>=': return v >= c.value;
    case '<=': return v <= c.value;
    case 'in': return c.value.includes(v);
    default: return true;
  }
};
export async function getDocs(q) {
  const docs = [];
  for (const [key, data] of calls.store.entries()) {
    const i = key.lastIndexOf('/');
    if (key.slice(0, i) !== q.path) continue;
    if ((q.clauses || []).every(c => pasa(data, c))) docs.push(snapDoc(key.slice(i + 1), data, q.path));
  }
  return { docs, empty: !docs.length, size: docs.length, forEach: (fn) => docs.forEach(fn) };
}
export async function setDoc(ref, data, opt) {
  calls.setDocCalls.push({ path: ref.path, id: ref.id, data, opt });
  calls.store.set(k(ref), opt?.merge ? { ...(calls.store.get(k(ref)) || {}), ...data } : data);
}
export async function updateDoc(ref, data) {
  calls.updateDocCalls.push({ path: ref.path, id: ref.id, data });
  calls.store.set(k(ref), { ...(calls.store.get(k(ref)) || {}), ...data });
}
export async function addDoc(c, data) { const ref = { path: c.path, id: 'auto_' + (++seq) }; calls.store.set(k(ref), data); return ref; }
export async function deleteDoc(ref) { calls.store.delete(k(ref)); }
export function onSnapshot(_q, cb) { setTimeout(() => cb({ docChanges: () => [] }), 0); return () => {}; }
export function onAuthStateChanged(_a, cb) { calls.authCallback = cb; return () => {}; }
export async function signInWithEmailAndPassword() {}
export async function signOut() {}
export async function runTransaction(_db, fn) { return fn({ get: getDoc, set: setDoc, update: updateDoc }); }
export function writeBatch() { const ops = []; return { set: (r, d, o) => ops.push(() => setDoc(r, d, o)), update: (r, d) => ops.push(() => updateDoc(r, d)), delete: (r) => ops.push(() => deleteDoc(r)), commit: async () => { for (const op of ops) await op(); } }; }
export function ref() { return {}; }
export async function uploadBytes() {}
export async function getDownloadURL() { return ''; }
