// The terminal AI's memory (v1.34), shared by the deck and Field Unit through decks/{id}/meta/ai.
// One running conversation and a list of things it was told to keep. Either side can add to it
// while the other is offline; merge() puts the two back together without losing anything.
//
// State: {
//   chat:   [{ id, role: 'user' | 'model', text, at }]   the conversation, oldest first (last 60)
//   memory: [{ id, t, at }]                               remembered lines (up to 150)
//   removed: [id]                                         memories that were forgotten (so they stay gone)
//   chatClearedAt, memClearedAt                           "clear chat" / "forget everything" (ISO times)
// }

export const CHAT_KEEP = 60;
export const MEMORY_KEEP = 150;
const REMOVED_KEEP = 400;

export const emptyAi = () => ({ chat: [], memory: [], removed: [], chatClearedAt: '', memClearedAt: '' });

const rid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const later = (a, b) => (String(a || '') > String(b || '') ? String(a || '') : String(b || ''));

/** Tidy anything loaded from storage or the cloud into a valid state. */
export function normalizeAi(s) {
  const o = s && typeof s === 'object' ? s : {};
  const chat = (Array.isArray(o.chat) ? o.chat : []).filter((m) => m && m.text && m.at)
    .map((m) => ({ id: String(m.id || `${m.at}-${m.role}`), role: m.role === 'model' ? 'model' : 'user', text: String(m.text).slice(0, 3000), at: String(m.at) }));
  const memory = (Array.isArray(o.memory) ? o.memory : []).filter((m) => m && m.t)
    .map((m) => ({ id: String(m.id || `${m.at || ''}-${m.t}`.slice(0, 80)), t: String(m.t).slice(0, 240), at: String(m.at || '') }));
  return {
    chat, memory,
    removed: (Array.isArray(o.removed) ? o.removed : []).map(String).slice(-REMOVED_KEEP),
    chatClearedAt: String(o.chatClearedAt || ''),
    memClearedAt: String(o.memClearedAt || '')
  };
}

/** Both sides' changes together: everything either added, minus what either removed or cleared. */
export function mergeAi(a, b) {
  const x = normalizeAi(a);
  const y = normalizeAi(b);
  const chatClearedAt = later(x.chatClearedAt, y.chatClearedAt);
  const memClearedAt = later(x.memClearedAt, y.memClearedAt);
  const removed = [...new Set([...x.removed, ...y.removed])].slice(-REMOVED_KEEP);
  const gone = new Set(removed);
  const byId = (list) => { const m = new Map(); for (const e of list) if (!m.has(e.id)) m.set(e.id, e); return [...m.values()]; };
  const chat = byId([...x.chat, ...y.chat]).filter((m) => m.at > chatClearedAt).sort((p, q) => (p.at < q.at ? -1 : p.at > q.at ? 1 : 0)).slice(-CHAT_KEEP);
  const seen = new Set();
  const memory = byId([...x.memory, ...y.memory]).filter((m) => !gone.has(m.id) && m.at > memClearedAt)
    .sort((p, q) => (p.at < q.at ? -1 : p.at > q.at ? 1 : 0))
    .filter((m) => { const k = m.t.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(-MEMORY_KEEP);
  return { chat, memory, removed, chatClearedAt, memClearedAt };
}

/** A short fingerprint, to tell whether a merge changed anything. */
export function aiKey(s) {
  const n = normalizeAi(s);
  return `${n.chat.map((m) => m.id).join(',')}|${n.memory.map((m) => m.id).join(',')}|${n.removed.length}|${n.chatClearedAt}|${n.memClearedAt}`;
}

export function addChat(s, role, text) {
  text = String(text || '').trim();
  if (!text) return s;
  const now = new Date().toISOString();
  s.chat.push({ id: rid(), role: role === 'model' ? 'model' : 'user', text: text.slice(0, 3000), at: now });
  if (s.chat.length > CHAT_KEEP) s.chat.splice(0, s.chat.length - CHAT_KEEP);
  return s;
}

const stamp = (at) => {
  const d = new Date(at);
  if (isNaN(d)) return '';
  return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

/** The conversation for Gemini: your lines carry when you said them, so it can run across days. */
export function chatTurns(s, n = 40) {
  return s.chat.slice(-n).map((m) => ({ role: m.role, text: m.role === 'user' ? `[${stamp(m.at)}] ${m.text}` : m.text }));
}

export function memoryLines(s) {
  return s.memory.map((m) => `${m.t}${m.at ? ` (noted ${stamp(m.at).split(',').slice(0, 2).join(',')})` : ''}`);
}

const SECRET = /\b(password|passcode|pin code|card number|account number|routing number|ssn|social security)\b/i;
const bare = (t) => String(t || '').replace(/\s*\(noted [^)]*\)\s*$/, '').trim();

/** What Gemini asked to keep or drop. Returns true if anything changed. */
export function applyMemory(s, g) {
  if (!g) return false;
  let changed = false;
  for (const f of g.forget || []) {
    const key = bare(f).toLowerCase();
    if (!key) continue;
    for (const m of s.memory) {
      const t = m.t.toLowerCase();
      if (t === key || (key.length > 12 && t.includes(key))) { s.removed.push(m.id); changed = true; }
    }
  }
  if (changed) { const gone = new Set(s.removed); s.memory = s.memory.filter((m) => !gone.has(m.id)); }
  for (const r of g.remember || []) {
    const t = bare(r).slice(0, 240);
    if (!t || SECRET.test(t) || s.memory.some((m) => m.t.toLowerCase() === t.toLowerCase())) continue;
    s.memory.push({ id: rid(), t, at: new Date().toISOString() });
    changed = true;
  }
  if (s.memory.length > MEMORY_KEEP) s.memory.splice(0, s.memory.length - MEMORY_KEEP);
  if (s.removed.length > REMOVED_KEEP) s.removed.splice(0, s.removed.length - REMOVED_KEEP);
  return changed;
}

export function forgetOne(s, id) {
  if (!s.memory.some((m) => m.id === id)) return false;
  s.memory = s.memory.filter((m) => m.id !== id);
  s.removed.push(id);
  return true;
}
export function clearChat(s) { s.chat = []; s.chatClearedAt = new Date().toISOString(); }
export function forgetAll(s) { clearChat(s); s.memory = []; s.memClearedAt = s.chatClearedAt; }

// The rules both sides give Gemini for memory, actions and lookups, so they behave alike.
export const AI_RULES = (who) => [
  `You are one ongoing conversation with ${who} that carries across days and across their devices (the PC deck and the phone): the earlier messages are your shared history, so follow up on them, refer back to them and build on them naturally.`,
  'Length: match the question. Quick things get a sentence or two. Questions that need explaining, planning, advice or detail get a proper answer: several sentences, with line breaks between steps or items (plain lines, starting a line with "- " is fine). No markdown symbols like ** or #, no emoji. Replies may be read aloud, so say dates and times the way a person would.',
  `Knowledge: answer general questions from your own knowledge, like any good assistant. For anything about ${who}'s own life (tasks, events, plans, people, notes), rely only on the deck data and memories you are given and never invent details. If you need fresh information from the web, put a search in "lookup".`,
  `Memory: when ${who} tells you something lasting about themselves, their people, preferences, routines or plans, or says "remember", add a short line to "remember" (third person, with the date if it matters). Don't store passing chatter, things already in the deck data, passwords or account numbers. When asked to forget something, or a memory turns out wrong, copy that line into "forget". When asked what you remember, say it plainly.`
];
