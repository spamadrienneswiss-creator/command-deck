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
await new Promise((r) => server.listen(5177, r));
const BASE = 'http://localhost:5177';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
await ctx.route(/fonts\.(googleapis|gstatic)\.com|open-meteo/, (r) => r.abort());


const now = Date.now();
const iso = (h) => new Date(now + h * 3600000).toISOString();
const local = {
  'fu.deckId': 'deck_1',
  'fu.settings': { theme: 'dusk', ui: 'classic', installDismissed: true, commsSound: 'off' },
  'fu.shared': { operatorName: 'Sam', consoleName: 'Command Deck', categories: [], people: ['Me'] },
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

await page.click('.tab[data-view="tasks"]');
await page.click('[data-tkview="projects"]');
await wait(150);
// v1.18: projects are collapsible groups; the header opens the group, OPEN PROJECT opens the sheet.
const grp = page.locator('.pj-group', { hasText: 'Garage cleanout' });
check(await grp.locator('.trow').count() === 0, 'project group starts folded');
await grp.locator('[data-pj-toggle]').click();
await page.waitForTimeout(150);
const grp2 = page.locator('.pj-group', { hasText: 'Garage cleanout' });
check(await grp2.locator('.trow').count() > 0, 'tapping the header shows its tasks');
await grp2.locator('[data-project]').click();
await wait(200);
check(await page.locator('#pjShare').count() === 1, 'project sheet has SHARE');
check(await page.locator('#pjLog').count() === 1, 'project sheet has the PROJECT LOG strip');
await page.click('#pjShare');
await wait(200);
await shot('share-form');
await page.fill('#shName', 'Jordan');
await page.click('[data-level="helper"]');
await wait(80);
await page.click('#shCreate');
await wait(700);
await shot('share-made');
const man = await fake(() => [...window.__fake.docs.entries()].filter(([k]) => /^manifests\/[^/]+$/.test(k)));
check(man.length === 1 && man[0][1].deckId === 'deck_1' && man[0][1].projectId === 'p1' && man[0][1].guest === 'Jordan' && man[0][1].level === 'helper', 'CREATE LINK writes the manifest');
const tok = man.length ? man[0][0].split('/')[1] : '';
check(tok.length >= 20, 'link token is long');
const mirrored = await fake((t) => [...window.__fake.docs.keys()].filter((k) => k.startsWith(`manifests/${t}/tasks/`)).map((k) => k.split('/').pop()).sort(), tok);
check(JSON.stringify(mirrored) === '["t1","t2"]', `only the project's tasks are copied (${mirrored})`);
const m1 = await fake((t) => window.__fake.docs.get(`manifests/${t}/tasks/t1`), tok);
check(m1 && !('notes' in m1), 'private task notes are not copied');
check((await page.locator('.sh-link').innerText()).includes(`/m#${tok}`), 'sheet shows the link');
check(await page.locator('.sh-made-row img').count() === 1, 'sheet shows a QR code');

// a guest checks off a task and posts to the log
await fake((t) => { const p = `manifests/${t}/tasks/t2`; window.__fake.write(p, { ...window.__fake.docs.get(p), done: true, doneAt: new Date().toISOString(), doneBy: 'Jordan', pending: true, gBy: 'Jordan', gAt: Date.now() }); }, tok);
await fake((t) => window.__fake.write(`manifests/${t}/log/lg1`, { id: 'lg1', by: 'Jordan', text: 'Neighbor has a truck', at: Date.now() }), tok);
await wait(900);
const t2 = (await lsTasks()).find((x) => x.id === 't2');
check(t2.done === true && t2.doneBy === 'Jordan', 'guest check-off lands in Field Unit with their name');
check(/Jordan/.test(await page.locator('#toast').innerText()), 'a toast reports the crew update');
const p1 = (await lsProjects()).find((x) => x.id === 'p1');
check(p1.log && p1.log.some((e) => e.id === 'lg1'), 'guest log post lands in the project log');
check(await fake((t) => window.__fake.docs.get(`manifests/${t}/tasks/t2`).pending === false, tok), 'pending mark is cleared after applying');
const synced = await fake(() => (window.__fake.docs.get('decks/deck_1/tasks/t2') || {}).doneBy);
check(synced === 'Jordan', 'the change syncs on to Command Deck');

await page.click('#shBack');
await wait(250);
await shot('project-sheet');
const sheet = await page.locator('.sheet').innerText();
check(/CREW · 1 PERSON/.test(sheet) && /Jordan/.test(sheet), 'project sheet shows the crew strip');
check(/PROJECT LOG · 1/.test(sheet) && /Neighbor has a truck/.test(sheet), 'project sheet shows the latest log post');
check(/DONE BY JORDAN/.test(sheet), 'task row shows who finished it');
await page.click('#pjLog');
await wait(150);
await page.fill('#plText', 'Thanks! Take the truck.');
await page.click('#plForm button[type="submit"]');
await wait(800);
check(await fake((t) => (window.__fake.docs.get(`manifests/${t}`).log || []).some((e) => e.text === 'Thanks! Take the truck.' && e.by === 'Sam'), tok), 'owner log post goes out to the guest link');
await shot('log-sheet');
await page.click('#plBack');
await wait(150);
await page.click('#pjShare');
await wait(200);
check(/Jordan/.test(await page.locator('.sh-person').innerText()), 'people with access lists Jordan');
await page.selectOption('[data-lvl]', 'check');
await wait(200);
check(await fake((t) => window.__fake.docs.get(`manifests/${t}`).level === 'check', tok), 'changing access updates the link');
await page.click('[data-stop]');
await page.click('[data-stop]');
await wait(500);
check(await fake((t) => ![...window.__fake.docs.keys()].some((k) => k.startsWith(`manifests/${t}`)), tok), 'STOP deletes the link and its copy');

console.log(results.join('\n'));
console.log(errors.length ? `\nERRORS:\n${errors.join('\n')}` : '\nno page errors');
console.log(`\n${results.filter((r) => r.startsWith('ok')).length}/${results.length} passed`);
await browser.close();
server.close();
