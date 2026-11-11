// Field Unit Terminal looks (Cockpit, Hairline): home, queue, sheets, comms + Gemini, settings picker.
const { chromium } = await import(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright/index.mjs');
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../field-unit');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const SHOTS = path.join(HERE, 'out', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['terminal']) fs.mkdirSync(path.join(HERE, 'out', d), { recursive: true });
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file;
  if (p === '/__/firebase/init.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ apiKey: 'k', projectId: 'demo', appId: 'a', authDomain: 'demo.firebaseapp.com' })); return; }
  if (p === '/lib/core.js') file = path.join(HERE, 'fake-core.js');
  else if (p === '/lib/real-core.js') file = path.join(ROOT, 'lib/core.js');
  else file = path.join(ROOT, p === '/' ? 'index.html' : p);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise((r) => server.listen(5181, r));
const BASE = 'http://localhost:5181';

const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
await ctx.route(/fonts\.(googleapis|gstatic)\.com|open-meteo/, (r) => r.abort());
await ctx.grantPermissions(['microphone']);
// Fake Gemini: model list, chat replies (JSON), briefing text and speech (PCM).
const calls = [];
await ctx.route(/generativelanguage\.googleapis\.com/, async (route) => {
  const req = route.request();
  const url = req.url();
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  calls.push({ url, body });
  const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  if (!body) return json({ models: [{ name: 'models/gemini-flash-latest', supportedGenerationMethods: ['generateContent'] }] });
  const cand = (parts) => json({ candidates: [{ content: { parts } }] });
  if (body.generationConfig && body.generationConfig.responseModalities) {
    const pcm = new Int16Array(2400); for (let i = 0; i < pcm.length; i++) pcm[i] = Math.round(Math.sin(i / 8) * 3000);
    return cand([{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: Buffer.from(pcm.buffer).toString('base64') } }]);
  }
  if (!body.generationConfig || !body.generationConfig.responseSchema) return cand([{ text: 'Good evening, Sam. The electric bill is still waiting on you, and the dentist is up next.' }]);
  const last = body.contents[body.contents.length - 1].parts;
  if (last.some((p) => p.inlineData)) return cand([{ text: JSON.stringify({ heard: 'add eggs to the list', reply: 'ignored' }) }]);
  const said = last.map((p) => p.text || '').join(' ');
  if (/dentist/i.test(said)) return cand([{ text: JSON.stringify({ heard: said, reply: 'Your shift is Thursday at nine, so Friday morning is open. Want a reminder to call the office?', suggestion: { kind: 'task', title: "Call Dr. Lee's office", at: '2030-01-04T09:00', label: 'Add reminder' } }) }]);
  return cand([{ text: JSON.stringify({ heard: said, reply: 'Noted.' }) }]);
});

const now = Date.now();
const iso = (h) => new Date(now + h * 3600000).toISOString();
const seed = {
  'fu.deckId': 'deck_1',
  'fu.shared': { operatorName: 'Adri', consoleName: 'Command Deck', categories: [{ id: 'work', name: 'Work', color: '#F4B6A0' }, { id: 'home', name: 'Home', color: '#F2A65A' }], people: ['Me'] },
  'fu.command': { lastSeen: now },
  'fu.projects': [{ id: 'p1', name: 'Garage cleanout', color: '#F2A65A', due: iso(24 * 18), status: 'active', createdAt: iso(-48) }, { id: 'p2', name: 'Holiday party', color: '#D9A9C6', due: iso(24 * 60), status: 'active', createdAt: iso(-40) }],
  'fu.tasks': [
    { id: 't1', title: 'Pay electric bill', due: iso(2), dueHasTime: true, priority: 'high', category: 'home', done: false, repeat: { type: 'none' }, subtasks: [] },
    { id: 't2', title: 'Sweep & reseal floor', due: null, priority: 'medium', category: null, projectId: 'p1', done: false, repeat: { type: 'none' }, subtasks: [] },
    { id: 't3', title: 'Haul boxes', due: null, priority: 'low', projectId: 'p1', done: true, doneAt: iso(-20), repeat: { type: 'none' }, subtasks: [] },
    { id: 't4', title: 'Order decorations', due: iso(48), dueHasTime: false, priority: 'medium', category: 'work', projectId: 'p2', done: false, repeat: { type: 'none' }, subtasks: [] }
  ],
  'fu.comms': [
    { id: 'c1', k: 'sep', text: 'WED 14 OCT · 3:58 PM', at: now },
    { id: 'c2', k: 'fu', text: 'Field Unit online. Go ahead, Adri.', tone: 'sys', at: now },
    { id: 'c3', k: 'you', text: 'add buy string lights to the holiday party project', at: now },
    { id: 'c4', k: 'fu', text: 'Copy. Buy string lights. Filed under Holiday party.', at: now },
    { id: 'c5', k: 'fu', text: 'Transmitting data to Command…', tone: 'dim', at: now },
    { id: 'c6', k: 'card', head: 'TASK LOGGED', tone: 'ok', fields: [['TITLE', 'Buy string lights'], ['PRIORITY', 'MED'], ['PROJECT', 'Holiday party']], undo: true, at: now },
    { id: 'c7', k: 'fu', text: 'Command acknowledges.', tone: 'ok', at: now },
    { id: 'c8', k: 'you', text: 'delete book flights', at: now },
    { id: 'c9', k: 'fu', text: 'Request to delete Book flights. Confirm?', tone: 'warn', at: now },
    { id: 'c10', k: 'card', head: 'CONFIRM DELETE', tone: 'warn', fields: [['ITEM', 'Book flights'], ['DETAILS', 'PERSONAL · NO DATE']], confirm: true, state: 'kept', at: now }
  ]
};


const OUT = path.join(HERE, 'out', 'terminal');
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) fails++; };
const LOOK = process.env.LOOK || '';
const events = [
  { id: 'e1', title: 'Dentist', start: new Date(now + 2 * 864e5).toISOString(), end: new Date(now + 2 * 864e5 + 3600e3).toISOString(), allDay: false, notes: '' },
  { id: 'e2', title: 'Work shift', start: new Date(now + 0.6 * 864e5).toISOString(), end: new Date(now + 0.6 * 864e5 + 5 * 3600e3).toISOString(), allDay: false, notes: '' },
  { id: 'e3', title: 'Dinner with the Parks', start: new Date(now + 5 * 864e5).toISOString(), end: new Date(now + 5 * 864e5 + 2 * 3600e3).toISOString(), allDay: false, notes: '' }
];
seed['fu.tasks'][0].due = new Date(now - 3 * 3600e3).toISOString();
seed['fu.tasks'].push({ id: 't5', title: 'Order bin labels', due: new Date(new Date().setHours(23, 0, 0, 0)).toISOString(), dueHasTime: false, priority: 'medium', category: 'home', done: false, repeat: { type: 'none' }, subtasks: [] });
seed['fu.tasks'].push({ id: 't6', title: 'Renew car registration', due: iso(24 * 4), dueHasTime: false, priority: 'medium', category: null, done: false, repeat: { type: 'none' }, subtasks: [] });

for (const look of LOOK ? [LOOK] : ['cockpit', 'hairline']) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { console.log('pageerror', e.message); fails++; });
  await page.addInitScript(({ seed, events, look }) => {
    if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
    localStorage.clear();
    for (const [k, v] of Object.entries(seed)) if (k !== 'fu.comms') localStorage.setItem(k, JSON.stringify(v));
    localStorage.setItem('fu.events', JSON.stringify(events));
    localStorage.setItem('fu.gemini', JSON.stringify({ key: 'AIzaTEST' }));
    window.__seedDocs = { 'decks/deck_1/fuConfig/main': { geminiKey: 'AIzaTEST' } };
    localStorage.setItem('fu.settings', JSON.stringify({ theme: 'hivis', installDismissed: true, ui: look }));
  }, { seed, events, look });
  await page.goto(BASE);
  await page.waitForFunction(() => !document.querySelector('#boot'), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(700);
  check(await page.evaluate((l) => document.body.classList.contains('ft-live') && document.body.dataset.theme === l && !!document.querySelector(`#ft[data-look="${l}"]`), look), `${look}: is the home screen and wears its theme`);
  check(/Pay electric bill/.test(await page.textContent('#ft')), `${look}: overdue shows`);
  check(/Dentist|DENTIST/.test(await page.textContent('#ft')), `${look}: upcoming events show`);
  await page.screenshot({ path: path.join(OUT, `${look}-home.png`) });
  await page.screenshot({ path: path.join(OUT, `${look}-home-full.png`), fullPage: false });
  // Queue
  await page.click('#ft [data-ft="tasks"]'); await page.waitForTimeout(250);
  check(await page.$('#ft [data-ft-done="t1"]') !== null, `${look}: queue lists tasks`);
  await page.screenshot({ path: path.join(OUT, `${look}-queue.png`) });
  await page.click('#ft [data-ft-done="t5"]'); await page.waitForTimeout(500);
  check(await page.evaluate(() => JSON.parse(localStorage.getItem('fu.tasks')).find((t) => t.id === 't5').done === true), `${look}: tick marks done`);
  await page.click('#ft [data-ft-tab="projects"]'); await page.waitForTimeout(200);
  check((await page.$$('#ft [data-ft-pj]')).length === 2, `${look}: projects`);
  await page.screenshot({ path: path.join(OUT, `${look}-projects.png`) });
  await page.click('#ft [data-ft-tab="done"]'); await page.waitForTimeout(200);
  await page.click('#ft [data-ft-done="t5"]'); await page.waitForTimeout(400);
  check(await page.evaluate(() => JSON.parse(localStorage.getItem('fu.tasks')).find((t) => t.id === 't5').done === false), `${look}: untick from Done`);
  await page.click('#ft [data-ft-tab="queue"]');
  await page.click('#ft [data-ft-go="home"]'); await page.waitForTimeout(200);
  // Task editor sheet
  await page.click('#ft [data-ft-task="t1"]'); await page.waitForTimeout(400);
  check(await page.$('.sheet') !== null, `${look}: tapping a task opens the editor`);
  await page.screenshot({ path: path.join(OUT, `${look}-sheet.png`) });
  await page.evaluate(() => { const b = document.querySelector('.sheet-back'); if (b) b.click(); });
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await page.evaluate(() => { document.querySelectorAll('.sheet-back').forEach((b) => b.remove()); });
  // Comms through the command bar
  await page.fill('#ftCmd', 'add buy milk tomorrow');
  await page.press('#ftCmd', 'Enter'); await page.waitForTimeout(2500);
  check(await page.evaluate(() => JSON.parse(localStorage.getItem('fu.tasks')).some((t) => /milk/i.test(t.title))), `${look}: typed command files a task`);
  await page.fill('#ctText', 'can i fit the dentist in before my shift?');
  await page.press('#ctText', 'Enter'); await page.waitForTimeout(3500);
  check(calls.some((c) => c.body && JSON.stringify(c.body).includes('dentist')), `${look}: questions go to Gemini`);
  await page.screenshot({ path: path.join(OUT, `${look}-comms.png`) });
  await page.click('[data-ct="close"]'); await page.waitForTimeout(300);
  // Calendar and settings via peek, then back
  await page.click('#ft [data-ft="settings"]'); await page.waitForTimeout(300);
  check(await page.$('[data-ui-pick="hairline"]') !== null && await page.$('.ft-back') !== null, `${look}: settings has the interface picker and a way back`);
  await page.screenshot({ path: path.join(OUT, `${look}-settings.png`) });
  await page.click('.ft-back'); await page.waitForTimeout(300);
  check(await page.evaluate(() => document.body.classList.contains('ft-live')), `${look}: back returns to the look`);
  await page.click('#ft [data-ft="agenda"]'); await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${look}-calendar.png`) });
  await page.click('.ft-back'); await page.waitForTimeout(250);
  await page.click('#ft [data-ft="notes"]'); await page.waitForTimeout(300);
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, `${look}-notes.png`) });
  await page.click('.ft-back'); await page.waitForTimeout(250);
  await page.click('#ft [data-ft="agenda"]'); await page.waitForTimeout(300);
  if (look === 'hairline') { check(await page.evaluate(() => getComputedStyle(document.querySelector('.tabbar')).display === 'none'), `${look}: no tab bar`); await page.click('.ft-back'); }
  else await page.click('.tab[data-view="today"]');
  await page.waitForTimeout(300);
  check(await page.evaluate(() => document.body.classList.contains('ft-live')), `${look}: Today tab / back returns to the look`);
  // Switch to classic and back
  await page.click('#ft [data-ft="settings"]'); await page.waitForTimeout(300);
  await page.click('[data-ui-pick="classic"]'); await page.waitForTimeout(300);
  check(await page.evaluate(() => !document.body.classList.contains('ft-live') && document.body.dataset.theme === 'hivis'), `${look}: Classic brings back the color theme`);
  await page.click('[data-ui-pick="cockpit"]'); await page.waitForTimeout(300);
  await page.close();
}
await browser.close();
server.close();
console.log(fails ? `${fails} FAILED` : 'terminal: all passed');
process.exit(fails ? 1 : 0);
