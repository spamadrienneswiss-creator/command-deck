// Wine Log: a tasting journal for the phone. Lives beside Field Unit on the same Firebase project and
// pairs with Command Deck the same way, so entries are kept under decks/{deckId}/wines (members only).
//   wines/{id}        one entry (with a small thumbnail of the label)
//   winePhotos/{id}   the label photo (~1200 px JPEG, kept in Firestore because the free plan has no Storage)
//   wineConfig/main   the Gemini key used to read labels
// Day look (Estate Terrace) and night look (Private Cellar) switch at local sunset.
import * as fb from '../lib/core.js';
import { normalizePairCode, makeId, startFirebase, signIn } from '../lib/sync.js';

const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const load = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const save = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ } };
const clone = (v) => JSON.parse(JSON.stringify(v));
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const longDate = (s) => { const d = parseYmd(s); return d ? `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}` : ''; };
const shortDate = (s) => { const d = parseYmd(s); if (!d) return ''; const m = MONTHS[d.getMonth()].slice(0, 3); return d.getFullYear() === new Date().getFullYear() ? `${m} ${d.getDate()}` : `${m} ${d.getFullYear()}`; };
const clock = (d) => d ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';

// ---------------------------------------------------------------- the tasting sheet
const TYPES = ['Red', 'White', 'Rosé', 'Sparkling'];
const HUES = {
  Red: [['Purple', '#5B2A5E'], ['Ruby', '#9B1B30'], ['Garnet', '#7A2431'], ['Tawny', '#A0522D'], ['Brown', '#6B4226']],
  White: [['Straw', '#E9DFA0'], ['Yellow', '#E8CF5A'], ['Gold', '#D4A93A'], ['Amber', '#C47F2B'], ['Brown', '#7A5230']],
  'Rosé': [['Pink', '#F2A7B8'], ['Salmon', '#F29B7E'], ['Copper', '#C9764D']],
  Sparkling: [['Straw', '#EDE3A8'], ['Gold', '#D4A93A'], ['Pink', '#F2A7B8'], ['Copper', '#C9764D']]
};
const TYPE_COLOR = { Red: '#9B1B30', White: '#D4A93A', 'Rosé': '#F29B7E', Sparkling: '#E9DFA0' };
const INTENSITY = ['Pale', 'Medium', 'Deep'];
// The aroma finder: families → groups → aromas. Fruit follows the style picked under The Look.
const FAMILIES = {
  'Fruit': '#8E2C43', 'Floral': '#9B6FA0', 'Herbal & Green': '#5E7A44', 'Spice': '#A0522D',
  'Oak & Toast': '#8A6A3E', 'Earth & Mineral': '#6E6458', 'Yeast & Cream': '#C9A464'
};
const FRUIT = {
  Red: [['Red fruit', ['Cherry', 'Raspberry', 'Strawberry', 'Cranberry', 'Red plum', 'Pomegranate']], ['Black fruit', ['Black cherry', 'Blackberry', 'Blackcurrant', 'Blueberry', 'Black plum', 'Black olive']], ['Dried fruit', ['Raisin', 'Fig', 'Prune', 'Dried cherry']]],
  White: [['Citrus', ['Lemon', 'Lime', 'Grapefruit', 'Orange zest', 'Tangerine']], ['Orchard', ['Green apple', 'Yellow apple', 'Pear', 'Quince']], ['Stone fruit', ['Peach', 'Apricot', 'Nectarine']], ['Tropical', ['Pineapple', 'Mango', 'Passion fruit', 'Lychee', 'Melon']]],
  'Rosé': [['Red fruit', ['Strawberry', 'Raspberry', 'Watermelon', 'Cherry', 'Cranberry']], ['Citrus', ['Lemon', 'Grapefruit', 'Blood orange']], ['Stone fruit', ['Peach', 'Apricot', 'Nectarine']]],
  Sparkling: [['Citrus', ['Lemon', 'Lime', 'Grapefruit']], ['Orchard', ['Green apple', 'Yellow apple', 'Pear', 'Quince']], ['Red fruit', ['Strawberry', 'Raspberry', 'Cherry']]]
};
// No style picked yet: every fruit group, once each.
FRUIT[''] = (() => {
  const seen = new Map();
  for (const t of ['Red', 'White', 'Rosé', 'Sparkling']) for (const [g, tags] of FRUIT[t]) seen.set(g, [...new Set([...(seen.get(g) || []), ...tags])]);
  return [...seen.entries()];
})();
const AROMAS = {
  'Floral': [['Flowers', ['Rose', 'Violet', 'Lavender', 'Orange blossom', 'Honeysuckle', 'Jasmine', 'Elderflower', 'Chamomile']]],
  'Herbal & Green': [['Fresh herbs', ['Mint', 'Basil', 'Thyme', 'Sage', 'Dill']], ['Green', ['Bell pepper', 'Cut grass', 'Tomato leaf', 'Green bean', 'Asparagus']], ['Resinous', ['Eucalyptus', 'Pine', 'Rosemary']]],
  'Spice': [['Sweet spice', ['Cinnamon', 'Clove', 'Nutmeg', 'Anise', 'Licorice']], ['Pepper & heat', ['Black pepper', 'White pepper', 'Pink peppercorn', 'Ginger']]],
  'Oak & Toast': [['Oak', ['Vanilla', 'Cedar', 'Coconut', 'Sandalwood']], ['Toast & smoke', ['Toast', 'Smoke', 'Coffee', 'Cocoa', 'Tobacco']], ['Nutty & sweet', ['Almond', 'Hazelnut', 'Caramel', 'Honey', 'Butterscotch']]],
  'Earth & Mineral': [['Earth', ['Forest floor', 'Mushroom', 'Wet leaves', 'Truffle', 'Leather']], ['Mineral', ['Wet stone', 'Chalk', 'Flint', 'Graphite', 'Saline']]],
  'Yeast & Cream': [['Bakery', ['Brioche', 'Bread dough', 'Biscuit']], ['Dairy', ['Butter', 'Cream', 'Yogurt']]]
};
const aromaGroups = (fam, type) => (fam === 'Fruit' ? FRUIT[type] || FRUIT[''] : AROMAS[fam]);
const familyOrder = (type) => (type === 'White' || type === 'Sparkling'
  ? ['Fruit', 'Floral', 'Yeast & Cream', 'Herbal & Green', 'Spice', 'Oak & Toast', 'Earth & Mineral']
  : ['Fruit', 'Floral', 'Spice', 'Oak & Toast', 'Earth & Mineral', 'Herbal & Green', 'Yeast & Cream']);
const FAMILY_OF = {};
for (const [fam, groups] of Object.entries(AROMAS)) for (const [, tags] of groups) for (const t of tags) FAMILY_OF[t] ||= fam;
for (const [, tags] of FRUIT['']) for (const t of tags) FAMILY_OF[t] = 'Fruit';
const PALATE = [
  ['body', 'Body', ['Light', 'Med−', 'Medium', 'Med+', 'Bold']],
  ['tannin', 'Tannin', ['Low', 'Med−', 'Medium', 'Med+', 'High']],
  ['acidity', 'Acidity', ['Low', 'Med−', 'Medium', 'Med+', 'High']],
  ['alcohol', 'Alcohol %', ['<10', '10–11.5', '11.5–13.5', '13.5–15', '15+']],
  ['sweet', 'Sweetness', ['Bone dry', 'Dry', 'Off dry', 'Sweet', 'V. sweet']]
];
const PLACES = { Winery: 'Winery name', Restaurant: 'Restaurant name', Shop: 'Store or website', Home: 'Where you bought it (optional)' };
const FILTERS = ['All', ...TYPES];

function blankWine() {
  return {
    id: null, date: ymd(), createdAt: null, updatedAt: null,
    place: { kind: '', name: '', address: '', lat: null, lon: null, website: '' },
    producer: '', name: '', vintage: '', classification: '', variety: '', region: '',
    look: { type: '', intensity: '', hue: '' },
    nose: { tags: [], notes: '' },
    palate: { tags: [], levels: { body: null, tannin: null, acidity: null, alcohol: null, sweet: null }, notes: { body: '', tannin: '', acidity: '', alcohol: '', sweet: '' } },
    remarks: '', stars: 0, thumb: '', hasPhoto: false
  };
}
/** Fills in anything an older or partial entry is missing. */
function normalize(w) {
  const b = blankWine();
  const o = { ...b, ...(w || {}) };
  o.place = { ...b.place, ...(o.place || {}) };
  o.look = { ...b.look, ...(o.look || {}) };
  o.nose = { ...b.nose, ...(o.nose || {}) };
  o.palate = { ...b.palate, ...(o.palate || {}) };
  o.palate.levels = { ...b.palate.levels, ...(o.palate.levels || {}) };
  o.palate.notes = { ...b.palate.notes, ...(o.palate.notes || {}) };
  if (!Array.isArray(o.nose.tags)) o.nose.tags = [];
  if (!Array.isArray(o.palate.tags)) o.palate.tags = [];
  return o;
}
const title = (w) => [w.producer, w.name].map((s) => String(s || '').trim()).filter(Boolean).join(' ') || 'Untitled wine';
const metaLine = (w) => [w.vintage, w.variety, w.region].map((s) => String(s || '').trim()).filter(Boolean).join(' · ');
const starText = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

// ---------------------------------------------------------------- state
const S = {
  config: load('wl.config', null),
  deckId: load('wl.deckId', null),
  coords: load('wl.coords', null),
  override: load('wl.override', null),
  geminiKey: load('wl.gemini', ''),
  model: load('wl.model', ''),
  fire: null, uid: null, unsubs: [],
  wines: [], loaded: false,
  view: 'log', currentId: null,
  filter: 'All', query: '',
  draft: null, draftPhoto: undefined, // undefined = unchanged, null = removed, string = new photo
  dirty: false,
  photos: new Map(),
  mood: 'day', popStars: false,
  openFam: { 'nose.tags': 'Fruit', 'palate.tags': null }
};

// ---------------------------------------------------------------- sunset
// Sunrise and sunset from the sun's position (the method SunCalc uses), so the look follows the real sky.
function sunTimes(date, lat, lon) {
  const rad = Math.PI / 180, dayMs = 864e5, J1970 = 2440588, J2000 = 2451545;
  const toDays = (d) => d.valueOf() / dayMs - 0.5 + J1970 - J2000;
  const fromJulian = (j) => new Date((j + 0.5 - J1970) * dayMs);
  const e = rad * 23.4397, J0 = 0.0009;
  const lw = rad * -lon, phi = rad * lat;
  const n = Math.round(toDays(date) - J0 - lw / (2 * Math.PI));
  const transit = (ht) => J0 + (ht + lw) / (2 * Math.PI) + n;
  const ds = transit(0);
  const M = rad * (357.5291 + 0.98560028 * ds);
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + rad * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const solarJ = (x) => J2000 + x + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const noon = solarJ(ds);
  const w = Math.acos((Math.sin(rad * -0.833) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));
  if (Number.isNaN(w)) return null;
  const set = solarJ(transit(w));
  return { rise: fromJulian(noon - (set - noon)), set: fromJulian(set) };
}
const HOME = { lat: 34.05, lon: -118.24, label: 'Los Angeles' };
function skyNow(now = new Date()) {
  const c = S.coords || HOME;
  const noon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  const t = sunTimes(noon, c.lat, c.lon);
  if (!t) return { mood: 'day', next: new Date(now.getTime() + 36e5), rise: null, set: null };
  if (now < t.rise) return { mood: 'night', next: t.rise, ...t };
  if (now < t.set) return { mood: 'day', next: t.set, ...t };
  const tom = sunTimes(new Date(noon.getTime() + 864e5), c.lat, c.lon);
  return { mood: 'night', next: tom ? tom.rise : new Date(now.getTime() + 36e5), ...t };
}
function currentMood() {
  if (S.override && Date.now() < S.override.until) return S.override.mood;
  if (S.override) { S.override = null; save('wl.override', null); }
  return skyNow().mood;
}
function applyMood(force) {
  const m = currentMood();
  if (m === S.mood && !force) return false;
  S.mood = m;
  document.documentElement.dataset.mood = m;
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = m === 'night' ? '#0E0C0A' : '#F6F1E6';
  return true;
}
function toggleMood() {
  const sky = skyNow();
  const want = S.mood === 'day' ? 'night' : 'day';
  // A manual flip lasts until the next sunrise or sunset, then the sky takes over again.
  S.override = want === sky.mood ? null : { mood: want, until: sky.next.getTime() };
  save('wl.override', S.override);
  applyMood();
  refreshMood();
}
function refreshMood() {
  if (S.view === 'entry') { const h = $('#hero'); if (h) h.innerHTML = entryHero(); renderPalate(); }
  else render();
}
setInterval(() => { if (applyMood()) refreshMood(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && applyMood()) refreshMood(); });

// ---------------------------------------------------------------- artwork
const ICON = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  scan: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><circle cx="12" cy="12" r="3.2"/></svg>',
  arrow: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  pin: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/></svg>',
  web: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  search: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
  plus: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z"/></svg>'
};
const VINEYARD = `<svg viewBox="0 0 390 190" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
<rect width="390" height="190" fill="#D6E5F0"/><ellipse cx="80" cy="44" rx="46" ry="12" fill="#F4F8FB"/><ellipse cx="290" cy="62" rx="60" ry="13" fill="#F4F8FB"/>
<path d="M0 118 C60 92 120 104 180 96 C240 88 300 100 390 90 L390 190 L0 190 Z" fill="#A9BDCB"/>
<path d="M0 140 C70 118 150 132 220 120 C290 108 340 122 390 116 L390 190 L0 190 Z" fill="#AFC58E"/>
<path d="M0 170 C90 140 200 158 390 136 L390 190 L0 190 Z" fill="#7F9D5E"/>
<path d="M20 186 L160 150 M60 190 L210 152 M110 190 L260 150 M170 190 L310 146 M230 190 L360 142 M300 190 L390 160" stroke="#5E7A44" stroke-width="2" stroke-linecap="round"/>
<rect x="286" y="104" width="34" height="22" fill="#EFE8DA"/><path d="M282 106 L303 92 L324 106 Z" fill="#9C5B3E"/><rect x="299" y="114" width="7" height="12" fill="#6B5446"/>
<path d="M334 128 C328 108 331 76 336 58 C341 76 344 108 338 128 Z" fill="#3B5130"/></svg>`;
const ORNAMENT = '<svg class="ornament" width="120" height="10" viewBox="0 0 120 10" aria-hidden="true"><path d="M0 5 H50 M70 5 H120" stroke="#A67C2E" stroke-width="1"/><path d="M60 0 L65 5 L60 10 L55 5 Z" fill="#A67C2E"/></svg>';
const bottleArt = (color, w = 52, h = 68) => `<svg width="${w}" height="${h}" viewBox="0 0 52 68" aria-hidden="true"><path d="M21 0 L21 12 C21 18 16 21 16 28 L16 68 L36 68 L36 28 C36 21 31 18 31 12 L31 0 Z" fill="#2A1A1E"/><rect x="17" y="38" width="18" height="20" fill="#F2EBDC"/><rect x="17" y="54" width="18" height="4" fill="${esc(color)}"/></svg>`;
const RING = '<svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true"><circle cx="15" cy="15" r="12" fill="none" stroke="var(--accent)" stroke-width="2.4" stroke-linecap="round" transform="rotate(-90 15 15)"/><circle cx="15" cy="15" r="7" fill="none" stroke="var(--accent)" stroke-width="1" opacity=".5" transform="rotate(-90 15 15)"/></svg>';
const moodBtn = (cls = 'right') => `<button type="button" class="round ${cls}" data-act="mood" aria-label="${S.mood === 'day' ? 'Switch to the night look' : 'Switch to the day look'}">${S.mood === 'day' ? ICON.moon : ICON.sun}</button>`;

function hero({ eyebrow, h1, left = '', short = false, center = true }) {
  if (S.mood === 'day') {
    return `<div class="hero hero-day${short ? ' short' : ''}">${VINEYARD}${left}${moodBtn()}</div>
<div class="sheet-top"><span class="eyebrow">${esc(eyebrow)}</span><h1 class="h1">${esc(h1)}</h1>${center && !short ? ORNAMENT : ''}</div>`;
  }
  return `<div class="hero hero-night${short ? ' short' : ''}">${left}${moodBtn()}<span class="eyebrow">${esc(eyebrow)}</span><h1 class="h1">${esc(h1)}</h1></div>`;
}

// ---------------------------------------------------------------- toast & sheets
function toast(text, { ring = false } = {}) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = document.createElement('div');
  t.className = `toast${ring ? '' : ' plain'}`;
  t.setAttribute('role', 'status');
  t.innerHTML = `${ring ? RING : ''}<span>${esc(text)}</span>`;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}
function openSheet(html, onClick) {
  closeSheet();
  const s = document.createElement('div');
  s.className = 'scrim';
  s.id = 'scrim';
  s.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="handle"></div>${html}</div>`;
  s.addEventListener('click', (e) => {
    if (e.target === s) return closeSheet();
    const a = e.target.closest('[data-sheet]');
    if (a && onClick) onClick(a.dataset.sheet, a, s);
  });
  document.body.appendChild(s);
  return s;
}
function closeSheet() { const s = $('#scrim'); if (s) s.remove(); }
function confirmSheet(heading, text, yes, onYes) {
  openSheet(`<h2>${esc(heading)}</h2><p class="hint">${esc(text)}</p>
<button type="button" class="btn" data-sheet="yes">${esc(yes)}</button><button type="button" class="btn quiet" data-sheet="no">Cancel</button>`,
  (act) => { closeSheet(); if (act === 'yes') onYes(); });
}

// ---------------------------------------------------------------- Firebase
async function getConfig() {
  try {
    const res = await fetch('/__/firebase/init.json', { cache: 'no-store' });
    if (res.ok) { S.config = await res.json(); save('wl.config', S.config); }
  } catch (e) { /* offline: the saved copy works */ }
  return S.config;
}
async function connect() {
  const cfg = S.config || await getConfig();
  if (!cfg) throw new Error('Wine Log needs a connection the first time it opens.');
  if (!S.fire) S.fire = startFirebase(fb, cfg, 'wine-log');
  if (!S.uid) { const user = await signIn(fb, S.fire.auth); S.uid = user.uid; }
  if (!S.config) getConfig();
}
const col = (name) => fb.collection(S.fire.db, 'decks', S.deckId, name);
const ref = (name, id) => fb.doc(S.fire.db, 'decks', S.deckId, name, id);

async function pairWith(text) {
  const code = normalizePairCode(text);
  if (code.length !== 6) throw new Error('Enter the 6-character code shown on Command Deck.');
  await connect();
  let snap;
  try { snap = await fb.getDoc(fb.doc(S.fire.db, 'pairCodes', code)); } catch (e) { throw new Error('That code has expired or is not valid. Show a new one on Command Deck.'); }
  if (!snap.exists()) throw new Error('Code not recognized. Check it, or show a new one on Command Deck.');
  const deckId = snap.data().deckId;
  const ua = navigator.userAgent;
  const device = /iPad/.test(ua) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : 'Browser';
  try {
    await fb.setDoc(fb.doc(S.fire.db, 'decks', deckId, 'members', S.uid), { kind: 'wine', name: `Wine Log · ${device}`, joinedAt: Date.now(), code });
  } catch (e) { throw new Error('Command Deck refused the code (it may have just expired). Show a new one and try again.'); }
  S.deckId = deckId;
  save('wl.deckId', deckId);
  start();
}

function start() {
  stop();
  S.unsubs.push(fb.onSnapshot(fb.doc(S.fire.db, 'decks', S.deckId, 'members', S.uid), { includeMetadataChanges: false }, (snap) => {
    // Unpaired from Command Deck: back to the pairing screen.
    if (!snap.exists() && !(snap.metadata && snap.metadata.fromCache)) unpaired();
  }, () => {}));
  S.unsubs.push(fb.onSnapshot(col('wines'), (snap) => {
    const list = [];
    snap.forEach((d) => list.push(normalize({ ...d.data(), id: d.id })));
    list.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0));
    S.wines = list;
    S.loaded = true;
    if (S.view === 'log') renderCards();
    else if (S.view === 'bottle') render();
  }, (err) => { console.warn('wines', err); if (err && err.code === 'permission-denied') unpaired(); }));
  S.unsubs.push(fb.onSnapshot(ref('wineConfig', 'main'), (snap) => {
    const d = snap.exists() ? snap.data() : {};
    if (d.geminiKey && d.geminiKey !== S.geminiKey) { S.geminiKey = d.geminiKey; save('wl.gemini', S.geminiKey); }
    if (d.model && d.model !== S.model) { S.model = d.model; save('wl.model', S.model); }
  }, () => {}));
  if (S.view === 'pair') go('log');
}
function stop() { S.unsubs.forEach((u) => { try { u(); } catch (e) { /* already gone */ } }); S.unsubs = []; }
function unpaired() {
  stop();
  S.deckId = null; save('wl.deckId', null);
  S.wines = []; S.loaded = false;
  go('pair');
}

// ---------------------------------------------------------------- photos
function readImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That photo could not be opened.')); };
    img.src = url;
  });
}
function shrink(img, max, quality, crop) {
  let sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0;
  if (crop) { // center-crop to a portrait label shape for thumbnails
    const want = crop;
    if (sw / sh > want) { const nw = sh * want; sx = (sw - nw) / 2; sw = nw; } else { const nh = sw / want; sy = (sh - nh) / 2; sh = nh; }
  }
  const scale = Math.min(1, max / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * scale));
  c.height = Math.max(1, Math.round(sh * scale));
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}
async function preparePhoto(file) {
  const img = await readImage(file);
  let q = 0.8, photo = shrink(img, 1200, q);
  while (photo.length > 560000 && q > 0.45) { q -= 0.1; photo = shrink(img, 1200, q); }
  return { photo, thumb: shrink(img, 200, 0.72, 52 / 68), forReading: shrink(img, 1024, 0.82) };
}
async function getPhoto(id) {
  if (S.photos.has(id)) return S.photos.get(id);
  try {
    const snap = await fb.getDoc(ref('winePhotos', id));
    const data = snap.exists() ? snap.data().data : null;
    if (data) S.photos.set(id, data);
    return data;
  } catch (e) { return null; }
}

// ---------------------------------------------------------------- Gemini (reads the label)
const API = 'https://generativelanguage.googleapis.com/v1beta';
const LABEL_SCHEMA = {
  type: 'OBJECT',
  properties: {
    producer: { type: 'STRING', nullable: true, description: 'Winery or producer name' },
    wineName: { type: 'STRING', nullable: true, description: 'Wine name, cuvée or vineyard, without the producer' },
    vintage: { type: 'STRING', nullable: true, description: 'Four-digit year, or NV for non-vintage' },
    variety: { type: 'STRING', nullable: true, description: 'Grape variety or varieties' },
    region: { type: 'STRING', nullable: true, description: 'Region or appellation, as printed' },
    classification: { type: 'STRING', nullable: true, description: 'Classification or quality term, e.g. Reserva, Grand Cru, DOCG' },
    color: { type: 'STRING', nullable: true, enum: ['Red', 'White', 'Rosé', 'Sparkling'], description: 'Wine style, only if the label or bottle makes it clear' }
  }
};
const LABEL_PROMPT = [
  'This is a photo of a wine bottle label. Read what is printed on it.',
  'Fill each field only with what the label actually shows. If something is not printed on the label, return null for it. Do not guess.',
  'Keep names as printed, with normal capitalization (not all caps).'
].join(' ');
async function gemini(path, body) {
  const res = await fetch(`${API}/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': S.geminiKey },
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* not JSON */ }
  return { status: res.status, ok: res.ok, json };
}
function geminiError(status, json) {
  const msg = (json && json.error && json.error.message) || '';
  if ((status === 400 && /api key/i.test(msg)) || status === 401 || status === 403) return 'Gemini didn\'t accept the key. Check it in Settings.';
  if (status === 429) return 'Gemini\'s free limit is used up for now. Try again a little later.';
  if (status >= 500) return 'Gemini is having trouble right now. Try again in a bit.';
  return msg || `Gemini error ${status}`;
}
async function flashModels() {
  const r = await gemini('models?pageSize=200');
  if (!r.ok) throw new Error(geminiError(r.status, r.json));
  return ((r.json && r.json.models) || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => String(m.name || '').replace(/^models\//, ''))
    .filter((n) => /^gemini-/.test(n) && /flash/.test(n) && !/(image|tts|live|audio|embedding)/.test(n))
    .sort((a, b) => Number(/preview|exp/.test(a)) - Number(/preview|exp/.test(b)) || Number(/lite/.test(a)) - Number(/lite/.test(b)));
}
async function readLabel(dataUrl) {
  if (!navigator.onLine) throw new Error('No signal right now. Your photo is saved; fill in the details by hand or scan again later.');
  const body = {
    contents: [{ parts: [{ text: LABEL_PROMPT }, { inlineData: { mimeType: 'image/jpeg', data: dataUrl.split(',')[1] } }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: LABEL_SCHEMA, temperature: 0.1 }
  };
  const tried = new Set();
  let queue = [S.model, 'gemini-flash-latest', 'gemini-flash-lite-latest'].filter(Boolean);
  let listed = false;
  while (queue.length) {
    const model = queue.shift();
    if (tried.has(model)) continue;
    tried.add(model);
    const r = await gemini(`models/${model}:generateContent`, body);
    if (r.ok) {
      if (model !== S.model) { S.model = model; save('wl.model', model); try { fb.setDoc(ref('wineConfig', 'main'), { model }, { merge: true }).catch(() => {}); } catch (e) { /* offline */ } }
      const text = (((r.json.candidates || [])[0] || {}).content || {}).parts || [];
      let obj;
      try { obj = JSON.parse(text.map((p) => p.text || '').join('').replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch (e) { throw new Error('Gemini sent back something unreadable. Try the scan again.'); }
      const s = (v, n = 120) => (v == null ? '' : String(v).trim().slice(0, n));
      return {
        producer: s(obj.producer), name: s(obj.wineName), vintage: s(obj.vintage, 8), variety: s(obj.variety),
        region: s(obj.region), classification: s(obj.classification), type: TYPES.includes(obj.color) ? obj.color : ''
      };
    }
    if (r.status === 404 && !listed) { listed = true; queue = queue.concat(await flashModels()); continue; }
    if (r.status === 404) continue;
    throw new Error(geminiError(r.status, r.json));
  }
  throw new Error('No Gemini model that can read photos is available for this key.');
}

// ---------------------------------------------------------------- places (OpenStreetMap search, free, no key)
async function findPlaces(q) {
  const u = new URL('https://nominatim.openstreetmap.org/search');
  u.searchParams.set('q', q);
  u.searchParams.set('format', 'jsonv2');
  u.searchParams.set('addressdetails', '1');
  u.searchParams.set('extratags', '1');
  u.searchParams.set('limit', '6');
  u.searchParams.set('accept-language', 'en');
  const c = S.coords || HOME;
  u.searchParams.set('viewbox', `${c.lon - 0.7},${c.lat + 0.7},${c.lon + 0.7},${c.lat - 0.7}`);
  const res = await fetch(u.toString());
  if (!res.ok) throw new Error('The place search is busy. Try again in a moment.');
  const list = await res.json();
  return (list || []).map((r) => {
    const a = r.address || {};
    const street = [a.house_number, a.road].filter(Boolean).join(' ');
    const town = a.city || a.town || a.village || a.hamlet || a.suburb || '';
    const address = [street, town, a.state].filter(Boolean).join(', ') || String(r.display_name || '').split(',').slice(1, 4).join(',').trim();
    const t = r.extratags || {};
    return {
      name: r.name || String(r.display_name || '').split(',')[0],
      address, town,
      lat: Number(r.lat), lon: Number(r.lon),
      website: t.website || t['contact:website'] || t.url || ''
    };
  });
}
function mapsUrl(p) {
  const q = encodeURIComponent([p.name, p.address].filter(Boolean).join(', '));
  return p.lat != null && p.lon != null ? `https://maps.apple.com/?q=${encodeURIComponent(p.name || 'Place')}&ll=${p.lat},${p.lon}` : `https://maps.apple.com/?q=${q}`;
}
function webUrl(p) {
  if (p.website) return /^https?:\/\//i.test(p.website) ? p.website : `https://${p.website}`;
  return `https://www.google.com/search?q=${encodeURIComponent([p.name, p.address].filter(Boolean).join(' '))}`;
}
function placeCard(p, removable) {
  return `<div class="place-card"><span style="color: var(--accent); display: flex">${ICON.pin}</span>
<div class="grow">${p.kind ? `<span class="label">${esc(p.kind)}</span>` : ''}<span class="place-name">${esc(p.name)}</span>${p.address ? `<span class="place-addr">${esc(p.address)}</span>` : ''}</div>
<a class="circle" href="${esc(mapsUrl(p))}" target="_blank" rel="noopener" aria-label="Open in Maps">${ICON.map}</a>
<a class="circle" href="${esc(webUrl(p))}" target="_blank" rel="noopener" aria-label="${p.website ? 'Open website' : 'Search the web'}">${ICON.web}</a>
${removable ? `<button type="button" class="circle" data-act="place-clear" aria-label="Remove this place">${ICON.close}</button>` : ''}</div>`;
}

// ---------------------------------------------------------------- routing
function go(view, id) {
  S.view = view;
  if (id !== undefined) S.currentId = id;
  render();
  window.scrollTo(0, 0);
}
function render() {
  applyMood();
  if (!S.deckId) S.view = 'pair';
  if (S.view === 'pair') return renderPair();
  if (S.view === 'entry') return renderEntry();
  if (S.view === 'bottle') return renderBottle();
  return renderLog();
}

// ---------------------------------------------------------------- pairing
function renderPair(error = '') {
  app.innerHTML = `<div class="pair">${hero({ eyebrow: 'Welcome', h1: 'Wine Log' })}
<div class="body">
<p class="hint" style="font-size: 16px">Wine Log keeps your tastings with Command Deck, so they're safe and on every device you pair. On Command Deck, open <b>Settings › Field Unit</b> and press <b>SHOW PAIRING CODE</b>, then enter it here.</p>
<form id="pair-form" class="section" autocomplete="off">
<label class="label" for="code">Pairing code</label>
<input class="in code-in" id="code" inputmode="text" autocapitalize="characters" autocomplete="one-time-code" maxlength="7" placeholder="ABC-123">
${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
<button class="btn" type="submit" id="pair-btn">Connect</button>
</form></div></div>`;
  $('#pair-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#pair-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span>';
    try { await pairWith($('#code').value); toast('Connected', { ring: true }); } catch (err) { renderPair(err.message || String(err)); }
  });
}

// ---------------------------------------------------------------- the log
function renderLog() {
  const left = `<button type="button" class="round left" data-act="settings" aria-label="Settings">${ICON.gear}</button>`;
  app.innerHTML = `${hero({ eyebrow: S.mood === 'day' ? 'The Estate Journal' : 'The Private Cellar', h1: 'Wine Log', left, short: true })}
<div class="log-body">
<div class="search"><label class="sr" for="q">Search wines</label>${ICON.search}<input id="q" type="search" placeholder="Producer, grape, aroma, place" value="${esc(S.query)}" autocomplete="off"></div>
<div class="filters" role="group" aria-label="Filter by style">${FILTERS.map((f) => `<button type="button" class="tag${S.filter === f ? ' on' : ''}" data-act="filter" data-v="${esc(f)}" aria-pressed="${S.filter === f}">${esc(f)}</button>`).join('')}</div>
${navigator.onLine ? '' : '<div class="offline">Offline · new entries save on the phone and sync later</div>'}
<div class="cards" id="cards"></div>
</div>
<button type="button" class="btn fab" data-act="new">${ICON.plus}New Entry</button>`;
  $('#q').addEventListener('input', (e) => { S.query = e.target.value; renderCards(); });
  renderCards();
}
function matches(w, q) {
  if (!q) return true;
  const hay = [w.producer, w.name, w.vintage, w.variety, w.region, w.classification, w.place.name, w.place.address, w.look.type, w.look.hue, w.remarks, w.nose.notes, ...w.nose.tags, ...w.palate.tags].join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((t) => hay.includes(t));
}
function renderCards() {
  const box = $('#cards');
  if (!box) return;
  const list = S.wines.filter((w) => (S.filter === 'All' || w.look.type === S.filter) && matches(w, S.query));
  if (!S.loaded && !S.wines.length) { box.innerHTML = '<div class="empty"><span class="spin" style="color: var(--accent)"></span></div>'; return; }
  if (!S.wines.length) {
    box.innerHTML = `<div class="empty"><span class="row-title">Your first bottle awaits</span><span class="hint">Tap New Entry, then scan the label to get started.</span></div>`;
    return;
  }
  if (!list.length) { box.innerHTML = '<div class="empty"><span class="hint">Nothing matches that yet.</span></div>'; return; }
  box.innerHTML = list.map((w, i) => {
    const placeLine = w.place.name ? `${w.place.kind ? `${w.place.kind} · ` : ''}${w.place.name}` : w.place.kind;
    return `<button type="button" class="card" data-act="open" data-id="${esc(w.id)}" style="animation-delay: ${Math.min(i, 8) * 30}ms">
<span class="thumb">${w.thumb ? `<img src="${esc(w.thumb)}" alt="">` : bottleArt(TYPE_COLOR[w.look.type] || '#B9AE95')}</span>
<span class="grow"><span class="card-name">${esc(title(w))}</span>${metaLine(w) ? `<span class="card-meta">${esc(metaLine(w))}</span>` : ''}${placeLine ? `<span class="card-place">${esc(placeLine)}</span>` : ''}</span>
<span class="card-side"><span class="card-date">${esc(shortDate(w.date))}</span>${w.stars ? `<span class="mini-stars" aria-label="${w.stars} of 5 stars">${starText(w.stars)}</span>` : ''}</span>
</button>`;
  }).join('');
}

// ---------------------------------------------------------------- settings
function openSettings() {
  const sky = skyNow();
  const where = S.coords ? 'where you are' : HOME.label;
  const flip = sky.mood === 'day' ? `Night look starts at sunset, ${clock(sky.set)}` : `Day look returns at sunrise, ${clock(sky.next)}`;
  openSheet(`<h2>Settings</h2>
<div class="section"><span class="label">Day &amp; night</span><p class="hint">Follows the sun in ${esc(where)}. ${esc(flip)}. The sun / moon button flips it until the next sunrise or sunset.</p>
<button type="button" class="btn quiet" data-sheet="locate">Use my current location</button></div>
<div class="section"><label class="label" for="gkey">Label reading (Gemini key)</label>
<p class="hint">Scanning reads labels with Google's Gemini. Paste a free key from <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a> (the same kind Command Deck uses for Data Recap).</p>
<input class="in" id="gkey" type="password" autocomplete="off" placeholder="${S.geminiKey ? 'Key saved · paste to replace' : 'Paste your key'}">
<button type="button" class="btn" data-sheet="key">Save key</button>${S.geminiKey ? '<button type="button" class="link-btn" data-sheet="nokey">Remove key</button>' : ''}</div>
<div class="section"><span class="label">Command Deck</span><p class="hint">Connected. Your tastings are kept with Command Deck.</p>
<button type="button" class="link-btn danger" data-sheet="unpair">Unpair this phone</button></div>
<button type="button" class="btn quiet" data-sheet="close">Done</button>`, (act) => {
    if (act === 'close') closeSheet();
    if (act === 'locate') locate(true);
    if (act === 'key') {
      const v = $('#gkey').value.trim();
      if (!v) return toast('Paste a key first');
      S.geminiKey = v; save('wl.gemini', v); S.model = ''; save('wl.model', '');
      fb.setDoc(ref('wineConfig', 'main'), { geminiKey: v, model: '' }, { merge: true }).catch(() => {});
      closeSheet(); toast('Key saved', { ring: true });
    }
    if (act === 'nokey') {
      S.geminiKey = ''; save('wl.gemini', '');
      fb.setDoc(ref('wineConfig', 'main'), { geminiKey: '' }, { merge: true }).catch(() => {});
      closeSheet(); toast('Key removed');
    }
    if (act === 'unpair') {
      closeSheet();
      confirmSheet('Unpair this phone?', 'Your tastings stay safe with Command Deck. Pair again any time with a new code.', 'Unpair', async () => {
        try { await fb.deleteDoc(fb.doc(S.fire.db, 'decks', S.deckId, 'members', S.uid)); } catch (e) { /* offline: it clears on the deck side */ }
        unpaired();
      });
    }
  });
}
function locate(manual) {
  if (!navigator.geolocation) return manual && toast('Location isn\'t available here');
  navigator.geolocation.getCurrentPosition((pos) => {
    S.coords = { lat: Math.round(pos.coords.latitude * 100) / 100, lon: Math.round(pos.coords.longitude * 100) / 100 };
    save('wl.coords', S.coords);
    if (manual) { closeSheet(); toast('Sunset set for where you are', { ring: true }); }
    if (applyMood()) refreshMood();
  }, () => { if (manual) toast('Location was not allowed. Using Los Angeles.'); }, { maximumAge: 864e5, timeout: 15000 });
}

// ---------------------------------------------------------------- the entry form
function startEntry(w) {
  S.draft = normalize(clone(w || blankWine()));
  S.draftPhoto = undefined;
  S.dirty = false;
  S.results = null;
  S.openFam = { 'nose.tags': 'Fruit', 'palate.tags': null };
  go('entry');
}
function entryHero() {
  const d = parseYmd(S.draft.date) || new Date();
  const left = `<button type="button" class="round left" data-act="leave" aria-label="Back">${ICON.back}</button>`;
  return hero({ eyebrow: `${DAYS[d.getDay()]} · ${MONTHS[d.getMonth()]} ${d.getDate()}`, h1: S.draft.id ? 'Edit Entry' : 'New Entry', left });
}
const secHead = (n, t) => `<div class="sec-head"><span class="num">${n}</span><span class="sec">${esc(t)}</span><span class="rule"></span></div>`;
const textField = (id, label, key, ph, attrs = '') => `<div class="field"><label class="label" for="f-${id}">${esc(label)}</label><input class="in" id="f-${id}" data-bind="${key}" value="${esc(get(S.draft, key))}" placeholder="${esc(ph)}" ${attrs}></div>`;
function get(o, path) { return path.split('.').reduce((v, k) => (v == null ? '' : v[k]), o) ?? ''; }
function set(o, path, val) { const ks = path.split('.'); const last = ks.pop(); ks.reduce((v, k) => v[k], o)[last] = val; }

function renderEntry() {
  const d = S.draft;
  app.innerHTML = `<div id="hero">${entryHero()}</div>
<div class="body">
<button type="button" class="scan" data-act="scan"><span class="scan-icon">${ICON.scan}</span><span class="grow"><span class="scan-title">Scan the label</span><span class="scan-sub">${S.geminiKey ? 'Fills in the details for you' : 'Saves the label photo · add a Gemini key in Settings to fill in details'}</span></span><span style="color: var(--accent); display: flex">${ICON.arrow}</span></button>

<section class="section">${secHead('I', 'The Wine')}
<div class="field"><label class="label" for="f-date">Date</label><input class="in" id="f-date" type="date" data-bind="date" value="${esc(d.date)}"></div>
<div class="field" style="gap: 8px"><span class="label">Where</span><div class="chips4" id="places"></div><div id="place-box" style="display: flex; flex-direction: column; gap: 8px"></div></div>
${textField('producer', 'Producer', 'producer', 'Who made it', 'autocapitalize="words"')}
${textField('name', 'Wine name / vineyard', 'name', 'Name on the label', 'autocapitalize="words"')}
<div class="grid2">${textField('vintage', 'Vintage', 'vintage', 'Year', 'inputmode="numeric"')}${textField('class', 'Classification', 'classification', 'e.g. Reserva', 'autocapitalize="words"')}</div>
${textField('variety', 'Variety(ies)', 'variety', 'Grape or blend', 'autocapitalize="words"')}
${textField('region', 'Region', 'region', 'Where it\'s from', 'autocapitalize="words"')}
<div class="field" style="gap: 8px"><span class="label">Label photo</span><div class="photo-row" id="photo-row"></div></div>
</section>

<section class="section">${secHead('II', 'The Look')}<div id="look" class="section"></div></section>

<section class="section">${secHead('III', 'The Nose')}<div id="nose" class="section"></div>
<label class="sr" for="f-nose">Smell notes</label><textarea class="area" id="f-nose" data-bind="nose.notes" rows="3" placeholder="Anything else you pick up?">${esc(d.nose.notes)}</textarea></section>

<section class="section">${secHead('IV', 'The Palate')}
<div class="panel"><div class="row-top" style="align-items: center"><span class="row-title">Flavors</span><button type="button" class="ghost" data-act="same-nose">Same as nose</button></div><div id="flavors" class="section" style="gap: 6px"></div></div>
<div id="palate" class="section"></div></section>

<section class="section">${secHead('V', 'Final Thoughts')}
<label class="sr" for="f-remarks">Remarks</label><textarea class="area" id="f-remarks" data-bind="remarks" rows="3" placeholder="Food, company, would you buy it again?">${esc(d.remarks)}</textarea>
<div style="display: flex; flex-direction: column; align-items: center; gap: 4px; padding-top: 6px"><div class="stars" id="stars" role="group" aria-label="Rating"></div><span class="label star-text" id="star-text"></span></div>
</section>

<button type="button" class="btn" data-act="save" id="save-btn">${S.mood === 'night' ? 'Save to Cellar' : 'Save to Log'}</button>
${d.id ? '<button type="button" class="link-btn" data-act="cancel-edit" style="align-self: center">Discard changes</button>' : ''}
</div>`;
  renderPlaces(); renderPhotoRow(); renderLook(); renderTags(); renderPalate(); renderStars();
}
function renderPlaces() {
  const d = S.draft;
  $('#places').innerHTML = Object.keys(PLACES).map((k) => `<button type="button" class="chip${d.place.kind === k ? ' on' : ''}" data-act="place-kind" data-v="${k}" aria-pressed="${d.place.kind === k}">${k}</button>`).join('');
  const box = $('#place-box');
  const picked = d.place.name && (d.place.lat != null || d.place.address);
  if (picked) { box.innerHTML = placeCard(d.place, true); return; }
  const r = S.results;
  box.innerHTML = `<div class="find-row"><label class="sr" for="f-place">Place name</label><input class="in" id="f-place" data-bind="place.name" value="${esc(d.place.name)}" placeholder="${esc(PLACES[d.place.kind] || 'Restaurant, winery or shop')}" autocapitalize="words" enterkeyhint="search">
<button type="button" class="circle" data-act="find" aria-label="Find this place">${ICON.search}</button></div>
${r === 'busy' ? '<div class="hint"><span class="spin"></span> Looking nearby…</div>' : ''}
${typeof r === 'string' && r !== 'busy' ? `<p class="hint">${esc(r)}</p>` : ''}
${Array.isArray(r) ? (r.length ? `<div class="results">${r.map((p, i) => `<button type="button" class="result" data-act="place-pick" data-i="${i}"><b>${esc(p.name)}</b><span>${esc(p.address)}</span></button>`).join('')}</div><button type="button" class="link-btn" data-act="place-keep" style="align-self: flex-start">None of these · keep what I typed</button>` : '<p class="hint">No matches. What you typed is kept as the place name.</p>') : ''}`;
}
function renderPhotoRow() {
  const d = S.draft;
  const src = S.draftPhoto === undefined ? (d.thumb || '') : (S.draftPhoto ? d.thumb : '');
  $('#photo-row').innerHTML = `${src ? `<img src="${esc(src)}" alt="Label photo">` : `<span class="thumb-empty">${bottleArt(TYPE_COLOR[d.look.type] || '#B9AE95')}</span>`}
<div class="photo-actions"><button type="button" class="tag" data-act="photo-camera">${src ? 'Retake' : 'Take photo'}</button><button type="button" class="tag" data-act="photo-library">Choose</button>${src ? '<button type="button" class="tag" data-act="photo-remove">Remove</button>' : ''}</div>`;
}
function renderLook() {
  const L = S.draft.look;
  const hues = HUES[L.type] || [];
  $('#look').innerHTML = `<div class="chips2">${TYPES.map((t) => `<button type="button" class="chip${L.type === t ? ' on' : ''}" data-act="type" data-v="${esc(t)}" aria-pressed="${L.type === t}">${esc(t)}</button>`).join('')}</div>
<span class="label">Intensity</span><div class="chips3">${INTENSITY.map((t) => `<button type="button" class="chip${L.intensity === t ? ' on' : ''}" data-act="intensity" data-v="${t}" aria-pressed="${L.intensity === t}">${t}</button>`).join('')}</div>
<span class="label">Hue</span>${hues.length ? `<div class="wrap">${hues.map(([h, c]) => `<button type="button" class="tag hue${L.hue === h ? ' on' : ''}" data-act="hue" data-v="${esc(h)}" aria-pressed="${L.hue === h}"><span class="sw" style="background: ${c}"></span>${esc(h)}</button>`).join('')}</div>` : '<p class="hint">Pick red, white, rosé or sparkling to see its hues.</p>'}`;
}
// The aroma finder, used for The Nose ('nose.tags') and the palate's Flavors ('palate.tags').
function finder(key) {
  const picks = get(S.draft, key);
  const type = S.draft.look.type;
  const open = S.openFam[key];
  const color = (t) => FAMILIES[FAMILY_OF[t]] || 'var(--muted)';
  const countIn = (fam) => aromaGroups(fam, type).reduce((c, [, tags]) => c + tags.filter((t) => picks.includes(t)).length, 0);
  const strip = picks.length
    ? `<div class="wrap">${picks.map((t) => `<button type="button" class="tag on pick" data-act="tag" data-k="${key}" data-v="${esc(t)}" aria-label="Remove ${esc(t)}"><span class="dot" style="background: ${color(t)}"></span>${esc(t)}<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`).join('')}</div>`
    : `<p class="hint">${key === 'nose.tags' ? 'Smell, then open a family below and tap what you find. Aim for three.' : 'Open a family and tap what you taste.'}</p>`;
  const grid = `<div class="fam-grid">${familyOrder(type).map((fam) => {
    const n = countIn(fam);
    return `<button type="button" class="fam${open === fam ? ' open' : ''}" data-act="fam" data-k="${key}" data-v="${esc(fam)}" aria-expanded="${open === fam}">
<span class="fam-dot" style="background: ${FAMILIES[fam]}; box-shadow: 0 0 0 3px ${FAMILIES[fam]}33"></span>
<span class="grow"><span class="fam-name">${esc(fam)}</span><span class="fam-sub">${n ? `${n} picked` : esc(aromaGroups(fam, type).map(([g]) => g).join(' · '))}</span></span></button>`;
  }).join('')}</div>`;
  const drawer = open ? `<div class="drawer"><div class="drawer-head"><span class="fam-dot" style="background: ${FAMILIES[open]}"></span><span class="row-title">${esc(open)}</span></div>
${aromaGroups(open, type).map(([g, tags]) => `<div class="field" style="gap: 6px"><span class="label">${esc(g)}</span><div class="wrap">${tags.map((t) => {
    const on = picks.includes(t);
    return `<button type="button" class="tag${on ? ' on' : ''}" data-act="tag" data-k="${key}" data-v="${esc(t)}" aria-pressed="${on}">${esc(t)}</button>`;
  }).join('')}</div></div>`).join('')}</div>` : '';
  const head = key === 'nose.tags'
    ? `<div class="panel"><div class="row-top"><span class="row-title">Your aromas</span><span class="value">${picks.length ? `${picks.length} aroma${picks.length > 1 ? 's' : ''}` : ''}</span></div>${strip}</div>`
    : strip;
  return `${head}${grid}${drawer}`;
}
function renderTags() { $('#nose').innerHTML = finder('nose.tags'); $('#flavors').innerHTML = finder('palate.tags'); }
function renderFinder(key) { const box = key === 'nose.tags' ? $('#nose') : $('#flavors'); if (box) box.innerHTML = finder(key); }
function renderPalate() {
  const box = $('#palate');
  if (!box) return;
  const P = S.draft.palate;
  box.innerHTML = PALATE.map(([k, label, opts]) => {
    const v = P.levels[k];
    return `<div class="panel"><div class="row-top"><span class="row-title">${esc(label)}</span><span class="value">${v == null ? '' : esc(opts[v])}</span></div>
<div class="scale">${opts.map((o, i) => `<button type="button" data-act="level" data-k="${k}" data-v="${i}" aria-label="${esc(label)}: ${esc(o)}" aria-pressed="${v === i}"><span class="mark${v != null && i <= v ? ' on' : ''}${v === i ? ' cur' : ''}"></span></button>`).join('')}</div>
<div class="ends"><span>${esc(opts[0])}</span><span>${esc(opts[4])}</span></div>
<label class="sr" for="n-${k}">${esc(label)} note</label><input class="in" id="n-${k}" data-bind="palate.notes.${k}" value="${esc(P.notes[k])}" placeholder="Note (optional)"></div>`;
  }).join('');
}
function renderStars() {
  const n = S.draft.stars;
  const box = $('#stars');
  box.className = `stars${S.popStars ? ' pop' : ''}`;
  S.popStars = false;
  box.innerHTML = [1, 2, 3, 4, 5].map((k) => `<button type="button" class="star-btn${k <= n ? ' on' : ''}" data-act="star" data-v="${k}" aria-label="${k} star${k > 1 ? 's' : ''}" aria-pressed="${k === n}">${ICON.star}</button>`).join('');
  $('#star-text').textContent = n ? `${n} of 5` : 'Tap to rate';
}

async function find() {
  const d = S.draft;
  const q = d.place.name.trim();
  if (q.length < 2) return toast('Type the place name first');
  if (!navigator.onLine) { S.results = 'No signal right now. What you typed is kept as the place name.'; return renderPlaces(); }
  S.results = 'busy'; renderPlaces();
  try { S.results = (await findPlaces(q)).slice(0, 6); } catch (e) { S.results = e.message || 'The place search didn\'t answer. What you typed is kept.'; }
  renderPlaces();
}

function saveEntry() {
  const d = S.draft;
  ['producer', 'name', 'vintage', 'classification', 'variety', 'region', 'remarks'].forEach((k) => { d[k] = String(d[k] || '').trim(); });
  d.place.name = String(d.place.name || '').trim();
  if (!d.producer && !d.name) { toast('Add a producer or wine name first'); const f = $('#f-producer'); if (f) f.focus(); return; }
  const now = Date.now();
  const isNew = !d.id;
  if (isNew) { d.id = makeId('w'); d.createdAt = now; }
  d.updatedAt = now;
  if (S.draftPhoto === null) { d.thumb = ''; d.hasPhoto = false; }
  if (typeof S.draftPhoto === 'string') d.hasPhoto = true;
  const docData = clone(d);
  delete docData.id;
  // Writes queue on the phone when there's no signal and go out on their own later.
  fb.setDoc(ref('wines', d.id), docData).catch((e) => { console.warn('save', e); toast('Couldn\'t save that. Check the connection and try again.'); });
  if (typeof S.draftPhoto === 'string') { S.photos.set(d.id, S.draftPhoto); fb.setDoc(ref('winePhotos', d.id), { data: S.draftPhoto, at: now }).catch(() => {}); }
  if (S.draftPhoto === null) { S.photos.delete(d.id); fb.deleteDoc(ref('winePhotos', d.id)).catch(() => {}); }
  const i = S.wines.findIndex((w) => w.id === d.id);
  if (i >= 0) S.wines[i] = normalize(clone(d)); else S.wines.unshift(normalize(clone(d)));
  S.dirty = false;
  go('bottle', d.id);
  toast(isNew ? (S.mood === 'night' ? 'Saved to the cellar' : 'Saved to the log') : 'Changes saved', { ring: true });
}
function leaveEntry() {
  const back = () => (S.draft && S.draft.id ? go('bottle', S.draft.id) : go('log'));
  if (!S.dirty) return back();
  confirmSheet('Leave without saving?', 'What you\'ve filled in on this entry will be lost.', 'Leave', back);
}

// ---------------------------------------------------------------- scanning
let pickFor = null; // 'scan' or 'photo'
function choosePhoto(mode, source) {
  pickFor = mode;
  const input = $(source === 'library' ? '#library' : '#camera');
  input.value = '';
  input.click();
}
async function gotFile(file) {
  if (!file) return;
  const mode = pickFor; pickFor = null;
  if (mode === 'scan') return scan(file);
  try {
    const p = await preparePhoto(file);
    S.draftPhoto = p.photo; S.draft.thumb = p.thumb; S.dirty = true;
    renderPhotoRow();
  } catch (e) { toast(e.message || 'That photo could not be used'); }
}
function scanShell(img, inner) {
  let s = $('#scanner');
  if (!s) { s = document.createElement('div'); s.id = 'scanner'; s.className = 'scan-screen'; s.setAttribute('role', 'dialog'); s.setAttribute('aria-label', 'Scan the label'); document.body.appendChild(s); }
  s.innerHTML = `<div class="scan-photo">${img ? `<img src="${esc(img)}" alt="">` : ''}</div>
<button type="button" class="round left" data-scan="close" aria-label="Close" style="color: #EFE6D6; background: rgba(14,12,10,.7); border-color: rgba(239,230,214,.25)">${ICON.close}</button>${inner}`;
  s.onclick = (e) => { const a = e.target.closest('[data-scan]'); if (a) scanAction(a.dataset.scan); };
  return s;
}
function closeScan() { const s = $('#scanner'); if (s) s.remove(); }
let scanResult = null;
async function scan(file) {
  let p;
  try { p = await preparePhoto(file); } catch (e) { return toast(e.message || 'That photo could not be used'); }
  // The photo you took becomes the label photo either way.
  S.draftPhoto = p.photo; S.draft.thumb = p.thumb; S.dirty = true;
  renderPhotoRow();
  if (!S.geminiKey) {
    scanShell(p.photo, `<div class="found"><div class="handle"></div><span class="eyebrow" style="text-align: center">Photo saved</span><h2 class="h1" style="font-size: 30px; text-align: center">Label photo added</h2>
<p class="hint">To have labels read and the details filled in for you, add a free Gemini key in Settings (gear on the Wine Log screen).</p>
<button type="button" class="btn" data-scan="close">Continue</button></div>`);
    return;
  }
  scanShell(p.photo, `<div class="scan-frame"><i></i><i></i><i></i><i></i><span class="sweep"></span></div>
<div class="scan-bottom"><span class="row-title" style="font-family: var(--display)">Reading the label…</span><span class="hint">Producer, vintage, grape, region</span></div>`);
  try {
    scanResult = await readLabel(p.forReading);
    if (!$('#scanner')) return; // closed while reading
    const rows = [['Producer', scanResult.producer], ['Wine name', scanResult.name], ['Vintage', scanResult.vintage], ['Variety', scanResult.variety], ['Region', scanResult.region], ['Classification', scanResult.classification], ['Style', scanResult.type]];
    const any = rows.some(([, v]) => v);
    scanShell(p.photo, `<div class="found"><div class="handle"></div><span class="eyebrow" style="text-align: center">Label read</span>
<h2 class="h1" style="font-size: 30px; text-align: center">${any ? 'Here\'s what I found' : 'Couldn\'t make it out'}</h2>
${any ? `<div>${rows.map(([k, v]) => `<div class="found-row"><span class="label">${k}</span><span class="found-val${v ? '' : ' none'}">${esc(v || 'Not on label')}</span></div>`).join('')}</div>` : '<p class="hint">The label wasn\'t readable in that photo. Try again closer, with the label flat and well lit.</p>'}
<p class="hint">Your photo is kept as the label photo.${any ? ' Anything wrong can be fixed on the next screen.' : ''}</p>
${any ? '<button type="button" class="btn" data-scan="use">Use these details</button>' : ''}
<button type="button" class="btn quiet" data-scan="retake">Retake photo</button>
${any ? '' : '<button type="button" class="link-btn" data-scan="close">Fill in by hand</button>'}</div>`);
  } catch (e) {
    if (!$('#scanner')) return;
    scanShell(p.photo, `<div class="found"><div class="handle"></div><h2 class="h1" style="font-size: 28px; text-align: center">Couldn't read it this time</h2>
<p class="hint">${esc(e.message || 'Something went wrong reading the label.')}</p><p class="hint">Your photo is kept as the label photo.</p>
<button type="button" class="btn" data-scan="retake">Try again</button><button type="button" class="btn quiet" data-scan="close">Fill in by hand</button></div>`);
  }
}
function scanAction(act) {
  if (act === 'close') { closeScan(); return; }
  if (act === 'retake') { closeScan(); choosePhoto('scan', 'camera'); return; }
  if (act === 'use' && scanResult) {
    const d = S.draft, r = scanResult;
    ['producer', 'name', 'vintage', 'variety', 'region', 'classification'].forEach((k) => { if (r[k]) d[k] = r[k]; });
    if (r.type) { d.look.type = r.type; if (!(HUES[r.type] || []).some(([h]) => h === d.look.hue)) d.look.hue = ''; }
    S.dirty = true;
    closeScan();
    renderEntry();
    toast('Details filled in', { ring: true });
  }
}

// ---------------------------------------------------------------- bottle page
function renderBottle() {
  const w = S.wines.find((x) => x.id === S.currentId);
  if (!w) { if (S.loaded) return go('log'); app.innerHTML = '<div class="empty"><span class="spin"></span></div>'; return; }
  const cached = S.photos.get(w.id);
  const photo = cached || w.thumb;
  const left = `<button type="button" class="round left" data-act="home" aria-label="Back to log">${ICON.back}</button>`;
  const L = w.look;
  const look = [L.hue, L.intensity && `${L.intensity} intensity`, L.type].filter(Boolean).join(' · ');
  const levels = PALATE.filter(([k]) => w.palate.levels[k] != null || w.palate.notes[k]);
  app.innerHTML = `<div class="photo-hero">${photo ? `<img id="hero-img" src="${esc(photo)}" alt="Label photo">` : `<div class="placeholder">${bottleArt(TYPE_COLOR[L.type] || '#B9AE95', 160, 210)}</div>`}${left}${moodBtn()}</div>
<div class="bottle-sheet">
<div class="bottle-head"><span class="eyebrow">Tasted ${esc(longDate(w.date))}</span><h1 class="h1">${esc(title(w))}</h1>${metaLine(w) || w.classification ? `<span class="meta">${esc([metaLine(w), w.classification].filter(Boolean).join(' · '))}</span>` : ''}
${w.stars ? `<div class="stars" style="padding-top: 8px" role="img" aria-label="${w.stars} of 5 stars">${[1, 2, 3, 4, 5].map((k) => `<span class="star-btn${k <= w.stars ? ' on' : ''}" style="width: 30px; height: 30px">${ICON.star.replace('<svg', '<svg style="width: 26px; height: 26px"')}</span>`).join('')}</div>` : ''}</div>
${w.place.name || w.place.kind ? (w.place.name ? placeCard(w.place, false) : `<div class="view-block"><span class="label">Where</span><span class="view-text">${esc(w.place.kind)}</span></div>`) : ''}
${look ? `<div class="view-block"><span class="label">The Look</span><span class="view-text">${esc(look)}</span></div>` : ''}
${w.nose.tags.length || w.nose.notes ? `<div class="view-block"><span class="label">The Nose</span>${w.nose.tags.length ? `<div class="wrap">${w.nose.tags.map((t) => `<span class="view-tag">${esc(t)}</span>`).join('')}</div>` : ''}${w.nose.notes ? `<span class="view-text">${esc(w.nose.notes)}</span>` : ''}</div>` : ''}
${levels.length || w.palate.tags.length ? `<div class="view-block" style="gap: 12px"><span class="label">The Palate</span>
${w.palate.tags.length ? `<div class="wrap">${w.palate.tags.map((t) => `<span class="view-tag">${esc(t)}</span>`).join('')}</div>` : ''}
${levels.map(([k, label, opts]) => { const v = w.palate.levels[k]; return `<div class="pal-row"><span class="pal-name">${esc(label.replace(' %', ''))}</span><span class="pal-scale">${v == null ? '' : opts.map((o, i) => `<span class="mark${i <= v ? ' on' : ''}" style="${S.mood === 'night' ? 'width: 100%' : ''}"></span>`).join('')}</span><span class="pal-val">${v == null ? '' : esc(opts[v])}</span></div>${w.palate.notes[k] ? `<div class="pal-note">${esc(w.palate.notes[k])}</div>` : ''}`; }).join('')}</div>` : ''}
${w.remarks ? `<div class="view-block"><span class="label">Final Thoughts</span><span class="view-text">${esc(w.remarks)}</span></div>` : ''}
<div class="bottle-actions"><button type="button" class="btn" data-act="edit">Edit</button><button type="button" class="btn quiet" data-act="delete">Delete</button></div>
</div>`;
  if (w.hasPhoto && !cached) getPhoto(w.id).then((data) => { const img = $('#hero-img'); if (data && S.view === 'bottle' && S.currentId === w.id) { if (img) img.src = data; else render(); } });
}

// ---------------------------------------------------------------- clicks and typing
app.addEventListener('click', (e) => {
  const a = e.target.closest('[data-act]');
  if (!a) return;
  const act = a.dataset.act, v = a.dataset.v;
  const d = S.draft;
  switch (act) {
    case 'mood': toggleMood(); break;
    case 'settings': openSettings(); break;
    case 'filter': S.filter = v; document.querySelectorAll('[data-act="filter"]').forEach((b) => { b.classList.toggle('on', b.dataset.v === v); b.setAttribute('aria-pressed', b.dataset.v === v); }); renderCards(); break;
    case 'new': startEntry(); break;
    case 'open': go('bottle', a.dataset.id); break;
    case 'home': go('log'); break;
    case 'edit': startEntry(S.wines.find((w) => w.id === S.currentId)); break;
    case 'delete': {
      const w = S.wines.find((x) => x.id === S.currentId);
      if (!w) break;
      confirmSheet('Delete this entry?', `${title(w)} will be removed from your log for good.`, 'Delete', () => {
        fb.deleteDoc(ref('wines', w.id)).catch(() => {});
        if (w.hasPhoto) fb.deleteDoc(ref('winePhotos', w.id)).catch(() => {});
        S.wines = S.wines.filter((x) => x.id !== w.id);
        S.photos.delete(w.id);
        go('log');
        toast('Entry deleted');
      });
      break;
    }
    case 'leave': leaveEntry(); break;
    case 'cancel-edit': S.dirty = false; go('bottle', d.id); break;
    case 'save': saveEntry(); break;
    case 'scan': choosePhoto('scan', 'camera'); break;
    case 'photo-camera': choosePhoto('photo', 'camera'); break;
    case 'photo-library': choosePhoto('photo', 'library'); break;
    case 'photo-remove': S.draftPhoto = null; d.thumb = ''; S.dirty = true; renderPhotoRow(); break;
    case 'place-kind': d.place.kind = d.place.kind === v ? '' : v; S.dirty = true; renderPlaces(); break;
    case 'find': find(); break;
    case 'place-pick': {
      const p = S.results[Number(a.dataset.i)];
      if (p) Object.assign(d.place, { name: p.name, address: p.address, lat: p.lat, lon: p.lon, website: p.website });
      S.results = null; S.dirty = true; renderPlaces(); break;
    }
    case 'place-keep': S.results = null; renderPlaces(); break;
    case 'place-clear': Object.assign(d.place, { name: '', address: '', lat: null, lon: null, website: '' }); S.results = null; S.dirty = true; renderPlaces(); break;
    case 'type': d.look.type = d.look.type === v ? '' : v; if (!(HUES[d.look.type] || []).some(([h]) => h === d.look.hue)) d.look.hue = ''; S.dirty = true; renderLook(); renderPhotoRow(); renderTags(); break;
    case 'intensity': d.look.intensity = d.look.intensity === v ? '' : v; S.dirty = true; renderLook(); break;
    case 'hue': d.look.hue = d.look.hue === v ? '' : v; S.dirty = true; renderLook(); break;
    case 'tag': {
      const list = get(d, a.dataset.k);
      const i = list.indexOf(v);
      if (i >= 0) list.splice(i, 1); else list.push(v);
      S.dirty = true; renderFinder(a.dataset.k); break;
    }
    case 'fam': {
      const k = a.dataset.k;
      S.openFam[k] = S.openFam[k] === v ? null : v;
      renderFinder(k); break;
    }
    case 'same-nose': d.palate.tags = d.nose.tags.slice(); S.dirty = true; renderTags(); toast(d.nose.tags.length ? 'Copied from the nose' : 'Pick some aromas under The Nose first'); break;
    case 'level': { const k = a.dataset.k, n = Number(v); d.palate.levels[k] = d.palate.levels[k] === n ? null : n; S.dirty = true; renderPalate(); break; }
    case 'star': { const n = Number(v); d.stars = d.stars === n ? 0 : n; S.popStars = d.stars > 0; S.dirty = true; renderStars(); break; }
    default: break;
  }
});
app.addEventListener('input', (e) => {
  const key = e.target.dataset && e.target.dataset.bind;
  if (!key || !S.draft) return;
  set(S.draft, key, e.target.value);
  S.dirty = true;
  if (key === 'place.name' && Array.isArray(S.results)) { S.results = null; const r = $('.results'); if (r) { r.nextElementSibling && r.nextElementSibling.remove(); r.remove(); } }
  if (key === 'date') { const h = $('#hero'); if (h) h.innerHTML = entryHero(); }
});
app.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'f-place') { e.preventDefault(); find(); } });
$('#camera').addEventListener('change', (e) => gotFile(e.target.files && e.target.files[0]));
$('#library').addEventListener('change', (e) => gotFile(e.target.files && e.target.files[0]));
window.addEventListener('online', () => { if (S.view === 'log') renderLog(); });
window.addEventListener('offline', () => { if (S.view === 'log') renderLog(); });
window.addEventListener('beforeunload', (e) => { if (S.view === 'entry' && S.dirty) { e.preventDefault(); e.returnValue = ''; } });

// ---------------------------------------------------------------- start
(async function boot() {
  applyMood(true);
  // Sunset follows where you are when the phone already allows location; otherwise Los Angeles until you choose.
  try { if (navigator.permissions) { const p = await navigator.permissions.query({ name: 'geolocation' }); if (p.state === 'granted') locate(false); } } catch (e) { /* not supported */ }
  if (!S.deckId) { S.view = 'pair'; render(); getConfig(); return; }
  S.view = 'log';
  render();
  try { await connect(); start(); } catch (e) {
    console.warn('connect', e);
    toast('Can\'t reach Command Deck right now. Showing what\'s saved on this phone.');
    // Try again when the signal comes back.
    window.addEventListener('online', async function retry() { try { await connect(); start(); window.removeEventListener('online', retry); } catch (err) { /* still offline */ } });
  }
})();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
