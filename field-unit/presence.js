// Presence: Field Unit as the Computer. A glowing orb that speaks your briefing, a
// conversation screen, and calm Tasks / Week / Settings screens.
//
// The brain is two parts. Known commands ("add milk", "what's next") run on the
// built-in parser in app.js: instant, free, offline. Anything it doesn't understand,
// plus the spoken briefing and everything you say out loud, goes to Gemini, called
// straight from the phone with Field Unit's own key (decks/{id}/fuConfig/main, like
// Wine Log's wineConfig/main), so Presence works with the PC off.
//
// Listening records a short clip (16 kHz WAV, made here) and Gemini both writes down
// what you said and answers. If the words are a known command, the built-in parser
// does it instead. Speaking uses a Gemini voice, or the iPhone's own voices offline.

let A = null; // app.js hooks
const P = {
  view: 'home',
  cfg: { key: '', model: '', ttsModel: '' },
  wineKey: '',
  brief: null, // { text, at, sig, src }
  briefBusy: false,
  tkTab: 'queue',
  weekSel: null,
  mic: null, // { stream, ctx, src, proc, an, chunks, rate, heard, started, lastLoud, timer, raf }
  micIdle: null,
  state: 'idle', // idle | listening | thinking | speaking
  voiceQ: Promise.resolve(),
  playing: null,
  ttsDownUntil: 0,
  pendingBrief: false,
  unsub: []
};

export const VOICES = [
  ['Charon', 'Informative'], ['Algenib', 'Gravelly'], ['Orus', 'Firm'], ['Kore', 'Firm'], ['Sulafat', 'Warm'], ['Gacrux', 'Mature'],
  ['Iapetus', 'Clear'], ['Schedar', 'Even'], ['Algieba', 'Smooth'], ['Despina', 'Smooth'], ['Achird', 'Friendly'], ['Sadaltager', 'Knowledgeable'],
  ['Puck', 'Upbeat'], ['Zephyr', 'Bright'], ['Aoede', 'Breezy'], ['Leda', 'Youthful'], ['Fenrir', 'Excitable'], ['Enceladus', 'Breathy'],
  ['Umbriel', 'Easy-going'], ['Callirrhoe', 'Easy-going'], ['Achernar', 'Soft'], ['Vindemiatrix', 'Gentle'], ['Rasalgethi', 'Informative'], ['Alnilam', 'Firm'],
  ['Erinome', 'Clear'], ['Autonoe', 'Bright'], ['Laomedeia', 'Upbeat'], ['Pulcherrima', 'Forward'], ['Zubenelgenubi', 'Casual'], ['Sadachbia', 'Lively']
];
const PERSONAS = [['dry', 'Dry wit'], ['warm', 'Warm'], ['brief', 'Just the facts']];
const DEFAULTS = { name: 'Computer', gemini: true, voiceSrc: 'gemini', voice: 'Charon', iosVoice: '', speak: true, persona: 'dry', callsYou: '', morning: true, morningAt: '07:00', evening: false, eveningAt: '18:00' };
const ORB = 'presence-orb.jpg';
const API = 'https://generativelanguage.googleapis.com/v1beta';

const IC = {
  mic: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  stop: '<span class="pz-stopsq" aria-hidden="true"></span>',
  send: '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M3 9 H14 M9 4 L14 9 L9 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  close: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3 L13 13 M13 3 L3 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  chev: '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M5 2 L10 7 L5 12" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>'
};

// ---------------------------------------------------------------- setup
export function initPresence(api) {
  A = api;
  P.cfg = { ...P.cfg, ...A.load('fu.gemini', {}) };
  P.wineKey = A.load('fu.wineKey', '');
  document.addEventListener('visibilitychange', () => { if (document.hidden) { stopVoice(); releaseMic(); } else if (on()) maybeBriefing(); });
  // iPhone only plays sound after a tap: a briefing that's due waits for the first touch.
  document.addEventListener('pointerdown', () => { if (P.pendingBrief && on() && !A.C.open) { P.pendingBrief = false; speakBriefing(); } }, true);
}
export const on = () => (A.S.settings.ui || 'presence') === 'presence';
export const opts = () => ({ ...DEFAULTS, ...(A.S.settings.pres || {}) });
function setOpt(k, v) { A.S.settings.pres = { ...opts(), [k]: v }; A.saveSettings(); }
export const name = () => (opts().name || 'Computer').trim() || 'Computer';
const callsYou = () => (opts().callsYou || '').trim() || A.operator();
const key = () => P.cfg.key || P.wineKey;
export const thinks = () => !!(opts().gemini && key());

// Field Unit's Gemini settings live with the deck (so every phone shares one key);
// Wine Log's key is used when Field Unit hasn't been given its own.
export function watchConfig() {
  P.unsub.forEach((u) => { try { u(); } catch (e) { /* gone */ } });
  P.unsub = [];
  const S = A.S;
  if (!S.fire || !S.deckId) return;
  const ref = (c) => A.fb.doc(S.fire.db, 'decks', S.deckId, c, 'main');
  P.unsub.push(A.fb.onSnapshot(ref('fuConfig'), (snap) => {
    const d = snap.exists() ? snap.data() : {};
    P.cfg = { key: d.geminiKey || '', model: d.model || '', ttsModel: d.ttsModel || '' };
    A.store('fu.gemini', P.cfg);
    if (on()) refresh();
  }, () => {}));
  P.unsub.push(A.fb.onSnapshot(ref('wineConfig'), (snap) => {
    const d = snap.exists() ? snap.data() : {};
    P.wineKey = d.geminiKey || '';
    A.store('fu.wineKey', P.wineKey);
  }, () => {}));
}
function saveCfg(patch) {
  P.cfg = { ...P.cfg, ...patch };
  A.store('fu.gemini', P.cfg);
  const S = A.S;
  if (S.fire && S.deckId) {
    const data = {};
    if ('key' in patch) data.geminiKey = patch.key;
    if ('model' in patch) data.model = patch.model;
    if ('ttsModel' in patch) data.ttsModel = patch.ttsModel;
    A.fb.setDoc(A.fb.doc(S.fire.db, 'decks', S.deckId, 'fuConfig', 'main'), data, { merge: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------- shell
// A start page cached from before Presence existed has no link to its styles or font:
// add them here so Presence never draws unstyled.
function ensureStyles() {
  if (document.querySelector('link[href$="presence.css"]')) return;
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = 'presence.css';
  document.head.appendChild(css);
  if (!document.querySelector('link[href*="family=Outfit"]')) {
    const f = document.createElement('link');
    f.rel = 'stylesheet';
    f.href = 'https://fonts.googleapis.com/css2?family=Outfit:wght@200;300;400;500&display=swap';
    document.head.appendChild(f);
  }
}
export function mount() {
  ensureStyles();
  const live = on() && !A.S.peek;
  document.body.classList.toggle('presence', live);
  if (!live) { const r = A.$('#pres'); if (r) r.innerHTML = ''; return; }
  let root = A.$('#pres');
  if (!root) {
    root = document.createElement('div');
    root.id = 'pres';
    document.body.insertBefore(root, A.$('#overlay'));
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('input', onInput);
  }
}
export function render() {
  mount();
  if (!on() || A.S.peek) return;
  const root = A.$('#pres');
  const scroller = A.$('.pz-scroll', root);
  const keep = scroller && root.dataset.v === P.view ? scroller.scrollTop : 0;
  const v = P.view;
  root.dataset.v = v;
  root.innerHTML = `${v === 'home' ? homeHtml() : `<div class="pz-scroll">${v === 'tasks' ? tasksHtml() : v === 'week' ? weekHtml() : settingsHtml()}</div>`}${navHtml()}`;
  const sc = A.$('.pz-scroll', root);
  if (sc) sc.scrollTop = keep;
  if (v === 'home') maybeBriefing();
}
function refresh() { if (on() && !A.C.open && !A.$('.sheet')) render(); }
export function go(v) { P.view = v; render(); }

function navHtml() {
  const tab = (v, l) => `<button type="button" class="pz-tab${P.view === v ? ' on' : ''}" data-pz-go="${v}"><i aria-hidden="true"></i>${l}</button>`;
  return `<nav class="pz-nav" aria-label="Main">${tab('home', 'Home')}${tab('tasks', 'Tasks')}
    <button type="button" class="pz-talk${P.state === 'speaking' ? ' live' : ''}" data-pz="talk" aria-label="Talk to ${A.esc(name())}">${IC.mic}</button>
    ${tab('week', 'Week')}${tab('settings', 'Settings')}</nav>`;
}

function orbHtml(cls = '') {
  return `<span class="pz-orbwrap ${cls}${P.state !== 'idle' ? ` ${P.state}` : ''}" aria-hidden="true"><img class="pz-orb" src="${ORB}" alt=""><img class="pz-orb b" src="${ORB}" alt=""></span>`;
}
function motes() {
  let s = '';
  for (let i = 0; i < 12; i++) s += `<i class="pz-mote" style="left:${12 + ((i * 53) % 76)}%;top:${10 + ((i * 37) % 38)}%;animation-delay:-${(i * 0.83).toFixed(2)}s"></i>`;
  return `<span class="pz-motes" aria-hidden="true">${s}</span>`;
}

// ---------------------------------------------------------------- home
function words(text) {
  return A.esc(text).split(/\s+/).map((w, i) => `<span class="pz-w" style="animation-delay:${(i * 0.16).toFixed(2)}s">${w}</span>`).join(' ');
}
function homeHtml() {
  const S = A.S;
  const now = new Date();
  const list = A.active();
  const over = A.sortTasks(list.filter((t) => A.isOverdue(t, now)), now);
  const next = nextThing(now);
  const w = S.weather && S.weather.current ? ` · ${Math.round(S.weather.current.temperature_2m)}°` : '';
  const b = briefText();
  const card = (kind, label, title, sub, data) => `<button type="button" class="pz-card ${kind}" ${data}><span class="pz-k">${label}</span><span class="pz-t">${A.esc(title)}</span><span class="pz-s">${A.esc(sub)}</span></button>`;
  const cards = [];
  if (over.length) cards.push(card('late', over.length > 1 ? `OVERDUE · ${over.length}` : 'OVERDUE', over[0].title, sinceLabel(over[0], now), `data-pz-task="${A.esc(over[0].id)}"`));
  if (next) cards.push(card('next', 'NEXT', next.title, next.when, next.data));
  if (cards.length < 2) {
    const dueToday = list.filter((t) => t.due && A.U.sameDay(new Date(t.due), now) && !A.isOverdue(t, now));
    if (dueToday.length) cards.push(card('today', 'TODAY', dueToday[0].title, dueToday.length > 1 ? `+ ${dueToday.length - 1} more due today` : A.dueLabel(dueToday[0], now).toLowerCase(), `data-pz-task="${A.esc(dueToday[0].id)}"`));
  }
  if (!cards.length) cards.push(card('next', 'ALL CLEAR', 'Nothing due', 'Enjoy it', 'data-pz-go="week"'));
  const chips = [['Status report', 'status report'], ['What\'s next?', "what's next"], ['Show my week', '#week'], ['Add a task', '#task']];
  return `<section class="pz-home">
    <div class="pz-glow" aria-hidden="true"></div>
    <button type="button" class="pz-orbbtn" data-pz="brief" aria-label="Hear the briefing">${orbHtml('big')}${motes()}</button>
    <header class="pz-top"><span>${A.esc(name().toUpperCase())}</span><span>${A.U.fmtTimeShort(now, A.clock24())}${w}</span></header>
    <div class="pz-homebody">
      <p class="pz-brief${b.src === 'gemini' ? ' g' : ''}" aria-live="polite">${words(b.text)}</p>
      <div class="pz-cards${cards.length === 1 ? ' one' : ''}">${cards.join('')}</div>
      <div class="pz-chips">${chips.map(([l, c]) => `<button type="button" class="pz-chip" data-pz-say="${A.esc(c)}">${A.esc(l)}</button>`).join('')}</div>
      <div class="pz-hint">${thinks() ? 'TAP TO TALK' : key() ? 'GEMINI IS OFF · TAP TO TYPE' : 'TAP TO TYPE · ADD A GEMINI KEY TO TALK'}</div>
    </div>
    <div class="pz-wave" aria-hidden="true"><svg width="510" height="40" viewBox="0 0 510 40"><path d="M0 20 Q 15 6 30 20 T 60 20 T 90 20 T 120 20 T 150 20 T 180 20 T 210 20 T 240 20 T 270 20 T 300 20 T 330 20 T 360 20 T 390 20 T 420 20 T 450 20 T 480 20 T 510 20" fill="none" stroke="rgba(255,200,130,0.55)" stroke-width="1.2"/><path d="M0 20 Q 15 30 30 20 T 60 20 T 90 20 T 120 20 T 150 20 T 180 20 T 210 20 T 240 20 T 270 20 T 300 20 T 330 20 T 360 20 T 390 20 T 420 20 T 450 20 T 480 20 T 510 20" fill="none" stroke="rgba(120,210,240,0.4)" stroke-width="1"/></svg></div>
  </section>`;
}
function sinceLabel(t, now) {
  const d = new Date(t.due);
  if (A.U.sameDay(d, now)) return t.dueHasTime ? `since ${A.U.fmtTimeShort(d, A.clock24()).toLowerCase()}` : 'due today';
  const days = Math.round((A.U.startOfDay(now) - A.U.startOfDay(d)) / 864e5);
  return days === 1 ? 'since yesterday' : `${days} days late`;
}
function nextThing(now) {
  const ev = A.allEvents().find((e) => (e.allDay ? A.U.startOfDay(e.end) > now && e.start >= A.U.startOfDay(now) : e.start > now));
  const t = A.sortTasks(A.active().filter((x) => x.due && x.dueHasTime && new Date(x.due) > now), now)[0];
  const evAt = ev ? ev.start : null;
  const tAt = t ? new Date(t.due) : null;
  if (ev && (!tAt || evAt <= tAt)) return { title: ev.title, when: whenShort(ev.start, ev.allDay, now), data: ev.local ? `data-pz-ev="${A.esc(ev.id)}"` : 'data-pz-go="week"' };
  if (t) return { title: t.title, when: whenShort(tAt, false, now), data: `data-pz-task="${A.esc(t.id)}"` };
  return null;
}
function whenShort(d, allDay, now = new Date()) {
  const day = A.U.sameDay(d, now) ? 'Today' : A.U.sameDay(d, A.U.addDays(now, 1)) ? 'Tomorrow' : A.U.DAY_FULL[d.getDay()].slice(0, 3);
  return allDay ? `${day} · all day` : `${day} · ${A.U.fmtTimeShort(d, A.clock24())}`;
}

// ---------------------------------------------------------------- briefing
function dataSig() {
  const S = A.S;
  const now = new Date();
  return [A.active().length, A.active().filter((t) => A.isOverdue(t, now)).length, (S.calendar.updatedAt || 0), S.events.length, now.getHours() < 12 ? 'am' : now.getHours() < 18 ? 'pm' : 'eve', now.toDateString(), name(), callsYou(), opts().persona].join('|');
}
function briefText() {
  const sig = dataSig();
  if (P.brief && P.brief.sig === sig && Date.now() - P.brief.at < 45 * 60000) return P.brief;
  if (thinks() && !P.briefBusy && navigator.onLine) {
    P.briefBusy = true;
    geminiBriefing().then((text) => {
      if (text) { P.brief = { text, at: Date.now(), sig, src: 'gemini' }; if (P.view === 'home') refresh(); }
    }).catch(() => {}).finally(() => { P.briefBusy = false; });
  }
  const local = A.briefing().replace(/^Good \w+, [^.]+\./, `Good ${A.U.partOfDay(new Date())}, ${callsYou()}.`);
  if (P.brief && P.brief.sig === sig) return P.brief;
  return { text: local, src: 'built-in' };
}
// Spoken once each morning / evening (after the set time), on the first tap after opening.
function maybeBriefing() {
  const o = opts();
  if (!o.speak) return;
  const now = new Date();
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const day = now.toDateString();
  const said = A.load('fu.presBriefed', {});
  let slot = null;
  if (o.evening && hm >= o.eveningAt && said.evening !== day) slot = 'evening';
  else if (o.morning && hm >= o.morningAt && hm < '12:00' && said.morning !== day) slot = 'morning';
  if (!slot) return;
  A.store('fu.presBriefed', { ...said, [slot]: day });
  P.pendingBrief = true;
}
function speakBriefing() {
  A.ac();
  const b = briefText();
  speak(b.text);
  const p = A.$('.pz-brief');
  if (p) { p.innerHTML = words(b.text); }
}

// ---------------------------------------------------------------- tasks
function tasksHtml() {
  const now = new Date();
  const list = A.active();
  const over = A.sortTasks(list.filter((t) => A.isOverdue(t, now)), now);
  const today = A.sortTasks(list.filter((t) => !A.isOverdue(t, now) && t.due && A.U.sameDay(new Date(t.due), now)), now);
  const end = A.U.addDays(A.U.startOfDay(now), 8);
  const week = A.sortTasks(list.filter((t) => t.due && !A.isOverdue(t, now) && !A.U.sameDay(new Date(t.due), now) && new Date(t.due) < end), now);
  const later = A.sortTasks(list.filter((t) => !t.due || new Date(t.due) >= end), now);
  const inQ = (t) => A.inQueue(t, now);
  const summary = !list.length ? 'Nothing open. Suspiciously quiet.'
    : `${list.length} open.${over.length ? ` ${over.length === 1 ? `<span class="late">${A.esc(over[0].title)}</span> is` : `<span class="late">${over.length} things</span> are`} running late.` : ' Nothing is running late.'}${today.length ? ` ${today.length} due today.` : ''}`;
  const tabs = [['queue', 'Queue'], ['projects', 'Projects'], ['done', 'Done']].map(([v, l]) => `<button type="button" class="pz-seg${P.tkTab === v ? ' on' : ''}" data-pz-tk="${v}">${l}</button>`).join('');
  let body = '';
  if (P.tkTab === 'queue') {
    const group = (label, cls, items) => (items.length ? `<div class="pz-l ${cls}">${label}</div><section class="pz-panel">${items.map((t) => taskRow(t, now)).join('')}</section>` : '');
    const q = (arr) => arr.filter(inQ);
    body = group('Needs you', 'late', q(over).concat(q(today))) + group('This week', '', q(week)) + group('Later', '', q(later).slice(0, 25));
    const tucked = list.filter((t) => !inQ(t)).length;
    if (tucked) body += `<button type="button" class="pz-tucked" data-pz-tk="projects">${tucked} more in projects ${IC.chev}</button>`;
    if (!body) body = '<div class="pz-empty">Your queue is clear.</div>';
  } else if (P.tkTab === 'projects') {
    const pj = A.liveProjects();
    body = pj.length ? `<section class="pz-panel">${pj.map((p) => projectRow(p)).join('')}</section>` : '<div class="pz-empty">No projects running. Say "new project garage cleanout".</div>';
    body += '<button type="button" class="pz-ghost" data-pz="newproject">+ New project</button>';
  } else {
    const done = A.S.tasks.filter((t) => t.done).sort((a, b) => new Date(b.doneAt || 0) - new Date(a.doneAt || 0)).slice(0, 30);
    body = done.length ? `<section class="pz-panel">${done.map((t) => taskRow(t, now)).join('')}</section>` : '<div class="pz-empty">Nothing finished yet today.</div>';
  }
  return `<div class="pz-page">
    <header class="pz-head">${orbHtml('mini')}<h1>Tasks</h1><button type="button" class="pz-btn" data-pz="newtask">+ New</button></header>
    <p class="pz-say">${summary}</p>
    <div class="pz-segs" role="tablist">${tabs}</div>
    ${body}</div>`;
}
function taskRow(t, now) {
  const late = A.isOverdue(t, now);
  const p = A.projectById(t.projectId);
  const cat = A.categoryById(t.category);
  const meta = [p ? p.name : cat ? cat.name : '', t.due ? (late ? sinceLabel(t, now) : '') : '', t.subtasks && t.subtasks.length ? `${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length}` : ''].filter(Boolean).join(' · ');
  const due = t.done ? '' : !t.due ? '' : late ? 'Late' : A.U.sameDay(new Date(t.due), now) ? (t.dueHasTime ? A.U.fmtTimeShort(new Date(t.due), A.clock24()) : 'Today') : A.U.DAY_FULL[new Date(t.due).getDay()].slice(0, 3);
  return `<div class="pz-row${late ? ' late' : ''}${t.done ? ' done' : ''}">
    <button type="button" class="pz-check" data-pz-done="${A.esc(t.id)}" aria-label="${t.done ? 'Mark not done' : 'Mark done'}: ${A.esc(t.title)}"></button>
    <button type="button" class="pz-rowmain" data-pz-task="${A.esc(t.id)}"><span class="pz-t">${A.esc(t.title)}</span>${meta ? `<span class="pz-s">${A.esc(meta)}</span>` : ''}</button>
    ${due ? `<span class="pz-due">${A.esc(due)}</span>` : ''}</div>`;
}
function projectRow(p) {
  const st = A.projectStats(p);
  const c = 2 * Math.PI * 14;
  const sub = [`${st.done} of ${st.total} done`, st.next ? `next: ${st.next.title}` : '', p.due ? A.projectDueLabel(p).toLowerCase() : ''].filter(Boolean).join(' · ');
  return `<button type="button" class="pz-row pz-pj" data-pz-pj="${A.esc(p.id)}">
    <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true"><circle cx="17" cy="17" r="14" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="3"/><circle cx="17" cy="17" r="14" fill="none" stroke="${A.esc(p.color || '#8FD8F0')}" stroke-width="3" stroke-dasharray="${(c * st.pct / 100).toFixed(1)} ${c.toFixed(1)}" stroke-linecap="round" transform="rotate(-90 17 17)"/></svg>
    <span class="pz-rowmain"><span class="pz-t">${A.esc(p.name)}</span><span class="pz-s">${A.esc(sub)}</span></span><span class="pz-chev">${IC.chev}</span></button>`;
}

// ---------------------------------------------------------------- week
function weekHtml() {
  const now = new Date();
  const start = A.U.startOfDay(now);
  const sel = P.weekSel && P.weekSel >= start && P.weekSel < A.U.addDays(start, 7) ? P.weekSel : null;
  const events = A.allEvents();
  const tasks = A.active();
  const items = [];
  for (let i = 0; i < 7; i++) {
    const d = A.U.addDays(start, i);
    const evs = A.eventsOnDay(d, events).filter((e) => i > 0 || e.allDay || e.end > now);
    evs.forEach((e) => { if (A.U.sameDay(e.start < start ? start : e.start, d)) items.push({ at: e.allDay ? d : e.start, day: d, kind: 'ev', e }); });
    tasks.filter((t) => t.due && A.U.sameDay(new Date(t.due), d) && !A.isOverdue(t, now)).forEach((t) => items.push({ at: t.dueHasTime ? new Date(t.due) : A.U.addDays(d, 0.99), day: d, kind: 'task', t }));
  }
  const late = tasks.filter((t) => A.isOverdue(t, now));
  items.sort((a, b) => a.at - b.at);
  const busy = new Map();
  items.forEach((it) => { const k = it.day.toDateString(); busy.set(k, (busy.get(k) || 0) + 1); });
  const quiet = [];
  for (let i = 1; i < 7; i++) { const d = A.U.addDays(start, i); if (!busy.get(d.toDateString())) quiet.push(A.U.DAY_FULL[d.getDay()]); }
  const big = [...busy.entries()].sort((a, b) => b[1] - a[1])[0];
  const summary = !items.length && !late.length ? 'Nothing on the books this week. Wide open.'
    : `${items.length <= 4 ? 'A light week.' : items.length <= 10 ? 'A steady week.' : 'A full week.'}${big && big[1] > 1 ? ` ${A.U.DAY_FULL[new Date(big[0]).getDay()]} is the busy one.` : ''}${quiet.length ? ` ${quiet[0]} is wide open.` : ''}`;
  const strip = Array.from({ length: 7 }, (_, i) => {
    const d = A.U.addDays(start, i);
    const k = d.toDateString();
    const dayItems = items.filter((it) => it.day.toDateString() === k);
    const dots = dayItems.slice(0, 3).map((it) => `<i style="background:${it.kind === 'ev' ? A.esc(String(it.e.color || '#8FD8F0')) : '#F2C58A'}"></i>`).join('') + (i === 0 && late.length ? '<i style="background:#FF9A6A"></i>' : '');
    const on = sel ? A.U.sameDay(sel, d) : false;
    return `<button type="button" class="pz-day${i === 0 ? ' today' : ''}${on ? ' on' : ''}" data-pz-day="${i}"><span>${A.U.DAY_FULL[d.getDay()].slice(0, 3).toUpperCase()}</span><b>${d.getDate()}</b><em>${dots}</em></button>`;
  }).join('');
  const shown = sel ? items.filter((it) => A.U.sameDay(it.day, sel)) : items;
  const line = [];
  if (!sel || A.U.sameDay(sel, start)) late.slice(0, 3).forEach((t) => line.push(`<button type="button" class="pz-tl late" data-pz-task="${A.esc(t.id)}"><i class="pz-dot pulse"></i><span class="pz-k">NOW · ${A.esc(sinceLabel(t, now).toUpperCase())}</span><span class="pz-t">${A.esc(t.title)}</span><span class="pz-s">Overdue · tap to edit</span></button>`));
  shown.forEach((it) => {
    const dayName = A.U.sameDay(it.day, now) ? 'TODAY' : A.U.DAY_FULL[it.day.getDay()].slice(0, 3).toUpperCase();
    if (it.kind === 'ev') {
      const e = it.e;
      const when = e.allDay ? `${dayName} · ALL DAY` : `${dayName} · ${A.U.fmtTimeShort(e.start, A.clock24())}${e.end - e.start > 3600000 ? ` – ${A.U.fmtTimeShort(e.end, A.clock24())}` : ''}`;
      line.push(`<button type="button" class="pz-tl" ${e.local ? `data-pz-ev="${A.esc(e.id)}"` : ''} style="--c:${A.esc(String(e.color || '#8FD8F0'))}"><i class="pz-dot"></i><span class="pz-k">${A.esc(when)}</span><span class="pz-t">${A.esc(e.title)}</span><span class="pz-s">${A.esc([e.location, e.calName].filter(Boolean).join(' · '))}</span></button>`);
    } else {
      const t = it.t;
      line.push(`<button type="button" class="pz-tl task" data-pz-task="${A.esc(t.id)}"><i class="pz-dot"></i><span class="pz-k">${dayName}${t.dueHasTime ? ` · ${A.esc(A.U.fmtTimeShort(new Date(t.due), A.clock24()))}` : ''} · TASK</span><span class="pz-t">${A.esc(t.title)}</span></button>`);
    }
  });
  return `<div class="pz-page">
    <header class="pz-head">${orbHtml('mini')}<h1>This week</h1><button type="button" class="pz-btn ghost" data-pz="newevent">+ Event</button></header>
    <p class="pz-say">${A.esc(summary)}</p>
    <div class="pz-strip">${strip}</div>
    ${sel ? `<button type="button" class="pz-ghost small" data-pz-day="all">Show the whole week</button>` : ''}
    <div class="pz-line">${line.join('') || '<div class="pz-empty">Nothing that day.</div>'}</div>
    <button type="button" class="pz-ghost" data-pz="classic-cal">Month view and shared schedule ${IC.chev}</button></div>`;
}

// ---------------------------------------------------------------- settings
function row(title, sub, right, data = '') {
  return `<div class="pz-srow"${data}><div class="pz-st">${title}${sub ? `<span>${sub}</span>` : ''}</div>${right}</div>`;
}
function sw(id, on, label) { return `<button type="button" class="pz-sw" role="switch" aria-checked="${on}" aria-label="${A.esc(label)}" data-pz-sw="${id}"></button>`; }
function settingsHtml() {
  const o = opts();
  const own = !!P.cfg.key;
  const keyLine = own ? `Field Unit's own · ${mask(P.cfg.key)}` : P.wineKey ? `Using Wine Log's key · ${mask(P.wineKey)}` : 'No key yet. Free from Google AI Studio.';
  const ios = iosVoices();
  return `<div class="pz-page">
    <header class="pz-head">${orbHtml('mini')}<h1>${A.esc(name())}</h1></header>
    <div class="pz-l">Brain</div>
    <section class="pz-panel">
      ${row('Built-in commands', 'Instant, free, works offline', '<span class="pz-v ok">● Always on</span>')}
      ${row('Gemini', 'Conversation, listening and briefings · works without the PC', sw('gemini', o.gemini, 'Use Gemini'))}
      ${row('Gemini key', A.esc(keyLine), `<button type="button" class="pz-link" data-pz="key">${own ? 'Change' : 'Add'}</button>`)}
      ${row('Model', A.esc(P.cfg.model ? P.cfg.model : 'Picked automatically'), '<span class="pz-v">Auto</span>')}
    </section>
    <div class="pz-l">Voice &amp; manner</div>
    <section class="pz-panel">
      ${row('Name', 'What it answers to and calls itself', `<input class="pz-in" id="pzName" value="${A.esc(o.name)}" maxlength="20" aria-label="Name">`)}
      ${row('Voice', o.voiceSrc === 'gemini' ? 'Gemini voice · falls back to the iPhone voice offline' : 'iPhone voice · works offline', `<select class="pz-sel" id="pzVoiceSrc" aria-label="Voice source"><option value="gemini"${o.voiceSrc === 'gemini' ? ' selected' : ''}>Gemini</option><option value="iphone"${o.voiceSrc === 'iphone' ? ' selected' : ''}>iPhone</option></select>`)}
      ${o.voiceSrc === 'gemini'
        ? row('Gemini voice', '', `<select class="pz-sel" id="pzVoice" aria-label="Gemini voice">${VOICES.map(([v, d]) => `<option value="${v}"${o.voice === v ? ' selected' : ''}>${v} · ${d}</option>`).join('')}</select>`)
        : row('iPhone voice', ios.length ? 'Download Enhanced or Premium voices in iPhone Settings › Accessibility › Spoken Content' : 'Voices load after the first tap', `<select class="pz-sel" id="pzIos" aria-label="iPhone voice"><option value="">Default</option>${ios.map((v) => `<option value="${A.esc(v.voiceURI)}"${o.iosVoice === v.voiceURI ? ' selected' : ''}>${A.esc(v.name)}</option>`).join('')}</select>`)}
      ${row('Hear a sample', '', '<button type="button" class="pz-link" data-pz="sample">Play</button>')}
      ${row('Personality', 'How it talks to you', `<select class="pz-sel" id="pzPersona" aria-label="Personality">${PERSONAS.map(([v, l]) => `<option value="${v}"${o.persona === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`)}
      ${row('Calls you', `Blank uses your name from the deck (${A.esc(A.operator())})`, `<input class="pz-in" id="pzCalls" value="${A.esc(o.callsYou)}" maxlength="24" placeholder="${A.esc(A.operator())}" aria-label="What it calls you">`)}
      ${row('Speak replies out loud', '', sw('speak', o.speak, 'Speak replies'))}
    </section>
    <div class="pz-l">Briefings</div>
    <section class="pz-panel">
      ${row('Morning briefing', 'Spoken on your first tap after this time', `<span class="pz-pair"><input class="pz-in time" type="time" id="pzMorningAt" value="${A.esc(o.morningAt)}" aria-label="Morning briefing time">${sw('morning', o.morning, 'Morning briefing')}</span>`)}
      ${row('Evening wrap-up', 'What got done and what\'s tomorrow', `<span class="pz-pair"><input class="pz-in time" type="time" id="pzEveningAt" value="${A.esc(o.eveningAt)}" aria-label="Evening wrap-up time">${sw('evening', o.evening, 'Evening wrap-up')}</span>`)}
    </section>
    <div class="pz-l">Field Unit</div>
    <section class="pz-panel">
      ${row('Notes, recaps and calendar', 'Open the classic screens', `<button type="button" class="pz-link" data-pz="classic">Open ${IC.chev}</button>`)}
      ${row('Pairing, alerts and more settings', '', `<button type="button" class="pz-link" data-pz="classic-settings">Open ${IC.chev}</button>`)}
      ${row('Use the classic Field Unit', 'Switch back any time from its Settings', `<button type="button" class="pz-link" data-pz="to-classic">Switch</button>`)}
    </section>
    <div class="pz-foot">${A.esc(name())} · built-in commands${thinks() ? ' + Gemini' : ''}</div></div>`;
}
const mask = (k) => (k ? `${k.slice(0, 4)}••••${k.slice(-3)}` : '');

function openKeySheet() {
  const sh = A.openSheet(`<div class="sheet-head"><span class="label">GEMINI KEY</span><button type="button" class="icon-btn" data-close aria-label="Close">${IC.close}</button></div>
    <div class="hint" style="margin-top:0">Free from <b>aistudio.google.com</b> › Get API key. It's kept with your deck, so every paired phone can use it, and calls go straight from this phone to Google.${P.wineKey && !P.cfg.key ? ' Right now Field Unit is borrowing Wine Log\'s key.' : ''}</div>
    <input class="in" id="pzKey" type="password" autocomplete="off" placeholder="${P.cfg.key ? 'Key saved · paste to replace' : 'Paste your key'}" style="margin-top:14px" aria-label="Gemini key">
    <div class="sheet-foot">${P.cfg.key ? '<button type="button" class="btn" id="pzKeyDel">REMOVE</button>' : ''}<button type="button" class="btn primary" id="pzKeySave" style="flex:1">SAVE</button></div>`);
  sh.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) { A.closeSheet(); render(); return; }
    if (e.target.closest('#pzKeyDel')) { saveCfg({ key: '', model: '' }); A.closeSheet(); A.toast('Key removed'); render(); return; }
    if (e.target.closest('#pzKeySave')) {
      const v = A.$('#pzKey', sh).value.trim();
      if (!v) return;
      const b = A.$('#pzKeySave', sh);
      b.textContent = 'CHECKING…';
      const r = await gemini('models?pageSize=1', null, v).catch(() => null);
      if (!r || !r.ok) { b.textContent = 'SAVE'; A.toast(r ? geminiError(r.status, r.json) : 'No signal. Try again.', 3500); return; }
      saveCfg({ key: v, model: '', ttsModel: '' });
      A.closeSheet();
      A.toast('Key saved. Gemini online.');
      render();
    }
  });
}

// ---------------------------------------------------------------- events
function onClick(e) {
  const t = e.target;
  const g = t.closest('[data-pz-go]');
  if (g) { go(g.dataset.pzGo); return; }
  const tk = t.closest('[data-pz-tk]');
  if (tk) { P.tkTab = tk.dataset.pzTk; render(); return; }
  const dn = t.closest('[data-pz-done]');
  if (dn) {
    const task = A.S.tasks.find((x) => x.id === dn.dataset.pzDone);
    if (!task) return;
    if (task.done) A.uncomplete(task.id);
    else { dn.classList.add('ticking'); setTimeout(() => A.completeTask(task.id), 260); }
    return;
  }
  const ta = t.closest('[data-pz-task]');
  if (ta) { const task = A.S.tasks.find((x) => x.id === ta.dataset.pzTask); if (task) A.openTaskEditor(task); return; }
  const ev = t.closest('[data-pz-ev]');
  if (ev) { const x = A.S.events.find((y) => y.id === ev.dataset.pzEv); if (x) A.openEventEditor(x); return; }
  const pj = t.closest('[data-pz-pj]');
  if (pj) { const p = A.projectById(pj.dataset.pzPj); if (p) A.openProject(p); return; }
  const dy = t.closest('[data-pz-day]');
  if (dy) { P.weekSel = dy.dataset.pzDay === 'all' || (P.weekSel && A.U.sameDay(P.weekSel, A.U.addDays(A.U.startOfDay(new Date()), Number(dy.dataset.pzDay)))) ? null : A.U.addDays(A.U.startOfDay(new Date()), Number(dy.dataset.pzDay)); render(); return; }
  const sy = t.closest('[data-pz-say]');
  if (sy) {
    const c = sy.dataset.pzSay;
    if (c === '#week') { go('week'); return; }
    if (c === '#task') { A.openTaskEditor(null); return; }
    openTalk({ say: c });
    return;
  }
  const swb = t.closest('[data-pz-sw]');
  if (swb) { const k = swb.dataset.pzSw; setOpt(k, !opts()[k]); render(); return; }
  const a = t.closest('[data-pz]');
  if (!a) return;
  const act = a.dataset.pz;
  if (act === 'talk') { if (!A.S.deckId) { A.showPairing(); return; } openTalk({ listen: true }); }
  else if (act === 'brief') { P.pendingBrief = false; if (P.state === 'speaking') stopVoice(); else speakBriefing(); }
  else if (act === 'newtask') A.openTaskEditor(null);
  else if (act === 'newproject') A.openProjectEditor(null);
  else if (act === 'newevent') A.openEventEditor(null, P.weekSel || new Date());
  else if (act === 'key') openKeySheet();
  else if (act === 'sample') { A.ac(); speak(`${name()} here. Voice check, ${callsYou()}. All systems nominal.`, { force: true }); }
  else if (act === 'classic') A.classic('notes');
  else if (act === 'classic-cal') A.classic('calendar');
  else if (act === 'classic-settings') A.classic('settings');
  else if (act === 'to-classic') { stopVoice(); A.S.settings.ui = 'classic'; A.S.view = 'settings'; A.saveSettings(); A.render(); A.toast('Classic Field Unit. Switch back at the top of Settings.', 3200); }
}
function onChange(e) {
  const id = e.target.id;
  const v = e.target.value;
  if (id === 'pzVoiceSrc') { setOpt('voiceSrc', v); render(); }
  else if (id === 'pzVoice') { setOpt('voice', v); A.ac(); speak(`${v} online.`, { force: true }); }
  else if (id === 'pzIos') { setOpt('iosVoice', v); A.ac(); speak(`${name()} online.`, { force: true }); }
  else if (id === 'pzPersona') { setOpt('persona', v); P.brief = null; }
  else if (id === 'pzMorningAt' && v) setOpt('morningAt', v);
  else if (id === 'pzEveningAt' && v) setOpt('eveningAt', v);
  else if (id === 'pzName') { setOpt('name', v.trim() || 'Computer'); render(); }
  else if (id === 'pzCalls') { setOpt('callsYou', v.trim()); P.brief = null; }
}
function onInput() { /* names save on change (blur), so typing doesn't redraw */ }

// ---------------------------------------------------------------- conversation (talk)
// The conversation reuses the comms terminal's transcript and command runner in app.js;
// Presence only changes how it looks and adds listening, speaking and Gemini.
export function talkShell() {
  return `<div class="ct-screen pz-talkscr" role="dialog" aria-label="Conversation with ${A.esc(name())}">
    <header class="pz-thead">${orbHtml('talk')}
      <div class="pz-tname"><b>${A.esc(name())}</b><span id="pzStatus">${statusText()}</span></div>
      <button type="button" class="pz-x" data-ct="close" aria-label="Close conversation">${IC.close}</button></header>
    <div class="ct-log pz-log" id="ctLog" aria-live="polite">${A.C.log.map(entryHtml).join('')}<div class="ct-cursor-line" id="ctCursor"></div></div>
    <div class="pz-tfoot">
      <div class="ct-chips pz-tchips" id="ctChips">${A.ctChipsHtml()}</div>
      <form class="ct-form pz-form" id="ctForm" autocomplete="off">
        <div class="pz-field" id="pzField"><input id="ctText" aria-label="Message" placeholder="${thinks() ? 'Type, or tap the mic' : 'Type a command'}" enterkeyhint="send" autocomplete="off"><button type="submit" class="pz-send" aria-label="Send">${IC.send}</button></div>
        <div class="pz-bars" id="pzBars" hidden aria-hidden="true">${Array.from({ length: 24 }, () => '<i></i>').join('')}</div>
        <button type="button" class="pz-mic" id="pzMic" data-ct="mic" aria-label="Talk">${IC.mic}</button>
      </form>
    </div></div>`;
}
function statusText() {
  if (P.state === 'listening') return 'Listening';
  if (P.state === 'thinking') return 'Thinking';
  if (P.state === 'speaking') return `Speaking${opts().voiceSrc === 'gemini' && P.playing && P.playing.src === 'gemini' ? ' · Gemini' : ''}`;
  return thinks() ? 'Ready · built-in + Gemini' : 'Ready · built-in commands';
}
function setState(s) {
  P.state = s;
  const st = A.$('#pzStatus');
  if (st) st.textContent = statusText();
  A.$$('.pz-orbwrap').forEach((el) => { el.classList.remove('listening', 'thinking', 'speaking'); if (s !== 'idle') el.classList.add(s); });
  const mic = A.$('#pzMic');
  if (mic) { mic.classList.toggle('rec', s === 'listening'); mic.innerHTML = s === 'listening' ? IC.stop : IC.mic; mic.setAttribute('aria-label', s === 'listening' ? 'Stop listening' : 'Talk'); }
  const bars = A.$('#pzBars');
  const field = A.$('#pzField');
  if (bars && field) { bars.hidden = s !== 'listening' && s !== 'thinking'; field.hidden = !bars.hidden; bars.classList.toggle('think', s === 'thinking'); }
  const talk = A.$('.pz-talk');
  if (talk) talk.classList.toggle('live', s === 'speaking');
}
export function openTalk({ listen = false, say = '' } = {}) {
  A.ac();
  stopVoice();
  A.openComms();
  if (say) A.submitCommand(say);
  else if (listen && thinks()) startListening();
  else if (listen) setTimeout(() => { const i = A.$('#ctText'); if (i) i.focus(); }, 60);
}
export function onTalkClose() { stopListening(true); stopVoice(); setState('idle'); refresh(); }
export function onTalkMic() {
  A.ac();
  if (P.state === 'listening') { stopListening(); return; }
  if (P.state === 'speaking') stopVoice();
  if (!thinks()) { A.toast(key() ? 'Gemini is off in Settings. Type instead.' : 'Add a Gemini key in Settings to talk. Typing works now.', 3500); const i = A.$('#ctText'); if (i) i.focus(); return; }
  startListening();
}

export function entryHtml(e) {
  const esc = A.esc;
  if (e.k === 'sep') return `<div class="pz-sep" data-e="${e.id}">${esc(e.text)}</div>`;
  if (e.k === 'you') return `<div class="pz-b me" data-e="${e.id}">${e.voice ? '<i class="pz-said" aria-label="Spoken"></i>' : ''}${esc(e.text)}</div>`;
  if (e.k === 'fu') {
    if (e.tone === 'dim' || e.tone === 'sys') return `<div class="pz-note ${e.tone}" data-e="${e.id}"><span class="tx">${esc(e.text)}</span></div>`;
    return `<div class="pz-b ai ${e.tone || ''}" data-e="${e.id}"><span class="tx">${esc(e.text)}</span>${e.src === 'builtin' ? ' <em class="pz-src">· built-in</em>' : ''}</div>`;
  }
  if (e.k === 'card') {
    const head = e.state === 'undone' ? 'Undone' : e.state === 'confirmed' ? 'Deleted' : e.state === 'kept' ? 'Kept' : cap(e.head);
    const canUndo = e.undo && !e.state && A.C.undo.has(e.id);
    const canConfirm = e.confirm && !e.state && A.C.pending && A.C.pending.entry === e.id;
    return `<div class="pz-card2 ${e.state ? `st-${e.state}` : `tone-${e.tone || 'ok'}`}" data-e="${e.id}">
      <div class="pz-ch"><span>${esc(head)}</span>${canUndo ? `<button type="button" class="pz-mini" data-ct="undo" data-id="${e.id}">Undo</button>` : ''}</div>
      ${e.fields && e.fields.length ? `<div class="pz-kv">${e.fields.map(([k, v]) => `<span>${esc(cap(k))}</span><span>${esc(v)}</span>`).join('')}</div>` : ''}
      ${canConfirm ? '<div class="pz-yn"><button type="button" class="pz-no" data-ct="no">Keep it</button><button type="button" class="pz-yes" data-ct="yes">Delete</button></div>' : ''}</div>`;
  }
  if (e.k === 'sugg') {
    const done = e.state === 'added' ? 'Added' : e.state === 'skipped' ? 'Skipped' : '';
    return `<div class="pz-card2 sugg${done ? ' st-done' : ''}" data-e="${e.id}"><div class="pz-ch"><span>${done || 'Suggestion'}</span></div>
      <div class="pz-st2">${esc(e.title)}${e.when ? ` · ${esc(e.when)}` : ''}</div>
      ${done ? '' : `<div class="pz-yn"><button type="button" class="pz-yes" data-ct="sugg-yes" data-id="${e.id}">${esc(e.label || 'Add')}</button><button type="button" class="pz-no" data-ct="sugg-no" data-id="${e.id}">Not now</button></div>`}</div>`;
  }
  return '';
}
const cap = (s) => String(s || '').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export function onSuggestion(id, yes) {
  const ent = A.C.log.find((x) => x.id === id);
  if (!ent || ent.state) return;
  if (yes) {
    const s = ent.s;
    if (s.kind === 'event') A.addEvent(s.title, s.at, s.allDay);
    else if (s.kind === 'note') A.addNote(s.title, s.body || '');
    else A.addTask(s.title, s.at, !s.allDay);
    ent.state = 'added';
    A.ctUpdate(ent);
    A.queueOut(() => A.say(s.kind === 'event' ? 'On the calendar.' : s.kind === 'note' ? 'Noted.' : 'Added.', ''));
  } else {
    ent.state = 'skipped';
    A.ctUpdate(ent);
  }
}

// Lines the built-in runner prints: only the main ones are spoken.
export function voiceLine(text, tone) {
  if (!opts().speak || !A.C.open) return;
  if (tone === 'dim' || tone === 'sys' || tone === 'ok') return;
  speak(text);
}

// ---------------------------------------------------------------- listening
function releaseMic() {
  clearTimeout(P.micIdle);
  if (P.mic && P.mic.stream) P.mic.stream.getTracks().forEach((t) => t.stop());
  if (P.mic && P.mic.ctx) P.mic.ctx.close().catch(() => {});
  P.mic = null;
}
async function startListening() {
  if (P.state === 'listening') return;
  stopVoice();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { A.toast('This browser can\'t use the microphone. Type instead.', 3500); return; }
  clearTimeout(P.micIdle);
  try {
    if (!P.mic) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      src.connect(an);
      src.connect(proc);
      proc.connect(ctx.destination);
      P.mic = { stream, ctx, src, an, proc, chunks: null, rate: ctx.sampleRate };
      proc.onaudioprocess = (ev) => {
        const m = P.mic;
        if (!m || !m.chunks) return;
        m.chunks.push(new Float32Array(ev.inputBuffer.getChannelData(0)));
        // Silence in the output (the processor has to be connected to run).
        ev.outputBuffer.getChannelData(0).fill(0);
      };
    }
    if (P.mic.ctx.state === 'suspended') await P.mic.ctx.resume();
  } catch (err) {
    releaseMic();
    A.toast(/denied|allowed|permission/i.test(String(err && (err.name + err.message))) ? 'Microphone is blocked. Allow it in iPhone Settings › Safari, or type instead.' : 'Couldn\'t open the microphone. Type instead.', 4200);
    return;
  }
  const m = P.mic;
  m.chunks = [];
  m.heard = false;
  m.started = performance.now();
  m.lastLoud = m.started;
  setState('listening');
  const buf = new Uint8Array(m.an.fftSize);
  const bars = A.$$('#pzBars i');
  const tick = () => {
    if (P.mic !== m || !m.chunks) return;
    m.an.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
    const rms = Math.sqrt(sum / buf.length);
    const t = performance.now();
    if (rms > 0.035) { m.lastLoud = t; m.heard = true; }
    bars.forEach((b, i) => { const lvl = Math.min(1, rms * 9 * (0.55 + 0.45 * Math.abs(Math.sin(t / 140 + i * 0.7)))); b.style.transform = `scaleY(${(0.15 + lvl * 0.85).toFixed(2)})`; });
    if (m.heard && t - m.lastLoud > 1400) { stopListening(); return; }
    if (!m.heard && t - m.started > 7000) { stopListening(true); A.toast('Didn\'t catch anything. Tap the mic and try again.'); return; }
    if (t - m.started > 30000) { stopListening(); return; }
    m.raf = requestAnimationFrame(tick);
  };
  m.raf = requestAnimationFrame(tick);
}
function stopListening(cancel = false) {
  const m = P.mic;
  if (!m || !m.chunks) { if (P.state === 'listening') setState('idle'); return; }
  cancelAnimationFrame(m.raf);
  const chunks = m.chunks;
  m.chunks = null;
  // Keep the mic open a little while, so a follow-up doesn't ask for permission again.
  P.micIdle = setTimeout(releaseMic, 120000);
  if (cancel || !m.heard) { setState('idle'); return; }
  const wav = toWav(chunks, m.rate, 16000);
  setState('thinking');
  A.queueOut(() => think({ audio: wav }));
}
function toWav(chunks, rate, out) {
  const len = chunks.reduce((n, c) => n + c.length, 0);
  const all = new Float32Array(len);
  let o = 0;
  chunks.forEach((c) => { all.set(c, o); o += c.length; });
  const ratio = rate / out;
  const n = Math.floor(len / ratio);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (p, s) => { for (let i = 0; i < s.length; i++) v.setUint8(p + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, out, true); v.setUint32(28, out * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    // Average the samples that fold into this one (a simple low-pass before downsampling).
    const a = Math.floor(i * ratio);
    const b = Math.min(len, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let j = a; j < b; j++) s += all[j];
    s = Math.max(-1, Math.min(1, s / Math.max(1, b - a)));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// ---------------------------------------------------------------- Gemini
async function gemini(path, body, k = key()) {
  const res = await fetch(`${API}/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': k },
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* not JSON */ }
  return { status: res.status, ok: res.ok, json };
}
function geminiError(status, json) {
  const msg = (json && json.error && json.error.message) || '';
  if ((status === 400 && /api key/i.test(msg)) || status === 401 || status === 403) return 'Gemini didn\'t accept the key. Check it in Settings.';
  if (status === 429) return 'Gemini\'s free limit is used up for now. Built-in commands still work.';
  if (status >= 500) return 'Gemini is having trouble right now. Try again in a bit.';
  return msg || `Gemini error ${status}`;
}
async function listModels(test) {
  const r = await gemini('models?pageSize=200');
  if (!r.ok) throw new Error(geminiError(r.status, r.json));
  return ((r.json && r.json.models) || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => String(m.name || '').replace(/^models\//, ''))
    .filter(test);
}
// Tries the saved model, then the newest Flash names, then whatever this key lists.
async function generate(body, { tts = false } = {}) {
  const field = tts ? 'ttsModel' : 'model';
  const base = tts ? ['gemini-2.5-flash-preview-tts', 'gemini-2.5-flash-tts'] : ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-2.5-flash'];
  const test = tts ? (n) => /^gemini-/.test(n) && /tts/.test(n) && !/pro/.test(n)
    : (n) => /^gemini-/.test(n) && /flash/.test(n) && !/(image|tts|live|audio|embedding|thinking)/.test(n);
  let queue = [P.cfg[field], ...base].filter(Boolean);
  const tried = new Set();
  let listed = false;
  while (queue.length) {
    const model = queue.shift();
    if (tried.has(model)) continue;
    tried.add(model);
    const r = await gemini(`models/${model}:generateContent`, body);
    if (r.ok) {
      if (model !== P.cfg[field]) saveCfg({ [field]: model });
      return r.json;
    }
    if ((r.status === 404 || (r.status === 400 && /not (found|supported)|modalit/i.test(JSON.stringify(r.json || '')))) && !listed) {
      listed = true;
      queue = queue.concat((await listModels(test)).sort((a, b) => Number(/preview|exp/.test(a)) - Number(/preview|exp/.test(b)) || Number(/lite/.test(a)) - Number(/lite/.test(b))));
      continue;
    }
    if (r.status === 404) continue;
    throw new Error(geminiError(r.status, r.json));
  }
  throw new Error(tts ? 'No Gemini voice is available for this key.' : 'No Gemini model is available for this key.');
}
const textOf = (json) => ((((json && json.candidates) || [])[0] || {}).content || {}).parts || [];

function persona() {
  const o = opts();
  const style = {
    dry: 'Competent and calm with a dry wit, like a ship\'s computer with a warm streak. A light, understated joke now and then, never at the user\'s expense.',
    warm: 'Warm, friendly and encouraging, like a thoughtful assistant who knows the user well.',
    brief: 'Brisk and factual. No jokes, no filler.'
  }[o.persona] || '';
  return `You are ${name()}, the voice of Field Unit, the phone side of ${A.operator()}'s Command Deck (a personal dashboard for tasks, projects, a calendar and notes). Call the user ${callsYou()}. ${style} Your replies are read aloud: short, natural spoken sentences (usually one to three), no lists, no markdown, no emoji. Say times the way people say them.`;
}
function contextBlock() {
  const S = A.S;
  const now = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const f = (d) => `${A.U.DAY_FULL[d.getDay()]} ${A.U.MONTHS[d.getMonth()]} ${d.getDate()} ${A.U.fmtTimeShort(d, A.clock24())}`;
  const tasks = A.sortTasks(A.active(), now).slice(0, 40).map((t) => {
    const p = A.projectById(t.projectId);
    return `- ${t.title}${t.due ? ` (due ${t.dueHasTime ? f(new Date(t.due)) : `${A.U.DAY_FULL[new Date(t.due).getDay()]} ${A.U.MONTHS[new Date(t.due).getMonth()]} ${new Date(t.due).getDate()}`}${A.isOverdue(t, now) ? ', OVERDUE' : ''})` : ''}${t.priority === 'high' ? ' [high priority]' : ''}${p ? ` [project: ${p.name}]` : ''}`;
  });
  const until = A.U.addDays(now, 14);
  const events = A.allEvents().filter((e) => e.end > now && e.start < until).slice(0, 40).map((e) => `- ${e.title}: ${e.allDay ? `${A.U.DAY_FULL[e.start.getDay()]} ${A.U.MONTHS[e.start.getMonth()]} ${e.start.getDate()}, all day` : `${f(e.start)} to ${A.U.fmtTimeShort(e.end, A.clock24())}`}${e.location ? ` at ${e.location}` : ''}`);
  const projects = A.liveProjects().map((p) => { const st = A.projectStats(p); return `- ${p.name}: ${st.done}/${st.total} tasks done${p.due ? `, finish by ${A.projectDueLabel(p)}` : ''}`; });
  const w = S.weather && S.weather.current ? `${Math.round(S.weather.current.temperature_2m)}° and ${A.wxWords(S.weather.current.weather_code)}, high ${Math.round(S.weather.daily.temperature_2m_max[0])}, low ${Math.round(S.weather.daily.temperature_2m_min[0])}` : 'unknown';
  return `Right now: ${f(now)} (${tz}).
Weather: ${w}.
Command Deck (the PC): ${A.commandOnline() ? 'online' : 'offline; changes sync when it wakes'}.
Open tasks:
${tasks.join('\n') || '- none'}
Calendar, next two weeks:
${events.join('\n') || '- nothing'}
Projects:
${projects.join('\n') || '- none'}`;
}
const REPLY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    heard: { type: 'STRING', description: 'Exactly what the user said or typed, written out as plain text.' },
    reply: { type: 'STRING', description: 'Your spoken reply.' },
    suggestion: {
      type: 'OBJECT', nullable: true,
      description: 'Only when adding something would clearly help and the user did not already ask for it plainly. Otherwise null.',
      properties: {
        kind: { type: 'STRING', enum: ['task', 'event', 'note'] },
        title: { type: 'STRING', description: 'Short title, sentence case.' },
        at: { type: 'STRING', nullable: true, description: 'Local date-time as YYYY-MM-DDTHH:MM, or a date as YYYY-MM-DD, or null.' },
        label: { type: 'STRING', description: 'Two or three word button text, e.g. Add reminder.' }
      },
      required: ['kind', 'title', 'label']
    }
  },
  required: ['heard', 'reply']
};

// One round with Gemini: typed text it couldn't parse, or a spoken clip.
export async function think({ text = '', audio = null } = {}) {
  setState('thinking');
  if (!navigator.onLine) { setState('idle'); A.C.src = 'builtin'; return A.say('No signal for Gemini right now. Built-in commands still work.', 'err'); }
  const hist = A.C.log.filter((e) => (e.k === 'you' || (e.k === 'fu' && !e.tone)) && e.text).slice(-12, audio ? undefined : -1)
    .map((e) => ({ role: e.k === 'you' ? 'user' : 'model', parts: [{ text: e.text }] }));
  const contents = [];
  hist.forEach((h) => { const last = contents[contents.length - 1]; if (last && last.role === h.role) last.parts.push(...h.parts); else contents.push(h); });
  if (contents.length && contents[0].role === 'model') contents.shift();
  const user = audio
    ? { role: 'user', parts: [{ text: 'The user said this out loud (audio attached). Write down what they said in "heard", then answer.' }, { inlineData: { mimeType: 'audio/wav', data: audio } }] }
    : { role: 'user', parts: [{ text }] };
  if (contents.length && contents[contents.length - 1].role === 'user') contents[contents.length - 1].parts.push(...user.parts);
  else contents.push(user);
  const body = {
    systemInstruction: { parts: [{ text: `${persona()}\n\nUse only the information below about the user's day; if something isn't there, say you don't have it. You can't change their tasks or calendar yourself: when adding something would help, offer it as a suggestion and mention it briefly.\n\n${contextBlock()}` }] },
    contents,
    generationConfig: { responseMimeType: 'application/json', responseSchema: REPLY_SCHEMA, temperature: 0.6, maxOutputTokens: 600 }
  };
  let out;
  try {
    const json = await generate(body);
    out = JSON.parse(textOf(json).map((p) => p.text || '').join('').replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch (err) {
    setState('idle');
    A.C.src = 'builtin';
    return A.say(err && err.message ? err.message : 'Gemini sent back something unreadable. Try again.', 'err');
  }
  const heard = String(out.heard || '').trim();
  if (audio) {
    if (!heard) { setState('idle'); A.C.src = 'builtin'; return A.say('Didn\'t catch that. Try again?', 'err'); }
    A.ctAdd({ k: 'you', text: heard, voice: true });
    // Something the built-in commands know: they do it (and it syncs), not Gemini.
    if (A.knows(heard)) { setState('idle'); return A.runCommand(heard); }
  }
  A.C.src = 'gemini';
  setState('idle');
  await A.say(String(out.reply || 'Hm. I have nothing useful on that.').trim(), '');
  const s = out.suggestion;
  if (s && s.title) {
    const at = parseAt(s.at);
    A.ctAdd({ k: 'sugg', s: { kind: s.kind, title: String(s.title).slice(0, 120), at: at ? at.d.toISOString() : null, allDay: at ? at.allDay : true }, title: String(s.title).slice(0, 120), when: at ? whenShort(at.d, at.allDay) : '', label: String(s.label || 'Add').slice(0, 24) });
  }
  A.C.src = null;
}
function parseAt(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(v || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), m[4] ? Number(m[4]) : 0, m[5] ? Number(m[5]) : 0);
  return isNaN(d) ? null : { d, allDay: !m[4] };
}
async function geminiBriefing() {
  const o = opts();
  const hr = new Date().getHours();
  const evening = o.evening && hr >= Number(String(o.eveningAt).slice(0, 2));
  const body = {
    systemInstruction: { parts: [{ text: `${persona()}\n\n${contextBlock()}` }] },
    contents: [{ role: 'user', parts: [{ text: evening
      ? 'Give my evening wrap-up in two or three short spoken sentences: anything still late, and the first thing tomorrow. Plain text only.'
      : 'Give my briefing in two or three short spoken sentences: greet me for the time of day, anything overdue first, then the next thing coming up. Plain text only.' }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 200 }
  };
  const json = await generate(body);
  return textOf(json).map((p) => p.text || '').join(' ').replace(/\s+/g, ' ').trim().slice(0, 400);
}

// ---------------------------------------------------------------- speaking
function iosVoices() {
  try { return (window.speechSynthesis ? speechSynthesis.getVoices() : []).filter((v) => /^en/i.test(v.lang)).sort((a, b) => Number(/premium|enhanced/i.test(b.name)) - Number(/premium|enhanced/i.test(a.name)) || a.name.localeCompare(b.name)); } catch (e) { return []; }
}
if (typeof window !== 'undefined' && window.speechSynthesis) speechSynthesis.onvoiceschanged = () => { if (on() && P.view === 'settings' && !A.C.open) refresh(); };

export function stopVoice() {
  P.voiceQ = Promise.resolve();
  P.voiceGen = (P.voiceGen || 0) + 1;
  if (P.playing && P.playing.stop) try { P.playing.stop(); } catch (e) { /* already done */ }
  P.playing = null;
  try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) { /* none */ }
  if (P.state === 'speaking') setState('idle');
}
function speak(text, { force = false } = {}) {
  if (!text || (!force && !opts().speak)) return Promise.resolve();
  const gen = P.voiceGen || 0;
  P.voiceQ = P.voiceQ.then(async () => {
    if (gen !== (P.voiceGen || 0)) return;
    const useGemini = opts().voiceSrc === 'gemini' && key() && navigator.onLine && Date.now() > P.ttsDownUntil;
    if (useGemini) {
      try { await sayGemini(text, gen); return; } catch (e) { P.ttsDownUntil = Date.now() + 10 * 60000; }
    }
    if (gen !== (P.voiceGen || 0)) return;
    await sayIphone(text);
  });
  return P.voiceQ;
}
async function sayGemini(text, gen) {
  const body = {
    contents: [{ parts: [{ text: `Say in a calm, low, warm voice${opts().persona === 'dry' ? ' with a hint of dry humor' : ''}: ${text}` }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: opts().voice || 'Charon' } } } }
  };
  setState('speaking');
  const json = await generate(body, { tts: true });
  if (gen !== (P.voiceGen || 0)) return;
  const part = textOf(json).find((p) => p.inlineData && p.inlineData.data);
  if (!part) throw new Error('no audio');
  const rate = Number((/rate=(\d+)/.exec(part.inlineData.mimeType || '') || [])[1]) || 24000;
  const bin = atob(part.inlineData.data);
  const n = bin.length >> 1;
  const c = A.ac();
  const buf = c.createBuffer(1, n, rate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < n; i++) { let v = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8); if (v >= 0x8000) v -= 0x10000; ch[i] = v / 0x8000; }
  await new Promise((resolve) => {
    const s = c.createBufferSource();
    s.buffer = buf;
    s.connect(c.destination);
    s.onended = resolve;
    P.playing = { src: 'gemini', stop: () => { s.onended = null; s.stop(); resolve(); } };
    setState('speaking');
    s.start();
  });
  P.playing = null;
  if (gen === (P.voiceGen || 0)) setState('idle');
}
function sayIphone(text) {
  if (!window.speechSynthesis) return Promise.resolve();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    const want = opts().iosVoice;
    const vs = iosVoices();
    const v = (want && vs.find((x) => x.voiceURI === want)) || vs.find((x) => /premium|enhanced/i.test(x.name)) || null;
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = 1;
    u.pitch = 0.92;
    u.onend = () => { P.playing = null; setState('idle'); resolve(); };
    u.onerror = u.onend;
    P.playing = { src: 'iphone', stop: () => { speechSynthesis.cancel(); resolve(); } };
    setState('speaking');
    speechSynthesis.speak(u);
  });
}
