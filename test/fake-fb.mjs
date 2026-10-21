// In-memory stand-in for shared/core.js (Firestore + Auth), shared by every importer in one process.
const g = globalThis.__fakeFb || (globalThis.__fakeFb = { docs: new Map(), listeners: new Set(), uidSeq: 0, writes: [] });
const copy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const parent = (p) => p.split('/').slice(0, -1).join('/');
const docSnap = (path) => ({ id: path.split('/').pop(), ref: { path }, exists: () => g.docs.has(path), data: () => copy(g.docs.get(path)), metadata: { fromCache: false } });
const colSnap = (path, filter) => {
  const items = [];
  for (const [p, data] of g.docs) {
    if (parent(p) !== path) continue;
    if (filter && data[filter.field] !== filter.value) continue;
    items.push({ id: p.split('/').pop(), data: () => copy(data), ref: { path: p } });
  }
  return { forEach: (fn) => items.forEach(fn), docs: items, size: items.length, metadata: { fromCache: false } };
};
function notify(path) {
  setTimeout(() => g.listeners.forEach((l) => {
    if (l.isDoc ? l.path === path : l.path === parent(path)) l.cb(l.isDoc ? docSnap(l.path) : colSnap(l.path, l.filter));
  }), 0);
}
function write(path, data, merge, who) {
  g.writes.push({ path, who });
  if (data === null) g.docs.delete(path);
  else g.docs.set(path, merge ? { ...(g.docs.get(path) || {}), ...copy(data) } : copy(data));
  notify(path);
}
const who = (ref) => ref.db && ref.db.who;
export const collection = (db, ...p) => ({ path: p.join('/'), isDoc: false, db });
export const doc = (db, ...p) => ({ path: p.join('/'), id: p[p.length - 1], isDoc: true, db });
export const query = (ref, filter) => ({ ...ref, filter });
export const where = (field, _op, value) => ({ field, value });
export function onSnapshot(ref, opts, cb, err) {
  if (typeof opts === 'function') { err = cb; cb = opts; }
  const l = { path: ref.path, isDoc: ref.isDoc, filter: ref.filter, cb };
  g.listeners.add(l);
  setTimeout(() => g.listeners.has(l) && cb(ref.isDoc ? docSnap(ref.path) : colSnap(ref.path, ref.filter)), 0);
  return () => g.listeners.delete(l);
}
export const setDoc = async (ref, data, opts) => write(ref.path, data, opts && opts.merge, who(ref));
export const updateDoc = async (ref, data) => { if (!g.docs.has(ref.path)) throw new Error('not-found'); write(ref.path, data, true, who(ref)); };
export const deleteDoc = async (ref) => write(ref.path, null, false, who(ref));
export const getDoc = async (ref) => docSnap(ref.path);
export const getDocs = async (ref) => colSnap(ref.path, ref.filter);
export function writeBatch(db) {
  const ops = [];
  return { set: (r, d) => ops.push([r.path, d]), delete: (r) => ops.push([r.path, null]), commit: async () => ops.forEach(([p, d]) => write(p, d, false, db && db.who)) };
}
export const Timestamp = { fromMillis: (ms) => ({ ms, toMillis: () => ms }) };
export const initializeApp = (config, name) => ({ config, name, id: ++g.uidSeq });
export const initializeFirestore = (app) => ({ who: `uid-${app.id}` });
export const persistentLocalCache = () => ({});
export const persistentMultipleTabManager = () => ({});
export const memoryLocalCache = () => ({});
export const initializeAuth = (app) => ({ currentUser: { uid: `uid-${app.id}` } });
export const indexedDBLocalPersistence = {}; export const browserLocalPersistence = {}; export const inMemoryPersistence = {};
export function onAuthStateChanged(auth, cb) { setTimeout(() => cb(auth.currentUser), 0); return () => {}; }
export const signInAnonymously = async (auth) => auth.currentUser;
