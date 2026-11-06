// Your themes on Field Unit: starred list, ALL THEMES sheet, sharing with the deck.
// Drives Field Unit in a phone-sized Chromium against an in-memory Firestore stand-in.
const { chromium } = await import(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright/index.mjs');
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../field-unit');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const SHOTS = path.join(HERE, 'out', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['shots-guest', 'themes', 'favs']) fs.mkdirSync(path.join(HERE, 'out', d), { recursive: true });
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
await new Promise((r) => server.listen(5179, r));
const BASE = 'http://localhost:5179';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
await ctx.route(/fonts\.(googleapis|gstatic)\.com|open-meteo/, (r) => r.abort());

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

// Your themes: only starred themes show in Settings; the ALL THEMES sheet stars them,
// and the list is shared with the deck through decks/{id}/meta/themes.
const OUT = path.join(HERE, 'out', 'favs');
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) fails++; };
const page = await ctx.newPage();
page.on('pageerror', (e) => { console.log('pageerror', e.message); fails++; });
await page.addInitScript(({ seed }) => { if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1'); localStorage.clear(); for (const [k, v] of Object.entries(seed)) (k === 'fu.comms' ? sessionStorage : localStorage).setItem(k, JSON.stringify(v)); localStorage.setItem('fu.settings', JSON.stringify({ theme: 'dusk', ui: 'classic', installDismissed: true })); }, { seed });
await page.goto(BASE);
await page.waitForFunction(() => !document.querySelector('#boot'), null, { timeout: 15000 }).catch(() => {});
await page.click('.gear-btn'); await page.waitForTimeout(200);
const chips = () => page.$$eval('[data-theme-pick]', (els) => els.map((e) => e.dataset.themePick));
check((await chips()).length === 13, 'never edited: every theme shows');
check(/PICK YOURS/.test(await page.textContent('[data-theme-all]')), 'never edited: offers PICK YOURS');
await page.click('[data-theme-all]'); await page.waitForTimeout(200);
for (const v of ['space', 'red', 'terminal', 'retro', 'blueprint', 'cryo', 'freighter', 'vector', 'hivis']) await page.click(`[data-star="${v}"]`);
await page.screenshot({ path: path.join(OUT, 'sheet.png') });
check(await page.$eval('[data-star="dusk"]', (b) => b.disabled), 'theme in use cannot be unstarred');
await page.click('[data-close]'); await page.waitForTimeout(200);
check(JSON.stringify(await chips()) === JSON.stringify(['dusk', 'moonbase', 'skydock', 'horizon']), 'settings shows only the 4 starred');
check(/\+ 9 MORE/.test(await page.textContent('[data-theme-all]')), 'shows + 9 MORE');
await page.screenshot({ path: path.join(OUT, 'settings.png') });
const meta = await page.evaluate(() => window.__fake.docs.get('decks/deck_1/meta/themes'));
check(meta && JSON.stringify(meta.favs) === JSON.stringify(['dusk', 'moonbase', 'skydock', 'horizon']) && meta.at > 0, 'starred list shared to meta/themes');
// The deck changes the list later: the phone follows.
await page.evaluate(() => window.__fake.write('decks/deck_1/meta/themes', { favs: ['dusk', 'hivis'], at: Date.now() + 5000 }));
await page.waitForTimeout(300);
check(JSON.stringify(await chips()) === JSON.stringify(['dusk', 'hivis']), 'follows a newer list from the deck');
// An older list from the deck doesn't overwrite.
await page.evaluate(() => window.__fake.write('decks/deck_1/meta/themes', { favs: ['dusk'], at: 5 }));
await page.waitForTimeout(300);
check(JSON.stringify(await chips()) === JSON.stringify(['dusk', 'hivis']), 'ignores an older list');
// Picking a hidden theme from the sheet keeps it visible while in use.
await page.click('[data-theme-all]'); await page.click('[data-try="vector"]'); await page.click('[data-close]'); await page.waitForTimeout(200);
check((await chips()).includes('vector'), 'theme in use shows even when not starred');
await page.close();
await browser.close();
server.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
