// Wine Log (field-unit/wine) in a phone-sized Chromium against the in-memory Firestore stand-in.
// Pairs, scans a label (Gemini answer faked), finds a place (search answer faked), saves, views,
// filters, edits, deletes, and checks both looks. Screenshots land in tools/ui-tests/out/shots-wine/.
const { chromium } = await import(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright/index.mjs');
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../field-unit');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const SHOTS = path.join(HERE, 'out', 'shots-wine');
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/__/firebase/init.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ apiKey: 'k', projectId: 'demo', appId: 'a', authDomain: 'demo.firebaseapp.com' })); return; }
  let file;
  if (p === '/lib/core.js') file = path.join(HERE, 'fake-core.js');
  else if (p === '/lib/real-core.js') file = path.join(ROOT, 'lib/core.js');
  else file = path.join(ROOT, p.endsWith('/') ? `${p}index.html` : p);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise((r) => server.listen(5183, r));
const BASE = 'http://localhost:5183';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
let geminiCalls = 0, lastGeminiBody = null;
await ctx.route(/generativelanguage\.googleapis\.com/, async (r) => {
  geminiCalls++;
  lastGeminiBody = r.request().postDataJSON();
  const answer = { producer: 'Ridgecrest Cellars', wineName: 'Estate Reserve', vintage: '2019', variety: 'Cabernet Sauvignon', region: 'Napa Valley', classification: null, color: 'Red' };
  await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }) });
});
let placeQuery = '';
await ctx.route(/nominatim\.openstreetmap\.org/, async (r) => {
  placeQuery = new URL(r.request().url()).searchParams.get('q');
  await r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify([
    { name: 'Bottega Louie', display_name: 'Bottega Louie, 700, South Grand Avenue, Los Angeles', lat: '34.0469', lon: '-118.2564', address: { house_number: '700', road: 'South Grand Avenue', city: 'Los Angeles', state: 'California' }, extratags: { website: 'https://www.bottegalouie.com' } },
    { name: 'Bottega Italiana', display_name: 'Bottega Italiana, Pasadena', lat: '34.14', lon: '-118.14', address: { city: 'Pasadena', state: 'California' }, extratags: {} }
  ]) });
});

const results = [];
const errors = [];
const check = (cond, name) => results.push(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
let n = 0;
const shot = async (page, name, full = false) => { await page.waitForTimeout(700); return page.screenshot({ path: path.join(SHOTS, `${String(++n).padStart(2, '0')}-${name}.png`), fullPage: full }); };

// A label photo to "take": draw one and save it as a JPEG.
const labelPage = await ctx.newPage();
await labelPage.setViewportSize({ width: 600, height: 800 });
await labelPage.setContent(`<body style="margin:0;background:#2a1a1e;display:flex;align-items:center;justify-content:center;height:800px"><div style="width:360px;height:480px;background:#efe6d4;border:2px solid #a67c2e;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:Georgia;color:#2a1a1e"><div style="font-size:40px;font-style:italic">Ridgecrest</div><div style="font-size:22px;letter-spacing:4px">ESTATE RESERVE</div><div style="margin-top:20px">NAPA VALLEY · 2019</div></div></body>`);
const LABEL = path.join(SHOTS, 'label.jpg');
await labelPage.screenshot({ path: LABEL, type: 'jpeg', quality: 85 });
await labelPage.close();

const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(`console: ${m.text()}`); });
await page.addInitScript(() => {
  window.__seedDocs = { 'pairCodes/ABC234': { deckId: 'deck1', owner: 'desk-uid', expires: 9e15 }, 'decks/deck1': { owner: 'desk-uid' } };
  if (!sessionStorage.getItem('wl-test-started')) { localStorage.clear(); sessionStorage.setItem('wl-test-started', '1'); }
});

// 1. pairing
await page.goto(`${BASE}/wine/`);
await page.waitForSelector('#code');
await shot(page, 'pair-day');
await page.fill('#code', 'zzz');
await page.click('#pair-btn');
await page.waitForSelector('.error');
check((await page.textContent('.error')).includes('6-character'), 'short code is refused with a clear message');
await page.fill('#code', 'abc-234');
await page.click('#pair-btn');
await page.waitForSelector('.fab');
const member = await page.evaluate(() => window.__fake.docs.get('decks/deck1/members/phone-uid'));
check(member && member.kind === 'wine' && member.code === 'ABC234', 'pairing joins the deck as "Wine Log"');
await page.waitForSelector('.empty .row-title');
await shot(page, 'log-empty-day');

// 2. scan without a key: keeps the photo, explains the key
await page.click('[data-act="new"]');
await page.waitForSelector('[data-act="scan"]');
await shot(page, 'entry-top-day');
let chooser = page.waitForEvent('filechooser');
await page.click('[data-act="scan"]');
await (await chooser).setFiles(LABEL);
await page.waitForSelector('#scanner .found');
check((await page.textContent('#scanner')).includes('Gemini key'), 'scan without a key keeps the photo and points to Settings');
await shot(page, 'scan-no-key');
await page.click('#scanner [data-scan="close"]');
check(await page.$('#photo-row img') !== null, 'scanned photo shows as the label photo');

// 3. add a key in Settings (from the log), then scan again
await page.click('[data-act="leave"]');
await page.waitForSelector('#scrim');
await page.click('[data-sheet="yes"]');
await page.waitForSelector('[data-act="settings"]');
await page.click('[data-act="settings"]');
await page.waitForSelector('#gkey');
await shot(page, 'settings-day');
await page.fill('#gkey', 'AIza-test-key');
await page.click('[data-sheet="key"]');
const cfg = await page.evaluate(() => window.__fake.docs.get('decks/deck1/wineConfig/main'));
check(cfg && cfg.geminiKey === 'AIza-test-key', 'Gemini key is kept with the deck');

await page.click('[data-act="new"]');
await page.waitForSelector('[data-act="scan"]');
chooser = page.waitForEvent('filechooser');
await page.click('[data-act="scan"]');
await (await chooser).setFiles(LABEL);
await page.waitForSelector('#scanner .found .found-row');
check(geminiCalls === 1, 'label is sent to Gemini once');
check(lastGeminiBody && lastGeminiBody.contents[0].parts[1].inlineData.mimeType === 'image/jpeg', 'label photo goes as a JPEG');
const found = await page.textContent('#scanner .found');
check(found.includes('Ridgecrest Cellars') && found.includes('Not on label'), '"Here\'s what I found" lists fields and marks missing ones');
await shot(page, 'scan-found-day');
await page.click('[data-scan="use"]');
await page.waitForSelector('#f-producer');
check(await page.inputValue('#f-producer') === 'Ridgecrest Cellars' && await page.inputValue('#f-vintage') === '2019', 'scan fills the form');
check(await page.$('[data-act="type"][data-v="Red"].on') !== null, 'scan sets the style to Red');

// 4. place search
await page.click('[data-act="place-kind"][data-v="Restaurant"]');
await page.fill('#f-place', 'Bottega');
await page.click('[data-act="find"]');
await page.waitForSelector('.result');
check(placeQuery === 'Bottega', 'place search uses what was typed');
await shot(page, 'place-results');
await page.click('.result >> nth=0');
await page.waitForSelector('.place-card');
const web = await page.getAttribute('.place-card a[aria-label="Open website"]', 'href');
check(web === 'https://www.bottegalouie.com', 'picked place links to its website');
check((await page.getAttribute('.place-card a[aria-label="Open in Maps"]', 'href')).startsWith('https://maps.apple.com/'), 'picked place opens in Maps');

// 5. tasting
await page.click('[data-act="intensity"][data-v="Deep"]');
await page.click('[data-act="hue"][data-v="Garnet"]');
for (const t of ['Cherry', 'Vanilla', 'Oak']) await page.click(`[data-act="tag"][data-k="nose.tags"][data-v="${t}"]`);
await page.fill('#f-nose', 'Dark cherry, a little cedar');
await page.click('[data-act="same-nose"]');
check(await page.$$eval('[data-act="tag"][data-k="palate.tags"].on', (els) => els.length) === 3, '"Same as nose" copies the aromas');
await page.click('[data-act="level"][data-k="body"][data-v="3"]');
await page.click('[data-act="level"][data-k="tannin"][data-v="2"]');
await page.fill('#n-body', 'Plush');
await page.fill('#f-remarks', 'With the short rib. Would buy again.');
await page.click('[data-act="star"][data-v="4"]');
check((await page.textContent('#star-text')) === '4 of 5', 'four stars');
await shot(page, 'entry-full-day', true);
await page.click('#save-btn');
await page.waitForSelector('.bottle-sheet');
const saved = await page.evaluate(() => { const d = window.__fake.docs; const k = [...d.keys()].find((p) => p.startsWith('decks/deck1/wines/')); return k ? { id: k.split('/').pop(), ...d.get(k) } : null; });
check(saved && saved.producer === 'Ridgecrest Cellars' && saved.stars === 4 && saved.palate.levels.body === 3 && saved.place.website, 'entry saved with all its parts');
check(saved && saved.hasPhoto && saved.thumb.startsWith('data:image/jpeg'), 'entry keeps a small thumbnail');
const photo = await page.evaluate((id) => window.__fake.docs.get(`decks/deck1/winePhotos/${id}`), saved.id);
check(photo && photo.data.length < 600000 && photo.data.length > 1000, `label photo saved small (${photo ? Math.round(photo.data.length / 1024) : 0} KB as text)`);
await page.waitForTimeout(300);
await shot(page, 'bottle-day');
await shot(page, 'bottle-day-full', true);

// 6. the log, search and filters
await page.click('[data-act="home"]');
await page.waitForSelector('.card');
await shot(page, 'log-day');
await page.fill('#q', 'vanilla');
check(await page.$$eval('.card', (c) => c.length) === 1, 'search finds by aroma');
await page.fill('#q', 'pinot');
check((await page.textContent('#cards')).includes('Nothing matches'), 'search with no match says so');
await page.fill('#q', '');
await page.click('[data-act="filter"][data-v="Sparkling"]');
check(await page.$$eval('.card', (c) => c.length) === 0, 'Sparkling filter hides the red');
await page.click('[data-act="filter"][data-v="Red"]');
check(await page.$$eval('.card', (c) => c.length) === 1, 'Red filter shows it');

// 7. night look
await page.click('[data-act="mood"]');
check(await page.evaluate(() => document.documentElement.dataset.mood) === 'night', 'sun / moon flips to the night look');
const ov = await page.evaluate(() => JSON.parse(localStorage.getItem('wl.override')));
check(ov && ov.mood === 'night' && ov.until > Date.now(), 'the flip lasts until the next sunrise or sunset');
await shot(page, 'log-night');
await page.click('.card');
await page.waitForSelector('.bottle-sheet');
await page.waitForTimeout(300);
await shot(page, 'bottle-night');
await shot(page, 'bottle-night-full', true);
await page.click('[data-act="edit"]');
await page.waitForSelector('#save-btn');
check((await page.textContent('#save-btn')).includes('Cellar'), 'night save button says "Save to Cellar"');
check(await page.inputValue('#f-producer') === 'Ridgecrest Cellars', 'edit opens with the saved details');
await shot(page, 'entry-night');
await shot(page, 'entry-night-full', true);
await page.fill('#f-vintage', '2018');
await page.click('#save-btn');
await page.waitForSelector('.bottle-sheet');
check((await page.textContent('.meta')).includes('2018'), 'edits save');

// 8. delete
await page.click('[data-act="delete"]');
await page.waitForSelector('#scrim');
await shot(page, 'delete-night');
await page.click('[data-sheet="yes"]');
await page.waitForSelector('.empty .row-title');
const left = await page.evaluate(() => [...window.__fake.docs.keys()].filter((p) => /wines\/|winePhotos\//.test(p)).length);
check(left === 0, 'delete removes the entry and its photo');

// 9. unpaired from the deck sends the phone back to pairing
await page.evaluate(() => window.__fake.write('decks/deck1/members/phone-uid', null));
await page.waitForSelector('#code');
check(true, 'unpairing on the deck returns to the pairing screen');

console.log(results.join('\n'));
if (errors.length) console.log(`\nPage errors:\n${errors.join('\n')}`);
await browser.close();
server.close();
const failed = results.filter((r) => r.startsWith('FAIL')).length + errors.length;
console.log(`\n${results.length - results.filter((r) => r.startsWith('FAIL')).length}/${results.length} passed${errors.length ? `, ${errors.length} page errors` : ''}. Screenshots: ${SHOTS}`);
process.exit(failed ? 1 : 0);
