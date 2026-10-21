// Command Deck ⇄ Field Unit uplink (desktop side).
// Links this console to a Firebase project, mirrors tasks/events/timers,
// relays calendar + shared settings for the phone, pairs phones with a short
// code / QR, and sends alerts to paired phones as web push notifications.
import * as fb from '../shared/core.js';
import { DeckSync, makePairCode, formatPairCode, normalizePairCode, makeId, fetchHostingConfig, startFirebase, signIn } from '../shared/sync.js';
import { ManifestRelay, manifestUrl } from '../shared/manifest.js';
import { RosterRelay, scheduleUrl, DEFAULT_TYPES } from '../shared/roster.js';

const deck = window.deck;
const PAIR_MINUTES = 10;

const F = {
  hooks: null,
  status: 'off', // off | connecting | online | offline | error
  error: '',
  fire: null, // { app, db, auth }
  uid: null,
  sync: null,
  members: [],
  pushSubs: [],
  pairing: null, // { code, expires }
  listeners: new Set(),
  heartbeat: null,
  unsubs: [],
  relay: null,
  roster: null, // schedule links
  adopted: null // joined consoles: settings that follow the main console
};

// Settings a joined console takes from the main console (each computer keeps its own look).
const FOLLOW = ['operatorName', 'categories', 'people', 'location', 'tempUnit', 'clock24', 'defaultReminder', 'snoozeMinutes', 'localCalendarName', 'localCalendarColor', 'scheduleTypes'];

function role() {
  const fu = (F.hooks && F.hooks.getSettings().fieldUnit) || {};
  return fu.role === 'joined' ? 'joined' : 'main';
}
export function isJoined() { return role() === 'joined'; }

let emitQueued = false;
function emit() {
  // Batched and run on a snapshot: a listener that re-renders (and re-subscribes)
  // must never be called again by the same update.
  if (emitQueued) return;
  emitQueued = true;
  setTimeout(() => {
    emitQueued = false;
    const s = state();
    [...F.listeners].forEach((fn) => { try { fn(s); } catch (e) { console.error(e); } });
  }, 0);
}

function setStatus(s, err = '') {
  F.status = s;
  F.error = err;
  emit();
}

export function state() {
  const settings = F.hooks ? F.hooks.getSettings() : {};
  const fu = settings.fieldUnit || {};
  return {
    linked: !!(fu.deckId && fu.config),
    url: fu.url || '',
    deckId: fu.deckId || null,
    status: F.status,
    error: F.error,
    role: role(),
    devices: F.members.filter((m) => m.id !== F.uid).map((m) => ({ ...m, console: m.kind === 'desktop', alerts: F.pushSubs.some((p) => p.id === m.id) })),
    phones: F.members.filter((m) => m.id !== F.uid && m.kind !== 'desktop').length,
    consoles: F.members.filter((m) => m.id !== F.uid && m.kind === 'desktop').length,
    pairing: F.pairing && F.pairing.expires > Date.now() ? F.pairing : null,
    pushReady: F.pushSubs.length,
    sharing: !!F.relay
  };
}

export function onChange(fn) {
  F.listeners.add(fn);
  return () => F.listeners.delete(fn);
}

function deckRef() {
  return fb.doc(F.fire.db, 'decks', F.hooks.getSettings().fieldUnit.deckId);
}

function friendlyError(e) {
  const msg = (e && (e.code || e.message)) || String(e);
  if (/permission/i.test(msg)) {
    return role() === 'joined'
      ? 'This console no longer has access to the shared deck. It may have been removed on the main console. Leave the deck here, then join again with a new code.'
      : 'Firebase refused access. Check the setup guide (Firestore rules deployed? Anonymous sign-in enabled?)';
  }
  if (/admin-restricted|operation-not-allowed/i.test(msg)) return 'Anonymous sign-in is turned off in Firebase › Authentication.';
  if (/network|fetch/i.test(msg)) return 'Could not reach Firebase. Check the internet connection.';
  return msg;
}

// ---------------------------------------------------------------- lifecycle
export async function init(hooks) {
  F.hooks = hooks;
  window.addEventListener('online', () => {
    if (F.status === 'offline') setStatus('online');
    else if (F.status === 'error' && !F.sync) retryNow();
  });
  window.addEventListener('offline', () => { if (F.status === 'online') setStatus('offline'); });
  await retryNow();
}

// Keeps trying (every minute) when the uplink couldn't start, e.g. Wi-Fi not up yet at boot.
let retryTimer = null;
async function retryNow() {
  clearTimeout(retryTimer);
  const fu = F.hooks.getSettings().fieldUnit || {};
  if (!fu.deckId || !fu.config || F.sync) return;
  try {
    await connect(fu.config);
  } catch (e) {
    setStatus('error', friendlyError(e));
    retryTimer = setTimeout(retryNow, 60000);
  }
}

async function connect(config) {
  setStatus('connecting');
  if (!F.fire) F.fire = startFirebase(fb, config, 'command-deck');
  const user = await signIn(fb, F.fire.auth);
  F.uid = user.uid;
  const settings = F.hooks.getSettings();
  let deckId = settings.fieldUnit.deckId;

  if (!deckId) {
    deckId = makeId('deck_');
    const { publicKey } = await deck.pushKeys();
    await fb.setDoc(fb.doc(F.fire.db, 'decks', deckId), {
      owner: F.uid, createdAt: Date.now(), vapidPublicKey: publicKey, pairCode: null, pairExpires: fb.Timestamp.fromMillis(0)
    });
    await fb.setDoc(fb.doc(F.fire.db, 'decks', deckId, 'members', F.uid), {
      kind: 'desktop', name: settings.consoleName || 'Command Deck', joinedAt: Date.now(), code: null
    });
    await F.hooks.saveFieldUnit({ ...settings.fieldUnit, deckId });
  } else if (role() === 'joined') {
    // A joined console only needs to still be a member; the main console owns the deck.
    try {
      await fb.getDoc(fb.doc(F.fire.db, 'decks', deckId));
    } catch (e) {
      if (/permission/i.test(e.code || e.message || '')) throw e;
    }
  } else {
    // Make sure the phone can find the push key (older links, rotated keys).
    try {
      const { publicKey } = await deck.pushKeys();
      await fb.updateDoc(fb.doc(F.fire.db, 'decks', deckId), { vapidPublicKey: publicKey });
    } catch (e) {
      if (/permission/i.test(e.code || e.message || '')) throw new Error('This console no longer owns its Field Unit link. Unlink and link again, then re-pair phones.');
    }
  }

  startSync(deckId);
  setStatus(navigator.onLine ? 'online' : 'offline');
}

function startSync(deckId) {
  stopSync();
  F.sync = new DeckSync(fb, F.fire.db, deckId, F.uid);
  const h = F.hooks;
  const onErr = (e) => setStatus('error', friendlyError(e));
  F.sync.track('tasks', () => h.getList('tasks'), (list) => h.applyRemote('tasks', list), onErr);
  F.sync.track('events', () => h.getList('events'), (list) => h.applyRemote('events', list), onErr);
  F.sync.track('timers', () => h.getList('timers'), (list) => h.applyRemote('timers', list), onErr);
  F.sync.track('notes', () => h.getList('notes'), (list) => h.applyRemote('notes', list), onErr);
  F.sync.track('projects', () => h.getList('projects'), (list) => h.applyRemote('projects', list), onErr);
  F.sync.track('schedule', () => h.getList('schedule'), (list) => h.applyRemote('schedule', list), onErr);

  F.unsubs.push(fb.onSnapshot(fb.collection(F.fire.db, 'decks', deckId, 'members'), (snap) => {
    const before = new Set(F.members.map((m) => m.id));
    F.members = [];
    snap.forEach((d) => F.members.push({ id: d.id, ...d.data() }));
    if (role() === 'joined' && snap.metadata && !snap.metadata.fromCache && !F.members.some((m) => m.id === F.uid)) {
      setStatus('error', 'This console was removed from the shared deck on the main console. Leave the deck here, then join again with a new code.');
    }
    const joined = F.members.filter((m) => m.id !== F.uid && !before.has(m.id) && before.size);
    if (joined.length && F.pairing) {
      F.pairing = null;
      clearPairCode().catch(() => {});
      h.onPaired(joined[0]);
    }
    emit();
  }, (e) => { if (role() === 'joined' && /permission/i.test((e && (e.code || e.message)) || '')) setStatus('error', friendlyError(e)); }));

  F.unsubs.push(fb.onSnapshot(fb.collection(F.fire.db, 'decks', deckId, 'push'), (snap) => {
    F.pushSubs = [];
    snap.forEach((d) => { const v = d.data(); if (v && v.sub) F.pushSubs.push({ id: d.id, sub: v.sub }); });
    emit();
  }, () => {}));

  // Project Manifest: copies shared projects out to their guest links, and guest changes back in.
  F.relay = new ManifestRelay(fb, F.fire.db, deckId, F.uid, {
    getProjects: () => h.getList('projects'),
    getTasks: () => h.getList('tasks'),
    guestChanges: (changes) => h.guestChanges(changes),
    addLog: (projectId, entries) => h.addLog(projectId, entries),
    onActivity: (events) => h.onActivity(events),
    getLook: () => h.getLook(),
    operatorName: () => h.getSettings().operatorName || ''
  });
  F.relay.onChange(emit);
  F.relay.start();

  // Schedule links: copies the schedule out to each link, and GOT IT / CHANGE REQUEST replies back in.
  F.roster = new RosterRelay(fb, F.fire.db, deckId, F.uid, {
    getEntries: () => h.getList('schedule'),
    getTypes: () => h.getSettings().scheduleTypes || DEFAULT_TYPES,
    applyReplies: (changes) => h.applyReplies(changes),
    onActivity: (events) => h.onScheduleActivity(events),
    getLook: () => h.getLook(),
    operatorName: () => h.getSettings().operatorName || ''
  });
  F.roster.onChange(emit);
  F.roster.start();

  if (role() === 'joined') {
    // Follow the main console's shared settings and calendar feeds. Phones keep
    // treating the main console as "Command", so they still ring alerts themselves
    // whenever it's off, and only the main console sends phone notifications.
    const follow = { shared: null, setup: null };
    const adopt = () => {
      const next = {};
      if (follow.shared) FOLLOW.forEach((k) => { if (follow.shared[k] !== undefined && follow.shared[k] !== null) next[k] = follow.shared[k]; });
      if (follow.setup && Array.isArray(follow.setup.calendars)) next.calendars = follow.setup.calendars;
      F.adopted = Object.keys(next).length ? next : null;
      if (F.adopted && h.adoptShared) h.adoptShared(F.adopted);
    };
    F.sync.watchMeta('shared', (d) => { follow.shared = d; adopt(); });
    F.sync.watchMeta('setup', (d) => { follow.setup = d; adopt(); });
    return;
  }
  relayShared(h.getSettings());
  beat();
  clearInterval(F.heartbeat);
  F.heartbeat = setInterval(beat, 60000);
  setTimeout(() => ['tasks', 'events', 'timers', 'notes', 'projects', 'schedule'].forEach((k) => F.sync && F.sync.prune(k).catch(() => {})), 30000);
}

/** Joined consoles: lays the main console's shared settings over a settings object. */
export function overlay(settings) {
  if (role() !== 'joined' || !F.adopted) return settings;
  return { ...settings, ...F.adopted };
}

function stopSync() {
  if (F.relay) F.relay.stop();
  F.relay = null;
  if (F.roster) F.roster.stop();
  F.roster = null;
  if (F.sync) F.sync.stop();
  F.sync = null;
  F.unsubs.forEach((u) => u());
  F.unsubs = [];
  clearInterval(F.heartbeat);
}

function beat() {
  if (!F.sync) return;
  const s = F.hooks.getSettings();
  F.sync.setMeta('command', { lastSeen: Date.now(), consoleName: s.consoleName || 'Command Deck', version: F.hooks.version }).catch(() => {});
}

// ---------------------------------------------------------------- public actions
export async function link(url) {
  const clean = String(url || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\/[^/]+$/.test(clean)) throw new Error('Paste the full address, like https://your-project.web.app');
  setStatus('connecting');
  try {
    const config = await fetchHostingConfig(clean);
    await F.hooks.saveFieldUnit({ url: clean, config, deckId: null, role: 'main' });
    await connect(config);
  } catch (e) {
    setStatus('error', friendlyError(e));
    throw new Error(friendlyError(e));
  }
}

// Joins the deck of another Command Deck with a pairing code shown on that console.
export async function join(url, codeText) {
  const clean = String(url || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\/[^/]+$/.test(clean)) throw new Error('Paste the full address, like https://your-project.web.app');
  const code = normalizePairCode(codeText);
  if (code.length !== 6) throw new Error('Enter the 6-character code from the main console (Settings › Field Unit › SHOW PAIRING CODE).');
  setStatus('connecting');
  try {
    const config = await fetchHostingConfig(clean);
    // The app lets Firebase calls through only for the saved Field Unit address, so save it first.
    await F.hooks.saveFieldUnit({ url: clean, config, deckId: null, role: 'main' });
    if (!F.fire) F.fire = startFirebase(fb, config, 'command-deck');
    const user = await signIn(fb, F.fire.auth);
    F.uid = user.uid;
    let snap;
    try {
      snap = await fb.getDoc(fb.doc(F.fire.db, 'pairCodes', code));
    } catch (e) {
      throw new Error('That code has expired or is not valid. Show a new one on the main console.');
    }
    if (!snap.exists()) throw new Error('Code not recognized. Check it, or show a new one on the main console.');
    const deckId = snap.data().deckId;
    const settings = F.hooks.getSettings();
    let name = settings.consoleName && settings.consoleName !== 'Command Deck' ? settings.consoleName : '';
    if (!name) { try { name = await deck.hostname(); } catch (e) { /* older preload */ } }
    try {
      await fb.setDoc(fb.doc(F.fire.db, 'decks', deckId, 'members', F.uid), {
        kind: 'desktop', role: 'joined', name: name ? `Command Deck · ${name}` : 'Command Deck · second console', joinedAt: Date.now(), code
      });
    } catch (e) {
      throw new Error('The main console refused the code (it may have just expired). Show a new one and try again.');
    }
    await F.hooks.saveFieldUnit({ url: clean, config, deckId, role: 'joined' });
    startSync(deckId);
    setStatus(navigator.onLine ? 'online' : 'offline');
  } catch (e) {
    await F.hooks.saveFieldUnit({ url: '', config: null, deckId: null, role: 'main' }).catch(() => {});
    setStatus('error', e.message && !/permission/i.test(e.code || '') ? e.message : friendlyError(e));
    throw new Error(F.error);
  }
}

export async function unlink() {
  clearTimeout(retryTimer);
  // A joined console takes itself off the shared deck (the deck itself belongs to the main console).
  if (role() === 'joined' && F.fire && F.uid) {
    const deckId = F.hooks.getSettings().fieldUnit.deckId;
    if (deckId) await fb.deleteDoc(fb.doc(F.fire.db, 'decks', deckId, 'members', F.uid)).catch(() => {});
  }
  F.adopted = null;
  stopSync();
  F.members = [];
  F.pushSubs = [];
  F.pairing = null;
  await F.hooks.saveFieldUnit({ url: '', config: null, deckId: null, role: 'main' });
  setStatus('off');
}

export async function startPairing() {
  if (role() === 'joined') throw new Error('Pair phones and consoles from the main console.');
  if (!F.sync) throw new Error(F.status === 'error' ? 'The uplink is down. Check the internet connection and try again in a minute.' : 'Still connecting. Try again in a moment.');
  const settings = F.hooks.getSettings();
  const code = makePairCode();
  const expires = Date.now() + PAIR_MINUTES * 60000;
  await clearPairCode();
  await fb.setDoc(fb.doc(F.fire.db, 'pairCodes', code), { deckId: settings.fieldUnit.deckId, owner: F.uid, expires: fb.Timestamp.fromMillis(expires) });
  await fb.updateDoc(deckRef(), { pairCode: code, pairExpires: fb.Timestamp.fromMillis(expires) });
  F.pairing = { code, expires, pretty: formatPairCode(code) };
  const pairUrl = `${settings.fieldUnit.url}/?pair=${code}`;
  F.pairing.url = pairUrl;
  F.pairing.qr = await deck.qr(pairUrl);
  emit();
  return F.pairing;
}

async function clearPairCode() {
  if (!F.sync) return;
  try {
    const snap = await fb.getDoc(deckRef());
    const old = snap.exists() ? snap.data().pairCode : null;
    if (old) await fb.deleteDoc(fb.doc(F.fire.db, 'pairCodes', old)).catch(() => {});
    await fb.updateDoc(deckRef(), { pairCode: null, pairExpires: fb.Timestamp.fromMillis(0) });
  } catch (e) { /* best effort */ }
}

export async function cancelPairing() {
  F.pairing = null;
  emit();
  await clearPairCode();
}

export async function unpair(uid) {
  const deckId = F.hooks.getSettings().fieldUnit.deckId;
  await fb.deleteDoc(fb.doc(F.fire.db, 'decks', deckId, 'push', uid)).catch(() => {});
  await fb.deleteDoc(fb.doc(F.fire.db, 'decks', deckId, 'members', uid));
}

// ---------------------------------------------------------------- relays
export function push(kind) {
  if (F.sync) F.sync.push(kind);
  if (F.relay && (kind === 'tasks' || kind === 'projects')) F.relay.schedule();
  if (F.roster && kind === 'schedule') F.roster.schedule();
}

// ---------------------------------------------------------------- schedule links
function needRoster() {
  if (!F.roster) throw new Error(F.hooks.getSettings().fieldUnit && F.hooks.getSettings().fieldUnit.deckId ? 'The uplink is reconnecting. Try again in a moment.' : 'Sharing uses the Field Unit link. Set it up in Settings › Field Unit first.');
}
export function nudgeSchedule() { if (F.roster) F.roster.schedule(); }
export function scheduleShares() { return F.roster ? F.roster.list() : []; }
export function scheduleGuest(token) { return F.roster ? F.roster.guestOf(token) : null; }
export function scheduleShareUrl(token) { return scheduleUrl(F.hooks.getSettings().fieldUnit.url, token); }
export async function shareSchedule(opts) {
  needRoster();
  const token = await F.roster.share(opts);
  emit();
  const url = scheduleShareUrl(token);
  return { token, url, qr: await deck.qr(url) };
}
export async function scheduleQr(token) { return deck.qr(scheduleShareUrl(token)); }
export async function revokeSchedule(token) { needRoster(); await F.roster.revoke(token); emit(); }

// ---------------------------------------------------------------- project manifest (share links)
function needRelay() {
  if (!F.relay) throw new Error(F.hooks.getSettings().fieldUnit && F.hooks.getSettings().fieldUnit.deckId ? 'The uplink is reconnecting. Try again in a moment.' : 'Sharing uses the Field Unit link. Set it up in Settings › Field Unit first.');
}
export function nudgeShares() { if (F.relay) F.relay.schedule(); }
export function shares(projectId) { return F.relay ? F.relay.forProject(projectId) : []; }
export function shareUrl(token) { return manifestUrl(F.hooks.getSettings().fieldUnit.url, token); }
export async function shareQr(token) { return deck.qr(shareUrl(token)); }
export async function shareProject(opts) {
  needRelay();
  const token = await F.relay.share(opts);
  emit();
  return { token, url: shareUrl(token), qr: await shareQr(token) };
}
export async function setShareLevel(token, level) { needRelay(); await F.relay.setLevel(token, level); }
export async function revokeShare(token) { needRelay(); await F.relay.revoke(token); emit(); }

export function relayShared(s) {
  if (!F.sync || !s || role() === 'joined') return;
  // Joined consoles copy these, calendar feeds included (phones never see the feed links).
  F.sync.setMeta('setup', { calendars: (s.calendars || []).map((c) => ({ ...c })), updatedAt: Date.now() }).catch(() => {});
  F.sync.setMeta('shared', {
    operatorName: s.operatorName, consoleName: s.consoleName,
    categories: s.categories, people: s.people, location: s.location, scheduleTypes: s.scheduleTypes || DEFAULT_TYPES,
    tempUnit: s.tempUnit, clock24: s.clock24, defaultReminder: s.defaultReminder, snoozeMinutes: s.snoozeMinutes,
    localCalendarName: s.localCalendarName, localCalendarColor: s.localCalendarColor,
    calendars: (s.calendars || []).filter((c) => c.enabled !== false).map((c) => ({ id: c.id, name: c.name, color: c.color })),
    updatedAt: Date.now()
  }).catch(() => {});
}

let lastCalJson = '';
export function relayCalendar(events) {
  if (!F.sync || role() === 'joined') return;
  const from = Date.now() - 864e5;
  const to = Date.now() + 62 * 864e5;
  const list = events
    .filter((e) => new Date(e.end) > from && new Date(e.start) < to)
    .slice(0, 400)
    .map((e) => ({ id: e.id, calId: e.calId, title: e.title, location: e.location || '', start: e.start, end: e.end, allDay: !!e.allDay }));
  const json = JSON.stringify(list);
  if (json === lastCalJson) return;
  lastCalJson = json;
  F.sync.setMeta('calendar', { events: list, updatedAt: Date.now() }).catch(() => {});
}

// Sends a notification to every paired phone that has alerts turned on.
export async function notifyPhones(payload) {
  // Only the main console holds the phones' notification key.
  if (!F.sync || !F.pushSubs.length || role() === 'joined') return;
  const settings = F.hooks.getSettings();
  try {
    const res = await deck.pushSend(F.pushSubs, payload, settings.fieldUnit.url);
    const deckId = settings.fieldUnit.deckId;
    (res.gone || []).forEach((id) => fb.deleteDoc(fb.doc(F.fire.db, 'decks', deckId, 'push', id)).catch(() => {}));
  } catch (e) { /* phones are best-effort */ }
}
