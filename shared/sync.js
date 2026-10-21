// Command Deck ⇄ Field Unit sync engine (shared by both apps).
//
// Each list (tasks, events, timers) lives locally first and mirrors into
// Firestore under decks/{deckId}/{kind}/{id}. Every item carries updatedAt;
// the newest write wins. Deletions become tombstones ({ deleted: true }) so the
// other device learns about them. Firestore's offline cache queues writes made
// without signal and sends them when the connection returns.

const STRIP = new Set(['updatedAt', 'by']);

function stable(item) {
  const out = {};
  Object.keys(item).sort().forEach((k) => { if (!STRIP.has(k)) out[k] = item[k]; });
  return JSON.stringify(out);
}

function clean(value) {
  // Firestore rejects undefined; JSON round-trip drops it.
  return JSON.parse(JSON.stringify(value));
}

export class DeckSync {
  /**
   * @param {object} fb   the exports of shared/core.js
   * @param {object} db   a Firestore instance
   * @param {string} deckId
   * @param {string} uid  this device's user id
   */
  constructor(fb, db, deckId, uid) {
    this.fb = fb;
    this.db = db;
    this.deckId = deckId;
    this.uid = uid;
    this.kinds = new Map(); // kind -> { base: Map(id -> stable json), get, apply, ready, unsub }
    this.metaUnsubs = [];
    this.lastWrite = Promise.resolve();
  }

  col(kind) {
    return this.fb.collection(this.db, 'decks', this.deckId, kind);
  }

  ref(kind, id) {
    return this.fb.doc(this.db, 'decks', this.deckId, kind, id);
  }

  /**
   * Starts mirroring a list.
   * get()      → the current local array
   * apply(arr) → replace the local array with a merged one (already includes local-only items)
   */
  track(kind, get, apply, onError) {
    const state = { base: new Map(), get, apply, ready: false, unsub: null };
    this.kinds.set(kind, state);
    state.unsub = this.fb.onSnapshot(this.col(kind), { includeMetadataChanges: false }, (snap) => {
      // Local edits not yet sent get stamped first, so a remote change that
      // arrives in the meantime can't silently overwrite them.
      if (state.ready) this.push(kind);
      const local = new Map(get().map((x) => [x.id, x]));
      let changed = false;
      snap.forEach((d) => {
        const remote = d.data();
        const id = d.id;
        const mine = local.get(id);
        const ru = remote.updatedAt || 0;
        const lu = mine ? (mine.updatedAt || 0) : -1;
        if (remote.deleted) {
          state.base.delete(id);
          if (mine && lu <= ru) { local.delete(id); changed = true; }
          return;
        }
        const { deleted: _d, ...item } = remote;
        if (!mine || lu < ru) {
          local.set(id, item);
          state.base.set(id, stable(item));
          changed = true;
        } else if (lu === ru) {
          state.base.set(id, stable(mine));
        }
      });
      if (changed) apply(Array.from(local.values()));
      if (!state.ready) {
        state.ready = true;
        // First contact: send anything that only exists on this device.
        this.push(kind);
      }
    }, (err) => { if (onError) onError(err); });
  }

  /** Writes local changes for one list. Returns a promise that resolves when the server has them. */
  push(kind, list) {
    const state = this.kinds.get(kind);
    if (!state || !state.ready) return Promise.resolve(false);
    const items = list || state.get();
    const now = Date.now();
    const seen = new Set();
    const writes = [];
    for (const item of items) {
      if (!item || !item.id) continue;
      seen.add(item.id);
      const s = stable(item);
      if (state.base.get(item.id) === s) continue;
      item.updatedAt = Math.max(now, (item.updatedAt || 0) + 1);
      item.by = this.uid;
      state.base.set(item.id, s);
      writes.push([item.id, clean(item)]);
    }
    for (const id of Array.from(state.base.keys())) {
      if (seen.has(id)) continue;
      state.base.delete(id);
      writes.push([id, { id, deleted: true, updatedAt: now, by: this.uid }]);
    }
    if (!writes.length) return Promise.resolve(false);
    const commits = [];
    for (let i = 0; i < writes.length; i += 400) {
      const batch = this.fb.writeBatch(this.db);
      writes.slice(i, i + 400).forEach(([id, data]) => batch.set(this.ref(kind, id), data));
      commits.push(batch.commit());
    }
    this.lastWrite = Promise.all(commits).then(() => true);
    return this.lastWrite;
  }

  /** Listens to a single metadata document (decks/{deckId}/meta/{name}). */
  watchMeta(name, cb) {
    const unsub = this.fb.onSnapshot(this.fb.doc(this.db, 'decks', this.deckId, 'meta', name),
      (snap) => cb(snap.exists() ? snap.data() : null), () => {});
    this.metaUnsubs.push(unsub);
    return unsub;
  }

  setMeta(name, data) {
    return this.fb.setDoc(this.fb.doc(this.db, 'decks', this.deckId, 'meta', name), clean(data));
  }

  /** Waits for the latest write, or gives up after `ms` (offline). */
  async acknowledged(ms = 4000) {
    let timer;
    const timeout = new Promise((r) => { timer = setTimeout(() => r('timeout'), ms); });
    const result = await Promise.race([this.lastWrite.then(() => 'ok', () => 'error'), timeout]);
    clearTimeout(timer);
    return result;
  }

  /** Removes tombstones older than `days` (run occasionally by Command). */
  async prune(kind, days = 30) {
    const cutoff = Date.now() - days * 864e5;
    const snap = await this.fb.getDocs(this.col(kind));
    const batch = this.fb.writeBatch(this.db);
    let n = 0;
    snap.forEach((d) => {
      const v = d.data();
      if (v.deleted && (v.updatedAt || 0) < cutoff && n < 400) { batch.delete(d.ref); n++; }
    });
    if (n) await batch.commit();
    return n;
  }

  stop() {
    this.kinds.forEach((s) => s.unsub && s.unsub());
    this.metaUnsubs.forEach((u) => u());
    this.kinds.clear();
    this.metaUnsubs = [];
  }
}

// ---- Pairing helpers --------------------------------------------------------

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makePairCode() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export function normalizePairCode(text) {
  return String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/[O]/g, '0').replace(/[I]/g, '1')
    .split('').filter((c) => CODE_ALPHABET.includes(c)).join('').slice(0, 6);
}

export function formatPairCode(code) {
  return code && code.length === 6 ? `${code.slice(0, 3)}-${code.slice(3)}` : code;
}

export function makeId(prefix = '') {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return prefix + Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 16);
}

/** Loads the Firebase web config that Firebase Hosting serves for every project. */
export async function fetchHostingConfig(baseUrl) {
  const url = String(baseUrl || '').trim().replace(/\/+$/, '');
  const res = await fetch(`${url}/__/firebase/init.json`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`No Firebase project found at ${url} (HTTP ${res.status})`);
  const cfg = await res.json();
  if (!cfg.apiKey || !cfg.projectId) throw new Error('That address did not return a Firebase configuration');
  return cfg;
}

/** Starts Firebase with offline persistence where available. */
export function startFirebase(fb, config, name) {
  const app = fb.initializeApp(config, name);
  let db;
  try {
    db = fb.initializeFirestore(app, { localCache: fb.persistentLocalCache({ tabManager: fb.persistentMultipleTabManager() }) });
  } catch (e) {
    db = fb.initializeFirestore(app, { localCache: fb.memoryLocalCache() });
  }
  let auth;
  try {
    auth = fb.initializeAuth(app, { persistence: [fb.indexedDBLocalPersistence, fb.browserLocalPersistence] });
  } catch (e) {
    auth = fb.initializeAuth(app, { persistence: fb.inMemoryPersistence });
  }
  return { app, db, auth };
}

export function signIn(fb, auth) {
  return new Promise((resolve, reject) => {
    const off = fb.onAuthStateChanged(auth, (user) => {
      if (user) { off(); resolve(user); }
    }, reject);
    if (!auth.currentUser) fb.signInAnonymously(auth).catch((e) => { off(); reject(e); });
  });
}
