// Drives Field Unit in a phone-sized Chromium against an in-memory Firestore stand-in.
const { chromium } = await import(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright/index.mjs');
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../field-unit');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const SHOTS = path.join(HERE, 'out', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
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
await new Promise((r) => server.listen(5176, r));
const BASE = 'http://localhost:5176';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
await ctx.route(/fonts\.(googleapis|gstatic)\.com|open-meteo/, (r) => r.abort());

const now = Date.now();
const T = (id, title, extra = {}) => ({ id, title, due: null, dueHasTime: false, done: false, doneAt: null, doneBy: null, addedBy: null, comments: [], pending: false, ...extra });
const M = (level, extra = {}) => ({ deckId: 'deck_1', projectId: 'p1', guest: 'Jordan', level, ends: 'done', expiresAt: null, closed: false, createdAt: now, owner: 'Sam',
  project: { name: 'Garage cleanout', goal: 'Park the car inside by winter', due: new Date(now + 18 * 864e5).toISOString(), color: '#F2A65A', status: 'active' },
  log: [{ id: 'l0', by: 'Sam', text: 'Spare key is under the planter.', at: now - 864e5 }], look: { theme: 'dusk', font: 'auto', ink: 'theme' }, ...extra });
const tasks = (tok) => ({
  [`manifests/${tok}/tasks/t1`]: T('t1', 'Sweep & reseal floor', { due: new Date(now + 2 * 864e5).toISOString(), assignee: 'Sam', subtasks: [{ id: 'a', text: 'Move the boxes out', done: true }, { id: 'b', text: 'Sweep', done: false }, { id: 'c', text: 'Roll on sealer', done: false }] }),
  [`manifests/${tok}/tasks/t2`]: T('t2', 'Label bins', { comments: [{ id: 'c0', by: 'Sam', text: 'Label maker is in the junk drawer.', at: now - 3600e3 }] }),
  [`manifests/${tok}/tasks/t3`]: T('t3', 'Install wall hooks', { done: true, doneAt: new Date(now - 7200e3).toISOString(), doneBy: 'Sam' })
});
const HELP = 'HelperTokenAAAAAAAAAAAAA';
const NOTE = 'NotesTokenBBBBBBBBBBBBBB';
const CHK = 'CheckTokenCCCCCCCCCCCCCC';
const OLD = 'ClosedTokenDDDDDDDDDDDDD';
const seed = {
  [`manifests/${HELP}`]: M('helper'), ...tasks(HELP),
  [`manifests/${NOTE}`]: M('notes'), ...tasks(NOTE),
  [`manifests/${CHK}`]: M('check', { guest: 'Maya' }), ...tasks(CHK),
  [`manifests/${OLD}`]: M('notes', { closed: true, closedReason: 'done' })
};
const results = [];
const errors = [];
const check = (cond, name) => results.push(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
const GSHOTS = path.join(HERE, 'out', 'shots-guest');
fs.mkdirSync(GSHOTS, { recursive: true });
let n = 0;
async function openGuest(tok, { name } = {}) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(`console: ${m.text()}`); });
  await page.addInitScript(({ seed, name, tok }) => { window.__seedDocs = seed; localStorage.clear(); if (name) localStorage.setItem(`pm.name.${tok}`, name); }, { seed, name, tok });
  await page.goto(`${BASE}/m#${tok}`);
  await page.waitForTimeout(500);
  return page;
}
const shot = (page, name) => page.screenshot({ path: path.join(GSHOTS, `${String(++n).padStart(2, '0')}-${name}.png`) });
const doc = (page, p) => page.evaluate((p) => window.__fake.docs.get(p) || null, p);

// ---- project administrator
let page = await openGuest(HELP);
await shot(page, 'welcome');
const welcome = await page.locator('#pm').innerText();
check(/Garage cleanout/.test(welcome) && /Add and edit tasks/.test(welcome) && /SAM'S COMMAND DECK/i.test(welcome), 'welcome shows project, abilities and owner');
check((await page.inputValue('#pmNameIn')) === 'Jordan', 'name is pre-filled from the share');
await page.fill('#pmNameIn', 'Jordan');
await page.click('.pm-nameform .btn.primary');
await page.waitForTimeout(200);
await shot(page, 'helper-list');
check(/CHECKLIST · 2/.test(await page.locator('.pm-tabs').innerText()), 'checklist counts open tasks');
check(/DONE BY SAM/.test(await page.locator('#pm').innerText()), 'done tasks show who finished them');
await page.click('[data-toggle="t1"]');
await page.waitForTimeout(200);
let d = await doc(page, `manifests/${HELP}/tasks/t1`);
check(d.done === true && d.doneBy === 'Jordan' && d.pending === true && d.gBy === 'Jordan', 'check-off writes done + pending mark');
check(/SENT TO SAM/.test(await page.locator('.pm-sync').innerText()), 'header confirms it was sent');
await page.click('[data-open="t2"]');
await page.waitForTimeout(100);
await page.fill('form[data-edit="t2"] input[name="title"]', 'Label every bin');
await page.fill('form[data-edit="t2"] textarea[name="note"]', 'Using the blue labels');
await page.click('form[data-edit="t2"] button[type="submit"]');
await page.waitForTimeout(200);
d = await doc(page, `manifests/${HELP}/tasks/t2`);
check(d.title === 'Label every bin' && d.comments.length === 2 && d.comments[1].text === 'Using the blue labels' && d.pending, 'helper edits title and adds a note');
await page.fill('#pmAddIn', 'pick up extra bins tomorrow');
await page.press('#pmAddIn', 'Enter');
await page.waitForTimeout(250);
const added = await page.evaluate((tok) => [...window.__fake.docs.entries()].filter(([k, v]) => k.startsWith(`manifests/${tok}/tasks/`) && v.addedBy === 'Jordan').map(([, v]) => v), HELP);
check(added.length === 1 && /pick up extra bins/i.test(added[0].title) && added[0].due && added[0].pending, `helper adds a task with a parsed date (${added[0] && added[0].title})`);
check(/ADDED BY JORDAN/.test(await page.locator('#pm').innerText()), 'new task shows who added it');
await page.click('[data-open="t2"]');
await page.click('form[data-edit="t2"] [data-del]');
await page.click('form[data-edit="t2"] [data-del]');
await page.waitForTimeout(200);
d = await doc(page, `manifests/${HELP}/tasks/t2`);
check(d.deleted === true && d.pending === true, 'helper delete (two taps) marks the task deleted');
check(!/Label every bin/.test(await page.locator('#pm').innerText()), 'deleted task leaves the list');
await page.click('[data-tab="log"]');
await page.waitForTimeout(100);
check(/Spare key is under the planter/.test(await page.locator('#pm').innerText()), 'project log shows the owner\'s posts');
await page.fill('#pmPost textarea', 'Neighbor offered his truck Saturday');
await page.click('#pmPost button[type="submit"]');
await page.waitForTimeout(200);
const logs = await page.evaluate((tok) => [...window.__fake.docs.entries()].filter(([k]) => k.startsWith(`manifests/${tok}/log/`)).map(([, v]) => v), HELP);
check(logs.length === 1 && logs[0].by === 'Jordan', 'guest log post is written');
check(/Neighbor offered his truck/.test(await page.locator('#pm').innerText()) && /PROJECT LOG · 2/.test(await page.locator('.pm-tabs').innerText()), 'post appears right away');
await shot(page, 'helper-log');
// live update from the owner while typing
await page.fill('#pmPost textarea', 'half typed');
await page.evaluate((tok) => window.__fake.write(`manifests/${tok}/tasks/t1`, { ...window.__fake.docs.get(`manifests/${tok}/tasks/t1`), title: 'Sweep floor (owner edit)', pending: false }), HELP);
await page.waitForTimeout(150);
check((await page.inputValue('#pmPost textarea')) === 'half typed', 'typing survives live updates');
await page.click('[data-tab="list"]');
check(/Sweep floor \(owner edit\)/.test(await page.locator('#pm').innerText()), 'owner changes appear live');
await page.close();

// ---- check off + notes
page = await openGuest(NOTE, { name: 'Jordan' });
check(await page.locator('#pmAdd').count() === 0, 'notes access has no add-task bar');
await page.click('[data-open="t1"]');
await page.fill('form[data-note="t1"] textarea', 'Bought the sealer, it\'s on the bench.');
await page.click('form[data-note="t1"] button');
await page.waitForTimeout(200);
d = await doc(page, `manifests/${NOTE}/tasks/t1`);
check(d.comments.length === 1 && /sealer/.test(d.comments[0].text) && d.pending && d.title === 'Sweep & reseal floor', 'notes access adds a note without touching anything else');
await shot(page, 'notes-list');
await page.click('[data-tab="log"]');
check(await page.locator('#pmPost').count() === 1, 'notes access can post to the log');
await page.close();

// ---- check off only
page = await openGuest(CHK, { name: 'Maya' });
check(await page.locator('[data-open]').count() === 0, 'check-only access has no note or edit buttons');
await page.click('[data-tab="log"]');
check(await page.locator('#pmPost').count() === 0 && /Posting isn't part of your access/.test(await page.locator('#pm').innerText()), 'check-only access reads the log but cannot post');
await shot(page, 'check-log');
await page.close();

// ---- ended + invalid
page = await openGuest(OLD, { name: 'Jordan' });
check(/project is complete/i.test(await page.locator('#pm').innerText()), 'a finished project shows that the link has ended');
await shot(page, 'ended');
await page.close();
page = await openGuest('NopeNopeNopeNopeNopeNope');
check(/Link not found/.test(await page.locator('#pm').innerText()), 'unknown token shows link not found');
await page.close();
page = await openGuest(HELP, { name: 'Jordan' });
await page.evaluate((tok) => window.__fake.write(`manifests/${tok}`, { ...window.__fake.docs.get(`manifests/${tok}`), closed: true, closedReason: 'stopped' }), HELP);
await page.waitForTimeout(150);
check(/This link has ended/.test(await page.locator('#pm').innerText()), 'STOP takes effect on an open page');
await page.close();

// ---- subtasks: shown on tap, tickable at any access level
page = await openGuest(NOTE, { name: 'Jordan' });
await page.waitForSelector('#boot', { state: 'detached', timeout: 8000 }).catch(() => {});
let text = await page.locator('#pm').innerText();
check(/1\/3 SUBTASKS/.test(text), 'a task shows its subtask count'); check(/SUBTASKS ▾\s*SAM/.test(text), 'and who it is assigned to');
await page.click('[data-subs="t1"]');
await page.waitForTimeout(150);
text = await page.locator('#pm').innerText();
check(/Move the boxes out/.test(text) && /Roll on sealer/.test(text), 'tapping the task shows its subtasks');
await shot(page, 'subtasks');
await page.click('[data-sub="t1|b"]');
await page.waitForTimeout(300);
d = await doc(page, `manifests/${NOTE}/tasks/t1`);
check(d.pending && d.subtasks.find((x) => x.id === 'b').done === true && d.subtasks.length === 3, 'ticking a subtask sends just that tick');
check(/2\/3 SUBTASKS/.test(await page.locator('#pm').innerText()), 'the count updates right away');

console.log(results.join('\n'));
console.log(errors.length ? `\nERRORS:\n${errors.join('\n')}` : '\nno page errors');
console.log(`\n${results.filter((r) => r.startsWith('ok')).length}/${results.length} passed`);
await browser.close();
server.close();
