// Schedule links: owner app ⇄ guest replies, through an in-memory Firestore stand-in.
import assert from 'assert';
import { webcrypto } from 'crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const R = await import('../shared/roster.js');
const { RosterRelay, scheduleUrl, ymd, addDays, weekStart, weekLabel, weekDays, DEFAULT_TYPES, mirrorOf, timeRange, parseTime } = R;

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
async function check(name, fn) { await fn(); passed++; console.log(`  ok  ${name}`); }

console.log('Schedule links');
const { fb, docs } = fakeFirestore();
const today = new Date();
const d = (n) => ymd(addDays(today, n));
const app = {
  entries: [
    { id: 'e1', type: 'ldc', title: 'Work shift', date: d(0), note: '', replies: {} },
    { id: 'e2', type: 'appt', title: 'Dentist', date: d(1), note: 'Need a ride home after.', replies: {} },
    { id: 'e3', type: 'other', title: 'Old thing', date: d(-40), note: '', replies: {} }
  ],
  activity: []
};
const hooks = {
  getEntries: () => app.entries,
  getTypes: () => DEFAULT_TYPES,
  applyReplies: (changes) => {
    for (const c of changes) {
      const e = app.entries.find((x) => x.id === c.entryId);
      e.replies = { ...(e.replies || {}), [c.token]: c.reply };
    }
    relay.schedule(10);
  },
  onActivity: (ev) => app.activity.push(...ev),
  getLook: () => ({ theme: 'dusk' }),
  operatorName: () => 'Sam'
};
const relay = new RosterRelay(fb, {}, 'deck_1', 'desk-uid', hooks);
relay.start();
await tick();
let token; let token2;
const reply = async (tok, id, r, by = 'Jordan') => {
  const path = `rosters/${tok}/entries/${id}`;
  await fb.setDoc({ path }, { ...(docs.get(path) || {}), reply: { ...r, at: Date.now() }, pending: true, gBy: by, gAt: Date.now() + Math.random() });
};

await check('links live under /s/ with the token in the path', () => {
  assert.strictEqual(scheduleUrl('https://x.web.app/', 'abc'), 'https://x.web.app/s/abc');
});

await check('sharing copies upcoming entries, not old ones', async () => {
  token = await relay.share({ guest: 'Jordan', ends: 'month' });
  await tick(60);
  const m = docs.get(`rosters/${token}`);
  assert.strictEqual(m.deckId, 'deck_1');
  assert.strictEqual(m.owner, 'Sam');
  assert(m.expiresAt && m.expiresAt.ms > Date.now() + 29 * 864e5, '30-day link');
  assert(m.types.some((t) => t.short === 'LDC'));
  assert(docs.has(`rosters/${token}/entries/e1`) && docs.has(`rosters/${token}/entries/e2`));
  assert(!docs.has(`rosters/${token}/entries/e3`), 'entries from long ago stay home');
  assert.deepStrictEqual(Object.keys(docs.get(`rosters/${token}/entries/e2`)).sort(), ['date', 'end', 'id', 'note', 'pending', 'reply', 'start', 'title', 'type']);
});

await check('GOT IT comes home to the entry', async () => {
  await reply(token, 'e1', { state: 'ok', comment: '' });
  await tick(500);
  assert.strictEqual(app.entries[0].replies[token].state, 'ok');
  assert.strictEqual(app.entries[0].replies[token].by, 'Jordan');
  assert.strictEqual(docs.get(`rosters/${token}/entries/e1`).pending, false);
  assert(app.activity.some((a) => /Jordan: got it for Work shift/.test(a.text)));
});

await check('a CHANGE REQUEST comes home with its comment', async () => {
  await reply(token, 'e2', { state: 'change', comment: 'Could you move it to Thursday?' });
  await tick(500);
  const r = app.entries[1].replies[token];
  assert.strictEqual(r.state, 'change');
  assert.strictEqual(r.comment, 'Could you move it to Thursday?');
  assert(app.activity.some((a) => a.state === 'change' && /asked to change Dentist/.test(a.text)));
});

await check('a change request without a note still comes through', async () => {
  await reply(token, 'e1', { state: 'change', comment: '   ' });
  await tick(500);
  const r = app.entries[0].replies[token];
  assert.strictEqual(r.state, 'change');
  assert.strictEqual(r.comment, '');
  assert(app.activity.some((a) => a.state === 'change' && /\(no note\)/.test(a.text)));
  await reply(token, 'e1', { state: 'ok' });
  await tick(500);
  assert.strictEqual(app.entries[0].replies[token].state, 'ok');
});

await check('each person only sees their own reply', async () => {
  token2 = await relay.share({ guest: 'Maya', ends: 'week' });
  await tick(500);
  assert.strictEqual(docs.get(`rosters/${token2}/entries/e2`).reply, null);
  assert.strictEqual(docs.get(`rosters/${token}/entries/e2`).reply.state, 'change');
});

await check('owner changes flow out, and moving an entry clears its replies', async () => {
  const e = app.entries[1];
  e.date = d(2); e.replies = {};
  app.entries.push({ id: 'e4', type: 'metro', title: 'Work shift', date: d(3), note: '', replies: {} });
  relay.schedule(10);
  await tick(150);
  assert.strictEqual(docs.get(`rosters/${token}/entries/e2`).date, d(2));
  assert.strictEqual(docs.get(`rosters/${token}/entries/e2`).reply, null);
  assert(docs.has(`rosters/${token2}/entries/e4`));
  app.entries = app.entries.filter((x) => x.id !== 'e4');
  relay.schedule(10);
  await tick(150);
  assert(!docs.has(`rosters/${token}/entries/e4`), 'deleted entries disappear from the link');
});

await check('a new type reaches the links', async () => {
  const types = [...DEFAULT_TYPES, { id: 't9', name: 'Training', short: 'TRAINING', color: '#B8E27A' }];
  hooks.getTypes = () => types;
  relay.schedule(10);
  await tick(150);
  assert(docs.get(`rosters/${token}`).types.some((t) => t.short === 'TRAINING'));
});

await check('people list shows each link with last reply', () => {
  const list = relay.list();
  assert.strictEqual(list.length, 2);
  assert(list.find((x) => x.guest === 'Jordan').lastActive > 0);
  assert.strictEqual(list.find((x) => x.guest === 'Maya').ends, 'week');
});

await check('STOP removes the link and its copy', async () => {
  await relay.revoke(token2);
  await tick(100);
  assert(![...docs.keys()].some((k) => k.startsWith(`rosters/${token2}`)));
});

await check('weeks run Monday to Sunday and group by day', () => {
  const mon = weekStart(new Date(2026, 9, 21));
  assert.strictEqual(ymd(mon), '2026-10-19');
  assert.strictEqual(weekLabel(mon, new Date(2026, 9, 20)), 'THIS WEEK · OCT 19 – 25');
  assert.strictEqual(weekLabel(addDays(mon, 7), new Date(2026, 9, 20)), 'NEXT WEEK · OCT 26 – NOV 1');
  const days = weekDays([{ id: 'a', date: '2026-10-22' }, { id: 'b', date: '2026-10-20' }, { id: 'c', date: '2026-10-27' }], mon, new Date(2026, 9, 20));
  assert.deepStrictEqual(days.map((x) => x.label), ['TODAY · TUE OCT 20', 'THU OCT 22']);
});

await check('optional times: format, parse, sort and reach the link', () => {
  assert.strictEqual(timeRange('09:00', '14:00'), '9:00 AM – 2:00 PM');
  assert.strictEqual(timeRange('09:00', ''), '9:00 AM');
  assert.strictEqual(timeRange('', '14:00'), 'Until 2:00 PM');
  assert.strictEqual(timeRange('', ''), '');
  assert.strictEqual(timeRange('09:00', '14:00', true), '09:00 – 14:00');
  for (const [i, o] of [['9', '09:00'], ['9:30 pm', '21:30'], ['930', '09:30'], ['12am', '00:00'], ['12 PM', '12:00'], ['14:05', '14:05'], ['', ''], ['25:00', ''], ['13pm', ''], ['lunch', '']]) assert.strictEqual(parseTime(i), o, i);
  const days = weekDays([{ id: 'a', date: '2026-10-20', start: '14:00' }, { id: 'b', date: '2026-10-20', start: '09:00' }, { id: 'c', date: '2026-10-20' }], weekStart(new Date(2026, 9, 20)), new Date(2026, 9, 20));
  assert.deepStrictEqual(days[0].items.map((x) => x.id), ['b', 'a', 'c'], 'timed entries first, earliest first');
  const m = mirrorOf({ id: 'x', title: 'T', date: '2026-10-20', start: '09:00', end: '14:00' }, 'a');
  assert.strictEqual(m.start, '09:00'); assert.strictEqual(m.end, '14:00');
});

await check('mirrorOf never leaks other people\'s replies', () => {
  const m = mirrorOf({ id: 'x', title: 'T', date: '2026-10-20', replies: { a: { state: 'ok' }, b: { state: 'change', comment: 'no' } } }, 'a');
  assert.deepStrictEqual(m.reply, { state: 'ok', comment: '', at: 0 });
});

relay.stop();
console.log(`\n${passed} schedule checks passed`);
