// Field Unit Terminal (v1.30): two premium looks for the phone, picked in Settings › Interface.
//
//   Cockpit  – after Starfield's cockpit: slate plates with clipped corners, inset cyan
//              screens, a dot-matrix clock, hardware keys with status lights, an orange
//              PRIORITY plate, red only for overdue.
//   Hairline – after Cyclical / Anomaly Detected: black and white, thin lines, a big light
//              clock and the week drawn as an orbit. One red dot for anything late.
//
// Both draw their own Today and Queue screens here. Comms, Calendar, Notes, Settings and the
// editor sheets are the classic screens, restyled by terminal.css (data-theme is set to the
// look). Classic stays a third choice. Everything behind the screens is shared.

let A = null; // app.js hooks
const T = { view: 'home', tab: 'queue' };
export const LOOKS = ['cockpit', 'hairline'];

export function initTerminal(api) { A = api; }
export const look = () => (LOOKS.includes(A.S.settings.ui) ? A.S.settings.ui : null);
export const on = () => !!look();
export const live = () => on() && !A.S.peek;

const FONTS = 'https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Condensed:wght@500;600;700&family=Doto:wght@600;800&family=JetBrains+Mono:wght@400;500&family=Inter+Tight:wght@200;300;400;500&family=Space+Mono:wght@400;700&display=swap';
// A start page cached from before this version has no link to the styles or fonts: add them.
function ensureStyles() {
  if (!document.querySelector('link[href$="terminal.css"]')) {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'terminal.css';
    document.head.appendChild(css);
  }
  if (!document.querySelector('link[href*="family=Doto"]')) {
    const f = document.createElement('link');
    f.rel = 'stylesheet';
    f.href = FONTS;
    document.head.appendChild(f);
  }
}

// ---------------------------------------------------------------- shell
export function mount() {
  ensureStyles();
  const lv = live();
  document.body.classList.toggle('ft-live', lv);
  document.body.classList.toggle('ft-cockpit', look() === 'cockpit');
  document.body.classList.toggle('ft-hairline', look() === 'hairline');
  let root = A.$('#ft');
  if (!lv) { if (root) root.innerHTML = ''; return; }
  if (!root) {
    root = document.createElement('div');
    root.id = 'ft';
    document.body.insertBefore(root, A.$('#overlay'));
    root.addEventListener('click', onClick);
    root.addEventListener('submit', onSubmit);
  }
}
export function render() {
  mount();
  if (!live()) return;
  const root = A.$('#ft');
  const sc = A.$('.ft-scroll', root);
  const keep = sc && root.dataset.v === T.view ? sc.scrollTop : 0;
  root.dataset.v = T.view;
  root.dataset.look = look();
  const L = look() === 'cockpit' ? C : H;
  root.innerHTML = `<div class="ft-scroll">${T.view === 'tasks' ? L.tasks() : L.home()}</div>`;
  const sc2 = A.$('.ft-scroll', root);
  if (sc2) sc2.scrollTop = keep;
}
export function go(v) { T.view = v; render(); const sc = A.$('#ft .ft-scroll'); if (sc) sc.scrollTop = 0; }

// ---------------------------------------------------------------- data
const two = (n) => String(n).padStart(2, '0');
function clockParts(d) {
  if (A.clock24()) return { hm: `${two(d.getHours())}:${two(d.getMinutes())}`, ap: '' };
  const h = d.getHours() % 12 || 12;
  return { hm: `${two(h)}:${two(d.getMinutes())}`, ap: d.getHours() < 12 ? 'AM' : 'PM' };
}
const dayPct = (now) => Math.min(100, Math.max(0, Math.round(((now - A.U.startOfDay(now)) / 864e5) * 100)));
const dayShort = (d) => A.U.DAY_FULL[d.getDay()].slice(0, 3).toUpperCase();
const monShort = (d) => A.U.MONTHS[d.getMonth()].slice(0, 3).toUpperCase();
const tm = (d) => A.U.fmtTimeShort(d, A.clock24());
function weather() {
  const w = A.S.weather && A.S.weather.current;
  return w ? { t: `${Math.round(w.temperature_2m)}°`, words: String(A.wxWords(w.weather_code) || '').toUpperCase() } : null;
}
function span(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m}M`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}H ${two(m % 60)}M`;
  return `${Math.round(h / 24)} DAYS`;
}
function lateBy(t, now) {
  const d = new Date(t.due);
  if (!t.dueHasTime && A.U.sameDay(d, now)) return 'DUE TODAY';
  if (!t.dueHasTime) { const days = Math.round((A.U.startOfDay(now) - A.U.startOfDay(d)) / 864e5); return days === 1 ? 'SINCE YESTERDAY' : `${days} DAYS LATE`; }
  return `${span(now - d)} LATE`;
}
function buckets(now) {
  const list = A.active();
  const over = A.sortTasks(list.filter((t) => A.isOverdue(t, now)), now);
  const today = A.sortTasks(list.filter((t) => !A.isOverdue(t, now) && t.due && A.U.sameDay(new Date(t.due), now)), now);
  const later = A.sortTasks(list.filter((t) => !A.isOverdue(t, now) && !(t.due && A.U.sameDay(new Date(t.due), now))), now);
  return { list, over, today, later };
}
function nextThing(now) {
  const ev = A.allEvents().find((e) => (e.allDay ? A.U.startOfDay(e.end) > now && e.start >= A.U.startOfDay(now) : e.start > now));
  const t = A.sortTasks(A.active().filter((x) => x.due && x.dueHasTime && new Date(x.due) > now), now)[0];
  const tAt = t ? new Date(t.due) : null;
  if (ev && (!tAt || ev.start <= tAt)) return { title: ev.title, at: ev.start, end: ev.end, allDay: ev.allDay, place: ev.location || '', data: ev.local ? `data-ft-ev="${A.esc(ev.id)}"` : 'data-ft="agenda"' };
  if (t) return { title: t.title, at: tAt, allDay: false, place: '', data: `data-ft-task="${A.esc(t.id)}"` };
  return null;
}
function whenLine(x, now) {
  const d = x.at;
  const day = A.U.sameDay(d, now) ? 'TODAY' : A.U.sameDay(d, A.U.addDays(now, 1)) ? 'TOMORROW' : `${dayShort(d)} ${d.getDate()}`;
  if (x.allDay) return `${day} · ALL DAY`;
  return `${day} ${tm(d)}${x.end && !x.allDay ? ` – ${tm(x.end)}` : ''}`;
}
function upcoming(now, days, max) {
  const end = A.U.addDays(A.U.startOfDay(now), days);
  return A.allEvents().filter((e) => e.end > now && e.start < end).slice(0, max);
}
function taskWhen(t, now) {
  if (t.done) return t.doneAt ? `${dayShort(new Date(t.doneAt))}` : 'DONE';
  if (!t.due) return '';
  if (A.isOverdue(t, now)) return 'LATE';
  const d = new Date(t.due);
  if (A.U.sameDay(d, now)) return t.dueHasTime ? tm(d) : 'TODAY';
  return `${dayShort(d)} ${d.getDate()}`;
}
function taskMeta(t, now) {
  const p = A.projectById(t.projectId);
  const cat = A.categoryById(t.category);
  const subs = t.subtasks && t.subtasks.length ? `${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length}` : '';
  const due = t.done ? 'DONE' : !t.due ? 'NO DATE' : A.isOverdue(t, now) ? lateBy(t, now) : A.dueLabel(t, now);
  return [p ? p.name : cat ? cat.name : '', due, subs].filter(Boolean).join(' · ').toUpperCase();
}
function lists(now) {
  const b = buckets(now);
  const q = (arr) => arr.filter((t) => A.inQueue(t, now));
  return { ...b, queue: q(b.over).concat(q(b.today), q(b.later)), tucked: b.list.filter((t) => !A.inQueue(t, now)).length };
}
const done = () => A.S.tasks.filter((t) => t.done).sort((a, b) => new Date(b.doneAt || 0) - new Date(a.doneAt || 0)).slice(0, 30);

const IC = {
  back: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3L5 8L10 13" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  send: '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M3 9H14M9.5 4.5L14 9L9.5 13.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  gear: '<svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="2.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 2.5v2.2M10 15.3v2.2M2.5 10h2.2M15.3 10h2.2M4.7 4.7l1.6 1.6M13.7 13.7l1.6 1.6M4.7 15.3l1.6-1.6M13.7 6.3l1.6-1.6" stroke="currentColor" stroke-width="1.5"/></svg>',
  check: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5L5 9L10 3" fill="none" stroke="currentColor" stroke-width="2"/></svg>'
};
const cmdForm = (cls, ph) => `<form class="${cls}" data-ft-form autocomplete="off"><label for="ftCmd" class="ft-pr">${look() === 'cockpit' ? '›' : '&gt;'}</label><input id="ftCmd" placeholder="${ph}" enterkeyhint="send" autocomplete="off" spellcheck="false" aria-label="Command">${look() === 'cockpit' ? `<button type="submit" class="ftc-send" aria-label="Send">${IC.send}</button>` : '<button type="submit" class="fth-send">SEND ↵</button>'}</form>`;

// ================================================================ COCKPIT
const C = {
  home() {
    const S = A.S;
    const now = new Date();
    const { hm, ap } = clockParts(now);
    const w = weather();
    const pct = dayPct(now);
    const b = buckets(now);
    const nx = nextThing(now);
    const online = A.commandOnline();
    const circ = 2 * Math.PI * 44;
    const seg = b.over.slice(0, 1).map(() => 'late').concat(b.today.map(() => 'today'), b.later.map(() => '')).slice(0, 6);
    while (seg.length < 4) seg.push('off');
    const ag = upcoming(now, 5, 4);
    const pri = b.over[0];
    return `<section class="ftc">
      <header class="ftc-top">
        <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true"><path d="M14 2 L26 9 V19 L14 26 L2 19 V9 Z" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M14 8 L20 11.5 V16.5 L14 20 L8 16.5 V11.5 Z" fill="rgba(122,214,232,0.18)" stroke="currentColor" stroke-width="1"/></svg>
        <div class="ftc-id"><b>FIELD UNIT</b><span class="ftc-code">${/^field unit$/i.test(String(S.settings.callsign || 'Field Unit').trim()) ? '' : `${A.esc(String(S.settings.callsign).toUpperCase())} · `}COMMAND DECK LINK</span></div>
        <span class="ftc-lab ftc-link"><i class="ftc-led${online ? '' : ' off'}"></i>${online ? 'DECK ONLINE' : 'DECK ASLEEP'}</span>
        <button type="button" class="ftc-key sq" data-ft="settings" aria-label="Settings">${IC.gear}</button>
      </header>

      <section class="ftc-plate" aria-label="Clock and day">
        <div class="ftc-ph"><span class="ftc-lab hi">01 · CHRONO</span><span class="ftc-code">NAV-CLK</span></div>
        <div class="ftc-screen ftc-chrono">
          <div class="ftc-cl">
            <div class="ftc-dot ftc-time">${hm}${ap ? `<small>${ap}</small>` : ''}</div>
            <div class="ftc-date"><span>${dayShort(now)} ${now.getDate()} ${monShort(now)}</span>${w ? `<b>${w.t}</b><span>${A.esc(w.words)}</span>` : ''}</div>
          </div>
          <svg class="ftc-ring" width="112" height="112" viewBox="0 0 120 120" role="img" aria-label="Day ${pct} percent through">
            <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(122,214,232,0.14)" stroke-width="1"/>
            <circle cx="60" cy="60" r="44" fill="none" stroke="rgba(122,214,232,0.1)" stroke-width="6"/>
            <circle cx="60" cy="60" r="44" fill="none" stroke="#7AD6E8" stroke-width="2" stroke-dasharray="${(circ * pct / 100).toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 60 60)" class="ftc-arc"/>
            <g stroke="rgba(159,230,242,0.5)" stroke-width="1"><path d="M60 4V10M116 60H110M60 116V110M4 60H10"/></g>
            <g class="ftc-orbit"><circle cx="60" cy="8" r="2.5" fill="#F08A3C"/></g>
            <text x="60" y="60" text-anchor="middle" class="ftc-ringn">${pct}</text>
            <text x="60" y="76" text-anchor="middle" class="ftc-ringl">DAY ELAPSED</text>
          </svg>
        </div>
      </section>

      ${pri ? `<button type="button" class="ftc-warn" data-ft-task="${A.esc(pri.id)}"><span class="ftc-warnk"><span class="ftc-pulse">▲ PRIORITY</span></span><span class="ftc-warnt">${A.esc(pri.title)} · ${A.esc(lateBy(pri, now).toLowerCase())}${b.over.length > 1 ? ` · +${b.over.length - 1}` : ''}</span></button>` : ''}

      <div class="ftc-two">
        <button type="button" class="ftc-plate ftc-next" ${nx ? nx.data : 'data-ft="agenda"'} aria-label="Next">
          <span class="ftc-ph"><span class="ftc-lab">02 · NEXT</span>${nx ? `<span class="ftc-code">IN ${span(nx.at - now)}</span>` : ''}</span>
          <span class="ftc-nt">${nx ? A.esc(nx.title) : 'Clear skies'}</span>
          <span class="ftc-nw">${nx ? A.esc(whenLine(nx, now)) : 'NOTHING SCHEDULED'}</span>
          ${nx && nx.place ? `<span class="ftc-code ftc-np">${A.esc(nx.place.toUpperCase())}</span>` : ''}
        </button>
        <button type="button" class="ftc-plate ftc-q" data-ft="tasks" aria-label="Queue, ${b.list.length} open">
          <span class="ftc-lab">03 · QUEUE</span>
          <span class="ftc-qn"><span class="ftc-dot">${two(b.list.length)}</span><span class="ftc-lab hi">OPEN</span></span>
          <span class="ftc-segs" aria-hidden="true">${seg.slice(0, 6).map((s) => `<i class="${s}"></i>`).join('')}</span>
        </button>
      </div>

      <section class="ftc-plate" aria-label="Flight plan">
        <div class="ftc-ph"><span class="ftc-lab">04 · FLIGHT PLAN</span><span class="ftc-code">NEXT 5 DAYS</span></div>
        ${ag.length ? ag.map((e) => `<button type="button" class="ftc-ag" ${e.local ? `data-ft-ev="${A.esc(e.id)}"` : 'data-ft="agenda"'}>
          <span class="ftc-agd">${A.U.sameDay(e.start, now) ? 'TODAY' : `${dayShort(e.start)} ${two(e.start.getDate())}`}</span>
          <i class="ftc-agdot" style="--c:${A.esc(e.color || '#7AD6E8')}"></i>
          <span class="ftc-agt">${A.esc(e.title)}</span>
          <span class="ftc-code">${e.allDay ? 'ALL DAY' : A.esc(tm(e.start))}</span></button>`).join('') : '<div class="ftc-empty">Clear skies. Nothing on the calendar.</div>'}
      </section>

      <div class="ftc-fill"></div>
      <div class="ftc-keys">
        <button type="button" class="ftc-key" data-ft-say="status report"><i class="ftc-led"></i>BRIEF</button>
        <button type="button" class="ftc-key" data-ft="agenda"><i class="ftc-led off"></i>AGENDA</button>
        <button type="button" class="ftc-key" data-ft="tasks"><i class="ftc-led off"></i>QUEUE</button>
        <button type="button" class="ftc-key" data-ft="notes"><i class="ftc-led off"></i>NOTES</button>
      </div>
      ${cmdForm('ftc-plate ftc-cmd', 'Type a command')}
    </section>`;
  },

  tasks() {
    const now = new Date();
    const L = lists(now);
    const tab = (v, l) => `<button type="button" role="tab" aria-selected="${T.tab === v}" class="ftc-key${T.tab === v ? ' on' : ''}" data-ft-tab="${v}"><i class="ftc-led${T.tab === v ? '' : ' off'}"></i>${l}</button>`;
    const row = (t) => {
      const late = !t.done && A.isOverdue(t, now);
      const today = !t.done && !late && t.due && A.U.sameDay(new Date(t.due), now);
      const cls = t.done ? 'done' : late ? 'late' : today ? 'today' : '';
      const tag = taskWhen(t, now);
      return `<div class="ftc-plate ftc-row ${cls}">
        <button type="button" class="ftc-chk" data-ft-done="${A.esc(t.id)}" aria-label="${t.done ? 'Mark not done' : 'Mark done'}: ${A.esc(t.title)}">${t.done ? IC.check : ''}</button>
        <button type="button" class="ftc-rmain" data-ft-task="${A.esc(t.id)}"><span class="ftc-rt">${A.esc(t.title)}</span><span class="ftc-code">${A.esc(taskMeta(t, now))}</span></button>
        ${tag ? `<span class="ftc-tag ${cls}">${A.esc(late ? 'OVERDUE' : tag)}</span>` : ''}</div>`;
    };
    let body = '';
    if (T.tab === 'queue') {
      body = L.queue.length ? L.queue.slice(0, 40).map(row).join('') : '<div class="ftc-empty">Queue clear. Enjoy it.</div>';
      if (L.tucked) body += `<button type="button" class="ftc-tucked" data-ft-tab="projects">${L.tucked} MORE IN PROJECTS ›</button>`;
    } else if (T.tab === 'projects') {
      const pj = A.liveProjects();
      body = pj.length ? pj.map((p) => {
        const st = A.projectStats(p);
        const n = Math.min(10, Math.max(st.total, 1));
        const on = st.total ? Math.round((st.done / st.total) * n) : 0;
        return `<button type="button" class="ftc-plate ftc-pj" data-ft-pj="${A.esc(p.id)}">
          <span class="ftc-ph"><span class="ftc-lab">PROJECT · ${A.esc(p.name.toUpperCase())}</span><span class="ftc-code">${st.done} / ${st.total}</span></span>
          <span class="ftc-pjbar" aria-hidden="true">${Array.from({ length: n }, (_, i) => `<i class="${i < on ? 'on' : ''}"></i>`).join('')}</span>
          <span class="ftc-pjn"><span>${st.next ? `Next: ${A.esc(st.next.title)}` : st.total ? 'All tasks done' : 'No tasks yet'}</span>${p.due ? `<span class="ftc-code">${A.esc(A.projectDueLabel(p).toUpperCase())}</span>` : ''}</span></button>`;
      }).join('') : '<div class="ftc-empty">No projects running.</div>';
      body += '<button type="button" class="ftc-key wide" data-ft="newproject">+ NEW PROJECT</button>';
    } else {
      const d = done();
      body = d.length ? d.map(row).join('') : '<div class="ftc-empty">Nothing finished yet.</div>';
    }
    const tally = T.tab === 'queue' ? `<section class="ftc-plate ftc-tally" aria-label="Tally">
      <div><span class="ftc-dot late">${two(L.over.length)}</span><span class="ftc-lab">OVERDUE</span></div>
      <div><span class="ftc-dot today">${two(L.today.length)}</span><span class="ftc-lab">TODAY</span></div>
      <div><span class="ftc-dot">${two(L.later.length)}</span><span class="ftc-lab">LATER</span></div></section>` : '';
    return `<section class="ftc">
      <header class="ftc-top">
        <button type="button" class="ftc-key sq" data-ft-go="home" aria-label="Back to Today">${IC.back}</button>
        <div class="ftc-id"><b>QUEUE</b><span class="ftc-code">${L.list.length} OPEN · ${L.over.length} OVERDUE · ${L.today.length} TODAY</span></div>
        <button type="button" class="ftc-key sq" data-ft="newtask" aria-label="Add a task">+</button>
      </header>
      <div class="ftc-tabs" role="tablist" aria-label="View">${tab('queue', 'QUEUE')}${tab('projects', 'PROJECTS')}${tab('done', 'DONE')}</div>
      <div class="ftc-list">${body}</div>
      <div class="ftc-fill"></div>
      ${tally}
    </section>`;
  }
};

// ================================================================ HAIRLINE
const H = {
  home() {
    const S = A.S;
    const now = new Date();
    const { hm, ap } = clockParts(now);
    const w = weather();
    const pct = dayPct(now);
    const b = buckets(now);
    const pri = b.over[0];
    const rest = A.sortTasks(b.list.filter((t) => t !== pri && A.inQueue(t, now)), now).slice(0, 3);
    return `<section class="fth">
      <header class="fth-top"><span class="fth-brand">FIELD UNIT</span><span class="fth-sm">${w ? `${A.esc(w.t)} / ${A.esc(w.words)}` : ''}</span>
        <button type="button" class="fth-icon" data-ft="settings" aria-label="Settings">${IC.gear}</button></header>
      <div class="fth-clock"><div class="fth-time">${hm}${ap ? `<small>${ap}</small>` : ''}</div><div class="fth-sm fth-date">${dayShort(now)}<br>${two(now.getDate())}.${two(now.getMonth() + 1)}.${String(now.getFullYear()).slice(2)}</div></div>
      ${H.orbit(now, pct, pri)}
      ${pri ? `<button type="button" class="fth-late" data-ft-task="${A.esc(pri.id)}"><i></i><span>${A.esc(pri.title)}</span><span class="fth-sm red">LATE${b.over.length > 1 ? ` +${b.over.length - 1}` : ''}</span></button>` : ''}
      <section class="fth-q" aria-label="Queue">
        <button type="button" class="fth-sm fth-qh" data-ft="tasks"><span>QUEUE</span><span>${two(b.list.length)} OPEN ›</span></button>
        ${rest.length ? rest.map((t) => `<button type="button" class="fth-row" data-ft-task="${A.esc(t.id)}"><span class="fth-sm">${A.esc(taskWhen(t, now) || '—')}</span><span class="fth-rt">${A.esc(t.title)}</span><span class="fth-sm">${A.esc(((A.projectById(t.projectId) || A.categoryById(t.category) || {}).name || '').toUpperCase())}</span></button>`).join('') : `<div class="fth-empty">${pri ? 'Nothing else waiting.' : 'Nothing waiting. Quiet orbit.'}</div>`}
      </section>
      <div class="fth-fill"></div>
      <div class="fth-keys">
        <button type="button" class="fth-key" data-ft-say="status report">BRIEF</button><button type="button" class="fth-key" data-ft="agenda">AGENDA</button><button type="button" class="fth-key" data-ft="tasks">QUEUE</button><button type="button" class="fth-key" data-ft="notes">NOTES</button>
      </div>
      ${cmdForm('fth-cmd', 'command')}
    </section>`;
  },

  // Today in the middle; the coming week's events as points around it (nearer days on the
  // inner ring), placed by time of week, clockwise from the top.
  orbit(now, pct, pri) {
    const cx = 150; const cy = 150;
    const start = A.U.startOfDay(now);
    const evs = upcoming(now, 7, 12).filter((e) => !(A.U.sameDay(e.start, now) && !e.allDay && e.start < now)).slice(0, 5);
    const pts = evs.map((e, i) => {
      const off = Math.max(0, (e.start - start) / 864e5);
      const r = off < 1 ? 86 : off < 3 ? 108 : 132;
      const a = ((off / 7) * 360 - 90) * (Math.PI / 180);
      const x = cx + Math.cos(a) * r; const y = cy + Math.sin(a) * r;
      const right = x >= cx;
      const lx = right ? Math.min(262, x + 10) : Math.max(54, x - 10);
      const when = A.U.sameDay(e.start, now) ? `TODAY ${e.allDay ? '' : tm(e.start)}` : `${dayShort(e.start)} ${e.allDay ? '' : tm(e.start)}`;
      const title = e.title.length > 14 ? `${e.title.slice(0, 13)}…` : e.title;
      return { x, y, lx, ly: y + (y < cy ? -4 : 8), anchor: right ? 'start' : 'end', big: i === 0, when: when.trim().toUpperCase(), title: title.toUpperCase(), id: e.local ? e.id : '' };
    });
    const arcEnd = ((pct / 100) * 360 - 90) * (Math.PI / 180);
    const ex = cx + Math.cos(arcEnd) * 68; const ey = cy + Math.sin(arcEnd) * 68;
    const large = pct > 50 ? 1 : 0;
    const lateDot = pri ? `<circle class="fth-blink" cx="${(cx + Math.cos(-2.2) * 68).toFixed(1)}" cy="${(cy + Math.sin(-2.2) * 68).toFixed(1)}" r="4" fill="#FF4D3D"/>` : '';
    return `<section class="fth-orbit" aria-label="This week as an orbit">
      <svg width="390" height="300" viewBox="-45 0 390 300" role="img" aria-label="Today at the center, ${pts.length} upcoming event${pts.length === 1 ? '' : 's'} around it">
        <g fill="none" stroke="rgba(255,255,255,0.1)"><circle cx="${cx}" cy="${cy}" r="132"/><circle cx="${cx}" cy="${cy}" r="108"/></g>
        <circle cx="${cx}" cy="${cy}" r="68" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="1"/>
        ${pct > 0 ? `<path d="M${cx} ${cy - 68} A68 68 0 ${large} 1 ${ex.toFixed(1)} ${ey.toFixed(1)}" fill="none" stroke="#FFFFFF" stroke-width="2"/>` : ''}
        <g class="fth-spin" fill="none" stroke="rgba(255,255,255,0.32)" stroke-dasharray="1 5"><circle cx="${cx}" cy="${cy}" r="86"/></g>
        <g stroke="rgba(255,255,255,0.5)" stroke-width="0.8">${pts.map((p) => `<line x1="${cx}" y1="${cy}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}"/>`).join('')}</g>
        <circle cx="${cx}" cy="${cy}" r="3" fill="#fff"/>
        ${pts.map((p) => (p.big ? `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="8" fill="#000" stroke="#fff" stroke-width="1.2"/><circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.5" fill="#fff"/>` : `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.5" fill="#000" stroke="#fff" stroke-width="1.1"/>`)).join('')}
        ${lateDot}
        <g class="fth-lbl">${pts.map((p) => `<text x="${p.lx.toFixed(1)}" y="${p.ly.toFixed(1)}" text-anchor="${p.anchor}">${A.esc(p.when)}</text><text x="${p.lx.toFixed(1)}" y="${(p.ly + 12).toFixed(1)}" text-anchor="${p.anchor}" class="d">${A.esc(p.title)}</text>`).join('')}</g>
        <text x="${cx}" y="${cy - 4}" text-anchor="middle" class="fth-pct">${pct}</text>
        <text x="${cx}" y="${cy + 12}" text-anchor="middle" class="fth-pctl">% OF DAY</text>
        ${pts.length ? '' : `<text x="${cx}" y="${cy + 104}" text-anchor="middle" class="fth-pctl">NO EVENTS THIS WEEK</text>`}
      </svg>
      <button type="button" class="fth-orbitbtn" data-ft="agenda" aria-label="Open the calendar"></button>
      ${pri ? `<div class="fth-vert" aria-hidden="true">OVERDUE · ${A.esc(lateBy(pri, now).replace(' LATE', ''))}</div>` : ''}
    </section>`;
  },

  tasks() {
    const now = new Date();
    const L = lists(now);
    // The week as a line: each task due in the next 7 days is a dot; late ones sit at the start.
    const weekStart = A.U.startOfDay(now);
    const W = 346;
    const xOf = (d) => 12 + Math.min(1, Math.max(0, (d - weekStart) / (7 * 864e5))) * (W - 24);
    const nowX = xOf(now);
    const dots = L.list.filter((t) => t.due && new Date(t.due) < A.U.addDays(weekStart, 7)).map((t) => {
      const late = A.isOverdue(t, now);
      const x = late ? 4 : xOf(new Date(t.due));
      return `<circle cx="${x.toFixed(1)}" cy="7" r="3.5" ${late ? 'fill="#FF4D3D"' : x <= nowX + 30 ? 'fill="#fff"' : 'fill="#000" stroke="#fff"'}/>`;
    }).join('');
    const tab = (v, l) => `<button type="button" role="tab" aria-selected="${T.tab === v}" class="fth-tab${T.tab === v ? ' on' : ''}" data-ft-tab="${v}">${l}</button>`;
    const row = (t) => {
      const late = !t.done && A.isOverdue(t, now);
      const when = late ? lateBy(t, now) : taskWhen(t, now);
      const p = A.projectById(t.projectId);
      const cat = A.categoryById(t.category);
      return `<div class="fth-trow${t.done ? ' done' : ''}">
        <button type="button" class="fth-box" data-ft-done="${A.esc(t.id)}" aria-label="${t.done ? 'Mark not done' : 'Mark done'}: ${A.esc(t.title)}">${t.done ? IC.check : ''}</button>
        <button type="button" class="fth-tmain" data-ft-task="${A.esc(t.id)}"><span class="fth-rt">${A.esc(t.title)}</span><span class="fth-sm">${A.esc(((p || cat || {}).name || (t.due ? '' : 'NO DATE')).toUpperCase())}</span></button>
        ${when ? `<span class="fth-sm${late ? ' red fth-blink' : t.due && A.U.sameDay(new Date(t.due), now) ? ' hi' : ''}">${A.esc(when)}</span>` : ''}</div>`;
    };
    let body = '';
    if (T.tab === 'queue') {
      body = L.queue.length ? L.queue.slice(0, 40).map(row).join('') : '<div class="fth-empty">Queue clear.</div>';
      if (L.tucked) body += `<button type="button" class="fth-sm fth-more" data-ft-tab="projects">${L.tucked} MORE IN PROJECTS ›</button>`;
    } else if (T.tab === 'projects') {
      const pj = A.liveProjects();
      body = pj.length ? pj.map((p) => {
        const st = A.projectStats(p);
        const n = Math.max(2, Math.min(10, st.total || 2));
        const at = st.total ? Math.round((st.done / st.total) * (n - 1)) : 0;
        const step = (W - 8) / (n - 1);
        return `<button type="button" class="fth-pj" data-ft-pj="${A.esc(p.id)}">
          <span class="fth-sm fth-pjh"><span>${A.esc(p.name.toUpperCase())}</span><span class="hi">${st.done} / ${st.total}</span></span>
          <svg width="${W}" height="14" viewBox="0 0 ${W} 14" aria-hidden="true"><line x1="4" y1="7" x2="${W - 4}" y2="7" stroke="rgba(255,255,255,0.18)"/>${st.done ? `<line x1="4" y1="7" x2="${(4 + at * step).toFixed(1)}" y2="7" stroke="#fff" stroke-width="1.5"/>` : ''}${Array.from({ length: n }, (_, i) => `<circle cx="${(4 + i * step).toFixed(1)}" cy="7" r="3" fill="#000" stroke="${i <= at && st.done ? '#fff' : 'rgba(255,255,255,0.35)'}"/>`).join('')}</svg>
          <span class="fth-pjn">${st.next ? `Next: ${A.esc(st.next.title)}` : st.total ? 'All tasks done' : 'No tasks yet'}${p.due ? ` · ${A.esc(A.projectDueLabel(p))}` : ''}</span></button>`;
      }).join('') : '<div class="fth-empty">No projects running.</div>';
      body += '<button type="button" class="fth-sm fth-more" data-ft="newproject">+ NEW PROJECT</button>';
    } else {
      const d = done();
      body = d.length ? d.map(row).join('') : '<div class="fth-empty">Nothing finished yet.</div>';
    }
    return `<section class="fth">
      <header class="fth-top"><button type="button" class="fth-sm fth-link" data-ft-go="home">← TODAY</button><button type="button" class="fth-sm fth-link" data-ft="newtask">+ ADD</button></header>
      <div class="fth-clock"><div class="fth-time">${two(L.list.length)}</div><div class="fth-sm fth-date"><span class="red">${two(L.over.length)} LATE</span><br>${two(L.today.length)} TODAY<br>${two(L.later.length)} LATER</div></div>
      <svg class="fth-week" width="${W}" height="14" viewBox="0 0 ${W} 14" aria-hidden="true"><line x1="0" y1="7" x2="${W}" y2="7" stroke="rgba(255,255,255,0.18)"/><line x1="${nowX.toFixed(1)}" y1="0" x2="${nowX.toFixed(1)}" y2="14" stroke="#fff"/>${dots}</svg>
      <div class="fth-sm fth-wl"><span>NOW</span><span>+7 DAYS</span></div>
      <div class="fth-tabs" role="tablist" aria-label="View">${tab('queue', 'QUEUE')}${tab('projects', 'PROJECTS')}${tab('done', 'DONE')}</div>
      <div class="fth-list">${body}</div>
    </section>`;
  }
};

// ---------------------------------------------------------------- events
function onSubmit(e) {
  if (!e.target.closest('[data-ft-form]')) return;
  e.preventDefault();
  const i = A.$('#ftCmd');
  const text = i ? i.value.trim() : '';
  if (!A.S.deckId) { A.showPairing(); return; }
  A.openComms();
  if (text) A.submitCommand(text);
}
function onClick(e) {
  const t = e.target;
  const g = t.closest('[data-ft-go]');
  if (g) { go(g.dataset.ftGo); return; }
  const tb = t.closest('[data-ft-tab]');
  if (tb) { T.tab = tb.dataset.ftTab; render(); return; }
  const dn = t.closest('[data-ft-done]');
  if (dn) {
    const task = A.S.tasks.find((x) => x.id === dn.dataset.ftDone);
    if (!task) return;
    if (task.done) A.uncomplete(task.id);
    else { dn.classList.add('ticking'); setTimeout(() => A.completeTask(task.id), 240); }
    return;
  }
  const ta = t.closest('[data-ft-task]');
  if (ta) { const task = A.S.tasks.find((x) => x.id === ta.dataset.ftTask); if (task) A.openTaskEditor(task); return; }
  const ev = t.closest('[data-ft-ev]');
  if (ev) { const x = A.S.events.find((y) => y.id === ev.dataset.ftEv); if (x) A.openEventEditor(x); else A.classic('calendar'); return; }
  const pj = t.closest('[data-ft-pj]');
  if (pj) { const p = A.projectById(pj.dataset.ftPj); if (p) A.openProject(p); return; }
  const sy = t.closest('[data-ft-say]');
  if (sy) { if (!A.S.deckId) { A.showPairing(); return; } A.openComms(); A.submitCommand(sy.dataset.ftSay); return; }
  const a = t.closest('[data-ft]');
  if (!a) return;
  const act = a.dataset.ft;
  if (act === 'tasks') go('tasks');
  else if (act === 'agenda') A.classic('calendar');
  else if (act === 'notes') A.classic('notes');
  else if (act === 'settings') A.classic('settings');
  else if (act === 'newtask') A.openTaskEditor(null);
  else if (act === 'newproject') A.openProjectEditor(null);
}
