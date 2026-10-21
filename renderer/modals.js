// Task editor, event editor, settings and first-run setup.
import * as U from './util.js';
import { NEURAL_VOICES } from './tts.js';

const { $, $$, esc } = U;
let app = null;
let current = null;

const PRI = { high: ['HIGH', 'var(--coral)'], medium: ['MED', 'var(--amber)'], low: ['LOW', 'var(--lav)'] };
const REMINDERS = [[null, 'NONE'], [0, 'AT DUE TIME'], [5, '5 MIN BEFORE'], [10, '10 MIN BEFORE'], [15, '15 MIN BEFORE'], [30, '30 MIN BEFORE'], [60, '1 HOUR BEFORE'], [120, '2 HOURS BEFORE'], [1440, '1 DAY BEFORE']];
const REPEATS = [['none', 'NONE'], ['daily', 'DAILY'], ['weekdays', 'WEEKDAYS'], ['weekly', 'WEEKLY'], ['monthly', 'MONTHLY'], ['yearly', 'YEARLY']];
const PALETTE = ['#A8B0D8', '#F4B6A0', '#B8E27A', '#D9A9C6', '#7FD1C7', '#F2A65A', '#FF8A78', '#E8D58B'];
const THEMES = [
  ['dusk', 'DUSK', ['#F2A65A', '#A8B0D8']], ['space', 'DEEP SPACE', ['#4FD1E8', '#9FB7FF']], ['red', 'RED ALERT', ['#FF4D4D', '#FFD27A']],
  ['terminal', 'TERMINAL', ['#39FF88', '#1F3328']], ['retro', 'RETRO', ['#5EE7FF', '#FF7BD5']],
  ['moonbase', "MOONBASE '79", ['#F05A1A', '#E4E6E9']], ['blueprint', 'BLUEPRINT', ['#8EC5FF', '#0E2A47']],
  ['cryo', 'CRYO', ['#2D8CFF', '#D6E7F3']], ['freighter', 'FREIGHTER', ['#9CF2A8', '#E8C547']]
];
const FONTS = [
  ['auto', 'THEME DEFAULT', ''], ['chakra', 'CHAKRA', "'Chakra Petch'"], ['michroma', 'MICHROMA', "'Michroma'"],
  ['spacemono', 'SPACE MONO', "'Space Mono'"], ['exo2', 'EXO 2', "'Exo 2'"], ['b612', 'B612 MONO', "'B612 Mono'"],
  ['vt323', 'VT323', "'VT323'"], ['orbitron', 'ORBITRON', "'Orbitron'"], ['oxanium', 'OXANIUM', "'Oxanium'"],
  ['rajdhani', 'RAJDHANI', "'Rajdhani'"], ['sharetech', 'SHARE TECH MONO', "'Share Tech Mono'"], ['majormono', 'MAJOR MONO', "'Major Mono Display'"]
];
const INKS = [['theme', 'THEME', null], ['amber', 'AMBER CRT', '#FFC27A'], ['phosphor', 'PHOSPHOR', '#A8F5B4'], ['ice', 'ICE', '#CFE6FF'], ['arctic', 'ARCTIC', '#FFFFFF'], ['rose', 'ROSE', '#F6C1CF']];
const FRAMES = [['dark', 'DARK', '#14151B'], ['bone', 'BONE', '#EEDDC3'], ['gunmetal', 'GUNMETAL', '#3A3E44'], ['olive', 'OLIVE DRAB', '#4A5236'], ['navy', 'MIDNIGHT NAVY', '#16264A']];
const TRIMS = [['none', 'NONE', []], ['sunset', 'SUNSET', ['#B5432A', '#E07A2E', '#E9B23B']], ['mission', 'MISSION', ['#E5532D', '#EADBC2', '#3F68A6']], ['arcade', 'ARCADE', ['#D6457E', '#F08A3C', '#F2C94C', '#3FB3A8']],
  ['hazard', 'HAZARD', ['#E8C547', '#1A1A1A', '#E8C547', '#1A1A1A']], ['aurora', 'AURORA', ['#2BB3A3', '#6FD08C', '#8E6CD8']], ['gulf', 'GULF', ['#8FC1E3', '#F28A2E', '#8FC1E3']]];
const X_SVG = '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2 L8 8 M8 2 L2 8" stroke="currentColor" stroke-width="1.4"/></svg>';

export function initModals(api) {
  app = api;
}

export function isModalOpen() {
  return !!current;
}

export function closeModal(force = false) {
  if (!current) return;
  if (current.locked && !force) return;
  const { el, onClose } = current;
  current = null;
  el.remove();
  if (onClose) onClose();
}

function mount(html, { wide = false, locked = false, onClose = null } = {}) {
  closeModal(true);
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  $('#modalRoot').appendChild(back);
  back.addEventListener('mousedown', (e) => { if (e.target === back) closeModal(); });
  current = { el: back, locked, onClose };
  const m = back.querySelector('.modal');
  $$('[data-x]', m).forEach((b) => b.addEventListener('click', () => closeModal(true)));
  return m;
}

function pills(options, value, attrs = '') {
  return options.map(([v, label, color]) =>
    `<button type="button" class="pill${String(value) === String(v) ? ' on' : ''}" data-v="${esc(v)}" ${color ? `style="--pc:${esc(color)}"` : ''} ${attrs}>${esc(label)}</button>`).join('');
}

function wirePills(container, onPick) {
  container.addEventListener('click', (e) => {
    const b = e.target.closest('.pill');
    if (!b || !container.contains(b)) return;
    $$('.pill', container).forEach((p) => p.classList.toggle('on', p === b));
    app.sounds.click();
    onPick(b.dataset.v);
  });
}

function switchHtml(id, on, label) {
  return `<button type="button" class="switch" id="${id}" role="switch" aria-checked="${on ? 'true' : 'false'}" aria-label="${esc(label)}"><i></i></button>`;
}

function wireSwitch(el, onChange) {
  el.addEventListener('click', () => {
    const next = el.getAttribute('aria-checked') !== 'true';
    el.setAttribute('aria-checked', next ? 'true' : 'false');
    app.sounds.click();
    onChange(next);
  });
}

// ================================================================ TASK EDITOR
export function openTaskEditor(task, preset = {}) {
  const S = app.S;
  const isNew = !task;
  const t = U.clone(task || { ...app.blankTask(), ...preset });
  t.repeat = t.repeat || { type: 'none', interval: 1, days: [] };
  t.repeat.days = t.repeat.days || [];
  t.subtasks = t.subtasks || [];

  const cats = [['', 'NONE']].concat(S.settings.categories.map((c) => [c.id, c.name.toUpperCase(), c.color]));
  const people = [['', 'NONE']].concat(S.settings.people.map((p) => [p, p.toUpperCase()]));
  if (t.assignee && !S.settings.people.includes(t.assignee)) people.push([t.assignee, t.assignee.toUpperCase()]);

  const projOpts = [['', 'NONE']].concat((S.projects || []).filter((p) => p.status !== 'done' || p.id === t.projectId).map((p) => [p.id, p.name.toUpperCase()]));
  const m = mount(`
    <i class="br br-tr amber"></i><i class="br br-bl lav"></i>
    <div class="m-head"><span>${isNew ? 'NEW TASK' : 'TASK EDITOR'}</span><button type="button" class="x-btn" data-x aria-label="Close">${X_SVG}</button></div>
    <form class="m-body scroll" id="tkForm" autocomplete="off">
      <div class="f"><label class="f-label" for="tTitle">DESIGNATION</label><input id="tTitle" class="in title" value="${esc(t.title)}" placeholder="What needs doing?" spellcheck="true"></div>
      <div class="f-row">
        <div class="f"><label class="f-label" for="tDate">DUE DATE</label><input id="tDate" class="in" type="date" value="${U.toDateInput(t.due)}"></div>
        <div class="f"><label class="f-label" for="tTime">TIME · OPTIONAL</label><input id="tTime" class="in" type="time" value="${t.dueHasTime ? U.toTimeInput(t.due) : ''}"></div>
      </div>
      <div class="f-row">
        <div class="f"><span class="f-label">PRIORITY</span><div class="pills" id="tPri">${pills(Object.entries(PRI).map(([k, [l, c]]) => [k, l, c]), t.priority)}</div></div>
        <div class="f"><span class="f-label">ASSIGNED TO</span><div class="pills" id="tWho">${pills(people, t.assignee || '')}</div></div>
      </div>
      <div class="f"><span class="f-label">CATEGORY</span><div class="pills" id="tCat">${pills(cats, t.category || '')}</div></div>
      ${projOpts.length > 1 ? `<div class="f"><label class="f-label" for="tProj">PROJECT</label><select id="tProj" class="sel">${projOpts.map(([v, l]) => `<option value="${esc(v)}"${(t.projectId || '') === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>` : ''}
      <div class="f-row">
        <div class="f"><label class="f-label" for="tRem">REMINDER</label>
          <select id="tRem" class="sel">${REMINDERS.map(([v, l]) => `<option value="${v == null ? '' : v}"${t.reminder === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="f"><label class="f-label" for="tRep">REPEAT</label>
          <select id="tRep" class="sel">${REPEATS.map(([v, l]) => `<option value="${v}"${t.repeat.type === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
      </div>
      <div class="f" id="tDaysWrap" ${t.repeat.type === 'weekly' ? '' : 'hidden'}>
        <span class="f-label">REPEAT ON</span>
        <div class="days" id="tDays">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => `<button type="button" class="pill${t.repeat.days.includes(i) ? ' on' : ''}" data-d="${i}" aria-label="${U.DAY_FULL[i]}">${d}</button>`).join('')}</div>
      </div>
      <div class="f-hint" id="tHint"></div>
      <div class="f">
        <span class="f-label" style="display:flex;justify-content:space-between"><span>SUBTASKS</span><span id="tSubCount" class="ok-t"></span></span>
        <div class="sub-list" id="tSubs"></div>
        <button type="button" class="link-btn" id="tAddSub">+ ADD SUBTASK</button>
      </div>
      <div class="f"><label class="f-label" for="tNotes">NOTES</label><textarea id="tNotes" class="ta" placeholder="Details, links, anything worth remembering">${esc(t.notes || '')}</textarea></div>
    </form>
    <div class="m-foot">
      ${isNew ? '' : '<button type="button" class="btn danger" id="tDel">DELETE</button>'}
      <div class="right"><button type="button" class="btn line" data-x>CANCEL</button><button type="button" class="btn primary" id="tSave">${isNew ? 'LOG TASK' : 'SAVE TASK'}</button></div>
    </div>`);

  const hint = () => {
    const parts = [];
    const date = $('#tDate', m).value;
    const time = $('#tTime', m).value;
    if (t.reminder != null && !date) parts.push('Reminders need a due date.');
    else if (t.reminder != null && !time) parts.push('Date-only tasks remind at 9:00 AM on the day.');
    if (t.repeat.type !== 'none') parts.push('Checking off a repeating task rolls it to its next date.');
    $('#tHint', m).textContent = parts.join(' ');
  };

  const renderSubs = () => {
    $('#tSubs', m).innerHTML = t.subtasks.map((s, i) => `
      <div class="sub-item${s.done ? ' done' : ''}" data-i="${i}">
        <input type="checkbox" ${s.done ? 'checked' : ''} aria-label="Subtask done">
        <input class="in" value="${esc(s.text)}" placeholder="Subtask" aria-label="Subtask text">
        <button type="button" class="x-btn rm" aria-label="Remove subtask">${X_SVG}</button>
      </div>`).join('');
    const done = t.subtasks.filter((s) => s.done).length;
    $('#tSubCount', m).textContent = t.subtasks.length ? `${done} / ${t.subtasks.length}` : '';
  };
  renderSubs();
  hint();

  wirePills($('#tPri', m), (v) => { t.priority = v; });
  wirePills($('#tWho', m), (v) => { t.assignee = v || null; });
  wirePills($('#tCat', m), (v) => { t.category = v || null; });
  if ($('#tProj', m)) $('#tProj', m).addEventListener('change', (e) => { t.projectId = e.target.value || null; });
  $('#tRem', m).addEventListener('change', (e) => { t.reminder = e.target.value === '' ? null : Number(e.target.value); hint(); });
  $('#tRep', m).addEventListener('change', (e) => {
    t.repeat.type = e.target.value;
    $('#tDaysWrap', m).hidden = t.repeat.type !== 'weekly';
    hint();
  });
  $('#tDate', m).addEventListener('change', hint);
  $('#tTime', m).addEventListener('change', hint);
  $('#tDays', m).addEventListener('click', (e) => {
    const b = e.target.closest('.pill');
    if (!b) return;
    const d = Number(b.dataset.d);
    const set = new Set(t.repeat.days);
    if (set.has(d)) set.delete(d); else set.add(d);
    t.repeat.days = [...set].sort();
    b.classList.toggle('on', set.has(d));
  });
  $('#tSubs', m).addEventListener('input', (e) => {
    const row = e.target.closest('.sub-item');
    if (!row) return;
    const s = t.subtasks[Number(row.dataset.i)];
    if (e.target.type === 'checkbox') { s.done = e.target.checked; row.classList.toggle('done', s.done); renderSubs(); }
    else s.text = e.target.value;
  });
  $('#tSubs', m).addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList.contains('in')) {
      e.preventDefault();
      $('#tAddSub', m).click();
    }
  });
  $('#tSubs', m).addEventListener('click', (e) => {
    const rm = e.target.closest('.rm');
    if (!rm) return;
    t.subtasks.splice(Number(rm.closest('.sub-item').dataset.i), 1);
    renderSubs();
  });
  $('#tAddSub', m).addEventListener('click', () => {
    t.subtasks.push({ id: U.uid(), text: '', done: false });
    renderSubs();
    const inputs = $$('#tSubs .in', m);
    inputs[inputs.length - 1].focus();
  });
  $('#tkForm', m).addEventListener('submit', (e) => { e.preventDefault(); $('#tSave', m).click(); });

  $('#tSave', m).addEventListener('click', () => {
    const title = $('#tTitle', m).value.trim();
    if (!title) { $('#tTitle', m).focus(); app.toast('Give the task a name first'); return; }
    const date = $('#tDate', m).value;
    const time = $('#tTime', m).value;
    const due = U.fromInputs(date, time);
    t.title = title;
    t.due = due ? due.toISOString() : null;
    t.dueHasTime = !!(date && time);
    t.notes = $('#tNotes', m).value;
    if (t.repeat.type !== 'none' && !t.due) t.due = U.startOfDay(new Date()).toISOString();
    if (t.repeat.type === 'weekly' && !t.repeat.days.length && t.due) t.repeat.days = [new Date(t.due).getDay()];
    if (t.repeat.type !== 'weekly') t.repeat.days = [];
    t.subtasks = t.subtasks.filter((s) => s.text.trim());
    app.upsertTask(t, isNew);
    closeModal(true);
    app.toast(isNew ? 'Task logged' : 'Task updated');
  });
  if (!isNew) {
    $('#tDel', m).addEventListener('click', () => {
      app.deleteTask(t.id);
      closeModal(true);
      app.toast('Task deleted');
    });
  }
  setTimeout(() => $('#tTitle', m).focus(), 30);
}

// ================================================================ EVENT EDITOR
export function openEventEditor(ev, date) {
  const isNew = !ev;
  let e;
  if (ev) e = U.clone(ev);
  else {
    const now = new Date();
    const s = new Date(date || now);
    if (U.sameDay(s, now)) s.setHours(now.getHours() + 1, 0, 0, 0);
    else s.setHours(9, 0, 0, 0);
    e = { id: U.uid(), title: '', start: s.toISOString(), end: new Date(s.getTime() + 3600000).toISOString(), allDay: false, notes: '' };
  }
  const m = mount(`
    <i class="br br-tr lav"></i><i class="br br-bl peach"></i>
    <div class="m-head"><span>${isNew ? 'NEW EVENT' : 'EVENT'} · ${esc((app.S.settings.localCalendarName || 'Local').toUpperCase())} CALENDAR</span><button type="button" class="x-btn" data-x aria-label="Close">${X_SVG}</button></div>
    <form class="m-body scroll" id="evForm" autocomplete="off">
      <div class="f"><label class="f-label" for="eTitle">EVENT</label><input id="eTitle" class="in title" value="${esc(e.title)}" placeholder="What's happening?"></div>
      <div class="f-row">
        <div class="f"><label class="f-label" for="eDate">DATE</label><input id="eDate" class="in" type="date" value="${U.toDateInput(e.start)}"></div>
        <div class="f"><span class="f-label">ALL DAY</span><div class="toggle-row" style="box-shadow:none;padding:0;height:38px"><span>No set time</span>${switchHtml('eAll', e.allDay, 'All day')}</div></div>
      </div>
      <div class="f-row" id="eTimes" ${e.allDay ? 'hidden' : ''}>
        <div class="f"><label class="f-label" for="eStart">STARTS</label><input id="eStart" class="in" type="time" value="${U.toTimeInput(e.start)}"></div>
        <div class="f"><label class="f-label" for="eEnd">ENDS</label><input id="eEnd" class="in" type="time" value="${U.toTimeInput(e.end)}"></div>
      </div>
      <div class="f"><label class="f-label" for="eNotes">NOTES</label><textarea id="eNotes" class="ta" placeholder="Location, details">${esc(e.notes || '')}</textarea></div>
      <div class="f-hint">Events added here live on this computer in the ${esc(app.S.settings.localCalendarName || 'Local')} calendar. Linked calendars are read-only.</div>
    </form>
    <div class="m-foot">
      ${isNew ? '' : '<button type="button" class="btn danger" id="eDel">DELETE</button>'}
      <div class="right"><button type="button" class="btn line" data-x>CANCEL</button><button type="button" class="btn primary" id="eSave">${isNew ? 'SCHEDULE' : 'SAVE EVENT'}</button></div>
    </div>`);

  wireSwitch($('#eAll', m), (on) => { e.allDay = on; $('#eTimes', m).hidden = on; });
  $('#evForm', m).addEventListener('submit', (x) => { x.preventDefault(); $('#eSave', m).click(); });
  $('#eSave', m).addEventListener('click', () => {
    const title = $('#eTitle', m).value.trim();
    const date = $('#eDate', m).value;
    if (!title) { $('#eTitle', m).focus(); app.toast('Give the event a name first'); return; }
    if (!date) { $('#eDate', m).focus(); app.toast('Pick a date'); return; }
    let start;
    let end;
    if (e.allDay) {
      start = U.fromInputs(date, '');
      end = U.addDays(start, 1);
    } else {
      start = U.fromInputs(date, $('#eStart', m).value || '09:00');
      end = U.fromInputs(date, $('#eEnd', m).value || '');
      if (!end || end <= start) end = new Date(start.getTime() + 3600000);
    }
    const out = { ...e, title, start: start.toISOString(), end: end.toISOString(), notes: $('#eNotes', m).value };
    app.upsertLocalEvent(out, isNew);
    closeModal(true);
    app.toast(isNew ? 'Event scheduled' : 'Event updated');
  });
  if (!isNew) {
    $('#eDel', m).addEventListener('click', () => {
      app.deleteLocalEvent(e.id);
      closeModal(true);
      app.toast('Event deleted');
    });
  }
  setTimeout(() => $('#eTitle', m).focus(), 30);
}

// ================================================================ PROJECTS
const SHARE_SVG = '<svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true"><circle cx="3.2" cy="7" r="1.8" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="10.8" cy="3" r="1.8" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="10.8" cy="11" r="1.8" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M4.8 6.1 L9.2 3.9 M4.8 7.9 L9.2 10.1" stroke="currentColor" stroke-width="1.2"/></svg>';
const CREW_COLORS = ['#B8E27A', '#D9A9C6', '#A8B0D8', '#F4B6A0', '#4FD1E8', '#F2A65A'];
const LEVEL_INFO = [
  ['check', 'CHECK OFF ONLY', 'They can tick tasks done, and untick a mistake.'],
  ['notes', 'CHECK OFF + NOTES', 'Also leave notes on tasks and post to the project log.'],
  ['helper', 'PROJECT ADMINISTRATOR', 'Also add new tasks, edit them and delete them.']
];
const END_INFO = [['done', 'WHEN PROJECT IS DONE'], ['week', 'IN 7 DAYS'], ['never', 'NEVER']];
const levelName = (l) => (LEVEL_INFO.find((x) => x[0] === l) || LEVEL_INFO[0])[1];
function crewAvatars(list, size = 20) {
  return list.slice(0, 4).map((c, i) => `<span class="crew-av" style="width:${size}px;height:${size}px;background:${CREW_COLORS[i % CREW_COLORS.length]}">${esc((c.guest || '?').slice(0, 1).toUpperCase())}</span>`).join('');
}
function whenShort(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return U.sameDay(d, new Date()) ? U.fmtTimeShort(d, app.S.settings.clock24) : `${U.MON[d.getMonth()]} ${d.getDate()}`;
}

export function openProject(p) {
  const S = app.S;
  let logOpen = false;
  const draw = () => {
    const proj = S.projects.find((x) => x.id === p.id);
    if (!proj) { app.setProjectRefresh(null); closeModal(true); return; }
    // Keep a half-typed log post across live refreshes.
    const prevIn = document.querySelector('#pjLogIn');
    const keepText = prevIn ? prevIn.value : '';
    const keepFocus = prevIn && prevIn === document.activeElement;
    const st = app.projectStats(proj);
    const col = proj.color || 'var(--amber)';
    const now = new Date();
    const open = st.tasks.filter((t) => !t.done);
    const done = st.tasks.filter((t) => t.done);
    const crew = app.fieldUnit.shares(proj.id);
    const log = (proj.log || []).slice().sort((a, b) => (b.at || 0) - (a.at || 0));
    const withComments = (t) => app.taskRow(t, now) + ((t.comments || []).length
      ? `<div class="crew-notes">${t.comments.slice(-2).map((c) => `<div class="crew-note"><span>${esc((c.by || '').toUpperCase())} · ${whenShort(c.at)}</span>${esc(c.text)}</div>`).join('')}</div>` : '');
    const m = mount(`
      <i class="br br-tr amber"></i><i class="br br-bl lav"></i>
      <div class="m-head"><span>PROJECT</span>
        <span class="m-head-r">${crew.length ? `<button type="button" class="crew-chip" id="pjCrew" aria-label="Manage who this project is shared with"><span class="crew-avs">${crewAvatars(crew, 18)}</span>CREW · ${crew.length}</button>` : ''}
        <button type="button" class="x-btn" data-x aria-label="Close">${X_SVG}</button></span></div>
      <div class="m-body scroll pj-detail" style="--pc:${esc(col)}">
        <div class="pj-hero">
          <div style="min-width:0">
            <div class="pj-eyebrow">${esc(app.projectDueLabel(proj, now))}</div>
            <div class="pj-title">${esc(proj.name)}</div>
          </div>
          <div class="pj-big"><b>${st.pct}%</b><span>COMPLETE</span></div>
        </div>
        <div class="pj-meter"><i style="width:${st.pct}%"></i></div>
        ${proj.goal ? `<div class="pj-goal">${esc(proj.goal)}</div>` : ''}
        <div class="pj-log${logOpen ? ' open' : ''}">
          <button type="button" class="pj-log-head" id="pjLogToggle" aria-expanded="${logOpen}"><span>PROJECT LOG · ${log.length}</span><span>${logOpen ? 'CLOSE' : log.length ? 'OPEN ›' : 'POST ›'}</span></button>
          ${!logOpen && log.length ? `<div class="pj-log-peek"><b>${esc(log[0].by)}:</b> ${esc(log[0].text)}</div>` : ''}
          ${logOpen ? `<form class="pj-log-form" id="pjLogForm" autocomplete="off"><input id="pjLogIn" class="in" maxlength="1000" placeholder="Post a note for the whole project…"><button type="submit" class="btn primary">POST</button></form>
            ${log.length ? log.slice(0, 30).map((e) => `<div class="pj-log-item"><span>${esc((e.by || '').toUpperCase())} · ${whenShort(e.at)}</span>${esc(e.text)}</div>`).join('') : '<div class="f-hint">No posts yet. Crew you share this project with can post here too.</div>'}` : ''}
        </div>
        <div class="tk-sep"><span>NEXT UP · ${open.length} OPEN</span></div>
        <div class="pj-tasks">${open.length ? open.map(withComments).join('') : '<div class="empty">Every task is done. Add another, or mark the project complete.</div>'}</div>
        ${done.length ? `<div class="tk-sep"><span>DONE · ${done.length}</span></div><div class="pj-tasks">${done.map(withComments).join('')}</div>` : ''}
      </div>
      <div class="m-foot">
        <button type="button" class="btn line" id="pjEdit">EDIT</button>
        <button type="button" class="btn line share-btn" id="pjShare">${SHARE_SVG}SHARE</button>
        ${st.total && !open.length ? '<button type="button" class="btn line" id="pjDone">MARK COMPLETE</button>' : ''}
        <div class="right"><button type="button" class="btn primary" id="pjAdd">+ ADD TASK</button></div>
      </div>`, { wide: true, onClose: () => app.setProjectRefresh(null) });
    app.setProjectRefresh(draw);
    m.querySelector('.pj-detail').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      const row = btn && btn.closest('.tk');
      const t = row && S.tasks.find((x) => x.id === row.dataset.id);
      if (!t) return;
      if (btn.dataset.act === 'toggle') { if (t.done) app.uncompleteTask(t.id); else app.completeTask(t.id); draw(); }
      else if (btn.dataset.act === 'edit') openTaskEditor(t);
    });
    $('#pjLogToggle', m).addEventListener('click', () => { logOpen = !logOpen; draw(); if (logOpen) setTimeout(() => { const i = $('#pjLogIn'); if (i) i.focus(); }, 30); });
    const lf = $('#pjLogForm', m);
    if (lf) {
      const li = $('#pjLogIn', m);
      li.value = keepText;
      if (keepFocus) li.focus();
      lf.addEventListener('submit', (e) => { e.preventDefault(); const v = li.value.trim(); if (!v) return; li.value = ''; app.postProjectLog(proj.id, v); });
    }
    $('#pjEdit', m).addEventListener('click', () => openProjectEditor(proj));
    $('#pjShare', m).addEventListener('click', () => openShareDialog(proj));
    const crewBtn = $('#pjCrew', m);
    if (crewBtn) crewBtn.addEventListener('click', () => openShareDialog(proj));
    $('#pjAdd', m).addEventListener('click', () => openTaskEditor(null, { projectId: proj.id, category: null }));
    const doneBtn = $('#pjDone', m);
    if (doneBtn) doneBtn.addEventListener('click', () => { app.completeProject(proj.id); closeModal(true); app.toast(`Project complete: ${proj.name}`); });
  };
  draw();
}

// ================================================================ SHARE (PROJECT MANIFEST)
export function openShareDialog(proj) {
  const FU = app.fieldUnit;
  const draft = { guest: '', level: 'notes', ends: 'done' };
  let made = null; // { token, url, qr, guest }
  let busy = false;
  const draw = () => {
    const ready = FU.state().sharing;
    const crew = FU.shares(proj.id);
    const prevName = document.querySelector('#shName');
    if (prevName) draft.guest = prevName.value;
    const m = mount(`
      <i class="br br-tr amber"></i><i class="br br-bl lav"></i>
      <div class="m-head"><span>SHARE · ${esc(proj.name.toUpperCase())}</span><button type="button" class="x-btn" data-x aria-label="Close">${X_SVG}</button></div>
      <div class="m-body scroll">
        ${!ready ? `<div class="sh-warn">Sharing uses the Field Unit link (Firebase), the same one your phone syncs through. ${FU.state().linked ? 'It is reconnecting. Try again in a moment.' : 'Set it up first in <b>Settings › Field Unit</b>.'}</div>` : ''}
        <div class="sh-grid">
          <div>
            ${made ? `<div class="sh-made"><div class="sh-made-h">✓ PROJECT MANIFEST READY · ${esc(made.guest.toUpperCase())}</div>
                <div class="sh-link">${esc(made.url)}</div>
                <div class="f-hint">Send this link to ${esc(made.guest)}, or let them scan the code. It opens in any browser. No app or account.</div>
                <div class="sh-made-btns"><button type="button" class="btn primary" id="shCopy">COPY LINK</button><button type="button" class="btn line" id="shAnother">+ SHARE WITH SOMEONE ELSE</button></div></div>`
            : `<div class="f"><label class="f-label" for="shName">WHO'S IT FOR?</label><input id="shName" class="in title" maxlength="40" placeholder="Their name" value="${esc(draft.guest)}"></div>
              <div class="f"><span class="f-label">WHAT CAN THEY DO?</span><div class="sh-levels">${LEVEL_INFO.map(([v, l, d]) => `<button type="button" class="sh-level${draft.level === v ? ' on' : ''}" data-level="${v}"><i></i><span><b>${l}</b><small>${d}</small></span></button>`).join('')}</div></div>
              <div class="f"><span class="f-label">LINK STOPS WORKING</span><div class="pills">${END_INFO.map(([v, l]) => `<button type="button" class="pill${draft.ends === v ? ' on' : ''}" data-ends="${v}">${l}</button>`).join('')}</div></div>
              <button type="button" class="btn primary block" id="shCreate" ${ready && !busy ? '' : 'disabled'}>${busy ? 'CREATING…' : 'CREATE LINK'}</button>`}
          </div>
          <div class="sh-qr">${made && made.qr ? `<img src="${made.qr}" alt="QR code for ${esc(made.guest)}'s link"><span class="f-hint">Scan with a phone camera to open.</span>` : '<div class="sh-qr-empty">The QR code appears here once you create a link.</div>'}</div>
        </div>
        <div class="tk-sep"><span>PEOPLE WITH ACCESS · ${crew.length}</span></div>
        ${crew.length ? crew.map((c, i) => `<div class="sh-person" data-token="${esc(c.token)}">
            <span class="crew-av" style="background:${CREW_COLORS[i % CREW_COLORS.length]}">${esc((c.guest || '?').slice(0, 1).toUpperCase())}</span>
            <span class="sh-p-text"><b>${esc(c.guest)}</b><small>${c.lastActive ? `ACTIVE ${esc(whenShort(c.lastActive))}` : 'NOT ACTIVE YET'} · ${c.ends === 'week' ? 'ENDS IN 7 DAYS' : c.ends === 'never' ? 'NO END DATE' : 'ENDS WHEN DONE'}</small></span>
            <select class="sel sh-lvl" data-lvl="${esc(c.token)}" aria-label="Access for ${esc(c.guest)}">${LEVEL_INFO.map(([v, l]) => `<option value="${v}"${c.level === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
            <button type="button" class="mini-btn" data-copy="${esc(c.token)}">COPY LINK</button>
            <button type="button" class="mini-btn danger-t" data-stop="${esc(c.token)}">STOP</button>
          </div>`).join('') : '<div class="f-hint">Nobody yet. Links you create show up here, with STOP to end one at any time.</div>'}
      </div>
      <div class="m-foot"><button type="button" class="btn line" id="shBack">‹ BACK TO PROJECT</button></div>`, { wide: true });
    m.addEventListener('click', async (e) => {
      const t = e.target;
      const lv = t.closest('[data-level]');
      if (lv) { draft.level = lv.dataset.level; draw(); return; }
      const en = t.closest('[data-ends]');
      if (en) { draft.ends = en.dataset.ends; draw(); return; }
      if (t.closest('#shBack')) { openProject(proj); return; }
      if (t.closest('#shAnother')) { made = null; draft.guest = ''; draw(); setTimeout(() => { const i = $('#shName'); if (i) i.focus(); }, 30); return; }
      if (t.closest('#shCopy')) { await window.deck.copy(made.url); app.toast('Link copied'); return; }
      const cp = t.closest('[data-copy]');
      if (cp) { await window.deck.copy(FU.shareUrl(cp.dataset.copy)); app.toast('Link copied'); return; }
      const stop = t.closest('[data-stop]');
      if (stop) {
        if (stop.dataset.armed !== '1') { stop.dataset.armed = '1'; stop.textContent = 'CONFIRM STOP'; return; }
        try { await FU.revokeShare(stop.dataset.stop); app.toast('Link stopped. It no longer opens.'); } catch (err) { app.toast(err.message, 4000); }
        draw();
        return;
      }
      if (t.closest('#shCreate')) {
        const guest = ($('#shName', m).value || '').trim();
        if (!guest) { $('#shName', m).focus(); app.toast('Add their name first'); return; }
        busy = true; draw();
        try {
          const res = await FU.shareProject({ projectId: proj.id, guest, level: draft.level, ends: draft.ends });
          made = { ...res, guest };
          await window.deck.copy(res.url);
          app.toast(`Link for ${guest} created and copied`);
        } catch (err) { app.toast(err.message || 'Could not create the link', 4500); }
        busy = false;
        draw();
      }
    });
    m.addEventListener('change', async (e) => {
      const sel = e.target.closest('[data-lvl]');
      if (!sel) return;
      try { await FU.setShareLevel(sel.dataset.lvl, sel.value); app.toast(`Access changed to ${levelName(sel.value).toLowerCase()}`); } catch (err) { app.toast(err.message, 4000); }
    });
    if (!made) setTimeout(() => { const i = $('#shName'); if (i && !i.value) i.focus(); }, 30);
  };
  // Redraw when the list of people changes (a new link registers, or one is stopped elsewhere).
  const sigOf = () => JSON.stringify(FU.shares(proj.id).map((c) => [c.token, c.level]));
  let sig = sigOf();
  const off = FU.onChange(() => {
    if (!document.querySelector('.modal .sh-grid')) { off(); return; }
    const next = sigOf();
    if (next !== sig) { sig = next; draw(); }
  });
  draw();
}

export function openProjectEditor(project) {
  const isNew = !project;
  const p = U.clone(project || { id: U.uid(), name: '', goal: '', color: app.PROJECT_COLORS[0], due: null, status: 'active' });
  if (isNew) {
    const used = new Set(app.S.projects.filter((x) => x.status !== 'done').map((x) => x.color));
    p.color = app.PROJECT_COLORS.find((c) => !used.has(c)) || app.PROJECT_COLORS[0];
  }
  const m = mount(`
    <i class="br br-tr amber"></i><i class="br br-bl lav"></i>
    <div class="m-head"><span>${isNew ? 'NEW PROJECT' : 'EDIT PROJECT'}</span><button type="button" class="x-btn" data-x aria-label="Close">${X_SVG}</button></div>
    <form class="m-body scroll" id="pjForm" autocomplete="off">
      <div class="f"><label class="f-label" for="pName">PROJECT</label><input id="pName" class="in title" value="${esc(p.name)}" placeholder="Garage cleanout, holiday party…"></div>
      <div class="f"><label class="f-label" for="pGoal">GOAL · OPTIONAL</label><textarea id="pGoal" class="ta" style="min-height:70px" placeholder="What does done look like?">${esc(p.goal || '')}</textarea></div>
      <div class="f-row">
        <div class="f"><label class="f-label" for="pDue">FINISH BY · OPTIONAL</label><input id="pDue" class="in" type="date" value="${p.due ? U.toDateInput(app.projectDue(p)) : ''}"></div>
        <div class="f"><span class="f-label">COLOR</span><div class="pills pj-swatches" id="pColor">${app.PROJECT_COLORS.map((c) => `<button type="button" class="pill${p.color === c ? ' on' : ''}" data-v="${c}" style="--pc:${c}" aria-label="Color ${c}"><i style="background:${c}"></i></button>`).join('')}</div></div>
      </div>
      <div class="f-hint">Tasks join a project from the task editor, from the project itself, or by saying "…to the ${esc((p.name || 'garage cleanout').toLowerCase())} project".</div>
    </form>
    <div class="m-foot">
      ${isNew ? '' : '<button type="button" class="btn danger" id="pDel">DELETE</button>'}
      <div class="right"><button type="button" class="btn line" data-x>CANCEL</button><button type="button" class="btn primary" id="pSave">${isNew ? 'START PROJECT' : 'SAVE'}</button></div>
    </div>`);
  wirePills($('#pColor', m), (v) => { p.color = v; });
  $('#pjForm', m).addEventListener('submit', (e) => { e.preventDefault(); $('#pSave', m).click(); });
  $('#pSave', m).addEventListener('click', () => {
    const name = $('#pName', m).value.trim();
    if (!name) { $('#pName', m).focus(); app.toast('Name the project first'); return; }
    const due = $('#pDue', m).value;
    const out = { ...p, name, goal: $('#pGoal', m).value.trim(), due: due ? U.fromInputs(due, '').toISOString() : null };
    app.upsertProject(out, isNew);
    if (isNew) { closeModal(true); app.toast(`Project started: ${name}`); }
    else openProject(out);
  });
  if (!isNew) {
    const del = $('#pDel', m);
    del.addEventListener('click', () => {
      if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = 'CONFIRM · TASKS STAY'; return; }
      app.deleteProject(p.id);
      closeModal(true);
      app.toast('Project deleted. Its tasks stay in the queue.');
    });
  }
  setTimeout(() => $('#pName', m).focus(), 30);
}

// ================================================================ SCHEDULE
const SCHED_ENDS = [['week', 'IN 7 DAYS'], ['month', 'IN 30 DAYS'], ['never', 'NEVER']];
const TYPE_SWATCHES = ['#F2A65A', '#7FD1C7', '#A8B0D8', '#B8E27A', '#FF8A73', '#E3B5D9', '#F2D06B', '#8FC8FF', '#B5B0BC'];

export function openScheduleEditor(entry, { focus = null } = {}) {
  const isNew = !entry;
  const types = () => app.scheduleTypes();
  const today = new Date();
  const e = U.clone(entry || { id: U.uid(), type: (types()[0] || {}).id || 'appt', title: '', date: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`, note: '', replies: {} });
  const prev = entry ? U.clone(entry) : null;
  let adding = false;
  let newColor = null;
  const typePills = () => types().map((t) => `<button type="button" class="pill sc-type${e.type === t.id ? ' on' : ''}" data-type="${esc(t.id)}" style="--pc:${esc(t.color)}">${esc((t.name || '').toUpperCase())}</button>`).join('')
    + `<button type="button" class="pill sc-newtype" id="scNewType">+ NEW TYPE</button>`;
  const replies = Object.values(e.replies || {});
  const m = mount(`
    <i class="br br-tr amber"></i><i class="br br-bl lav"></i>
    <div class="m-head"><span>${isNew ? 'SCHEDULE · NEW ENTRY' : 'SCHEDULE · EDIT ENTRY'}</span><button type="button" class="x-btn" data-x aria-label="Close">${X_SVG}</button></div>
    <form class="m-body scroll" id="scForm" autocomplete="off">
      <div class="f"><span class="f-label">TYPE</span><div class="pills" id="scTypes">${typePills()}</div>
        <div class="sc-addtype" id="scAddType" hidden>
          <input id="scTypeName" class="in" maxlength="24" placeholder="Name, like Training">
          <div class="pills pj-swatches" id="scTypeColor">${TYPE_SWATCHES.map((c) => `<button type="button" class="pill" data-v="${c}" style="--pc:${c}" aria-label="Color ${c}"><i style="background:${c}"></i></button>`).join('')}</div>
          <button type="button" class="btn line" id="scTypeAdd">ADD TYPE</button>
        </div></div>
      <div class="f"><label class="f-label" for="scTitle">TITLE</label><input id="scTitle" class="in title" maxlength="120" value="${esc(e.title)}" placeholder="Work shift, dentist…"></div>
      <div class="f-row three">
        <div class="f"><label class="f-label" for="scDate">DATE</label><input id="scDate" class="in" type="date" value="${esc(e.date || '')}"></div>
        <div class="f"><label class="f-label" for="scStart">START · OPTIONAL</label><input id="scStart" class="in" type="time" value="${esc(e.start || '')}"></div>
        <div class="f"><label class="f-label" for="scEnd">END · OPTIONAL</label><input id="scEnd" class="in" type="time" value="${esc(e.end || '')}"></div>
      </div>
      <div class="f"><label class="f-label" for="scNote">NOTE · THEY SEE THIS</label><input id="scNote" class="in" maxlength="300" value="${esc(e.note || '')}" placeholder="Optional, like &quot;need a ride home after&quot;"></div>
      ${!isNew && replies.length ? '<div class="f-hint">Changing the title, type, date or time clears the replies on this entry, so everyone confirms the new version.</div>' : ''}
    </form>
    <div class="m-foot">
      ${isNew ? '' : '<button type="button" class="btn danger" id="scDel">DELETE</button>'}
      <div class="right"><button type="button" class="btn line" data-x>CANCEL</button><button type="button" class="btn primary" id="scSave">${isNew ? 'ADD' : 'SAVE'}</button></div>
    </div>`);
  const typesEl = $('#scTypes', m);
  typesEl.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-type]');
    if (b) { e.type = b.dataset.type; $$('[data-type]', typesEl).forEach((x) => x.classList.toggle('on', x === b)); app.sounds.click(); return; }
    if (ev.target.closest('#scNewType')) {
      adding = !adding;
      $('#scAddType', m).hidden = !adding;
      if (adding) setTimeout(() => $('#scTypeName', m).focus(), 20);
    }
  });
  wirePills($('#scTypeColor', m), (v) => { newColor = v; });
  const addType = () => {
    const name = $('#scTypeName', m).value.trim();
    if (!name) { $('#scTypeName', m).focus(); return; }
    const t = app.addScheduleType(name, newColor);
    if (!t) return;
    e.type = t.id;
    typesEl.innerHTML = typePills();
    adding = false;
    $('#scAddType', m).hidden = true;
    $('#scTypeName', m).value = '';
    app.toast(`Type added: ${t.name}`);
  };
  $('#scTypeAdd', m).addEventListener('click', addType);
  $('#scTypeName', m).addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); addType(); } });
  $('#scForm', m).addEventListener('submit', (ev) => { ev.preventDefault(); $('#scSave', m).click(); });
  $('#scSave', m).addEventListener('click', () => {
    const title = $('#scTitle', m).value.trim();
    const date = $('#scDate', m).value;
    if (!title) { $('#scTitle', m).focus(); app.toast('Give it a title'); return; }
    if (!date) { $('#scDate', m).focus(); app.toast('Pick a date'); return; }
    app.upsertScheduleEntry({ ...e, title, date, start: $('#scStart', m).value || '', end: $('#scEnd', m).value || '', note: $('#scNote', m).value.trim() }, prev);
    closeModal(true);
    app.toast(isNew ? `Added to the schedule: ${title}` : 'Schedule updated');
  });
  if (!isNew) {
    const del = $('#scDel', m);
    del.addEventListener('click', () => {
      if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = 'CONFIRM DELETE'; return; }
      app.deleteScheduleEntry(e.id);
      closeModal(true);
      app.toast('Removed from the schedule');
    });
  }
  setTimeout(() => { const f = focus === 'date' ? $('#scDate', m) : $('#scTitle', m); f.focus(); if (focus === 'date' && f.showPicker) { try { f.showPicker(); } catch (err) { /* needs a click */ } } }, 30);
}

export function openScheduleShare() {
  const FU = app.fieldUnit;
  const draft = { guest: '', ends: 'month' };
  let made = null;
  let busy = false;
  const draw = () => {
    const ready = FU.state().sharing;
    const crew = FU.scheduleShares();
    const prevName = document.querySelector('#shName');
    if (prevName) draft.guest = prevName.value;
    const m = mount(`
      <i class="br br-tr amber"></i><i class="br br-bl lav"></i>
      <div class="m-head"><span>SHARE · SCHEDULE</span><button type="button" class="x-btn" data-x aria-label="Close">${X_SVG}</button></div>
      <div class="m-body scroll">
        ${!ready ? `<div class="sh-warn">Sharing uses the Field Unit link (Firebase), the same one your phone syncs through. ${FU.state().linked ? 'It is reconnecting. Try again in a moment.' : 'Set it up first in <b>Settings › Field Unit</b>.'}</div>` : ''}
        <div class="sh-grid">
          <div>
            ${made ? `<div class="sh-made"><div class="sh-made-h">✓ SCHEDULE LINK READY · ${esc(made.guest.toUpperCase())}</div>
                <div class="sh-link">${esc(made.url)}</div>
                <div class="f-hint">Send this to ${esc(made.guest)}, or let them scan the code. They see one week at a time and tap GOT IT or CHANGE REQUEST on each entry. On an iPhone they can add it to the Home Screen.</div>
                <div class="sh-made-btns"><button type="button" class="btn primary" id="shCopy">COPY LINK</button><button type="button" class="btn line" id="shAnother">+ SHARE WITH SOMEONE ELSE</button></div></div>`
            : `<div class="f"><label class="f-label" for="shName">WHO'S IT FOR?</label><input id="shName" class="in title" maxlength="40" placeholder="Their name" value="${esc(draft.guest)}"></div>
              <div class="f-hint">They'll see your schedule one week at a time, and can reply GOT IT or CHANGE REQUEST (with a comment) on each entry. Replies show up here and on Field Unit.</div>
              <div class="f"><span class="f-label">LINK STOPS WORKING</span><div class="pills">${SCHED_ENDS.map(([v, l]) => `<button type="button" class="pill${draft.ends === v ? ' on' : ''}" data-ends="${v}">${l}</button>`).join('')}</div></div>
              <button type="button" class="btn primary block" id="shCreate" ${ready && !busy ? '' : 'disabled'}>${busy ? 'CREATING…' : 'CREATE LINK'}</button>`}
          </div>
          <div class="sh-qr">${made && made.qr ? `<img src="${made.qr}" alt="QR code for ${esc(made.guest)}'s link"><span class="f-hint">Scan with a phone camera to open.</span>` : '<div class="sh-qr-empty">The QR code appears here once you create a link.</div>'}</div>
        </div>
        <div class="tk-sep"><span>PEOPLE WITH ACCESS · ${crew.length}</span></div>
        ${crew.length ? crew.map((c, i) => `<div class="sh-person sc-person" data-token="${esc(c.token)}">
            <span class="crew-av" style="background:${CREW_COLORS[i % CREW_COLORS.length]}">${esc((c.guest || '?').slice(0, 1).toUpperCase())}</span>
            <span class="sh-p-text"><b>${esc(c.guest)}</b><small>${c.lastActive ? `LAST REPLY ${esc(whenShort(c.lastActive))}` : 'NO REPLIES YET'} · ${c.ends === 'week' ? 'ENDS IN 7 DAYS' : c.ends === 'never' ? 'NO END DATE' : 'ENDS IN 30 DAYS'}</small></span>
            <button type="button" class="mini-btn" data-copy="${esc(c.token)}">COPY LINK</button>
            <button type="button" class="mini-btn danger-t" data-stop="${esc(c.token)}">STOP</button>
          </div>`).join('') : '<div class="f-hint">Nobody yet. Links you create show up here, with STOP to end one at any time.</div>'}
      </div>
      <div class="m-foot"><div class="right"><button type="button" class="btn line" data-x>DONE</button></div></div>`, { wide: true });
    m.addEventListener('click', async (ev) => {
      const t = ev.target;
      const en = t.closest('[data-ends]');
      if (en) { draft.ends = en.dataset.ends; draw(); return; }
      if (t.closest('#shAnother')) { made = null; draft.guest = ''; draw(); setTimeout(() => { const i = $('#shName'); if (i) i.focus(); }, 30); return; }
      if (t.closest('#shCopy')) { await window.deck.copy(made.url); app.toast('Link copied'); return; }
      const cp = t.closest('[data-copy]');
      if (cp) { await window.deck.copy(FU.scheduleShareUrl(cp.dataset.copy)); app.toast('Link copied'); return; }
      const stop = t.closest('[data-stop]');
      if (stop) {
        if (stop.dataset.armed !== '1') { stop.dataset.armed = '1'; stop.textContent = 'CONFIRM STOP'; return; }
        try { await FU.revokeSchedule(stop.dataset.stop); app.toast('Link stopped. It no longer opens.'); } catch (err) { app.toast(err.message, 4000); }
        draw();
        return;
      }
      if (t.closest('#shCreate')) {
        const guest = ($('#shName', m).value || '').trim();
        if (!guest) { $('#shName', m).focus(); app.toast('Add their name first'); return; }
        busy = true; draw();
        try {
          const res = await FU.shareSchedule({ guest, ends: draft.ends });
          made = { ...res, guest };
          await window.deck.copy(res.url);
          app.toast(`Schedule link for ${guest} created and copied`);
        } catch (err) { app.toast(err.message || 'Could not create the link', 4500); }
        busy = false;
        draw();
      }
    });
    if (!made) setTimeout(() => { const i = $('#shName'); if (i && !i.value) i.focus(); }, 30);
  };
  const sigOf = () => JSON.stringify(FU.scheduleShares().map((c) => [c.token, c.lastActive]));
  let sig = sigOf();
  const off = FU.onChange(() => {
    if (!document.querySelector('.modal .sh-grid')) { off(); return; }
    const next = sigOf();
    if (next !== sig) { sig = next; draw(); }
  });
  draw();
}

// ================================================================ NOTE EDITOR
export function openNoteEditor(note) {
  const isNew = !note;
  const n = U.clone(note || { id: U.uid(), title: '', body: '', pinned: false, src: 'typed' });
  const srcLabel = { scan: 'SCANNED ON FIELD UNIT', voice: 'SAID TO THE COMPUTER', comms: 'SENT FROM THE COMMS TERMINAL', typed: 'TYPED' }[n.src] || 'TYPED';
  const where = n.editedOn === 'field' ? 'FIELD UNIT' : 'COMMAND';
  const stamp = n.editedAt ? `${srcLabel} · LAST EDITED ON ${where} · ${U.dayLabel(new Date(n.editedAt))} ${U.fmtTimeShort(new Date(n.editedAt), app.S.settings.clock24)}` : 'NEW NOTE';
  const m = mount(`
    <i class="br br-tr amber"></i><i class="br br-bl lav"></i>
    <div class="m-head"><span>${isNew ? 'NEW NOTE' : 'NOTE'}</span><button type="button" class="x-btn" data-x aria-label="Close">${X_SVG}</button></div>
    <div class="m-body scroll">
      <div class="f"><label class="f-label" for="nTitle">TITLE</label><input id="nTitle" class="in title" value="${esc(n.title)}" placeholder="Name this note"></div>
      <div class="f"><label class="f-label" for="nBody" style="display:flex;justify-content:space-between"><span>NOTE</span><span id="nWords" class="dim-t"></span></label>
        <textarea id="nBody" class="ta note-ta" placeholder="Write anything">${esc(n.body)}</textarea></div>
      <div class="f-hint">${esc(stamp)}</div>
    </div>
    <div class="m-foot">
      ${isNew ? '' : '<button type="button" class="btn danger" id="nDel">DELETE</button>'}
      <button type="button" class="btn line" id="nPin" aria-pressed="${n.pinned ? 'true' : 'false'}">${n.pinned ? 'UNPIN' : 'PIN'}</button>
      ${isNew ? '' : '<button type="button" class="btn line" id="nTask">→ TASK</button>'}
      <div class="right"><button type="button" class="btn line" data-x>CANCEL</button><button type="button" class="btn primary" id="nSave">${isNew ? 'SAVE NOTE' : 'SAVE'}</button></div>
    </div>`, { wide: true });
  const words = () => { const c = $('#nBody', m).value.split(/\s+/).filter(Boolean).length; $('#nWords', m).textContent = c ? `${c} WORD${c === 1 ? '' : 'S'}` : ''; };
  words();
  $('#nBody', m).addEventListener('input', words);
  const collect = () => {
    const body = $('#nBody', m).value.replace(/\s+$/, '');
    let title = $('#nTitle', m).value.trim();
    if (!title) title = (body.split('\n').find((l) => l.trim()) || '').trim().slice(0, 40);
    return { ...n, title, body };
  };
  $('#nPin', m).addEventListener('click', (e) => {
    n.pinned = !n.pinned;
    e.currentTarget.textContent = n.pinned ? 'UNPIN' : 'PIN';
    e.currentTarget.setAttribute('aria-pressed', n.pinned ? 'true' : 'false');
  });
  $('#nSave', m).addEventListener('click', () => {
    const out = collect();
    if (!out.title && !out.body) { $('#nBody', m).focus(); app.toast('Write something first'); return; }
    app.upsertNote(out, isNew);
    closeModal(true);
    app.toast(isNew ? 'Note saved' : 'Note updated');
  });
  if (!isNew) {
    $('#nTask', m).addEventListener('click', () => {
      const out = collect();
      app.upsertNote(out, false);
      app.noteToTask(out);
      closeModal(true);
    });
    const del = $('#nDel', m);
    del.addEventListener('click', () => {
      if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = 'CONFIRM DELETE'; return; }
      app.deleteNote(n.id);
      closeModal(true);
      app.toast('Note deleted');
    });
  }
  setTimeout(() => (isNew ? $('#nTitle', m) : $('#nBody', m)).focus(), 30);
}

// ================================================================ SETTINGS
const TABS = [
  ['operator', 'OPERATOR'],
  ['location', 'LOCATION'],
  ['calendars', 'CALENDARS'],
  ['tasks', 'TASKS & CREW'],
  ['system', 'SYSTEM'],
  ['alerts', 'ALERTS'],
  ['fieldunit', 'FIELD UNIT'],
  ['data', 'DATA']
];

export function openSettings(welcome = false) {
  const draft = U.clone(app.S.settings);
  const tabs = welcome ? TABS.slice(0, 5) : TABS;
  let tab = tabs[0][0];
  let saved = false;
  const cleanups = [];
  const runCleanups = () => { while (cleanups.length) { try { cleanups.pop()(); } catch (e) { /* ignore */ } } };
  if (welcome && draft.operatorName === 'Commander') draft.operatorName = '';
  // Closing without saving undoes any live opacity preview.
  const revert = () => {
    runCleanups();
    if (saved) return;
    app.previewOpacity(app.S.settings.opacity ?? 1);
    app.previewDarkness(app.S.settings.frameDarkness ?? 0.8);
    app.previewTheme(app.S.settings.theme || 'dusk');
    app.previewFont(app.S.settings.font || 'auto');
    app.previewInk(app.S.settings.ink || 'theme');
    app.previewFrame(app.S.settings.frame || 'dark');
    app.previewTrim(app.S.settings.trim || 'none');
  };

  const m = mount(`
    <i class="br br-tr amber"></i><i class="br br-bl lav"></i>
    <div class="m-head"><span>${welcome ? 'FIRST-RUN SETUP' : 'SETTINGS'}</span>${welcome ? '' : `<button type="button" class="x-btn" data-x aria-label="Close">${X_SVG}</button>`}</div>
    <div class="set-tabs" id="setTabs" role="tablist"></div>
    <div class="m-body scroll" id="setBody"></div>
    <div class="m-foot" id="setFoot"></div>`, { wide: true, locked: welcome, onClose: revert });

  const body = $('#setBody', m);

  const views = {
    operator() {
      return `
        ${welcome ? '<div><div class="welcome">WELCOME ABOARD</div><div class="welcome-sub">A few quick settings and the console is ready. Everything here can be changed later from the gear icon.</div></div>' : ''}
        <div class="f"><label class="f-label" for="sName">YOUR NAME · HOW THE COMPUTER ADDRESSES YOU</label><input id="sName" class="in" value="${esc(welcome && draft.operatorName === 'Commander' ? '' : draft.operatorName)}" placeholder="e.g. Sam, or Captain"></div>
        <div class="f"><label class="f-label" for="sConsole">CONSOLE NAME</label><input id="sConsole" class="in" value="${esc(draft.consoleName)}" placeholder="Command Deck">
          <div class="f-hint">Shown in the header, the system tray and the boot sequence.</div></div>`;
    },
    location() {
      return `
        <div class="f"><span class="f-label">CURRENT LOCATION</span><div class="current-loc" id="locCur">${esc(draft.location.name)}</div></div>
        <div class="f"><label class="f-label" for="locQ">SEARCH FOR A CITY</label>
          <div class="inline"><input id="locQ" class="in" placeholder="e.g. Pasadena"><button type="button" class="btn line" id="locGo">SEARCH</button></div></div>
        <div class="geo-results" id="locRes"></div>
        <div class="f-hint">Weather comes from Open-Meteo: free, no account needed. Clicking the weather panel opens the full forecast on weather.com.</div>`;
    },
    calendars() {
      return `
        <div class="f-hint">Paste each calendar's <b>private iCal link</b>, as many as you like.<br>
          <b>Google:</b> calendar.google.com › Settings › pick a calendar › Integrate calendar › <b>Secret address in iCal format</b><br>
          <b>Outlook:</b> Settings › Calendar › Shared calendars › Publish a calendar › ICS link<br>
          <b>iCloud:</b> Calendar app › share calendar › Public Calendar › copy link</div>
        <div class="row-list" id="calRows"></div>
        <div class="inline" style="gap:18px"><button type="button" class="link-btn" id="calAdd">+ ADD CALENDAR LINK</button><button type="button" class="link-btn" id="calTest">TEST LINKS</button></div>
        <div class="f-hint" id="calOut"></div>
        <div class="f"><span class="f-label">EVENTS ADDED IN THE CONSOLE</span>
          <div class="row-item cat"><input type="color" class="in" id="locColor" value="${esc(draft.localCalendarColor)}" aria-label="Local calendar color"><input class="in" id="locName" value="${esc(draft.localCalendarName || 'Local')}" aria-label="Local calendar name"><span></span></div></div>`;
    },
    tasks() {
      return `
        <div class="f"><span class="f-label">CATEGORIES</span><div class="row-list" id="catRows"></div><button type="button" class="link-btn" id="catAdd">+ ADD CATEGORY</button></div>
        <div class="f"><span class="f-label">SCHEDULE TYPES</span><div class="row-list" id="stRows"></div><button type="button" class="link-btn" id="stAdd">+ ADD TYPE</button>
          <div class="f-hint">The chips on schedule entries. Removing a type moves its entries to Other.</div></div>
        <div class="f"><span class="f-label">CREW · THE "ASSIGNED TO" LIST</span><div class="people" id="crew"></div>
          <div class="inline"><input id="crewIn" class="in" placeholder="Add a name"><button type="button" class="btn line" id="crewAdd">ADD</button></div></div>
        <div class="f"><label class="f-label" for="defRem">DEFAULT REMINDER WHEN YOU SAY "REMIND ME"</label>
          <select id="defRem" class="sel">${REMINDERS.slice(1).map(([v, l]) => `<option value="${v}"${draft.defaultReminder === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>`;
    },
    system() {
      const voices = app.englishVoices();
      return `
        <div class="f"><span class="f-label">COLOR THEME</span>
          <div class="pills" data-key="theme">${THEMES.map(([v, l, cs]) => `<button type="button" class="pill theme-pill${(draft.theme || 'dusk') === v ? ' on' : ''}" data-v="${v}" style="--pc:${cs[0] === '#FFFFFF' ? cs[1] : cs[0]}"><span class="theme-sw">${cs.map((c) => `<i style="background:${c}"></i>`).join('')}</span>${l}</button>`).join('')}</div></div>
        <div class="f"><span class="f-label">TYPEFACE</span>
          <div class="pills" data-key="font">${FONTS.map(([v, l, fam]) => `<button type="button" class="pill font-pill${(draft.font || 'auto') === v ? ' on' : ''}" data-v="${v}"${fam ? ` style="font-family:${fam}"` : ''}>${l}</button>`).join('')}</div>
          <div class="f-hint" style="margin-top:8px">Theme default follows the color theme: Moonbase uses Michroma, Blueprint Space Mono, Cryo Exo 2, Freighter B612 Mono.</div></div>
        <div class="f"><span class="f-label">TEXT COLOR</span>
          <div class="pills" data-key="ink">${INKS.map(([v, l, c]) => `<button type="button" class="pill theme-pill${(draft.ink || 'theme') === v ? ' on' : ''}" data-v="${v}">${c ? `<i style="background:${c};box-shadow:inset 0 0 0 1px #6E6A78"></i>` : ''}${l}</button>`).join('')}</div>
          <div class="f-hint" style="margin-top:8px">Recolors the main text. Accents, warnings and checkmarks stay with the theme; light themes get a deeper shade so it stays readable.</div></div>
        <div style="display:flex;flex-direction:column;gap:18px">
          <div class="f"><span class="f-label">FRAME</span><div class="pills" data-key="frame">${FRAMES.map(([v, l, c]) => `<button type="button" class="pill theme-pill${(draft.frame || 'dark') === v ? ' on' : ''}" data-v="${v}" style="--pc:${c === '#14151B' ? '#9C98A6' : v === 'bone' ? c : '#C9CDD3'}"><i style="background:${c};box-shadow:inset 0 0 0 1px #6E6A78"></i>${l}</button>`).join('')}</div></div>
          <div class="f"><span class="f-label">PANEL TRIM</span><div class="pills" data-key="trim">${TRIMS.map(([v, l, cs]) => `<button type="button" class="pill${(draft.trim || 'none') === v ? ' on' : ''}" data-v="${v}">${cs.length ? `<span class="trim-sw">${cs.map((c) => `<i style="background:${c}"></i>`).join('')}</span>` : ''}${l}</button>`).join('')}</div></div>
        </div>
        <div class="f-row">
          <div class="f"><span class="f-label">MOTION</span><div class="pills" data-key="motion">${pills([['full', 'FULL'], ['subtle', 'SUBTLE'], ['still', 'STILL']], draft.motion)}</div></div>
          <div class="f"><span class="f-label">SOUND EFFECTS</span><div class="pills" data-key="sound">${pills([['full', 'FULL'], ['key', 'KEY MOMENTS'], ['silent', 'SILENT']], draft.sound)}</div></div>
        </div>
        <div class="f-row three">
          <div class="f"><span class="f-label">WINDOW</span><div class="pills" data-key="windowMode">${pills([['top', 'ON TOP'], ['desk', 'DESKTOP']], draft.windowMode)}</div></div>
          <div class="f"><span class="f-label">CLOCK</span><div class="pills" data-key="clock24">${pills([['false', '12-HOUR'], ['true', '24-HOUR']], String(draft.clock24))}</div></div>
          <div class="f"><span class="f-label">TEMPERATURE</span><div class="pills" data-key="tempUnit">${pills([['F', '°F'], ['C', '°C']], draft.tempUnit)}</div></div>
        </div>
        <div class="f"><label class="f-label" for="sOpacity" style="display:flex;justify-content:space-between"><span>CONSOLE OPACITY</span><span id="sOpacityVal" class="amber-t">${Math.round((draft.opacity ?? 1) * 100)}%</span></label>
          <input id="sOpacity" class="range" type="range" min="30" max="100" step="5" value="${Math.round((draft.opacity ?? 1) * 100)}">
          <div class="f-hint">Fades the whole console, text included, so the desktop shows through. Previews live as you drag.</div></div>
        <div class="f"><label class="f-label" for="sDark" style="display:flex;justify-content:space-between"><span>BACKGROUND DARKNESS</span><span id="sDarkVal" class="amber-t">${Math.round((draft.frameDarkness ?? 0.8) * 100)}%</span></label>
          <input id="sDark" class="range" type="range" min="20" max="97" step="1" value="${Math.round((draft.frameDarkness ?? 0.8) * 100)}">
          <div class="f-hint">Darkens only the space between and behind the panels.</div></div>
        <div class="f"><span class="f-label">COMPUTER VOICE</span>
          <div class="toggle-row"><span>Spoken greetings, answers and reminders</span>${switchHtml('swVoice', draft.voiceEnabled, 'Computer voice')}</div>
          <div class="f-row" style="margin-top:6px">
            <div class="f"><span class="f-label">ENGINE</span><div class="pills" data-key="voiceEngine">${pills([['neural', 'NEURAL'], ['windows', 'WINDOWS']], draft.voiceEngine)}</div></div>
            <div class="f"><label class="f-label" for="sRate">SPEED</label><select id="sRate" class="sel">${[[0.85, 'SLOWER'], [1, 'NORMAL'], [1.15, 'FASTER']].map(([v, l]) => `<option value="${v}"${Number(draft.voiceRate) === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
          </div>
          <div id="neuralOpts" class="f" ${draft.voiceEngine === 'neural' ? '' : 'hidden'} style="margin-top:6px">
            <select id="sNeural" class="sel" aria-label="Neural voice">${NEURAL_VOICES.map(([v, l]) => `<option value="${v}"${draft.neuralVoice === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
            <div class="f" style="margin-top:6px"><span class="f-label">VOICE CHARACTER</span><div class="pills" data-key="voiceFx">${pills([['robot', 'ROBOT COMPANION'], ['comms', 'SHIP COMMS'], ['radio', 'RADIO'], ['off', 'OFF']], draft.voiceFx || 'robot')}</div></div>
            <div class="f-row">
              <div class="f"><label class="f-label" for="sDepth" style="display:flex;justify-content:space-between"><span>DEPTH</span><span id="sDepthVal" class="amber-t">${draft.voiceDepth ?? 35}%</span></label>
                <input id="sDepth" class="range" type="range" min="0" max="100" step="5" value="${draft.voiceDepth ?? 35}"></div>
              <div class="f"><label class="f-label" for="sStrength" style="display:flex;justify-content:space-between"><span>EFFECT STRENGTH</span><span id="sStrengthVal" class="amber-t">${draft.voiceFxStrength ?? 60}%</span></label>
                <input id="sStrength" class="range" type="range" min="0" max="100" step="5" value="${draft.voiceFxStrength ?? 60}"></div>
            </div>
            <div class="f-hint" id="synthHint"></div>
          </div>
          <div id="windowsOpts" class="f" ${draft.voiceEngine === 'windows' ? '' : 'hidden'} style="margin-top:6px">
            <select id="sVoice" class="sel" aria-label="Windows voice"><option value="">AUTOMATIC</option>${voices.map((v) => `<option value="${esc(v.name)}"${draft.voiceName === v.name ? ' selected' : ''}>${esc(v.name.replace(/^Microsoft /, '').toUpperCase())}</option>`).join('')}</select>
          </div>
          <div class="inline" style="flex:none;margin-top:6px"><button type="button" class="btn line" id="sTest">TEST VOICE</button></div>
        </div>
        <div class="f"><span class="f-label">MIC WAITS AFTER YOU STOP TALKING</span>
          <div class="pills" data-key="micPatience">${pills([['short', 'SHORT · 1.5 S'], ['normal', 'NORMAL · 2.2 S'], ['long', 'LONG · 3.5 S']], draft.micPatience || 'normal')}</div>
          <div class="f-hint">How long a pause ends your turn. Tapping the mic button again always finishes right away.</div></div>
        <div class="f"><label class="f-label" for="sHumor" style="display:flex;justify-content:space-between"><span>HUMOR SETTING</span><span id="sHumorVal" class="amber-t">${draft.humor ?? 40}%</span></label>
          <input id="sHumor" class="range" type="range" min="0" max="100" step="5" value="${draft.humor ?? 40}">
          <div class="f-hint">0% is strictly professional; higher settings add dry, deadpan remarks. You can also just say "set humor to 75 percent."</div></div>
        <div class="f"><span class="f-label">STARTUP</span>
          <div class="toggle-row"><span>Start with Windows</span>${switchHtml('swAuto', draft.autoStart, 'Start with Windows')}</div>
          <div class="toggle-row"><span>Daily briefing the first time the console opens each day</span>${switchHtml('swBrief', draft.morningBriefing, 'Daily briefing')}</div>
        </div>
        <div class="f"><span class="f-label">UPDATES</span>
          <div class="toggle-row"><span id="sUpd">${esc(app.updateInfo().text)}</span><button type="button" class="btn line" id="sUpdBtn">${app.updateInfo().state === 'ready' ? 'RESTART TO UPDATE' : 'CHECK NOW'}</button></div>
          <div class="f-hint">New versions download in the background. When one is ready, UPDATE READY appears at the top; tap it to restart, or it installs the next time Command Deck closes.</div></div>`;
    },
    alerts() {
      return `
        <div class="f"><span class="f-label">QUIET HOURS</span>
          <div class="toggle-row"><span>No speaking or sounds overnight. Reminders still appear on screen; timers and alarms still ring.</span>${switchHtml('swQuiet', draft.quietEnabled, 'Quiet hours')}</div>
          <div class="inline" style="flex:none;align-items:center;gap:12px;margin-top:6px">
            <label class="f-label" for="qStart">FROM</label><input id="qStart" class="in time-in" type="time" value="${esc(draft.quietStart || '22:00')}">
            <label class="f-label" for="qEnd">UNTIL</label><input id="qEnd" class="in time-in" type="time" value="${esc(draft.quietEnd || '07:00')}">
          </div></div>
        <div class="f"><label class="f-label" for="snoozeMin">SNOOZE LENGTH</label>
          <select id="snoozeMin" class="sel" style="max-width:260px">${[5, 10, 15, 30].map((v) => `<option value="${v}"${Number(draft.snoozeMinutes || 10) === v ? ' selected' : ''}>${v} MINUTES</option>`).join('')}</select>
          <div class="f-hint">Used by the Snooze button and by saying "snooze." You can also say "remind me in 20 minutes."</div></div>
        <div class="f"><span class="f-label">RED ALERT</span>
          <div class="toggle-row"><span>Pulse the frame red when a task is badly overdue</span>${switchHtml('swRed', draft.redAlert, 'Red alert')}</div>
          <div class="inline" style="flex:none;align-items:center;gap:12px;margin-top:6px"><label class="f-label" for="redAfter">AFTER</label>
            <select id="redAfter" class="sel" style="max-width:220px">${[[15, '15 MINUTES'], [30, '30 MINUTES'], [60, '1 HOUR'], [120, '2 HOURS'], [240, '4 HOURS'], [1440, '1 DAY']].map(([v, l]) => `<option value="${v}"${Number(draft.redAlertAfter || 60) === v ? ' selected' : ''}>${l} OVERDUE</option>`).join('')}</select></div></div>`;
    },
    fieldunit() {
      const fu = app.fieldUnit.state();
      if (!fu.linked) {
        return `
        <div class="f-hint"><b>Field Unit</b> is the iPhone companion. It talks to this console through a free Firebase project.
          Follow <b>FIELD-UNIT-SETUP.md</b> in the Command Deck folder once, then paste the web address it gives you here.</div>
        <div class="f"><label class="f-label" for="fuUrl">FIELD UNIT WEB ADDRESS</label>
          <div class="inline"><input id="fuUrl" class="in" placeholder="https://your-project.web.app" value="${esc(fu.url)}" spellcheck="false"><button type="button" class="btn primary" id="fuLink">LINK</button></div>
          <div class="f-hint">LINK makes this computer the <b>main console</b>: it starts a new deck that phones pair with.</div>
          <div class="f-hint" id="fuMsg">${fu.status === 'connecting' ? 'Establishing uplink…' : fu.error ? `<span class="err-t">${esc(fu.error)}</span>` : ''}</div></div>
        <div class="f fu-join"><span class="f-label">OR JOIN ANOTHER COMMAND DECK</span>
          <div class="f-hint">Already running Command Deck on another computer? Share its deck here: tasks, projects, notes and events stay the same on both.
            On the main console open <b>Settings › Field Unit › SHOW PAIRING CODE</b>, put the same web address above, and enter the code:</div>
          <div class="inline"><input id="fuJoinCode" class="in pair-in" maxlength="7" placeholder="ABC-123" spellcheck="false" autocomplete="off"><button type="button" class="btn line" id="fuJoin">JOIN DECK</button></div>
          <div class="f-hint">Anything already on this computer is added to the shared deck.</div></div>`;
      }
      if (fu.role === 'joined') {
        const statusJ = { online: '<span class="ok-t">UPLINK ONLINE</span>', connecting: 'CONNECTING…', offline: '<span class="err-t">OFFLINE · changes wait for signal</span>', error: `<span class="err-t">ERROR · ${esc(fu.error)}</span>`, off: 'OFF' }[fu.status] || fu.status;
        const crew = fu.devices.length ? fu.devices.map((d) => `
          <div class="row-item dev"><div><div class="dev-name">${esc(d.name || (d.console ? 'Command Deck' : 'Field Unit'))}</div><div class="f-hint">${d.console ? (d.role === 'joined' ? 'Console' : 'Main console') : 'Phone'}${d.joinedAt ? ` · joined ${esc(new Date(d.joinedAt).toLocaleDateString())}` : ''}</div></div></div>`).join('') : `<div class="f-hint">${fu.status === 'online' ? 'Loading…' : 'Shows up once the uplink is connected.'}</div>`;
        return `
        <div class="f"><span class="f-label">UPLINK</span>
          <div class="toggle-row"><span>${statusJ}</span><span class="f-hint">${esc(fu.url)}</span></div></div>
        <div class="f"><span class="f-label">JOINED DECK</span>
          <div class="f-hint">This console shares the main console's deck. Tasks, projects, notes, events and timers stay in sync with it and with every paired phone.<br>
            Categories, crew, location, units and calendar feeds follow the main console, so change those there. Look and layout stay your own.<br>
            Pair phones and add consoles from the main console. Phone notifications come from the main console too.</div></div>
        <div class="f"><span class="f-label">ON THIS DECK</span><div class="row-list">${crew}</div></div>
        <div class="f"><span class="f-label">LINK</span>
          <div class="inline" style="flex:none"><button type="button" class="btn danger" id="fuUnlink">LEAVE THIS DECK</button></div>
          <div class="f-hint">Stops syncing. What's on this computer stays here. You can join again with a new code.</div></div>`;
      }
      const statusText = { online: '<span class="ok-t">UPLINK ONLINE</span>', connecting: 'CONNECTING…', offline: '<span class="err-t">OFFLINE · changes wait for signal</span>', error: `<span class="err-t">ERROR · ${esc(fu.error)}</span>`, off: 'OFF' }[fu.status] || fu.status;
      const pairing = fu.pairing;
      const left = pairing ? Math.max(0, Math.round((pairing.expires - Date.now()) / 1000)) : 0;
      const devices = fu.devices.length ? fu.devices.map((d) => `
          <div class="row-item dev">
            <div><div class="dev-name">${esc(d.name || (d.console ? 'Command Deck' : 'Field Unit'))}</div><div class="f-hint">${d.console ? `Console · joined ${d.joinedAt ? esc(new Date(d.joinedAt).toLocaleDateString()) : ''}` : `Paired ${d.joinedAt ? esc(new Date(d.joinedAt).toLocaleDateString()) : ''} · alerts ${d.alerts ? '<span class="ok-t">on</span>' : 'off'}`}</div></div>
            <button type="button" class="btn danger" data-unpair="${esc(d.id)}" data-console="${d.console ? '1' : ''}">${d.console ? 'REMOVE' : 'UNPAIR'}</button>
          </div>`).join('') : '<div class="f-hint">No phones paired yet.</div>';
      return `
        <div class="f"><span class="f-label">UPLINK</span>
          <div class="toggle-row"><span>${statusText}</span><span class="f-hint">${esc(fu.url)}</span></div></div>
        <div class="f"><span class="f-label">PAIR A DEVICE</span>
          ${pairing ? `
          <div class="pair-box">
            <img src="${pairing.qr}" alt="QR code to pair Field Unit" width="184" height="184">
            <div>
              <div class="f-hint">Scan with the iPhone camera, or open Field Unit and enter:</div>
              <div class="pair-code">${esc(pairing.pretty)}</div>
              <div class="f-hint">Expires in <span id="fuLeft">${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}</span>. Add Field Unit to the Home Screen first, then pair inside it.</div>
              <div class="f-hint">Adding another Command Deck? Enter this code on that computer under <b>Settings › Field Unit › JOIN DECK</b>.</div>
              <button type="button" class="btn line" id="fuCancel" style="margin-top:10px">CANCEL</button>
            </div>
          </div>` : `<div class="inline" style="flex:none"><button type="button" class="btn primary" id="fuPair">SHOW PAIRING CODE</button></div>`}
        </div>
        <div class="f"><span class="f-label">PAIRED DEVICES</span><div class="row-list">${devices}</div></div>
        <div class="f"><span class="f-label">LINK</span>
          <div class="inline" style="flex:none"><button type="button" class="btn danger" id="fuUnlink">UNLINK THIS CONSOLE</button></div>
          <div class="f-hint">Stops syncing. Tasks stay on this computer. Linking again creates a fresh uplink, and phones need to pair again.</div></div>`;
    },
    data() {
      return `
        <div class="f"><span class="f-label">BACKUP</span><div class="f-hint">Saves tasks, events, settings and layout to a file you choose.</div>
          <div class="inline" style="flex:none"><button type="button" class="btn line" id="dExport">EXPORT BACKUP</button><button type="button" class="btn line" id="dImport">RESTORE FROM FILE</button></div></div>
        <div class="f"><span class="f-label">LAYOUT</span>
          <div class="inline" style="flex:none"><button type="button" class="btn line" id="dLayout">RESET PANEL LAYOUT</button><button type="button" class="btn line" id="dBoot">REPLAY BOOT SEQUENCE</button></div></div>
        <div class="f"><span class="f-label">SETUP</span><div class="inline" style="flex:none"><button type="button" class="btn line" id="dSetup">RUN FIRST-RUN SETUP AGAIN</button></div></div>
        <div class="f"><span class="f-label">ABOUT</span><div class="f-hint">${esc(draft.consoleName)} v1.0.<br>
          Show or hide from anywhere with <span class="kbd">Ctrl</span> + <span class="kbd">Alt</span> + <span class="kbd">Space</span>. Closing the window sends it to the system tray; quit from the tray icon.<br>
          Voice is transcribed on this computer. The speech model (about 80 MB) downloads once, the first time the computer starts up with internet.</div></div>`;
    }
  };

  const wires = {
    operator() {
      $('#sName', body).addEventListener('input', (e) => { draft.operatorName = e.target.value; });
      $('#sConsole', body).addEventListener('input', (e) => { draft.consoleName = e.target.value; });
      setTimeout(() => $('#sName', body).focus(), 30);
    },
    location() {
      const go = async () => {
        const q = $('#locQ', body).value.trim();
        if (!q) return;
        const out = $('#locRes', body);
        out.innerHTML = '<div class="f-hint">Scanning…</div>';
        try {
          const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`);
          const json = await res.json();
          const list = json.results || [];
          if (!list.length) { out.innerHTML = '<div class="f-hint err-t">No matches. Try a nearby city name.</div>'; return; }
          out.innerHTML = list.map((r, i) => `<button type="button" class="geo-btn" data-i="${i}">${esc([r.name, r.admin1, r.country].filter(Boolean).join(', '))}</button>`).join('');
          out.onclick = (e) => {
            const b = e.target.closest('.geo-btn');
            if (!b) return;
            const r = list[Number(b.dataset.i)];
            draft.location = { name: [r.name, r.admin1 || r.country].filter(Boolean).join(', '), lat: r.latitude, lon: r.longitude };
            $('#locCur', body).textContent = draft.location.name;
            out.innerHTML = '<div class="f-hint ok-t">Location set.</div>';
            app.sounds.click();
          };
        } catch (e) {
          out.innerHTML = '<div class="f-hint err-t">Could not reach the location service. Check the internet connection.</div>';
        }
      };
      $('#locGo', body).addEventListener('click', go);
      $('#locQ', body).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    },
    calendars() {
      const rows = $('#calRows', body);
      const render = () => {
        rows.innerHTML = draft.calendars.length ? draft.calendars.map((c, i) => `
          <div class="row-item cal" data-i="${i}">
            <input type="color" class="in" data-f="color" value="${esc(c.color)}" aria-label="Calendar color">
            <input class="in" data-f="name" value="${esc(c.name)}" placeholder="Name" aria-label="Calendar name">
            <input class="in" data-f="url" value="${esc(c.url)}" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" aria-label="Calendar link" spellcheck="false">
            ${switchHtml(`calOn${i}`, c.enabled !== false, 'Show this calendar')}
            <button type="button" class="x-btn" data-rm aria-label="Remove calendar">${X_SVG}</button>
          </div>`).join('') : '<div class="f-hint">No calendars linked yet.</div>';
        $$('.switch', rows).forEach((sw) => {
          const i = Number(sw.closest('.row-item').dataset.i);
          wireSwitch(sw, (on) => { draft.calendars[i].enabled = on; });
        });
      };
      render();
      rows.addEventListener('input', (e) => {
        const row = e.target.closest('.row-item');
        if (!row || !e.target.dataset.f) return;
        draft.calendars[Number(row.dataset.i)][e.target.dataset.f] = e.target.value;
      });
      rows.addEventListener('click', (e) => {
        const rm = e.target.closest('[data-rm]');
        if (!rm) return;
        draft.calendars.splice(Number(rm.closest('.row-item').dataset.i), 1);
        render();
      });
      $('#calAdd', body).addEventListener('click', () => {
        draft.calendars.push({ id: U.uid(), name: `Calendar ${draft.calendars.length + 1}`, url: '', color: PALETTE[draft.calendars.length % PALETTE.length], enabled: true });
        render();
        const urls = $$('[data-f="url"]', rows);
        urls[urls.length - 1].focus();
      });
      $('#calTest', body).addEventListener('click', async () => {
        const out = $('#calOut', body);
        const cals = draft.calendars.filter((c) => c.url.trim());
        if (!cals.length) { out.innerHTML = '<span class="err-t">Paste a link first.</span>'; return; }
        out.textContent = 'Contacting calendars…';
        const res = await app.testCalendars(cals.map((c) => ({ ...c, enabled: true })));
        out.innerHTML = cals.map((c) => {
          const err = res.errors.find((x) => x.calId === c.id);
          const n = res.events.filter((x) => x.calId === c.id).length;
          return err ? `<span class="err-t">✕ ${esc(c.name)}: ${esc(err.message)}</span>` : `<span class="ok-t">✓ ${esc(c.name)}: ${n} event${n === 1 ? '' : 's'} in the next 30 days</span>`;
        }).join('<br>');
      });
      $('#locColor', body).addEventListener('input', (e) => { draft.localCalendarColor = e.target.value; });
      $('#locName', body).addEventListener('input', (e) => { draft.localCalendarName = e.target.value; });
    },
    tasks() {
      const rows = $('#catRows', body);
      const renderCats = () => {
        rows.innerHTML = draft.categories.map((c, i) => `
          <div class="row-item cat" data-i="${i}">
            <input type="color" class="in" data-f="color" value="${esc(c.color)}" aria-label="Category color">
            <input class="in" data-f="name" value="${esc(c.name)}" placeholder="Category name" aria-label="Category name">
            <button type="button" class="x-btn" data-rm aria-label="Remove category">${X_SVG}</button>
          </div>`).join('');
      };
      renderCats();
      rows.addEventListener('input', (e) => {
        const row = e.target.closest('.row-item');
        if (!row || !e.target.dataset.f) return;
        draft.categories[Number(row.dataset.i)][e.target.dataset.f] = e.target.value;
      });
      rows.addEventListener('click', (e) => {
        const rm = e.target.closest('[data-rm]');
        if (!rm) return;
        draft.categories.splice(Number(rm.closest('.row-item').dataset.i), 1);
        renderCats();
      });
      $('#catAdd', body).addEventListener('click', () => {
        draft.categories.push({ id: U.uid(), name: '', color: PALETTE[(draft.categories.length + 2) % PALETTE.length] });
        renderCats();
        const names = $$('[data-f="name"]', rows);
        names[names.length - 1].focus();
      });

      if (!Array.isArray(draft.scheduleTypes) || !draft.scheduleTypes.length) draft.scheduleTypes = U.clone(app.scheduleTypes());
      const stRows = $('#stRows', body);
      const renderTypes = () => {
        stRows.innerHTML = draft.scheduleTypes.map((t, i) => `
          <div class="row-item cat" data-i="${i}">
            <input type="color" class="in" data-f="color" value="${esc(t.color)}" aria-label="Type color">
            <input class="in" data-f="name" maxlength="24" value="${esc(t.name)}" placeholder="Type name" aria-label="Type name">
            ${t.id === 'other' ? '<span class="x-btn" aria-hidden="true"></span>' : `<button type="button" class="x-btn" data-rm aria-label="Remove type">${X_SVG}</button>`}
          </div>`).join('');
      };
      renderTypes();
      stRows.addEventListener('input', (e) => {
        const row = e.target.closest('.row-item');
        if (!row || !e.target.dataset.f) return;
        const t = draft.scheduleTypes[Number(row.dataset.i)];
        t[e.target.dataset.f] = e.target.value;
        if (e.target.dataset.f === 'name') t.short = e.target.value.trim().toUpperCase().slice(0, 10);
      });
      stRows.addEventListener('click', (e) => {
        const rm = e.target.closest('[data-rm]');
        if (!rm) return;
        draft.scheduleTypes.splice(Number(rm.closest('.row-item').dataset.i), 1);
        renderTypes();
      });
      $('#stAdd', body).addEventListener('click', () => {
        draft.scheduleTypes.push({ id: U.uid(), name: '', short: '', color: PALETTE[(draft.scheduleTypes.length + 3) % PALETTE.length] });
        renderTypes();
        const names = $$('[data-f="name"]', stRows);
        names[names.length - 1].focus();
      });

      const crew = $('#crew', body);
      const renderCrew = () => {
        crew.innerHTML = draft.people.map((p, i) => `<span class="person">${esc(p.toUpperCase())}<button type="button" data-i="${i}" aria-label="Remove ${esc(p)}">${X_SVG}</button></span>`).join('') || '<span class="f-hint">No one yet.</span>';
      };
      renderCrew();
      crew.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        draft.people.splice(Number(b.dataset.i), 1);
        renderCrew();
      });
      const add = () => {
        const v = $('#crewIn', body).value.trim();
        if (!v || draft.people.some((p) => p.toLowerCase() === v.toLowerCase())) return;
        draft.people.push(v);
        $('#crewIn', body).value = '';
        renderCrew();
      };
      $('#crewAdd', body).addEventListener('click', add);
      $('#crewIn', body).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
      $('#defRem', body).addEventListener('change', (e) => { draft.defaultReminder = Number(e.target.value); });
    },
    system() {
      $$('.pills[data-key]', body).forEach((group) => {
        wirePills(group, (v) => {
          const key = group.dataset.key;
          draft[key] = key === 'clock24' ? v === 'true' : v;
          if (key === 'theme') app.previewTheme(v);
          if (key === 'font') app.previewFont(v);
          if (key === 'ink') app.previewInk(v);
          if (key === 'frame') app.previewFrame(v);
          if (key === 'trim') app.previewTrim(v);
          if (key === 'voiceEngine') {
            $('#neuralOpts', body).hidden = v !== 'neural';
            $('#windowsOpts', body).hidden = v !== 'windows';
            if (v === 'neural') app.loadTts().catch(() => {});
          }
        });
      });
      const op = $('#sOpacity', body);
      const fill = () => op.style.setProperty('--fill', `${((Number(op.value) - 30) / 70) * 100}%`);
      fill();
      op.addEventListener('input', () => {
        fill();
        draft.opacity = Number(op.value) / 100;
        $('#sOpacityVal', body).textContent = `${op.value}%`;
        app.previewOpacity(draft.opacity);
      });
      const synthHint = () => {
        const st = app.ttsStatus();
        const el = $('#synthHint', body);
        if (!el) return;
        el.innerHTML = st.state === 'ready' ? '<span class="ok-t">Neural voice ready. Runs on this computer.</span>'
          : st.state === 'loading' ? `Downloading the neural voice (one time, about 90 MB): ${st.progress || 0}%. The Windows voice fills in until it's ready.`
            : st.state === 'error' ? '<span class="err-t">The neural voice could not download. It needs internet once; the Windows voice is used until then.</span>'
              : 'The neural voice downloads once (about 90 MB), then works offline.';
      };
      synthHint();
      const updLine = () => {
        const u = app.updateInfo();
        const t = $('#sUpd', body); const b = $('#sUpdBtn', body);
        if (!t || !b) return;
        t.textContent = u.text;
        if (!b.dataset.busy) b.textContent = u.state === 'ready' ? 'RESTART TO UPDATE' : 'CHECK NOW';
        b.disabled = u.state === 'dev' || u.state === 'checking' || u.state === 'downloading';
      };
      updLine();
      $('#sUpdBtn', body).addEventListener('click', async () => {
        const b = $('#sUpdBtn', body);
        if (app.updateInfo().state === 'ready') { b.textContent = 'INSTALLING…'; b.dataset.busy = '1'; await app.installUpdate(); return; }
        b.dataset.busy = '1'; b.textContent = 'CHECKING…';
        await app.checkUpdates();
        delete b.dataset.busy;
        updLine();
      });
      const hintTimer = setInterval(() => { if (!document.body.contains(body) || tab !== 'system') clearInterval(hintTimer); else { synthHint(); updLine(); } }, 700);
      wireSwitch($('#swVoice', body), (on) => { draft.voiceEnabled = on; });
      const slider = (id, key, toValue, onMove) => {
        const el = $(id, body);
        const min = Number(el.min);
        const max = Number(el.max);
        const paint = () => el.style.setProperty('--fill', `${((Number(el.value) - min) / (max - min)) * 100}%`);
        paint();
        el.addEventListener('input', () => {
          paint();
          draft[key] = toValue(Number(el.value));
          $(`${id}Val`, body).textContent = `${el.value}%`;
          if (onMove) onMove(draft[key]);
        });
      };
      slider('#sDark', 'frameDarkness', (v) => v / 100, (v) => app.previewDarkness(v));
      slider('#sDepth', 'voiceDepth', (v) => v);
      slider('#sStrength', 'voiceFxStrength', (v) => v);
      slider('#sHumor', 'humor', (v) => v);
      wireSwitch($('#swAuto', body), (on) => { draft.autoStart = on; });
      wireSwitch($('#swBrief', body), (on) => { draft.morningBriefing = on; });
      $('#sVoice', body).addEventListener('change', (e) => { draft.voiceName = e.target.value; });
      $('#sNeural', body).addEventListener('change', (e) => { draft.neuralVoice = e.target.value; });
      $('#sRate', body).addEventListener('change', (e) => { draft.voiceRate = Number(e.target.value); });
      $('#sTest', body).addEventListener('click', () => {
        if (draft.voiceEngine === 'neural' && app.ttsStatus().state !== 'ready') {
          app.loadTts().catch(() => {});
          app.toast('Neural voice still downloading. Testing with the Windows voice for now.', 3200);
        }
        app.speak(`${draft.consoleName || 'Command Deck'} online. Good ${U.partOfDay()}, ${draft.operatorName || 'Commander'}. All systems nominal.`, 'speaking', {
          enabled: true, engine: draft.voiceEngine, voice: draft.voiceName, neuralVoice: draft.neuralVoice, fx: draft.voiceFx, depth: draft.voiceDepth, strength: draft.voiceFxStrength, rate: draft.voiceRate
        });
      });
    },
    alerts() {
      wireSwitch($('#swQuiet', body), (on) => { draft.quietEnabled = on; });
      wireSwitch($('#swRed', body), (on) => { draft.redAlert = on; });
      $('#qStart', body).addEventListener('change', (e) => { draft.quietStart = e.target.value || '22:00'; });
      $('#qEnd', body).addEventListener('change', (e) => { draft.quietEnd = e.target.value || '07:00'; });
      $('#snoozeMin', body).addEventListener('change', (e) => { draft.snoozeMinutes = Number(e.target.value); });
      $('#redAfter', body).addEventListener('change', (e) => { draft.redAlertAfter = Number(e.target.value); });
    },
    fieldunit() {
      const fu = app.fieldUnit;
      const rerender = () => { if (tab === 'fieldunit' && document.body.contains(body) && !['fuUrl', 'fuJoinCode'].includes(document.activeElement?.id)) render(); };
      const off = fu.onChange(rerender);
      const tick = setInterval(() => {
        if (tab !== 'fieldunit' || !document.body.contains(body)) { clearInterval(tick); off(); return; }
        const el = $('#fuLeft', body);
        const p = fu.state().pairing;
        if (el && p) {
          const left = Math.max(0, Math.round((p.expires - Date.now()) / 1000));
          el.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
        } else if (el && !p) render();
      }, 1000);
      cleanups.push(() => { clearInterval(tick); off(); });
      const linkBtn = $('#fuLink', body);
      if (linkBtn) {
        const go = async () => {
          const url = $('#fuUrl', body).value;
          $('#fuMsg', body).textContent = 'Establishing uplink…';
          linkBtn.disabled = true;
          try {
            await fu.link(url);
            app.toast('Uplink established');
            draft.fieldUnit = app.S.settings.fieldUnit;
            render();
          } catch (e) {
            $('#fuMsg', body).innerHTML = `<span class="err-t">${esc(e.message)}</span>`;
            linkBtn.disabled = false;
          }
        };
        linkBtn.addEventListener('click', go);
        $('#fuUrl', body).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
      }
      const joinBtn = $('#fuJoin', body);
      if (joinBtn) {
        const codeIn = $('#fuJoinCode', body);
        codeIn.addEventListener('input', () => {
          const v = codeIn.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
          codeIn.value = v.length > 3 ? `${v.slice(0, 3)}-${v.slice(3)}` : v;
        });
        const goJoin = async () => {
          $('#fuMsg', body).textContent = 'Joining the deck…';
          joinBtn.disabled = true;
          try {
            await fu.join($('#fuUrl', body).value, codeIn.value);
            app.toast('Joined the deck', 3000);
            draft.fieldUnit = app.S.settings.fieldUnit;
            render();
          } catch (e) {
            $('#fuMsg', body).innerHTML = `<span class="err-t">${esc(e.message)}</span>`;
            joinBtn.disabled = false;
          }
        };
        joinBtn.addEventListener('click', goJoin);
        codeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); goJoin(); } });
      }
      const pairBtn = $('#fuPair', body);
      if (pairBtn) pairBtn.addEventListener('click', async () => {
        pairBtn.disabled = true;
        try { await fu.startPairing(); render(); } catch (e) { app.toast(e.message, 4000); pairBtn.disabled = false; }
      });
      const cancel = $('#fuCancel', body);
      if (cancel) cancel.addEventListener('click', async () => { await fu.cancelPairing(); render(); });
      $$('[data-unpair]', body).forEach((b) => b.addEventListener('click', async () => {
        if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'CONFIRM'; return; }
        try { await fu.unpair(b.dataset.unpair); app.toast(b.dataset.console ? 'Console removed from the deck' : 'Field unit unpaired'); } catch (e) { app.toast(e.message, 4000); }
      }));
      const unlink = $('#fuUnlink', body);
      if (unlink) unlink.addEventListener('click', async () => {
        const joined = fu.state().role === 'joined';
        if (unlink.dataset.armed !== '1') { unlink.dataset.armed = '1'; unlink.textContent = joined ? 'CONFIRM LEAVE' : 'CONFIRM UNLINK'; return; }
        await fu.unlink();
        draft.fieldUnit = app.S.settings.fieldUnit;
        app.toast(joined ? 'Left the deck' : 'Uplink closed');
        render();
      });
    },
    data() {
      $('#dExport', body).addEventListener('click', async () => {
        const r = await app.exportData();
        if (r && r.ok) app.toast('Backup saved');
      });
      $('#dImport', body).addEventListener('click', async () => {
        const r = await app.importData();
        if (r && r.ok) {
          closeModal(true);
          app.afterImport(r.data);
          app.toast('Backup restored');
        } else if (r && r.error) {
          app.toast(`Restore failed: ${r.error}`, 4000);
        }
      });
      $('#dLayout', body).addEventListener('click', () => app.resetLayout());
      $('#dBoot', body).addEventListener('click', () => { closeModal(true); app.replayBoot(); });
      $('#dSetup', body).addEventListener('click', () => { closeModal(true); openSettings(true); });
    }
  };

  function validate() {
    draft.operatorName = (draft.operatorName || '').trim();
    draft.consoleName = (draft.consoleName || '').trim() || 'Command Deck';
    if (Array.isArray(draft.scheduleTypes)) {
      draft.scheduleTypes = draft.scheduleTypes.filter((t) => t.id === 'other' || String(t.name || '').trim())
        .map((t) => ({ ...t, name: String(t.name || 'Other').trim(), short: String(t.name || 'Other').trim().toUpperCase().slice(0, 10) }));
    }
    if (!draft.operatorName) return ['operator', 'Enter a name for the computer to use.'];
    draft.calendars = draft.calendars.filter((c) => c.url.trim() || c.name.trim());
    for (const c of draft.calendars) {
      c.url = c.url.trim();
      c.name = c.name.trim() || 'Calendar';
      if (!c.url) return ['calendars', `"${c.name}" needs a link.`];
      if (!/^(https?|webcal):\/\//i.test(c.url)) return ['calendars', `The link for "${c.name}" should start with https:// or webcal://`];
    }
    draft.categories = draft.categories.filter((c) => c.name.trim());
    draft.categories.forEach((c) => { c.name = c.name.trim(); });
    draft.localCalendarName = (draft.localCalendarName || '').trim() || 'Local';
    return null;
  }

  async function commit() {
    const problem = validate();
    if (problem) {
      tab = problem[0];
      render();
      app.toast(problem[1], 3600);
      return;
    }
    draft.fieldUnit = app.S.settings.fieldUnit; // linking happens live, not via the draft
    if (welcome) draft.setupComplete = true;
    saved = true;
    closeModal(true);
    await app.saveSettings(draft);
    if (welcome) app.afterSetup();
    else app.toast('Settings saved');
  }

  function render() {
    runCleanups();
    const idx = tabs.findIndex(([k]) => k === tab);
    $('#setTabs', m).innerHTML = tabs.map(([k, label], i) =>
      `<button type="button" class="set-tab${k === tab ? ' on' : ''}" data-tab="${k}" role="tab" aria-selected="${k === tab}">${welcome ? `<span class="n">${i + 1}</span>` : ''}${label}</button>`).join('');
    body.innerHTML = views[tab]();
    wires[tab]();
    const foot = $('#setFoot', m);
    if (welcome) {
      const last = idx === tabs.length - 1;
      foot.innerHTML = `${idx > 0 ? '<button type="button" class="btn line" id="sBack">BACK</button>' : '<span></span>'}
        <div class="right"><button type="button" class="btn primary" id="sNext">${last ? 'ENGAGE' : 'NEXT'}</button></div>`;
      if (idx > 0) $('#sBack', foot).addEventListener('click', () => { tab = tabs[idx - 1][0]; render(); });
      $('#sNext', foot).addEventListener('click', () => {
        if (tab === 'operator' && !(draft.operatorName || '').trim()) { app.toast('Enter a name for the computer to use.'); return; }
        if (last) commit();
        else { tab = tabs[idx + 1][0]; render(); }
      });
    } else {
      foot.innerHTML = '<span></span><div class="right"><button type="button" class="btn line" data-cancel>CANCEL</button><button type="button" class="btn primary" id="sSave">SAVE</button></div>';
      $('[data-cancel]', foot).addEventListener('click', () => closeModal(true));
      $('#sSave', foot).addEventListener('click', commit);
    }
    body.scrollTop = 0;
  }

  $('#setTabs', m).addEventListener('click', (e) => {
    const b = e.target.closest('.set-tab');
    if (!b) return;
    app.sounds.click();
    tab = b.dataset.tab;
    render();
  });
  render();
}
