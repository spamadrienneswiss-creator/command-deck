// Schedule sharing: send your work shifts and appointments to someone by a secret link.
//
// Firestore layout (outside the private deck):
//   rosters/{token}              the share: deck, guest name, end rule, owner name, look, type chips
//   rosters/{token}/entries/{id} a copy of each schedule entry the guest can see, plus that
//                                guest's own reply: { state: 'ok' | 'change', comment (optional), at }
//
// The guest only ever writes a reply (marked pending: true). Whichever of the owner's apps is
// online (Command Deck or Field Unit) runs this relay: it copies the schedule out to every live
// link, and copies replies back into the real entries (entry.replies[token]), then clears the mark.

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

/** What one guest sees of an entry: no other guests' replies. */
export function mirrorOf(e, token) {
  const r = e.replies && e.replies[token];
  return clean({
    id: e.id,
    type: e.type || 'other',
    title: e.title || '',
    date: e.date || null,
    start: e.start || '',
    end: e.end || '',
    note: e.note || '',
    reply: r ? { state: r.state, comment: r.comment || '', at: r.at || 0 } : null,
    pending: false
  });
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
   *   applyReplies(changes)     [{ entryId, token, reply: { state, comment, at, by } }] → entry.replies[token]
   *   onActivity(events)        [{ token, guest, text, state }] for a log line / toast
   *   getLook(), operatorName()
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

  /** Guest replies → the real entries. */
  inbound(token) {
    const m = this.rosters.get(token);
    const s = this.subs.get(token);
    if (!m || !s || !isLive(m)) return;
    const entries = new Map(this.h.getEntries().map((e) => [e.id, e]));
    const changes = [];
    const activity = [];
    for (const [id, g] of s.entries) {
      if (!g || !g.pending || !g.reply) continue;
      const key = `${token}:${id}:${g.gAt || 0}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      const main = entries.get(id);
      if (!main) continue;
      const state = g.reply.state === 'change' ? 'change' : g.reply.state === 'ok' ? 'ok' : null;
      const comment = String(g.reply.comment || '').trim().slice(0, 500);
      if (!state) continue;
      const by = String(g.gBy || m.guest || 'Guest').slice(0, 40);
      const reply = { state, comment: state === 'change' ? comment : '', at: g.gAt || Date.now(), by };
      const cur = main.replies && main.replies[token];
      if (cur && cur.state === reply.state && (cur.comment || '') === reply.comment) continue;
      changes.push({ entryId: id, token, reply });
      const when = main.date ? dayLabel(parseYmd(main.date)).replace(/^(TODAY|TOMORROW) · /, '').toLowerCase().replace(/(^| )\w/g, (c) => c.toUpperCase()) : '';
      activity.push({ state, text: state === 'ok'
        ? `${by}: got it for ${main.title}${when ? ` (${when})` : ''}`
        : `${by} asked to change ${main.title}${when ? ` (${when})` : ''}${comment ? `: ${comment}` : ' (no note)'}` });
    }
    if (changes.length) this.h.applyReplies(changes);
    if (activity.length) this.h.onActivity(activity.map((a) => ({ token, guest: m.guest, text: a.text, state: a.state })));
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
      owner: this.h.operatorName ? this.h.operatorName() : ''
    });
  }

  /** The real schedule → every live link. */
  async sync() {
    const entries = this.h.getEntries().filter((e) => inWindow(e));
    const header = this.header();
    for (const [token, m] of this.rosters) {
      if (!isLive(m)) continue;
      if (!same(header, { types: m.types, look: m.look || null, owner: m.owner || '' })) {
        await this.fb.setDoc(this.ref(token), header, { merge: true }).catch(() => {});
      }
      const s = this.subs.get(token);
      if (!s || !s.ready) continue;
      const want = new Map(entries.map((e) => [e.id, mirrorOf(e, token)]));
      const batch = this.fb.writeBatch(this.db);
      let n = 0;
      for (const [id, data] of want) {
        const cur = s.entries.get(id);
        if (cur && cur.pending && !this.seen.has(`${token}:${id}:${cur.gAt || 0}`)) continue; // not handled yet
        const curCmp = cur ? mirrorOf({ ...cur, id, replies: cur.reply ? { [token]: cur.reply } : {} }, token) : null;
        if (!cur || cur.pending || !same(curCmp, data)) { batch.set(this.ref(token, 'entries', id), data); n++; }
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
  async share({ guest, ends = 'month' }) {
    const token = makeToken();
    const now = Date.now();
    const days = ENDS[ends] !== undefined ? ENDS[ends] : ENDS.month;
    // expiresAt is added after clean(): a real Timestamp must reach Firestore (the rules compare it).
    await this.fb.setDoc(this.ref(token), { ...clean({
      deckId: this.deckId, guest: String(guest || 'Guest').trim().slice(0, 40) || 'Guest',
      ends: ENDS[ends] !== undefined ? ends : 'month',
      closed: false, createdAt: now, createdBy: this.uid,
      ...this.header()
    }), expiresAt: days ? this.fb.Timestamp.fromMillis(now + days * 864e5) : null });
    // Entries are copied out right away so the link works the moment it's opened.
    const batch = this.fb.writeBatch(this.db);
    this.h.getEntries().filter((e) => inWindow(e)).forEach((e) => batch.set(this.ref(token, 'entries', e.id), mirrorOf(e, token)));
    await batch.commit();
    return token;
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

  /** Live links, newest first, with each guest's last reply. */
  list() {
    const out = [];
    for (const [token, m] of this.rosters) {
      if (!isLive(m)) continue;
      const s = this.subs.get(token);
      let last = 0;
      if (s) s.entries.forEach((e) => { if (e && e.reply && e.reply.at > last) last = e.reply.at; });
      out.push({ token, guest: m.guest, ends: m.ends, createdAt: m.createdAt, lastActive: last || null });
    }
    return out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  /** Guest name for a token (for showing replies). */
  guestOf(token) {
    const m = this.rosters.get(token);
    return m ? m.guest : null;
  }
}

export function scheduleUrl(base, token) {
  return `${String(base || '').replace(/\/+$/, '')}/s/${token}`;
}
