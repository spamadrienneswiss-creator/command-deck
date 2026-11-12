// Data Recap summaries through Google's Gemini API (free key from Google AI Studio).
// Runs in the main process so the key never has to cross into a web page's network stack.
//
// Google renames its models often, so we ask for the "latest Flash" alias first and fall back
// to whatever Flash model the key can see.

const API = 'https://generativelanguage.googleapis.com/v1beta';
const PREFERRED = ['gemini-flash-latest', 'gemini-flash-lite-latest'];
const SUMMARY_MS = 3 * 60 * 1000;

const RECAP_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING', description: 'A short name for the meeting, 2 to 6 words' },
    summary: { type: 'STRING', description: 'Two to four plain sentences: what the meeting covered and what was decided' },
    points: { type: 'ARRAY', items: { type: 'STRING' }, description: 'The main points, each one short line' },
    actions: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Action items or follow-ups, each one short imperative line' }
  },
  required: ['summary', 'points', 'actions']
};

async function call(fetchFn, path, key, body, signal) {
  const res = await fetchFn(`${API}/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: body ? JSON.stringify(body) : undefined,
    signal
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* not JSON */ }
  return { status: res.status, ok: res.ok, json };
}

function friendly(status, json) {
  const msg = (json && json.error && json.error.message) || '';
  if (status === 400 && /api key/i.test(msg)) return 'Gemini rejected the key. Check it in Settings › Field Unit › DATA RECAP.';
  if (status === 401 || status === 403) return 'Gemini rejected the key. Check it in Settings › Field Unit › DATA RECAP.';
  if (status === 429) return 'Gemini\'s free limit is used up for now. Try again later.';
  if (status >= 500) return 'Gemini is having trouble right now. Try again in a bit.';
  return msg || `Gemini error ${status}`;
}

/** Lists the models this key can use for generateContent, best Flash model first. */
async function listModels(key, fetchFn = fetch) {
  const r = await call(fetchFn, 'models?pageSize=200', key);
  if (!r.ok) throw new Error(friendly(r.status, r.json));
  const names = ((r.json && r.json.models) || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => String(m.name || '').replace(/^models\//, ''))
    .filter((n) => /^gemini-/.test(n) && /flash/.test(n) && !/(image|tts|live|audio|thinking-exp|embedding)/.test(n));
  const version = (n) => { const m = n.match(/gemini-(\d+(?:\.\d+)?)/); return m ? Number(m[1]) : 0; };
  return names.sort((a, b) => {
    const lite = Number(/lite/.test(a)) - Number(/lite/.test(b));
    if (lite) return lite; // full Flash before Flash-Lite
    const preview = Number(/preview|exp/.test(a)) - Number(/preview|exp/.test(b));
    if (preview) return preview; // stable before previews
    return version(b) - version(a);
  });
}

function buildPrompt(transcript, opts = {}) {
  const lines = (transcript || []).map((s) => `[${fmt(s.t)}] ${s.text}`).join('\n');
  const want = [];
  if (opts.summary !== false) want.push('a short summary');
  if (opts.points !== false) want.push('the main points');
  if (opts.actions !== false) want.push('the action items');
  return [
    `Below is a machine transcript of a recorded conversation or meeting${opts.title ? ` titled "${opts.title}"` : ''}. There are no speaker labels.`,
    `Write ${want.join(', ') || 'a short summary'} for the person who recorded it.`,
    'Keep it plain and specific: names, dates, numbers and decisions as they were said. Do not invent anything that is not in the transcript.',
    'If there are no clear action items, return an empty list for actions.',
    '',
    'TRANSCRIPT:',
    lines
  ].join('\n');
}

function fmt(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function parseRecap(text) {
  let obj;
  try { obj = JSON.parse(String(text || '').replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch (e) { throw new Error('Gemini sent back something unreadable. Try SUMMARIZE again.'); }
  const strs = (a) => (Array.isArray(a) ? a.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 25) : []);
  return {
    title: String(obj.title || '').trim().slice(0, 80),
    summary: String(obj.summary || '').trim().slice(0, 2000),
    points: strs(obj.points).map((p) => p.slice(0, 300)),
    actions: strs(obj.actions).map((p) => p.slice(0, 200))
  };
}

/**
 * Summarizes a transcript. Returns { model, title, summary, points, actions }.
 * `model` is the one that worked, so the caller can remember it for next time.
 */
async function summarize(opts, fetchFn = fetch) {
  const { key, model, transcript, title, include } = opts || {};
  if (!key) throw new Error('Add a Gemini key in Settings › Field Unit › DATA RECAP to get summaries.');
  if (!transcript || !transcript.length) throw new Error('The recording had no speech to summarize.');
  const body = {
    contents: [{ role: 'user', parts: [{ text: buildPrompt(transcript, { title, ...(include || {}) }) }] }],
    generationConfig: { temperature: 0.3, responseMimeType: 'application/json', responseSchema: RECAP_SCHEMA }
  };
  // v1.28.1: Google's servers sometimes answer "busy" (5xx) or hang. Wait a moment and try
  // again, then try other Flash models, and never wait on one answer longer than SUMMARY_MS.
  const tried = new Set();
  const attempt = async (m) => {
    tried.add(m);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), opts.timeoutMs || SUMMARY_MS);
    try {
      return { m, r: await call(fetchFn, `models/${encodeURIComponent(m)}:generateContent`, key, body, ac.signal) };
    } catch (e) {
      return { m, r: { ok: false, status: 0, json: null, timedOut: ac.signal.aborted } };
    } finally { clearTimeout(timer); }
  };
  const missing = (r) => r.status === 404 || (r.status === 400 && /not found|not supported/i.test(JSON.stringify(r.json || {})));
  const busy = (r) => r.status === 0 || r.status >= 500;
  let { m, r } = await attempt(model || PREFERRED[0]);
  if (!r.ok && busy(r)) {
    await new Promise((ok) => setTimeout(ok, opts.retryMs == null ? 2500 : opts.retryMs));
    ({ m, r } = await attempt(m));
  }
  // The remembered model went away or stays busy: try the others this key can use.
  if (!r.ok && (missing(r) || busy(r))) {
    const options = [...PREFERRED, ...(await listModels(key, fetchFn).catch(() => []))].filter((x, i, all) => !tried.has(x) && all.indexOf(x) === i).slice(0, 4);
    for (const next of options) {
      ({ m, r } = await attempt(next));
      if (r.ok || !(missing(r) || busy(r))) break;
    }
  }
  if (!r.ok && r.status === 0) throw new Error(r.timedOut ? 'Gemini took too long to answer. Try SUMMARIZE again in a bit.' : 'Couldn\'t reach Gemini. Check the internet, then try SUMMARIZE again.');
  if (!r.ok) throw new Error(friendly(r.status, r.json));
  const cand = r.json && r.json.candidates && r.json.candidates[0];
  const text = cand && cand.content && Array.isArray(cand.content.parts) ? cand.content.parts.map((p) => p.text || '').join('') : '';
  if (!text) {
    const why = (cand && cand.finishReason) || (r.json && r.json.promptFeedback && r.json.promptFeedback.blockReason) || 'empty reply';
    throw new Error(`Gemini didn't write a summary (${String(why).toLowerCase()}).`);
  }
  return { model: m, ...parseRecap(text) };
}

// ---------------------------------------------------------------- Comm Tower 1
// Gemini words what Comm Tower 1 says back (the deck has already done the filing), and
// answers questions about the operator's day from the deck's own tasks and schedule.
const TOWER_SCHEMA = {
  type: 'OBJECT',
  properties: {
    reply: { type: 'STRING', description: 'What to say back. Short for quick things; longer (with line breaks) when the question needs it.' },
    act: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Deck commands to run NOW because the operator plainly asked for them, e.g. "Add task call the dentist on Friday", "Schedule lunch with Sam Tuesday at noon", "Set a timer for 20 minutes". Otherwise empty.' },
    command: { type: 'STRING', description: 'One deck command to OFFER (the reply asks "Want me to …? Type yes."). Otherwise empty.' },
    remember: { type: 'ARRAY', items: { type: 'STRING' }, description: 'New lasting facts worth keeping about the operator, their people, preferences or plans, each one short line in third person. Otherwise empty.' },
    forget: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Remembered lines (copied exactly) the operator wants dropped or that are now wrong. Otherwise empty.' },
    lookup: { type: 'STRING', description: 'Only when answering needs current information from the web (news, scores, prices, opening hours, anything after your training): a search query. Otherwise empty.' }
  },
  required: ['reply']
};

/** The standing instructions: who it is, how to talk, what it remembers, and what the deck holds right now. */
function towerPrompt({ name, operator, humor, context, memory }) {
  const who = operator || 'the operator';
  const dry = Number(humor) >= 60 ? 'Dry wit is welcome.' : Number(humor) <= 10 ? 'Strictly businesslike, no jokes.' : 'A touch of dry humor is fine, never forced.';
  const mem = (memory || []).filter(Boolean);
  return [
    `You are ${name || 'Comm Tower 1'}, the AI aboard ${who}'s Command Deck, a desktop console that holds their calendar, tasks, projects, notes and meeting recaps. ${who} talks to you by typing in its terminal. You are one ongoing conversation that carries across days and across their devices (this PC and their phone's Field Unit): the earlier messages are your shared history, so follow up on them, refer back to them and build on them naturally.`,
    `Personality: a capable, warm crew member, a little JARVIS. ${dry} Use ${who}'s name now and then, not every time.`,
    'Length: match the question. Quick things get a sentence or two. Questions that need explaining, planning, advice or detail get a proper answer: several sentences, with line breaks between steps or items (plain lines, starting a line with "- " is fine). No markdown symbols like ** or #, no emoji. Replies may be read aloud, so say dates and times the way a person would.',
    'Knowledge: answer general questions from your own knowledge, like any good assistant. For anything about ' + who + "'s own life (tasks, events, plans, people, notes), rely only on the deck data and memories below and never invent details. If you need fresh information from the web, put a search in \"lookup\".",
    'Doing things: when ' + who + ' plainly asks you to add, schedule, remind, time or complete something, put the deck command(s) in "act" and write the reply as if it is done (the deck runs them and reports any problem). When something would merely help, offer it in the reply ("Want me to …? Type yes.") and put the command in "command". Commands always spell out the day and time.',
    'Memory: when ' + who + ' tells you something lasting about themselves, their people, preferences, routines or plans, or says "remember", add a short line to "remember" (third person, with the date if it matters). Don\'t store passing chatter, things already in the deck data, passwords or account numbers. When asked to forget something, or a memory turns out wrong, copy that line into "forget". When asked what you remember, say it plainly.',
    '',
    mem.length ? `WHAT YOU REMEMBER ABOUT ${who.toUpperCase()} (oldest first):\n${mem.map((m) => `- ${m}`).join('\n')}` : 'WHAT YOU REMEMBER: nothing yet.',
    '',
    'THE DECK RIGHT NOW:',
    context || '(nothing)'
  ].join('\n');
}

/** The message turn: what was typed, plus what the deck already did (if anything). */
function towerTurn({ heard, done, when }) {
  const lines = [`${when ? `[${when}] ` : ''}${heard}`];
  if (done) {
    lines.push('', done.kind === 'err'
      ? `(The deck tried this as a command and hit a problem: "${done.reply}". Say so plainly and helpfully.)`
      : `(The deck has ALREADY done this. Its own confirmation: "${done.reply}". Say it back conversationally, keeping every fact exact. Leave "act" and "command" empty.)`);
  }
  return lines.join('\n');
}

const clean = (t, max) => String(t || '').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const list = (v, n, max) => (Array.isArray(v) ? v : []).map((x) => clean(x, max)).filter(Boolean).slice(0, n);

/** Model fallback shared by every call: the remembered model, the aliases, then whatever Flash the key can see. */
async function generate(key, model, body, fetchFn) {
  const tried = new Set();
  const attempt = async (m) => {
    tried.add(m);
    const r = await call(fetchFn, `models/${encodeURIComponent(m)}:generateContent`, key, body);
    return { m, r };
  };
  let { m, r } = await attempt(model || PREFERRED[0]);
  if (!r.ok && (r.status === 404 || (r.status === 400 && /not found|not supported/i.test(JSON.stringify(r.json || {}))))) {
    const options = [...PREFERRED, ...(await listModels(key, fetchFn).catch(() => []))].filter((x) => !tried.has(x));
    for (const next of options) {
      ({ m, r } = await attempt(next));
      if (r.ok || !(r.status === 404 || r.status === 400)) break;
    }
  }
  if (!r.ok) throw new Error(friendly(r.status, r.json));
  const cand = r.json && r.json.candidates && r.json.candidates[0];
  const text = cand && cand.content && Array.isArray(cand.content.parts) ? cand.content.parts.map((p) => p.text || '').join('') : '';
  return { model: m, text };
}

/** Returns { model, reply, command }. Throws on any problem; the deck falls back to its own reply. */
async function towerReply(opts, fetchFn = fetch) {
  const { key, model } = opts || {};
  if (!key) throw new Error('no key');
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs || 30000);
  const f = (url, init) => fetchFn(url, { ...init, signal: ac.signal });
  try {
    const history = (Array.isArray(opts.history) ? opts.history : []).filter((h) => h && h.text).slice(-40)
      .map((h) => ({ role: h.role === 'model' ? 'model' : 'user', parts: [{ text: String(h.text).slice(0, 3000) }] }));
    const body = {
      systemInstruction: { parts: [{ text: towerPrompt(opts) }] },
      contents: [...history, { role: 'user', parts: [{ text: towerTurn(opts) }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 6000, responseMimeType: 'application/json', responseSchema: TOWER_SCHEMA, thinkingConfig: { thinkingBudget: 1024 } }
    };
    let out;
    try {
      out = await generate(key, model, body, f);
    } catch (e) {
      // Some models don't take a thinking budget: try once more without it.
      if (!/thinking/i.test(String(e.message))) throw e;
      delete body.generationConfig.thinkingConfig;
      out = await generate(key, model, body, f);
    }
    let obj;
    try { obj = JSON.parse(String(out.text || '').replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch (e) { throw new Error('unreadable reply'); }
    const reply = clean(obj.reply, 3000);
    if (!reply) throw new Error('empty reply');
    return {
      model: out.model,
      reply,
      command: clean(obj.command, 200),
      act: list(obj.act, 3, 200),
      remember: list(obj.remember, 5, 200),
      forget: list(obj.forget, 10, 200),
      lookup: clean(obj.lookup, 200)
    };
  } finally {
    clearTimeout(timer);
  }
}

/** A web lookup for the terminal: Gemini with Google Search grounding, answering in plain text. */
async function towerLookup(opts, fetchFn = fetch) {
  const { key, model, query } = opts || {};
  if (!key || !query) throw new Error('nothing to look up');
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs || 30000);
  const f = (url, init) => fetchFn(url, { ...init, signal: ac.signal });
  try {
    const who = opts.operator || 'the operator';
    const body = {
      systemInstruction: { parts: [{ text: `You are ${opts.name || 'Comm Tower 1'}, the AI on ${who}'s Command Deck. Search the web and answer ${who}'s message from what you find: plainly, a little warm, short unless detail is needed. Plain text with line breaks, no markdown symbols, no links. Today is ${opts.when || new Date().toDateString()}.` }] },
      contents: [{ role: 'user', parts: [{ text: `${opts.heard || query}\n\n(Search for: ${query})` }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 4000 }
    };
    const out = await generate(key, model, body, f);
    const reply = clean(out.text, 3000);
    if (!reply) throw new Error('empty reply');
    return { model: out.model, reply };
  } finally {
    clearTimeout(timer);
  }
}

/** A quick check for the TEST KEY button. */
async function testKey(key, fetchFn = fetch) {
  if (!key) return { ok: false, error: 'Paste a key first.' };
  try {
    const models = await listModels(key, fetchFn);
    return models.length ? { ok: true, model: models[0] } : { ok: false, error: 'The key works, but no Flash model is available to it.' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { summarize, testKey, listModels, buildPrompt, parseRecap, RECAP_SCHEMA, towerReply, towerLookup, towerPrompt, towerTurn, TOWER_SCHEMA };
