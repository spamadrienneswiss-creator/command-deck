// ============================================================
// DATA RECAP (deck side)
// A recording sent from Field Unit arrives in pieces through the uplink. The main console
// collects it, keeps the audio on this computer, transcribes it with Whisper (on this PC),
// asks Gemini for the summary, main points and action items, and files it all as a note with
// src "recap", which syncs back to the phone like any other note.
//
// note.recap = {
//   status: uploading | queued | receiving | decoding | transcribing | summarizing | ready | error
//   progress (0–100), error, summaryError,
//   fileName, sizeBytes, durationSec, recordedAt, readyAt, uploadId,
//   include: { summary, points, actions, transcript },
//   summary, points: [], actions: [{ id, text, taskId }], transcript: [{ t, text }],
//   audio: { keep: keep | d30 | now, deleted, deleting }
// }
// ============================================================
import { decodeRecording, TARGET_RATE } from './audio.js';

const DAY = 864e5;
const BLOCK_SEC = 300; // Whisper gets five minutes at a time
const UNDO_MS = 8000;

let H = null;
const R = {
  busy: false,
  queue: [], // jobs: { kind: 'upload', up } | { kind: 'audio', noteId } | { kind: 'summary', noteId }
  seenUploads: new Set(),
  worker: null,
  pending: new Map(),
  seq: 0,
  device: null,
  deleting: new Map(), // noteId -> timer for DELETE NOW's undo window
  lastWrite: new Map() // noteId -> { status, progress } last synced
};

// ---------------------------------------------------------------- helpers
export function isRecap(n) { return !!(n && n.src === 'recap' && n.recap); }
export function audioDeleteAt(rc) {
  if (!rc || !rc.audio || rc.audio.deleted) return null;
  if (rc.audio.keep === 'now') return Date.now();
  if (rc.audio.keep === 'd30' && rc.readyAt) return rc.readyAt + 30 * DAY;
  return null;
}
function findNote(id) { return H.getNotes().find((n) => n.id === id) || null; }
function uid(p = '') { return p + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }

/** Updates a recap. Progress-only changes are written at most every few percent so the phone isn't flooded. */
function patch(id, fields, { force = false } = {}) {
  const n = findNote(id);
  if (!n) return null;
  const oldAudio = (n.recap && n.recap.audio) || {};
  n.recap = { ...n.recap, ...fields };
  if (fields.audio) n.recap.audio = { ...oldAudio, ...fields.audio };
  n.editedAt = new Date().toISOString();
  n.editedOn = 'command';
  const last = R.lastWrite.get(id) || {};
  const quiet = !force && last.status === n.recap.status && Math.abs((n.recap.progress || 0) - (last.progress || 0)) < 4 && Object.keys(fields).every((k) => k === 'progress');
  if (quiet) { H.render(); return n; }
  R.lastWrite.set(id, { status: n.recap.status, progress: n.recap.progress || 0 });
  H.saveNotes();
  return n;
}

// ---------------------------------------------------------------- Whisper worker
function worker() {
  if (R.worker) return R.worker;
  R.worker = new Worker(new URL('./recap-worker.js', import.meta.url), { type: 'module' });
  R.worker.onmessage = (e) => {
    const { id, type } = e.data || {};
    const p = R.pending.get(id);
    if (!p) return;
    R.pending.delete(id);
    if (e.data.device) R.device = e.data.device;
    if (type === 'error') p.reject(new Error(e.data.error));
    else p.resolve(e.data);
  };
  R.worker.onerror = (e) => {
    R.pending.forEach((p) => p.reject(new Error((e && e.message) || 'Transcription engine stopped')));
    R.pending.clear();
    R.worker = null;
  };
  return R.worker;
}
// The engine holds its own copy of the speech model (a few hundred MB), so it
// shuts down shortly after the last recording is transcribed. The next recap
// starts it again from the computer's cache.
const IDLE_MS = 90 * 1000;
let idleTimer = null;
function releaseLater() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!R.worker || R.pending.size) return;
    R.worker.terminate();
    R.worker = null;
  }, IDLE_MS);
}
function ask(msg, transfer) {
  const id = ++R.seq;
  clearTimeout(idleTimer);
  const p = new Promise((resolve, reject) => {
    R.pending.set(id, { resolve, reject });
    worker().postMessage({ id, ...msg }, transfer || []);
  });
  p.then(releaseLater, releaseLater);
  return p;
}

// Cuts between blocks land in the quietest moment near the five-minute mark, not mid-word.
export function quietCut(samples, ideal, rate = TARGET_RATE) {
  const win = Math.round(rate * 0.2);
  const span = rate * 4;
  let best = ideal;
  let bestE = Infinity;
  for (let c = Math.max(win, ideal - span); c <= Math.min(samples.length - win, ideal + span); c += Math.round(win / 2)) {
    let e = 0;
    for (let i = c - win; i < c; i++) e += samples[i] * samples[i];
    if (e < bestE) { bestE = e; best = c; }
  }
  return best;
}

/** Whisper's short phrases → readable transcript lines (one sentence or so each), keeping the first timestamp. */
export function mergeSegments(segs) {
  const lines = [];
  let cur = null;
  for (const s of segs) {
    const text = String(s.text || '').trim();
    if (!text) continue;
    if (!cur) { cur = { t: s.t, text }; continue; }
    const words = cur.text.split(/\s+/).length;
    const gap = s.t - cur.t;
    if ((/[.?!]["')\]]?$/.test(cur.text) && words >= 8) || words >= 28 || gap > 40) {
      lines.push(cur);
      cur = { t: s.t, text };
    } else cur.text = `${cur.text} ${text}`;
  }
  if (cur) lines.push(cur);
  return lines.map((l) => ({ t: Math.round(l.t * 10) / 10, text: l.text.replace(/\s+/g, ' ') }));
}

async function transcribe(samples, onProgress) {
  await ask({ type: 'load' });
  const block = BLOCK_SEC * TARGET_RATE;
  const segs = [];
  let start = 0;
  while (start < samples.length) {
    let end = Math.min(samples.length, start + block);
    if (end < samples.length - TARGET_RATE * 20) end = quietCut(samples, end);
    else end = samples.length; // don't leave a few seconds stranded at the end
    const piece = samples.slice(start, end); // a copy, handed over to the worker
    const res = await ask({ type: 'transcribe', audio: piece, offset: start / TARGET_RATE }, [piece.buffer]);
    segs.push(...(res.segments || []));
    start = end;
    onProgress(start / samples.length);
  }
  return mergeSegments(segs);
}

// ---------------------------------------------------------------- the pipeline
function enqueue(job) {
  const key = job.kind === 'upload' ? `u:${job.up.id}` : `${job.kind}:${job.noteId}`;
  if (R.queue.some((j) => j.key === key)) return;
  R.queue.push({ ...job, key });
  pump();
}

async function pump() {
  if (R.busy || !R.queue.length) return;
  R.busy = true;
  const job = R.queue.shift();
  try {
    if (job.kind === 'upload') await receive(job.up);
    else if (job.kind === 'audio') await processAudio(job.noteId, null);
    else if (job.kind === 'summary') await summarize(job.noteId);
  } catch (e) {
    console.error('Data Recap:', e);
    // Never leave a recap showing a step that has stopped (v1.28.1).
    const n = job.noteId && findNote(job.noteId);
    if (n && n.recap && !['ready', 'error'].includes(n.recap.status)) {
      if (n.recap.status === 'summarizing') patch(n.id, { status: 'ready', progress: 100, summaryError: friendlyError(e) }, { force: true });
      else patch(n.id, { status: 'error', error: friendlyError(e) }, { force: true });
    }
  } finally {
    R.busy = false;
    setTimeout(pump, 50);
  }
}

function ensureNote(up) {
  let n = findNote(up.noteId);
  if (n) return n;
  // The phone's note hasn't synced over yet: start one from what the upload says.
  const now = new Date().toISOString();
  n = {
    id: up.noteId, title: up.title || 'Data Recap', body: '', pinned: false, src: 'recap', createdAt: now, editedAt: now, editedOn: 'command',
    recap: { status: 'queued', progress: 0, fileName: up.fileName || '', sizeBytes: up.size || 0, recordedAt: up.recordedAt || null, uploadId: up.id, include: up.include || {}, audio: { keep: up.audio || 'd30' } }
  };
  H.getNotes().unshift(n);
  H.saveNotes();
  return n;
}

async function receive(up) {
  const n = ensureNote(up);
  const id = n.id;
  patch(id, { status: 'receiving', progress: 0, error: '' }, { force: true });
  const bytes = await H.FU.fetchRecapUpload(up, (f) => patch(id, { progress: Math.round(f * 10) }));
  const ext = (String(up.fileName || '').match(/\.([a-z0-9]{2,5})$/i) || [])[1] || 'm4a';
  await H.deck.recap.save(id, ext.toLowerCase(), bytes);
  await H.FU.clearRecapUpload(up).catch(() => {});
  patch(id, { sizeBytes: bytes.length, progress: 10 });
  await processAudio(id, bytes);
}

async function processAudio(id, bytes) {
  const n = findNote(id);
  if (!n) return;
  try {
    if (!bytes) bytes = await H.deck.recap.read(id);
    if (!bytes) throw new Error('The recording isn\'t on this computer anymore.');
    patch(id, { status: 'decoding', progress: 10, error: '' }, { force: true });
    const { samples, durationSec } = await decodeRecording(bytes, (f) => patch(id, { progress: 10 + Math.round(f * 5) }));
    bytes = null;
    patch(id, { status: 'transcribing', progress: 15, durationSec: Math.round(durationSec) }, { force: true });
    const transcript = await transcribe(samples, (f) => patch(id, { progress: 15 + Math.round(f * 75) }));
    patch(id, { transcript, progress: 90 }, { force: true });
    await summarize(id, { chained: true });
  } catch (e) {
    const msg = friendlyError(e);
    patch(id, { status: 'error', error: msg }, { force: true });
    H.pushLog('err', `Data Recap failed: ${msg}`);
  }
}

/** Plain words for what went wrong. The usual one: the speech model couldn't download (no internet). */
export function friendlyError(e) {
  const raw = String((e && e.message) || e || '');
  if (/failed to fetch|networkerror|load failed|err_internet|err_name|unable to load|could not locate file/i.test(raw)) {
    return 'Couldn\'t load the transcription engine. It downloads once (about 150 MB) and needs the internet for that. TRY AGAIN once this PC is online.';
  }
  if (/out of memory|allocation|array buffer/i.test(raw)) return 'This PC ran out of memory reading the recording. Close a few programs and TRY AGAIN.';
  return raw || 'Something went wrong.';
}

async function summarize(id, { chained = false } = {}) {
  const n = findNote(id);
  if (!n) return;
  const rc = n.recap;
  const s = H.getSettings().recap || {};
  patch(id, { status: 'summarizing', progress: Math.max(90, rc.progress || 0), summaryError: '' }, { force: true });
  const inc = { summary: true, points: true, actions: true, transcript: true, ...(rc.include || {}) };
  let fields = {};
  if (!s.geminiKey) {
    fields.summaryError = 'Add a free Gemini key in Settings › Field Unit › DATA RECAP to get the summary, main points and action items. The transcript is ready now.';
  } else if (!(rc.transcript || []).length) {
    fields.summaryError = 'No speech was found in the recording.';
  } else {
    const r = await H.deck.recap.summarize({ key: s.geminiKey, model: s.model || '', transcript: rc.transcript, title: n.title, include: inc }).catch((e) => ({ ok: false, error: friendlyError(e) }));
    if (r && r.ok) {
      fields = {
        summary: inc.summary ? r.summary : '',
        points: inc.points ? r.points : [],
        actions: inc.actions ? r.actions.map((text) => ({ id: uid('ra_'), text, taskId: null })) : [],
        summaryError: ''
      };
      if (r.model && r.model !== s.model) H.saveRecapSettings({ ...s, model: r.model });
      // A default name from Voice Memos ("New Recording 14") gets Gemini's better one.
      if (r.title && (!n.title || /^new recording\b/i.test(n.title) || /^recording\b/i.test(n.title))) n.title = r.title;
    } else {
      fields.summaryError = (r && r.error) || 'Gemini didn\'t answer.';
    }
  }
  const first = !rc.readyAt;
  const readyAt = rc.readyAt || Date.now();
  const transcript = inc.transcript === false ? [] : rc.transcript;
  const body = [fields.summary || rc.summary || '', ...((fields.points || rc.points || []).map((p) => `• ${p}`))].filter(Boolean).join('\n');
  patch(id, { ...fields, transcript, status: 'ready', progress: 100, readyAt, error: '' }, { force: true });
  const cur = findNote(id);
  if (cur) { cur.body = body; H.saveNotes(); }
  sweepAudio();
  if (first || !chained) {
    const title = (cur && cur.title) || 'Data Recap';
    H.toast(`Data Recap ready: ${title}`, 4000);
    H.pushLog('ok', `Data Recap ready: ${title}.`);
    H.FU.notifyPhones({ title: 'Data Recap ready', body: title, tag: `recap-${id}`, recapId: id });
    if (H.onReady && cur) H.onReady(cur);
  }
}

// ---------------------------------------------------------------- audio on this computer
/** Deletes recordings whose time is up (or that were set to DELETE NOW, here or on the phone). */
export async function sweepAudio() {
  if (!H || H.FU.isJoined()) return;
  const now = Date.now();
  for (const n of H.getNotes()) {
    if (!isRecap(n) || n.recap.status !== 'ready') continue;
    const at = audioDeleteAt(n.recap);
    if (at == null || at > now || R.deleting.has(n.id)) continue;
    await H.deck.recap.remove(n.id).catch(() => false);
    patch(n.id, { audio: { deleted: true, deleting: false } }, { force: true });
  }
}

export function setAudioKeep(id, keep) {
  const n = findNote(id);
  if (!n) return;
  cancelDelete(id, false);
  patch(id, { audio: { keep, deleting: false } }, { force: true });
  sweepAudio();
}

/** DELETE NOW from the deck: gone after a few seconds unless UNDO is tapped. */
export function deleteAudioSoon(id) {
  const n = findNote(id);
  if (!n || R.deleting.has(id)) return;
  patch(id, { audio: { deleting: true } }, { force: true });
  R.deleting.set(id, setTimeout(async () => {
    R.deleting.delete(id);
    await H.deck.recap.remove(id).catch(() => false);
    patch(id, { audio: { deleted: true, deleting: false } }, { force: true });
  }, UNDO_MS));
}
export function cancelDelete(id, write = true) {
  const t = R.deleting.get(id);
  if (t) { clearTimeout(t); R.deleting.delete(id); }
  if (write) patch(id, { audio: { deleting: false } }, { force: true });
}

// ---------------------------------------------------------------- actions from the UI
export function retry(id) {
  const n = findNote(id);
  if (!n || !isRecap(n)) return;
  patch(id, { status: 'queued', error: '' }, { force: true });
  enqueue({ kind: 'audio', noteId: id });
}
export function summarizeAgain(id) {
  const n = findNote(id);
  if (!n || !isRecap(n)) return;
  enqueue({ kind: 'summary', noteId: id });
}
/** Turns an action item into a task (once). Returns the task. */
export function actionToTask(id, actionId) {
  const n = findNote(id);
  if (!n || !isRecap(n)) return null;
  const a = (n.recap.actions || []).find((x) => x.id === actionId);
  if (!a || a.taskId) return null;
  const t = H.newTask({ title: a.text, notes: `From the Data Recap "${n.title}".` });
  n.recap.actions = n.recap.actions.map((x) => (x.id === actionId ? { ...x, taskId: t.id } : x));
  patch(id, { actions: n.recap.actions }, { force: true });
  return t;
}
export function allActionsToTasks(id) {
  const n = findNote(id);
  if (!n || !isRecap(n)) return 0;
  let c = 0;
  (n.recap.actions || []).forEach((a) => { if (!a.taskId && actionToTask(id, a.id)) c++; });
  return c;
}
export async function audioInfo(id) {
  try { return await H.deck.recap.info(id); } catch (e) { return { exists: false, size: 0 }; }
}
export function engineName() { return R.device === 'webgpu' ? 'graphics card' : R.device === 'wasm' ? 'processor' : ''; }

// ---------------------------------------------------------------- start
export function initRecap(hooks) {
  H = hooks;
  H.FU.onRecapUploads((list) => {
    if (H.FU.isJoined()) return;
    list.forEach((up) => {
      if (R.seenUploads.has(up.id)) return;
      R.seenUploads.add(up.id);
      enqueue({ kind: 'upload', up });
    });
  });
  // Pick up anything that was mid-way when the deck last closed.
  setTimeout(async () => {
    if (H.FU.isJoined()) return;
    for (const n of H.getNotes().filter(isRecap)) {
      const st = n.recap.status;
      if (st === 'decoding' || st === 'transcribing') enqueue({ kind: 'audio', noteId: n.id });
      else if (st === 'summarizing') enqueue({ kind: 'summary', noteId: n.id });
      // Saved here but not processed yet (the uplink copy is already gone): carry on from the file.
      else if (st === 'receiving' && (await audioInfo(n.id)).exists) enqueue({ kind: 'audio', noteId: n.id });
      // A meeting recording cut off when the deck closed: recap what was saved.
      else if (st === 'recording' && !(H.isRecordingNow && H.isRecordingNow(n.id))) {
        if ((await audioInfo(n.id)).exists) { patch(n.id, { status: 'queued', recovered: true }, { force: true }); enqueue({ kind: 'audio', noteId: n.id }); }
        else patch(n.id, { status: 'error', error: 'The recording stopped before anything was saved.' }, { force: true });
      }
      if (n.recap.audio && n.recap.audio.deleting) cancelDelete(n.id);
    }
    sweepAudio();
  }, 4000);
  setInterval(sweepAudio, 3600 * 1000);
  H.getNotes().filter(isRecap).forEach((n) => known.add(n.id));
}

/** Called when notes arrive from the phone: a DELETE NOW, a new keep choice, or a recap deleted there. */
const known = new Set();
export function notesChanged() {
  if (!H) return;
  const now = new Set(H.getNotes().filter(isRecap).map((n) => n.id));
  if (!H.FU.isJoined()) known.forEach((id) => { if (!now.has(id) && !R.queue.some((j) => j.noteId === id)) H.deck.recap.remove(id).catch(() => {}); });
  known.clear();
  now.forEach((id) => known.add(id));
  sweepAudio();
}

/** A meeting recorded on this PC (meeting.js) is saved: start the recap. */
export function recapLocal(id, ms) {
  patch(id, { status: 'queued', progress: 0, durationSec: Math.round((ms || 0) / 1000), error: '' }, { force: true });
  enqueue({ kind: 'audio', noteId: id });
}
