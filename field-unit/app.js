// ============================================================
// FIELD UNIT — Command Deck's iPhone companion (web app)
// ============================================================
import * as fb from './lib/core.js';
import { DeckSync, normalizePairCode, formatPairCode, makeId, startFirebase, signIn } from './lib/sync.js';
import * as U from './lib/util.js';
import { ManifestRelay, manifestUrl } from './lib/manifest.js';
import { RosterRelay, scheduleUrl, DEFAULT_TYPES, weekStart, addDays, weekLabel, weekDays, ymd, parseYmd, typeOf, shortName, dayLabel, timeRange, parseTime } from './lib/roster.js';
import { bootScreen } from './boot.js';

const { $, $$, esc } = U;
const VERSION = 'v1.14.1';
// Field Scan (the in-app text reader) is switched off for now; the code stays for when it comes back.
const FIELD_SCAN = false;
const STANDALONE = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

// ---------------------------------------------------------------- defaults
const DEFAULT_SETTINGS = {
  callsign: 'Field Unit',
  theme: 'dusk',
  frame: 'dark',
  trim: 'none',
  font: 'auto',
  commsSound: 'mainframe',
  humor: 40,
  phrases: {},
  installDismissed: false
};

const PHRASES = {
  greet: ['{callsign} online. Go ahead, {name}.', 'Channel open. Go ahead, {name}.', '{callsign} standing by.'],
  copy: ['Copy.', 'Understood.', 'Affirmative.'],
  transmit: ['Transmitting data to Command…', 'Relaying to Command…', 'Sending to Command now…'],
  ack: ['Command acknowledges.', 'Command confirms receipt.', 'Received by Command.'],
  offline: ['Unable to reach Command. Data stored locally. Will transmit when signal returns.'],
  deleteAsk: ['Request to delete {title}. Confirm?'],
  deleted: ['Confirmed. Purge order sent to Command.'],
  briefing: ['Requesting status report from Command. Receiving.'],
  timer: ['{callsign} will alert you.'],
  miss: ['Command not recognized. Rephrase, or type help.', 'Signal garbled. Repeat? Type help for examples.']
};
const PHRASE_LABELS = {
  greet: 'Greeting', copy: 'Before confirming', transmit: 'Sending to Command', ack: 'Command received it',
  offline: 'No signal', deleteAsk: 'Asking to delete', deleted: 'Deleted', briefing: 'Before a briefing',
  timer: 'After setting a timer', miss: "Didn't understand"
};
const QUIPS = [
  "Command will pretend it didn't see the deadline.", 'Another one for the pile.', 'Bold move.',
  'Command is thrilled. Probably.', "Logged. I'd salute, but no arms."
];

const PRI = { high: { n: 3, color: 'var(--coral)', label: 'HIGH' }, medium: { n: 2, color: 'var(--amber)', label: 'MED' }, low: { n: 1, color: 'var(--lav)', label: 'LOW' } };
const FALLBACK_CATEGORIES = [
  { id: 'home', name: 'Home', color: '#F2A65A' }, { id: 'work', name: 'Work', color: '#F4B6A0' },
  { id: 'errands', name: 'Errands', color: '#A8B0D8' }, { id: 'personal', name: 'Personal', color: '#D9A9C6' }
];

// ---------------------------------------------------------------- storage
function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch (e) { return fallback; }
}
function store(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage full or blocked */ }
}

const S = {
  settings: { ...DEFAULT_SETTINGS, ...load('fu.settings', {}) },
  deckId: load('fu.deckId', null),
  tasks: load('fu.tasks', []),
  events: load('fu.events', []),
  timers: load('fu.timers', []),
  notes: load('fu.notes', []),
  projects: load('fu.projects', []),
  schedule: load('fu.schedule', []),
  schedWeek: weekStart(new Date()),
  roster: null,
  tkView: 'queue',
  noteSearch: null,
  shared: load('fu.shared', null),
  calendar: load('fu.calendar', { events: [], updatedAt: 0 }),
  command: load('fu.command', { lastSeen: 0 }),
  config: load('fu.config', null),
  weather: null,
  view: 'today',
  filter: 'all',
  calMonth: null,
  calSel: null,
  fire: null,
  uid: null,
  sync: null,
  relay: null,
  openPj: null, // project id whose sheet is open
  memberUnsub: null,
  connected: false,
  pendingDelete: null,
  alert: null,
  lastAlert: null,
  pairCodeFromLink: null
};

function saveSettings() { store('fu.settings', S.settings); applyTheme(); }
function shared() { return S.shared || {}; }
function categories() { return (shared().categories && shared().categories.length) ? shared().categories : FALLBACK_CATEGORIES; }
function people() { return shared().people || ['Me']; }
function scheduleTypes() { const t = shared().scheduleTypes; return Array.isArray(t) && t.length ? t : DEFAULT_TYPES; }
function operator() { return shared().operatorName || 'Commander'; }
function clock24() { return !!shared().clock24; }
function commandOnline() { return Date.now() - (S.command.lastSeen || 0) < 3 * 60000; }

let saveTimer = null;
function persist(kind) {
  store(`fu.${kind}`, S[kind]);
  if (S.sync) S.sync.push(kind);
  if (S.relay && (kind === 'tasks' || kind === 'projects')) S.relay.schedule();
  if (S.roster && kind === 'schedule') S.roster.schedule();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(render, 30);
}

// ---------------------------------------------------------------- small UI helpers
const THEME_FONT = { dusk: 'chakra', space: 'chakra', red: 'chakra', terminal: 'chakra', retro: 'sharetech', moonbase: 'michroma', blueprint: 'spacemono', cryo: 'exo2', freighter: 'b612', skydock: 'quantico', vector: 'tektur' };
const THEME_BG = { moonbase: '#DADDE1', blueprint: '#0E2A47', cryo: '#E6F0F7', freighter: '#0A0C07', skydock: '#EEF1F4', vector: '#03050A' };
const THEMES = [
  ['dusk', 'DUSK', ['#F2A65A', '#A8B0D8']], ['space', 'DEEP SPACE', ['#4FD1E8', '#9FB7FF']], ['red', 'RED ALERT', ['#FF4D4D', '#FFD27A']],
  ['terminal', 'TERMINAL', ['#39FF88', '#1F3328']], ['retro', 'RETRO', ['#5EE7FF', '#FF7BD5']],
  ['moonbase', "MOONBASE '79", ['#F05A1A', '#E4E6E9']], ['blueprint', 'BLUEPRINT', ['#8EC5FF', '#0E2A47']],
  ['cryo', 'CRYO', ['#2D8CFF', '#D6E7F3']], ['freighter', 'FREIGHTER', ['#9CF2A8', '#E8C547']],
  ['skydock', 'SKYDOCK', ['#1FB8F0', '#F2F4F7']], ['vector', 'VECTOR', ['#FF7A2F', '#62D9FF']]
];
const FONTS = [
  ['auto', 'THEME DEFAULT', ''], ['chakra', 'CHAKRA', "'Chakra Petch'"], ['michroma', 'MICHROMA', "'Michroma Scaled'"],
  ['spacemono', 'SPACE MONO', "'Space Mono'"], ['exo2', 'EXO 2', "'Exo 2'"], ['b612', 'B612 MONO', "'B612 Mono'"],
  ['vt323', 'VT323', "'VT323 Scaled'"], ['orbitron', 'ORBITRON', "'Orbitron Scaled'"], ['oxanium', 'OXANIUM', "'Oxanium'"],
  ['rajdhani', 'RAJDHANI', "'Rajdhani Scaled'"], ['sharetech', 'SHARE TECH MONO', "'Share Tech Mono'"], ['majormono', 'MAJOR MONO', "'Major Mono Scaled'"],
  ['quantico', 'QUANTICO', "'Quantico'"], ['tektur', 'TEKTUR', "'Tektur'"]
];
const INKS = [['theme', 'THEME', null], ['amber', 'AMBER CRT', '#FFC27A'], ['phosphor', 'PHOSPHOR', '#A8F5B4'], ['ice', 'ICE', '#CFE6FF'], ['arctic', 'ARCTIC', '#FFFFFF'], ['rose', 'ROSE', '#F6C1CF']];
const FRAMES = [['dark', 'DARK', '#14151B'], ['bone', 'BONE', '#EEDDC3'], ['gunmetal', 'GUNMETAL', '#3A3E44'], ['olive', 'OLIVE DRAB', '#4A5236'], ['navy', 'MIDNIGHT NAVY', '#16264A']];
const TRIMS = [['none', 'NONE', []], ['sunset', 'SUNSET', ['#B5432A', '#E07A2E', '#E9B23B']], ['mission', 'MISSION', ['#E5532D', '#EADBC2', '#3F68A6']], ['arcade', 'ARCADE', ['#D6457E', '#F08A3C', '#F2C94C', '#3FB3A8']],
  ['hazard', 'HAZARD', ['#E8C547', '#1A1A1A', '#E8C547', '#1A1A1A']], ['aurora', 'AURORA', ['#2BB3A3', '#6FD08C', '#8E6CD8']], ['gulf', 'GULF', ['#8FC1E3', '#F28A2E', '#8FC1E3']],
  ['dock', 'DOCK LIGHTS', ['#1FB8F0', '#F4B41A', '#FF4F86', '#EE8A2E']]];
function applyTheme() {
  const theme = S.settings.theme || 'dusk';
  const font = S.settings.font || 'auto';
  document.body.dataset.theme = theme;
  document.body.dataset.font = font === 'auto' ? (THEME_FONT[theme] || 'chakra') : font;
  document.body.dataset.ink = S.settings.ink || 'theme';
  if (theme === 'moonbase' || theme === 'cryo' || theme === 'skydock') document.body.dataset.light = '1'; else delete document.body.dataset.light;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = THEME_BG[theme] || '#0B0C11';
  document.body.dataset.frame = S.settings.frame || 'dark';
  document.body.dataset.trim = S.settings.trim || 'none';
}

let toastTimer = null;
function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), ms);
}

function pick(key, vars = {}) {
  const custom = S.settings.phrases && S.settings.phrases[key];
  const pool = (custom && custom.length ? custom : PHRASES[key]) || [''];
  const line = pool[Math.floor(Math.random() * pool.length)];
  return line.replace(/\{(\w+)\}/g, (_, k) => (k === 'callsign' ? S.settings.callsign : k === 'name' ? operator() : (vars[k] ?? '')));
}

function quip() {
  const h = S.settings.humor ?? 0;
  if (h < 10 || Math.random() > (h / 100) * 0.7) return '';
  return ` ${QUIPS[Math.floor(Math.random() * QUIPS.length)]}`;
}

function categoryById(id) { return categories().find((c) => c.id === id); }

const IC = {
  check: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5 L5 9 L10 3" fill="none" stroke="#14151B" stroke-width="2"/></svg>',
  plus: '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M9 2 V16 M2 9 H16" stroke="currentColor" stroke-width="1.6"/></svg>',
  close: '<svg width="14" height="14" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2 L8 8 M8 2 L2 8" stroke="currentColor" stroke-width="1.2"/></svg>',
  left: '<svg width="12" height="12" viewBox="0 0 10 10" aria-hidden="true"><path d="M6.5 1.5 L3 5 L6.5 8.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  right: '<svg width="12" height="12" viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 1.5 L7 5 L3.5 8.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  gear: '<svg width="18" height="18" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="2.2" fill="none" stroke="currentColor" stroke-width="1.1"/><path d="M7 1 V3 M7 11 V13 M1 7 H3 M11 7 H13 M2.8 2.8 L4.2 4.2 M9.8 9.8 L11.2 11.2 M2.8 11.2 L4.2 9.8 M9.8 4.2 L11.2 2.8" stroke="currentColor" stroke-width="1.1"/></svg>',
  scan: '<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><path d="M2 8 V3 H7 M19 3 H24 V8 M24 18 V23 H19 M7 23 H2 V18" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M7 9 H19 M7 13 H17 M7 17 H14" stroke="currentColor" stroke-width="1.6"/></svg>',
  pin: '<svg width="12" height="12" viewBox="0 0 12 12" role="img" aria-label="Pinned"><path d="M4 1 H8 L7.4 5 L9.5 7 H2.5 L4.6 5 Z M6 7 V11" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  search: '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12 12 L16 16" stroke="currentColor" stroke-width="1.5"/></svg>',
  sun: '<svg width="16" height="16" viewBox="0 0 34 34" aria-hidden="true"><circle cx="17" cy="17" r="6.5" fill="none" stroke="var(--amber)" stroke-width="2"/><path d="M17 3 V7 M17 27 V31 M3 17 H7 M27 17 H31 M7 7 L9.8 9.8 M24.2 24.2 L27 27 M7 27 L9.8 24.2 M24.2 9.8 L27 7" stroke="var(--amber)" stroke-width="2"/></svg>'
};

// ---------------------------------------------------------------- sounds (alerts + small UI chirps)
let audio = null;
function ac() {
  if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
  if (audio.state === 'suspended') audio.resume();
  return audio;
}
function tone(freq, start, dur, vol = 0.12, type = 'sine', to = null) {
  try {
    const c = ac();
    const t0 = c.currentTime + start;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(c.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  } catch (e) { /* audio unavailable */ }
}
const chirp = {
  ack() { if (S.settings.commsSound === 'off') return; tone(1200, 0, 0.07, 0.08); tone(1600, 0.08, 0.1, 0.08); },
  alert() { for (let i = 0; i < 3; i++) { tone(988, i * 0.5, 0.12, 0.18, 'triangle'); tone(1319, i * 0.5 + 0.14, 0.18, 0.18, 'triangle'); } }
};

// ---------------------------------------------------------------- Firebase / Command link
async function getConfig() {
  try {
    const res = await fetch('/__/firebase/init.json', { cache: 'no-store' });
    if (res.ok) {
      const cfg = await res.json();
      S.config = cfg;
      store('fu.config', cfg);
      return cfg;
    }
  } catch (e) { /* offline: use the cached copy */ }
  return S.config;
}

async function connect() {
  const cfg = await getConfig();
  if (!cfg) throw new Error('Field Unit is not connected to a Firebase project yet.');
  if (!S.fire) S.fire = startFirebase(fb, cfg, 'field-unit');
  const user = await signIn(fb, S.fire.auth);
  S.uid = user.uid;
}

async function pairWith(codeText) {
  const code = normalizePairCode(codeText);
  if (code.length !== 6) throw new Error('Enter the 6-character code shown on Command Deck.');
  await connect();
  let snap;
  try {
    snap = await fb.getDoc(fb.doc(S.fire.db, 'pairCodes', code));
  } catch (e) {
    throw new Error('That code has expired or is not valid. Show a new one on Command Deck.');
  }
  if (!snap.exists()) throw new Error('Code not recognized. Check it, or show a new one on Command Deck.');
  const deckId = snap.data().deckId;
  const ua = navigator.userAgent;
  const device = /iPad/.test(ua) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : 'Browser';
  try {
    await fb.setDoc(fb.doc(S.fire.db, 'decks', deckId, 'members', S.uid), {
      kind: 'phone', name: `${S.settings.callsign} · ${device}`, joinedAt: Date.now(), code
    });
  } catch (e) {
    throw new Error('Command refused the code (it may have just expired). Show a new one and try again.');
  }
  S.deckId = deckId;
  store('fu.deckId', deckId);
  startSync();
}

function startSync() {
  if (!S.fire || !S.deckId) return;
  if (S.sync) S.sync.stop();
  S.sync = new DeckSync(fb, S.fire.db, S.deckId, S.uid);
  const lists = { tasks: () => S.tasks, events: () => S.events, timers: () => S.timers, notes: () => S.notes, projects: () => S.projects, schedule: () => S.schedule };
  for (const kind of Object.keys(lists)) {
    S.sync.track(kind, lists[kind], (list) => {
      if (kind === 'tasks') S.tasks = list;
      else if (kind === 'events') S.events = list;
      else if (kind === 'notes') S.notes = list;
      else if (kind === 'projects') S.projects = list;
      else if (kind === 'schedule') S.schedule = list;
      else { timersRemoved(S.timers, list); S.timers = list.sort((a, b) => new Date(a.endsAt) - new Date(b.endsAt)); }
      store(`fu.${kind}`, list);
      render();
      if (S.firstSync) { S.firstSync(); S.firstSync = null; }
      if (kind === 'tasks' || kind === 'projects') { if (S.relay) S.relay.schedule(); refreshProjectSheet(); }
      if (kind === 'schedule' && S.roster) S.roster.schedule();
    }, (err) => console.warn('sync', kind, err));
  }
  // Project Manifest: keep shared projects' guest links in step (Command Deck does the same when it's on).
  if (S.relay) S.relay.stop();
  S.relay = new ManifestRelay(fb, S.fire.db, S.deckId, S.uid, {
    getProjects: () => S.projects,
    getTasks: () => S.tasks,
    guestChanges,
    addLog: addProjectLog,
    onActivity: guestActivity,
    getLook: () => ({ theme: S.settings.theme || 'dusk', font: S.settings.font || 'auto', ink: S.settings.ink || 'theme', trim: S.settings.trim || 'none' }),
    operatorName: () => operator()
  });
  let crewSig = '';
  S.relay.onChange(() => {
    const sig = JSON.stringify(S.projects.map((p) => S.relay ? S.relay.forProject(p.id).map((c) => [c.token, c.level]) : []));
    if (sig === crewSig) return;
    crewSig = sig;
    if (S.view === 'tasks') render();
    refreshProjectSheet();
    if (S.shareRedraw && $('.sheet [data-share-sheet]')) S.shareRedraw();
  });
  S.relay.start();
  // Schedule links: same idea for the shared schedule (GOT IT / CHANGE REQUEST replies).
  if (S.roster) S.roster.stop();
  S.roster = new RosterRelay(fb, S.fire.db, S.deckId, S.uid, {
    getEntries: () => S.schedule,
    getTypes: () => scheduleTypes(),
    applyReplies: (changes) => {
      for (const c of changes) { const e = S.schedule.find((x) => x.id === c.entryId); if (e) e.replies = { ...(e.replies || {}), [c.token]: c.reply }; }
      persist('schedule');
    },
    onActivity: (events) => { if (!events.length) return; chirp.ack(); toast(events[events.length - 1].text, events.some((e) => e.state === 'change') ? 6000 : 3500); },
    getLook: () => ({ theme: S.settings.theme || 'dusk', font: S.settings.font || 'auto', ink: S.settings.ink || 'theme', trim: S.settings.trim || 'none', clock24: clock24() }),
    operatorName: () => operator()
  });
  let rosterSig = '';
  S.roster.onChange(() => {
    const sig = JSON.stringify(S.roster ? S.roster.list().map((c) => [c.token, c.lastActive]) : []);
    if (sig === rosterSig) return;
    rosterSig = sig;
    if (S.view === 'tasks' && S.tkView === 'schedule') render();
    if (S.schedShareRedraw && $('.sheet [data-sched-share]')) S.schedShareRedraw();
  });
  S.roster.start();
  S.sync.watchMeta('shared', (d) => { if (d) { S.shared = d; store('fu.shared', d); fetchWeather(); render(); } });
  S.sync.watchMeta('calendar', (d) => { if (d) { S.calendar = d; store('fu.calendar', d); render(); } });
  S.sync.watchMeta('command', (d) => { if (d) { S.command = d; store('fu.command', d); render(); } });

  // If Command unpairs this phone, go back to the pairing screen.
  if (S.memberUnsub) S.memberUnsub();
  let seen = false;
  S.memberUnsub = fb.onSnapshot(fb.doc(S.fire.db, 'decks', S.deckId, 'members', S.uid), (snap) => {
    if (snap.exists()) { seen = true; S.connected = true; render(); return; }
    if (seen) unpairLocal('Command unpaired this device.');
  }, (err) => {
    if (/permission/i.test(err.code || err.message || '')) unpairLocal('This device is no longer paired with Command.');
  });
}

function unpairLocal(msg) {
  if (S.relay) S.relay.stop();
  S.relay = null;
  if (S.sync) S.sync.stop();
  if (S.memberUnsub) S.memberUnsub();
  S.sync = null;
  S.memberUnsub = null;
  S.deckId = null;
  S.connected = false;
  store('fu.deckId', null);
  if (msg) toast(msg, 4000);
  showPairing();
}

async function unpairSelf() {
  try {
    await fb.deleteDoc(fb.doc(S.fire.db, 'decks', S.deckId, 'push', S.uid)).catch(() => {});
    await fb.deleteDoc(fb.doc(S.fire.db, 'decks', S.deckId, 'members', S.uid));
  } catch (e) { /* already gone */ }
  unpairLocal('Unpaired from Command.');
}

// ---------------------------------------------------------------- push alerts
function b64ToBytes(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function alertsSupported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }

async function enableAlerts() {
  if (!alertsSupported()) {
    toast(STANDALONE ? 'This iPhone needs iOS 16.4 or newer for alerts.' : 'Add Field Unit to the Home Screen first, then enable alerts.', 4500);
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { toast('Alerts are blocked. Allow them in iPhone Settings › Notifications › Field Unit.', 5000); return; }
  const deckSnap = await fb.getDoc(fb.doc(S.fire.db, 'decks', S.deckId));
  const key = deckSnap.exists() ? deckSnap.data().vapidPublicKey : null;
  if (!key) { toast('Command has not shared its alert key yet. Open Command Deck once, then try again.', 5000); return; }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
  await fb.setDoc(fb.doc(S.fire.db, 'decks', S.deckId, 'push', S.uid), { sub: JSON.stringify(sub.toJSON()), updatedAt: Date.now(), ua: navigator.userAgent.slice(0, 120) });
  S.settings.alertsOn = true;
  saveSettings();
  toast('Alerts enabled. Command will reach you here.');
  render();
}

// ---------------------------------------------------------------- weather
async function fetchWeather() {
  const loc = shared().location;
  if (!loc || loc.lat == null) return;
  const c = shared().tempUnit === 'C';
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&temperature_unit=${c ? 'celsius' : 'fahrenheit'}&timezone=auto&forecast_days=1`;
    const res = await fetch(url);
    if (res.ok) { S.weather = await res.json(); render(); }
  } catch (e) { /* offline */ }
}
function wxWords(code) {
  if (code === 0) return 'clear';
  if (code <= 2) return 'partly cloudy';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'foggy';
  if (code >= 51 && code <= 67) return 'raining';
  if (code >= 71 && code <= 86) return 'snowing';
  if (code >= 95) return 'stormy';
  return 'mixed';
}

// ---------------------------------------------------------------- task + timer logic
function blankTask() {
  return {
    id: makeId('t_'), title: '', due: null, dueHasTime: false, priority: 'medium', category: null, assignee: null,
    reminder: null, repeat: { type: 'none', interval: 1, days: [] }, subtasks: [], notes: '',
    done: false, doneAt: null, createdAt: new Date().toISOString(), remindedFor: null
  };
}
function active() { return S.tasks.filter((t) => !t.done); }
function isOverdue(t, now = new Date()) {
  if (!t.due || t.done) return false;
  const d = new Date(t.due);
  return t.dueHasTime ? d < now : d < U.startOfDay(now);
}
function dueLabel(t, now = new Date()) {
  if (!t.due) return 'NO DATE';
  const d = new Date(t.due);
  let s = U.dayLabel(d, now);
  if (t.dueHasTime) s += ` · ${U.fmtTimeShort(d, clock24())}`;
  return s;
}
function sortTasks(list, now = new Date()) {
  return list.slice().sort((a, b) => {
    const oa = isOverdue(a, now) ? 0 : 1;
    const ob = isOverdue(b, now) ? 0 : 1;
    if (oa !== ob) return oa - ob;
    const da = a.due ? new Date(a.due).getTime() + (a.dueHasTime ? 0 : 86399000) : Infinity;
    const db = b.due ? new Date(b.due).getTime() + (b.dueHasTime ? 0 : 86399000) : Infinity;
    if (da !== db) return da - db;
    return (PRI[b.priority] || PRI.medium).n - (PRI[a.priority] || PRI.medium).n;
  });
}
function upsertTask(task) {
  const i = S.tasks.findIndex((t) => t.id === task.id);
  if (i >= 0) {
    if (S.tasks[i].due !== task.due || S.tasks[i].reminder !== task.reminder) task.remindedFor = null;
    S.tasks[i] = task;
  } else S.tasks.unshift(task);
  persist('tasks');
}
function deleteTask(id) { S.tasks = S.tasks.filter((t) => t.id !== id); persist('tasks'); }
function completeTask(id, by = null) {
  const t = S.tasks.find((x) => x.id === id);
  if (!t) return null;
  if (t.repeat && t.repeat.type !== 'none' && t.due) {
    let next = U.advanceDate(new Date(t.due), t.repeat);
    const today = U.startOfDay(new Date());
    let guard = 0;
    while (next && next < today && guard++ < 500) next = U.advanceDate(next, t.repeat);
    if (next) {
      t.due = next.toISOString();
      t.remindedFor = null;
      (t.subtasks || []).forEach((s) => { s.done = false; });
      toast(`${t.title} → next ${U.dayLabel(next)}`);
    }
  } else { t.done = true; t.doneAt = new Date().toISOString(); t.doneBy = by || null; }
  chirp.ack();
  persist('tasks');
  return t;
}
function uncomplete(id) {
  const t = S.tasks.find((x) => x.id === id);
  if (t) { t.done = false; t.doneAt = null; t.doneBy = null; persist('tasks'); }
}

// ---------------------------------------------------------------- project manifest (guests)
function guestChanges(changes) {
  for (const c of changes) {
    const t = S.tasks.find((x) => x.id === c.taskId);
    if (c.type === 'add' && !t) S.tasks.unshift({ ...blankTask(), ...c.task, id: c.taskId, projectId: c.projectId });
    else if (c.type === 'update' && t) Object.assign(t, c.task);
    else if (c.type === 'complete' && t && !t.done) completeTask(t.id, c.by);
    else if (c.type === 'reopen' && t && t.done) { t.done = false; t.doneAt = null; t.doneBy = null; }
    else if (c.type === 'delete' && t) S.tasks = S.tasks.filter((x) => x.id !== c.taskId);
  }
  persist('tasks');
  refreshProjectSheet();
}
function addProjectLog(projectId, entries) {
  const p = projectById(projectId);
  if (!p) return;
  const map = new Map();
  [...(p.log || []), ...entries].forEach((e) => { if (e && e.id && !map.has(e.id)) map.set(e.id, e); });
  p.log = [...map.values()].sort((a, b) => (a.at || 0) - (b.at || 0)).slice(-200);
  persist('projects');
  refreshProjectSheet();
}
function guestActivity(events) {
  if (!events.length) return;
  chirp.ack();
  const last = events[events.length - 1];
  toast(events.length > 1 ? `${events.length} crew updates · ${last.text}` : last.text, 4000);
}
function refreshProjectSheet() {
  if (!S.openPj || !$('.sheet [data-pj-sheet]')) return;
  const p = projectById(S.openPj);
  if (p) openProject(p, { keep: true });
}
function snoozeTask(id, minutes) {
  const t = S.tasks.find((x) => x.id === id);
  if (!t) return;
  t.snoozeUntil = new Date(Date.now() + minutes * 60000).toISOString();
  persist('tasks');
  toast(`Snoozed ${minutes} min · Command will remind you`);
}
function findTask(query) {
  const words = (s) => String(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !['the', 'my', 'a', 'an', 'to'].includes(w));
  const q = words(query);
  if (!q.length) return null;
  let best = null;
  let bestScore = 0;
  for (const t of active()) {
    const tw = words(t.title);
    let score = q.filter((w) => tw.some((x) => x.startsWith(w) || w.startsWith(x))).length / q.length;
    if (t.title.toLowerCase().includes(String(query).toLowerCase())) score += 0.5;
    if (score > bestScore) { bestScore = score; best = t; }
  }
  return bestScore >= 0.5 ? best : null;
}
function addTimer({ kind, seconds, at, label, wake }) {
  const endsAt = at ? new Date(at) : new Date(Date.now() + seconds * 1000);
  const t = { id: makeId('tm_'), kind, label: (label || '').trim(), endsAt: endsAt.toISOString(), total: seconds || null, wake: !!wake, origin: 'phone' };
  S.timers.push(t);
  S.timers.sort((a, b) => new Date(a.endsAt) - new Date(b.endsAt));
  persist('timers');
  return t;
}
function cancelTimers({ kind, label, all }) {
  const pool = S.timers.filter((t) => (kind ? t.kind === kind : true));
  let gone;
  if (label) { const l = label.toLowerCase(); gone = pool.filter((t) => t.label && (t.label.toLowerCase().includes(l) || l.includes(t.label.toLowerCase()))); }
  else if (all || pool.length === 1) gone = pool;
  else gone = pool.slice(0, 1);
  const ids = new Set(gone.map((t) => t.id));
  S.timers = S.timers.filter((t) => !ids.has(t.id));
  persist('timers');
  return gone;
}
function spokenDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  const parts = [];
  if (h) parts.push(`${h} hour${h === 1 ? '' : 's'}`);
  if (m) parts.push(`${m} minute${m === 1 ? '' : 's'}`);
  if (s && !h) parts.push(`${s} second${s === 1 ? '' : 's'}`);
  return parts.join(' ') || '0 seconds';
}
function fmtCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- calendar data
function allEvents() {
  const sh = shared();
  const cals = new Map((sh.calendars || []).map((c) => [c.id, c]));
  const list = (S.calendar.events || []).map((e) => {
    const c = cals.get(e.calId);
    return { ...e, start: new Date(e.start), end: new Date(e.end), color: c ? c.color : 'var(--lav)', calName: c ? c.name : 'Calendar', local: false };
  });
  S.events.forEach((e) => list.push({ ...e, start: new Date(e.start), end: new Date(e.end), color: sh.localCalendarColor || 'var(--peach)', calName: sh.localCalendarName || 'Local', local: true }));
  return list.sort((a, b) => a.start - b.start);
}
function eventsOnDay(day, events = allEvents()) {
  const a = U.startOfDay(day);
  const b = U.addDays(a, 1);
  return events.filter((e) => e.start < b && e.end > a);
}

// ---------------------------------------------------------------- projects
const PROJECT_COLORS = ['#F2A65A', '#A8B0D8', '#F4B6A0', '#B8E27A', '#D9A9C6', '#4FD1E8'];
function projectById(id) { return id ? S.projects.find((p) => p.id === id) || null : null; }
function liveProjects() {
  return S.projects.filter((p) => p.status !== 'done').sort((a, b) => {
    const da = a.due ? projectDue(a).getTime() : Infinity;
    const db = b.due ? projectDue(b).getTime() : Infinity;
    return da - db || new Date(a.createdAt) - new Date(b.createdAt);
  });
}
function projectDue(p) {
  if (!p.due) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(p.due) ? U.fromInputs(p.due, '') : new Date(p.due);
}
function projectStats(p) {
  const tasks = S.tasks.filter((t) => t.projectId === p.id);
  const done = tasks.filter((t) => t.done).length;
  const open = sortTasks(tasks.filter((t) => !t.done));
  return { tasks, open, done, total: tasks.length, pct: tasks.length ? Math.round((done / tasks.length) * 100) : 0, next: open[0] || null };
}
function projectDueLabel(p, now = new Date()) {
  if (!p.due) return 'NO DATE';
  const d = projectDue(p);
  const late = U.startOfDay(d) < U.startOfDay(now);
  return `${late ? 'OVERDUE · ' : ''}${U.MONTHS[d.getMonth()].slice(0, 3).toUpperCase()} ${d.getDate()}`;
}
function upsertProject(p) {
  const i = S.projects.findIndex((x) => x.id === p.id);
  if (i >= 0) S.projects[i] = p; else S.projects.push({ status: 'active', createdAt: new Date().toISOString(), ...p });
  persist('projects');
}
function newProject(name, extra = {}) {
  const used = new Set(liveProjects().map((p) => p.color));
  const color = PROJECT_COLORS.find((c) => !used.has(c)) || PROJECT_COLORS[S.projects.length % PROJECT_COLORS.length];
  const p = { id: makeId('p_'), name, goal: '', color, due: null, status: 'active', createdAt: new Date().toISOString(), ...extra };
  S.projects.push(p);
  persist('projects');
  return p;
}
function deleteProject(id) {
  S.projects = S.projects.filter((p) => p.id !== id);
  let touched = false;
  S.tasks.forEach((t) => { if (t.projectId === id) { t.projectId = null; touched = true; } });
  if (touched) persist('tasks');
  persist('projects');
}
function findProject(query) {
  const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const q = norm(query);
  if (!q) return null;
  const live = liveProjects();
  return live.find((p) => norm(p.name) === q) || live.find((p) => norm(p.name).includes(q) || q.includes(norm(p.name))) || null;
}
function projectCard(p, now) {
  const st = projectStats(p);
  const col = p.color || 'var(--amber)';
  const filled = st.total ? Math.round((st.done / st.total) * 10) : 0;
  const due = projectDueLabel(p, now);
  const soon = p.due && (projectDue(p) - now) < 14 * 864e5;
  return `<button type="button" class="card pj-card" data-project="${esc(p.id)}" style="--pc:${esc(col)}">
    <span class="pj-top"><span class="pj-name">${esc(p.name)}</span><span class="pj-top-r">${(() => { const c = S.relay ? S.relay.forProject(p.id) : []; return c.length ? `<span class="crew-avs">${c.slice(0, 3).map((x, i) => `<span class="crew-av" style="width:18px;height:18px;font-size:9px;background:${['#B8E27A', '#D9A9C6', '#A8B0D8'][i]}">${esc((x.guest || '?').slice(0, 1).toUpperCase())}</span>`).join('')}</span>` : ''; })()}<span class="pj-pct">${st.pct}%</span></span></span>
    <span class="pj-bar" aria-hidden="true">${Array.from({ length: 10 }, (_, i) => `<i class="${i < filled ? 'on' : ''}"></i>`).join('')}</span>
    <span class="pj-meta"><span class="pj-next">${st.next ? `Next: <b>${esc(st.next.title)}</b>` : st.total ? '<b>All tasks done</b>' : 'No tasks yet'}</span><span class="${due.startsWith('OVERDUE') ? 'over' : soon ? 'soon' : ''}">${esc(due)}</span></span>
  </button>`;
}

// ---------------------------------------------------------------- rendering
function render() {
  $$('.tab[data-view]').forEach((t) => t.classList.toggle('on', t.dataset.view === S.view));
  const v = $('#view');
  const keep = v.scrollTop;
  if (S.view === 'today') v.innerHTML = viewToday();
  else if (S.view === 'tasks') v.innerHTML = viewTasks();
  else if (S.view === 'calendar') v.innerHTML = viewCalendar();
  else if (S.view === 'notes') v.innerHTML = viewNotes();
  else v.innerHTML = viewSettings();
  v.scrollTop = keep;
  if (C.open) ctRefreshChrome();
}

function taskRow(t, now, { swipe = true } = {}) {
  const over = isOverdue(t, now);
  const pri = PRI[t.priority] || PRI.medium;
  const cat = categoryById(t.category);
  const cls = ['trow'];
  if (t.done) cls.push('done');
  if (over) cls.push('over');
  const segs = [0, 1, 2].map((i) => `<i style="${!t.done && i < pri.n ? `background:${pri.color}` : ''}"></i>`).join('');
  const proj = projectById(t.projectId);
  const crewBits = [t.done && t.doneBy ? `DONE BY ${t.doneBy.toUpperCase()}` : !t.done && t.addedBy ? `ADDED BY ${t.addedBy.toUpperCase()}` : '', (t.comments || []).length ? `${t.comments.length} NOTE${t.comments.length > 1 ? 'S' : ''}` : ''].filter(Boolean).join(' · ');
  const extra = [crewBits, t.assignee ? t.assignee.toUpperCase() : '', t.repeat && t.repeat.type !== 'none' ? U.repeatLabel(t.repeat) : '', t.subtasks && t.subtasks.length ? `${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length}` : ''].filter(Boolean).join(' · ');
  return `<div class="${cls.join(' ')}" data-id="${esc(t.id)}">
    ${swipe && !t.done ? `<div class="acts"><button type="button" class="snz" data-act="snooze">SNOOZE</button><button type="button" class="dn" data-act="done">DONE</button><button type="button" class="del" data-act="delete">DELETE</button></div>` : ''}
    <div class="tmain">
      <button type="button" class="tbox${over ? ' over' : ''}" data-act="toggle" aria-label="${t.done ? 'Mark not done' : 'Mark done'}: ${esc(t.title)}"><i>${t.done ? IC.check : ''}</i></button>
      <div class="ttext" data-act="edit">
        <div class="ttitle">${esc(t.title)}</div>
        <div class="tmeta">${cat ? `<span class="tag" style="color:${esc(cat.color)};box-shadow:inset 0 0 0 1px ${esc(cat.color)}66">${esc(cat.name.toUpperCase())}</span>` : ''}<span class="${over ? 'over' : ''}">${over ? 'OVERDUE · ' : ''}${dueLabel(t, now)}</span>${proj ? `<span class="pj-tag" style="color:${esc(proj.color || 'var(--lav)')}"><i style="background:${esc(proj.color || 'var(--lav)')}"></i>${esc(proj.name.toUpperCase())}</span>` : ''}${extra ? `<span>${esc(extra)}</span>` : ''}</div>
      </div>
      <div class="tpri" aria-label="${pri.label} priority">${segs}</div>
    </div>
  </div>`;
}

function viewToday() {
  const now = new Date();
  const w = S.weather && S.weather.current;
  const events = allEvents();
  const next = events.find((e) => e.end > now && !(e.allDay && !U.sameDay(e.start, now) && e.start < now));
  let nextHtml = '';
  if (next) {
    const mins = Math.round((next.start - now) / 60000);
    const when = next.allDay ? 'All day' : mins <= 0 ? 'Happening now' : mins < 60 ? `in ${mins} min` : mins < 1440 ? `in ${Math.floor(mins / 60)} hr ${mins % 60} min` : U.dayLabel(next.start, now);
    const filled = next.allDay || mins <= 0 ? 10 : Math.max(1, Math.min(10, 10 - Math.round(mins / 18)));
    nextHtml = `<section class="card next" aria-label="Next up"><i class="br"></i>
      <div class="label" style="display:flex;justify-content:space-between"><span>NEXT UP</span><span style="color:${esc(next.color)}">${esc((next.calName || '').toUpperCase())}</span></div>
      <div class="ttl"><b>${esc(next.title)}</b><span class="tm">${next.allDay ? 'ALL DAY' : U.fmtTimeShort(next.start, clock24())}</span></div>
      <div class="meta">${esc(next.location || '')}${next.location ? ' · ' : ''}${when}</div>
      <div class="bar">${Array.from({ length: 10 }, (_, i) => `<i class="${i < filled ? 'on' : ''}"></i>`).join('')}</div></section>`;
  } else {
    nextHtml = `<section class="card next"><i class="br"></i><div class="label">NEXT UP</div><div class="empty" style="padding:10px 0 0">Nothing on the calendar soon.</div></section>`;
  }
  const timers = S.timers.length ? `<div class="timers">${S.timers.slice(0, 4).map((t) => {
    const end = new Date(t.endsAt);
    const v = t.kind === 'alarm' ? U.fmtTimeShort(end, clock24()) : fmtCountdown(end - now);
    return `<div class="tmr${t.kind === 'timer' && end - now < 60000 ? ' soon' : ''}" data-timer="${esc(t.id)}"><span class="k">${t.kind === 'alarm' ? 'ALM' : 'TMR'}</span>${t.label ? `<span class="l">${esc(t.label.toUpperCase())}</span>` : ''}<span class="v">${v}</span><button type="button" class="x" data-cancel-timer="${esc(t.id)}" aria-label="Cancel">×</button></div>`;
  }).join('')}</div>` : '';
  const list = sortTasks(active(), now);
  const today = list.filter((t) => isOverdue(t, now) || (t.due && U.sameDay(new Date(t.due), now)));
  const shown = today.length ? today : list.slice(0, 4);
  const overdue = list.filter((t) => isOverdue(t, now)).length;
  const install = !STANDALONE && !S.settings.installDismissed ? `<div class="install" role="note">
      <div style="flex:1;min-width:0"><div class="t1">INSTALL FIELD UNIT</div><div class="t2">Tap <b>Share › Add to Home Screen</b> for full screen and alerts.</div></div>
      <button type="button" class="icon-btn" data-dismiss-install aria-label="Dismiss">${IC.close}</button></div>` : '';
  const online = commandOnline();
  const seen = S.command.lastSeen ? U.fmtTimeShort(new Date(S.command.lastSeen), clock24()) : 'never';
  return `
    <header class="today-head">
      <div>
        <div class="eyebrow">${esc(S.settings.callsign.toUpperCase())}</div>
        <h1 class="h1">Good ${U.partOfDay(now)}, ${esc(operator())}</h1>
        <div class="sub">${U.DAY_FULL[now.getDay()].toUpperCase()} · ${now.getDate()} ${U.MONTHS[now.getMonth()].toUpperCase()}</div>
      </div>
      <div class="head-chips">
        ${w ? `<div class="wx-chip" aria-label="Weather">${IC.sun}${Math.round(w.temperature_2m)}°</div>` : ''}
        <button type="button" class="gear-btn" data-go="settings" aria-label="Settings">${IC.gear}</button>
      </div>
    </header>
    ${install}
    ${nextHtml}
    ${timers}
    <div class="row-head"><div class="label">${today.length ? "TODAY'S QUEUE" : 'UP NEXT'} · <span class="amber-t">${active().length} ACTIVE${overdue ? ` · ${overdue} OVERDUE` : ''}</span></div>
      <button type="button" class="icon-btn accent" data-new-task aria-label="Add task">${IC.plus}</button></div>
    <div>${shown.length ? shown.map((t) => taskRow(t, now)).join('') : '<div class="empty">Queue clear. Open the terminal to log something.</div>'}</div>
    <div class="cmd-status ${online ? 'on' : 'off'}"><i></i>${online ? `COMMAND ONLINE · ${esc(shared().consoleName || 'Command Deck').toUpperCase()}` : `COMMAND OFFLINE · LAST CONTACT ${seen}`}</div>`;
}

function tasksHead(n) {
  const live = liveProjects().length;
  const v = S.tkView;
  const thisWeek = weekDays(S.schedule, weekStart(new Date())).reduce((k, d) => k + d.items.length, 0);
  const add = v === 'projects' ? 'data-new-project aria-label="New project"' : v === 'schedule' ? 'data-new-sched aria-label="Add to schedule"' : 'data-new-task aria-label="Add task"';
  const tab = (id, label) => `<button type="button" role="tab" aria-selected="${v === id}" class="${v === id ? 'on' : ''}" data-tkview="${id}">${label}</button>`;
  return `
    <header style="display:flex;justify-content:space-between;align-items:center">
      <h1 class="h1" style="margin:0;font-size:28px">Tasks</h1>
      <button type="button" class="icon-btn accent" ${add} style="margin-right:-8px">${IC.plus}</button>
    </header>
    <div class="seg seg3" role="tablist" aria-label="View">${tab('queue', `QUEUE · ${n}`)}${tab('projects', `PROJECTS · ${live}`)}${tab('schedule', `SCHEDULE · ${thisWeek}`)}</div>`;
}

// ---------------------------------------------------------------- schedule (shifts & appointments)
const REPLY_LABEL = { ok: '✓ GOT IT', change: '⚠ CHANGE REQUEST' };
function schedChip(typeId) {
  const t = typeOf(scheduleTypes(), typeId);
  return `<span class="sc-chip" style="--tc:${esc(t.color)}">${esc(t.short || shortName(t.name))}</span>`;
}
function viewSchedule() {
  const now = new Date();
  const days = weekDays(S.schedule, S.schedWeek, now);
  const links = S.roster ? S.roster.list() : [];
  const live = new Set(links.map((c) => c.token));
  const crew = links.length ? `<span class="crew-avs">${links.slice(0, 3).map((x, i) => crewAv(x.guest, i, 18)).join('')}</span>` : '';
  const isThis = ymd(S.schedWeek) === ymd(weekStart(now));
  let html = `${tasksHead(active().length)}
    <div class="sc-tools"><button type="button" class="share-pill" data-sched-share>${crew}${SHARE_IC}SHARE</button>${isThis ? '' : '<button type="button" class="mini-line" data-sc="today">THIS WEEK</button>'}</div>
    <div class="sc-week"><button type="button" class="sc-nav" data-sc="prev" aria-label="Previous week">‹</button><span>${esc(weekLabel(S.schedWeek, now))}</span><button type="button" class="sc-nav" data-sc="next" aria-label="Next week">›</button></div>`;
  if (!days.length) html += '<div class="empty">Nothing scheduled this week. Tap <b>+</b> to add a shift or appointment.</div>';
  for (const d of days) {
    html += `<div class="group-h${d.label.startsWith('TODAY') ? ' today' : ''}"><span>${esc(d.label)}</span><span>${d.items.length}</span></div>`;
    for (const e of d.items) {
      const replies = Object.entries(e.replies || {}).filter(([tok]) => !live.size || live.has(tok));
      html += `<button type="button" class="sc-row" data-sched="${esc(e.id)}">
        <span class="sc-top"><span class="sc-title">${esc(e.title)}</span>${schedChip(e.type)}</span>
        ${timeRange(e.start, e.end, clock24()) ? `<span class="sc-time">${esc(timeRange(e.start, e.end, clock24()))}</span>` : ''}
        ${e.note ? `<span class="sc-note">Note: ${esc(e.note)}</span>` : ''}
        ${replies.map(([, r]) => `<span class="sc-reply ${r.state === 'change' ? 'chg' : 'ok'}">${esc((r.by || 'GUEST').toUpperCase())} · ${REPLY_LABEL[r.state] || ''}${r.state === 'change' && !r.comment ? ' · NO NOTE' : ''}</span>${r.state === 'change' && r.comment ? `<span class="sc-change">${esc(r.comment)}</span>` : ''}`).join('')}
        ${links.length && !replies.length ? '<span class="sc-reply none">NO REPLY YET</span>' : ''}
      </button>`;
    }
  }
  return html;
}

function openScheduleEditor(entry) {
  const isNew = !entry;
  const types = scheduleTypes();
  const e = JSON.parse(JSON.stringify(entry || { id: makeId(), type: types[0].id, title: '', date: ymd(new Date()), note: '', replies: {} }));
  const prev = entry ? JSON.parse(JSON.stringify(entry)) : null;
  const sh = openSheet(`
    <div class="sheet-head"><span class="label">${isNew ? 'SCHEDULE · NEW ENTRY' : 'SCHEDULE · EDIT'}</span><button type="button" class="icon-btn" data-close aria-label="Close">${IC.close}</button></div>
    <div class="f"><span class="label">TYPE</span><div class="pills" id="scTypes">${types.map((t) => `<button type="button" class="chip${e.type === t.id ? ' on' : ''}" data-type="${esc(t.id)}" style="--pc:${esc(t.color)};${e.type === t.id ? '' : `color:${esc(t.color)}`}">${esc((t.name || '').toUpperCase())}</button>`).join('')}</div>
      <div class="hint" style="margin-top:6px">New types are added on Command Deck.</div></div>
    <div class="f"><span class="label">TITLE</span><input class="in title" id="scTitle" maxlength="120" value="${esc(e.title)}" placeholder="Work shift, dentist…" aria-label="Title"></div>
    <div class="f"><span class="label">DATE</span><input class="in" id="scDate" type="date" value="${esc(e.date || '')}" aria-label="Date"></div>
    <div class="sc-times">
      <div class="f"><span class="label">START · OPTIONAL<button type="button" class="sc-clr" data-clr="scStart">CLEAR</button></span><input class="in" id="scStart" type="time" value="${esc(e.start || '')}" aria-label="Start time, optional"></div>
      <div class="f"><span class="label">END · OPTIONAL<button type="button" class="sc-clr" data-clr="scEnd">CLEAR</button></span><input class="in" id="scEnd" type="time" value="${esc(e.end || '')}" aria-label="End time, optional"></div>
    </div>
    <div class="f"><span class="label">NOTE · THEY SEE THIS</span><input class="in" id="scNote" maxlength="300" value="${esc(e.note || '')}" placeholder="Optional" aria-label="Note"></div>
    ${!isNew && Object.keys(e.replies || {}).length ? '<div class="hint">Changing the title, type, date or time clears replies, so everyone confirms the new version.</div>' : ''}
    <div class="sheet-foot">${isNew ? '' : '<button type="button" class="btn danger" id="scDel">DELETE</button>'}<button type="button" class="btn primary" id="scSave" style="flex:1">${isNew ? 'ADD' : 'SAVE'}</button></div>`);
  sh.addEventListener('click', (ev) => {
    const t = ev.target;
    if (t.closest('[data-close]')) { closeSheet(); return; }
    const clr = t.closest('[data-clr]');
    if (clr) { const i = $(`#${clr.dataset.clr}`, sh); if (i) i.value = ''; return; }
    const ty = t.closest('[data-type]');
    if (ty) { e.type = ty.dataset.type; $$('[data-type]', sh).forEach((b) => { const on = b === ty; b.classList.toggle('on', on); const tt = typeOf(types, b.dataset.type); b.style.color = on ? '' : tt.color; }); return; }
    const del = t.closest('#scDel');
    if (del) {
      if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = 'CONFIRM'; return; }
      S.schedule = S.schedule.filter((x) => x.id !== e.id);
      persist('schedule');
      closeSheet();
      toast('Removed from the schedule');
      return;
    }
    if (t.closest('#scSave')) {
      const title = $('#scTitle', sh).value.trim();
      const date = $('#scDate', sh).value;
      if (!title) { $('#scTitle', sh).focus(); return; }
      if (!date) { $('#scDate', sh).focus(); return; }
      const out = { ...e, title: title.slice(0, 120), date, start: parseTime($('#scStart', sh).value), end: parseTime($('#scEnd', sh).value), note: $('#scNote', sh).value.trim().slice(0, 300) };
      if (prev && (prev.date !== out.date || prev.title !== out.title || prev.type !== out.type || (prev.start || '') !== out.start || (prev.end || '') !== out.end)) out.replies = {};
      const i = S.schedule.findIndex((x) => x.id === out.id);
      if (i >= 0) S.schedule[i] = out; else S.schedule.push({ ...out, createdAt: Date.now() });
      const d = parseYmd(date);
      if (d) S.schedWeek = weekStart(d);
      persist('schedule');
      closeSheet();
      chirp.ack();
      toast(isNew ? `Added to the schedule: ${title}` : 'Schedule updated');
    }
  });
  if (isNew) setTimeout(() => { const i = $('#scTitle', sh); if (i) i.focus(); }, 60);
}

const SCHED_ENDS = [['week', 'IN 7 DAYS'], ['month', 'IN 30 DAYS'], ['never', 'NEVER']];
function openScheduleShare() {
  const draft = { guest: '', ends: 'month' };
  let made = null;
  let busy = false;
  const draw = async () => {
    const prevIn = $('#shName');
    if (prevIn) draft.guest = prevIn.value;
    const crew = S.roster ? S.roster.list() : [];
    const ready = !!S.roster && !!S.fire;
    let qr = '';
    if (made) { try { qr = await fb.QRCode.toDataURL(made.url, { margin: 2, scale: 6, color: { dark: '#14151BFF', light: '#F4EFE9FF' } }); } catch (e) { qr = ''; } }
    const sh = openSheet(`
      <div class="sheet-head" data-sched-share><span class="label">SHARE · SCHEDULE</span><button type="button" class="icon-btn" data-close aria-label="Close">${IC.close}</button></div>
      ${!ready ? '<div class="hint err-t" style="margin-top:0">Waiting for the uplink to Command. Try again in a moment.</div>' : ''}
      ${made ? `<div class="sh-made"><div class="sh-made-h">✓ SCHEDULE LINK READY · ${esc(made.guest.toUpperCase())}</div>
          <div class="sh-made-row">${qr ? `<img src="${qr}" alt="QR code for the link">` : ''}<div class="sh-link">${esc(made.url)}</div></div></div>
        <div class="sh-btns"><button type="button" class="btn line" id="shCopy">COPY LINK</button><button type="button" class="btn primary" id="shSend">SEND…</button></div>
        <div class="hint">They see one week at a time and tap GOT IT or CHANGE REQUEST. On an iPhone they can add it to the Home Screen.</div>`
      : `<div class="f"><span class="label">WHO'S IT FOR?</span><input class="in title" id="shName" maxlength="40" placeholder="Their name" value="${esc(draft.guest)}" aria-label="Their name"></div>
        <div class="hint" style="margin-top:0">They can reply GOT IT or CHANGE REQUEST (with a comment) on each entry.</div>
        <div class="f"><span class="label">LINK STOPS WORKING</span><div class="pills">${SCHED_ENDS.map(([v, l]) => `<button type="button" class="chip${draft.ends === v ? ' on' : ''}" data-ends="${v}">${l}</button>`).join('')}</div></div>
        <button type="button" class="btn primary block" id="shCreate" ${ready && !busy ? '' : 'disabled'} style="margin-top:8px">${busy ? 'CREATING…' : 'CREATE LINK'}</button>`}
      <div class="group-h"><span>PEOPLE WITH ACCESS</span><span>${crew.length}</span></div>
      ${crew.length ? crew.map((c, i) => `<div class="sh-person">${crewAv(c.guest, i)}
          <span class="sh-p-text"><b>${esc(c.guest)}</b><small>${c.lastActive ? `LAST REPLY ${esc(shortWhen(c.lastActive))}` : 'NO REPLIES YET'}</small></span>
          <span class="sh-p-btns"><button type="button" class="mini-line" data-send="${esc(c.token)}" data-guest="${esc(c.guest)}">SEND</button><button type="button" class="mini-line danger-t" data-stop="${esc(c.token)}">STOP</button></span>
        </div>`).join('') : '<div class="hint">Nobody yet. Links you create show up here, with STOP to end one at any time.</div>'}
      ${made ? '<button type="button" class="btn line block" id="shAnother" style="margin-top:14px">+ SHARE WITH SOMEONE ELSE</button>' : ''}`);
    const sendLink = async (url, guest) => {
      if (navigator.share) { try { await navigator.share({ title: `${operator()}'s schedule`, text: `${operator()} shared their schedule with you.`, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
      try { await navigator.clipboard.writeText(url); toast(`Link for ${guest} copied`); } catch (e) { toast(url, 6000); }
    };
    sh.addEventListener('click', async (ev) => {
      const t = ev.target;
      if (t.closest('[data-close]')) { closeSheet(); return; }
      const en = t.closest('[data-ends]');
      if (en) { draft.ends = en.dataset.ends; draw(); return; }
      if (t.closest('#shAnother')) { made = null; draft.guest = ''; draw(); return; }
      if (t.closest('#shCopy')) { try { await navigator.clipboard.writeText(made.url); toast('Link copied'); } catch (err) { toast(made.url, 6000); } return; }
      if (t.closest('#shSend')) { sendLink(made.url, made.guest); return; }
      const sd = t.closest('[data-send]');
      if (sd) { sendLink(scheduleUrl(location.origin, sd.dataset.send), sd.dataset.guest); return; }
      const stop = t.closest('[data-stop]');
      if (stop) {
        if (stop.dataset.armed !== '1') { stop.dataset.armed = '1'; stop.textContent = 'CONFIRM'; return; }
        try { await S.roster.revoke(stop.dataset.stop); toast('Link stopped. It no longer opens.'); } catch (err) { toast('Could not stop it. Check the signal and try again.', 4000); }
        draw();
        return;
      }
      if (t.closest('#shCreate')) {
        const guest = ($('#shName', sh).value || '').trim();
        if (!guest) { $('#shName', sh).focus(); return; }
        busy = true; draw();
        try {
          const token = await S.roster.share({ guest, ends: draft.ends });
          made = { token, guest, url: scheduleUrl(location.origin, token) };
          chirp.ack();
        } catch (err) { toast('Could not create the link. Check the signal and try again.', 4000); }
        busy = false;
        draw();
      }
    });
    sh.style.animation = 'none';
  };
  S.schedShareRedraw = draw;
  draw();
}

function viewProjects() {
  const now = new Date();
  const list = liveProjects();
  const finished = S.projects.filter((p) => p.status === 'done').sort((a, b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0));
  return `${tasksHead(active().length)}
    <div class="pj-list">${list.map((p) => projectCard(p, now)).join('')}</div>
    ${!list.length ? '<div class="empty">No projects yet. Tap <b>+</b> to start one, or open the terminal and type <b>new project garage cleanout</b>.</div>' : ''}
    ${finished.length ? `<div class="group-h"><span>FINISHED</span><span>${finished.length}</span></div>${finished.slice(0, 8).map((p) => `<button type="button" class="pj-done" data-project="${esc(p.id)}"><i style="background:${esc(p.color || 'var(--lav)')}"></i><span>${esc(p.name)}</span><span>${p.completedAt ? `${U.MONTHS[new Date(p.completedAt).getMonth()].slice(0, 3).toUpperCase()} ${new Date(p.completedAt).getDate()}` : ''}</span></button>`).join('')}` : ''}
    <div class="hint" style="margin-top:16px">Type <b>add buy string lights to the holiday party project</b> in the terminal to file a task straight into a project.</div>`;
}

function viewTasks() {
  if (S.tkView === 'projects') return viewProjects();
  if (S.tkView === 'schedule') return viewSchedule();
  const now = new Date();
  const cats = categories();
  if (S.filter !== 'all' && !cats.some((c) => c.id === S.filter)) S.filter = 'all';
  const inF = (t) => S.filter === 'all' || t.category === S.filter;
  const list = sortTasks(active().filter(inF), now);
  const weekEnd = U.addDays(U.startOfDay(now), 7);
  const groups = [
    ['OVERDUE', list.filter((t) => isOverdue(t, now)), true],
    ['TODAY', list.filter((t) => !isOverdue(t, now) && t.due && U.sameDay(new Date(t.due), now))],
    ['THIS WEEK', list.filter((t) => t.due && !U.sameDay(new Date(t.due), now) && !isOverdue(t, now) && new Date(t.due) < weekEnd)],
    ['LATER', list.filter((t) => t.due && new Date(t.due) >= weekEnd)],
    ['NO DATE', list.filter((t) => !t.due)]
  ];
  const done = S.tasks.filter((t) => t.done && inF(t));
  const chips = [['all', 'ALL', 'var(--text)']].concat(cats.map((c) => [c.id, c.name.toUpperCase(), c.color]))
    .map(([id, label, col]) => `<button type="button" class="chip${S.filter === id ? ' on' : ''}" data-filter="${esc(id)}" style="--pc:${esc(col)};${S.filter === id ? '' : `color:${esc(col)}`}">${esc(label)}</button>`).join('');
  return `${tasksHead(active().length)}
    <div class="chip-row" style="margin-top:12px">${chips}</div>
    ${groups.map(([label, items, red]) => (items.length ? `<div class="group-h${red ? ' red' : ''}"><span>${label}</span><span>${items.length}</span></div>${items.map((t) => taskRow(t, now)).join('')}` : '')).join('')}
    ${!list.length ? '<div class="empty">Nothing here. Tap <b>+</b>, or open the terminal and type a task.</div>' : ''}
    ${done.length ? `<div class="group-h"><span>COMPLETED</span><span>${done.length}</span></div>${done.slice(0, 15).map((t) => taskRow(t, now, { swipe: false })).join('')}` : ''}
    <div class="hint" style="margin-top:16px">Swipe a task left for Snooze, Done and Delete.</div>`;
}

function viewCalendar() {
  const now = new Date();
  if (!S.calMonth) S.calMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  if (!S.calSel) S.calSel = U.startOfDay(now);
  const m = S.calMonth;
  const first = new Date(m.getFullYear(), m.getMonth(), 1);
  const start = U.addDays(first, -first.getDay());
  const events = allEvents();
  const taskDays = new Set(active().filter((t) => t.due).map((t) => U.dayKey(new Date(t.due))));
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = U.addDays(start, i);
    const cls = ['cal-cell'];
    if (d.getMonth() !== m.getMonth()) cls.push('out');
    if (U.sameDay(d, now)) cls.push('today'); else if (d < U.startOfDay(now)) cls.push('past');
    if (U.sameDay(d, S.calSel)) cls.push('sel');
    const colors = [...new Set(eventsOnDay(d, events).map((e) => e.color))].slice(0, 3);
    if (taskDays.has(U.dayKey(d))) colors.push('var(--amber)');
    cells += `<button type="button" class="${cls.join(' ')}" data-day="${U.dayKey(d)}" aria-label="${U.DAY_FULL[d.getDay()]} ${U.MONTHS[d.getMonth()]} ${d.getDate()}"><span>${d.getDate()}</span><span class="dots">${colors.map((c) => `<i style="background:${esc(c)}"></i>`).join('')}</span></button>`;
  }
  const sel = S.calSel;
  const dayEvents = eventsOnDay(sel, events);
  const dayTasks = active().filter((t) => t.due && U.sameDay(new Date(t.due), sel));
  const agenda = dayEvents.map((e) => `<div class="ev"${e.local ? ` data-ev="${esc(e.id)}" role="button" tabindex="0"` : ''}><i class="c" style="background:${esc(e.color)}"></i>
      <div class="t">${e.allDay ? 'ALL DAY' : U.fmtTimeShort(e.start, clock24())}</div>
      <div style="min-width:0"><div class="n">${esc(e.title)}</div><div class="s">${esc((e.calName || '').toUpperCase())}${e.location ? ` · ${esc(e.location)}` : ''}</div></div></div>`).join('')
    + dayTasks.map((t) => `<div class="ev" data-task="${esc(t.id)}" role="button" tabindex="0"><i class="c" style="background:var(--amber)"></i><div class="t">${t.dueHasTime ? U.fmtTimeShort(new Date(t.due), clock24()) : 'TASK'}</div><div><div class="n">${esc(t.title)}</div><div class="s">TASK</div></div></div>`).join('');
  const relayed = S.calendar.updatedAt ? `Relayed by Command · ${U.fmtTimeShort(new Date(S.calendar.updatedAt), clock24())}` : 'Command has not relayed calendars yet.';
  return `
    <header style="display:flex;justify-content:space-between;align-items:center">
      <h1 class="h1" style="margin:0;font-size:28px">Calendar</h1>
      <button type="button" class="icon-btn accent" data-new-event aria-label="New event" style="margin-right:-8px">${IC.plus}</button>
    </header>
    <div class="cal-nav">
      <div class="cal-title">${U.MONTHS[m.getMonth()].toUpperCase()} <span class="label">${m.getFullYear()}</span></div>
      <div style="display:flex"><button type="button" class="icon-btn" data-month="-1" aria-label="Previous month">${IC.left}</button><button type="button" class="icon-btn" data-month="1" aria-label="Next month">${IC.right}</button></div>
    </div>
    <div class="cal-dow"><span>SU</span><span>MO</span><span>TU</span><span>WE</span><span>TH</span><span>FR</span><span>SA</span></div>
    <div class="cal-grid">${cells}</div>
    <div class="row-head"><div class="label">${U.dayLabel(sel, now)} · ${U.MONTHS[sel.getMonth()].slice(0, 3).toUpperCase()} ${sel.getDate()}</div></div>
    <div class="agenda">${agenda || '<div class="empty">Nothing scheduled.</div>'}</div>
    <div class="hint">${relayed}</div>`;
}


// ---------------------------------------------------------------- notes
const NOTE_SRC = { scan: ['SCANNED', 'var(--lav)'], voice: ['VOICE', 'var(--amber)'], comms: ['COMMS', 'var(--amber)'], typed: ['TYPED', 'var(--muted)'] };
function normText(x) { return String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
function noteWhen(iso, now = new Date()) {
  if (!iso) return '';
  const d = new Date(iso);
  return U.sameDay(d, now) ? U.fmtTimeShort(d, clock24()) : U.dayLabel(d, now);
}
function noteRow(n) {
  const [src, col] = NOTE_SRC[n.src] || NOTE_SRC.typed;
  const preview = String(n.body || '').split('\n').map((l) => l.trim()).filter((l) => l && l !== n.title).join(' · ');
  return `<button type="button" class="nrow" data-note="${esc(n.id)}">
    <span class="nrow-top"><span class="nrow-title">${esc(n.title || 'Untitled')}</span>${n.pinned ? `<span class="amber-t">${IC.pin}</span>` : ''}</span>
    ${preview ? `<span class="nrow-prev">${esc(preview)}</span>` : ''}
    <span class="nrow-meta"><span class="tag" style="color:${col};box-shadow:inset 0 0 0 1px ${col}">${src}</span><span>${esc(noteWhen(n.editedAt || n.createdAt))}</span></span>
  </button>`;
}
function viewNotes() {
  const q = S.noteSearch == null ? '' : normText(S.noteSearch);
  const all = S.notes.slice().sort((a, b) => new Date(b.editedAt || b.createdAt) - new Date(a.editedAt || a.createdAt));
  const list = q ? all.filter((n) => normText(`${n.title} ${n.body}`).includes(q)) : all;
  const pinned = list.filter((n) => n.pinned);
  const recent = list.filter((n) => !n.pinned);
  const group = (label, items, accent) => (items.length ? `<div class="group-h${accent ? ' amber-h' : ''}"><span>${label}</span><span>${items.length}</span></div>${items.map(noteRow).join('')}` : '');
  return `
    <header style="display:flex;justify-content:space-between;align-items:center">
      <h1 class="h1" style="margin:0;font-size:28px">Notes</h1>
      <div style="display:flex;margin-right:-8px">
        <button type="button" class="icon-btn" data-note-search aria-label="Search notes">${IC.search}</button>
        <button type="button" class="icon-btn accent" data-new-note aria-label="New note">${IC.plus}</button>
      </div>
    </header>
    ${S.noteSearch != null ? `<div class="f"><input class="in" id="noteSearch" type="search" placeholder="Search notes" aria-label="Search notes" value="${esc(S.noteSearch)}"></div>` : ''}
    ${FIELD_SCAN ? `<button type="button" class="scan-btn" data-scan>
      ${IC.scan}
      <span><span class="t1">FIELD SCAN</span><span class="t2">Capture a page and file it with Command</span></span>
    </button>` : ''}
    ${group('PINNED', pinned, true)}
    ${group(q ? 'MATCHES' : 'RECENT', recent)}
    ${!list.length ? `<div class="empty">${q ? 'No notes match that.' : `No notes yet. Tap ${FIELD_SCAN ? '<b>Field Scan</b>, ' : ''}the <b>+</b>, or open the terminal and type <b>take a note: …</b>`}</div>` : ''}
    <div class="hint" style="margin-top:16px">Copying from paper? Open a note, tap in the text and choose <b>Scan Text</b>. iPhone reads printed pages and handwriting straight into it.</div>`;
}

function saveNote(note, isNew) {
  const now = new Date().toISOString();
  const out = { ...note, editedAt: now, editedOn: 'field' };
  if (isNew) { out.createdAt = out.createdAt || now; S.notes.unshift(out); }
  else {
    const i = S.notes.findIndex((n) => n.id === out.id);
    if (i >= 0) S.notes[i] = out; else S.notes.unshift(out);
  }
  persist('notes');
  return out;
}
function deleteNote(id) { S.notes = S.notes.filter((n) => n.id !== id); persist('notes'); }

function openNoteEditor(note) {
  const isNew = !note;
  const n = JSON.parse(JSON.stringify(note || { id: makeId('n_'), title: '', body: '', pinned: false, src: 'typed' }));
  const sh = openSheet(`
    <div class="sheet-head"><span class="label">${isNew ? 'NEW NOTE' : 'NOTE'}</span><button type="button" class="icon-btn" data-close aria-label="Close">${IC.close}</button></div>
    <div class="f"><input class="in title" id="nTitle" value="${esc(n.title)}" placeholder="Name this note" aria-label="Title"></div>
    <div class="f"><textarea class="ta note-ta" id="nBody" placeholder="Write anything. Tap here and choose Scan Text to read a page or handwriting." aria-label="Note">${esc(n.body)}</textarea></div>
    <div class="sheet-foot wrap">
      ${isNew ? '' : '<button type="button" class="btn danger" id="nDel">DELETE</button>'}
      <button type="button" class="btn line" id="nPin">${n.pinned ? 'UNPIN' : 'PIN'}</button>
      ${isNew ? '' : '<button type="button" class="btn line" id="nTask">→ TASK</button>'}
      <button type="button" class="btn primary" id="nSave">${isNew ? 'SAVE NOTE' : 'SAVE'}</button>
    </div>`);
  sh.addEventListener('click', (x) => { if (x.target.closest('[data-close]')) closeSheet(); });
  const collect = () => {
    const body = $('#nBody', sh).value.replace(/\s+$/, '');
    let title = $('#nTitle', sh).value.trim();
    if (!title) title = (body.split('\n').find((l) => l.trim()) || '').trim().slice(0, 40);
    return { ...n, title, body };
  };
  $('#nPin', sh).addEventListener('click', (e) => { n.pinned = !n.pinned; e.currentTarget.textContent = n.pinned ? 'UNPIN' : 'PIN'; });
  $('#nSave', sh).addEventListener('click', () => {
    const out = collect();
    if (!out.title && !out.body) { $('#nBody', sh).focus(); return; }
    saveNote(out, isNew);
    closeSheet();
    toast(isNew ? 'Note filed · transmitting to Command' : 'Note updated');
  });
  if (!isNew) {
    $('#nTask', sh).addEventListener('click', () => {
      const out = saveNote(collect(), false);
      upsertTask({ ...blankTask(), title: out.title || 'From a note', notes: out.body || '' });
      closeSheet();
      toast(`Task logged: ${out.title}`);
    });
    const del = $('#nDel', sh);
    del.addEventListener('click', () => {
      if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = 'CONFIRM'; return; }
      deleteNote(n.id);
      closeSheet();
      toast('Note deleted');
    });
  }
  if (isNew) setTimeout(() => $('#nTitle', sh).focus(), 50);
}

// ---------------------------------------------------------------- field scan (photo → text)
let ocrWorker = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load the text reader. Check the signal and try again.'));
    document.head.appendChild(s);
  });
}
async function getOcr(onProgress) {
  if (ocrWorker) return ocrWorker;
  const base = new URL('vendor/ocr/', location.href).href;
  await loadScript(`${base}tesseract.min.js`);
  ocrWorker = await window.Tesseract.createWorker('eng', 1, {
    workerPath: `${base}worker.min.js`,
    corePath: base,
    langPath: `${base}lang`,
    logger: (m) => { if (onProgress && m && typeof m.progress === 'number') onProgress(m.status || '', m.progress); }
  });
  return ocrWorker;
}

// Shrinks big phone photos and boosts contrast, which makes reading faster and cleaner.
function loadPhoto(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 2000;
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k);
      c.height = Math.round(img.naturalHeight * k);
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, c.width, c.height);
      const px = g.getImageData(0, 0, c.width, c.height);
      const d = px.data;
      let lo = 255;
      let hi = 0;
      for (let i = 0; i < d.length; i += 16) {
        const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        if (y < lo) lo = y;
        if (y > hi) hi = y;
      }
      const span = Math.max(40, hi - lo);
      for (let i = 0; i < d.length; i += 4) {
        const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        const v = Math.max(0, Math.min(255, ((y - lo) / span) * 255));
        d[i] = d[i + 1] = d[i + 2] = v;
      }
      g.putImageData(px, 0, 0);
      resolve({ canvas: c, thumb: url });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That photo couldn't be opened. Try another.")); };
    img.src = url;
  });
}

function scanOverlay(html) {
  $('#overlay').innerHTML = `<div class="scan-screen" role="dialog" aria-label="Field scan">${html}</div>`;
  return $('.scan-screen');
}

function startFieldScan() {
  if (!FIELD_SCAN) return;
  const input = $('#scanInput');
  input.value = '';
  input.click();
}

async function runFieldScan(file) {
  let el = scanOverlay(`
    <div class="scan-top"><span class="label amber-t">FIELD SCAN</span><button type="button" class="icon-btn" data-scan-close aria-label="Cancel">${IC.close}</button></div>
    <div class="scan-wait"><div class="scan-ring" aria-hidden="true"></div><div class="label" id="scanStatus">PREPARING IMAGE</div><div class="scan-bar"><i id="scanBar"></i></div>
      <div class="hint" id="scanHint">The first scan downloads the text reader (about 7 MB). After that it works offline.</div></div>`);
  let cancelled = false;
  el.addEventListener('click', (e) => { if (e.target.closest('[data-scan-close]')) { cancelled = true; $('#overlay').innerHTML = ''; } });
  const status = (t, p) => {
    const s = $('#scanStatus');
    const b = $('#scanBar');
    if (s) s.textContent = t;
    if (b && p != null) b.style.width = `${Math.round(p * 100)}%`;
  };
  try {
    const photo = await loadPhoto(file);
    if (cancelled) return;
    status('LOADING TEXT READER', 0.05);
    const worker = await getOcr((st, p) => {
      if (/recogniz/i.test(st)) status('DECODING', p);
      else status('LOADING TEXT READER', p * 0.9);
    });
    if (cancelled) return;
    status('DECODING', 0);
    const { data } = await worker.recognize(photo.canvas, {}, { text: true, blocks: true });
    if (cancelled) return;
    showScanReview(data, photo.thumb);
  } catch (err) {
    if (cancelled) return;
    el = scanOverlay(`
      <div class="scan-top"><span class="label amber-t">FIELD SCAN</span><button type="button" class="icon-btn" data-scan-close aria-label="Close">${IC.close}</button></div>
      <div class="scan-wait"><div class="label err-t">SCAN FAILED</div><p class="hint">${esc(err.message || 'Something went wrong.')}</p>
      <button type="button" class="btn primary block" data-scan-retake>TRY AGAIN</button></div>`);
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-scan-close]')) $('#overlay').innerHTML = '';
      if (e.target.closest('[data-scan-retake]')) startFieldScan();
    });
  }
}

// Builds the editable result; words the reader wasn't sure about get underlined.
function scanLines(data) {
  const lines = [];
  for (const b of data.blocks || []) {
    for (const p of b.paragraphs || []) {
      for (const l of p.lines || []) {
        const words = (l.words || []).filter((w) => w.text && w.text.trim());
        if (words.length) lines.push(words);
      }
    }
  }
  if (!lines.length && data.text) {
    return data.text.split('\n').filter((t) => t.trim()).map((t) => t.split(/\s+/).map((w) => ({ text: w, confidence: 100 })));
  }
  return lines;
}

function showScanReview(data, thumb) {
  const lines = scanLines(data);
  if (!lines.length) {
    const el = scanOverlay(`
      <div class="scan-top"><span class="label amber-t">FIELD SCAN</span><button type="button" class="icon-btn" data-scan-close aria-label="Close">${IC.close}</button></div>
      <div class="scan-wait"><div class="label err-t">NO TEXT FOUND</div><p class="hint">Try again closer, flatter and in good light. For handwriting, use <b>Scan Text</b> inside a note instead.</p>
      <button type="button" class="btn primary block" data-scan-retake>RETAKE</button></div>`);
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-scan-close]')) $('#overlay').innerHTML = '';
      if (e.target.closest('[data-scan-retake]')) startFieldScan();
    });
    return;
  }
  const html = lines.map((ws) => ws.map((w) => (w.confidence < 65 ? `<mark class="unsure">${esc(w.text)}</mark>` : esc(w.text))).join(' ')).join('<br>');
  const firstLine = lines[0].map((w) => w.text).join(' ');
  const title = firstLine.length > 40 ? `${firstLine.slice(0, 38).trim()}…` : firstLine;
  const unsure = lines.flat().filter((w) => w.confidence < 65).length;
  const el = scanOverlay(`
    <div class="scan-top"><span class="label amber-t">SCAN DECODED</span><button type="button" class="icon-btn" data-scan-close aria-label="Discard scan">${IC.close}</button></div>
    <div class="scan-sum"><img class="scan-thumb" src="${thumb}" alt="">
      <div><div class="label ok-t">READ ${lines.length} LINE${lines.length === 1 ? '' : 'S'}</div>
      <div class="hint" style="margin-top:6px">${unsure ? `Check it over. ${unsure} word${unsure === 1 ? '' : 's'} it wasn't sure about ${unsure === 1 ? 'is' : 'are'} underlined.` : 'Check it over and fix anything it misread.'}</div></div></div>
    <label class="label" for="scanTitle" style="margin-top:16px;display:block">TITLE</label>
    <input class="in title" id="scanTitle" value="${esc(title)}">
    <div class="label" style="margin-top:14px">TEXT</div>
    <div class="scan-text" id="scanText" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Scanned text">${html}</div>
    <div class="scan-foot"><button type="button" class="btn line" data-scan-retake>RETAKE</button><button type="button" class="btn primary" data-scan-save>SAVE NOTE</button></div>`);
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-scan-close]')) { $('#overlay').innerHTML = ''; return; }
    if (e.target.closest('[data-scan-retake]')) { startFieldScan(); return; }
    if (e.target.closest('[data-scan-save]')) {
      const body = $('#scanText').innerText.replace(/ /g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      const t = $('#scanTitle').value.trim() || body.split('\n')[0].slice(0, 40);
      saveNote({ id: makeId('n_'), title: t, body, pinned: false, src: 'scan' }, true);
      $('#overlay').innerHTML = '';
      URL.revokeObjectURL(thumb);
      chirp.ack();
      S.view = 'notes';
      render();
      toast('Field scan filed · transmitting to Command');
    }
  });
  // Once a flagged word is edited, drop its underline.
  $('#scanText').addEventListener('input', (e) => {
    const m = window.getSelection && window.getSelection().anchorNode;
    const mark = m && (m.nodeType === 1 ? m : m.parentElement).closest && (m.nodeType === 1 ? m : m.parentElement).closest('mark.unsure');
    if (mark) mark.classList.remove('unsure');
  });
}

function viewSettings() {
  const perm = alertsSupported() ? Notification.permission : 'unsupported';
  const alertsState = !alertsSupported() ? (STANDALONE ? 'Needs iOS 16.4 or newer' : 'Add to Home Screen first')
    : perm === 'granted' && S.settings.alertsOn ? '<span class="ok-t">ON</span>' : perm === 'denied' ? '<span class="err-t">BLOCKED</span>' : 'OFF';
  const online = commandOnline();
  return `
    <header style="display:flex;align-items:center;gap:4px;margin-left:-12px">
      <button type="button" class="icon-btn" data-go="today" aria-label="Back to Today">${IC.left}</button>
      <h1 class="h1" style="margin:0;font-size:28px">Settings</h1>
    </header>
    <div class="set-group"><span class="label">CALLSIGN</span>
      <input class="in" id="sCallsign" value="${esc(S.settings.callsign)}" maxlength="24" aria-label="Callsign">
      <div class="hint">What this device calls itself: “${esc(S.settings.callsign)} online. Go ahead.”</div></div>
    <div class="set-group"><span class="label">COLOR THEME</span>
      <div class="pills">${THEMES.map(([v, l, cs]) => `<button type="button" class="chip${(S.settings.theme || 'dusk') === v ? ' on' : ''}" data-theme-pick="${v}" style="--pc:${cs[0] === '#FFFFFF' ? cs[1] : cs[0]}"><span class="theme-sw" aria-hidden="true">${cs.map((c) => `<i style="background:${c}"></i>`).join('')}</span>${l}</button>`).join('')}</div></div>
    <div class="set-group"><span class="label">TYPEFACE</span>
      <div class="pills">${FONTS.map(([v, l, fam]) => `<button type="button" class="chip font-chip${(S.settings.font || 'auto') === v ? ' on' : ''}" data-font-pick="${v}"${fam ? ` style="font-family:${fam}"` : ''}>${l}</button>`).join('')}</div>
      <div class="hint">Theme default follows the color theme: Moonbase uses Michroma, Blueprint Space Mono, Cryo Exo 2, Freighter B612 Mono, Skydock Quantico, Vector Tektur.</div></div>
    <div class="set-group"><span class="label">TEXT COLOR</span>
      <div class="pills">${INKS.map(([v, l, c]) => `<button type="button" class="chip${(S.settings.ink || 'theme') === v ? ' on' : ''}" data-ink-pick="${v}">${c ? `<span class="ink-sw" aria-hidden="true" style="background:${c}"></span>` : ''}${l}</button>`).join('')}</div>
      <div class="hint">Recolors the main text. Accents and warnings stay with the theme.</div></div>
    <div class="set-group"><span class="label">FRAME</span>
      <div class="pills">${FRAMES.map(([v, l, c]) => `<button type="button" class="chip${(S.settings.frame || 'dark') === v ? ' on' : ''}" data-frame-pick="${v}"><span class="ink-sw" aria-hidden="true" style="background:${c}"></span>${l}</button>`).join('')}</div></div>
    <div class="set-group"><span class="label">PANEL TRIM</span>
      <div class="pills">${TRIMS.map(([v, l, cs]) => `<button type="button" class="chip${(S.settings.trim || 'none') === v ? ' on' : ''}" data-trim-pick="${v}">${cs.length ? `<span class="trim-sw" aria-hidden="true">${cs.map((c) => `<i style="background:${c}"></i>`).join('')}</span>` : ''}${l}</button>`).join('')}</div></div>
    <div class="set-group"><span class="label">COMMS TERMINAL SOUND</span>
      <div class="pills">${[['mainframe', 'MAINFRAME'], ['soft', 'SOFT'], ['off', 'OFF']].map(([v, l]) => `<button type="button" class="chip${(S.settings.commsSound || 'mainframe') === v ? ' on' : ''}" data-sound-pick="${v}">${l}</button>`).join('')}<button type="button" class="chip" id="sTest">▶ TEST</button></div>
      <div class="hint">Mainframe: readout chirps, relay clicks and the computer-room hum. Soft: gentle beeps only.</div></div>
    <div class="set-group"><span class="label" style="display:flex;justify-content:space-between"><span>HUMOR SETTING</span><span class="amber-t" id="sHumorVal">${S.settings.humor}%</span></span>
      <input class="range" type="range" id="sHumor" min="0" max="100" step="5" value="${S.settings.humor}" aria-label="Humor setting"></div>
    <div class="set-group"><span class="label">PHRASES</span>
      <button type="button" class="btn line block" id="sPhrases">EDIT WHAT ${esc(S.settings.callsign.toUpperCase())} SAYS</button></div>
    <div class="set-group"><span class="label">ALERTS</span>
      <div class="set-row"><span>Reminders, timers and alarms</span><span class="v">${alertsState}</span></div>
      ${alertsSupported() && !(perm === 'granted' && S.settings.alertsOn) && perm !== 'denied' ? '<div class="f"><button type="button" class="btn primary block" id="sAlerts">ENABLE ALERTS</button></div>' : ''}
      <div class="hint">Command Deck sends alerts while it's running on the computer. When it's off, alerts still show here whenever ${esc(S.settings.callsign)} is open.</div></div>
    <div class="set-group"><span class="label">COMMAND LINK</span>
      <div class="set-row"><span>Command</span><span class="v">${online ? '<span class="ok-t">ONLINE</span>' : '<span class="err-t">OFFLINE</span>'}</span></div>
      <div class="set-row"><span>Paired with</span><span class="v">${esc(shared().consoleName || 'Command Deck')}</span></div>
      <div class="f"><button type="button" class="btn danger block" id="sUnpair">UNPAIR THIS DEVICE</button></div></div>
    <div class="hint" style="margin-top:24px">Field Unit ${VERSION} · ${STANDALONE ? 'running from the Home Screen' : 'running in the browser'}</div>`;
}

// ---------------------------------------------------------------- sheets (editors)
function closeSheet() { $('#sheet-root').innerHTML = ''; S.openPj = null; }
function openSheet(html) {
  $('#sheet-root').innerHTML = `<div class="sheet-back"><div class="sheet" role="dialog" aria-modal="true"><div class="grabber"></div>${html}</div></div>`;
  const back = $('.sheet-back');
  back.addEventListener('click', (e) => { if (e.target === back) closeSheet(); });
  return $('.sheet');
}

const REMINDERS = [[null, 'NONE'], [0, 'AT DUE TIME'], [5, '5 MIN BEFORE'], [15, '15 MIN BEFORE'], [30, '30 MIN BEFORE'], [60, '1 HOUR BEFORE'], [1440, '1 DAY BEFORE']];
const REPEATS = [['none', 'NONE'], ['daily', 'DAILY'], ['weekdays', 'WEEKDAYS'], ['weekly', 'WEEKLY'], ['monthly', 'MONTHLY'], ['yearly', 'YEARLY']];

function openTaskEditor(task, preset = {}) {
  const isNew = !task;
  const t = JSON.parse(JSON.stringify(task || { ...blankTask(), ...preset }));
  t.repeat = t.repeat || { type: 'none', interval: 1, days: [] };
  t.repeat.days = t.repeat.days || [];
  t.subtasks = t.subtasks || [];
  const cats = [['', 'NONE', 'var(--text)']].concat(categories().map((c) => [c.id, c.name.toUpperCase(), c.color]));
  const ppl = [['', 'NONE']].concat(people().map((p) => [p, p.toUpperCase()]));
  const pjs = liveProjects();
  const cur = projectById(t.projectId);
  if (cur && !pjs.includes(cur)) pjs.push(cur);
  const pjOpts = [['', 'NONE', 'var(--text)']].concat(pjs.map((p) => [p.id, p.name.toUpperCase(), p.color]));
  const pills = (opts, val, key) => opts.map(([v, l, c]) => `<button type="button" class="chip${String(val ?? '') === String(v) ? ' on' : ''}" data-k="${key}" data-v="${esc(v)}" style="${c ? `--pc:${esc(c)}` : ''}">${esc(l)}</button>`).join('');
  const sh = openSheet(`
    <div class="sheet-head"><span class="label">${isNew ? 'NEW TASK' : 'TASK'}</span><button type="button" class="icon-btn" data-close aria-label="Close">${IC.close}</button></div>
    <div class="f"><input class="in title" id="eTitle" value="${esc(t.title)}" placeholder="What needs doing?" aria-label="Title"></div>
    <div class="f f-row"><div><span class="label" style="display:block;margin-bottom:8px">DATE</span><input class="in" type="date" id="eDate" value="${U.toDateInput(t.due)}"></div>
      <div><span class="label" style="display:block;margin-bottom:8px">TIME</span><input class="in" type="time" id="eTime" value="${t.dueHasTime ? U.toTimeInput(t.due) : ''}"></div></div>
    <div class="f"><span class="label">PRIORITY</span><div class="pills">${pills([['high', 'HIGH', 'var(--coral)'], ['medium', 'MED', 'var(--amber)'], ['low', 'LOW', 'var(--lav)']], t.priority, 'priority')}</div></div>
    <div class="f"><span class="label">CATEGORY</span><div class="pills">${pills(cats, t.category || '', 'category')}</div></div>
    ${pjs.length ? `<div class="f"><span class="label">PROJECT</span><div class="pills">${pills(pjOpts, t.projectId || '', 'projectId')}</div></div>` : ''}
    <div class="f"><span class="label">ASSIGNED TO</span><div class="pills">${pills(ppl, t.assignee || '', 'assignee')}</div></div>
    <div class="f f-row">
      <div><span class="label" style="display:block;margin-bottom:8px">REMINDER</span><select class="sel" id="eRem">${REMINDERS.map(([v, l]) => `<option value="${v == null ? '' : v}"${t.reminder === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
      <div><span class="label" style="display:block;margin-bottom:8px">REPEAT</span><select class="sel" id="eRep">${REPEATS.map(([v, l]) => `<option value="${v}"${t.repeat.type === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div></div>
    <div class="f" id="eDaysWrap" ${t.repeat.type === 'weekly' ? '' : 'hidden'}><span class="label">REPEAT ON</span>
      <div class="days">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => `<button type="button" class="chip${t.repeat.days.includes(i) ? ' on' : ''}" data-day="${i}" aria-label="${U.DAY_FULL[i]}">${d}</button>`).join('')}</div></div>
    <div class="f"><span class="label">SUBTASKS</span><div id="eSubs"></div><button type="button" class="btn line block" id="eAddSub" style="margin-top:8px">+ ADD SUBTASK</button></div>
    <div class="f"><span class="label">NOTES</span><textarea class="ta" id="eNotes" placeholder="Details">${esc(t.notes || '')}</textarea></div>
    <div class="sheet-foot">${isNew ? '' : '<button type="button" class="btn danger" id="eDel">DELETE</button>'}<button type="button" class="btn primary" id="eSave">${isNew ? 'LOG TASK' : 'SAVE'}</button></div>`);

  const renderSubs = () => {
    $('#eSubs', sh).innerHTML = t.subtasks.map((s, i) => `<div class="sub-item" data-i="${i}"><input type="checkbox" ${s.done ? 'checked' : ''} aria-label="Done"><input class="in" value="${esc(s.text)}" placeholder="Subtask" aria-label="Subtask"><button type="button" class="icon-btn" data-rm aria-label="Remove">${IC.close}</button></div>`).join('');
  };
  renderSubs();
  sh.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.close !== undefined) closeSheet();
    else if (b.dataset.k) {
      $$(`[data-k="${b.dataset.k}"]`, sh).forEach((x) => x.classList.toggle('on', x === b));
      t[b.dataset.k] = b.dataset.v || null;
    } else if (b.dataset.day) {
      const d = Number(b.dataset.day);
      const set = new Set(t.repeat.days);
      if (set.has(d)) set.delete(d); else set.add(d);
      t.repeat.days = [...set].sort();
      b.classList.toggle('on', set.has(d));
    } else if (b.dataset.rm !== undefined) {
      t.subtasks.splice(Number(b.closest('.sub-item').dataset.i), 1);
      renderSubs();
    }
  });
  $('#eSubs', sh).addEventListener('input', (e) => {
    const row = e.target.closest('.sub-item');
    const s = t.subtasks[Number(row.dataset.i)];
    if (e.target.type === 'checkbox') s.done = e.target.checked; else s.text = e.target.value;
  });
  $('#eAddSub', sh).addEventListener('click', () => { t.subtasks.push({ id: makeId('s_'), text: '', done: false }); renderSubs(); const ins = $$('#eSubs .in', sh); ins[ins.length - 1].focus(); });
  $('#eRep', sh).addEventListener('change', (e) => { t.repeat.type = e.target.value; $('#eDaysWrap', sh).hidden = t.repeat.type !== 'weekly'; });
  $('#eRem', sh).addEventListener('change', (e) => { t.reminder = e.target.value === '' ? null : Number(e.target.value); });
  $('#eSave', sh).addEventListener('click', () => {
    const title = $('#eTitle', sh).value.trim();
    if (!title) { $('#eTitle', sh).focus(); return; }
    const date = $('#eDate', sh).value;
    const time = $('#eTime', sh).value;
    const due = U.fromInputs(date, time);
    t.title = title;
    t.due = due ? due.toISOString() : null;
    t.dueHasTime = !!(date && time);
    t.notes = $('#eNotes', sh).value;
    if (t.repeat.type !== 'none' && !t.due) t.due = U.startOfDay(new Date()).toISOString();
    if (t.repeat.type === 'weekly' && !t.repeat.days.length && t.due) t.repeat.days = [new Date(t.due).getDay()];
    if (t.repeat.type !== 'weekly') t.repeat.days = [];
    t.subtasks = t.subtasks.filter((s) => s.text.trim());
    upsertTask(t);
    const back = preset.returnTo ? projectById(preset.returnTo) : null;
    if (back) openProject(back); else closeSheet();
    toast(isNew ? 'Task logged · transmitting to Command' : 'Task updated');
  });
  const del = $('#eDel', sh);
  if (del) del.addEventListener('click', () => {
    if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = 'CONFIRM'; return; }
    deleteTask(t.id);
    closeSheet();
    toast('Task deleted');
  });
  if (isNew) setTimeout(() => $('#eTitle', sh).focus(), 50);
}

const CREW_COLORS = ['#B8E27A', '#D9A9C6', '#A8B0D8', '#F4B6A0', '#4FD1E8', '#F2A65A'];
const LEVEL_INFO = [
  ['check', 'CHECK OFF ONLY', 'They can tick tasks done, and untick a mistake.'],
  ['notes', 'CHECK OFF + NOTES', 'Also leave notes on tasks and post to the project log.'],
  ['helper', 'PROJECT ADMINISTRATOR', 'Also add new tasks, edit them and delete them.']
];
const END_INFO = [['done', 'WHEN PROJECT IS DONE'], ['week', 'IN 7 DAYS'], ['never', 'NEVER']];
const SHARE_IC = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="3.2" cy="7" r="1.8" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="10.8" cy="3" r="1.8" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="10.8" cy="11" r="1.8" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M4.8 6.1 L9.2 3.9 M4.8 7.9 L9.2 10.1" stroke="currentColor" stroke-width="1.2"/></svg>';
const crewAv = (name, i, size = 26) => `<span class="crew-av" style="width:${size}px;height:${size}px;background:${CREW_COLORS[i % CREW_COLORS.length]}">${esc((name || '?').slice(0, 1).toUpperCase())}</span>`;
function shortWhen(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return U.sameDay(d, new Date()) ? U.fmtTimeShort(d, clock24()) : `${U.MONTHS[d.getMonth()].slice(0, 3).toUpperCase()} ${d.getDate()}`;
}
function shares(projectId) { return S.relay ? S.relay.forProject(projectId) : []; }

function openProject(p, { keep = false } = {}) {
  const now = new Date();
  const st = projectStats(p);
  const col = p.color || 'var(--amber)';
  const doneList = st.tasks.filter((t) => t.done);
  const live = p.status !== 'done';
  const crew = shares(p.id);
  const log = (p.log || []).slice().sort((a, b) => (b.at || 0) - (a.at || 0));
  const prevScroll = keep && $('.sheet') ? $('.sheet').scrollTop : 0;
  const withNotes = (t) => taskRow(t, now, { swipe: false }) + ((t.comments || []).length
    ? `<div class="crew-notes">${t.comments.slice(-2).map((c) => `<div class="crew-note"><span>${esc((c.by || '').toUpperCase())} · ${shortWhen(c.at)}</span>${esc(c.text)}</div>`).join('')}</div>` : '');
  S.openPj = p.id;
  const sh = openSheet(`
    <div class="sheet-head" data-pj-sheet="${esc(p.id)}"><span class="label">PROJECT · ${esc(live ? projectDueLabel(p, now) : 'FINISHED')}</span>
      <span class="sheet-head-r">${live ? `<button type="button" class="share-pill" id="pjShare">${SHARE_IC}SHARE</button>` : ''}<button type="button" class="icon-btn" data-close aria-label="Close">${IC.close}</button></span></div>
    <div class="pj-hero" style="--pc:${esc(col)}">
      <div class="pj-title">${esc(p.name)}</div>
      <div class="pj-big">${st.pct}%<small>COMPLETE</small></div>
    </div>
    <div class="pj-meter" style="--pc:${esc(col)}"><i style="width:${st.pct}%"></i></div>
    ${p.goal ? `<div class="pj-goal">${esc(p.goal)}</div>` : ''}
    ${crew.length ? `<button type="button" class="crew-strip" id="pjCrew"><span class="crew-avs">${crew.slice(0, 3).map((c, i) => crewAv(c.guest, i)).join('')}</span>
      <span class="crew-strip-t"><b>CREW · ${crew.length} ${crew.length === 1 ? 'PERSON' : 'PEOPLE'}</b><small>${esc(crew.map((c) => c.guest).join(', '))}</small></span><span class="crew-strip-go">MANAGE ›</span></button>` : ''}
    <button type="button" class="log-strip" id="pjLog"><span class="log-strip-h"><b>PROJECT LOG · ${log.length}</b><span>${log.length ? 'OPEN ›' : 'POST ›'}</span></span>
      ${log.length ? `<span class="log-strip-peek"><i>${esc(log[0].by)}:</i> ${esc(log[0].text)}</span>` : ''}</button>
    <div class="group-h"><span>NEXT UP</span><span>${st.open.length} OPEN</span></div>
    <div class="pj-tasks">${st.open.map(withNotes).join('') || '<div class="empty" style="padding:8px 0">No open tasks.</div>'}</div>
    ${doneList.length ? `<div class="group-h"><span>DONE</span><span>${doneList.length}</span></div><div class="pj-tasks">${doneList.map(withNotes).join('')}</div>` : ''}
    <div class="sheet-foot">
      <button type="button" class="btn line" id="pjEdit">EDIT</button>
      ${live && st.total && !st.open.length ? '<button type="button" class="btn line" id="pjDone" style="color:var(--lime)">MARK COMPLETE</button>' : ''}
      ${live ? '' : '<button type="button" class="btn line" id="pjReopen">REOPEN</button>'}
      <button type="button" class="btn primary" id="pjAdd">+ ADD TASK</button>
    </div>`);
  if (keep) sh.style.animation = 'none';
  if (prevScroll) sh.scrollTop = prevScroll;
  sh.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { S.openPj = null; closeSheet(); return; }
    const row = e.target.closest('.trow');
    const act = e.target.closest('[data-act]');
    if (row && act) {
      const task = S.tasks.find((x) => x.id === row.dataset.id);
      if (!task) return;
      if (act.dataset.act === 'toggle') { if (task.done) uncomplete(task.id); else completeTask(task.id); openProject(projectById(p.id) || p, { keep: true }); }
      else if (act.dataset.act === 'edit') openTaskEditor(task, { returnTo: p.id });
      return;
    }
    if (e.target.closest('#pjShare') || e.target.closest('#pjCrew')) openShareSheet(p);
    else if (e.target.closest('#pjLog')) openProjectLog(p);
    else if (e.target.closest('#pjEdit')) openProjectEditor(p);
    else if (e.target.closest('#pjAdd')) openTaskEditor(null, { projectId: p.id, returnTo: p.id });
    else if (e.target.closest('#pjDone')) { upsertProject({ ...p, status: 'done', completedAt: new Date().toISOString() }); chirp.ack(); S.openPj = null; closeSheet(); toast(`Project complete: ${p.name}`); }
    else if (e.target.closest('#pjReopen')) { const q = { ...p, status: 'active', completedAt: null }; upsertProject(q); openProject(q); }
  });
}

function openProjectLog(p) {
  S.openPj = null;
  const draw = () => {
    const proj = projectById(p.id) || p;
    const log = (proj.log || []).slice().sort((a, b) => (b.at || 0) - (a.at || 0));
    const prev = $('#plText');
    const keepText = prev ? prev.value : '';
    const sh = openSheet(`
      <div class="sheet-head"><span class="label">PROJECT LOG · ${esc(proj.name.toUpperCase())}</span><button type="button" class="icon-btn" data-close aria-label="Close">${IC.close}</button></div>
      <div class="hint" style="margin-top:0">Notes about the whole project. Anyone you share it with sees them, and crew with notes access can post here too.</div>
      <form class="pl-form" id="plForm" autocomplete="off"><textarea class="ta" id="plText" rows="3" maxlength="1000" placeholder="Post a note for the whole project…" aria-label="Project log note"></textarea><button type="submit" class="btn primary">POST</button></form>
      <div class="pl-list">${log.length ? log.map((e) => `<div class="pl-item"><span>${esc((e.by || '').toUpperCase())} · ${shortWhen(e.at)}</span>${esc(e.text)}</div>`).join('') : '<div class="empty">No posts yet.</div>'}</div>
      <div class="sheet-foot"><button type="button" class="btn line block" id="plBack">‹ BACK TO PROJECT</button></div>`);
    $('#plText', sh).value = keepText;
    sh.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) closeSheet();
      else if (e.target.closest('#plBack')) openProject(projectById(p.id) || p);
    });
    $('#plForm', sh).addEventListener('submit', (e) => {
      e.preventDefault();
      const v = $('#plText', sh).value.trim();
      if (!v) return;
      $('#plText', sh).value = '';
      addProjectLog(p.id, [{ id: makeId('l_'), by: operator(), text: v.slice(0, 1000), at: Date.now() }]);
      draw();
    });
  };
  draw();
}

function openShareSheet(p) {
  S.openPj = null;
  const draft = { guest: '', level: 'notes', ends: 'done' };
  let made = null;
  let busy = false;
  const draw = async () => {
    const prev = $('#shName');
    if (prev) draft.guest = prev.value;
    const crew = shares(p.id);
    const ready = !!S.relay && !!S.fire;
    let qr = '';
    if (made) { try { qr = await fb.QRCode.toDataURL(made.url, { margin: 2, scale: 6, color: { dark: '#14151BFF', light: '#F4EFE9FF' } }); } catch (e) { qr = ''; } }
    const sh = openSheet(`
      <div class="sheet-head" data-share-sheet="${esc(p.id)}"><span class="label">SHARE · ${esc(p.name.toUpperCase())}</span><button type="button" class="icon-btn" data-close aria-label="Close">${IC.close}</button></div>
      ${!ready ? '<div class="hint err-t" style="margin-top:0">Waiting for the uplink to Command. Try again in a moment.</div>' : ''}
      ${made ? `<div class="sh-made"><div class="sh-made-h">✓ MANIFEST READY · ${esc(made.guest.toUpperCase())}</div>
          <div class="sh-made-row">${qr ? `<img src="${qr}" alt="QR code for the link">` : ''}<div class="sh-link">${esc(made.url)}</div></div></div>
        <div class="sh-btns"><button type="button" class="btn line" id="shCopy">COPY LINK</button><button type="button" class="btn primary" id="shSend">SEND…</button></div>
        <div class="hint">SEND opens iPhone's share menu: Messages, Mail, AirDrop. The link opens in any browser, no app needed.</div>`
      : `<div class="f"><span class="label">WHO'S IT FOR?</span><input class="in title" id="shName" maxlength="40" placeholder="Their name" value="${esc(draft.guest)}" aria-label="Their name"></div>
        <div class="f"><span class="label">WHAT CAN THEY DO?</span><div class="sh-levels">${LEVEL_INFO.map(([v, l, d]) => `<button type="button" class="sh-level${draft.level === v ? ' on' : ''}" data-level="${v}"><i></i><span><b>${l}</b><small>${d}</small></span></button>`).join('')}</div></div>
        <div class="f"><span class="label">LINK STOPS WORKING</span><div class="pills">${END_INFO.map(([v, l]) => `<button type="button" class="chip${draft.ends === v ? ' on' : ''}" data-ends="${v}">${l}</button>`).join('')}</div></div>
        <button type="button" class="btn primary block" id="shCreate" ${ready && !busy ? '' : 'disabled'} style="margin-top:8px">${busy ? 'CREATING…' : 'CREATE LINK'}</button>`}
      <div class="group-h"><span>PEOPLE WITH ACCESS</span><span>${crew.length}</span></div>
      ${crew.length ? crew.map((c, i) => `<div class="sh-person">${crewAv(c.guest, i)}
          <span class="sh-p-text"><b>${esc(c.guest)}</b><small>${c.lastActive ? `ACTIVE ${esc(shortWhen(c.lastActive))}` : 'NOT OPENED YET'}</small>
            <select class="sel sh-lvl" data-lvl="${esc(c.token)}" aria-label="Access for ${esc(c.guest)}">${LEVEL_INFO.map(([v, l]) => `<option value="${v}"${c.level === v ? ' selected' : ''}>${l}</option>`).join('')}</select></span>
          <span class="sh-p-btns"><button type="button" class="mini-line" data-send="${esc(c.token)}" data-guest="${esc(c.guest)}">SEND</button><button type="button" class="mini-line danger-t" data-stop="${esc(c.token)}">STOP</button></span>
        </div>`).join('') : '<div class="hint">Nobody yet. Links you create show up here, with STOP to end one at any time.</div>'}
      ${made ? '<button type="button" class="btn line block" id="shAnother" style="margin-top:14px">+ SHARE WITH SOMEONE ELSE</button>' : ''}
      <div class="sheet-foot"><button type="button" class="btn line block" id="shBack">‹ BACK TO PROJECT</button></div>`);
    const sendLink = async (url, guest) => {
      if (navigator.share) { try { await navigator.share({ title: `${p.name} · Project Manifest`, text: `${operator()} shared “${p.name}” with you.`, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
      try { await navigator.clipboard.writeText(url); toast(`Link for ${guest} copied`); } catch (e) { toast(url, 6000); }
    };
    sh.addEventListener('click', async (e) => {
      const t = e.target;
      if (t.closest('[data-close]')) { closeSheet(); return; }
      if (t.closest('#shBack')) { openProject(projectById(p.id) || p); return; }
      const lv = t.closest('[data-level]');
      if (lv) { draft.level = lv.dataset.level; draw(); return; }
      const en = t.closest('[data-ends]');
      if (en) { draft.ends = en.dataset.ends; draw(); return; }
      if (t.closest('#shAnother')) { made = null; draft.guest = ''; draw(); return; }
      if (t.closest('#shCopy')) { try { await navigator.clipboard.writeText(made.url); toast('Link copied'); } catch (err) { toast(made.url, 6000); } return; }
      if (t.closest('#shSend')) { sendLink(made.url, made.guest); return; }
      const sd = t.closest('[data-send]');
      if (sd) { sendLink(manifestUrl(location.origin, sd.dataset.send), sd.dataset.guest); return; }
      const stop = t.closest('[data-stop]');
      if (stop) {
        if (stop.dataset.armed !== '1') { stop.dataset.armed = '1'; stop.textContent = 'CONFIRM'; return; }
        try { await S.relay.revoke(stop.dataset.stop); toast('Link stopped. It no longer opens.'); } catch (err) { toast('Could not stop it. Check the signal and try again.', 4000); }
        draw();
        return;
      }
      if (t.closest('#shCreate')) {
        const guest = ($('#shName', sh).value || '').trim();
        if (!guest) { $('#shName', sh).focus(); return; }
        busy = true; draw();
        try {
          const token = await S.relay.share({ projectId: p.id, guest, level: draft.level, ends: draft.ends });
          made = { token, guest, url: manifestUrl(location.origin, token) };
          chirp.ack();
        } catch (err) { toast('Could not create the link. Check the signal and try again.', 4000); }
        busy = false;
        draw();
      }
    });
    sh.addEventListener('change', async (e) => {
      const sel = e.target.closest('[data-lvl]');
      if (!sel) return;
      try { await S.relay.setLevel(sel.dataset.lvl, sel.value); toast('Access changed'); } catch (err) { toast('Could not change access right now.', 4000); }
    });
    sh.style.animation = 'none';
  };
  S.shareRedraw = draw;
  draw();
}

function openProjectEditor(project) {
  const isNew = !project;
  const p = JSON.parse(JSON.stringify(project || { id: makeId('p_'), name: '', goal: '', color: PROJECT_COLORS.find((c) => !liveProjects().some((x) => x.color === c)) || PROJECT_COLORS[0], due: null, status: 'active' }));
  const sh = openSheet(`
    <div class="sheet-head"><span class="label">${isNew ? 'NEW PROJECT' : 'EDIT PROJECT'}</span><button type="button" class="icon-btn" data-close aria-label="Close">${IC.close}</button></div>
    <div class="f"><input class="in title" id="pjName" value="${esc(p.name)}" placeholder="Project name" aria-label="Project name"></div>
    <div class="f"><span class="label">GOAL · OPTIONAL</span><input class="in" id="pjGoal" value="${esc(p.goal || '')}" placeholder="What does done look like?" aria-label="Goal"></div>
    <div class="f"><span class="label">FINISH BY · OPTIONAL</span><input class="in" type="date" id="pjDue" value="${p.due ? U.toDateInput(projectDue(p)) : ''}" aria-label="Finish by"></div>
    <div class="f"><span class="label">COLOR</span><div class="pills">${PROJECT_COLORS.map((c) => `<button type="button" class="chip swatch${p.color === c ? ' on' : ''}" data-color="${c}" style="--pc:${c}" aria-label="Color ${c}"><i style="background:${c}"></i></button>`).join('')}</div></div>
    <div class="hint">Tasks join a project from the task editor, from the project itself, or by typing “…to the ${esc((p.name || 'garage cleanout').toLowerCase())} project” in the terminal.</div>
    <div class="sheet-foot">${isNew ? '' : '<button type="button" class="btn danger" id="pjDel">DELETE</button>'}<button type="button" class="btn primary" id="pjSave">${isNew ? 'START PROJECT' : 'SAVE'}</button></div>`);
  sh.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { if (isNew) closeSheet(); else openProject(project); return; }
    const sw = e.target.closest('[data-color]');
    if (sw) { p.color = sw.dataset.color; $$('[data-color]', sh).forEach((x) => x.classList.toggle('on', x === sw)); }
  });
  $('#pjSave', sh).addEventListener('click', () => {
    const name = $('#pjName', sh).value.trim();
    if (!name) { $('#pjName', sh).focus(); return; }
    const date = $('#pjDue', sh).value;
    const out = { ...p, name, goal: $('#pjGoal', sh).value.trim(), due: date ? U.fromInputs(date, '').toISOString() : null };
    upsertProject(out);
    if (isNew) { closeSheet(); S.view = 'tasks'; S.tkView = 'projects'; render(); toast(`Project started: ${name}`); }
    else openProject(projectById(out.id) || out);
  });
  const del = $('#pjDel', sh);
  if (del) del.addEventListener('click', () => {
    if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = 'CONFIRM · TASKS STAY'; return; }
    deleteProject(p.id);
    closeSheet();
    toast('Project deleted. Its tasks stay in the queue.');
  });
  if (isNew) setTimeout(() => $('#pjName', sh).focus(), 50);
}

function openEventEditor(ev, date) {
  const isNew = !ev;
  let e;
  if (ev) e = JSON.parse(JSON.stringify(ev));
  else {
    const s = new Date(date || new Date());
    s.setHours(U.sameDay(s, new Date()) ? new Date().getHours() + 1 : 9, 0, 0, 0);
    e = { id: makeId('e_'), title: '', start: s.toISOString(), end: new Date(s.getTime() + 3600000).toISOString(), allDay: false, notes: '' };
  }
  const sh = openSheet(`
    <div class="sheet-head"><span class="label">${isNew ? 'NEW EVENT' : 'EVENT'} · ${esc((shared().localCalendarName || 'Local').toUpperCase())}</span><button type="button" class="icon-btn" data-close aria-label="Close">${IC.close}</button></div>
    <div class="f"><input class="in title" id="vTitle" value="${esc(e.title)}" placeholder="What's happening?" aria-label="Event"></div>
    <div class="f"><span class="label">DATE</span><input class="in" type="date" id="vDate" value="${U.toDateInput(e.start)}"></div>
    <div class="set-row"><span>All day</span><button type="button" class="switch" id="vAll" role="switch" aria-checked="${e.allDay ? 'true' : 'false'}" aria-label="All day"><i></i></button></div>
    <div class="f f-row" id="vTimes" ${e.allDay ? 'hidden' : ''}><div><span class="label" style="display:block;margin-bottom:8px">STARTS</span><input class="in" type="time" id="vStart" value="${U.toTimeInput(e.start)}"></div>
      <div><span class="label" style="display:block;margin-bottom:8px">ENDS</span><input class="in" type="time" id="vEnd" value="${U.toTimeInput(e.end)}"></div></div>
    <div class="sheet-foot">${isNew ? '' : '<button type="button" class="btn danger" id="vDel">DELETE</button>'}<button type="button" class="btn primary" id="vSave">${isNew ? 'SCHEDULE' : 'SAVE'}</button></div>`);
  sh.addEventListener('click', (x) => { if (x.target.closest('[data-close]')) closeSheet(); });
  $('#vAll', sh).addEventListener('click', (x) => {
    e.allDay = !e.allDay;
    x.currentTarget.setAttribute('aria-checked', e.allDay ? 'true' : 'false');
    $('#vTimes', sh).hidden = e.allDay;
  });
  $('#vSave', sh).addEventListener('click', () => {
    const title = $('#vTitle', sh).value.trim();
    const date = $('#vDate', sh).value;
    if (!title || !date) { (title ? $('#vDate', sh) : $('#vTitle', sh)).focus(); return; }
    let start;
    let end;
    if (e.allDay) { start = U.fromInputs(date, ''); end = U.addDays(start, 1); }
    else {
      start = U.fromInputs(date, $('#vStart', sh).value || '09:00');
      end = U.fromInputs(date, $('#vEnd', sh).value || '');
      if (!end || end <= start) end = new Date(start.getTime() + 3600000);
    }
    const out = { ...e, title, start: start.toISOString(), end: end.toISOString() };
    const i = S.events.findIndex((x) => x.id === out.id);
    if (i >= 0) S.events[i] = out; else S.events.push(out);
    persist('events');
    closeSheet();
    toast(isNew ? 'Event scheduled · transmitting to Command' : 'Event updated');
  });
  const del = $('#vDel', sh);
  if (del) del.addEventListener('click', () => {
    if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = 'CONFIRM'; return; }
    S.events = S.events.filter((x) => x.id !== e.id);
    persist('events');
    closeSheet();
  });
}

function openPhrases() {
  const keys = Object.keys(PHRASES);
  const sh = openSheet(`
    <div class="sheet-head"><span class="label">PHRASES · ONE PER LINE</span><button type="button" class="icon-btn" data-close aria-label="Close">${IC.close}</button></div>
    <div class="hint" style="margin-top:0">${esc(S.settings.callsign)} picks one line at random each time. Use <b>{name}</b>, <b>{callsign}</b> and <b>{title}</b> as placeholders.</div>
    ${keys.map((k) => `<div class="f"><span class="label">${esc(PHRASE_LABELS[k].toUpperCase())}</span><textarea class="ta" data-phrase="${k}" rows="3">${esc(((S.settings.phrases[k] && S.settings.phrases[k].length) ? S.settings.phrases[k] : PHRASES[k]).join('\n'))}</textarea></div>`).join('')}
    <div class="sheet-foot"><button type="button" class="btn line" id="pReset">RESET ALL</button><button type="button" class="btn primary" id="pSave">SAVE</button></div>`);
  sh.addEventListener('click', (x) => { if (x.target.closest('[data-close]')) closeSheet(); });
  $('#pSave', sh).addEventListener('click', () => {
    const out = {};
    $$('[data-phrase]', sh).forEach((ta) => {
      const lines = ta.value.split('\n').map((l) => l.trim()).filter(Boolean);
      const k = ta.dataset.phrase;
      if (lines.length && JSON.stringify(lines) !== JSON.stringify(PHRASES[k])) out[k] = lines;
    });
    S.settings.phrases = out;
    saveSettings();
    closeSheet();
    toast('Phrases saved');
  });
  $('#pReset', sh).addEventListener('click', () => { S.settings.phrases = {}; saveSettings(); closeSheet(); toast('Phrases reset'); });
}

// ---------------------------------------------------------------- comms terminal (keyboard)
// A computer-style transcript. Field Unit prints its replies like a mainframe readout;
// readout cards carry UNDO, and deletes wait for CONFIRM (or a typed y / n).
// The transcript lives in sessionStorage: it survives switching apps, and is wiped when
// Field Unit is closed completely (swiped away), so each launch starts with a fresh screen.
function loadComms() {
  try { localStorage.removeItem('fu.comms'); } catch (e) { /* blocked */ }
  try { const v = sessionStorage.getItem('fu.comms'); return v ? JSON.parse(v) : []; } catch (e) { return []; }
}
const C = {
  open: false,
  log: loadComms(),
  undo: new Map(), // entry id → function (only for this session)
  pending: null, // delete waiting for y / n: { kind, id, title, entry, expires }
  busy: null,
  skip: false
};
const MAX_LOG = 160;
const IC_TERM = '<svg width="28" height="28" viewBox="0 0 30 30" aria-hidden="true"><path d="M6 9 L12 15 L6 21" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M15 22 H24" stroke="currentColor" stroke-width="2.2"/></svg>';
const CHIPS = [
  ['Status report', 'status report'],
  ['Take a note', 'take a note: ', true],
  ['New project', 'new project ', true],
  ['Add to calendar', 'schedule ', true]
];

function saveComms() {
  if (C.log.length > MAX_LOG) C.log = C.log.slice(-MAX_LOG);
  try { sessionStorage.setItem('fu.comms', JSON.stringify(C.log)); } catch (e) { /* storage blocked */ }
}

function ctEntryHtml(e) {
  if (e.k === 'sep') return `<div class="ct-sep" data-e="${e.id}">── ${esc(e.text)} ──</div>`;
  if (e.k === 'you') return `<div class="ct-you" data-e="${e.id}"><span class="p">&gt; </span>${esc(e.text)}</div>`;
  if (e.k === 'fu') return `<div class="ct-fu ${e.tone || ''}" data-e="${e.id}"><span class="p">› </span><span class="tx">${esc(e.text)}</span></div>`;
  if (e.k === 'card') {
    const icon = { ok: '✓ ', warn: '⚠ ', err: '✕ ', wait: '◌ ', info: '' }[e.tone] ?? '';
    const head = e.state === 'undone' ? '↺ UNDONE' : e.state === 'confirmed' ? '✓ PURGED' : e.state === 'kept' ? '✓ KEPT' : `${icon}${e.head}`;
    const canUndo = e.undo && !e.state && C.undo.has(e.id);
    const canConfirm = e.confirm && !e.state && C.pending && C.pending.entry === e.id;
    return `<div class="ct-card ${e.state ? `st-${e.state}` : `tone-${e.tone || 'ok'}`}" data-e="${e.id}">
      <div class="ct-card-h"><span>${esc(head)}</span>${canUndo ? `<button type="button" class="ct-mini" data-ct="undo" data-id="${e.id}">UNDO</button>` : ''}</div>
      ${e.fields && e.fields.length ? `<div class="ct-kv">${e.fields.map(([k, v]) => `<span>${esc(k)}</span><span>${esc(v)}</span>`).join('')}</div>` : ''}
      ${canConfirm ? '<div class="ct-yn"><button type="button" class="ct-no" data-ct="no">CANCEL · N</button><button type="button" class="ct-yes" data-ct="yes">CONFIRM · Y</button></div>' : ''}
    </div>`;
  }
  return '';
}

function ctChipsHtml() {
  if (C.pending) return '<button type="button" class="ct-chip warn" data-ct="yes">y · confirm</button><button type="button" class="ct-chip" data-ct="no">n · keep it</button>';
  return CHIPS.map(([l, cmd, fill], i) => `<button type="button" class="ct-chip" data-chip="${i}"${fill ? ' data-fill="1"' : ''}>${esc(l)}</button>`).join('');
}

function ctLinkHtml() {
  const online = commandOnline();
  return `<span class="ct-led ${online ? 'on' : 'off'}"></span>${online ? 'LINK TO COMMAND · STABLE' : 'COMMAND OFFLINE · STORING LOCALLY'}`;
}

function openComms() {
  ac();
  C.open = true;
  $('#overlay').innerHTML = `<div class="ct-screen" role="dialog" aria-label="Comms terminal">
    <header class="ct-head">
      <div class="ct-head-row"><div class="ct-title">COMMS TERMINAL</div>
        <div class="ct-head-btns"><button type="button" class="ct-mini" data-ct="clear" aria-label="Clear the terminal">CLEAR</button>
        <button type="button" class="ct-mini" data-ct="close">CLOSE TERMINAL</button></div></div>
      <div class="ct-link" id="ctLink">${ctLinkHtml()}</div>
    </header>
    <div class="ct-log" id="ctLog" aria-live="polite">${C.log.map(ctEntryHtml).join('')}<div class="ct-cursor-line" id="ctCursor"><span class="p">&gt; </span><i class="ct-cursor"></i></div></div>
    <div class="ct-foot">
      <div class="ct-chips" id="ctChips">${ctChipsHtml()}</div>
      <form class="ct-form" id="ctForm" autocomplete="off">
        <label class="ct-field"><span aria-hidden="true">&gt;</span><input id="ctText" aria-label="Command" placeholder="${C.pending ? 'Type y or n' : 'Type a command'}" enterkeyhint="send" autocomplete="off" spellcheck="false"></label>
        <button type="submit" class="ct-send" aria-label="Send"><svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M3 9 H14 M9 4 L14 9 L9 14" fill="none" stroke="currentColor" stroke-width="2"/></svg></button>
      </form>
    </div>
  </div>`;
  const scr = $('.ct-screen');
  scr.addEventListener('click', onCommsClick);
  $('#ctForm').addEventListener('submit', onCommsSubmit);
  fitComms();
  ctScroll(true);
  sfx.droneStart();
  const last = C.log[C.log.length - 1];
  const fresh = !last || Date.now() - (last.at || 0) > 20 * 60000;
  if (fresh) {
    const now = new Date();
    ctAdd({ k: 'sep', text: `${U.DAY_FULL[now.getDay()].slice(0, 3).toUpperCase()} ${now.getDate()} ${U.MONTHS[now.getMonth()].slice(0, 3).toUpperCase()} · ${U.fmtTimeShort(now, clock24())}` });
    queueOut(async () => { await say(pick('greet'), 'sys'); });
  }
  setTimeout(() => { const i = $('#ctText'); if (i && C.open) i.focus(); }, 60);
}

function closeComms() {
  C.open = false;
  C.skip = true;
  sfx.droneStop();
  sfx.hush();
  $('#overlay').innerHTML = '';
  window.scrollTo(0, 0);
  render();
}

// iPhone's keyboard shrinks the visual viewport, not the layout one: keep the input above it.
function fitComms() {
  const scr = $('.ct-screen');
  const vv = window.visualViewport;
  if (!scr || !vv) return;
  scr.style.height = `${vv.height}px`;
  scr.style.transform = `translateY(${vv.offsetTop}px)`;
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => { if (C.open) { fitComms(); ctScroll(true); } });
  window.visualViewport.addEventListener('scroll', () => { if (C.open) fitComms(); });
}

function ctScroll(force) {
  const el = $('#ctLog');
  if (!el) return;
  if (force || el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight;
}

function ctAdd(entry) {
  const e = { id: makeId('c_'), at: Date.now(), ...entry };
  C.log.push(e);
  saveComms();
  const cur = $('#ctCursor');
  if (cur) cur.insertAdjacentHTML('beforebegin', ctEntryHtml(e));
  ctScroll(true);
  return e;
}

function ctUpdate(e) {
  saveComms();
  const node = $(`#ctLog [data-e="${e.id}"]`);
  if (node) node.outerHTML = ctEntryHtml(e);
}

function ctRefreshChrome() {
  const chips = $('#ctChips');
  if (chips) chips.innerHTML = ctChipsHtml();
  const i = $('#ctText');
  if (i) i.placeholder = C.pending ? 'Type y or n' : 'Type a command';
  const link = $('#ctLink');
  if (link) link.innerHTML = ctLinkHtml();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Prints one line, character by character, with the readout sound.
async function say(text, tone = '') {
  if (!text) return;
  text = String(text).trim();
  const e = ctAdd({ k: 'fu', text, tone });
  const node = $(`#ctLog [data-e="${e.id}"] .tx`);
  if (!node || !C.open || C.skip) return;
  const per = Math.max(9, Math.min(26, 1600 / Math.max(1, text.length)));
  node.textContent = '';
  node.parentElement.classList.add('typing');
  const voice = sfx.readout(text, per);
  const t0 = performance.now();
  await new Promise((resolve) => {
    const step = () => {
      const k = C.skip || !C.open ? text.length : Math.min(text.length, Math.floor((performance.now() - t0) / per) + 1);
      node.textContent = text.slice(0, k);
      ctScroll();
      if (k >= text.length) resolve(); else requestAnimationFrame(step);
    };
    step();
  });
  if (C.skip) voice.stop();
  node.parentElement.classList.remove('typing');
  if (!C.skip && C.open) await sleep(240);
}

async function card({ head, tone = 'ok', fields = [], undo = null, confirm = false }) {
  const e = ctAdd({ k: 'card', head, tone, fields, undo: !!undo, confirm });
  if (undo) { C.undo.set(e.id, undo); ctUpdate(e); }
  const node = $(`#ctLog [data-e="${e.id}"]`);
  if (node && !C.skip) node.classList.add('reveal');
  if (C.open && !C.skip) { sfx.cardOut(); await sleep(260); }
  return e;
}

// All output goes through one queue, so lines never interleave.
function queueOut(fn) {
  const run = (C.busy || Promise.resolve()).then(async () => {
    C.skip = false;
    try { await fn(); } catch (err) { console.error(err); await say('Fault in the relay. Try that again.', 'err'); }
  });
  const tracked = run.finally(() => { if (C.busy === tracked) C.busy = null; });
  C.busy = tracked;
  return tracked;
}

function onCommsSubmit(e) {
  e.preventDefault();
  const input = $('#ctText');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  submitCommand(text);
}

function submitCommand(text) {
  if (C.busy) C.skip = true; // fast-forward whatever is still printing
  ctAdd({ k: 'you', text });
  sfx.enter();
  queueOut(() => runCommand(text));
}

function onCommsClick(e) {
  const b = e.target.closest('[data-ct],[data-chip]');
  if (!b) {
    if (e.target.closest('#ctLog') && C.busy) C.skip = true; // tap the readout to skip ahead
    return;
  }
  if (b.dataset.chip !== undefined) {
    const [, cmd, fill] = CHIPS[Number(b.dataset.chip)];
    const i = $('#ctText');
    if (fill) { i.value = cmd; i.focus(); i.setSelectionRange(cmd.length, cmd.length); return; }
    submitCommand(cmd);
    return;
  }
  const a = b.dataset.ct;
  if (a === 'close') closeComms();
  else if (a === 'clear') {
    if (C.busy) C.skip = true;
    queueOut(async () => { clearComms(); await say('Screen cleared.', 'sys'); });
  }
  else if (a === 'yes') submitCommand('y');
  else if (a === 'no') submitCommand('n');
  else if (a === 'undo') {
    const id = b.dataset.id;
    const fn = C.undo.get(id);
    const ent = C.log.find((x) => x.id === id);
    if (!fn || !ent) return;
    C.undo.delete(id);
    fn();
    ent.state = 'undone';
    ctUpdate(ent);
    queueOut(() => say('Undone. Command updated.', 'ok'));
  }
}

// ---------------------------------------------------------------- comms sounds ("mainframe readout")
const sfx = (() => {
  let noise = null;
  let drone = null;
  const live = new Set();
  const mode = () => S.settings.commsSound || 'mainframe';
  const vol = () => ({ mainframe: 0.55, soft: 0.22 }[mode()] || 0);
  function noiseBuf(c) {
    if (noise) return noise;
    noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return noise;
  }
  function bus(c, v) {
    const g = c.createGain();
    g.gain.value = v;
    g.connect(c.destination);
    live.add(g);
    return g;
  }
  function beep(c, out, t, f, dur, soft) {
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = soft ? 2600 : 5000;
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(soft ? 0.5 : 0.32, t + 0.002);
    env.gain.setValueAtTime(soft ? 0.5 : 0.32, t + dur - 0.004);
    env.gain.linearRampToValueAtTime(0.0001, t + dur);
    lp.connect(env);
    env.connect(out);
    const parts = soft ? [['sine', 1]] : [['square', 0.55], ['sine', 0.45]];
    parts.forEach(([type, mix]) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.value = f;
      g.gain.value = mix;
      o.connect(g);
      g.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.01);
    });
  }
  function click(c, out, t) {
    const s = c.createBufferSource();
    s.buffer = noiseBuf(c);
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1500;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 6000;
    const g = c.createGain();
    g.gain.setValueAtTime(0.6 * 0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.0012 * 4);
    s.connect(hp);
    hp.connect(lp);
    lp.connect(g);
    g.connect(out);
    s.start(t, Math.random() * 0.9);
    s.stop(t + 0.008);
  }
  function tone(c, out, t, f, dur, v) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + 0.012);
    g.gain.setValueAtTime(v, t + dur - 0.05);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  const BASES = [880, 990, 1175, 1320, 1480, 1760];
  const MULTS = [1, 1, 1.122, 0.891, 1.5];
  const rnd = (a) => a[Math.floor(Math.random() * a.length)];
  return {
    // One beep per printed character, grouped into little clusters that share a pitch.
    readout(text, perMs) {
      const v = vol();
      if (!v) return { stop() {} };
      let c;
      try { c = ac(); } catch (e) { return { stop() {} }; }
      const soft = mode() === 'soft';
      const out = bus(c, v);
      const t0 = c.currentTime + 0.02;
      const every = perMs < 15 ? 2 : 1; // fast lines: every other character
      let left = 0;
      let base = 880;
      let shift = 0;
      for (let i = 0; i < text.length; i++) {
        if (text[i] === ' ' || i % every) continue;
        if (left <= 0) { left = 3 + Math.floor(Math.random() * 5); base = rnd(BASES); if (i) shift += ((20 + Math.random() * 50) / 1000) * 0.3; }
        left--;
        const t = t0 + (i * perMs) / 1000 + shift;
        const dur = (12 + Math.random() * 8) / 1000;
        beep(c, out, t, base * rnd(MULTS), dur, soft);
        if (!soft) click(c, out, t);
      }
      const end = t0 + (text.length * perMs) / 1000 + 0.3;
      setTimeout(() => { try { out.disconnect(); } catch (e) { /* gone */ } live.delete(out); }, (end - c.currentTime) * 1000 + 200);
      return { stop() { try { out.gain.setValueAtTime(0, c.currentTime); out.disconnect(); } catch (e) { /* gone */ } live.delete(out); } };
    },
    transmit() {
      const v = vol();
      if (!v) return;
      try {
        const c = ac();
        const out = bus(c, v);
        const t = c.currentTime + 0.02;
        tone(c, out, t, 440, 0.32, 0.22);
        tone(c, out, t + 0.22, 660, 0.36, 0.2);
        setTimeout(() => { live.delete(out); }, 1200);
      } catch (e) { /* no audio */ }
    },
    cardOut() {
      const v = vol();
      if (!v) return;
      try {
        const c = ac();
        const out = bus(c, v);
        const t = c.currentTime + 0.01;
        [0, 0.035, 0.07].forEach((d, i) => { beep(c, out, t + d, [1320, 1760, 1480][i], 0.016, mode() === 'soft'); if (mode() !== 'soft') click(c, out, t + d); });
        setTimeout(() => { live.delete(out); }, 600);
      } catch (e) { /* no audio */ }
    },
    enter() {
      const v = vol();
      if (!v) return;
      try { const c = ac(); const out = bus(c, v * 0.8); beep(c, out, c.currentTime + 0.005, 660, 0.03, true); setTimeout(() => live.delete(out), 300); } catch (e) { /* no audio */ }
    },
    hush() { live.forEach((g) => { try { g.disconnect(); } catch (e) { /* gone */ } }); live.clear(); },
    // The low hum of the ship's computer room, under the terminal (Mainframe only).
    droneStart() {
      if (drone || mode() !== 'mainframe') return;
      try {
        const c = ac();
        const out = c.createGain();
        out.gain.value = 0;
        out.gain.linearRampToValueAtTime(0.05, c.currentTime + 1.2);
        out.connect(c.destination);
        const pulse = c.createGain();
        pulse.gain.value = 0.75;
        const lfo = c.createOscillator();
        const depth = c.createGain();
        lfo.frequency.value = 0.35;
        depth.gain.value = 0.25;
        lfo.connect(depth);
        depth.connect(pulse.gain);
        pulse.connect(out);
        const nodes = [lfo];
        [[55, 0.5], [82.5, 0.28], [110, 0.18]].forEach(([f, g]) => {
          const o = c.createOscillator();
          const og = c.createGain();
          o.frequency.value = f;
          og.gain.value = g;
          o.connect(og);
          og.connect(pulse);
          nodes.push(o);
        });
        const n = c.createBufferSource();
        n.buffer = noiseBuf(c);
        n.loop = true;
        const nlp = c.createBiquadFilter();
        nlp.type = 'lowpass';
        nlp.frequency.value = 300;
        const ng = c.createGain();
        ng.gain.value = 0.35;
        n.connect(nlp);
        nlp.connect(ng);
        ng.connect(out);
        nodes.push(n);
        nodes.forEach((x) => x.start());
        const tick = () => {
          if (!drone) return;
          try { const t = c.currentTime; const g = c.createGain(); g.gain.value = 0.5; g.connect(out); click(c, g, t); } catch (e) { /* skip */ }
          drone.tick = setTimeout(tick, 900 + Math.random() * 3200);
        };
        drone = { out, nodes, tick: null };
        drone.tick = setTimeout(tick, 1500);
      } catch (e) { drone = null; }
    },
    droneStop() {
      if (!drone) return;
      const d = drone;
      drone = null;
      clearTimeout(d.tick);
      try {
        const c = ac();
        d.out.gain.cancelScheduledValues(c.currentTime);
        d.out.gain.setValueAtTime(d.out.gain.value, c.currentTime);
        d.out.gain.linearRampToValueAtTime(0, c.currentTime + 0.3);
        setTimeout(() => { d.nodes.forEach((x) => { try { x.stop(); } catch (e) { /* stopped */ } }); try { d.out.disconnect(); } catch (e) { /* gone */ } }, 400);
      } catch (e) { /* no audio */ }
    },
    test() {
      const line = `${S.settings.callsign} online. Readout check.`;
      const per = 26;
      this.readout(line, per);
      setTimeout(() => this.transmit(), line.length * per + 400);
    }
  };
})();

function spokenWhen(iso, hasTime) {
  if (!iso) return '';
  const d = new Date(iso);
  const day = U.spokenDay(d);
  return hasTime ? `${day} at ${U.fmtTimeShort(d, clock24())}` : day;
}

function taskFields(t) {
  const cat = categoryById(t.category);
  const proj = projectById(t.projectId);
  const f = [['TITLE', t.title]];
  if (t.due) f.push(['DUE', `${U.dayLabel(new Date(t.due))}${t.dueHasTime ? ` · ${U.fmtTimeShort(new Date(t.due), clock24())}` : ''}`]);
  f.push(['PRIORITY', `${(PRI[t.priority] || PRI.medium).label}${cat ? ` · ${cat.name.toUpperCase()}` : ''}`]);
  if (proj) f.push(['PROJECT', proj.name]);
  if (t.assignee) f.push(['ASSIGNED', t.assignee]);
  if (t.repeat && t.repeat.type !== 'none') f.push(['REPEAT', U.repeatLabel(t.repeat)]);
  if (t.reminder != null && t.due) f.push(['REMINDER', 'ON']);
  return f;
}

function taskSummary(t) {
  const bits = [t.title];
  if (t.due) bits.push(spokenWhen(t.due, t.dueHasTime));
  if (t.priority === 'high') bits.push('high priority');
  const cat = categoryById(t.category);
  if (cat) bits.push(cat.name);
  if (t.assignee) bits.push(`assigned to ${t.assignee}`);
  return bits.join(', ');
}

function mergeDue(oldIso, oldHasTime, newIso, newHasTime) {
  if (newHasTime || !oldIso || !oldHasTime) return { due: newIso, dueHasTime: newHasTime };
  const o = new Date(oldIso);
  const n = new Date(newIso);
  n.setHours(o.getHours(), o.getMinutes(), 0, 0);
  return { due: n.toISOString(), dueHasTime: true };
}

function briefing() {
  const now = new Date();
  const out = [`Good ${U.partOfDay(now)}, ${operator()}.`];
  const w = S.weather;
  if (w && w.current) out.push(`${Math.round(w.current.temperature_2m)}° and ${wxWords(w.current.weather_code)}, high of ${Math.round(w.daily.temperature_2m_max[0])}.`);
  const today = eventsOnDay(now).filter((e) => e.allDay || e.end > now);
  if (today.length) { const f = today.find((e) => !e.allDay) || today[0]; out.push(`${today.length} event${today.length > 1 ? 's' : ''} today. Next: ${f.title}${f.allDay ? '' : ` at ${U.fmtTimeShort(f.start, clock24())}`}.`); }
  else out.push('No more events today.');
  const list = active();
  const overdue = list.filter((t) => isOverdue(t, now)).length;
  const dueToday = list.filter((t) => t.due && U.sameDay(new Date(t.due), now) && !isOverdue(t, now)).length;
  out.push(list.length ? `${list.length} active task${list.length > 1 ? 's' : ''}${dueToday ? `, ${dueToday} due today` : ''}${overdue ? `, ${overdue} overdue` : ''}.` : 'Task queue clear.');
  const pj = liveProjects();
  if (pj.length) out.push(`${pj.length} project${pj.length > 1 ? 's' : ''} in progress.`);
  return out.join(' ');
}

async function transmit(label, fields, firstLine, undo) {
  await say(`${firstLine}${quip()}`);
  sfx.transmit();
  await say(pick('transmit'), 'dim');
  const ack = S.sync ? await S.sync.acknowledged(4500) : 'timeout';
  if (ack === 'ok') {
    await card({ head: label, tone: 'ok', fields, undo });
    await say(pick('ack'), 'ok');
  } else {
    await card({ head: 'STORED LOCALLY', tone: 'wait', fields, undo });
    await say(pick('offline'), 'dim');
  }
  ctRefreshChrome();
}

function projectReport(p) {
  const st = projectStats(p);
  const due = projectDue(p);
  const f = [['PROJECT', p.name], ['PROGRESS', `${st.done}/${st.total} TASKS · ${st.pct}%`]];
  if (st.next) f.push(['NEXT', st.next.title]);
  if (due) f.push(['FINISH BY', projectDueLabel(p)]);
  return { st, fields: f, line: `${p.name}: ${st.pct}% complete, ${st.done} of ${st.total} task${st.total === 1 ? '' : 's'} done.${st.next ? ` Next: ${st.next.title}.` : ''}${due ? ` Due ${U.spokenDay(due)}.` : ''}` };
}

const HELP = [
  'call sam thursday at 3, high priority, work',
  'add buy string lights to the holiday party project',
  'new project garage cleanout',
  "how's the garage cleanout project",
  'take a note: gate code is 1357',
  'move electric bill to friday',
  'delete book flights',
  'schedule dentist friday at 2',
  'set a timer for 10 minutes · wake me at 7',
  'status report · clear (or the CLEAR button) wipes this screen'
];

async function runCommand(text) {
  const lower = text.toLowerCase().trim().replace(/[.!]+$/, '');
  const now = new Date();
  const fail = (msg) => say(msg, 'err');

  // Typed y / n answer a waiting delete.
  if (C.pending && /^(y|yes|yep|yeah|confirm|ok|do it)$/.test(lower)) text = 'yes';
  else if (C.pending && /^(n|no|nope|keep( it)?|cancel)$/.test(lower)) text = 'no';
  if (/^(clear|cls|clear screen)$/.test(lower)) { clearComms(); await say('Screen cleared.', 'sys'); return; }
  if (/^(help|\?|commands|what can you do)$/.test(lower)) {
    await say('Command examples follow.', 'sys');
    for (const h of HELP) await say(h, 'dim');
    return;
  }
  if (/^(exit|close|quit|bye)$/.test(lower)) { closeComms(); return; }

  const ctx = { categories: categories(), people: people(), projects: liveProjects(), defaultReminder: shared().defaultReminder ?? 15 };
  let r;
  try { r = fb.parseCommand(text, ctx, now); } catch (e) { r = { intent: 'empty' }; }

  // Edits that match no existing task may really be new tasks ("make dinner reservations, high priority").
  if (r.intent === 'edit-task' && r.fallback && !findTask(r.query)) {
    try { r = fb.parseCommand(text, { ...ctx, noEdit: true }, now); } catch (e) { /* keep */ }
  }
  // A new question cancels a delete that was waiting.
  if (C.pending && r.intent !== 'confirm' && r.intent !== 'deny') resolvePending('kept');

  switch (r.intent) {
    case 'add-task': {
      const { projectName, ...rest } = r.task;
      const t = { ...blankTask(), ...rest };
      let started = null;
      if (!t.projectId && projectName) { started = newProject(projectName); t.projectId = started.id; }
      const proj = projectById(t.projectId);
      upsertTask(t);
      const tail = started ? ` New project started: ${started.name}.` : proj ? ` Filed under ${proj.name}.` : '';
      return transmit('TASK LOGGED', taskFields(t), `${pick('copy')} ${taskSummary(t)}.${tail}`, () => { deleteTask(t.id); if (started) deleteProject(started.id); });
    }
    case 'add-project': {
      const name = String(r.name || '').trim().replace(/^(?:the|a|an)\s+/i, '').replace(/\s+project$/i, '');
      if (!name) return fail('Name the project. Try: new project garage cleanout.');
      const existing = findProject(name);
      if (existing && existing.name.toLowerCase() === name.toLowerCase()) return say(`${existing.name} already exists. File tasks with "…to the ${existing.name.toLowerCase()} project."`, 'sys');
      const p = newProject(name.charAt(0).toUpperCase() + name.slice(1));
      await transmit('PROJECT STARTED', [['PROJECT', p.name], ['COLOR', 'ASSIGNED']], `${pick('copy')} New project: ${p.name}.`, () => deleteProject(p.id));
      return say(`File tasks with "…to the ${p.name.toLowerCase()} project."`, 'dim');
    }
    case 'project-status': {
      const p = findProject(r.query);
      if (!p) return fail(r.query ? `No active project matches ${r.query}.` : 'Which project? Try: how\'s the garage cleanout project.');
      const rep = projectReport(p);
      await say(rep.line);
      return card({ head: 'PROJECT STATUS', tone: 'info', fields: rep.fields });
    }
    case 'list-projects': {
      const list = liveProjects();
      if (!list.length) return say('No active projects. Try: new project garage cleanout.', 'sys');
      await say(`${list.length} active project${list.length > 1 ? 's' : ''}.`);
      return card({ head: 'PROJECTS', tone: 'info', fields: list.slice(0, 8).map((p) => { const st = projectStats(p); return [`${st.pct}%`, `${p.name}${p.due ? ` · ${projectDueLabel(p)}` : ''}`]; }) });
    }
    case 'add-note': {
      if (!r.note) return fail('Ready. Type "take a note:", then what it should say.');
      const n = saveNote({ id: makeId('n_'), title: r.note.title, body: r.note.body, pinned: false, src: 'comms' }, true);
      return transmit('NOTE FILED', [['NOTE', n.title]], `${pick('copy')} Noted: ${n.title}.`, () => deleteNote(n.id));
    }
    case 'add-event': {
      const e = r.event;
      if (e.missing) return fail(`I need a day or time for ${e.title}.`);
      const ev = { id: makeId('e_'), title: e.title, start: e.start, end: e.end, allDay: e.allDay, notes: '' };
      S.events.push(ev);
      persist('events');
      return transmit('EVENT SCHEDULED', [['EVENT', ev.title], ['WHEN', ev.allDay ? `${U.dayLabel(new Date(ev.start))} · ALL DAY` : `${U.dayLabel(new Date(ev.start))} · ${U.fmtTimeShort(new Date(ev.start), clock24())}`]],
        `${pick('copy')} ${ev.title}, ${U.spokenDay(new Date(ev.start))}${ev.allDay ? '' : ` at ${U.fmtTimeShort(new Date(ev.start), clock24())}`}.`,
        () => { S.events = S.events.filter((x) => x.id !== ev.id); persist('events'); });
    }
    case 'complete-task': {
      const t = findTask(r.query);
      if (!t) return fail(`No active task matches ${r.query}.`);
      completeTask(t.id);
      return transmit('MARKED COMPLETE', [['TASK', t.title]], `Marked complete: ${t.title}.`, () => uncomplete(t.id));
    }
    case 'edit-task': {
      const t = findTask(r.query);
      const ev = t ? null : S.events.find((e) => e.title.toLowerCase().includes(String(r.query).toLowerCase()));
      if (!t && !ev) return fail(`No task matches ${r.query}.`);
      if (r.action === 'delete') {
        const item = t || ev;
        const cat = t ? categoryById(t.category) : null;
        const meta = t
          ? [cat ? cat.name.toUpperCase() : '', t.due ? dueLabel(t) : 'NO DATE', t.subtasks && t.subtasks.length ? `${t.subtasks.length} SUBTASK${t.subtasks.length > 1 ? 'S' : ''}` : ''].filter(Boolean).join(' · ')
          : `EVENT · ${U.dayLabel(new Date(ev.start))}`;
        await say(pick('deleteAsk', { title: item.title }), 'warn');
        const ent = await card({ head: 'CONFIRM DELETE', tone: 'warn', fields: [['ITEM', item.title], ['DETAILS', meta]], confirm: true });
        C.pending = { kind: t ? 'task' : 'event', id: item.id, title: item.title, entry: ent.id, expires: Date.now() + 5 * 60000 };
        ctUpdate(ent);
        ctRefreshChrome();
        return;
      }
      if (ev) {
        if (r.action !== 'reschedule') return fail(`${ev.title} is an event. I can move or delete it.`);
        const before = { ...ev };
        const dur = new Date(ev.end) - new Date(ev.start);
        const md = mergeDue(ev.start, !ev.allDay, r.due, r.dueHasTime);
        ev.start = md.due;
        ev.allDay = !md.dueHasTime;
        ev.end = new Date(new Date(md.due).getTime() + (ev.allDay ? 864e5 : dur)).toISOString();
        persist('events');
        return transmit('EVENT MOVED', [['EVENT', ev.title], ['NOW', spokenWhen(ev.start, !ev.allDay)]], `Moving ${ev.title} to ${spokenWhen(ev.start, !ev.allDay)}.`, () => { Object.assign(ev, before); persist('events'); });
      }
      const before = JSON.parse(JSON.stringify(t));
      const task = { ...t };
      let line = '';
      let fields = taskFields(task);
      if (r.action === 'priority') { task.priority = r.priority; line = `${t.title} set to ${r.priority} priority.`; }
      else if (r.action === 'category') { task.category = r.category; const c = categoryById(r.category); line = `${t.title} filed under ${c ? c.name : 'that category'}.`; }
      else if (r.action === 'assign') { task.assignee = r.assignee; line = r.assignee ? `${t.title} assigned to ${r.assignee}.` : `${t.title} unassigned.`; }
      else if (r.action === 'reschedule') { Object.assign(task, mergeDue(t.due, t.dueHasTime, r.due, r.dueHasTime)); task.snoozeUntil = null; line = `Rescheduling ${t.title} to ${spokenWhen(task.due, task.dueHasTime)}.`; }
      upsertTask(task);
      fields = taskFields(task);
      if (r.action === 'reschedule') fields = [['TASK', task.title], ['NOW DUE', dueLabel(task)]];
      return transmit('UPDATED', fields, line, () => upsertTask(before));
    }
    case 'confirm': {
      const p = C.pending;
      if (!p || p.expires < Date.now()) { resolvePending('kept'); return fail('Nothing waiting for confirmation.'); }
      resolvePending('confirmed');
      if (p.kind === 'task') deleteTask(p.id); else { S.events = S.events.filter((x) => x.id !== p.id); persist('events'); }
      sfx.transmit();
      await say(pick('deleted'), 'ok');
      return;
    }
    case 'deny': {
      const p = C.pending;
      resolvePending('kept');
      return say(p ? `Understood. Keeping ${p.title}.` : 'Standing by.', 'sys');
    }
    case 'set-timer': {
      if (!r.seconds) return fail('How long? Try: set a timer for 10 minutes.');
      const t = addTimer({ kind: 'timer', seconds: r.seconds, label: r.label });
      return transmit('TIMER SET', [['TIMER', fmtCountdown(r.seconds * 1000)], ...(t.label ? [['LABEL', t.label]] : []), ['ALERT', 'THIS PHONE']], `${pick('copy')} ${spokenDuration(r.seconds).replace(/(\d+) (hour|minute|second)s\b/g, '$1 $2')} timer set${t.label ? ` for ${t.label}` : ''}. ${pick('timer')}`, () => { S.timers = S.timers.filter((x) => x.id !== t.id); persist('timers'); });
    }
    case 'set-alarm': {
      if (!r.at) return fail('What time? Try: wake me at 7.');
      const t = addTimer({ kind: 'alarm', at: r.at, label: r.label, wake: r.wake });
      return transmit('ALARM SET', [['ALARM', `${U.dayLabel(new Date(t.endsAt))} · ${U.fmtTimeShort(new Date(t.endsAt), clock24())}`]], `Alarm set for ${spokenWhen(t.endsAt, true)}.`, () => { S.timers = S.timers.filter((x) => x.id !== t.id); persist('timers'); });
    }
    case 'cancel-timer': {
      const gone = cancelTimers(r);
      if (!gone.length) return fail(`No active ${r.kind}s.`);
      return transmit('CANCELLED', [['CANCELLED', `${gone.length} ${r.kind}${gone.length > 1 ? 's' : ''}`]], `${gone.length > 1 ? `${gone.length} ${r.kind}s` : r.kind === 'alarm' ? 'Alarm' : 'Timer'} cancelled.`);
    }
    case 'timer-query': {
      if (!S.timers.length) return say('No timers or alarms running.');
      return card({ head: 'TIMERS', tone: 'info', fields: S.timers.slice(0, 5).map((t) => [t.kind === 'alarm' ? 'ALARM' : (t.label || 'TIMER').toUpperCase(), t.kind === 'alarm' ? U.fmtTimeShort(new Date(t.endsAt), clock24()) : `${fmtCountdown(new Date(t.endsAt) - now)} LEFT`]) });
    }
    case 'snooze': {
      const target = S.alert || S.lastAlert;
      const min = Math.round((r.seconds || (shared().snoozeMinutes || 10) * 60) / 60);
      if (!target) return fail('Nothing to snooze right now.');
      doSnooze(target, min);
      return transmit('SNOOZED', [['FOR', `${min} MIN`]], `Snoozed for ${min} minutes.`);
    }
    case 'briefing': {
      sfx.transmit();
      await say(pick('briefing'), 'dim');
      await say(briefing());
      return say(commandOnline() ? 'Command is online.' : 'Command is offline. Working from local data.', commandOnline() ? 'ok' : 'warn');
    }
    case 'weather': {
      const w = S.weather;
      return say(w && w.current ? `${Math.round(w.current.temperature_2m)}° and ${wxWords(w.current.weather_code)}. High of ${Math.round(w.daily.temperature_2m_max[0])}, low of ${Math.round(w.daily.temperature_2m_min[0])}.` : 'No atmospheric data right now.');
    }
    case 'next-event': {
      const n = allEvents().find((e) => e.start > now);
      return say(n ? `Next up: ${n.title}, ${U.spokenDay(n.start)}${n.allDay ? '' : ` at ${U.fmtTimeShort(n.start, clock24())}`}.${n.location ? ` ${n.location}.` : ''}` : 'Nothing on the calendar soon.');
    }
    case 'list-tasks': {
      const list = sortTasks(active(), now);
      if (!list.length) return say('Your queue is clear.');
      await say(`${list.length} active. Top of the queue:`);
      return card({ head: 'QUEUE', tone: 'info', fields: list.slice(0, 5).map((t) => [t.due ? dueLabel(t, now).replace(/ · .*/, '') : 'NO DATE', t.title]) });
    }
    case 'time': return say(`It's ${U.fmtTimeShort(now, clock24())}.`);
    case 'date': return say(`Today is ${U.DAY_FULL[now.getDay()]}, ${U.MONTHS[now.getMonth()]} ${U.ordinal(now.getDate())}.`);
    case 'thanks': return say(`Anytime, ${operator()}.`);
    case 'cancel': return say('Standing by.', 'sys');
    case 'set-humor': S.settings.humor = r.value; saveSettings(); return say(`Humor setting ${r.value} percent.`);
    case 'humor-query': return say(`Humor setting is at ${S.settings.humor} percent.`);
    default: return fail(pick('miss'));
  }
}

function clearComms() {
  C.log = [];
  C.undo.clear();
  C.pending = null;
  saveComms();
  const log = $('#ctLog');
  if (log) log.innerHTML = '<div class="ct-cursor-line" id="ctCursor"><span class="p">&gt; </span><i class="ct-cursor"></i></div>';
  ctRefreshChrome();
}

function resolvePending(state) {
  const p = C.pending;
  C.pending = null;
  if (p) {
    const ent = C.log.find((x) => x.id === p.entry);
    if (ent) { ent.state = state; ctUpdate(ent); }
  }
  ctRefreshChrome();
}

// ---------------------------------------------------------------- alerts (when Command is offline)
function showAlert(a) {
  S.alert = { ...a, at: Date.now() };
  S.lastAlert = S.alert;
  const el = $('#alert');
  el.className = `alert ${a.type === 'alarm' ? 'alarm' : ''}`;
  el.innerHTML = `<div class="t">${esc(a.title)}</div><div class="s">${esc(a.sub || '')}</div>
    <div class="b"><button type="button" data-al="snooze">SNOOZE ${shared().snoozeMinutes || 10} MIN</button>${a.type === 'reminder' ? '<button type="button" data-al="done">DONE</button>' : ''}<button type="button" class="ghost" data-al="dismiss">DISMISS</button></div>`;
  el.hidden = false;
}
function hideAlert() { $('#alert').hidden = true; S.alert = null; }
function doSnooze(target, minutes) {
  hideAlert();
  S.lastAlert = null;
  if (target.type === 'reminder') snoozeTask(target.ref.id, minutes);
  else addTimer({ kind: 'timer', seconds: minutes * 60, label: target.ref.label || 'Snoozed' });
}

function reminderTime(t) {
  const due = new Date(t.due);
  if (t.dueHasTime) return new Date(due.getTime() - (t.reminder || 0) * 60000);
  const at = new Date(due);
  at.setHours(9, 0, 0, 0);
  if ((t.reminder || 0) >= 1440) at.setDate(at.getDate() - Math.floor(t.reminder / 1440));
  return at;
}

const rung = new Set();
function ringTimer(t, now = new Date()) {
  if (rung.has(t.id)) return;
  rung.add(t.id);
  const label = t.label ? `: ${t.label}` : '';
  showAlert({ type: t.kind, title: t.kind === 'alarm' ? `ALARM${label.toUpperCase()}` : `TIMER COMPLETE${label.toUpperCase()}`, sub: U.fmtTimeShort(now, clock24()), ref: t });
  chirp.alert();
}

// Command removes a phone timer the moment it relays it. If this screen is open
// at that moment, ring here too so the in-app alert isn't lost.
function timersRemoved(before, after) {
  if (document.hidden) return;
  const now = Date.now();
  const keep = new Set(after.map((t) => t.id));
  before.filter((t) => !keep.has(t.id) && t.origin === 'phone' && Math.abs(new Date(t.endsAt) - now) < 5000).forEach((t) => ringTimer(t));
}

function checkTimers() {
  if (document.hidden) return;
  const now = new Date();
  // While Command is online it rings its own timers; this phone rings the ones set here.
  const mine = (t) => !commandOnline() || t.origin === 'phone';
  const due = S.timers.filter((t) => new Date(t.endsAt) <= now && mine(t));
  if (!due.length) return;
  const ids = new Set(due.map((t) => t.id));
  S.timers = S.timers.filter((t) => !ids.has(t.id));
  persist('timers');
  due.filter((t) => now - new Date(t.endsAt) < 6 * 3600000).forEach((t) => ringTimer(t, now));
}

function checkLocalAlerts() {
  if (document.hidden) return;
  const now = new Date();
  checkTimers();
  // Task reminders: Command sends these as notifications when it's online and alerts are on.
  if (commandOnline() && S.settings.alertsOn) return;
  let changed = false;
  for (const t of active()) {
    const snoozed = t.snoozeUntil && now >= new Date(t.snoozeUntil);
    const fresh = t.reminder != null && t.due && t.remindedFor !== t.due && now >= reminderTime(t) && now - reminderTime(t) < 6 * 3600000;
    if (!snoozed && !fresh) continue;
    if (snoozed) t.snoozeUntil = null;
    if (fresh) t.remindedFor = t.due;
    changed = true;
    showAlert({ type: 'reminder', title: `REMINDER · ${t.title.toUpperCase()}`, sub: `Due ${dueLabel(t, now)}`, ref: { id: t.id } });
    chirp.alert();
    break;
  }
  if (changed) persist('tasks');
}

// ---------------------------------------------------------------- pairing screen
function showPairing() {
  const code = S.pairCodeFromLink;
  const viaLinkInBrowser = code && !STANDALONE;
  $('#overlay').innerHTML = `<div class="pair" role="dialog" aria-label="Pair with Command">
    <div class="eyebrow">${esc(S.settings.callsign.toUpperCase())} · ${VERSION}</div>
    <div class="big">${viaLinkInBrowser ? 'Almost there' : 'Pair with Command'}</div>
    ${viaLinkInBrowser ? `
      <p>Install ${esc(S.settings.callsign)} first so it can run full screen and receive alerts:</p>
      <ol class="steps">
        <li>Tap <b>Share</b> (the square with an arrow), then <b>Add to Home Screen</b>.</li>
        <li>Open <b>${esc(S.settings.callsign)}</b> from the Home Screen.</li>
        <li>Enter this code (it expires in 10 minutes):<div class="code-show">${esc(formatPairCode(code))}</div></li>
      </ol>
      <button type="button" class="btn line block" id="pairHere" style="margin-top:22px">OR PAIR IN THIS BROWSER</button>`
    : `
      <p>On the computer, open <b>Command Deck › Settings › Field Unit › Show pairing code</b>, then enter the code here.</p>
      <input class="in code-in" id="pairCode" inputmode="text" autocapitalize="characters" autocomplete="one-time-code" maxlength="7" placeholder="ABC-123" value="${code ? esc(formatPairCode(code)) : ''}" aria-label="Pairing code">
      <button type="button" class="btn primary block" id="pairGo" style="margin-top:12px">ESTABLISH UPLINK</button>
      <div class="hint" id="pairMsg"></div>
      ${!STANDALONE ? `<div class="hint" style="margin-top:18px">Tip: for alerts, use <b>Share › Add to Home Screen</b> and pair from there.</div>` : ''}`}
  </div>`;
  const here = $('#pairHere');
  if (here) here.addEventListener('click', () => { S.pairCodeFromLink = code; showPairingForm(code); });
  wirePairForm();
}

function showPairingForm(code) {
  S.pairCodeFromLink = null;
  showPairing();
  const i = $('#pairCode');
  if (i && code) i.value = formatPairCode(code);
}

function wirePairForm() {
  const go = $('#pairGo');
  if (!go) return;
  const input = $('#pairCode');
  input.addEventListener('input', () => {
    const n = normalizePairCode(input.value);
    input.value = n.length > 3 ? `${n.slice(0, 3)}-${n.slice(3)}` : n;
  });
  const submit = async () => {
    go.disabled = true;
    $('#pairMsg').textContent = 'Establishing uplink…';
    try {
      await pairWith(input.value);
      $('#overlay').innerHTML = '';
      history.replaceState(null, '', location.pathname);
      chirp.ack();
      toast(`Uplink established. ${S.settings.callsign} paired with Command.`, 3500);
      S.view = 'today';
      render();
    } catch (e) {
      $('#pairMsg').innerHTML = `<span class="err-t">${esc(e.message)}</span>`;
      go.disabled = false;
    }
  };
  go.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
}

// ---------------------------------------------------------------- swipe to reveal actions
function wireSwipe() {
  let startX = 0;
  let startY = 0;
  let row = null;
  let dx = 0;
  let decided = null;
  const view = $('#view');
  const closeOthers = (except) => $$('.trow.open', view).forEach((r) => { if (r !== except) { r.classList.remove('open'); $('.tmain', r).style.transform = ''; } });
  view.addEventListener('touchstart', (e) => {
    const r = e.target.closest('.trow');
    if (!r || !$('.acts', r)) { row = null; return; }
    row = r;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    dx = 0;
    decided = null;
    $('.tmain', row).style.transition = 'none';
  }, { passive: true });
  view.addEventListener('touchmove', (e) => {
    if (!row) return;
    const x = e.touches[0].clientX - startX;
    const y = e.touches[0].clientY - startY;
    if (!decided) decided = Math.abs(x) > Math.abs(y) + 4 ? 'h' : Math.abs(y) > 8 ? 'v' : null;
    if (decided !== 'h') return;
    row.classList.add('swiping');
    const base = row.classList.contains('open') ? -228 : 0;
    dx = Math.min(0, Math.max(-240, base + x));
    $('.tmain', row).style.transform = `translateX(${dx}px)`;
  }, { passive: true });
  view.addEventListener('touchend', () => {
    if (!row) return;
    const main = $('.tmain', row);
    main.style.transition = '';
    if (decided === 'h') {
      const open = dx < -80;
      row.classList.toggle('open', open);
      main.style.transform = open ? 'translateX(-228px)' : '';
      if (open) closeOthers(row);
    }
    const r = row;
    setTimeout(() => r.classList.remove('swiping'), 220);
    row = null;
  });
}

// ---------------------------------------------------------------- events
function wire() {
  $$('.tab[data-view]').forEach((t) => t.addEventListener('click', () => { S.view = t.dataset.view; $('#view').scrollTop = 0; render(); }));
  $('#hailBtn').addEventListener('click', () => {
    if (!S.deckId) { showPairing(); return; }
    openComms();
  });
  $('#alert').addEventListener('click', (e) => {
    const b = e.target.closest('[data-al]');
    if (!b || !S.alert) return;
    if (b.dataset.al === 'snooze') doSnooze(S.alert, shared().snoozeMinutes || 10);
    else if (b.dataset.al === 'done') { const id = S.alert.ref.id; hideAlert(); completeTask(id); }
    else hideAlert();
  });

  const view = $('#view');
  view.addEventListener('click', (e) => {
    const t = e.target;
    const row = t.closest('.trow');
    const act = t.closest('[data-act]');
    if (row && act) {
      const id = row.dataset.id;
      const task = S.tasks.find((x) => x.id === id);
      const a = act.dataset.act;
      if (a === 'toggle') { if (task && task.done) uncomplete(id); else completeTask(id); }
      else if (a === 'edit') { if (row.classList.contains('open')) { row.classList.remove('open'); $('.tmain', row).style.transform = ''; } else if (task) openTaskEditor(task); }
      else if (a === 'done') completeTask(id);
      else if (a === 'snooze') snoozeTask(id, shared().snoozeMinutes || 10);
      else if (a === 'delete') { deleteTask(id); toast('Task deleted'); }
      return;
    }
    if (t.closest('[data-new-task]')) return openTaskEditor(null);
    if (t.closest('[data-new-project]')) return openProjectEditor(null);
    if (t.closest('[data-new-sched]')) return openScheduleEditor(null);
    if (t.closest('[data-sched-share]')) return openScheduleShare();
    const scn = t.closest('[data-sc]');
    if (scn) {
      const a = scn.dataset.sc;
      S.schedWeek = a === 'prev' ? addDays(S.schedWeek, -7) : a === 'next' ? addDays(S.schedWeek, 7) : weekStart(new Date());
      render();
      return;
    }
    const scr = t.closest('[data-sched]');
    if (scr) { const it = S.schedule.find((x) => x.id === scr.dataset.sched); if (it) openScheduleEditor(it); return; }
    const tv = t.closest('[data-tkview]');
    if (tv) { S.tkView = tv.dataset.tkview; render(); return; }
    const pc = t.closest('[data-project]');
    if (pc) { const pr = projectById(pc.dataset.project); if (pr) openProject(pr); return; }
    if (t.closest('[data-new-note]')) return openNoteEditor(null);
    if (t.closest('[data-scan]')) { ac(); startFieldScan(); return; }
    const go = t.closest('[data-go]');
    if (go) { S.view = go.dataset.go; $('#view').scrollTop = 0; render(); return; }
    const nr = t.closest('[data-note]');
    if (nr) { const n = S.notes.find((x) => x.id === nr.dataset.note); if (n) openNoteEditor(n); return; }
    if (t.closest('[data-note-search]')) { S.noteSearch = S.noteSearch == null ? '' : null; render(); if (S.noteSearch != null) setTimeout(() => { const i = $('#noteSearch'); if (i) i.focus(); }, 30); return; }
    if (t.closest('[data-new-event]')) return openEventEditor(null, S.calSel);
    if (t.closest('[data-dismiss-install]')) { S.settings.installDismissed = true; saveSettings(); render(); return; }
    const ct = t.closest('[data-cancel-timer]');
    if (ct) { S.timers = S.timers.filter((x) => x.id !== ct.dataset.cancelTimer); persist('timers'); return; }
    const f = t.closest('[data-filter]');
    if (f) { S.filter = f.dataset.filter; render(); return; }
    const mo = t.closest('[data-month]');
    if (mo) { S.calMonth = new Date(S.calMonth.getFullYear(), S.calMonth.getMonth() + Number(mo.dataset.month), 1); render(); return; }
    const day = t.closest('[data-day]');
    if (day && S.view === 'calendar') { const [y, m, d] = day.dataset.day.split('-').map(Number); S.calSel = new Date(y, m - 1, d); if (S.calSel.getMonth() !== S.calMonth.getMonth()) S.calMonth = new Date(y, m - 1, 1); render(); return; }
    const evr = t.closest('[data-ev]');
    if (evr) { const ev = S.events.find((x) => x.id === evr.dataset.ev); if (ev) openEventEditor(ev); return; }
    const tr = t.closest('[data-task]');
    if (tr) { const task = S.tasks.find((x) => x.id === tr.dataset.task); if (task) openTaskEditor(task); return; }
    const th = t.closest('[data-theme-pick]');
    if (th) { S.settings.theme = th.dataset.themePick; saveSettings(); render(); return; }
    const fp = t.closest('[data-font-pick]');
    if (fp) { S.settings.font = fp.dataset.fontPick; saveSettings(); render(); return; }
    const ik = t.closest('[data-ink-pick]');
    if (ik) { S.settings.ink = ik.dataset.inkPick; saveSettings(); render(); return; }
    const fr = t.closest('[data-frame-pick]');
    if (fr) { S.settings.frame = fr.dataset.framePick; saveSettings(); render(); return; }
    const tr2 = t.closest('[data-trim-pick]');
    if (tr2) { S.settings.trim = tr2.dataset.trimPick; saveSettings(); render(); return; }
    const snd = t.closest('[data-sound-pick]');
    if (snd) { S.settings.commsSound = snd.dataset.soundPick; saveSettings(); render(); ac(); sfx.test(); return; }
    if (t.closest('#sTest')) { ac(); sfx.test(); return; }
    if (t.closest('#sPhrases')) return openPhrases();
    if (t.closest('#sAlerts')) { enableAlerts().catch((err) => toast(err.message || 'Could not enable alerts', 4000)); return; }
    const up = t.closest('#sUnpair');
    if (up) { if (up.dataset.armed !== '1') { up.dataset.armed = '1'; up.textContent = 'TAP AGAIN TO UNPAIR'; return; } unpairSelf(); }
  });
  view.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'sCallsign') { S.settings.callsign = t.value.trim() || 'Field Unit'; saveSettings(); }
  });
  $('#scanInput').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f && FIELD_SCAN) runFieldScan(f);
  });
  view.addEventListener('input', (e) => {
    if (e.target.id === 'noteSearch') {
      S.noteSearch = e.target.value;
      const pos = e.target.selectionStart;
      render();
      const i = $('#noteSearch');
      if (i) { i.focus(); i.setSelectionRange(pos, pos); }
      return;
    }
    if (e.target.id === 'sHumor') { S.settings.humor = Number(e.target.value); $('#sHumorVal').textContent = `${S.settings.humor}%`; saveSettings(); }
  });
  wireSwipe();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { sfx.droneStop(); if (C.open) C.skip = true; }
    else { render(); checkLocalAlerts(); if (C.open) sfx.droneStart(); }
  });
}

// ---------------------------------------------------------------- start
async function start() {
  applyTheme();
  const boot = bootScreen();
  const params = new URLSearchParams(location.search);
  const code = params.get('pair');
  if (code) S.pairCodeFromLink = normalizePairCode(code);
  wire();
  render();

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  try {
    await connect();
    if (S.deckId) {
      // The radar locks once the first real data lands (or after a few seconds, whichever comes first).
      const landed = new Promise((r) => { S.firstSync = r; setTimeout(r, 4000); });
      startSync();
      await landed;
      boot.lock(`Welcome back, ${operator()}.`);
    } else boot.skip();
  } catch (e) {
    boot.skip();
    if (!S.deckId) {
      showPairing();
      const msg = $('#pairMsg');
      if (msg) msg.innerHTML = `<span class="err-t">${esc(e.message || 'No signal')}</span>`;
      return;
    }
    toast('No signal. Working from local data.', 3500);
  }
  if (!S.deckId) showPairing();
  fetchWeather();

  // Signal came back after starting offline: connect and resume sync.
  window.addEventListener('online', async () => {
    if (S.sync || !S.deckId) return;
    try { await connect(); startSync(); toast('Signal restored. Uplink resumed.'); } catch (e) { /* try again next time */ }
  });

  setInterval(() => {
    if (S.timers.length) checkTimers();
    const live = S.view === 'today' && S.timers.length;
    if (live && !document.hidden && !$('.sheet') && !C.open) {
      $$('.tmr').forEach((el) => {
        const t = S.timers.find((x) => x.id === el.dataset.timer);
        if (t && t.kind === 'timer') $('.v', el).textContent = fmtCountdown(new Date(t.endsAt) - Date.now());
      });
    }
  }, 1000);
  setInterval(checkLocalAlerts, 15000);
  setInterval(fetchWeather, 20 * 60000);
  setInterval(() => { if (!document.hidden && !$('.sheet') && !C.open && S.view !== 'settings') render(); }, 60000);
}

start();
