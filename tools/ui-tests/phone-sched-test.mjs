// Drives Field Unit in a phone-sized Chromium against an in-memory Firestore stand-in.
const { chromium } = await import(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright/index.mjs');
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../field-unit');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const SHOTS = path.join(HERE, 'out', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['shots-guest', 'themes']) fs.mkdirSync(path.join(HERE, 'out', d), { recursive: true });
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file;
  if (p === '/__/firebase/init.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ apiKey: 'k', projectId: 'demo', appId: 'a', authDomain: 'demo.firebaseapp.com' })); return; }
  if (p === '/lib/core.js') file = path.join(HERE, 'fake-core.js');
  else if (p === '/lib/real-core.js') file = path.join(ROOT, 'lib/core.js');
  else file = path.join(ROOT, p === '/' ? 'index.html' : p === '/m' ? 'manifest.html' : p);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise((r) => server.listen(5179, r));
const BASE = 'http://localhost:5179';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
await ctx.route(/fonts\.(googleapis|gstatic)\.com|open-meteo/, (r) => r.abort());


const now = Date.now();
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const iso = (h) => new Date(now + h * 3600000).toISOString();
const local = {
  'fu.deckId': 'deck_1',
  'fu.settings': { theme: 'dusk', installDismissed: true, commsSound: 'off' },
  'fu.shared': { operatorName: 'Sam', consoleName: 'Command Deck', categories: [], people: ['Me'], scheduleTypes: [{ id: 'appt', name: 'Appointment', short: 'APPT', color: '#A8B0D8' }, { id: 'ldc', name: 'LDC', short: 'LDC', color: '#F2A65A' }, { id: 'metro', name: 'Metro', short: 'METRO', color: '#7FD1C7' }, { id: 'other', name: 'Other', short: 'OTHER', color: '#B5B0BC' }, { id: 'tr', name: 'Training', short: 'TRAINING', color: '#B8E27A' }] },
  'fu.schedule': [
    { id: 's1', type: 'ldc', title: 'Work shift', date: ymd(new Date()), note: '', replies: {}, createdAt: 1 },
    { id: 's2', type: 'appt', title: 'Dentist', date: ymd(new Date(Date.now() + 864e5)), note: 'Need a ride home after.', replies: {}, createdAt: 2 }
  ],
  'fu.command': { lastSeen: now },
  'fu.projects': [{ id: 'p1', name: 'Garage cleanout', color: '#F2A65A', due: iso(24 * 18), status: 'active', createdAt: iso(-48), log: [] }, { id: 'p2', name: 'Surprise party', color: '#D9A9C6', status: 'active', createdAt: iso(-40) }],
  'fu.tasks': [
    { id: 't1', title: 'Sweep & reseal floor', due: iso(30), dueHasTime: false, priority: 'medium', projectId: 'p1', done: false, repeat: { type: 'none' }, subtasks: [], notes: 'owner-only note' },
    { id: 't2', title: 'Label bins', due: null, priority: 'low', projectId: 'p1', done: false, repeat: { type: 'none' }, subtasks: [] },
    { id: 't9', title: 'Buy the cake', due: null, priority: 'high', projectId: 'p2', done: false, repeat: { type: 'none' }, subtasks: [] }
  ]
};
const seedDocs = { 'decks/deck_1/members/phone-uid': { kind: 'phone', name: 'Field Unit' }, 'decks/deck_1/meta/command': { lastSeen: now } };
const results = [];
const errors = [];
const check = (cond, name) => results.push(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(`console: ${m.text()}`); });
await page.addInitScript(({ local, seedDocs }) => { window.__seedDocs = seedDocs; if (!sessionStorage.getItem('seeded')) { localStorage.clear(); for (const [k, v] of Object.entries(local)) localStorage.setItem(k, JSON.stringify(v)); sessionStorage.setItem('seeded', '1'); } }, { local, seedDocs });
await page.goto(BASE);
await page.waitForTimeout(800);
const wait = (ms) => page.waitForTimeout(ms);
const fake = (fn, arg) => page.evaluate(fn, arg);
const shot = (name) => page.screenshot({ path: path.join(HERE, 'out', 'shots-guest', `phone-${name}.png`) });
const lsTasks = () => page.evaluate(() => JSON.parse(localStorage.getItem('fu.tasks')));
const lsProjects = () => page.evaluate(() => JSON.parse(localStorage.getItem('fu.projects')));


const lsSched = () => page.evaluate(() => JSON.parse(localStorage.getItem('fu.schedule')));
await page.click('.tab[data-view="tasks"]');
await page.click('[data-tkview="schedule"]');
await wait(200);
let text = await page.locator('#view').innerText();
check(/SCHEDULE · 2/.test(text) && /THIS WEEK/.test(text), 'Tasks has a SCHEDULE tab with this week');
check(/Work shift/.test(text) && /LDC/.test(text) && /Dentist/.test(text) && /APPT/.test(text), 'entries show with type chips');
await shot('sched-tab');
await page.click('[data-new-sched]');
await wait(200);
check(await page.locator('#scTypes [data-type="tr"]').count() === 1, 'editor offers the types from Command Deck');
await page.click('#scTypes [data-type="tr"]');
await page.fill('#scTitle', 'Safety course');
await page.fill('#scDate', ymd(new Date(Date.now() + 2 * 864e5)));
await page.fill('#scNote', 'Bring ID');
await page.click('#scSave');
await wait(300);
let sch = await lsSched();
check(sch.some((e) => e.title === 'Safety course' && e.type === 'tr' && e.note === 'Bring ID'), 'new entry is saved');
const synced = await fake((p) => Object.keys(Object.fromEntries(window.__fake.docs)).filter((k) => k.startsWith(p)).length, 'decks/deck_1/schedule/');
check(synced >= 3, 'schedule syncs to the deck');
// Saving can jump to the entry's week (e.g. on a weekend); start from this week.
if (await page.locator('[data-sc="today"]').count()) { await page.click('[data-sc="today"]'); await wait(120); }
await page.click('[data-sc="next"]');
await wait(120);
check(/NEXT WEEK/.test(await page.locator('#view').innerText()), '› goes to next week');
if (await page.locator('[data-sc="today"]').count()) await page.click('[data-sc="today"]');
await wait(120);

await page.click('[data-sched-share]');
await wait(200);
await page.fill('#shName', 'Jordan');
await page.click('[data-ends="week"]');
await page.click('.sheet [data-level="add"]');
await wait(80);
await page.click('#shCreate');
await wait(800);
text = await page.locator('.sheet').innerText();
check(/SCHEDULE LINK READY · JORDAN/.test(text) && /\/s\//.test(text), 'link is made with /s/ in it');
await shot('sched-share');
const tok = await fake(() => [...window.__fake.docs.keys()].find((k) => /^rosters\/[^/]+$/.test(k)).split('/')[1]);
const r = await fake((t) => window.__fake.docs.get(`rosters/${t}`), tok);
check(r && r.level === 'add' && /^#/.test(r.color || '') && r.guest === 'Jordan' && r.ends === 'week' && r.owner === 'Sam' && r.types.some((t) => t.short === 'TRAINING'), 'link carries owner, end rule and types');
check(await fake((t) => !!window.__fake.docs.get(`rosters/${t}/entries/s1`), tok), 'entries are copied to the link');
check(/PEOPLE WITH ACCESS\s*1/.test(await page.locator('.sheet').innerText()), 'people list shows the new link');
await page.click('[data-close]');
await wait(150);

// Jordan adds an entry on the link → phone relay brings it home
const gDate = ymd(new Date(Date.now() + 864e5));
await fake(([t, d]) => window.__fake.write(`rosters/${t}/entries/gVet`, { id: 'gVet', type: 'appt', title: 'Vet for Biscuit', date: d, start: '10:00', end: '', note: 'Can someone drive?', byToken: t, byName: 'JORDAN', byColor: '#7FD1C7', pending: true, gBy: 'Jordan', gAt: Date.now() }), [tok, gDate]);
await wait(1200);
sch = await lsSched();
const gv = sch.find((e) => e.title === 'Vet for Biscuit');
check(gv && gv.addedBy && gv.addedBy.token === tok && gv.addedBy.name === 'Jordan', 'a guest entry reaches the phone with who added it');
text = await page.locator('#view').innerText();
check(/Vet for Biscuit/.test(text) && /JORDAN: Can someone drive\?/.test(text), 'shows on the schedule with their note');
check(!/GOT IT|CHANGE REQUEST|NO REPLY/.test(text), 'no reply buttons or labels');
const chipsTxt = await page.locator('.sc-row', { hasText: 'Vet for Biscuit' }).locator('.sc-chip').allInnerTexts();
check(chipsTxt.length === 2 && /JORDAN/.test(chipsTxt[0]) && /APPT/.test(chipsTxt[1]), 'name chip before the type chip');
const own = await page.locator('.sc-row', { hasText: 'Work shift' }).first().locator('.sc-who').innerText();
check(/SAM/.test(own), "the owner's own entries carry the owner's chip");
const linkCopy = await fake((t) => window.__fake.docs.get(`rosters/${t}/entries/gVet`), tok);
check(linkCopy && linkCopy.pending === false && linkCopy.byName === 'JORDAN', 'link copy is marked handled');
await shot('sched-guest-entry');

// Jordan deletes it (soft delete) → gone here too
await fake((t) => { const p = `rosters/${t}/entries/gVet`; window.__fake.write(p, { ...window.__fake.docs.get(p), deleted: true, pending: true, gBy: 'Jordan', gAt: Date.now() }); }, tok);
await wait(1200);
sch = await lsSched();
check(!sch.some((e) => e.title === 'Vet for Biscuit'), 'their delete reaches the phone');

console.log(results.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
console.log(`${results.filter((r) => r.startsWith('ok')).length}/${results.length} passed`);
await browser.close();
server.close();
