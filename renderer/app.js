// ============================================================
// COMMAND DECK — interface
// ============================================================
import sounds from './sound.js';
import { loadModel, transcribe, record, onVoiceStatus, voiceStatus } from './voice.js';
import { loadTts, speakNeural, stopNeural, onTtsStatus, ttsStatus } from './tts.js';
import * as U from './util.js';
import { initModals, openTaskEditor, openEventEditor, openNoteEditor, openProject, openProjectEditor, openScheduleEditor, openScheduleShare, openSettings, closeModal, isModalOpen } from './modals.js';
import * as FU from './fieldunit.js';
import * as Motion from './motion.js';
import { DEFAULT_TYPES, TYPE_COLORS, weekStart, addDays, weekLabel, weekDays, ymd, parseYmd, typeOf, shortName, timeRange, parseTime } from '../shared/roster.js';

const { $, $$, esc } = U;
const deck = window.deck;
const VERSION = 'v1.13.2';

const PRI = {
  high: { n: 3, color: 'var(--coral)', label: 'HIGH' },
  medium: { n: 2, color: 'var(--amber)', label: 'MED' },
  low: { n: 1, color: 'var(--lav)', label: 'LOW' }
};

const S = {
  data: null,
  settings: null,
  tasks: [],
  localEvents: [],
  calEvents: [],
  calErrors: [],
  calFetchedAt: null,
  calRange: null,
  weather: null,
  wxFetchedAt: null,
  wxError: null,
  filter: 'all',
  viewMonth: null,
  selectedDate: null,
  log: [],
  voice: 'idle',
  newTaskId: null,
  lastDayKey: null,
  timers: [],
  alert: null,
  lastAlert: null,
  pendingConfirm: null,
  redAlertCount: 0
};

let grid = null;

// ---------------------------------------------------------------- icons
const IC = {
  check: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5 L5 9 L10 3" fill="none" stroke="#14151B" stroke-width="2"/></svg>',
  person: '<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="4" r="2.2" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M1.8 11 a4.2 4.2 0 0 1 8.4 0" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  bell: '<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 8.5 V5.5 a3 3 0 0 1 6 0 V8.5 L10 9.5 H2 Z M5 10.5 H7" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  repeat: '<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 5 a4 4 0 0 1 7.2 -1.6 M10 7 a4 4 0 0 1 -7.2 1.6 M9.5 1.2 V3.6 H7.1 M2.5 10.8 V8.4 H4.9" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  list: '<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M1.5 2.5 H3 M5 2.5 H10.5 M1.5 6 H3 M5 6 H10.5 M1.5 9.5 H3 M5 9.5 H10.5" stroke="currentColor" stroke-width="1.2"/></svg>',
  note: '<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 1.5 H7.5 L10 4 V10.5 H2 Z M4 6 H8 M4 8 H7" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>'
};
const WX_ICONS = {
  sun: '<svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true"><circle cx="17" cy="17" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M17 3 V7 M17 27 V31 M3 17 H7 M27 17 H31 M7 7 L9.8 9.8 M24.2 24.2 L27 27 M7 27 L9.8 24.2 M24.2 9.8 L27 7" stroke="currentColor" stroke-width="1.5"/></svg>',
  moon: '<svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true"><path d="M22 6 a11 11 0 1 0 7 17 a9 9 0 1 1 -7 -17 Z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  partly: '<svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true"><circle cx="13" cy="12" r="5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M13 3 V5 M4 12 H6 M6.6 5.6 L8 7 M19.4 5.6 L18 7" stroke="currentColor" stroke-width="1.5"/><path d="M11 27 H26 a5 5 0 0 0 0 -10 a7 7 0 0 0 -13 2 a4 4 0 0 0 -2 8 Z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  cloud: '<svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true"><path d="M9 25 H25 a6 6 0 0 0 0 -12 a8 8 0 0 0 -15 2 a5 5 0 0 0 -1 10 Z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  fog: '<svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true"><path d="M5 12 H29 M3 17 H27 M7 22 H31 M5 27 H25" stroke="currentColor" stroke-width="1.5"/></svg>',
  rain: '<svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true"><path d="M9 20 H25 a6 6 0 0 0 0 -12 a8 8 0 0 0 -15 2 a5 5 0 0 0 -1 10 Z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M11 24 L9 29 M17 24 L15 29 M23 24 L21 29" stroke="currentColor" stroke-width="1.5"/></svg>',
  snow: '<svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true"><path d="M9 20 H25 a6 6 0 0 0 0 -12 a8 8 0 0 0 -15 2 a5 5 0 0 0 -1 10 Z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M11 25 V29 M9 27 H13 M17 25 V29 M15 27 H19 M23 25 V29 M21 27 H25" stroke="currentColor" stroke-width="1.3"/></svg>',
  storm: '<svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true"><path d="M9 19 H25 a6 6 0 0 0 0 -12 a8 8 0 0 0 -15 2 a5 5 0 0 0 -1 10 Z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M18 21 L14 27 H19 L16 32" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>'
};

function wxInfo(code, isDay = 1) {
  if (code === 0) return { label: isDay ? 'CLEAR' : 'CLEAR NIGHT', icon: isDay ? 'sun' : 'moon', words: 'clear' };
  if (code === 1) return { label: 'MOSTLY CLEAR', icon: isDay ? 'sun' : 'moon', words: 'mostly clear' };
  if (code === 2) return { label: 'PARTLY CLOUDY', icon: isDay ? 'partly' : 'cloud', words: 'partly cloudy' };
  if (code === 3) return { label: 'OVERCAST', icon: 'cloud', words: 'overcast' };
  if (code === 45 || code === 48) return { label: 'FOG', icon: 'fog', words: 'foggy' };
  if (code >= 51 && code <= 57) return { label: 'DRIZZLE', icon: 'rain', words: 'drizzling' };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { label: code >= 80 ? 'SHOWERS' : 'RAIN', icon: 'rain', words: 'raining' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { label: 'SNOW', icon: 'snow', words: 'snowing' };
  if (code >= 95) return { label: 'THUNDERSTORM', icon: 'storm', words: 'stormy' };
  return { label: 'UNKNOWN', icon: 'cloud', words: 'unsettled' };
}

// ---------------------------------------------------------------- persistence
let taskSaveTimer = null;
function saveTasks() {
  clearTimeout(taskSaveTimer);
  taskSaveTimer = setTimeout(() => { deck.save('tasks', S.tasks); FU.push('tasks'); }, 200);
}
function saveProjects() {
  deck.save('projects', S.projects);
  FU.push('projects');
  renderTasks();
}
function saveNotes() {
  deck.save('notes', S.notes);
  FU.push('notes');
  renderNotes();
}
function saveSchedule() {
  deck.save('schedule', S.schedule);
  FU.push('schedule');
  if (S.tkView === 'schedule') renderTasks();
}
function saveLocalEvents() {
  deck.save('localEvents', S.localEvents);
  FU.push('events');
}

// Changes arriving from Field Unit (the phone).
function applyRemote(kind, list) {
  if (kind === 'tasks') {
    S.tasks = list;
    deck.save('tasks', list);
    renderTasks();
    renderCalendar();
    refreshOpenProject();
    FU.nudgeShares();
  } else if (kind === 'events') {
    S.localEvents = list;
    deck.save('localEvents', list);
    renderCalendar();
    renderEvents();
  } else if (kind === 'timers') {
    S.timers = list.sort((x, y) => new Date(x.endsAt) - new Date(y.endsAt));
    deck.save('timers', S.timers);
    renderTimers();
  } else if (kind === 'notes') {
    S.notes = list;
    deck.save('notes', list);
    renderNotes();
  } else if (kind === 'projects') {
    S.projects = list;
    deck.save('projects', list);
    renderTasks();
    refreshOpenProject();
    FU.nudgeShares();
  } else if (kind === 'schedule') {
    S.schedule = list;
    deck.save('schedule', list);
    if (S.tkView === 'schedule') renderTasks();
    FU.nudgeSchedule();
  }
}
function saveMeta() {
  deck.save('meta', S.data.meta);
}

// ---------------------------------------------------------------- settings
// Each theme has its own typeface; the Typeface setting can override it.
const THEME_FONT = { dusk: 'chakra', space: 'chakra', red: 'chakra', terminal: 'chakra', retro: 'sharetech', moonbase: 'michroma', blueprint: 'spacemono', cryo: 'exo2', freighter: 'b612' };
const LIGHT_THEMES = new Set(['moonbase', 'cryo']);
const look = { theme: 'dusk', font: 'auto', ink: 'theme' };
function applyLook(theme = look.theme, font = look.font, ink = look.ink) {
  look.theme = theme || 'dusk';
  look.font = font || 'auto';
  look.ink = ink || 'theme';
  const b = document.body;
  b.dataset.ink = look.ink;
  b.dataset.theme = look.theme;
  b.dataset.font = look.font === 'auto' ? (THEME_FONT[look.theme] || 'chakra') : look.font;
  if (LIGHT_THEMES.has(look.theme)) b.dataset.light = '1'; else delete b.dataset.light;
}

function applySettings() {
  const s = S.settings;
  document.body.classList.remove('motion-full', 'motion-subtle', 'motion-still');
  document.body.classList.add(`motion-${s.motion}`);
  document.documentElement.style.setProperty('--frame-alpha', String(s.frameDarkness ?? 0.8));
  applyLook(s.theme, s.font, s.ink);
  document.body.dataset.frame = s.frame || 'dark';
  document.body.dataset.trim = s.trim || 'none';
  sounds.setQuiet(isQuiet());
  sounds.setLevel(s.sound);
  $('#consoleName').textContent = (s.consoleName || 'Command Deck').toUpperCase();
  $('#operatorLabel').textContent = `// OPERATOR: ${(s.operatorName || '').toUpperCase()}`;
  document.title = s.consoleName || 'Command Deck';
  $$('#segWindow button').forEach((b) => b.classList.toggle('on', b.dataset.v === s.windowMode));
  $$('#segMotion button').forEach((b) => b.classList.toggle('on', b.dataset.v === s.motion));
  document.body.classList.toggle('unlocked', !s.layoutLocked);
  if (grid) grid.setStatic(!!s.layoutLocked);
}

async function saveSettings(next, { refetch = true } = {}) {
  next = FU.overlay(next); // a joined console keeps following the main console's shared settings
  const prev = S.settings;
  S.settings = next;
  await deck.save('settings', next);
  applySettings();
  const locChanged = !prev || prev.location.lat !== next.location.lat || prev.location.lon !== next.location.lon || prev.tempUnit !== next.tempUnit;
  const calChanged = !prev || JSON.stringify(prev.calendars) !== JSON.stringify(next.calendars);
  if (refetch && locChanged) fetchWeather();
  if (refetch && calChanged) fetchCalendars(true);
  renderAll();
  checkRedAlert();
  FU.relayShared(next);
  if (deck.lights && JSON.stringify((prev || {}).lighting) !== JSON.stringify(next.lighting)) deck.lights.configure(next.lighting).catch(() => {});
  if (!prev || prev.layoutMode !== next.layoutMode) applyLayout();
}

// ---------------------------------------------------------------- toast & log
let toastTimer = null;
function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), ms);
}

// ---- Rig lighting (iCUE, see src/lighting.js): moments light up the rig, then iCUE takes back over.
let lightState = { status: 'off', devices: [] };
function lights(name, on = true, data) {
  if (!deck.lights) return;
  // Overnight, only timers and alarms light up the rig, the same way sounds go quiet.
  if (on && isQuiet() && !(name === 'alert' && data && data.wake)) return;
  deck.lights.moment(name, on, data);
}
function wireLights() {
  if (!deck.lights) return;
  deck.lights.get().then((s) => { lightState = s; }).catch(() => {});
  deck.lights.onState((s) => { lightState = s; });
}

// ---- Automatic updates (see main.js): a chip appears once a new version is downloaded.
let updateState = { state: 'idle' };
function updateText(u = updateState) {
  const cur = VERSION;
  const at = u.checkedAt ? ` Checked ${U.fmtTimeShort(new Date(u.checkedAt), S.settings.clock24)}.` : '';
  switch (u.state) {
    case 'dev': return `${cur} · Updates are off while running from source.`;
    case 'checking': return `${cur} · Checking for updates…`;
    case 'current': return `${cur} · Up to date.${at}`;
    case 'downloading': return `Downloading v${u.version || ''}${u.percent ? ` · ${u.percent}%` : '…'}`;
    case 'ready': return `v${u.version} is downloaded and ready to install.`;
    case 'error': return `${cur} · Couldn't check for updates right now. It tries again on its own.`;
    default: return `${cur} · Checks for updates automatically.`;
  }
}
function showUpdate(u) {
  const was = updateState.state;
  updateState = { ...updateState, ...u };
  const chip = $('#updChip');
  if (chip) chip.hidden = updateState.state !== 'ready';
  if (updateState.state === 'ready' && was !== 'ready') {
    pushLog('ok', `Update v${updateState.version} downloaded. Tap UPDATE READY to restart, or it installs next time Command Deck closes.`);
    renderLog();
  }
}
function wireUpdates() {
  // After an update installs, say so once in the log.
  try {
    const last = localStorage.getItem('deck.lastVersion');
    if (last !== VERSION) { pushLog('ok', `Now running ${VERSION}. All systems nominal.`); renderLog(); if (last) toast(`Command Deck updated to ${VERSION}`); }
    localStorage.setItem('deck.lastVersion', VERSION);
  } catch (e) { /* storage blocked */ }
  if (!deck.updates) return;
  deck.updates.get().then(showUpdate).catch(() => {});
  deck.updates.onState(showUpdate);
  $('#updChip').addEventListener('click', async () => {
    sounds.click();
    $('#updChip').textContent = 'INSTALLING…';
    const ok = await deck.updates.install().catch(() => false);
    if (!ok) $('#updChip').textContent = 'UPDATE READY · RESTART';
  });
}

function pushLog(kind, text) {
  S.log.push({ kind, text });
  if (S.log.length > 12) S.log.shift();
  renderLog();
}

function renderLog() {
  const el = $('#cmpLog');
  const lines = S.log.slice(-2);
  if (!lines.length) {
    el.innerHTML = `<div><span class="k c">›</span>Standing by, ${esc(S.settings.operatorName)}.</div>`;
    return;
  }
  el.innerHTML = lines.map((l) => {
    const k = l.kind === 'u' ? 'u' : l.kind;
    const cls = l.kind === 'u' ? 'you' : '';
    const mark = l.kind === 'u' ? '‹' : '›';
    return `<div class="${cls}" title="${esc(l.text)}"><span class="k ${k}">${mark}</span>${esc(l.text)}</div>`;
  }).join('');
}

// ---------------------------------------------------------------- clock
function renderClock(now = new Date()) {
  const h24 = S.settings.clock24;
  const h = h24 ? String(now.getHours()).padStart(2, '0') : String(now.getHours() % 12 || 12);
  $('#clkTime').textContent = `${h}:${String(now.getMinutes()).padStart(2, '0')}`;
  $('#clkSec').textContent = `:${String(now.getSeconds()).padStart(2, '0')}`;
  $('#clkAmpm').textContent = h24 ? '24H' : (now.getHours() < 12 ? 'AM' : 'PM');
  $('#clkDay').textContent = U.DAY_FULL[now.getDay()].toUpperCase();
  $('#clkDate').textContent = `${now.getDate()} ${U.MONTHS[now.getMonth()].toUpperCase()} ${now.getFullYear()}`;
  const mins = now.getHours() * 60 + now.getMinutes();
  const pct = Math.round(mins / 14.4);
  $('#cycPct').textContent = `${pct}%`;
  const lit = Math.round(pct / 5);
  const bar = $('#cycBar');
  if (bar.childElementCount !== 20) bar.innerHTML = '<i></i>'.repeat(20);
  Array.from(bar.children).forEach((seg, i) => {
    seg.classList.toggle('on', i < lit);
    seg.classList.toggle('tip', i === lit - 1);
  });
}

// ---------------------------------------------------------------- weather
async function fetchWeather() {
  const s = S.settings;
  const loc = s.location;
  if (!loc || loc.lat == null) return;
  const c = s.tempUnit === 'C';
  const url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${loc.lat}&longitude=${loc.lon}`
    + '&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,is_day'
    + '&hourly=temperature_2m,weather_code'
    + '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code'
    + `&temperature_unit=${c ? 'celsius' : 'fahrenheit'}&wind_speed_unit=${c ? 'kmh' : 'mph'}`
    + '&timezone=auto&forecast_days=2';
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Weather service answered ${res.status}`);
    S.weather = await res.json();
    S.wxFetchedAt = new Date();
    S.wxError = null;
  } catch (e) {
    S.wxError = e.message || 'offline';
  }
  renderWeather();
  renderFooter();
}

function hourLabel(iso) {
  const h = Number(iso.slice(11, 13));
  if (S.settings.clock24) return `${String(h).padStart(2, '0')}:00`;
  return `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;
}

function renderWeather() {
  const loc = S.settings.location || {};
  $('#wxLoc').textContent = (loc.name || '').split(',')[0].toUpperCase();
  $('#wxUnit').textContent = S.settings.tempUnit === 'C' ? '°C' : '°F';
  const w = S.weather;
  if (!w || !w.current) {
    $('#wxTemp').textContent = '--';
    $('#wxCond').textContent = S.wxError ? 'NO SIGNAL' : 'LINKING';
    $('#wxIcon').innerHTML = WX_ICONS.cloud;
    $('#wxStats').innerHTML = '';
    $('#wxHours').innerHTML = '';
    return;
  }
  const cur = w.current;
  const info = wxInfo(cur.weather_code, cur.is_day);
  $('#wxTemp').textContent = Math.round(cur.temperature_2m);
  $('#wxCond').textContent = info.label;
  $('#wxIcon').innerHTML = WX_ICONS[info.icon];
  const d = w.daily || {};
  const hi = d.temperature_2m_max ? Math.round(d.temperature_2m_max[0]) : '--';
  const lo = d.temperature_2m_min ? Math.round(d.temperature_2m_min[0]) : '--';
  const rain = d.precipitation_probability_max ? d.precipitation_probability_max[0] : null;
  $('#wxStats').innerHTML = `<span>H <b>${hi}°</b></span><span>L <b>${lo}°</b></span>`
    + (rain != null && rain >= 20 ? `<span>RAIN <b>${rain}%</b></span>` : `<span>WIND <b>${Math.round(cur.wind_speed_10m)}</b></span>`)
    + `<span>HUM <b>${Math.round(cur.relative_humidity_2m)}%</b></span>`;
  const hours = w.hourly || { time: [] };
  let i = hours.time.findIndex((t) => t > cur.time);
  if (i < 0) i = 0;
  const picks = [i, i + 2, i + 4, i + 6].filter((k) => k < hours.time.length);
  $('#wxHours').innerHTML = picks.map((k) =>
    `<div class="wx-hour"><div class="h">${hourLabel(hours.time[k])}</div><div class="t">${Math.round(hours.temperature_2m[k])}°</div></div>`
  ).join('');
}

function weatherSentence() {
  const w = S.weather;
  if (!w || !w.current) return 'Atmospheric data is unavailable right now.';
  const info = wxInfo(w.current.weather_code, w.current.is_day);
  const hi = Math.round(w.daily.temperature_2m_max[0]);
  const lo = Math.round(w.daily.temperature_2m_min[0]);
  const rain = w.daily.precipitation_probability_max ? w.daily.precipitation_probability_max[0] : 0;
  const place = (S.settings.location.name || '').split(',')[0];
  let s = `It's ${Math.round(w.current.temperature_2m)} degrees and ${info.words} in ${place}. Today's high is ${hi}, with a low of ${lo}.`;
  if (rain >= 40) s += ` ${rain} percent chance of rain.`;
  return s;
}

// ---------------------------------------------------------------- calendar data
function calendarById(id) {
  return S.settings.calendars.find((c) => c.id === id);
}

function allEvents() {
  const s = S.settings;
  const list = [];
  for (const e of S.calEvents) {
    const cal = calendarById(e.calId);
    if (!cal || cal.enabled === false) continue;
    list.push({ ...e, start: new Date(e.start), end: new Date(e.end), color: cal.color, calName: cal.name, local: false });
  }
  for (const e of S.localEvents) {
    list.push({ ...e, start: new Date(e.start), end: new Date(e.end), color: s.localCalendarColor, calName: s.localCalendarName || 'Local', local: true });
  }
  list.sort((a, b) => a.start - b.start || (b.allDay ? 1 : 0) - (a.allDay ? 1 : 0));
  return list;
}

function eventsOnDay(day, events = allEvents()) {
  const a = U.startOfDay(day);
  const b = U.addDays(a, 1);
  return events.filter((e) => e.start < b && e.end > a);
}

function monthGridStart(month) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  return U.addDays(first, -first.getDay());
}

async function fetchCalendars(force = false) {
  const cals = S.settings.calendars.filter((c) => c.enabled !== false && c.url);
  const today = U.startOfDay(new Date());
  const gridStart = monthGridStart(S.viewMonth);
  const start = U.addDays(gridStart < today ? gridStart : today, -1);
  const gridEnd = U.addDays(gridStart, 43);
  const soon = U.addDays(today, 60);
  const end = gridEnd > soon ? gridEnd : soon;
  if (!force && S.calRange && S.calRange.start <= start && S.calRange.end >= end) return;
  if (!cals.length) {
    S.calEvents = [];
    S.calErrors = [];
    S.calRange = { start, end };
    renderCalendar();
    renderEvents();
    renderFooter();
    return;
  }
  try {
    const res = await deck.fetchCalendars(cals, start.toISOString(), end.toISOString());
    S.calEvents = res.events;
    S.calErrors = res.errors;
    S.calFetchedAt = new Date();
    FU.relayCalendar(S.calEvents.map((e) => ({ ...e })));
    S.calRange = { start, end };
  } catch (e) {
    S.calErrors = [{ name: 'Calendars', message: e.message }];
  }
  renderCalendar();
  renderEvents();
  renderFooter();
}

// ---------------------------------------------------------------- calendar panel
function renderCalendar() {
  const now = new Date();
  const m = S.viewMonth;
  $('#calMonth').textContent = U.MONTHS[m.getMonth()].toUpperCase();
  $('#calYear').textContent = m.getFullYear();
  const start = monthGridStart(m);
  const events = allEvents();
  const taskDays = new Set(activeTasks().filter((t) => t.due).map((t) => U.dayKey(new Date(t.due))));
  let html = '';
  for (let i = 0; i < 42; i++) {
    const d = U.addDays(start, i);
    const cls = ['cal-cell'];
    if (d.getMonth() !== m.getMonth()) cls.push('out');
    if (d.getDay() === 0 || d.getDay() === 6) cls.push('wkend');
    if (U.sameDay(d, now)) cls.push('today');
    else if (d < U.startOfDay(now)) cls.push('past');
    if (S.selectedDate && U.sameDay(d, S.selectedDate)) cls.push('sel');
    const colors = [...new Set(eventsOnDay(d, events).map((e) => e.color))].slice(0, 3);
    if (taskDays.has(U.dayKey(d)) && colors.length < 4) colors.push('var(--amber)');
    const dots = colors.map((c) => `<i style="background:${esc(c)}"></i>`).join('');
    const label = `${U.DAY_FULL[d.getDay()]} ${U.MONTHS[d.getMonth()]} ${d.getDate()}`;
    html += `<button type="button" class="${cls.join(' ')}" data-day="${U.dayKey(d)}" aria-label="${label}"><span>${String(d.getDate()).padStart(2, '0')}</span><span class="cal-dots">${dots}</span></button>`;
  }
  $('#calGrid').innerHTML = html;
  const legend = ['<span><i style="background:rgba(var(--accent-rgb),.15);box-shadow:inset 0 0 0 1px var(--amber)"></i>TODAY</span>'];
  S.settings.calendars.filter((c) => c.enabled !== false && c.url).slice(0, 4).forEach((c) => {
    legend.push(`<span><i style="background:${esc(c.color)}"></i>${esc(c.name.toUpperCase())}</span>`);
  });
  if (S.localEvents.length) legend.push(`<span><i style="background:${esc(S.settings.localCalendarColor)}"></i>${esc((S.settings.localCalendarName || 'LOCAL').toUpperCase())}</span>`);
  legend.push('<span><i style="background:var(--amber)"></i>TASKS DUE</span>');
  $('#calLegend').innerHTML = legend.join('');
}

// ---------------------------------------------------------------- events panel
// ---------------------------------------------------------------- projects
const PROJECT_COLORS = ['#F2A65A', '#A8B0D8', '#F4B6A0', '#B8E27A', '#D9A9C6', '#4FD1E8'];

function projectActive(id) {
  const p = id && S.projects.find((x) => x.id === id);
  return !!(p && p.status !== 'done');
}

// Finished one-off tasks leave the next day, unless they belong to a live project.
function archivable(t, now = new Date()) {
  return t.done && t.doneAt && !U.sameDay(new Date(t.doneAt), now) && !projectActive(t.projectId);
}

function projectStats(p) {
  const tasks = S.tasks.filter((t) => t.projectId === p.id);
  const done = tasks.filter((t) => t.done).length;
  const open = sortTasks(tasks.filter((t) => !t.done));
  return { tasks, done, total: tasks.length, pct: tasks.length ? Math.round((done / tasks.length) * 100) : 0, next: open[0] || null };
}

function activeProjects() {
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

function projectDueLabel(p, now = new Date()) {
  if (!p.due) return 'NO DATE';
  const d = projectDue(p);
  const days = U.daysBetween(U.startOfDay(now), U.startOfDay(d));
  if (days < 0) return `OVERDUE · ${U.dayLabel(d, now)}`;
  return `DUE ${U.dayLabel(d, now)}`;
}

const CREW_COLORS = ['#B8E27A', '#D9A9C6', '#A8B0D8', '#F4B6A0', '#4FD1E8', '#F2A65A'];
function crewBadge(projectId) {
  const crew = FU.shares(projectId);
  if (!crew.length) return '';
  return `<span class="crew-avs" title="Shared with ${esc(crew.map((c) => c.guest).join(', '))}">${crew.slice(0, 3).map((c, i) => `<span class="crew-av" style="width:16px;height:16px;font-size:8.5px;background:${CREW_COLORS[i % CREW_COLORS.length]}">${esc((c.guest || '?').slice(0, 1).toUpperCase())}</span>`).join('')}</span>`;
}

function renderProjects() {
  const now = new Date();
  const list = activeProjects();
  $('#tkCount').textContent = `${list.length} ACTIVE`;
  const el = $('#tkList');
  if (!list.length) {
    el.innerHTML = '<div class="empty">No projects yet.<br>Tap <b>+ Project</b>, or say <b>"new project garage cleanout"</b>.<br>Then file tasks with <b>"…to the garage cleanout project"</b>.</div>';
    return;
  }
  el.innerHTML = list.map((p) => {
    const st = projectStats(p);
    const col = p.color || 'var(--amber)';
    const filled = st.total ? Math.round((st.done / st.total) * 10) : 0;
    const segs = Array.from({ length: 10 }, (_, i) => `<i style="${i < filled ? `background:${esc(col)}` : ''}"></i>`).join('');
    const due = projectDueLabel(p, now);
    return `<button type="button" class="pj-card" data-project="${esc(p.id)}" style="--pc:${esc(col)}">
      <span class="pj-top"><span class="pj-name">${esc(p.name)}</span><span class="pj-top-r">${crewBadge(p.id)}<span class="pj-pct">${st.pct}%</span></span></span>
      <span class="pj-bar">${segs}</span>
      <span class="pj-meta"><span>${st.done}/${st.total} TASKS${st.next ? ` · NEXT: <b>${esc(st.next.title)}</b>` : ''}</span><span class="${due.startsWith('OVERDUE') ? 'over' : ''}">${esc(due)}</span></span>
    </button>`;
  }).join('');
}

function upsertProject(p, isNew) {
  if (isNew) S.projects.push({ ...p, createdAt: p.createdAt || new Date().toISOString(), status: 'active' });
  else {
    const i = S.projects.findIndex((x) => x.id === p.id);
    if (i >= 0) S.projects[i] = p; else S.projects.push(p);
  }
  saveProjects();
}

function deleteProject(id) {
  S.projects = S.projects.filter((p) => p.id !== id);
  S.tasks = S.tasks.map((t) => (t.projectId === id ? { ...t, projectId: null } : t));
  saveTasks();
  saveProjects();
}

function completeProject(id) {
  const p = S.projects.find((x) => x.id === id);
  if (!p) return;
  p.status = 'done';
  p.completedAt = new Date().toISOString();
  saveProjects();
  sounds.complete && sounds.complete();
}

function newProject(name, extra = {}) {
  const used = new Set(S.projects.filter((p) => p.status !== 'done').map((p) => p.color));
  const color = PROJECT_COLORS.find((c) => !used.has(c)) || PROJECT_COLORS[S.projects.length % PROJECT_COLORS.length];
  const p = { id: U.uid(), name, goal: '', color, due: null, status: 'active', createdAt: new Date().toISOString(), ...extra };
  S.projects.push(p);
  saveProjects();
  return p;
}

function findProject(query) {
  const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const q = norm(query);
  if (!q) return null;
  const live = S.projects.filter((p) => p.status !== 'done');
  return live.find((p) => norm(p.name) === q) || live.find((p) => norm(p.name).includes(q) || q.includes(norm(p.name))) || null;
}

function wireProjects() {
  $$('.tk-views button').forEach((b) => b.addEventListener('click', () => {
    sounds.click();
    S.tkView = b.dataset.tkview;
    renderTasks();
  }));
  $('#tkList').addEventListener('click', (e) => {
    const c = e.target.closest('[data-project]');
    if (!c) return;
    const p = S.projects.find((x) => x.id === c.dataset.project);
    if (p) { sounds.click(); openProject(p); }
  });
}

// ---------------------------------------------------------------- schedule (shifts & appointments)
function scheduleTypes() {
  const t = S.settings.scheduleTypes;
  return Array.isArray(t) && t.length ? t : DEFAULT_TYPES;
}

function typeChip(typeId) {
  const t = typeOf(scheduleTypes(), typeId);
  return `<span class="sc-chip" style="--tc:${esc(t.color)}">${esc(t.short || shortName(t.name))}</span>`;
}

const REPLY_LABEL = { ok: '✓ GOT IT', change: '⚠ CHANGE REQUEST' };
function scheduleReplies(e) {
  const live = new Set(FU.scheduleShares().map((c) => c.token));
  const all = Object.entries(e.replies || {});
  return live.size ? all.filter(([token]) => live.has(token)) : all;
}

function renderSchedule() {
  const now = new Date();
  if (!S.schedWeek) S.schedWeek = weekStart(now);
  const days = weekDays(S.schedule, S.schedWeek, now);
  const count = days.reduce((n, d) => n + d.items.length, 0);
  $('#tkCount').textContent = `${count} THIS WEEK`.replace('THIS WEEK', ymd(S.schedWeek) === ymd(weekStart(now)) ? 'THIS WEEK' : 'THAT WEEK');
  const shares = FU.scheduleShares();
  const crew = shares.length ? `<button type="button" class="crew-chip sc-crew" data-sc="share" title="Shared with ${esc(shares.map((c) => c.guest).join(', '))}"><span class="crew-avs">${shares.slice(0, 3).map((c, i) => `<span class="crew-av" style="width:16px;height:16px;font-size:8.5px;background:${CREW_COLORS[i % CREW_COLORS.length]}">${esc((c.guest || '?').slice(0, 1).toUpperCase())}</span>`).join('')}</span>SHARED · ${shares.length}</button>` : '';
  let html = `<div class="sc-bar">
    <button type="button" class="sc-nav" data-sc="prev" aria-label="Previous week">‹</button>
    <span class="sc-week">${esc(weekLabel(S.schedWeek, now))}</span>
    <button type="button" class="sc-nav" data-sc="next" aria-label="Next week">›</button>
    <span class="sc-bar-r">${ymd(S.schedWeek) !== ymd(weekStart(now)) ? '<button type="button" class="mini-btn" data-sc="today">THIS WEEK</button>' : ''}${crew}<button type="button" class="mini-btn sc-share" data-sc="share">SHARE</button></span>
  </div>`;
  if (!days.length) {
    html += '<div class="empty">Nothing scheduled this week.<br>Tap <b>+ Add</b> for a shift or appointment, then <b>Share</b> it with someone.</div>';
  }
  for (const d of days) {
    html += `<div class="tk-sep${d.label.startsWith('TODAY') ? ' today' : ''}"><span>${esc(d.label)}</span><span>${d.items.length}</span></div>`;
    for (const e of d.items) {
      const replies = scheduleReplies(e);
      const badges = replies.map(([token, r], i) => `<span class="sc-reply ${r.state === 'change' ? 'chg' : 'ok'}"><span class="crew-av" style="width:15px;height:15px;font-size:8px;background:${CREW_COLORS[i % CREW_COLORS.length]}">${esc((r.by || FU.scheduleGuest(token) || '?').slice(0, 1).toUpperCase())}</span>${REPLY_LABEL[r.state] || ''}</span>`).join('');
      const pending = shares.length && !replies.length ? '<span class="sc-reply none">NO REPLY YET</span>' : '';
      const changes = replies.filter(([, r]) => r.state === 'change');
      html += `<div class="sc-row" data-sched="${esc(e.id)}" role="button" tabindex="0">
        <div class="sc-main"><span class="sc-title">${esc(e.title)}</span>${typeChip(e.type)}</div>
        <div class="sc-side">${badges || pending}</div>
        ${timeRange(e.start, e.end, S.settings.clock24) ? `<div class="sc-time">${esc(timeRange(e.start, e.end, S.settings.clock24))}</div>` : ''}
        ${e.note ? `<div class="sc-note">Note: ${esc(e.note)}</div>` : ''}
        ${changes.map(([, r]) => `<div class="sc-change"><span class="sc-change-by">${esc((r.by || 'GUEST').toUpperCase())} · ${esc(whenShortMs(r.at))}${r.comment ? '' : ' · NO NOTE'}</span>${esc(r.comment || '')}<span class="sc-change-btns"><button type="button" class="mini-btn amber" data-sc-date="${esc(e.id)}">CHANGE DATE</button></span></div>`).join('')}
      </div>`;
    }
  }
  $('#tkList').innerHTML = html;
}

function whenShortMs(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return U.sameDay(d, new Date()) ? U.fmtTimeShort(d, S.settings.clock24) : `${U.MON[d.getMonth()]} ${d.getDate()}`;
}

function upsertScheduleEntry(entry, prev) {
  const e = { ...entry, title: String(entry.title || '').trim().slice(0, 120), note: String(entry.note || '').trim().slice(0, 300), start: parseTime(entry.start), end: parseTime(entry.end) };
  // A moved, retimed or renamed entry asks again: earlier replies were for the old version.
  if (prev && (prev.date !== e.date || prev.title !== e.title || prev.type !== e.type || (prev.start || '') !== e.start || (prev.end || '') !== e.end)) e.replies = {};
  const i = S.schedule.findIndex((x) => x.id === e.id);
  if (i >= 0) S.schedule[i] = e; else S.schedule.push({ ...e, createdAt: e.createdAt || Date.now(), replies: e.replies || {} });
  const d = parseYmd(e.date);
  if (d) S.schedWeek = weekStart(d);
  saveSchedule();
}

function deleteScheduleEntry(id) {
  S.schedule = S.schedule.filter((x) => x.id !== id);
  saveSchedule();
}

function addScheduleType(name, color) {
  const clean = String(name || '').trim().slice(0, 24);
  if (!clean) return null;
  const types = scheduleTypes();
  const have = types.find((t) => t.name.toLowerCase() === clean.toLowerCase());
  if (have) return have;
  const used = new Set(types.map((t) => t.color));
  const t = { id: U.uid(), name: clean, short: shortName(clean), color: color || TYPE_COLORS.find((c) => !used.has(c)) || TYPE_COLORS[types.length % TYPE_COLORS.length] };
  saveSettings({ ...S.settings, scheduleTypes: [...types, t] }, { refetch: false });
  return t;
}

function removeScheduleType(id) {
  if (id === 'other') return;
  S.schedule = S.schedule.map((e) => (e.type === id ? { ...e, type: 'other' } : e));
  saveSchedule();
  saveSettings({ ...S.settings, scheduleTypes: scheduleTypes().filter((t) => t.id !== id) }, { refetch: false });
}

// Replies to schedule links (GOT IT / CHANGE REQUEST), relayed in by the uplink.
function applyReplies(changes) {
  for (const c of changes) {
    const e = S.schedule.find((x) => x.id === c.entryId);
    if (e) e.replies = { ...(e.replies || {}), [c.token]: c.reply };
  }
  saveSchedule();
}

function scheduleActivity(events) {
  if (!events.length) return;
  const change = events.some((e) => e.state === 'change');
  lights('crew', true, { kind: change ? 'change' : 'ok' });
  if (change) sounds.reminder(); else sounds.add();
  events.slice(-3).forEach((e) => pushLog(e.state === 'change' ? 'err' : 'ok', e.text));
  toast(events[events.length - 1].text, change ? 6000 : 3500);
}

function wireSchedule() {
  $('#tkList').addEventListener('click', (e) => {
    if (S.tkView !== 'schedule') return;
    const nav = e.target.closest('[data-sc]');
    if (nav) {
      sounds.click();
      const a = nav.dataset.sc;
      if (a === 'prev') S.schedWeek = addDays(S.schedWeek, -7);
      else if (a === 'next') S.schedWeek = addDays(S.schedWeek, 7);
      else if (a === 'today') S.schedWeek = weekStart(new Date());
      else if (a === 'share') { openScheduleShare(); return; }
      renderTasks();
      return;
    }
    const dt = e.target.closest('[data-sc-date]');
    if (dt) { const it = S.schedule.find((x) => x.id === dt.dataset.scDate); if (it) { sounds.click(); openScheduleEditor(it, { focus: 'date' }); } return; }
    const row = e.target.closest('[data-sched]');
    if (row) { const it = S.schedule.find((x) => x.id === row.dataset.sched); if (it) { sounds.click(); openScheduleEditor(it); } }
  });
  $('#tkList').addEventListener('keydown', (e) => {
    if (S.tkView !== 'schedule' || (e.key !== 'Enter' && e.key !== ' ')) return;
    const row = e.target.closest('[data-sched]');
    if (row && e.target === row) { e.preventDefault(); row.click(); }
  });
}

// ---------------------------------------------------------------- notepad
const NOTE_SRC = { scan: ['SCANNED', 'var(--lav)'], voice: ['VOICE', 'var(--amber)'], comms: ['COMMS', 'var(--amber)'], typed: ['TYPED', 'var(--muted)'] };
let noteQuery = '';

function sortedNotes() {
  return S.notes.slice().sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || new Date(b.editedAt || b.createdAt) - new Date(a.editedAt || a.createdAt));
}

function noteWhen(iso, now = new Date()) {
  if (!iso) return '';
  const d = new Date(iso);
  if (U.sameDay(d, now)) return U.fmtTimeShort(d, S.settings.clock24);
  return U.dayLabel(d, now);
}

function renderNotes() {
  const el = $('#ntList');
  if (!el) return;
  const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const q = norm(noteQuery);
  const all = sortedNotes();
  const list = q ? all.filter((n) => norm(`${n.title} ${n.body}`).includes(q)) : all;
  $('#ntCount').textContent = S.notes.length ? String(S.notes.length) : '';
  if (!list.length) {
    el.innerHTML = q
      ? `<div class="empty">No notes match "${esc(noteQuery)}".</div>`
      : '<div class="empty">No notes yet. Tap <b>+ Note</b>, say <b>"take a note…"</b>, or use <b>Field Scan</b> on the phone.</div>';
    return;
  }
  el.innerHTML = list.map((n) => {
    const [src, col] = NOTE_SRC[n.src] || NOTE_SRC.typed;
    const preview = String(n.body || '').split('\n').map((l) => l.trim()).filter(Boolean).filter((l) => l !== n.title).join(' · ');
    return `<button type="button" class="nt-row" data-note="${esc(n.id)}">
      <span class="nt-top"><span class="nt-title">${esc(n.title || 'Untitled')}</span>${n.pinned ? '<svg class="nt-pin" width="11" height="11" viewBox="0 0 12 12" role="img" aria-label="Pinned"><path d="M4 1 H8 L7.4 5 L9.5 7 H2.5 L4.6 5 Z M6 7 V11" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>' : ''}</span>
      ${preview ? `<span class="nt-prev">${esc(preview)}</span>` : ''}
      <span class="nt-meta"><span class="src" style="color:${col};box-shadow:inset 0 0 0 1px ${col}">${src}</span><span>${esc(noteWhen(n.editedAt || n.createdAt))}</span></span>
    </button>`;
  }).join('');
}

function upsertNote(note, isNew) {
  const now = new Date().toISOString();
  const out = { ...note, editedAt: now, editedOn: 'command' };
  if (isNew) { out.createdAt = out.createdAt || now; S.notes.unshift(out); }
  else {
    const i = S.notes.findIndex((n) => n.id === out.id);
    if (i >= 0) S.notes[i] = out; else S.notes.unshift(out);
  }
  saveNotes();
}

function deleteNote(id) {
  S.notes = S.notes.filter((n) => n.id !== id);
  saveNotes();
}

function noteToTask(note) {
  const t = { ...blankTask(), title: note.title || 'From a note', notes: note.body || '' };
  upsertTask(t, true);
  toast(`Task logged: ${t.title}`);
}

function wireNotes() {
  $('#btnNewNote').addEventListener('click', () => { sounds.click(); openNoteEditor(null); });
  $('#btnNoteSearch').addEventListener('click', () => {
    const inp = $('#ntSearch');
    inp.hidden = !inp.hidden;
    if (inp.hidden) { noteQuery = ''; inp.value = ''; renderNotes(); } else inp.focus();
  });
  $('#ntSearch').addEventListener('input', (e) => { noteQuery = e.target.value; renderNotes(); });
  $('#ntSearch').addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#btnNoteSearch').click(); });
  $('#ntList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-note]');
    if (!b) return;
    const n = S.notes.find((x) => x.id === b.dataset.note);
    if (n) { sounds.click(); openNoteEditor(n); }
  });
}

function renderEvents() {
  const now = new Date();
  const sel = S.selectedDate || U.startOfDay(now);
  const fromToday = U.sameDay(sel, now);
  const from = fromToday ? now : U.startOfDay(sel);
  const until = U.addDays(U.startOfDay(sel), 14);
  const list = allEvents().filter((e) => e.end > from && e.start < until).slice(0, 40);
  $('#evRange').textContent = fromToday ? 'NEXT 14 DAYS' : `FROM ${U.dayLabel(sel, now)}`;
  const el = $('#evList');
  if (!list.length) {
    const hasCals = S.settings.calendars.some((c) => c.url);
    el.innerHTML = `<div class="empty">No events in range.${hasCals ? '' : '<br>Add calendar links in <b>Settings › Calendars</b>,<br>or tap <b>+ New event</b>.'}</div>`;
    return;
  }
  el.innerHTML = list.map((e) => {
    const startDay = e.start < U.startOfDay(now) ? now : e.start;
    const day = U.dayLabel(startDay, now);
    const isToday = day === 'TODAY';
    const time = e.allDay ? 'ALL DAY' : U.fmtTimeShort(e.start, S.settings.clock24);
    const happening = !e.allDay && e.start <= now && e.end > now;
    const durMin = Math.round((e.end - e.start) / 60000);
    const meta = e.location || (e.allDay ? '' : durMin >= 60 ? `${+(durMin / 60).toFixed(1)} HR` : `${durMin} MIN`);
    const tag = `<span class="src" style="color:${esc(e.color)};box-shadow:inset 0 0 0 1px ${esc(e.color)}66">${esc((e.calName || '').toUpperCase().slice(0, 12))}</span>`;
    return `<div class="ev${e.local ? ' local' : ''}${happening ? ' now' : ''}" ${e.local ? `data-ev="${esc(e.id)}" role="button" tabindex="0"` : ''} title="${esc(e.title)}">
      <div><div class="ev-day${isToday ? ' today' : ''}">${day}</div><div class="ev-time">${time}</div></div>
      <div style="min-width:0"><div class="ev-title">${esc(e.title)}</div><div class="ev-meta">${tag}<span class="loc">${esc(meta)}</span></div></div>
    </div>`;
  }).join('');
}

// ---------------------------------------------------------------- tasks
function activeTasks() {
  return S.tasks.filter((t) => !t.done);
}

function isOverdue(t, now = new Date()) {
  if (!t.due || t.done) return false;
  const d = new Date(t.due);
  return t.dueHasTime ? d < now : d < U.startOfDay(now);
}

function dueLabel(t, now = new Date()) {
  if (!t.due) return 'NO DATE';
  const d = new Date(t.due);
  let s = U.dayLabel(d, now);
  if (t.dueHasTime) s += ` · ${U.fmtTimeShort(d, S.settings.clock24)}`;
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

function categoryById(id) {
  return S.settings.categories.find((c) => c.id === id);
}

function taskRow(t, now) {
  const over = isOverdue(t, now);
  const pri = PRI[t.priority] || PRI.medium;
  const cat = categoryById(t.category);
  const cls = ['tk'];
  if (t.done) cls.push('done');
  if (over) cls.push('overdue');
  if (t.id === S.newTaskId) cls.push('new');
  const meta = [];
  if (cat) meta.push(`<span class="tag" style="color:${esc(cat.color)};box-shadow:inset 0 0 0 1px ${esc(cat.color)}66">${esc(cat.name.toUpperCase())}</span>`);
  meta.push(`<span class="${over ? 'over' : ''}">${over ? 'OVERDUE · ' : ''}${dueLabel(t, now)}</span>`);
  const proj = t.projectId && S.projects.find((p) => p.id === t.projectId);
  if (proj) meta.push(`<span class="ic pj-tag" style="color:${esc(proj.color || 'var(--lav)')}"><i style="background:${esc(proj.color || 'var(--lav)')}"></i>${esc(proj.name.toUpperCase())}</span>`);
  if (t.assignee) meta.push(`<span class="ic">${IC.person}${esc(t.assignee.toUpperCase())}</span>`);
  if (t.reminder != null && t.due) meta.push(`<span class="ic rem" title="Reminder set">${IC.bell}</span>`);
  if (t.repeat && t.repeat.type !== 'none') meta.push(`<span class="ic">${IC.repeat}${U.repeatLabel(t.repeat)}</span>`);
  if (t.subtasks && t.subtasks.length) meta.push(`<span class="ic">${IC.list}${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length}</span>`);
  if (t.notes && t.notes.trim()) meta.push(`<span class="ic" title="Has notes">${IC.note}</span>`);
  if (t.done && t.doneBy) meta.push(`<span class="ic crew">DONE BY ${esc(t.doneBy.toUpperCase())}</span>`);
  else if (t.addedBy) meta.push(`<span class="ic crew">ADDED BY ${esc(t.addedBy.toUpperCase())}</span>`);
  if (t.comments && t.comments.length) meta.push(`<span class="ic crew" title="Crew notes">${IC.note}${t.comments.length}</span>`);
  const segs = [0, 1, 2].map((i) => `<i class="${!t.done && i < pri.n ? 'lit' : ''}" style="${!t.done && i < pri.n ? `background:${pri.color}` : ''}"></i>`).join('');
  return `<div class="${cls.join(' ')}" data-id="${esc(t.id)}">
    <button type="button" class="tk-box" data-act="toggle" aria-label="${t.done ? 'Mark not done' : 'Mark done'}: ${esc(t.title)}">${t.done ? IC.check : ''}</button>
    <button type="button" class="tk-main" data-act="edit" aria-label="Edit ${esc(t.title)}">
      <span class="tk-title" style="display:block">${esc(t.title)}</span>
      <span class="tk-meta" style="display:flex">${meta.join('')}</span>
    </button>
    <div class="tk-pri" aria-label="${pri.label} priority">${segs}<span style="color:${t.done ? '#5C5966' : pri.color}">${pri.label}</span></div>
  </div>`;
}

function renderTasks() {
  $$('.tk-views button').forEach((b) => b.classList.toggle('on', b.dataset.tkview === S.tkView));
  $('#btnAddTask').textContent = S.tkView === 'projects' ? '+ PROJECT' : S.tkView === 'schedule' ? '+ ADD' : '+ ADD TASK';
  $('#tkChips').hidden = S.tkView !== 'queue';
  if (S.tkView === 'projects') { renderProjects(); checkRedAlert(); return; }
  if (S.tkView === 'schedule') { renderSchedule(); checkRedAlert(); return; }
  const now = new Date();
  const cats = S.settings.categories;
  if (S.filter !== 'all' && !cats.some((c) => c.id === S.filter)) S.filter = 'all';
  const active = activeTasks();
  $('#tkCount').textContent = `${active.length} ACTIVE`;
  $('#tkChips').innerHTML = [`<button type="button" class="chip${S.filter === 'all' ? ' on' : ''}" data-filter="all">ALL</button>`]
    .concat(cats.map((c) => `<button type="button" class="chip${S.filter === c.id ? ' on' : ''}" data-filter="${esc(c.id)}" style="${S.filter === c.id ? '' : `color:${esc(c.color)}`}">${esc(c.name.toUpperCase())}</button>`))
    .join('');
  const inFilter = (t) => S.filter === 'all' || t.category === S.filter;
  const list = sortTasks(active.filter(inFilter), now);
  const done = S.tasks.filter((t) => t.done && inFilter(t) && !t.queueCleared && t.doneAt && U.sameDay(new Date(t.doneAt), now)).sort((a, b) => new Date(b.doneAt) - new Date(a.doneAt));
  let html = list.map((t) => taskRow(t, now)).join('');
  if (!list.length) {
    html = `<div class="empty">Queue clear${S.filter === 'all' ? '' : ' in this category'}.<br>Type below, tap <b>+ Add task</b>, or hail the computer.</div>`;
  }
  if (done.length) {
    html += `<div class="tk-sep"><span>COMPLETED · ${done.length}</span><button type="button" class="mini-btn" data-act="clear-done">CLEAR</button></div>`;
    html += done.slice(0, 20).map((t) => taskRow(t, now)).join('');
  }
  $('#tkList').innerHTML = html;
  S.newTaskId = null;
  checkRedAlert();
}

function blankTask() {
  return {
    id: U.uid(),
    title: '',
    due: null,
    dueHasTime: false,
    priority: 'medium',
    category: null,
    assignee: null,
    reminder: null,
    repeat: { type: 'none', interval: 1, days: [] },
    subtasks: [],
    notes: '',
    done: false,
    doneAt: null,
    createdAt: new Date().toISOString(),
    remindedFor: null
  };
}

function upsertTask(task, isNew) {
  if (isNew) {
    S.tasks.unshift(task);
    S.newTaskId = task.id;
    sounds.add();
  } else {
    const i = S.tasks.findIndex((t) => t.id === task.id);
    if (i >= 0) {
      const prev = S.tasks[i];
      if (prev.due !== task.due || prev.reminder !== task.reminder) task.remindedFor = null;
      S.tasks[i] = task;
    }
  }
  saveTasks();
  renderTasks();
  renderCalendar();
}

function deleteTask(id) {
  S.tasks = S.tasks.filter((t) => t.id !== id);
  saveTasks();
  renderTasks();
  renderCalendar();
}

function completeTask(id, by = null) {
  const t = S.tasks.find((x) => x.id === id);
  if (!t) return null;
  sounds.complete();
  if (t.repeat && t.repeat.type !== 'none' && t.due) {
    let next = U.advanceDate(new Date(t.due), t.repeat);
    const today = U.startOfDay(new Date());
    let guard = 0;
    while (next && next < today && guard++ < 500) next = U.advanceDate(next, t.repeat);
    if (next) {
      t.due = next.toISOString();
      t.remindedFor = null;
      t.completions = (t.completions || 0) + 1;
      (t.subtasks || []).forEach((s) => { s.done = false; });
      toast(`${t.title} → next ${U.dayLabel(next)}`);
    }
  } else {
    t.done = true;
    t.doneAt = new Date().toISOString();
    t.doneBy = by || null;
  }
  saveTasks();
  renderTasks();
  renderCalendar();
  refreshOpenProject();
  return t;
}

function uncompleteTask(id) {
  const t = S.tasks.find((x) => x.id === id);
  if (!t) return;
  t.done = false;
  t.doneAt = null;
  t.doneBy = null;
  saveTasks();
  renderTasks();
  renderCalendar();
  refreshOpenProject();
}

// ---------------------------------------------------------------- project manifest (guests)
// Changes a guest made through a share link, relayed in by the uplink.
function guestChanges(changes) {
  for (const c of changes) {
    const t = S.tasks.find((x) => x.id === c.taskId);
    if (c.type === 'add' && !t) S.tasks.unshift({ ...blankTask(), ...c.task, id: c.taskId, projectId: c.projectId });
    else if (c.type === 'update' && t) Object.assign(t, c.task);
    else if (c.type === 'complete' && t && !t.done) completeTask(t.id, c.by);
    else if (c.type === 'reopen' && t && t.done) uncompleteTask(t.id);
    else if (c.type === 'delete' && t) S.tasks = S.tasks.filter((x) => x.id !== c.taskId);
  }
  saveTasks();
  renderTasks();
  renderCalendar();
  refreshOpenProject();
}

function mergeLog(a = [], b = []) {
  const map = new Map();
  [...a, ...b].forEach((e) => { if (e && e.id && !map.has(e.id)) map.set(e.id, e); });
  return [...map.values()].sort((x, y) => (x.at || 0) - (y.at || 0)).slice(-200);
}

function addProjectLog(projectId, entries) {
  const p = S.projects.find((x) => x.id === projectId);
  if (!p) return;
  p.log = mergeLog(p.log, entries);
  saveProjects();
  renderTasks();
  refreshOpenProject();
}

function postProjectLog(projectId, text) {
  const t = String(text || '').trim();
  if (!t) return;
  addProjectLog(projectId, [{ id: U.uid(), by: S.settings.operatorName || 'Command', text: t.slice(0, 1000), at: Date.now() }]);
}

function guestActivity(events) {
  if (!events.length) return;
  sounds.add();
  lights('crew', true, { kind: 'ok' });
  if (events.length > 3) {
    const projects = [...new Set(events.map((e) => e.project).filter(Boolean))];
    pushLog('ok', `${events.length} crew updates${projects.length === 1 ? ` on ${projects[0]}` : ''}.`);
  }
  events.slice(-3).forEach((e) => pushLog('ok', `${e.text}${e.project ? ` · ${e.project}` : ''}`));
  toast(events[events.length - 1].text, 4000);
}

let openProjectRefresh = null;
function refreshOpenProject() { if (openProjectRefresh) openProjectRefresh(); }

function findTask(query) {
  const words = (s) => String(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !['the', 'my', 'a', 'an', 'to'].includes(w));
  const q = words(query);
  if (!q.length) return null;
  let best = null;
  let bestScore = 0;
  for (const t of activeTasks()) {
    const tw = words(t.title);
    const hits = q.filter((w) => tw.some((x) => x.startsWith(w) || w.startsWith(x))).length;
    let score = hits / Math.max(q.length, 1);
    if (t.title.toLowerCase().includes(String(query).toLowerCase())) score += 0.5;
    if (score > bestScore) { bestScore = score; best = t; }
  }
  return bestScore >= 0.5 ? best : null;
}

// ---------------------------------------------------------------- local events
function upsertLocalEvent(ev, isNew) {
  if (isNew) {
    S.localEvents.push(ev);
    sounds.add();
  } else {
    const i = S.localEvents.findIndex((e) => e.id === ev.id);
    if (i >= 0) S.localEvents[i] = ev;
  }
  saveLocalEvents();
  renderCalendar();
  renderEvents();
}

function deleteLocalEvent(id) {
  S.localEvents = S.localEvents.filter((e) => e.id !== id);
  saveLocalEvents();
  renderCalendar();
  renderEvents();
}

// ---------------------------------------------------------------- footer
function renderFooter() {
  const s = S.settings;
  const parts = [];
  if (S.redAlertCount) parts.push(`<span class="warn">RED ALERT · ${S.redAlertCount} OVERDUE</span>`);
  if (S.calErrors.length) parts.push(`<span class="warn">${S.calErrors.length} CAL FEED${S.calErrors.length > 1 ? 'S' : ''} OFFLINE</span>`);
  else if (!S.redAlertCount) parts.push('<span class="ok">SYS NOMINAL</span>');
  if (isQuiet()) parts.push('QUIET HOURS');
  const fu = FU.state();
  if (fu.linked) {
    const n = fu.phones;
    const extra = fu.role === 'joined' ? ' · JOINED DECK' : fu.consoles ? ` · +${fu.consoles} CONSOLE${fu.consoles === 1 ? '' : 'S'}` : '';
    const label = fu.status === 'online' ? `UPLINK ONLINE · ${n} FIELD UNIT${n === 1 ? '' : 'S'}${extra}`
      : fu.status === 'connecting' ? 'UPLINK CONNECTING'
        : fu.status === 'error' ? '<span class="warn">UPLINK ERROR</span>' : '<span class="warn">UPLINK OFFLINE</span>';
    parts.push(label);
  }
  if (S.calFetchedAt) parts.push(`CAL SYNC ${U.fmtTimeShort(S.calFetchedAt, s.clock24)}`);
  if (S.wxFetchedAt) parts.push(`OPEN-METEO ${U.fmtTimeShort(S.wxFetchedAt, s.clock24)}`);
  else if (S.wxError) parts.push('<span class="warn">WEATHER OFFLINE</span>');
  $('#footLeft').innerHTML = parts.join(' · ');
  const label = (name, st) => (st.state === 'ready' ? `${name} READY`
    : st.state === 'loading' ? `${name} ${st.progress || 0}%`
      : st.state === 'error' ? `<span class="warn">${name} OFFLINE</span>` : `${name} STANDBY`);
  const parts2 = [label('MIC CORE', voiceStatus())];
  if (s.voiceEngine === 'neural' && s.voiceEnabled) parts2.push(label('VOICE SYNTH', ttsStatus()));
  parts2.push(`LAYOUT ${s.layoutLocked ? 'LOCKED' : '<span class="warn">UNLOCKED</span>'}`, VERSION);
  $('#footRight').innerHTML = parts2.join(' · ');
  if (S.calErrors.length) $('#footLeft').title = S.calErrors.map((e) => `${e.name}: ${e.message}`).join('\n');
}

function renderAll() {
  renderClock();
  renderWeather();
  renderCalendar();
  renderEvents();
  renderTasks();
  renderNotes();
  renderLog();
  renderFooter();
}

// ---------------------------------------------------------------- speech output
let voices = [];
function loadVoices() {
  voices = speechSynthesis.getVoices();
}
speechSynthesis.onvoiceschanged = loadVoices;
loadVoices();

function englishVoices() {
  return voices.filter((v) => /^en/i.test(v.lang));
}

function pickVoice() {
  const name = S.settings.voiceName;
  return voices.find((v) => v.name === name)
    || voices.find((v) => /en-US/i.test(v.lang) && /Microsoft/i.test(v.name))
    || voices.find((v) => /^en/i.test(v.lang))
    || null;
}

function stopSpeaking() {
  speechSynthesis.cancel();
  stopNeural();
}

// Routes speech to the on-device neural voice when it's ready, otherwise to
// the built-in Windows voice (also the fallback while the neural one downloads).
async function speak(text, as = 'speaking', override = null) {
  const s = S.settings;
  const enabled = override ? override.enabled : s.voiceEnabled;
  if (!enabled || !text) return;
  const engine = (override && override.engine) || s.voiceEngine;
  if (engine === 'neural') {
    const st = ttsStatus().state;
    if (st === 'ready') {
      stopSpeaking();
      if (S.voice === 'idle') setVoiceState(as);
      try {
        const o = override || {};
        await speakNeural(text, {
          voice: o.neuralVoice || s.neuralVoice || 'am_fenrir',
          speed: o.rate || s.voiceRate || 1,
          fx: o.fx || s.voiceFx || 'robot',
          depth: o.depth ?? s.voiceDepth ?? 35,
          strength: o.strength ?? s.voiceFxStrength ?? 60
        });
        if (S.voice === 'speaking' || S.voice === 'greeting') setVoiceState('idle');
        return;
      } catch (e) {
        if (S.voice === 'speaking' || S.voice === 'greeting') setVoiceState('idle');
        // fall through to the Windows voice
      }
    } else if (st !== 'loading') {
      loadTts().catch(() => {});
    }
  }
  await speakWindows(text, as, override);
}

function speakWindows(text, as, override) {
  return new Promise((resolve) => {
    stopSpeaking();
    const u = new SpeechSynthesisUtterance(text);
    const v = override && override.voice ? voices.find((x) => x.name === override.voice) : pickVoice();
    if (v) u.voice = v;
    u.rate = (override && override.rate) || S.settings.voiceRate || 1;
    u.pitch = 0.92;
    if (S.voice === 'idle') setVoiceState(as);
    let finished = false;
    const fin = () => {
      if (finished) return;
      finished = true;
      if (S.voice === 'speaking' || S.voice === 'greeting') setVoiceState('idle');
      resolve();
    };
    u.onend = fin;
    u.onerror = fin;
    setTimeout(fin, 2500 + text.length * 95);
    speechSynthesis.speak(u);
  });
}

// ---------------------------------------------------------------- the computer
const GREETINGS = {
  morning: ['Good morning, {n}. Systems nominal. Awaiting instruction.', 'Morning, {n}. Command Deck is listening.', 'Good morning, {n}. What do you need?'],
  afternoon: ['Good afternoon, {n}. Systems nominal. Awaiting instruction.', 'Bridge is yours, {n}. Go ahead.', 'Afternoon, {n}. Listening.'],
  evening: ['Good evening, {n}. Awaiting instruction.', 'Evening, {n}. Go ahead.', 'Systems ready, {n}. What do you need?'],
  night: ['Working late, {n}. How can I assist?', 'Night watch active, {n}. Go ahead.', 'Listening, {n}.']
};
// Humor setting (a nod to a certain deadpan robot): above 10%, a dry remark
// sometimes follows the facts. The facts always come first.
const QUIPS = {
  task: ["I'll pretend I didn't hear the deadline.", 'Another one for the pile. Admirable optimism.', 'Filed. My circuits are thrilled.', "I'll remind you. Whether you like it or not.", "Noted. Added to the list of things you'll definitely do."],
  taskHigh: ["High priority. I've alerted the crew. The crew is me.", "Urgent. I'll start worrying on your behalf."],
  event: ['Try not to double-book the universe.', "I'll make sure you're fashionably on time.", "I've cleared my schedule. It was empty."],
  complete: ['Somewhere, a checklist is very proud.', 'Look at you go.', "One less thing. I'll update your legend status.", 'Efficient. I may need to recalibrate my expectations.'],
  briefing: ['Try to look surprised.', 'Applause is optional.', 'No pressure.'],
  miss: ['And I was listening very hard.', 'Try again. Slower, for the robot.'],
  thanks: ["It's literally my job.", "Don't mention it. Really. I'll get emotional.", "Anytime. I'm not going anywhere. Physically incapable."],
  timer: ["I'll be counting. Obsessively.", 'Clock is running. No pressure.'],
  alarm: ["I'll be here. I don't sleep.", 'Set. I promise to be annoying about it.'],
  deleted: ['Gone. Like it never existed.', "Deleted. I won't tell anyone."],
  note: ["Filed in the ship's log.", "I'll guard it with my circuits.", 'Stored. Unlike your keys, apparently.'],
  greet: ["Go ahead. I'm all ears. Figuratively.", 'Listening. Humor setting at {h} percent.', 'Ready. Please keep it under a novella.']
};

function quip(kind) {
  const h = S.settings.humor ?? 0;
  if (h < 10) return '';
  const chance = h >= 90 ? 0.95 : (h / 100) * 0.8;
  if (Math.random() > chance) return '';
  const pool = QUIPS[kind] || [];
  return pool.length ? pool[Math.floor(Math.random() * pool.length)].replace('{h}', h) : '';
}

function withQuip(text, kind) {
  const q = quip(kind);
  return q ? `${text} ${q}` : text;
}

let lastGreeting = '';
function greeting() {
  const funny = quip('greet');
  if (funny) return funny;
  const pool = GREETINGS[U.partOfDay()];
  let g = pool[Math.floor(Math.random() * pool.length)];
  if (g === lastGreeting && pool.length > 1) g = pool[(pool.indexOf(g) + 1) % pool.length];
  lastGreeting = g;
  return g.replace('{n}', S.settings.operatorName || 'Commander').replace('Command Deck', S.settings.consoleName || 'Command Deck');
}

function spokenWhen(iso, hasTime) {
  if (!iso) return '';
  const d = new Date(iso);
  const day = U.spokenDay(d);
  return hasTime ? `${day} at ${U.fmtTimeShort(d, S.settings.clock24)}` : day;
}

function taskConfirmation(t) {
  const bits = [`Task logged: ${t.title}`];
  if (t.due) bits.push(`due ${spokenWhen(t.due, t.dueHasTime)}`);
  if (t.repeat && t.repeat.type !== 'none') bits.push(`repeating ${U.spokenRepeat(t.repeat)}`);
  if (t.priority === 'high') bits.push('high priority');
  if (t.priority === 'low') bits.push('low priority');
  const cat = categoryById(t.category);
  if (cat) bits.push(`filed under ${cat.name}`);
  if (t.assignee) bits.push(`assigned to ${t.assignee}`);
  if (t.reminder != null) bits.push('reminder set');
  return bits.join(', ') + '.';
}

function buildBriefing() {
  const now = new Date();
  const s = S.settings;
  const out = [`Good ${U.partOfDay(now)}, ${s.operatorName}.`];
  out.push(`It's ${U.fmtTimeShort(now, s.clock24)}, ${U.DAY_FULL[now.getDay()]}, ${U.MONTHS[now.getMonth()]} ${U.ordinal(now.getDate())}.`);
  const w = S.weather;
  if (w && w.current) {
    const info = wxInfo(w.current.weather_code, w.current.is_day);
    out.push(`Currently ${Math.round(w.current.temperature_2m)} degrees and ${info.words}, with a high of ${Math.round(w.daily.temperature_2m_max[0])}.`);
    const rain = w.daily.precipitation_probability_max ? w.daily.precipitation_probability_max[0] : 0;
    if (rain >= 40) out.push(`${rain} percent chance of rain.`);
  }
  const today = eventsOnDay(now).filter((e) => e.allDay || e.end > now);
  if (!today.length) out.push('No events on the calendar for the rest of today.');
  else {
    const first = today.find((e) => !e.allDay) || today[0];
    const when = first.allDay ? 'all day' : `at ${U.fmtTimeShort(first.start, s.clock24)}`;
    out.push(today.length === 1 ? `One event today: ${first.title}, ${when}.` : `${today.length} events today. First up: ${first.title}, ${when}.`);
  }
  const active = activeTasks();
  const overdue = active.filter((t) => isOverdue(t, now));
  const dueToday = active.filter((t) => t.due && U.sameDay(new Date(t.due), now) && !isOverdue(t, now));
  if (!active.length) out.push('The task queue is clear.');
  else {
    const parts = [];
    if (dueToday.length) parts.push(`${dueToday.length} task${dueToday.length > 1 ? 's' : ''} due today`);
    if (overdue.length) parts.push(`${overdue.length} overdue`);
    if (parts.length) out.push(parts.join(', and ') + '.');
    else out.push(`${active.length} task${active.length > 1 ? 's' : ''} in the queue, none due today.`);
    const top = sortTasks(active.filter((t) => t.priority === 'high'), now)[0];
    if (top) out.push(`Priority item: ${top.title}.`);
  }
  out.push('All systems nominal.');
  return out.join(' ');
}

function listTasksSentence() {
  const now = new Date();
  const active = activeTasks();
  if (!active.length) return 'Your task queue is clear.';
  const sorted = sortTasks(active, now);
  const overdue = sorted.filter((t) => isOverdue(t, now));
  const today = sorted.filter((t) => t.due && U.sameDay(new Date(t.due), now) && !isOverdue(t, now));
  let s = `You have ${active.length} active task${active.length > 1 ? 's' : ''}.`;
  if (overdue.length) s += ` Overdue: ${overdue.slice(0, 3).map((t) => t.title).join(', ')}.`;
  if (today.length) s += ` Due today: ${today.slice(0, 3).map((t) => t.title).join(', ')}.`;
  if (!overdue.length && !today.length) s += ` Next up: ${sorted[0].title}${sorted[0].due ? `, due ${spokenWhen(sorted[0].due, sorted[0].dueHasTime)}` : ''}.`;
  return s;
}

function nextEventSentence() {
  const now = new Date();
  const next = allEvents().find((e) => e.start > now);
  if (!next) return 'Nothing on the calendar in the next few weeks.';
  if (next.allDay) return `Next up: ${next.title}, ${U.spokenDay(next.start)}, all day.`;
  return `Next up: ${next.title}, ${U.spokenDay(next.start)} at ${U.fmtTimeShort(next.start, S.settings.clock24)}.`;
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

function findLocalEvent(query) {
  const words = (s) => String(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !['the', 'my', 'a', 'an', 'to'].includes(w));
  const q = words(query);
  if (!q.length) return null;
  let best = null;
  let bestScore = 0;
  const now = new Date();
  for (const e of S.localEvents) {
    if (new Date(e.end) < now) continue;
    const tw = words(e.title);
    let score = q.filter((w) => tw.some((x) => x.startsWith(w) || w.startsWith(x))).length / q.length;
    if (e.title.toLowerCase().includes(String(query).toLowerCase())) score += 0.5;
    if (score > bestScore) { bestScore = score; best = e; }
  }
  return bestScore >= 0.5 ? best : null;
}

// Keeps a task's time of day when it's moved to a new date without a time.
function mergeDue(oldIso, oldHasTime, newIso, newHasTime) {
  if (newHasTime || !oldIso || !oldHasTime) return { due: newIso, dueHasTime: newHasTime };
  const o = new Date(oldIso);
  const n = new Date(newIso);
  n.setHours(o.getHours(), o.getMinutes(), 0, 0);
  return { due: n.toISOString(), dueHasTime: true };
}

function editItem(r) {
  const t = findTask(r.query);
  const ev = t ? null : findLocalEvent(r.query);
  if (!t && !ev) return null;
  if (r.action === 'delete') {
    S.pendingConfirm = { kind: t ? 'task' : 'event', id: (t || ev).id, title: (t || ev).title, expires: Date.now() + 90000 };
    return { reply: `Delete "${(t || ev).title}"? Say yes to confirm.`, kind: 'c', followUp: true };
  }
  if (ev) {
    if (r.action !== 'reschedule') return { reply: `"${ev.title}" is a calendar event. I can move or delete it.`, kind: 'err' };
    const dur = new Date(ev.end) - new Date(ev.start);
    const { due, dueHasTime } = mergeDue(ev.start, !ev.allDay, r.due, r.dueHasTime);
    const start = new Date(due);
    const allDay = !dueHasTime;
    const updated = { ...ev, start: start.toISOString(), end: new Date(start.getTime() + (allDay ? 864e5 : dur)).toISOString(), allDay };
    upsertLocalEvent(updated, false);
    return { reply: `${ev.title} moved to ${spokenWhen(updated.start, !allDay)}.`, kind: 'ok' };
  }
  const task = { ...t };
  let reply = '';
  switch (r.action) {
    case 'priority':
      task.priority = r.priority;
      reply = `${t.title} set to ${r.priority} priority.`;
      break;
    case 'category': {
      task.category = r.category;
      const cat = categoryById(r.category);
      reply = `${t.title} filed under ${cat ? cat.name : 'that category'}.`;
      break;
    }
    case 'assign':
      task.assignee = r.assignee;
      reply = r.assignee ? `${t.title} assigned to ${r.assignee}.` : `${t.title} is unassigned.`;
      break;
    case 'reschedule': {
      Object.assign(task, mergeDue(t.due, t.dueHasTime, r.due, r.dueHasTime));
      task.snoozeUntil = null;
      reply = `${t.title} moved to ${spokenWhen(task.due, task.dueHasTime)}.`;
      break;
    }
    default:
      return null;
  }
  upsertTask(task, false);
  return { reply, kind: 'ok' };
}

async function handleCommand(text, { fromVoice = false, noEdit = false, skipLog = false } = {}) {
  if (!skipLog) pushLog('u', text);
  const ctx = { categories: S.settings.categories, people: S.settings.people, defaultReminder: S.settings.defaultReminder, noEdit, projects: S.projects.filter((p) => p.status !== 'done').map((p) => ({ id: p.id, name: p.name })) };
  let r;
  try {
    r = await deck.parse(text, ctx);
  } catch (e) {
    r = { intent: 'empty' };
  }
  // An edit that matches no existing task may really be a new task ("make dinner reservations, high priority").
  if (r.intent === 'edit-task' && r.fallback && !findTask(r.query) && !findLocalEvent(r.query)) {
    return handleCommand(text, { fromVoice, noEdit: true, skipLog: true });
  }
  let reply = '';
  let kind = 'c';
  let followUp = false;
  const now = new Date();
  // Voice commands get a spoken confirmation, so their chimes stay silent.
  if (fromVoice) sounds.setSuppressed(true);
  try {
  switch (r.intent) {
    case 'add-task': {
      const { projectName, ...fields } = r.task;
      let started = null;
      if (!fields.projectId && projectName) { started = newProject(projectName); fields.projectId = started.id; }
      const t = { ...blankTask(), ...fields };
      upsertTask(t, true);
      const proj = t.projectId && S.projects.find((p) => p.id === t.projectId);
      reply = withQuip(`${started ? `New project started: ${started.name}. ` : ''}${taskConfirmation(t)}${proj && !started ? ` Filed under ${proj.name}.` : ''}`, t.priority === 'high' ? 'taskHigh' : 'task');
      kind = 'ok';
      break;
    }
    case 'add-project': {
      const existing = findProject(r.name);
      if (existing && existing.name.toLowerCase() === r.name.toLowerCase()) { reply = `${existing.name} is already a project.`; kind = 'err'; break; }
      const p = newProject(r.name);
      reply = `Project started: ${p.name}. Add tasks with "… to the ${p.name.toLowerCase()} project."`;
      kind = 'ok';
      break;
    }
    case 'project-status': {
      const p = findProject(r.query);
      if (!p) { reply = `No active project matches ${r.query}.`; kind = 'err'; break; }
      const st = projectStats(p);
      reply = `${p.name}: ${st.pct} percent complete, ${st.done} of ${st.total} tasks done.${st.next ? ` Next: ${st.next.title}.` : ''}${p.due ? ` Due ${U.spokenDay(projectDue(p))}.` : ''}`;
      kind = 'ok';
      break;
    }
    case 'list-projects': {
      const list = activeProjects();
      reply = list.length ? `${list.length} active project${list.length > 1 ? 's' : ''}: ${list.map((p) => `${p.name}, ${projectStats(p).pct} percent`).join('; ')}.` : 'No active projects.';
      kind = 'ok';
      break;
    }
    case 'add-note': {
      if (!r.note) {
        reply = 'Ready to take it down. Say "take a note", then what it should say.';
        kind = 'err';
        break;
      }
      const n = { id: U.uid(), title: r.note.title, body: r.note.body, pinned: false, src: 'voice', createdAt: new Date().toISOString(), editedAt: new Date().toISOString(), editedOn: 'command' };
      S.notes.unshift(n);
      saveNotes();
      reply = withQuip(`Noted: ${n.title}.`, 'note');
      kind = 'ok';
      break;
    }
    case 'add-event': {
      const e = r.event;
      if (e.missing) {
        reply = `I need a day or time for "${e.title}". Try again with when it happens.`;
        kind = 'err';
        sounds.error();
      } else {
        const ev = { id: U.uid(), title: e.title, start: e.start, end: e.end, allDay: e.allDay, notes: '' };
        upsertLocalEvent(ev, true);
        reply = withQuip(`Event scheduled: ${ev.title}, ${U.spokenDay(new Date(ev.start))}${ev.allDay ? ', all day' : ` at ${U.fmtTimeShort(new Date(ev.start), S.settings.clock24)}`}.`, 'event');
        kind = 'ok';
      }
      break;
    }
    case 'complete-task': {
      const t = findTask(r.query);
      if (t) {
        const repeating = t.repeat && t.repeat.type !== 'none' && t.due;
        completeTask(t.id);
        reply = withQuip(repeating ? `Marked complete: ${t.title}. Next one is ${spokenWhen(t.due, t.dueHasTime)}.` : `Marked complete: ${t.title}.`, 'complete');
        kind = 'ok';
      } else {
        reply = `No active task matches "${r.query}".`;
        kind = 'err';
        sounds.error();
      }
      break;
    }
    case 'edit-task': {
      const res = editItem(r);
      if (!res) {
        reply = `No task matches "${r.query}".`;
        kind = 'err';
        sounds.error();
      } else {
        ({ reply, kind } = res);
        followUp = !!res.followUp;
      }
      break;
    }
    case 'confirm': {
      const p = S.pendingConfirm;
      S.pendingConfirm = null;
      if (!p || p.expires < Date.now()) { reply = 'Nothing waiting for confirmation.'; break; }
      if (p.kind === 'task') deleteTask(p.id); else deleteLocalEvent(p.id);
      reply = withQuip(`Deleted: ${p.title}.`, 'deleted');
      kind = 'ok';
      break;
    }
    case 'deny': {
      const p = S.pendingConfirm;
      S.pendingConfirm = null;
      reply = p ? `Understood. Keeping ${p.title}.` : 'Standing by.';
      break;
    }
    case 'set-timer': {
      if (!r.seconds) { reply = 'How long? Try: set a timer for 10 minutes.'; kind = 'err'; break; }
      const t = addTimer({ kind: 'timer', seconds: r.seconds, label: r.label });
      reply = withQuip(`Timer set: ${spokenDuration(r.seconds)}${t.label ? ` for ${t.label}` : ''}.`, 'timer');
      kind = 'ok';
      break;
    }
    case 'set-alarm': {
      if (!r.at) { reply = 'What time? Try: wake me at 7, or set an alarm for 6:30 PM.'; kind = 'err'; break; }
      const t = addTimer({ kind: 'alarm', at: r.at, label: r.label, wake: r.wake });
      reply = withQuip(`Alarm set for ${spokenWhen(t.endsAt, true)}${t.label ? `: ${t.label}` : ''}.`, 'alarm');
      kind = 'ok';
      break;
    }
    case 'cancel-timer': {
      const gone = cancelTimers(r);
      const noun = r.kind === 'alarm' ? 'alarm' : 'timer';
      reply = !gone.length ? `No active ${noun}s${r.label ? ` called ${r.label}` : ''}.`
        : gone.length === 1 ? `${gone[0].kind === 'alarm' ? 'Alarm' : 'Timer'} cancelled${gone[0].label ? `: ${gone[0].label}` : ''}.`
          : `Cancelled ${gone.length} ${noun}s.`;
      kind = gone.length ? 'ok' : 'err';
      break;
    }
    case 'timer-query': reply = timersSentence(); break;
    case 'snooze': reply = snooze(r.seconds); kind = 'ok'; break;
    case 'briefing': reply = withQuip(buildBriefing(), 'briefing'); break;
    case 'weather': reply = weatherSentence(); break;
    case 'next-event': reply = nextEventSentence(); break;
    case 'list-tasks': reply = listTasksSentence(); break;
    case 'time': reply = `It's ${U.fmtTimeShort(now, S.settings.clock24)}.`; break;
    case 'date': reply = `Today is ${U.DAY_FULL[now.getDay()]}, ${U.MONTHS[now.getMonth()]} ${U.ordinal(now.getDate())}, ${now.getFullYear()}.`; break;
    case 'thanks': reply = withQuip(`Always, ${S.settings.operatorName}.`, 'thanks'); break;
    case 'cancel': reply = 'Standing by.'; break;
    case 'set-humor': {
      const v = r.value;
      saveSettings({ ...S.settings, humor: v }, { refetch: false });
      reply = v === 0 ? 'Humor setting zero percent. Strictly business.'
        : v >= 90 ? `Humor setting ${v} percent. Self-destruct sequence initiated. Kidding. Mostly.`
          : v >= 60 ? `Humor setting ${v} percent. This should be fun.`
            : `Humor setting ${v} percent.`;
      kind = 'ok';
      break;
    }
    case 'humor-query': reply = `Humor setting is at ${S.settings.humor ?? 0} percent.`; break;
    default: reply = withQuip("I didn't catch that.", 'miss'); kind = 'err';
  }
  } finally {
    sounds.setSuppressed(false);
  }
  pushLog(kind, reply);
  const isQuery = !['add-task', 'add-event', 'complete-task', 'edit-task', 'confirm', 'set-timer', 'set-alarm', 'cancel-timer'].includes(r.intent);
  if (fromVoice || isQuery || followUp) await speak(reply);
  return { reply, followUp: fromVoice && followUp };
}

// ---------------------------------------------------------------- voice input
const WAVE_N = 28;
const WAVE_BASE = [10, 18, 26, 14, 30, 22, 36, 16, 28, 12, 24, 34, 20, 30, 14, 26, 36, 18, 22, 12, 30, 24, 16, 28, 20, 10, 18, 14];
let levels = new Array(WAVE_N).fill(0);

function buildWave() {
  $('#wave').innerHTML = WAVE_BASE.map((h, i) =>
    `<i style="height:${h}px;--d:${(0.9 + (i % 7) * 0.13).toFixed(2)}s;--delay:${(i * 0.05).toFixed(2)}s"></i>`).join('');
}

function resetWave() {
  $$('#wave i').forEach((b, i) => { b.style.height = `${WAVE_BASE[i]}px`; });
}

function onLevel(v) {
  levels.push(v);
  levels = levels.slice(-WAVE_N);
  $$('#wave i').forEach((b, i) => {
    const lv = levels[i] || 0;
    b.style.height = `${Math.round(4 + lv * 36 * (0.6 + 0.4 * Math.abs(Math.sin(i * 1.7))))}px`;
  });
}

const VOICE_TEXT = {
  idle: ['STANDBY', 'HAIL THE COMPUTER', 'Tap to speak · tasks, events, briefings'],
  greeting: ['HAILING', 'CHANNEL OPEN', 'Stand by…'],
  listening: ['LISTENING', 'GO AHEAD', 'Speak now · tap to finish'],
  thinking: ['PROCESSING', 'DECODING', 'Transcribing on this computer…'],
  speaking: ['RESPONDING', 'TRANSMITTING', 'Tap to interrupt']
};

function setVoiceState(state) {
  if ((state === 'speaking') !== (S.voice === 'speaking')) lights('speaking', state === 'speaking');
  S.voice = state;
  document.body.dataset.voice = state;
  const [status, title, sub] = VOICE_TEXT[state] || VOICE_TEXT.idle;
  $('#cmpStatusText').textContent = status;
  $('#cmpStatus').style.color = state === 'listening' ? 'var(--coral)' : state === 'idle' ? '' : 'var(--lav)';
  $('#cmpTitle').textContent = title;
  let subText = sub;
  const vs = voiceStatus();
  if (state === 'thinking' && vs.state === 'loading') subText = `Loading voice core ${vs.progress || 0}%…`;
  $('#cmpSub').textContent = subText;
  if (state !== 'listening') resetWave();
}

let rec = null;
async function hail() {
  if (S.voice === 'listening' && rec) { rec.stop(); return; }
  if (S.voice === 'speaking' || S.voice === 'greeting') {
    stopSpeaking();
    setVoiceState('idle');
    return;
  }
  if (S.voice !== 'idle') return;
  if (voiceStatus().state !== 'ready' && voiceStatus().state !== 'loading') loadModel().catch(() => {});

  // Hailing while an alarm or timer is ringing acknowledges it first.
  if (S.alert && S.alert.ringing) stopRinging();

  setVoiceState('greeting');
  await speak(greeting(), 'greeting');
  if (S.voice !== 'greeting' && S.voice !== 'idle') return;

  // A turn can ask a follow-up ("Delete X? Say yes to confirm"); keep listening for it.
  for (let turn = 0; turn < 3; turn++) {
    const res = await listenTurn();
    if (!res || !res.followUp) break;
  }
}

async function listenTurn() {
  try {
    setVoiceState('listening');
    sounds.micOn();
    levels = new Array(WAVE_N).fill(0);
    const patience = { short: 1500, normal: 2200, long: 3500 }[S.settings.micPatience] || 2200;
    rec = await record({ onLevel, silenceMs: patience });
  } catch (e) {
    rec = null;
    setVoiceState('idle');
    sounds.error();
    const msg = "I can't reach the microphone. Check that one is connected and that microphone access is allowed in Windows privacy settings.";
    pushLog('err', msg);
    speak(msg);
    return null;
  }
  const { audio, heard } = await rec.done;
  rec = null;
  sounds.micOff();
  if (!heard) {
    setVoiceState('idle');
    if (S.pendingConfirm) { S.pendingConfirm = null; pushLog('c', 'No answer. Nothing deleted.'); speak('No answer. Nothing deleted.'); return null; }
    pushLog('c', 'No input detected. Standing by.');
    speak('No input detected.');
    return null;
  }
  setVoiceState('thinking');
  let text = '';
  try {
    text = await transcribe(audio);
  } catch (e) {
    setVoiceState('idle');
    sounds.error();
    const msg = navigator.onLine
      ? 'The voice core failed to load. Typed commands still work in the quick-add line.'
      : 'The voice core needs an internet connection the first time it loads. Typed commands still work.';
    pushLog('err', msg);
    speak(msg);
    return null;
  }
  setVoiceState('idle');
  if (!text) {
    pushLog('c', "I didn't catch that.");
    speak("I didn't catch that. Please try again.");
    return null;
  }
  return handleCommand(text, { fromVoice: true });
}

// ---------------------------------------------------------------- timers & alarms
function saveTimers() {
  deck.save('timers', S.timers);
  FU.push('timers');
}

function addTimer({ kind, seconds, at, label, wake }) {
  const endsAt = at ? new Date(at) : new Date(Date.now() + seconds * 1000);
  const t = { id: U.uid(), kind, label: (label || '').trim(), endsAt: endsAt.toISOString(), total: seconds || null, wake: !!wake };
  S.timers.push(t);
  S.timers.sort((x, y) => new Date(x.endsAt) - new Date(y.endsAt));
  saveTimers();
  renderTimers();
  return t;
}

function cancelTimers({ kind, label, all }) {
  const pool = S.timers.filter((t) => (kind ? t.kind === kind : true));
  let gone;
  if (label) {
    const l = label.toLowerCase();
    gone = pool.filter((t) => t.label && (t.label.toLowerCase().includes(l) || l.includes(t.label.toLowerCase())));
  } else if (all || pool.length === 1) gone = pool;
  else gone = pool.slice(0, 1); // nearest one
  const ids = new Set(gone.map((t) => t.id));
  S.timers = S.timers.filter((t) => !ids.has(t.id));
  saveTimers();
  renderTimers();
  return gone;
}

function fmtCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function renderTimers(now = new Date()) {
  const el = $('#cmpTimers');
  const panel = el.closest('.panel');
  if (!S.timers.length) {
    el.hidden = true;
    panel.classList.remove('has-timers');
    return;
  }
  el.hidden = false;
  panel.classList.add('has-timers');
  el.innerHTML = S.timers.slice(0, 4).map((t) => {
    const end = new Date(t.endsAt);
    const value = t.kind === 'alarm' ? `${U.dayLabel(end, now) === 'TODAY' ? '' : `${U.dayLabel(end, now)} `}${U.fmtTimeShort(end, S.settings.clock24)}` : fmtCountdown(end - now);
    const soon = t.kind === 'timer' && end - now < 60000;
    return `<span class="tmr${soon ? ' soon' : ''}" title="${esc(t.label || (t.kind === 'alarm' ? 'Alarm' : 'Timer'))}">
      <span class="tmr-k">${t.kind === 'alarm' ? 'ALM' : 'TMR'}</span>${t.label ? `<span class="tmr-l">${esc(t.label.toUpperCase())}</span>` : ''}<span class="tmr-v">${value}</span>
      <button type="button" class="tmr-x" data-timer="${esc(t.id)}" aria-label="Cancel ${t.kind}">×</button></span>`;
  }).join('') + (S.timers.length > 4 ? `<span class="tmr more">+${S.timers.length - 4}</span>` : '');
}

function timersSentence() {
  if (!S.timers.length) return 'No timers or alarms running.';
  const now = new Date();
  return S.timers.slice(0, 4).map((t) => {
    const end = new Date(t.endsAt);
    if (t.kind === 'alarm') return `Alarm${t.label ? ` for ${t.label}` : ''} set for ${spokenWhen(t.endsAt, true)}.`;
    return `${t.label ? `${t.label} timer` : 'Timer'}: ${spokenDuration(Math.round((end - now) / 1000))} left.`;
  }).join(' ');
}

function checkTimers(now = new Date()) {
  const due = S.timers.filter((t) => new Date(t.endsAt) <= now);
  if (!due.length) return;
  S.timers = S.timers.filter((t) => new Date(t.endsAt) > now);
  saveTimers();
  renderTimers(now);
  due.forEach((t) => {
    if (t.origin === 'phone') {
      // Set on Field Unit: Command relays it to the phone instead of ringing here.
      const label = t.label ? `: ${t.label}` : '';
      FU.notifyPhones({ title: t.kind === 'alarm' ? `Alarm${label}` : `Timer complete${label}`, body: t.kind === 'alarm' ? `It's ${U.fmtTimeShort(now, S.settings.clock24)}.` : 'Time is up.', tag: `timer-${t.id}` });
      return;
    }
    fireTimer(t, now);
  });
}

let ringTimer = null;
function stopRinging() {
  clearInterval(ringTimer);
  ringTimer = null;
  if (S.alert) S.alert.ringing = false;
}

function fireTimer(t, now) {
  const isAlarm = t.kind === 'alarm';
  const label = t.label ? `: ${t.label}` : '';
  const title = isAlarm ? `ALARM${label.toUpperCase()}` : `TIMER COMPLETE${label.toUpperCase()}`;
  showAlert({ type: isAlarm ? 'alarm' : 'timer', title, sub: isAlarm ? U.fmtTimeShort(now, S.settings.clock24) : (t.total ? `${spokenDuration(t.total)} elapsed` : 'Time is up'), ref: t, ringing: true });
  const ring = () => (isAlarm ? sounds.alarm() : sounds.timer());
  ring();
  stopRinging();
  S.alert.ringing = true;
  let rings = 1;
  ringTimer = setInterval(() => {
    if (!S.alert || !S.alert.ringing || rings >= (isAlarm ? 8 : 3)) { stopRinging(); return; }
    rings++;
    ring();
  }, isAlarm ? 4500 : 5000);
  pushLog('c', isAlarm ? `Alarm${label}.` : `Timer complete${label}.`);
  if (isAlarm) FU.notifyPhones({ title: `Alarm${label}`, body: `It's ${U.fmtTimeShort(now, S.settings.clock24)}.`, tag: `timer-${t.id}` });
  try { new Notification(S.settings.consoleName || 'Command Deck', { body: isAlarm ? `Alarm${label}` : `Timer complete${label}`, silent: true }); } catch (e) { /* unavailable */ }
  let msg;
  if (isAlarm) {
    const wake = t.wake && U.partOfDay(now) === 'morning' ? `Good morning, ${S.settings.operatorName}. ` : '';
    msg = `${wake}It's ${U.fmtTimeShort(now, S.settings.clock24)}. ${t.label ? `${t.label}. ` : ''}This is your alarm.`;
  } else {
    msg = `Timer complete${label}.`;
  }
  setTimeout(() => speak(msg), 1400);
}

// Timers that ended while the console was closed: recent ones still fire, old ones are noted.
function reconcileTimers() {
  const now = new Date();
  const missed = S.timers.filter((t) => new Date(t.endsAt) <= now);
  if (!missed.length) return;
  S.timers = S.timers.filter((t) => new Date(t.endsAt) > now);
  saveTimers();
  missed.forEach((t) => {
    if (now - new Date(t.endsAt) < 10 * 60000) fireTimer(t, now);
    else pushLog('err', `Missed ${t.kind}${t.label ? ` (${t.label})` : ''} at ${U.fmtTimeShort(new Date(t.endsAt), S.settings.clock24)}.`);
  });
}

// ---------------------------------------------------------------- alert strip & snooze
function showAlert(alert) {
  S.alert = { ...alert, at: Date.now() };
  S.lastAlert = S.alert;
  const el = $('#alertStrip');
  const doneBtn = alert.type === 'reminder' || alert.type === 'pastdue' ? '<button type="button" class="al-btn" data-al="done">MARK DONE</button>' : '';
  el.dataset.type = alert.type;
  el.innerHTML = `<span class="al-dot"></span>
    <div class="al-text"><div class="al-title">${esc(alert.title)}</div>${alert.sub ? `<div class="al-sub">${esc(alert.sub)}</div>` : ''}</div>
    <div class="al-btns"><button type="button" class="al-btn" data-al="snooze">SNOOZE ${S.settings.snoozeMinutes || 10} MIN</button>${doneBtn}<button type="button" class="al-btn ghost" data-al="dismiss">DISMISS</button></div>`;
  el.hidden = false;
  if (['timer', 'alarm', 'pastdue', 'event'].includes(alert.type)) lights('alert', true, { wake: alert.type === 'timer' || alert.type === 'alarm' });
  clearTimeout(showAlert.t);
  showAlert.t = setTimeout(() => hideAlert(), alert.type === 'alarm' ? 10 * 60000 : 3 * 60000);
}

function hideAlert() {
  stopRinging();
  lights('alert', false);
  $('#alertStrip').hidden = true;
  S.alert = null;
}

function snooze(seconds) {
  const target = S.alert || (S.lastAlert && Date.now() - S.lastAlert.at < 30 * 60000 ? S.lastAlert : null);
  if (!target) return 'Nothing to snooze right now.';
  const sec = seconds || (S.settings.snoozeMinutes || 10) * 60;
  hideAlert();
  S.lastAlert = null;
  if (target.type === 'reminder' || target.type === 'pastdue') {
    const t = S.tasks.find((x) => x.id === target.ref.id);
    if (!t || t.done) return 'That task is already done.';
    t.snoozeUntil = new Date(Date.now() + sec * 1000).toISOString();
    saveTasks();
    return `Snoozed. I'll remind you about ${t.title} in ${spokenDuration(sec)}.`;
  }
  addTimer({ kind: 'timer', seconds: sec, label: target.ref.label || (target.type === 'alarm' ? 'Snoozed alarm' : '') });
  return `Snoozed for ${spokenDuration(sec)}.`;
}

// ---------------------------------------------------------------- quiet hours & red alert
function minutesOf(hhmm) {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function isQuiet(now = new Date()) {
  const s = S.settings;
  if (!s.quietEnabled) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  const a = minutesOf(s.quietStart);
  const b = minutesOf(s.quietEnd);
  if (a === b) return false;
  return a < b ? cur >= a && cur < b : cur >= a || cur < b;
}

function criticalOverdue(now = new Date()) {
  if (!S.settings.redAlert) return [];
  const limit = (S.settings.redAlertAfter || 60) * 60000;
  return activeTasks().filter((t) => {
    if (!t.due) return false;
    const d = new Date(t.due);
    const deadline = t.dueHasTime ? d : U.addDays(U.startOfDay(d), 1);
    return now - deadline > limit;
  });
}

let lastPulse = 0;
function checkRedAlert(now = new Date()) {
  const list = criticalOverdue(now);
  const on = list.length > 0;
  document.body.classList.toggle('red-alert', on);
  S.redAlertCount = list.length;
  if (on && S.settings.motion !== 'still' && Date.now() - lastPulse > 3 * 60000) {
    lastPulse = Date.now();
    document.body.classList.remove('red-pulse');
    void document.body.offsetWidth;
    document.body.classList.add('red-pulse');
    setTimeout(() => document.body.classList.remove('red-pulse'), 3000);
  }
  if (!on) lastPulse = 0;
}

// ---------------------------------------------------------------- reminders
function reminderTime(t) {
  const due = new Date(t.due);
  if (t.dueHasTime) return new Date(due.getTime() - (t.reminder || 0) * 60000);
  // Date-only tasks: remind at 9:00 AM on the day (or the day before for 1-day reminders).
  const at = new Date(due);
  at.setHours(9, 0, 0, 0);
  if ((t.reminder || 0) >= 1440) at.setDate(at.getDate() - Math.floor(t.reminder / 1440));
  return at;
}

// Past due: a timed task reaches its due time without being done. Shown on screen (red on the rig
// when lighting is on), with MARK DONE / SNOOZE / DISMISS. Once per due time.
function checkPastDue(now) {
  let changed = false;
  for (const t of activeTasks()) {
    if (!t.due || !t.dueHasTime || t.overdueFor === t.due || (t.snoozeUntil && now < new Date(t.snoozeUntil))) continue;
    const due = new Date(t.due);
    if (now < due) continue;
    t.overdueFor = t.due;
    changed = true;
    if (now - due > 2 * 60000) continue; // added late, or long overdue at startup: the red-alert frame covers that
    // Its reminder is already on screen (a reminder set for "at due time"): just turn the rig red.
    if (S.alert && S.alert.ref && S.alert.ref.id === t.id) { lights('alert', true); continue; }
    showAlert({ type: 'pastdue', title: `PAST DUE · ${t.title.toUpperCase()}`, sub: `Was due ${U.fmtTimeShort(due, S.settings.clock24)}`, ref: { id: t.id } });
    pushLog('err', `Past due: ${t.title}.`);
  }
  return changed;
}

// Calendar events starting now get a heads-up on screen (and red on the rig when lighting is on).
const eventsStarted = new Set();
function checkEventStarts(now) {
  for (const e of allEvents()) {
    if (e.allDay) continue;
    const key = `${e.id || e.title}@${+e.start}`;
    if (eventsStarted.has(key) || e.start > now || now - e.start > 2 * 60000) continue;
    eventsStarted.add(key);
    showAlert({ type: 'event', title: `NOW · ${String(e.title || 'Event').toUpperCase()}`, sub: [U.fmtTimeShort(e.start, S.settings.clock24), e.location].filter(Boolean).join(' · '), ref: { label: e.title } });
    pushLog('c', `Starting now: ${e.title}.`);
  }
}

function checkReminders() {
  const now = new Date();
  let changed = checkPastDue(now);
  checkEventStarts(now);
  for (const t of activeTasks()) {
    if (t.snoozeUntil && now >= new Date(t.snoozeUntil)) {
      t.snoozeUntil = null;
      changed = true;
      fireReminder(t, now);
      continue;
    }
    if (t.reminder == null || !t.due || t.remindedFor === t.due) continue;
    const at = reminderTime(t);
    if (now >= at && now - at < 6 * 3600 * 1000) {
      t.remindedFor = t.due;
      changed = true;
      fireReminder(t, now);
    }
  }
  if (changed) saveTasks();
}

function fireReminder(t, now) {
  const due = new Date(t.due);
  let when;
  if (!t.dueHasTime) when = 'today';
  else {
    const mins = Math.round((due - now) / 60000);
    when = mins < 0 ? `${spokenDuration(-mins * 60)} ago` : mins === 0 ? 'now' : mins < 60 ? `in ${mins} minute${mins === 1 ? '' : 's'}` : `at ${U.fmtTimeShort(due, S.settings.clock24)}`;
  }
  const msg = `Reminder: ${t.title} ${when.endsWith('ago') ? 'was due' : 'is due'} ${when}.`;
  const quiet = isQuiet(now);
  showAlert({ type: 'reminder', title: `REMINDER · ${t.title.toUpperCase()}`, sub: `Due ${when}`, ref: { id: t.id } });
  FU.notifyPhones({ title: `Reminder: ${t.title}`, body: `Due ${when}.`, tag: `task-${t.id}`, taskId: t.id });
  pushLog('c', quiet ? `${msg} (quiet hours)` : msg);
  try {
    const n = new Notification(S.settings.consoleName || 'Command Deck', { body: `${t.title} · due ${when}`, silent: true });
    n.onclick = () => openTaskEditor(t);
  } catch (e) { /* notifications unavailable */ }
  if (quiet) return; // quiet hours: on screen only
  sounds.reminder();
  setTimeout(() => speak(msg), 900);
}

// ---------------------------------------------------------------- boot sequence
async function bootSequence() {
  const motion = S.settings.motion;
  const panels = $$('.panel');
  if (motion === 'still') {
    sounds.boot(true);
    return;
  }
  const short = motion === 'subtle';
  const step = short ? 110 : 250;
  const boot = $('#boot');
  const linesEl = $('#bootLines');
  const fill = $('#bootFill');
  panels.forEach((p) => p.classList.add('boot-hide'));
  boot.classList.add('on');
  sounds.boot(short);
  const cals = S.settings.calendars.filter((c) => c.enabled !== false && c.url).length;
  const name = (S.settings.consoleName || 'Command Deck').toUpperCase();
  const lines = [
    [`${name} // ${VERSION}`, 'hd'],
    ['POWER BUS ............ ', 'ONLINE'],
    ['CHRONOMETER .......... ', 'SYNCED'],
    ['ATMOSPHERICS ......... ', 'LINKED'],
    ['CALENDAR ARRAY ....... ', `${cals} FEED${cals === 1 ? '' : 'S'}`],
    ['TASK QUEUE ........... ', `${activeTasks().length} ACTIVE`],
    ['VOICE CORE ........... ', 'STANDBY'],
    ['ALL SYSTEMS NOMINAL', 'hd']
  ];
  linesEl.innerHTML = '';
  for (let i = 0; i < lines.length; i++) {
    const [a, b] = lines[i];
    const div = document.createElement('div');
    if (b === 'hd') div.innerHTML = `<span class="hd">${esc(a)}</span>`;
    else div.innerHTML = `${esc(a)}<span class="ok">${esc(b)}</span>`;
    linesEl.appendChild(div);
    fill.style.width = `${Math.round(((i + 1) / lines.length) * 100)}%`;
    await U.wait(i === 0 ? step * 2 : step);
  }
  await U.wait(short ? 200 : 600);
  boot.classList.add('fade');
  panels.forEach((p, i) => {
    p.style.setProperty('--bd', `${(i * (short ? 0.05 : 0.11)).toFixed(2)}s`);
    p.classList.remove('boot-hide');
    p.classList.add('boot-in');
  });
  await U.wait(650);
  boot.classList.remove('on', 'fade');
  setTimeout(() => panels.forEach((p) => p.classList.remove('boot-in')), 1500);
}

async function maybeBriefing() {
  const s = S.settings;
  if (!s.setupComplete || !s.morningBriefing) return;
  const key = U.dayKey(new Date());
  if (S.data.meta.lastBriefingDate === key) return;
  if (isQuiet()) return; // wait until quiet hours end
  S.data.meta.lastBriefingDate = key;
  saveMeta();
  const t0 = Date.now();
  while (!S.weather && Date.now() - t0 < 5000) await U.wait(250);
  const text = buildBriefing();
  pushLog('c', 'Daily briefing delivered.');
  await speak(text);
}

// ---------------------------------------------------------------- grid layout
// Two layouts share the same panels: the standard 12-column grid, and the Xeneon Edge layout
// (24 columns) for a wide, short touch strip like Corsair's 2560 x 720 Xeneon Edge.
// AUTO picks by the window's shape; each layout remembers its own rearrangements.
const LAYOUTS = {
  standard: { columns: 12, key: 'layout', defaults: { clock: [0, 0, 5, 4], weather: [5, 0, 3, 4], computer: [8, 0, 4, 4], calendar: [0, 4, 4, 8], events: [4, 4, 3, 4], notes: [4, 8, 3, 4], tasks: [7, 4, 5, 8] } },
  edge: { columns: 24, key: 'layoutEdge', defaults: { clock: [0, 0, 4, 6], weather: [0, 6, 4, 6], calendar: [4, 0, 5, 12], events: [9, 0, 4, 6], notes: [9, 6, 4, 6], tasks: [13, 0, 7, 12], computer: [20, 0, 4, 12] } }
};
const EDGE_RATIO = 2.6; // a window at least this many times wider than tall counts as an Edge
let layoutNow = null;
let applyingLayout = false;

function wantedLayout() {
  const m = S.settings.layoutMode || 'auto';
  if (m === 'edge' || m === 'standard') return m;
  return window.innerWidth / Math.max(1, window.innerHeight) >= EDGE_RATIO ? 'edge' : 'standard';
}

// gridstack ships column CSS up to 12; the Edge layout's 24 columns get theirs here.
function columnCss(n) {
  if (document.getElementById(`gs-css-${n}`)) return;
  let css = '';
  for (let i = 1; i <= n; i++) {
    css += `.gs-${n} > .grid-stack-item[gs-w="${i}"] { width: ${(i / n) * 100}%; }\n.gs-${n} > .grid-stack-item[gs-x="${i - 1}"] { left: ${((i - 1) / n) * 100}%; }\n`;
  }
  const el = document.createElement('style');
  el.id = `gs-css-${n}`;
  el.textContent = css;
  document.head.appendChild(el);
}

function placePanels(mode) {
  const L = LAYOUTS[mode];
  const saved = Array.isArray(S.data[L.key]) && S.data[L.key].length ? S.data[L.key] : null;
  const pos = saved ? Object.fromEntries(saved.map((it) => [it.id, [it.x, it.y, it.w, it.h]])) : L.defaults;
  grid.batchUpdate();
  Object.entries({ ...L.defaults, ...pos }).forEach(([id, [x, y, w, h]]) => {
    const el = document.querySelector(`.grid-stack-item[gs-id="${CSS.escape(id)}"]`);
    if (el) grid.update(el, { x, y, w, h });
  });
  grid.batchUpdate(false);
}

function applyLayout(force = false) {
  if (!grid) return;
  const mode = wantedLayout();
  if (mode === layoutNow && !force) return;
  applyingLayout = true;
  layoutNow = mode;
  document.body.dataset.layout = mode;
  columnCss(LAYOUTS[mode].columns);
  grid.column(LAYOUTS[mode].columns, 'none');
  placePanels(mode);
  applyingLayout = false;
  const chip = $('#layoutChip');
  if (chip) {
    chip.classList.toggle('on', mode === 'edge');
    chip.querySelector('span').textContent = mode === 'edge' ? 'EDGE LAYOUT' : 'STANDARD LAYOUT';
    chip.title = mode === 'edge' ? 'Switch to the standard layout' : 'Switch to the Xeneon Edge layout';
  }
  fitGrid();
}

/** The header chip: flip between the two layouts right now (and stay there until switched back). */
function toggleLayout() {
  const next = layoutNow === 'edge' ? 'standard' : 'edge';
  sounds.click();
  saveSettings({ ...S.settings, layoutMode: next }, { refetch: false });
  toast(next === 'edge' ? 'Edge layout' : 'Standard layout');
}

function fitGrid() {
  if (!grid) return;
  const h = $('.grid-wrap').clientHeight;
  grid.cellHeight(Math.max(26, Math.floor(h / 12)));
}

function initGrid() {
  grid = GridStack.init({
    column: 12,
    cellHeight: 60,
    margin: 7,
    float: false,
    animate: true,
    staticGrid: true,
    draggable: { handle: '.p-head' },
    resizable: { handles: 'se' }
  }, '#grid');
  let saved = S.data.layout;
  // Layouts saved before the Notepad existed: give it the lower half of
  // Upcoming if that panel is still in its original spot, else add it below.
  if (Array.isArray(saved) && saved.length && !saved.some((it) => it.id === 'notes')) {
    const ev = saved.find((it) => it.id === 'events');
    if (ev && ev.h >= 6) {
      saved = saved.map((it) => (it.id === 'events' ? { ...it, h: Math.ceil(ev.h / 2) } : it));
      saved.push({ id: 'notes', x: ev.x, y: ev.y + Math.ceil(ev.h / 2), w: ev.w, h: Math.floor(ev.h / 2) });
    } else {
      const bottom = Math.max(...saved.map((it) => it.y + it.h));
      saved.push({ id: 'notes', x: 0, y: bottom, w: 4, h: 4 });
    }
  }
  S.data.layout = saved;
  applyLayout(true);
  grid.on('change', () => {
    if (applyingLayout || !layoutNow) return;
    const layout = grid.save(false).map((n) => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h }));
    const key = LAYOUTS[layoutNow].key;
    S.data[key] = layout;
    deck.save(key, layout);
  });
  fitGrid();
  let t = null;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => { applyLayout(); fitGrid(); }, 60); });
  const chip = $('#layoutChip');
  if (chip) chip.addEventListener('click', toggleLayout);
}

function resetLayout() {
  const key = LAYOUTS[layoutNow || 'standard'].key;
  S.data[key] = null;
  deck.save(key, null);
  applyLayout(true);
  toast('Layout restored');
}

// ---------------------------------------------------------------- window resize grip
function initGrip() {
  const grip = $('#winGrip');
  let start = null;
  let pending = null;
  let raf = 0;
  grip.addEventListener('pointerdown', async (e) => {
    grip.setPointerCapture(e.pointerId);
    const b = await deck.getBounds();
    start = { x: e.screenX, y: e.screenY, w: b.width, h: b.height };
  });
  grip.addEventListener('pointermove', (e) => {
    if (!start) return;
    pending = [start.w + (e.screenX - start.x), start.h + (e.screenY - start.y)];
    if (!raf) {
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (pending) deck.setSize(pending[0], pending[1]);
      });
    }
  });
  const end = () => { start = null; };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
}

// ---------------------------------------------------------------- events wiring
function wire() {
  $('#segWindow').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    sounds.click();
    saveSettings({ ...S.settings, windowMode: b.dataset.v }, { refetch: false });
  });
  $('#segMotion').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    sounds.click();
    saveSettings({ ...S.settings, motion: b.dataset.v }, { refetch: false });
  });
  $('#btnLock').addEventListener('click', () => {
    sounds.click();
    const locked = !S.settings.layoutLocked;
    saveSettings({ ...S.settings, layoutLocked: locked }, { refetch: false });
    toast(locked ? 'Layout locked' : 'Layout unlocked · drag panel headers, pull corners to resize');
  });
  $('#btnSettings').addEventListener('click', () => { sounds.click(); openSettings(false); });
  $('#btnMin').addEventListener('click', () => { sounds.click(); deck.minimize(); });
  $('#btnHail').addEventListener('click', () => hail());

  $('#wxOpen').addEventListener('click', () => {
    const { lat, lon } = S.settings.location;
    deck.openExternal(`https://weather.com/weather/today/l/${(+lat).toFixed(2)},${(+lon).toFixed(2)}`);
  });

  $('#calPrev').addEventListener('click', () => shiftMonth(-1));
  $('#calNext').addEventListener('click', () => shiftMonth(1));
  $('#calToday').addEventListener('click', () => {
    sounds.click();
    const now = new Date();
    S.viewMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    S.selectedDate = U.startOfDay(now);
    renderCalendar();
    renderEvents();
  });
  $('#calGrid').addEventListener('click', (e) => {
    const cell = e.target.closest('.cal-cell');
    if (!cell) return;
    sounds.click();
    const [y, m, d] = cell.dataset.day.split('-').map(Number);
    S.selectedDate = new Date(y, m - 1, d);
    if (S.selectedDate.getMonth() !== S.viewMonth.getMonth()) {
      S.viewMonth = new Date(y, m - 1, 1);
      fetchCalendars();
    }
    renderCalendar();
    renderEvents();
  });
  $('#calGrid').addEventListener('dblclick', (e) => {
    const cell = e.target.closest('.cal-cell');
    if (!cell) return;
    const [y, m, d] = cell.dataset.day.split('-').map(Number);
    openEventEditor(null, new Date(y, m - 1, d));
  });

  $('#btnNewEvent').addEventListener('click', () => { sounds.click(); openEventEditor(null, S.selectedDate || new Date()); });
  $('#evList').addEventListener('click', (e) => {
    const row = e.target.closest('.ev.local');
    if (!row) return;
    const ev = S.localEvents.find((x) => x.id === row.dataset.ev);
    if (ev) openEventEditor(ev);
  });
  $('#evList').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest('.ev.local');
    if (!row) return;
    e.preventDefault();
    const ev = S.localEvents.find((x) => x.id === row.dataset.ev);
    if (ev) openEventEditor(ev);
  });

  $('#btnAddTask').addEventListener('click', () => { sounds.click(); if (S.tkView === 'projects') openProjectEditor(null); else if (S.tkView === 'schedule') openScheduleEditor(null); else openTaskEditor(null); });
  $('#tkChips').addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (!c) return;
    sounds.click();
    S.filter = c.dataset.filter;
    renderTasks();
  });
  $('#tkList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'clear-done') {
      // Finished tasks that belong to a live project stay (they count toward its progress), just out of the queue.
      S.tasks = S.tasks.filter((t) => !t.done || projectActive(t.projectId)).map((t) => (t.done ? { ...t, queueCleared: true } : t));
      saveTasks();
      renderTasks();
      return;
    }
    const row = btn.closest('.tk');
    const t = row && S.tasks.find((x) => x.id === row.dataset.id);
    if (!t) return;
    if (btn.dataset.act === 'toggle') {
      if (t.done) uncompleteTask(t.id);
      else completeTask(t.id);
    } else if (btn.dataset.act === 'edit') {
      openTaskEditor(t);
    }
  });
  $('#quickForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#quickInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    await handleCommand(text, { fromVoice: false });
  });

  $('#alertStrip').addEventListener('click', (e) => {
    const b = e.target.closest('[data-al]');
    if (!b || !S.alert) return;
    const act = b.dataset.al;
    if (act === 'snooze') {
      const msg = snooze();
      toast(msg);
      pushLog('ok', msg);
    } else if (act === 'done') {
      const id = S.alert.ref && S.alert.ref.id;
      hideAlert();
      if (id) completeTask(id);
    } else {
      hideAlert();
    }
  });
  $('#cmpTimers').addEventListener('click', (e) => {
    const b = e.target.closest('[data-timer]');
    if (!b) return;
    S.timers = S.timers.filter((t) => t.id !== b.dataset.timer);
    saveTimers();
    renderTimers();
    sounds.click();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isModalOpen()) { closeModal(); return; }
    if (e.key === 'Escape' && S.alert) { hideAlert(); return; }
    if (e.key === 'Escape' && S.voice !== 'idle') { stopSpeaking(); if (rec) rec.stop(); }
  });

  deck.onShown(() => {
    checkNewDay();
    maybeBriefing();
  });
  deck.onSettingsChanged((s) => {
    S.settings = s;
    applySettings();
    renderAll();
  });
}

function shiftMonth(n) {
  sounds.click();
  S.viewMonth = new Date(S.viewMonth.getFullYear(), S.viewMonth.getMonth() + n, 1);
  renderCalendar();
  fetchCalendars();
}

function checkNewDay() {
  const key = U.dayKey(new Date());
  if (S.lastDayKey && S.lastDayKey !== key) {
    // Clear yesterday's completed one-off tasks from view and follow today.
    const now = new Date();
    S.tasks = S.tasks.filter((t) => !archivable(t, now));
    saveTasks();
    if (S.selectedDate && U.daysBetween(S.selectedDate, now) === 1) S.selectedDate = U.startOfDay(now);
    S.viewMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    fetchCalendars(true);
    renderAll();
  }
  S.lastDayKey = key;
}

// ---------------------------------------------------------------- timers
function startTimers() {
  const tick = () => {
    const now = new Date();
    renderClock(now);
    checkTimers(now);
    if (S.timers.length) renderTimers(now);
    if (now.getSeconds() === 0) {
      sounds.setQuiet(isQuiet(now));
      checkRedAlert(now);
      checkNewDay();
      renderTasks();
      renderEvents();
      renderFooter();
    }
  };
  setTimeout(() => { tick(); setInterval(tick, 1000); }, 1000 - (Date.now() % 1000));
  setInterval(checkReminders, 15000);
  setInterval(fetchWeather, 15 * 60 * 1000);
  setInterval(() => fetchCalendars(true), 10 * 60 * 1000);
}

// ---------------------------------------------------------------- start
async function start() {
  S.data = await deck.load();
  S.settings = S.data.settings;
  S.tasks = S.data.tasks || [];
  S.localEvents = S.data.localEvents || [];
  S.timers = S.data.timers || [];
  S.notes = S.data.notes || [];
  S.projects = S.data.projects || [];
  S.schedule = S.data.schedule || [];
  S.schedWeek = weekStart(new Date());
  S.tkView = 'queue';
  const now = new Date();
  S.viewMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  S.selectedDate = U.startOfDay(now);
  S.lastDayKey = U.dayKey(now);
  // Completed one-off tasks from previous days are archived on launch.
  S.tasks = S.tasks.filter((t) => !archivable(t, now));

  document.body.dataset.voice = 'idle';
  buildWave();
  Motion.start();
  if (deck.onAway) deck.onAway((away) => Motion.setAway(away));
  wireUpdates();
  wireLights();
  applySettings();
  initGrid();
  applySettings();
  initGrip();
  wire();
  wireNotes();
  wireProjects();
  wireSchedule();

  initModals({
    lightInfo: () => ({ ...lightState }),
    lightsPreview: (cfg) => (deck.lights ? deck.lights.configure(cfg).then((s) => { if (s) lightState = s; return s; }).catch(() => null) : Promise.resolve(null)),
    lightsTest: (name) => (deck.lights ? deck.lights.test(name) : Promise.resolve(false)),
    lightsRescan: () => (deck.lights ? deck.lights.rescan().then((s) => { if (s) lightState = s; return s; }).catch(() => null) : Promise.resolve(null)),
    updateInfo: () => ({ ...updateState, text: updateText() }),
    checkUpdates: async () => { if (deck.updates) showUpdate(await deck.updates.check().catch(() => ({ state: 'error' }))); return { ...updateState, text: updateText() }; },
    installUpdate: () => (deck.updates ? deck.updates.install() : Promise.resolve(false)),
    S,
    sounds,
    toast,
    speak,
    englishVoices,
    blankTask,
    upsertTask,
    deleteTask,
    upsertLocalEvent,
    deleteLocalEvent,
    upsertNote,
    deleteNote,
    noteToTask,
    upsertProject,
    deleteProject,
    completeProject,
    projectStats,
    projectDueLabel, projectDue,
    PROJECT_COLORS,
    taskRow,
    completeTask,
    uncompleteTask,
    postProjectLog,
    scheduleTypes, upsertScheduleEntry, deleteScheduleEntry, addScheduleType, removeScheduleType,
    setProjectRefresh: (fn) => { openProjectRefresh = fn; },
    saveSettings,
    resetLayout,
    replayBoot: bootSequence,
    testCalendars: async (cals) => {
      const n = new Date();
      return deck.fetchCalendars(cals, U.addDays(n, -1).toISOString(), U.addDays(n, 30).toISOString());
    },
    afterSetup,
    ttsStatus,
    loadTts,
    previewOpacity: (v) => deck.setOpacity(v),
    previewDarkness: (v) => document.documentElement.style.setProperty('--frame-alpha', String(v)),
    previewTheme: (t) => applyLook(t, look.font),
    previewFont: (f) => applyLook(look.theme, f),
    previewInk: (k) => applyLook(look.theme, look.font, k),
    THEME_FONT,
    previewFrame: (f) => { document.body.dataset.frame = f || 'dark'; },
    previewTrim: (t) => { document.body.dataset.trim = t || 'none'; },
    fieldUnit: FU,
    exportData: () => deck.exportData(),
    importData: () => deck.importData(),
    afterImport: (data) => {
      S.data = data;
      S.settings = data.settings;
      S.tasks = data.tasks || [];
      S.localEvents = data.localEvents || [];
      applySettings();
      fetchWeather();
      fetchCalendars(true);
      renderAll();
    }
  });

  onVoiceStatus(() => {
    renderFooter();
    if (S.voice === 'thinking') setVoiceState('thinking');
  });
  onTtsStatus(() => renderFooter());

  renderAll();
  renderTimers();
  setVoiceState('idle');
  let shareSig = '';
  FU.onChange(() => {
    renderFooter();
    const sig = JSON.stringify(S.projects.map((p) => FU.shares(p.id).map((c) => [c.token, c.level, c.lastActive])));
    if (sig !== shareSig) { shareSig = sig; renderTasks(); refreshOpenProject(); }
  });
  FU.init({
    version: VERSION,
    getSettings: () => S.settings,
    saveFieldUnit: (fieldUnit) => saveSettings({ ...S.settings, fieldUnit }, { refetch: false }),
    getList: (kind) => (kind === 'tasks' ? S.tasks : kind === 'events' ? S.localEvents : kind === 'notes' ? S.notes : kind === 'projects' ? S.projects : kind === 'schedule' ? S.schedule : S.timers),
    applyReplies,
    onScheduleActivity: scheduleActivity,
    applyRemote,
    guestChanges,
    addLog: addProjectLog,
    onActivity: guestActivity,
    getLook: () => ({ theme: S.settings.theme || 'dusk', font: S.settings.font || 'auto', ink: S.settings.ink || 'theme', trim: S.settings.trim || 'none', clock24: !!S.settings.clock24 }),
    adoptShared: (shared) => {
      const keys = Object.keys(shared);
      if (keys.every((k) => JSON.stringify(S.settings[k]) === JSON.stringify(shared[k]))) return;
      saveSettings({ ...S.settings, ...shared });
    },
    onPaired: (m) => {
      const msg = m.kind === 'desktop' ? `Console joined the deck${m.name ? `: ${m.name}` : ''}.` : `Field unit paired${m.name ? `: ${m.name}` : ''}.`;
      toast(msg, 4000);
      pushLog('ok', msg);
      speak(`Uplink established. ${msg}`);
    }
  }).then(() => { if (S.calEvents.length) FU.relayCalendar(S.calEvents); });
  startTimers();
  checkRedAlert();
  renderFooter();
  fetchWeather();
  fetchCalendars(true);

  lights('boot', true);
  await bootSequence();
  lights('boot', false);

  if (!S.settings.setupComplete) {
    openSettings(true);
    return;
  }
  checkReminders();
  reconcileTimers();
  // Warm up the voice engines quietly in the background.
  warmUpVoices(2500);
  maybeBriefing();
}

function warmUpVoices(delay) {
  setTimeout(() => {
    const s = S.settings;
    const synth = s.voiceEnabled && s.voiceEngine === 'neural' ? loadTts() : Promise.resolve();
    synth.catch(() => {}).finally(() => loadModel().catch(() => {}));
  }, delay);
}

function afterSetup() {
  warmUpVoices(1500);
  speak(`Setup complete. Welcome aboard, ${S.settings.operatorName}. ${S.settings.consoleName} is online.`);
  pushLog('ok', `Welcome aboard, ${S.settings.operatorName}.`);
  S.data.meta.lastBriefingDate = U.dayKey(new Date());
  saveMeta();
}

start();
