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
  else file = path.join(ROOT, p === '/' ? 'index.html' : p);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise((r) => server.listen(5175, r));
const BASE = 'http://localhost:5175';

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
const combos = JSON.parse(process.env.COMBOS || '[]');
for (const [theme, font, frame, trim, ink] of combos) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.addInitScript(({ seed, settings }) => { localStorage.clear(); for (const [k, v] of Object.entries(seed)) (k === 'fu.comms' ? sessionStorage : localStorage).setItem(k, JSON.stringify(v)); localStorage.setItem('fu.settings', JSON.stringify(settings)); }, { seed, settings: { theme, font: font || 'auto', frame, trim, ink: ink || 'theme', installDismissed: true } });
  await page.goto(BASE);
  // Let the Signal load-up finish (it removes #boot) before the Today shot.
  await page.waitForFunction(() => !document.querySelector('#boot'), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
  const tag = `${theme}-${font || 'auto'}-${frame}-${trim}-${ink || 'theme'}`;
  await page.screenshot({ path: path.join(HERE, 'out', 'themes', `${tag}-today.png`) });
  await page.click('.tab[data-view="tasks"]'); await page.waitForTimeout(150); await page.screenshot({ path: path.join(HERE, 'out', 'themes', `${tag}-queue.png`) }); await page.click('[data-tkview="projects"]'); await page.waitForTimeout(150); const pjt = await page.$('[data-pj-toggle]'); if (pjt) { await pjt.click(); await page.waitForTimeout(150); }
  await page.screenshot({ path: path.join(HERE, 'out', 'themes', `${tag}-projects.png`) });
  await page.click('#hailBtn'); await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(HERE, 'out', 'themes', `${tag}-comms.png`) });
  await page.click('[data-ct="close"]');
  if (process.env.SETTINGS) { await page.click('.tab[data-view="today"]'); await page.click('.gear-btn'); await page.waitForTimeout(200); await page.screenshot({ path: path.join(HERE, 'out', 'themes', `${tag}-settings.png`), fullPage: false }); }
  await page.close();
}
await browser.close();
server.close();
