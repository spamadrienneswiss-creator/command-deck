// Drives the schedule link page in a phone-sized Chromium against the in-memory Firestore stand-in.
const { chromium } = await import(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright/index.mjs');
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../field-unit');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file;
  if (p === '/__/firebase/init.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ apiKey: 'k', projectId: 'demo', appId: 'a', authDomain: 'demo.firebaseapp.com' })); return; }
  if (p === '/lib/core.js') file = path.join(HERE, 'fake-core.js');
  else if (p === '/lib/real-core.js') file = path.join(ROOT, 'lib/core.js');
  else if (p === '/s' || p.startsWith('/s/')) file = path.join(ROOT, 'schedule.html');
  else file = path.join(ROOT, p === '/' ? 'index.html' : p);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise((r) => server.listen(5178, r));
const BASE = 'http://localhost:5178';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = new Date();
const mon = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
const day = (n) => ymd(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + n));
const TOK = 'ScheduleTokenAAAAAAAAAAA';
const OLD = 'ScheduleTokenClosedBBBBB';
const types = [{ id: 'appt', short: 'APPT', color: '#A8B0D8' }, { id: 'ldc', short: 'LDC', color: '#F2A65A' }, { id: 'metro', short: 'METRO', color: '#7FD1C7' }, { id: 'other', short: 'OTHER', color: '#B5B0BC' }];
const R = (extra = {}) => ({ deckId: 'deck_1', guest: 'Jordan', ends: 'month', expiresAt: null, closed: false, createdAt: Date.now(), owner: 'Sam', types, look: { theme: 'dusk' }, level: 'add', color: '#7FD1C7', ...extra });
const E = (id, type, title, date, note = '', by = null) => ({ id, type, title, date, note, pending: false, byName: by ? by[0] : 'SAM', byColor: by ? by[1] : '#F4B6A0', ...(by && by[2] ? { byToken: by[2] } : {}) });
const RO = 'ScheduleTokenReadOnlyCCCC';
const seed = {
  [`rosters/${TOK}`]: R(),
  [`rosters/${TOK}/entries/e1`]: { ...E('e1', 'ldc', 'Work shift', ymd(today)), start: '09:00', end: '14:00' },
  [`rosters/${TOK}/entries/e2`]: E('e2', 'appt', 'Dentist', day(((today.getDay() + 6) % 7) < 6 ? ((today.getDay() + 6) % 7) + 1 : 6), 'Need a ride home after.'),
  [`rosters/${TOK}/entries/e3`]: E('e3', 'metro', 'Movie night', day(6), 'I\'ll bring snacks', ['RILEY', '#D9A9C6']),
  [`rosters/${TOK}/entries/gMine`]: { ...E('gMine', 'other', 'Pick up groceries', ymd(today), '', ['JORDAN', '#7FD1C7', TOK]), start: '17:30' },
  [`rosters/${RO}`]: R({ guest: 'Casey', level: 'read', color: '#E8D58B' }),
  [`rosters/${RO}/entries/e1`]: E('e1', 'ldc', 'Work shift', ymd(today)),
  [`rosters/${TOK}/entries/e4`]: E('e4', 'other', 'Eye exam', day(9), 'Can you watch the dogs?'),
  [`rosters/${OLD}`]: R({ closed: true })
};
const results = [];
const errors = [];
const check = (cond, name) => results.push(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
const SHOTS = path.join(HERE, 'out', 'shots-sched');
fs.mkdirSync(SHOTS, { recursive: true });
let n = 0;
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${String(++n).padStart(2, '0')}-${name}.png`) });
async function open(url, { keepBoot = false } = {}) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(`console: ${m.text()}`); });
  await page.addInitScript(({ seed }) => { window.__seedDocs = seed; }, { seed });
  await page.goto(url);
  if (keepBoot) return page;
  await page.waitForSelector('#boot', { state: 'detached', timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(150);
  return page;
}
const doc = (page, p) => page.evaluate((p) => window.__fake.docs.get(p) || null, p);

let page = await open(`${BASE}/s/${TOK}`, { keepBoot: true });
check(await page.locator('#boot.s1 .sb-log').count() === 1 && /DECK RELAY \/\/ SHARED SCHEDULE/.test(await page.locator('#boot').innerText()), 'Signal load-up shows first, on the boot log');
await page.waitForSelector('#boot.s2', { timeout: 6000 });
let bt = await page.locator('#boot .sb-log').evaluate((el) => el.textContent);
check(/Relay uplink \.\.\. ONLINE/.test(bt) && /Link token · SAM'S SCHEDULE \.\.\. VALID/.test(bt) && /Access level \.\.\. READ \+ ADD/.test(bt), 'the log ticks through uplink, link and access');
check(/Entries this week \.\.\. \d+/.test(bt) && /Guest \.\.\. JORDAN/.test(bt) && /Opening the schedule/.test(bt), 'then this week\'s entries and the guest, and hands over');
await shot(page, 'boot-align');
check(/OPENING SCHEDULE/.test(await page.locator('#boot .sb-align').innerText()) && (await page.locator('#boot .sb-row').count()) === 6, 'alignment card with the schedule\'s six rows');
await page.waitForSelector('#boot.s3', { timeout: 3000 });
await page.waitForTimeout(700);
await shot(page, 'boot-radar');
check(/REACHING THE DECK/.test(await page.locator('#boot .sb-radar').innerText()), 'radar sweep');
await page.waitForSelector('#boot.s4', { timeout: 3000 });
await page.waitForTimeout(300);
await shot(page, 'boot-locked');
bt = await page.locator('#boot .sb-lock').innerText();
check(/SIGNAL LOCKED/.test(bt) && /Welcome, Jordan\./.test(bt) && /SAM'S SCHEDULE · READ \+ ADD/.test(bt), 'locks and greets them by name, with whose schedule and their access');
await page.waitForSelector('#boot', { state: 'detached', timeout: 6000 });
check(true, 'then fades away');
await shot(page, 'week');
let text = await page.locator('#pm').innerText();
check(/Sam's schedule/.test(text) && /THIS WEEK/.test(text), 'opens on this week with the owner\'s name');
check(/9:00 AM – 2:00 PM/.test(text), 'an entry with times shows them');
check((text.match(/\d (AM|PM)/g) || []).length === 3, 'entries without times show none');
check(/Work shift/.test(text) && /LDC/.test(text) && /METRO/.test(text) && /Dentist/.test(text), 'entries show with their type chips');
check(/Need a ride home after/.test(text), 'the owner\'s note shows');
check(!/Eye exam/.test(text), 'next week\'s entry waits for next week');
check(/Add to Home Screen/.test(text), 'Home Screen tip shows the first time');
check((await page.title()) === "Sam's Schedule" && (await page.getAttribute('#appTitle', 'content')) === "Sam's Schedule", 'Home Screen name is the owner\'s schedule');
check(!/GOT IT|CHANGE REQUEST/.test(text), 'no GOT IT / CHANGE REQUEST anywhere');
check(/EVERYONE ON THIS LINK SEES THE SAME SCHEDULE/.test(text), 'READ + ADD access line');
const chips = await page.locator('[data-entry="e1"] .sc-chips .sc-chip').allInnerTexts();
check(chips.length === 2 && /SAM/.test(chips[0]) && /LDC/.test(chips[1]), 'name chip sits before the type chip');
check(await page.locator('[data-entry="e3"] .sc-who').evaluate((el) => el.style.getPropertyValue('--tc')) === '#D9A9C6', 'another person\'s chip is in their color');
check(/RILEY: I'll bring snacks/.test(text), 'notes are prefixed with who wrote them');
check(await page.locator('[data-entry="gMine"] [data-edit]').count() === 1 && await page.locator('[data-entry="e1"] [data-edit]').count() === 0 && await page.locator('[data-entry="e3"] [data-edit]').count() === 0, 'EDIT / DELETE only on their own entries');
check(await page.locator('.sg-add').count() === 1, '+ ADD TO SCHEDULE shows');

await page.click('.sg-add');
await page.waitForTimeout(200);
check(await page.locator('#sgForm').count() === 1, 'add sheet opens');
let sheet = await page.locator('.sheet').innerText();
check(/ADD TO SAM'S SCHEDULE/.test(sheet) && /Shows as/.test(sheet) && /JORDAN/.test(sheet), 'sheet shows who it will show as');
check(!/LOCATION/i.test(sheet), 'no location field');
await shot(page, 'add-sheet');
await page.click('.sheet button[type="submit"]');
await page.waitForTimeout(150);
check(await page.locator('#sgForm').count() === 1, 'no title: the sheet stays open');
await page.click('.sheet [data-type="appt"]');
await page.fill('#sgTitle', 'Vet for Biscuit');
await page.fill('#sgDate', day(4));
await page.fill('#sgStart', '10:00');
await page.fill('#sgNote', 'Can someone drive?');
await shot(page, 'add-filled');
await page.click('.sheet button[type="submit"]');
await page.waitForTimeout(400);
const added = await page.evaluate((t) => [...window.__fake.docs.entries()].filter(([k, v]) => k.startsWith(`rosters/${t}/entries/g`) && v.title === 'Vet for Biscuit').map(([k, v]) => ({ k, ...v }))[0] || null, TOK);
check(added && added.pending === true && added.byToken === TOK && added.byName === 'JORDAN' && added.byColor === '#7FD1C7' && added.type === 'appt' && added.start === '10:00' && added.gBy === 'Jordan', 'ADD IT writes their entry, pending, with their chip');
const allowed = ['id', 'type', 'title', 'date', 'start', 'end', 'note', 'byToken', 'byName', 'byColor', 'pending', 'gBy', 'gAt', 'deleted'];
check(added && Object.keys(added).filter((k) => k !== 'k').every((k) => allowed.includes(k)), 'only fields the rules allow');
text = await page.locator('#pm').innerText();
check(/Vet for Biscuit/.test(text) && /JORDAN: Can someone drive\?/.test(text), 'shows right away');
await shot(page, 'added');

await page.click('[data-entry="gMine"] [data-edit]');
await page.waitForTimeout(200);
check((await page.inputValue('#sgTitle')) === 'Pick up groceries' && /EDIT YOUR ENTRY/.test(await page.locator('.sheet').innerText()), 'EDIT opens their entry filled in');
await page.fill('#sgTitle', 'Pick up groceries + cake');
await page.click('.sheet button[type="submit"]');
await page.waitForTimeout(300);
let gm = await doc(page, `rosters/${TOK}/entries/gMine`);
check(gm.title === 'Pick up groceries + cake' && gm.pending === true && gm.byToken === TOK, 'SAVE writes the change');

await page.click('[data-entry="gMine"] [data-del]');
await page.waitForTimeout(100);
check((await page.locator('[data-entry="gMine"] [data-del]').innerText()) === 'CONFIRM', 'DELETE asks to confirm');
await page.click('[data-entry="gMine"] [data-del]');
await page.waitForTimeout(300);
gm = await doc(page, `rosters/${TOK}/entries/gMine`);
check(gm.deleted === true && gm.pending === true && gm.title, 'delete is a soft delete for the owner\'s app');
check(!/Pick up groceries/.test(await page.locator('#pm').innerText()), 'and it disappears');

// the gear
await page.click('[data-look]');
await page.waitForTimeout(200);
sheet = await page.locator('.sheet').innerText();
check(/YOUR VIEW · ONLY ON THIS PHONE/.test(sheet) && /MOONBASE/.test(sheet) && /SKYDOCK/.test(sheet) && /VECTOR/.test(sheet) && /BLUEPRINT/.test(sheet), 'gear opens YOUR VIEW with the themes');
check(/MICHROMA/.test(sheet) && /SPACE MONO/.test(sheet) && /VT323/.test(sheet) && /ORBITRON/.test(sheet) && /THEME DEFAULT/.test(sheet), 'typefaces listed');
check(/DARK/.test(sheet) && /BONE/.test(sheet) && /MIDNIGHT NAVY/.test(sheet) && /USE SAM'S LOOK/.test(sheet), 'frames and reset listed');
await shot(page, 'look-sheet');
await page.click('[data-look-theme="skydock"]');
await page.click('[data-look-frame="bone"]');
await page.click('[data-look-font="orbitron"]');
await page.waitForTimeout(150);
let ds = await page.evaluate(() => ({ ...document.body.dataset }));
check(ds.theme === 'skydock' && ds.frame === 'bone' && ds.font === 'orbitron' && ds.light === '1', 'picks apply to the page');
await page.click('.sheet [data-close]');
await page.waitForTimeout(200);
await shot(page, 'look-skydock-bone');
await page.reload();
await page.waitForSelector('#boot', { state: 'detached', timeout: 8000 }).catch(() => {});
await page.waitForTimeout(300);
ds = await page.evaluate(() => ({ ...document.body.dataset }));
check(ds.theme === 'skydock' && ds.frame === 'bone', 'the look stays on this phone');
await page.click('[data-look]');
await page.click('[data-look-theme="vector"]');
await page.click('[data-look-frame="navy"]');
await page.click('[data-look-font="auto"]');
await page.click('.sheet [data-close]');
await page.waitForTimeout(200);
await shot(page, 'look-vector-navy');
await page.click('[data-look]');
await page.click('[data-look-reset]');
await page.waitForTimeout(200);
ds = await page.evaluate(() => ({ ...document.body.dataset }));
check(ds.theme === 'dusk' && ds.frame === 'dark' && !ds.light, "USE SAM'S LOOK goes back");

await page.click('[data-week="1"]');
await page.waitForTimeout(150);
text = await page.locator('#pm').innerText();
check(/NEXT WEEK/.test(text) && /Eye exam/.test(text) && /Can you watch the dogs/.test(text), '› shows next week');
check(/BACK TO THIS WEEK/.test(text), 'a way back to this week appears');
await shot(page, 'next-week');
await page.click('[data-week="1"]');
await page.waitForTimeout(150);
check(/Nothing scheduled that week/.test(await page.locator('#pm').innerText()), 'an empty week says so');

await page.click('[data-tip-x]');
await page.waitForTimeout(100);
await page.reload();
await page.waitForTimeout(600);
check(!/Add to Home Screen/.test(await page.locator('#pm').innerText()), 'dismissed tip stays dismissed');


page = await open(`${BASE}/s/${RO}`);
text = await page.locator('#pm').innerText();
check(/SHARED SCHEDULE · READ ONLY/.test(text) && await page.locator('.sg-add').count() === 0 && await page.locator('[data-edit]').count() === 0, 'READ ONLY: no add, no edit');
check(await page.locator('[data-look]').count() === 1, 'READ ONLY still gets the gear');
await shot(page, 'read-only');

page = await open(`${BASE}/s#${TOK}`);
check(new URL(page.url()).pathname === `/s/${TOK}`, '#token links move to /s/token for the Home Screen');
check(/Sam's schedule/.test(await page.locator('#pm').innerText()), 'and still open the schedule');

page = await open(`${BASE}/s/${OLD}`);
check(/This link has ended/.test(await page.locator('#pm').innerText()), 'a stopped link says it ended');
page = await open(`${BASE}/s/NotARealTokenXXXXXXXXXXX`);
check(/Link not found/.test(await page.locator('#pm').innerText()), 'an unknown link says not found');

console.log(results.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
console.log(`${results.filter((r) => r.startsWith('ok')).length}/${results.length} passed`);
await browser.close();
server.close();
