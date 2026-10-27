// Shared schedule links: owner app ⇄ people's links, through an in-memory Firestore stand-in.
import assert from 'assert';
import { webcrypto } from 'crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const R = await import('../shared/roster.js');
const { RosterRelay, scheduleUrl, ymd, addDays, weekStart, weekLabel, weekDays, DEFAULT_TYPES, mirrorOf, timeRange, parseTime, guestEntry, chipName } = R;

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
    { id: 'e1', type: 'ldc', title: 'Work shift', date: d(0), note: '' },
    { id: 'e2', type: 'appt', title: 'Dentist', date: d(1), note: 'Need a ride home after.' },
    { id: 'e3', type: 'other', title: 'Old thing', date: d(-40), note: '' }
  ],
  activity: []
};
const hooks = {
  getEntries: () => app.entries,
  getTypes: () => DEFAULT_TYPES,
  applyGuestChanges: (changes) => {
    for (const c of changes) {
      if (c.kind === 'delete') app.entries = app.entries.filter((x) => x.id !== c.entry.id);
      else if (c.kind === 'add') app.entries.push(c.entry);
      else app.entries = app.entries.map((x) => (x.id === c.entry.id ? c.entry : x));
    }
    relay.schedule(10);
  },
  onActivity: (ev) => app.activity.push(...ev),
  getLook: () => ({ theme: 'dusk' }),
  operatorName: () => 'Samantha',
  ownerChip: () => ({ name: 'Sam', color: '#F4B6A0' })
};
const relay = new RosterRelay(fb, {}, 'deck_1', 'desk-uid', hooks);
relay.start();
await tick();
let token; let token2;
// A person writes into their own link, the way the shared page does.
const write = async (tok, id, fields, by = 'Jordan') => {
  const path = `rosters/${tok}/entries/${id}`;
  await fb.setDoc({ path }, { ...(docs.get(path) || {}), ...fields, id, byToken: tok, pending: true, gBy: by, gAt: Date.now() + Math.random() });
};

await check('links live under /s/ with the token in the path', () => {
  assert.strictEqual(scheduleUrl('https://x.web.app/', 'abc'), 'https://x.web.app/s/abc');
});

await check('sharing copies upcoming entries, not old ones, labeled with who added them', async () => {
  token = await relay.share({ guest: 'Jordan', ends: 'month', level: 'add', color: '#B8E27A' });
  await tick(60);
  const m = docs.get(`rosters/${token}`);
  assert.strictEqual(m.deckId, 'deck_1');
  assert.strictEqual(m.owner, 'Samantha');
  assert.deepStrictEqual(m.ownerChip, { name: 'Sam', color: '#F4B6A0' });
  assert.strictEqual(m.level, 'add');
  assert.strictEqual(m.color, '#B8E27A');
  assert(m.expiresAt && m.expiresAt.ms > Date.now() + 29 * 864e5, '30-day link');
  assert(m.types.some((t) => t.short === 'LDC'));
  assert(docs.has(`rosters/${token}/entries/e1`) && docs.has(`rosters/${token}/entries/e2`));
  assert(!docs.has(`rosters/${token}/entries/e3`), 'entries from long ago stay home');
  const e2 = docs.get(`rosters/${token}/entries/e2`);
  assert.deepStrictEqual(Object.keys(e2).sort(), ['byColor', 'byName', 'byToken', 'date', 'end', 'id', 'note', 'pending', 'start', 'title', 'type']);
  assert.strictEqual(e2.byName, 'SAM');
  assert.strictEqual(e2.byColor, '#F4B6A0');
  assert.strictEqual(e2.byToken, '');
});

await check('a READ + ADD person adds an entry, and it lands in the real schedule', async () => {
  await write(token, 'gAdd1', { type: 'other', title: "Dog sitting at Sam's", date: d(2), start: '18:00', end: '21:00', note: 'Key under the mat' });
  await tick(500);
  const e = app.entries.find((x) => x.id === 'gAdd1');
  assert(e, 'added');
  assert.strictEqual(e.title, "Dog sitting at Sam's");
  assert.deepStrictEqual(e.addedBy, { token, name: 'Jordan', color: '#B8E27A' });
  const mine = docs.get(`rosters/${token}/entries/gAdd1`);
  assert.strictEqual(mine.pending, false);
  assert.strictEqual(mine.byToken, token, 'their own entry is marked as theirs');
  assert.strictEqual(mine.byName, 'JORDAN');
  assert(app.activity.some((a) => a.kind === 'add' && /Jordan added Dog sitting/.test(a.text)));
});

await check('everyone sees it, with the adder\'s name and color but never their key', async () => {
  token2 = await relay.share({ guest: 'Maya', ends: 'week' });
  await tick(500);
  const theirs = docs.get(`rosters/${token2}/entries/gAdd1`);
  assert(theirs, 'shared schedule: Maya sees Jordan\'s entry');
  assert.strictEqual(theirs.byName, 'JORDAN');
  assert.strictEqual(theirs.byColor, '#B8E27A');
  assert.strictEqual(theirs.byToken, '', 'no other person\'s key leaks');
  const m2 = docs.get(`rosters/${token2}`);
  assert.strictEqual(m2.level, 'read', 'links are read only unless chosen');
  assert(m2.color && m2.color !== '#B8E27A' && m2.color !== '#F4B6A0', 'a free color is picked');
});

await check('they can edit and delete their own entry', async () => {
  await write(token, 'gAdd1', { ...docs.get(`rosters/${token}/entries/gAdd1`), title: 'Dog sitting', start: '17:30' });
  await tick(500);
  const e = app.entries.find((x) => x.id === 'gAdd1');
  assert.strictEqual(e.title, 'Dog sitting');
  assert.strictEqual(e.start, '17:30');
  assert.strictEqual(docs.get(`rosters/${token2}/entries/gAdd1`).title, 'Dog sitting');
  await write(token, 'gAdd1', { ...docs.get(`rosters/${token}/entries/gAdd1`), deleted: true });
  await tick(500);
  assert(!app.entries.some((x) => x.id === 'gAdd1'), 'removed from the real schedule');
  assert(!docs.has(`rosters/${token}/entries/gAdd1`) && !docs.has(`rosters/${token2}/entries/gAdd1`), 'and from every link');
  assert(app.activity.some((a) => a.kind === 'delete'));
});

await check('nobody can change the owner\'s entries or another person\'s', async () => {
  const before = JSON.stringify(app.entries.find((x) => x.id === 'e1'));
  await write(token, 'e1', { ...docs.get(`rosters/${token}/entries/e1`), title: 'Hacked' });
  await tick(500);
  assert.strictEqual(JSON.stringify(app.entries.find((x) => x.id === 'e1')), before);
  assert.strictEqual(docs.get(`rosters/${token}/entries/e1`).title, 'Work shift', 'the true version is put back');
  await write(token, 'gJ', { type: 'ldc', title: 'Covering LDC', date: d(3) });
  await tick(400);
  await write(token2, 'gJ', { ...docs.get(`rosters/${token2}/entries/gJ`), title: 'Maya was here' }, 'Maya');
  await tick(400);
  assert.strictEqual(app.entries.find((x) => x.id === 'gJ').title, 'Covering LDC');
});

await check('a READ ONLY link can\'t add, even if it tries', async () => {
  await write(token2, 'gM', { type: 'other', title: 'Sneaky', date: d(1) }, 'Maya');
  await tick(500);
  assert(!app.entries.some((x) => x.id === 'gM'));
  assert(!docs.has(`rosters/${token2}/entries/gM`), 'cleaned off their link');
});

await check('switching a link to READ + ADD works without a new link', async () => {
  await relay.setLevel(token2, 'add');
  await tick(100);
  assert.strictEqual(docs.get(`rosters/${token2}`).level, 'add');
  await write(token2, 'gM2', { type: 'appt', title: 'Haircut', date: d(1) }, 'Maya');
  await tick(500);
  assert(app.entries.some((x) => x.id === 'gM2' && x.addedBy.name === 'Maya'));
});

await check('a new color follows the person to all their entries', async () => {
  await relay.setColor(token, '#8EC5FF');
  await tick(500);
  assert.strictEqual(docs.get(`rosters/${token2}/entries/gJ`).byColor, '#8EC5FF');
});

await check('owner changes flow out, and deletions disappear everywhere', async () => {
  const e = app.entries.find((x) => x.id === 'e2');
  e.date = d(2);
  app.entries.push({ id: 'e4', type: 'metro', title: 'Work shift', date: d(3), note: '' });
  relay.schedule(10);
  await tick(150);
  assert.strictEqual(docs.get(`rosters/${token}/entries/e2`).date, d(2));
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

await check('people list shows each link with its level and color', () => {
  const list = relay.list();
  assert.strictEqual(list.length, 2);
  const j = list.find((x) => x.guest === 'Jordan');
  assert.strictEqual(j.level, 'add');
  assert.strictEqual(j.color, '#8EC5FF');
  assert(j.lastActive > 0);
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

await check('guest entries are checked and trimmed', () => {
  assert.strictEqual(guestEntry({ title: '  ', date: '2026-10-20' }), null);
  assert.strictEqual(guestEntry({ title: 'X', date: 'tomorrow' }), null);
  const g = guestEntry({ title: 'X'.repeat(200), date: '2026-10-20', start: '9am', end: '14:00', type: 'nope', note: 'n' });
  assert.strictEqual(g.title.length, 120);
  assert.strictEqual(g.start, '');
  assert.strictEqual(g.end, '14:00');
  assert.strictEqual(g.type, 'other');
  assert.strictEqual(chipName('Jordan'), 'JORDAN');
  assert.strictEqual(chipName(''), 'GUEST');
});

relay.stop();
console.log(`\n${passed} schedule checks passed`);
