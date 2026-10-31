// In-browser stand-in for the Firebase parts of core.js (keeps the real parseCommand).
export { parseCommand, QRCode } from './real-core.js';

const docs = new Map();
const listeners = new Set(); // { path, isDoc, cb }
window.__fake = { docs, failSignIn: false, offline: false };

const parent = (p) => p.split('/').slice(0, -1).join('/');
const copy = (v) => JSON.parse(JSON.stringify(v));
function docSnap(path) {
  const d = docs.get(path);
  return { id: path.split('/').pop(), exists: () => d !== undefined, data: () => (d === undefined ? undefined : copy(d)), ref: { path } };
}
function colSnap(path, filter) {
  const items = [];
  for (const p of docs.keys()) if (parent(p) === path && (!filter || (docs.get(p) || {})[filter.field] === filter.value)) items.push(docSnap(p));
  return { forEach: (fn) => items.forEach(fn), size: items.length, docs: items };
}
function notify(path) {
  setTimeout(() => listeners.forEach((l) => {
    if (l.isDoc ? l.path === path : l.path === parent(path)) l.cb(l.isDoc ? docSnap(l.path) : colSnap(l.path, l.filter));
  }), 5);
}
function write(path, data) {
  if (window.__fake.offline) throw Object.assign(new Error('offline'), { code: 'unavailable' });
  if (data === null) docs.delete(path); else docs.set(path, copy(data));
  notify(path);
}
window.__fake.write = write;

export const initializeApp = (cfg, name) => ({ cfg, name });
export const deleteApp = async () => {};
export const indexedDBLocalPersistence = {}; export const browserLocalPersistence = {}; export const inMemoryPersistence = {};
export const persistentLocalCache = () => ({}); export const persistentMultipleTabManager = () => ({}); export const memoryLocalCache = () => ({});
export const initializeFirestore = () => ({});
const authCbs = new Set();
export function initializeAuth() { return { currentUser: null }; }
export function onAuthStateChanged(auth, cb) { authCbs.add(cb); if (auth.currentUser) setTimeout(() => cb(auth.currentUser), 0); return () => authCbs.delete(cb); }
export async function signInAnonymously(auth) {
  if (window.__fake.failSignIn) throw Object.assign(new Error('network-request-failed'), { code: 'auth/network-request-failed' });
  auth.currentUser = { uid: 'phone-uid' };
  authCbs.forEach((cb) => cb(auth.currentUser));
  return { user: auth.currentUser };
}
export const doc = (_db, ...p) => ({ path: p.join('/'), id: p[p.length - 1], isDoc: true });
export const collection = (_db, ...p) => ({ path: p.join('/'), isDoc: false });
export async function getDoc(ref) { return docSnap(ref.path); }
export async function getDocs(ref) { return colSnap(ref.path); }
export async function setDoc(ref, data, opts) { write(ref.path, opts && opts.merge ? { ...(docs.get(ref.path) || {}), ...data } : data); }
export async function updateDoc(ref, data) { write(ref.path, { ...(docs.get(ref.path) || {}), ...data }); }
export async function deleteDoc(ref) { write(ref.path, null); }
export function onSnapshot(ref, opts, cb, err) {
  if (typeof opts === 'function') { err = cb; cb = opts; }
  const l = { path: ref.path, isDoc: ref.isDoc, filter: ref.filter, cb };
  listeners.add(l);
  setTimeout(() => cb(ref.isDoc ? docSnap(ref.path) : colSnap(ref.path, ref.filter)), 5);
  return () => listeners.delete(l);
}
export function writeBatch() {
  const ops = [];
  return {
    set: (ref, data) => ops.push([ref.path, data]),
    delete: (ref) => ops.push([ref.path, null]),
    commit: async () => {
      if (window.__fake.offline) return new Promise(() => {}); // queued forever while offline
      ops.forEach(([p, d]) => write(p, d));
    }
  };
}
export const Timestamp = { fromMillis: (ms) => ({ ms, toMillis: () => ms }) };
export const query = (r, filter) => ({ ...r, filter }); export const where = (field, _op, value) => ({ field, value }); export const waitForPendingWrites = async () => {};
// Tests can pre-load documents before the page's code runs.
if (window.__seedDocs) for (const [p, d] of Object.entries(window.__seedDocs)) docs.set(p, JSON.parse(JSON.stringify(d)));
