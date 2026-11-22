// Command Deck connector: a remote MCP server that lets Claude work with your deck.
//
// It runs on Cloudflare Workers. Claude adds it as a custom connector; when you click
// Connect, Claude opens /authorize, you type the pairing code the deck shows under
// Settings › Field Unit, and the connector joins the deck as one more paired device
// (an anonymous Firebase user with a members/{uid} doc, exactly like a phone).
//
// Nothing is stored here. Everything the connector needs to remember (which deck, its
// Firebase sign-in, your time zone) travels inside the OAuth tokens, sealed with
// AES-GCM under ENC_KEY, a secret only this worker knows. Unpairing it on the deck
// (deleting its members doc) cuts it off at once: Firestore refuses every request.
//
// Writes follow shared/sync.js: every item carries updatedAt (newest wins) and `by`
// (the writer's uid); a delete is a tombstone { id, deleted: true, updatedAt, by }.

const VERSION = '1.0.0';
const NAME = 'Claude';
const SCOPE = 'deck';

// ---------------------------------------------------------------- small helpers
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS, ...headers } });
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-expose-headers': 'www-authenticate, mcp-session-id' };

class UserError extends Error {}
class Unpaired extends Error {}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function normalizePairCode(text) {
  return String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/[O]/g, '0').replace(/[I]/g, '1')
    .split('').filter((c) => CODE_ALPHABET.includes(c)).join('').slice(0, 6);
}
export function makeId(prefix = '') {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return prefix + Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 16);
}

// ---------------------------------------------------------------- sealing (AES-GCM)
const keyCache = new Map();
async function aesKey(secret) {
  if (!secret) throw new Error('ENC_KEY is not set');
  if (!keyCache.has(secret)) {
    const raw = await crypto.subtle.digest('SHA-256', enc.encode(secret));
    keyCache.set(secret, await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']));
  }
  return keyCache.get(secret);
}
export async function seal(env, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env.ENC_KEY), enc.encode(JSON.stringify(obj))));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv); out.set(ct, 12);
  return b64u(out);
}
export async function unseal(env, token) {
  try {
    const all = unb64u(String(token || ''));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, await aesKey(env.ENC_KEY), all.slice(12));
    const obj = JSON.parse(dec.decode(pt));
    if (obj.exp && obj.exp < Date.now()) return null;
    return obj;
  } catch (e) { return null; }
}
async function sha256b64u(text) {
  return b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text))));
}

// ---------------------------------------------------------------- time zone helpers
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtCache = new Map();
function partsIn(ms, tz) {
  if (!fmtCache.has(tz)) fmtCache.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }));
  const p = {};
  for (const x of fmtCache.get(tz).formatToParts(new Date(ms))) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour % 24, mm: +p.minute, ss: +p.second };
}
/** The instant when the wall clock in `tz` reads y-m-d hh:mm. */
export function zoned(y, m, d, hh, mm, tz) {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const off = (t) => { const p = partsIn(t, tz); return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - t; };
  let t = guess - off(guess);
  t = guess - off(t);
  return t;
}
export function validTz(tz) { try { partsIn(0, tz); return true; } catch (e) { return false; } }
const pad = (n) => String(n).padStart(2, '0');
function ymdIn(ms, tz) { const p = partsIn(ms, tz); return `${p.y}-${pad(p.m)}-${pad(p.d)}`; }
function wdOf(ymd) { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }
function addDaysYmd(ymd, n) { const [y, m, d] = ymd.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; }
function niceDate(ymd) { const [y, m, d] = ymd.split('-').map(Number); return `${DOW[wdOf(ymd)]} ${MON[m - 1]} ${d}${y !== new Date().getUTCFullYear() ? ` ${y}` : ''}`; }
function niceTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}${m ? `:${pad(m)}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}
function hmIn(ms, tz) { const p = partsIn(ms, tz); return `${pad(p.hh)}:${pad(p.mm)}`; }
function cleanYmd(v, field) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new UserError(`${field} must be a date like 2026-11-23.`);
  return s;
}
function cleanHm(v, field) {
  if (v == null || v === '') return '';
  const s = String(v).trim().toLowerCase().replace(/\./g, '');
  const m = /^(\d{1,2})(?::?(\d{2}))?\s*(am|pm|a|p)?$/.exec(s);
  if (!m) throw new UserError(`${field} must be a time like 15:30 or 3:30 pm.`);
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  const ap = m[3] ? m[3][0] : '';
  if (min > 59 || h > 23 || (ap && (h < 1 || h > 12))) throw new UserError(`${field} must be a time like 15:30 or 3:30 pm.`);
  if (ap === 'p' && h < 12) h += 12;
  if (ap === 'a' && h === 12) h = 0;
  return `${pad(h)}:${pad(min)}`;
}
function dueIso(ymd, hm, tz) {
  const [y, m, d] = ymd.split('-').map(Number);
  const [hh, mm] = hm ? hm.split(':').map(Number) : [0, 0];
  return new Date(zoned(y, m, d, hh, mm, tz)).toISOString();
}

/** shared/util.js advanceDate, done on the wall clock of `tz`. */
export function advanceDue(iso, rep, tz) {
  const p = partsIn(new Date(iso).getTime(), tz);
  const n = new Date(Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm));
  const iv = Math.max(1, rep.interval || 1);
  switch (rep.type) {
    case 'daily': n.setUTCDate(n.getUTCDate() + iv); break;
    case 'weekdays': do { n.setUTCDate(n.getUTCDate() + 1); } while (n.getUTCDay() === 0 || n.getUTCDay() === 6); break;
    case 'weekly':
      if (rep.days && rep.days.length && iv === 1) { do { n.setUTCDate(n.getUTCDate() + 1); } while (!rep.days.includes(n.getUTCDay())); }
      else n.setUTCDate(n.getUTCDate() + 7 * iv);
      break;
    case 'monthly': {
      const day = n.getUTCDate();
      n.setUTCDate(1);
      n.setUTCMonth(n.getUTCMonth() + iv);
      const max = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 0)).getUTCDate();
      n.setUTCDate(Math.min(day, max));
      break;
    }
    case 'yearly': n.setUTCFullYear(n.getUTCFullYear() + iv); break;
    default: return null;
  }
  return new Date(zoned(n.getUTCFullYear(), n.getUTCMonth() + 1, n.getUTCDate(), n.getUTCHours(), n.getUTCMinutes(), tz)).toISOString();
}

// ---------------------------------------------------------------- Firebase (REST)
let cfgCache = null;
async function firebaseConfig(env) {
  if (env.FIREBASE_API_KEY) return { apiKey: env.FIREBASE_API_KEY, projectId: env.FIREBASE_PROJECT };
  if (cfgCache && cfgCache.at > Date.now() - 3600e3) return cfgCache.cfg;
  const res = await fetch(`https://${env.FIREBASE_PROJECT}.web.app/__/firebase/init.json`);
  if (!res.ok) throw new Error(`Could not read the Firebase config (HTTP ${res.status})`);
  const cfg = await res.json();
  cfgCache = { cfg, at: Date.now() };
  return cfg;
}
const referer = (env) => ({ referer: `https://${env.FIREBASE_PROJECT}.web.app/` });

async function signUpAnon(env) {
  const { apiKey } = await firebaseConfig(env);
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...referer(env) }, body: JSON.stringify({ returnSecureToken: true })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Firebase sign-in failed: ${(body.error && body.error.message) || res.status}`);
  return { uid: body.localId, idToken: body.idToken, refreshToken: body.refreshToken, exp: Date.now() + (Number(body.expiresIn) || 3600) * 1000 };
}

const idCache = new Map(); // uid -> { idToken, exp }
async function idTokenFor(env, sess) {
  const hit = idCache.get(sess.uid);
  if (hit && hit.exp > Date.now() + 60e3) return hit.idToken;
  const { apiKey } = await firebaseConfig(env);
  const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...referer(env) },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: sess.rt })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 400) throw new Unpaired('sign-in expired');
    throw new Error(`Firebase token refresh failed (HTTP ${res.status})`);
  }
  idCache.set(sess.uid, { idToken: body.id_token, exp: Date.now() + (Number(body.expires_in) || 3600) * 1000 });
  return body.id_token;
}

// Firestore value encoding (what the JS SDK writes).
export function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.filter((x) => x !== undefined).map(toValue) } };
  if (typeof v === 'object') return { mapValue: { fields: toFields(v) } };
  return { nullValue: null };
}
export function toFields(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = toValue(v);
  return out;
}
export function fromValue(v) {
  if (!v || 'nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  if ('mapValue' in v) return fromFields(v.mapValue.fields || {});
  if ('referenceValue' in v) return v.referenceValue;
  return null;
}
export function fromFields(f) {
  const out = {};
  for (const [k, v] of Object.entries(f || {})) out[k] = fromValue(v);
  return out;
}

class Store {
  constructor(env, sess) {
    this.env = env;
    this.sess = sess;
    this.base = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT}/databases/(default)/documents`;
  }
  async call(method, path, body, idToken) {
    const tok = idToken || await idTokenFor(this.env, this.sess);
    const res = await fetch(`${this.base}/${path}`, {
      method, headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined
    });
    if (res.status === 404) return null;
    if (res.status === 403 || res.status === 401) {
      const t = await res.text().catch(() => '');
      if (!idToken) throw new Unpaired(t.slice(0, 200));
      const err = new Error('forbidden'); err.status = res.status; throw err;
    }
    if (!res.ok) throw new Error(`Firestore ${method} ${path.split('/').slice(-2, -1)[0] || path} failed (HTTP ${res.status})`);
    return res.json();
  }
  deck(...parts) { return ['decks', this.sess.deck, ...parts].map(encodeURIComponent).join('/'); }
  async get(...parts) {
    const doc = await this.call('GET', this.deck(...parts));
    return doc ? fromFields(doc.fields) : null;
  }
  async list(kind) {
    const out = [];
    let token = '';
    for (let i = 0; i < 20; i++) {
      const page = await this.call('GET', `${this.deck(kind)}?pageSize=300${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`);
      if (!page) break;
      for (const d of page.documents || []) out.push(fromFields(d.fields));
      if (!page.nextPageToken) break;
      token = page.nextPageToken;
    }
    return out;
  }
  async live(kind) { return (await this.list(kind)).filter((x) => x && x.id && !x.deleted); }
  /** Writes one item the way DeckSync.push does. */
  async put(kind, item, prev) {
    item.updatedAt = Math.max(Date.now(), ((prev && prev.updatedAt) || 0) + 1);
    item.by = this.sess.uid;
    const clean = JSON.parse(JSON.stringify(item));
    await this.call('PATCH', this.deck(kind, item.id), { fields: toFields(clean) });
    return item;
  }
  async remove(kind, prev) {
    const t = { id: prev.id, deleted: true, updatedAt: Math.max(Date.now(), (prev.updatedAt || 0) + 1), by: this.sess.uid };
    await this.call('PATCH', this.deck(kind, prev.id), { fields: toFields(t) });
  }
}

/** Joins a deck with its pairing code, exactly as a phone does. Returns the session to seal into tokens. */
export async function pairWithCode(env, codeText, tz) {
  const code = normalizePairCode(codeText);
  if (code.length !== 6) throw new UserError('Enter the 6-character code shown on Command Deck.');
  const user = await signUpAnon(env);
  const st = new Store(env, { uid: user.uid, deck: '' });
  let pc;
  try { pc = await st.call('GET', `pairCodes/${code}`, null, user.idToken); }
  catch (e) { if (e.status) throw new UserError('That code has expired. Show a new one on the deck and try again.'); throw e; }
  if (!pc) throw new UserError('Code not recognized. Check it, or show a new one on the deck.');
  const deckId = fromFields(pc.fields).deckId;
  try {
    await st.call('PATCH', `decks/${encodeURIComponent(deckId)}/members/${encodeURIComponent(user.uid)}`,
      { fields: toFields({ kind: 'claude', name: NAME, joinedAt: Date.now(), code }) }, user.idToken);
  } catch (e) {
    if (e.status) throw new UserError('The deck refused the code (it may have just expired). Show a new one and try again.');
    throw e;
  }
  idCache.set(user.uid, { idToken: user.idToken, exp: user.exp });
  return { uid: user.uid, rt: user.refreshToken, deck: deckId, tz: validTz(tz) ? tz : (env.DEFAULT_TZ || 'America/Los_Angeles') };
}

// ---------------------------------------------------------------- deck logic
const PRI = { high: 3, medium: 2, low: 1 };
const DEFAULT_TYPES = [
  { id: 'appt', name: 'Appointment' }, { id: 'ldc', name: 'LDC' }, { id: 'metro', name: 'Metro' }, { id: 'other', name: 'Other' }
];

function taskWhen(t, tz) {
  if (!t.due) return '';
  const ms = new Date(t.due).getTime();
  return `${niceDate(ymdIn(ms, tz))}${t.dueHasTime ? ` ${niceTime(hmIn(ms, tz))}` : ''}`;
}
function overdue(t, tz, now = Date.now()) {
  if (!t.due || t.done) return false;
  const ms = new Date(t.due).getTime();
  return t.dueHasTime ? ms < now : ymdIn(ms, tz) < ymdIn(now, tz);
}
function sortTasks(list, tz) {
  const now = Date.now();
  return list.slice().sort((a, b) => {
    const oa = overdue(a, tz, now) ? 0 : 1; const ob = overdue(b, tz, now) ? 0 : 1;
    if (oa !== ob) return oa - ob;
    const da = a.due ? new Date(a.due).getTime() + (a.dueHasTime ? 0 : 86399000) : Infinity;
    const db = b.due ? new Date(b.due).getTime() + (b.dueHasTime ? 0 : 86399000) : Infinity;
    if (da !== db) return da - db;
    return (PRI[b.priority] || 2) - (PRI[a.priority] || 2);
  });
}
function taskLine(t, tz) {
  const bits = [];
  const when = taskWhen(t, tz);
  if (when) bits.push(`due ${when}`);
  if (overdue(t, tz)) bits.push('OVERDUE');
  if (t.priority && t.priority !== 'medium') bits.push(`${t.priority} priority`);
  if (t.repeat && t.repeat.type && t.repeat.type !== 'none') bits.push(`repeats ${t.repeat.type}`);
  if (t.category) bits.push(`category ${t.category}`);
  if (t.done) bits.push(`done ${t.doneAt ? niceDate(ymdIn(new Date(t.doneAt).getTime(), tz)) : ''}`.trim());
  const subs = (t.subtasks || []).filter((s) => s && s.text);
  if (subs.length) bits.push(`${subs.filter((s) => s.done).length}/${subs.length} steps`);
  return `- [${t.id}] ${t.title}${bits.length ? ` (${bits.join(', ')})` : ''}${t.notes ? `\n    notes: ${String(t.notes).slice(0, 300)}` : ''}`;
}
function todayLine(tz) {
  const now = Date.now();
  return `Now: ${niceDate(ymdIn(now, tz))} ${niceTime(hmIn(now, tz))} (${ymdIn(now, tz)}, ${tz}).`;
}
function findById(list, id, what) {
  const hit = list.find((x) => x.id === String(id || '').trim());
  if (!hit) throw new UserError(`No ${what} with id "${id}". List them first to get the id.`);
  return hit;
}
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

function eventLine(e, tz) {
  const s = new Date(e.start).getTime();
  const en = e.end ? new Date(e.end).getTime() : s;
  const when = e.allDay ? `${niceDate(ymdIn(s, tz))} (all day)` : `${niceDate(ymdIn(s, tz))} ${niceTime(hmIn(s, tz))}${e.end ? `–${niceTime(hmIn(en, tz))}` : ''}`;
  return `- ${when}: ${e.title}${e.location ? ` @ ${e.location}` : ''}`;
}

async function scheduleTypes(st) {
  const shared = await st.get('meta', 'shared').catch(() => null);
  const t = shared && Array.isArray(shared.scheduleTypes) && shared.scheduleTypes.length ? shared.scheduleTypes : DEFAULT_TYPES;
  return t;
}

export const TOOLS = [
  {
    name: 'deck_overview',
    title: 'Overview of today',
    description: "A quick look at the deck right now: today's date and time, overdue tasks, tasks due today, today's calendar events and today's schedule entries. Start here when the user asks what's on today.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'list_tasks',
    title: 'List tasks',
    description: "List tasks in the user's Command Deck queue, overdue first, then by due date. Each line starts with the task id in brackets; use that id with the other task tools.",
    inputSchema: { type: 'object', properties: {
      show: { type: 'string', enum: ['open', 'done', 'all'], description: 'Which tasks to show. Default open.' },
      search: { type: 'string', description: 'Only tasks whose title or notes contain this text.' },
      limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Most tasks to return. Default 60.' }
    }, additionalProperties: false },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'add_task',
    title: 'Add a task',
    description: "Add a task to the user's queue. Dates are in the user's own time zone (see the Now line in any result). Leave due_date out for a task with no date.",
    inputSchema: { type: 'object', properties: {
      title: { type: 'string', description: 'What to do, short.' },
      due_date: { type: 'string', description: 'YYYY-MM-DD.' },
      due_time: { type: 'string', description: 'HH:MM (24-hour) or like "3:30 pm". Needs due_date.' },
      priority: { type: 'string', enum: ['low', 'medium', 'high'] },
      notes: { type: 'string', description: 'Extra details.' }
    }, required: ['title'], additionalProperties: false }
  },
  {
    name: 'update_task',
    title: 'Edit a task',
    description: 'Change a task: title, due date or time, priority or notes. Pass only what changes. Set clear_due to true to remove the date.',
    inputSchema: { type: 'object', properties: {
      id: { type: 'string' }, title: { type: 'string' }, due_date: { type: 'string', description: 'YYYY-MM-DD.' },
      due_time: { type: 'string', description: 'HH:MM, or "" to make it an all-day task.' }, clear_due: { type: 'boolean' },
      priority: { type: 'string', enum: ['low', 'medium', 'high'] }, notes: { type: 'string', description: 'Replaces the notes.' }
    }, required: ['id'], additionalProperties: false },
    annotations: { idempotentHint: true }
  },
  {
    name: 'complete_task',
    title: 'Finish a task',
    description: 'Mark a task done. A repeating task moves to its next date instead.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
    annotations: { idempotentHint: true }
  },
  {
    name: 'reopen_task',
    title: 'Reopen a task',
    description: 'Put a finished task back in the queue.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
    annotations: { idempotentHint: true }
  },
  {
    name: 'delete_task',
    title: 'Delete a task',
    description: 'Delete a task for good (finishing it is usually what the user wants). Always ask the user to confirm, naming the task, before calling this.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
    annotations: { destructiveHint: true }
  },
  {
    name: 'list_schedule',
    title: 'Read the shared schedule',
    description: "Entries on the user's shared schedule (who's where, appointments, shifts) for a range of days.",
    inputSchema: { type: 'object', properties: {
      from: { type: 'string', description: 'First day, YYYY-MM-DD. Default today.' },
      days: { type: 'integer', minimum: 1, maximum: 62, description: 'How many days. Default 14.' }
    }, additionalProperties: false },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'add_schedule_entry',
    title: 'Add to the schedule',
    description: 'Add an entry to the shared schedule. Everyone with a schedule link sees it.',
    inputSchema: { type: 'object', properties: {
      title: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD.' },
      start: { type: 'string', description: 'Optional start time, HH:MM or "9:30 am".' }, end: { type: 'string', description: 'Optional end time.' },
      type: { type: 'string', description: 'Entry type by name or id (list_schedule shows the types). Default the first type.' },
      note: { type: 'string', description: 'Optional note everyone sees.' }
    }, required: ['title', 'date'], additionalProperties: false }
  },
  {
    name: 'delete_schedule_entry',
    title: 'Remove from the schedule',
    description: 'Remove a schedule entry. Always ask the user to confirm, naming the entry, before calling this.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
    annotations: { destructiveHint: true }
  },
  {
    name: 'list_events',
    title: 'Upcoming events',
    description: "Calendar events coming up: the user's linked calendars plus events added on the deck.",
    inputSchema: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 60, description: 'How many days ahead. Default 14.' } }, additionalProperties: false },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'list_notes',
    title: 'List notes',
    description: 'Notes on the deck, pinned first, then newest. Includes meeting recaps. Use read_note for the full text.',
    inputSchema: { type: 'object', properties: { search: { type: 'string', description: 'Only notes containing this text.' } }, additionalProperties: false },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'read_note',
    title: 'Read a note',
    description: 'The full text of one note, or a recap with its summary and action items.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'add_note',
    title: 'Add a note',
    description: 'Save a new note on the deck.',
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } }, required: ['title'], additionalProperties: false }
  },
  {
    name: 'update_note',
    title: 'Edit a note',
    description: 'Change a note. Use append to add text at the end without retyping it; body replaces the whole text.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, append: { type: 'string' } }, required: ['id'], additionalProperties: false }
  }
];
for (const t of TOOLS) {
  t.annotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: false, ...t.annotations, title: t.title };
}

async function runTool(env, sess, name, a = {}) {
  const st = new Store(env, sess);
  const tz = sess.tz;
  const now = Date.now();
  const today = ymdIn(now, tz);

  switch (name) {
    case 'deck_overview': {
      const [tasks, cal, local, sched] = await Promise.all([st.live('tasks'), st.get('meta', 'calendar').catch(() => null), st.live('events').catch(() => []), st.live('schedule').catch(() => [])]);
      const open = sortTasks(tasks.filter((t) => !t.done), tz);
      const late = open.filter((t) => overdue(t, tz, now));
      const dueToday = open.filter((t) => !overdue(t, tz, now) && t.due && ymdIn(new Date(t.due).getTime(), tz) === today);
      const evs = [...((cal && cal.events) || []), ...local].filter((e) => e && e.start && ymdIn(new Date(e.start).getTime(), tz) <= today && ymdIn(new Date(e.end || e.start).getTime() - 1, tz) >= today)
        .sort((x, y) => new Date(x.start) - new Date(y.start));
      const sc = sched.filter((e) => e.date === today);
      const out = [todayLine(tz), '',
        `Overdue (${late.length}):`, ...(late.length ? late.map((t) => taskLine(t, tz)) : ['- none']), '',
        `Due today (${dueToday.length}):`, ...(dueToday.length ? dueToday.map((t) => taskLine(t, tz)) : ['- none']), '',
        `Open tasks in all: ${open.length}.`, '',
        `Calendar today (${evs.length}):`, ...(evs.length ? evs.map((e) => eventLine(e, tz)) : ['- nothing']), '',
        `Schedule today (${sc.length}):`, ...(sc.length ? sc.map((e) => `- [${e.id}] ${e.start ? `${niceTime(e.start)}${e.end ? `–${niceTime(e.end)}` : ''} ` : ''}${e.title}`) : ['- nothing'])];
      return out.join('\n');
    }

    case 'list_tasks': {
      const show = a.show || 'open';
      const q = str(a.search, 100).toLowerCase();
      let list = await st.live('tasks');
      if (show === 'open') list = list.filter((t) => !t.done);
      if (show === 'done') list = list.filter((t) => t.done).sort((x, y) => String(y.doneAt || '').localeCompare(String(x.doneAt || '')));
      else list = sortTasks(list, tz);
      if (q) list = list.filter((t) => `${t.title} ${t.notes || ''}`.toLowerCase().includes(q));
      const lim = Math.min(200, Math.max(1, Number(a.limit) || 60));
      const shown = list.slice(0, lim);
      return [todayLine(tz), `${list.length} ${show === 'all' ? '' : `${show} `}task${list.length === 1 ? '' : 's'}${q ? ` matching "${q}"` : ''}${list.length > lim ? `, showing ${lim}` : ''}:`,
        ...(shown.length ? shown.map((t) => taskLine(t, tz)) : ['- none'])].join('\n');
    }

    case 'add_task': {
      const title = str(a.title, 200);
      if (!title) throw new UserError('A task needs a title.');
      const date = cleanYmd(a.due_date, 'due_date');
      const time = cleanHm(a.due_time, 'due_time');
      if (time && !date) throw new UserError('Give a due_date along with due_time.');
      const pr = PRI[a.priority] ? a.priority : 'medium';
      const task = {
        id: makeId('t_'), title, due: date ? dueIso(date, time, tz) : null, dueHasTime: !!(date && time), priority: pr, category: null, assignee: null,
        reminder: null, repeat: { type: 'none', interval: 1, days: [] }, subtasks: [], notes: str(a.notes, 4000),
        done: false, doneAt: null, createdAt: new Date(now).toISOString(), remindedFor: null, addedBy: NAME
      };
      await st.put('tasks', task);
      return `Added: ${taskLine(task, tz)}`;
    }

    case 'update_task': {
      const list = await st.live('tasks');
      const prev = findById(list, a.id, 'task');
      const t = JSON.parse(JSON.stringify(prev));
      if (a.title != null) { const v = str(a.title, 200); if (!v) throw new UserError('The title cannot be empty.'); t.title = v; }
      if (a.notes != null) t.notes = str(a.notes, 4000);
      if (a.priority != null) { if (!PRI[a.priority]) throw new UserError('priority is low, medium or high.'); t.priority = a.priority; }
      if (a.clear_due) { t.due = null; t.dueHasTime = false; t.remindedFor = null; }
      else if (a.due_date != null || a.due_time != null) {
        const date = cleanYmd(a.due_date, 'due_date') || (t.due ? ymdIn(new Date(t.due).getTime(), tz) : null);
        if (!date) throw new UserError('This task has no date yet: give due_date too.');
        const time = a.due_time != null ? cleanHm(a.due_time, 'due_time') : (t.due && t.dueHasTime ? hmIn(new Date(t.due).getTime(), tz) : '');
        t.due = dueIso(date, time, tz); t.dueHasTime = !!time; t.remindedFor = null;
      }
      await st.put('tasks', t, prev);
      return `Updated: ${taskLine(t, tz)}`;
    }

    case 'complete_task': {
      const list = await st.live('tasks');
      const prev = findById(list, a.id, 'task');
      if (prev.done) return `Already done: ${taskLine(prev, tz)}`;
      const t = JSON.parse(JSON.stringify(prev));
      if (t.repeat && t.repeat.type && t.repeat.type !== 'none' && t.due) {
        let next = advanceDue(t.due, t.repeat, tz);
        let guard = 0;
        while (next && ymdIn(new Date(next).getTime(), tz) < today && guard++ < 500) next = advanceDue(next, t.repeat, tz);
        if (next) {
          t.due = next; t.remindedFor = null;
          (t.subtasks || []).forEach((s) => { s.done = false; });
          await st.put('tasks', t, prev);
          return `Repeating task moved to its next date: ${taskLine(t, tz)}`;
        }
      }
      t.done = true; t.doneAt = new Date(now).toISOString(); t.doneBy = NAME;
      await st.put('tasks', t, prev);
      return `Done: ${t.title}`;
    }

    case 'reopen_task': {
      const list = await st.live('tasks');
      const prev = findById(list, a.id, 'task');
      if (!prev.done) return `Already open: ${taskLine(prev, tz)}`;
      const t = { ...prev, done: false, doneAt: null, doneBy: null };
      await st.put('tasks', t, prev);
      return `Back in the queue: ${taskLine(t, tz)}`;
    }

    case 'delete_task': {
      const list = await st.live('tasks');
      const prev = findById(list, a.id, 'task');
      await st.remove('tasks', prev);
      return `Deleted task: ${prev.title}`;
    }

    case 'list_schedule': {
      const from = cleanYmd(a.from, 'from') || today;
      const days = Math.min(62, Math.max(1, Number(a.days) || 14));
      const to = addDaysYmd(from, days - 1);
      const [list, types] = await Promise.all([st.live('schedule'), scheduleTypes(st)]);
      const tName = (id) => (types.find((t) => t.id === id) || {}).name || id || 'Other';
      const rows = list.filter((e) => e.date >= from && e.date <= to)
        .sort((x, y) => (x.date + (x.start || '')).localeCompare(y.date + (y.start || '')));
      return [todayLine(tz), `Schedule ${niceDate(from)} – ${niceDate(to)} (${rows.length}):`,
        ...(rows.length ? rows.map((e) => `- [${e.id}] ${niceDate(e.date)}${e.start ? ` ${niceTime(e.start)}${e.end ? `–${niceTime(e.end)}` : ''}` : ''}: ${e.title} (${tName(e.type)}${e.addedBy && e.addedBy.name ? `, added by ${e.addedBy.name}` : ''})${e.note ? ` — ${e.note}` : ''}`) : ['- nothing']),
        `Types: ${types.map((t) => t.name).join(', ')}.`].join('\n');
    }

    case 'add_schedule_entry': {
      const title = str(a.title, 120);
      if (!title) throw new UserError('An entry needs a title.');
      const date = cleanYmd(a.date, 'date');
      if (!date) throw new UserError('An entry needs a date.');
      const types = await scheduleTypes(st);
      const want = str(a.type, 40).toLowerCase();
      const type = want ? types.find((t) => t.id.toLowerCase() === want || String(t.name || '').toLowerCase() === want) : types[0];
      if (!type) throw new UserError(`No schedule type "${a.type}". Types: ${types.map((t) => t.name).join(', ')}.`);
      const entry = { id: makeId(), type: type.id, title, date, start: cleanHm(a.start, 'start'), end: cleanHm(a.end, 'end'), note: str(a.note, 300), addedBy: null, createdAt: now };
      await st.put('schedule', entry);
      return `Added to the schedule: ${niceDate(date)}${entry.start ? ` ${niceTime(entry.start)}${entry.end ? `–${niceTime(entry.end)}` : ''}` : ''} ${title} (${type.name}).`;
    }

    case 'delete_schedule_entry': {
      const list = await st.live('schedule');
      const prev = findById(list, a.id, 'schedule entry');
      await st.remove('schedule', prev);
      return `Removed from the schedule: ${niceDate(prev.date)} ${prev.title}`;
    }

    case 'list_events': {
      const days = Math.min(60, Math.max(1, Number(a.days) || 14));
      const [cal, local] = await Promise.all([st.get('meta', 'calendar').catch(() => null), st.live('events').catch(() => [])]);
      const end = now + days * 864e5;
      const evs = [...((cal && cal.events) || []), ...local]
        .filter((e) => e && e.start && new Date(e.end || e.start).getTime() > now - 3600e3 && new Date(e.start).getTime() < end)
        .sort((x, y) => new Date(x.start) - new Date(y.start)).slice(0, 150);
      return [todayLine(tz), `Next ${days} days (${evs.length}):`, ...(evs.length ? evs.map((e) => eventLine(e, tz)) : ['- nothing'])].join('\n');
    }

    case 'list_notes': {
      const q = str(a.search, 100).toLowerCase();
      let list = await st.live('notes');
      if (q) list = list.filter((n) => `${n.title} ${n.body || ''} ${n.recap && n.recap.summary ? n.recap.summary : ''}`.toLowerCase().includes(q));
      list.sort((x, y) => (y.pinned ? 1 : 0) - (x.pinned ? 1 : 0) || String(y.editedAt || y.createdAt || '').localeCompare(String(x.editedAt || x.createdAt || '')));
      return [`${list.length} note${list.length === 1 ? '' : 's'}${q ? ` matching "${q}"` : ''}:`,
        ...(list.length ? list.slice(0, 80).map((n) => `- [${n.id}] ${n.title || '(untitled)'}${n.pinned ? ' (pinned)' : ''}${n.src === 'recap' ? ' (meeting recap)' : ''}${n.body ? ` — ${String(n.body).replace(/\s+/g, ' ').slice(0, 90)}` : ''}`) : ['- none'])].join('\n');
    }

    case 'read_note': {
      const n = findById(await st.live('notes'), a.id, 'note');
      const out = [`# ${n.title || '(untitled)'}`, n.body || ''];
      const r = n.recap;
      if (r) {
        if (r.summary) out.push('', 'Summary:', r.summary);
        const acts = r.actions || r.actionItems;
        if (Array.isArray(acts) && acts.length) out.push('', 'Action items:', ...acts.map((x) => `- ${typeof x === 'string' ? x : x.text || JSON.stringify(x)}`));
        if (r.status && r.status !== 'done') out.push('', `(Recap status: ${r.status})`);
      }
      return out.join('\n').trim();
    }

    case 'add_note': {
      const title = str(a.title, 200);
      if (!title) throw new UserError('A note needs a title.');
      const iso = new Date(now).toISOString();
      const n = { id: makeId('n_'), title, body: str(a.body, 20000), pinned: false, src: 'typed', createdAt: iso, editedAt: iso, editedOn: 'claude' };
      await st.put('notes', n);
      return `Saved note [${n.id}] ${title}`;
    }

    case 'update_note': {
      const list = await st.live('notes');
      const prev = findById(list, a.id, 'note');
      const n = JSON.parse(JSON.stringify(prev));
      if (a.title != null) n.title = str(a.title, 200) || n.title;
      if (a.body != null) n.body = str(a.body, 20000);
      if (a.append) n.body = `${n.body ? `${n.body}\n` : ''}${str(a.append, 20000)}`.slice(0, 20000);
      n.editedAt = new Date(now).toISOString(); n.editedOn = 'claude';
      await st.put('notes', n, prev);
      return `Updated note [${n.id}] ${n.title}`;
    }

    default:
      throw new UserError(`Unknown tool ${name}`);
  }
}

// ---------------------------------------------------------------- MCP endpoint
async function bearerSession(env, req) {
  const h = req.headers.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) return null;
  const tok = await unseal(env, m[1].trim());
  return tok && tok.t === 'x' ? tok.s : null;
}

function unauthorized(origin) {
  return new Response(JSON.stringify({ error: 'invalid_token', error_description: 'Connect Command Deck again.' }), {
    status: 401, headers: { 'content-type': 'application/json', 'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`, ...CORS }
  });
}

async function handleRpc(env, sess, msg) {
  const id = msg.id;
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (id === undefined || id === null) return null; // notification
  switch (msg.method) {
    case 'initialize':
      return ok({
        protocolVersion: (msg.params && msg.params.protocolVersion) || '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'command-deck', title: 'Command Deck', version: VERSION },
        instructions: `Command Deck is the user's own desktop console (with Field Unit on their phone). These tools read and change their tasks, shared schedule, notes and upcoming events; changes show up on the deck and phone within seconds. The user's time zone is ${sess.tz}; give dates as YYYY-MM-DD in that zone. Get ids from the list tools. Ask before deleting anything.`
      });
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: TOOLS });
    case 'resources/list': return ok({ resources: [] });
    case 'prompts/list': return ok({ prompts: [] });
    case 'tools/call': {
      const p = msg.params || {};
      if (!TOOLS.some((t) => t.name === p.name)) return fail(-32602, `Unknown tool: ${p.name}`);
      try {
        const text = await runTool(env, sess, p.name, p.arguments || {});
        return ok({ content: [{ type: 'text', text }], isError: false });
      } catch (e) {
        if (e instanceof Unpaired) return ok({ content: [{ type: 'text', text: 'Command Deck refused the request: this connector has been unpaired from the deck. Disconnect and connect it again in Claude with a new pairing code.' }], isError: true });
        if (e instanceof UserError) return ok({ content: [{ type: 'text', text: e.message }], isError: true });
        return ok({ content: [{ type: 'text', text: `Command Deck had a problem: ${e.message}` }], isError: true });
      }
    }
    default: return fail(-32601, `Method not found: ${msg.method}`);
  }
}

async function mcp(env, req, origin) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: { allow: 'POST', ...CORS } });
  const sess = await bearerSession(env, req);
  if (!sess) return unauthorized(origin);
  let body;
  try { body = await req.json(); } catch (e) { return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400); }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handleRpc(env, sess, m)))).filter(Boolean);
    return out.length ? json(out) : new Response(null, { status: 202, headers: CORS });
  }
  const out = await handleRpc(env, sess, body);
  return out ? json(out) : new Response(null, { status: 202, headers: CORS });
}

// ---------------------------------------------------------------- OAuth
function metadata(origin) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    registration_endpoint: `${origin}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [SCOPE]
  };
}

function okRedirect(uri) {
  try {
    const u = new URL(uri);
    return u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname));
  } catch (e) { return false; }
}

async function register(env, req) {
  let body = {};
  try { body = await req.json(); } catch (e) { /* empty */ }
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
  if (!uris.length || !uris.every(okRedirect)) return json({ error: 'invalid_redirect_uri', error_description: 'redirect_uris must be https URLs.' }, 400);
  const name = str(body.client_name || 'Claude', 80);
  const clientId = await seal(env, { t: 'c', ru: uris, n: name });
  return json({ client_id: clientId, client_id_issued_at: Math.floor(Date.now() / 1000), client_name: name, redirect_uris: uris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }, 201);
}

async function checkAuthParams(env, p) {
  if (p.get('response_type') !== 'code') return 'response_type must be code';
  const client = await unseal(env, p.get('client_id'));
  if (!client || client.t !== 'c') return 'Unknown client. Remove the connector in Claude and add it again.';
  const ru = p.get('redirect_uri') || client.ru[0];
  if (!client.ru.includes(ru)) return 'redirect_uri does not match this client';
  if (!p.get('code_challenge') || (p.get('code_challenge_method') || 'S256') !== 'S256') return 'PKCE (S256) is required';
  return { client, ru };
}

const PAGE_CSS = `*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0B0C10;color:#E8E4EE;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{width:min(440px,92vw);padding:34px;border:1px solid #2A2C37;border-radius:12px;background:#111218}
.lg{font-size:12px;letter-spacing:.2em;color:#6E6A78;font-weight:600}h1{font-size:28px;line-height:1.15;margin:12px 0 10px;font-weight:600}
p{color:#B9B4C2;margin:0 0 20px}b{color:#E8E4EE;font-weight:600}
input{width:100%;font:600 30px ui-monospace,Menlo,Consolas,monospace;letter-spacing:.3em;text-align:center;text-transform:uppercase;padding:14px;border:1px solid #3A3D4C;border-radius:8px;background:#0B0C10;color:#F2A65A;margin-bottom:18px}
input:focus{outline:2px solid #F2A65A;outline-offset:2px}
button{font:600 15px system-ui,sans-serif;letter-spacing:.12em;padding:14px 26px;border:0;border-radius:8px;background:#F2A65A;color:#0B0C10;cursor:pointer;width:100%}
.err{color:#FF6F59;background:rgba(255,111,89,.08);border:1px solid rgba(255,111,89,.35);border-radius:8px;padding:10px 12px;margin-bottom:16px;font-size:14px}
.fine{font-size:13px;color:#6E6A78;margin:18px 0 0}`;

function authPage(p, error) {
  const hidden = ['response_type', 'client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'scope', 'resource']
    .filter((k) => p.get(k) != null).map((k) => `<input type="hidden" name="${k}" value="${esc(p.get(k))}">`).join('');
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pair Claude with Command Deck</title><style>${PAGE_CSS}</style></head>
<body><main><div class="lg">COMMAND DECK</div><h1>Pair Claude with your deck</h1>
<p>On the deck, open <b>Settings › Field Unit › SHOW PAIRING CODE</b> and type the code here.</p>
${error ? `<div class="err" role="alert">${esc(error)}</div>` : ''}
<form method="post" action="/authorize">${hidden}<input type="hidden" name="tz" id="tz" value="">
<label for="code" class="lg" style="display:block;margin-bottom:8px">PAIRING CODE</label>
<input id="code" name="code" maxlength="8" autocomplete="off" spellcheck="false" autofocus placeholder="ABC-123" required>
<button type="submit">PAIR CLAUDE</button></form>
<p class="fine">Claude gets the same access as a paired phone: tasks, schedule, notes and events on this deck. It shows up under Paired Devices, where UNPAIR cuts it off at once.</p>
</main><script>try{document.getElementById('tz').value=Intl.DateTimeFormat().resolvedOptions().timeZone||''}catch(e){}</script></body></html>`,
  { status: error ? 400 : 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self' https:; frame-ancestors 'none'" } });
}

async function authorize(env, req) {
  if (req.method === 'GET') {
    const p = new URL(req.url).searchParams;
    const chk = await checkAuthParams(env, p);
    if (typeof chk === 'string') return new Response(chk, { status: 400 });
    return authPage(p);
  }
  const form = await req.formData();
  const p = new URLSearchParams();
  for (const [k, v] of form.entries()) p.set(k, String(v));
  const chk = await checkAuthParams(env, p);
  if (typeof chk === 'string') return new Response(chk, { status: 400 });
  let sess;
  try { sess = await pairWithCode(env, p.get('code'), p.get('tz')); }
  catch (e) { return authPage(p, e instanceof UserError ? e.message : `Something went wrong: ${e.message}`); }
  const code = await seal(env, { t: 'a', s: sess, cid: p.get('client_id'), ru: chk.ru, cc: p.get('code_challenge'), exp: Date.now() + 5 * 60e3 });
  const to = new URL(chk.ru);
  to.searchParams.set('code', code);
  if (p.get('state') != null) to.searchParams.set('state', p.get('state'));
  return new Response(null, { status: 302, headers: { location: to.toString(), 'cache-control': 'no-store' } });
}

const ACCESS_SECONDS = 24 * 3600;
async function issue(env, sess, cid) {
  return {
    access_token: await seal(env, { t: 'x', s: sess, exp: Date.now() + ACCESS_SECONDS * 1000 }),
    token_type: 'Bearer', expires_in: ACCESS_SECONDS, scope: SCOPE,
    refresh_token: await seal(env, { t: 'r', s: sess, cid })
  };
}

async function token(env, req) {
  const ct = req.headers.get('content-type') || '';
  const p = ct.includes('json') ? new URLSearchParams(await req.json().catch(() => ({}))) : new URLSearchParams(await req.text());
  const bad = (error, error_description) => json({ error, error_description }, 400);
  const gt = p.get('grant_type');
  if (gt === 'authorization_code') {
    const c = await unseal(env, p.get('code'));
    if (!c || c.t !== 'a') return bad('invalid_grant', 'Code expired. Connect again.');
    if (p.get('client_id') && p.get('client_id') !== c.cid) return bad('invalid_grant', 'client_id mismatch');
    if (p.get('redirect_uri') && p.get('redirect_uri') !== c.ru) return bad('invalid_grant', 'redirect_uri mismatch');
    if (!p.get('code_verifier') || await sha256b64u(p.get('code_verifier')) !== c.cc) return bad('invalid_grant', 'PKCE check failed');
    return json(await issue(env, c.s, c.cid));
  }
  if (gt === 'refresh_token') {
    const r = await unseal(env, p.get('refresh_token'));
    if (!r || r.t !== 'r') return bad('invalid_grant', 'Refresh token not valid. Connect again.');
    return json(await issue(env, r.s, r.cid));
  }
  return bad('unsupported_grant_type', 'Use authorization_code or refresh_token.');
}

// ---------------------------------------------------------------- router
export default {
  async fetch(req, env) {
    env = { FIREBASE_PROJECT: 'command-deck-c3000', ...env };
    const url = new URL(req.url);
    const origin = url.origin;
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    try {
      if (url.pathname === '/.well-known/oauth-authorization-server' || url.pathname.startsWith('/.well-known/openid-configuration')) return json(metadata(origin));
      if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) return json({ resource: `${origin}/mcp`, authorization_servers: [origin], scopes_supported: [SCOPE], bearer_methods_supported: ['header'], resource_name: 'Command Deck' });
      if (url.pathname === '/register' && req.method === 'POST') return await register(env, req);
      if (url.pathname === '/authorize') return await authorize(env, req);
      if (url.pathname === '/token' && req.method === 'POST') return await token(env, req);
      if (url.pathname === '/mcp' || url.pathname === '/') {
        if (url.pathname === '/' && req.method === 'GET') return new Response(`Command Deck connector ${VERSION}. Add ${origin}/mcp to Claude as a custom connector.`, { headers: { 'content-type': 'text/plain' } });
        return await mcp(env, req, origin);
      }
      return new Response('Not found', { status: 404 });
    } catch (e) {
      return json({ error: 'server_error', error_description: e.message }, 500);
    }
  }
};
