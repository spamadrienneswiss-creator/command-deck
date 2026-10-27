// Persistent storage: one JSON file in the app's user-data folder.
// Writes are atomic (temp file + rename) so a crash can't corrupt it.
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  settings: {
    setupComplete: false,
    operatorName: 'Commander',
    chipName: '', // your name chip on shared schedules (blank: from operatorName)
    chipColor: '#F4B6A0',
    consoleName: 'Command Deck',
    location: { name: 'Los Angeles, California', lat: 34.0522, lon: -118.2437 },
    calendars: [], // { id, name, url, color, enabled }
    localCalendarName: 'Local',
    localCalendarColor: '#F4B6A0',
    categories: [
      { id: 'home', name: 'Home', color: '#F2A65A' },
      { id: 'work', name: 'Work', color: '#F4B6A0' },
      { id: 'errands', name: 'Errands', color: '#A8B0D8' },
      { id: 'personal', name: 'Personal', color: '#D9A9C6' }
    ],
    people: ['Me'],
    scheduleTypes: [
      { id: 'appt', name: 'Appointment', short: 'APPT', color: '#A8B0D8' },
      { id: 'ldc', name: 'LDC', short: 'LDC', color: '#F2A65A' },
      { id: 'metro', name: 'Metro', short: 'METRO', color: '#7FD1C7' },
      { id: 'other', name: 'Other', short: 'OTHER', color: '#B5B0BC' }
    ],
    motion: 'full', // full | subtle | still
    sound: 'full', // full | key | silent
    voiceEnabled: true,
    voiceEngine: 'neural', // neural (Kokoro, on-device) | windows
    neuralVoice: 'am_fenrir',
    voiceFx: 'robot', // robot (companion-robot speaker) | comms (ship intercom) | off
    voiceDepth: 35, // 0–100: how far the voice is pitched down
    voiceFxStrength: 60, // 0–100: dry voice → full effect
    humor: 40, // 0–100: strictly professional → dry and deadpan
    micPatience: 'normal', // how long the mic waits after you stop talking: short | normal | long
    theme: 'dusk', // dusk | space | red | terminal | retro | moonbase | blueprint | cryo | freighter
    ink: 'theme', // theme | amber | phosphor | ice | arctic | rose (main text color)
    font: 'auto', // auto (the theme's own) | chakra | michroma | spacemono | exo2 | b612 | vt323 | orbitron
    frame: 'dark', // dark | bone (off-white console tray)
    trim: 'none', // none | sunset | mission | arcade (retro panel stripes)
    quietEnabled: true,
    quietStart: '22:00',
    quietEnd: '07:00',
    snoozeMinutes: 10,
    redAlert: true,
    redAlertAfter: 60, // minutes overdue before the frame pulses red
    voiceName: '',
    voiceRate: 1,
    opacity: 1, // whole-console opacity, 0.3 – 1
    frameDarkness: 0.8, // darkness behind/between panels, 0.2 – 0.97
    windowMode: 'top', // top | desk
    clock24: false,
    tempUnit: 'F',
    autoStart: true,
    morningBriefing: true,
    defaultReminder: 15,
    layoutLocked: true,
    layoutMode: 'auto', // auto (Edge layout on a wide, short screen) | standard | edge
    fieldUnit: { url: '', config: null, deckId: null, role: 'main' },
    // Rig lighting through iCUE (off until switched on in Settings › LIGHTING)
    lighting: { enabled: false, boot: true, alert: true, speaking: true, crew: true, brightness: 80 }
  },
  tasks: [],
  localEvents: [],
  timers: [], // { id, kind: timer|alarm, label, endsAt, total }
  projects: [], // { id, name, goal, color, due, status: active|done, createdAt, completedAt }
  notes: [], // { id, title, body, pinned, src: typed|voice|scan, createdAt, editedAt, editedOn }
  schedule: [], // { id, type, title, date: 'YYYY-MM-DD', note, replies: { [linkToken]: { state: ok|change, comment, at, by } }, createdAt }
  layout: null,
  layoutEdge: null, // panel positions for the Xeneon Edge layout (24 columns)
  window: { bounds: null },
  meta: { lastBriefingDate: null, lastLaunch: null },
  push: { publicKey: null, privateKey: null }
};

let file = null;
let data = null;

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function mergeDefaults(target, defaults) {
  for (const key of Object.keys(defaults)) {
    const dv = defaults[key];
    if (target[key] === undefined) {
      target[key] = clone(dv);
    } else if (dv && typeof dv === 'object' && !Array.isArray(dv) && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      mergeDefaults(target[key], dv);
    }
  }
  return target;
}

function init(userDataDir) {
  file = path.join(userDataDir, 'command-deck.json');
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    // Missing or unreadable: try the backup copy, else start fresh.
    try {
      data = JSON.parse(fs.readFileSync(file + '.bak', 'utf8'));
    } catch (e2) {
      data = {};
    }
  }
  mergeDefaults(data, DEFAULTS);
  return data;
}

function get() {
  return data;
}

let writeTimer = null;
function flush() {
  if (!file) return;
  clearTimeout(writeTimer);
  writeTimer = null;
  const tmp = file + '.tmp';
  const text = JSON.stringify(data, null, 2);
  try {
    if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak');
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, file);
  } catch (e) {
    console.error('Store write failed:', e);
  }
}

function set(key, value) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) return false;
  data[key] = value;
  clearTimeout(writeTimer);
  writeTimer = setTimeout(flush, 250);
  return true;
}

function replaceAll(next) {
  data = mergeDefaults(next && typeof next === 'object' ? next : {}, DEFAULTS);
  flush();
  return data;
}

module.exports = { init, get, set, flush, replaceAll, DEFAULTS };
