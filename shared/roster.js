// Schedule sharing: one shared schedule, opened by secret links.
//
// Firestore layout (outside the private deck):
//   rosters/{token}              one person's link: deck, their name, color, level ('read' | 'add'),
//                                end rule, and the owner's name, look, chip and type chips
//   rosters/{token}/entries/{id} a copy of every schedule entry everyone sees, each labeled with
//                                who added it (byName, byColor; byToken only on that person's own)
//
// Everyone with a link sees the same schedule. A person whose link is READ + ADD can add their own
// entries, and edit or delete the ones they added: they write into their own link (pending: true).
// Whichever of the owner's apps is online (Command Deck or Field Unit) runs this relay: it brings
// those changes into the real schedule, then copies the schedule back out to every live link.

import { makeToken, expiryMs } from './manifest.js';

export { makeToken };

export const DEFAULT_TYPES = [
  { id: 'appt', name: 'Appointment', short: 'APPT', color: '#A8B0D8' },
  { id: 'ldc', name: 'LDC', short: 'LDC', color: '#F2A65A' },
  { id: 'metro', name: 'Metro', short: 'METRO', color: '#7FD1C7' },
  { id: 'other', name: 'Other', short: 'OTHER', color: '#B5B0BC' }
];

export const TYPE_COLORS = ['#F2A65A', '#7FD1C7', '#A8B0D8', '#B8E27A', '#FF8A73', '#E3B5D9', '#F2D06B', '#8FC8FF', '#B5B0BC'];

/** How long a link lasts. */
export const ENDS = { week: 7, month: 30, never: 0 };

const clean = (v) => JSON.parse(JSON.stringify(v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- dates: entries carry a plain calendar date, 'YYYY-MM-DD' ------------------------------
export function ymd(d) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
export function parseYmd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
/** Monday of the week that holds `d`. */
export function weekStart(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
export function addDays(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
/** "THIS WEEK · OCT 19 – 25", "NEXT WEEK · OCT 26 – NOV 1", "WEEK OF NOV 2 – 8". */
export function weekLabel(start, today = new Date()) {
  const end = addDays(start, 6);
  const range = start.getMonth() === end.getMonth()
    ? `${MON[start.getMonth()]} ${start.getDate()} – ${end.getDate()}`
    : `${MON[start.getMonth()]} ${start.getDate()} – ${MON[end.getMonth()]} ${end.getDate()}`;
  const diff = Math.round((start - weekStart(today)) / (7 * 864e5));
  const lead = diff === 0 ? 'THIS WEEK' : diff === 1 ? 'NEXT WEEK' : diff === -1 ? 'LAST WEEK' : 'WEEK OF';
  return `${lead} · ${range}`;
}
/** "TODAY · TUE OCT 20", "WED OCT 21". */
export function dayLabel(d, today = new Date()) {
  const base = `${DOW[d.getDay()]} ${MON[d.getMonth()]} ${d.getDate()}`;
  return ymd(d) === ymd(today) ? `TODAY · ${base}` : ymd(d) === ymd(addDays(today, 1)) ? `TOMORROW · ${base}` : base;
}
/** Entries of one week, grouped by day in date order: [{ date, label, items }]. */
export function weekDays(entries, start, today = new Date()) {
  const from = ymd(start);
  const to = ymd(addDays(start, 6));
  const days = new Map();
  entries.filter((e) => e && e.date >= from && e.date <= to)
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : (a.start || '99') !== (b.start || '99') ? ((a.start || '99') < (b.start || '99') ? -1 : 1) : (a.createdAt || 0) - (b.createdAt || 0)))
    .forEach((e) => {
      if (!days.has(e.date)) days.set(e.date, []);
      days.get(e.date).push(e);
    });
  return [...days.entries()].map(([date, items]) => ({ date, label: dayLabel(parseYmd(date), today), items }));
}

/** 'HH:MM' (24h) or '' → '9:00 AM' / '09:00'. */
export function fmtTime(t, clock24 = false) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ''));
  if (!m) return '';
  const h = Number(m[1]);
  if (clock24) return `${String(h).padStart(2, '0')}:${m[2]}`;
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}
/** Optional start/end → "9:00 AM – 2:00 PM", "9:00 AM", "Until 2:00 PM" or ''. */
export function timeRange(start, end, clock24 = false) {
  const a = fmtTime(start, clock24);
  const b = fmtTime(end, clock24);
  return a && b ? `${a} – ${b}` : a || (b ? `Until ${b}` : '');
}
/** Normalize a typed time ("9", "9:30", "930", "9:30 pm", "14:00") to 'HH:MM', or '' if blank/unreadable. */
export function parseTime(v) {
  const s = String(v || '').trim().toLowerCase().replace(/\./g, '');
  if (!s) return '';
  const m = /^(\d{1,2})(?::?(\d{2}))?\s*(am|pm|a|p)?$/.exec(s);
  if (!m) return '';
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  const ap = m[3] ? m[3][0] : '';
  if (min > 59 || h > 23 || (ap && (h < 1 || h > 12))) return '';
  if (ap === 'p' && h < 12) h += 12;
  if (ap === 'a' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export function typeOf(types, id) {
  return (types || []).find((t) => t.id === id) || (types || []).find((t) => t.id === 'other') || DEFAULT_TYPES[3];
}

/** Short chip label for a new type name ("Training" → "TRAINING", max 10). */
export function shortName(name) {
  return String(name || '').trim().toUpperCase().slice(0, 10) || 'TYPE';
}

/** Colors for people's name chips (the owner picks one per link, and one for themself). */
export const PERSON_COLORS = ['#B8E27A', '#7FD1C7', '#A8B0D8', '#D9A9C6', '#F4B6A0', '#E8D58B', '#FF8A78', '#8EC5FF'];
export const OWNER_COLOR = '#F4B6A0';
export const LEVELS = ['read', 'add'];
/** A short label for a name chip: "Jordan" → "JORDAN" (max 10). */
export function chipName(name) {
  return String(name || '').trim().toUpperCase().slice(0, 10) || 'GUEST';
}
function levelOf(m) { return m && m.level === 'add' ? 'add' : 'read'; }
const HEX = /^#[0-9A-Fa-f]{6}$/;
const goodColor = (c, fallback) => (HEX.test(String(c || '')) ? String(c) : fallback);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

/**
 * What a link sees of an entry. Entries carry who added them: `by` is null for the owner's own,
 * or { token, name, color } for someone's link. The token is only shown back to that same person
 * (byToken), so links never learn each other's keys.
 */
export function mirrorOf(e, token = '', owner = null, people = {}) {
  const tok = e.addedBy && e.addedBy.token;
  const p = tok ? people[tok] : null;
  return clean({
    id: e.id,
    type: e.type || 'other',
    title: e.title || '',
    date: e.date || null,
    start: e.start || '',
    end: e.end || '',
    note: e.note || '',
    byName: tok ? chipName((p && p.name) || e.addedBy.name) : chipName((owner && owner.name) || ''),
    byColor: tok ? goodColor((p && p.color) || e.addedBy.color, '#B5B0BC') : goodColor(owner && owner.color, OWNER_COLOR),
    byToken: tok && tok === token ? tok : '',
    pending: false
  });
}

/** A guest's entry as written into their link, checked and trimmed. Null if it isn't usable. */
export function guestEntry(g, types = DEFAULT_TYPES) {
  if (!g || typeof g !== 'object') return null;
  const title = String(g.title || '').trim().slice(0, 120);
  const date = String(g.date || '');
  if (!title || !DATE.test(date)) return null;
  const start = TIME.test(String(g.start || '')) ? g.start : '';
  const end = TIME.test(String(g.end || '')) ? g.end : '';
  const type = (types || []).some((t) => t.id === g.type) ? g.type : 'other';
  return { type, title, date, start, end, note: String(g.note || '').trim().slice(0, 300) };
}

/** A link's copy of an entry in the same shape mirrorOf writes, for comparing. */
function mirrorShape(c, id) {
  return clean({ id, type: c.type || 'other', title: c.title || '', date: c.date || null, start: c.start || '', end: c.end || '', note: c.note || '',
    byName: c.byName || '', byColor: c.byColor || '', byToken: c.byToken || '', pending: !!c.pending });
}

function isLive(m, now = Date.now()) {
  if (!m || m.closed) return false;
  const exp = expiryMs(m.expiresAt);
  return !exp || exp > now;
}

/** Entries a link carries: from last week on, up to about four months ahead. */
function inWindow(e, now = new Date()) {
  if (!e || !e.date) return false;
  return e.date >= ymd(addDays(weekStart(now), -7)) && e.date <= ymd(addDays(now, 120));
}

export class RosterRelay {
  /**
   * hooks:
   *   getEntries()              the current schedule list
   *   getTypes()                [{ id, name, short, color }]
   *   applyGuestChanges(list)   [{ kind: 'add' | 'edit' | 'delete', entry, token }] → the real schedule
   *   onActivity(events)        [{ token, guest, text, kind }] for a log line / toast
   *   getLook(), operatorName(), ownerChip() → { name, color }
   */
  constructor(fb, db, deckId, uid, hooks) {
    this.fb = fb;
    this.db = db;
    this.deckId = deckId;
    this.uid = uid;
    this.h = hooks;
    this.rosters = new Map();
    this.subs = new Map(); // token -> { entries: Map, unsub, ready }
    this.unsub = null;
    this.timer = null;
    this.seen = new Set();
    this.listeners = new Set();
  }

  ref(...p) { return this.fb.doc(this.db, 'rosters', ...p); }
  col(...p) { return this.fb.collection(this.db, 'rosters', ...p); }

  start() {
    const q = this.fb.query(this.col(), this.fb.where('deckId', '==', this.deckId));
    this.unsub = this.fb.onSnapshot(q, (snap) => {
      const next = new Map();
      snap.forEach((d) => next.set(d.id, { token: d.id, ...d.data() }));
      for (const token of this.subs.keys()) if (!next.has(token) || !isLive(next.get(token))) this.unwatch(token);
      this.rosters = next;
      for (const [token, m] of next) if (isLive(m) && !this.subs.has(token)) this.watch(token);
      this.schedule();
      this.emit();
    }, () => {});
  }

  stop() {
    if (this.unsub) this.unsub();
    this.unsub = null;
    for (const token of [...this.subs.keys()]) this.unwatch(token);
    clearTimeout(this.timer);
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { [...this.listeners].forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }); }

  watch(token) {
    const s = { entries: new Map(), unsub: null, ready: false };
    this.subs.set(token, s);
    s.unsub = this.fb.onSnapshot(this.col(token, 'entries'), (snap) => {
      s.entries = new Map();
      snap.forEach((d) => s.entries.set(d.id, d.data()));
      s.ready = true;
      this.inbound(token);
      this.emit();
    }, () => {});
  }

  unwatch(token) {
    const s = this.subs.get(token);
    if (s && s.unsub) s.unsub();
    this.subs.delete(token);
  }

  /** People's live links: token → { name, color, level }. */
  people() {
    const out = {};
    for (const [token, m] of this.rosters) if (isLive(m)) out[token] = { name: m.guest, color: m.color || '', level: levelOf(m) };
    return out;
  }

  owner() {
    const c = this.h.ownerChip ? this.h.ownerChip() : null;
    return { name: (c && c.name) || (this.h.operatorName ? this.h.operatorName() : '') || 'Owner', color: goodColor(c && c.color, OWNER_COLOR) };
  }

  /** What people added, edited or deleted on their links → the real schedule. */
  inbound(token) {
    const m = this.rosters.get(token);
    const s = this.subs.get(token);
    if (!m || !s || !isLive(m)) return;
    const entries = new Map(this.h.getEntries().map((e) => [e.id, e]));
    const types = this.h.getTypes() || DEFAULT_TYPES;
    const changes = [];
    const activity = [];
    const by = { token, name: String(m.guest || 'Guest').slice(0, 40), color: goodColor(m.color, '#B5B0BC') };
    for (const [id, g] of s.entries) {
      if (!g || !g.pending) continue;
      const key = `${token}:${id}:${g.gAt || 0}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      // Only their own entries, and only on a READ + ADD link. Everything else is left alone,
      // and the next copy-out puts the true version back on their link.
      if (g.byToken !== token || levelOf(m) !== 'add') continue;
      const main = entries.get(id);
      if (main && !(main.addedBy && main.addedBy.token === token)) continue;
      const when = (date) => (date ? dayLabel(parseYmd(date)).replace(/^(TODAY|TOMORROW) · /, '').toLowerCase().replace(/(^| )\w/g, (c) => c.toUpperCase()) : '');
      if (g.deleted) {
        if (main) {
          changes.push({ kind: 'delete', entry: main, token });
          activity.push({ kind: 'delete', text: `${by.name} removed ${main.title}${main.date ? ` (${when(main.date)})` : ''}` });
        }
        continue;
      }
      const e = guestEntry(g, types);
      if (!e) continue;
      if (!main) {
        changes.push({ kind: 'add', entry: { id, ...e, addedBy: by, createdAt: g.gAt || Date.now() }, token });
        activity.push({ kind: 'add', text: `${by.name} added ${e.title}${` (${when(e.date)})`}` });
      } else if (!same(guestEntry(main, types), e)) {
        changes.push({ kind: 'edit', entry: { ...main, ...e, addedBy: by }, token });
        activity.push({ kind: 'edit', text: `${by.name} changed ${e.title}${` (${when(e.date)})`}` });
      }
    }
    if (changes.length) {
      this.h.applyGuestChanges(changes);
      const lastAt = Math.max(...[...s.entries.values()].map((g) => (g && g.byToken === token && g.gAt) || 0));
      if (lastAt > (m.lastAt || 0)) { m.lastAt = lastAt; this.fb.setDoc(this.ref(token), { lastAt }, { merge: true }).catch(() => {}); }
    }
    if (activity.length && this.h.onActivity) this.h.onActivity(activity.map((a) => ({ token, guest: m.guest, text: a.text, kind: a.kind })));
    this.schedule(50);
  }

  schedule(ms = 400) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.sync().catch((e) => console.warn('schedule sync', e)), ms);
  }

  header() {
    return clean({
      types: (this.h.getTypes() || DEFAULT_TYPES).map((t) => ({ id: t.id, short: t.short || shortName(t.name), color: t.color })),
      look: this.h.getLook ? this.h.getLook() : null,
      owner: this.h.operatorName ? this.h.operatorName() : '',
      ownerChip: this.owner()
    });
  }

  /** The real schedule → every live link. */
  async sync() {
    const entries = this.h.getEntries().filter((e) => inWindow(e));
    const header = this.header();
    const owner = this.owner();
    const people = this.people();
    for (const [token, m] of this.rosters) {
      if (!isLive(m)) continue;
      if (!same(header, { types: m.types, look: m.look || null, owner: m.owner || '', ownerChip: m.ownerChip || null })) {
        await this.fb.setDoc(this.ref(token), header, { merge: true }).catch(() => {});
      }
      const s = this.subs.get(token);
      if (!s || !s.ready) continue;
      const want = new Map(entries.map((e) => [e.id, mirrorOf(e, token, owner, people)]));
      const batch = this.fb.writeBatch(this.db);
      let n = 0;
      for (const [id, data] of want) {
        const cur = s.entries.get(id);
        if (cur && cur.pending && !this.seen.has(`${token}:${id}:${cur.gAt || 0}`)) continue; // not handled yet
        if (!cur || cur.pending || !same(mirrorShape(cur, id), data)) {
          batch.set(this.ref(token, 'entries', id), data); n++;
        }
      }
      for (const [id, cur] of s.entries) {
        if (want.has(id)) continue;
        if (cur && cur.pending && !this.seen.has(`${token}:${id}:${cur.gAt || 0}`)) continue;
        batch.delete(this.ref(token, 'entries', id));
        n++;
      }
      if (n) await batch.commit().catch(() => {});
    }
  }

  /** Creates a link. Returns its token. */
  async share({ guest, ends = 'month', level = 'read', color = '' }) {
    const token = makeToken();
    const now = Date.now();
    const days = ENDS[ends] !== undefined ? ENDS[ends] : ENDS.month;
    const used = new Set(Object.values(this.people()).map((p) => p.color).concat(this.owner().color));
    const pick = goodColor(color, PERSON_COLORS.find((c) => !used.has(c)) || PERSON_COLORS[0]);
    // expiresAt is added after clean(): a real Timestamp must reach Firestore (the rules compare it).
    await this.fb.setDoc(this.ref(token), { ...clean({
      deckId: this.deckId, guest: String(guest || 'Guest').trim().slice(0, 40) || 'Guest',
      ends: ENDS[ends] !== undefined ? ends : 'month',
      level: LEVELS.includes(level) ? level : 'read', color: pick,
      closed: false, createdAt: now, createdBy: this.uid,
      ...this.header()
    }), expiresAt: days ? this.fb.Timestamp.fromMillis(now + days * 864e5) : null });
    this.rosters.set(token, { token, deckId: this.deckId, guest, level, color: pick, closed: false });
    // Entries are copied out right away so the link works the moment it's opened.
    const owner = this.owner();
    const people = this.people();
    const batch = this.fb.writeBatch(this.db);
    this.h.getEntries().filter((e) => inWindow(e)).forEach((e) => batch.set(this.ref(token, 'entries', e.id), mirrorOf(e, token, owner, people)));
    await batch.commit();
    return token;
  }

  /** READ ONLY ⇄ READ + ADD, without sending a new link. */
  async setLevel(token, level) {
    if (!LEVELS.includes(level)) return;
    await this.fb.setDoc(this.ref(token), { level }, { merge: true });
    const m = this.rosters.get(token);
    if (m) m.level = level;
    this.emit();
  }

  /** A person's chip color; their entries everywhere follow it. */
  async setColor(token, color) {
    if (!HEX.test(String(color || ''))) return;
    await this.fb.setDoc(this.ref(token), { color }, { merge: true });
    const m = this.rosters.get(token);
    if (m) m.color = color;
    this.emit();
    this.schedule(50);
  }

  async close(token, reason = 'stopped') {
    await this.fb.setDoc(this.ref(token), { closed: true, closedReason: reason, closedAt: Date.now() }, { merge: true }).catch(() => {});
  }

  /** STOP: the link stops working at once, and its copy of the schedule is removed. */
  async revoke(token) {
    await this.close(token, 'stopped');
    this.unwatch(token);
    try {
      const snap = await this.fb.getDocs(this.col(token, 'entries'));
      const batch = this.fb.writeBatch(this.db);
      snap.forEach((d) => batch.delete(d.ref));
      batch.delete(this.ref(token));
      await batch.commit();
    } catch (e) { /* the closed flag already blocks the guest */ }
  }

  /** Live links, newest first. */
  list() {
    const out = [];
    for (const [token, m] of this.rosters) {
      if (!isLive(m)) continue;
      const s = this.subs.get(token);
      let last = m.lastAt || 0;
      if (s) s.entries.forEach((e) => { if (e && e.byToken === token && (e.gAt || 0) > last) last = e.gAt; });
      out.push({ token, guest: m.guest, ends: m.ends, level: levelOf(m), color: goodColor(m.color, '#B5B0BC'), createdAt: m.createdAt, lastActive: last || null });
    }
    return out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  /** Guest name for a token. */
  guestOf(token) {
    const m = this.rosters.get(token);
    return m ? m.guest : null;
  }
}

export function scheduleUrl(base, token) {
  return `${String(base || '').replace(/\/+$/, '')}/s/${token}`;
}
