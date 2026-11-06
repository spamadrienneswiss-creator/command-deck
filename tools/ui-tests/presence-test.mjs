// PARKED with Presence (ENABLED = false in presence.js): skipped until it's switched back on.
if (!process.env.PRESENCE) { console.log('presence-test skipped (Presence is parked; PRESENCE=1 to run)'); process.exit(0); }
// Presence on Field Unit: home, tasks, week, settings, and the conversation (built-in
// commands, Gemini fallback with a suggestion, listening, Gemini key). Gemini is faked.
// Drives Field Unit in a phone-sized Chromium against an in-memory Firestore stand-in.
const { chromium } = await import(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright/index.mjs');
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../field-unit');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const SHOTS = path.join(HERE, 'out', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['shots-guest', 'themes', 'presence']) fs.mkdirSync(path.join(HERE, 'out', d), { recursive: true });
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

const OUT = path.join(HERE, 'out', 'presence');
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) fails++; };
const page = await ctx.newPage();
page.on('pageerror', (e) => { console.log('pageerror', e.message); fails++; });
const day = new Date(); day.setHours(10, 0, 0, 0);
const ev = { id: 'e1', title: 'Dentist', start: new Date(now + 3 * 864e5).toISOString(), end: new Date(now + 3 * 864e5 + 3600e3).toISOString(), allDay: false, notes: '' };
await page.addInitScript(({ seed, ev }) => {
  if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
  localStorage.clear();
  for (const [k, v] of Object.entries(seed)) if (k !== 'fu.comms') localStorage.setItem(k, JSON.stringify(v));
  localStorage.setItem('fu.events', JSON.stringify([ev]));
  localStorage.setItem('fu.settings', JSON.stringify({ theme: 'hivis', installDismissed: true, pres: { speak: true, morning: false } }));
}, { seed, ev });
// The electric bill is overdue.
seed['fu.tasks'][0].due = new Date(now - 3 * 3600e3).toISOString();
await page.addInitScript((t) => { if (sessionStorage.getItem('seeded2')) return; sessionStorage.setItem('seeded2', '1'); localStorage.setItem('fu.tasks', JSON.stringify(t)); }, seed['fu.tasks']);
await page.goto(BASE);
await page.waitForFunction(() => !document.querySelector('#boot'), null, { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(500);
check(await page.evaluate(() => document.body.classList.contains('presence') && !!document.querySelector('#pres .pz-home')), 'Presence is the default screen');
check(await page.evaluate(() => document.body.dataset.theme === 'dusk'), 'Presence wears its own look (sheets use Dusk underneath)');
check(/Pay electric bill/.test(await page.textContent('.pz-card.late')), 'home: overdue card');
check(/Dentist/.test(await page.textContent('.pz-cards')), 'home: next card shows the dentist');
check(/ADD A GEMINI KEY/.test(await page.textContent('.pz-hint')), 'home: asks for a key when there is none');
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(OUT, 'home.png') });

// Tasks
await page.click('[data-pz-go="tasks"]'); await page.waitForTimeout(200);
check(/running late/.test(await page.textContent('.pz-say')), 'tasks: spoken summary mentions the late one');
check(await page.$('.pz-l.late') !== null, 'tasks: Needs you group');
await page.screenshot({ path: path.join(OUT, 'tasks.png') });
await page.click('[data-pz-tk="projects"]'); await page.waitForTimeout(150);
check((await page.$$('[data-pz-pj]')).length === 2, 'tasks: projects with rings');
await page.screenshot({ path: path.join(OUT, 'projects.png') });
await page.click('[data-pz-tk="queue"]'); await page.waitForTimeout(150);
await page.click('[data-pz-done="t1"]'); await page.waitForTimeout(500);
check(await page.evaluate(() => JSON.parse(localStorage.getItem('fu.tasks')).find((t) => t.id === 't1').done === true), 'tasks: tick marks done');
await page.click('[data-pz-tk="done"]'); await page.waitForTimeout(150);
await page.click('[data-pz-done="t1"]'); await page.waitForTimeout(300);
check(await page.evaluate(() => JSON.parse(localStorage.getItem('fu.tasks')).find((t) => t.id === 't1').done === false), 'tasks: untick from Done');
await page.click('[data-pz-tk="queue"]');

// Week
await page.click('[data-pz-go="week"]'); await page.waitForTimeout(200);
check(/Dentist/.test(await page.textContent('.pz-line')), 'week: timeline has the dentist');
check((await page.$$('.pz-day')).length === 7, 'week: seven-day strip');
await page.screenshot({ path: path.join(OUT, 'week.png') });

// Settings: add a key
await page.click('[data-pz-go="settings"]'); await page.waitForTimeout(200);
await page.screenshot({ path: path.join(OUT, 'settings.png') });
await page.click('[data-pz="key"]'); await page.fill('#pzKey', 'AIzaTESTKEY123'); await page.click('#pzKeySave'); await page.waitForTimeout(500);
const cfg = await page.evaluate(() => window.__fake.docs.get('decks/deck_1/fuConfig/main'));
check(cfg && cfg.geminiKey === 'AIzaTESTKEY123', 'settings: key saved with the deck (fuConfig/main)');
await page.fill('#pzName', 'Atlas'); await page.press('#pzName', 'Tab'); await page.waitForTimeout(200);
check(/Atlas/.test(await page.textContent('.pz-head h1')), 'settings: rename the Computer');
await page.screenshot({ path: path.join(OUT, 'settings-key.png') });

// Home briefing from Gemini
await page.click('[data-pz-go="home"]'); await page.waitForTimeout(800);
check(/still waiting on you/.test(await page.textContent('.pz-brief')), 'home: Gemini writes the briefing');
check(/TAP TO TALK/.test(await page.textContent('.pz-hint')), 'home: tap to talk once a key is in');

// Conversation: a built-in command
await page.click('[data-pz-say="status report"]'); await page.waitForTimeout(400);
check(await page.$('.pz-talkscr') !== null, 'talk: conversation opens');
await page.waitForFunction(() => document.querySelectorAll('.pz-b.ai').length > 0, null, { timeout: 8000 }).catch(() => {});
check(/built-in/.test(await page.textContent('.pz-log')), 'talk: built-in reply is tagged');
const before = calls.filter((c) => c.body && c.body.generationConfig && c.body.generationConfig.responseSchema).length;
await page.fill('#ctText', 'add milk to the grocery list'); await page.press('#ctText', 'Enter');
await page.waitForTimeout(1600);
check(await page.evaluate(() => JSON.parse(localStorage.getItem('fu.tasks')).some((t) => /milk/i.test(t.title))), 'talk: plain command adds a task with the built-in parser');
check(calls.filter((c) => c.body && c.body.generationConfig && c.body.generationConfig.responseSchema).length === before, 'talk: plain command never calls Gemini');
// A question goes to Gemini, with a suggestion card.
await page.fill('#ctText', 'Can I fit the dentist in before my shift?'); await page.press('#ctText', 'Enter');
await page.waitForSelector('.pz-card2.sugg', { timeout: 8000 }).catch(() => {});
check(/Friday morning is open/.test(await page.textContent('.pz-log')), 'talk: question answered by Gemini');
check(await page.$('.pz-card2.sugg') !== null, 'talk: suggestion card');
const chat = calls.filter((c) => c.body && c.body.generationConfig && c.body.generationConfig.responseSchema).pop();
check(chat && /Pay electric bill/.test(chat.body.systemInstruction.parts[0].text) && /Dentist/.test(chat.body.systemInstruction.parts[0].text), 'talk: Gemini gets tasks and calendar');
check(chat && /Atlas/.test(chat.body.systemInstruction.parts[0].text), 'talk: Gemini answers to the new name');
await page.screenshot({ path: path.join(OUT, 'talk.png') });
await page.click('[data-ct="sugg-yes"]'); await page.waitForTimeout(500);
check(await page.evaluate(() => JSON.parse(localStorage.getItem('fu.tasks')).some((t) => /Dr\. Lee/.test(t.title) && t.dueHasTime)), 'talk: Add reminder creates the task');
check(calls.some((c) => c.body && c.body.generationConfig && c.body.generationConfig.responseModalities), 'talk: replies are spoken with a Gemini voice');
// Listening: record, stop, Gemini writes it down, built-in does it.
await page.click('#pzMic'); await page.waitForTimeout(1500);
check(await page.evaluate(() => !document.querySelector('#pzBars').hidden), 'talk: listening shows the level bars');
await page.screenshot({ path: path.join(OUT, 'listening.png') });
await page.click('#pzMic');
await page.waitForFunction(() => JSON.parse(localStorage.getItem('fu.tasks')).some((t) => /eggs/i.test(t.title)), null, { timeout: 8000 }).catch(() => {});
const audioCall = calls.find((c) => c.body && c.body.contents && c.body.contents.some((x) => x.parts.some((p) => p.inlineData && p.inlineData.mimeType === 'audio/wav')));
check(!!audioCall, 'talk: the clip goes to Gemini as WAV');
check(await page.evaluate(() => JSON.parse(localStorage.getItem('fu.tasks')).some((t) => /eggs/i.test(t.title))), 'talk: spoken command runs on the built-in parser');
check(/add eggs to the list/.test(await page.textContent('.pz-log')), 'talk: what you said shows as your bubble');
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(OUT, 'talk-2.png') });
await page.click('[data-ct="close"]'); await page.waitForTimeout(200);

// Classic screens stay reachable, and the classic app can switch back.
await page.click('[data-pz-go="settings"]'); await page.click('[data-pz="classic"]'); await page.waitForTimeout(200);
check(await page.evaluate(() => !document.body.classList.contains('presence') && !!document.querySelector('[data-pz-back]')), 'classic notes open with a way back');
await page.click('[data-pz-back]'); await page.waitForTimeout(200);
check(await page.evaluate(() => document.body.classList.contains('presence')), 'back to Presence');
await page.click('[data-pz-go="settings"]'); await page.click('[data-pz="to-classic"]'); await page.waitForTimeout(200);
check(await page.evaluate(() => document.body.dataset.theme === 'hivis' && !document.body.classList.contains('presence')), 'switch to classic keeps the classic theme');
await page.click('[data-to-presence]'); await page.waitForTimeout(200);
check(await page.evaluate(() => document.body.classList.contains('presence')), 'classic Settings switches back to Presence');
await page.close();

// An old cached start page (no Presence stylesheet link) must still draw Presence properly.
const old = await ctx.newPage();
old.on('pageerror', (e) => { console.log('pageerror', e.message); fails++; });
await old.route(BASE + '/', async (r) => { const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/<link[^>]*presence\.css[^>]*>/, ''); r.fulfill({ status: 200, contentType: 'text/html', body: html }); });
await old.goto(BASE + '/');
await old.waitForFunction(() => !document.querySelector('#boot'), null, { timeout: 15000 }).catch(() => {});
await old.waitForTimeout(600);
check(await old.evaluate(() => getComputedStyle(document.querySelector('#app')).display === 'none' && document.querySelector('.pz-orbbtn').getBoundingClientRect().width <= 340), 'old cached start page: Presence still styled');
await old.screenshot({ path: path.join(OUT, 'old-cache.png') });
await old.close();
await browser.close();
server.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
