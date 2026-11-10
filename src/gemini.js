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
    reply: { type: 'STRING', description: 'What to say out loud: one or two short sentences' },
    command: { type: 'STRING', description: 'Only when the reply offers to add or set something: the exact command for the deck, e.g. "Add dentist appointment on Tuesday November 10 at 10 AM". Otherwise empty.' }
  },
  required: ['reply']
};

function towerPrompt({ name, operator, humor, heard, done, context }) {
  const who = operator || 'the operator';
  const dry = Number(humor) >= 60 ? 'Dry wit is welcome, lightly.' : Number(humor) <= 10 ? 'Strictly businesslike, no jokes.' : 'A touch of dry humor is fine, never forced.';
  return [
    `You are ${name || 'Comm Tower 1'}, the voice on the comms line of ${who}'s Command Deck (a desktop console). ${who} just typed a message to you in its terminal.`,
    `Talk like a capable, warm crew member on a ship's comms line: natural, brief, friendly, a little JARVIS. ${dry}`,
    'Your reply is shown in the terminal and may be read aloud: one or two short sentences, usually under 35 words. No lists, no markdown, no emoji. Say dates and times the way a person would ("Friday the 20th", "10 in the morning").',
    `Use ${who}'s name now and then, not every time.`,
    'Only state facts that appear below. Never invent tasks, events, times or plans.',
    '',
    done
      ? `The deck has ALREADY done what was asked. Its own confirmation: "${done.reply}". (${done.kind === 'err' ? 'This was a problem, not a success: say so plainly and helpfully.' : 'Say it back conversationally, keeping every fact exact: titles, dates, times, amounts.'}) If something in the context below is clearly and usefully related (a clash, a same-day errand, an overdue item), you may mention it in a few words; otherwise don't. Leave "command" empty.`
      : 'This is a question or a request the deck can\'t do by itself. Answer it from the context below. If the honest answer is that you don\'t know, say so briefly. If adding a task, event, reminder or timer would clearly help, offer it in the reply ("Want me to …? Type yes.") and put the matching deck command, with an explicit day and time, in "command". Never claim you already did it.',
    '',
    `${who} typed: "${heard}"`,
    '',
    'CONTEXT FROM THE DECK:',
    context || '(nothing)'
  ].join('\n');
}

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
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs || 7000);
  const f = (url, init) => fetchFn(url, { ...init, signal: ac.signal });
  try {
    const body = {
      contents: [{ role: 'user', parts: [{ text: towerPrompt(opts) }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 400, responseMimeType: 'application/json', responseSchema: TOWER_SCHEMA, thinkingConfig: { thinkingBudget: 0 } }
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
    const reply = String(obj.reply || '').replace(/\s+/g, ' ').trim().slice(0, 400);
    if (!reply) throw new Error('empty reply');
    return { model: out.model, reply, command: String(obj.command || '').trim().slice(0, 200) };
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

module.exports = { summarize, testKey, listModels, buildPrompt, parseRecap, RECAP_SCHEMA, towerReply, towerPrompt, TOWER_SCHEMA };
