// ============================================================
// PROJECT MANIFEST — the guest page for one shared project
// Opened from a link like https://…/m#<token>. No app or account:
// the long token in the link is the key to this one project.
// ============================================================
import * as fb from './lib/core.js';
import { startFirebase, signIn, makeId } from './lib/sync.js';
import { LEVELS } from './lib/manifest.js';
import * as U from './lib/util.js';
import { bootScreen } from './boot.js';

const boot = bootScreen();

const { $, esc } = U;
const THEME_FONT = { dusk: 'chakra', space: 'chakra', red: 'chakra', terminal: 'chakra', retro: 'sharetech', moonbase: 'michroma', blueprint: 'spacemono', cryo: 'exo2', freighter: 'b612' };

const P = {
  token: (location.hash || '').replace(/^#/, '').replace(/[^A-Za-z0-9]/g, ''),
  fire: null,
  m: null, // manifest doc
  tasks: new Map(),
  myLog: new Map(),
  name: '',
  tab: 'list',
  open: null, // task id with its note/edit drawer open
  sent: 0,
  state: 'loading', // loading | invalid | ended | welcome | main | error
  error: ''
};
const nameKey = () => `pm.name.${P.token}`;
try { P.name = localStorage.getItem(nameKey()) || ''; } catch (e) { /* private mode */ }

const IC = {
  check: '<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5 L5 9 L10 3" fill="none" stroke="#14151B" stroke-width="2"/></svg>',
  note: '<svg width="15" height="15" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2.5 H12 V9.5 H6 L3 12 V9.5 H2 Z" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  more: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="3" cy="8" r="1.4" fill="currentColor"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/><circle cx="13" cy="8" r="1.4" fill="currentColor"/></svg>'
};

function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('on'), ms);
}

function level() { return LEVELS[(P.m && P.m.level) || 'check'] || LEVELS.check; }
function can(what) {
  const l = P.m ? P.m.level : 'check';
  if (what === 'notes' || what === 'log') return l === 'notes' || l === 'helper';
  if (what === 'edit') return l === 'helper';
  return true;
}
function live() {
  if (!P.m || P.m.closed) return false;
  const exp = P.m.expiresAt && (P.m.expiresAt.toMillis ? P.m.expiresAt.toMillis() : P.m.expiresAt);
  return !exp || exp > Date.now();
}
function owner() { return (P.m && P.m.owner) || 'the owner'; }

function applyLook() {
  const lk = (P.m && P.m.look) || {};
  const theme = lk.theme || 'dusk';
  const b = document.body;
  b.dataset.theme = theme;
  b.dataset.font = !lk.font || lk.font === 'auto' ? (THEME_FONT[theme] || 'chakra') : lk.font;
  b.dataset.ink = lk.ink || 'theme';
  b.dataset.trim = lk.trim || 'none';
  if (theme === 'moonbase' || theme === 'cryo') b.dataset.light = '1'; else delete b.dataset.light;
}

function sortTasks(list) {
  return list.slice().sort((a, b) => {
    const da = a.due ? new Date(a.due).getTime() : Infinity;
    const db = b.due ? new Date(b.due).getTime() : Infinity;
    return da - db || String(a.title).localeCompare(String(b.title));
  });
}
function dueText(t) {
  if (!t.due) return 'NO DATE';
  const d = new Date(t.due);
  return `DUE ${U.dayLabel(d)}${t.dueHasTime ? ` · ${U.fmtTimeShort(d)}` : ''}`;
}
function when(ms) {
  const d = new Date(ms);
  const now = new Date();
  if (Date.now() - ms < 60000) return 'JUST NOW';
  return U.sameDay(d, now) ? `TODAY ${U.fmtTimeShort(d)}` : `${U.dayLabel(d)} ${U.fmtTimeShort(d)}`;
}

function logEntries() {
  const map = new Map();
  ((P.m && P.m.log) || []).forEach((e) => map.set(e.id, e));
  P.myLog.forEach((e, id) => { if (!map.has(id)) map.set(id, e); });
  return [...map.values()].sort((a, b) => (b.at || 0) - (a.at || 0));
}

// ---------------------------------------------------------------- rendering
// Live updates re-draw the page; whatever the guest is typing survives that.
function render() {
  const keep = {};
  document.querySelectorAll('#pm input, #pm textarea').forEach((el) => {
    const f = el.form;
    const k = `${f ? (f.id || f.dataset.note || f.dataset.edit || '') : ''}:${el.name || el.id}`;
    keep[k] = { v: el.value, focus: el === document.activeElement, sel: el.selectionStart };
  });
  draw();
  document.querySelectorAll('#pm input, #pm textarea').forEach((el) => {
    const f = el.form;
    const k = `${f ? (f.id || f.dataset.note || f.dataset.edit || '') : ''}:${el.name || el.id}`;
    const v = keep[k];
    if (!v) return;
    el.value = v.v;
    if (v.focus) { el.focus(); try { el.setSelectionRange(v.sel, v.sel); } catch (e) { /* date inputs */ } }
  });
}

function draw() {
  const root = $('#pm');
  applyLook();
  if (P.state === 'loading') return;
  if (P.state === 'invalid' || P.state === 'error') {
    root.innerHTML = `<div class="pm-center"><div class="eyebrow">PROJECT MANIFEST</div><div class="pm-big">${P.state === 'invalid' ? 'Link not found' : 'No signal'}</div>
      <p class="pm-p">${P.state === 'invalid' ? 'This link isn\'t valid, or the owner has stopped sharing it. Ask them for a new one.' : esc(P.error || 'Couldn\'t reach the project. Check your connection and reload.')}</p></div>`;
    return;
  }
  if (P.state === 'ended') {
    root.innerHTML = `<div class="pm-center"><div class="eyebrow">PROJECT MANIFEST</div><div class="pm-big">${esc((P.m.project || {}).name || 'Project')}</div>
      <p class="pm-p">${P.m.closedReason === 'done' ? 'This project is complete. Thanks for the help!' : 'This link has ended.'} Ask ${esc(owner())} for a new link if you still need access.</p></div>`;
    return;
  }
  const p = P.m.project || {};
  const all = [...P.tasks.values()].filter((t) => t && !t.deleted);
  const open = sortTasks(all.filter((t) => !t.done));
  const done = all.filter((t) => t.done).sort((a, b) => String(b.doneAt || '').localeCompare(String(a.doneAt || '')));
  const pct = all.length ? Math.round((done.length / all.length) * 100) : 0;
  const due = p.due ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(p.due) ? `${p.due}T00:00` : p.due) : null;
  const dueLine = due ? `FINISH BY ${U.MONTHS[due.getMonth()].slice(0, 3).toUpperCase()} ${due.getDate()}` : 'PROJECT';

  if (P.state === 'welcome') {
    const filled = all.length ? Math.round((done.length / all.length) * 10) : 0;
    const abilities = ['Check off tasks'];
    if (can('notes')) abilities.push('Leave notes on tasks', 'Post to the project log');
    if (can('edit')) abilities.push('Add and edit tasks');
    root.innerHTML = `<div class="pm-scroll pm-welcome">
      <div class="eyebrow">PROJECT MANIFEST</div>
      <div class="pm-from">FROM ${esc(owner().toUpperCase())}'S COMMAND DECK</div>
      <section class="card pm-intro"><i class="br"></i>
        <div class="label amber-t">${esc(dueLine)}</div>
        <div class="pm-title">${esc(p.name || 'Project')}</div>
        <div class="pm-seg">${Array.from({ length: 10 }, (_, i) => `<i class="${i < filled ? 'on' : ''}"></i>`).join('')}</div>
        <div class="pm-small">${done.length} of ${all.length} tasks done</div>
        ${p.goal ? `<div class="pm-goal">${esc(p.goal)}</div>` : ''}
        <div class="pm-p">Project Access Granted</div>
        <ul class="pm-can">${abilities.map((a) => `<li><span class="ok-t">✓</span> ${a}</li>`).join('')}</ul>
      </section>
      <form id="pmName" class="pm-nameform" autocomplete="off">
        <label class="label" for="pmNameIn">SIGN IN AS</label>
        <input class="in title" id="pmNameIn" maxlength="40" value="${esc(P.name || P.m.guest || '')}" autocomplete="given-name" enterkeyhint="go">
        <div class="hint">Shows ${esc(owner())} who checked things off.</div>
        <button type="submit" class="btn primary block">OPEN PROJECT</button>
      </form>
      <div class="hint pm-fine">No app or account needed. ${esc(owner())} can end this link at any time.</div>
    </div>`;
    return;
  }

  const online = navigator.onLine;
  const sync = !online ? 'OFFLINE · WILL SEND WHEN BACK' : Date.now() - P.sent < 8000 ? `SENT TO ${esc(owner().toUpperCase())} · JUST NOW` : 'LIVE · SYNCED WITH COMMAND DECK';
  const logs = logEntries();
  const row = (t) => {
    const isOpen = P.open === t.id;
    const meta = t.done ? `DONE${t.doneBy ? ` BY ${esc(t.doneBy.toUpperCase())}` : ''}` : `${dueText(t)}${t.addedBy ? ` · ADDED BY ${esc(t.addedBy.toUpperCase())}` : ''}`;
    const comments = (t.comments || []).slice(-3).map((c) => `<div class="pm-comment"><span>${esc((c.by || '').toUpperCase())} · ${when(c.at || 0)}</span>${esc(c.text)}</div>`).join('');
    const btn = can('edit') ? `<button type="button" class="pm-icon${isOpen ? ' on' : ''}" data-open="${esc(t.id)}" aria-label="Edit ${esc(t.title)}">${IC.more}</button>`
      : can('notes') ? `<button type="button" class="pm-icon${isOpen ? ' on' : ''}" data-open="${esc(t.id)}" aria-label="Add a note to ${esc(t.title)}">${IC.note}${(t.comments || []).length ? `<b>${t.comments.length}</b>` : ''}</button>` : '';
    let drawer = '';
    if (isOpen && can('edit')) {
      drawer = `<form class="pm-drawer" data-edit="${esc(t.id)}" autocomplete="off">
        <div class="label">EDIT TASK</div>
        <input class="in title" name="title" value="${esc(t.title)}" maxlength="200" aria-label="Task">
        <div class="f-row"><label><span class="label">DUE DATE</span><input class="in" type="date" name="date" value="${t.due ? U.toDateInput(t.due) : ''}"></label>
          <label><span class="label">TIME</span><input class="in" type="time" name="time" value="${t.due && t.dueHasTime ? U.toTimeInput(t.due) : ''}"></label></div>
        <span class="label">NOTE</span>
        <textarea class="ta" name="note" rows="2" maxlength="500" placeholder="Optional note for ${esc(owner())}"></textarea>
        <div class="pm-drawer-btns"><button type="button" class="btn danger" data-del="${esc(t.id)}">DELETE</button><button type="submit" class="btn primary">SAVE</button></div>
      </form>`;
    } else if (isOpen && can('notes')) {
      drawer = `<form class="pm-drawer pm-noteform" data-note="${esc(t.id)}" autocomplete="off">
        <textarea class="ta" name="note" rows="2" maxlength="500" placeholder="Note for ${esc(owner())}…" aria-label="Note"></textarea>
        <button type="submit" class="btn primary">SEND</button></form>`;
    }
    return `<div class="pm-row${t.done ? ' done' : ''}">
      <div class="pm-row-main">
        <button type="button" class="tbox" data-toggle="${esc(t.id)}" aria-label="${t.done ? 'Mark not done' : 'Mark done'}: ${esc(t.title)}"><i>${t.done ? IC.check : ''}</i></button>
        <div class="pm-row-text"><div class="pm-row-title">${esc(t.title)}</div><div class="pm-row-meta">${meta}</div></div>
        ${btn}
      </div>${comments}${drawer}</div>`;
  };

  root.innerHTML = `
    <header class="pm-head">
      <div><div class="eyebrow">PROJECT MANIFEST</div><div class="pm-sync ${online ? '' : 'off'}"><i></i>${sync}</div></div>
      <button type="button" class="pm-name" id="pmRename" aria-label="Change your name">${esc((P.name || 'GUEST').toUpperCase())}</button>
    </header>
    <main class="pm-scroll pm-main">
      <div class="pm-hero">
        <div><div class="label amber-t">${esc(dueLine)}</div><h1 class="pm-title">${esc(p.name || 'Project')}</h1></div>
        <div class="pm-pct">${pct}%<small>COMPLETE</small></div>
      </div>
      <div class="pm-meter"><i style="width:${pct}%"></i></div>
      ${p.goal ? `<div class="pm-goal">${esc(p.goal)}</div>` : ''}
      <div class="pm-access">YOUR ACCESS · ${esc(level().name)}</div>
      <div class="seg pm-tabs" role="tablist">
        <button type="button" role="tab" aria-selected="${P.tab === 'list'}" class="${P.tab === 'list' ? 'on' : ''}" data-tab="list">CHECKLIST · ${open.length}</button>
        <button type="button" role="tab" aria-selected="${P.tab === 'log'}" class="${P.tab === 'log' ? 'on' : ''}" data-tab="log">PROJECT LOG · ${logs.length}</button>
      </div>
      ${P.tab === 'list' ? `
        ${open.length ? open.map(row).join('') : '<div class="empty">Nothing left to do. Nice work.</div>'}
        ${done.length ? `<div class="group-h"><span>DONE</span><span>${done.length}</span></div>${done.map(row).join('')}` : ''}
      ` : `
        <div class="hint">Notes about the whole project, not one task. ${esc(owner())} sees them on Command Deck and Field Unit.</div>
        ${can('log') ? `<form class="pm-post" id="pmPost" autocomplete="off"><textarea class="ta" name="text" rows="3" maxlength="1000" placeholder="Add a note for the whole project…" aria-label="Project log note"></textarea><button type="submit" class="btn primary">POST</button></form>` : '<div class="hint">You can read the log. Posting isn\'t part of your access.</div>'}
        ${logs.length ? logs.map((e) => `<div class="pm-log"><div class="pm-log-by"><span class="pm-av">${esc((e.by || '?').slice(0, 1).toUpperCase())}</span>${esc((e.by || '').toUpperCase())} · ${when(e.at || 0)}</div><div class="pm-log-text">${esc(e.text)}</div></div>`).join('') : '<div class="empty">No posts yet.</div>'}
      `}
    </main>
    ${can('edit') && P.tab === 'list' ? `<form class="pm-add" id="pmAdd" autocomplete="off"><label class="pm-add-field"><span aria-hidden="true">+</span><input id="pmAddIn" placeholder="Add a task (e.g. pick up bins oct 28)" maxlength="200" enterkeyhint="done" aria-label="Add a task"></label><button type="submit" class="btn primary">ADD</button></form>` : ''}`;
}

// ---------------------------------------------------------------- writes
function stamp() { return { pending: true, gBy: (P.name || 'Guest').slice(0, 40), gAt: Date.now() }; }
function sent() { P.sent = Date.now(); render(); setTimeout(render, 8200); }
async function write(fn, failMsg) {
  try { await fn(); sent(); } catch (e) {
    console.warn(e);
    toast(/permission/i.test(e.code || e.message || '') ? 'This link no longer allows that change.' : failMsg || 'Could not send. It will retry when you\'re back online.', 3500);
  }
}
const taskRef = (id) => fb.doc(P.fire.db, 'manifests', P.token, 'tasks', id);

function toggle(id) {
  const t = P.tasks.get(id);
  if (!t) return;
  const done = !t.done;
  write(() => fb.updateDoc(taskRef(id), { done, doneAt: done ? new Date().toISOString() : null, doneBy: done ? P.name : null, ...stamp() }));
}

function addComment(id, text) {
  const t = P.tasks.get(id);
  if (!t || !text.trim()) return null;
  const c = { id: makeId('c_'), by: P.name || 'Guest', text: text.trim().slice(0, 500), at: Date.now() };
  return [...(t.comments || []), c];
}

function parseAdd(text) {
  try {
    const r = fb.parseCommand(`add ${text}`, { categories: [], people: [], projects: [], noEdit: true }, new Date());
    if (r && r.intent === 'add-task' && r.task && r.task.title) return { title: r.task.title, due: r.task.due || null, dueHasTime: !!r.task.dueHasTime };
  } catch (e) { /* plain title */ }
  return { title: text.trim(), due: null, dueHasTime: false };
}

// ---------------------------------------------------------------- events
document.addEventListener('click', (e) => {
  const t = e.target;
  const tg = t.closest('[data-toggle]');
  if (tg) { toggle(tg.dataset.toggle); return; }
  const op = t.closest('[data-open]');
  if (op) { P.open = P.open === op.dataset.open ? null : op.dataset.open; render(); const ta = document.querySelector('.pm-drawer textarea, .pm-drawer input'); if (ta && P.open) ta.focus(); return; }
  const tab = t.closest('[data-tab]');
  if (tab) { P.tab = tab.dataset.tab; P.open = null; render(); return; }
  const del = t.closest('[data-del]');
  if (del) {
    if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = 'CONFIRM'; return; }
    const id = del.dataset.del;
    P.open = null;
    write(() => fb.updateDoc(taskRef(id), { deleted: true, ...stamp() }));
    return;
  }
  if (t.closest('#pmRename')) { P.state = 'welcome'; render(); }
});

document.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  if (f.id === 'pmName') {
    const n = $('#pmNameIn').value.trim().slice(0, 40);
    if (!n) { $('#pmNameIn').focus(); return; }
    P.name = n;
    try { localStorage.setItem(nameKey(), n); } catch (err) { /* private mode */ }
    P.state = 'main';
    render();
    return;
  }
  if (f.dataset.note) {
    const id = f.dataset.note;
    const comments = addComment(id, f.note.value);
    if (!comments) return;
    P.open = null;
    write(() => fb.updateDoc(taskRef(id), { comments, ...stamp() }));
    return;
  }
  if (f.dataset.edit) {
    const id = f.dataset.edit;
    const title = f.title.value.trim();
    if (!title) { f.title.focus(); return; }
    const d = U.fromInputs(f.date.value, f.time.value);
    const patch = { title: title.slice(0, 200), due: d ? d.toISOString() : null, dueHasTime: !!(f.date.value && f.time.value) };
    const comments = f.note.value.trim() ? addComment(id, f.note.value) : null;
    if (comments) patch.comments = comments;
    P.open = null;
    write(() => fb.updateDoc(taskRef(id), { ...patch, ...stamp() }));
    return;
  }
  if (f.id === 'pmPost') {
    const text = f.text.value.trim();
    if (!text) return;
    const entry = { id: makeId('l_'), by: (P.name || 'Guest').slice(0, 40), text: text.slice(0, 1000), at: Date.now() };
    P.myLog.set(entry.id, entry);
    f.text.value = '';
    write(() => fb.setDoc(fb.doc(P.fire.db, 'manifests', P.token, 'log', entry.id), entry));
    return;
  }
  if (f.id === 'pmAdd') {
    const text = $('#pmAddIn').value.trim();
    if (!text) return;
    const parsed = parseAdd(text);
    const id = makeId('t_');
    $('#pmAddIn').value = '';
    write(() => fb.setDoc(taskRef(id), {
      id, title: parsed.title.slice(0, 200), due: parsed.due, dueHasTime: parsed.dueHasTime,
      done: false, doneAt: null, doneBy: null, comments: [], addedBy: P.name || 'Guest', ...stamp()
    }));
  }
});

window.addEventListener('online', render);
window.addEventListener('offline', render);
window.addEventListener('hashchange', () => location.reload());

// ---------------------------------------------------------------- start
async function start() {
  if (P.token.length < 20) { P.state = 'invalid'; boot.skip(); render(); return; }
  let cfg;
  try {
    const res = await fetch('/__/firebase/init.json', { cache: 'no-store' });
    cfg = await res.json();
  } catch (e) { P.state = 'error'; P.error = 'Couldn\'t reach the project. Check your connection and reload.'; boot.skip(); render(); return; }
  try {
    P.fire = startFirebase(fb, cfg, 'manifest');
    await signIn(fb, P.fire.auth);
  } catch (e) { P.state = 'error'; P.error = 'Couldn\'t sign in to the project. Check your connection and reload.'; boot.skip(); render(); return; }
  boot.progress(12);

  let first = true;
  fb.onSnapshot(fb.doc(P.fire.db, 'manifests', P.token), (snap) => {
    if (!snap.exists()) { P.state = 'invalid'; boot.skip(); render(); return; }
    P.m = snap.data();
    if (!live()) { P.state = 'ended'; boot.skip(); render(); return; }
    if (first) {
      first = false;
      const theirs = P.m && P.m.owner ? `${P.m.owner.toUpperCase()}'S DECK` : 'COMMAND DECK';
      boot.line(0, `SIGNAL · ${theirs}`, 'OK');
      let landed = false;
      P.state = P.name ? 'main' : 'welcome';
      document.title = `${(P.m.project || {}).name || 'Project'} · Project Manifest`;
      fb.onSnapshot(fb.collection(P.fire.db, 'manifests', P.token, 'tasks'), (s) => {
        P.tasks = new Map();
        s.forEach((d) => P.tasks.set(d.id, { id: d.id, ...d.data() }));
        render();
        if (!landed) {
          landed = true;
          boot.line(1, `MANIFEST · ${String((P.m.project || {}).name || 'PROJECT').toUpperCase()}`, 'OK');
          boot.line(2, `ACCESS · ${P.name ? P.name.toUpperCase() : 'GUEST'}`, 'GRANTED');
          boot.lock(P.name ? `Hi, ${P.name}.` : 'Welcome.');
        }
      }, () => { boot.skip(); });
      fb.onSnapshot(fb.collection(P.fire.db, 'manifests', P.token, 'log'), (s) => {
        P.myLog = new Map();
        s.forEach((d) => P.myLog.set(d.id, d.data()));
        render();
      }, () => {});
    } else if (P.state === 'ended') P.state = P.name ? 'main' : 'welcome';
    render();
  }, (err) => {
    P.state = /permission/i.test(err.code || err.message || '') ? 'ended' : 'error';
    if (P.state === 'ended' && !P.m) P.state = 'invalid';
    boot.skip();
    render();
  });
}

start();
