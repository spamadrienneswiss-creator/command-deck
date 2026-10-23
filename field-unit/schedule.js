// ============================================================
// SCHEDULE — the page someone opens from a schedule link
// https://…/s/<token>. No app or account: the long token in the link is the key.
// They see one week at a time and reply to each entry: GOT IT, or CHANGE REQUEST
// (a note is optional). Added to the Home Screen, it opens full screen like an app.
// ============================================================
import * as fb from './lib/core.js';
import { startFirebase, signIn } from './lib/sync.js';
import { weekStart, addDays, weekLabel, weekDays, ymd, typeOf, shortName, timeRange } from './lib/roster.js';
import { bootScreen } from './boot.js';
import * as U from './lib/util.js';

const { $, esc } = U;
const THEME_FONT = { dusk: 'chakra', space: 'chakra', red: 'chakra', terminal: 'chakra', retro: 'sharetech', moonbase: 'michroma', blueprint: 'spacemono', cryo: 'exo2', freighter: 'b612', skydock: 'quantico', vector: 'tektur' };
const STANDALONE = window.navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);

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
  asking: null, // entry id with the change-request box open
  busy: new Set(),
  sentAt: 0,
  state: 'loading', // loading | invalid | ended | main | error
  error: ''
};
const boot = bootScreen();
const tipKey = () => `sg.tip.${P.token}`;
let tipDismissed = false;
try { tipDismissed = localStorage.getItem(tipKey()) === '1'; } catch (e) { /* private mode */ }

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

function applyLook() {
  const lk = (P.r && P.r.look) || {};
  const theme = lk.theme || 'dusk';
  const b = document.body;
  b.dataset.theme = theme;
  b.dataset.font = !lk.font || lk.font === 'auto' ? (THEME_FONT[theme] || 'chakra') : lk.font;
  b.dataset.ink = lk.ink || 'theme';
  b.dataset.trim = lk.trim || 'none';
  if (theme === 'moonbase' || theme === 'cryo' || theme === 'skydock') b.dataset.light = '1'; else delete b.dataset.light;
}

function when(ms) {
  if (!ms) return '';
  if (Date.now() - ms < 60000) return 'JUST NOW';
  const d = new Date(ms);
  return U.sameDay(d, new Date()) ? `TODAY ${U.fmtTimeShort(d)}` : `${U.dayLabel(d)} ${U.fmtTimeShort(d)}`;
}

function chip(typeId) {
  const t = typeOf((P.r && P.r.types) || [], typeId);
  return `<span class="sc-chip" style="--tc:${esc(t.color || '#B5B0BC')}">${esc(t.short || shortName(t.name))}</span>`;
}

// ---------------------------------------------------------------- rendering
// Live updates re-draw the page; a half-typed comment survives that.
function render() {
  const box = document.querySelector('#sgComment');
  const keep = box ? { v: box.value, focus: box === document.activeElement, sel: box.selectionStart } : null;
  draw();
  const nb = document.querySelector('#sgComment');
  if (nb && keep) { nb.value = keep.v; if (keep.focus) { nb.focus(); try { nb.setSelectionRange(keep.sel, keep.sel); } catch (e) { /* ok */ } } }
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
  const days = weekDays([...P.entries.values()], P.week, now);
  const thisWeek = ymd(P.week) === ymd(weekStart(now));
  const sync = !navigator.onLine ? 'OFFLINE · REPLIES SEND WHEN SIGNAL RETURNS'
    : Date.now() - P.sentAt < 8000 ? `SENT TO ${esc(owner().toUpperCase())} · JUST NOW` : 'LIVE · SYNCED WITH COMMAND DECK';
  const tip = !STANDALONE && !tipDismissed ? `<div class="sg-tip" role="note"><div><b>Keep this one tap away.</b> Tap <b>Share › Add to Home Screen</b>. It opens full screen, like an app.</div><button type="button" class="sg-x" data-tip-x aria-label="Dismiss">×</button></div>` : '';
  let list = '';
  if (!days.length) list = `<div class="sg-empty">Nothing scheduled ${thisWeek ? 'this week' : 'that week'}.</div>`;
  for (const d of days) {
    list += `<div class="group-h${d.label.startsWith('TODAY') ? ' today' : ''}"><span>${esc(d.label)}</span><span>${d.items.length}</span></div>`;
    for (const e of d.items) {
      const r = e.reply;
      const busy = P.busy.has(e.id);
      list += `<div class="sg-row" data-entry="${esc(e.id)}">
        <div class="sc-top"><span class="sc-title">${esc(e.title)}</span>${chip(e.type)}</div>
        ${timeRange(e.start, e.end, !!(P.r.look && P.r.look.clock24)) ? `<div class="sg-time">${esc(timeRange(e.start, e.end, !!(P.r.look && P.r.look.clock24)))}</div>` : ''}
        ${e.note ? `<div class="sg-note"><span>${esc(owner())}:</span> ${esc(e.note)}</div>` : ''}
        <div class="sg-btns">
          <button type="button" class="sg-btn ok${r && r.state === 'ok' ? ' on' : ''}" data-ok="${esc(e.id)}" ${busy ? 'disabled' : ''} aria-pressed="${r && r.state === 'ok'}">✓ GOT IT</button>
          <button type="button" class="sg-btn chg${r && r.state === 'change' ? ' on' : ''}" data-chg="${esc(e.id)}" ${busy ? 'disabled' : ''} aria-pressed="${r && r.state === 'change'}">CHANGE REQUEST</button>
        </div>
        ${P.asking === e.id ? `<form class="sg-ask" data-ask="${esc(e.id)}" autocomplete="off">
            <textarea id="sgComment" class="ta" maxlength="500" placeholder="Add a note (optional)" aria-label="Note for your change request on ${esc(e.title)}">${r && r.state === 'change' ? esc(r.comment || '') : ''}</textarea>
            <div class="sg-ask-btns"><button type="button" class="btn line" data-ask-x>CANCEL</button><button type="submit" class="btn primary">SEND</button></div>
          </form>` : ''}
        ${r && r.state === 'change' && r.comment && P.asking !== e.id ? `<div class="sc-change"><span class="sg-by">YOU · ${esc(when(r.at))}</span>${esc(r.comment)}</div>` : ''}
      </div>`;
    }
  }
  root.innerHTML = `
    <header class="pm-head">
      <div><div class="eyebrow">SCHEDULE</div><div class="pm-sync${navigator.onLine ? '' : ' off'}"><i></i>${sync}</div></div>
      <span class="pm-name" aria-label="Signed in as">${esc(guest().toUpperCase())}</span>
    </header>
    <main class="pm-scroll pm-main">
      <h1 class="pm-title" style="margin:0">${esc(owner())}'s schedule</h1>
      ${tip}
      <div class="sc-week"><button type="button" class="sc-nav" data-week="-1" aria-label="Previous week">‹</button><span>${esc(weekLabel(P.week, now))}</span><button type="button" class="sc-nav" data-week="1" aria-label="Next week">›</button></div>
      ${thisWeek ? '' : '<button type="button" class="sg-today" data-week="0">BACK TO THIS WEEK</button>'}
      <div class="pm-access">TAP GOT IT OR CHANGE REQUEST.</div>
      ${list}
    </main>`;
}

async function reply(id, state, comment = '') {
  const e = P.entries.get(id);
  if (!e || !live()) return;
  P.busy.add(id);
  const at = Date.now();
  // Shown right away; the owner's Command Deck or Field Unit picks it up from here.
  P.entries.set(id, { ...e, reply: { state, comment: state === 'change' ? comment.trim().slice(0, 500) : '', at } });
  P.asking = null;
  render();
  try {
    await fb.updateDoc(fb.doc(P.fire.db, 'rosters', P.token, 'entries', id), {
      reply: { state, comment: state === 'change' ? comment.trim().slice(0, 500) : '', at },
      pending: true, gBy: guest().slice(0, 40), gAt: at
    });
    P.sentAt = Date.now();
    toast(state === 'ok' ? 'Sent: got it' : 'Change request sent');
  } catch (err) {
    toast(navigator.onLine ? 'Couldn\'t send that. Try again.' : 'Saved. It sends when you have signal.');
  }
  P.busy.delete(id);
  render();
  setTimeout(render, 8200);
}

document.addEventListener('click', (ev) => {
  const t = ev.target;
  const wk = t.closest('[data-week]');
  if (wk) {
    const n = Number(wk.dataset.week);
    P.week = n === 0 ? weekStart(new Date()) : addDays(P.week, 7 * n);
    P.asking = null;
    render();
    return;
  }
  if (t.closest('[data-tip-x]')) { tipDismissed = true; try { localStorage.setItem(tipKey(), '1'); } catch (e) { /* ok */ } render(); return; }
  const ok = t.closest('[data-ok]');
  if (ok) { reply(ok.dataset.ok, 'ok'); return; }
  const chg = t.closest('[data-chg]');
  if (chg) { P.asking = P.asking === chg.dataset.chg ? null : chg.dataset.chg; render(); setTimeout(() => { const b = $('#sgComment'); if (b) b.focus(); }, 30); return; }
  if (t.closest('[data-ask-x]')) { P.asking = null; render(); }
});
document.addEventListener('submit', (ev) => {
  const f = ev.target.closest('[data-ask]');
  if (!f) return;
  ev.preventDefault();
  reply(f.dataset.ask, 'change', $('#sgComment').value);
});

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
        s.forEach((d) => {
          const v = { id: d.id, ...d.data() };
          // Keep a reply that's on its way, so the button doesn't flicker back.
          const mine = P.entries.get(d.id);
          if (mine && mine.reply && P.busy.has(d.id)) v.reply = mine.reply;
          next.set(d.id, v);
        });
        P.entries = next;
        render();
        if (!landed) {
          landed = true;
          boot.line(1, `SCHEDULE · ${weekLabel(P.week).split(' · ').pop()}`, 'OK');
          boot.line(2, `ACCESS · ${guest().toUpperCase()}`, 'GRANTED');
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
