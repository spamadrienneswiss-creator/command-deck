// ============================================================
// SCHEDULE — the page someone opens from a schedule link
// https://…/s/<token>. No app or account: the long token in the link is the key.
// One shared schedule: everyone with a link sees the same entries, each labeled with who
// added it. A READ + ADD link can also add its own entries, and edit or delete them.
// The gear changes how the page looks on this phone only. Added to the Home Screen,
// it opens full screen like an app.
// ============================================================
import * as fb from './lib/core.js';
import { startFirebase, signIn } from './lib/sync.js';
import { weekStart, addDays, weekLabel, weekDays, ymd, typeOf, shortName, timeRange, chipName, parseTime } from './lib/roster.js';
import { bootScreen } from './boot.js';
import * as U from './lib/util.js';

const { $, esc } = U;
const THEME_FONT = { dusk: 'chakra', space: 'chakra', red: 'chakra', terminal: 'chakra', retro: 'sharetech', moonbase: 'michroma', blueprint: 'spacemono', cryo: 'exo2', freighter: 'b612', skydock: 'quantico', vector: 'tektur' };
const LIGHT = new Set(['moonbase', 'cryo', 'skydock']);
const STANDALONE = window.navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
// Their own look for this page, kept on this phone.
const LOOK_THEMES = [['dusk', 'DUSK', ['#F2A65A', '#A8B0D8']], ['moonbase', "MOONBASE '79", ['#F05A1A', '#E4E6E9']], ['blueprint', 'BLUEPRINT', ['#8EC5FF', '#0E2A47']], ['skydock', 'SKYDOCK', ['#1FB8F0', '#F2F4F7']], ['vector', 'VECTOR', ['#FF7A2F', '#62D9FF']]];
const LOOK_FONTS = [['auto', 'THEME DEFAULT', ''], ['michroma', 'MICHROMA', "'Michroma Scaled'"], ['spacemono', 'SPACE MONO', "'Space Mono'"], ['vt323', 'VT323', "'VT323 Scaled'"], ['orbitron', 'ORBITRON', "'Orbitron Scaled'"]];
const LOOK_FRAMES = [['dark', 'DARK', '#14151B'], ['bone', 'BONE', '#EEDDC3'], ['navy', 'MIDNIGHT NAVY', '#16264A']];
const PERSON_IC = '<svg width="8" height="9" viewBox="0 0 9 10" aria-hidden="true"><circle cx="4.5" cy="3" r="2.2" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M0.8 9.5 a3.7 3.7 0 0 1 7.4 0" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>';
const GEAR_IC = '<svg width="15" height="15" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="2.2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M7 1 V3 M7 11 V13 M1 7 H3 M11 7 H13 M2.8 2.8 L4.2 4.2 M9.8 9.8 L11.2 11.2 M2.8 11.2 L4.2 9.8 M9.8 4.2 L11.2 2.8" stroke="currentColor" stroke-width="1.3"/></svg>';

function tokenFromUrl() {
  const m = /^\/s\/([A-Za-z0-9]+)/.exec(location.pathname);
  const raw = m ? m[1] : (location.hash || '').replace(/^#/, '');
  return raw.replace(/[^A-Za-z0-9]/g, '');
}

const P = {
  token: tokenFromUrl(),
  fire: null,
  r: null, // the roster (link) doc
  entries: new Map(),
  week: weekStart(new Date()),
  sheet: null, // null | { kind: 'add' | 'edit' | 'look', id? }
  hidden: new Set(), // entries deleted here, waiting for the owner's app to confirm
  busy: new Set(),
  sentAt: 0,
  state: 'loading', // loading | invalid | ended | main | error
  error: ''
};
const boot = bootScreen();
const tipKey = () => `sg.tip.${P.token}`;
let tipDismissed = false;
try { tipDismissed = localStorage.getItem(tipKey()) === '1'; } catch (e) { /* private mode */ }

const lookKey = () => `sg.look.${P.token}`;
let myLook = null;
try { myLook = JSON.parse(localStorage.getItem(lookKey()) || 'null'); } catch (e) { myLook = null; }
function saveMyLook() { try { if (myLook) localStorage.setItem(lookKey(), JSON.stringify(myLook)); else localStorage.removeItem(lookKey()); } catch (e) { /* private mode */ } }

// A link opened as #token is moved to /s/token, so Add to Home Screen keeps the key.
if (P.token && !/^\/s\//.test(location.pathname)) {
  try { history.replaceState(null, '', `/s/${P.token}`); } catch (e) { /* older browsers */ }
}

function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('on'), ms);
}

function expiryMs(t) {
  if (!t) return 0;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t.seconds === 'number') return t.seconds * 1000;
  return typeof t === 'number' ? t : 0;
}
function live() {
  if (!P.r || P.r.closed) return false;
  const exp = expiryMs(P.r.expiresAt);
  return !exp || exp > Date.now();
}
function owner() { return (P.r && P.r.owner) || 'Your contact'; }
function guest() { return (P.r && P.r.guest) || 'Guest'; }

function canAdd() { return live() && P.r && P.r.level === 'add'; }
function myChip() { return { name: chipName(guest()), color: (P.r && P.r.color) || '#B5B0BC' }; }
function whoChip(name, color) { return `<span class="sc-chip sc-who" style="--tc:${esc(color || '#B5B0BC')}">${PERSON_IC}${esc(chipName(name))}</span>`; }

function applyLook() {
  const lk = { ...((P.r && P.r.look) || {}), ...(myLook || {}) };
  const theme = lk.theme || 'dusk';
  const b = document.body;
  b.dataset.theme = theme;
  b.dataset.font = !lk.font || lk.font === 'auto' ? (THEME_FONT[theme] || 'chakra') : lk.font;
  b.dataset.ink = myLook ? 'theme' : (lk.ink || 'theme');
  b.dataset.trim = myLook ? 'none' : (lk.trim || 'none');
  b.dataset.frame = (myLook && myLook.frame) || 'dark';
  if (LIGHT.has(theme)) b.dataset.light = '1'; else delete b.dataset.light;
}

function chip(typeId) {
  const t = typeOf((P.r && P.r.types) || [], typeId);
  return `<span class="sc-chip" style="--tc:${esc(t.color || '#B5B0BC')}">${esc(t.short || shortName(t.name))}</span>`;
}

// ---------------------------------------------------------------- rendering
// Live updates re-draw the page; a half-filled form survives that.
function render() {
  const form = document.querySelector('#sgForm');
  const keep = form ? [...form.querySelectorAll('input')].map((i) => [i.id, i.value]) : null;
  const focusId = document.activeElement && document.activeElement.id;
  draw();
  if (keep) keep.forEach(([id, v]) => { const i = document.getElementById(id); if (i) i.value = v; });
  if (focusId) { const f = document.getElementById(focusId); if (f && f.focus) f.focus(); }
}

function entryRow(e) {
  const mine = e.byToken && e.byToken === P.token;
  const clock24 = !!(P.r.look && P.r.look.clock24);
  const busy = P.busy.has(e.id);
  return `<div class="sg-row${mine ? ' mine' : ''}" data-entry="${esc(e.id)}">
    <div class="sc-top"><span class="sc-title">${esc(e.title)}</span><span class="sc-chips">${whoChip(e.byName || owner(), e.byColor)}${chip(e.type)}</span></div>
    ${timeRange(e.start, e.end, clock24) ? `<div class="sg-time">${esc(timeRange(e.start, e.end, clock24))}</div>` : ''}
    ${e.note ? `<div class="sg-note"><span style="color:${esc(e.byColor || 'var(--amber)')}">${esc(chipName(e.byName || owner()))}:</span> ${esc(e.note)}</div>` : ''}
    ${mine && canAdd() ? `<div class="sg-mine"><span>${e.pending ? 'SENDING…' : 'YOU ADDED THIS'}</span><button type="button" class="sg-btn" data-edit="${esc(e.id)}" ${busy ? 'disabled' : ''}>EDIT</button><button type="button" class="sg-btn del" data-del="${esc(e.id)}" ${busy ? 'disabled' : ''}>DELETE</button></div>` : ''}
  </div>`;
}

function formSheet() {
  const editing = P.sheet.kind === 'edit' ? P.entries.get(P.sheet.id) : null;
  const e = editing || { type: ((P.r.types || [])[0] || {}).id || 'other', title: '', date: ymd(new Date()), start: '', end: '', note: '' };
  if (!P.sheet.type) P.sheet.type = e.type;
  const types = (P.r.types || []).length ? P.r.types : [{ id: 'other', short: 'OTHER', color: '#B5B0BC' }];
  const min = ymd(addDays(weekStart(new Date()), -7));
  const max = ymd(addDays(new Date(), 120));
  return `<div class="sheet-back" data-sheet-back><div class="sheet" role="dialog" aria-modal="true" aria-label="${editing ? 'Edit your entry' : 'Add to the schedule'}">
    <div class="grabber"></div>
    <div class="sheet-head"><span class="label" style="color:var(--amber)">${editing ? 'EDIT YOUR ENTRY' : `ADD TO ${esc(owner().toUpperCase())}'S SCHEDULE`}</span><button type="button" class="icon-btn" data-close aria-label="Close">×</button></div>
    <form id="sgForm" autocomplete="off">
      <div class="f"><span class="label">TYPE</span><div class="pills">${types.map((t) => `<button type="button" class="chip${P.sheet.type === t.id ? ' on' : ''}" data-type="${esc(t.id)}" style="--pc:${esc(t.color)}">${esc(t.short || shortName(t.name))}</button>`).join('')}</div></div>
      <div class="f"><label class="label" for="sgTitle">TITLE</label><input class="in title" id="sgTitle" maxlength="120" value="${esc(e.title)}" placeholder="What's happening?"></div>
      <div class="sg-when">
        <div class="f"><label class="label" for="sgDate">DATE</label><input class="in" id="sgDate" type="date" min="${min}" max="${max}" value="${esc(e.date || '')}"></div>
        <div class="f"><label class="label" for="sgStart">START</label><input class="in" id="sgStart" type="time" value="${esc(e.start || '')}"></div>
        <div class="f"><label class="label" for="sgEnd">END</label><input class="in" id="sgEnd" type="time" value="${esc(e.end || '')}"></div>
      </div>
      <div class="f"><label class="label" for="sgNote">NOTE · OPTIONAL</label><input class="in" id="sgNote" maxlength="300" value="${esc(e.note || '')}" placeholder="Anything everyone should know"></div>
      <div class="hint sc-shows">Shows as ${whoChip(myChip().name, myChip().color)} on everyone's schedule.</div>
      <div class="sheet-foot"><button type="button" class="btn line" data-close>CANCEL</button><button type="submit" class="btn primary">${editing ? 'SAVE' : 'ADD IT'}</button></div>
    </form></div></div>`;
}

function lookSheet() {
  const cur = { theme: 'dusk', font: 'auto', frame: 'dark', ...((P.r && P.r.look) || {}), ...(myLook || {}) };
  const pill = (attr, v, label, on, extra = '') => `<button type="button" class="chip${on ? ' on' : ''}" ${attr}="${v}" ${extra}>${label}</button>`;
  return `<div class="sheet-back" data-sheet-back><div class="sheet" role="dialog" aria-modal="true" aria-label="How this page looks">
    <div class="grabber"></div>
    <div class="sheet-head"><span class="label">YOUR VIEW · ONLY ON THIS PHONE</span><button type="button" class="icon-btn" data-close aria-label="Close">×</button></div>
    <div class="f"><span class="label">THEME</span><div class="pills">${LOOK_THEMES.map(([v, l, cs]) => pill('data-look-theme', v, `<span class="theme-sw" aria-hidden="true">${cs.map((c) => `<i style="background:${c}"></i>`).join('')}</span>${l}${v === 'dusk' ? '' : ''}`, cur.theme === v)).join('')}</div></div>
    <div class="f"><span class="label">TYPEFACE</span><div class="pills">${LOOK_FONTS.map(([v, l, fam]) => pill('data-look-font', v, l, (cur.font || 'auto') === v, fam ? `style="font-family:${fam}"` : '')).join('')}</div></div>
    <div class="f"><span class="label">FRAME</span><div class="pills">${LOOK_FRAMES.map(([v, l, c]) => pill('data-look-frame', v, `<span class="ink-sw" aria-hidden="true" style="background:${c}"></span>${l}`, (cur.frame || 'dark') === v)).join('')}</div></div>
    <div class="hint">Changes only how this page looks for you. ${esc(owner())} and everyone else keep their own.</div>
    <div class="sheet-foot"><button type="button" class="btn line" data-look-reset>USE ${esc(owner().toUpperCase())}'S LOOK</button><button type="button" class="btn primary" data-close>DONE</button></div>
  </div></div>`;
}

function draw() {
  const root = $('#pm');
  applyLook();
  if (P.state === 'loading') return;
  if (P.state === 'invalid' || P.state === 'error') {
    root.innerHTML = `<div class="pm-center"><div class="eyebrow">SCHEDULE</div><div class="pm-big">${P.state === 'invalid' ? 'Link not found' : 'No signal'}</div>
      <p class="pm-p">${P.state === 'invalid' ? 'This link isn\'t valid, or sharing was stopped. Ask for a new one.' : esc(P.error || 'Couldn\'t reach the schedule. Check your connection and reload.')}</p></div>`;
    return;
  }
  if (P.state === 'ended') {
    root.innerHTML = `<div class="pm-center"><div class="eyebrow">SCHEDULE</div><div class="pm-big">${esc(owner())}'s schedule</div>
      <p class="pm-p">This link has ended. Ask ${esc(owner())} for a new one if you still need it.</p></div>`;
    return;
  }
  const now = new Date();
  const shown = [...P.entries.values()].filter((e) => !e.deleted && !P.hidden.has(e.id));
  const days = weekDays(shown, P.week, now);
  const thisWeek = ymd(P.week) === ymd(weekStart(now));
  const sync = !navigator.onLine ? 'OFFLINE · CHANGES SEND WHEN SIGNAL RETURNS'
    : Date.now() - P.sentAt < 8000 ? 'SENT · EVERYONE SEES IT SHORTLY' : 'LIVE · SHARED SCHEDULE';
  const tip = !STANDALONE && !tipDismissed ? `<div class="sg-tip" role="note"><div><b>Keep this one tap away.</b> Tap <b>Share › Add to Home Screen</b>. It opens full screen, like an app.</div><button type="button" class="sg-x" data-tip-x aria-label="Dismiss">×</button></div>` : '';
  let list = '';
  if (!days.length) list = `<div class="sg-empty">Nothing scheduled ${thisWeek ? 'this week' : 'that week'}.${canAdd() ? ' Tap <b>+ ADD TO SCHEDULE</b> to add something.' : ''}</div>`;
  for (const d of days) {
    list += `<div class="group-h${d.label.startsWith('TODAY') ? ' today' : ''}"><span>${esc(d.label)}</span><span>${d.items.length}</span></div>`;
    for (const e of d.items) list += entryRow(e);
  }
  const me = myChip();
  root.innerHTML = `
    <header class="pm-head">
      <div><div class="eyebrow">SCHEDULE</div><div class="pm-sync${navigator.onLine ? '' : ' off'}"><i></i>${sync}</div></div>
      <span class="sg-head-r"><span class="pm-name sg-me" aria-label="You are" style="--tc:${esc(me.color)}">${esc(guest().toUpperCase())}</span><button type="button" class="sg-gear${myLook ? ' on' : ''}" data-look aria-label="How this page looks">${GEAR_IC}</button></span>
    </header>
    <main class="pm-scroll pm-main">
      <h1 class="pm-title" style="margin:0">${esc(owner())}'s schedule</h1>
      ${tip}
      <div class="sc-week"><button type="button" class="sc-nav" data-week="-1" aria-label="Previous week">‹</button><span>${esc(weekLabel(P.week, now))}</span><button type="button" class="sc-nav" data-week="1" aria-label="Next week">›</button></div>
      ${thisWeek ? '' : '<button type="button" class="sg-today" data-week="0">BACK TO THIS WEEK</button>'}
      <div class="pm-access">${canAdd() ? 'EVERYONE ON THIS LINK SEES THE SAME SCHEDULE. ADD YOURS WITH +.' : 'SHARED SCHEDULE · READ ONLY'}</div>
      ${list}
    </main>
    ${canAdd() ? '<button type="button" class="sg-add" data-add>+ ADD TO SCHEDULE</button>' : ''}
    ${P.sheet && (P.sheet.kind === 'add' || P.sheet.kind === 'edit') && canAdd() ? formSheet() : ''}
    ${P.sheet && P.sheet.kind === 'look' ? lookSheet() : ''}`;
}

function newId() {
  const a = new Uint8Array(12);
  (window.crypto || {}).getRandomValues ? window.crypto.getRandomValues(a) : a.forEach((_, i) => { a[i] = Math.floor(Math.random() * 256); });
  return `g${Array.from(a, (b) => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[b % 62]).join('')}`;
}

async function saveEntry() {
  if (!canAdd()) return;
  const editing = P.sheet.kind === 'edit' ? P.entries.get(P.sheet.id) : null;
  const title = ($('#sgTitle').value || '').trim().slice(0, 120);
  const date = $('#sgDate').value || '';
  if (!title) { $('#sgTitle').focus(); toast('Give it a title'); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { $('#sgDate').focus(); toast('Pick a date'); return; }
  const id = editing ? editing.id : newId();
  const me = myChip();
  const at = Date.now();
  const doc = {
    id, type: P.sheet.type || 'other', title, date,
    start: parseTime($('#sgStart').value), end: parseTime($('#sgEnd').value),
    note: ($('#sgNote').value || '').trim().slice(0, 300),
    byToken: P.token, byName: me.name, byColor: me.color,
    pending: true, gBy: guest().slice(0, 40), gAt: at
  };
  P.entries.set(id, doc);
  P.busy.add(id);
  P.sheet = null;
  const d = new Date(`${date}T12:00:00`);
  if (!Number.isNaN(d.getTime())) P.week = weekStart(d);
  render();
  try {
    await fb.setDoc(fb.doc(P.fire.db, 'rosters', P.token, 'entries', id), doc);
    P.sentAt = Date.now();
    toast(editing ? 'Saved. Everyone sees the change.' : `Added: ${title}`);
  } catch (err) {
    toast(navigator.onLine ? 'Couldn\'t save that. Try again.' : 'Saved. It sends when you have signal.');
  }
  P.busy.delete(id);
  render();
  setTimeout(render, 8200);
}

async function deleteEntry(id) {
  const e = P.entries.get(id);
  if (!e || !canAdd()) return;
  P.hidden.add(id);
  render();
  try {
    await fb.updateDoc(fb.doc(P.fire.db, 'rosters', P.token, 'entries', id), { deleted: true, pending: true, gBy: guest().slice(0, 40), gAt: Date.now() });
    P.sentAt = Date.now();
    toast(`Removed: ${e.title}`);
  } catch (err) {
    P.hidden.delete(id);
    toast(navigator.onLine ? 'Couldn\'t remove it. Try again.' : 'It is removed when you have signal.');
  }
  render();
}

document.addEventListener('click', (ev) => {
  const t = ev.target;
  if (t.matches('[data-sheet-back]') || t.closest('[data-close]')) { P.sheet = null; render(); return; }
  const wk = t.closest('[data-week]');
  if (wk) {
    const n = Number(wk.dataset.week);
    P.week = n === 0 ? weekStart(new Date()) : addDays(P.week, 7 * n);
    render();
    return;
  }
  if (t.closest('[data-tip-x]')) { tipDismissed = true; try { localStorage.setItem(tipKey(), '1'); } catch (e) { /* ok */ } render(); return; }
  if (t.closest('[data-add]')) { P.sheet = { kind: 'add' }; render(); setTimeout(() => { const i = $('#sgTitle'); if (i) i.focus(); }, 60); return; }
  const ed = t.closest('[data-edit]');
  if (ed) { const e = P.entries.get(ed.dataset.edit); if (e) { P.sheet = { kind: 'edit', id: e.id, type: e.type }; render(); } return; }
  const del = t.closest('[data-del]');
  if (del) {
    if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = 'CONFIRM'; setTimeout(() => { if (del.isConnected) { del.dataset.armed = ''; del.textContent = 'DELETE'; } }, 4000); return; }
    deleteEntry(del.dataset.del);
    return;
  }
  const ty = t.closest('[data-type]');
  if (ty && P.sheet) { P.sheet.type = ty.dataset.type; render(); return; }
  if (t.closest('[data-look]')) { P.sheet = { kind: 'look' }; render(); return; }
  const lt = t.closest('[data-look-theme]');
  if (lt) { myLook = { theme: 'dusk', font: 'auto', frame: 'dark', ...(myLook || {}), theme: lt.dataset.lookTheme }; saveMyLook(); render(); return; }
  const lf = t.closest('[data-look-font]');
  if (lf) { myLook = { theme: ((P.r && P.r.look) || {}).theme || 'dusk', frame: 'dark', ...(myLook || {}), font: lf.dataset.lookFont }; saveMyLook(); render(); return; }
  const lr = t.closest('[data-look-frame]');
  if (lr) { myLook = { theme: ((P.r && P.r.look) || {}).theme || 'dusk', font: 'auto', ...(myLook || {}), frame: lr.dataset.lookFrame }; saveMyLook(); render(); return; }
  if (t.closest('[data-look-reset]')) { myLook = null; saveMyLook(); P.sheet = null; render(); toast(`Back to ${owner()}'s look`); }
});
document.addEventListener('submit', (ev) => {
  if (!ev.target.closest('#sgForm')) return;
  ev.preventDefault();
  saveEntry();
});
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && P.sheet) { P.sheet = null; render(); } });

window.addEventListener('online', render);
window.addEventListener('offline', render);
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

// ---------------------------------------------------------------- start
async function start() {
  if (P.token.length < 20) { P.state = 'invalid'; boot.skip(); render(); return; }
  let cfg;
  try {
    const res = await fetch('/__/firebase/init.json', { cache: 'no-store' });
    cfg = await res.json();
  } catch (e) { P.state = 'error'; P.error = 'Couldn\'t reach the schedule. Check your connection and reload.'; boot.skip(); render(); return; }
  try {
    P.fire = startFirebase(fb, cfg, 'schedule');
    await signIn(fb, P.fire.auth);
  } catch (e) { P.state = 'error'; P.error = 'Couldn\'t connect. Check your connection and reload.'; boot.skip(); render(); return; }
  boot.progress(12);

  let first = true;
  fb.onSnapshot(fb.doc(P.fire.db, 'rosters', P.token), (snap) => {
    if (!snap.exists()) { P.state = 'invalid'; boot.skip(); render(); return; }
    P.r = snap.data();
    if (!live()) { P.state = 'ended'; boot.skip(); render(); return; }
    if (first) {
      first = false;
      boot.line(0, `SIGNAL · ${owner().toUpperCase()}'S DECK`, 'OK');
      let landed = false;
      P.state = 'main';
      const title = `${owner()}'s Schedule`;
      document.title = title;
      const meta = document.getElementById('appTitle');
      if (meta) meta.setAttribute('content', title);
      fb.onSnapshot(fb.collection(P.fire.db, 'rosters', P.token, 'entries'), (s) => {
        const next = new Map();
        s.forEach((d) => next.set(d.id, { id: d.id, ...d.data() }));
        // Keep an entry that's still on its way, so it doesn't blink out.
        for (const id of P.busy) if (!next.has(id) && P.entries.has(id)) next.set(id, P.entries.get(id));
        for (const id of [...P.hidden]) if (!next.has(id)) P.hidden.delete(id);
        P.entries = next;
        render();
        if (!landed) {
          landed = true;
          boot.line(1, `SCHEDULE · ${weekLabel(P.week).split(' · ').pop()}`, 'OK');
          boot.line(2, `ACCESS · ${guest().toUpperCase()}${P.r && P.r.level === 'add' ? ' · READ + ADD' : ''}`, 'GRANTED');
          boot.lock(`Hi, ${guest()}.`);
        }
      }, () => { boot.skip(); });
    } else if (P.state === 'ended') P.state = 'main';
    render();
  }, (err) => {
    P.state = /permission/i.test(err.code || err.message || '') ? (P.r ? 'ended' : 'invalid') : 'error';
    boot.skip();
    render();
  });
}

start();
