// The AI's shared memory on Field Unit (v1.34): the conversation and notes come from meta/ai,
// go along to Gemini, grow, sync back, and Settings can remove them. Classic look.
const { chromium } = await import(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright/index.mjs');
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../field-unit');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(HERE, 'out', 'ai');
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/__/firebase/init.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ apiKey: 'k', projectId: 'demo', appId: 'a', authDomain: 'demo.firebaseapp.com' })); return; }
  const file = p === '/lib/core.js' ? path.join(HERE, 'fake-core.js') : p === '/lib/real-core.js' ? path.join(ROOT, 'lib/core.js') : path.join(ROOT, p === '/' ? 'index.html' : p);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise((r) => server.listen(5186, r));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
await ctx.route(/fonts\.(googleapis|gstatic)\.com|open-meteo/, (r) => r.abort());
const calls = [];
await ctx.route(/generativelanguage\.googleapis\.com/, async (route) => {
  const body = route.request().postData() ? JSON.parse(route.request().postData()) : null;
  calls.push(body);
  const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  if (!body) return json({ models: [{ name: 'models/gemini-flash-latest', supportedGenerationMethods: ['generateContent'] }] });
  const cand = (text) => json({ candidates: [{ content: { parts: [{ text }] } }] });
  if (body.tools) return cand('The farmers market runs 8 to 1 on Saturdays.');
  const said = body.contents[body.contents.length - 1].parts.map((p) => p.text || '').join(' ');
  if (/oat milk/i.test(said)) return cand(JSON.stringify({ heard: said, reply: 'Noted, and it\'s on the list for Friday.\nAnything else?', remember: ['Nick drinks oat milk'], act: ['add task buy oat milk friday'] }));
  if (/market/i.test(said)) return cand(JSON.stringify({ heard: said, reply: 'Checking.', lookup: 'farmers market hours Saturday' }));
  return cand(JSON.stringify({ heard: said, reply: 'Noted.' }));
});

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) fails++; };
const page = await ctx.newPage();
page.on('pageerror', (e) => { console.log('pageerror', e.message); fails++; });

const at = new Date(Date.now() - 3600e3).toISOString();
await page.addInitScript(({ at }) => {
  if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
  localStorage.clear();
  localStorage.setItem('fu.deckId', JSON.stringify('deck_1'));
  localStorage.setItem('fu.shared', JSON.stringify({ operatorName: 'Nick', consoleName: 'Command Deck', categories: [], people: ['Me'] }));
  localStorage.setItem('fu.command', JSON.stringify({ lastSeen: Date.now() }));
  localStorage.setItem('fu.settings', JSON.stringify({ theme: 'dusk', installDismissed: true, ui: 'classic' }));
  window.__seedDocs = {
    'decks/deck_1/fuConfig/main': { geminiKey: 'AIzaTEST' },
    // What the deck already had: one remembered line and a bit of conversation.
    'decks/deck_1/meta/ai': { chat: [{ id: 'd1', role: 'user', text: 'am I free Thursday?', at }, { id: 'd2', role: 'model', text: 'Thursday is clear after 3.', at }], memory: [{ id: 'm1', t: "Nick's wife is Adrienne", at }], removed: [], chatClearedAt: '', memClearedAt: '', at: Date.now() }
  };
}, { at });
await page.goto('http://localhost:5186');
await page.waitForFunction(() => !document.querySelector('#boot'), null, { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(3000);
check(await page.evaluate(() => (JSON.parse(localStorage.getItem('fu.ai')) || { memory: [] }).memory.some((m) => /Adrienne/.test(m.t))), 'the deck\'s memory arrives on the phone');

await page.click('#hailBtn'); await page.waitForTimeout(500);
await page.fill('#ctText', 'i only drink oat milk, can you add it for friday');
await page.press('#ctText', 'Enter'); await page.waitForTimeout(3500);
const chat = calls.filter((b) => b && b.generationConfig && b.generationConfig.responseSchema).pop();
check(!!chat && /Adrienne/.test(chat.systemInstruction.parts[0].text), 'what it remembers goes to Gemini');
check(!!chat && JSON.stringify(chat.contents).includes('Thursday is clear'), 'the deck\'s conversation goes along too');
check(await page.evaluate(() => JSON.parse(localStorage.getItem('fu.tasks') || '[]').some((t) => /oat milk/i.test(t.title))), 'a plain ask gets done (task filed)');
const doc = await page.evaluate(() => window.__fake.docs.get('decks/deck_1/meta/ai'));
check(doc && doc.memory.some((m) => /oat milk/.test(m.t)) && doc.chat.some((m) => /oat milk/.test(m.text)), 'the new note and messages sync back for the deck');
check(/Anything else\?/.test(await page.textContent('#ctLog')), 'long replies keep their line breaks on screen');
await page.screenshot({ path: path.join(OUT, 'comms.png') });

await page.fill('#ctText', 'when is the farmers market open?');
await page.press('#ctText', 'Enter'); await page.waitForTimeout(3000);
check(calls.some((b) => b && b.tools) && /8 to 1/.test(await page.textContent('#ctLog')), 'a web lookup answers from Google Search');

await page.click('[data-ct="close"]').catch(() => {}); await page.waitForTimeout(300);
await page.click('[data-go="settings"]'); await page.waitForTimeout(400);
await page.click('[data-ai-mem]'); await page.waitForTimeout(400);
check((await page.$$('[data-ai-x]')).length === 2, 'Settings lists both remembered lines');
await page.screenshot({ path: path.join(OUT, 'memory-sheet.png') });
await page.click('[data-ai-x="m1"]'); await page.waitForTimeout(400);
const doc2 = await page.evaluate(() => window.__fake.docs.get('decks/deck_1/meta/ai'));
check(!doc2.memory.some((m) => m.id === 'm1') && doc2.removed.includes('m1'), 'removing a line removes it everywhere');

console.log(fails ? `ai-memory: ${fails} failed` : 'ai-memory: all passed');
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
