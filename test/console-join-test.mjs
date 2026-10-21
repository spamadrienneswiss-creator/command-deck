// Two Command Decks on one deck: the main console and a second one that joins with a pairing code.
import assert from 'assert';
import { register } from 'module';
register('./fake-loader.mjs', import.meta.url);

const pushes = [];
globalThis.window = { addEventListener() {}, deck: {
  pushKeys: async () => ({ publicKey: 'vapid-pub' }), qr: async () => 'data:qr', hostname: async () => 'OFFICE-LAPTOP',
  pushSend: async (subs, payload) => { pushes.push(payload); return { gone: [] }; }, copy: async () => true } };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
globalThis.fetch = async () => ({ ok: true, json: async () => ({ apiKey: 'k', projectId: 'deck-test' }) });

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(`  ok  ${name}`); }

function makeConsole(tag, settings) {
  const app = {
    settings: { consoleName: 'Command Deck', operatorName: 'Sam', categories: [{ id: 'home', name: 'Home' }], people: ['Me'], location: { name: 'LA', lat: 1, lon: 2 },
      tempUnit: 'F', clock24: false, calendars: [], theme: 'dusk', fieldUnit: { url: '', config: null, deckId: null, role: 'main' }, ...settings },
    lists: { tasks: [], events: [], timers: [], notes: [], projects: [], schedule: [] },
    paired: [], adopted: 0
  };
  return import(`../renderer/fieldunit.js?${tag}`).then(async (FU) => {
    app.FU = FU;
    app.save = async (next) => { app.settings = FU.overlay(next); FU.relayShared(app.settings); };
    await FU.init({
      version: 'test', getSettings: () => app.settings,
      saveFieldUnit: async (fieldUnit) => app.save({ ...app.settings, fieldUnit }),
      getList: (k) => app.lists[k],
      applyRemote: (k, list) => { app.lists[k] = list; },
      guestChanges() {}, addLog() {}, onActivity() {}, getLook: () => ({}), applyReplies() {}, onScheduleActivity() {},
      adoptShared: (shared) => { app.adopted++; app.save({ ...app.settings, ...shared }); },
      onPaired: (m) => app.paired.push(m)
    });
    return app;
  });
}

console.log('Second console joins a deck');
const main = await makeConsole('main', { categories: [{ id: 'home', name: 'Home' }, { id: 'garage', name: 'Garage' }], people: ['Me', 'Adri'],
  calendars: [{ id: 'c1', name: 'Family', url: 'https://cal.example/secret.ics', color: '#F2A65A', enabled: true }] });
const surface = await makeConsole('surface', { theme: 'cryo' });

await check('main console links and owns a new deck', async () => {
  await main.FU.link('https://deck-test.web.app');
  await tick();
  const st = main.FU.state();
  assert(st.linked && st.role === 'main' && st.deckId);
  assert.strictEqual(globalThis.__fakeFb.docs.get(`decks/${st.deckId}`).owner, 'uid-1');
});

let code;
await check('a wrong code is refused without linking', async () => {
  await assert.rejects(surface.FU.join('https://deck-test.web.app', 'ZZZ-999'), /not recognized/);
  assert.strictEqual(surface.FU.state().linked, false);
});

await check('the second console joins with the pairing code', async () => {
  code = (await main.FU.startPairing()).code;
  await surface.FU.join('https://deck-test.web.app', code.slice(0, 3) + '-' + code.slice(3).toLowerCase());
  await tick(80);
  const st = surface.FU.state();
  assert(st.linked && st.role === 'joined' && st.deckId === main.FU.state().deckId);
  const m = globalThis.__fakeFb.docs.get(`decks/${st.deckId}/members/uid-2`);
  assert.strictEqual(m.kind, 'desktop');
  assert.strictEqual(m.name, 'Command Deck · OFFICE-LAPTOP');
});

await check('the main console sees it as a console, not a phone', async () => {
  const st = main.FU.state();
  assert.strictEqual(st.consoles, 1);
  assert.strictEqual(st.phones, 0);
  assert(main.paired.some((p) => p.kind === 'desktop'), 'join announced on the main console');
  assert.strictEqual(st.pairing, null, 'pairing code cleared after use');
});

await check('tasks made on either console show up on the other', async () => {
  main.lists.tasks.push({ id: 't1', title: 'Sweep floor', done: false });
  main.FU.push('tasks');
  await tick(80);
  assert(surface.lists.tasks.some((t) => t.title === 'Sweep floor'));
  surface.lists.tasks = [...surface.lists.tasks, { id: 't2', title: 'Call Sam', done: false }];
  surface.FU.push('tasks');
  await tick(80);
  assert(main.lists.tasks.some((t) => t.title === 'Call Sam'));
});

await check('notes and projects sync too', async () => {
  surface.lists.notes.push({ id: 'n1', title: 'Gate code', body: '1357' });
  surface.lists.projects.push({ id: 'p1', name: 'Garage cleanout', status: 'active' });
  surface.FU.push('notes'); surface.FU.push('projects');
  await tick(80);
  assert(main.lists.notes.some((n) => n.id === 'n1'));
  assert(main.lists.projects.some((p) => p.id === 'p1'));
});

await check('schedule entries and types are shared too', async () => {
  main.lists.schedule.push({ id: 's1', type: 'ldc', title: 'Work shift', date: '2026-10-24', note: '', replies: {} });
  main.FU.push('schedule');
  await main.save({ ...main.settings, scheduleTypes: [{ id: 'ldc', name: 'LDC', short: 'LDC', color: '#F2A65A' }, { id: 'tr', name: 'Training', short: 'TRAINING', color: '#B8E27A' }] });
  await tick(80);
  assert(surface.lists.schedule.some((e) => e.id === 's1'));
  assert(surface.settings.scheduleTypes.some((t) => t.id === 'tr'));
});

await check('the joined console follows categories, crew and calendar feeds', async () => {
  assert(surface.adopted > 0);
  assert.deepStrictEqual(surface.settings.categories.map((c) => c.id), ['home', 'garage']);
  assert.deepStrictEqual(surface.settings.people, ['Me', 'Adri']);
  assert.strictEqual(surface.settings.calendars[0].url, 'https://cal.example/secret.ics');
  assert.strictEqual(surface.settings.theme, 'cryo', 'its own look is kept');
});

await check('phones never see the calendar feed links', async () => {
  const shared = globalThis.__fakeFb.docs.get(`decks/${main.FU.state().deckId}/meta/shared`);
  assert(shared.calendars.length && !('url' in shared.calendars[0]));
});

await check('editing followed settings on the joined console keeps the main values', async () => {
  await surface.save({ ...surface.settings, categories: [{ id: 'x', name: 'Mine' }], theme: 'redalert' });
  assert.deepStrictEqual(surface.settings.categories.map((c) => c.id), ['home', 'garage']);
  assert.strictEqual(surface.settings.theme, 'redalert');
});

await check('a change on the main console reaches the joined console', async () => {
  await main.save({ ...main.settings, people: ['Me', 'Adri', 'Sam'] });
  await tick(80);
  assert.deepStrictEqual(surface.settings.people, ['Me', 'Adri', 'Sam']);
});

await check('only the main console speaks for "Command" and sends phone alerts', async () => {
  const deckId = main.FU.state().deckId;
  const metaWriters = globalThis.__fakeFb.writes.filter((w) => w.path.startsWith(`decks/${deckId}/meta/`)).map((w) => w.who);
  assert(metaWriters.length && metaWriters.every((w) => w === 'uid-1'), 'joined console writes no command/shared meta');
  globalThis.__fakeFb.docs.set(`decks/${deckId}/push/phone1`, { sub: { endpoint: 'x' } });
  globalThis.__fakeFb.listeners.forEach((l) => l.path === `decks/${deckId}/push` && l.cb({ forEach: (fn) => fn({ id: 'phone1', data: () => ({ sub: { endpoint: 'x' } }) }) }));
  await tick();
  await surface.FU.notifyPhones({ title: 'from surface' });
  await main.FU.notifyPhones({ title: 'from main' });
  assert.deepStrictEqual(pushes.map((p) => p.title), ['from main']);
});

await check('pairing is done from the main console only', async () => {
  await assert.rejects(surface.FU.startPairing(), /main console/);
});

await check('removing the console on the main console cuts it off', async () => {
  await main.FU.unpair('uid-2');
  await tick(80);
  assert.strictEqual(main.FU.state().consoles, 0);
  assert.strictEqual(surface.FU.state().status, 'error');
  assert(/removed/.test(surface.FU.state().error));
});

await check('leaving keeps local data and resets the link', async () => {
  const before = surface.lists.tasks.length;
  await surface.FU.unlink();
  const st = surface.FU.state();
  assert(!st.linked && st.role === 'main');
  assert.strictEqual(surface.lists.tasks.length, before);
});

console.log(`\n${passed} console-join checks passed`);
process.exit(0);
