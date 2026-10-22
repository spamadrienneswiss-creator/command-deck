// Project Manifest: share one project with a guest through a secret link.
//
// Firestore layout (outside the private deck):
//   manifests/{token}             the share: deck, project, guest name, access level, end rule,
//                                 plus a read-only copy of the project header and project log
//   manifests/{token}/tasks/{id}  a copy of the project's tasks the guest can see and change
//   manifests/{token}/log/{id}    project-log posts written by the guest
//
// The guest never touches the deck. Whichever of the owner's apps is online (Command Deck or
// Field Unit) runs this relay: it copies the project out to every live manifest, and copies
// guest changes (marked pending: true) back into the real tasks, then clears the mark.

export const LEVELS = {
  check: { name: 'CHECK OFF ONLY', fields: ['done', 'doneAt', 'doneBy'], log: false, add: false },
  notes: { name: 'CHECK OFF + NOTES', fields: ['done', 'doneAt', 'doneBy', 'comments'], log: true, add: false },
  helper: { name: 'PROJECT ADMINISTRATOR', fields: ['done', 'doneAt', 'doneBy', 'comments', 'title', 'due', 'dueHasTime', 'deleted'], log: true, add: true }
};

const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** A long random link key (about 130 bits): unguessable, so it can act as the password. */
export function makeToken() {
  const bytes = new Uint8Array(23);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => TOKEN_ALPHABET[b % TOKEN_ALPHABET.length]).join('');
}

const clean = (v) => JSON.parse(JSON.stringify(v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function mergeComments(a = [], b = []) {
  const map = new Map();
  [...(a || []), ...(b || [])].forEach((c) => { if (c && c.id && !map.has(c.id)) map.set(c.id, c); });
  return [...map.values()].sort((x, y) => (x.at || 0) - (y.at || 0)).slice(-50);
}

/** What a guest may see of one task (never the owner's private notes, reminders or assignee). */
/** Subtasks made before they had ids get a stable one from their position. */
export const subId = (s, i) => (s && s.id) || `s${i}`;

export function mirrorOf(t) {
  return clean({
    id: t.id,
    title: t.title || '',
    due: t.due || null,
    dueHasTime: !!t.dueHasTime,
    done: !!t.done,
    doneAt: t.doneAt || null,
    doneBy: t.doneBy || null,
    addedBy: t.addedBy || null,
    comments: t.comments || [],
    subtasks: (t.subtasks || []).filter((s) => s && String(s.text || '').trim()).map((s, i) => ({ id: subId(s, i), text: String(s.text).slice(0, 200), done: !!s.done })),
    pending: false
  });
}

/** A Firestore Timestamp (or its plain { seconds } form, or millis) → millis. */
export function expiryMs(t) {
  if (!t) return 0;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t === 'number') return t;
  if (typeof t.seconds === 'number') return t.seconds * 1000 + Math.floor((t.nanoseconds || 0) / 1e6);
  if (typeof t.ms === 'number') return t.ms;
  return 0;
}

function isLive(m, now = Date.now()) {
  if (!m || m.closed) return false;
  const exp = expiryMs(m.expiresAt);
  return !exp || exp > now;
}

export class ManifestRelay {
  /**
   * hooks:
   *   getProjects(), getTasks()          current local lists
   *   guestChanges(changes)              apply [{ type, projectId, taskId, task, by }] to the real lists
   *                                      type: add | update | complete | reopen | delete
   *   addLog(projectId, entries)         merge guest log posts into project.log
   *   onActivity(events)                 [{ token, guest, text }] for a log line / toast
   *   getLook()                          { theme, font, ink } so the guest page matches
   *   operatorName()
   */
  constructor(fb, db, deckId, uid, hooks) {
    this.fb = fb;
    this.db = db;
    this.deckId = deckId;
    this.uid = uid;
    this.h = hooks;
    this.manifests = new Map(); // token -> data
    this.subs = new Map(); // token -> { tasks: Map(id -> data), log: Map, unsubs: [] }
    this.unsub = null;
    this.timer = null;
    this.seen = new Set(); // guest writes already handled: `${token}:${id}:${gAt}`
    this.listeners = new Set();
    this.firstRun = true;
  }

  ref(...p) { return this.fb.doc(this.db, 'manifests', ...p); }
  col(...p) { return this.fb.collection(this.db, 'manifests', ...p); }

  start() {
    const q = this.fb.query(this.col(), this.fb.where('deckId', '==', this.deckId));
    this.unsub = this.fb.onSnapshot(q, (snap) => {
      const next = new Map();
      snap.forEach((d) => next.set(d.id, { token: d.id, ...d.data() }));
      for (const token of this.subs.keys()) if (!next.has(token) || !isLive(next.get(token))) this.unwatch(token);
      this.manifests = next;
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
    const s = { tasks: new Map(), log: new Map(), unsubs: [], ready: false };
    this.subs.set(token, s);
    s.unsubs.push(this.fb.onSnapshot(this.col(token, 'tasks'), (snap) => {
      s.tasks = new Map();
      snap.forEach((d) => s.tasks.set(d.id, d.data()));
      s.ready = true;
      this.inbound(token);
    }, () => {}));
    s.unsubs.push(this.fb.onSnapshot(this.col(token, 'log'), (snap) => {
      s.log = new Map();
      snap.forEach((d) => s.log.set(d.id, d.data()));
      this.inboundLog(token);
    }, () => {}));
  }

  unwatch(token) {
    const s = this.subs.get(token);
    if (s) s.unsubs.forEach((u) => u());
    this.subs.delete(token);
  }

  /** Guest changes → the real tasks. */
  inbound(token) {
    const m = this.manifests.get(token);
    const s = this.subs.get(token);
    if (!m || !s || !isLive(m)) return;
    const level = LEVELS[m.level] || LEVELS.check;
    const tasks = new Map(this.h.getTasks().map((t) => [t.id, t]));
    const changes = [];
    const activity = [];
    for (const [id, g] of s.tasks) {
      if (!g || !g.pending) continue;
      const key = `${token}:${id}:${g.gAt || 0}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      const by = String(g.gBy || m.guest || 'Guest').slice(0, 40);
      const main = tasks.get(id);
      if (main && main.projectId !== m.projectId) continue; // never reach outside the shared project
      if (g.deleted) {
        if (main && level.add) { changes.push({ type: 'delete', projectId: m.projectId, taskId: id, by }); activity.push(`${by} deleted ${main.title}`); }
        continue;
      }
      if (!main) {
        if (!level.add || !g.title) continue;
        const task = {
          id, title: String(g.title).slice(0, 200), due: g.due || null, dueHasTime: !!g.dueHasTime,
          done: !!g.done, doneAt: g.done ? (g.doneAt || new Date().toISOString()) : null, doneBy: g.done ? by : null,
          comments: mergeComments([], g.comments), addedBy: by, projectId: m.projectId
        };
        changes.push({ type: 'add', projectId: m.projectId, taskId: id, task, by });
        activity.push(`${by} added ${task.title}`);
        continue;
      }
      const patch = {};
      for (const f of level.fields) {
        if (f === 'deleted' || f === 'done' || f === 'doneAt' || f === 'doneBy') continue;
        if (f === 'comments') {
          const merged = mergeComments(main.comments, g.comments);
          if (!same(merged, main.comments || [])) {
            patch.comments = merged;
            const fresh = merged.filter((c) => !(main.comments || []).some((x) => x.id === c.id));
            fresh.forEach((c) => activity.push(`${c.by || by} noted on ${main.title}: ${c.text}`));
          }
        } else if (g[f] !== undefined && !same(g[f], main[f])) patch[f] = g[f];
      }
      if (patch.title) patch.title = String(patch.title).slice(0, 200);
      // Subtasks: guests at every level can tick them. Only the ticks come back; the text is always ours.
      if (Array.isArray(g.subtasks) && Array.isArray(main.subtasks) && main.subtasks.length) {
        const ticks = new Map(g.subtasks.filter((x) => x && x.id).map((x) => [x.id, !!x.done]));
        let changed = false;
        const next = main.subtasks.map((st, i) => {
          const id = subId(st, i);
          if (!ticks.has(id) || ticks.get(id) === !!st.done) return st;
          changed = true;
          activity.push(`${by} ${ticks.get(id) ? 'checked off' : 'unchecked'} ${st.text} (${main.title})`);
          return { ...st, done: ticks.get(id) };
        });
        if (changed) patch.subtasks = next;
      }
      if (Object.keys(patch).length) changes.push({ type: 'update', projectId: m.projectId, taskId: id, task: patch, by });
      if (!!g.done !== !!main.done) {
        changes.push({ type: g.done ? 'complete' : 'reopen', projectId: m.projectId, taskId: id, by });
        activity.push(g.done ? `${by} completed ${main.title}` : `${by} reopened ${main.title}`);
      }
    }
    if (changes.length) this.h.guestChanges(changes);
    if (activity.length) this.h.onActivity(activity.map((text) => ({ token, guest: m.guest, project: (m.project || {}).name, text })));
    this.schedule(50);
  }

  /** Guest log posts → project.log. */
  inboundLog(token) {
    const m = this.manifests.get(token);
    const s = this.subs.get(token);
    if (!m || !s || !isLive(m) || !LEVELS[m.level] || !LEVELS[m.level].log) return;
    const p = this.h.getProjects().find((x) => x.id === m.projectId);
    if (!p) return;
    const have = new Set((p.log || []).map((e) => e.id));
    const fresh = [...s.log.values()].filter((e) => e && e.id && e.text && !have.has(e.id))
      .map((e) => ({ id: e.id, by: String(e.by || m.guest || 'Guest').slice(0, 40), text: String(e.text).slice(0, 1000), at: e.at || Date.now() }));
    if (!fresh.length) return;
    this.h.addLog(m.projectId, fresh);
    this.h.onActivity(fresh.map((e) => ({ token, guest: m.guest, project: p.name, text: `${e.by} posted to ${p.name}: ${e.text}` })));
    this.schedule(50);
  }

  schedule(ms = 400) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.sync().catch((e) => console.warn('manifest sync', e)), ms);
  }

  /** The real project → every live manifest that shares it. */
  async sync() {
    const projects = this.h.getProjects();
    const tasks = this.h.getTasks();
    const look = this.h.getLook ? this.h.getLook() : null;
    const owner = this.h.operatorName ? this.h.operatorName() : '';
    for (const [token, m] of this.manifests) {
      if (!isLive(m)) continue;
      const p = projects.find((x) => x.id === m.projectId);
      if (!p) { await this.close(token, 'deleted'); continue; }
      if (m.ends === 'done' && p.status === 'done') { await this.close(token, 'done'); continue; }
      const header = clean({
        project: { name: p.name, goal: p.goal || '', due: p.due || null, color: p.color || null, status: p.status || 'active' },
        log: (p.log || []).slice(-100),
        look: look || null,
        owner: owner || ''
      });
      if (!same(header, { project: m.project, log: m.log, look: m.look || null, owner: m.owner || '' })) {
        await this.fb.setDoc(this.ref(token), header, { merge: true }).catch(() => {});
      }
      const s = this.subs.get(token);
      if (!s || !s.ready) continue;
      const want = new Map(tasks.filter((t) => t.projectId === m.projectId).map((t) => [t.id, mirrorOf(t)]));
      const batch = this.fb.writeBatch(this.db);
      let n = 0;
      for (const [id, data] of want) {
        const cur = s.tasks.get(id);
        if (cur && cur.pending && !this.seen.has(`${token}:${id}:${cur.gAt || 0}`)) continue; // not handled yet
        const curCmp = cur ? mirrorOf({ ...cur, id }) : null;
        if (!cur || cur.pending || cur.deleted || !same(curCmp, data)) { batch.set(this.ref(token, 'tasks', id), data); n++; }
      }
      for (const [id, cur] of s.tasks) {
        if (want.has(id)) continue;
        if (cur && cur.pending && !this.seen.has(`${token}:${id}:${cur.gAt || 0}`)) continue;
        batch.delete(this.ref(token, 'tasks', id));
        n++;
      }
      if (n) await batch.commit().catch(() => {});
    }
    if (this.firstRun) this.firstRun = false;
  }

  /** Creates a share. Returns its token. */
  async share({ projectId, guest, level = 'notes', ends = 'done' }) {
    const token = makeToken();
    const now = Date.now();
    const p = this.h.getProjects().find((x) => x.id === projectId);
    // expiresAt is added after clean(): a real Timestamp must reach Firestore (the rules compare it).
    await this.fb.setDoc(this.ref(token), { ...clean({
      deckId: this.deckId, projectId, guest: String(guest || 'Guest').trim().slice(0, 40) || 'Guest',
      level: LEVELS[level] ? level : 'notes', ends,
      closed: false, createdAt: now, createdBy: this.uid,
      project: p ? { name: p.name, goal: p.goal || '', due: p.due || null, color: p.color || null, status: p.status || 'active' } : null,
      log: p ? (p.log || []).slice(-100) : [],
      look: this.h.getLook ? this.h.getLook() : null,
      owner: this.h.operatorName ? this.h.operatorName() : ''
    }), expiresAt: ends === 'week' ? this.fb.Timestamp.fromMillis(now + 7 * 864e5) : null });
    // Tasks are copied out right away so the link works the moment it's opened.
    const batch = this.fb.writeBatch(this.db);
    this.h.getTasks().filter((t) => t.projectId === projectId).forEach((t) => batch.set(this.ref(token, 'tasks', t.id), mirrorOf(t)));
    await batch.commit();
    return token;
  }

  async setLevel(token, level) {
    if (!LEVELS[level]) return;
    await this.fb.setDoc(this.ref(token), { level }, { merge: true });
  }

  async close(token, reason = 'stopped') {
    await this.fb.setDoc(this.ref(token), { closed: true, closedReason: reason, closedAt: Date.now() }, { merge: true }).catch(() => {});
  }

  /** STOP: the link stops working at once, and its copy of the project is removed. */
  async revoke(token) {
    await this.close(token, 'stopped');
    const s = this.subs.get(token);
    this.unwatch(token);
    try {
      const snaps = await Promise.all([this.fb.getDocs(this.col(token, 'tasks')), this.fb.getDocs(this.col(token, 'log'))]);
      const batch = this.fb.writeBatch(this.db);
      snaps.forEach((snap) => snap.forEach((d) => batch.delete(d.ref)));
      batch.delete(this.ref(token));
      await batch.commit();
    } catch (e) { /* the closed flag already blocks the guest */ }
    void s;
  }

  /** Live shares of one project, newest first, with the guest's last activity. */
  forProject(projectId) {
    const out = [];
    for (const [token, m] of this.manifests) {
      if (m.projectId !== projectId || !isLive(m)) continue;
      const s = this.subs.get(token);
      let last = 0;
      if (s) {
        s.tasks.forEach((t) => { if (t && t.gAt > last) last = t.gAt; });
        s.log.forEach((e) => { if (e && e.at > last) last = e.at; });
      }
      out.push({ token, guest: m.guest, level: m.level, ends: m.ends, createdAt: m.createdAt, lastActive: last || null });
    }
    return out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }
}

export function manifestUrl(base, token) {
  return `${String(base || '').replace(/\/+$/, '')}/m#${token}`;
}
