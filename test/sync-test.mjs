// Two devices (Command + Field Unit) syncing through an in-memory Firestore stand-in.
import assert from 'assert';
import { webcrypto } from 'crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const { DeckSync, makePairCode, normalizePairCode, formatPairCode } = await import('../shared/sync.js');

function fakeFirestore() {
  const docs = new Map(); // path -> data
  const listeners = new Map(); // colPath -> Set(cb)
  const snap = (colPath) => {
    const items = [];
    for (const [p, data] of docs) {
      const parts = p.split('/');
      if (parts.slice(0, -1).join('/') === colPath) items.push({ id: parts[parts.length - 1], data: () => JSON.parse(JSON.stringify(data)), ref: { path: p } });
    }
    return { forEach: (fn) => items.forEach(fn) };
  };
  const notify = (colPath) => setTimeout(() => (listeners.get(colPath) || []).forEach((cb) => cb(snap(colPath))), 0);
  const fb = {
    collection: (_db, ...p) => ({ path: p.join('/') }),
    doc: (_db, ...p) => ({ path: p.join('/'), id: p[p.length - 1] }),
    onSnapshot: (ref, opts, cb) => {
      if (typeof opts === 'function') cb = opts;
      if (!listeners.has(ref.path)) listeners.set(ref.path, new Set());
      listeners.get(ref.path).add(cb);
      setTimeout(() => cb(snap(ref.path)), 0);
      return () => listeners.get(ref.path).delete(cb);
    },
    writeBatch: () => {
      const ops = [];
      return {
        set: (ref, data) => ops.push(['set', ref, data]),
        delete: (ref) => ops.push(['del', ref]),
        commit: async () => {
          const cols = new Set();
          for (const [op, ref, data] of ops) {
            if (op === 'set') docs.set(ref.path, JSON.parse(JSON.stringify(data))); else docs.delete(ref.path);
            cols.add(ref.path.split('/').slice(0, -1).join('/'));
          }
          cols.forEach(notify);
        }
      };
    },
    setDoc: async (ref, data) => { docs.set(ref.path, data); notify(ref.path.split('/').slice(0, -1).join('/')); },
    getDocs: async (ref) => { const s = snap(ref.path); const out = []; s.forEach((d) => out.push(d)); return { forEach: (fn) => out.forEach(fn) }; }
  };
  return { fb, docs };
}

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const { fb, docs } = fakeFirestore();

function device(uid, initial) {
  const dev = { tasks: initial, applied: 0 };
  dev.sync = new DeckSync(fb, {}, 'deck_1', uid);
  dev.sync.track('tasks', () => dev.tasks, (list) => { dev.tasks = list; dev.applied++; });
  return dev;
}

let pass = 0;
const ok = (name) => { pass++; console.log('  ok ', name); };
console.log('Sync engine');

const command = device('desk', [{ id: 'a', title: 'Pay electric bill', done: false }, { id: 'b', title: 'Book flights', done: false }]);
await tick();
assert.strictEqual([...docs.keys()].filter((k) => k.startsWith('decks/deck_1/tasks/')).length, 2);
ok('tasks that existed before linking are sent up on first contact');

const phone = device('phone', []);
await tick();
assert.deepStrictEqual(phone.tasks.map((t) => t.id).sort(), ['a', 'b']);
ok('a newly paired phone receives everything');

phone.tasks = phone.tasks.map((t) => (t.id === 'a' ? { ...t, title: 'Pay the electric bill' } : t));
await phone.sync.push('tasks');
await tick();
assert.strictEqual(command.tasks.find((t) => t.id === 'a').title, 'Pay the electric bill');
ok('an edit on the phone reaches Command');

command.tasks = command.tasks.filter((t) => t.id !== 'b');
await command.sync.push('tasks');
await tick();
assert.deepStrictEqual(phone.tasks.map((t) => t.id), ['a']);
assert.strictEqual(docs.get('decks/deck_1/tasks/b').deleted, true);
ok('a deletion on Command removes it from the phone (tombstone)');

const appliedBefore = command.applied;
await command.sync.push('tasks');
await tick();
assert.strictEqual(command.applied, appliedBefore);
ok('pushing with no changes writes nothing and echoes nothing');

// Conflict: both edit the same task; the later write wins everywhere.
command.tasks = command.tasks.map((t) => ({ ...t, title: 'Command version' }));
phone.tasks = phone.tasks.map((t) => ({ ...t, title: 'Phone version' }));
await command.sync.push('tasks');
await tick(5);
await new Promise((r) => setTimeout(r, 3));
await phone.sync.push('tasks');
await tick();
assert.strictEqual(command.tasks[0].title, 'Phone version');
assert.strictEqual(phone.tasks[0].title, 'Phone version');
ok('simultaneous edits settle on the newest one on both devices');

phone.tasks = [...phone.tasks, { id: 'c', title: 'Call Sam' }];
await phone.sync.push('tasks');
await tick();
assert.ok(command.tasks.some((t) => t.id === 'c'));
ok('a task added on the phone appears on Command');

const code = makePairCode();
assert.strictEqual(code.length, 6);
assert.strictEqual(normalizePairCode(formatPairCode(code).toLowerCase()), code);
assert.strictEqual(normalizePairCode('k7q-4zp'), 'K7Q4ZP');
ok('pairing codes: 6 characters, typed loosely still match');

command.sync.stop();
phone.sync.stop();
console.log(`\n${pass} sync checks passed`);
