// The "Signal" load-up screens on Field Unit and both shared links, plus Data Recap's send flow on
// the phone, in a phone-sized Chromium against the in-memory Firestore stand-in.
// Screenshots of each boot stage land in tools/ui-tests/out/shots-signal/.
const { chromium } = await import(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright/index.mjs');
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../field-unit');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const SHOTS = path.join(HERE, 'out', 'shots-signal');
fs.mkdirSync(SHOTS, { recursive: true });
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file;
  if (p === '/__/firebase/init.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ apiKey: 'k', projectId: 'demo', appId: 'a', authDomain: 'demo.firebaseapp.com' })); return; }
  if (p === '/lib/core.js') file = path.join(HERE, 'fake-core.js');
  else if (p === '/lib/real-core.js') file = path.join(ROOT, 'lib/core.js');
  else if (p === '/m') file = path.join(ROOT, 'manifest.html');
  else if (p === '/s' || p.startsWith('/s/')) file = path.join(ROOT, 'schedule.html');
  else file = path.join(ROOT, p === '/' ? 'index.html' : p);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise((r) => server.listen(5181, r));
const BASE = 'http://localhost:5181';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
await ctx.route(/fonts\.(googleapis|gstatic)\.com|open-meteo/, (r) => r.abort());

const results = [];
const errors = [];
const check = (cond, name) => results.push(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
let n = 0;
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${String(++n).padStart(2, '0')}-${name}.png`) });
const now = Date.now();
function watch(page) {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(`console: ${m.text()}`); });
}
/** Walks a page's boot through every stage, screenshotting each. Returns the log and lock text. */
async function walk(page, tag) {
  await page.waitForSelector('#boot.s1', { timeout: 4000 });
  await page.waitForTimeout(500);
  await shot(page, `${tag}-1-log`);
  await page.waitForSelector('#boot.s2', { timeout: 8000 });
  const log = await page.locator('#boot .sb-log').evaluate((el) => el.textContent);
  await page.waitForTimeout(650);
  await shot(page, `${tag}-2-align`);
  const align = await page.locator('#boot .sb-align').innerText();
  await page.waitForSelector('#boot.s3', { timeout: 3000 });
  await page.waitForTimeout(750);
  await shot(page, `${tag}-3-radar`);
  await page.waitForSelector('#boot.s4', { timeout: 3000 });
  await page.waitForTimeout(350);
  await shot(page, `${tag}-4-locked`);
  const lock = await page.locator('#boot .sb-lock').innerText();
  await page.waitForSelector('#boot', { state: 'detached', timeout: 4000 });
  return { log, align, lock };
}

// ---- Field Unit
const local = {
  'fu.deckId': 'deck_1',
  'fu.settings': { theme: 'dusk', installDismissed: true, commsSound: 'off' },
  'fu.shared': { operatorName: 'Sam', consoleName: 'Command Deck', categories: [], people: ['Me'], location: { lat: 33.9, lon: -118.0 }, recapAudio: 'd30', recapSummaries: true },
  'fu.command': { lastSeen: now },
  'fu.tasks': [{ id: 't1', title: 'Label bins', due: null, priority: 'low', done: false, repeat: { type: 'none' }, subtasks: [] }],
  'fu.notes': [{ id: 'n1', title: "Grandma's chili", body: '2 lb ground beef', src: 'scan', createdAt: new Date(now - 3600e3).toISOString() }]
};
const fuSeed = { 'decks/deck_1/members/phone-uid': { kind: 'phone', name: 'Field Unit' }, 'decks/deck_1/meta/command': { lastSeen: now } };
let page = await ctx.newPage();
watch(page);
await page.addInitScript(({ local, seed }) => { window.__seedDocs = seed; if (!sessionStorage.getItem('seeded')) { localStorage.clear(); for (const [k, v] of Object.entries(local)) localStorage.setItem(k, JSON.stringify(v)); sessionStorage.setItem('seeded', '1'); } }, { local, seed: fuSeed });
await page.goto(BASE);
check(/FIELD UNIT SELF-TEST/.test(await page.locator('#boot').innerText()), 'Field Unit: the boot log paints first');
check(/FIELD UNIT · 33\.90° N · 118\.00° W/.test(await page.locator('#boot .sb-foot').innerText()), 'Field Unit: location in the footer');
let b = await walk(page, 'fu');
check(/Local cache \(1 task, 1 note\) \.\.\. OK/.test(b.log) && /Sync relay \.\.\. ONLINE/.test(b.log) && /Operator profile \.\.\. SAM/.test(b.log), 'Field Unit: the log ticks through real steps');
check(/Hailing Command Deck/.test(b.log), 'Field Unit: hands over to Command');
check(/ALIGNING LINK/.test(b.align) && /CHRONO/.test(b.align) && /UPLINK/.test(b.align), 'Field Unit: alignment rows');
check(/SIGNAL LOCKED/.test(b.lock) && /Welcome back, Sam\./.test(b.lock), 'Field Unit: locks and welcomes them back');

// ---- Data Recap: pick a recording, send it in pieces
await page.click('.tab[data-view="notes"]');
await page.waitForTimeout(300);
let text = await page.locator('#view').innerText();
check(/FIELD SCAN|DATA RECAP/.test(text) && /DATA RECAP/.test(text), 'Notes tab: DATA RECAP button');
check(!/HOW IT WORKS/.test(text), 'no how-it-works box');
await shot(page, 'notes-tab');
const audio = fs.readFileSync(path.join(HERE, '../../test/fixtures/tone-3s.m4a'));
const big = Buffer.concat([audio, Buffer.alloc(1600 * 1024)]); // pad past two pieces
await page.setInputFiles('#recapInput', { name: 'New Recording 14.m4a', mimeType: 'audio/mp4', buffer: big });
await page.waitForSelector('#rcGo', { timeout: 3000 });
text = await page.locator('.sheet').innerText();
check(/AUDIO AFTER THE RECAP/.test(text) && /KEEP/.test(text) && /30 DAYS/.test(text) && /DELETE NOW/.test(text), 'send sheet: the three audio choices');
check(/New Recording 14/.test(await page.inputValue('#rcTitle')), 'send sheet: title from the file name');
await page.click('[data-keep="keep"]');
check(/Kept on Command until you delete it/.test(await page.locator('.sheet').innerText()), 'send sheet: the note under the choice changes');
await page.fill('#rcTitle', 'Kitchen remodel call');
await shot(page, 'recap-send');
await page.click('#rcGo');
await page.waitForFunction(() => [...window.__fake.docs.keys()].some((k) => k.startsWith('decks/deck_1/recapUploads/')), null, { timeout: 5000 });
const up = await page.evaluate(() => { const e = [...window.__fake.docs.entries()].find(([k]) => k.startsWith('decks/deck_1/recapUploads/')); return e && e[1]; });
const pieces = await page.evaluate(() => [...window.__fake.docs.keys()].filter((k) => k.startsWith('decks/deck_1/recapChunks/')).length);
check(up && up.complete && up.chunks === 3 && pieces === 3, 'the recording goes up in pieces, then the "complete" note');
check(up && up.title === 'Kitchen remodel call' && up.audio === 'keep' && up.size === big.length, 'the upload carries the title, size and audio choice');
const note = await page.evaluate(() => JSON.parse(localStorage.getItem('fu.notes')).find((x) => x.src === 'recap'));
check(note && note.recap && note.recap.status === 'queued' && note.recap.audio.keep === 'keep', 'a recap note waits for Command');
await page.waitForTimeout(300);
text = await page.locator('.sheet').innerText();
check(/Uplink complete/.test(text) && /Safe to close Field Unit/.test(text), 'status: uplink complete, safe to close');
await shot(page, 'recap-sent');
await page.close();

// ---- schedule link
const TOK = 'ScheduleTokenAAAAAAAAAAA';
const types = [{ id: 'appt', short: 'APPT', color: '#A8B0D8' }];
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const sSeed = {
  [`rosters/${TOK}`]: { deckId: 'deck_1', guest: 'Jordan', ends: 'month', expiresAt: null, closed: false, createdAt: now, owner: 'Sam', types, look: { theme: 'dusk' }, level: 'add', color: '#7FD1C7' },
  [`rosters/${TOK}/entries/e1`]: { id: 'e1', type: 'appt', title: 'Dentist', date: ymd(new Date()), pending: false, byName: 'SAM', byColor: '#F4B6A0' }
};
page = await ctx.newPage();
watch(page);
await page.addInitScript(({ seed }) => { window.__seedDocs = seed; localStorage.clear(); }, { seed: sSeed });
await page.goto(`${BASE}/s/${TOK}`);
b = await walk(page, 'sched');
check(/Link token · SAM'S SCHEDULE \.\.\. VALID/.test(b.log) && /Access level \.\.\. READ \+ ADD/.test(b.log) && /Entries this week \.\.\. 1/.test(b.log), 'schedule link: real log lines');
check(/OPENING SCHEDULE/.test(b.align) && /THIS WEEK/.test(b.align), 'schedule link: its own alignment rows');
check(/Welcome, Jordan\./.test(b.lock) && /SAM'S SCHEDULE · READ \+ ADD/.test(b.lock), 'schedule link: welcomes the guest by name');
await page.close();

// ---- project link
const PT = 'HelperTokenAAAAAAAAAAAAA';
const T = (id, title, extra = {}) => ({ id, title, due: null, dueHasTime: false, done: false, doneAt: null, doneBy: null, addedBy: null, comments: [], pending: false, ...extra });
const pSeed = {
  [`manifests/${PT}`]: { deckId: 'deck_1', projectId: 'p1', guest: 'Riley', level: 'helper', ends: 'done', expiresAt: null, closed: false, createdAt: now, owner: 'Sam', project: { name: 'Kitchen remodel', goal: '', status: 'active', color: '#F2A65A' }, log: [], look: { theme: 'dusk' } },
  [`manifests/${PT}/tasks/t1`]: T('t1', 'Send cabinet color'),
  [`manifests/${PT}/tasks/t2`]: T('t2', 'Book the plumber'),
  [`manifests/${PT}/tasks/t3`]: T('t3', 'Pick tile', { done: true })
};
page = await ctx.newPage();
watch(page);
await page.addInitScript(({ seed, tok }) => { window.__seedDocs = seed; localStorage.clear(); localStorage.setItem(`pm.name.${tok}`, 'Riley'); }, { seed: pSeed, tok: PT });
await page.goto(`${BASE}/m#${PT}`);
b = await walk(page, 'project');
check(/Link token · SAM'S DECK \.\.\. VALID/.test(b.log) && /Project \.\.\. KITCHEN REMODEL/.test(b.log) && /Open tasks \.\.\. 2/.test(b.log) && /Guest \.\.\. RILEY/.test(b.log), 'project link: real log lines');
check(/OPENING PROJECT/.test(b.align) && /SUBTASKS/.test(b.align) && /CREW/.test(b.align), 'project link: its own alignment rows');
check(/Welcome, Riley\./.test(b.lock) && /KITCHEN REMODEL · PROJECT ADMINISTRATOR/.test(b.lock), 'project link: welcomes them with the project and access');
await page.close();

// ---- reduced motion skips straight from the log to the lock
const rctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', isMobile: true, hasTouch: true });
await rctx.route(/fonts\.(googleapis|gstatic)\.com|open-meteo/, (r) => r.abort());
page = await rctx.newPage();
watch(page);
await page.addInitScript(({ seed }) => { window.__seedDocs = seed; localStorage.clear(); }, { seed: sSeed });
await page.goto(`${BASE}/s/${TOK}`);
let saw = new Set();
for (let i = 0; i < 40; i++) {
  const cls = await page.evaluate(() => { const el = document.getElementById('boot'); return el ? el.className : 'gone'; });
  if (cls === 'gone') break;
  (cls.match(/s[1-4]/g) || []).forEach((s) => saw.add(s));
  await page.waitForTimeout(100);
}
check(saw.has('s1') && saw.has('s4') && !saw.has('s2') && !saw.has('s3'), 'reduced motion: log, then straight to the lock');

console.log(results.join('\n'));
console.log(errors.length ? `\nERRORS:\n${errors.join('\n')}` : '\nno page errors');
const fails = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`${results.length - fails}/${results.length} passed`);
await browser.close();
server.close();
process.exit(fails || errors.length ? 1 : 0);
