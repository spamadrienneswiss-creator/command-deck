// Project Manifest relay: owner app ⇄ guest link, through an in-memory Firestore stand-in.
import assert from 'assert';
import { webcrypto } from 'crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const { ManifestRelay, makeToken, mirrorOf, manifestUrl } = await import('../shared/manifest.js');

function fakeFirestore() {
  const docs = new Map();
  const listeners = new Set(); // { path, filter, cb }
  const parent = (p) => p.split('/').slice(0, -1).join('/');
  const copy = (v) => JSON.parse(JSON.stringify(v));
  const colSnap = (path, filter) => {
    const items = [];
    for (const [p, data] of docs) {
      if (parent(p) !== path) continue;
      if (filter && data[filter.field] !== filter.value) continue;
      items.push({ id: p.split('/').pop(), data: () => copy(data), ref: { path: p } });
    }
    return { forEach: (fn) => items.forEach(fn), docs: items, size: items.length };
  };
  const docSnap = (path) => ({ id: path.split('/').pop(), exists: () => docs.has(path), data: () => (docs.has(path) ? copy(docs.get(path)) : undefined) });
  const notify = (path) => setTimeout(() => listeners.forEach((l) => {
    if (l.isDoc ? l.path === path : l.path === parent(path)) l.cb(l.isDoc ? docSnap(l.path) : colSnap(l.path, l.filter));
  }), 0);
  const write = (path, data, merge) => {
    if (data === null) docs.delete(path);
    else docs.set(path, merge ? { ...(docs.get(path) || {}), ...copy(data) } : copy(data));
    notify(path);
  };
  const fb = {
    collection: (_db, ...p) => ({ path: p.join('/'), isDoc: false }),
    doc: (_db, ...p) => ({ path: p.join('/'), id: p[p.length - 1], isDoc: true }),
    query: (ref, filter) => ({ ...ref, filter }),
    where: (field, _op, value) => ({ field, value }),
    onSnapshot: (ref, opts, cb) => {
      if (typeof opts === 'function') cb = opts;
      const l = { path: ref.path, isDoc: ref.isDoc, filter: ref.filter, cb };
      listeners.add(l);
      setTimeout(() => cb(ref.isDoc ? docSnap(ref.path) : colSnap(ref.path, ref.filter)), 0);
      return () => listeners.delete(l);
    },
    setDoc: async (ref, data, opts) => write(ref.path, data, opts && opts.merge),
    updateDoc: async (ref, data) => write(ref.path, data, true),
    getDocs: async (ref) => colSnap(ref.path),
    writeBatch: () => {
      const ops = [];
      return { set: (r, d) => ops.push([r.path, d]), delete: (r) => ops.push([r.path, null]), commit: async () => ops.forEach(([p, d]) => write(p, d)) };
    },
    Timestamp: { fromMillis: (ms) => ({ ms, toMillis: () => ms }) }
  };
  return { fb, docs };
}

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
async function check(name, fn) {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
}

console.log('Project Manifest');
const { fb, docs } = fakeFirestore();
const app = {
  projects: [{ id: 'p1', name: 'Garage cleanout', goal: 'Park inside', status: 'active', color: '#F2A65A', log: [] }, { id: 'p2', name: 'Secret', status: 'active' }],
  tasks: [
    { id: 't1', title: 'Sweep floor', projectId: 'p1', done: false, notes: 'private owner note', reminder: 15, assignee: 'Sam' },
    { id: 't2', title: 'Label bins', projectId: 'p1', done: false },
    { id: 't9', title: 'Private task', projectId: 'p2', done: false }
  ],
  activity: []
};
const hooks = {
  getProjects: () => app.projects,
  getTasks: () => app.tasks,
  guestChanges: (changes) => {
    for (const c of changes) {
      const t = app.tasks.find((x) => x.id === c.taskId);
      if (c.type === 'add') app.tasks.push({ ...c.task, id: c.taskId });
      else if (c.type === 'update') Object.assign(t, c.task);
      else if (c.type === 'complete') Object.assign(t, { done: true, doneAt: new Date().toISOString(), doneBy: c.by });
      else if (c.type === 'reopen') Object.assign(t, { done: false, doneAt: null, doneBy: null });
      else if (c.type === 'delete') app.tasks = app.tasks.filter((x) => x.id !== c.taskId);
    }
    relay.schedule(10);
  },
  addLog: (pid, entries) => { const p = app.projects.find((x) => x.id === pid); p.log = [...(p.log || []), ...entries]; relay.schedule(10); },
  onActivity: (ev) => app.activity.push(...ev),
  getLook: () => ({ theme: 'freighter', font: 'auto', ink: 'theme' }),
  operatorName: () => 'Sam'
};
const relay = new ManifestRelay(fb, {}, 'deck_1', 'desk-uid', hooks);
relay.start();
await tick();

let token;
let helperToken;
const guestWrite = async (tok, id, patch) => {
  const path = `manifests/${tok}/tasks/${id}`;
  await fb.setDoc({ path }, { ...(docs.get(path) || {}), ...patch, pending: true, gBy: patch.gBy || 'Jordan', gAt: Date.now() + Math.random() });
};

await check('tokens are long, unguessable and unique', () => {
  const a = makeToken(); const b = makeToken();
  assert(a.length >= 20 && a !== b && /^[A-Za-z0-9]+$/.test(a));
  assert.strictEqual(manifestUrl('https://x.web.app/', 'abc'), 'https://x.web.app/m#abc');
});

await check('sharing copies only that project, without private fields', async () => {
  token = await relay.share({ projectId: 'p1', guest: 'Jordan', level: 'check', ends: 'done' });
  await tick(60);
  const m = docs.get(`manifests/${token}`);
  assert.strictEqual(m.deckId, 'deck_1');
  assert.strictEqual(m.project.name, 'Garage cleanout');
  assert.strictEqual(m.look.theme, 'freighter');
  const t1 = docs.get(`manifests/${token}/tasks/t1`);
  assert(t1 && t1.title === 'Sweep floor');
  assert(!('notes' in t1) && !('reminder' in t1) && !('assignee' in t1), 'private fields stay home');
  assert(!docs.has(`manifests/${token}/tasks/t9`), 'other projects never leave');
});

await check('a guest check-off reaches the real task, then the mark clears', async () => {
  await guestWrite(token, 't1', { done: true, doneAt: new Date().toISOString(), doneBy: 'Jordan' });
  await tick(600);
  const t = app.tasks.find((x) => x.id === 't1');
  assert(t.done && t.doneBy === 'Jordan');
  assert.strictEqual(docs.get(`manifests/${token}/tasks/t1`).pending, false);
  assert(app.activity.some((a) => /Jordan completed Sweep floor/.test(a.text)));
});

await check('check-off-only access cannot rename tasks (reverted on the link)', async () => {
  await guestWrite(token, 't2', { title: 'HACKED' });
  await tick(600);
  assert.strictEqual(app.tasks.find((x) => x.id === 't2').title, 'Label bins');
  assert.strictEqual(docs.get(`manifests/${token}/tasks/t2`).title, 'Label bins');
});

await check('owner changes flow out to the link', async () => {
  app.tasks.find((x) => x.id === 't2').title = 'Label all bins';
  app.tasks.push({ id: 't3', title: 'Haul boxes', projectId: 'p1', done: false });
  relay.schedule(10);
  await tick(120);
  assert.strictEqual(docs.get(`manifests/${token}/tasks/t2`).title, 'Label all bins');
  assert(docs.has(`manifests/${token}/tasks/t3`));
  app.tasks = app.tasks.filter((x) => x.id !== 't3');
  relay.schedule(10);
  await tick(120);
  assert(!docs.has(`manifests/${token}/tasks/t3`), 'removed tasks disappear from the link');
});

await check('project administrator: notes, rename, add and delete all come home', async () => {
  helperToken = await relay.share({ projectId: 'p1', guest: 'Maya', level: 'helper', ends: 'never' });
  await tick(80);
  await guestWrite(helperToken, 't2', { comments: [{ id: 'c1', by: 'Maya', text: 'Bins are in the truck', at: Date.now() }], title: 'Label bins (blue)', gBy: 'Maya' });
  await fb.setDoc({ path: `manifests/${helperToken}/tasks/tn` }, { id: 'tn', title: 'Pick up extra bins', due: null, dueHasTime: false, done: false, doneAt: null, doneBy: null, comments: [], addedBy: 'Maya', pending: true, gBy: 'Maya', gAt: Date.now() });
  await tick(600);
  const t2 = app.tasks.find((x) => x.id === 't2');
  assert.strictEqual(t2.title, 'Label bins (blue)');
  assert.strictEqual(t2.comments[0].text, 'Bins are in the truck');
  const tn = app.tasks.find((x) => x.id === 'tn');
  assert(tn && tn.projectId === 'p1' && tn.addedBy === 'Maya');
  assert(docs.has(`manifests/${token}/tasks/tn`), 'other guests see the new task too');
  await guestWrite(helperToken, 'tn', { deleted: true, gBy: 'Maya' });
  await tick(600);
  assert(!app.tasks.some((x) => x.id === 'tn'));
});

await check('guests cannot reach tasks outside the shared project', async () => {
  await guestWrite(helperToken, 't9', { title: 'pwned', gBy: 'Maya' });
  await tick(600);
  assert.strictEqual(app.tasks.find((x) => x.id === 't9').title, 'Private task');
});

await check('project log posts come home and go out to every link', async () => {
  await fb.setDoc({ path: `manifests/${helperToken}/log/l1` }, { id: 'l1', by: 'Maya', text: 'Neighbor has a truck Saturday', at: Date.now() });
  await tick(600);
  assert.strictEqual(app.projects[0].log[0].text, 'Neighbor has a truck Saturday');
  assert(docs.get(`manifests/${token}/`.slice(0, -1)).log.some((e) => e.id === 'l1'), 'the other guest sees it');
});

await check('check-off-only guests cannot post to the log', async () => {
  await fb.setDoc({ path: `manifests/${token}/log/l2` }, { id: 'l2', by: 'Jordan', text: 'sneaky', at: Date.now() });
  await tick(400);
  assert(!app.projects[0].log.some((e) => e.id === 'l2'));
});

await check('forProject lists live shares with last activity', async () => {
  const list = relay.forProject('p1');
  assert.strictEqual(list.length, 2);
  assert(list.find((c) => c.guest === 'Maya').lastActive > 0);
});

await check('finishing the project ends "when done" links only', async () => {
  app.projects[0].status = 'done';
  relay.schedule(10);
  await tick(200);
  assert.strictEqual(docs.get(`manifests/${token}`).closed, true);
  assert.notStrictEqual(docs.get(`manifests/${helperToken}`).closed, true);
  app.projects[0].status = 'active';
});

await check('subtasks go out with their task, and guests can tick them (only the tick comes home)', async () => {
  const p1 = app.projects.find((x) => x.id === 'p1');
  p1.status = 'active';
  const t = app.tasks.find((x) => x.id === 't2') || app.tasks.find((x) => x.projectId === 'p1');
  t.subtasks = [{ id: 'a', text: 'Buy bins', done: false }, { text: 'Print labels', done: false }, { id: 'c', text: '', done: false }];
  const tok = await relay.share({ projectId: 'p1', guest: 'Riley', level: 'check', ends: 'week' });
  await tick(80);
  const mirror = docs.get(`manifests/${tok}/tasks/${t.id}`);
  assert.deepStrictEqual(mirror.subtasks, [{ id: 'a', text: 'Buy bins', done: false }, { id: 's1', text: 'Print labels', done: false }], 'blank subtasks stay home; old ones get a stable id');
  await guestWrite(tok, t.id, { gBy: 'Riley', subtasks: [{ id: 'a', text: 'HACKED', done: true }, { id: 's1', text: 'Print labels', done: false }] });
  await tick(120);
  assert.deepStrictEqual(t.subtasks.map((x) => [x.text, x.done]), [['Buy bins', true], ['Print labels', false], ['', false]], 'only the tick is applied');
  assert(app.activity.some((e) => /Riley checked off Buy bins/.test(e.text)));
  assert.strictEqual(docs.get(`manifests/${tok}/tasks/${t.id}`).subtasks[0].text, 'Buy bins', 'the link shows our text again');
  await relay.revoke(tok);
});

await check('STOP removes the link and its copy of the project', async () => {
  await relay.revoke(helperToken);
  await tick(100);
  assert(![...docs.keys()].some((k) => k.startsWith(`manifests/${helperToken}`)));
});

await check('mirrorOf keeps only what guests should see', () => {
  const m = mirrorOf({ id: 'x', title: 'T', notes: 'secret', reminder: 5, assignee: 'A', comments: [], done: false });
  assert.deepStrictEqual(Object.keys(m).sort(), ['addedBy', 'comments', 'done', 'doneAt', 'doneBy', 'due', 'dueHasTime', 'id', 'pending', 'subtasks', 'title']);
});

relay.stop();
console.log(`\n${passed} manifest checks passed`);
